const axios = require('axios');
require('dotenv').config();

// Try to get token from environment - Render sets this as env var
const PRINTIFY_API_TOKEN = process.env.PRINTIFY_API_TOKEN || process.env.PRINTIFY_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID || '27495153';
const WEBHOOK_URL = 'https://custom-ecommerce-qp30.onrender.com/api/webhooks/printify';

// Check if token is just a placeholder
if (!PRINTIFY_API_TOKEN || PRINTIFY_API_TOKEN === 'YOUR_PRINTIFY_TOKEN') {
  console.log('⚠️  Note: PRINTIFY_API_TOKEN not found locally.');
  console.log('    If running on Render, the token should be set as an environment variable.');
  console.log('    If running locally, update your .env file with the real token.');
  console.log('\n❌ Cannot proceed without a valid token.\n');
  process.exit(1);
}

const events = [
  'shop:product:updated',
  'shop:product:deleted',
  'shop:product:published'
];

async function registerWebhooks() {

  console.log('🔗 Registering Printify Webhooks...');
  console.log(`   Shop ID: ${PRINTIFY_SHOP_ID}`);
  console.log(`   Webhook URL: ${WEBHOOK_URL}`);
  console.log(`   Events: ${events.join(', ')}\n`);

  const apiUrl = `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/webhooks.json`;
  const headers = {
    'Authorization': `Bearer ${PRINTIFY_API_TOKEN}`,
    'Content-Type': 'application/json'
  };

  let successCount = 0;
  let errorCount = 0;

  for (const event of events) {
    try {
      console.log(`⏳ Registering event: ${event}...`);

      const payload = {
        topic: event,
        address: WEBHOOK_URL
      };

      const response = await axios.post(apiUrl, payload, { headers });

      if (response.status === 200 || response.status === 201) {
        console.log(`✅ Successfully registered: ${event}`);
        console.log(`   Webhook ID: ${response.data.id || 'N/A'}\n`);
        successCount++;
      }
    } catch (error) {
      console.error(`❌ Failed to register: ${event}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        console.error(`   Error: ${error.message}`);
      }
      console.log();
      errorCount++;
    }
  }

  console.log('━'.repeat(60));
  console.log(`📊 Summary: ${successCount} successful, ${errorCount} failed`);

  if (errorCount === 0) {
    console.log('✅ All webhooks registered successfully!');
    console.log('   Printify will now send events to your store.');
    process.exit(0);
  } else {
    console.log('⚠️  Some webhooks failed to register. Check the errors above.');
    process.exit(1);
  }
}

registerWebhooks();
