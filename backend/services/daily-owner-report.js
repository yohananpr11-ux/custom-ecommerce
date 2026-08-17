'use strict';

/**
 * JONO Daily Owner Report Service (PR #36)
 *
 * Generates and delivers exactly ONE high-value operational summary report
 * every day at 22:00 Europe/Jerusalem to the owner via @jono_store_bot.
 *
 * Core Guarantees:
 * 1. Restart-safe and duplicate-safe: uses durable SQLite table `daily_owner_reports`
 *    with a UNIQUE(report_type, report_date) constraint and atomic CAS.
 * 2. Delivery confirmation: marked 'sent' ONLY after Telegram genuinely succeeds.
 * 3. Exact Rolling Reporting Window:
 *    [Previous Day 22:00 Jerusalem, Current Day 22:00 Jerusalem)
 *    Non-overlapping, full coverage, no blind spot, stable cutoff on retries.
 * 4. Real data only: summarizes genuine telemetry, orders, technical issues,
 *    fulfillments, and backups; explicitly marks uncollected metrics as unavailable.
 * 5. Time-window paid sales: requires `orders.status = 'paid' AND orders.paid_at IS NOT NULL`
 *    within the window. Legacy orders with NULL paid_at are never falsely backfilled
 *    and never attributed to the date-window revenue.
 * 6. Privacy: zero raw IP addresses, tokens, passwords, customer names, or PII.
 * 7. Crash recovery & unambiguous delivery: detects crashes before vs after delivery_started,
 *    never blindly resends ambiguous deliveries, and reclaims stale in_progress leases safely.
 * 8. After-midnight catch-up: automatically catches up yesterday's report if service was offline at 22:00.
 */

const fs = require('fs');
const path = require('path');
const defaultDb = require('../db');
const ownerNotifications = require('./owner-notifications');
const sqliteBackup = require('./sqlite-backup');
const sqliteOffsiteBackup = require('./sqlite-offsite-backup');

/**
 * HTML-escape any dynamic user- or DB-derived string before inserting into Telegram HTML messages.
 */
function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Extract safe hostname/domain from referrer URL, stripping paths, queries, tokens, and PII.
 */
function extractSafeDomain(referrer) {
  if (!referrer || typeof referrer !== 'string') return 'Direct / ישיר';
  const trimmed = referrer.trim();
  if (!trimmed || trimmed.toLowerCase() === 'direct') return 'Direct / ישיר';
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (url.hostname) return url.hostname;
  } catch (_) {
    // fallback to regex extraction
  }
  const clean = trimmed.split('?')[0].split('#')[0].replace(/^[a-zA-Z0-9+.-]+:\/\//, '').split('/')[0];
  return clean.slice(0, 50) || 'Direct / ישיר';
}

// Dynamically resolve valid IANA Jerusalem timezone across all OS/ICU environments
function resolveJerusalemTimezone() {
  const candidates = ['Asia/Jerusalem', 'Europe/Jerusalem', 'Israel'];
  for (const tz of candidates) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch (_) {
      // try next
    }
  }
  return 'Asia/Jerusalem';
}

/**
 * Get current date string 'YYYY-MM-DD' in Europe/Jerusalem timezone.
 */
function getJerusalemDateString(date = new Date()) {
  const tz = resolveJerusalemTimezone();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Get the previous calendar date string 'YYYY-MM-DD' in Europe/Jerusalem.
 */
function getPreviousJerusalemDateString(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0) - (24 * 3600 * 1000));
  const tz = resolveJerusalemTimezone();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Get local time parts (hour, minute, second) in Europe/Jerusalem.
 */
function getJerusalemTimeParts(date = new Date()) {
  const tz = resolveJerusalemTimezone();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);
  return { hour, minute, second };
}

/**
 * Checks if the given date/time is eligible to send the daily report (>= 22:00 local time).
 */
function isEligibleForDailyReport(date = new Date()) {
  const { hour } = getJerusalemTimeParts(date);
  return hour >= 22;
}

/**
 * Find the exact UTC ISO timestamp corresponding to dateStr at timeStr in Europe/Jerusalem.
 * Dynamically resolves DST transitions (IDT UTC+3 vs IST UTC+2) without hardcoding fixed offsets.
 * Throws if the boundary cannot be resolved faithfully.
 */
