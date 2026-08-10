# PROJECT HISTORY AND SYSTEM MAP — JONO Store
# Full Architecture, Suppliers, Timeline, and Connected-Dots
# Generated: 2026-08-07 | Author: Copilot CTO Agent

---

## 🗺️ GENERAL PICTURE — WHAT THIS PROJECT IS

JONO is a Yohanan's men's fashion brand (Yohanan = John = JONO).
It is a **fully custom e-commerce stack** (NOT Shopify) selling:
1. **Apparel** (Print-on-Demand via Printify) — Premium heavyweight tees, CVC tees, hoodies
2. **Jewelry** (Dropshipping via CJ Dropshipping) — 316L stainless steel chains, bracelets, studs

The store is live at **https://www.shopjono.com** as of 2026-08-07.

---

## 1. REPOSITORIES

### Primary Repo
| Field | Value |
|-------|-------|
| URL | https://github.com/yohananpr11-ux/custom-ecommerce.git |
| Remote | origin |
| Team | yohananpr11-ux |
| Default branch | main |

### All Branches (36 total)
```
main (current production)
backup/joakim-wip-2026-08-02       ← WIP snapshot before rebrand, DO NOT MERGE
backup-before-i18n-removal
english-only-release
feat/approved-pricing-and-dolev-prep      ← PR #19 (merged)
feat/cors-shopjoakim-domain               ← PR #13 (merged)
feat/fabric-upgrade-11-to-1717-plus-5-cvc ← PR #18 (merged)
feat/full-store-ready-live                ← PR #20 (merged)
feat/joakim-storefront-rebrand            ← PR #16 (merged)
feat/mani-v2-jewelry-fabric-audit         ← PR #17 (merged)
feat/paypal-standard-card-button          ← PR #12 (merged)
feature/antigravity-ui-redesign
fix/joakim-neck-label-final-5c            ← PR #15 (merged)
fix/paid-order-e2e-readiness
fix/paypal-silent-cancel-observability    ← PR #11 (merged)
fix/phase-9-mobile-responsiveness
fix/phase-9-polish
fix/printify-auth-p0
fix/safe-manual-payment-test-product
fix/shipping-exempt-manual-test-product-25
fix/startup-safety-observability
hotfix/shop-down-timeout                  ← PR #21 (merged) — fixed ERR_CONNECTION_TIMED_OUT
integration/joakim-phase-1                ← Brand assets (JOAKIM logos, neck label)
integration/joakim-phase-2-brand-shell    ← Metadata, footer
integration/joakim-phase-3a-storefront    ← Full storefront rebrand
integration/joakim-phase-3b-customer-channels
integration/joakim-phase-3c-backend-copy
integration/joakim-phase-4b-favicon
refactor/rebrand-joakim-to-jono           ← PR #22 (merged) — JOAKIM→JONO
security/remove-hardcoded-printify-token  ← PR #14 (merged) — CRITICAL security fix
stabilize/payments-p0
stabilize/payments-p0-clean
test/neck-label-draft-5b
feat/automation/printify-pipeline
```

### ⚠️ CRITICAL NOTE: integration/joakim-phase-1 branch
The neck label source URL in design-pipeline.js points to a raw file in this branch:
`https://raw.githubusercontent.com/yohananpr11-ux/custom-ecommerce/integration/joakim-phase-1/frontend/public/jono-logo-transparent.png`
**This URL returns HTTP 404** — the file doesn't exist there by that name.
This means Printify neck label uploads WILL FAIL unless NECK_LABEL_SOURCE_URL env var is set on Render.

---

## 2. FULL TIMELINE — DRIP STREET → JOAKIM → JONO

