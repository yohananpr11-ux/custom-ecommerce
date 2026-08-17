// Coverage for backend/services/sqlite-offsite-backup.js and its
// integration point in backend/services/sqlite-backup.js's runBackupCycle().
// Fully mocked/local: no real S3, no internet, no Render, no /var/data.
// The fake S3 client below implements the same .send(command) shape the
// real @aws-sdk/client-s3 client does, using the REAL PutObjectCommand/
// HeadObjectCommand classes so `instanceof` checks in the module under test
// behave exactly as they would against the genuine SDK -- only the network
// transport is replaced. It also honors IfNoneMatch:'*' semantics (throwing
// a PreconditionFailed-shaped error on an existing key) and correctly
// consumes a Readable-stream Body, since the module under test now streams
// the .db upload rather than buffering it.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const sqlite3 = require('sqlite3').verbose();
const { PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-offsite-backup-test-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';

const sqliteBackup = require('../services/sqlite-backup');
const offsite = require('../services/sqlite-offsite-backup');

function openDb(dbPath) {
  return new sqlite3.Database(dbPath);
}
function closeDb(conn) {
  return new Promise((resolve) => conn.close(() => resolve()));
}
function run(conn, sql, params = []) {
  return new Promise((resolve, reject) => conn.run(sql, params, function (err) { if (err) reject(err); else resolve(this); }));
}

test.afterEach(() => {
  sqliteBackup._resetBackupStateForTests();
  offsite._resetOffsiteStateForTests();
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

const FAKE_CONFIG_ENV = {
  ENABLE_OFFSITE_BACKUP: 'true',
  OFFSITE_BACKUP_BUCKET: 'test-bucket',
  OFFSITE_BACKUP_REGION: 'us-east-1',
  OFFSITE_BACKUP_ACCESS_KEY_ID: 'AKIA_FAKE_TEST_KEY_DO_NOT_LEAK',
  OFFSITE_BACKUP_SECRET_ACCESS_KEY: 'fake/secret+key/DO-NOT-LEAK=1234567890',
  OFFSITE_BACKUP_KEY_PREFIX: 'jono',
};

function preconditionFailedError() {
  const err = new Error('At least one of the pre-conditions you specified did not hold');
  err.name = 'PreconditionFailed';
  err.$metadata = { httpStatusCode: 412 };
  return err;
}

async function readBody(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body && typeof body.pipe === 'function') {
    const chunks = [];
    for await (const chunk of body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return Buffer.from(body);
}

/** In-memory stand-in for an S3-compatible client. Never touches a network. */
function makeFakeClient(overrides = {}) {
  const store = new Map();
  const calls = [];
  return {
    calls,
    store,
    send: async (command) => {
      calls.push(command);
      if (overrides.onSend) {
        const result = await overrides.onSend(command, store);
        if (result !== undefined) return result;
      }
      if (command instanceof PutObjectCommand) {
        const { Key, Body, Metadata, IfNoneMatch } = command.input;
        if (IfNoneMatch === '*' && store.has(Key)) {
          throw preconditionFailedError();
        }
        const isStreamBody = Boolean(Body && typeof Body.pipe === 'function');
        const bodyBuffer = await readBody(Body);
        store.set(Key, { body: bodyBuffer, metadata: Metadata || {}, size: bodyBuffer.length, wasStreamBody: isStreamBody });
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        const { Key } = command.input;
        const obj = store.get(Key);
        if (!obj) {
          const err = new Error('Not Found');
          err.name = 'NotFound';
          throw err;
        }
        return { ContentLength: obj.size, Metadata: obj.metadata };
      }
      throw new Error(`unexpected command in fake client: ${command.constructor.name}`);
    },
  };
}

async function seedLocalBackup(backupDir) {
  const sourceDbPath = path.join(tmpDir, `source-${Date.now()}-${Math.random()}.db`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
  await run(sourceDb, "INSERT INTO t (val) VALUES ('hello')");

  const result = await sqliteBackup.runBackup({
    db: sourceDb,
    dbPath: sourceDbPath,
    backupDir,
    now: new Date(),
    log: () => {},
  });
  await closeDb(sourceDb);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 — disabled by default: zero client construction / zero upload calls
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 1: off-site disabled by default -- zero client construction, zero upload calls', async () => {
  const client = makeFakeClient();
  const result = await offsite.uploadBackupOffsite(
    { path: '/does/not/matter.db', filename: 'does-not-matter.db' },
    { env: {}, client },
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(client.calls.length, 0, 'a client was injected but must never be used while disabled');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2/3/4 — orchestration: runBackupCycle only uploads on real success
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 2: a successful local backup triggers exactly one off-site upload attempt', async () => {
  const backupDir = path.join(tmpDir, `cycle-success-${Date.now()}`);
  const client = makeFakeClient();

  const sourceDbPath = path.join(tmpDir, `source-cycle-${Date.now()}.db`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  const result = await sqliteBackup.runBackupCycle({
    db: sourceDb,
    dbPath: sourceDbPath,
    backupDir,
    now: new Date(),
    log: () => {},
    env: FAKE_CONFIG_ENV,
    offsiteClient: client,
  });

  assert.equal(result.skipped, false);
  assert.ok(client.calls.length > 0, 'expected at least one call to the off-site client');
  const putCalls = client.calls.filter((c) => c instanceof PutObjectCommand);
  assert.equal(putCalls.length, 2, 'expected exactly one PutObject for the .db and one for the .sha256');

  await closeDb(sourceDb);
});

test('TEST 3: a failed local backup triggers zero off-site upload attempts', async () => {
  const backupDir = path.join(tmpDir, `cycle-fail-${Date.now()}`);
  const client = makeFakeClient();

  const sourceDbPath = path.join(tmpDir, `source-cycle-fail-${Date.now()}.db`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  await assert.rejects(
    () => sqliteBackup.runBackupCycle({
      db: sourceDb,
      dbPath: sourceDbPath,
      backupDir,
      now: new Date(),
      log: () => {},
      verifyIntegrity: async () => false,
      env: FAKE_CONFIG_ENV,
      offsiteClient: client,
    }),
    /integrity check failed/i,
  );

  assert.equal(client.calls.length, 0, 'a failed local backup must never reach the off-site client at all');
  await closeDb(sourceDb);
});

test('TEST 4: a skipped local backup (single-flight guard already held) triggers zero off-site upload attempts', async () => {
  const backupDir = path.join(tmpDir, `cycle-skip-${Date.now()}`);
  const client = makeFakeClient();

  const sourceDbPath = path.join(tmpDir, `source-cycle-skip-${Date.now()}.db`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  const first = sqliteBackup.runBackupCycle({
    db: sourceDb, dbPath: sourceDbPath, backupDir, now: new Date(), log: () => {},
    env: FAKE_CONFIG_ENV, offsiteClient: client,
  });
  const second = await sqliteBackup.runBackupCycle({
    db: sourceDb, dbPath: sourceDbPath, backupDir, now: new Date(), log: () => {},
    env: FAKE_CONFIG_ENV, offsiteClient: makeFakeClient(),
  });

  assert.equal(second.skipped, true, 'the second, overlapping call must be skipped by runBackup\'s own guard');
  await first;
  await closeDb(sourceDb);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5/6/7 — upload content, checksum metadata, HEAD verification
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 5/6/7: uploads both .db and .sha256, metadata sha256 matches the real local checksum, HEAD verifies size + checksum for both objects', async () => {
  const backupDir = path.join(tmpDir, `content-${Date.now()}`);
  const client = makeFakeClient();
  const backupResult = await seedLocalBackup(backupDir);
  assert.equal(backupResult.skipped, false);

  const localDbBuffer = fs.readFileSync(backupResult.path);
  const localChecksum = crypto.createHash('sha256').update(localDbBuffer).digest('hex');
  const localSha256Buffer = fs.readFileSync(`${backupResult.path}.sha256`);

  const uploadResult = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });

  assert.equal(uploadResult.skipped, false);
  assert.equal(uploadResult.uploaded, true);

  // TEST 5: both objects present
  assert.ok(client.store.has(uploadResult.dbKey), '.db object must be present');
  assert.ok(client.store.has(uploadResult.sha256Key), '.sha256 object must be present');
  assert.equal(uploadResult.sha256Key, `${uploadResult.dbKey}.sha256`);

  // TEST 6: metadata sha256 matches the real local checksum
  const storedDbObject = client.store.get(uploadResult.dbKey);
  assert.equal(storedDbObject.metadata.sha256, localChecksum);
  assert.equal(storedDbObject.size, localDbBuffer.length);

  const storedSidecarObject = client.store.get(uploadResult.sha256Key);
  assert.equal(storedSidecarObject.size, localSha256Buffer.length);

  // TEST 7: HEAD verification -- with the pre-upload existence check removed
  // (see IfNoneMatch tests below), every HeadObjectCommand call here is
  // post-upload verification: one for the .db, one for the .sha256.
  const headCalls = client.calls.filter((c) => c instanceof HeadObjectCommand);
  assert.equal(headCalls.length, 2, 'expected exactly two post-upload verification HEAD calls (.db and .sha256), no pre-upload check');
  assert.equal(headCalls[0].input.Key, uploadResult.dbKey);
  assert.equal(headCalls[1].input.Key, uploadResult.sha256Key);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8 — metadata/checksum mismatch is treated as a failure
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 8: a post-upload checksum metadata mismatch is reported as an off-site failure', async () => {
  const backupDir = path.join(tmpDir, `mismatch-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  const client = makeFakeClient({
    onSend: async (command) => {
      if (command instanceof HeadObjectCommand) {
        // Every HEAD call is now post-upload verification; tamper the first
        // one (the .db check) to prove a mismatch is caught.
        return { ContentLength: 999999, Metadata: { sha256: 'not-the-real-checksum' } };
      }
      return undefined; // default PutObjectCommand behavior
    },
  });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.skipped, false);
  assert.equal(result.uploaded, false);
  assert.match(result.error, /mismatch/i);
});

test('TEST 8b: a post-upload sidecar size mismatch is reported as an off-site failure', async () => {
  const backupDir = path.join(tmpDir, `sidecar-mismatch-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  const client = makeFakeClient({
    onSend: async (command, store) => {
      if (command instanceof HeadObjectCommand && command.input.Key.endsWith('.sha256')) {
        return { ContentLength: 999999, Metadata: {} };
      }
      return undefined;
    },
  });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.uploaded, false);
  assert.match(result.error, /sidecar size mismatch/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 9/10 — a failed upload never touches local files
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 9/10: a network/upload failure leaves the local .db and .sha256 files untouched', async () => {
  const backupDir = path.join(tmpDir, `local-untouched-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  const dbBefore = fs.readFileSync(backupResult.path);
  const shaBefore = fs.readFileSync(`${backupResult.path}.sha256`);

  const client = makeFakeClient({
    onSend: async (command) => {
      if (command instanceof PutObjectCommand) {
        throw new Error('simulated network failure');
      }
      return undefined;
    },
  });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.uploaded, false);

  assert.ok(fs.existsSync(backupResult.path), 'local .db must still exist');
  assert.ok(fs.existsSync(`${backupResult.path}.sha256`), 'local .sha256 must still exist');
  assert.deepEqual(fs.readFileSync(backupResult.path), dbBefore, 'local .db content must be byte-identical');
  assert.deepEqual(fs.readFileSync(`${backupResult.path}.sha256`), shaBefore, 'local .sha256 content must be byte-identical');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 11 — off-site failure never converts a successful local backup into a failure
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 11: an off-site failure does not convert a successful local backup into a failure', async () => {
  const backupDir = path.join(tmpDir, `no-cascade-${Date.now()}`);
  const client = makeFakeClient({
    onSend: async (command) => {
      if (command instanceof PutObjectCommand) throw new Error('simulated provider outage');
      return undefined;
    },
  });

  const sourceDbPath = path.join(tmpDir, `source-no-cascade-${Date.now()}.db`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  const result = await sqliteBackup.runBackupCycle({
    db: sourceDb, dbPath: sourceDbPath, backupDir, now: new Date(), log: () => {},
    env: FAKE_CONFIG_ENV, offsiteClient: client,
  });

  assert.equal(result.skipped, false, 'runBackupCycle must still report the local backup as successful');
  assert.ok(result.path && fs.existsSync(result.path));

  await closeDb(sourceDb);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 12/13 — single-flight guard: no overlap, no queueing
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 12/13: a second overlapping upload is skipped immediately, not queued behind the first', async () => {
  const backupDir = path.join(tmpDir, `single-flight-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const slowClient = makeFakeClient({
    onSend: async (command) => {
      if (command instanceof PutObjectCommand) {
        await firstGate; // hang until the test releases it
      }
      return undefined;
    },
  });

  const firstCallPromise = offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client: slowClient, log: () => {} });

  // Give the first call a tick to acquire the guard before starting the second.
  await new Promise((resolve) => setImmediate(resolve));

  const secondClient = makeFakeClient();
  const secondStart = Date.now();
  const secondResult = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client: secondClient, log: () => {} });
  const secondElapsedMs = Date.now() - secondStart;

  assert.equal(secondResult.skipped, true);
  assert.equal(secondResult.reason, 'in_progress');
  assert.equal(secondClient.calls.length, 0, 'the second call must never touch its own client at all');
  assert.ok(secondElapsedMs < 500, `second call must resolve immediately, not wait behind the first (took ${secondElapsedMs}ms)`);

  releaseFirst();
  await firstCallPromise;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 14 — missing configuration fails safely
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 14: missing required configuration fails safely, no client used, no credential leakage', async () => {
  const client = makeFakeClient();
  const incompleteEnv = { ENABLE_OFFSITE_BACKUP: 'true', OFFSITE_BACKUP_BUCKET: 'test-bucket' }; // missing region/keys
  const result = await offsite.uploadBackupOffsite(
    { path: '/does/not/matter.db', filename: 'x.db' },
    { env: incompleteEnv, client },
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'misconfigured');
  assert.equal(client.calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 15 — secrets never appear in logged output
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 15: the access key and secret key never appear in any logged output, even on failure', async () => {
  const backupDir = path.join(tmpDir, `secret-leak-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  const logged = [];
  const captureLog = (...args) => logged.push(args.map(String).join(' '));
  const { mock } = test;
  const errorMock = mock.method(console, 'error', captureLog);

  try {
    const client = makeFakeClient({
      onSend: async (command) => {
        if (command instanceof PutObjectCommand) {
          const err = new Error(`upload failed for key ${command.input.Key} with credentials ${FAKE_CONFIG_ENV.OFFSITE_BACKUP_ACCESS_KEY_ID}`);
          err.$metadata = { httpStatusCode: 403 };
          throw err;
        }
        return undefined;
      },
    });

    await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: captureLog });
  } finally {
    errorMock.mock.restore();
  }

  const allOutput = logged.join('\n');
  assert.doesNotMatch(allOutput, new RegExp(FAKE_CONFIG_ENV.OFFSITE_BACKUP_ACCESS_KEY_ID.replace(/[/+=]/g, '\\$&')));
  assert.doesNotMatch(allOutput, new RegExp(FAKE_CONFIG_ENV.OFFSITE_BACKUP_SECRET_ACCESS_KEY.replace(/[/+=]/g, '\\$&')));
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 16 — object-key/prefix normalization
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 16: object key/prefix normalization strips slashes and rejects path-traversal segments', () => {
  assert.equal(offsite.normalizeKeyPrefix('jono'), 'jono');
  assert.equal(offsite.normalizeKeyPrefix('/jono/'), 'jono');
  assert.equal(offsite.normalizeKeyPrefix('jono//backups///'), 'jono/backups');
  assert.equal(offsite.normalizeKeyPrefix('../../etc'), 'etc');
  assert.equal(offsite.normalizeKeyPrefix('./jono/./x'), 'jono/x');
  assert.equal(offsite.normalizeKeyPrefix(''), '');
  assert.equal(offsite.normalizeKeyPrefix(undefined), '');

  assert.equal(offsite.buildObjectKey('jono', 'ecommerce-20260101-000000Z.db'), 'jono/sqlite/ecommerce-20260101-000000Z.db');
  assert.equal(offsite.buildObjectKey('', 'ecommerce-20260101-000000Z.db'), 'sqlite/ecommerce-20260101-000000Z.db');
  // path.basename() defense: even a maliciously path-shaped filename collapses to just its basename.
  assert.equal(offsite.buildObjectKey('jono', '../../../etc/passwd'), 'jono/sqlite/passwd');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 17 — strict endpoint protocol allowlist
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 17: a non-loopback http:// endpoint is rejected; https:// and loopback http:// are accepted', () => {
  const base = {
    OFFSITE_BACKUP_BUCKET: 'b', OFFSITE_BACKUP_REGION: 'r',
    OFFSITE_BACKUP_ACCESS_KEY_ID: 'a', OFFSITE_BACKUP_SECRET_ACCESS_KEY: 's',
  };

  const insecure = offsite.resolveOffsiteConfig({ ...base, OFFSITE_BACKUP_ENDPOINT: 'http://storage.example.com' });
  assert.equal(insecure.ok, false);
  assert.match(insecure.reason, /https/i);

  const secure = offsite.resolveOffsiteConfig({ ...base, OFFSITE_BACKUP_ENDPOINT: 'https://storage.example.com' });
  assert.equal(secure.ok, true);

  const loopback = offsite.resolveOffsiteConfig({ ...base, OFFSITE_BACKUP_ENDPOINT: 'http://127.0.0.1:9000' });
  assert.equal(loopback.ok, true, 'a loopback http endpoint must be allowed so tests can mock a local server');
  const loopbackLocalhost = offsite.resolveOffsiteConfig({ ...base, OFFSITE_BACKUP_ENDPOINT: 'http://localhost:9000' });
  assert.equal(loopbackLocalhost.ok, true);

  const noEndpoint = offsite.resolveOffsiteConfig({ ...base });
  assert.equal(noEndpoint.ok, true, 'no endpoint at all is valid -- means "use the real AWS S3 default"');
});

test('TEST 17b: every non-https, non-loopback-http protocol is rejected -- allowlist, not a denylist', () => {
  const base = {
    OFFSITE_BACKUP_BUCKET: 'b', OFFSITE_BACKUP_REGION: 'r',
    OFFSITE_BACKUP_ACCESS_KEY_ID: 'a', OFFSITE_BACKUP_SECRET_ACCESS_KEY: 's',
  };

  for (const endpoint of [
    'ftp://storage.example.com',
    'file:///etc/passwd',
    'ws://storage.example.com',
    'wss://storage.example.com',
    'ftp://127.0.0.1:2121', // even on loopback, only http:/https: are meaningful for this SDK
  ]) {
    const result = offsite.resolveOffsiteConfig({ ...base, OFFSITE_BACKUP_ENDPOINT: endpoint });
    assert.equal(result.ok, false, `expected ${endpoint} to be rejected`);
    assert.match(result.reason, /https/i);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 18 — no remote delete/prune capability exists anywhere in this module
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 18: no delete/prune method is exported, called, or even imported by the off-site module', () => {
  const modulePath = path.join(__dirname, '..', 'services', 'sqlite-offsite-backup.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  // Strip comments first -- the module's own doc comment explains, in prose,
  // that DeleteObject is deliberately absent, which would otherwise trip a
  // naive substring check on the comment text itself, not actual code.
  const codeOnly = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(codeOnly, /DeleteObject/);

  const exportNames = Object.keys(offsite);
  for (const name of exportNames) {
    assert.doesNotMatch(name.toLowerCase(), /delete|prune|remove/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Atomic no-overwrite: IfNoneMatch on both PutObject calls, no pre-upload HEAD
// ═══════════════════════════════════════════════════════════════════════════

test('atomic no-overwrite: both PutObject calls carry IfNoneMatch:\'*\', and no HeadObject is ever called before either PUT', async () => {
  const backupDir = path.join(tmpDir, `ifnonematch-${Date.now()}`);
  const client = makeFakeClient();
  const backupResult = await seedLocalBackup(backupDir);

  await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });

  const putCalls = client.calls.filter((c) => c instanceof PutObjectCommand);
  assert.equal(putCalls.length, 2);
  assert.equal(putCalls[0].input.IfNoneMatch, '*', 'the .db PutObject must use IfNoneMatch: \'*\'');
  assert.equal(putCalls[1].input.IfNoneMatch, '*', 'the .sha256 PutObject must use IfNoneMatch: \'*\'');

  // The very first call to the client must be the .db PUT, not a HEAD --
  // proves there is no pre-upload existence check anywhere in the flow.
  assert.ok(client.calls[0] instanceof PutObjectCommand, 'the first call to the client must be a PutObject, never a pre-upload HeadObject');
});

// ═══════════════════════════════════════════════════════════════════════════
// Retry safety: a 412 on either object verifies the pre-existing object
// rather than either trusting it blindly or failing the whole attempt.
// ═══════════════════════════════════════════════════════════════════════════

test('a 412 on the .db PutObject against a genuinely valid pre-existing object is accepted, and the sidecar step still runs', async () => {
  const backupDir = path.join(tmpDir, `db-already-valid-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);
  const client = makeFakeClient();

  const dbKey = offsite.buildObjectKey(FAKE_CONFIG_ENV.OFFSITE_BACKUP_KEY_PREFIX, backupResult.filename);
  const localChecksum = fs.readFileSync(`${backupResult.path}.sha256`, 'utf8').trim().split(/\s+/)[0];
  const dbBuffer = fs.readFileSync(backupResult.path);
  // Pre-populate the store directly -- the fake client's own default
  // PutObjectCommand logic will naturally 412 against this on IfNoneMatch,
  // exactly like a real provider would.
  client.store.set(dbKey, { body: dbBuffer, metadata: { sha256: localChecksum }, size: dbBuffer.length });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });

  assert.equal(result.uploaded, true, 'the sidecar was genuinely new, so this attempt did real work and must not report a bare "already_exists" skip');
  assert.ok(client.store.has(result.sha256Key), 'the sidecar must have been uploaded despite the db 412');
});

test('a 412 on the .db PutObject against a pre-existing object with the WRONG checksum fails safely', async () => {
  const backupDir = path.join(tmpDir, `db-wrong-checksum-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);
  const client = makeFakeClient();

  const dbKey = offsite.buildObjectKey(FAKE_CONFIG_ENV.OFFSITE_BACKUP_KEY_PREFIX, backupResult.filename);
  const dbBuffer = fs.readFileSync(backupResult.path);
  client.store.set(dbKey, { body: dbBuffer, metadata: { sha256: 'wrong-checksum-entirely' }, size: dbBuffer.length });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.uploaded, false);
  assert.match(result.error, /checksum metadata mismatch/i);
});

test('a 412 on the .db PutObject against a pre-existing object with the WRONG size fails safely', async () => {
  const backupDir = path.join(tmpDir, `db-wrong-size-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);
  const client = makeFakeClient();

  const dbKey = offsite.buildObjectKey(FAKE_CONFIG_ENV.OFFSITE_BACKUP_KEY_PREFIX, backupResult.filename);
  const localChecksum = fs.readFileSync(`${backupResult.path}.sha256`, 'utf8').trim().split(/\s+/)[0];
  client.store.set(dbKey, { body: Buffer.from('short'), metadata: { sha256: localChecksum }, size: 5 });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.uploaded, false);
  assert.match(result.error, /size mismatch/i);
});

test('a 412 on the .sha256 PutObject against a pre-existing sidecar with the WRONG size fails safely', async () => {
  const backupDir = path.join(tmpDir, `sidecar-wrong-size-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);
  const client = makeFakeClient();

  const dbKey = offsite.buildObjectKey(FAKE_CONFIG_ENV.OFFSITE_BACKUP_KEY_PREFIX, backupResult.filename);
  const sha256Key = `${dbKey}.sha256`;
  client.store.set(sha256Key, { body: Buffer.from('x'), metadata: {}, size: 1 });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.uploaded, false);
  assert.match(result.error, /sidecar size mismatch/i);
});

test('a 412 on the .sha256 PutObject against a genuinely valid pre-existing sidecar is accepted -- BOTH objects already-present is the only case that reports already_exists', async () => {
  const backupDir = path.join(tmpDir, `both-already-valid-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);
  const client = makeFakeClient();

  const dbKey = offsite.buildObjectKey(FAKE_CONFIG_ENV.OFFSITE_BACKUP_KEY_PREFIX, backupResult.filename);
  const sha256Key = `${dbKey}.sha256`;
  const localChecksum = fs.readFileSync(`${backupResult.path}.sha256`, 'utf8').trim().split(/\s+/)[0];
  const dbBuffer = fs.readFileSync(backupResult.path);
  const sha256Buffer = fs.readFileSync(`${backupResult.path}.sha256`);
  client.store.set(dbKey, { body: dbBuffer, metadata: { sha256: localChecksum }, size: dbBuffer.length });
  client.store.set(sha256Key, { body: sha256Buffer, metadata: { sha256: localChecksum }, size: sha256Buffer.length });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already_exists');

  // No blind overwrite: exactly zero bytes were ever written to either
  // pre-existing object (both PUTs 412'd, never fell back to overwriting).
  const putCalls = client.calls.filter((c) => c instanceof PutObjectCommand);
  assert.equal(putCalls.length, 2, 'both PUTs must still be attempted (that is how the 412s are discovered), but neither may succeed as a write');
  assert.equal(client.store.get(dbKey).body.equals(dbBuffer), true, 'the pre-existing .db bytes must be completely untouched');
  assert.equal(client.store.get(sha256Key).body.equals(sha256Buffer), true, 'the pre-existing .sha256 bytes must be completely untouched');
});

// ═══════════════════════════════════════════════════════════════════════════
// PARTIAL UPLOAD RECOVERY (explicit scenario): attempt 1 uploads the .db but
// fails before the sidecar; attempt 2, against the same backup, must
// complete the sidecar and succeed overall -- not report "already exists"
// and strand the backup without its sidecar forever.
// ═══════════════════════════════════════════════════════════════════════════

test('PARTIAL UPLOAD RECOVERY: a retry after a db-succeeded/sidecar-failed first attempt completes the sidecar and succeeds', async () => {
  const backupDir = path.join(tmpDir, `partial-recovery-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  let sidecarShouldFail = true;
  // Deliberately the SAME client/store across both attempts -- this is what
  // makes attempt 2's .db PutObject genuinely 412 against a real object
  // attempt 1 actually left behind, not a hand-simulated one.
  const client = makeFakeClient({
    onSend: async (command) => {
      if (command instanceof PutObjectCommand && command.input.Key.endsWith('.sha256') && sidecarShouldFail) {
        throw new Error('simulated network failure after the db upload succeeded');
      }
      return undefined; // real default PutObject/HeadObject behavior otherwise
    },
  });

  // Attempt 1: .db PUT succeeds for real; .sha256 PUT fails.
  const attempt1 = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(attempt1.uploaded, false, 'attempt 1 must report failure -- the sidecar never made it');
  const dbKey = offsite.buildObjectKey(FAKE_CONFIG_ENV.OFFSITE_BACKUP_KEY_PREFIX, backupResult.filename);
  assert.ok(client.store.has(dbKey), 'the .db object really was left behind in storage after attempt 1');
  assert.ok(!client.store.has(`${dbKey}.sha256`), 'the sidecar must genuinely be missing after attempt 1');

  // Attempt 2: same backup, same stateful client/store. The .db PUT now
  // hits a real 412 against attempt 1's leftover object; the sidecar PUT is
  // no longer forced to fail.
  sidecarShouldFail = false;
  const attempt2 = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });

  assert.equal(attempt2.uploaded, true, 'attempt 2 must succeed, completing the sidecar upload attempt 1 never reached');
  assert.ok(client.store.has(attempt2.dbKey));
  assert.ok(client.store.has(attempt2.sha256Key));

  // Confirm attempt 2's .db PUT really did take the 412 path (proving
  // retry-safety), not that it happened to re-upload successfully.
  const dbPutCallsAcrossBothAttempts = client.calls.filter((c) => c instanceof PutObjectCommand && c.input.Key === dbKey);
  assert.equal(dbPutCallsAcrossBothAttempts.length, 2, 'expected one .db PutObject attempt per call to uploadBackupOffsite');
});

test('a provider that rejects the IfNoneMatch parameter itself (not a 412) fails the attempt -- no fallback to a blind overwrite', async () => {
  const backupDir = path.join(tmpDir, `unsupported-condition-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  const client = makeFakeClient({
    onSend: async (command) => {
      if (command instanceof PutObjectCommand) {
        const err = new Error('Unknown parameter: IfNoneMatch');
        err.name = 'ValidationException';
        throw err;
      }
      return undefined;
    },
  });

  const result = await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });
  assert.equal(result.uploaded, false);
  assert.match(result.error, /IfNoneMatch/);
  // No object was ever actually written to the store -- confirms there is
  // no retry-without-the-condition fallback anywhere in the code path.
  assert.equal(client.store.size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Streaming: the .db body is a Readable stream, never a fully-buffered Buffer
// ═══════════════════════════════════════════════════════════════════════════

test('the .db upload Body is a Readable stream, not a Buffer -- the whole file is never held in process memory', async () => {
  const backupDir = path.join(tmpDir, `streaming-${Date.now()}`);
  const client = makeFakeClient();
  const backupResult = await seedLocalBackup(backupDir);

  await offsite.uploadBackupOffsite(backupResult, { env: FAKE_CONFIG_ENV, client, log: () => {} });

  const dbPut = client.calls.find((c) => c instanceof PutObjectCommand && !c.input.Key.endsWith('.sha256'));
  assert.ok(dbPut, 'expected a PutObjectCommand for the .db key');
  assert.equal(Buffer.isBuffer(dbPut.input.Body), false, 'the .db Body must not be a Buffer');
  assert.equal(typeof dbPut.input.Body.pipe, 'function', 'the .db Body must be a Readable stream (has .pipe)');
  assert.equal(dbPut.input.ContentLength, fs.statSync(backupResult.path).size, 'ContentLength must be supplied explicitly alongside the stream');

  const storedDbObject = client.store.get(dbPut.input.Key);
  assert.equal(storedDbObject.wasStreamBody, true, 'the fake client must have received and consumed an actual stream, confirming this end to end');

  // The .sha256 sidecar is small and may remain buffered.
  const sidecarPut = client.calls.find((c) => c instanceof PutObjectCommand && c.input.Key.endsWith('.sha256'));
  assert.equal(Buffer.isBuffer(sidecarPut.input.Body), true, 'the tiny .sha256 sidecar may still be a plain Buffer');
});

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler orchestration: startScheduler must thread env/offsite deps through
// ═══════════════════════════════════════════════════════════════════════════

test('startScheduler threads its resolved env and injected off-site test dependencies into each scheduled backup cycle', async () => {
  const client = makeFakeClient();

  const sourceDbPath = path.join(tmpDir, `source-scheduler-${Date.now()}.db`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  // MIN_INTERVAL_MINUTES is 15 -- waiting for a real tick isn't practical in
  // a test. Capture the exact callback startScheduler registers with
  // setInterval and invoke it directly instead; this is the same function
  // object the real timer would have called, just without the real wait.
  let capturedCallback = null;
  const realSetInterval = global.setInterval;
  global.setInterval = (fn) => {
    capturedCallback = fn;
    return { unref() {} };
  };

  try {
    sqliteBackup.startScheduler({
      env: { ENABLE_SQLITE_BACKUPS: 'true', ...FAKE_CONFIG_ENV },
      db: sourceDb,
      offsiteClient: client,
      log: () => {},
    });
  } finally {
    global.setInterval = realSetInterval;
  }

  assert.ok(capturedCallback, 'expected startScheduler to register an interval callback');

  capturedCallback();
  // The callback is fire-and-forget internally (runBackupCycle(...).catch(...))
  // and involves real disk I/O (the Online Backup API, integrity_check),
  // so a fixed small number of microtask ticks isn't reliable -- poll for
  // the effect instead, bounded so a genuine regression still fails fast.
  const deadline = Date.now() + 5000;
  while (client.calls.length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(
    client.calls.some((c) => c instanceof PutObjectCommand),
    'expected the off-site client injected into startScheduler to have received calls from the scheduled cycle',
  );

  sqliteBackup.stopScheduler();
  await closeDb(sourceDb);
});

// ═══════════════════════════════════════════════════════════════════════════
// Sanity: real end-to-end round trip through both modules together
// ═══════════════════════════════════════════════════════════════════════════

test('end-to-end: runBackupCycle with off-site enabled produces a verified local backup AND a verified remote copy', async () => {
  const backupDir = path.join(tmpDir, `e2e-${Date.now()}`);
  const client = makeFakeClient();

  const sourceDbPath = path.join(tmpDir, `source-e2e-${Date.now()}.db`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
  await run(sourceDb, "INSERT INTO t (val) VALUES ('e2e')");

  const result = await sqliteBackup.runBackupCycle({
    db: sourceDb, dbPath: sourceDbPath, backupDir, now: new Date(), log: () => {},
    env: FAKE_CONFIG_ENV, offsiteClient: client,
  });

  assert.equal(result.skipped, false);
  assert.ok(fs.existsSync(result.path));
  assert.ok(fs.existsSync(`${result.path}.sha256`));

  const expectedKey = `jono/sqlite/${result.filename}`;
  assert.ok(client.store.has(expectedKey), 'expected the uploaded object under the configured prefix');

  await closeDb(sourceDb);
});