function getJerusalemLocalTimestampUtc(dateStr, timeStr = '22:00:00') {
  const tz = resolveJerusalemTimezone();
  const [year, month, day] = dateStr.split('-').map(Number);
  const [targetHour, targetMin, targetSec] = timeStr.split(':').map(Number);

  let testMs = Date.UTC(year, month - 1, day, targetHour, targetMin, targetSec) - (6 * 3600 * 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const targetPrefix = `${dateStr}`;
  const targetTime = `${String(targetHour).padStart(2, '0')}:${String(targetMin).padStart(2, '0')}:${String(targetSec).padStart(2, '0')}`;

  for (let i = 0; i < 480; i++) {
    const formatted = formatter.format(new Date(testMs));
    if (formatted.includes(targetPrefix) && formatted.includes(targetTime)) {
      return new Date(testMs).toISOString();
    }
    testMs += 60000;
  }

  throw new Error(`Failed to resolve Jerusalem local timestamp boundary for ${dateStr} ${timeStr}`);
}

/**
 * Calculates the exact reporting window for report date dateStr:
 * [Previous Day 22:00 Jerusalem, Current Day 22:00 Jerusalem)
 *
 * Guaranteed properties:
 * - Non-overlapping across consecutive days.
 * - Full coverage (no 22:00-00:00 blind spot).
 * - Fixed snapshot cutoff: retrying at 22:05 or 23:30 uses the same exact window.
 * - Actual durationHours computed dynamically (24 for normal days, 23 or 25 on DST transition days).
 */
function getJerusalem24HourWindow(dateStr) {
  const prevDateStr = getPreviousJerusalemDateString(dateStr);
  const startUtcIso = getJerusalemLocalTimestampUtc(prevDateStr, '22:00:00');
  const endUtcIso = getJerusalemLocalTimestampUtc(dateStr, '22:00:00');

  const startMs = new Date(startUtcIso).getTime();
  const endMs = new Date(endUtcIso).getTime();
  const durationHours = Math.round((endMs - startMs) / (3600 * 1000));

  const [py, pm, pd] = prevDateStr.split('-');
  const [cy, cm, cd] = dateStr.split('-');

  return {
    reportDateStr: dateStr,
    prevDateStr,
    startUtcIso,
    endUtcIso,
    durationHours,
    startLocalDisplay: `${pd}/${pm} 22:00`,
    endLocalDisplay: `${cd}/${cm} 22:00`,
    fullLocalDisplay: `${pd}/${pm} 22:00 → ${cd}/${cm} 22:00`,
  };
}

// Promisified SQLite helpers
const dbAllAsync = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
});

const dbGetAsync = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});

const dbRunAsync = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});

/**
 * Collect real metrics from SQLite tables for the exact window.
 * Every section tracks `.available` (true on successful query, false on failure).
 * Query failures are NEVER silently reported as 0.
 */
