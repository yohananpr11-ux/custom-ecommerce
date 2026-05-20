const { Resend } = require('resend');
const crypto = require('crypto');
const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:4000';

class EmailService {
  constructor() {
    this.resend = null;
    this.fromEmail = process.env.FROM_EMAIL || 'Drip Street Shop <hello@dripstreetshop.com>';
    this.logoUrl = process.env.BRAND_LOGO_URL || null;
    this.init();
  }

  getUnsubscribeSecret() {
    return process.env.UNSUBSCRIBE_SECRET || process.env.STRIPE_SECRET_KEY || 'drip-street-fallback-secret';
  }

  generateUnsubscribeSignature(email) {
    const secret = this.getUnsubscribeSecret();
    return crypto.createHmac('sha256', secret).update(String(email).trim().toLowerCase()).digest('hex');
  }

  init() {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && apiKey !== 'your_resend_api_key_here') {
      this.resend = new Resend(apiKey);
    } else {
      console.warn('⚠️ Resend API Key is not configured. Email service will run in mock/log mode.');
    }
  }

  renderLogoHeader() {
    if (this.logoUrl) {
      return `<img src="${this.logoUrl}" alt="DRIP STREET" style="max-height: 48px; max-width: 240px; display: block; margin: 0 auto;" />`;
    }
    return `<h1 style="margin: 0; font-size: 28px; font-weight: 900; letter-spacing: 0.15em; text-transform: uppercase; color: #ffffff;">DRIP STREET</h1>`;
  }


  async sendEmail({ to, subject, html, text = null, headers = {} }) {
    const recipient = Array.isArray(to) ? to[0] : to;
    const recipientStr = String(recipient || '').toLowerCase().trim();

    // Reputation Safeguard: Local junk and simulated/load-test domain filtration
    const isJunkOrSimulated = 
      recipientStr.includes('example.com') ||
      recipientStr.includes('test.com') ||
      recipientStr.includes('loadtest+') ||
      recipientStr.includes('+sim') ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientStr);

    if (isJunkOrSimulated) {
      console.log(`🛡️ [Reputation Safeguard] Skipped sending to simulated/junk address: ${recipientStr}`);
      return { ok: true, mocked: true, reason: 'safeguarded_junk_or_simulation' };
    }

    if (!this.resend) {
      console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}`);
      if (text) {
        console.log(`[MOCK EMAIL TEXT FALLBACK] ${text.slice(0, 300)}...`);
      }
      console.log(`[MOCK EMAIL BODY] ${html.slice(0, 300)}...`);
      return { ok: true, mocked: true };
    }

    try {
      const payload = {
        from: this.fromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      };
      if (text) {
        payload.text = text;
      }
      if (headers && Object.keys(headers).length > 0) {
        payload.headers = headers;
      }

      const response = await this.resend.emails.send(payload);
      console.log(`✅ Email sent successfully via Resend: ${subject} to ${to}`);
      return { ok: true, data: response.data };
    } catch (error) {
      console.error(`❌ Failed to send email via Resend to ${to}:`, error);
      return { ok: false, error };
    }
  }

  async sendCouponEmail(email, promoCode) {
    const subject = '🚀 Welcome to Drip Street - Here is your 10% Discount';
    const sig = this.generateUnsubscribeSignature(email);
    const unsubscribeUrl = `${API_BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`;
    
    const text = `Welcome to the Club!\n\nThanks for joining our exclusive streetwear circle. As a member of Drip Street, you will be first in line to receive seasonal drops, exclusive pricing details, and collection restocks.\n\nYour Unique Promo Code: ${promoCode}\n10% OFF YOUR FIRST ORDER\n\nShop The Collection: https://custom-ecommerce-seven.vercel.app\n\nNeed help? Contact us at support@dripstreet.shop\n\nTo unsubscribe from our newsletter, visit:\n${unsubscribeUrl}\n\n© 2026 DRIP STREET. All rights reserved.`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to the Club</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0c0c0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 40px auto; background-color: #121212; border: 1px solid #222222; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center; border-bottom: 1px solid #222222;">
              ${this.renderLogoHeader()}
              <p style="margin: 5px 0 0 0; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #888888;">Minimal Streetwear Built for Confidence</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; text-align: center;">Welcome to the Movement</h2>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.7; color: #b3b3b3; text-align: center;">
                Thanks for joining our exclusive streetwear circle. As a member of Drip Street, you will be first in line to receive seasonal drops, exclusive pricing details, and collection restocks.
              </p>
              
              <!-- Coupon Block -->
              <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 30px auto; background-color: #1a1a1a; border: 1px dashed #444444; border-radius: 8px; width: 100%; max-width: 320px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #888888; display: block; margin-bottom: 8px;">Your Unique Promo Code</span>
                    <span style="font-size: 24px; font-weight: 800; font-family: monospace; letter-spacing: 0.1em; color: #ffffff; display: block;">${promoCode}</span>
                    <span style="font-size: 12px; color: #4caf50; display: block; margin-top: 8px; font-weight: 600;">10% OFF YOUR FIRST ORDER</span>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <div style="text-align: center; margin-top: 35px;">
                <a href="https://custom-ecommerce-seven.vercel.app" target="_blank" style="background-color: #ffffff; color: #000000; text-decoration: none; padding: 14px 28px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; border-radius: 6px; display: inline-block; transition: opacity 0.2s;">Shop The Collection</a>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #0a0a0a; border-top: 1px solid #222222; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 12px; color: #666666;">
                Need help? Contact us at <a href="mailto:support@dripstreet.shop" style="color: #888888; text-decoration: underline;">support@dripstreet.shop</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #444444; text-transform: uppercase; letter-spacing: 0.05em;">
                &copy; 2026 DRIP STREET. All rights reserved.
              </p>
              <p style="margin: 10px 0 0 0; font-size: 10px; color: #444444;">
                You are receiving this because you signed up for the Drip Street newsletter. 
                <a href="${unsubscribeUrl}" target="_blank" style="color: #666666; text-decoration: underline; margin-left: 5px;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@dripstreetshop.com?subject=unsubscribe-${encodeURIComponent(email)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };

    return this.sendEmail({ to: email, subject, html, text, headers });
  }

  async sendOrderConfirmationEmail(email, orderId, customerName, items, totals, address = null) {
    const { subtotal, shipping = 0, discount = 0, total } = totals || {};
    const subject = `🛍️ Order Confirmed - Order #${orderId}`;
    
    // Build items rows & plain-text lines
    let itemsText = '';
    const itemRows = items.map(item => {
      const parts = String(item.title || '').split(' - ');
      const baseTitle = parts[0] || item.title;
      const color = item.color || parts[1] || 'Default';
      const size = item.size || parts[2] || 'OS';
      const price = Number(item.price || 0).toFixed(2);
      
      itemsText += `- ${baseTitle} (Color: ${color}, Size: ${size}) x ${item.quantity} - ₪${price}\n`;
      
      return `
        <tr style="border-bottom: 1px solid #222222;">
          <td style="padding: 16px 0; vertical-align: top;">
            <div style="font-weight: 700; color: #ffffff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">${baseTitle}</div>
            <div style="font-size: 12px; color: #888888; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.02em;">Color: ${color} | Size: ${size}</div>
          </td>
          <td style="padding: 16px 0; text-align: center; color: #b3b3b3; font-size: 14px; vertical-align: top;">${item.quantity}</td>
          <td style="padding: 16px 0; text-align: right; color: #ffffff; font-size: 14px; font-weight: 700; vertical-align: top;">₪${price}</td>
        </tr>
      `;
    }).join('');

    // Parse address for HTML and text falling back nicely
    let addressText = '';
    let shippingHtml = '';
    if (address) {
      let addr = null;
      try {
        addr = typeof address === 'string' ? JSON.parse(address) : address;
      } catch (e) {
        addr = { address1: address, name: customerName };
      }

      const name = addr.name || customerName;
      const street = addr.address1 || '';
      const street2Text = addr.address2 ? `, ${addr.address2}` : '';
      const city = addr.city || '';
      const state = addr.state || '';
      const zip = addr.zip || '';
      const country = addr.country || '';

      addressText = `\nSHIPPING ADDRESS:\n${name}\n${street}${street2Text}\n${city}${state ? ', ' + state : ''} ${zip}\n${country}\n`;

      shippingHtml = `
        <!-- Shipping Card -->
        <h3 style="margin: 30px 0 12px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #ffffff; border-bottom: 1px solid #333333; padding-bottom: 8px;">Delivery Details</h3>
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1a1a1a; border: 1px solid #222222; border-radius: 8px; margin-bottom: 30px;">
          <tr>
            <td style="padding: 20px;">
              <div style="font-weight: 700; color: #ffffff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Shipping Address</div>
              <div style="font-size: 13px; line-height: 1.6; color: #b3b3b3;">
                <div style="font-weight: 600; color: #ffffff;">${name}</div>
                <div style="margin-top: 4px;">${street}</div>
                ${addr.address2 ? `<div style="margin-top: 2px;">${addr.address2}</div>` : ''}
                <div style="margin-top: 2px;">${city}${state ? `, ${state}` : ''} ${zip}</div>
                <div style="margin-top: 2px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; color: #888888;">${country}</div>
              </div>
            </td>
          </tr>
        </table>
      `;
    }

    const text = `Order Confirmed - Order #${orderId}\n\nThank you, ${customerName}!\n\nYour payment was received, and your order has been sent to our production queue. We will send you another email with tracking details as soon as the package ships.\n\nORDER DETAILS:\n${itemsText}\nSubtotal: ₪${Number(subtotal).toFixed(2)}\nShipping: ${shipping > 0 ? `₪${Number(shipping).toFixed(2)}` : 'FREE'}\n${discount > 0 ? `Discount: -₪${Number(discount).toFixed(2)}\n` : ''}Total Amount Paid: ₪${Number(total).toFixed(2)}\n${addressText}\nTrack your order or get help by visiting support:\nhttps://custom-ecommerce-seven.vercel.app/shipping\n\n© 2026 DRIP STREET. All rights reserved.`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0c0c0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 40px auto; background-color: #121212; border: 1px solid #222222; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px; text-align: center; border-bottom: 1px solid #222222;">
              <div style="font-size: 12px; color: #4caf50; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 15px;">Payment Successful</div>
              ${this.renderLogoHeader()}
              <p style="margin: 10px 0 0 0; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #888888;">Order Confirmation #${orderId}</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 10px 0; font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff;">Thank you, ${customerName}!</h2>
              <p style="margin: 0 0 30px 0; font-size: 14px; line-height: 1.6; color: #b3b3b3;">
                Your payment was received, and your order has been sent to our production queue. We will send you another email with tracking details as soon as the package ships.
              </p>
              
              <!-- Items Table -->
              <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #ffffff; border-bottom: 1px solid #333333; padding-bottom: 8px;">Order Details</h3>
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 30px;">
                <thead>
                  <tr style="color: #666666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">
                    <th align="left" style="padding-bottom: 10px; font-weight: 500;">Item</th>
                    <th align="center" style="padding-bottom: 10px; font-weight: 500;">Qty</th>
                    <th align="right" style="padding-bottom: 10px; font-weight: 500;">Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>

              <!-- Totals -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top: 1px solid #222222; padding-top: 16px;">
                <tr>
                  <td style="padding: 4px 0; color: #888888; font-size: 14px;">Subtotal</td>
                  <td align="right" style="padding: 4px 0; color: #ffffff; font-size: 14px; font-weight: 600;">₪${Number(subtotal).toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #888888; font-size: 14px;">Shipping</td>
                  <td align="right" style="padding: 4px 0; ${shipping > 0 ? 'color: #ffffff;' : 'color: #4caf50;'} font-size: 14px; font-weight: 600;">${shipping > 0 ? `₪${Number(shipping).toFixed(2)}` : 'FREE'}</td>
                </tr>
                ${discount > 0 ? `<tr>
                  <td style="padding: 4px 0; color: #888888; font-size: 14px;">Discount</td>
                  <td align="right" style="padding: 4px 0; color: #4caf50; font-size: 14px; font-weight: 600;">-₪${Number(discount).toFixed(2)}</td>
                </tr>` : ''}
                <tr style="font-weight: 700; font-size: 16px; color: #ffffff;">
                  <td style="padding: 16px 0 0 0; font-size: 15px; text-transform: uppercase; letter-spacing: 0.05em;">Total Amount Paid</td>
                  <td align="right" style="padding: 16px 0 0 0; font-size: 18px;">₪${Number(total).toFixed(2)}</td>
                </tr>
              </table>

              ${shippingHtml}

              <!-- Track Order & Support CTA -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="text-align: center; margin-top: 40px; border-top: 1px solid #222222; padding-top: 30px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #b3b3b3;">You can track your fulfillment status and shipping updates in real-time on our portal.</p>
                    <div style="margin-bottom: 15px;">
                      <a href="https://custom-ecommerce-seven.vercel.app/shipping" target="_blank" style="background-color: #ffffff; color: #000000; text-decoration: none; padding: 14px 28px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; border-radius: 6px; display: inline-block;">Track Your Order</a>
                    </div>
                    <a href="https://custom-ecommerce-seven.vercel.app/contact" target="_blank" style="color: #888888; text-decoration: underline; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;">Contact Customer Support</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #0a0a0a; border-top: 1px solid #222222; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #444444; text-transform: uppercase; letter-spacing: 0.05em;">
                &copy; 2026 DRIP STREET. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const headers = {
      'X-Entity-Ref-ID': `drip-street-order-${orderId}`
    };

    return this.sendEmail({ to: email, subject, html, text, headers });
  }
}

module.exports = new EmailService();
