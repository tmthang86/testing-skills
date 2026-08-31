# Roadmap & design notes

Two Claude Code skills, drafted and validated. This note covers what is and isn't
verified, what's left to do, and the design decisions worth preserving.

Install instructions live in the [README](../README.md). This file covers what's
left to do and the decisions worth preserving.

## Verification status — read this before trusting anything

| Component | Status |
|---|---|
| Both SKILL.md files | Validated by `npm run validate` — frontmatter, cross-references, manifest consistency |
| `compare-design.mjs` pure logic | **Verified — 33/33 self-tests.** Normalization, diffing, all six invariants, boundary probes, responsiveness detection, report assembly |
| `compare-design.mjs` browser path | Exercised by CI on every push via `scripts/integration-test.mjs` against fixtures with known faults. **Never run against a real application** |
| Skill triggering | **Not evaluated.** No trigger evals run |
| Skill output quality | **Not evaluated.** No test prompts run end-to-end |
| `references/false-greens.md` §10–19 | **Measured on a second, non-UI system — not by using this skill.** Every figure was observed while building a protocol server end to end; none of it validates the skill itself |

Nothing here has been proven against a real app. Treat it as a solid draft, not a
finished tool.

**One clarification now that outside material has arrived.** `false-greens.md` §10–19 comes from a
second system — a network server with no UI — and every figure in it was measured. That is evidence
the *cases* generalise beyond the one desktop app. It is **not** evidence about these skills: that
system never invoked them. The row above says so, and the gap in "First thing to do" is unchanged.

## First thing to do

CI exercises the browser path on every push, but it has never run against a real
application. Do that early:

```bash
npm run setup
npm test                                  # all three layers, locally

# then point it at something real — invariants only, no artifact needed
node plugins/design-conformance-testing/skills/design-conformance-testing/scripts/compare-design.mjs \
  --impl http://localhost:3000/<a-real-screen> \
  --viewports 375x812,768x1024,1440x900
```

Invariants-only mode is the fastest honest signal: it needs no mockup and will
find real overflow and touch-target bugs on day one. Expect rough edges on first
contact with a real app. The likeliest candidates are the `networkidle` wait
(SPAs that poll never go idle, so this may need to become `domcontentloaded`
plus an explicit wait for a known element) and the 150ms settle timeout being
too short for animated layouts.

Then try a comparison run against a real mockup to exercise the testid-matching
path, which the fixtures cover but real markup will stress differently.

## Open items

1. **Browser path hardening against a real app.** CI covers the fixtures; real
   markup will stress it differently. The `collect()` wait strategy is the most
   likely thing to need tuning.
2. **The testid contract.** The comparator matches elements by shared `data-testid`
   between mockup and implementation. If the existing mockups don't carry testids,
   decide: add them to the mockups (better — makes mockups machine-checkable and
   doubles as the locator contract for functional tests), or use explicit selector
   maps. This decision shapes how usable the whole layer is.
3. **Run the eval loop.** Neither skill has been measured for triggering or output
   quality — the biggest remaining unknown. Use the `skill-creator` skill: write 2–3
   realistic prompts per skill, run with-skill vs. baseline via subagents, review in
   the eval viewer, iterate. Consider committing the eval set under `evals/` so
   results are comparable across iterations.
4. **Description optimization.** `skill-creator`'s `run_loop.py` tunes the frontmatter
   description for trigger accuracy. Needs `claude -p`. Worth doing once the bodies
   settle — two sibling skills with overlapping vocabulary ("test the UI") are exactly
   the case where trigger boundaries blur, so include cross-skill near-miss queries in
   the eval set.
5. **Responsive visual baselines** are documented in `responsive.md` but have no script
   support. Playwright projects-per-viewport is the intended approach if you want it.
6. **Mobile token conformance** is a real gap (no `getComputedStyle` equivalent). The
   documented answer is to push it into in-app component tests. Revisit if mobile
   becomes a priority.

## Design decisions worth preserving

If you refactor, these are the load-bearing ideas — losing them quietly degrades the
skills:

- **Ground locators in the live UI.** The anti-hallucination step (snapshot before
  asserting) is the single most important instruction in `e2e-testing`.
- **Functional and conformance stay separate.** Different failure modes, different
  tooling, different CI gating. Merging them means people stop reading failures.
- **Repo-committed artifacts beat Figma** for automated conformance: versioned,
  machine-readable, and HTML mockups render in the same engine as the app (DOM-to-DOM
  diffing tells you *what* diverged, not just that something did).
- **Comparison needs a per-viewport reference; invariants don't.** This is what makes
  responsive testing practical when you only have one or two mockups.
- **Never auto-update baselines or auto-file defects.** Both convert signal into noise.
- **Report honestly.** "Functional passing" ≠ "verified against design". An unverified
  conformance report is worse than none.

## Repo conventions

- **Version in two places must agree.** `plugin.json` silently wins over the
  marketplace entry, so a stale manifest version masks the one you meant to ship.
  `npm run validate` fails on a mismatch; bump both on every release.
- **Every reference file must be linked from its SKILL.md.** An unlinked reference
  is dead weight the model never loads; the validator warns about it.
- **A skill's `name` must match its directory.** Claude Code resolves by directory,
  so a mismatch loads nothing. The validator treats this as an error.
- **Keep the comparator's pure logic browser-free.** It's what makes the fast test
  layer possible; pushing logic into `page.evaluate` quietly removes it from test
  coverage.
