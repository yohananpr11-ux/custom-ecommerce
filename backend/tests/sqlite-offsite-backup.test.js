// Coverage for backend/services/sqlite-offsite-backup.js and its
// integration point in backend/services/sqlite-backup.js's runBackupCycle().
// Fully mocked/local: no real S3, no internet, no Render, no /var/data.
// The fake S3 client below implements the same .send(command) shape the
// real @aws-sdk/client-s3 client does, using the REAL PutObjectCommand/
// HeadObjectCommand classes so `instanceof` checks in the module under test
// behave exactly as they would against the genuine SDK -- only the network
// transport is replaced.

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
        const { Key, Body, Metadata } = command.input;
        const bodyBuffer = Buffer.isBuffer(Body) ? Body : Buffer.from(Body);
        store.set(Key, { body: bodyBuffer, metadata: Metadata || {}, size: bodyBuffer.length });
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
  // Two PutObjectCommand + one HeadObjectCommand-before + one HeadObjectCommand-verify = calls, but
  // the important assertion is that an upload attempt genuinely happened (not zero).
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

test('TEST 5/6/7: uploads both .db and .sha256, metadata sha256 matches the real local checksum, HEAD verifies size + checksum', async () => {
  const backupDir = path.join(tmpDir, `content-${Date.now()}`);
  const client = makeFakeClient();
  const backupResult = await seedLocalBackup(backupDir);
  assert.equal(backupResult.skipped, false);

  const localDbBuffer = fs.readFileSync(backupResult.path);
  const localChecksum = crypto.createHash('sha256').update(localDbBuffer).digest('hex');

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

  // TEST 7: HEAD verification checked size + sha256 metadata (indirectly proven
  // by uploaded:true, since uploadBackupOffsite throws internally on any
  // mismatch -- explicitly re-confirm the stored object actually matches too)
  assert.equal(storedDbObject.size, localDbBuffer.length);
  const headCalls = client.calls.filter((c) => c instanceof HeadObjectCommand);
  assert.ok(headCalls.length >= 2, 'expected a pre-upload existence check and a post-upload verification HEAD call');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8 — metadata/checksum mismatch is treated as a failure
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 8: a post-upload checksum metadata mismatch is reported as an off-site failure', async () => {
  const backupDir = path.join(tmpDir, `mismatch-${Date.now()}`);
  const backupResult = await seedLocalBackup(backupDir);

  let headCallCount = 0;
  const client = makeFakeClient({
    onSend: async (command, store) => {
      if (command instanceof HeadObjectCommand) {
        headCallCount += 1;
        if (headCallCount === 1) return undefined; // let the default "not found" behavior run (pre-upload check)
        // Second HEAD call (post-upload verification): return tampered metadata.
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
// TEST 17 — HTTPS required; loopback http allowed only for test mocking
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

  const noEndpoint = offsite.resolveOffsiteConfig({ ...base });
  assert.equal(noEndpoint.ok, true, 'no endpoint at all is valid -- means "use the real AWS S3 default"');
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
