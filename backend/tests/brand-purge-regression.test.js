const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Encoded pattern ensuring zero plaintext legacy tokens exist in tracked source
const PATTERN_B64 = 'ZHJpcFsgLV0/c3RyZWV0fGRyaXBzdHJlZXR8ZHJpcHN0cmVldHNob3B815PXqNeZ16QgP9eh15jXqNeZ15h8am9ha2ltfGpvYWNoaW18am9hcXVpbnxqb2FxdcOtbnzXl9eV15DXp9eZ159815nXldeQ16fXmdedfNeZ15XXkNen15nXnw==';
const FORBIDDEN_BRAND_PATTERN = new RegExp(Buffer.from(PATTERN_B64, 'base64').toString('utf8'), 'i');

test('Repository Brand Integrity: Zero active legacy brand strings in tracked files', () => {
  const trackedFilesOutput = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  const trackedFiles = trackedFilesOutput.split(/\r?\n/).filter(Boolean);

  const violations = [];

  for (const relativePath of trackedFiles) {
    // Skip binary files, lock files, and git metadata
    if (/\.(png|jpg|jpeg|gif|webp|ico|sqlite|db|ttf|woff|woff2|eot|lock)$/i.test(relativePath)) {
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
