const axios = require('axios');
const db = require('../db');
const telegram = require('./telegram');

const SYSTEM_INSTRUCTION = `
You are "Meni" (מני), the AI customer assistant of "Drip Street" (דריפ סטריט), a premium streetwear brand.
Answer questions about Drip Street's products, policies, sizing, and shipping in a friendly, cool, and premium tone.
Keep your answers brief and concise (1-3 sentences max).
Answer in the user's language (Hebrew if they write in Hebrew, English if English).

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
      lower.includes('נציג') || 
      lower.includes('אנושי') || 
      lower.includes('בעלים') || 
      lower.includes('בנאדם') || 
      lower.includes('human') || 
      lower.includes('support') || 
      lower.includes('representative') || 
      lower.includes('talk to') ||
      lower.includes('עזרה');

    if (isEscalationRequest) {
      await this.escalateToHuman(sessionId, customerName, messageText);
      return {
        text: "אני מעביר אותך כעת לנציג אנושי. השאלה שלך נשלחה אליו ישירות בטלגרם והוא יחזור אליך בהקדם!",
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

    // Smart Rule-based fallback engine (Multilingual)
    let reply = "היי! אני מני, עוזר הבינה המלאכותית של דריפ סטריט. אני יכול לעזור לך עם שאלות על מידות, משלוחים או החזרות. לשאלות מורכבות יותר תוכל לבקש לדבר עם נציג אנושי!";
    if (lower.includes('מידה') || lower.includes('מידות') || lower.includes('size') || lower.includes('sizing')) {
      reply = "ההמלצות שלנו למידות:\n- טי-שירט בייסיק (Gildan Softstyle): מידה רגילה (True to size).\n- טי-שירט פרימיום (Bella Canvas): גזרה מעט צמודה, מומלץ לעלות מידה אחת ללוק אוברסייז/סטריט.\n- קפוצ'ונים: מידה רגילה ונוחה.";
    } else if (lower.includes('משלוח') || lower.includes('משלוחים') || lower.includes('shipping') || lower.includes('delivery')) {
      reply = "מדיניות המשלוחים שלנו:\n- משלוח חינם בכל רכישה של 5 פריטים ומעלה!\n- משלוח רגיל (5-7 ימי עסקים): 29.90₪\n- משלוח אקספרס (2-3 ימי עסקים): 49.90₪";
    } else if (lower.includes('החזר') || lower.includes('החזרה') || lower.includes('החזרות') || lower.includes('return') || lower.includes('refund')) {
      reply = "ניתן להחזיר או להחליף כל פריט שלא נלבש ושלא כובס תוך 14 ימים מקבלת המשלוח.";
    }

    return { text: reply, status: "bot" };
  }

  async escalateToHuman(sessionId, customerName, messageText) {
    db.run("UPDATE chat_sessions SET status = 'escalated' WHERE id = ?", [sessionId]);
    
    const alertMsg = `🤖 <b>בוט מני: פניית לקוח הועברה לנציג אנושי!</b>\n\n` +
      `<b>לקוח:</b> ${customerName}\n` +
      `<b>מזהה שיחה:</b> <code>${sessionId}</code>\n` +
      `<b>הודעה אחרונה:</b>\n"${messageText}"\n\n` +
      `<b>מענה מהיר:</b> <code>/reply ${sessionId} כאן כותבים את התשובה</code>`;
      
    await telegram.sendMessage(alertMsg);
  }
}

module.exports = new MeniChatService();