```
DATE        COMMIT(s)     EVENT
──────────────────────────────────────────────────────────────────
~2025 Q4    early         DRIP STREET launched: Gildan blanks, Bella+Canvas 3001 standard
                          Domain: dripstreetshop.com
                          Brand: "D" metallic logo (logo-new.png still exists in repo)
                          Products: Softstyle tees ₪89.90, Bella ₪119.90, Hoodies ₪159.90

2026 Q1     PRs #1-#13    Payments: PayPal + Stripe + PayPlus added
                          Phase 9: Mobile responsiveness
                          Phase 11: UI redesign (antigravity)
                          Phase 12: Logo rembg (metallic D, logo-new.png)
                          PR #11: PayPal silent cancel observability
                          PR #12: PayPal Standard card button
                          PR #13: CORS for shopjoakim.com

2026 Q2     PR #14        SECURITY: Removed hardcoded Printify token from run-sync.js
            6ef4d7b       Critical fix — token was in git history

            PR #15        Neck label fix — inner_neck asset 6a72e86f376cb40ed1f472c2
            6a05f90

            PR #16        REBRAND 1: DRIP STREET → JOAKIM
            31585b7       Reason: Legal issues with DRIP STREET name
                          Domain: shopjoakim.com (added to CORS)
                          Design: kept D logo, added JOAKIM text

            PR #17        Mani V2: Real-time Telegram intelligence + bot detection + daily report
            004ec41       Added: botDetector.js, daily cron 23:00, visit alerts

2026 ~Jul   PR #18        FABRIC UPGRADE: Gildan → Comfort Colors 1717 (6.1oz)
            a60a640       New pricing: heavyweight 199.90, CVC 169.90, hoodie 249.90
                          Blueprint 706 (CC1717), Blueprint 3013 (CVC 3001CVC)

            PR #19        Applied approved pricing + Dolev iPhone test prep
            4e03f39       Free shipping: 199 → 299 ILS

            PR #20        Full store ready live
            eb2ace6       Published 11 heavyweight + 5 CVC products (in code)
                          products_seed.json: 21 products (16 apparel + 5 jewelry)

2026-08     hotfix/PR #21 ERR_CONNECTION_TIMED_OUT — Namecheap DNS pointed to parking IP
                          Fixed: DNS A @ 216.198.79.1, CNAME www → vercel-dns

2026-08-07  PR #22        REBRAND 2: JOAKIM → JONO
            8a1b38e       Reason: Brand pivot. Yohanan=John=JONO. Freedom/landscape vibe.
                          Domain: shopjono.com (already purchased)
                          21 products renamed, all SEO updated

2026-08-07  7fade0b       Added hero.png background image + missing JONO asset files
                          PROBLEM: jono-approved-full-logo.png created as copy of
                          shirt-black-white-logo.png (shirt image, NOT a logo)

2026-08-07  54e682d       Replaced logo-new.png (D) with jono-approved-full-logo.png
                          PROBLEM: Still shows broken/wrong image (shirt photo)

2026-08-07  888714f       FIXED: JonoLogo.jsx text component (Bebas Neue font)
                          Stopped Telegram hourly spam (hourly → daily 09:00 IST)
                          botDetector: 2-layer classification (human/known_bot/suspicious)
                          Daily report: 23:00 → 20:00 IST, real COGS, traffic split
```

---

## 3. SYSTEM ARCHITECTURE MAP

