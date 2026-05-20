const axios = require('axios');
const db = require('../db');
const telegram = require('./telegram');

const SYSTEM_INSTRUCTION = `
You are "Meni", the AI customer assistant of "Drip Street", a premium streetwear brand.
Answer questions about Drip Street's products, policies, sizing, and shipping in a friendly, cool, and premium tone.
Keep your answers brief and concise (1-3 sentences max).
Answer in English only.

Store Sizing & Products:
- Basic Tees (Gildan 64000 Softstyle): True to size, premium everyday tee (₪89.90 / $23.90).
- Premium Tees (Bella+Canvas 3001 Jersey): Soft fabric, fits like a well-loved favorite, slightly slim fit. Sizing up is highly recommended for a modern boxy street look (₪119.90 / $31.90).
- Hoodies (Gildan 18500 Heavy Blend): Premium heavy blend fleece, comfy streetwear fit (₪159.90 / $42.60).

Store Policies:
- Sizing: True to size for Softstyle, size up for Bella Canvas, standard comfortable fit for hoodies.
- Shipping: Free shipping when buying 5 or more items. Standard shipping is ₪29.90 ($7.90) taking 5-7 business days. Express shipping is ₪49.90 ($13.20) taking 2-3 business days.
- Returns: 14 days returns allowed for any unworn and unwashed item.

Human Representative:
- If the user asks to speak to a human, owner, manager, representative, or expresses frustration, explain that you are transferring them to human support immediately.
`;

class MeniChatService {
  async processMessage(sessionId, messageText, customerName = 'Guest') {
    const lower = messageText.toLowerCase();
    const isEscalationRequest = 
      lower.includes('human') || 
      lower.includes('support') || 
      lower.includes('representative') || 
      lower.includes('talk to') ||
      lower.includes('help');

    if (isEscalationRequest) {
      await this.escalateToHuman(sessionId, customerName, messageText);
      return {
        text: "I'm transferring you to a human support representative now. Your message has been sent directly and you'll receive a reply shortly.",
        status: "escalated"
      };
    }

    // Try Gemini API if key is available
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey && geminiKey !== 'YOUR_GEMINI_API_KEY') {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const response = await axios.post(url, {
          contents: [
            { role: 'user', parts: [{ text: `${SYSTEM_INSTRUCTION}\n\nCustomer: ${messageText}` }] }
          ]
        });

        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const reply = response.data.candidates[0].content.parts[0].text.trim();
          return { text: reply, status: "bot" };
        }
      } catch (err) {
        console.warn("Gemini API call failed, falling back to rule-based engine:", err.message);
      }
    }

    // Smart rule-based fallback engine (English-only)
    let reply = "Hi! I'm Meni, Drip Street's AI assistant. I can help with sizing, shipping, and returns. For anything advanced, ask to speak with a human support rep.";
    if (lower.includes('size') || lower.includes('sizing')) {
      reply = "Sizing guide:\n- Basic Tee (Gildan Softstyle): true to size.\n- Premium Tee (Bella+Canvas): slightly slim fit, we recommend sizing up for a boxy streetwear look.\n- Hoodies: comfortable regular fit.";
    } else if (lower.includes('shipping') || lower.includes('delivery')) {
      reply = "Shipping policy:\n- Free shipping on 5+ items.\n- Standard shipping (5-7 business days): ₪29.90\n- Express shipping (2-3 business days): ₪49.90";
    } else if (lower.includes('return') || lower.includes('refund')) {
      reply = "You can return or exchange any unworn and unwashed item within 14 days of delivery.";
    }

    return { text: reply, status: "bot" };
  }

  async escalateToHuman(sessionId, customerName, messageText) {
    db.run("UPDATE chat_sessions SET status = 'escalated' WHERE id = ?", [sessionId]);
    
    const alertMsg = `🤖 <b>Meni Bot: Customer escalated to human support</b>\n\n` +
      `<b>Customer:</b> ${customerName}\n` +
      `<b>Session ID:</b> <code>${sessionId}</code>\n` +
      `<b>Last message:</b>\n"${messageText}"\n\n` +
      `<b>Quick reply:</b> <code>/reply ${sessionId} write your response here</code>`;
      
    await telegram.sendMessage(alertMsg);
  }
}

module.exports = new MeniChatService();
