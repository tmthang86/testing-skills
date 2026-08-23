#!/usr/bin/env node
/**
 * check-theme-contract.mjs — theme matrix conformance, on the token source.
 *
 * An app that ships more than one theme (light/dark, brands, density, high
 * contrast) has a failure mode that per-element token assertions cannot see:
 * a token defined in one theme and missing from another. Nothing breaks in the
 * theme you develop in. Exactly one control breaks, in exactly one theme, and
 * only when somebody switches to it.
 *
 * The contract is the union of every token name any theme defines. Each theme
 * must cover it. That is the whole check, and it is worth its own script for
 * one reason: it reads the TOKEN SOURCE, not a rendered page. No browser, no
 * device, no getComputedStyle — so it works identically on web, desktop and
 * mobile, which is exactly where the other conformance layers thin out.
 *
 * Supported sources:
 *   css      CSS custom properties, one theme per selector block
 *   json     a JSON/JS object whose chosen level names the themes
 *   android  res/values-* directories (colors.xml, dimens.xml), one theme each
 *
 * Usage:
 *   node check-theme-contract.mjs --css tokens.css
 *   node check-theme-contract.mjs --css tokens.css --prefix "--app-"
 *   node check-theme-contract.mjs --css tokens.css --base ':root'   # default for --css
 *   node check-theme-contract.mjs --json tokens.json --base ''      # peers, no base
 *   node check-theme-contract.mjs --json tokens.json --themes-at 0
 *   node check-theme-contract.mjs --android app/src/main/res
 *   node check-theme-contract.mjs --css a.css --json b.json --out report.json
 *   node check-theme-contract.mjs --self-test      # pure logic, no I/O
 *
 * Known limitation, stated because it decides whether this check helps you:
 * with base+override and exactly ONE override, removing a token from that
 * override merely shrinks the contract, so the result degrades to an advisory
 * rather than a failure. Structure alone cannot tell "deliberately invariant"
 * from "forgotten" when there is nothing to compare against. From the second
 * override onward the remaining themes hold the token in the contract and the
 * check fails precisely, naming the theme and the token. It strengthens as the
 * theme count grows, which is when the defect it hunts actually starts to bite.
 *
 * Exit codes: 0 every theme complete · 1 a theme is missing a token · 2 usage error
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

// ---------------------------------------------------------------- parsing

/**
 * Split CSS into { selector, body } blocks with a real brace counter.
 *
 * A regex like /\{([^}]*)\}/ looks sufficient and is not: it stops at the first
 * closing brace, so a nested block (@media, @supports, a nested rule) silently
 * truncates the theme and the check then reports missing tokens that are in
 * fact present. Counting braces is the difference between this script telling
 * the truth and telling a confident lie.
 */
export function cssBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const selector = text.slice(i, open).trim().split('\n').pop().trim();
    let depth = 0;
    let close = -1;
    for (let k = open; k < text.length; k++) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}') {
        depth--;
        if (depth === 0) { close = k; break; }
      }
    }
    if (close === -1) break;
    const body = text.slice(open + 1, close);
    // An at-rule wraps other rules; recurse instead of treating it as a theme.
    if (selector.startsWith('@')) out.push(...cssBlocks(body));
    else out.push({ selector, body });
    i = close + 1;
  }
  return out;
}

/** Custom properties declared directly in a block body (not nested), name -> value. */
export function cssTokens(body, prefix = '--') {
  const flat = body.replace(/\{[^{}]*\}/g, '');
  const out = new Map();
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g;
  let m;
  while ((m = re.exec(flat)) !== null) {
    if (m[1].startsWith(prefix)) out.set(m[1], m[2].trim());
  }
  return out;
}

