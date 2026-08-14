// Offline coverage for backend/services/sqlite-backup.js. No live network
// calls -- everything here is local file/sqlite I/O against a throwaway
// temp database, isolated from the real ecommerce.db via DB_PATH (same
// convention as fulfillment-recovery.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const sqlite3 = require('sqlite3').verbose();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-backup-test-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;

const sqliteBackup = require('../services/sqlite-backup');

function openDb(dbPath) {
  return new sqlite3.Database(dbPath);
}
function closeDb(conn) {
  return new Promise((resolve) => conn.close(resolve));
}
function run(conn, sql, params = []) {
  return new Promise((resolve, reject) => conn.run(sql, params, function (err) { if (err) reject(err); else resolve(this); }));
}

test.afterEach(() => {
  sqliteBackup._resetBackupStateForTests();
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

// ---- pure helpers ----

test('formatBackupTimestamp/buildBackupFilename produce the pattern runBackup relies on for pruning', () => {
  const fixed = new Date(Date.UTC(2026, 0, 5, 9, 3, 7));
  assert.equal(sqliteBackup.formatBackupTimestamp(fixed), '20260105-090307Z');
  const filename = sqliteBackup.buildBackupFilename(fixed);
  assert.equal(filename, 'ecommerce-20260105-090307Z.db');
  assert.match(filename, sqliteBackup.BACKUP_FILENAME_PATTERN);
});

test('parseRetention: rejects non-positive/non-numeric values and falls back to the default', () => {
  assert.equal(sqliteBackup.parseRetention('10'), 10);
  assert.equal(sqliteBackup.parseRetention('0'), sqliteBackup.DEFAULT_RETENTION);
  assert.equal(sqliteBackup.parseRetention('-5'), sqliteBackup.DEFAULT_RETENTION);
  assert.equal(sqliteBackup.parseRetention('not-a-number'), sqliteBackup.DEFAULT_RETENTION);
  assert.equal(sqliteBackup.parseRetention(undefined), sqliteBackup.DEFAULT_RETENTION);
  assert.equal(sqliteBackup.parseRetention('3', 99), 3);
});

test('parseIntervalMinutes: enforces the minimum interval floor', () => {
  assert.equal(sqliteBackup.parseIntervalMinutes('120'), 120);
  assert.equal(sqliteBackup.parseIntervalMinutes(String(sqliteBackup.MIN_INTERVAL_MINUTES - 1)), sqliteBackup.DEFAULT_INTERVAL_MINUTES);
  assert.equal(sqliteBackup.parseIntervalMinutes('garbage'), sqliteBackup.DEFAULT_INTERVAL_MINUTES);
});

test('isBackupEnabled / shouldStartScheduler: opt-in flag plus background-jobs kill switch', () => {
  assert.equal(sqliteBackup.isBackupEnabled({}), false);
  assert.equal(sqliteBackup.isBackupEnabled({ ENABLE_SQLITE_BACKUPS: 'true' }), true);
  assert.equal(sqliteBackup.isBackupEnabled({ ENABLE_SQLITE_BACKUPS: 'yes' }), false);

  assert.equal(sqliteBackup.shouldStartScheduler({ ENABLE_SQLITE_BACKUPS: 'true' }), true);
  assert.equal(
    sqliteBackup.shouldStartScheduler({ ENABLE_SQLITE_BACKUPS: 'true', DISABLE_BACKGROUND_JOBS: 'true' }),
    false,
  );
});

test('resolveBackupDir: defaults to a backups/ sibling of the db, honors overrides', () => {
  const dbPath = path.join(tmpDir, 'ecommerce.db');
  assert.equal(sqliteBackup.resolveBackupDir(dbPath), path.join(tmpDir, 'backups'));
  assert.equal(
    sqliteBackup.resolveBackupDir(dbPath, { backupDir: path.join(tmpDir, 'custom') }),
    path.join(tmpDir, 'custom'),
  );
});

// ---- listManagedBackupFiles / pruneOldBackups ----

test('listManagedBackupFiles: only matches managed filenames, newest first', () => {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'list-'));
  const older = path.join(dir, 'ecommerce-20260101-000000Z.db');
  const newer = path.join(dir, 'ecommerce-20260102-000000Z.db');
  fs.writeFileSync(older, 'a');
  fs.writeFileSync(newer, 'b');
  fs.writeFileSync(path.join(dir, 'ecommerce-20260102-000000Z.db.sha256'), 'hash');
  fs.writeFileSync(path.join(dir, 'not-a-backup.txt'), 'c');
  fs.utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
  fs.utimesSync(newer, new Date(2026, 0, 2), new Date(2026, 0, 2));

  const files = sqliteBackup.listManagedBackupFiles(dir);
  assert.equal(files.length, 2);
  assert.deepEqual(files.map((f) => f.name), ['ecommerce-20260102-000000Z.db', 'ecommerce-20260101-000000Z.db']);
});

