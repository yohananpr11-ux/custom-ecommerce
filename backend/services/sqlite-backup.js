'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const dbModule = require('../db');
const offsiteBackup = require('./sqlite-offsite-backup');

const BACKUP_FILENAME_PATTERN = /^ecommerce-\d{8}-\d{6}Z\.db$/;

const DEFAULT_RETENTION = 24;
const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 15;

let backupInProgress = false;
let schedulerTimer = null;

function parseRetention(value, fallback = DEFAULT_RETENTION) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
}

function parseIntervalMinutes(value, fallback = DEFAULT_INTERVAL_MINUTES) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < MIN_INTERVAL_MINUTES) return fallback;
    return parsed;
}

function isBackupEnabled(env = process.env) {
    return env.ENABLE_SQLITE_BACKUPS === 'true';
}

function shouldStartScheduler(env = process.env) {
    if (env.DISABLE_BACKGROUND_JOBS === 'true') return false;
    return isBackupEnabled(env);
}

function resolveDbPath(options = {}) {
    if (options.dbPath) return path.resolve(options.dbPath);
    return dbModule.dbPath || path.resolve(__dirname, '..', 'ecommerce.db');
}

function resolveBackupDir(dbPath, options = {}) {
    if (options.backupDir) return path.resolve(options.backupDir);
    if (process.env.SQLITE_BACKUP_DIR) return path.resolve(process.env.SQLITE_BACKUP_DIR);
    return path.join(path.dirname(dbPath), 'backups');
}

function formatBackupTimestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
    ].join('') + '-' + [
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds()),
    ].join('') + 'Z';
}

function buildBackupFilename(now = new Date()) {
    return `ecommerce-${formatBackupTimestamp(now)}.db`;
}

function promisifyBackupStep(backup, pages) {
    return new Promise((resolve, reject) => {
        backup.step(pages, (err) => {
            if (err && backup.failed) return reject(err);
            resolve();
        });
    });
}

function promisifyBackupFinish(backup) {
    return new Promise((resolve, reject) => {
        backup.finish((err) => {
            if (err) return reject(err);
            if (backup.failed) {
                return reject(new Error(backup.message || 'SQLite backup failed'));
            }
            resolve();
        });
    });
}

