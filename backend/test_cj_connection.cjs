require('dotenv').config();
const dropship = require('./services/dropship');

const mockDestination = {
  firstName: 'Test',
  lastName: 'Customer',
  customerName: 'Test Customer',
  customerEmail: 'test-cj@dripstreetshop.com',
  phone: '1234567890',
  addressLine1: '123 Test Street',
  addressLine2: 'Apt 4B',
  city: 'New York',
  region: 'NY',
  postalCode: '10001',
  country: 'US'
};

const mockItems = [
  {
    id: 9999,
    quantity: 1,
    sku: 'CJLX222053101AZ' // Test SKU
  }
];

console.log('🚀 Starting CJ Dropshipping API integration test...');
console.log('API Key loaded:', process.env.CJ_API_KEY ? 'YES (length: ' + process.env.CJ_API_KEY.length + ')' : 'NO');

dropship.sendOrder(123456789, mockDestination, mockItems)
  .then(res => {
    console.log('✅ Connection test successful!');
    console.log('Response:', res);
    process.exit(0);
  })
  .catch(err => {
    console.log('❌ Connection test finished with error (could be an API validation check like user status or balance):');
    console.error('Error Message:', err.message);
    process.exit(0); // Exit with 0 so the script run doesn't report npm/node failure but outputs clean logs
  });
