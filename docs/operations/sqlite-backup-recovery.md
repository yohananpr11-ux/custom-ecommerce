# SQLite Backup Recovery

Manual, human-only procedure for restoring `ecommerce.db` from a backup
produced by `backend/services/sqlite-backup.js`. There is no automated
restore path and none should be added casually — restoring the wrong file
onto a live store is one of the few genuinely unrecoverable mistakes
available here.

Backups live in the directory configured by `SQLITE_BACKUP_DIR` (default:
a `backups/` folder next to the database), named
`ecommerce-YYYYMMDD-HHMMSSZ.db`, each with a `.sha256` sidecar written at
backup time.

## Before you touch anything

- **Stop writes first.** Stop the backend process (or scale it to zero)
  before restoring. Restoring under a live writer leaves the running
  process holding stale file handles / WAL state against a database file
  that changed out from under it.
- **Quarantine, don't delete, the current files.** Move the current
  `ecommerce.db`, `ecommerce.db-wal`, and `ecommerce.db-shm` aside (e.g.
  into a timestamped `quarantine/` folder) rather than overwriting them.
  If the restore turns out to be wrong, this is the only way back.
- **Never mix a restored `.db` with an old `-wal`/`-shm`.** Those files
  are only valid alongside the exact main-file state they were written
  against. Restoring `ecommerce.db` next to a leftover `-wal`/`-shm` from
  before the restore will silently replay unrelated changes on next open.
  Quarantine or delete `-wal`/`-shm` together with the main file — never
  keep one from before the restore and one from after.

## If local backups aren't available: retrieving one off-site

Skip this section entirely when a good local backup exists under
`SQLITE_BACKUP_DIR` — use that first. This is only for when the local disk
itself is the problem (lost, corrupted, or the backups directory is
otherwise unusable), and a copy needs to be pulled from the off-site object
store (`backend/services/sqlite-offsite-backup.js`, opt-in via
`ENABLE_OFFSITE_BACKUP`) instead.

1. **Select the desired remote backup.** Same naming as local:
   `ecommerce-YYYYMMDD-HHMMSSZ.db`, under whatever key prefix
   `OFFSITE_BACKUP_KEY_PREFIX` was configured with, followed by `sqlite/`.
2. **Retrieve both objects** — the `.db` file and its `.sha256` sidecar —
   using the storage provider's own CLI or console, with an operator-level
   credential. This is a separate, more-privileged credential than the
   application's own upload-only one; never the app's runtime credential.
3. **Never retrieve through any JONO HTTP endpoint.** None exists for this
   on purpose — see "Guardrails" below.
4. **Verify the downloaded `.db`'s SHA-256 matches the downloaded `.sha256`
   sidecar** before doing anything else, exactly as you would for a local
   backup:
   ```
   sha256sum ecommerce-YYYYMMDD-HHMMSSZ.db
   ```
   Do not proceed on a mismatch — the transfer may have been corrupted, or
   the wrong object retrieved; re-download or pick a different backup.
5. **Run `PRAGMA integrity_check` on the downloaded file** before trusting
   it, same as the local flow:
   ```
   sqlite3 ecommerce.db "PRAGMA integrity_check;"
   ```
   It must return exactly `ok`.
6. **Only then continue through the restoring procedure below**, starting
   at "Choosing and verifying a backup" — from this point on, a verified
   off-site backup is handled identically to a verified local one. The same
   "never mix a restored `.db` with an old `-wal`/`-shm`" rule applies
   without exception.

## Choosing and verifying a backup

1. List the candidates in the backup directory and pick the target
   timestamp (the most recent one, or the last one known-good before an
   incident).
2. If a `.sha256` sidecar exists for it, verify the backup file's hash
   matches before doing anything else:
   ```
   sha256sum ecommerce-YYYYMMDD-HHMMSSZ.db
   ```
   Compare against the contents of the matching `.sha256` file. Do not
   proceed on a mismatch — pick an older backup and investigate why the
   newer one doesn't verify.
   If no sidecar exists for that backup (e.g. it predates this tooling),
   treat it as unverified and go straight to `PRAGMA integrity_check` below
   before trusting it.

