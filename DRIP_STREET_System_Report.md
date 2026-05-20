# DRIP STREET Architecture & Technical Audit Report

## 1. Live Environment & Tech Stack

**Production domain:** https://dripstreetshop.com

**Deployment architecture:**
- **Frontend:** Vercel
- **Backend:** Render
- **Database:** SQLite (`backend/ecommerce.db`)

**Core stack observed in the codebase:**
- **React 19** on the frontend
- **Node.js** + **Express 5** on the backend
- **Framer Motion** for motion and transitions
- **Custom CSS** in `frontend/src/index.css` for the actual UI system
- **SQLite3** for product, variant, order, and session persistence

**Stack note for reviewers:**
- The audit request references Tailwind CSS, but the inspected frontend currently ships with handcrafted CSS rather than Tailwind utility classes or Tailwind config files. The production UI is still fully functional and styled via `frontend/src/index.css`.

---

## 2. Global Geo-Location & i18n Architecture

The store is built as a bilingual, locale-aware storefront with automatic region detection and currency selection.

**Locale resolution flow:**
1. The frontend requests `GET /api/geolocation` from the backend on app mount.
2. The backend reads `x-vercel-ip-country` and `cf-ipcountry` headers.
3. If the country is `IL`, the backend returns:
   - `locale: 'he'`
   - `currency: 'ILS'`
4. For all other countries, the backend returns:
   - `locale: 'en'`
   - `currency: 'USD'`
5. The frontend applies the returned locale to:
   - `document.documentElement.dir` (`rtl` for Hebrew, `ltr` for English)
   - `document.documentElement.lang`
   - all UI copy through the `translations` object
   - displayed currency symbols and numeric conversions

**User experience rules:**
- **Israel:** Hebrew, RTL layout, ILS pricing (`₪`)
- **Rest of world:** English, LTR layout, USD pricing (`$`)

**Pricing logic:**
- The backend exposes a live exchange rate through `/api/geolocation`.
- The frontend stores the exchange rate in state and uses it to convert product and cart prices.
- Product pages and cart totals remain locale-correct after geolocation resolution.
- The app also persists user overrides in localStorage so returning visitors keep the selected language and currency.

**Code points of control:**
- Frontend app shell and locale state: `frontend/src/App.jsx`
- Geo endpoint: `backend/index.js` (`/api/geolocation`)
- Localization content: `frontend/src/App.jsx` `translations` object

---

## 3. Third-Party Integrations & APIs

### PayPal Live

The store uses a server-side PayPal integration for live checkout.

**Flow:**
1. The frontend requests the PayPal client ID from `GET /api/paypal/config`.
2. The checkout UI renders `@paypal/react-paypal-js` buttons.
3. When the buyer submits checkout, the backend creates a local pending order first.
4. The backend then creates a real PayPal order with the PayPal Orders API.
5. On capture, the backend verifies the PayPal order is `COMPLETED` and matches the expected amount before marking the local order as paid.

**Server controls:**
- OAuth token retrieval: PayPal REST API client credentials flow
- Order creation: `POST https://api-m.paypal.com/v2/checkout/orders`
- Capture: `POST https://api-m.paypal.com/v2/checkout/orders/{orderID}/capture`
- Amount integrity check: backend compares captured value against the locally calculated order total
- Duplicate protection: webhook/event deduping uses the `processed_webhooks` table

**Why this matters:**
- The backend, not the browser, owns order creation, capture verification, and fulfillment triggers.
- This protects the store from price tampering and keeps payment state authoritative.

**Relevant files:**
- `backend/index.js`
- `frontend/src/App.jsx`

### Printify Auto-Sync

Printify is wired as the product and fulfillment source of truth for the store.

**Observed behavior:**
- The backend syncs products from Printify on startup and on an hourly cron schedule.
- Printify webhooks are registered and accepted through `/api/webhooks/printify`.
- Product and variant data are synchronized into SQLite.
- The backend builds product variants, colors, sizes, images, fabric notes, care instructions, and delivery notes from Printify data.

**Caching and freshness:**
- `printify.getLiveProductSnapshot()` caches live variant snapshots in memory.
- TTL is 2 minutes.
- On PDP requests, live snapshot data is merged into stored variants so stock and availability can be refreshed without rewriting the entire product row every time.

**Strict server-side validation:**
- Before checkout, `resolveValidatedOrderItems()` validates every item against SQLite.
- If the item includes color, size, or variant data, the server checks the selected variant exists and is enabled/available.
- Orders with variant mismatches are rejected before payment creation.
- This prevents invalid Printify orders from reaching production.

**Relevant files:**
- `backend/services/printify.js`
- `backend/index.js`
- `backend/db.js`

### Telegram Webhook / Notification System

Telegram is used as the real-time operational alert channel for the store.

**What it notifies:**
- New visitor events from `/api/analytics/visit`
- New orders and payment confirmations
- Printify sync results
- Fulfillment success or failures
- Support messages from the contact form
- Error and diagnostic events

**Implementation details:**
- `backend/services/telegram.js` resolves the chat ID from environment variables or fallback sources.
- `sendMessage()` posts to the Telegram Bot API.
- The backend uses Telegram for both customer-facing operational alerts and internal system diagnostics.
- Visit alerts are deduped with a 30-minute in-memory cache so the owner is not spammed by repeated page refreshes.

**Relevant files:**
- `backend/services/telegram.js`
- `backend/index.js`
- `backend/services/meni.js`

