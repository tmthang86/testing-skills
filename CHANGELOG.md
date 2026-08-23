# Changelog

## 0.1.0 — unreleased

Initial draft of both skills.

### e2e-testing — field findings added from a real project

Contributed after using this material on a Tauri desktop app for about a week.
Everything here is measured rather than researched; the numbers are the observed
ones.

- `references/false-greens.md` — how a suite passes while proving nothing, with
  five measured cases: `it()` blocks with no `expect()` reporting 8/8 passing; an
  assertion expecting *nothing* that also passes when the action never happened;
  six ways exit status disagreed with output; a parser scoring 100% on a real
  corpus that lacked the one shape that breaks it; and guards nobody had ever
  seen fail
- `SKILL.md` gains a step 4, "before you believe a green run", and an
  anti-pattern for reporting a run as passing because it exited 0
- `references/desktop.md` gains the WKWebView keyboard boundary: on macOS the
  embedded WebDriver drops synthetic key events, while `setValue` and clicks work
  — so an Enter-to-submit, Tab-order, or focus-ring test can run, pass, and prove
  nothing. Includes why `:focus-visible` cannot be tested from inside the page at
  all, and why the finding must not be generalised from the channel to the app
- `references/desktop.md` gains "building a native input driver": the six hazards
  behind input from outside the browser — frontmost targeting, two processes
  sharing one name, an input method swallowing every key, locked sessions, stale
  system state in short-lived helpers, and coordinates going stale between
  commands — plus the tab-cycle boundary and how a test suite can damage the
  developer's running app

### e2e-testing
- Platform router: web/Electron/Tauri → Playwright, iOS/Android → Maestro,
  native desktop → OS accessibility drivers
- Playwright CLI+Skill vs MCP guidance, Page Object Model, auth via storage
  state, flake triage, CI wiring
- Maestro-first mobile guidance with Appium fallback
- Explicit handoff boundary to design-conformance-testing

### design-conformance-testing
- Source-of-truth routing that prefers repo-committed artifacts (tokens, HTML
  mockups, markdown specs) over Figma
- Four layers: token conformance, DOM-to-DOM mockup comparison, spec & flow
  coverage, visual regression baselines; plus accessibility
- `compare-design.mjs`: multi-viewport comparator with six layout invariants,
  breakpoint boundary probing, and layout-responsiveness detection
- Responsive guidance: comparison needs a per-viewport reference, invariants
  don't

### Repo
- Marketplace + two plugin manifests
- `validate-repo.mjs` for frontmatter, cross-references, manifest consistency
- Fixture pair with five documented faults + integration test asserting on
  specific findings
- CI running validate → unit → integration on every push

### Known gaps
- Comparator has never run against a real application
- Neither skill has been evaluated for triggering accuracy or output quality
