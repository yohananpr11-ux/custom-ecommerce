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
