const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const DEFAULT_MENI_CHAT_ID = '644275080';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

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
    if (!this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      console.warn('⚠️ Telegram token not configured. Skipping message:', text);
      return { ok: false, skipped: true, reason: 'token_not_configured' };
    }

    const resolvedChatId = await this.ensureChatId();

    if (!resolvedChatId) {
      console.warn('⚠️ Telegram chat id not configured. Skipping message:', text);
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
      const details = error.response && error.response.data ? error.response.data : error.message;
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
      `<b>Customer:</b> ${customerName}\n` +
      `<b>Total Amount:</b> ${formattedTotal}\n\n` +
      `<b>Items:</b>\n${itemsList}\n\n` +
      `The order was successfully recorded in the system.`;
      
    await this.sendMessage(message);
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
    const safeEmail = String(email || 'Unknown').trim();
    const safeMessage = String(message || '').trim();
    const text = [
      '📩 <b>Support Request</b>',
      `<b>Name:</b> ${escapeHtml(safeName)}`,
      `<b>Email:</b> ${escapeHtml(safeEmail)}`,
      `<b>Message:</b> ${escapeHtml(safeMessage)}`,
    ].join('\n');

    try {
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'HTML'
      });
    } catch (error) {
      console.error('Failed to send Telegram support message:', error.message);
    }
  }
}

module.exports = new TelegramService();
