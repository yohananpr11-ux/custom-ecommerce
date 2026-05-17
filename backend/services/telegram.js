const axios = require('axios');

class TelegramService {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  async sendMessage(text) {
    if (!this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      console.warn('⚠️ Telegram token not configured. Skipping message:', text);
      return { ok: false, skipped: true, reason: 'token_not_configured' };
    }

    if (!this.chatId) {
      console.warn('⚠️ Telegram chat id not configured. Skipping message:', text);
      return { ok: false, skipped: true, reason: 'chat_id_not_configured' };
    }

    try {
      const response = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.chatId,
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
