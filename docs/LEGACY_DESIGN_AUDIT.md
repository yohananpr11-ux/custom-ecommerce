# JONO Design Audit Report — Historical Brand Transition Regression & Fix
Generated: 2026-08-07

## What Was Broken (Design Regression)

After PR #22 merged the legacy brand rebrand to JONO, the live site at www.shopjono.com
still showed the OLD legacy brand metallic logo because:

| Location | Old (broken) | Fixed |
|----------|-------------|-------|
| Header (storefront-header) | `/logo-new.png` (legacy mark) | `/jono-approved-full-logo.png` |
| Mobile nav drawer | `/logo-new.png` | `/jono-approved-full-logo.png` |
| Product card watermark | `/logo-new.png` | `/jono-approved-full-logo.png` |
| Footer brand column | `/logo-new.png` | `/jono-approved-full-logo.png` |
| CSS cursor variable | `url('/logo-new.png')` | `url('/jono-favicon.png')` |
| CSS comment | "Legacy Brand System" | "JONO Brand System" |
| RefundPolicy.jsx (×2) | `support@legacy-domain` | `support@shopjono.com` |
| ContactUs.jsx (×2) | `support@legacy-domain` | `support@shopjono.com` |
| Terms.jsx (×2) | `support@legacy-domain` / "Legacy Brand" | `support@shopjono.com` / "JONO" |

## Why logo-new.png Was The Problem

`logo-new.png` was the original legacy brand logo (276KB square PNG).
The previous rebrand replaced it in the copy description but the `src=` attributes
in JSX were never changed. This caused every user to see:
- Old logo in top-left header
- Old logo watermark on every product card
- Old logo in footer
- Old cursor on CTA buttons

## Hero Background — Also Fixed (commit 7fade0b)

The hero section had `background: #050505` (solid black, no image).
Fixed to: `background: #050505 url('/hero.png') center center / cover no-repeat`
with `::before` overlay at 65% opacity for text legibility.

Assets added to `frontend/public/`:
- `hero.png` (copied from src/assets/)
- `jono-favicon.png`, `jono-og.png`
- `jono-approved-full-logo.png`, `jono-logo-transparent.png`, `jono-wordmark-dark.png`

## Files Changed in Fix

```
frontend/src/App.jsx             — logo-new.png → jono-approved-full-logo.png (4 occurrences)
frontend/src/components/Footer.jsx — logo-new.png → jono-approved-full-logo.png
frontend/src/index.css           — cursor + CSS comment updated
frontend/src/pages/RefundPolicy.jsx — email + brand name fixed
frontend/src/pages/ContactUs.jsx — email fixed
frontend/src/pages/Terms.jsx     — email + legacy brand → "JONO"
```

## Internal Identifiers

Storage keys were migrated to `jono_*` prefixes with backward-compatible reads.

## Commit History

```
54e682d fix: replace legacy logo with JONO logo everywhere
7fade0b feat: add JONO hero background image + missing public assets
8a1b38e Merge PR #22 refactor/rebrand-legacy-to-jono
```

## Verification (post-deploy)

```
www.shopjono.com HTTP 200 ✅
shopjono.com     HTTP 308 → www.shopjono.com ✅
Title: JONO - Men's Heavyweight Tees & Steel Jewelry ✅
hero.png in deployed CSS bundle ✅
logo-new.png references: 0 ✅
legacy domain email references: 0 ✅
```
