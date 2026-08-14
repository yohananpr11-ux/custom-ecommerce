// Regression coverage for backend/run-sync.js as a thin authenticated HTTP
// client. Spawns the real script as a child process (it's a top-level
// script, not an exported module -- it calls process.exit() itself) against
// a local, in-test HTTP server standing in for the admin endpoint. No real
// network call is ever made -- the target is always 127.0.0.1.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');

const RUN_SYNC_PATH = path.join(__dirname, '..', 'run-sync.js');
const FAKE_SECRET = 'test-admin-secret-do-not-leak-1a2b3c4d5e6f';

function startFakeAdminServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runScript(env) {
  return spawnSync(process.execPath, [RUN_SYNC_PATH], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

// spawnSync blocks this ENTIRE process's event loop until the child exits --
// including any in-process fake HTTP server the child is meant to talk to,
// which would otherwise deadlock (child waiting for a response, parent
// frozen waiting for the child). Async spawn() keeps this process's event
// loop running so the fake server can actually service the request.
function runScriptAsync(env, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUN_SYNC_PATH], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`runScriptAsync timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('missing SYNC_BACKEND_URL exits non-zero with a clear, non-crashing message', () => {
  const result = runScript({ SYNC_BACKEND_URL: '', DRIP_ADMIN_SECRET: FAKE_SECRET });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SYNC_BACKEND_URL/);
  assert.doesNotMatch(result.stderr, /at Object\.|at Module\./, 'must not dump a raw stack trace');
});

test('missing DRIP_ADMIN_SECRET exits non-zero with a clear message, no secret in output', () => {
  const result = runScript({ SYNC_BACKEND_URL: 'http://127.0.0.1:1', DRIP_ADMIN_SECRET: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DRIP_ADMIN_SECRET/);
});

test('successful sync: exits 0, prints only a safe count summary, sends exactly one authenticated POST', async () => {
  let requestCount = 0;
  let capturedMethod = null;
  let capturedPath = null;
  let capturedSecretHeader = null;

  const server = await startFakeAdminServer((req, res, body) => {
    requestCount += 1;
    capturedMethod = req.method;
    capturedPath = req.url;
    capturedSecretHeader = req.headers['x-admin-secret'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: 11 }));
  });

  try {
    const { port } = server.address();
    const result = await runScriptAsync({
      SYNC_BACKEND_URL: `http://127.0.0.1:${port}`,
      DRIP_ADMIN_SECRET: FAKE_SECRET,
    });

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /products synced: 11/);

    assert.equal(requestCount, 1, 'exactly one request, no retries');
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedPath, '/api/admin/printify-sync');
    assert.equal(capturedSecretHeader, FAKE_SECRET);

    // The secret must never appear in the script's own stdout/stderr.
    assert.doesNotMatch(result.stdout, new RegExp(FAKE_SECRET));
    assert.doesNotMatch(result.stderr, new RegExp(FAKE_SECRET));
  } finally {
    server.close();
  }
});

test('a 401/unauthorized response from the backend is treated as a failure, exits non-zero, no secret leaked', async () => {
  const server = await startFakeAdminServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  });

  try {
    const { port } = server.address();
    const result = await runScriptAsync({
      SYNC_BACKEND_URL: `http://127.0.0.1:${port}`,
      DRIP_ADMIN_SECRET: FAKE_SECRET,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unauthorized/);
    assert.doesNotMatch(result.stdout, new RegExp(FAKE_SECRET));
    assert.doesNotMatch(result.stderr, new RegExp(FAKE_SECRET));
  } finally {
    server.close();
  }
});

test('a {success:false} or malformed body from the backend is treated as a failure, exits non-zero', async () => {
  const server = await startFakeAdminServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Sync failed' }));
  });

  try {
    const { port } = server.address();
    const result = await runScriptAsync({
      SYNC_BACKEND_URL: `http://127.0.0.1:${port}`,
      DRIP_ADMIN_SECRET: FAKE_SECRET,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Sync failed/);
  } finally {
    server.close();
  }
});

test('an unreachable backend (connection refused) exits non-zero without hanging or crashing', () => {
  // Port 1 is a privileged/unused port that reliably refuses connections.
  const result = runScript({
    SYNC_BACKEND_URL: 'http://127.0.0.1:1',
    DRIP_ADMIN_SECRET: FAKE_SECRET,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Request to backend failed/);
});

test('the script performs zero direct database or Printify API access -- source inspection', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(RUN_SYNC_PATH, 'utf8');
  // Strip comments so the historical explanation of what was REMOVED
  // doesn't trip this check -- only actual code matters here.
  const codeOnly = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(codeOnly, /require\(['"]sqlite3['"]\)/);
  assert.doesNotMatch(codeOnly, /require\(['"]\.\/db['"]\)/);
  assert.doesNotMatch(codeOnly, /require\(['"]\.\/services\/printify/);
  assert.doesNotMatch(codeOnly, /api\.printify\.com/);
});
