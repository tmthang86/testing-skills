#!/usr/bin/env node
/**
 * compare-design.mjs — responsive design conformance comparator.
 *
 * Runs at every viewport you care about and performs two independent checks:
 *
 *   1. COMPARISON  — diff computed styles/geometry between a design artifact
 *                    (HTML mockup) and the implementation. Requires a mockup
 *                    for that viewport. Both sides render in the same engine,
 *                    so the output says WHAT diverged, not just that it did.
 *
 *   2. INVARIANTS  — layout rules that hold at every size regardless of any
 *                    artifact: no horizontal overflow, nothing escaping the
 *                    viewport, no collapsed elements, adequate touch targets.
 *                    These run even when no mockup exists, which is why they
 *                    matter: most teams have one desktop mockup and no
 *                    reference at all for the sizes where layout actually breaks.
 *
 * Usage:
 *   Single viewport:
 *     node compare-design.mjs --mockup <url|file> --impl <url> [--viewport 1440x900]
 *
 *   Responsive sweep (recommended):
 *     node compare-design.mjs --config responsive.json
 *
 *   Invariants only (no design artifact needed):
 *     node compare-design.mjs --impl http://localhost:3000/trade \
 *       --viewports 375x812,768x1024,1440x900
 *
 *   node compare-design.mjs --self-test     # validates pure logic, no browser
 *
 * Config file:
 *   {
 *     "impl": "http://localhost:3000/trade",
 *     "tolerance": 1,
 *     "breakpoints": [768, 1024],          // adds boundary probes at bp-1 / bp
 *     "viewports": [
 *       { "name": "mobile",  "width": 375,  "height": 812,
 *         "mockup": "file:///abs/mockups/trade.mobile.html" },
 *       { "name": "tablet",  "width": 768,  "height": 1024 },
 *       { "name": "desktop", "width": 1440, "height": 900,
 *         "mockup": "file:///abs/mockups/trade.desktop.html" }
 *     ]
 *   }
 *   A viewport without a mockup still gets invariant checks.
 *
 * Element matching: shared data-testid across mockup and implementation, or
 * explicit pairs via "map" in the config / --map file.
 *
 * Exit codes: 0 = no high-severity findings, 1 = findings, 2 = bad usage.
 */

// ---------------------------------------------------------------------------
// Property groups for comparison. Severity reflects how likely a diff is a
// real design bug rather than acceptable rendering variance.
// ---------------------------------------------------------------------------
const GROUPS = {
  color: { severity: 'high', props: ['color', 'backgroundColor', 'borderColor'] },
  typography: {
    severity: 'high',
    props: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'],
  },
  spacing: {
    severity: 'high',
    props: [
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap',
    ],
  },
  shape: { severity: 'medium', props: ['borderRadius', 'borderWidth', 'boxShadow'] },
  layout: {
    severity: 'medium',
    props: ['display', 'flexDirection', 'justifyContent', 'alignItems'],
  },
  size: { severity: 'medium', props: ['width', 'height'] },
};

const ALL_PROPS = Object.values(GROUPS).flatMap((g) => g.props);
const GROUP_OF = Object.fromEntries(
  Object.entries(GROUPS).flatMap(([n, g]) => g.props.map((p) => [p, n])),
);

// Minimum comfortable touch target. WCAG 2.5.5 asks for 44x44 CSS px; both
// Apple and Android land in the same neighbourhood.
const MIN_TOUCH_PX = 44;
// Below this width we treat the surface as touch-first for target sizing.
const TOUCH_VIEWPORT_MAX = 768;

// ---------------------------------------------------------------------------
// Normalization — pure, unit-testable. Browsers serialize colors and lengths
// inconsistently; normalize both sides so formatting noise isn't reported as
// design drift.
// ---------------------------------------------------------------------------
export function normalizeColor(value) {
  if (typeof value !== 'string') return value;
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return 'rgba(0,0,0,0)';
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return v;
  const parts = m[1].split(/[,/\s]+/).filter(Boolean).map((p) => p.trim());
  const [r, g, b] = parts.slice(0, 3).map((n) => Math.round(parseFloat(n)));
  const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
  return `rgba(${r},${g},${b},${a})`;
}

