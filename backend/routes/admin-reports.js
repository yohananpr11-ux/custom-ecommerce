const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

const timingSafeEqualStr = (a, b) => {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const requireAdminSecret = (req, res, next) => {
  const expected = String(process.env.DRIP_ADMIN_SECRET || '').trim();
  const provided = String(req.get('X-Admin-Secret') || '').trim();

  if (!expected || !timingSafeEqualStr(provided, expected)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  return next();
};

const dbGetAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.get(query, params, (err, row) => {
    if (err) return reject(err);
    resolve(row || null);
  });
});

const dbAllAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.all(query, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows || []);
  });
});

router.use(requireAdminSecret);

router.get('/orders-summary', async (req, res) => {
  try {
    const requestedHours = Number(req.query.since_hours);
    const sinceHours = Number.isFinite(requestedHours)
      ? Math.min(24 * 30, Math.max(1, Math.round(requestedHours)))
      : 24;

    const sinceModifier = `-${sinceHours} hours`;
    const row = await dbGetAsync(
      `SELECT
         COUNT(*) AS newOrders,
         COALESCE(SUM(totalAmount), 0) AS totalRevenue
       FROM orders
       WHERE datetime(createdAt) >= datetime('now', ?)`,
      [sinceModifier]
    );

    return res.json({
      sinceHours,
      windowStartUtc: new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString(),
      newOrders: Number(row && row.newOrders) || 0,
      totalRevenue: Number(Number(row && row.totalRevenue).toFixed(2)) || 0,
      currency: 'ILS',
    });
  } catch (err) {
    console.error('[admin-reports] orders-summary failed:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch orders summary' });
  }
});

router.get('/coupons-active', async (req, res) => {
  try {
    const rows = await dbAllAsync(
      `SELECT promo_code, created_at
       FROM leads
       WHERE is_used = 0
       ORDER BY datetime(created_at) DESC
       LIMIT 25`
    );

    const activeCoupons = rows.map((row) => {
      const createdAt = new Date(row.created_at || Date.now());
      const expiry = new Date(createdAt.getTime() + (30 * 24 * 60 * 60 * 1000));
      return {
        code: row.promo_code,
        discount: '10%',
        expiry: expiry.toISOString(),
      };
    });

    return res.json({
      count: activeCoupons.length,
      coupons: activeCoupons,
    });
  } catch (err) {
    console.error('[admin-reports] coupons-active failed:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch active coupons' });
  }
});

module.exports = router;