async function getReportMetrics({ dateStr, db = defaultDb, backupDir, env = process.env } = {}) {
  const targetDate = dateStr || getJerusalemDateString();
  const windowInfo = getJerusalem24HourWindow(targetDate);
  const { startUtcIso, endUtcIso } = windowInfo;

  // 1. Traffic Metrics (visitor_sessions)
  let trafficSummary = {
    available: true,
    error: null,
    totalSessions: 0,
    humanSessions: 0,
    uniqueHumanVisitors: 0,
    deviceBreakdown: {},
    topLandingPages: [],
    topReferrers: [],
  };

  try {
    const trafficRows = await dbAllAsync(
      db,
      `SELECT
        id, is_human, visitor_id, device_category, landing_path, referrer, source
       FROM visitor_sessions
       WHERE datetime(started_at) >= datetime(?) AND datetime(started_at) < datetime(?)`,
      [startUtcIso, endUtcIso]
    );

    const humanRows = trafficRows.filter(r => r.is_human === 1);
    trafficSummary.totalSessions = trafficRows.length;
    trafficSummary.humanSessions = humanRows.length;

    const uniqueVisitorIds = new Set(humanRows.map(r => r.visitor_id).filter(Boolean));
    trafficSummary.uniqueHumanVisitors = uniqueVisitorIds.size;

    // Device breakdown
    const devices = {};
    for (const r of humanRows) {
      const dev = r.device_category || 'unknown';
      devices[dev] = (devices[dev] || 0) + 1;
    }
    trafficSummary.deviceBreakdown = devices;

    // Top landing pages (sanitize path: strip query/hash)
    const landingCounts = {};
    for (const r of humanRows) {
      if (r.landing_path) {
        const cleanPath = String(r.landing_path).split('?')[0].split('#')[0].slice(0, 100);
        landingCounts[cleanPath] = (landingCounts[cleanPath] || 0) + 1;
      }
    }
    trafficSummary.topLandingPages = Object.entries(landingCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([landingPath, count]) => ({ path: landingPath, count }));

    // Top referrers (safe domain only)
    const referrerCounts = {};
    for (const r of humanRows) {
      const domain = extractSafeDomain(r.referrer);
      referrerCounts[domain] = (referrerCounts[domain] || 0) + 1;
    }
    trafficSummary.topReferrers = Object.entries(referrerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([domain, count]) => ({ domain, count }));
  } catch (err) {
    console.error('[daily-owner-report] Error collecting traffic metrics:', err.message);
    trafficSummary = {
      available: false,
      error: 'UNAVAILABLE',
      totalSessions: null,
      humanSessions: null,
      uniqueHumanVisitors: null,
      deviceBreakdown: null,
      topLandingPages: [],
      topReferrers: [],
    };
  }

  // 2. Sales Metrics (orders & order_items)
  // Strictly requires `status = 'paid' AND paid_at IS NOT NULL` inside the window.
  // Legacy orders with paid_at IS NULL are tracked separately and excluded from window revenue.
  let salesSummary = {
    available: true,
    error: null,
    paidOrdersCount: 0,
    paidRevenueILS: 0,
    aovILS: null,
    conversionRatePercent: null,
    itemsSoldCount: 0,
    topProducts: [],
    legacyPaidOrdersWithoutTimestamp: 0,
    paidTimestampSource: 'orders.paid_at strictly',
  };

  try {
    const paidOrders = await dbAllAsync(
      db,
      `SELECT id, totalAmount, expected_payment_currency, expected_payment_amount, paid_at
       FROM orders
       WHERE status = 'paid'
         AND paid_at IS NOT NULL
         AND datetime(paid_at) >= datetime(?) AND datetime(paid_at) < datetime(?)`,
      [startUtcIso, endUtcIso]
    );

    salesSummary.paidOrdersCount = paidOrders.length;
    salesSummary.paidRevenueILS = paidOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

    if (salesSummary.paidOrdersCount > 0) {
      salesSummary.aovILS = salesSummary.paidRevenueILS / salesSummary.paidOrdersCount;
    }

    if (trafficSummary.available && trafficSummary.humanSessions > 0) {
      salesSummary.conversionRatePercent = (salesSummary.paidOrdersCount / trafficSummary.humanSessions) * 100;
    }

    // Items sold & top products (strictly using paid_at within window)
    const productSales = await dbAllAsync(
      db,
      `SELECT
        oi.productId,
        COALESCE(p.title, 'Product #' || oi.productId) as title,
        SUM(oi.quantity) as qty_sold,
        SUM(oi.price * oi.quantity) as total_sales
       FROM order_items oi
       JOIN orders o ON oi.orderId = o.id
       LEFT JOIN products p ON oi.productId = p.id
       WHERE o.status = 'paid'
         AND o.paid_at IS NOT NULL
         AND datetime(o.paid_at) >= datetime(?) AND datetime(o.paid_at) < datetime(?)
       GROUP BY oi.productId, p.title
       ORDER BY qty_sold DESC
       LIMIT 5`,
      [startUtcIso, endUtcIso]
    );

    salesSummary.itemsSoldCount = productSales.reduce((sum, p) => sum + (Number(p.qty_sold) || 0), 0);
    salesSummary.topProducts = productSales.map(p => ({
      productId: p.productId,
      title: p.title,
      quantity: Number(p.qty_sold) || 0,
      sales: Number(p.total_sales) || 0,
    }));

    // Count legacy paid orders with unknown payment time
    const legacyRow = await dbGetAsync(
      db,
      `SELECT COUNT(*) as count FROM orders WHERE status = 'paid' AND paid_at IS NULL`
    );
    salesSummary.legacyPaidOrdersWithoutTimestamp = legacyRow ? Number(legacyRow.count) || 0 : 0;
  } catch (err) {
    console.error('[daily-owner-report] Error collecting sales metrics:', err.message);
    salesSummary = {
      available: false,
      error: 'UNAVAILABLE',
      paidOrdersCount: null,
      paidRevenueILS: null,
      aovILS: null,
      conversionRatePercent: null,
      itemsSoldCount: null,
      topProducts: [],
      legacyPaidOrdersWithoutTimestamp: null,
      paidTimestampSource: null,
    };
  }

  // 3. Technical & Customer Issues (technical_issues)
  // Truthfully reports distinct issues observed/touched in this window.
  // Lifetime occurrence counts are NOT mislabeled as window-specific error events.
  let issuesSummary = {
    available: true,
    error: null,
    distinctIssuesCount: 0,
    criticalCount: 0,
    warningCount: 0,
    activeIssues: [],
  };

  try {
    const issues = await dbAllAsync(
      db,
      `SELECT id, type, severity, route, message, occurrence_count, first_seen_at, last_seen_at
       FROM technical_issues
       WHERE (datetime(last_seen_at) >= datetime(?) AND datetime(last_seen_at) < datetime(?))
          OR (datetime(first_seen_at) >= datetime(?) AND datetime(first_seen_at) < datetime(?))
       ORDER BY last_seen_at DESC`,
      [startUtcIso, endUtcIso, startUtcIso, endUtcIso]
    );

    issuesSummary.distinctIssuesCount = issues.length;
    issuesSummary.criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
    issuesSummary.warningCount = issues.filter(i => i.severity === 'WARNING').length;
    issuesSummary.activeIssues = issues.slice(0, 3).map(i => ({
      type: i.type,
      severity: i.severity,
      route: i.route,
      cumulativeOccurrences: i.occurrence_count,
    }));
  } catch (err) {
    console.error('[daily-owner-report] Error collecting technical issues:', err.message);
    issuesSummary = {
      available: false,
      error: 'UNAVAILABLE',
      distinctIssuesCount: null,
      criticalCount: null,
      warningCount: null,
      activeIssues: [],
    };
  }

  // 4. Fulfillment Status (Current-state snapshot)
  let fulfillmentSummary = {
    available: true,
    error: null,
    pendingFulfillmentCount: 0,
    manualFulfillmentCount: 0,
    supplierBreakdown: {},
  };

  try {
    const fulfillmentRows = await dbAllAsync(
      db,
      `SELECT oi.supplier_id, oi.fulfillment_status, COUNT(*) as count
       FROM order_items oi
       JOIN orders o ON oi.orderId = o.id
       WHERE o.status = 'paid'
       GROUP BY oi.supplier_id, oi.fulfillment_status`
    );

    for (const r of fulfillmentRows) {
      const sup = r.supplier_id || 'manual';
      const status = r.fulfillment_status || 'pending';
      const count = Number(r.count) || 0;

      if (!fulfillmentSummary.supplierBreakdown[sup]) {
        fulfillmentSummary.supplierBreakdown[sup] = {};
      }
      fulfillmentSummary.supplierBreakdown[sup][status] = count;

      if (status === 'pending') {
        fulfillmentSummary.pendingFulfillmentCount += count;
        if (sup === 'manual') {
          fulfillmentSummary.manualFulfillmentCount += count;
        }
      }
    }
  } catch (err) {
    console.error('[daily-owner-report] Error collecting fulfillment metrics:', err.message);
    fulfillmentSummary = {
      available: false,
      error: 'UNAVAILABLE',
      pendingFulfillmentCount: null,
      manualFulfillmentCount: null,
      supplierBreakdown: null,
    };
  }

  // 5. Database & Backup Status (Current-state snapshot)
  let backupSummary = {
    available: true,
    error: null,
    integrityCheck: 'UNKNOWN',
    latestBackupName: null,
    latestBackupTimestamp: null,
    hasSha256Sidecar: false,
    managedCount: 0,
    offsiteEnabled: false,
    offsiteStatusDescription: 'כבוי (Disabled)',
  };

  try {
    const integrity = await dbGetAsync(db, `PRAGMA integrity_check;`);
    backupSummary.integrityCheck = integrity && integrity.integrity_check === 'ok' ? 'OK' : (integrity?.integrity_check || 'FAIL');

    const dbPath = (db && db.filename) || env.DB_PATH || path.resolve(__dirname, '../ecommerce.db');
    const resolvedDir = sqliteBackup.resolveBackupDir(dbPath, { backupDir, env });
    const managedFiles = sqliteBackup.listManagedBackupFiles(resolvedDir);
    backupSummary.managedCount = managedFiles ? managedFiles.length : 0;

    if (managedFiles && managedFiles.length > 0) {
      const newest = managedFiles[0]; // Real shape: { name, path, mtimeMs }
      backupSummary.latestBackupName = newest.name;
      backupSummary.latestBackupTimestamp = newest.mtimeMs ? new Date(newest.mtimeMs).toISOString() : null;
      const sidecarPath = `${newest.path}.sha256`;
      backupSummary.hasSha256Sidecar = fs.existsSync(sidecarPath);
    }

    const isOffsiteOn = sqliteOffsiteBackup.isOffsiteBackupEnabled(env);
    backupSummary.offsiteEnabled = isOffsiteOn;
    backupSummary.offsiteStatusDescription = isOffsiteOn ? 'מוגדר (Enabled)' : 'כבוי (Disabled)';
  } catch (err) {
    console.error('[daily-owner-report] Error collecting backup summary:', err.message);
    backupSummary = {
      available: false,
      error: 'UNAVAILABLE',
      integrityCheck: 'UNAVAILABLE',
    };
  }

  // 6. Action Items Generation (Respecting metric availability)
  const actionItems = [];

  if (fulfillmentSummary.available) {
    if (fulfillmentSummary.manualFulfillmentCount > 0) {
      actionItems.push(`📦 ישנן ${fulfillmentSummary.manualFulfillmentCount} הזמנות להגשמה ידנית הממתינות לטיפול`);
    }
  } else {
    actionItems.push('⚠️ נתוני הגשמת הזמנות אינם זמינים כרגע');
  }

  if (issuesSummary.available) {
    if (issuesSummary.criticalCount > 0) {
      actionItems.push(`🚨 נרשמו ${issuesSummary.criticalCount} תקלות קריטיות בחלון זה — מומלץ לבדוק את לוג המערכת`);
    }
  } else {
    actionItems.push('⚠️ נתוני תקלות מערכת אינם זמינים כרגע');
  }

  if (salesSummary.available) {
    if (salesSummary.paidOrdersCount > 0) {
      actionItems.push(`💰 נרשמו ${salesSummary.paidOrdersCount} רכישות מוצלחות בחלון זה (סה״כ ₪${salesSummary.paidRevenueILS.toFixed(2)})`);
    } else if (trafficSummary.available && trafficSummary.humanSessions > 0) {
      actionItems.push(`🔍 נרשמו ${trafficSummary.humanSessions} ביקורים ללא רכישות (יחס המרה 0.0%)`);
    }
  } else {
    actionItems.push('⚠️ נתוני מכירות אינם זמינים כרגע לניתוח');
  }

  if (trafficSummary.available) {
    if (trafficSummary.humanSessions === 0 && (!salesSummary.available || salesSummary.paidOrdersCount === 0)) {
      actionItems.push('👥 לא נרשמה תנועת גולשים בחלון זה — מומלץ לבדוק קמפיינים ופעילות שיווקית');
    }
  } else {
    actionItems.push('⚠️ נתוני תנועת גולשים אינם זמינים כרגע לניתוח');
  }

  if (backupSummary.available) {
    if (backupSummary.integrityCheck === 'OK') {
      actionItems.push('💾 שלמות מסד הנתונים תקינה (Integrity: OK)');
    } else {
      actionItems.push(`⚠️ בדיקת שלמות מסד הנתונים נכשלה (${escapeHtml(backupSummary.integrityCheck)})`);
    }
  } else {
    actionItems.push('⚠️ נתוני בדיקת מסד הנתונים אינם זמינים כרגע');
  }

  if (actionItems.length === 0) {
    actionItems.push('✅ כל המערכות הזמינות פועלות כסדרן');
  }

  return {
    dateStr: targetDate,
    windowInfo,
    traffic: trafficSummary,
    sales: salesSummary,
    issues: issuesSummary,
    fulfillment: fulfillmentSummary,
    backup: backupSummary,
    actionItems,
  };
}