export function parsePx(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(-?[\d.]+)px$/);
  return m ? parseFloat(m[1]) : null;
}

export function normalizeFontFamily(value) {
  if (typeof value !== 'string') return value;
  // Compare the first family only: fallback stacks legitimately differ between
  // a static mockup and a built app.
  return value.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
}

function normalize(prop, value) {
  if (GROUPS.color.props.includes(prop)) return normalizeColor(value);
  if (prop === 'fontFamily') return normalizeFontFamily(value);
  return typeof value === 'string' ? value.trim() : value;
}

// ---------------------------------------------------------------------------
// Comparison — pure.
// ---------------------------------------------------------------------------
export function diffPair(name, expected, actual, tolerance = 1, viewport = null) {
  const diffs = [];
  for (const prop of ALL_PROPS) {
    if (!(prop in expected) || !(prop in actual)) continue;
    const e = normalize(prop, expected[prop]);
    const a = normalize(prop, actual[prop]);

    const ePx = parsePx(e);
    const aPx = parsePx(a);
    if (ePx !== null && aPx !== null) {
      const delta = +(aPx - ePx).toFixed(2);
      if (Math.abs(delta) > tolerance) {
        diffs.push({
          kind: 'comparison', viewport, element: name, prop,
          group: GROUP_OF[prop], severity: GROUPS[GROUP_OF[prop]].severity,
          expected: e, actual: a, delta,
        });
      }
      continue;
    }
    if (e !== a) {
      diffs.push({
        kind: 'comparison', viewport, element: name, prop,
        group: GROUP_OF[prop], severity: GROUPS[GROUP_OF[prop]].severity,
        expected: e, actual: a, delta: null,
      });
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Invariants — pure. These need no design artifact, which is exactly why they
// carry the responsive story: teams rarely have a mockup for every width, but
// these rules hold at all of them.
// ---------------------------------------------------------------------------
export function checkInvariants(viewport, pageInfo, elements) {
  const findings = [];
  const vp = viewport.name || `${viewport.width}x${viewport.height}`;
  const add = (severity, element, rule, detail) =>
    findings.push({ kind: 'invariant', viewport: vp, element, rule, severity, detail });

  // The single most common responsive bug: the page scrolls sideways.
  if (pageInfo && pageInfo.scrollWidth > pageInfo.clientWidth + 1) {
    add('high', '(document)', 'no-horizontal-overflow',
      `document scrollWidth ${pageInfo.scrollWidth}px exceeds viewport ${pageInfo.clientWidth}px ` +
      `by ${pageInfo.scrollWidth - pageInfo.clientWidth}px`);
  }

  for (const [name, el] of Object.entries(elements || {})) {
    if (!el) continue;
    const { box } = el;
    if (!box) continue;

    // Rendered but collapsed: usually a designed element that didn't survive
    // the breakpoint, which reads as "missing" to a user.
    if (box.width === 0 || box.height === 0) {
      add('high', name, 'not-collapsed',
        `renders at ${box.width}x${box.height} — element is present but has no size`);
      continue;
    }

    // Escaping the viewport horizontally.
    const right = box.x + box.width;
    if (right > viewport.width + 1) {
      add('high', name, 'within-viewport',
        `right edge at ${Math.round(right)}px exceeds viewport width ${viewport.width}px`);
    }
    if (box.x < -1) {
      add('high', name, 'within-viewport',
        `left edge at ${Math.round(box.x)}px is off-screen`);
    }

    // Content clipped by its own box. Often an intentional ellipsis, so this is
    // a medium finding to review rather than an automatic failure.
    if (el.contentOverflowsX) {
      add('medium', name, 'no-clipped-content',
        'content is wider than its box (truncated or clipped)');
    }

    // Touch ergonomics on small screens.
    if (el.interactive && viewport.width <= TOUCH_VIEWPORT_MAX) {
      if (box.width < MIN_TOUCH_PX || box.height < MIN_TOUCH_PX) {
        add('medium', name, 'touch-target-size',
          `interactive element is ${Math.round(box.width)}x${Math.round(box.height)}px, ` +
          `below the ${MIN_TOUCH_PX}x${MIN_TOUCH_PX}px minimum`);
      }
    }
  }
  return findings;
}

/**
 * Detect whether the layout actually responds. If every viewport produces an
 * identical layout signature, either the responsive rules never fire or the
 * page is fixed-width — both worth surfacing, because a "responsive" design
 * that never changes is a silent failure no single-viewport check would catch.
 */
export function checkResponsiveness(perViewport) {
  const findings = [];
  const named = perViewport.filter((v) => v.signature);
  if (named.length < 2) return findings;
  const unique = new Set(named.map((v) => v.signature));
  if (unique.size === 1) {
    findings.push({
      kind: 'invariant', viewport: '(all)', element: '(layout)',
      rule: 'layout-responds', severity: 'medium',
      detail: `layout is identical across ${named.length} viewports ` +
        `(${named.map((v) => v.name).join(', ')}) — responsive rules may not be applying`,
    });
  }
  return findings;
}

/**
 * Expand configured breakpoints into boundary probes. A breakpoint bug almost
 * always shows up at the boundary itself (off-by-one in the media query), not
 * in the middle of a range, so probe bp-1 and bp rather than trusting a single
 * width per range.
 */
export function boundaryViewports(breakpoints, height = 900) {
  const out = [];
  for (const bp of breakpoints || []) {
    out.push({ name: `bp${bp}-below`, width: bp - 1, height });
    out.push({ name: `bp${bp}-at`, width: bp, height });
  }
  return out;
}


// ---------------------------------------------------------------------------
// Attribution — pure. One container drift makes every block child narrower, and
// reporting each child as its own finding is how a conformance report turns
// into noise. Nothing is deleted: a consequence is re-labelled `derived` and
// carries the finding that explains it.
// ---------------------------------------------------------------------------
export function attributeDerived(findings, ancestorsByName, tolerance = 1) {
  // **Width only, and the asymmetry is the point.** In block layout a container
  // imposes its width on its children, so a container's horizontal padding is a
  // cause and the child's width is the consequence. Height runs the other way:
  // a container is usually as tall as its content, so a child's height is the
  // cause and the container's height the consequence. Attributing a child's
  // height to its container inverts that.
  //
  // `[measured]` this is not theoretical. In `examples/fixtures`, `card` is 4px
  // shorter and 8px more padded top and bottom, which predicts exactly -20px
  // for a child — and `icon-btn` is 20px shorter for an entirely unrelated
  // reason (fault 5, an explicit 24px height against a 44px minimum). Reading
  // the vertical axis would have labelled a deliberate fault a consequence.
  const AXIS = {
    width: ['paddingLeft', 'paddingRight'],
  };

  // Both lookups are scoped by viewport. A container padded at desktop must not
  // explain a child that is narrower at mobile — they are different renders and
  // the coincidence would be silent.
  const at = (viewport, element, prop) => findings.find((x) =>
    x.kind === 'comparison' && x.viewport === viewport &&
    x.element === element && x.prop === prop && typeof x.delta === 'number');
  const deltaOf = (viewport, element, prop) => at(viewport, element, prop)?.delta ?? 0;

  return findings.map((f) => {
    if (f.kind !== 'comparison' || !AXIS[f.prop] || typeof f.delta !== 'number') return f;

    // Nearest ancestor first: the innermost container that explains the number
    // is the one worth naming.
    for (const a of ancestorsByName?.[f.element] ?? []) {
      const sides = AXIS[f.prop];
      const moved = sides.filter((p) => at(f.viewport, a, p));
      const ownAxis = at(f.viewport, a, f.prop) ? [f.prop] : [];
      if (!moved.length && !ownAxis.length) continue;

      // A container that grew its padding by N in total takes N off every block
      // child; a container that changed its own width passes that on directly.
      const expected = deltaOf(f.viewport, a, f.prop) -
        sides.reduce((n, p) => n + deltaOf(f.viewport, a, p), 0);
      if (Math.abs(f.delta - expected) > tolerance) continue;

      return {
        ...f,
        kind: 'derived',
        derivedFrom: { element: a, props: [...moved, ...ownAxis], delta: expected },
      };
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// Reporting — pure.
// ---------------------------------------------------------------------------
export function buildReport(results, tolerance = 1) {
  const findings = [];
  const perViewport = [];

  for (const r of results) {
    const vpName = r.viewport.name || `${r.viewport.width}x${r.viewport.height}`;
    let compared = 0;

    if (r.expected) {
      for (const name of Object.keys(r.expected)) {
        const e = r.expected[name];
        const a = r.actual ? r.actual[name] : null;
        if (!e || !a) continue;
        compared++;
        findings.push(...diffPair(name, e.style, a.style, tolerance, vpName));
      }
    }
    findings.push(...checkInvariants(r.viewport, r.pageInfo, r.actual));
    perViewport.push({ name: vpName, width: r.viewport.width, compared, signature: r.signature });
  }

  findings.push(...checkResponsiveness(perViewport));

  // The DOM tree, as reported by extraction. Structure does not change between
  // viewports, so the first result that names an element wins.
  const tree = {};
  for (const r of results) {
    for (const [name, v] of Object.entries(r.actual ?? {})) {
      if (v?.ancestors && !(name in tree)) tree[name] = v.ancestors;
    }
  }
  const attributed = attributeDerived(findings, tree, tolerance);

  // A consequence never fails the gate on its own: its cause is already in the
  // report, and failing twice for one drift is the noise this exists to remove.
  const high = attributed.filter((f) => f.severity === 'high' && f.kind !== 'derived');
  const derived = attributed.filter((f) => f.kind === 'derived');
  const byViewport = {};
  for (const f of attributed) byViewport[f.viewport] = (byViewport[f.viewport] || 0) + 1;

  return {
    summary: {
      viewports: perViewport.length,
      totalFindings: attributed.length,
      highSeverity: high.length,
      derived: derived.length,
      byViewport,
      pass: high.length === 0,
    },
    viewports: perViewport,
    findings: attributed,
  };
}

export function formatReport(report) {
  const { summary, findings } = report;
  const lines = [];
  lines.push(
    `${summary.pass ? 'PASS' : 'FAIL'} | viewports: ${summary.viewports} | ` +
    `findings: ${summary.totalFindings} (high: ${summary.highSeverity}` +
    `${summary.derived ? `, derived: ${summary.derived}` : ''})`,
  );

  const groups = {};
  for (const f of findings) (groups[f.viewport] ||= []).push(f);
  const order = { high: 0, medium: 1, low: 2 };

  for (const [vp, items] of Object.entries(groups)) {
    lines.push(`\n  ${vp}`);
    for (const f of items.sort((a, b) => order[a.severity] - order[b.severity])) {
      if (f.kind === 'comparison') {
        const d = f.delta === null ? '' : ` (${f.delta > 0 ? '+' : ''}${f.delta}px)`;
        lines.push(`    [${f.severity}] ${f.element} · ${f.prop}: ` +
          `design=${f.expected} impl=${f.actual}${d}`);
      } else if (f.kind === 'derived') {
        // Indented and attributed rather than dropped. The observation is true
        // and belongs in the report; what it is not is a second defect.
        const d = f.delta === null ? '' : ` (${f.delta > 0 ? '+' : ''}${f.delta}px)`;
        lines.push(`      └ ${f.element} · ${f.prop}${d} ` +
          `— follows ${f.derivedFrom.element} · ${f.derivedFrom.props.join(', ')}`);
      } else {
        lines.push(`    [${f.severity}] ${f.element} · ${f.rule}: ${f.detail}`);
      }
    }
  }
  if (!findings.length) lines.push('  No findings.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Extraction — the only browser-dependent part, kept thin so everything above
// stays testable without a browser.
// ---------------------------------------------------------------------------
const PAGE_FN = ([selectors, props]) => {
  const INTERACTIVE = 'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]';
  const out = {};
  // Kept so the ancestor chain can be resolved once every element is known:
  // a container may appear after its children in the selector list.
  const found = [];
  for (const { name, selector } of selectors) {
    const el = document.querySelector(selector);
    if (!el) { out[name] = null; continue; }
    found.push({ name, el });
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const style = {};
    for (const p of props) style[p] = cs[p];
    // Rendered box beats the computed width/height, which are often "auto".
    style.width = `${Math.round(b.width)}px`;
    style.height = `${Math.round(b.height)}px`;
    out[name] = {
      style,
      box: { x: b.x, y: b.y, width: b.width, height: b.height },
      contentOverflowsX: el.scrollWidth > el.clientWidth + 1,
      interactive: el.matches(INTERACTIVE),
    };
  }
  // Which measured elements each measured element sits inside, nearest first.
  // **Data, not logic**: the comparison that uses it stays pure and unit-tested,
  // which is the split `docs/ROADMAP.md` calls load-bearing.
  for (const { name, el } of found) {
    const chain = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const hit = found.find((f) => f.el === p);
      if (hit) chain.push(hit.name);
    }
    out[name].ancestors = chain;
  }

  return {
    elements: out,
    pageInfo: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    // Coarse layout fingerprint: if this is identical across widths, the
    // layout isn't responding.
    signature: Object.entries(out)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}:${Math.round(v.box.width)}x${Math.round(v.box.height)}` +
        `@${Math.round(v.box.x)},${Math.round(v.box.y)}`)
      .join('|'),
  };
};

async function collect(page, src, selectors, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(src, { waitUntil: 'networkidle' });
  // Give media queries and any resize handlers a frame to settle.
  await page.waitForTimeout(150);
  return page.evaluate(PAGE_FN, [selectors, ALL_PROPS]);
}

async function discoverTestIds(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid]')].map((el) => el.dataset.testid));
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
function selfTest() {
  const checks = [];
  const ok = (label, cond) => checks.push({ label, pass: !!cond });

  // --- normalization ---
  ok('color rgb -> rgba', normalizeColor('rgb(10, 132, 255)') === 'rgba(10,132,255,1)');
  ok('color spacing-insensitive',
    normalizeColor('rgba(10,132,255,1)') === normalizeColor('rgb(10, 132, 255)'));
  ok('transparent normalized', normalizeColor('transparent') === 'rgba(0,0,0,0)');
  ok('parsePx', parsePx('16px') === 16 && parsePx('auto') === null);
  ok('font first family', normalizeFontFamily('"Inter", -apple-system, sans-serif') === 'inter');

  // --- comparison ---
  const d = diffPair('cta',
    { backgroundColor: 'rgb(10, 132, 255)', fontFamily: '"Inter", sans-serif',
      paddingLeft: '16px', borderRadius: '8px', width: '160px' },
    { backgroundColor: 'rgba(10, 132, 255, 1)', fontFamily: 'Inter, Helvetica, sans-serif',
      paddingLeft: '24px', borderRadius: '4px', width: '160px' }, 1, 'desktop');
  const props = d.map((x) => x.prop);
  ok('equivalent color not flagged', !props.includes('backgroundColor'));
  ok('equivalent font stack not flagged', !props.includes('fontFamily'));
  ok('padding drift flagged', props.includes('paddingLeft'));
  ok('identical width not flagged', !props.includes('width'));
  ok('delta computed', d.find((x) => x.prop === 'paddingLeft').delta === 8);
  ok('spacing is high severity', d.find((x) => x.prop === 'paddingLeft').severity === 'high');
  ok('shape is medium severity', d.find((x) => x.prop === 'borderRadius').severity === 'medium');
  ok('viewport tagged on diff', d[0].viewport === 'desktop');
  ok('sub-pixel noise tolerated',
    diffPair('x', { paddingLeft: '16px' }, { paddingLeft: '16.4px' }, 1).length === 0);

  // --- invariants ---
  const mobile = { name: 'mobile', width: 375, height: 812 };
  const inv = checkInvariants(mobile,
    { scrollWidth: 420, clientWidth: 375 },
    {
      wide: { box: { x: 0, y: 0, width: 420, height: 40 }, contentOverflowsX: false, interactive: false },
      tiny: { box: { x: 0, y: 60, width: 30, height: 30 }, contentOverflowsX: false, interactive: true },
      gone: { box: { x: 0, y: 100, width: 0, height: 0 }, contentOverflowsX: false, interactive: false },
      clipped: { box: { x: 0, y: 140, width: 200, height: 20 }, contentOverflowsX: true, interactive: false },
      fine: { box: { x: 0, y: 200, width: 200, height: 48 }, contentOverflowsX: false, interactive: true },
    });
  const rules = inv.map((f) => `${f.element}:${f.rule}`);
  ok('page overflow detected', rules.includes('(document):no-horizontal-overflow'));
  ok('element beyond viewport detected', rules.includes('wide:within-viewport'));
  ok('small touch target detected', rules.includes('tiny:touch-target-size'));
  ok('collapsed element detected', rules.includes('gone:not-collapsed'));
  ok('clipped content detected', rules.includes('clipped:no-clipped-content'));
  ok('healthy element not flagged', !rules.some((r) => r.startsWith('fine:')));
  ok('overflow is high severity',
    inv.find((f) => f.rule === 'no-horizontal-overflow').severity === 'high');
  ok('touch target is medium',
    inv.find((f) => f.rule === 'touch-target-size').severity === 'medium');

  // Touch-target rule must not fire on desktop widths.
  const desktopInv = checkInvariants({ name: 'desktop', width: 1440, height: 900 },
    { scrollWidth: 1440, clientWidth: 1440 },
    { tiny: { box: { x: 0, y: 0, width: 30, height: 30 }, contentOverflowsX: false, interactive: true } });
  ok('touch rule skipped on desktop',
    !desktopInv.some((f) => f.rule === 'touch-target-size'));
  ok('clean page yields no invariant findings',
    checkInvariants(mobile, { scrollWidth: 375, clientWidth: 375 },
      { a: { box: { x: 0, y: 0, width: 100, height: 50 }, contentOverflowsX: false, interactive: false } })
      .length === 0);

  // --- responsiveness ---
  ok('identical layout across viewports flagged',
    checkResponsiveness([
      { name: 'mobile', signature: 'a:100x50@0,0' },
      { name: 'desktop', signature: 'a:100x50@0,0' },
    ]).length === 1);
  ok('differing layout not flagged',
    checkResponsiveness([
      { name: 'mobile', signature: 'a:100x50@0,0' },
      { name: 'desktop', signature: 'a:300x50@0,0' },
    ]).length === 0);

  // --- boundary probes ---
  const bps = boundaryViewports([768, 1024]);
  ok('boundary probes generated', bps.length === 4);
  ok('probes sit at bp-1 and bp',
    bps[0].width === 767 && bps[1].width === 768 && bps[2].width === 1023);

  // --- report assembly ---
  const report = buildReport([
    {
      viewport: mobile,
      pageInfo: { scrollWidth: 420, clientWidth: 375 },
      expected: { cta: { style: { paddingLeft: '16px' } } },
      actual: { cta: { style: { paddingLeft: '24px' },
        box: { x: 0, y: 0, width: 100, height: 48 }, contentOverflowsX: false, interactive: true } },
      signature: 's1',
    },
    {
      viewport: { name: 'desktop', width: 1440, height: 900 },
      pageInfo: { scrollWidth: 1440, clientWidth: 1440 },
      expected: null, actual: {}, signature: 's2',
    },
  ], 1);
  ok('report counts both viewports', report.summary.viewports === 2);
  ok('report mixes comparison and invariant findings',
    report.findings.some((f) => f.kind === 'comparison') &&
    report.findings.some((f) => f.kind === 'invariant'));
  ok('high severity fails the gate', report.summary.pass === false);
  ok('findings grouped by viewport', Object.keys(report.summary.byViewport).includes('mobile'));
  ok('formatter runs', typeof formatReport(report) === 'string' &&
    formatReport(report).includes('mobile'));


  // --- attribution: a container's drift is not each child's finding ---
  {
    // `card` is 8px more padded on each side, so every block child renders
    // 16px narrower. One real drift; three children reported.
    const raw = [
      { kind: 'comparison', viewport: 'mobile', element: 'card', prop: 'paddingLeft',
        group: 'spacing', severity: 'high', expected: '16px', actual: '24px', delta: 8 },
      { kind: 'comparison', viewport: 'mobile', element: 'card', prop: 'paddingRight',
        group: 'spacing', severity: 'high', expected: '16px', actual: '24px', delta: 8 },
      { kind: 'comparison', viewport: 'mobile', element: 'title', prop: 'width',
        group: 'size', severity: 'medium', expected: '341px', actual: '325px', delta: -16 },
      { kind: 'comparison', viewport: 'mobile', element: 'cta', prop: 'width',
        group: 'size', severity: 'medium', expected: '341px', actual: '325px', delta: -16 },
      // A real, independent size drift inside the same container: the numbers
      // do not match the padding, so it must survive as a comparison.
      { kind: 'comparison', viewport: 'mobile', element: 'table', prop: 'width',
        group: 'size', severity: 'medium', expected: '341px', actual: '420px', delta: 79 },
    ];
    const tree = { title: ['card'], cta: ['card'], table: ['card'], card: [] };
    const out = attributeDerived(raw, tree);

    // Optional chaining throughout: a check that throws reports a stack trace
    // instead of a failing assertion, and a stack trace does not say which
    // expectation was not met.
    const of = (el) => out.find((f) => f.element === el && f.prop === 'width') || {};
    ok('a child width explained by an ancestor becomes derived',
      of('title').kind === 'derived' && of('cta').kind === 'derived');
    ok('and it names the finding that explains it',
      of('title').derivedFrom?.element === 'card' &&
      !!of('title').derivedFrom?.props?.includes('paddingLeft'));
    ok('an unexplained child width stays a comparison',
      of('table').kind === 'comparison');
    ok('the cause itself is untouched',
      out.find((f) => f.element === 'card' && f.prop === 'paddingLeft')?.kind === 'comparison');
    ok('nothing is deleted', out.length === raw.length);

    // **A height is never attributed**, even when the arithmetic lines up
    // perfectly. A container is as tall as its content, so a child's height is
    // the cause and the container's height the consequence — attributing the
    // child inverts the causality. The numbers here are the fixtures' own: card
    // is 4px shorter with 8px more padding each side, which predicts -20px, and
    // icon-btn is -20px for an unrelated deliberate fault.
    const vert = attributeDerived([
      { kind: 'comparison', viewport: 'mobile', element: 'card', prop: 'paddingTop',
        group: 'spacing', severity: 'high', expected: '16px', actual: '24px', delta: 8 },
      { kind: 'comparison', viewport: 'mobile', element: 'card', prop: 'paddingBottom',
        group: 'spacing', severity: 'high', expected: '16px', actual: '24px', delta: 8 },
      { kind: 'comparison', viewport: 'mobile', element: 'card', prop: 'height',
        group: 'size', severity: 'medium', expected: '211px', actual: '207px', delta: -4 },
      { kind: 'comparison', viewport: 'mobile', element: 'title', prop: 'height',
        group: 'size', severity: 'medium', expected: '44px', actual: '24px', delta: -20 },
    ], tree);
    ok('a height is never attributed, even when the arithmetic fits',
      vert.find((f) => f.element === 'title' && f.prop === 'height')?.kind === 'comparison');

    // A finding in another viewport must not explain this one.
    const cross = attributeDerived([
      { kind: 'comparison', viewport: 'desktop', element: 'card', prop: 'paddingLeft',
        group: 'spacing', severity: 'high', expected: '16px', actual: '24px', delta: 8 },
      { kind: 'comparison', viewport: 'desktop', element: 'card', prop: 'paddingRight',
        group: 'spacing', severity: 'high', expected: '16px', actual: '24px', delta: 8 },
      { kind: 'comparison', viewport: 'mobile', element: 'title', prop: 'width',
        group: 'size', severity: 'medium', expected: '341px', actual: '325px', delta: -16 },
    ], tree);
    ok('a cause in another viewport explains nothing',
      cross.find((f) => f.element === 'title')?.kind === 'comparison');
  }

  for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'}  ${c.label}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; } else { args[key] = true; }
  }
  return args;
}

export function parseViewports(spec) {
  return String(spec).split(',').map((s) => {
    const [w, h] = s.trim().split('x').map(Number);
    const height = h || 900;
    return { name: `${w}x${height}`, width: w, height };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['self-test']) process.exit(selfTest());

  const { readFileSync, writeFileSync } = await import('node:fs');
  let cfg = {};
  if (args.config) cfg = JSON.parse(readFileSync(args.config, 'utf8'));

  const impl = args.impl || cfg.impl;
  if (!impl) {
    console.error('Usage: node compare-design.mjs --impl <url> [--mockup <url|file>] ' +
      '[--viewports 375x812,1440x900]');
    console.error('       node compare-design.mjs --config responsive.json');
    console.error('       node compare-design.mjs --self-test');
    process.exit(2);
  }

  const tolerance = args.tolerance ? parseFloat(args.tolerance) : (cfg.tolerance ?? 1);
  let viewports = cfg.viewports || [];
  if (args.viewports) viewports = parseViewports(args.viewports);
  if (args.viewport) viewports = parseViewports(args.viewport);
  if (!viewports.length) viewports = [{ name: 'desktop', width: 1440, height: 900 }];
  if (args.mockup) viewports = viewports.map((v) => ({ ...v, mockup: v.mockup || args.mockup }));
  viewports = [...viewports, ...boundaryViewports(cfg.breakpoints)];

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const implPage = await ctx.newPage();
  const mockPage = await ctx.newPage();

  // Resolve the element pairs once.
  let mockSel = null, implSel = null;
  const mapFile = args.map || cfg.map;
  if (mapFile) {
    const map = typeof mapFile === 'string' ? JSON.parse(readFileSync(mapFile, 'utf8')) : mapFile;
    mockSel = map.map((m) => ({ name: m.name, selector: m.mockup }));
    implSel = map.map((m) => ({ name: m.name, selector: m.impl }));
  } else {
    await implPage.goto(impl, { waitUntil: 'networkidle' });
    const implIds = await discoverTestIds(implPage);
    const firstMockup = viewports.find((v) => v.mockup)?.mockup;
    if (firstMockup) {
      await mockPage.goto(firstMockup, { waitUntil: 'networkidle' });
      const mockIds = new Set(await discoverTestIds(mockPage));
      const shared = implIds.filter((id) => mockIds.has(id));
      if (!shared.length) {
        console.error('No shared data-testid between mockup and implementation.\n' +
          'Add matching testids to both, or supply an explicit map.');
        await browser.close();
        process.exit(2);
      }
      mockSel = shared.map((id) => ({ name: id, selector: `[data-testid="${id}"]` }));
      implSel = mockSel;
    } else {
      // Invariants-only mode: track everything the implementation exposes.
      implSel = implIds.map((id) => ({ name: id, selector: `[data-testid="${id}"]` }));
      if (!implSel.length) {
        console.error('No data-testid found in the implementation — nothing to track.\n' +
          'Add testids, or supply an explicit map.');
        await browser.close();
        process.exit(2);
      }
    }
  }

  const results = [];
  for (const vp of viewports) {
    const actual = await collect(implPage, impl, implSel, vp);
    let expected = null;
    if (vp.mockup && mockSel) {
      const m = await collect(mockPage, vp.mockup, mockSel, vp);
      expected = m.elements;
    }
    results.push({
      viewport: vp,
      pageInfo: actual.pageInfo,
      actual: actual.elements,
      expected,
      signature: actual.signature,
    });
  }
  await browser.close();

  const report = buildReport(results, tolerance);
  report.checkedViewports = viewports.map((v) => ({
    name: v.name, width: v.width, height: v.height, comparedAgainstMockup: !!v.mockup,
  }));

  console.log(formatReport(report));
  const noRef = viewports.filter((v) => !v.mockup).map((v) => v.name);
  if (noRef.length) {
    console.log(`\nInvariants only (no mockup supplied): ${noRef.join(', ')}`);
  }

  if (args.out || cfg.out) {
    writeFileSync(args.out || cfg.out, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${args.out || cfg.out}`);
  }
  process.exit(report.summary.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(2); });
}
