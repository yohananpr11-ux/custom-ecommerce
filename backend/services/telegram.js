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
      return;
    }

    try {
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'HTML'
      });
      console.log('✅ Telegram alert sent.');
    } catch (error) {
      console.error('❌ Failed to send Telegram alert:', error.message);
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
}

module.exports = new TelegramService();