---

## 4. CRO (Conversion Rate Optimization) & Marketing Engine

### Lead Capture System

The storefront includes a promotional email capture popup designed to convert first-time visitors.

**Behavior:**
- Shows after 5 seconds on page.
- Also triggers on exit intent via `mouseleave` detection.
- Persists dismissal state in localStorage so the visitor does not see the same offer repeatedly.
- Stores the submitted email locally for follow-up workflows.
- Uses a success state to confirm submission and then closes automatically.

**Offer framing:**
- 10% first-order discount
- Short, direct conversion copy
- Minimalist modal styling to match the brand aesthetic

**Relevant file:**
- `frontend/src/App.jsx`

### Social Proof

The product experience includes several social-proof layers.

**On PDP:**
- Star rating directly beneath the product title
- Customer review block with hardcoded, locale-specific testimonials

**On homepage:**
- A horizontal “Trending Now” strip that surfaces selected products in a scannable format

**Impact:**
- Reinforces trust near the point of decision
- Gives the store the feel of a real, active brand with buyers and opinions

**Relevant file:**
- `frontend/src/App.jsx`

### Trust Badges and Cart Cross-Selling

**PDP trust badges:**
- Security
- Fast shipping
- Easy returns

**Cart cross-sell:**
- The cart drawer shows a “You Might Also Like” recommendation row
- Recommendations are derived from the product catalog and rendered directly inside the cart drawer
- This is positioned close to checkout to encourage add-on purchases

**Relevant file:**
- `frontend/src/App.jsx`

---

## 5. Frontend UX & Mobile-First Design

The frontend uses a premium, matte-black, minimalist visual language designed for streetwear positioning.

**Visual language:**
- Dark surfaces
- High-contrast typography
- Premium, restrained motion effects
- Spacious product presentation
- Minimal visual clutter

**Mobile UX controls:**
- A dynamic hamburger navigation pattern is present in the mobile shell
- The catalog uses a mobile-friendly 2-column grid
- A sticky Add-to-Cart bar appears on PDP for mobile conversion support
- The quick-add modal lets users configure color, size, and quantity without leaving the catalog flow

**Image-color state synchronization:**
- Product data includes `imagesByColor` and variant mappings from Printify
- The PDP selects image sets based on the chosen color
- Quick-add also derives its preview image from the active color and selected variant
- This keeps the visual preview aligned with the selected inventory variant and reduces accidental mismatches

**QA-relevant behavior:**
- The PDP validates the selected color and size before carting
- The backend validates the same combination again before order creation
- This creates a two-layer guardrail around variant correctness

**Relevant files:**
- `frontend/src/App.jsx`
- `frontend/src/index.css`

---

## 6. SEO & Performance

### Dynamic SEO

The storefront implements runtime SEO adjustments tied to locale.

**Observed implementation:**
- Base document metadata exists in `frontend/index.html`
- On locale changes, the app updates:
  - `document.title`
  - `<meta name="description">`
  - `document.documentElement.lang`
  - `document.documentElement.dir`

**Base homepage metadata:**
- English title: `DRIP STREET | Minimalist Streetwear`
- English description: `Premium minimal streetwear built for confidence. Shop oversized tees, summer tanks, and high-quality basics. Worldwide shipping.`
- Hebrew versions are also defined in the translation table

**Scope of SEO behavior:**
- Locale-aware, not route-specific metadata generation
- Enough to keep the homepage and browsing experience search- and accessibility-friendly

### Localized Alt Text and Image Loading

**Alt text:**
- Product grid images use localized product titles for descriptive alt text
- PDP gallery images use the product title plus view-specific descriptors
- Trending cards also use localized product titles

**Lazy loading policy:**
- Above-the-fold PDP main image is eager/high priority
- The first product grid card is eager so the initial visible item loads quickly
- Remaining product grid images load lazily
- Product back images load lazily
- Trending section images load lazily
- PDP thumbnails and secondary gallery views are optimized for deferred loading where appropriate

**Why this matters:**
- Improves Lighthouse performance without hurting the visual priority of primary content
- Preserves the fastest path for the first visible product and the PDP hero image

**Relevant files:**
- `frontend/index.html`
- `frontend/src/App.jsx`

---

## 7. Production Review Notes

**Operational status inferred from code:**
- The storefront is production-ready and structured for live traffic.
- Orders are guarded by server-side validation and payment verification.
- Printify fulfillment is connected through sync and webhook logic.
- Telegram gives the operator real-time visibility into visits, orders, errors, and sync events.
- The frontend is bilingual, region-aware, and optimized for mobile conversion.

**Primary QA checkpoints for a live audit:**
- Confirm geolocation returns `he/ILS` from Israel and `en/USD` elsewhere.
- Confirm PayPal config loads and order creation/capture completes on the backend.
- Confirm Printify sync populates products, variants, images, and fulfillment data.
- Confirm Telegram receives visitor and order notifications.
- Confirm the locale toggle and RTL/LTR switch behave correctly.
- Confirm PDP variant validation blocks invalid combinations before payment.

**Key code surfaces for reviewers:**
- `frontend/src/App.jsx`
- `frontend/src/utils/analytics.js`
- `frontend/index.html`
- `backend/index.js`
- `backend/db.js`
- `backend/services/printify.js`
- `backend/services/telegram.js`
- `backend/services/pricing.js`
- `backend/services/meni.js`
- `frontend/src/index.css`

---

**End of report**
