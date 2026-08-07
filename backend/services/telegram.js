const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const cron = require('node-cron');
const db = require('../db');

const DEFAULT_MENI_CHAT_ID = '644275080';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * PII Email Redaction Helper
 * e.g. "john.doe@gmail.com" -> "j***e@gmail.com"
 */
const redactEmail = (email) => {
  if (!email || typeof email !== 'string') return '***@***';
  const clean = email.trim().toLowerCase();
  const parts = clean.split('@');
  if (parts.length !== 2) return '***@***';
  const user = parts[0];
  const domain = parts[1];
  if (user.length <= 2) {
    return `${user[0] || '*'}***@${domain}`;
  }
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
};

const pickFirstId = (value) => {
  if (!value || typeof value !== 'string') return null;
  const first = value.split(',').map((part) => part.trim()).find(Boolean);
  return first || null;
};

const readEnvFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return {};
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return dotenv.parse(fileContent);
  } catch {
    return {};
  }
};

const resolveChatId = () => {
  if (process.env.TELEGRAM_OWNER_CHAT_ID) return process.env.TELEGRAM_OWNER_CHAT_ID;

  const fromAllowed = pickFirstId(process.env.TELEGRAM_ALLOWED_USER_IDS || '');
  if (fromAllowed) return fromAllowed;

  // Hermetic test runs must never touch real local files outside the
  // sandboxed test environment, even as a read-only fallback — skip the
  // MENI_CORE lookup entirely and use the inert default chat id instead.
  // Requires BOTH NODE_ENV=test AND the dedicated HERMETIC_TEST_MODE flag,
  // standardized the same way as pricing.js's fetchExchangeRate() — never
  // DISABLE_BACKGROUND_JOBS, which is an unrelated, independent control.
  if (process.env.NODE_ENV === 'test' && process.env.HERMETIC_TEST_MODE === 'true') return DEFAULT_MENI_CHAT_ID;

  const userProfile = process.env.USERPROFILE || '';
  const meniCoreEnvPaths = [
    process.env.MENI_CORE_ENV_PATH,
    process.env.MENI_CORE_PATH ? path.join(process.env.MENI_CORE_PATH, '.env') : null,
    userProfile ? path.join(userProfile, 'OneDrive', 'Desktop', 'MENI_CORE', '.env') : null,
    userProfile ? path.join(userProfile, 'Desktop', 'MENI_CORE', '.env') : null
  ].filter(Boolean);

  for (const envPath of meniCoreEnvPaths) {
    const parsed = readEnvFile(envPath);
    const ownerChat = parsed.TELEGRAM_OWNER_CHAT_ID;
    if (ownerChat) return ownerChat;

    const allowedUser = pickFirstId(parsed.TELEGRAM_ALLOWED_USER_IDS || '');
    if (allowedUser) return allowedUser;
  }

  return DEFAULT_MENI_CHAT_ID;
};

class TelegramService {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = resolveChatId();
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;

    // Batching queue for visit events
    this.visitQueue = [];
    this.batchTimer = null;
    this.BATCH_INTERVAL_MS = 10000; // 10 seconds
    this.MAX_BATCH_SIZE = 5;