## Restoring

1. With the backend stopped and the current files quarantined, copy the
   verified backup file into place as the new `ecommerce.db` (the path
   `DB_PATH` / `backend/db.js` resolves to). Do not copy over any `-wal`
   or `-shm` file — the restored `.db` starts clean.
2. Open it and run an integrity check before starting the backend:
   ```
   sqlite3 ecommerce.db "PRAGMA integrity_check;"
   ```
   It must return exactly `ok`. Anything else means this backup is not
   safe to use — go back to an older one.
3. Restart the backend against the restored database.

## After restart: reconcile before trusting it

A restored backup is, by definition, missing everything that happened
between the backup timestamp and the incident. Before treating the store
as healthy again:

- **Verify paid orders and PayPal mappings.** Cross-check `orders` rows
  with `status = 'paid'` (and their `paypal_order_id` / expected
  currency+amount columns) against PayPal's own transaction history for
  the same window. Any PayPal capture with no matching local order is a
  paid order the restore lost — it needs to be manually recreated or
  reconciled, not silently dropped.
- **Verify supplier/fulfillment state.** Check `order_items` (`supplier_id`,
  `fulfillment_status`, `fulfillment_ref`) and `supplier_fulfillments`
  against the supplier's own dashboard/API for the same window, so an
  order that was actually submitted to a supplier before the incident
  isn't resubmitted (double fulfillment) or silently forgotten.
- **Compare recent paid orders against PayPal end to end** for the full
  gap window (backup timestamp → incident time), not just spot-checking
  the newest one — the whole gap is unaccounted-for by construction.

## Guardrails that are deliberate, not gaps

- **No automated restore endpoint exists**, and none should be exposed
  over HTTP. Restoring is destructive, requires human judgment at the
  verification and reconciliation steps above, and must happen with the
  backend stopped — properties an API endpoint can't safely guarantee.
- **No public or authenticated download endpoint for backup files
  exists.** Backup files contain full customer PII (names, emails,
  addresses, order history). They are retrieved by direct filesystem/disk
  access only, never served over HTTP.
- **The off-site layer has no restore, download, or browse endpoint
  either**, and no application-level delete/prune capability against the
  object store at all — see `sqlite-offsite-backup.js`'s own module
  comment. Remote retention is a bucket lifecycle policy an operator
  configures on the storage provider's side (a starting point of ~30 days
  is reasonable), never something this codebase's application code can do.
  That split is deliberate: off-site storage is the disaster-recovery
  boundary of last resort, and a bug in application code should never be
  able to reach in and delete backup history, local or remote.

## Off-site credential: minimum IAM permissions

The credential this application uses (`OFFSITE_BACKUP_ACCESS_KEY_ID` /
`OFFSITE_BACKUP_SECRET_ACCESS_KEY`) needs exactly two permissions, for
AWS S3 or any IAM-compatible S3-provider:

- **`s3:PutObject`** — uploads the `.db` and `.sha256` objects.
- **`s3:GetObject`** — required for the post-upload HEAD verification calls.
  AWS's IAM model has no separate "HeadObject" permission; the `HeadObject`
  API action is authorized by `s3:GetObject`, the same permission a full
  download would need, even though this module never actually downloads
  object contents.

Deliberately **not** required by the normal upload path:

- **No `s3:DeleteObject`.** This module never deletes anything (see above);
  granting it would only widen a leaked credential's blast radius for no
  functional benefit.
- **No `s3:ListBucket`.** Overwrite protection uses an atomic conditional
  create (`IfNoneMatch: '*'` on `PutObject`) rather than a HEAD-then-PUT
  existence check, so nothing in the normal upload path ever needs to
  enumerate or check bucket contents ahead of a write.

An operator retrieving a backup for restore (see the retrieval steps above)
uses a *separate*, more-privileged credential of their own — never this
application's write-oriented one.
