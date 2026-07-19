#!/usr/bin/env node
/**
 * Self-test for assert-network-guard-clean.cjs's verifyLog()/validateEntry().
 * Proves the verifier itself rejects every failure mode it claims to catch,
 * using temp files only — writes nothing outside os.tmpdir(), touches no
 * real project file.
 *
 * Run: node scripts/assert-network-guard-clean.selftest.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { verifyLog, validateEntry } = require('./assert-network-guard-clean.cjs');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-selftest-'));
const writeLog = (name, content) => {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
};

const VALID_ACTIVATION = '{"activated":true,"pid":1234,"timestamp":"2026-01-01T00:00:00.000Z"}';
const VALID_NETWORK_ALLOWED = '{"moduleName":"http","method":"get","hostname":"127.0.0.1","allowed":true,"timestamp":"2026-01-01T00:00:00.000Z"}';
const VALID_NETWORK_BLOCKED = '{"moduleName":"https","method":"get","hostname":"open.er-api.com","allowed":false,"timestamp":"2026-01-01T00:00:00.000Z"}';

function main() {
  console.log('assert-network-guard-clean.cjs self-test\n');

  // 1. Missing file must fail.
  const missingPath = path.join(tmpDir, 'does-not-exist.jsonl');
  const missingResult = verifyLog(missingPath);
  check('missing log file is rejected', missingResult.ok === false, JSON.stringify(missingResult));

  // 2. Empty file must fail (distinct from missing).
  const emptyPath = writeLog('empty.jsonl', '');
  const emptyResult = verifyLog(emptyPath);
  check('empty log file is rejected', emptyResult.ok === false, JSON.stringify(emptyResult));
  check('empty-log rejection reason differs from missing-file reason', emptyResult.reason !== missingResult.reason);

  // 3. Malformed JSON line must fail immediately, not be silently skipped.
  const malformedPath = writeLog('malformed.jsonl', [VALID_ACTIVATION, '{not valid json at all', ''].join('\n'));
  const malformedResult = verifyLog(malformedPath);
  check('malformed JSON line is rejected', malformedResult.ok === false, JSON.stringify(malformedResult));
  check('malformed-JSON rejection reason mentions "malformed JSON"', /malformed JSON/i.test(malformedResult.reason || ''));

  // 3b. Truncated final line (no trailing newline, cut mid-write) must fail
  //     the same way — proves the "last line" isn't special-cased/ignored.
  const truncatedPath = writeLog('truncated.jsonl', `${VALID_ACTIVATION}\n${VALID_NETWORK_ALLOWED}\n{"moduleName":"http","method":"g`);
  const truncatedResult = verifyLog(truncatedPath);
  check('truncated final line is rejected', truncatedResult.ok === false, JSON.stringify(truncatedResult));

  // 4. Well-formed JSON but missing the activation marker must fail.
  const noActivationPath = writeLog('no-activation.jsonl', `${VALID_NETWORK_ALLOWED}\n`);
  const noActivationResult = verifyLog(noActivationPath);
  check('log without an activation marker is rejected', noActivationResult.ok === false, JSON.stringify(noActivationResult));
  check('missing-activation rejection reason mentions "activation"', /activation/i.test(noActivationResult.reason || ''));

  // 5. A blocked request entry must fail, even with a valid activation marker.
  const blockedPath = writeLog('blocked.jsonl', [VALID_ACTIVATION, VALID_NETWORK_BLOCKED, ''].join('\n'));
  const blockedResult = verifyLog(blockedPath);
  check('a blocked request entry is rejected', blockedResult.ok === false, JSON.stringify(blockedResult));
  check('blocked-entry result includes the offending entry', Array.isArray(blockedResult.blockedEntries) && blockedResult.blockedEntries.length === 1);

  // 6. Positive control: activation marker + only allowed entries must pass.
  const cleanPath = writeLog('clean.jsonl', [VALID_ACTIVATION, VALID_NETWORK_ALLOWED, ''].join('\n'));
  const cleanResult = verifyLog(cleanPath);
  check('activation marker + only allowed entries passes', cleanResult.ok === true, JSON.stringify(cleanResult));
  check('positive control reports allowedCount=1', cleanResult.allowedCount === 1, JSON.stringify(cleanResult));

  // 7. Positive control: activation marker alone (zero traffic) must pass.
  const activationOnlyResult = verifyLog(writeLog('activation-only.jsonl', `${VALID_ACTIVATION}\n`));
  check('activation marker alone (zero traffic) passes', activationOnlyResult.ok === true, JSON.stringify(activationOnlyResult));

  // 8. Well-formed JSON object matching no known record schema must fail.
  const unknownSchemaResult = verifyLog(writeLog('unknown-schema.jsonl', [VALID_ACTIVATION, '{"foo":"bar","random":123}', ''].join('\n')));
  check('an unrecognized-but-valid JSON object is rejected', unknownSchemaResult.ok === false, JSON.stringify(unknownSchemaResult));
  check('unrecognized-schema rejection reason mentions "unrecognized"', /unrecognized/i.test(unknownSchemaResult.reason || ''));

  // 9. Primitive JSON values (valid JSON, not an object) must fail.
  for (const [label, primitiveLine] of [
    ['bare string', '"just a string"'],
    ['bare number', '42'],
    ['bare boolean', 'true'],
    ['bare null', 'null'],
    ['bare array', '[1,2,3]'],
  ]) {
    const result = verifyLog(writeLog(`primitive-${label.replace(/\s+/g, '-')}.jsonl`, [VALID_ACTIVATION, primitiveLine, ''].join('\n')));
    check(`primitive JSON line (${label}) is rejected`, result.ok === false, JSON.stringify(result));
  }

  // 10. Missing required fields must fail.
  const missingFieldsCases = [
    ['activation missing pid', '{"activated":true,"timestamp":"2026-01-01T00:00:00.000Z"}'],
    ['activation missing timestamp', '{"activated":true,"pid":1}'],
    ['network missing moduleName', '{"method":"get","hostname":"127.0.0.1","allowed":true,"timestamp":"2026-01-01T00:00:00.000Z"}'],
    ['network missing method', '{"moduleName":"http","hostname":"127.0.0.1","allowed":true,"timestamp":"2026-01-01T00:00:00.000Z"}'],
    ['network missing timestamp', '{"moduleName":"http","method":"get","hostname":"127.0.0.1","allowed":true}'],
    ['network missing hostname', '{"moduleName":"http","method":"get","allowed":true,"timestamp":"2026-01-01T00:00:00.000Z"}'],
  ];
  for (const [label, line] of missingFieldsCases) {
    const result = verifyLog(writeLog(`missing-${label.replace(/\s+/g, '-')}.jsonl`, [VALID_ACTIVATION, line, ''].join('\n')));
    check(`${label} is rejected`, result.ok === false, JSON.stringify(result));
  }

  // 11. Extra/unexpected fields must fail — as untrustworthy as a missing one.
  const extraFieldsCases = [
    ['activation with extra field', '{"activated":true,"pid":1,"timestamp":"2026-01-01T00:00:00.000Z","extra":"nope"}'],
    ['network with extra field', '{"moduleName":"http","method":"get","hostname":"127.0.0.1","allowed":true,"timestamp":"2026-01-01T00:00:00.000Z","note":"unexpected"}'],
  ];
  for (const [label, line] of extraFieldsCases) {
    const result = verifyLog(writeLog(`extra-${label.replace(/\s+/g, '-')}.jsonl`, [VALID_ACTIVATION, line, ''].join('\n')));
    check(`${label} is rejected`, result.ok === false, JSON.stringify(result));
  }

  // 12. Non-boolean "allowed" must fail, even though the value is truthy.
  const nonBooleanAllowedResult = verifyLog(
    writeLog('non-boolean-allowed.jsonl', [VALID_ACTIVATION, '{"moduleName":"http","method":"get","hostname":"127.0.0.1","allowed":"yes","timestamp":"2026-01-01T00:00:00.000Z"}', ''].join('\n'))
  );
  check('non-boolean "allowed" value is rejected', nonBooleanAllowedResult.ok === false, JSON.stringify(nonBooleanAllowedResult));
  check('non-boolean-"allowed" rejection reason mentions "allowed"', /allowed/i.test(nonBooleanAllowedResult.reason || ''));

  // 13. Invalid timestamps must fail — not just "unparseable", also
  //     "parseable by Date.parse() but not the exact ISO shape the writer
  //     actually emits" (a looser Date.parse()-based check would wrongly
  //     accept these).
  const invalidTimestampCases = [
    ['not a date at all', 'not-a-timestamp'],
    ['date-only, no time', '2026-01-01'],
    ['missing milliseconds', '2026-01-01T00:00:00Z'],
    ['missing Z suffix', '2026-01-01T00:00:00.000'],
    ['space instead of T', '2026-01-01 00:00:00.000Z'],
    ['empty string', ''],
  ];
  for (const [label, ts] of invalidTimestampCases) {
    const line = `{"activated":true,"pid":1,"timestamp":${JSON.stringify(ts)}}`;
    const result = verifyLog(writeLog(`ts-${label.replace(/\s+/g, '-')}.jsonl`, `${line}\n`));
    check(`invalid timestamp (${label}) is rejected`, result.ok === false, JSON.stringify(result));
  }

  // 14. "wrong pid" — fractional, negative, zero, non-numeric, and NaN/Infinity
  //     values must all be rejected as invalid positive integers.
  const invalidPidCases = [
    ['fractional pid', 1.5],
    ['negative pid', -42],
    ['zero pid', 0],
    ['string pid', '1234'],
    ['NaN pid', NaN],
    ['Infinity pid', Infinity],
  ];
  for (const [label, pidValue] of invalidPidCases) {
    const line = `{"activated":true,"pid":${JSON.stringify(pidValue) ?? 'null'},"timestamp":"2026-01-01T00:00:00.000Z"}`;
    const result = verifyLog(writeLog(`pid-${label.replace(/\s+/g, '-')}.jsonl`, `${line}\n`));
    check(`${label} is rejected`, result.ok === false, JSON.stringify(result));
  }
  // Direct unit check too, since JSON.stringify(NaN)/(Infinity) both
  // serialize to "null", which the line-based cases above can't distinguish
  // from a literal null pid — validateEntry() is checked directly instead.
  check('validateEntry rejects NaN pid directly', validateEntry({ activated: true, pid: NaN, timestamp: '2026-01-01T00:00:00.000Z' }).valid === false);
  check('validateEntry rejects Infinity pid directly', validateEntry({ activated: true, pid: Infinity, timestamp: '2026-01-01T00:00:00.000Z' }).valid === false);

  // 15. Summary records no longer exist as a recognized schema (Option B —
  //     see network-guard.cjs's own comment on why the summary writer was
  //     removed). A summary-shaped record must now be rejected exactly like
  //     any other unrecognized schema, not specially parsed or reconciled.
  const summaryShapedResult = verifyLog(
    writeLog('summary-shaped.jsonl', [VALID_ACTIVATION, '{"summary":true,"allowedCount":1,"blockedCount":0,"hermetic":true}', ''].join('\n'))
  );
  check('a summary-shaped record is rejected as unrecognized', summaryShapedResult.ok === false, JSON.stringify(summaryShapedResult));
  check('summary-shaped rejection reason mentions "unrecognized"', /unrecognized/i.test(summaryShapedResult.reason || ''));

  // 16. Positive control: multiple valid activation + network records
  //     (simulating several processes/requests sharing one log file) still
  //     passes when every record is individually well-formed.
  const multiRecordResult = verifyLog(
    writeLog(
      'multi-record.jsonl',
      [
        '{"activated":true,"pid":100,"timestamp":"2026-01-01T00:00:00.000Z"}',
        '{"activated":true,"pid":200,"timestamp":"2026-01-01T00:00:01.000Z"}',
        VALID_NETWORK_ALLOWED,
        '{"moduleName":"fetch","method":"fetch","hostname":"::1","allowed":true,"timestamp":"2026-01-01T00:00:02.000Z"}',
        '',
      ].join('\n')
    )
  );
  check('multiple valid activation + network records passes', multiRecordResult.ok === true, JSON.stringify(multiRecordResult));
  check('multi-record positive control reports allowedCount=2', multiRecordResult.allowedCount === 2, JSON.stringify(multiRecordResult));

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
