# Printify Duplicate/Stale-Product Recovery

What to do when a Printify sync aborts with `Duplicate printifyId ... found in
N products. Sync aborted.`, or when a local `type='printify'` product no
longer corresponds to any live Printify catalog item. Manual, human-only —
there is no automated repair, and none should be added casually. Deciding
which of two duplicate rows is the stale one requires judgment (order
history, which row Printify's live title actually matches) that is unsafe to
automate.

## What the abort means

`services/printify-sync-helpers.js`'s `matchAndUpsertProduct()` counts every
row that already matches an incoming product's `printifyId` before writing.
If it finds more than one, it refuses to guess and aborts the whole sync
rather than silently picking one and losing track of the other. This is
deliberate, working-as-intended behavior, not a bug to route around — treat
every abort as a real data problem that needs a human to look at it, not
something to retry past.

As of this hardening pass, this class of incident is also structurally
harder to reach in the first place:

- **Checkout guard** (`resolveValidatedOrderItems` in `backend/index.js`):
  a `type='printify'` product with a missing/blank `printifyId` can never
  reach payment creation. Previously, a paid order could be created for
  such a row with no way to ever submit it to Printify at fulfillment time.
- **Database-level uniqueness** (`backend/db.js`): a partial unique index
  on `products.printifyId` (excluding NULL/blank) makes a duplicate
  impossible to write from *any* code path — the app, a script, anything —
  not just something application code has to remember to check.

Together these don't prevent a duplicate from occurring, but they close the
two ways it used to cause real damage: an unfulfillable paid order, and a
second write silently succeeding once one already exists.

## Investigating an abort

1. Find the two (or more) conflicting local rows:
   ```sql
   SELECT id, title, printifyId, price, stock
   FROM products WHERE printifyId = '<the id from the abort message>';
   ```
2. Check order history for each candidate row — never proceed without this:
   ```sql
   SELECT productId, COUNT(*) FROM order_items
   WHERE productId IN (<id1>, <id2>) GROUP BY productId;
   ```
3. Compare each candidate's stored title against Printify's live title for
   that product (`GET /v1/shops/{shopId}/products/{printifyId}.json`,
   read-only). Whichever local row already matches the live title is almost
   always the one being kept in sync; the other is the stale twin.

## Resolving it

If one candidate has zero order history (the common case for a stale,
long-abandoned duplicate): clear its `printifyId` so it stops competing —
`UPDATE products SET printifyId = NULL WHERE id = <stale-id>;` — the sync
will then match the remaining row cleanly on its next run. If **both** rows
have real order history, this needs full manual reconciliation (remap
`order_items`/`product_variants`, decide fulfillment history) — don't apply
the one-line fix to that case.

Take a fresh SQLite backup immediately before any write (see
`docs/operations/sqlite-backup-recovery.md`), and re-run the global
duplicate scan afterward to confirm exactly one printifyId group was
resolved and no new one was introduced:
```sql
SELECT printifyId, COUNT(*) AS c, GROUP_CONCAT(id)
FROM products WHERE printifyId IS NOT NULL AND TRIM(printifyId) != ''
GROUP BY printifyId HAVING c > 1;
```

## After a printifyId is cleared: the row is now orphaned, not gone

A `type='printify'` row with `printifyId = NULL` still exists, still has
`type='printify'`, and — critically — is **not** automatically hidden,
disabled, or removed by anything in this codebase. The checkout guard
stops it from being *purchased*, but it remains visible in the storefront
catalog with whatever stale price/stock/images it last had. This is a
deliberate choice, not an oversight: automatic deletion is out of scope
here for the same reason automatic duplicate resolution is — it requires
judgment a script shouldn't make unattended.

Making an orphaned row unpurchasable *and* undiscoverable (matching the
convention `scripts/manual-payment-test-product.js` already uses for
hidden products) is a manual operator action: `supplier_id='manual'`,
`type='local'`, `stock=0`. This is a data operation an operator performs
deliberately when ready, not something this PR automates or ships tooling
for.

## Never sync via a second implementation

`backend/run-sync.js` is a thin authenticated HTTP client for
`POST /api/admin/printify-sync` — it contains no product-matching,
variant-reconciliation, or direct database logic of its own. Always trigger
a manual sync through it (or the endpoint directly), never by writing a new
standalone script that talks to Printify or the database independently.
Every sync — scheduled, webhook-triggered, or manually kicked off — must go
through the one running server process so it shares
`services/printify.js`'s `_syncTail` serialization. A second, separate
sync-implementing process sharing the same database is exactly how the
original duplicate-printifyId incident this document exists for became
possible.
