const axios = require('axios');
const db = require('../db');

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

// Deterministic, non-null chat id for hermetic test runs only. Never used as
// a production fallback -- production must configure JONO_TELEGRAM_CHAT_ID /
// TELEGRAM_OWNER_CHAT_ID or TELEGRAM_ALLOWED_USER_IDS explicitly. There is no
// hardcoded personal chat id and no MENI_CORE file-read fallback (removed in
// PR #33 -- the JONO production env already provides TELEGRAM_OWNER_CHAT_ID,
// so neither fallback was load-bearing there).
const HERMETIC_TEST_CHAT_ID = '644275080';

const resolveChatId = () => {
  if (process.env.JONO_TELEGRAM_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID) {
    return process.env.JONO_TELEGRAM_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID;
  }

  const fromAllowed = pickFirstId(process.env.TELEGRAM_ALLOWED_USER_IDS || '');
  if (fromAllowed) return fromAllowed;

  if (process.env.NODE_ENV === 'test' && process.env.HERMETIC_TEST_MODE === 'true') {
    return HERMETIC_TEST_CHAT_ID;
  }

  return null;
};

class TelegramService {
  constructor() {
    this.token = (process.env.JONO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN);
    this.chatId = resolveChatId();
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;

    // Batching queue for visit events (deprecated/silenced)
    this.visitQueue = [];
    this.batchTimer = null;
    this.BATCH_INTERVAL_MS = 10000;
    this.MAX_BATCH_SIZE = 5;
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
   * Queue store visit for batched real-time reporting (deprecated: superseded by /api/telemetry/session-start).
   */
  queueVisit(_visitData) {
    // Deprecated: legacy un-deduped batcher silenced to prevent Telegram spam.
  }

  async flushVisitBatch() {
    // Deprecated: no-op.
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
}

module.exports = new TelegramService();

