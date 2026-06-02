const express = require('express');
const paymentControllerFactory = require('../controllers/paymentController');

// Factory: takes the shared processPaidOrderFulfillment(orderId, providerTag)
// so the webhook can dispatch to CJ via the existing multi-vendor fulfillment service.
module.exports = function paymentRoutesFactory(processPaidOrderFulfillment) {
  const router = express.Router();
  const { createMeshulamPayment, meshulamWebhook } = paymentControllerFactory(processPaidOrderFulfillment);

  // POST /api/payment/create
  router.post('/create', createMeshulamPayment);

  // POST /api/payment/webhook
  // Meshulam posts back form-encoded; the express.json() upstream is fine for JSON,
  // but Meshulam sends application/x-www-form-urlencoded — make sure we parse it here.
  router.post(
    '/webhook',
    express.urlencoded({ extended: true, limit: '1mb' }),
    express.json({ limit: '1mb' }), // tolerant: some test posts arrive as JSON
    meshulamWebhook
  );

  return router;
};
