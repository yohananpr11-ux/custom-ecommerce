const express = require('express');
const { createMeshulamPayment } = require('../controllers/paymentController');

const router = express.Router();

// POST /api/payment/create
router.post('/create', createMeshulamPayment);

module.exports = router;
