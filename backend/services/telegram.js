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

    let lines = [`👁️ <b>JONO Store Visits</b> (${visits.length} new)`];
    
    for (const v of visits) {
      const icon = v.isBot ? '🤖' : '👤';
      const label = v.isBot ? `Bot (${v.botReason || 'crawler'})` : 'Real';
      const pathStr = escapeHtml(v.path || '/');
      const countryStr = escapeHtml(v.country || 'Unknown');
      const deviceStr = escapeHtml(v.visitorDevice || '-');
      const typeStr = escapeHtml(v.visitorType || (v.isBot ? 'bot' : 'human'));
      lines.push(`${icon} <b>${label}</b> | <code>${pathStr}</code> | ${countryStr} | ${deviceStr} | ${typeStr}`);
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
      cron.schedule('0 20 * * *', async () => {
        console.log('⏰ Running JONO Daily Report Cron (20:00 Asia/Jerusalem)...');
        await this.sendDailyReport();
      }, {
        timezone: 'Asia/Jerusalem'
      });
      console.log('✅ Mani V2 Daily Intelligence Cron scheduled for 20:00 Asia/Jerusalem.');
      // --- DB Migration for Abandoned Carts ---
      try {
        db.prepare("ALTER TABLE abandoned_carts ADD COLUMN alerted INTEGER DEFAULT 0").run();
        console.log("✅ Column 'alerted' added to abandoned_carts successfully.");
      } catch (e) {} // Ignore if it already exists

      // --- Abandoned Cart Cron ---
      cron.schedule('0 * * * *', async () => {
        try {
          const carts = db.prepare("SELECT * FROM abandoned_carts WHERE alerted = 0 AND datetime(updated_at) <= datetime('now', '-1 hour') LIMIT 10").all();
          
          for (const cart of carts) {
            let itemSummary = 'Unknown items';
            try {
              const items = JSON.parse(cart.items_json || '[]');
              itemSummary = items.map(i => `${i.quantity}x ${i.title}`).join(', ');
            } catch(e) {}
            
            const timeStr = new Date(cart.updated_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
            const msg = `🛒 <b>Abandoned Cart Alert!</b>\n\n<b>Email:</b> ${cart.email || 'None provided'}\n<b>Items:</b> ${itemSummary}\n<b>Last Active:</b> ${timeStr}\n\n<i>💡 Consider reaching out or checking PayPal logs.</i>`;
            
            await this.bot.sendMessage(this.adminChatId, msg, { parse_mode: 'HTML' });
            db.prepare("UPDATE abandoned_carts SET alerted = 1 WHERE id = ?").run(cart.id);
          }
        } catch (err) {
          console.error('Abandoned cart cron error:', err.message);
        }
      });
      console.log('✅ Abandoned Cart Cron scheduled (hourly).');
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

      // COGS constants aligned with pricing.js (approved 2026-05)
      const COGS_HEAVY_USD   = 22.30;  // $11.80 blank + $10.50 ship
      const COGS_CVC_USD     = 17.90;  // $9.40  blank + $8.50  ship
      const RETAIL_HEAVY_ILS = 199.90;
      const RETAIL_CVC_ILS   = 169.90;
      const RETAIL_HOODIE_ILS = 249.90;
      const PAYPAL_FEE_RATE  = 0.03;
      const FX               = 3.75;   // USD→ILS fallback rate

      db.all(
        `SELECT COUNT(*) as orderCount, COALESCE(SUM(totalAmount), 0) as totalRevenue, COALESCE(SUM(shippingCost), 0) as totalShipping
         FROM orders WHERE DATE(createdAt) = DATE('now') AND status != 'cancelled'`,
        [],
        (err, orderRows) => {
          const ordersInfo = (orderRows && orderRows[0]) || { orderCount: 0, totalRevenue: 0, totalShipping: 0 };
          const orderCount = ordersInfo.orderCount;
          const grossRevenueILS = ordersInfo.totalRevenue;
          const grossRevenueUSD = (grossRevenueILS / FX).toFixed(2);

          // Real COGS: assume heavyweight mix (~70% heavy, 30% CVC)
          const avgCogsUSD = COGS_HEAVY_USD * 0.7 + COGS_CVC_USD * 0.3; // ~20.68
          const avgCogsILS = avgCogsUSD * FX;
          const paypalFeesILS = grossRevenueILS * PAYPAL_FEE_RATE;
          const estCostsILS = (orderCount * avgCogsILS + paypalFeesILS).toFixed(2);
          const estProfitILS = (grossRevenueILS - parseFloat(estCostsILS)).toFixed(2);
          const grossMarginPct = grossRevenueILS > 0
            ? ((parseFloat(estProfitILS) / grossRevenueILS) * 100).toFixed(1)
            : '0.0';

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

                      // Traffic breakdown from visits table (bot_type column set by botDetector)
                      db.all(
                        `SELECT
                           COUNT(*) as total,
                           SUM(CASE WHEN bot_type IS NULL OR bot_type = 'human' THEN 1 ELSE 0 END) as humans,
                           SUM(CASE WHEN bot_type = 'known_bot' THEN 1 ELSE 0 END) as knownBots,
                           SUM(CASE WHEN bot_type = 'suspicious' THEN 1 ELSE 0 END) as suspicious
                         FROM visits WHERE DATE(timestamp) = DATE('now')`,
                        [],
                        (err5, visitRows) => {
                          const vr = (visitRows && visitRows[0]) || { total: 0, humans: 0, knownBots: 0, suspicious: 0 };

                          const recommendations = [];
                          if (orderCount === 0) {
                            recommendations.push('⚡ Zero orders today — run a flash sale or push Instagram story.');
                          } else {
                            recommendations.push(`🔥 ${orderCount} order(s)! Top seller: "${topProducts}".`);
                          }
                          if (cartsToday > 0) {
                            recommendations.push(`🛒 ${cartsToday} abandoned cart(s) — check PayPal mobile flow.`);
                          }
                          if (leadsToday > 0) {
                            recommendations.push(`✉️ ${leadsToday} new lead(s) — 10% OFF welcome coupon sent.`);
                          }
                          if (vr.suspicious > 5) {
                            recommendations.push(`⚠️ ${vr.suspicious} suspicious visitors today — review traffic source.`);
                          }

                          const reportText = [
                            `📊 <b>JONO Daily Store Intelligence</b> [src:render-main] — ${displayDate}`,
                            `━━━━━━━━━━━━━━━━━━━━━`,
                            `👥 <b>Traffic (Human / Bot):</b>`,
                            `• 👤 Humans: <b>${vr.humans}</b>  🤖 Known Bots: ${vr.knownBots}  ⚠️ Suspicious: ${vr.suspicious}`,
                            ``,
                            `💰 <b>Sales & Financials:</b>`,
                            `• Total Orders: <b>${orderCount}</b>`,
                            `• Gross Revenue: <b>₪${grossRevenueILS.toFixed(2)}</b> ($${grossRevenueUSD})`,
                            `• PayPal Fees (3%): ₪${paypalFeesILS.toFixed(2)}`,
                            `• Est. COGS: ₪${estCostsILS} (heavy $${COGS_HEAVY_USD} / CVC $${COGS_CVC_USD} × ₪${FX})`,
                            `• Est. Net Profit: <b>₪${estProfitILS}</b> (${grossMarginPct}% margin)`,
                            `• Top Products: ${escapeHtml(topProducts)}`,
                            ``,
                            `💡 <b>Example calc (1× heavy @ ₪199.90):</b>`,
                            `  $53.30 retail − $22.30 COGS − $1.86 fee = <b>$29.14 profit (~₪109)</b>`,
                            ``,
                            `👥 <b>Funnel & Leads:</b>`,
                            `• New Leads: <b>${leadsToday}</b>  |  Abandoned Carts: <b>${cartsToday}</b>`,
                            ``,
                            `🤖 <b>AI Insights:</b>`,
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
        }
      );
    });
  }
}

module.exports = new TelegramService();
