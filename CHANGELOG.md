# Changelog

## 0.1.0 — unreleased

Initial draft of both skills.

### design-conformance-testing — tokens that are set and do nothing

Contributed after a measured miss on the same Tauri desktop app.

- `references/layers.md`, Layer 1 gains "The token that is set and does nothing:
  framework alias indirection". A design system scoping tokens below `:root` —
  a theme preview, an inverted panel — meets this and it fails silently:
  Tailwind v4's `@theme` maps `--color-ink-900: var(--ink-900)` inside `:root`,
  a `var()` is substituted at the element that declares it, and descendants
  inherit a finished colour. Redefining the underlying token on a subtree
  changes nothing until the framework's alias keys are re-declared inside the
  scope. Not Tailwind-specific: any layer that renames tokens into its own
  namespace on `:root` behaves the same way.
- Layer 1 also gains "Assert the promise, not the mechanism". The measured case
  shipped green: the spec asserted a `data-theme` attribute had changed, and it
  had, while the five cards that attribute was supposed to repaint rendered
  pixel-identical. An attribute, a class name and a data hook are inputs to
  rendering, not evidence of it. The assertion that states the claim compares
  computed colours and reverses cleanly to `Expected: 5, Received: 1`. Found,
  again, by a person reading a screenshot and disagreeing with a green suite.

### e2e-testing — a delete that succeeds is not evidence the right thing was deleted

- `SKILL.md` gains the reset-hygiene section. A suite that clears state before
  it runs is making a claim it rarely checks. Measured: a reset script deleted
  WKWebView's `WebsiteData/LocalStorage` — a directory that exists and is empty
  — while the real store sat under `WebsiteData/Default/<salt>/<salt>/`, values
  in UTF-16. Six runs, a successful-delete log each time, and every spec after
  it running on inherited state. The close is to read the state back through a
  different door than the one that wrote it. The write side has the same
  asymmetry: a lazy flush loses the value if the process exits promptly, so poll
  for it to land — 2 failures in 14 runs before, 10 of 10 after.

### design-conformance-testing — the blind spot in DOM-to-DOM comparison

Contributed after a measured miss on the same Tauri desktop app.

- `references/layers.md`, Layer 2 gains "The blind spot this layer cannot see
  out of": a same-instrument comparison can prove two things **match**, and can
  never prove either is **correct**. The measured case is a Tailwind v4 project
  whose 4px spacing grid was really a 3.5px grid — `--spacing` left at the
  default `.25rem` against a 14px root — which the DOM-to-DOM run reported as
  clean agreement, correctly, because the mockup was authored in the same
  utilities and both sides were wrong by the same eighth. A source-reading
  static guard missed it too, for the complementary reason: `h-14` is a clean
  multiple of 4 in the source text whatever it paints. What found it was a
  person noticing a header bar shorter than its documented height. The fix
  generalises: whatever two compared artifacts **share** — engine, stylesheet,
  component library, token file, generator — is precisely what the comparison
  is structurally unable to judge, and needs its own check pointed at the
  shared thing itself

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
- `references/false-greens.md` case 6 — **screen capture as a test instrument
  has three failure modes that all return exit 0 and a real PNG**: a uniformly
  black frame because the display slept (extrema `(0,0)` on every channel while
  the app ran normally); 24 frames that photographed the application *behind*
  the target, because the loop polled for the pid rather than for a visible
  window, and because coordinates from an earlier launch pointed outside a
  window that had moved to `(136,66) 1280×820`; and a capture cadence of ~500 ms
  aimed at a ~16 ms one-frame transient — an instrument roughly thirty times too
  slow, whose "nothing observed across 24 frames" says nothing about the event.
  Each gets its own guard: variance, a window rectangle plus a per-capture
  frontmost assertion, and cadence arithmetic done before the loop runs
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

- `references/layers.md` — **pin both sides to the same theme state, or you
  measure the theme.** On an app shipping ten palettes, a mockup hard-coded to
  light compared against an app following the user's stored dark preference
  reported **70 findings, 44 high**, every one of them naming a real token and
  a real colour. Reading the app's own theme attributes and stamping them onto
  the mockup gave **52 findings, 26 high**: eighteen high-severity findings
  were an artefact of the harness. Extends to any global state reaching
  computed style — locale, density, high-contrast, reduced-transparency
- `references/layers.md` — **the mockup directory must be in the CSS
  toolchain's source set.** Utility CSS generators emit only what they scan,
  and mockups usually sit outside the scanned tree, so every class resolves to
  nothing. The mockup renders unstyled and the comparison reports a diff on
  every property of every element — a catastrophic-looking drift that is an
  empty stylesheet, and harder to diagnose than a blank screen because the
  output looks like what the tool exists to produce. Includes serving the
  mockup from the app's own origin, copying it in as a test-build step so a
  proposal never ships, and the stable-filename trap with content hashing
- `references/platforms.md` — **a window is not a viewport.** Porting the
  comparison from Playwright to WebdriverIO: `setWindowSize()` takes device
  pixels, so 960/1280/1920 produced viewports of 480/640/960 on a 2× display
  and three confident `within-viewport` failures. Also measured: the
  automation channel ignored the window's declared `minWidth: 960` and placed
  the app at 480 CSS px, a state no user can reach. Measure the achieved
  viewport and judge against that; the width you asked for and the width you
  got are different variables and only one is evidence

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

- Corrected: "layout invariants need no artifact" is true about *artifacts* and
  was read as true about *test ids*. `compare-design.mjs` anchors per-element
  invariants to tracked elements and exits with "nothing to track" on an
  untagged page — found by running invariants-only against an untagged mockup,
  which is the first thing a reader following that line will do

### Repo
- Marketplace + two plugin manifests
- `validate-repo.mjs` for frontmatter, cross-references, manifest consistency
- Fixture pair with five documented faults + integration test asserting on
  specific findings
- CI running validate → unit → integration on every push

### Known gaps
- Comparator has never run against a real application
- Neither skill has been evaluated for triggering accuracy or output quality
