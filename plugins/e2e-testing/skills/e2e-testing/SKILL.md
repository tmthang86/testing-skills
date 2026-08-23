---
name: e2e-testing
description: Functional end-to-end (E2E) UI test automation across web, desktop, and mobile apps, using the recommended agentic tooling per platform — Playwright CLI/MCP for web and Electron, Maestro for iOS/Android, OS-native accessibility drivers for native desktop. Use whenever the user wants to write, generate, run, debug, or maintain E2E / UI / browser / functional tests; automate clicking through a real app to verify a flow works; set up a test suite or Page Object Model; capture stable locators from a live UI; reproduce a user journey; or triage flaky UI tests. Trigger it even when the user just says "test the login flow", "automate the checkout", "add e2e tests", "verify this screen works", or names Playwright, Maestro, Appium, or a simulator — do not wait for the exact phrase "end-to-end". For whether the UI matches its design, tokens, or mockup, use the design-conformance-testing skill instead.
---

# E2E Testing (Web · Desktop · Mobile)

## What this skill is for

Driving a *real* app the way a user would — clicking, typing, navigating between screens — then asserting that the app behaved correctly, and saving that as a repeatable test. This is different from unit or integration testing: here the whole stack is running and the test talks to it through the actual UI.

The single most important idea: **ground every locator in the live UI, never guess it from memory.** An agent asked to "write a test for checkout" will happily invent `.btn-primary`, `#submit`, or an XPath three divs deep — selectors that look plausible and break within a week. The recommended tools below all exist to let you *look at the running app first*, capture a real, stable reference (a role, a label, a `data-testid`), and only then write the assertion. When you skip that step, the tests are worse than no tests: they fail for the wrong reasons and erode trust in the suite.

## Scope: functional only

This skill covers *does the flow work* — clicking through produces the right outcome. It deliberately does **not** cover *does it match the design* (tokens, mockups, design system, visual regression). That is a different failure mode with different tooling and a different review cadence, and it lives in the **design-conformance-testing** skill. If the user asks whether the UI matches its design, mockup, spec, or tokens, or asks for visual regression, hand off there.

Keeping the two apart matters in practice: when a design drift and a functional regression turn the same suite red, people stop reading the failures. Keep conformance tests in separate files and tags (`@visual`, `@token`) from the functional specs you write here.

The two layers do meet in one place worth remembering: the scenarios worth testing functionally should come from the *designed* user flows, not invented paths. If a design spec, mockup, or flow diagram exists in the repo, read it when choosing what to test — it tells you which states (empty, loading, error) were designed and therefore ought to exist.

## Step 1 — Identify the platform, then read the matching reference

Do not try to hold all three platforms' tooling in your head. Figure out what kind of app is under test, then read exactly the reference file(s) you need. Each is self-contained with setup, the core loop, and worked examples.

| App under test | Recommended tool | Read |
|---|---|---|
| Web app in a browser (React/Vue/Angular/server-rendered, localhost or deployed) | **Playwright** — CLI+Skill for repeatable/CI work, MCP for exploratory sessions | `references/web-playwright.md` |
| Electron / Tauri / any webview-wrapped desktop app | **Playwright** (Electron) or **tauri-driver** (Tauri) | `references/web-playwright.md` + `references/desktop.md` |
| Native macOS app (AppKit/SwiftUI, no webview) | **Hammerspoon** driver or built-in **computer use** | `references/desktop.md` |
| Native Windows app (WPF/WinForms/Win32) | **Windows UI Automation** (UIA) | `references/desktop.md` |
| iOS / Android app (native, React Native, Flutter) | **Maestro** (YAML, agent-friendly) — Appium if the team already runs it | `references/mobile-maestro.md` |

If the user hasn't said which platform, ask — but infer first from context (a `localhost:3000` URL, a `.xcodeproj`, a mention of "the trading terminal", an `AndroidManifest.xml` in the repo all answer the question without asking). A quick `ls` / `git ls-files` to spot the project type is usually faster than a clarifying question.

If a single product spans platforms (e.g. a web dashboard *and* a mobile app), treat each as its own testing target with its own tool — there is no unified tool that does all three well, and pretending otherwise produces brittle output. Keep the test *intent* shared (same user journeys, same acceptance criteria) but let each platform use its native driver.

## Step 2 — Choose CLI/Skill vs MCP (this is the choice people get wrong)

For web and Electron work you'll pick between two ways of driving Playwright. The distinction matters more than it looks:

- **CLI + Skill** (`@playwright/cli`) — the agent issues short shell commands (`goto`, `snapshot`, `click e5`, `fill e3 "…"`). Snapshots and screenshots are written to disk, *not* injected into the context. This is dramatically more token-efficient because it never forces a giant accessibility tree or tool schema into the model's context on every step. **Default to this for anything you'll run repeatedly, in CI, or across a large codebase** — which is most real work.
- **MCP** (`@playwright/mcp`) — exposes ~34 tools and keeps a persistent browser session with rich page introspection. Better for a one-off *exploratory* session where you're figuring out an unfamiliar UI live and want the model reasoning over page structure turn by turn, or for self-healing/long-running autonomous loops.

