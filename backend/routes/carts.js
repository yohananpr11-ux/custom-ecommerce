const express = require('express');
const router = express.Router();
const db = require('../db');

const dbRunAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function runCallback(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

router.post('/abandoned', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const cartFingerprint = String(req.body?.cart_fingerprint || '').trim();
    const source = String(req.body?.source || 'web').trim().slice(0, 40);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!isValidEmail(email) || !cartFingerprint) {
      return res.status(400).json({ ok: false, error: 'email and cart_fingerprint are required' });
    }

    const itemsJson = JSON.stringify(items);

    await dbRunAsync(
      `INSERT INTO abandoned_carts (email, cart_fingerprint, items_json, source, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(email, cart_fingerprint)
       DO UPDATE SET items_json = excluded.items_json,
                     source = excluded.source,
                     updated_at = CURRENT_TIMESTAMP`,
      [email, cartFingerprint, itemsJson, source]
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