function runOnlineBackup(sourceDb, destPath) {
    return new Promise((resolve, reject) => {
        let backup;
        try {
            backup = sourceDb.backup(destPath, (initErr) => {
                if (initErr) return reject(initErr);

                promisifyBackupStep(backup, -1)
                    .then(async () => {
                        if (backup.completed) return resolve();
                        if (backup.failed) {
                            throw new Error(backup.message || 'SQLite backup failed');
                        }
                        await promisifyBackupFinish(backup);
                        resolve();
                    })
                    .catch(reject);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function verifyBackupIntegrity(backupPath, DatabaseCtor = sqlite3.Database) {
    return new Promise((resolve, reject) => {
        const verifyDb = new DatabaseCtor(backupPath, sqlite3.OPEN_READONLY, (openErr) => {
            if (openErr) return reject(openErr);

            verifyDb.all('PRAGMA integrity_check', (checkErr, rows) => {
                const closeAnd = (fn) => {
                    verifyDb.close((closeErr) => {
                        if (closeErr) return reject(closeErr);
                        fn();
                    });
                };

                if (checkErr) {
                    return closeAnd(() => reject(checkErr));
                }

                const ok = Array.isArray(rows)
                    && rows.length === 1
                    && rows[0]
                    && rows[0].integrity_check === 'ok';

                closeAnd(() => resolve(ok));
            });
        });
    });
}

function writeChecksumFile(backupPath) {
    const hash = crypto.createHash('sha256')
        .update(fs.readFileSync(backupPath))
        .digest('hex');
    fs.writeFileSync(`${backupPath}.sha256`, `${hash}\n`, 'utf8');
    return hash;
}

function listManagedBackupFiles(backupDir) {
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
        .filter((name) => BACKUP_FILENAME_PATTERN.test(name))
        .map((name) => {
            const fullPath = path.join(backupDir, name);
            const stat = fs.statSync(fullPath);
            return { name, path: fullPath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneOldBackups(backupDir, retention, log = console.log) {
    const files = listManagedBackupFiles(backupDir);
    const toDelete = files.slice(retention);
    for (const file of toDelete) {
        fs.unlinkSync(file.path);
        const checksumPath = `${file.path}.sha256`;
        if (fs.existsSync(checksumPath)) {
            fs.unlinkSync(checksumPath);
        }
        log(`[SQLite Backup] pruned old backup ${file.name}`);
    }
    return toDelete.length;
}

async function runBackup(options = {}) {
    if (backupInProgress) {
        console.log('[SQLite Backup] backup already in progress; skipping');
        return { skipped: true };
    }

    backupInProgress = true;
    let backupPath = null;

    try {
        const dbPath = resolveDbPath(options);
        const backupDir = resolveBackupDir(dbPath, options);
        const sourceDb = options.db || dbModule;
        const retention = parseRetention(
            options.retention ?? process.env.SQLITE_BACKUP_RETENTION,
            DEFAULT_RETENTION,
        );
        const verifyIntegrity = options.verifyIntegrity || verifyBackupIntegrity;
        const onlineBackup = options.onlineBackup || runOnlineBackup;
        const now = options.now instanceof Date ? options.now : new Date();
        const log = options.log || console.log;

        fs.mkdirSync(backupDir, { recursive: true });

        const filename = buildBackupFilename(now);
        backupPath = path.join(backupDir, filename);

        log(`[SQLite Backup] starting backup to ${filename}`);
        await onlineBackup(sourceDb, backupPath);

        const integrityOk = await verifyIntegrity(backupPath, options.DatabaseCtor);
        if (!integrityOk) {
            if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
            throw new Error('Backup integrity check failed');
        }

        writeChecksumFile(backupPath);
        pruneOldBackups(backupDir, retention, log);
        log(`[SQLite Backup] backup completed: ${filename}`);

        return { skipped: false, path: backupPath, filename };
    } catch (err) {
        if (backupPath && fs.existsSync(backupPath)) {
            try { fs.unlinkSync(backupPath); } catch { /* best effort */ }
            const checksumPath = `${backupPath}.sha256`;
            if (fs.existsSync(checksumPath)) {
                try { fs.unlinkSync(checksumPath); } catch { /* best effort */ }
            }
        }
        throw err;
    } finally {
        backupInProgress = false;
    }
}

// Orchestration only -- runBackup() itself above is completely unmodified.
// Off-site upload is attempted only after a successful, non-skipped local
// backup, and only ever as a separate step whose own failure is caught and
// logged here, never allowed to affect what runBackup() already returned.
// This is the one and only place uploadBackupOffsite() is ever called from
// production code -- calling runBackup() directly (as most existing tests
// and any manual/one-off invocation do) never triggers an off-site upload.
async function runBackupCycle(options = {}) {
    const result = await runBackup(options);
    if (result && result.skipped === false) {
        try {
            await offsiteBackup.uploadBackupOffsite(result, {
                log: options.log,
                env: options.env,
                client: options.offsiteClient,
                resolveConfig: options.offsiteResolveConfig,
            });
        } catch (err) {
            const log = options.log || console.error;
            log(`[SQLite Offsite Backup] upload failed: ${err && err.message}`);
        }
    }
    return result;
}

function startScheduler(options = {}) {
    if (!shouldStartScheduler(options.env || process.env)) {
        return null;
    }
    if (schedulerTimer) {
        return schedulerTimer;
    }

    const env = options.env || process.env;
    const intervalMinutes = parseIntervalMinutes(env.SQLITE_BACKUP_INTERVAL_MINUTES);
    const retention = parseRetention(env.SQLITE_BACKUP_RETENTION);
    const intervalMs = intervalMinutes * 60 * 1000;
    const log = options.log || console.log;

    log(`[SQLite Backup] scheduler enabled: every ${intervalMinutes} minutes, retention ${retention}`);

    schedulerTimer = setInterval(() => {
        runBackupCycle({ db: options.db, log }).catch((err) => {
            console.error('[SQLite Backup] scheduled backup failed:', err.message);
        });
    }, intervalMs);

    if (typeof schedulerTimer.unref === 'function') {
        schedulerTimer.unref();
    }

    return schedulerTimer;
}

function stopScheduler() {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }
}

function _resetBackupStateForTests() {
    backupInProgress = false;
    stopScheduler();
}

module.exports = {
    BACKUP_FILENAME_PATTERN,
    DEFAULT_RETENTION,
    DEFAULT_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    buildBackupFilename,
    formatBackupTimestamp,
    isBackupEnabled,
    shouldStartScheduler,
    parseRetention,
    parseIntervalMinutes,
    resolveBackupDir,
    resolveDbPath,
    runOnlineBackup,
    verifyBackupIntegrity,
    writeChecksumFile,
    listManagedBackupFiles,
    pruneOldBackups,
    runBackup,
    runBackupCycle,
    startScheduler,
    stopScheduler,
    _resetBackupStateForTests,
};