Rule of thumb: **exploring → MCP; producing a durable suite → CLI+Skill.** When unsure, prefer CLI+Skill; you can always drop into MCP for a tricky screen and go back.

Mobile has a parallel split, covered in the mobile reference: Maestro's own MCP for live device-driven authoring, Maestro CLI (`maestro test flow.yaml`) for running the committed YAML in CI.

## Step 3 — The universal loop (applies to every platform)

The tooling differs but the workflow does not. Follow this every time:

1. **Bring the app up.** Web: start the dev server / target a deployed URL. Mobile: boot the simulator/emulator and install the build. Desktop: launch the app. A test written against a non-running app is guesswork.
2. **Explore the target screen and capture real references.** Navigate to it, take a snapshot (accessibility tree or view hierarchy). Read out the *actual* elements — their roles, labels, test IDs. This is the anti-hallucination step; do not skip it.
3. **Walk the flow once, manually via the tool**, confirming each step does what you expect before you commit any assertion. If a step surprises you (wrong element, missing wait), fix your understanding now, not after writing 40 lines.
4. **Write the test**, preferring resilient, user-facing locators (see the locator priority below) over implementation-detail selectors.
5. **Run it, watch it fail for real reasons, stabilize.** First-generation output from any agent is ~70–80% right — usually a wrong selector or a missing wait condition. Run, read the actual failure, fix, rerun. Never hand back a test you haven't executed.
6. **Assert on outcomes, not UI mechanics.** "The dashboard shows the new order ID" is a real test; "the dropdown opened" is theater. Verify the product actually did the thing the user came to do.
7. **Isolate state, then commit.** Each test should set up and tear down its own data so it can run alone, in any order, in parallel. Save the committed artifact (a `.spec.ts`, a `.yaml` flow) and, for CI, a report (JUnit XML) so failures are tracked rather than lost in a folder nobody reads after week one.

## Step 4 — Before you believe a green run

Step 3 ends with "run it and watch it fail for real reasons." The harder problem is the opposite
one: **a test that runs, passes, and proves nothing.** A red test is information; a green test is
information only if it could have been red.

This is not a hypothetical failure mode for agent-written tests, it is the *characteristic* one. The
setup steps are the interesting part to write, the assertion is one boring line at the end, and
nothing complains when it is missing or vacuous. Measured examples, each of which sat green for
weeks: nine `it()` blocks containing no `expect()` while the reporter said 8/8 passing; a search
spec that waited for zero results and passed because the typing silently delivered nothing; a parser
scoring 100% on a real corpus that lacked the one shape which breaks it.

Read `references/false-greens.md` before handing over a suite, and at minimum:

- Enforce "every `it()` contains an `expect()`" **as part of the test command**, not as optional lint.
- Pair any assertion expecting *nothing* with proof that the action actually happened.
- Read the **output**, not the exit status — they are different checks.
- Prove each guard by reversal at least once: break what it protects, watch it go red, restore.

## Locator priority (all platforms)

Resilient tests target what the *user* perceives, not how the DOM/view tree happens to be built today. In rough order of preference:

1. **Role + accessible name** — `getByRole('button', { name: 'Place order' })`, or the native accessibility equivalent. Survives restyling and refactors; doubles as an a11y check.
2. **Test ID** — `data-testid` on web, `accessibilityIdentifier` / `testTag` / `resource-id` on mobile. Stable and explicit; add them to the app if they're missing rather than reaching for fragile selectors.
3. **Visible text / label** — good for content-driven UIs, but breaks under i18n and copy changes, so use with awareness.
4. **CSS / XPath structural selectors** — last resort. `.card > div:nth-child(3)` is a time bomb. If you're writing one, first ask whether a test ID belongs on that element instead.

## What good output looks like

- Tests a human can read and own without an SDK: a `.spec.ts` with clear steps, or a Maestro `.yaml` in plain English.
- One test = one user-meaningful outcome, self-contained, order-independent.
- Locators grounded in a snapshot you actually took, not invented.
- Screenshots/traces captured on failure for debugging.
- A run command and, for CI, a machine-readable report.
- Honest status: if you couldn't run it (no simulator, no dev server), say so plainly and say what's needed — don't present unverified tests as passing.
- Honest scope: "functional passing" and "visually verified against the design" are different claims. Don't let one imply the other — if design fidelity matters here, say so and point to the design-conformance-testing skill.

## Anti-patterns to refuse or flag

- Writing a full suite without ever launching the app. Stop and bring the app up first.
- Selectors invented from training data. If you didn't see the element in a snapshot, you don't know it exists.
- Asserting UI mechanics ("modal opened") instead of outcomes ("record was saved").
- Auto-filing a defect / opening a PR on every CI failure — that's noise, not signal. Gate it behind human confirmation.
- Treating first-draft generated tests as final. They're a draft; validate with a real run before trusting them.
- Reporting a run as passing because it exited 0. Read what it printed — a detached-task panic, a masked timeout, and a `$?` taken after a pipe all exit 0 (`references/false-greens.md`).

Now read the reference for the platform you identified and follow it. If the work spans platforms, read each relevant reference and keep the tools cleanly separated.
