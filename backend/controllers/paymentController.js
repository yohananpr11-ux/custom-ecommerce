/**
 * Meshulam (Grow) payment controller.
 *
 * Wraps Meshulam's hosted-page Sandbox API:
 *   POST https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess
 *
 * Production endpoint (swap once live keys are provisioned):
 *   POST https://meshulam.co.il/api/light/server/1.0/createPaymentProcess
 *
 * Env (see backend/.env.example):
 *   MESHULAM_PAGE_CODE   - hosted payment page code from Grow dashboard
 *   MESHULAM_USER_ID     - merchant userId from Grow dashboard
 *   MESHULAM_API_KEY     - server-to-server API key (kept ONLY on the server)
 *   MESHULAM_ENV         - "sandbox" (default) or "production"
 */

const axios = require('axios');

const SANDBOX_URL = 'https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess';
const PRODUCTION_URL = 'https://meshulam.co.il/api/light/server/1.0/createPaymentProcess';

function getMeshulamEndpoint() {
  const env = String(process.env.MESHULAM_ENV || 'sandbox').toLowerCase();
  return env === 'production' ? PRODUCTION_URL : SANDBOX_URL;
}

function sanitizeAmount(rawAmount) {
  const numeric = Number(rawAmount);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  // Meshulam expects up to 2 decimal places.
  return Math.round(numeric * 100) / 100;
}

/**
 * POST /api/payment/create
 *
 * Body:
 *   { amount: number, orderId: string, customer: { fullName, email, phone } }
 *
 * Response on success:
 *   { ok: true, redirectUrl: string, transactionId: string, raw: object }
 *
 * Response on failure:
 *   400 { ok: false, error: 'validation_failed', details: string }
 *   500 { ok: false, error: 'meshulam_failed', details: string }
 */
async function createMeshulamPayment(req, res) {
  const { amount, orderId, customer = {} } = req.body || {};

  const cleanAmount = sanitizeAmount(amount);
  if (!cleanAmount) {
    return res.status(400).json({ ok: false, error: 'validation_failed', details: 'amount must be a positive number' });
  }
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ ok: false, error: 'validation_failed', details: 'orderId is required' });
  }

  const pageCode = process.env.MESHULAM_PAGE_CODE;
  const userId = process.env.MESHULAM_USER_ID;
  const apiKey = process.env.MESHULAM_API_KEY;

  if (!pageCode || !userId || !apiKey) {
    return res.status(500).json({
      ok: false,
      error: 'meshulam_not_configured',
      details: 'MESHULAM_PAGE_CODE, MESHULAM_USER_ID, and MESHULAM_API_KEY must all be set.',
    });
  }

  const fullName = String(customer.fullName || '').trim().slice(0, 80);
  const email = String(customer.email || '').trim().slice(0, 120);
  const phone = String(customer.phone || '').trim().slice(0, 40);

  // Meshulam Light API uses a form-encoded payload (not JSON).
  const params = new URLSearchParams();
  params.set('pageCode', pageCode);
  params.set('userId', userId);
  params.set('apiKey', apiKey);
  params.set('sum', String(cleanAmount));
  params.set('description', `Drip Street order ${orderId}`);
  if (fullName) params.set('pageField[fullName]', fullName);
  if (email) params.set('pageField[email]', email);
  if (phone) params.set('pageField[phone]', phone);
  params.set('cField1', orderId); // surfaced back to us on webhook for reconciliation

  try {
    const response = await axios.post(getMeshulamEndpoint(), params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    const payload = response.data || {};
    // Meshulam Light returns { status: 1, data: { url, processId } } on success.
    if (Number(payload.status) !== 1) {
      return res.status(502).json({
        ok: false,
        error: 'meshulam_rejected',
        details: payload.err || payload.message || 'Meshulam refused the payment request.',
        raw: payload,
      });
    }

    const data = payload.data || {};
    return res.json({
      ok: true,
      redirectUrl: data.url || null,
      transactionId: data.processId || data.transactionId || null,
      raw: payload,
    });
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const details = err.response ? err.response.data : err.message;
    console.error('[meshulam] createPaymentProcess failed:', details);
    return res.status(502).json({ ok: false, error: 'meshulam_failed', details });
  }
}

module.exports = { createMeshulamPayment };
