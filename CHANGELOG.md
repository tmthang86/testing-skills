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

### design-conformance-testing — field findings added from a real project

- `references/layers.md` gains a **measured drift case**: an app with a
  committed `tokens.css`, an ADR recording its visual direction, and a contrast
  harness — and still 286 inline style blocks across 14 files, 14 of its 24
  tokens actually referenced from components, and **48 distinct hardcoded `px`
  literals including every integer from 1 to 18**. A design system existing is
  not evidence it is applied, and counting distinct literals is a five-second
  opening measurement that needs no browser
- `references/layers.md` gains the limit on **focus treatment**: `:focus-visible`
  depends on how focus was caused, so a script `focus()` can never satisfy it and
  a spec built that way passes against an app with no focus ring at all. Includes
  the delivery matrix — script, WebDriver, OS key, OS key on a locked session
- `references/layers.md` gains contrast **opacity compositing**, which found
  three real token defects on first run in one project
- `references/layers.md` notes that window capture returns a **blank image** on a
  sleeping display, silently — an unattended overnight visual run can produce a
  full set of blank baselines
- `references/platforms.md` corrects "Tauri is the easy case": token, mockup,
  spec and most accessibility layers are full, but visual baselines lose
  Playwright's `toHaveScreenshot()` machinery and focus treatment is not
  reachable from inside the page at all

### design-conformance-testing
- Source-of-truth routing that prefers repo-committed artifacts (tokens, HTML
  mockups, markdown specs) over Figma
- Four layers: token conformance, DOM-to-DOM mockup comparison, spec & flow
  coverage, visual regression baselines; plus accessibility
- `compare-design.mjs`: multi-viewport comparator with six layout invariants,
  breakpoint boundary probing, and layout-responsiveness detection
- Responsive guidance: comparison needs a per-viewport reference, invariants
  don't
- Layer 1 gains the **theme matrix**: assert every theme defines the same token
  contract before asserting any element. Handles both theming shapes — peers
  and base+override — because treating a CSS base block as a peer reports every
  inherited structural token as missing from every override
- `check-theme-contract.mjs`: source-level contract check for CSS custom
  properties, JSON/JS token objects, and Android `values-*` directories. Reads
  the token source rather than a rendered page, so it runs unchanged on mobile
  and native desktop, where the rest of Layer 1 degrades
- Layer 5 — **semantic role conformance**: assert content of a given kind gets
  the treatment the design system assigns it (measured values in tabular mono,
  destructive actions in the danger token), checked at the producer rather than
  the element, with an allowlist whose entries must name their reason
- Accessibility: contrast must be measured against the **binding surface** —
  ancestor opacity composited in, and a non-uniform backdrop (gradient, image,
  platform material) sampled at its worst point rather than assumed uniform
- **Prove each check by reversal** — break the thing a check watches and confirm
  it goes red. A `--self-test` proves the script's logic, not that the check is
  pointed at your app correctly

- **Adopting conformance on a non-conformant codebase**: baseline the violation
  count and gate on it rising, not on it being non-zero. A gate that is red from
  day one for reasons nobody caused gets disabled within a week, which is the
  most common way this layer is lost — before it has caught anything. Includes
  the two ways a ratchet rots, which checks to exempt from it (the decidable
  ones block immediately), and the redesign case, where the artifact is
  deliberately ahead of the code and Layer 2 runs as a worklist rather than a
  gate until the migration closes
- Scheduling summary corrected: focus treatment needs an *unlocked* session, not
  merely an awake display, and it sits under accessibility rather than layer 4 —
  so scheduling by layer number silently loses it
- `layers.md` marked canonical for the `:focus-visible` finding, which had
  spread to three files; the others now point at it
- The measured px-literal figures now carry the exact grep that produced them

### Repo
- Marketplace + two plugin manifests
- `validate-repo.mjs` for frontmatter, cross-references, manifest consistency
- Fixture pair with five documented faults + integration test asserting on
  specific findings
- CI running validate → unit → integration on every push

### Known gaps
- Comparator has never run against a real application
- Neither skill has been evaluated for triggering accuracy or output quality
