const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE_URL || 'https://custom-ecommerce-qp30.onrender.com';
const BOT_COUNT = Number(process.env.BOT_COUNT || 20);
const CONCURRENCY = Number(process.env.BOT_CONCURRENCY || 5);
const REQUEST_TIMEOUT_MS = Number(process.env.BOT_TIMEOUT_MS || 20000);

const client = axios.create({
  baseURL: API_BASE,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json'
  }
});

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];

const sampleNames = [
  'Avi Cohen',
  'Noa Levi',
  'Daniel Mizrahi',
  'Yael Ben David',
  'Omer Azulay',
  'Roni Shalev'
];

const sampleStreets = [
  'Dizengoff 45, Tel Aviv',
  'Herzl 13, Haifa',
  'Jaffa 20, Jerusalem',
  'Rothschild 9, Tel Aviv',
  'Hanasi 44, Beer Sheva',
  'Balfour 7, Netanya'
];

function parseOrderIdFromPaymentUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/(\d+)(?:\?.*)?$/);
  return match ? Number(match[1]) : null;
}

function buildRandomItems(products) {
  const itemCount = rand(1, 3);
  const chosen = new Set();
  const items = [];

  while (items.length < itemCount && chosen.size < products.length) {
    const p = pick(products);
    if (chosen.has(p.id)) continue;
    chosen.add(p.id);

    items.push({
      id: p.id,
      title: p.title,
      price: Number(p.price),
      quantity: rand(1, 2)
    });
  }

  return items;
}

function sumTotal(items) {
  return items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function runBot(botIndex) {
  const startedAt = Date.now();
  const trace = [];

  const botSessionId = `loadtest-session-${botIndex}-${Date.now()}`;
  const customerName = `[SIM] ${pick(sampleNames)} #${botIndex}`;
  const customerEmail = `loadtest+bot${botIndex}@example.com`;
  const address = `${pick(sampleStreets)} [SIM]`;

  try {
    const visitStart = Date.now();
    await client.post('/api/analytics/visit', {
      sessionId: botSessionId,
      path: '/',
      locale: 'he',
      currency: 'ILS',
      source: 'load-test-bot'
    });
    trace.push({ step: 'visit', ok: true, ms: Date.now() - visitStart });

    const productsStart = Date.now();
    const productsRes = await client.get('/api/products');
    const products = Array.isArray(productsRes.data) ? productsRes.data : [];
    trace.push({ step: 'list_products', ok: true, ms: Date.now() - productsStart, count: products.length });

    if (!products.length) {
      throw new Error('No products returned from /api/products');
    }

    const selected = pick(products);
    const detailsStart = Date.now();
    await client.get(`/api/products/${selected.id}`);
    trace.push({ step: 'product_details', ok: true, ms: Date.now() - detailsStart, productId: selected.id });

    const items = buildRandomItems(products);
    const totalAmount = sumTotal(items);

    const checkoutStart = Date.now();
    const checkoutRes = await client.post('/api/checkout/payplus', {
      customerName,
      customerEmail,
      address,
      items,
      totalAmount
    });
    trace.push({ step: 'checkout_init', ok: true, ms: Date.now() - checkoutStart });

    if (!checkoutRes.data || !checkoutRes.data.success || !checkoutRes.data.paymentUrl) {
      throw new Error('Checkout init did not return success/paymentUrl');
    }

    const orderId = parseOrderIdFromPaymentUrl(checkoutRes.data.paymentUrl);
    if (!orderId) {
      throw new Error('Could not parse orderId from paymentUrl');
    }

    const paymentStart = Date.now();
    await client.post('/api/webhooks/payplus', {
      transaction_uid: `sim-tx-${botIndex}-${Date.now()}`,
      status: 'success',
      custom_field: String(orderId)
    });
    trace.push({ step: 'payment_webhook', ok: true, ms: Date.now() - paymentStart, orderId });

    return {
      botIndex,
      ok: true,
      orderId,
      elapsedMs: Date.now() - startedAt,
      trace
    };
  } catch (error) {
    const status = error.response ? error.response.status : null;
    const details = error.response ? JSON.stringify(error.response.data) : error.message;

    trace.push({
      step: 'failed',
      ok: false,
      status,
      details
    });

    return {
      botIndex,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      trace,
      error: details
    };
  }
}

async function runPool(total, concurrency, worker) {
  const results = new Array(total);
  let cursor = 0;

  async function next() {
    const idx = cursor;
    cursor += 1;
    if (idx >= total) return;
    results[idx] = await worker(idx + 1);
    await next();
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, total); i += 1) {
    workers.push(next());
  }

  await Promise.all(workers);
  return results;
}