```
                        ┌─────────────────────────────────────────────┐
                        │              OWNER (Yohanan)                │
                        │    iPhone · Desktop · Telegram @Meni_bot    │
                        └───────────────────┬─────────────────────────┘
                                            │ views reports, gets alerts
                                            ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         TELEGRAM MANI BOT (@Meni_Assistantbot)                  │
│  • Real-time alerts: 👤 visit → 🛒 cart → 💳 checkout → ✅ order               │
│  • Daily report: 20:00 IST (Revenue, COGS, Profit, Traffic, Insights)           │
│  • Bot token: TELEGRAM_BOT_TOKEN (Render env, secret)                           │
│  • Chat ID: TELEGRAM_OWNER_CHAT_ID = 644275080                                  │
│  • Code: backend/services/telegram.js, backend/services/meni.js                 │
│  • CURRENT BUG FIXED: Was sending "Printify Sync Completed" EVERY HOUR (spam)  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                            ▲
                                            │ sendMessage()
                    ┌───────────────────────┴──────────────────────────┐
                    │                                                   │
                    ▼                                                   ▼
┌───────────────────────────────────┐       ┌──────────────────────────────────────┐
│     FRONTEND — Vercel             │       │     BACKEND — Render                 │
│     Project: custom-ecommerce     │       │     Service: custom-ecommerce-backend│
│     Team: yohanan-ecommerce-26    │       │     URL: custom-ecommerce-qp30       │
│     URL: custom-ecommerce-seven   │       │           .onrender.com              │
│           .vercel.app             │       │     Port: 4000                       │
│     Domain: www.shopjono.com ✅   │       │     Node.js + Express 5              │
│             shopjono.com (308→www)│       │     Plan: FREE (RAM issue ⚠️)        │
│     Stack: React 19 + Vite        │       │                                      │
│     Deploy: auto on push to main  │       │     Env vars (set in Render):        │
│     Config: vercel.json (SPA)     │       │     • PRINTIFY_API_TOKEN (secret)    │
│     Font: Bebas Neue (Google)     │       │     • TELEGRAM_BOT_TOKEN (secret)    │
│     Logo: JonoLogo.jsx (text)     │       │     • PAYPAL_CLIENT_ID (secret)      │
│     Hero: /hero.png background    │       │     • PAYPAL_CLIENT_SECRET (secret)  │
└─────────────────┬─────────────────┘       │     • CJ_API_KEY (secret)            │
                  │ fetch API calls          │     • DRIP_ADMIN_SECRET (secret)     │
                  │ CORS allowed             │     • STRIPE_SECRET_KEY (secret)     │
                  ▼                          └──────────────┬───────────────────────┘
         User's Browser                                     │ API calls
                                            ┌───────────────┼───────────────────────┐
                                            ▼               ▼                       ▼
                                  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
                                  │   PRINTIFY   │  │CJ DROPSHIPPING│  │  PAYPAL REST API  │
                                  │ POD Apparel  │  │  Jewelry      │  │  Payments Live    │
                                  │ Shop: 27495153│  │ Products 17-21│  │  PAYPAL_CLIENT_ID │
                                  │ Blueprint 706 │  │ 316L Steel    │  │  Webhooks         │
                                  │  CC 1717 6.1oz│  │ Chains/Studs  │  └────────────────────┘
                                  │ Blueprint 3013│  │ Ships from CN │
                                  │  CVC 3001CVC  │  │ CJ API v2     │
                                  │ Blueprint 180 │  │ createOrderV2 │
                                  │  Gildan 18500 │  └──────────────┘
                                  │ Provider 99   │
                                  │  (Printify    │
                                  │   Choice)     │
                                  │ Neck label:   │
                                  │ 6a72e86f376cb │
                                  └──────────────┘
```

---

## 4. SUPPLIERS IN DETAIL

### 4A. Printify (Print-on-Demand Apparel)
| Field | Value |
|-------|-------|
| Shop ID | 27495153 |
| API Base | https://api.printify.com/v1 |
| Auth | PRINTIFY_API_TOKEN (Render env, secret) |
| Default Blueprint | 6 (Bella+Canvas 3001 — OLD) |
| Current Blueprints | 706 (CC 1717), 3013 (CVC 3001CVC), 180 (Gildan 18500) |
| Default Provider | 99 (Printify Choice) |
| Neck label asset ID | 6a72e86f376cb40ed1f472c2 |
| Neck label URL | **BROKEN** — points to integration/joakim-phase-1 branch (404) |
| Webhook | /api/webhooks/printify on Render |

**Products 1-11 (Heavyweight Tees — Blueprint 706 CC 1717):**
All at ₪199.90. Designs include Pornstar Martini, Samurai, Palm Tree, Paris Eiffel, etc.

**Products 12-16 (CVC Tees — Blueprint 3013):**
JONO - Essential CVC Black/White, Minimal Wordmark, Monogram Navy, Oversized.
At ₪169.90. ⚠️ Status in Printify UNKNOWN — only in products_seed.json / SQLite.

**Product 10 (Hoodie — Blueprint 180 Gildan 18500):**
At ₪249.90.

### 4B. CJ Dropshipping (Jewelry)
| Field | Value |
|-------|-------|
| API | https://developers.cjdropshipping.com/api2.0/v1 |
| Auth | CJ_API_KEY (Render env, secret) — exchanges for CJ-Access-Token (12hr cache) |
| Order endpoint | /shopping/order/createOrderV2 |
| Products | IDs 17-21 in store (DO NOT DELETE) |
| Code | backend/services/dropship.js |

**Products 17-21 (Jewelry):**
- 17: HEAVYWEIGHT CUBAN CHAIN
- 18: TITANIUM BRAIDED PENDANT
- 19: COLD WIND CUBAN BRACELET
- 20: ESSENTIAL STEEL STUDS
- 21: ONYX ZIRCON STUDS

