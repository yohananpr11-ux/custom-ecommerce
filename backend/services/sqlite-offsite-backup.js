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
//     re-verified with a GetObject-permission-governed HEAD call after
//     upload, against both the local hash and the local file size (both
//     objects: the .db and its .sha256 sidecar);
//   - no overwrite of an existing backup is ever possible: both PutObject
//     calls use IfNoneMatch:'*' (atomic conditional create), never a
//     HEAD-then-PUT check -- that would be TOCTOU (existence could change
//     between the check and the write) and would additionally require a
//     read-existence permission before the very first upload a fresh bucket
//     ever receives. A conditional-create rejection (412/PreconditionFailed)
//     is the *only* signal ever treated as "already uploaded" -- if the
//     provider doesn't support conditional writes at all, the PutObject
//     call fails for some other reason and the whole attempt is reported as
//     a failure; there is no fallback to a blind, unconditional overwrite;
//   - retry-safe across a partial previous attempt: a 412 on the .db never
//     short-circuits the whole call -- a prior run may have uploaded the
//     .db and then failed before ever reaching the sidecar, and a retry
//     must still complete that upload rather than reporting "already
//     exists" and permanently stranding the backup without its sidecar.
//     Whichever object ends up at each key (freshly uploaded, or already
//     present via a 412) is verified identically -- an existing object is
//     never trusted just because it exists; overall success/already-
//     existing is only ever reported once BOTH objects are confirmed
//     present and valid;
//   - the .db body is streamed (fs.createReadStream), never buffered whole
//     into process memory -- this module must stay correct as the database
//     grows well past its current ~400KB;
//   - only one upload runs at a time in this process (mirrors
//     sqlite-backup.js's own backupInProgress guard) -- a second attempt
//     while one is in flight is skipped immediately, never queued;
//   - only ever PutObject/HeadObject -- no DeleteObject anywhere in this
//     module, on purpose (see docs/operations/sqlite-backup-recovery.md):
//     remote retention is a bucket lifecycle policy an operator configures
//     on the provider side, never something application code can do. IAM
//     minimum for the credential this module uses: s3:PutObject (upload)
//     and s3:GetObject (AWS has no separate HeadObject action -- HEAD is
//     authorized by s3:GetObject). No s3:DeleteObject. No s3:ListBucket --
//     removing the old pre-upload existence check means the normal upload
//     path never needs it;
//   - credentials come only from process.env, are never logged, and no
//     error object is ever logged whole (only .name/.message, with the
//     message text itself scrubbed against the actual configured
//     credentials) since an SDK error can carry request/header detail, and
//     AWS's own InvalidAccessKeyId error text is documented to echo the
//     rejected access key ID back inside the message;
//   - a configured endpoint must be https:, or http: pointing at loopback
//     (127.0.0.1/localhost/::1) -- every other scheme (ftp:, file:, ws:,
//     or a non-loopback http:) is rejected outright.

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
    // Allowlist, not a denylist: only https:, or http: pointing at
    // loopback for a test's own local mock server. Every other scheme
    // (ftp:, file:, ws:, wss:, a non-loopback http:, ...) is rejected.
    const isHttps = parsed.protocol === 'https:';
    const isLoopbackHttp = parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
    if (!isHttps && !isLoopbackHttp) {
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

// True only for an atomic-conditional-create rejection -- the one and only
// signal this module treats as "this object already exists, not an error".
// Any other failure (validation error, network error, a provider that
// doesn't understand IfNoneMatch at all) falls through as a genuine
// failure -- there is deliberately no fallback path that retries without
// the condition, which would silently reintroduce blind-overwrite risk.
function isPreconditionFailed(err) {
  if (!err) return false;
  if (err.name === 'PreconditionFailed') return true;
  if (err.$metadata && err.$metadata.httpStatusCode === 412) return true;
  return false;
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

    const dbSize = fs.statSync(backupPath).size;
    const sha256Buffer = fs.readFileSync(checksumPath);
    const localChecksum = sha256Buffer.toString('utf8').trim().split(/\s+/)[0];

    const dbKey = buildObjectKey(config.keyPrefix, filename);
    const sha256Key = `${dbKey}.sha256`;

    // Atomic conditional create -- never HEAD-then-PUT (TOCTOU: existence
    // could change between the check and the write, and would additionally
    // require a read-existence permission before this bucket has ever
    // received a single object). The .db body is streamed, never buffered
    // whole into memory -- ContentLength is supplied explicitly since a
    // stream's length can't be introspected by the SDK the way a Buffer's
    // can.
    //
    // Retry safety: a 412 here does NOT short-circuit the whole attempt.
    // A previous run may have uploaded the .db and then failed before ever
    // reaching the sidecar (network drop, process restart, ...) -- a retry
    // must still be able to complete that upload rather than reporting
    // "already exists" and permanently stranding the backup without its
    // sidecar. Whether the .db PutObject succeeded fresh or 412'd against
    // a pre-existing object, the exact same verification runs below before
    // either is trusted -- an already-present object is never assumed
    // valid just because it exists.
    let dbAlreadyPresent = false;
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: dbKey,
        Body: fs.createReadStream(backupPath),
        ContentLength: dbSize,
        Metadata: { sha256: localChecksum },
        IfNoneMatch: '*',
      }));
    } catch (err) {
      if (!isPreconditionFailed(err)) throw err;
      dbAlreadyPresent = true;
      log(`[SQLite Offsite Backup] ${dbKey} already exists remotely (conditional create rejected); verifying it before trusting it`);
    }

    // Verifies whichever .db object is now at dbKey -- the one just
    // uploaded, or the pre-existing one a 412 just revealed. HeadObject is
    // authorized by s3:GetObject in AWS's IAM model (there is no separate
    // "HeadObject" action) -- this is the only reason this module's
    // credential needs s3:GetObject at all.
    const dbVerify = await headObjectSafe(client, config.bucket, dbKey);
    if (!dbVerify.exists) {
      throw new Error('post-upload HEAD verification found no .db object');
    }
    if (dbVerify.contentLength !== dbSize) {
      throw new Error(`post-upload size mismatch: local=${dbSize} remote=${dbVerify.contentLength}`);
    }
    const remoteDbChecksum = dbVerify.metadata && (dbVerify.metadata.sha256 || dbVerify.metadata.Sha256);
    if (remoteDbChecksum !== localChecksum) {
      throw new Error('post-upload checksum metadata mismatch');
    }

    // Same atomic-create-then-verify pattern for the sidecar, entirely
    // independent of whether the .db above was fresh or already-present --
    // this is exactly the step a retry after a partial previous attempt
    // (db uploaded, sidecar never attempted) needs to actually complete.
    // The sidecar also carries the same local DB checksum as its own
    // metadata -- a second, independent cross-check that a pre-existing
    // sidecar object really belongs to *this* backup, not some unrelated
    // object that happens to sit at the same key.
    let sidecarAlreadyPresent = false;
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: sha256Key,
        Body: sha256Buffer,
        Metadata: { sha256: localChecksum },
        IfNoneMatch: '*',
      }));
    } catch (err) {
      if (!isPreconditionFailed(err)) throw err;
      sidecarAlreadyPresent = true;
      log(`[SQLite Offsite Backup] ${sha256Key} already exists remotely (conditional create rejected); verifying it before trusting it`);
    }

    const sidecarVerify = await headObjectSafe(client, config.bucket, sha256Key);
    if (!sidecarVerify.exists) {
      throw new Error('post-upload HEAD verification found no .sha256 object');
    }
    if (sidecarVerify.contentLength !== sha256Buffer.length) {
      throw new Error(`post-upload sidecar size mismatch: local=${sha256Buffer.length} remote=${sidecarVerify.contentLength}`);
    }
    const remoteSidecarChecksum = sidecarVerify.metadata && (sidecarVerify.metadata.sha256 || sidecarVerify.metadata.Sha256);
    if (remoteSidecarChecksum !== localChecksum) {
      throw new Error('post-upload sidecar checksum metadata mismatch');
    }

    // Only now, with BOTH objects confirmed present and valid, is this
    // attempt allowed to report success/already-existing.
    if (dbAlreadyPresent && sidecarAlreadyPresent) {
      log(`[SQLite Offsite Backup] ${dbKey} and its sidecar already existed remotely and verified intact; nothing new to upload`);
      return { skipped: true, reason: 'already_exists', dbKey, sha256Key };
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