function buildUxFeedback(summary) {
  const feedback = [];

  if (summary.successRate < 95) {
    feedback.push('Checkout reliability is below launch target. Investigate failed bot traces and add retry/backoff for transient errors.');
  } else {
    feedback.push('Checkout reliability looks launch-ready under this test profile.');
  }

  if (summary.p95Ms > 6000) {
    feedback.push('Perceived flow feels slow at p95. Prioritize backend response-time optimization and warm-instance strategy.');
  } else {
    feedback.push('Flow speed is acceptable for end users under moderate concurrency.');
  }

  feedback.push('Visit and payment notifications are now emitted in real time to Telegram for operational visibility.');
  feedback.push('Simulation orders are marked and excluded from Printify fulfillment to avoid accidental production charges during load tests.');

  return feedback;
}

function writeReport(results, startedAtIso, endedAtIso) {
  const successes = results.filter(r => r.ok);
  const failures = results.filter(r => !r.ok);
  const durations = results.map(r => r.elapsedMs);
  const summary = {
    totalBots: results.length,
    passed: successes.length,
    failed: failures.length,
    successRate: results.length ? (successes.length / results.length) * 100 : 0,
    avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    p95Ms: Math.round(percentile(durations, 95)),
    maxMs: durations.length ? Math.max(...durations) : 0
  };

  const feedback = buildUxFeedback(summary);

  const reportLines = [];
  reportLines.push('# Load Test Report - Storefront Purchase Simulation');
  reportLines.push('');
  reportLines.push(`- Start: ${startedAtIso}`);
  reportLines.push(`- End: ${endedAtIso}`);
  reportLines.push(`- API Base: ${API_BASE}`);
  reportLines.push(`- Bots: ${summary.totalBots}`);
  reportLines.push(`- Concurrency: ${CONCURRENCY}`);
  reportLines.push('');
  reportLines.push('## Summary');
  reportLines.push(`- Passed: ${summary.passed}`);
  reportLines.push(`- Failed: ${summary.failed}`);
  reportLines.push(`- Success rate: ${summary.successRate.toFixed(2)}%`);
  reportLines.push(`- Average duration: ${summary.avgMs} ms`);
  reportLines.push(`- P95 duration: ${summary.p95Ms} ms`);
  reportLines.push(`- Max duration: ${summary.maxMs} ms`);
  reportLines.push('');
  reportLines.push('## UX and Purchase Experience Notes');
  feedback.forEach(note => reportLines.push(`- ${note}`));
  reportLines.push('');
  reportLines.push('## Detailed Bot Results');

  results.forEach((r) => {
    reportLines.push(`- Bot #${r.botIndex}: ${r.ok ? 'PASS' : 'FAIL'} (${r.elapsedMs} ms)`);
    if (r.orderId) reportLines.push(`  - Order ID: ${r.orderId}`);
    r.trace.forEach(step => {
      if (step.ok) {
        reportLines.push(`  - ${step.step}: ok (${step.ms || 0} ms)`);
      } else {
        reportLines.push(`  - ${step.step}: failed ${step.status ? `(HTTP ${step.status})` : ''} ${step.details || ''}`);
      }
    });
  });

  const dir = path.join(__dirname, 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const fileName = `load-test-report-${Date.now()}.md`;
  const outputPath = path.join(dir, fileName);
  fs.writeFileSync(outputPath, reportLines.join('\n'), 'utf8');

  return { outputPath, summary };
}

async function main() {
  const startedAtIso = new Date().toISOString();
  console.log(`Starting load simulation with ${BOT_COUNT} bots (concurrency ${CONCURRENCY}) against ${API_BASE}`);

  const results = await runPool(BOT_COUNT, CONCURRENCY, runBot);
  const endedAtIso = new Date().toISOString();

  const { outputPath, summary } = writeReport(results, startedAtIso, endedAtIso);

  console.log('Load simulation complete.');
  console.log(`Passed: ${summary.passed}/${summary.totalBots}`);
  console.log(`Failed: ${summary.failed}/${summary.totalBots}`);
  console.log(`Success rate: ${summary.successRate.toFixed(2)}%`);
  console.log(`P95: ${summary.p95Ms} ms`);
  console.log(`Report: ${outputPath}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Load simulation crashed:', err);
  process.exit(1);
});