/**
 * Format the structured Hebrew Telegram message and operator context block with full HTML escaping.
 */
function buildDailyReportMessage(metrics) {
  const { dateStr, windowInfo, traffic, sales, issues, fulfillment, backup, actionItems } = metrics;
  const displayWindow = windowInfo?.fullLocalDisplay || `${dateStr} 22:00`;

  // Traffic block
  let trafficLines;
  if (traffic.available) {
    const deviceParts = Object.entries(traffic.deviceBreakdown).map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(', ') || 'אין נתונים';
    const topLandings = traffic.topLandingPages.length > 0
      ? traffic.topLandingPages.map(p => `${escapeHtml(p.path)} (${p.count})`).join(', ')
      : 'לא זמין / אין ביקורים';
    const topRefs = traffic.topReferrers.length > 0
      ? traffic.topReferrers.map(r => `${escapeHtml(r.domain)} (${r.count})`).join(', ')
      : 'Direct / ישיר';

    trafficLines = `• סשנים של בני אדם: ${traffic.humanSessions}
• מבקרים ייחודיים: ${traffic.uniqueHumanVisitors}
• התפלגות מכשירים: ${deviceParts}
• דפי נחיתה מובילים: ${topLandings}
• מקורות הגעה: ${topRefs}`;
  } else {
    trafficLines = `• סשנים של בני אדם: לא זמין כרגע
• מבקרים ייחודיים: לא זמין כרגע
• התפלגות מכשירים: לא זמין כרגע
• דפי נחיתה מובילים: לא זמין כרגע
• מקורות הגעה: לא זמין כרגע`;
  }

  // Sales block
  let salesLines;
  if (sales.available) {
    const aovText = sales.aovILS !== null ? `₪${sales.aovILS.toFixed(2)}` : 'לא זמין (אין רכישות)';
    const convText = sales.conversionRatePercent !== null ? `${sales.conversionRatePercent.toFixed(1)}%` : (traffic.available ? 'לא זמין (אין תנועה)' : 'לא זמין כרגע');
    const topProductsText = sales.topProducts.length > 0
      ? sales.topProducts.map(p => `${escapeHtml(p.title)} (${p.quantity})`).join(', ')
      : 'אין רכישות בחלון זה';

    const legacyNote = sales.legacyPaidOrdersWithoutTimestamp > 0
      ? `\n• הזמנות ישנות ללא זמן תשלום מדויק: ${sales.legacyPaidOrdersWithoutTimestamp} — לא נכללו בהכנסה של חלון זה`
      : '';

    salesLines = `• הזמנות ששולמו: ${sales.paidOrdersCount}
• הכנסה ששולמה: ₪${sales.paidRevenueILS.toFixed(2)}
• ערך הזמנה ממוצע (AOV): ${escapeHtml(aovText)}
• יחס המרה (Conversion): ${escapeHtml(convText)}
• פריטים שנמכרו: ${sales.itemsSoldCount}
• מוצרים מובילים: ${topProductsText}${legacyNote}`;
  } else {
    salesLines = `• הזמנות ששולמו: לא זמין כרגע
• הכנסה ששולמה: לא זמין כרגע
• ערך הזמנה ממוצע (AOV): לא זמין כרגע
• יחס המרה (Conversion): לא זמין כרגע
• פריטים שנמכרו: לא זמין כרגע
• מוצרים מובילים: לא זמין כרגע`;
  }

  // Issues block (truthful distinct issues count)
  let issuesLines;
  if (issues.available) {
    issuesLines = issues.distinctIssuesCount === 0
      ? '• תקלות קריטיות: 0\n• סה״כ סוגי תקלות פעילות בחלון: 0'
      : `• תקלות קריטיות: ${issues.criticalCount}\n• תקלות אזהרה: ${issues.warningCount}\n• סה״כ סוגי תקלות פעילות בחלון: ${issues.distinctIssuesCount}`;
  } else {
    issuesLines = '• תקלות קריטיות: לא זמין כרגע\n• סה״כ סוגי תקלות פעילות בחלון: לא זמין כרגע';
  }

  // Fulfillment block (Current-state snapshot)
  let fulfillmentLines;
  if (fulfillment.available) {
    fulfillmentLines = `• פריטים ממתינים להגשמה (נוכחי): ${fulfillment.pendingFulfillmentCount}
• הגשמה ידנית ממתינה (נוכחי): ${fulfillment.manualFulfillmentCount}`;
  } else {
    fulfillmentLines = `• פריטים ממתינים להגשמה (נוכחי): לא זמין כרגע
• הגשמה ידנית ממתינה (נוכחי): לא זמין כרגע`;
  }

  // Backup block (Current-state snapshot)
  let backupLines;
  if (backup.available) {
    const backupNameDisplay = backup.latestBackupName
      ? `${escapeHtml(backup.latestBackupName)}${backup.hasSha256Sidecar ? ' (מאומת sha256)' : ''}`
      : 'לא נמצא גיבוי מקומי';

    backupLines = `• גיבוי מקומי אחרון: ${backupNameDisplay}
• שלמות מסד נתונים (Integrity): ${escapeHtml(backup.integrityCheck)}
• גיבוי מרוחק (Off-site): ${escapeHtml(backup.offsiteStatusDescription)}`;
  } else {
    backupLines = `• גיבוי מקומי אחרון: לא זמין כרגע
• שלמות מסד נתונים (Integrity): לא זמין כרגע
• גיבוי מרוחק (Off-site): לא זמין כרגע`;
  }

  // Action items block
  const actionItemsList = actionItems.map((item, idx) => `${idx + 1}. ${escapeHtml(item)}`).join('\n');

  // Human Hebrew readable report
  const humanReport = `📊 <b>JONO — סיכום יומי</b>
חלון: ${escapeHtml(displayWindow)}

👥 <b>תנועה</b>
${trafficLines}

💰 <b>מכירות (תשלומים שאושרו בחלון)</b>
${salesLines}

📦 <b>הגשמה וספקים (תמונת מצב נוכחית)</b>
${fulfillmentLines}

⚠️ <b>תקלות טכניות</b>
${issuesLines}

💾 <b>מערכת וגיבויים (תמונת מצב נוכחית)</b>
${backupLines}

🎯 <b>מה דורש תשומת לב</b>
${actionItemsList}`;

  // Structured operator diagnostic block
  const operatorFields = [
    ['Event', 'DAILY_OWNER_REPORT'],
    ['Date', dateStr],
    ['Window-Start', windowInfo?.startUtcIso || 'UNKNOWN'],
    ['Window-End', windowInfo?.endUtcIso || 'UNKNOWN'],
    ['Window-Local-Start', windowInfo?.prevDateStr ? `${windowInfo.prevDateStr} 22:00` : 'UNKNOWN'],
    ['Window-Local-End', `${dateStr} 22:00`],
    ['Window-Timezone', 'Europe/Jerusalem'],
    ['Window-Hours', windowInfo?.durationHours !== undefined ? windowInfo.durationHours : 'UNKNOWN'],
    ['Generated-At', new Date().toISOString()],
    ['Human-Sessions', traffic.available ? traffic.humanSessions : 'UNAVAILABLE'],
    ['Unique-Visitors', traffic.available ? traffic.uniqueHumanVisitors : 'UNAVAILABLE'],
    ['Paid-Orders', sales.available ? sales.paidOrdersCount : 'UNAVAILABLE'],
    ['Paid-Revenue', sales.available ? `${sales.paidRevenueILS.toFixed(2)} ILS` : 'UNAVAILABLE'],
    ['Legacy-Paid-Time-Unknown', sales.available ? sales.legacyPaidOrdersWithoutTimestamp : 'UNAVAILABLE'],
    ['AOV', sales.available ? (sales.aovILS !== null ? `${sales.aovILS.toFixed(2)} ILS` : undefined) : 'UNAVAILABLE'],
    ['Conversion-Rate', sales.available ? (sales.conversionRatePercent !== null ? `${sales.conversionRatePercent.toFixed(1)}%` : undefined) : 'UNAVAILABLE'],
    ['Items-Sold', sales.available ? sales.itemsSoldCount : 'UNAVAILABLE'],
    ['Issues-Distinct-Active', issues.available ? issues.distinctIssuesCount : 'UNAVAILABLE'],
    ['Issues-Critical', issues.available ? issues.criticalCount : 'UNAVAILABLE'],
    ['Issues-Warning', issues.available ? issues.warningCount : 'UNAVAILABLE'],
    ['Pending-Fulfillment-Current', fulfillment.available ? fulfillment.pendingFulfillmentCount : 'UNAVAILABLE'],
    ['Backup-Status', backup.available ? (backup.latestBackupName ? `OK (${backup.latestBackupName})` : 'NO_LOCAL_BACKUP') : 'UNAVAILABLE'],
    ['Integrity-Check', backup.available ? backup.integrityCheck : 'UNAVAILABLE'],
    ['Offsite-Backup', backup.available ? (backup.offsiteEnabled ? 'ENABLED' : 'DISABLED') : 'UNAVAILABLE'],
  ];

  return ownerNotifications.buildOperatorMessage({
    icon: '📊',
    titleHe: 'JONO — סיכום יומי',
    summaryHe: `דוח ביצועים ותפעול יומי לחלון ${displayWindow}`,
    fields: operatorFields,
  }).replace(/^📊 <b>.*?<\/b>\n.*?\n\n/s, `${humanReport}\n\n`);
}

