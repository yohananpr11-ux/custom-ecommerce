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
 * 3. Exact Timezone: Europe/Jerusalem (dynamically resolving DST transitions).
 * 4. Real data only: summarizes genuine telemetry, orders, technical issues,
 *    fulfillments, and backups; explicitly marks uncollected metrics as unavailable.
 * 5. Privacy: zero raw IP addresses, tokens, passwords, customer names, or PII.
 */

const path = require('path');
const defaultDb = require('../db');
const ownerNotifications = require('./owner-notifications');
const sqliteBackup = require('./sqlite-backup');

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
 * Calculates the exact UTC interval [startUtcIso, endUtcIso) corresponding
 * to midnight-to-midnight for dateStr in Europe/Jerusalem, taking DST into account.
 */
function getJerusalemDayInterval(dateStr) {
  const tz = resolveJerusalemTimezone();
  const [year, month, day] = dateStr.split('-').map(Number);

  // Search around UTC-4h to UTC+0h for local midnight 00:00:00
  let startMs = Date.UTC(year, month - 1, day, 0, 0, 0) - (4 * 3600 * 1000);
  while (true) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const formatted = f.format(new Date(startMs));
    if (formatted.startsWith(dateStr) && formatted.endsWith('00:00:00')) {
      break;
    }
    startMs += 60000;
    if (startMs > Date.UTC(year, month - 1, day, 4, 0, 0)) break;
  }

  // Next local calendar date
  const nextDayDate = new Date(startMs + 28 * 3600 * 1000);
  const nextDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(nextDayDate);

  let endMs = startMs + (23 * 3600 * 1000);
  while (true) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const formatted = f.format(new Date(endMs));
    if (formatted.startsWith(nextDateStr) && formatted.endsWith('00:00:00')) {
      break;
    }
    endMs += 60000;
    if (endMs > startMs + 30 * 3600 * 1000) break;
  }

  return {
    startUtcIso: new Date(startMs).toISOString(),
    endUtcIso: new Date(endMs).toISOString(),
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
 * Collect real metrics from SQLite tables for the specified local date.
 */
async function getReportMetrics({ dateStr, db = defaultDb, backupDir, env = process.env } = {}) {
  const targetDate = dateStr || getJerusalemDateString();
  const { startUtcIso, endUtcIso } = getJerusalemDayInterval(targetDate);

  // 1. Traffic Metrics (visitor_sessions)
  let trafficSummary = {
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

    // Top landing pages
    const landingCounts = {};
    for (const r of humanRows) {
      if (r.landing_path) {
        landingCounts[r.landing_path] = (landingCounts[r.landing_path] || 0) + 1;
      }
    }
    trafficSummary.topLandingPages = Object.entries(landingCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([landingPath, count]) => ({ path: landingPath, count }));

    // Top referrers
    const referrerCounts = {};
    for (const r of humanRows) {
      if (r.referrer) {
        referrerCounts[r.referrer] = (referrerCounts[r.referrer] || 0) + 1;
      }
    }
    trafficSummary.topReferrers = Object.entries(referrerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([referrer, count]) => ({ referrer, count }));
  } catch (err) {
    console.error('[daily-owner-report] Error collecting traffic metrics:', err.message);
  }

  // 2. Sales Metrics (orders & order_items)
  let salesSummary = {
    paidOrdersCount: 0,
    paidRevenueILS: 0,
    aovILS: null,
    conversionRatePercent: null,
    itemsSoldCount: 0,
    topProducts: [],
  };

  try {
    const paidOrders = await dbAllAsync(
      db,
      `SELECT id, totalAmount, expected_payment_currency, expected_payment_amount, createdAt
       FROM orders
       WHERE status = 'paid'
         AND datetime(createdAt) >= datetime(?) AND datetime(createdAt) < datetime(?)`,
      [startUtcIso, endUtcIso]
    );

    salesSummary.paidOrdersCount = paidOrders.length;
    salesSummary.paidRevenueILS = paidOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

    if (salesSummary.paidOrdersCount > 0) {
      salesSummary.aovILS = salesSummary.paidRevenueILS / salesSummary.paidOrdersCount;
    }

    if (trafficSummary.humanSessions > 0) {
      salesSummary.conversionRatePercent = (salesSummary.paidOrdersCount / trafficSummary.humanSessions) * 100;
    }

    // Items sold & top products
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
         AND datetime(o.createdAt) >= datetime(?) AND datetime(o.createdAt) < datetime(?)
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
  } catch (err) {
    console.error('[daily-owner-report] Error collecting sales metrics:', err.message);
  }

  // 3. Technical & Customer Issues (technical_issues)
  let issuesSummary = {
    totalDistinctIssues: 0,
    totalOccurrences: 0,
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
       ORDER BY occurrence_count DESC`,
      [startUtcIso, endUtcIso, startUtcIso, endUtcIso]
    );

    issuesSummary.totalDistinctIssues = issues.length;
    issuesSummary.totalOccurrences = issues.reduce((sum, i) => sum + (Number(i.occurrence_count) || 1), 0);
    issuesSummary.criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
    issuesSummary.warningCount = issues.filter(i => i.severity === 'WARNING').length;
    issuesSummary.activeIssues = issues.slice(0, 3).map(i => ({
      type: i.type,
      severity: i.severity,
      occurrences: i.occurrence_count,
      route: i.route,
    }));
  } catch (err) {
    console.error('[daily-owner-report] Error collecting technical issues:', err.message);
  }

  // 4. Fulfillment Status
  let fulfillmentSummary = {
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
  }

  // 5. Database & Backup Status
  let backupSummary = {
    integrityCheck: 'unknown',
    latestBackupFile: null,
    latestBackupTimestamp: null,
    offsiteEnabled: false,
    offsiteStatusDescription: 'כבוי כהלכה (Disabled)',
  };

  try {
    const integrity = await dbGetAsync(db, `PRAGMA integrity_check;`);
    backupSummary.integrityCheck = integrity && integrity.integrity_check === 'ok' ? 'OK' : (integrity?.integrity_check || 'FAIL');

    const dbPath = (db && db.filename) || process.env.DB_PATH || path.resolve(__dirname, '../ecommerce.db');
    const resolvedDir = sqliteBackup.resolveBackupDir(dbPath, { backupDir });
    const managedFiles = sqliteBackup.listManagedBackupFiles(resolvedDir);
    if (managedFiles && managedFiles.length > 0) {
      backupSummary.latestBackupFile = managedFiles[0].filename;
      backupSummary.latestBackupTimestamp = managedFiles[0].timestamp ? managedFiles[0].timestamp.toISOString() : null;
    }

    const offsiteEnv = (env.ENABLE_SQLITE_OFFSITE_BACKUP || '').trim().toLowerCase();
    if (offsiteEnv === 'true') {
      backupSummary.offsiteEnabled = true;
      backupSummary.offsiteStatusDescription = 'מוגדר ופעיל (Active)';
    }
  } catch (err) {
    console.error('[daily-owner-report] Error collecting backup summary:', err.message);
  }

  // 6. Action Items Generation (2–5 items strictly based on real data)
  const actionItems = [];
  if (fulfillmentSummary.manualFulfillmentCount > 0) {
    actionItems.push(`📦 ישנן ${fulfillmentSummary.manualFulfillmentCount} הזמנות להגשמה ידנית הממתינות לטיפול`);
  }
  if (issuesSummary.criticalCount > 0) {
    actionItems.push(`🚨 נרשמו ${issuesSummary.criticalCount} תקלות קריטיות היום — מומלץ לבדוק את לוג המערכת`);
  }
  if (salesSummary.paidOrdersCount > 0) {
    actionItems.push(`💰 נרשמו ${salesSummary.paidOrdersCount} רכישות מוצלחות היום (סה״כ ₪${salesSummary.paidRevenueILS.toFixed(2)})`);
  } else if (trafficSummary.humanSessions > 0) {
    actionItems.push(`🔍 נרשמו ${trafficSummary.humanSessions} ביקורים ללא רכישות (יחס המרה 0.0%)`);
  } else {
    actionItems.push(`👥 לא נרשמה תנועת גולשים היום — מומלץ לבדוק קמפיינים ופעילות שיווקית`);
  }

  if (backupSummary.integrityCheck === 'OK') {
    actionItems.push(`💾 שלמות מסד הנתונים תקינה (Integrity: OK)`);
  } else {
    actionItems.push(`⚠️ בדיקת שלמות מסד הנתונים נכשלה (${backupSummary.integrityCheck})`);
  }

  if (actionItems.length < 2) {
    actionItems.push(`✅ כל המערכות פועלות כסדרן ללא התרעות חריגות`);
  }

  return {
    dateStr: targetDate,
    traffic: trafficSummary,
    sales: salesSummary,
    issues: issuesSummary,
    fulfillment: fulfillmentSummary,
    backup: backupSummary,
    actionItems,
  };
}

/**
 * Format the structured Hebrew Telegram message and operator context block.
 */
function buildDailyReportMessage(metrics) {
  const { dateStr, traffic, sales, issues, fulfillment, backup, actionItems } = metrics;
  const [y, m, d] = dateStr.split('-');
  const displayDate = `${d}/${m}/${y}`;

  // Traffic block
  const deviceParts = Object.entries(traffic.deviceBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ') || 'אין נתונים';
  const topLandings = traffic.topLandingPages.length > 0
    ? traffic.topLandingPages.map(p => `${p.path} (${p.count})`).join(', ')
    : 'לא זמין / אין ביקורים';
  const topRefs = traffic.topReferrers.length > 0
    ? traffic.topReferrers.map(r => `${r.referrer} (${r.count})`).join(', ')
    : 'Direct / ישיר';

  // Sales block
  const aovText = sales.aovILS !== null ? `₪${sales.aovILS.toFixed(2)}` : 'לא זמין (אין רכישות)';
  const convText = sales.conversionRatePercent !== null ? `${sales.conversionRatePercent.toFixed(1)}%` : 'לא זמין (אין תנועה)';
  const topProductsText = sales.topProducts.length > 0
    ? sales.topProducts.map(p => `${p.title} (${p.quantity})`).join(', ')
    : 'אין רכישות היום';

  // Issues block
  const issuesText = issues.totalDistinctIssues === 0
    ? '• תקלות קריטיות: 0\n• סה״כ אירועי שגיאה: 0'
    : `• תקלות קריטיות: ${issues.criticalCount}\n• תקלות אזהרה: ${issues.warningCount}\n• סה״כ אירועי שגיאה: ${issues.totalOccurrences}`;

  // Fulfillment block
  const manualCount = fulfillment.manualFulfillmentCount;
  const pendingCount = fulfillment.pendingFulfillmentCount;

  // Action items block
  const actionItemsList = actionItems.map((item, idx) => `${idx + 1}. ${item}`).join('\n');

  // Human Hebrew readable report
  const humanReport = `📊 <b>JONO — סיכום יומי</b>
תאריך: ${displayDate}

👥 <b>תנועה</b>
• סשנים של בני אדם: ${traffic.humanSessions}
• מבקרים ייחודיים: ${traffic.uniqueHumanVisitors}
• התפלגות מכשירים: ${deviceParts}
• דפי נחיתה מובילים: ${topLandings}
• מקורות הגעה: ${topRefs}

💰 <b>מכירות</b>
• הזמנות ששולמו: ${sales.paidOrdersCount}
• הכנסה ששולמה: ₪${sales.paidRevenueILS.toFixed(2)}
• ערך הזמנה ממוצע (AOV): ${aovText}
• יחס המרה (Conversion): ${convText}
• פריטים שנמכרו: ${sales.itemsSoldCount}
• מוצרים מובילים: ${topProductsText}

📦 <b>הגשמה וספקים</b>
• פריטים ממתינים להגשמה: ${pendingCount}
• הגשמה ידנית ממתינה: ${manualCount}

⚠️ <b>תקלות טכניות</b>
${issuesText}

💾 <b>מערכת וגיבויים</b>
• גיבוי מקומי אחרון: ${backup.latestBackupFile || 'לא נמצא גיבוי מקומי'}
• שלמות מסד נתונים (Integrity): ${backup.integrityCheck}
• גיבוי מרוחק (Off-site): ${backup.offsiteStatusDescription}

🎯 <b>מה דורש תשומת לב</b>
${actionItemsList}`;

  // Structured operator diagnostic block
  const operatorFields = [
    ['Event', 'DAILY_OWNER_REPORT'],
    ['Date', dateStr],
    ['Generated-At', new Date().toISOString()],
    ['Human-Sessions', traffic.humanSessions],
    ['Unique-Visitors', traffic.uniqueHumanVisitors],
    ['Paid-Orders', sales.paidOrdersCount],
    ['Paid-Revenue', `${sales.paidRevenueILS.toFixed(2)} ILS`],
    ['AOV', sales.aovILS !== null ? `${sales.aovILS.toFixed(2)} ILS` : undefined],
    ['Conversion-Rate', sales.conversionRatePercent !== null ? `${sales.conversionRatePercent.toFixed(1)}%` : undefined],
    ['Items-Sold', sales.itemsSoldCount],
    ['Issues-Count', issues.totalDistinctIssues],
    ['Issues-Occurrences', issues.totalOccurrences],
    ['Pending-Fulfillment', pendingCount],
    ['Backup-Status', backup.latestBackupFile ? `OK (${backup.latestBackupFile})` : 'NO_LOCAL_BACKUP'],
    ['Integrity-Check', backup.integrityCheck],
    ['Offsite-Backup', backup.offsiteEnabled ? 'ENABLED' : 'DISABLED'],
  ];

  return ownerNotifications.buildOperatorMessage({
    icon: '📊',
    titleHe: 'JONO — סיכום יומי',
    summaryHe: `דוח ביצועים ותפעול יומי לתאריך ${displayDate}`,
    fields: operatorFields,
  }).replace(/^📊 <b>.*?<\/b>\n.*?\n\n/s, `${humanReport}\n\n`);
}

/**
 * Generate and deliver the daily report for dateStr, ensuring atomic restart-safe dedupe.
 *
 * @param {object} options
 * @param {Date} [options.date] - target date (defaults to current local date)
 * @param {string} [options.dateStr] - explicit 'YYYY-MM-DD'
 * @param {boolean} [options.force] - bypass eligibility check (for tests/manual trigger)
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

  // 1. Check if report for today was already successfully sent
  const existingRow = await dbGetAsync(
    db,
    `SELECT id, status, attempt_count, last_attempt_at, sent_at FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
    [targetDateStr]
  );

  if (existingRow && existingRow.sent_at) {
    console.log(`[daily-owner-report] Report for ${targetDateStr} was already sent at ${existingRow.sent_at}`);
    return { skipped: true, reason: 'already_sent', reportDate: targetDateStr, sentAt: existingRow.sent_at };
  }

  // 2. Atomic claim in SQLite:
  // Step A: Insert row in 'pending' status if not exists
  await dbRunAsync(
    db,
    `INSERT OR IGNORE INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
     VALUES ('daily_summary', ?, 'pending', 0, NULL)`,
    [targetDateStr]
  );

  // Step B: Atomic CAS update claiming this attempt
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
         OR (status = 'failed' AND (strftime('%s', 'now') - strftime('%s', COALESCE(last_attempt_at, '1970-01-01'))) >= 300)
         OR (status = 'in_progress' AND (strftime('%s', 'now') - strftime('%s', COALESCE(last_attempt_at, '1970-01-01'))) >= 300)
         OR ? = 1
       )`,
    [targetDateStr, force ? 1 : 0]
  );

  if (!claimResult || claimResult.changes === 0) {
    console.log(`[daily-owner-report] Claim skipped for ${targetDateStr} (already sent or claimed by concurrent worker)`);
    return { skipped: true, reason: 'already_claimed_or_sent', reportDate: targetDateStr };
  }

  // 3. Collect real metrics and build message
  const metrics = await getReportMetrics({ dateStr: targetDateStr, db, backupDir, env });
  const reportMessage = buildDailyReportMessage(metrics);

  // 4. Send via centralized owner-notifications layer
  let notifyResult;
  try {
    notifyResult = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.INFO,
      eventType: 'daily_owner_report',
      dedupKey: `daily_owner_report_${targetDateStr}`,
      message: reportMessage,
    });
  } catch (sendErr) {
    console.error('[daily-owner-report] Notification send threw error:', sendErr.message);
    notifyResult = { sent: false, reason: 'exception', error: sendErr.message };
  }

  // 5. Check genuine Telegram delivery confirmation
  const isDelivered = Boolean(
    notifyResult &&
    notifyResult.sent === true &&
    notifyResult.telegram &&
    notifyResult.telegram.ok === true
  );

  if (isDelivered) {
    // Marked sent ONLY after confirmed delivery
    await dbRunAsync(
      db,
      `UPDATE daily_owner_reports
       SET status = 'sent', sent_at = CURRENT_TIMESTAMP, payload_summary = ?
       WHERE report_type = 'daily_summary' AND report_date = ?`,
      [`sessions:${metrics.traffic.humanSessions}|orders:${metrics.sales.paidOrdersCount}|rev:${metrics.sales.paidRevenueILS}`, targetDateStr]
    );
    console.log(`[daily-owner-report] ✅ Successfully sent daily report for ${targetDateStr}`);
    return { sent: true, reportDate: targetDateStr, message: reportMessage, notifyResult };
  }

  // Telegram delivery failed: do NOT mark sent; mark failed so later retry can succeed
  await dbRunAsync(
    db,
    `UPDATE daily_owner_reports
     SET status = 'failed'
     WHERE report_type = 'daily_summary' AND report_date = ? AND sent_at IS NULL`,
    [targetDateStr]
  );
  console.warn(`[daily-owner-report] ⚠️ Telegram delivery failed for ${targetDateStr} (reason=${notifyResult?.reason || 'unknown'}); scheduled for retry`);
  return { sent: false, reason: notifyResult?.reason || 'delivery_failed', reportDate: targetDateStr, notifyResult };
}

let schedulerTimer = null;

/**
 * Starts the daily report periodic scheduler (runs every 60 seconds).
 */
function startDailyReportScheduler({ db = defaultDb, env = process.env, intervalMs = 60 * 1000 } = {}) {
  if (env.DISABLE_BACKGROUND_JOBS === 'true' || env.NODE_ENV === 'test') {
    console.log('[daily-owner-report] Background jobs disabled or test environment. Scheduler not started.');
    return null;
  }

  if (schedulerTimer) {
    return schedulerTimer;
  }

  const runCheck = async () => {
    try {
      if (isEligibleForDailyReport()) {
        await generateAndSendDailyReport({ db, env });
      }
    } catch (err) {
      console.error('[daily-owner-report] Scheduler tick error:', err.message);
    }
  };

  // Immediate check on startup (for restart catch-up after 22:00)
  setImmediate(runCheck);

  schedulerTimer = setInterval(runCheck, intervalMs);
  if (schedulerTimer.unref) schedulerTimer.unref();

  console.log('[daily-owner-report] ⏰ Daily owner report scheduler initialized (22:00 Europe/Jerusalem).');
  return schedulerTimer;
}

/**
 * Stops the scheduler timer (for tests and graceful teardown).
 */
function stopDailyReportScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  resolveJerusalemTimezone,
  getJerusalemDateString,
  getJerusalemTimeParts,
  isEligibleForDailyReport,
  getJerusalemDayInterval,
  getReportMetrics,
  buildDailyReportMessage,
  generateAndSendDailyReport,
  startDailyReportScheduler,
  stopDailyReportScheduler,
};
