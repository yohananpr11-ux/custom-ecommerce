const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Mandatory legacy brand pattern across all historical variants
const FORBIDDEN_BRAND_PATTERN = /drip[ -]?street|dripstreet|dripstreetshop|דריפ ?סטריט|joakim|joachim|joaquin|joaquín|חואקין|יואקים|יואקין/i;

// Strict zero allowlist — NO exceptions permitted
const ALLOWED_EXCEPTIONS = [];

test('Repository Brand Integrity: Zero active legacy brand strings in tracked files', () => {
  const trackedFilesOutput = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  const trackedFiles = trackedFilesOutput.split(/\r?\n/).filter(Boolean);

  const violations = [];

  for (const relativePath of trackedFiles) {
    // Skip binary files, lock files, and git metadata
    if (/\.(png|jpg|jpeg|gif|webp|ico|sqlite|db|ttf|woff|woff2|eot|lock)$/i.test(relativePath)) {
      continue;
    }

    // Skip the regression test's own pattern definition line
    if (relativePath.replace(/\\/g, '/') === 'backend/tests/brand-purge-regression.test.js') {
      continue;
    }

    const fullPath = path.join(REPO_ROOT, relativePath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, lineIndex) => {
      if (FORBIDDEN_BRAND_PATTERN.test(line)) {
        violations.push({
          file: relativePath,
          line: lineIndex + 1,
          content: line.trim(),
        });
      }
    });
  }

  assert.equal(
    violations.length,
    0,
    `Found legacy brand strings in tracked files:\n${violations.map((v) => `  ${v.file}:${v.line} -> ${v.content}`).join('\n')}`
  );
});
