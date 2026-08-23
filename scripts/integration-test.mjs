#!/usr/bin/env node
/**
 * integration-test.mjs — exercises the real browser path of compare-design.mjs.
 *
 * The comparator's pure logic is covered by `--self-test`, which needs no
 * browser. This covers the part that does: launching Chromium, rendering both
 * fixtures, extracting computed styles, and producing findings. The fixtures
 * carry deliberate, documented faults, so the expected output is known exactly
 * — which lets this assert on *specific* findings rather than just "it ran".
 *
 * Asserting specific findings matters: a comparator that reports everything, or
 * nothing, would still "pass" a smoke test. These assertions pin the behaviour.
 *
 * Usage: node scripts/integration-test.mjs
 * Requires: npm install && npx playwright install chromium
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPARATOR = join(
  ROOT,
  'plugins/design-conformance-testing/skills/design-conformance-testing/scripts/compare-design.mjs',
);
const FIXTURES = join(ROOT, 'examples/fixtures');
const REPORT = join(ROOT, '.integration-report.json');

const checks = [];
const ok = (label, cond, detail = '') => checks.push({ label, pass: !!cond, detail });

function findingsFor(report, viewport) {
  return report.findings.filter((f) => f.viewport === viewport);
}
function hasComparison(report, viewport, element, prop) {
  return findingsFor(report, viewport).some(
    (f) => f.kind === 'comparison' && f.element === element && f.prop === prop,
  );
}
function hasInvariant(report, viewport, element, rule) {
  return findingsFor(report, viewport).some(
    (f) => f.kind === 'invariant' && f.element === element && f.rule === rule,
  );
}

console.log('Running comparator against fixtures (mobile + desktop)...\n');

// Preflight: without this, a missing browser surfaces as an opaque exit-2 and
// two failed assertions, which sends people debugging the wrong thing.
try {
  const { chromium } = await import('playwright');
  const exe = chromium.executablePath();
  if (!existsSync(exe)) throw new Error(`browser binary not found at ${exe}`);
} catch (e) {
  console.error(
    'Cannot run the integration test — Playwright or its browser is unavailable.\n' +
    `  ${e.message}\n\n` +
    'Fix with:\n' +
    '  npm install && npx playwright install chromium\n\n' +
    'The pure-logic tests need no browser and are worth running meanwhile:\n' +
    '  npm run test:unit',
  );
  process.exit(2);
}

if (existsSync(REPORT)) rmSync(REPORT);

const run = spawnSync(process.execPath, [
  COMPARATOR,
  '--mockup', pathToFileURL(join(FIXTURES, 'mockup.html')).href,
  '--impl', pathToFileURL(join(FIXTURES, 'impl.html')).href,
  '--viewports', '375x812,1440x900',
  '--out', REPORT,
], { encoding: 'utf8' });

console.log(run.stdout || '');
if (run.stderr) console.error(run.stderr);

// The fixtures contain high-severity faults, so a clean exit would mean the
// comparator failed to detect them.
ok('comparator exits 1 when high-severity faults exist', run.status === 1,
  `got exit ${run.status}`);
ok('report file written', existsSync(REPORT));
if (!existsSync(REPORT)) { report(); process.exit(1); }

const data = JSON.parse(readFileSync(REPORT, 'utf8'));

ok('both viewports checked', data.summary.viewports === 2,
  `got ${data.summary.viewports}`);

// --- drifts that should appear at BOTH viewports (they are size-independent)
for (const vp of ['375x812', '1440x900']) {
  ok(`${vp}: card padding drift detected`, hasComparison(data, vp, 'card', 'paddingLeft'));
  ok(`${vp}: card radius drift detected`, hasComparison(data, vp, 'card', 'borderRadius'));
  ok(`${vp}: cta color drift detected`,
    hasComparison(data, vp, 'primary-cta', 'backgroundColor'));
}

// Delta must be signed and numeric — that's what makes a report actionable.
const padding = data.findings.find((f) => f.element === 'card' && f.prop === 'paddingLeft');
ok('padding delta is +8px', padding && padding.delta === 8,
  padding ? `got ${padding.delta}` : 'finding missing');
ok('padding drift is high severity', padding && padding.severity === 'high');

// --- responsive faults: mobile only
ok('mobile: horizontal overflow detected',
  hasInvariant(data, '375x812', '(document)', 'no-horizontal-overflow'));
ok('mobile: table escapes viewport',
  hasInvariant(data, '375x812', 'order-table', 'within-viewport'));
ok('mobile: small touch target detected',
  hasInvariant(data, '375x812', 'icon-btn', 'touch-target-size'));

// --- and NOT on desktop, where the same elements fit fine
ok('desktop: no overflow finding',
  !hasInvariant(data, '1440x900', '(document)', 'no-horizontal-overflow'));
ok('desktop: no touch-target finding',
  !hasInvariant(data, '1440x900', 'icon-btn', 'touch-target-size'));

// --- no false positives on the parts that genuinely match
ok('title not falsely flagged',
  !data.findings.some((f) => f.element === 'title' && f.kind === 'comparison'),
  'title is identical in both fixtures');
ok('cta font-size not falsely flagged',
  !hasComparison(data, '1440x900', 'primary-cta', 'fontSize'));

function report() {
  console.log('');
  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'}  ${c.label}${c.pass || !c.detail ? '' : ` — ${c.detail}`}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed;
}

const failed = report();
if (existsSync(REPORT)) rmSync(REPORT);
process.exit(failed ? 1 : 0);
