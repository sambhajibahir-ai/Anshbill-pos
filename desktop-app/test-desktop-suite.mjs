import { openDb } from './server/src/db.js';
import { createApp } from './server/src/app.js';
import assert from 'node:assert';

console.log('=== RUNNING COMPREHENSIVE DESKTOP BACKEND INTEGRATION TESTS ===\n');

const db = await openDb(':memory:');
const app = createApp(db);

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function runTests() {
  try {
    // Test 1: Healthcheck
    console.log('Test 1: Healthcheck endpoint...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.strictEqual(healthBody.ok, true);
    assert.strictEqual(healthBody.mode, 'desktop-offline');
    console.log('  -> Healthcheck PASSED');

    // Test 2: Admin Login
    console.log('Test 2: Admin authentication...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.strictEqual(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.ok(loginBody.token, 'Token should be returned');
    const token = loginBody.token;
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    console.log('  -> Admin login PASSED');

    // Test 3: Settings Fetch & Update
    console.log('Test 3: Settings fetch and update...');
    const getSettingsRes = await fetch(`${baseUrl}/api/settings`, { headers: authHeaders });
    assert.strictEqual(getSettingsRes.status, 200);
    const settingsBody = await getSettingsRes.json();
    assert.ok(settingsBody.shop_name);

    const updateSettingsRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ shop_name: 'ATB Test Supermarket', shop_gstin: '27AAPFU0939F1ZV' })
    });
    assert.strictEqual(updateSettingsRes.status, 200);
    const updatedSettings = await updateSettingsRes.json();
    assert.strictEqual(updatedSettings.shop_name, 'ATB Test Supermarket');
    console.log('  -> Settings update PASSED');

    // Test 4: Create Product
    console.log('Test 4: Product management (creation & catalog)...');
    const prodRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Organic Wheat Flour 5kg',
        price: 25000, // Rs 250 in paise
        cost: 20000,
        gstRate: 5,
        taxInclusive: true,
        unit: 'kg',
        openingStock: 50,
        reorderLevel: 10,
        category: 'Grains'
      })
    });
    assert.strictEqual(prodRes.status, 201);
    const prodBody = await prodRes.json();
    assert.strictEqual(prodBody.name, 'Organic Wheat Flour 5kg');
    assert.strictEqual(prodBody.stock, 50);
    const productId = prodBody.id;
    const barcode = prodBody.barcode;
    console.log(`  -> Product created with ID: ${productId}, Barcode: ${barcode}`);

    // Test 5: Scan Product by Barcode
    console.log('Test 5: Barcode scanning endpoint...');
    const scanRes = await fetch(`${baseUrl}/api/products/barcode/${barcode}`, { headers: authHeaders });
    assert.strictEqual(scanRes.status, 200);
    const scannedProd = await scanRes.json();
    assert.strictEqual(scannedProd.id, productId);
    console.log('  -> Barcode lookup PASSED');

    // Test 6: Create Customer
    console.log('Test 6: Customer directory...');
    const custRes = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Rahul Sharma',
        phone: '9876543210'
      })
    });
    assert.strictEqual(custRes.status, 201);
    const custBody = await custRes.json();
    assert.strictEqual(custBody.phone, '9876543210');
    console.log('  -> Customer directory PASSED');

    // Test 7: Create Invoice & Deduct Stock
    console.log('Test 7: Invoicing & Stock Decrement Transaction...');
    const invRes = await fetch(`${baseUrl}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        items: [{ productId, qty: 2, discountPct: 0 }],
        customer: { name: 'Rahul Sharma', phone: '9876543210' },
        paymentMode: 'cash',
        amountTendered: 50000
      })
    });
    assert.strictEqual(invRes.status, 201);
    const invBody = await invRes.json();
    assert.strictEqual(invBody.totals.grandTotal, 50000);
    assert.ok(invBody.invoiceNo.startsWith('AB/'));
    const invoiceId = invBody.id;
    console.log(`  -> Invoice #${invBody.invoiceNo} created for Rs ${(invBody.totals.grandTotal / 100).toFixed(2)}`);

    // Verify stock decremented from 50 to 48
    const checkStockRes = await fetch(`${baseUrl}/api/products/${productId}`, { headers: authHeaders });
    const checkStockBody = await checkStockRes.json();
    assert.strictEqual(checkStockBody.stock, 48);
    console.log('  -> Stock properly decremented to 48');

    // Test 8: Daily Reports & Dashboard
    console.log('Test 8: Daily Sales & Analytics reports...');
    const dashRes = await fetch(`${baseUrl}/api/reports/dashboard`, { headers: authHeaders });
    assert.strictEqual(dashRes.status, 200);
    const dashBody = await dashRes.json();
    assert.ok(dashBody.recent.length >= 1);
    assert.strictEqual(dashBody.recent[0].id, invoiceId);
    console.log('  -> Dashboard analytics PASSED');

    console.log('\n======================================================');
    console.log('✅ ALL 8 CORE FUNCTIONALITY TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  if (server) server.close();
  process.exit(1);
});