### 4C. PayPal (Payments)
| Field | Value |
|-------|-------|
| Mode | Live (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET) |
| Frontend SDK | @paypal/react-paypal-js ^9.2.0 |
| Standard card | Enabled (PR #12) |
| Webhooks | /api/paypal/capture-order (backend) |
| Fee | ~3% (used in profit calculations) |

### 4D. Other Services
| Service | Purpose | Env Var | Status |
|---------|---------|---------|--------|
| Resend | Transactional email (10% OFF, order confirm) | RESEND_API_KEY | Active |
| Cloudinary | Mockup image processing | CLOUDINARY_URL | Optional (mockup pipeline) |
| Stripe | Alternative payment | STRIPE_SECRET_KEY | Configured but PayPal primary |
| PayPlus | Israeli payment (alt) | PAYPLUS_API_KEY | Configured |
| IPAPI.co | Geolocation for visits | IPAPI_KEY (optional) | Free tier 1000/day |
| Google Fonts | Bebas Neue + Inter | CDN in index.html | Active |
| Google Analytics | GA4 | (in App.jsx pixels) | Active |
| Meta Pixel | Facebook ads | (in App.jsx) | Active |
| TikTok Pixel | TikTok ads | (in App.jsx) | Active |

---

## 5. FOLDER STRUCTURE — FULL MAP

```
custom-ecommerce/
├── backend/                          ← Node.js Express API (Render)
│   ├── index.js                      ← MAIN SERVER: routes, crons, CORS, startup
│   ├── db.js                         ← SQLite connection
│   ├── run-sync.js                   ← Manual Printify sync trigger
│   ├── generate_prerender_fallback.js← Regenerates products_fallback.json from DB
│   ├── register-webhooks.js          ← Registers Printify/Telegram webhooks
│   ├── dns-check.js                  ← DNS utility
│   ├── data/
│   │   ├── products_seed.json        ← Source of truth for 21 products (seed DB)
│   │   └── product-copy-updates.json ← Premium copy descriptions per product
│   ├── services/
│   │   ├── pricing.js                ← PricingEngine: retail prices, COGS, margins, crons
│   │   ├── telegram.js               ← TelegramService: alerts, daily report, crons
│   │   ├── printify.js               ← PrintifyService: syncProducts(), product API
│   │   ├── design-pipeline.js        ← createDraftFromImage(), neck label, mockup flow
│   │   ├── fulfillment.js            ← Order fulfillment: Printify + CJ routing
│   │   ├── fulfillment-recovery.js   ← Crash recovery for stale paid orders
│   │   ├── dropship.js               ← CJ Dropshipping API client
│   │   ├── emailService.js           ← Resend email: order confirm, 10% OFF
│   │   ├── meni.js                   ← Meni AI chat assistant (customer chat)
│   │   └── mockups/                  ← Mockup generation (Cloudinary pipeline)
│   ├── middleware/
│   │   └── botDetector.js            ← 2-layer visitor classification (human/bot/suspicious)
│   ├── routes/
│   │   ├── admin-reports.js          ← Admin analytics endpoints
│   │   ├── carts.js                  ← Abandoned cart tracking
│   │   ├── feeds.js                  ← Google Merchant feed, sitemap API
│   │   ├── marketing-webhooks.js     ← Marketing event intake
│   │   └── dev.js                    ← Dev/test endpoints
│   ├── scripts/
│   │   ├── sync-jono-catalog.js      ← Bulk Printify title/copy sync script
│   │   ├── update-printify-copy.js   ← Update product descriptions in Printify
│   │   ├── purge-local-placeholder-products.js
│   │   └── [many test/harness scripts]
│   ├── tests/                        ← Mocha/Node test files
│   ├── ecommerce.db                  ← SQLite database (NOT in git — gitignored)
│   └── .env                          ← Secrets (NOT in git — gitignored)
│
├── frontend/                         ← React + Vite SPA (Vercel)
│   ├── index.html                    ← Title: "JONO - Men's Heavyweight Tees & Steel Jewelry"
│   │                                    Fonts: Bebas Neue + Inter (Google)
│   │                                    Canonical: https://shopjono.com/
│   │                                    OG image: /jono-og.png
│   ├── vite.config.js                ← Vite config
│   ├── vercel.json                   ← SPA rewrite (/* → /index.html)
│   ├── public/
│   │   ├── hero.png                  ← Hero background image (13KB)
│   │   ├── logo-new.png              ← OLD Drip Street "D" logo (276KB) — still exists, not used
│   │   ├── jono-approved-full-logo.png ← Copy of shirt-black-white-logo.png (417KB) ⚠️ wrong file
│   │   ├── jono-favicon.png          ← Copy of apple-touch-icon.png (3.6KB) ✅
│   │   ├── jono-og.png               ← Copy of android-chrome-512x512.png (11KB) ✅
│   │   ├── jono-logo-transparent.png ← Copy of logo-new.png = D logo ⚠️ wrong
│   │   ├── jono-wordmark-dark.png    ← Copy of logo-new.png = D logo ⚠️ wrong
│   │   ├── shirt-black-design.png    ← Product photo
│   │   ├── shirt-black-white-logo.png← Product photo
│   │   ├── sitemap.xml               ← 28 URLs at shopjono.com
│   │   └── robots.txt                ← Sitemap: shopjono.com
│   ├── src/
│   │   ├── App.jsx                   ← MAIN APP (4500+ lines): all routes, cart, checkout
│   │   ├── index.css                 ← All styles (4400+ lines)
│   │   ├── main.jsx                  ← React entry point
│   │   ├── paypalFlowHelpers.js      ← PayPal helper utils
│   │   ├── components/
│   │   │   ├── JonoLogo.jsx          ← NEW: Text logo component (Bebas Neue, no image)
│   │   │   ├── Footer.jsx            ← Store footer with JONO branding
│   │   │   ├── MobileNav.jsx         ← Mobile navigation drawer
│   │   │   ├── LegalPageLayout.jsx   ← Wrapper for legal pages
│   │   │   ├── CookieConsent.jsx     ← GDPR cookie banner
│   │   │   └── BackButton.jsx        ← Navigation back button
│   │   ├── pages/
│   │   │   ├── About.jsx / AboutUs.jsx
│   │   │   ├── ContactUs.jsx         ← support@shopjono.com ✅
│   │   │   ├── PrivacyPolicy.jsx
│   │   │   ├── RefundPolicy.jsx      ← support@shopjono.com ✅
│   │   │   ├── Shipping.jsx / ShippingPolicy.jsx
│   │   │   ├── Terms.jsx / TermsOfService.jsx ← JONO branding ✅
│   │   └── utils/
│   │       └── analytics.js          ← GA4 + Meta + TikTok pixel tracking
│   ├── assets/
│   │   └── hero.png                  ← Source hero image (also copied to public/)
│   └── scripts/
│       ├── products_fallback.json    ← Build-time product data (21 products)
│       ├── generate-sitemap.cjs      ← Generates sitemap.xml (BASE_URL=shopjono.com)
│       ├── prerender-products.cjs    ← Prerenders 21 product pages for SEO
│       └── validate-seo.cjs          ← SEO validation (OG image, canonical checks)
│
├── docs/                             ← Untracked — not in git
├── render.yaml                       ← Render deployment config
├── MANI_V2_PROOF.md                  ← Untracked — pricing proof doc
├── REPORT_JOAKIM_DESIGN_AUDIT.md     ← Untracked — design audit
└── PROJECT_HISTORY_AND_SYSTEM_MAP.md ← This file
```

---

## 6. MANI BOT — FULL ARCHITECTURE

### What is Mani?
- Telegram bot @Meni_Assistantbot reporting to owner (Yohanan)
- Also has `meni.js` — AI customer chat assistant on the store (answers product questions)
- These are TWO SEPARATE systems sharing telegram.js for messaging

### Bot Connection
| Field | Value |
|-------|-------|
| Bot Token | TELEGRAM_BOT_TOKEN (Render env, never hardcoded) |
| Owner Chat ID | 644275080 (hardcoded in telegram.js as DEFAULT_MENI_CHAT_ID) |
| Mode | **Webhook** (not polling) — `/api/webhooks/telegram` on Render |
| Webhook registration | `backend/register-webhooks.js` |

### Cron Jobs (after commit 888714f fixes)
| Job | Schedule | Code Location | Purpose |
|-----|----------|---------------|---------|
| Printify Sync | Daily 09:00 IST | index.js:3974 | Sync products from Printify API |
| Email Retry | Every 15 min | index.js:3982 | Retry failed transactional emails |
| Fulfillment Recovery | Every 5 min | index.js:4014 | Recover stale paid orders |
| Daily Report | 20:00 IST | telegram.js:299 | Send Mani daily intelligence |
| Exchange Rate Update | Daily midnight | pricing.js:213 | Refresh USD/ILS rate |
| Price Check | Quarterly | pricing.js:219 | Quarterly pricing audit |

### SPAM BUG (FIXED in 888714f)
**Root cause:** `syncProducts()` in `printify.js` line 247 always called:
```js
await telegram.sendMessage(`🔄 Printify Sync Completed\n\n${syncedCount} products...`)
```
And index.js ran `syncProducts('scheduled')` **every hour** (cron `0 * * * *`).
So bot sent 1 message/hour × all day = 20-24 messages/day → 150 unread.

**Fix applied:**
1. `printify.js`: Only sends Telegram if `source !== 'scheduled'`
2. `index.js`: Changed `0 * * * *` to `0 9 * * *` (daily 09:00 IST)

### RAM 97% Root Cause
The hourly Printify sync loaded ALL product images + variants from Printify API every hour.
`syncProducts()` does a full DB write cycle for all products + variants.
Fix: daily sync = 24x fewer memory spikes per day.

### Heartbeat "זוהתה התערבות מחשב"
This message suggests **two instances of the backend running simultaneously** on Render.
Render free plan can restart instances, creating overlapping processes.
Each instance registers webhooks and starts its own cron jobs → doubled messages.
Fix: Render env `DISABLE_BACKGROUND_JOBS=true` on secondary instances, or use a single-instance plan.

### Alert Types (Human-only, after botDetector fix)
```
👤 New Human Visit (LOW) — only for human visitors, not bots
🛒 Product Viewed (MEDIUM)
🛍 Added to Cart (MEDIUM-HIGH)
💳 Checkout Started (HIGH)
✅ Order Completed (HIGHEST) + profit calc
```

---

## 7. REPORTING SYSTEM

### Pricing Engine (backend/services/pricing.js)
```js
targetPricesILS = {
  'heavyweight': 199.90,  // CC 1717 6.1oz
  'cvc':         169.90,  // CVC 3001CVC
  'hoodie':      249.90,  // Gildan 18500
}
freeShippingThresholdNIS = 299
shippingCostNIS = 29.90
paymentFeeRate = 0.03 (PayPal ~3%)
```

### COGS (Cost of Goods Sold)
| Item | Blank | Shipping to IL | Total USD | Total ILS (@3.75) |
|------|-------|----------------|-----------|-------------------|
| CC 1717 Heavyweight | $11.80 | $10.50 | **$22.30** | ₪83.63 |
| CVC 3001CVC | $9.40 | $8.50 | **$17.90** | ₪67.13 |

### Example Profit Calculation
```
1× Heavyweight @ ₪199.90:
  Retail:       $53.30 (₪199.90 ÷ 3.75)
  - COGS:      -$22.30
  - PayPal 3%: -$1.86 (3% × $62.09 = ~$1.86)
  = NET PROFIT: $29.14 (~₪109)  ← 54.7% margin
```

### Data Stored (SQLite ecommerce.db)
- `orders` — all orders, amounts, status
- `order_items` — products per order
- `products` — synced from Printify
- `product_variants` — colors, sizes, prices
- `leads` — email signups (10% OFF popup)
- `abandoned_carts` — cart abandonment tracking
- `visits` — store visits (with bot_type column after 888714f)
- `pricing_state` — exchange rate cache

---

## 8. SECURITY SYSTEM

### Secrets Management
All secrets are in Render environment variables (never in git):
- PRINTIFY_API_TOKEN
- TELEGRAM_BOT_TOKEN
- PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET
- CJ_API_KEY
- STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
- PAYPLUS_API_KEY / PAYPLUS_SECRET_KEY
- DRIP_ADMIN_SECRET (admin endpoints auth)
- RESEND_API_KEY
- CLOUDINARY_URL

### Gitignore
`.env`, `backend/.env`, `*.env`, `backend/*.db-wal`, `backend/backups/` — all ignored.

### CORS Allowlist (backend/index.js ~line 283)
```
https://custom-ecommerce-seven.vercel.app
https://shopjono.com
https://www.shopjono.com
https://shopjoakim.com        (kept for transition)
https://www.shopjoakim.com    (kept for transition)
https://dripstreetshop.com    (kept for transition)
https://www.dripstreetshop.com(kept for transition)
+ CORS_ALLOWED_ORIGINS env var (runtime override)
```

### PR #14 Security Fix (commit 6ef4d7b)
Fixed hardcoded Printify token in `backend/run-sync.js`.
Token was leaked to git history. After fix: uses `process.env.PRINTIFY_API_TOKEN` with fail-fast.

### ⚠️ Remaining Security Issue
`backend/index.js` lines 10-12:
```js
if (printify.token === 'YOUR_PRINTIFY_TOKEN_ROTATED') {
  printify.token = 'YOUR_PRINTIFY_TOKEN';  ← placeholder, not a real secret
  process.env.PRINTIFY_API_TOKEN = 'YOUR_PRINTIFY_TOKEN';
```
This is placeholder logic (not a real leaked token) but worth cleaning up.

---

## 9. DOMAINS & HOSTING

### Vercel (Frontend)
| Domain | Status | Notes |
|--------|--------|-------|
| www.shopjono.com | ✅ Valid Production | Primary |
| shopjono.com | ✅ Valid 308→www | Redirect |
| custom-ecommerce-seven.vercel.app | ✅ Production | Backup URL |
| dripstreetshop.com | ⚠️ DNS Change Recommended | Should be removed |
| www.dripstreetshop.com | ⚠️ DNS Change Recommended | Should be removed |

### Namecheap DNS (shopjono.com)
```
A     @    216.198.79.1              (Vercel IP)
CNAME www  d50203f779e7480e.vercel-dns-017.com
```

### Render (Backend)
```
Service: custom-ecommerce-backend
URL: https://custom-ecommerce-qp30.onrender.com
Plan: FREE (⚠️ RAM 97% — consider upgrading to Starter $7/mo)
Start: node index.js (rootDir: backend)
```

---

## 10. 6 UNTRACKED FILES (Audit Tools — NOT in git by design)

These files are one-off audit/validation scripts created during development sessions.
They are NOT part of the production codebase. They sit in the working directory but are gitignored.

| File | Purpose |
|------|---------|
| `check-lines.js` | Dev tool: prints specific line ranges of App.jsx for inspection |
| `validate-drip-street.cjs` | Phase 3 validation: checks /api/products returns 17+ products |
| `search-coupon-handling.js` | Audit: searches coupon handling code |
| `search-frontend.js` | Audit: searches frontend code patterns |
| `search-paypal-create.js` | Audit: searches PayPal create order code |
| `docs/` folder | Contains Drip-Street-Store-Audit-Report.md (pre-rebrand audit) |

**These must never be staged or committed.** They are safe to delete after use.

---

## 11. CURRENT STATUS — WHAT WORKS / WHAT'S BROKEN

### ✅ Working
- www.shopjono.com HTTP 200, shopjono.com 308→www
- Title: "JONO - Men's Heavyweight Tees & Steel Jewelry"
- Hero background image (hero.png) with dark overlay
- Header: JONO text logo (Bebas Neue font) — NO MORE broken image
- Footer: JONO text logo
- 21 product pages prerendered (SEO)
- Pricing: 199.90/169.90/249.90, free shipping 299
- PayPal live payments
- CJ Dropshipping jewelry (products 17-21)
- Telegram daily report 20:00 IST
- Bot detection 2-layer (human/known_bot/suspicious)
- Printify sync spam STOPPED (was hourly → now daily 09:00 IST)

### ⚠️ Known Issues
| Issue | Severity | Fix |
|-------|----------|-----|
| Neck label URL 404 (GitHub branch path broken) | HIGH | Set NECK_LABEL_SOURCE_URL env on Render to main branch raw URL |
| jono-approved-full-logo.png is shirt image, not a logo | MEDIUM | Now replaced with JonoLogo.jsx (text), file still exists but unused for logo |
| 5 CVC products (12-16) unknown if live in Printify | MEDIUM | Need PRINTIFY_API_TOKEN in env to verify/create |
| "dripstreetshop.com" still in Vercel (legal risk) | HIGH | Remove via Vercel dashboard: Settings → Domains |
| Render FREE plan → RAM 97% → crashes | MEDIUM | Upgrade to Starter ($7/mo) or optimize crons |
| Heartbeat "זוהתה התערבות מחשב" = 2 Render instances | MEDIUM | Add SINGLE_INSTANCE_LOCK or upgrade plan |
| meni.js still has "Drip Street" in SYSTEM_INSTRUCTION | LOW | Update meni.js AI persona to JONO |
| index.js line 2166: publicUrl still uses dripstreetshop.com | LOW | Update to shopjono.com |

---

## 12. DATA FLOW — ORDER LIFECYCLE

```
1. USER visits www.shopjono.com
   → Frontend fetches /api/products from Render backend
   → botDetector classifies visitor (human/bot)
   → if human: Telegram 👤 New Human Visit alert

2. USER browses product (e.g. /product/1)
   → Frontend fetches /api/products/1 (Printify synced data)
   → Telegram 🛒 Product Viewed alert

3. USER adds to cart
   → localStorage 'drip_street_cart' (kept as localStorage key for backward compat)
   → Telegram 🛍 Added to Cart alert

4. USER enters checkout
   → PayPal SDK creates order
   → Backend /api/paypal/create-order
   → Telegram 💳 Checkout Started alert

5. USER completes payment
   → PayPal webhook → /api/paypal/capture-order
   → Backend: processPaidOrderFulfillment()
   → If apparel: Printify createOrder() with jono-order-{id} external ID
   → If jewelry: CJ Dropshipping createOrderV2()
   → Resend confirmation email
   → Telegram ✅ Order Completed + profit calc

6. Daily 20:00 IST
   → telegram.js sendDailyReport()
   → Shows: Human traffic, Revenue, COGS, Profit, Top products, Insights
```

---

## 13. WHAT OWNER MEANS BY "GO BACKWARDS"

The JOAKIM→JONO rebrand (PR #22) introduced a regression chain:
1. PR #22 renamed logo file references but missed the `src=` JSX attributes
2. commit 7fade0b created jono-*.png assets as WRONG copies (shirt image as logo)
3. commit 54e682d replaced D logo with shirt image → broken/wrong image in header
4. commit 888714f FIXED all of this: replaced image with text logo (JonoLogo.jsx)

**Key insight:** The store NEVER had a proper JONO logo file.
`logo-new.png` = the Drip Street metallic "D" logo (276KB) — this is the only real logo file.
A new JONO logo (PNG/SVG) would need to be created and provided by the owner.

---

## 14. RECOMMENDATIONS (PRIORITY ORDER)

1. **URGENT: Remove dripstreetshop.com from Vercel** (legal risk)
   → Vercel Dashboard → Settings → Domains → Remove dripstreetshop.com + www
   
2. **HIGH: Fix NECK_LABEL_SOURCE_URL on Render**
   → Set env var: `NECK_LABEL_SOURCE_URL=https://raw.githubusercontent.com/yohananpr11-ux/custom-ecommerce/main/frontend/public/jono-favicon.png`
   Or better: upload a real JONO neck label image to Printify and set PRINTIFY_NECK_LABEL_IMAGE_ID

3. **HIGH: Verify 5 CVC products live in Printify**
   → With PRINTIFY_API_TOKEN, GET /v1/shops/27495153/products.json
   → If products 12-16 not there, create via design-pipeline.js

4. **MEDIUM: Create real JONO logo**
   → Owner needs to provide a JONO logo (SVG or transparent PNG)
   → Place in frontend/public/jono-logo.svg (or .png)
   → Update JonoLogo.jsx to use image if file exists, fallback to text

5. **MEDIUM: Upgrade Render plan**
   → Free plan causes RAM 97%, crashes, double-instance heartbeat issues
   → Starter: $7/month → dedicated instance, no sleep, stable

6. **LOW: Fix meni.js SYSTEM_INSTRUCTION**
   → Still says "Drip Street" in AI persona
   → Update to JONO brand voice

7. **LOW: Fix remaining dripstreetshop.com in index.js**
   → Line 2166: `publicUrl: 'https://dripstreetshop.com/product/${id}'`
   → Update to shopjono.com

---

*Report generated by Copilot CTO Agent — 2026-08-07 17:35 IST*
*Commit at time of report: 888714f (main branch)*
*All 6 untracked audit files untouched.*
