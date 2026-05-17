const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

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
    userProfile ? path.join(userProfile, 'OneDrive', 'שולחן העבודה', 'MENI_CORE', '.env') : null,
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

  return null;
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
    const message = `🛍️ <b>הזמנה חדשה באתר!</b>\n\n` +
      `<b>מספר הזמנה:</b> #${orderId}\n` +
      `<b>לקוח:</b> ${customerName}\n` +
      `<b>סכום כולל:</b> ₪${totalAmount.toFixed(2)}\n\n` +
      `<b>פריטים:</b>\n${itemsList}\n\n` +
      `ההזמנה נקלטה בהצלחה במערכת.`;
      
    await this.sendMessage(message);
  }

  async notifyError(context, errorMessage) {
    const message = `🚨 <b>שגיאת מערכת!</b>\n\n` +
      `<b>הקשר:</b> ${context}\n` +
      `<b>שגיאה:</b> ${errorMessage}`;
    
    await this.sendMessage(message);
  }

  async notifySupportMessage(name, email, message) {
    if (!this.token || !this.chatId) return;

    const text = `✉️ <b>הודעה חדשה מלקוח (צור קשר)</b>\n\n` +
                 `<b>שם:</b> ${name}\n` +
                 `<b>אימייל:</b> ${email}\n\n` +
                 `<b>הודעה:</b>\n${message}`;

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