test('listManagedBackupFiles: returns an empty array for a directory that does not exist yet', () => {
  assert.deepEqual(sqliteBackup.listManagedBackupFiles(path.join(tmpDir, 'does-not-exist')), []);
});

test('pruneOldBackups: deletes everything past the retention count, plus its checksum sidecar', () => {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'prune-'));
  const names = [
    'ecommerce-20260101-000000Z.db',
    'ecommerce-20260102-000000Z.db',
    'ecommerce-20260103-000000Z.db',
  ];
  names.forEach((name, i) => {
    const full = path.join(dir, name);
    fs.writeFileSync(full, String(i));
    fs.writeFileSync(`${full}.sha256`, 'hash');
    fs.utimesSync(full, new Date(2026, 0, i + 1), new Date(2026, 0, i + 1));
  });

  const deletedCount = sqliteBackup.pruneOldBackups(dir, 2, () => {});
  assert.equal(deletedCount, 1);

  const remaining = fs.readdirSync(dir).sort();
  assert.deepEqual(remaining, [
    'ecommerce-20260102-000000Z.db',
    'ecommerce-20260102-000000Z.db.sha256',
    'ecommerce-20260103-000000Z.db',
    'ecommerce-20260103-000000Z.db.sha256',
  ]);
});

test('runBackup: a real pruning pass removes old managed backups but leaves an unrelated file in the same directory untouched', async () => {
  const sourceDbPath = path.join(tmpDir, `source-unrelated-${Date.now()}.db`);
  const backupDir = path.join(tmpDir, `run-backup-unrelated-${Date.now()}`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  fs.mkdirSync(backupDir, { recursive: true });

  const preExisting = [
    'ecommerce-20200101-000000Z.db',
    'ecommerce-20200102-000000Z.db',
    'ecommerce-20200103-000000Z.db',
  ];
  preExisting.forEach((name, i) => {
    const full = path.join(backupDir, name);
    fs.writeFileSync(full, `old-backup-${i}`);
    fs.utimesSync(full, new Date(2020, 0, i + 1), new Date(2020, 0, i + 1));
  });

  const unrelatedPath = path.join(backupDir, 'README-do-not-delete.txt');
  const unrelatedContents = 'this file is not a managed backup and must survive pruning';
  fs.writeFileSync(unrelatedPath, unrelatedContents);

  // retention: 2 -- with the new backup this run produces, that's 4 managed files
  // competing for 2 slots, so 2 of the 3 pre-existing ones must be pruned.
  await sqliteBackup.runBackup({
    db: sourceDb,
    dbPath: sourceDbPath,
    backupDir,
    retention: 2,
    now: new Date(Date.UTC(2026, 0, 5, 0, 0, 0)),
    log: () => {},
  });

  const remainingDbFiles = fs.readdirSync(backupDir).filter((n) => n.endsWith('.db')).sort();
  assert.deepEqual(remainingDbFiles, ['ecommerce-20200103-000000Z.db', 'ecommerce-20260105-000000Z.db']);
  assert.ok(!fs.existsSync(path.join(backupDir, 'ecommerce-20200101-000000Z.db')), 'oldest managed backup should have been pruned');
  assert.ok(!fs.existsSync(path.join(backupDir, 'ecommerce-20200102-000000Z.db')), 'second-oldest managed backup should have been pruned');

  assert.ok(fs.existsSync(unrelatedPath), 'unrelated file must still exist after a real pruning pass');
  assert.equal(fs.readFileSync(unrelatedPath, 'utf8'), unrelatedContents, 'unrelated file contents must be byte-for-byte unchanged');

  await closeDb(sourceDb);
});

// ---- runBackup integration ----

test('runBackup: produces a verified backup file plus a matching sha256 sidecar', async () => {
  const sourceDbPath = path.join(tmpDir, `source-${Date.now()}.db`);
  const backupDir = path.join(tmpDir, `run-backup-out-${Date.now()}`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
  await run(sourceDb, 'INSERT INTO t (val) VALUES (?)', ['hello']);

  const result = await sqliteBackup.runBackup({
    db: sourceDb,
    dbPath: sourceDbPath,
    backupDir,
    retention: 24,
    now: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    log: () => {},
  });

  assert.equal(result.skipped, false);
  assert.equal(result.filename, 'ecommerce-20260101-000000Z.db');
  assert.ok(fs.existsSync(result.path));
  assert.ok(fs.existsSync(`${result.path}.sha256`));

  const expectedHash = crypto.createHash('sha256').update(fs.readFileSync(result.path)).digest('hex');
  const writtenHash = fs.readFileSync(`${result.path}.sha256`, 'utf8').trim();
  assert.equal(writtenHash, expectedHash);

  await closeDb(sourceDb);
});

test('runOnlineBackup: a row committed to WAL but never checkpointed is present in the backup (proves the online backup API reads through the WAL, not a stale main db file)', async () => {
  const sourceDbPath = path.join(tmpDir, `source-wal-${Date.now()}.db`);
  const backupDir = path.join(tmpDir, `run-backup-wal-${Date.now()}`);
  const sourceDb = openDb(sourceDbPath);

  await run(sourceDb, 'PRAGMA journal_mode = WAL');
  // Disabling auto-checkpoint makes this deterministic: with it left on, SQLite would
  // checkpoint on its own past a page threshold, silently turning this into a test of a
  // raw file (which is not what "committed WAL data included" is supposed to prove).
  await run(sourceDb, 'PRAGMA wal_autocheckpoint = 0');
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
  await run(sourceDb, "INSERT INTO t (val) VALUES ('wal-only-row')");

  const walPath = `${sourceDbPath}-wal`;
  assert.ok(fs.existsSync(walPath), 'expected a -wal file to exist after a WAL-mode commit');
  assert.ok(fs.statSync(walPath).size > 0, 'expected the -wal file to hold the committed row (not yet checkpointed)');

  const result = await sqliteBackup.runBackup({
    db: sourceDb,
    dbPath: sourceDbPath,
    backupDir,
    now: new Date(Date.UTC(2026, 0, 4, 0, 0, 0)),
    log: () => {},
  });
  assert.equal(result.skipped, false);

  // The row was never checkpointed by this test, and runOnlineBackup/runBackup never issue
  // a checkpoint themselves -- so the only way the row reaches the backup file is through
  // SQLite's online Backup API reading live through the WAL. It does not use fs.copyFile
  // or any raw file copy anywhere in the module (verified by inspection of runOnlineBackup).
  const backupDb = openDb(result.path);
  const row = await new Promise((resolve, reject) => {
    backupDb.get('SELECT val FROM t WHERE val = ?', ['wal-only-row'], (err, r) => (err ? reject(err) : resolve(r)));
  });
  await closeDb(backupDb);

  assert.ok(row, 'expected the WAL-only committed row to be present in the backup');
  assert.equal(row.val, 'wal-only-row');

  await closeDb(sourceDb);
});

test('runBackup: a failed integrity check deletes the partial backup and throws', async () => {
  const sourceDbPath = path.join(tmpDir, `source-bad-${Date.now()}.db`);
  const backupDir = path.join(tmpDir, `run-backup-bad-${Date.now()}`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  await assert.rejects(
    () => sqliteBackup.runBackup({
      db: sourceDb,
      dbPath: sourceDbPath,
      backupDir,
      now: new Date(Date.UTC(2026, 0, 2, 0, 0, 0)),
      verifyIntegrity: async () => false,
      log: () => {},
    }),
    /integrity check failed/i,
  );

  const leftoverFiles = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
  assert.deepEqual(leftoverFiles, []);

  await closeDb(sourceDb);
});

test('runBackup: a failed integrity check leaves pre-existing backups and their checksums untouched, and never prunes them', async () => {
  const sourceDbPath = path.join(tmpDir, `source-bad2-${Date.now()}.db`);
  const backupDir = path.join(tmpDir, `run-backup-bad2-${Date.now()}`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  fs.mkdirSync(backupDir, { recursive: true });

  const preExisting = ['ecommerce-20250101-000000Z.db', 'ecommerce-20250102-000000Z.db'];
  const preExistingContents = {};
  preExisting.forEach((name, i) => {
    const full = path.join(backupDir, name);
    const contents = `existing-backup-${i}`;
    const hash = crypto.createHash('sha256').update(contents).digest('hex');
    fs.writeFileSync(full, contents);
    fs.writeFileSync(`${full}.sha256`, `${hash}\n`, 'utf8');
    fs.utimesSync(full, new Date(2025, 0, i + 1), new Date(2025, 0, i + 1));
    preExistingContents[name] = { contents, hash };
  });

  await assert.rejects(
    // retention: 1 is deliberately lower than the 2 pre-existing backups -- if pruning ran
    // on the failure path, it would delete one of them. It must not run at all.
    () => sqliteBackup.runBackup({
      db: sourceDb,
      dbPath: sourceDbPath,
      backupDir,
      retention: 1,
      now: new Date(Date.UTC(2026, 0, 6, 0, 0, 0)),
      verifyIntegrity: async () => false,
      log: () => {},
    }),
    /integrity check failed/i,
  );

  assert.ok(!fs.existsSync(path.join(backupDir, 'ecommerce-20260106-000000Z.db')), 'the new failed backup must not remain');
  assert.ok(!fs.existsSync(path.join(backupDir, 'ecommerce-20260106-000000Z.db.sha256')), 'the new failed checksum must not remain');

  for (const name of preExisting) {
    const full = path.join(backupDir, name);
    assert.ok(fs.existsSync(full), `${name} should still exist`);
    assert.equal(fs.readFileSync(full, 'utf8'), preExistingContents[name].contents, `${name} contents must be unchanged`);
    const sidecar = `${full}.sha256`;
    assert.ok(fs.existsSync(sidecar), `${name}.sha256 should still exist`);
    assert.equal(fs.readFileSync(sidecar, 'utf8').trim(), preExistingContents[name].hash, `${name}.sha256 must be unchanged`);
  }

  const remaining = fs.readdirSync(backupDir).sort();
  assert.deepEqual(remaining, [
    'ecommerce-20250101-000000Z.db',
    'ecommerce-20250101-000000Z.db.sha256',
    'ecommerce-20250102-000000Z.db',
    'ecommerce-20250102-000000Z.db.sha256',
  ]);

  await closeDb(sourceDb);
});

test('runBackup: prunes beyond retention after a successful run', async () => {
  const sourceDbPath = path.join(tmpDir, `source-prune-${Date.now()}.db`);
  const backupDir = path.join(tmpDir, `run-backup-prune-${Date.now()}`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  fs.mkdirSync(backupDir, { recursive: true });
  const stale = path.join(backupDir, 'ecommerce-20200101-000000Z.db');
  fs.writeFileSync(stale, 'old');
  fs.utimesSync(stale, new Date(2020, 0, 1), new Date(2020, 0, 1));

  await sqliteBackup.runBackup({
    db: sourceDb,
    dbPath: sourceDbPath,
    backupDir,
    retention: 1,
    now: new Date(Date.UTC(2026, 0, 3, 0, 0, 0)),
    log: () => {},
  });

  const remaining = fs.readdirSync(backupDir).filter((n) => n.endsWith('.db'));
  assert.deepEqual(remaining, ['ecommerce-20260103-000000Z.db']);

  await closeDb(sourceDb);
});

test('runBackup: a second call while one is already running is skipped, not queued', async () => {
  const sourceDbPath = path.join(tmpDir, `source-concurrent-${Date.now()}.db`);
  const backupDir = path.join(tmpDir, `run-backup-concurrent-${Date.now()}`);
  const sourceDb = openDb(sourceDbPath);
  await run(sourceDb, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

  const first = sqliteBackup.runBackup({ db: sourceDb, dbPath: sourceDbPath, backupDir, log: () => {} });
  const second = await sqliteBackup.runBackup({ db: sourceDb, dbPath: sourceDbPath, backupDir, log: () => {} });

  assert.equal(second.skipped, true);
  const firstResult = await first;
  assert.equal(firstResult.skipped, false);

  await closeDb(sourceDb);
});

// ---- scheduler lifecycle ----

test('startScheduler: no-ops when the feature flag is off, and is idempotent when on', () => {
  assert.equal(sqliteBackup.startScheduler({ env: {} }), null);

  // DISABLE_BACKGROUND_JOBS must win even when ENABLE_SQLITE_BACKUPS=true, exercised
  // directly through startScheduler() itself (not just the shouldStartScheduler() helper
  // it delegates to) -- startScheduler returns null before ever reaching the
  // setInterval() call, so no timer is registered.
  assert.equal(
    sqliteBackup.startScheduler({ env: { ENABLE_SQLITE_BACKUPS: 'true', DISABLE_BACKGROUND_JOBS: 'true' }, log: () => {} }),
    null,
  );

  const timer = sqliteBackup.startScheduler({ env: { ENABLE_SQLITE_BACKUPS: 'true' }, log: () => {} });
  assert.ok(timer);
  const second = sqliteBackup.startScheduler({ env: { ENABLE_SQLITE_BACKUPS: 'true' }, log: () => {} });
  assert.equal(second, timer);

  sqliteBackup.stopScheduler();
});
