# PROJECT ARCHITECTURE AND SYSTEM MAP — JONO Store
# Full Architecture, Suppliers, Integrations, and Data Flow

---

## 🗺️ OVERVIEW — WHAT THIS PROJECT IS

JONO is a direct-to-consumer fashion brand.
It is built on a **fully custom e-commerce stack** (Node.js/Express backend, React/Vite frontend) selling:
1. **Apparel** (Print-on-Demand via Printify) — Heavyweight tees (Comfort Colors 1717) and CVC tees (Bella+Canvas 3001CVC)
2. **Jewelry** (Curated catalog drops) — Stainless steel hardware and chains

The live production store is hosted at **https://shopjono.com** / **https://www.shopjono.com**.

---

## 1. REPOSITORY & ENVIRONMENTS

### Primary Repository
| Field | Value |
|---|---|
| URL | https://github.com/yohananpr11-ux/custom-ecommerce.git |
| Remote | origin |
| Default branch | main |

### Environments
- **Frontend**: Deployed on Vercel (`https://shopjono.com`, `https://www.shopjono.com`).
- **Backend API**: Deployed on Render (`https://custom-ecommerce-qp30.onrender.com`).
- **Database**: Embedded SQLite (`backend/ecommerce.db`) with automatic additive migrations via `db.readyPromise`.

---

## 2. SYSTEM ARCHITECTURE & INTEGRATIONS

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             FRONTEND (React + Vite)                              │
│              https://shopjono.com · Prerendered HTML · Tailwind-free CSS         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ HTTPS API Requests
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Node.js / Express)                         │
│       CORS: shopjono.com · Rate Limiting · Bot Detection · Order Validation      │
└────────────┬───────────────────────────┬───────────────────────────┬─────────────┘
             │                           │                           │
             ▼                           ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│     PAYMENT ENGINE      │ │   FULFILLMENT ENGINE    │ │    OPERATIONAL ALERTS   │
│  PayPal Standard & SPB  │ │ Printify POD Integration│ │ Telegram Real-Time Bot  │
│  Stripe / PayPlus (alt) │ │ Webhook Ingestion       │ │ Daily 22:00 Owner Report│
└─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘
```

### Key Integrations

#### 1. Printify (Print-on-Demand Apparel)
- **Shop ID**: 27495153
- **API Base**: `https://api.printify.com/v1`
- **Auth**: `PRINTIFY_API_TOKEN` (Render env secret)
- **Catalog Blueprints**: Blueprint 706 (Comfort Colors 1717), Blueprint 3013 (Bella+Canvas 3001CVC)
- **Sync & Webhooks**: Automatic product sync, variant availability caching (2-min TTL), order routing via `jono-order-{id}`

#### 2. PayPal (Primary Payments)
- **Mode**: Live (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`)
- **SDK**: `@paypal/react-paypal-js`
- **Endpoints**: `/api/paypal/create-order` and `/api/paypal/capture-order`
- **Security**: Server-side total recalculation, variant existence verification, inventory checks before capture

#### 3. Telegram Bot & Telemetry
- **Bot Token / Owner Chat**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`
- **Events**: Real-time alerts for human visits, checkout initiation, paid orders, fulfillment updates, and critical system errors
- **Daily Owner Report**: Automated 22:00 Jerusalem owner report with traffic breakdown, conversion metrics, revenue, and health telemetry

#### 4. Security & Admin Authentication
- **Auth**: Constant-time comparison (`timingSafeEqual`) on `X-Admin-Secret` header matching `JONO_ADMIN_SECRET`
- **Protection**: Gated endpoints for catalog sync, pricing refreshes, admin reports, and coupon management

---

## 3. ORDER LIFECYCLE DATA FLOW

```
1. VISITOR lands on https://shopjono.com
   → First-party telemetry records session
   → If human visitor: Telegram 👤 Human Session alert

2. VISITOR configures product & adds to cart
   → Frontend state persists in localStorage ('jono_cart')
   → Telemetry records Cart Add event

3. CHECKOUT initiated
   → Backend /api/paypal/create-order validates cart items against SQLite
   → Telegram 💳 Checkout Started alert

4. PAYMENT captured
   → Backend /api/paypal/capture-order captures PayPal order
   → Atomic paid transition sets orders.paid_at and updates status
   → Fulfillment engine routes apparel order to Printify API
   → Telegram 🎉 Paid Order alert sent with profit & item breakdown

5. DAILY RECAP
   → At 22:00 Jerusalem time: daily-owner-report compiles authoritative metrics
   → Single-run CAS fence ensures exactly-once delivery to owner Telegram
```

---

## 4. DIRECTORY LAYOUT

```
custom-ecommerce/
├── backend/
│   ├── index.js                      ← Main Express API & route registry
│   ├── db.js                         ← SQLite connection & schema migrations
│   ├── routes/                       ← Telemetry, admin, feeds, dev routes
│   ├── services/
│   │   ├── daily-owner-report.js     ← 22:00 Jerusalem owner reporting engine
│   │   ├── visitor-telemetry.js      ← Human session attribution & classification
│   │   ├── printify.js               ← Printify API client & sync engine
│   │   ├── fulfillment.js            ← Order routing & fulfillment recovery
│   │   ├── telegram.js               ← Telegram bot notification client
│   │   ├── emailService.js           ← Resend transactional email client
│   │   └── pricing.js                ← Price calculation & margin engine
│   └── tests/                        ← Node:test automated test suite
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                   ← React application router & state
│   │   ├── components/               ← Header, Footer, JonoLogo, Navigation
│   │   ├── pages/                    ← Storefront PDP, Legal pages, Contact
│   │   └── utils/                    ← Analytics & client-side helpers
│   ├── scripts/
│   │   ├── generate-sitemap.cjs      ← Sitemap builder
│   │   └── prerender-products.cjs    ← Static HTML prerender engine
│   └── public/                       ← Static assets, sitemap.xml, robots.txt
└── docs/
    └── operations/                   ← Operational runbooks & recovery guides
```
