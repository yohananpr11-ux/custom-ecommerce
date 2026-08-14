'use strict';

// Off-site copy of an already-verified local SQLite backup, to a
// self-hosted-agnostic S3-compatible object store. This module is never the
// source of truth for "is the backup good" -- backend/services/sqlite-backup.js's
// runBackup() already did the Online Backup API copy, the
// PRAGMA integrity_check, and the local .sha256 write before anything here
// is ever called. This module's only job is to also put those two already-
// verified files somewhere off this Render disk.
//
// Hard properties, all enforced below, not just documented:
//   - disabled by default (ENABLE_OFFSITE_BACKUP=false) -- when disabled, no
//     S3 client is ever constructed and no network call of any kind happens;
//   - a failed/misconfigured/network-broken upload NEVER touches the local
//     .db or .sha256 files, and never throws in a way the caller can't
//     safely swallow (see sqlite-backup.js's runBackupCycle);
//   - the local .sha256 file is always the canonical checksum -- an S3 ETag
//     is never treated as a SHA-256 (ETags are MD5-based and, for
//     multipart/SSE-encrypted uploads, not even that -- comparing an ETag
//     against a SHA-256 sidecar would be comparing two different things);
//   - the real SHA-256 is instead carried as PutObject metadata and
//     re-verified with a HeadObject call after upload, against both the
//     local hash and the local file size;
//   - only one upload runs at a time in this process (mirrors
//     sqlite-backup.js's own backupInProgress guard) -- a second attempt
//     while one is in flight is skipped immediately, never queued;
//   - only ever PutObject/HeadObject -- no DeleteObject anywhere in this
//     module, on purpose (see docs/operations/sqlite-backup-recovery.md):
//     remote retention is a bucket lifecycle policy an operator configures
//     on the provider side, never something application code can do;
//   - credentials come only from process.env, are never logged, and no
//     error object is ever logged whole (only .name/.message) since an SDK
//     error can carry request/header detail that must never reach a log;
//   - a configured http:// endpoint is rejected unless it points at
//     loopback (127.0.0.1/localhost/::1) -- real off-site traffic must be
//     HTTPS; only a test's own local mock server may use plain http.

const fs = require('fs');
const path = require('path');

let offsiteUploadInProgress = false;

function isOffsiteBackupEnabled(env = process.env) {
  return env.ENABLE_OFFSITE_BACKUP === 'true';
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

// Strips leading/trailing/duplicate slashes and rejects '.'/'..' segments --
// this becomes part of an object key, never a filesystem path, but treating
// it with the same suspicion as a path keeps a misconfigured prefix from
// ever producing a surprising key shape.
function normalizeKeyPrefix(prefix) {
  return String(prefix || '')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

// filename always comes from sqlite-backup.js's own buildBackupFilename()
// output, never user input -- path.basename() here is defense in depth, not
// a response to any known input path.
function buildObjectKey(prefix, filename) {
  const safeName = path.basename(filename);
  return [prefix, 'sqlite', safeName].filter(Boolean).join('/');
}

function resolveOffsiteConfig(env = process.env) {
  const bucket = env.OFFSITE_BACKUP_BUCKET || '';
  const region = env.OFFSITE_BACKUP_REGION || '';
  const accessKeyId = env.OFFSITE_BACKUP_ACCESS_KEY_ID || '';
  const secretAccessKey = env.OFFSITE_BACKUP_SECRET_ACCESS_KEY || '';
  const endpoint = env.OFFSITE_BACKUP_ENDPOINT || '';
  const keyPrefix = normalizeKeyPrefix(env.OFFSITE_BACKUP_KEY_PREFIX || '');

  const missing = [];
  if (!bucket) missing.push('OFFSITE_BACKUP_BUCKET');
  if (!region) missing.push('OFFSITE_BACKUP_REGION');
  if (!accessKeyId) missing.push('OFFSITE_BACKUP_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('OFFSITE_BACKUP_SECRET_ACCESS_KEY');
  if (missing.length > 0) {
    return { ok: false, reason: `missing required configuration: ${missing.join(', ')}` };
  }

  if (endpoint) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      return { ok: false, reason: 'OFFSITE_BACKUP_ENDPOINT is not a valid URL' };
    }
    if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
      return {
        ok: false,
        reason: 'OFFSITE_BACKUP_ENDPOINT must use https:// (plain http:// is only accepted for a loopback test endpoint)',
      };
    }
  }

  return { ok: true, bucket, region, accessKeyId, secretAccessKey, endpoint: endpoint || undefined, keyPrefix };
}

