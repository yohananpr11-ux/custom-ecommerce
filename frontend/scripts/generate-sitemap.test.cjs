'use strict';

/**
 * Focused, hermetic node:test coverage for generate-sitemap.cjs's strict
 * mode (SITEMAP_REQUIRE_API=true).
 *
 * Each test spawns the real script as a child process (it is a top-level
 * IIFE CLI script, not an importable module, so require()-ing it directly
 * would execute it uncontrolled at import time) against a throwaway local
 * HTTP fixture server bound to 127.0.0.1 on an OS-assigned ephemeral port.
 * The script itself is copied into a fresh temp directory per test (its
 * PUBLIC_DIR/DIST_DIR are resolved relative to its own __dirname, not the
 * process cwd) so no test can ever write into the real frontend/public or
 * frontend/dist. No DB_PATH is set anywhere: strict mode never touches the
 * local SQLite path, so it is irrelevant to these tests by construction.
 *
 * Every base URL used below is an explicit 127.0.0.1 loopback address —
 * there is no code path in this file that can resolve to a production or
 * third-party host, since strict mode itself refuses to run without an
 * explicitly supplied SITEMAP_API_BASE (see the "missing base URL" test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT_SRC = path.join(__dirname, 'generate-sitemap.cjs');

// Defensive credential blanking, even though this script never reads any
// of these — keeps every child process structurally incapable of holding
// a real credential, consistent with every other hermetic test in this repo.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-test-'));
  const scriptsDir = path.join(dir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  const scriptDest = path.join(scriptsDir, 'generate-sitemap.cjs');
  fs.copyFileSync(SCRIPT_SRC, scriptDest);
  return { dir, scriptDest };
}

function cleanupTempProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Starts a throwaway HTTP fixture on loopback; caller controls the handler. */
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

/** Grabs a port, then frees it immediately -> guaranteed nothing is listening. */
async function reserveClosedPort() {
  const fixture = await startFixture((_req, res) => res.end('unused'));
  const { port } = fixture;
  await fixture.close();
  return port;
}

/**
 * Spawns the script ASYNCHRONOUSLY (never spawnSync). The fixture HTTP
 * server above lives in this same process — spawnSync blocks the entire
 * event loop until the child exits, which would starve that server of any
 * chance to ever accept a connection or write a response, deadlocking
 * every test that expects a real round trip (confirmed empirically: an
 * earlier spawnSync-based version of this harness hung every such test
 * until the *script's own* internal fetch timeout fired).
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

test('generate-sitemap.cjs strict mode', async (t) => {
  await t.test('succeeds against a local HTTP fixture and writes both artifacts', async () => {
    const fixture = await startFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ids: [9001] }));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: fixture.baseUrl,
      }, dir);

      assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
      assert.match(result.stdout, /Loaded 1 product ID\(s\) from API \(strict mode\)/);
      assert.doesNotMatch(result.stdout, /live API/i);

      const publicXml = fs.readFileSync(path.join(dir, 'public', 'sitemap.xml'), 'utf8');
      const distXml = fs.readFileSync(path.join(dir, 'dist', 'sitemap.xml'), 'utf8');
      assert.match(publicXml, /\/product\/9001/);
      assert.match(distXml, /\/product\/9001/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed when SITEMAP_API_BASE is missing', async () => {
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: '',
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /requires SITEMAP_API_BASE to be explicitly set/);
      assert.equal(fs.existsSync(path.join(dir, 'public', 'sitemap.xml')), false);
    } finally {
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed when the API is unreachable', async () => {
    const closedPort = await reserveClosedPort();
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: `http://127.0.0.1:${closedPort}`,
        SITEMAP_API_TIMEOUT_MS: '3000',
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /API request to .* failed/);
      assert.equal(fs.existsSync(path.join(dir, 'public', 'sitemap.xml')), false);
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
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: fixture.baseUrl,
        SITEMAP_API_TIMEOUT_MS: '300',
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
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: fixture.baseUrl,
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /HTTP 500/);
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
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: fixture.baseUrl,
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
      res.end(JSON.stringify({ unexpected: 'shape' }));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: fixture.baseUrl,
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /unexpected shape/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed when the API returns zero product IDs', async () => {
    const fixture = await startFixture((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ids: [] }));
    });
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: fixture.baseUrl,
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /returned zero product IDs/);
    } finally {
      await fixture.close();
      cleanupTempProject(dir);
    }
  });

  await t.test('fails closed on an invalid timeout value', async () => {
    const { dir, scriptDest } = makeTempProject();
    try {
      const result = await runScript(scriptDest, {
        SITEMAP_REQUIRE_API: 'true',
        SITEMAP_API_BASE: 'http://127.0.0.1:1',
        SITEMAP_API_TIMEOUT_MS: 'not-a-number',
      }, dir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /invalid SITEMAP_API_TIMEOUT_MS/);
    } finally {
      cleanupTempProject(dir);
    }
  });
});