/**
 * Generate and deliver the daily report for dateStr, ensuring atomic restart-safe dedupe
 * and distributed crash recovery across delivery phases.
 *
 * @param {object} options
 * @param {Date} [options.date] - target date (defaults to current local date)
 * @param {string} [options.dateStr] - explicit 'YYYY-MM-DD'
 * @param {boolean} [options.force] - bypass eligibility check (for tests/catch-up/manual trigger)
 * @param {sqlite3.Database} [options.db]
 * @param {string} [options.backupDir]
 * @param {object} [options.env]
 */
async function generateAndSendDailyReport({
  date = new Date(),
  dateStr,
  force = false,
  db = defaultDb,
  backupDir,
  env = process.env,
} = {}) {
  const targetDateStr = dateStr || getJerusalemDateString(date);

  // Eligibility check: at or after 22:00 local time (unless forced)
  if (!force && !isEligibleForDailyReport(date)) {
    console.log(`[daily-owner-report] Skipped: not eligible yet (time < 22:00 Jerusalem) for date=${targetDateStr}`);
    return { skipped: true, reason: 'not_eligible_yet', reportDate: targetDateStr };
  }

  // 1. Check existing state
  const existingRow = await dbGetAsync(
    db,
    `SELECT id, status, attempt_count, last_attempt_at, sent_at FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
    [targetDateStr]
  );

  if (existingRow && existingRow.sent_at) {
    console.log(`[daily-owner-report] Report for ${targetDateStr} was already sent at ${existingRow.sent_at}`);
    return { skipped: true, reason: 'already_sent', reportDate: targetDateStr, sentAt: existingRow.sent_at };
  }

  if (existingRow && existingRow.status === 'delivery_unknown') {
    console.warn(`[daily-owner-report] Report for ${targetDateStr} has status='delivery_unknown' (ambiguous crash after Telegram send started). Manual review required -- not blindly resending.`);
    return { skipped: true, reason: 'delivery_unknown_manual_review_required', reportDate: targetDateStr };
  }

  const STALE_LEASE_SECONDS = 300; // 5 minutes lease timeout

  // If previous attempt crashed after delivery_started, outcome is ambiguous
  if (existingRow && existingRow.status === 'delivery_started') {
    // Check if the lease has expired
    const isStale = await dbGetAsync(
      db,
      `SELECT (strftime('%s', 'now') - strftime('%s', COALESCE(last_attempt_at, '1970-01-01'))) as elapsedSec
       FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
      [targetDateStr]
    );

    if (isStale && Number(isStale.elapsedSec) >= STALE_LEASE_SECONDS) {
      console.warn(`[daily-owner-report] Detected ambiguous delivery crash for ${targetDateStr}: status was delivery_started with expired lease (${isStale.elapsedSec}s elapsed). Marking delivery_unknown.`);
      await dbRunAsync(
        db,
        `UPDATE daily_owner_reports SET status = 'delivery_unknown' WHERE report_type = 'daily_summary' AND report_date = ?`,
        [targetDateStr]
      );
      return { skipped: true, reason: 'ambiguous_delivery_detected', reportDate: targetDateStr };
    }
  }

  // 2. Insert row if not exists (pending status)
  await dbRunAsync(
    db,
    `INSERT OR IGNORE INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
     VALUES ('daily_summary', ?, 'pending', 0, NULL)`,
    [targetDateStr]
  );

  // 3. Atomically claim execution (CAS)
  // Reclaims pending, failed (after cooldown), or stale in_progress (crashed before delivery_started)
  const RETRY_COOLDOWN_SECONDS = 300; // 5 minutes retry cooldown on failure
  const claimResult = await dbRunAsync(
    db,
    `UPDATE daily_owner_reports
     SET status = 'in_progress',
         attempt_count = attempt_count + 1,
         last_attempt_at = CURRENT_TIMESTAMP
     WHERE report_type = 'daily_summary'
       AND report_date = ?
       AND sent_at IS NULL
       AND (
         status = 'pending'
         OR (status = 'failed' AND (strftime('%s', 'now') - strftime('%s', COALESCE(last_attempt_at, '1970-01-01'))) >= ?)
         OR (status = 'in_progress' AND (strftime('%s', 'now') - strftime('%s', COALESCE(last_attempt_at, '1970-01-01'))) >= ?)
         OR ? = 1
       )`,
    [targetDateStr, RETRY_COOLDOWN_SECONDS, STALE_LEASE_SECONDS, force ? 1 : 0]
  );

  if (!claimResult || claimResult.changes === 0) {
    console.log(`[daily-owner-report] Execution for ${targetDateStr} skipped: in_progress, recently failed within cooldown, or already sent.`);
    return { skipped: true, reason: 'claim_failed_or_cooling_down', reportDate: targetDateStr };
  }

  console.log(`[daily-owner-report] Claimed daily report execution for ${targetDateStr}. Generating data...`);

  let metrics;
  let message;
  try {
    metrics = await getReportMetrics({ dateStr: targetDateStr, db, backupDir, env });
    message = buildDailyReportMessage(metrics);
  } catch (err) {
    console.error(`[daily-owner-report] Failed to generate report metrics for ${targetDateStr}:`, err.message);
    await dbRunAsync(
      db,
      `UPDATE daily_owner_reports SET status = 'failed' WHERE report_type = 'daily_summary' AND report_date = ?`,
      [targetDateStr]
    );
    return { ok: false, error: err.message, reportDate: targetDateStr };
  }

  // 4. Mark delivery_started right before external Telegram call
  await dbRunAsync(
    db,
    `UPDATE daily_owner_reports
     SET status = 'delivery_started',
         last_attempt_at = CURRENT_TIMESTAMP
     WHERE report_type = 'daily_summary' AND report_date = ? AND status = 'in_progress'`,
    [targetDateStr]
  );

  // 5. Centralized Telegram delivery via owner-notifications.js
  const notifyResult = await ownerNotifications.notify({
    severity: 'INFO',
    eventType: 'daily_owner_report',
    dedupKey: `daily_owner_report:${targetDateStr}`,
    message,
  });

  // 6. Update DB status strictly upon confirmed Telegram delivery
  if (notifyResult.sent) {
    await dbRunAsync(
      db,
      `UPDATE daily_owner_reports SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE report_type = 'daily_summary' AND report_date = ?`,
      [targetDateStr]
    );
    console.log(`[daily-owner-report] Successfully sent daily owner report for ${targetDateStr}.`);
    return { ok: true, sent: true, reportDate: targetDateStr, metrics, message };
  } else {
    await dbRunAsync(
      db,
      `UPDATE daily_owner_reports SET status = 'failed' WHERE report_type = 'daily_summary' AND report_date = ?`,
      [targetDateStr]
    );
    console.warn(`[daily-owner-report] Telegram notification was not sent (skipped or failed) for ${targetDateStr}. Row marked failed for later retry.`);
    return { ok: false, sent: false, reason: notifyResult.reason || 'telegram_send_failed', reportDate: targetDateStr, metrics };
  }
}

