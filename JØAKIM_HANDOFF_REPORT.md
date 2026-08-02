# JØAKIM — דוח העברה מלא (CTO / Product Manager Handoff)

**תאריך ושעת הבדיקה:** 2026-08-02, 15:44 (שעון מקומי, Windows)
**הנתיב שנבדק:** `C:\Users\yohan\.gemini\antigravity-ide\scratch\custom-ecommerce` (זהו נתיב הקוד האמיתי של JØAKIM — ראו הערת זיהוי בחלק 1)
**Branch פעיל בזמן הבדיקה:** `stabilize/payments-p0`
**Commit נוכחי (HEAD):** `74a92146b560590a3d38fbf8051e42b29bc47d05` (2026-06-04) — **ישן משמעותית מ-`origin/main`**, ראו חלק 1.3
**היקף הגישה שהיה זמין:** קריאה מלאה של מערכת הקבצים המקומית (כולל Git history, reflog, stash, diff), הרצת פקודות Git שאינן משנות מצב, בדיקת HTTP חיצונית (curl, ללא שינוי מצב) לדומיינים הרלוונטיים, ובדיקת GitHub PRs דרך `gh` CLI (קריאה בלבד). **אין** גישה ל-Shopify Admin, ל-Render/Vercel dashboards, ל-Telegram, ל-Google Analytics/Meta/TikTok dashboards, או לכל מערכת חיצונית אחרת מעבר לקוד ול-Git.
**מגבלות הבדיקה:** הפרויקט **אינו Shopify** — הוא חנות React+Node עצמאית (ראו חלק 5). חלקים מהתבנית המבוקשת שמתייחסים ל-Shopify Theme/Liquid/Sections אינם רלוונטיים ומסומנים ככאלה במפורש. כמו כן, לא הייתה גישה לנתוני מסחר/טראפיק אמיתיים (Part 7) — כל מה שלא ניתן לאימות מסומן `לא ידוע`.
**הצהרת אי-שינוי:** לא בוצע שום שינוי בקוד, בקונפיגורציה, ב-Git state (לא commit, לא push, לא checkout, לא stash), בשירותים חיצוניים, או בתשתית. הפעולה היחידה שבוצעה מעבר לקריאה היא **יצירת קובץ הדוח הזה** בתיקיית `custom-ecommerce` (קובץ חדש, לא דרס שום קובץ קיים — נבדק מראש שאינו קיים).

---

## הערת זיהוי קריטית: איזו תיקייה היא "JØAKIM"?

תיקיית העבודה שממנה הופעלה השיחה הזו (`C:\Users\yohan\dripstreet-payment-server`) **אינה** קוד הפרויקט האמיתי. נבדק ישירות (`git status` → `fatal: not a git repository`): זו תיקיית שרידים יתומה, לא Git repo כלל, עם `package.json` בודד (תלויות `braintree`, `express`, `cors`, `dotenv`) וקובץ אחד ב-`backend/query_clicks.js`. לא נעשה בה שום שינוי מעבר לרשימת תוכן (read-only). **מסקנה סבירה:** ניסיון עבר להתחיל מיקרו-שירות Braintree נפרד שמעולם לא הבשיל, ולא קשור לחנות הפעילה.

הקוד האמיתי, המנוהל ב-Git, המחובר ל-production בפועל (Vercel + Render, שניהם מאומתים כ-**חיים** בבדיקת HTTP ישירה בזמן כתיבת הדוח — ראו חלק 1.9), נמצא ב:
`C:\Users\yohan\.gemini\antigravity-ide\scratch\custom-ecommerce`

כל הבדיקה, כל הראיות וכל הדוח הזה מתייחסים לנתיב הזה בלבד. תיקייה נוספת בשם `MENI_CORE` (`C:\Users\yohan\OneDrive\שולחן העבודה\MENI_CORE`) **לא נבדקה בכלל ולא נגעתי בה** — היא מזוהה כמשאב חיצוני/משותף שאינו בלעדי ל-JØAKIM (יש לה גם קישוריות קוד אמיתית מתועדת בחלק 1.12 — `backend/services/telegram.js` קורא ממנה fallback בייצור — אך תוכנה לא נבדק, בהתאם לכלל הבידוד).

---

## חלק 1 — זיהוי סביבת הפרויקט

### 1.1 נתיב מלא
`C:\Users\yohan\.gemini\antigravity-ide\scratch\custom-ecommerce` — **מאומת**.

### 1.2 Repository
שם: `custom-ecommerce`. אין monorepo נפרד ל-frontend/backend — שניהם תחת אותו Git repo, בתיקיות `frontend/` ו-`backend/`. **מאומת**.

### 1.3 כתובת remote
```
origin  https://github.com/yohananpr11-ux/custom-ecommerce.git
```
**מאומת** (`git remote -v`). ללא פרטי הזדהות מוצגים.

### 1.4 Branch פעיל
`stabilize/payments-p0`. **מאומת** (`git branch --show-current`).

**ממצא קריטי שחייב להיות ברור לסוכן הבא:** ה-HEAD המקומי של branch זה (`74a9214`, מתאריך 2026-06-04) **נמצא הרחק מאחורי** `origin/main` (טיפ נוכחי: `61a857f`, מתאריך 2026-07-26). הפער: **58 קבצים, כ-14,000 שורות (+13,976 / -1,102), ~20 commits / 9 Pull Requests שלמים** שכבר במיזוג ב-production (`origin/main`) ואינם קיימים בעץ העבודה המקומי הזה. **מאומת** (`git diff --stat 74a9214 origin/main`, `git log 74a9214..origin/main`).

המשמעות: מה שרואים כרגע בדיסק **אינו** הקוד שרץ כרגע ב-production. ה-production האמיתי (Render+Vercel) מריץ את מה שממוזג ב-`origin/main`. עץ העבודה המקומי הוא "אי" נפרד עם עבודה שלא הגיעה ל-Git כלל.

### 1.5 רשימת branches רלוונטיים ותפקידם

**Local branches (מאומת, `git branch -a`):**
| Branch | תפקיד (מסקנה סבירה מהשם/מה-log) |
|---|---|
| `main` | זהה ל-HEAD הנוכחי (`74a9214`) — **גם הוא ישן, לא עודכן מ-origin/main** |
| `stabilize/payments-p0` **(נוכחי)** | Branch עבודה על ייצוב תשלומים P0 — אך מכיל כרגע עבודת rebrand לא-קשורה שלא בוצע לה commit (ראו 1.7) |
| `stabilize/payments-p0-clean` | כנראה גרסה "נקייה" מקבילה של אותה עבודה |
| `backup-before-i18n-removal` | גיבוי לפני הסרת i18n |
| `backup/payments-p0-clean-pre-reorder` | גיבוי לפני ריאורגניזציה |
| `english-only-release` | ניסיון release באנגלית בלבד |
| `feature/antigravity-ui-redesign` | **PR #2, פתוח מאז 2026-06-06, מעולם לא מוזג (~57 ימים)** — ראו חלק 6, ממצא #11 |
| `fix/phase-9-mobile-responsiveness` | תיקוני mobile |
| `fix/phase-9-polish` | ליטוש UI |

