#!/usr/bin/env node
/**
 * validate-repo.mjs — structural checks that run in CI on every push.
 *
 * `claude plugin validate .` covers manifest schema; this covers the things it
 * doesn't: that every file a SKILL.md points at actually exists, that skill
 * names match their directories, and that manifests stay in sync with the tree.
 * A skill whose reference link is broken fails silently at runtime — the model
 * just doesn't get the content — so catching it here is worth the few lines.
 *
 * Usage: node scripts/validate-repo.mjs
 * Exit: 0 clean, 1 errors found.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const notes = [];

const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// --- frontmatter -----------------------------------------------------------
// Deliberately a small hand-rolled parser: the frontmatter we care about is
// two scalar fields, and adding a YAML dependency to a repo whose only runtime
// dep is Playwright isn't worth it.
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { error: 'no YAML frontmatter' };
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { error: 'malformed frontmatter block' };
  const out = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (kv) { key = kv[1]; out[key] = kv[2]; }
    else if (key && line.trim()) out[key] += ' ' + line.trim();
  }
  return { data: out };
}

const ALLOWED_FM = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility']);

function validateSkill(skillDir) {
  const rel = relative(ROOT, skillDir);
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) { err(`${rel}: no SKILL.md`); return; }

  const text = readFileSync(skillMd, 'utf8');
  const { data, error } = parseFrontmatter(text);
  if (error) { err(`${rel}/SKILL.md: ${error}`); return; }

  for (const k of Object.keys(data)) {
    if (!ALLOWED_FM.has(k)) err(`${rel}/SKILL.md: unexpected frontmatter key "${k}"`);
  }

  const name = (data.name || '').trim();
  if (!name) err(`${rel}/SKILL.md: missing name`);
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) err(`${rel}/SKILL.md: name "${name}" is not kebab-case`);
    if (name.length > 64) err(`${rel}/SKILL.md: name exceeds 64 chars`);
    const dirName = skillDir.split('/').pop();
    if (name !== dirName) {
      err(`${rel}/SKILL.md: name "${name}" does not match directory "${dirName}" — ` +
          `Claude Code resolves skills by directory, so these must agree`);
    }
  }

  const desc = (data.description || '').trim();
  if (!desc) err(`${rel}/SKILL.md: missing description`);
  else {
    if (desc.length > 1024) err(`${rel}/SKILL.md: description is ${desc.length} chars, max 1024`);
    if (/[<>]/.test(desc)) err(`${rel}/SKILL.md: description contains angle brackets`);
    if (desc.length < 80) warn(`${rel}/SKILL.md: description is short (${desc.length} chars) — ` +
      `descriptions are the whole triggering mechanism, so thin ones under-trigger`);
  }

  // Every referenced path must exist. A dead link means the model silently
  // gets nothing when it follows the pointer.
  const refs = new Set();
  for (const m of text.matchAll(/`((?:references|scripts|assets)\/[^`\s]+)`/g)) refs.add(m[1]);
  for (const m of text.matchAll(/\]\(((?:references|scripts|assets)\/[^)\s]+)\)/g)) refs.add(m[1]);
  for (const m of text.matchAll(/(?:^|[\s(])((?:scripts)\/[A-Za-z0-9._-]+\.(?:mjs|js|py|sh))/gm)) refs.add(m[1]);
  for (const r of refs) {
    if (!existsSync(join(skillDir, r))) err(`${rel}/SKILL.md: references missing file "${r}"`);
  }
  if (refs.size) notes.push(`${rel}: ${refs.size} referenced file(s) resolved`);

  // Reference docs should be reachable from SKILL.md, or they're dead weight
  // the model will never load.
  const refDir = join(skillDir, 'references');
  if (existsSync(refDir)) {
    for (const f of readdirSync(refDir)) {
      if (!f.endsWith('.md')) continue;
      if (!text.includes(`references/${f}`)) {
        warn(`${rel}: references/${f} exists but SKILL.md never points to it`);
      }
    }
  }
}

// --- manifests -------------------------------------------------------------
function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { err(`${label}: invalid JSON — ${e.message}`); return null; }
}

const marketplacePath = join(ROOT, '.claude-plugin/marketplace.json');
if (!existsSync(marketplacePath)) {
  err('.claude-plugin/marketplace.json is missing');
} else {
  const mk = readJson(marketplacePath, 'marketplace.json');
  if (mk) {
    if (!mk.name) err('marketplace.json: missing name');
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(mk.name)) {
      err(`marketplace.json: name "${mk.name}" is not kebab-case`);
    }
    if (!mk.owner || !mk.owner.name) err('marketplace.json: missing owner.name');
    if (!Array.isArray(mk.plugins) || !mk.plugins.length) {
      err('marketplace.json: plugins must be a non-empty array');
    } else {
      const seen = new Set();
      for (const [i, p] of mk.plugins.entries()) {
        const at = `marketplace.json plugins[${i}]`;
        if (!p.name) { err(`${at}: missing name`); continue; }
        if (seen.has(p.name)) err(`${at}: duplicate plugin name "${p.name}"`);
        seen.add(p.name);
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.name)) err(`${at}: name "${p.name}" is not kebab-case`);
        if (typeof p.source !== 'string') { err(`${at}: expected a relative-path source`); continue; }
        if (p.source.includes('..')) err(`${at}: source contains ".."`);
        if (!p.source.startsWith('./')) err(`${at}: relative source must start with "./"`);

        const pluginDir = join(ROOT, p.source);
        if (!existsSync(pluginDir) || !statSync(pluginDir).isDirectory()) {
          err(`${at}: source "${p.source}" does not exist`); continue;
        }
        const manifestPath = join(pluginDir, '.claude-plugin/plugin.json');
        if (!existsSync(manifestPath)) { err(`${p.source}: missing .claude-plugin/plugin.json`); continue; }
        const pj = readJson(manifestPath, `${p.source}/plugin.json`);
        if (!pj) continue;
        if (pj.name !== p.name) {
          err(`${p.source}: plugin.json name "${pj.name}" != marketplace entry "${p.name}"`);
        }
        // The docs warn that plugin.json's version silently wins over the
        // marketplace entry's, so a mismatch is a real trap.
        if (pj.version && p.version && pj.version !== p.version) {
          err(`${p.name}: version mismatch — plugin.json ${pj.version} vs marketplace ${p.version}. ` +
              `plugin.json wins silently, so these must agree`);
        }
        if (pj.repository && typeof pj.repository !== 'string') {
          err(`${p.source}: plugin.json repository must be a string URL, not an object`);
        }

        const skillsDir = join(pluginDir, 'skills');
        if (!existsSync(skillsDir)) { warn(`${p.source}: no skills/ directory`); continue; }
        const skills = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());
        if (!skills.length) warn(`${p.source}: skills/ is empty`);
        for (const s of skills) validateSkill(join(skillsDir, s));
      }
    }
  }
}

// --- report ----------------------------------------------------------------
for (const n of notes) console.log(`  ·  ${n}`);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`FAIL  ${e}`);

console.log(
  `\n${errors.length ? 'FAILED' : 'OK'} — ` +
  `${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);
