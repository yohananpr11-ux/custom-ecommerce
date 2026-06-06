const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const DEFAULT_MENI_CHAT_ID = '644275080';

const EXCHANGE_RATE_API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedRate = 3.75;
let lastFetchedAt = 0;

async function getLiveExchangeRate() {
  const now = Date.now();
  if (now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedRate;
  }
  try {
    const response = await axios.get(EXCHANGE_RATE_API_URL, { timeout: 5000 });
    const rate = response.data && response.data.rates && response.data.rates.ILS;
    if (typeof rate === 'number' && rate > 0) {
      cachedRate = rate;
      lastFetchedAt = now;
      console.log(`[exchange-rate] Updated live USD to ILS rate: ${rate}`);
    }
  } catch (err) {
    console.warn(`[exchange-rate] Failed to fetch live rate: ${err.message}. Using cached/fallback rate: ${cachedRate}`);
  }
  return cachedRate;
}

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

  async sendMessage(text, retries = 3, delayMs = 1000) {
    if (!this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      console.warn('⚠️ Telegram token not configured. Skipping message:', text);
      return { ok: false, skipped: true, reason: 'token_not_configured' };
    }

    const resolvedChatId = await this.ensureChatId();

    if (!resolvedChatId) {
      console.warn('⚠️ Telegram chat id not configured. Skipping message:', text);
      return { ok: false, skipped: true, reason: 'chat_id_not_configured' };
    }

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const response = await axios.post(`${this.baseUrl}/sendMessage`, {
          chat_id: resolvedChatId,
          text: text,
          parse_mode: 'HTML'
        }, { timeout: 8000 });
        console.log(`✅ Telegram alert sent (attempt ${attempt}/${retries}).`);
        return { ok: true, status: response.status };
      } catch (error) {
        const details = error.response && error.response.data ? error.response.data : error.message;
        console.warn(`⚠️ Telegram alert attempt ${attempt}/${retries} failed:`, details);
        if (attempt === retries) {
          console.error('❌ Failed to send Telegram alert after max retries:', details);
          return { ok: false, skipped: false, reason: 'telegram_api_error', details };
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
      }
    }
  }

  async formatHybridPrice(usdAmount) {
    const numericUsd = Number(usdAmount);
    if (!Number.isFinite(numericUsd)) return String(usdAmount);
    const rate = await getLiveExchangeRate();
    const ilsAmount = numericUsd * rate;
    const usdFormatted = numericUsd % 1 === 0 ? String(numericUsd) : numericUsd.toFixed(2);
    return `$${usdFormatted} (כ-₪${Math.round(ilsAmount)})`;
  }

  async notifyNewOrder(orderId, customerName, totalAmount, items) {
    const itemsList = Array.isArray(items)
      ? items.map(item => `- ${item.quantity}x ${item.title || 'פריט'}`).join('\n')
      : 'אין פריטים רשומים';
    const formattedTotal = await this.formatHybridPrice(totalAmount);
    const message = `🛍️ <b>הזמנה חדשה התקבלה</b>\n\n` +
      `<b>מספר הזמנה:</b> #${orderId}\n` +
      `<b>לקוח:</b> ${customerName || 'אנונימי'}\n` +
      `<b>סכום כולל:</b> ${formattedTotal}\n\n` +
      `<b>פריטים:</b>\n${itemsList}\n\n` +
      `ההזמנה נרשמה בהצלחה במערכת.`;
      
    await this.sendMessage(message);
  }

  async notifyCheckoutFailed({ provider, customerName, customerEmail, amount, orderId, error }) {
    let message = `❌ <b>הליך הרכישה נכשל</b>\n\n`;
    if (provider) message += `<b>ספק תשלום:</b> ${provider}\n`;
    if (orderId) message += `<b>מזהה הזמנה:</b> #${orderId}\n`;
    if (customerName || customerEmail) {
      const name = customerName || 'אנונימי';
      const email = customerEmail || 'לא ידוע';
      message += `<b>לקוח:</b> ${name} (${email})\n`;
    }
    if (amount !== undefined && amount !== null) {
      const formattedAmount = await this.formatHybridPrice(amount);
      message += `<b>סכום:</b> ${formattedAmount}\n`;
    }
    if (error) message += `<b>שגיאה:</b> ${error}\n`;
    
    await this.sendMessage(message);
  }

  async notifyNewLead({ email, promoCode, isResubscribe }) {
    let message = '';
    if (isResubscribe) {
      message = `♻️ <b>ליד נרשם מחדש</b>\n\n` +
        `<b>אימייל:</b> <code>${escapeHtml(email)}</code>`;
    } else {
      message = `🔥 <b>ליד חדש התווסף למועדון</b>\n\n` +
        `<b>אימייל:</b> <code>${escapeHtml(email)}</code>\n` +
        `<b>קוד הנחה שנוצר:</b> <code>${escapeHtml(promoCode || '')}</code>`;
    }
    await this.sendMessage(message);
  }

  async notifySupportMessage(name, email, message) {
    const safeName = String(name || 'אנונימי').trim();
    const safeEmail = String(email || 'לא ידוע').trim();
    const safeMessage = String(message || '').trim();
    const text = [
      '📩 <b>פניית תמיכה חדשה</b>',
      `<b>שם:</b> ${escapeHtml(safeName)}`,
      `<b>אימייל:</b> ${escapeHtml(safeEmail)}`,
      `<b>הודעה:</b> ${escapeHtml(safeMessage)}`,
    ].join('\n');

    await this.sendMessage(text);
  }

  async notifySystemError(context, errorMessage) {
    const message = `🚨 <b>שגיאת מערכת</b>\n\n` +
      `<b>הקשר:</b> ${context}\n` +
      `<b>שגיאה:</b> ${errorMessage}`;
    
    await this.sendMessage(message);
  }

  async notifyError(context, errorMessage) {
    await this.notifySystemError(context, errorMessage);
  }
}

module.exports = new TelegramService();
