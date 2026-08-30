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

Nothing here has been proven against a real app. Treat it as a solid draft, not a
finished tool.

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
7. **A third skill, for systems with no UI** (`protocol-e2e-testing`, working name).
   Both current skills assume a screen. The `e2e-testing` router offers five rows —
   web, Electron/Tauri, native macOS, native Windows, iOS/Android — and a
   message-based system (a FIX gateway, a matching engine, a gRPC or raw-socket
   service) matches none of them. Nothing anywhere in the plugin mentions protocol,
   socket, or API testing.

   **This is a triggering defect, not only a missing feature.** The frontmatter reads
   *"E2E / UI / browser / functional tests"* and *"set up a test suite"* — unqualified
   enough that "add e2e tests for our FIX gateway" will trigger the skill, which then
   routes into a table with no matching row. It fails by giving UI advice for a non-UI
   system rather than by declining cleanly. The existing **Scope: functional only**
   section does not save it: that section separates *functional vs design* and says
   nothing about *UI vs non-UI*.

   Do it in two steps, in this order:

   **a. Close the boundary first.** Cheap, and worth doing whether or not the third
   skill ever gets written: say UI-driven in the `e2e-testing` description, and add an
   explicit row to the Step 1 router for systems with no UI so the model has somewhere
   to land. An honest "this skill doesn't cover that" beats a confident wrong route.

   **b. Then write the skill in parallel, not as a fork.** The anti-hallucination
   principle transfers exactly; only the medium changes. An agent inventing
   `.btn-primary` and an agent inventing tag `6001` for a custom field are the same
   failure:

   | `e2e-testing` (UI) | non-UI equivalent |
   |---|---|
   | Playwright / Maestro drives the app | A real engine as counterparty (QuickFIX/J, quickfix-go, quickfix-n) |
   | Snapshot the accessibility tree | Capture a real session log plus the Data Dictionary XML |
   | **Never invent a selector** | **Never invent a tag number** — read the dictionary, don't recall it |
   | Page Object Model | Message builders / scenario DSL keyed by MsgType |
   | Locator priority | Session level (Logon, Heartbeat, ResendRequest, SeqReset) vs application level (NewOrderSingle → ExecutionReport) |
   | Isolate state per test | Reset sequence numbers and use a distinct CompID per test |

   **What already carries over unchanged:** `references/false-greens.md` is
   substantially platform-agnostic — it was measured partly on a Rust test suite and
   live API tests, not only on the WebDriver suite. Eight of its nine cases apply
   directly to a protocol app; §9 (the precondition the suite cannot create) is if
   anything sharper there, where logon state and sequence numbers are exactly the
   preconditions a suite cannot conjure. Only §6 (the screenshot that photographed
   something else) is UI-only. Share that reference across skills rather than
   copying it.

   Sequence this after item 3 — a third skill widens the triggering surface, and
   measuring the boundaries between two skills is the prerequisite for adding a third.

## Design decisions worth preserving

If you refactor, these are the load-bearing ideas — losing them quietly degrades the
skills:

- **Ground locators in the live UI.** The anti-hallucination step (snapshot before
  asserting) is the single most important instruction in `e2e-testing`.
- **Functional and conformance stay separate.** Different failure modes, different
  tooling, different CI gating. Merging them means people stop reading failures.
- **One skill owns one medium.** `e2e-testing` drives a UI. The moment a skill is
  asked to also cover a system with no screen, its router stops being a decision
  procedure and its description stops being a trigger boundary. Add a sibling
  skill instead, and share the medium-independent references between them.
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