/** Does a token's value look like a colour? Used only for the advisory below. */
export function looksLikeColour(v) {
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^(rgb|hsl|oklch|lab|color)a?\(/i.test(v);
}

/** CSS file → { themeName: Set<token> }, one theme per selector that declares any. */
export function themesFromCss(css, prefix = '--') {
  const themes = {};
  for (const { selector, body } of cssBlocks(css)) {
    const tokens = cssTokens(body, prefix);
    if (tokens.size === 0) continue;
    const key = selector.replace(/\s+/g, ' ');
    themes[key] = new Map([...(themes[key] ?? new Map()), ...tokens]);
  }
  return themes;
}

/** Flatten a nested object to a Map of dot-joined leaf path -> value. */
export function flatten(obj, base = '') {
  const out = new Map();
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = base ? `${base}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [lk, lv] of flatten(v, path)) out.set(lk, lv);
    } else {
      out.set(path, String(v));
    }
  }
  return out;
}

/**
 * JSON tokens → { themeName: Set<token> }.
 * `themesAt` says which nesting level names the themes: 0 for
 * { light: {...}, dark: {...} }, 1 for { color: { light: {...} } }.
 */
export function themesFromJson(obj, themesAt = 0) {
  const themes = {};
  if (themesAt === 0) {
    for (const [name, sub] of Object.entries(obj ?? {})) {
      if (sub && typeof sub === 'object') themes[name] = flatten(sub);
    }
    return themes;
  }
  for (const [group, sub] of Object.entries(obj ?? {})) {
    if (!sub || typeof sub !== 'object') continue;
    for (const [name, leaf] of Object.entries(themesFromJson(sub, themesAt - 1))) {
      const prefixed = [...leaf].map(([t, v]) => [`${group}.${t}`, v]);
      themes[name] = new Map([...(themes[name] ?? new Map()), ...prefixed]);
    }
  }
  return themes;
}

/** Android res/ → { "values-night": Set<name> }, reading colors/dimens XML. */
export function themesFromAndroidRes(
  resDir,
  read = readFileSync,
  list = readdirSync,
  isDir = (p) => statSync(p).isDirectory(),
) {
  const themes = {};
  for (const dir of list(resDir).filter((d) => d === 'values' || d.startsWith('values-'))) {
    const full = join(resDir, dir);
    if (!isDir(full)) continue;
    const names = new Map();
    for (const file of list(full).filter((f) => f.endsWith('.xml'))) {
      const xml = String(read(join(full, file), 'utf8'));
      const re = /<(color|dimen|string|style)\s+name="([^"]+)"\s*>([^<]*)</g;
      let m;
      while ((m = re.exec(xml)) !== null) names.set(`${m[1]}/${m[2]}`, m[3].trim());
    }
    if (names.size) themes[dir] = names;
  }
  return themes;
}

// ---------------------------------------------------------------- the check

/**
 * Two shapes of theming exist and they need different arithmetic.
 *
 *   PEERS  — every theme declares its own full set: { light: {...}, dark: {...} },
 *            Android values/ vs values-night/. The contract is the union.
 *
 *   BASE + OVERRIDE — one block holds defaults that the others inherit, and each
 *            override restates only what changes. This is the dominant CSS
 *            pattern (`:root` plus `:root[data-theme="dark"]`), and treating the
 *            base as a peer produces confident nonsense: every structural token
 *            declared once — font stacks, radii, a sidebar width — is reported
 *            missing from every override, when at runtime it simply cascades.
 *
 * With `base` set, the contract is the union of what the OVERRIDES declare —
 * the theme-varying tokens — and every block including the base must cover it.
 * A base token no override touches is theme-invariant and correctly declared
 * once, so it is not a finding.
 *
 * One case survives that rule and cannot be settled structurally: a colour
 * declared only in the base. It might be a deliberate invariant brand colour,
 * or a value someone forgot to give the other themes — the same shape, opposite
 * verdicts. Those are reported as advisories, never as failures.
 */
export function checkContract(themes, { base = null } = {}) {
  const names = Object.keys(themes);
  const hasBase = Boolean(base) && names.includes(base);
  const overrides = hasBase ? names.filter((n) => n !== base) : names;

  const contract = new Set();
  for (const n of overrides) for (const t of themes[n].keys()) contract.add(t);

  const audited = hasBase && overrides.length ? names : overrides;
  const perTheme = audited.map((name) => ({
    theme: name,
    isBase: name === base,
    defined: themes[name].size,
    missing: [...contract].filter((t) => !themes[name].has(t)).sort(),
  }));

  const findings = perTheme
    .filter((t) => t.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);

  const advisories = [];
  if (hasBase && overrides.length) {
    for (const [t, v] of themes[base]) {
      if (!contract.has(t) && looksLikeColour(v)) advisories.push(t);
    }
    advisories.sort();
  }

  return {
    mode: hasBase && overrides.length ? 'base+override' : 'peers',
    base: hasBase ? base : null,
    contract: [...contract].sort(),
    contractSize: contract.size,
    themes: perTheme.sort((a, b) => a.theme.localeCompare(b.theme)),
    findings,
    advisories,
    pass: findings.length === 0 && names.length > 0,
    themeCount: names.length,
  };
}

export function formatReport(r, { max = 12 } = {}) {
  const lines = [];
  if (r.themeCount === 0) {
    return 'FAIL | no themes found — check the source path, --prefix, or --themes-at';
  }
  if (r.themeCount === 1) {
    return [
      `PASS | 1 theme, ${r.contractSize} tokens — nothing to cross-check`,
      '  A single theme cannot have a symmetry defect. This check earns its',
      '  keep from the second theme onward.',
    ].join('\n');
  }

  const head = `${r.pass ? 'PASS' : 'FAIL'} | ${r.mode} | themes: ${r.themeCount}` +
    ` | contract: ${r.contractSize} theme-varying tokens | incomplete: ${r.findings.length}`;
  lines.push(head);
  if (r.base) lines.push(`  base: ${r.base} — its tokens are inherited by every theme`);

  for (const f of r.findings) {
    lines.push('');
    lines.push(`  ${f.theme}${f.isBase ? ' (base)' : ''} — defines ${f.defined}, missing ${f.missing.length} of the contract:`);
    for (const t of f.missing.slice(0, max)) lines.push(`    - ${t}`);
    if (f.missing.length > max) lines.push(`    … and ${f.missing.length - max} more`);
  }
  if (!r.pass) {
    lines.push('');
    lines.push('  A theme-varying token missing from one theme breaks exactly one control');
    lines.push('  in exactly that theme, and only when somebody switches to it.');
  }

  if (r.advisories.length) {
    lines.push('');
    lines.push(`  advisory — ${r.advisories.length} colour${r.advisories.length === 1 ? '' : 's'} declared only in the base, overridden by no theme:`);
    for (const t of r.advisories.slice(0, max)) lines.push(`    ? ${t}`);
    if (r.advisories.length > max) lines.push(`    … and ${r.advisories.length - max} more`);
    lines.push('    Either a deliberate invariant, or a value the other themes never got.');
    lines.push('    Not a failure — a human decides which.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- self-test

function selfTest() {
  let failed = 0;
  const ok = (name, cond) => {
    if (!cond) { console.error(`  FAIL ${name}`); failed++; }
    else console.log(`  ok   ${name}`);
  };

  // The brace-counting bug this script exists to avoid: a nested at-rule must
  // not truncate the block that contains it.
  const nested = `
    :root { --a: 1; @media (x) { --ignored: 2; } --b: 3; }
    [data-theme="dark"] { --a: 9; }
  `;
  const blocks = cssBlocks(nested);
  ok('cssBlocks survives a nested block', blocks.length === 2);
  ok('cssTokens ignores nested declarations', [...cssTokens(blocks[0].body).keys()].join(',') === '--a,--b');
  ok('cssTokens keeps values', cssTokens(blocks[0].body).get('--a') === '1');
  ok('looksLikeColour', looksLikeColour('#0a0f0d') && looksLikeColour('rgba(1,2,3,.4)') && !looksLikeColour('10px'));

  const t1 = themesFromCss(':root{--x:1;--y:2}[data-theme="dark"]{--x:3}');
  const r1 = checkContract(t1);
  ok('asymmetry detected', !r1.pass && r1.findings.length === 1);
  ok('names the missing token', r1.findings[0].missing[0] === '--y');
  ok('contract is the union', r1.contractSize === 2);

  const t2 = themesFromCss(':root{--x:1}[data-theme="dark"]{--x:3}');
  ok('symmetric themes pass', checkContract(t2).pass);

  ok('prefix filter applies', cssTokens('--app-a:1;--other-b:2', '--app-').size === 1);

  // The false positive that made this model necessary: a structural token
  // declared once in the base must NOT be reported missing from an override.
  const cascade = themesFromCss(':root{--c:#111;--radius:10px}[data-theme="light"]{--c:#eee}');
  const flat = checkContract(cascade);
  ok('peers model flags the inherited token (the old, wrong answer)', !flat.pass);
  const based = checkContract(cascade, { base: ':root' });
  ok('base model does not flag an inherited structural token', based.pass);
  ok('base model narrows the contract to theme-varying tokens', based.contractSize === 1);

  // …while a real asymmetry is still caught under the base model.
  const real = themesFromCss(':root{--a:#111;--b:#222}[data-theme="light"]{--a:#eee;--b:#ddd}[data-theme="hc"]{--a:#000}');
  const rr = checkContract(real, { base: ':root' });
  ok('base model still catches a theme missing a varying token', !rr.pass && rr.findings[0].theme === '[data-theme="hc"]');

  // A colour only the base declares is an advisory, never a failure.
  const adv = checkContract(themesFromCss(':root{--a:#111;--brand:#f00}[data-theme="light"]{--a:#eee}'), { base: ':root' });
  ok('base-only colour is advisory, not failure', adv.pass && adv.advisories[0] === '--brand');
  ok('advisory is rendered', formatReport(adv).includes('advisory'));

  const j = themesFromJson({ light: { color: { bg: '#fff' } }, dark: { color: {} } }, 0);
  const rj = checkContract(j);
  ok('json themes at level 0', !rj.pass && rj.findings[0].theme === 'dark');
  ok('json flattens to leaf paths', rj.contract[0] === 'color.bg');

  const jn = themesFromJson({ color: { light: { bg: 1 }, dark: { bg: 2 } } }, 1);
  ok('json themes at level 1', checkContract(jn).pass && 'light' in jn);

  const files = { 'values': ['colors.xml'], 'values-night': ['colors.xml'] };
  const xml = {
    'values/colors.xml': '<color name="bg">#fff</color><color name="fg">#000</color>',
    'values-night/colors.xml': '<color name="bg">#000</color>',
  };
  const ta = themesFromAndroidRes(
    'res',
    (p) => xml[String(p).replace('res/', '')],
    (p) => (String(p) === 'res' ? Object.keys(files) : files[String(p).replace('res/', '')]),
    () => true,
  );
  ok('android values dirs are themes', checkContract(ta).findings[0].theme === 'values-night');

  const single = checkContract(themesFromCss(':root{--x:1}'));
  ok('single theme is not a failure', formatReport(single).startsWith('PASS'));
  ok('empty source reports usefully', formatReport(checkContract({})).includes('no themes found'));

  console.log(failed === 0 ? '\nself-test: all passed' : `\nself-test: ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['self-test']) process.exit(selfTest());

  let themes = {};
  const prefix = typeof args.prefix === 'string' ? args.prefix : '--';

  if (typeof args.css === 'string') {
    if (!existsSync(args.css)) { console.error(`not found: ${args.css}`); process.exit(2); }
    themes = { ...themes, ...themesFromCss(readFileSync(args.css, 'utf8'), prefix) };
  }
  if (typeof args.json === 'string') {
    if (!existsSync(args.json)) { console.error(`not found: ${args.json}`); process.exit(2); }
    const at = args['themes-at'] === undefined ? 0 : Number(args['themes-at']);
    const parsed = themesFromJson(JSON.parse(readFileSync(args.json, 'utf8')), at);
    for (const [k, v] of Object.entries(parsed)) {
      themes[k] = new Set([...(themes[k] ?? []), ...v]);
    }
  }
  if (typeof args.android === 'string') {
    if (!existsSync(args.android)) { console.error(`not found: ${args.android}`); process.exit(2); }
    themes = { ...themes, ...themesFromAndroidRes(args.android) };
  }

  if (Object.keys(themes).length === 0 && !args.css && !args.json && !args.android) {
    console.error('usage: node check-theme-contract.mjs --css <file> | --json <file> | --android <res-dir>');
    console.error('       node check-theme-contract.mjs --self-test');
    process.exit(2);
  }

  // CSS overwhelmingly uses base+override, so default to it and let --base ""
  // (or --base with no value) turn it off for peer-shaped sources.
  let base = null;
  if (typeof args.base === 'string') base = args.base;
  else if (args.base === undefined && typeof args.css === 'string') base = ':root';

  const report = checkContract(themes, { base });
  console.log(formatReport(report));

  if (typeof args.out === 'string') {
    writeFileSync(
      args.out,
      JSON.stringify({ ...report, themes: report.themes.map((t) => ({ ...t })) }, null, 2),
    );
    console.log(`\nreport: ${basename(args.out)}`);
  }
  process.exit(report.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(2); });
}
