// Fails loudly if backend/package.json's engines.node ever silently
// diverges from the Node version this CI job actually pins via
// actions/setup-node (passed as argv[2]) -- the two are otherwise
// independent strings with nothing structurally forcing them to agree.
//
// Why only package.json: Render's own docs place a .node-version/.nvmrc
// file at "the root of your repo", with no documented behavior for how
// (or whether) that interacts with a service's configured Root Directory
// in a monorepo. This repository's Render service has rootDir: backend,
// and no official Render documentation confirms a .node-version file
// placed inside backend/ (rather than the true repository root) is ever
// discovered. package.json's engines field has no such ambiguity here --
// Render must already resolve backend/package.json to run
// `npm install`/`npm start` for this service, so pinning engines.node
// there rides on a mechanism that is unambiguously in play regardless of
// rootDir semantics. Adding a second, unverified mechanism (whether at
// backend/.node-version or a repository-root .node-version, the latter
// of which risks unintended interaction with Vercel's own Node-version
// detection for the unrelated frontend/ service) would only add a false
// sense of redundancy without proof it does anything.
'use strict';

const path = require('path');

const expected = process.argv[2];
if (!expected) {
  console.error('Usage: node assert-node-engines-pin.cjs <expected-exact-version>');
  process.exit(1);
}

const pkg = require(path.join(__dirname, '..', 'package.json'));
const actual = pkg.engines && pkg.engines.node;

console.log(`backend/package.json engines.node = ${JSON.stringify(actual)}`);
console.log(`expected (CI-pinned)              = ${JSON.stringify(expected)}`);

if (actual !== expected) {
  console.error(
    `MISMATCH: backend/package.json's engines.node (${JSON.stringify(actual)}) `
    + `does not exactly equal the Node version this CI job pins (${JSON.stringify(expected)}). `
    + `These must never silently diverge -- update both together.`
  );
  process.exit(1);
}

console.log('OK: engines.node matches the CI-pinned Node version exactly.');