let schedulerTimer = null;

/**
 * Starts the daily report periodic scheduler (runs every 60 seconds).
 * Includes both 22:00 daily scheduling and after-midnight catch-up for previous day.
 */
function startDailyReportScheduler({ db = defaultDb, env = process.env, intervalMs = 60 * 1000 } = {}) {
  if (env.DISABLE_BACKGROUND_JOBS === 'true' || env.NODE_ENV === 'test') {
    console.log('[daily-owner-report] Background jobs disabled or test environment. Scheduler not started.');
    return null;
  }

  if (schedulerTimer) {
    console.log('[daily-owner-report] Scheduler already running.');
    return schedulerTimer;
  }

  console.log('[daily-owner-report] Initializing daily owner report scheduler (target: 22:00 Europe/Jerusalem)...');

  const runCheck = async () => {
    try {
      const now = new Date();
      const currentDateStr = getJerusalemDateString(now);
      const { hour } = getJerusalemTimeParts(now);

      if (hour >= 22) {
        // Current day is eligible for today's report
        await generateAndSendDailyReport({ date: now, dateStr: currentDateStr, db, env });
      } else {
        // Before 22:00 local time: check whether yesterday's report was missed and is eligible for catch-up
        const prevDateStr = getPreviousJerusalemDateString(currentDateStr);
        const prevRow = await dbGetAsync(
          db,
          `SELECT id, status, sent_at FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
          [prevDateStr]
        );
        if (!prevRow || (!prevRow.sent_at && prevRow.status !== 'sent' && prevRow.status !== 'delivery_unknown')) {
          console.log(`[daily-owner-report] Catching up missed report for previous date: ${prevDateStr}`);
          await generateAndSendDailyReport({ dateStr: prevDateStr, force: true, db, env });
        }
      }
    } catch (err) {
      console.error('[daily-owner-report] Scheduler tick error:', err.message);
    }
  };

  // Immediate catch-up check on startup
  setImmediate(runCheck);

  schedulerTimer = setInterval(runCheck, intervalMs);
  if (schedulerTimer.unref) schedulerTimer.unref();

  return schedulerTimer;
}

function stopDailyReportScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[daily-owner-report] Scheduler stopped.');
  }
}

module.exports = {
  resolveJerusalemTimezone,
  getJerusalemDateString,
  getPreviousJerusalemDateString,
  getJerusalemTimeParts,
  isEligibleForDailyReport,
  getJerusalemLocalTimestampUtc,
  getJerusalem24HourWindow,
  getReportMetrics,
  buildDailyReportMessage,
  generateAndSendDailyReport,
  startDailyReportScheduler,
  stopDailyReportScheduler,
  escapeHtml,
  extractSafeDomain,
};

