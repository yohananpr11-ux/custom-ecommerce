'use strict';

/**
 * Focused, hermetic node:test coverage for prerender-products.cjs's strict
 * mode (PRERENDER_REQUIRE_API=true).
 *
 * Same approach as generate-sitemap.test.cjs: the script is a top-level CLI
 * IIFE, not an importable module, so each test copies it into a fresh temp
 * project (its own scripts/, dist/, and a minimal dist/index.html template
 * satisfying the script's own pre-flight TEMPLATE check) and spawns it as a
 * child process against a throwaway 127.0.0.1 HTTP fixture. No test can
 * write into the real frontend/dist, and no base URL used below can ever
 * resolve to a production or third-party host.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT_SRC = path.join(__dirname, 'prerender-products.cjs');

const MINIMAL_TEMPLATE = `<!doctype html>
<html>
  <head>
    <title>placeholder</title>
    <meta name="description" content="placeholder" />
  </head>
  <body><div id="root"></div></body>
</html>
`;

const BLANK_CREDENTIALS_ENV = {
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  PAYPAL_CLIENT_ID: '',
  PAYPAL_CLIENT_SECRET: '',
  PAYPLUS_API_KEY: '',
  PAYPLUS_SECRET_KEY: '',
  PAYPLUS_PAGE_UID: '',
  PRINTIFY_API_TOKEN: '',
  CJ_API_KEY: '',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_OWNER_CHAT_ID: '',
  RESEND_API_KEY: '',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: '',
  DRIP_ADMIN_SECRET: '',
};

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-test-'));
  const scriptsDir = path.join(dir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), MINIMAL_TEMPLATE, 'utf8');
  const scriptDest = path.join(scriptsDir, 'prerender-products.cjs');
  fs.copyFileSync(SCRIPT_SRC, scriptDest);
  return { dir, scriptDest };
}

function cleanupTempProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function startFixture(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => {
          for (const s of sockets) s.destroy();
          server.close(() => res());
        }),
      });
    });
  });
}

async function reserveClosedPort() {
  const fixture = await startFixture((_req, res) => res.end('unused'));
  const { port } = fixture;
  await fixture.close();
  return port;
}

/**
 * Spawns the script ASYNCHRONOUSLY (never spawnSync) -- the fixture HTTP
 * server above lives in this same process, and spawnSync would block the
 * entire event loop until the child exits, starving that server of any
 * chance to accept a connection or write a response (confirmed empirically
 * against generate-sitemap.test.cjs's identical harness: every round-trip
 * test hung until the *script's own* internal fetch timeout fired).
 */
function runScript(scriptDest, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptDest], {
      cwd,
      env: { ...BLANK_CREDENTIALS_ENV, PATH: process.env.PATH, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

test('prerender-products.cjs strict mode', async (t) => {
  await t.test('succeeds against a local HTTP fixture and writes the prerendered page', async () => {
    const fixture = await startFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([
        { id: 9001, title: 'Strict Mode Fixture Product', description: 'A fixture.', price: 74.5, imageUrl: 'https://example.com/x.jpg' },
      ]));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: fixture.baseUrl,
      }, dir);

      assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
      assert.match(result.stdout, /Loaded 1 product\(s\) from API \(strict mode\)/);

      const pagePath = path.join(dir, 'dist', 'product', '9001', 'index.html');
      assert.equal(fs.existsSync(pagePath), true);
      const html = fs.readFileSync(pagePath, 'utf8');
      assert.match(html, /Strict Mode Fixture Product/);
      assert.match(html, /application\/ld\+json/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed when PRERENDER_API_BASE is missing', async () => {
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: '',
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /requires PRERENDER_API_BASE to be explicitly set/);
      assert.equal(fs.existsSync(path.join(dir, 'dist', 'product')), false);
    } finally {
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed when the API is unreachable', async () => {
    const closedPort = await reserveClosedPort();
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: `http://127.0.0.1:${closedPort}`,
        PRERENDER_API_TIMEOUT_MS: '3000',
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /API request to .* failed/);
      assert.equal(fs.existsSync(path.join(dir, 'dist', 'product')), false);
    } finally {
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed on timeout', async () => {
    const fixture = await startFixture(() => {
      // Never respond -- forces the client-side AbortController timeout.
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: fixture.baseUrl,
        PRERENDER_API_TIMEOUT_MS: '300',
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /timed out after 300ms/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed on a non-2xx response', async () => {
    const fixture = await startFixture((req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: fixture.baseUrl,
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /HTTP 503/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed on malformed JSON', async () => {
    const fixture = await startFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json{');
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: fixture.baseUrl,
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /API response was not valid JSON/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed on an unexpected response shape', async () => {
    const fixture = await startFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ products: [{ id: 9001 }] }));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: fixture.baseUrl,
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /unexpected shape/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed when the API returns zero valid products', async () => {
    const fixture = await startFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ title: 'no id field' }, null]));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: fixture.baseUrl,
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /returned zero valid products/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed on an invalid timeout value', async () => {
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        PRERENDER_REQUIRE_API: 'true',
        PRERENDER_API_BASE: 'http://127.0.0.1:1',
        PRERENDER_API_TIMEOUT_MS: '-5',
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /invalid PRERENDER_API_TIMEOUT_MS/);
    } finally {
      cleanupTempProject(dir);
    }
  });
});