    // Initialize Daily Cron Report at 23:00 Asia/Jerusalem
    this.initDailyCron();
  }

  async ensureChatId() {
    if (this.chatId) return this.chatId;

    const fromAllowed = pickFirstId(process.env.TELEGRAM_ALLOWED_USER_IDS || '');
    if (fromAllowed) {
      this.chatId = fromAllowed;
      return this.chatId;
    }

    if (!this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN') return null;

    try {
      const response = await axios.get(`${this.baseUrl}/getUpdates`, { timeout: 7000 });
      const updates = Array.isArray(response.data && response.data.result) ? response.data.result : [];

      for (let index = updates.length - 1; index >= 0; index -= 1) {
        const update = updates[index];
        const messageChatId = update && update.message && update.message.chat ? update.message.chat.id : null;
        const callbackChatId = update && update.callback_query && update.callback_query.message && update.callback_query.message.chat
          ? update.callback_query.message.chat.id
          : null;
        const chatId = messageChatId || callbackChatId;
        if (chatId) {
          this.chatId = String(chatId);
          return this.chatId;
        }
      }
    } catch (error) {
      // Keep graceful behavior; sendMessage will return structured diagnostic below.
    }

    return null;
  }

  async sendMessage(text) {
    // SECURITY: never log the message body here -- callers embed customer
    // names, order totals, and other order details directly into `text`
    // (see notifyNewOrder/sendPaymentNotification-shaped callers in
    // index.js), so logging it verbatim whenever Telegram happens to be
    // unconfigured (every hermetic test run, and any real misconfiguration)
    // would put customer PII straight into operational logs. Only a safe,
    // fixed-shape, non-PII summary (byte length only) is ever logged.
    if (!this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      console.warn(`⚠️ Telegram token not configured. Skipping message (length=${String(text || '').length}).`);
      return { ok: false, skipped: true, reason: 'token_not_configured' };
    }

    const resolvedChatId = await this.ensureChatId();

    if (!resolvedChatId) {
      console.warn(`⚠️ Telegram chat id not configured. Skipping message (length=${String(text || '').length}).`);
      return { ok: false, skipped: true, reason: 'chat_id_not_configured' };
    }

    try {
      const response = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: resolvedChatId,
        text: text,
        parse_mode: 'HTML'
      });
      console.log('✅ Telegram alert sent.');
      return { ok: true, status: response.status };
    } catch (error) {
      // Only a coarse, safe status/error-code summary is ever logged --
      // never the raw response body, which is not guaranteed to be free of
      // request-derived content on every possible Telegram API error shape.
      const status = error.response && error.response.status;
      const telegramErrorCode = error.response && error.response.data && error.response.data.error_code;
      const details = status ? `HTTP_${status}${telegramErrorCode ? ` (telegram_error_code=${telegramErrorCode})` : ''}` : (error.code || 'UNKNOWN_ERROR');
      console.error('❌ Failed to send Telegram alert:', details);
      return { ok: false, skipped: false, reason: 'telegram_api_error', details };
    }
  }

  async notifyNewOrder(orderId, customerName, totalAmount, items) {
    const itemsList = items.map(item => `- ${item.quantity}x ${item.title}`).join('\n');
    const numericTotal = Number(totalAmount);
    const formattedTotal = Number.isFinite(numericTotal) ? numericTotal.toFixed(2) : String(totalAmount);
    const message = `🛍️ <b>New Order Received</b>\n\n` +
      `<b>Order Number:</b> #${orderId}\n` +
      `<b>Customer:</b> ${escapeHtml(customerName)}\n` +
      `<b>Total Amount:</b> ₪${formattedTotal}\n\n` +
      `<b>Items:</b>\n${escapeHtml(itemsList)}\n\n` +
      `The order was successfully recorded in the system.`;
      
    await this.sendMessage(message);
  }

  /**
   * Queue store visit for batched real-time reporting.
   */
  queueVisit(visitData) {
    this.visitQueue.push({
      ...visitData,
      timestamp: new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' })
    });

    if (this.visitQueue.length >= this.MAX_BATCH_SIZE) {
      this.flushVisitBatch();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushVisitBatch(), this.BATCH_INTERVAL_MS);
    }
  }

  async flushVisitBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.visitQueue.length === 0) return;

    const visits = [...this.visitQueue];
    this.visitQueue = [];

    let lines = [`👁️ <b>JOAKIM Store Visits</b> (${visits.length} new)`];
    
    for (const v of visits) {
      const icon = v.isBot ? '🤖' : '👤';
      const label = v.isBot ? `Bot (${v.botReason || 'crawler'})` : 'Real';
      const pathStr = escapeHtml(v.path || '/');
      const countryStr = escapeHtml(v.country || 'Unknown');
      lines.push(`${icon} <b>${label}</b> | <code>${pathStr}</code> | ${countryStr}`);
    }

    await this.sendMessage(lines.join('\n'));
  }

  /**
   * Real-time notification for email events
   */
  async notifyEmailSent(type, recipientEmail, success, details = '') {
    const redacted = redactEmail(recipientEmail);
    const statusIcon = success ? '✅' : '❌';
    const msg = `📧 <b>Email Event: ${escapeHtml(type)}</b>\n` +
      `<b>Status:</b> ${statusIcon} ${success ? 'Sent' : 'Failed'}\n` +
      `<b>To:</b> ${escapeHtml(redacted)}\n` +
      (details ? `<b>Detail:</b> ${escapeHtml(details)}` : '');
    await this.sendMessage(msg);
  }

  /**
   * Real-time notification for Order/PayPal events
   */
  async notifyOrderEvent(event, orderId, totalAmount, customerEmail, details = '') {
    const redacted = redactEmail(customerEmail);
    const msg = `💳 <b>Order Event: ${escapeHtml(event)}</b>\n` +
      `<b>Order ID:</b> #${orderId}\n` +
      `<b>Total:</b> ₪${Number(totalAmount || 0).toFixed(2)}\n` +
      `<b>Customer:</b> ${escapeHtml(redacted)}\n` +
      (details ? `<b>Detail:</b> ${escapeHtml(details)}` : '');
    await this.sendMessage(msg);
  }

  /**
   * Real-time notification for Printify events
   */
  async notifyPrintifyEvent(event, productId, title, status, details = '') {
    const msg = `🎨 <b>Printify Pipeline: ${escapeHtml(event)}</b>\n` +
      `<b>Product ID:</b> #${productId || 'N/A'}\n` +
      `<b>Title:</b> ${escapeHtml(title || 'Untitled')}\n` +
      `<b>Status:</b> ${escapeHtml(status)}\n` +
      (details ? `<b>Detail:</b> ${escapeHtml(details)}` : '');
    await this.sendMessage(msg);
  }

  async notifyError(context, errorMessage) {
    const message = `🚨 <b>System Error</b>\n\n` +
      `<b>Context:</b> ${context}\n` +
      `<b>Error:</b> ${errorMessage}`;
    
    await this.sendMessage(message);
  }

  async notifySupportMessage(name, email, message) {
    if (!this.token || !this.chatId) return;

    const safeName = String(name || 'Unknown').trim();
    const safeEmail = redactEmail(email);
    const safeMessage = String(message || '').trim();
    const text = [
      '📩 <b>Support Request</b>',
      `<b>Name:</b> ${escapeHtml(safeName)}`,
      `<b>Email:</b> ${escapeHtml(safeEmail)}`,
      `<b>Message:</b> ${escapeHtml(safeMessage)}`,
    ].join('\n');

    await this.sendMessage(text);
  }

  /**
   * Initialize Daily Summary Cron at 23:00 Asia/Jerusalem
   */
  initDailyCron() {
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_BACKGROUND_JOBS === 'true') {
      return;
    }

    try {
      cron.schedule('0 23 * * *', async () => {
        console.log('⏰ Running JOAKIM Daily Report Cron (23:00 Asia/Jerusalem)...');
        await this.sendDailyReport();
      }, {
        timezone: 'Asia/Jerusalem'
      });
      console.log('✅ Mani V2 Daily Intelligence Cron scheduled for 23:00 Asia/Jerusalem.');
    } catch (err) {
      console.error('Failed to schedule Daily Report Cron:', err.message);
    }
  }

  /**
   * Generates and sends the daily summary report
   */
  async sendDailyReport() {
    try {
      const report = await this.generateDailyReportData();
      await this.sendMessage(report);
      return { ok: true, report };
    } catch (err) {
      console.error('Failed to send Daily Report:', err.message);
      return { ok: false, error: err.message };
    }
  }

  generateDailyReportData() {
    return new Promise((resolve) => {
      const displayDate = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });

      db.all(
        `SELECT COUNT(*) as orderCount, COALESCE(SUM(totalAmount), 0) as totalRevenue, COALESCE(SUM(shippingCost), 0) as totalShipping
         FROM orders WHERE DATE(createdAt) = DATE('now') AND status != 'cancelled'`,
        [],
        (err, orderRows) => {
          const ordersInfo = (orderRows && orderRows[0]) || { orderCount: 0, totalRevenue: 0, totalShipping: 0 };
          const orderCount = ordersInfo.orderCount;
          const grossRevenueILS = ordersInfo.totalRevenue;
          const grossRevenueUSD = (grossRevenueILS / 3.75).toFixed(2);
          
          const estCostsILS = (grossRevenueILS * 0.38).toFixed(2); // ~38% COGS with Comfort Colors 1717 / CVC blanks + fulfillment
          const estProfitILS = (grossRevenueILS - estCostsILS).toFixed(2);

          db.all(
            `SELECT p.title, SUM(oi.quantity) as qty
             FROM order_items oi
             JOIN orders o ON o.id = oi.orderId
             JOIN products p ON p.id = oi.productId
             WHERE DATE(o.createdAt) = DATE('now') AND o.status != 'cancelled'
             GROUP BY p.id ORDER BY qty DESC LIMIT 3`,
            [],
            (err2, topRows) => {
              const topProducts = (topRows && topRows.length > 0)
                ? topRows.map(r => `${r.title} (${r.qty})`).join(', ')
                : 'None yet today';

              db.all(
                `SELECT COUNT(*) as count FROM leads WHERE DATE(created_at) = DATE('now')`,
                [],
                (err3, leadRows) => {
                  const leadsToday = (leadRows && leadRows[0]) ? leadRows[0].count : 0;

                  db.all(
                    `SELECT COUNT(*) as count FROM abandoned_carts WHERE DATE(updated_at) = DATE('now')`,
                    [],
                    (err4, cartRows) => {
                      const cartsToday = (cartRows && cartRows[0]) ? cartRows[0].count : 0;

                      const recommendations = [];
                      if (orderCount === 0) {
                        recommendations.push('⚡ Zero orders recorded today — test checkout pipeline and run promotional campaign.');
                      } else {
                        recommendations.push(`🔥 Strong performance today with ${orderCount} order(s)! Consider featuring top seller "${topProducts}".`);
                      }

                      if (cartsToday > 0) {
                        recommendations.push(`🛒 ${cartsToday} abandoned cart(s) detected — verify automated recovery email scheduler.`);
                      } else {
                        recommendations.push('💡 Add product bundle offers on cart modal to lift average order value.');
                      }

                      if (leadsToday > 0) {
                        recommendations.push(`✉️ ${leadsToday} new subscriber lead(s) acquired — welcome coupon automated.`);
                      } else {
                        recommendations.push('🎯 Test popup lead exit-intent trigger to capture browsing interest.');
                      }

                      const reportText = [
                        `📊 <b>JOAKIM Daily Store Intelligence</b> — ${displayDate}`,
                        `━━━━━━━━━━━━━━━━━━━━━`,
                        `💰 <b>Sales & Financials:</b>`,
                        `• Total Orders: <b>${orderCount}</b>`,
                        `• Gross Revenue: <b>₪${grossRevenueILS.toFixed(2)}</b> ($${grossRevenueUSD})`,
                        `• Est. Net Profit: <b>₪${estProfitILS}</b> (COGS ~₪${estCostsILS})`,
                        `• Top Products: ${escapeHtml(topProducts)}`,
                        ``,
                        `👥 <b>Funnel & Leads:</b>`,
                        `• New Leads Acquired: <b>${leadsToday}</b>`,
                        `• Abandoned Carts: <b>${cartsToday}</b>`,
                        ``,
                        `🤖 <b>AI Operational Recommendations:</b>`,
                        ...recommendations.map((rec, i) => `${i + 1}. ${rec}`)
                      ].join('\n');

                      resolve(reportText);
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  }
}

module.exports = new TelegramService();