**Remote-only branches (origin, כבר ממוזגים ברובם ל-main):** `feat/cors-shopjoakim-domain` (PR#13), `feat/paypal-standard-card-button` (PR#12), `fix/paid-order-e2e-readiness` (PR#8), `fix/paypal-silent-cancel-observability` (PR#11), `fix/printify-auth-p0` (PR#6), `fix/safe-manual-payment-test-product` (PR#9), `fix/shipping-exempt-manual-test-product-25` (PR#10), `fix/startup-safety-observability` (PR#7), `feat/automation/printify-pipeline`, `stabilize/payments-p0-clean`.

**רשימת Pull Requests מלאה (מאומת דרך `gh pr list --state all`):**
| # | כותרת | Branch | סטטוס | תאריך |
|---|---|---|---|---|
| 13 | Add shopjoakim.com to production CORS allowlist | feat/cors-shopjoakim-domain | MERGED | 2026-07-26 |
| 12 | Add PayPal Standard credit/debit card payment option | feat/paypal-standard-card-button | MERGED | 2026-07-25 |
| 11 | Fix silent PayPal popup closure on product 25 | fix/paypal-silent-cancel-observability | MERGED | 2026-07-25 |
| 10 | strictly scoped shipping exemption for hidden test product id=25 | fix/shipping-exempt-manual-test-product-25 | MERGED | 2026-07-25 |
| 9 | isolated manual product path for payment testing | fix/safe-manual-payment-test-product | MERGED | 2026-07-22 |
| 8 | prove paid-order end-to-end readiness | fix/paid-order-e2e-readiness | MERGED | 2026-07-22 |
| 7 | stabilize startup data and runtime observability | fix/startup-safety-observability | MERGED | 2026-07-21 |
| 6 | make Printify fulfillment durable and idempotent | fix/printify-auth-p0 | MERGED | 2026-07-21 |
| 5 | Stabilize P0 payments with hermetic CI verification | stabilize/payments-p0-clean | MERGED | 2026-07-19 |
| 2 | Drip Street full redesign — CSS grid header, PDP hardening, hardware products | feature/antigravity-ui-redesign | **OPEN** | 2026-06-06 |
| 1 | CSS grid centering + PDP defensive handling | fix/navbar-pdp-2026-06-06 | MERGED | 2026-06-06 |

PR #3, #4 אינם קיימים (נבדק דרך `gh pr view` — "Could not resolve to a PullRequest"). **מאומת.**

### 1.6 Worktrees
לא נמצאו Git worktrees נוספים הקשורים ל-JØAKIM (`.git` תקני יחיד, ללא `.git/worktrees` פעילים שנבדקו). **מאומת** ברמת בדיקת מבנה הקובץ.

### 1.7 מצב Git נוכחי — מפורט

**קבצים ב-staging (יבוצע להם commit אם ירוץ `git commit`):** 14 קבצים, כולל `backend/db.js`, `backend/index.js`, `backend/patch_catalog_images.cjs`, `backend/seed_cj_product.cjs`, `backend/services/pricing.js`, `backend/services/printify.js`, `frontend/package.json`/`package-lock.json`, `frontend/src/App.jsx`, `frontend/src/index.css`, ודפי מדיניות (`RefundPolicy.jsx`, `Shipping.jsx`, `ShippingPolicy.jsx`, `TermsOfService.jsx`).

**שינויים לא-staged (unstaged):** 14 קבצים נוספים, כולל **מחיקה** של `backend/controllers/paymentController.js` ו-`backend/routes/paymentRoutes.js` (377+24 שורות) — כנראה ניסיון מקומי לאחד את לוגיקת התשלומים לתוך `index.js`, **עבודה מקבילה ובלתי-תלויה** לאותו סוג שינוי שכבר קרה ב-`origin/main` (שם גם נמחקו אותם קבצים, כחלק מ-PR מוקדם יותר). שני המאמצים לא זהים בהכרח — נדרש דיאף ידני להשוואה, **לא בוצע כאן** (מחוץ להיקף read-only פשוט).

**קבצים חדשים ללא מעקב (untracked, ~40 פריטים) — המשמעותיים ביותר:**
- `docs/` (תיקייה שלמה, כולל `Drip-Street-Store-Audit-Report.md` מ-2026-06-07 — דוח ביקורת קודם, ראו סיכום בחלק 3)
- 14 קבצי לוגו/וורדמארק/פאביקון של **JØAKIM** תחת `frontend/public/` (`joakim-logo.png`, `joakim-wordmark-dark.png`, `joakim-og.png` וכו') — קבצים אמיתיים בגדלים משמעותיים (עשרות עד מאות KB, לא placeholders ריקים), אך **חלקם זהים בגודל בייטים בדיוק** (למשל `joakim-logo.png`/`joakim-approved-full-logo.png`/`joakim-logo-full-light.png` — כולם 41,927 בייטים) — ייתכן שיש כפילויות.
- `frontend/src/config/supplierPolicies.js` — מודול מדיניות משלוחים/החזרות דו-לשוני חדש, **מתנגש במספרים** עם דף המדיניות החי (ראו חלק 4 וחלק 6, ממצא #3).
- `frontend/src/utils/intelligence.js` — מנוע פרסונליזציה התנהגותית בצד לקוח (localStorage), לא ברור אם מחובר בפועל ל-UI.
- `backend/scripts/verify-admin-auth.js`, `backend/scripts/verify-p0-payment-security.js` — סקריפטי בדיקה עצמאיים (self-contained, לא נוגעים ב-production).
- `backend/tests/fulfillment-concurrency.test.js`, `backend/tests/paypal-capture-validation.test.js` — קבצי טסט.
- `frontend/public/catalog-fallback.json` + `frontend/scripts/generate-catalog-fallback.cjs` — מנגנון fallback קטלוג חדש לבנייה.
- `frontend/public/bracelet.png`, `chain.png`, `hero-bg.jpg`, `hero-model.png`, `ds-icon-a/b/c.svg` — נכסי עיצוב נוספים.
- קבצי root מוזרים: `check-lines.js`, `search-coupon-handling.js`, `search-frontend.js`, `search-paypal-create.js`, `validate-drip-street.cjs` — כולם סקריפטי debug חד-פעמיים זניחים (נבדקו, לא חלק מהאפליקציה). וגם קובץ בשם `git` בגודל **0 בייט** בשורש הריפו — כנראה תוצר לוואי מקרי של הפניית shell שגויה, לא מכוון.

**Commits מקומיים שלא הועלו (unpushed):** ה-branch `stabilize/payments-p0` המקומי זהה ל-`origin`'s HEAD מבחינת commits (`74a9214` בשניהם) — **אין commits מקומיים "מקדימים"**, הבעיה היא הפוכה: יש **שינויים לא-committed בכלל**, לא commits לא-pushed. `git stash list` מראה 4 stashes ישנים (מ-branch `fix/navbar-pdp-2026-06-06` ו-`english-only-release`) שלא נוגעים לעבודה הנוכחית.

**מסקנה סבירה חשובה להעברה:** מישהו (המשתמש או agent קודם) עבד סשן שלם — עיצוב מחדש למותג JØAKIM, מחיקת payment controller ישן, קונפיג מדיניות ספקים חדש — **על בסיס commit ישן בכ-2 חודשים**, ומעולם לא ביצע לו commit או push. העבודה הזו קיימת **רק על הדיסק המקומי הזה**. אין לה גיבוי ב-Git כלל. `לא ידוע`: מדוע לא בוצע commit; האם המשתמש מודע לפער מול origin/main; האם יש כוונה למזג את זה בחזרה.

### 1.8 טכנולוגיות וגרסאות

| רכיב | גרסה/פרט | מקור |
|---|---|---|
| Frontend framework | React `^19.2.6`, react-dom `^19.2.6` | `frontend/package.json` |
| Routing | react-router-dom `^7.15.1` | frontend/package.json |
| Build tool | Vite `^8.0.12` | frontend/package.json (devDependencies) |
| UI/motion | Framer Motion `^12.38.0`, react-helmet-async `^3.0.0` | frontend/package.json |
| תשלומים (frontend) | `@paypal/react-paypal-js ^9.2.0` | frontend/package.json |
| בדיקות E2E | Playwright `^1.60.0` | frontend/package.json |
| Backend runtime | Node.js — **מוצמד ל-`24.14.1`** ב-`origin/main`'s `backend/package.json` (`engines.node`); **בעץ העבודה המקומי אין הצמדה כלל** (עוד פער בין המקומי ל-origin/main) | git show origin/main:backend/package.json |
| Backend framework | Express `^5.2.1` | backend/package.json |
| DB | SQLite3 `^6.0.1` (קובץ מקומי `backend/ecommerce.db`) | backend/package.json + ls |
| שירותים נוספים (backend deps) | axios, cloudinary `^2.10.0`, sharp `^0.34.5`, resend `^6.12.3`, node-cron `^4.2.1`, **stripe `^22.1.1`** (מותקן אך מנוטרל בקוד — ראו חלק 3) | backend/package.json |
| שפת Liquid/Shopify Theme | **לא רלוונטי — אין Shopify** | ראו חלק 5 |
| CI | GitHub Actions, `.github/workflows/p0-verify.yml` (489 שורות, קיים רק ב-`origin/main`, **חסר בעץ העבודה המקומי** כי הוא נוסף אחרי ה-commit הישן שעליו יושב ה-HEAD המקומי) | git show origin/main |

### 1.9 פקודות התקנה/הרצה/בדיקה/deployment ידועות

- **Backend:** `npm install`, `npm start` (=`node index.js`, עם `prestart` שמריץ מיגרציה — `npm run migrate` → `scripts/migrate-order-items.js`), `npm run load:test` (סימולציית עומס). **`npm test` הוא stub לא ממומש** (`echo "Error: no test specified" && exit 1`) — למרות עשרות קבצי טסט אמיתיים תחת `backend/tests/` ב-`origin/main` (ראו חלק 6, ממצא #7).
- **Frontend build (מורכב, רב-שלבי):** `node scripts/generate-catalog-fallback.cjs && node scripts/generate-sitemap.cjs && vite build && node scripts/prerender-products.cjs && node scripts/generate-sitemap.cjs && node scripts/validate-seo.cjs` — שים לב: `generate-sitemap.cjs` רץ **פעמיים**, ו-`validate-seo.cjs` רץ אחרון ו**יכול להפיל את כל ה-build** (ראו חלק 6, ממצא #4).
- **Frontend E2E:** `npm run test:e2e` (Playwright), `npm run test:e2e:report`.
- **Deployment:** Push ל-`origin/main` → Vercel בונה אוטומטית את ה-frontend (זוהה דרך `vercel.json` המכיל rewrite-only config, ללא build command מפורש — כנראה auto-detect); Render בונה את ה-backend דרך `render.yaml` (`buildCommand: npm install`, `startCommand: node index.js`) — **הערה:** `startCommand` הישיר עוקף כנראה את ה-`prestart` hook של `npm start`; לא אומת אם Render בפועל מריץ `npm start` או את הפקודה הגולמית. `דורש אימות`.
- **בדיקה HTTP חיה שביצעתי (read-only, curl בלבד):**
  - `https://dripstreetshop.com` → **HTTP 200** (מפנה ל-`https://www.dripstreetshop.com/`) — **החנות חיה כרגע**. **מאומת**.
  - `https://shopjoakim.com` ו-`https://www.shopjoakim.com` → **HTTP 000 (לא נענה/לא resolves)** — הדומיין החדש **נרכש אך עדיין לא מחובר ל-DNS**, תואם להערת קוד ב-`origin/main`'s `backend/index.js` (סביבות שורה 285-288) שאומרת במפורש "purchased 2026-07-26, not yet connected to Vercel/DNS". **מאומת**.
  - `https://custom-ecommerce-qp30.onrender.com/api/products` → **HTTP 200** — ה-backend חי. **מאומת**.

### 1.10 Ports
פיתוח מקומי בלבד: backend ברירת מחדל `PORT=4000` (מ-`.env.example`/docs), frontend Vite dev על `5173`, preview על `4173` (מוזכר גם ב-`playwright.config.js` וגם ב-CORS allowlist). **נבדק בזמן כתיבת הדוח** — אין כרגע תהליכים מאזינים על 4000/5173/4173 במחשב הזה (netstat, read-only) — כלומר אין שרת מקומי פעיל כרגע. אין Ports ב-production (Render/Vercel מנהלים זאת פנימית).

### 1.11 שירותים חיצוניים מחוברים
PayPal (Live — תשלומים), Printify (POD אפרל), CJ Dropshipping (תכשיטים/hardware), Telegram Bot API (התראות תפעוליות + בוט אדמין), Resend (מייל טרנזקציוני), Cloudinary (pipeline מוקאפים מותאמים אישית), Google Gemini API (צ'אטבוט "Meni", אופציונלי), Google Analytics 4 / Meta Pixel / TikTok Pixel (אנליטיקס, מותנה env), Stripe (SDK מותקן, **מנוטרל בקוד**), PayPlus (מותקן חלקית, **לא פעיל בפועל** — `PAYPLUS_PAGE_UID` לא מוגדר), ipapi.co (fallback גיאולוקיישן), open.er-api.com (שער חליפין יומי). **פרוט מלא + סטטוס פעילות בחלק 2 ו-3.**

### 1.12 משתני סביבה נדרשים (שמות בלבד, ללא ערכים)

**`backend/.env.example` (זהה בעץ העבודה וב-`origin/main`):**
`PORT`, `TARGET_PROFIT_MARGIN`, `FRONTEND_BASE_URL`, `API_BASE_URL`, `CORS_ALLOWED_ORIGINS`, `ENABLE_PRINTIFY_SYNC`, `PRINTIFY_API_TOKEN`, `PRINTIFY_SHOP_ID`, `PRINTIFY_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPLUS_API_KEY`, `RESEND_API_KEY`, `BRAND_LOGO_URL`, `IPAPI_KEY`, `DRIP_ADMIN_SECRET` (הערה בקוד: **חייב להתאים לערך המקביל ב-MENI_CORE** — תלות תפעולית אמיתית במערכת החיצונית שאסור לנו לגעת בה), `CLOUDINARY_URL`, `MOCKUP_TEMPLATE_FRONT_BACKGROUND/SHADOWS/HIGHLIGHTS`, `MOCKUP_TEMPLATE_BACK_*` (6 משתנים), `MOCKUP_FRONT_GEOMETRY_JSON`, `MOCKUP_BACK_GEOMETRY_JSON`.

**`frontend/.env.example`:** `VITE_API_BASE_URL`, `VITE_PAYPAL_CLIENT_ID`, `VITE_GA4_ID`, `VITE_META_PIXEL_ID`, `VITE_TIKTOK_PIXEL_ID`, `VITE_ABANDONED_CART_DELAY_MS`. כל אחד מהם בשימוש בפועל בקוד — אין פערים בצד frontend.

**⚠️ פער קריטי בצד backend — משתנים בשימוש בקוד אך חסרים לגמרי מ-`.env.example` (ומ-`render.yaml`):**
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`/`PAYPAL_SECRET` (**זו שיטת התשלום היחידה הפעילה בפועל!**), `CJ_API_KEY`, `GEMINI_API_KEY`, `MARKETING_SECRET`, `PAYPLUS_SECRET_KEY`, `PAYPLUS_PAGE_UID`, `FROM_EMAIL`, `UNSUBSCRIBE_SECRET` (**נופל בחזרה ל-string קשיח אם לא מוגדר — חולשת אבטחה קלה, ראו חלק 6 ממצא #6**), `RESEND_WEBHOOK_SECRET`, `AUTO_PRICE_UPDATE_THRESHOLD_PCT`, `PAYMENT_FEE_RATE`, `TELEGRAM_ALLOWED_USER_IDS`, `MENI_CORE_ENV_PATH`/`MENI_CORE_PATH` (תלות מתועדת בקוד ב-MENI_CORE). ראו חלק 6 ממצא #5 לפירוט השלכות.

---

## חלק 2 — מבנה המערכת

**הערה חשובה: הפרויקט אינו Shopify.** אין Theme, אין Liquid, אין Sections/Snippets/Templates/Locales בסגנון Shopify. זו אפליקציית **React SPA** (frontend) + **Express API** (backend) עצמאית לחלוטין, עם SQLite כבסיס נתונים. המיפוי הבא הוא האנלוגיה הרלוונטית בפועל.

### מבנה תיקיות מרכזי
```
custom-ecommerce/
├── backend/            Express API, SQLite, אינטגרציות
│   ├── index.js        קובץ ראשי ענק (~143KB מקומי, גדול יותר ב-origin/main) — רוב ה-routes, PayPal, גיאולוקיישן
│   ├── db.js            סכמה/מיגרציות SQLite
│   ├── controllers/     (רוקן — paymentController.js נמחק בעץ העבודה)
│   ├── routes/          feeds.js, marketing-webhooks.js, admin-reports.js, dev.js, carts.js
│   ├── services/        printify.js, dropship.js, pricing.js, emailService.js, telegram.js, meni.js,
│   │                     design-pipeline.js, fulfillment.js, fulfillment-recovery.js (origin/main בלבד)
│   ├── lib/              paypal-capture-validation.js (origin/main בלבד)
│   ├── scripts/          מיגרציות, verify/smoke scripts, harnesses
│   ├── tests/            עשרות קבצי node:test (origin/main בלבד, לא רצים דרך npm test — ראו חלק 6)
│   └── data/             products_seed.json, product-copy-updates.json
├── frontend/
│   ├── src/App.jsx      קובץ ענק (225KB) — רוב הדפים/הרכיבים בפועל חיים כאן inline
│   ├── src/index.css    135KB, CSS ידני (לא Tailwind — מתועד גם ב-DRIP_STREET_System_Report.md)
│   ├── src/pages/       About/AboutUs, Terms/TermsOfService, RefundPolicy, Shipping/ShippingPolicy,
│   │                     PrivacyPolicy, ContactUs (ראו "קבצים מתים" למטה)
│   ├── src/components/  Footer, MobileNav, CookieConsent, BackButton, LegalPageLayout
│   ├── src/config/       supplierPolicies.js (untracked, חדש)
│   ├── src/utils/        analytics.js (פיקסלים), intelligence.js (untracked, פרסונליזציה)
│   └── scripts/          generate-sitemap.cjs, prerender-products.cjs, validate-seo.cjs, generate-catalog-fallback.cjs
├── docs/                 Drip-Street-Store-Audit-Report.md (untracked)
├── render.yaml
└── DRIP_STREET_System_Report.md   (דוח ארכיטקטורה קודם, tracked)
```

### קבצי כניסה וקונפיגורציה
Frontend entry: `frontend/src/main.jsx` → `App.jsx`. Backend entry: `backend/index.js`. Build config: `frontend/vite.config.js`, `frontend/vercel.json` (SPA rewrite בלבד — `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`, ללא build command מוצהר), `render.yaml` בשורש (שירות `custom-ecommerce-backend`, `rootDir: backend`, `plan: free`).

### רכיבי UI מרכזיים ומצבם

| רכיב | מיקום | מטרה | מצב |
|---|---|---|---|
| קטלוג/גריד מוצרים | App.jsx (inline) | הצגת מוצרים, hover אפקט גרייסקייל→צבע | פעיל |
| עמוד מוצר (PDP) | App.jsx (inline) | וריאנטים, צבע/מידה, גלריה | פעיל, עם ולידציה כפולה (client+server) |
| Quick-add modal | App.jsx (inline) | הוספה מהירה מהקטלוג בלי לעזוב את הדף | פעיל |
| עגלה / Cart drawer | App.jsx (inline) | + "You Might Also Like" cross-sell | פעיל |
| כפתורי תשלום PayPal | App.jsx + `paypalFlowHelpers.js` (origin/main) | wallet + card funding, נעילת concurrency בין שני הכפתורים | פעיל, נבדק ע"י E2E |
| Header/Nav | App.jsx + `MobileNav.jsx` | ניווט דסקטופ/מובייל | פעיל; announcement bar — `לא ידוע/דורש אימות` (לא אותר בבירור) |
| Footer | `Footer.jsx` (14KB) | קרוס-סייל, ניוזלטר, קישורי משפט | פעיל |
| Popup לכידת לידים | App.jsx (inline) | הופעה אחרי 5 שניות/exit-intent, הנחת 10% | פעיל |
| Search | `לא אותר בבירור בסקירה זו` | — | `דורש אימות` |
| Account/התחברות | לא נמצאה עדות למערכת משתמשים/login | — | **נראה שלא קיים כלל** — `מסקנה סבירה` |
| Checkout | אין עמוד checkout נפרד — מתבצע inline דרך כפתורי PayPal בעגלה/PDP | תקין לזרימת PayPal Buttons סטנדרטית | פעיל |

### מערכת העיצוב
פלטה כהה/מט (matte-black), טיפוגרפיה high-contrast, מינימליזם streetwear פרימיום, אנימציות Framer Motion מרוסנות. **CSS ידני מלא** (`index.css`, 135KB) — לא Tailwind (מתועד מפורשות ב-`DRIP_STREET_System_Report.md`). Responsive: גריד מובייל 2 עמודות (עם בעיית "יתום" בשורה אחרונה עבור 5 מוצרי hardware — תועד בדוח ביקורת 2026-06-07, ראו חלק 3).

### דפי חנות קיימים (Live routes, מאומת מ-`App.jsx` imports/routes)
`/` (home), `/product/:id` (PDP), `/privacy`, `/terms`, `/refund`, `/shipping`, `/about`, ContactUs (נתיב מדויק לא אומת אך הקומפוננטה קיימת ובשימוש).

**⚠️ ממצא משמעותי — קבצי דפים "מתים" (untracked-routing, לא מגיעים אליהם משתמשים):**
`TermsOfService.jsx`, `ShippingPolicy.jsx`, `AboutUs.jsx` — קיימים בדיסק, **אך אף route לא מצביע אליהם** (רק ה-`export default` הפנימי שלהם עולה בגריפ, שום import חיצוני). התוכן שלהם דווקא **מפורט ומקצועי יותר** מהגרסאות החיות המקבילות (`Terms.jsx`, `Shipping.jsx`, `About.jsx`), אבל אף לקוח לא רואה אותו. פירוט תוכן בחלק 4.

### תהליכי build/preview/deployment
Frontend: pipeline רב-שלבי (ראו חלק 1.9) עם שני שערי כשל אפשריים — `validate-seo.cjs` (מצפה לדומיין `dripstreetshop.com` בלבד — יפיל build אם ישונה לפני עדכון הסקריפט, ראו חלק 6 #4) ו-vite build עצמו. Backend: אין build step (Node ישיר). Deployment אוטומטי בפועל: Push ל-`main` → Vercel + Render (מאומת ע"י ה-domain check החי).

### אפליקציות/API חיצוניים שהקוד תלוי בהם
אין Shopify Apps. השקילות בפועל: Printify API (מוצרים+fulfillment), CJ Dropshipping API (fulfillment תכשיטים), PayPal REST API (תשלומים), Resend API (מייל), Cloudinary API (עיבוד תמונות מוקאפ), Telegram Bot API, Google Gemini API (צ'אט), ipapi.co (גיאולוקיישן fallback), open.er-api.com (שער חליפין).

---

## חלק 3 — היסטוריית הפעולות (ציר זמן)

כל הפריטים הבאים **מאומתים** ישירות מ-`git log` (עם תאריכים), `gh pr list`, וזיכרון פרויקט קודם (מסומן בנפרד). דירוג ודאות מצוין בסוגריים.

**2026-05-15 — קומיט ראשוני.** `33b406f Initial commit for Custom E-commerce`, ואחריו באותו יום: הטמעת Stripe+PayPlus כזוג שערי תשלום, "Premium Frontend Upgrade" (Framer Motion, פילטרים, סנכרון Printify, מנוע תמחור 20%, קופוני Telegram), ליטוש מקצועי (עמודים משפטיים, Trust Footer, Skeletons, Error Boundaries, נגישות, טופס יצירת קשר). **מאומת** מ-git log. **מסקנה סבירה:** כל 5 הקומיטים הראשונים מתוארכים לאותו יום — כנראה ייבוא מרוכז של עבודת פיתוח קודמת ולא יום עבודה אחד ליטרלי.

**מאי–יוני 2026 — איטרציות UI/UX ותשתית.** שלבים מסומנים "Phase 3", "Phase 4", "4.1", "4.2", "6", "9" בהודעות commit; הוספת קטלוג CJ dropship (תכשיטים/hardware); ניסיון אינטגרציית **Meshulam** (webhook + frontend, commits `dff6761`/`998d1fc`) — **הוסר לגמרי מאוחר יותר** (מאומת בזיכרון פרויקט קודם: dripstreet-payment-gaps); בניית i18n (עברית/אנגלית + ILS/USD) ולאחר מכן חזרה חלקית ממנה (branches `backup-before-i18n-removal`, `english-only-release` קיימים כעדות); לוקליזציה של דיווחי Telegram לעברית; הוספת מעקב פיקסלים Meta+TikTok; הוספת טסט E2E ראשון ב-Playwright; מספר עיצובים מחדש ללוגו המותג (מ"מתכתי D" ועד ללוגואים הנוכחיים).

**2026-06-04 — נקודת הקיפאון של עץ העבודה הנוכחי.** קומיט אחרון על branch `stabilize/payments-p0`/`main` המקומי: `74a9214 feat: autonomous logo background removal and live payment flow verification`. זו הנקודה שממנה עץ העבודה הנוכחי (עם כל ה-uncommitted state) יוצא לדרך.

**2026-06-06 — PR #1 ממוזג, PR #2 נפתח.** PR#1 (תיקוני header/PDP) ממוזג. PR#2 ("Drip Street full redesign") **נפתח ונשאר פתוח עד היום** (~57 יום, ראו חלק 6 #11).

**2026-06-07 — ביקורת חנות מלאה (`docs/Drip-Street-Store-Audit-Report.md`, untracked).** תיעד 18 מוצרים פעילים (11 Printify + 6 CJ + 1 מוצר בדיקה), רווחים גולמיים בריאים, ומספר P0/P1 items (מוצר staging חשוף ללקוחות, תיאורי CJ אוטומטיים גנריים). **מאומת** מקריאת המסמך במלואו — ראו סיכום מלא בחלק 4.

**2026-07-12/13 — ביקורת תשלומים ראשונית (מזיכרון פרויקט קודם, לא אומת מחדש כאן).** אותרו פערים ב-Braintree/Meshulam/אחסון ephemeral — **נפתרו כולם עד 2026-07-25/26** (ראו למטה).

**2026-07-19 — PR #5 ממוזג.** CI הרמטי (`p0-verify.yml` נולד), התחלת עבודת הצמדת גרסת Node.

**2026-07-21 — PR #6 + PR #7 ממוזגים.** PR#6: Printify חזר 401 אמיתי ב-production, אותר שורש הבעיה (טוקן שמור פגום), שוחזר טוקן תקין, ונבנה **state machine עמיד ל-fulfillment** (lease-based, idempotent) שמחליף לוגיקה ישנה לא-בטוחה. PR#7 (אותו יום): בטיחות אתחול + observability, **הצמדת Node ל-24.14.1**, הסרת "purge" קטלוג לא-מכוון באתחול. **שני "מטלות עתידיות" שסומנו בזיכרון קודם כ-deferred נבדקו מחדש בדוח זה וכעת מאומתים כ-פתורים לחלוטין:** (1) פער גרסת Node בין CI (היה 20.20.2) ל-Render (24.14.1) — **פתור**, שניהם מוצמדים כעת ל-24.14.1 עם סקריפט `assert-node-engines-pin.cjs` ששומר מפני drift עתידי; (2) `DELETE FROM products WHERE type='local'` הלא-מותנה על כל אתחול — **פתור**, לא נמצא יותר ב-`db.js` של `origin/main`. הפריט השלישי (observability ל-Printify sync) **בוצע** דרך `fulfillment-recovery.js` וקומיט `6239dd8`.

**2026-07-22 — PR #8 ממוזג.** ייצוב הזמנות מקצה-לקצה: bookkeeping עמיד לתקלות אחרי claim תשלום, redaction של PII מלוגים תפעוליים, סגירת פער ב-webhook PayPlus, ותיקון sitemap.

**2026-07-22/23 — PR #9 ממוזג.** נבנה מנגנון **מוצר-בדיקה ידני חבוי**, מוגן טוקן, עם reservation מלאי אטומי — כדי לאפשר **בדיקת תשלום PayPal אמיתית ובודדת** בלי לחשוף מוצר אמיתי לציבור.

**2026-07-25 — PR #10, #11, #12 ממוזגים באותו יום.** PR#10: פטור משלוח מצומצם ומדויק (5 תנאים בו-זמנית) עבור מוצר הבדיקה id=25 בלבד. PR#11: **תיקון אמיתי לבאג משתמש-קצה** — סגירת סדק תזמון שגרם לסגירה שקטה של חלון הפופאפ PayPal (התגלה תוך כדי אותה בדיקת תשלום אמיתית). PR#12: הוספת אמצעי תשלום כרטיס-אשראי PayPal Standard לצד ה-wallet.

**2026-07-25/26 — החלטת מיגרציית דומיין (מזיכרון פרויקט קודם).** נקבע רצף: קניית דומיין JOAKIM עכשיו → השארת dripstreetshop.com חי → מעבר מתואם אחד (Vercel, CORS, מיתוג, SEO, מייל) לפני בדיקת תשלום אמיתית ולפני בדיקת "קופסה שחורה" של דולב → 301 redirect רק אחרי אימות מלא.

**2026-07-26 — PR #13 ממוזג (האחרון שממוזג ב-origin/main).** `shopjoakim.com` נוסף ל-allowlist של CORS ב-backend. **נבדק ישירות בזמן כתיבת דוח זה (2026-08-02): הדומיין עדיין לא resolves** (curl → HTTP 000) — כלומר עדיין לא חובר ל-DNS/Vercel, תואם בדיוק להערת קוד שאומרת "purchased 2026-07-26, not yet connected."

**מועד לא ידוע, בין 2026-06-04 ל-היום (קבצי mtime מתפזרים יוני–יולי) — עבודת rebrand+refactor שלא בוצע לה commit מעולם.** על גבי ה-branch המקומי `stabilize/payments-p0` (עדיין על ה-commit הישן `74a9214`): נוצרו 14 קבצי לוגו/וורדמארק JØAKIM, מודול `supplierPolicies.js` חדש, מנוע `intelligence.js`, סקריפטי אימות אדמין/תשלומים חדשים, ובוצעה מחיקה מקומית של `paymentController.js`/`paymentRoutes.js` + עריכות ל-`App.jsx`, `index.css`, `Footer.jsx`, ולדפי מדיניות. **מעולם לא בוצע commit או push לעבודה הזו.** זו **נקודת העצירה האחרונה בפועל** של הפרויקט — לא נתון בזיכרון קודם, אלא נצפה ישירות בבדיקת `git status` הנוכחית.

**2026-08-02 (היום) — בקשת דוח העברה זה.** נמצא הפער בין העץ המקומי ל-`origin/main`, וזוהה הצורך לתעד את מצב ה-WIP הלא-מחויב לפני שהוא הולך לאיבוד.

---

## חלק 4 — מצב המוצר והמותג

**הצעת ערך:** אופנת רחוב מינימליסטית פרימיום (Printify, print-on-demand) + תכשיטים/hardware יומיומי (CJ Dropshipping — שרשראות, צמידים, עגילי סטאד). מוטיב שיווקי חוזר: "the Drip Street Set" (נמצא ב-`backend/data/product-copy-updates.json`).

**קהל יעד/שוק:** ישראל (עברית, RTL, ILS, זיהוי גיאוגרפי אוטומטי) + שאר העולם (אנגלית, USD). דיווחי Telegram התפעוליים בעברית מרמזים על מפעיל ישראלי. `Terms.jsx`/`TermsOfService.jsx` (הגרסה המתה) מתייחסים לחוק הגנת הצרכן הישראלי ולסטטוס "עוסק פטור."

**זהות מותג במעבר:** "Drip Street" (זהות streetwear כהה, dripstreetshop.com) → **"JØAKIM"** (סלוגן: "Freedom. Style. Attitude." — כבר חי ב-`index.html`). נכסי לוגו/וורדמארק חדשים קיימים (14 קבצים) אך **לא בוצע להם commit**. **מדד כמותי למצב המיגרציה בפועל:** 30 קבצים עדיין מכילים `dripstreetshop.com` (routes, services, דפי משפט, פיד Google/Facebook, מיילים, לוגים ישנים) מול 9 קבצים בלבד עם אזכור JOAKIM (בעיקר scripts לעיבוד נכסים, `index.html`, `App.jsx`, `Footer.jsx`, CSS). **מסקנה: המיגרציה בתחילתה** — שכבת הנכסים הוויזואליים והכותרת/מטא-דאטה זזו, אך תוכן המדיניות, המיילים, פיד השיווק, וה-SEO validator עדיין לא.

**קטגוריות ומוצרים קיימים:**
- אפרל (Printify): **11 מוצרים** מאומתים ב-`backend/data/products_seed.json` (טי-שירטים, טאנק טופ, קפוצ'ון) — כותרות כמו "Pornstar Martini T-Shirt", "Unisex Heavy Blend Hooded Sweatshirt".
- תכשיטים/hardware (CJ dropship): **לא מופיעים כלל בקובץ `products_seed.json`** (0 רשומות עם `supplier_id`) — קובץ ה-seed הזה מכסה רק את קו האפרל. נתוני מוצרי התכשיטים חיים ישירות ב-DB של production, לא בקובץ הזה. לפי דוח הביקורת מ-2026-06-07: **5 מוצרי hardware** (שרשרת כבדה, תליון טיטניום, צמיד קובני כסף/זהב, עגילי סטאד פלדה, עגילי זירקון) + מוצר staging אחד שהיה אמור להימחק (`ID 12`) — **`דורש אימות`** האם עדיין קיים ב-production הנוכחי.
- הערת אי-התאמה: הכותרות ב-`product-copy-updates.json` ("Drip Street Set", עיצוב פרימיום) **שונות** מהכותרות הגנריות ב-`products_seed.json` — נראה שמדובר בטיוטת קופי מיועדת שטרם הוחלה בפועל על המוצרים החיים. `דורש אימות`.

**מודל ייצור/מלאי:** Print-on-demand מלא (Printify) + Dropshipping מלא (CJ) — **אין סיכון מלאי, אין מחסן**.

**תמחור ומרווח:** מנוע תמחור אוטומטי (`pricing.js`) עם יעד רווח נטו **30%** + הנחת עמלת תשלום **3%** (שניהם env-overridable), שער חליפין יומי (ברירת מחדל 3.75 ₪/$, מתעדכן מ-open.er-api.com), עדכון מחיר אוטומטי רק בתנודת מט"ח קיצונית (>8%). לפי דוח 2026-06-07 (נקודת זמן היסטורית, `דורש אימות מחדש`): מרווחים בריאים — אפרל כ-₪56–114/פריט, תכשיטים כ-₪71–142/פריט, עם markup קיצוני (~60x) על הפריט הזול ביותר בתכשיטים — סומן כסיכון אמון לקוח (לא בעיית תמחור אלא צורך במיצוב/הצדקה בקופי).

**משלוחים:** Printify — 5–25 ימי עסקים (`Shipping.jsx` החי); סף משלוח חינם **₪249** (`pricing.js`). CJ/תכשיטים — 1–3 ימי עיבוד + 7–20 ימי משלוח (`supplierPolicies.js`). **⚠️ באג מטבע בקובץ מת בלבד:** `ShippingPolicy.jsx` (לא בשימוש) מציין את סף המשלוח החינם ב-**דולרים** ($249) במקום שקלים — לא משפיע על production כי הדף לא מנותב, אך יש לתקן אם הוא ייבחר כגרסה הסופית.

**החזרות/החלפות:** Printify (אפרל) — 30 יום, פגם בלבד. CJ (תכשיטים) — **סתירה בין שני מקורות חיים בו-זמנית:** `RefundPolicy.jsx` (הדף החי בפועל) קובע **15 יום**, בעוד `supplierPolicies.js` (הקונפיג החדש, untracked) קובע **14 יום**. יש לתאם לפני השקה.

**אמצעי תשלום:** PayPal בלבד בפועל (wallet + כרטיס אשראי דרך PayPal Standard) — חי ופעיל. Stripe מותקן בקוד אך **מנוטרל קשיח** (`&& false` בקוד, בהמתנה לחשבון סוחר ישראלי). PayPlus מוגדר חלקית אך **לא פעיל** (`PAYPLUS_PAGE_UID` לא מוגדר ב-production). Braintree/Meshulam הוסרו לגמרי מנתיב הקוד החי (חשבון Braintree Sandbox נפרד עדיין קיים אך לא מחובר לשום דבר חי).

**מטבעות ושפות:** ILS/עברית (ישראל) ↔ USD/אנגלית (שאר העולם), זיהוי גיאוגרפי אוטומטי + אפשרות override שנשמרת ב-localStorage.

**נכסי תוכן קיימים:** 14 קבצי לוגו/וורדמארק JØAKIM (untracked, ראו חלק 1.7), תמונות hero גדולות (`hero-bg.jpg` 2.2MB, `hero-model.png` 2.4MB), **חשד לכפילות תמונה:** `bracelet.png` ו-`chain.png` זהים בגודל בייטים בדיוק (430,482 בייטים) — דורש בדיקה ויזואלית. עותקי משפט: `Terms.jsx`/`Shipping.jsx`/`RefundPolicy.jsx`/`PrivacyPolicy.jsx`/`About.jsx` (החיים) — **כולם עדיין ממותגים "Drip Street" במלואם, ללא תוכן JOAKIM כלל**.

**⚠️ פער תוכן משפטי קריטי:** דף `/privacy` **החי כרגע** הוא placeholder גולמי בלבד — הכותרת מילולית "Privacy Policy Placeholder", גוף הטקסט אומר "This page is intentionally scaffolded for launch and awaits approved legal copy," עם 4 סעיפי `TODO:` (איסוף נתונים, שימוש, שיתוף/שמירה, זכויות משתמש). זהו פער תאימות אמיתי לחנות חיה שאוספת הזמנות ואימיילים. ראו חלק 6 ממצא #1.

**יתרונות מותג מול מתחרים:** לא מתועד בקוד — **לא הומצא, מסומן כלא-קיים.**

**החלטות מותג שכבר התקבלו:** שם JØAKIM + סלוגן; רכישת shopjoakim.com (26/07); רצף מיגרציה (ראו חלק 3, 8).

**נושאים עסקיים פתוחים:** אסטרטגיית תמחור/מרווח לתכשיטים (סיכון אמון), איזו גרסת דף משפטי סופית (Terms מול TermsOfService וכו'), האם קופי "Drip Street Set" יוחל על מוצרים חיים, גודל קטלוג תכשיטים בפועל (לא מתועד בקובץ seed).

---

## חלק 5 — מצב Shopify בפועל

**לא רלוונטי — הפרויקט אינו חנות Shopify.** אין Shopify Admin, אין Theme, אין Store domain בסגנון myshopify.com. הטבלה הבאה ממפה כל נושא Shopify-מבוקש לעובדה המקבילה שאומתה בפועל בפרויקט הזה:

| נושא Shopify מבוקש | המקביל בפועל ב-JØAKIM |
|---|---|
| Store domain, פעיל/מוגן סיסמה | `dripstreetshop.com` — **חי, HTTP 200, ללא הגנת סיסמה** (curl ישיר, ללא redirect לדף login). `shopjoakim.com` — נרכש, **לא מחובר**, HTTP 000. |
| Theme פעיל/פיתוח | אין תפיסת Theme — קוד React אחיד ל-production; אין "theme פיתוח" נפרד, כל הפיתוח קורה ב-branches (ראו חלק 1.5). |
| מוצרים/וריאציות/מלאי/מחירים | מנוהלים ב-SQLite (`backend/ecommerce.db`) + סנכרון חי מ-Printify/CJ, לא ב-Shopify Admin. פרטים בחלק 4. |
| Markets/שפות/מטבעות | מומש ידנית: geolocation → he/ILS או en/USD (חלק 2, חלק 4). |
| משלוחים/מיסים | מומשו בקוד (`pricing.js`, `supplierPolicies.js`) — אין Shopify Tax/Shipping settings. |
| Payments | PayPal Live בלבד בפועל, מומש ישירות מול PayPal REST API — לא Shopify Payments. |
| Domains | Vercel (frontend) + Render (backend) — לא Shopify Domains. |
| Policies | דפי React מותאמים אישית, ראו חלק 4 — לא Shopify Policies. |
| Apps | אין Shopify App Store — אינטגרציות ישירות ל-API (חלק 1.11). |
| Discounts | קופוני "10% first order" מנוהלים בקוד (`admin-reports.js` מציג קופונים פעילים) — לא Shopify Discounts. |
| Email notifications | Resend + `emailService.js` בקוד — לא Shopify Notifications. |
| Analytics/Pixels | GA4/Meta/TikTok דרך `analytics.js` בקוד — לא Shopify Analytics. |
| Checkout readiness | נבדק ישירות: backend חי (HTTP 200), PayPal מוגדר ופעיל בקוד, אך ראו חלק 6 לפערים (env vars לא מתועדים, מדיניות סותרת). |

---

## חלק 6 — בדיקות איכות (Static QA, ללא שינוי קוד)

### 🔴 קריטי

**#1 — דף `/privacy` החי הוא placeholder לא-גמור עם TODOs משפטיים.**
השפעה עסקית: חנות חיה שאוספת הזמנות, מיילים ותשלומים ללא מדיניות פרטיות אמיתית — חשיפה משפטית/רגולטורית ופגיעה באמון לקוח.
ראיה: `frontend/src/pages/PrivacyPolicy.jsx` שורות 29-52 ("Privacy Policy Placeholder" + 4 שורות `TODO:`).
פתרון מומלץ: כתיבת מדיניות פרטיות אמיתית (דורש קלט לא-טכני מהבעלים/יועץ משפטי).
מורכבות: קטנה (טכנית) אך **תלויה בקלט חיצוני** שאינו בידי סוכן קוד.

**#2 — עבודת WIP מקומית משמעותית ללא Git backup כלשהו.**
השפעה עסקית: סיכון אובדן מוחלט של שבועות עבודה (נכסי rebrand, refactor תשלומים) אם המחשב/התיקייה הזו יאבדו.
ראיה: `git status` — HEAD 74a9214 מול origin/main 61a857f (20+ קומיטים מאחור), עשרות קבצים staged/unstaged/untracked ללא branch מרוחק תואם.
פתרון מומלץ: **commit + push ל-branch ייעודי** (למשל `wip/joakim-rebrand-assets`) **בהקדם האפשרי**, גם לפני החלטה איך למזג מול origin/main.
מורכבות: קטנה (היגיינת Git) — **אך זו פעולה שאסור היה לי לבצע במסגרת המנדט read-only של הדוח הזה; זו המשימה הראשונה המומלצת לסוכן/למשתמש הבא.**

### 🟠 גבוה

**#3 — סתירת מספרים במדיניות החזרות תכשיטים (15 מול 14 יום).**
השפעה: תוכן משפטי/שירות לקוחות סותר במקביל בייצור.
ראיה: `frontend/src/pages/RefundPolicy.jsx` שורות 16, 48-51 (15 יום) מול `frontend/src/config/supplierPolicies.js` שורה 65 (`windowDays: 14`).
פתרון: לבחור מספר אחד, לעדכן את שניהם.
מורכבות: קטנה. תלות: החלטת בעלים על המספר הנכון מול ספק CJ בפועל.

**#4 — `validate-seo.cjs` יפיל את ה-build ברגע שהדומיין הראשי ישונה, אם לא יעודכן באותו רגע.**
השפעה: חוסם production build בדיוק בזמן ה-cutover, אם יישכח.
ראיה: הסקריפט מצפה ל-`https://dripstreetshop.com/` בדיוק ב-canonical/og:url/sitemap; אושר גם ב-`origin/main` וגם בעץ העבודה שהדומיין עדיין קשיח.
פתרון: לעדכן את המחרוזת המצופה **באותו commit** של החלפת הדומיין בפועל (זה כבר חלק מהתוכנית המתועדת בזיכרון הפרויקט — רק מאשר זאת שוב עם ראיה מדויקת).
מורכבות: קטנה, אך תלות רצף קריטית — אסור לשכוח.

**#5 — משתני סביבה קריטיים לתשלום (PayPal) ולתכשיטים (CJ) לא מתועדים בשום מקום ב-repo.**
השפעה: `PAYPAL_CLIENT_ID`/`SECRET` ו-`CJ_API_KEY` בשימוש קוד פעיל אך נעדרים גם מ-`.env.example` וגם מ-`render.yaml` — אין רישום מתועד ב-repo של מה שנדרש כדי להריץ מחדש/לשחזר production.
ראיה: גריפ מלא של `process.env.` מול `.env.example` (חלק 1.12).
פתרון: להוסיף ל-`.env.example` (שמות בלבד) ול-`render.yaml` כ-`sync: false`.
מורכבות: קטנה.

**#6 — `UNSUBSCRIBE_SECRET` נופל בחזרה ל-string קשיח אם לא מוגדר.**
השפעה: קישורי הסרה-מרשימת-תפוצה ניתנים לזיוף אם המשתנה לא הוגדר בפועל ב-Render (חומרה נמוכה-בינונית, לא נתוני תשלום/PII רגישים).
ראיה: `backend/services/emailService.js` שורה 14, fallback ל-`'drip-street-fallback-secret'`.
פתרון: לוודא שהוא מוגדר ב-Render, או לשנות את הקוד לכישלון-סגור (fail-closed) במקום fallback.
מורכבות: קטנה, ברגע שמאומת אם המשתנה מוגדר בפועל.

**#7 — אין פקודת בדיקה יחידה שמריצה את כל חבילת הטסטים האמיתית.**
השפעה: סיכון רגרסיה לא-מזוהה — `npm test` ב-backend הוא stub, בזמן שקיימים עשרות קבצי `node:test` אמיתיים תחת `backend/tests/` ב-`origin/main`.
ראיה: `backend/package.json`'s `test` script.
פתרון: לחווט `node --test backend/tests/` (או דומה) לתוך ה-script.
מורכבות: קטנה.

### 🟡 בינוני

**#8 — שני מנגנוני "עגלה נטושה" מקבילים** (`backend/routes/carts.js` מול `backend/routes/marketing-webhooks.js`'s `/intake/abandoned-cart`) — כפילות/סתירת נתונים אפשרית. מורכבות: בינונית (דורש בירור פונקציונלי, לא רק קריאת קוד). תלות: החלטה איזה נתיב קנוני.

**#9 — `marketing-webhooks.js` רק "מדמה" שליחת מייל/SMS** (`console.log("Simulate...")`) ולא שולח בפועל דרך Resend/ספק SMS — נראה כמו production אך הוא stub. השפעה: הנחה שגויה שהתראות שיווק נשלחות בפועל. מורכבות: בינונית (חיווט ל-Resend הקיים כבר).

**#10 — שני קבצי דף משפטי "מתים" (`TermsOfService.jsx`, `ShippingPolicy.jsx`) מכילים תוכן שלם ומקצועי יותר מהגרסאות החיות, אך לא מגיעים לאף אחד; יש להם גם באג מטבע (USD במקום ILS).** סיכון: בלבול/עבודה כפולה עתידית. מורכבות: בינונית — החלטת תוכן + תיקון קוד קטן.

**#11 — PR #2 (redesign מלא) פתוח ולא ממוזג כבר ~57 יום (מ-2026-06-06).** סיכון: קונפליקטים גדלים עם הזמן; לא ברור אם זו עבודה נטושה או מתוכננת. מורכבות: **גדולה** אם למזג (עץ עבודה השתנה מהותית מאז), **קטנה** אם לסגור רשמית. תלות: החלטת בעלים.

**#12 — `bracelet.png`/`chain.png` זהים בגודל בייטים במדויק** — חשד לכפילות/placeholder שגוי. מורכבות: קטנה, ברגע שנבדק ויזואלית.

### 🟢 נמוך

**#13 (פתור, לתיעוד בלבד) — פער גרסת Node שסומן כ-deferred בזיכרון פרויקט קודם: אומת כפתור ב-`origin/main`.** אין פעולה נדרשת.

**#14 (פתור, לתיעוד בלבד) — "DELETE FROM products" הלא-מכוון באתחול: אומת כפתור ב-`origin/main`.** אין פעולה נדרשת.

**#15 — `products_seed.json` מכיל רק את 11 מוצרי ה-Printify, לא את קו התכשיטים.** אם קובץ זה משמש כמקור אמת במקום כלשהו, הוא חסר. השפעה נמוכה (התכשיטים כנראה חיים ישירות ב-DB).

**#16 — קבצי scratch מזדמנים בשורש הריפו** (`check-lines.js`, `search-*.js`, `validate-drip-street.cjs`, קובץ `git` בגודל 0) — ניקיון קוסמטי בלבד, ללא סיכון תפקודי.

**נתוני ביצועים/Lighthouse/נגישות מלאה/בדיקת קישורים שבורים בפועל בדפדפן — לא בוצעו** (מחוץ להיקף בדיקה סטטית של קוד בלבד, ללא הרצת שרת). `דורש אימות` בסבב QA עתידי עם שרת חי.

---

## חלק 7 — מצב מסחרי ונתונים

**אין גישה בהיקף הבדיקה הזו** לנתוני Google Analytics 4, Meta Pixel, TikTok Pixel, Vercel Analytics, או היסטוריית הזמנות/Telegram בפועל. הקוד מוכיח שתשתית המדידה **קיימת ומחווטת** (`frontend/src/utils/analytics.js` — GA4/Meta/TikTok, מותנית ב-env vars אמיתיים, לא placeholder) וש-`admin-reports.js` מספק endpoint לסיכום הזמנות/הכנסות (`DRIP_ADMIN_SECRET`-gated) — כלומר **הנתונים כנראה קיימים** ונגישים לבעלים, אך **לא אומתו/נצפו בדוח הזה**.

**במפורש, כפי שהמשתמש ביקש: אין כרגע בסיס נתונים מספק בידי הסוכן שכתב דוח זה לקבלת החלטות מסחריות** (טראפיק, מקורות תנועה, conversion rate, AOV, revenue, refunds, CAC, הוצאות פרסום, רשימת תפוצה, ביצועי קמפיינים). כל אלה `לא ידוע` מנקודת המבט הזו — יש לפנות ל-Render/Vercel/GA4/Telegram dashboards ישירות.

---

## חלק 8 — Decision Log

| החלטה | סטטוס | סיבה | תאריך/מקור | השפעה | ניתנת לשינוי? |
|---|---|---|---|---|---|
| מיתוג מחדש Drip Street → JØAKIM | סופית (בביצוע) | עסקית, לא מפורטת בקוד | זיכרון 2026-07-25/26 + `index.html` כבר עודכן | נוגע ב-30+ קבצים, מיילים, פידים, דפי משפט, נכסים | כן, אך יקר |
| קניית shopjoakim.com עכשיו, דחיית חיבור DNS | סופית | מניעת אובדן הדומיין תוך כדי עבודת עיצוב | זיכרון + הערת קוד ב-`index.js` origin/main | דומיין קיים אך לא בשימוש (מאומת: HTTP 000) | לא רלוונטי (בוצע) |
| הפרדת מיגרציית דומיין המייל מהאתר | סופית | הימנעות מעיכוב launch עקב אימות DNS/DKIM ב-Resend | זיכרון 2026-07-26 | `emailService.js` עדיין ממותג dripstreetshop.com | כן |
| PayPal בלבד כאמצעי תשלום חי (wallet+card) | סופית (מצב נוכחי) | Stripe דורש חשבון סוחר ישראלי שעדיין לא קיים; PayPlus לא הושלם קונפיגורטיבית | קוד: `&& false` ב-`index.js` + `PAYPLUS_PAGE_UID` לא מוגדר | נקודת כשל יחידה לתשלומים | כן, כשהתנאים יתמלאו |
| הסרת Braintree/Meshulam מנתיב הקוד החי | סופית | הוחלפו ב-PayPal | זיכרון פרויקט קודם | — | לא רלוונטי |
| מודל מלאי Print-on-demand + Dropship בלבד | עובדת יסוד מתמשכת (לא נמצאה החלטה מתועדת מפורשת בקוד) | הימנעות מסיכון מלאי | מסקנה מהאינטגרציות (Printify+CJ) | תלות מוחלטת באיכות/SLA ספקים | לא רלוונטי כרגע |
| יעד מרווח 30% + עמלת תשלום 3% (ברירת מחדל) | הנחת עבודה, env-overridable | — | קוד: `pricing.js` | קובע תמחור אוטומטי | כן, דרך env |
| מנגנון מוצר-בדיקה חבוי (id=25) לבדיקת PayPal אמיתית | סופית, מוקפת scope צר מאוד | נדרשה בדיקת תשלום אמיתית בלי לחשוף מוצר אמיתי | PR#9/#10 | מורכבות קוד נוספת, נבדקה בהיקף נרחב | לא ברור אם עדיין נחוץ לאחר סיום הבדיקה — `דורש אימות` |
| עבודת rebrand+refactor מקומית נשארה ללא commit/push | **פתוחה, לא-מוסברת** | `לא ידוע` | תצפית ישירה, 2026-08-02 | סיכון אובדן עבודה; חוסם reconciliation מול origin/main | פעולה נדרשת מיידית |
| איזו גרסת דף משפטי קנונית (Terms מול TermsOfService וכו') | **פתוחה** | מעולם לא הוכרעה בקוד | מסקנה מ-dead-code routing | תוכן/תאימות | כן |
| מספר ימי החזרה לתכשיטים: 14 או 15 | **פתוחה** | שני מקורות חיים סותרים | `RefundPolicy.jsx` מול `supplierPolicies.js` | תוכן משפטי | כן |

---

## חלק 9 — משימות ו-Backlog

**הושלמו (מאומת מ-PRs ממוזגים):** ייצוב CI הרמטי; fulfillment עמיד ל-Printify; בטיחות אתחול + הצמדת Node; ייצוב הזמנות מקצה-לקצה + redaction PII; מנגנון מוצר-בדיקה מוגן טוקן; פטור משלוח מוקף-scope; תיקון סגירה שקטה של PayPal; כפתור כרטיס אשראי PayPal Standard; הוספת shopjoakim.com ל-CORS.

**בתהליך (uncommitted, בעץ העבודה המקומי כרגע):** נכסי מיתוג JØAKIM (14 קבצים); מודול `supplierPolicies.js`; מנוע `intelligence.js`; מחיקת/איחוד `paymentController.js`/`paymentRoutes.js`; מנגנון `catalog-fallback.json`. **עדיפות: להעלות ל-Git לפני כל דבר אחר (ראו חלק 6 #2).**

**נעצרו/ננטשו:** אינטגרציית Meshulam (הוסרה); PR #2 redesign מלא (פתוח, לא זז מאז 06/06 — לא ברור אם ננטש בפועל או רק מוקפא); i18n מלא (הוחזר חלקית, branches `backup-before-i18n-removal`/`english-only-release` עדים לכך).

**TODOs בקוד:** 4 סעיפים ב-`PrivacyPolicy.jsx` (איסוף נתונים, שימוש, שיתוף/שמירה, זכויות משתמש); שורת הערה `// TODO: enable [Stripe] once IL merchant account is available` ב-`index.js`.

**באגים:** סתירת ימי החזרה תכשיטים (14/15); באג מטבע ($/₪) ב-`ShippingPolicy.jsx` המת; חשד כפילות תמונה `bracelet.png`/`chain.png`.

**חובות טכניים:** `npm test` (backend) לא מחווט לחבילת הטסטים האמיתית; משתני סביבה קריטיים לא מתועדים; שני נתיבי עגלה-נטושה מקבילים; `marketing-webhooks.js` לא שולח בפועל (רק מדמה); קבצי דף משפטי כפולים/מתים; קבצי scratch בשורש הריפו.

**משימות עיצוב:** לבחור נכס לוגו סופי מתוך ~14 המועמדים (חלקם ייתכן שכפולים); לוודא `bracelet.png`/`chain.png` נכונים ויזואלית; לתקן "יתום" בגריד hardware במובייל (מדוח 06/07, `דורש אימות מחדש` אם עדיין רלוונטי).

**משימות תוכן:** לסיים מדיניות פרטיות אמיתית; לתאם מספר ימי החזרה; להחליט אם קופי "Drip Street Set" יוחל על מוצרים חיים; לכתוב תיאורי CJ אנושיים במקום תבנית אוטומטית (פריט מדוח 06/07, `דורש אימות מחדש`).

**משימות Shopify:** לא רלוונטי.

**משימות מוצר:** לאמת גודל/מצב קטלוג התכשיטים בפועל מול production (לא מתועד ב-seed file); להסיר מוצר staging אם עדיין קיים (`ID 12` מדוח 06/07, `דורש אימות מחדש`).

**משימות שיווק:** להחליט אם לחווט את `marketing-webhooks.js` ל-ESP אמיתי או להסירו/לתייג כלא-ממומש.

**משימות משפטיות/תפעוליות:** מדיניות פרטיות אמיתית (קריטי, ראו חלק 6 #1); ודא `UNSUBSCRIBE_SECRET` מוגדר ב-production.

**לפני השקה (Pre-launch, לפי תוכנית המיגרציה הקיימת בזיכרון פרויקט):** commit+push של ה-WIP המקומי; מעבר דומיין מתואם (Vercel+CORS+SEO validator+feeds+מיילים); בדיקת תשלום אמיתית על הדומיין החדש; בדיקת "קופסה שחורה" של דולב.

**אחרי השקה:** מיגרציית דומיין המייל (Resend); אופטימיזציית conversion (ביקורות, מדריך מידות תכשיטים, גריד מובייל 3 עמודות, לוגיקת upsell, SEO עברי ל-OG tags — כל אלה מדוח 06/07, `דורש אימות מחדש` לרלוונטיות נוכחית).

---

## חלק 10 — הדרך להכנסה אמיתית

### שלב A — ייצוב והשלמת תמונת המצב
1. **Commit + push מיידי לעבודת ה-WIP המקומית** (branch נפרד, לא ישירות ל-main) — לפני כל דבר אחר, כדי לעצור סיכון אובדן.
2. לאחר מכן: להשוות/למזג בין ה-refactor המקומי של payment controller לזה שכבר קיים ב-`origin/main` — לוודא שאין רגרסיה כפולה.
3. להחליט מה קורה עם PR #2 הפתוח (57 יום) — מיזוג, rebase, או סגירה רשמית.
4. לאמת מול production בפועל (לא רק קוד): קטלוג תכשיטים נוכחי, האם מוצר staging id=12 עדיין קיים, האם ה-DB תואם את מה שהקוד מצפה לו.

### שלב B — Minimum Sellable Store
כדי שלקוח אמיתי יוכל להגיע, להבין, לבחור, לסמוך, לשלם, לקבל אישור, לקבל הזמנה, ולהחליף/להחזיר — **רוב זה כבר קיים ועובד** (PayPal חי, fulfillment עמיד, מדיניות משלוחים קיימת). החוסמים הישירים: (1) דף פרטיות אמיתי — קריטי מבחינת אמון/תאימות; (2) תיאום מספרי החזרה (14/15); (3) החלטה על מיתוג — סיום המעבר ל-JØAKIM לפני שמישהו רואה "Drip Street" ו"JØAKIM" מעורבבים.

### שלב C — השקה ראשונה
מוצרים: 11 פריטי אפרל קיימים + קו תכשיטים (לאמת גודל מדויק). תוכן נדרש: קופי מוצר סופי (להחליט אם "Drip Street Set" עובר rebrand ישיר או נכתב מחדש), מדיניות פרטיות. ערוצי רכישה: PayPal בלבד לעת עתה. בדיקות: בדיקת תשלום אמיתית על הדומיין הסופי + בדיקת דולב. מדדים למעקב: PayPal captures, Telegram order alerts, GA4 (כבר מחווט).

### שלב D — ההכנסה הראשונה
מסלול ממוקד: לסיים cutover דומיין → הרצת קמפיין ממוקד קטן (לא נמדד בדוח זה, `לא ידוע` אם קיים כבר) → מעקב אחר הזמנה אמיתית ראשונה דרך Telegram/admin-reports endpoint.

### שלב E — מנוע מכירות חוזר
`marketing-webhooks.js` קיים כשלד (abandoned cart / welcome flow) אך לא שולח בפועל — זו נקודת ההתחלה הטבעית לשיפור retention/email ברגע שיחווט ל-Resend. `intelligence.js` (behavioral personalization, untracked) קיים ולא ברור אם מחובר ל-UI — פוטנציאל ל-conversion אם יאומת ויחובר.

### שלב F — רווחיות
נתונים חסרים לחישוב רווח אמיתי (חלק 7): אין נראות ל-CAC, ROAS, שיעור החזרות בפועל, עלות משלוח בפועל מול המוערכת. מנוע `pricing.js` נותן בסיס תיאורטי טוב (30% margin target) אך יש לאמת מול ביצועים אמיתיים כשיהיו נתונים.

---

## חלק 11 — תוכנית עבודה מתועדפת

### 48 השעות הבאות
1. **Commit + push לעבודת ה-WIP המקומית** — תוצר: branch מגובה ב-GitHub. קריטריון הצלחה: `git status` נקי, branch דחוף ל-origin. חייב לקרות לפני כל עבודה נוספת על אותה תיקייה. סיכון בדחייה: אובדן עבודה מוחלט.
2. **אימות ישיר של production מול הקוד**: קטלוג תכשיטים, מוצר staging, ערכי env בפועל ב-Render (לפחות אישור קיום, לא ערכים). תוצר: תמונת מצב מדויקת. סיכון בדחייה: החלטות הבאות מבוססות על הנחות שגויות.
3. **החלטת בעלים על PR #2** (מיזוג/סגירה). תוצר: החלטה מתועדת. סיכון בדחייה: הפער מול main רק גדל.

### השבועיים הקרובים
4. כתיבת מדיניות פרטיות אמיתית (תלוי קלט לא-טכני).
5. תיאום מספר ימי החזרה לתכשיטים (14 מול 15) ועדכון שני המקורות.
6. השלמת מעבר הדומיין המתואם (Vercel+CORS+SEO validator+feeds+מיילים) — לפי הרצף שכבר הוחלט בזיכרון הפרויקט.
7. חיווט `npm test` לחבילת הטסטים האמיתית ותיעוד משתני הסביבה החסרים.
8. בדיקת תשלום אמיתית + בדיקת דולב על הדומיין הסופי.

### 30–90 יום
9. חיווט `marketing-webhooks.js` ל-ESP אמיתי (Resend) עבור abandoned cart/welcome flow.
10. אימות/חיבור `intelligence.js` ל-UI אם רלוונטי, כמנוע conversion.
11. הכרעה על גרסאות דפי המשפט הכפולות (Terms/TermsOfService וכו').
12. איסוף נתוני מסחר אמיתיים (GA4/Telegram/admin-reports) ובניית תמונת CAC/AOV/margin אמיתית.
13. תוכנית תוכן/מלאי תכשיטים מבוססת נתונים אמיתיים (לא רק דוח 06/07 הישן).

---

## חלק 12 — ההמלצה שלי

1. **איפה הפרויקט עומד כיום:** חנות אמיתית, חיה, מוכיחת יכולת מכירה — payment stack עבר קשיחה משמעותית ב-9 PRs רצופים (19/07–26/07), ה-backend עמיד יותר מבעבר. אבל עץ העבודה המקומי (התיקייה שנבדקה) **נמצא בפועל מאחורי production ב-20+ commits**, עם עבודת rebrand משמעותית שיושבת רק על הדיסק הזה, ללא Git backup.

2. **נקודת העצירה המדויקת:** עבודת מיתוג/refactor על branch `stabilize/payments-p0`, על גבי commit מ-2026-06-04, מעולם לא בוצע לה commit. זו נקודת ההמשך הישירה עבור הסוכן הבא.

3. **הדבר החשוב ביותר שכבר הושלם:** ייצוב תשתית התשלומים — PayPal (wallet+card) חי, מאובטח (ולידציית capture, נעילת concurrency, redaction PII), עם fulfillment עמיד ל-Printify (state machine, לא עוד אובדן הזמנות שקט).

4. **החסם הגדול ביותר להכנסה:** לא טכני — **תוכן/מיתוג לא-גמור**: מדיניות פרטיות placeholder, "Drip Street" מול "JØAKIM" מעורבבים בכל שכבות התוכן החוץ-קוד (מיילים, פידים, דפי משפט), ומעבר דומיין שעדיין לא בוצע.

5. **המשימה היחידה שהסוכן הבא צריך לבצע ראשונה:** **commit + push לעבודת ה-WIP המקומית לפני כל דבר אחר** — לא שינוי פונקציונלי, אלא הצלת עבודה קיימת מפני אובדן.

6. **שלוש החלטות הנדרשות מבעל הפרויקט:**
   - מה עושים עם PR #2 הפתוח מזה כמעט חודשיים (למזג/לנטוש)?
   - מה מספר ימי ההחזרה הנכון לתכשיטים (14 או 15)?
   - איזו גרסת תוכן משפטי היא הסופית (Terms.jsx הדל מול TermsOfService.jsx המפורט)?

7. **מה אסור לשנות כרגע:** `origin/main` (production חי) — כל שינוי צריך לעבור PR מבוקר, לא push ישיר; `validate-seo.cjs` לא לשנות דומיין בלי לשנות גם את הדומיין בפועל באותו רגע; אין לגעת ב-MENI_CORE.

8. **המסלול הקצר והמציאותי ביותר להכנסה ראשונה:** להציל את ה-WIP → לסיים תוכן משפטי/מיתוג → לבצע cutover דומיין מתואם → בדיקת תשלום אמיתית + בדיקת דולב → פרסום. רוב התשתית הטכנית **כבר קיימת ועובדת** — זה בעיקר "לסגור פינות" תוכן/תיאום, לא בנייה מאפס.

9. **מה נדרש כדי להגיע לרווח, לא רק למחזור:** נתוני CAC/ROAS/שיעור החזרות/עלות משלוח בפועל — אף אחד מהם לא זמין מהקוד לבדו (חלק 7). יש לחבר בין `admin-reports.js`/GA4/Telegram לתמונת רווחיות אמיתית לפני כל השקעה משמעותית בפרסום.

10. **רמת ביטחון:** גבוהה מאוד לכל מה שמסומן `מאומת` (נגזר ישירות מ-Git/HTTP/gh CLI). בינונית-גבוהה למסקנות סבירות (למשל למה ה-WIP לא בוצע לו commit). נמוכה לכל מה שמסומן `דורש אימות מחדש` — בעיקר תוכן מדוח 06/07 הישן (מצב קטלוג תכשיטים, מוצר staging) שלא אומת ישירות מול production בסבב הזה.

---

## Evidence Index

- `git status`, `git status --porcelain=v2 -b`, `git diff --stat` (staged/unstaged/HEAD vs origin/main), `git log --oneline` (מקומי ו-`origin/main`), `git log --reverse` (קומיט ראשון), `git reflog`, `git stash list`, `git branch -a`, `git remote -v`, `git merge-base` — כל אלה הורצו ישירות מ-`C:\Users\yohan\.gemini\antigravity-ide\scratch\custom-ecommerce`.
- `gh pr list --repo yohananpr11-ux/custom-ecommerce --state all`, `gh pr view 3/4`.
- `curl` ל-`https://dripstreetshop.com`, `https://shopjoakim.com`, `https://www.shopjoakim.com`, `https://custom-ecommerce-qp30.onrender.com/api/products` (בדיקות HTTP read-only, ללא שינוי מצב).
- `netstat -ano` (בדיקת ports מקומיים, read-only).
- קריאת קבצים מלאה: `DRIP_STREET_System_Report.md`, `docs/Drip-Street-Store-Audit-Report.md`, `render.yaml`, `backend/.env.example`, `frontend/.env.example`, `backend/package.json`, `frontend/package.json`, `frontend/vercel.json`, `frontend/playwright.config.js`, `.github/workflows/p0-verify.yml` (מ-`origin/main`), ורשימה נרחבת של קבצי שירות/route/עמוד שנמנתה בפירוט בתת-סוכן חקירה (Explore agent) עם ציטוטי file:line לכל טענה — כולל `backend/services/meni.js`, `telegram.js`, `pricing.js`, `emailService.js`, `printify.js`, `dropship.js`, `design-pipeline.js`, `backend/routes/feeds.js`, `marketing-webhooks.js`, `admin-reports.js`, `dev.js`, `carts.js`, `frontend/src/config/supplierPolicies.js`, `frontend/src/utils/intelligence.js`, `frontend/src/utils/analytics.js`, `backend/index.js` (origin/main, 4064 שורות), `backend/lib/paypal-capture-validation.js`, `frontend/src/paypalFlowHelpers.js`, `backend/data/product-copy-updates.json`, `backend/data/products_seed.json`, כל דפי המדיניות (`RefundPolicy.jsx`, `Shipping.jsx`, `ShippingPolicy.jsx`, `Terms.jsx`, `TermsOfService.jsx`, `PrivacyPolicy.jsx`, `About.jsx`, `AboutUs.jsx`), `frontend/scripts/validate-seo.cjs`, `frontend/index.html`.
- זיכרון פרויקט קודם (auto-memory של הסוכן): `dripstreet-joaquin-status`, `dripstreet-repo-map`, `dripstreet-fulfillment-hardening-deployed`, `dripstreet-domain-migration-plan`, `dripstreet-payment-gaps` — שימשו כהיפותזת מוצא, **כל טענה מהם שאומתה מחדש בדוח זה מסומנת `מאומת`; מה שלא אומת מחדש מסומן במפורש**.

## Unknowns

- מדוע עבודת ה-WIP המקומית (rebrand+refactor) מעולם לא קיבלה commit — אין עדות בקוד למניע.
- האם המשתמש מודע לפער בין העץ המקומי ל-`origin/main`.
- גודל/מצב קטלוג התכשיטים בפועל ב-production כרגע (לא מתועד ב-`products_seed.json`, דוח 06/07 ישן מדי לסמוך עליו כעובדה נוכחית).
- האם מוצר staging (`ID 12` מדוח 06/07) עדיין קיים בקטלוג החי.
- כוונת PR #2 הפתוח — עבודה נטושה או מתוכננת להמשך.
- ערכים בפועל של משתני הסביבה הקריטיים ב-Render (רק שמות אומתו, לא נבדק אם מוגדרים בפועל, כולל `UNSUBSCRIBE_SECRET`).
- מצב מלא/מדויק של תוכן ב-MENI_CORE (לא נבדק כלל, מחוץ להיקף).
- כל נתוני מסחר/טראפיק/המרה בפועל (חלק 7) — לא נגישים מהיקף בדיקה זו.
- האם `intelligence.js` (untracked) מחובר בפועל לאיזשהו רכיב UI חי.
- כפילות חשודה בין `bracelet.png`/`chain.png` — לא אומתה ויזואלית.

## Questions for the Owner

**לפי השפעה על הכנסה:**
1. מה סטטוס ה-WIP המקומי (rebrand assets, מחיקת payment controller) — האם ידוע לך, והאם יש כוונה למזג אותו, או שהוא ניסיון שנזנח?
2. מה מספר ימי ההחזרה הנכון לתכשיטים — 14 או 15 — כדי לתקן את הסתירה בקוד?
3. איזו גרסת תוכן משפטי (Terms.jsx הקצר מול TermsOfService.jsx המפורט, וכן הלאה) את/ה רוצה כסופית?

**לפי סיכון טכני:**
4. האם יש כוונה למזג את PR #2 (redesign פתוח מזה ~57 יום), או לסגור אותו רשמית?
5. האם משתני הסביבה הקריטיים (PAYPAL_*, CJ_API_KEY, GEMINI_API_KEY, UNSUBSCRIBE_SECRET ועוד) מוגדרים בפועל ב-Render כרגע?

**לפי חוויית לקוח:**
6. האם יש תאריך יעד לסיום מעבר הדומיין (dripstreetshop.com → shopjoakim.com) ולבדיקת דולב?
7. האם קופי "Drip Street Set" ב-`product-copy-updates.json` אמור להיות מוחל על המוצרים החיים, ובאיזה timing ביחס למעבר המיתוג?