// Never logs the error object itself -- only name/message. An AWS SDK error
// can carry $metadata/$response detail that may include request headers;
// whole-object logging is exactly how a credential ends up in a log file.
//
// .message text itself is also scrubbed against the actual configured
// secrets, not just trusted as-is: AWS's own InvalidAccessKeyId error text
// is documented to echo the rejected access key ID back inside the message
// ("The AWS Access Key Id you provided does not exist in our records.")
// -- name/message alone is not automatically safe if the message can
// contain a credential the caller already knows about.
function safeErrorMessage(err, secrets = []) {
  if (!err) return 'unknown error';
  const parts = [err.name, err.message].filter(Boolean);
  let message = parts.length ? parts.join(': ') : 'unknown error';
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message;
}

function buildS3Client(config) {
  // Lazy require: a disabled/misconfigured deployment never needs this
  // package loaded, and every test that reaches this point injects its own
  // fake client instead, so the real SDK is only ever required for a
  // genuine, fully-configured, enabled upload.
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function headObjectSafe(client, bucket, key) {
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const resp = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { exists: true, contentLength: resp.ContentLength, metadata: resp.Metadata || {} };
  } catch (err) {
    if (err && (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404)) {
      return { exists: false };
    }
    throw err;
  }
}

/**
 * Uploads an already-verified local backup (the exact {path, filename}
 * shape runBackup() returns on success) to off-site object storage.
 * Never throws -- every failure path returns { skipped: true, ... } or
 * { skipped: false, uploaded: false, error }, so a caller can always safely
 * fire-and-forget or await-and-log without risking an unhandled rejection
 * that could be mistaken for a local backup failure.
 */
async function uploadBackupOffsite(backupResult, options = {}) {
  const env = options.env || process.env;
  const log = options.log || console.log;

  if (!isOffsiteBackupEnabled(env)) {
    return { skipped: true, reason: 'disabled' };
  }

  if (offsiteUploadInProgress) {
    log('[SQLite Offsite Backup] upload already in progress; skipping');
    return { skipped: true, reason: 'in_progress' };
  }

  const resolveConfig = options.resolveConfig || resolveOffsiteConfig;
  const config = resolveConfig(env);
  if (!config.ok) {
    console.error(`[SQLite Offsite Backup] configuration error: ${config.reason}`);
    return { skipped: true, reason: 'misconfigured' };
  }

  offsiteUploadInProgress = true;
  try {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = options.client || buildS3Client(config);

    const backupPath = backupResult.path;
    const filename = backupResult.filename;
    const checksumPath = `${backupPath}.sha256`;

    const dbBuffer = fs.readFileSync(backupPath);
    const sha256Buffer = fs.readFileSync(checksumPath);
    const localChecksum = sha256Buffer.toString('utf8').trim().split(/\s+/)[0];

    const dbKey = buildObjectKey(config.keyPrefix, filename);
    const sha256Key = `${dbKey}.sha256`;

    // Duplicate-key safety without depending on provider-specific
    // conditional-write support: check first, never blind-overwrite. Backup
    // filenames are already unique-per-run, so finding an existing object
    // here means this exact backup was already uploaded (e.g. a retry) --
    // treated as an idempotent no-op, not an error.
    const existing = await headObjectSafe(client, config.bucket, dbKey);
    if (existing.exists) {
      log(`[SQLite Offsite Backup] ${dbKey} already exists remotely; treating as already uploaded, skipping`);
      return { skipped: true, reason: 'already_exists', dbKey };
    }

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: dbKey,
      Body: dbBuffer,
      Metadata: { sha256: localChecksum },
    }));

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: sha256Key,
      Body: sha256Buffer,
    }));

    // Remote metadata verification -- never re-downloads the object just to
    // check it; HeadObject's size + the metadata sha256 we set on PutObject
    // are enough to prove the upload landed intact.
    const verify = await headObjectSafe(client, config.bucket, dbKey);
    if (!verify.exists) {
      throw new Error('post-upload HEAD verification found no object');
    }
    if (verify.contentLength !== dbBuffer.length) {
      throw new Error(`post-upload size mismatch: local=${dbBuffer.length} remote=${verify.contentLength}`);
    }
    const remoteChecksum = verify.metadata && (verify.metadata.sha256 || verify.metadata.Sha256);
    if (remoteChecksum !== localChecksum) {
      throw new Error('post-upload checksum metadata mismatch');
    }

    log(`[SQLite Offsite Backup] uploaded and verified: ${dbKey}`);
    return { skipped: false, uploaded: true, dbKey, sha256Key };
  } catch (err) {
    const safeMessage = safeErrorMessage(err, [config.accessKeyId, config.secretAccessKey]);
    console.error(`[SQLite Offsite Backup] upload failed: ${safeMessage}`);
    return { skipped: false, uploaded: false, error: safeMessage };
  } finally {
    offsiteUploadInProgress = false;
  }
}

function _resetOffsiteStateForTests() {
  offsiteUploadInProgress = false;
}

module.exports = {
  isOffsiteBackupEnabled,
  resolveOffsiteConfig,
  normalizeKeyPrefix,
  buildObjectKey,
  uploadBackupOffsite,
  _resetOffsiteStateForTests,
};
