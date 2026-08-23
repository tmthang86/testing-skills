---
name: design-conformance-testing
description: Verify that a built UI actually matches its design — design tokens, design system, HTML mockups, markdown UI/UX specs, Claude Design output, user flows, and optionally Figma. Covers design-token conformance, DOM-to-DOM mockup comparison, responsive checks across breakpoints and screen sizes, visual regression baselines, state and flow coverage, and accessibility conformance. Use whenever the user asks whether the implementation matches the design, mockup, spec, or design system; mentions design drift, visual regression, pixel diff, token conformance, or "does this look right"; wants to check spacing, color, typography, or layout against a source of truth; ships multiple themes that must define the same tokens; wants to verify responsiveness across viewports, breakpoints, resolutions, or mobile/tablet/desktop sizes; or wants to gate a PR on design fidelity. This is the design-fidelity layer and is distinct from functional E2E testing (does the flow work) — reach for the e2e-testing skill for that.
---

# Design Conformance Testing

Functional tests answer "does the flow work?" This skill answers a different question they are structurally blind to: **"does it match what was designed?"** A button can pass every functional assertion — exists, clickable, fires the right event — while shipping a wrong color token, a 24px gap where the spec says 16px, or a missing empty state. No amount of functional coverage catches that.

Keep this layer in its own files and its own CI job. When a design drift and a functional regression can both turn the same suite red, people stop reading the failures.

## Step 1 — Find the source of truth (do this before writing anything)

Conformance testing is only as good as what you compare against. The single biggest mistake is inventing expected values from what "looks like a reasonable design system." **Locate the actual artifact first.** Look for, roughly in this order:

| Artifact | Typical location | What it gives you |
|---|---|---|
| **Design tokens** | `tokens.json`, `theme.ts`, CSS custom properties, a design-system skill | Exact expected values — the strongest assertions |
| **HTML mockup** | `mockups/`, `design/`, prototype artifacts | A renderable reference: compare DOM-to-DOM (best technique available) |
| **Markdown UI/UX spec** | `docs/design/`, spec folders, feature specs | Stated values, component states, flows, acceptance criteria |
| **Claude Design output** | Canvas artifact exported to HTML | Same as an HTML mockup — render and compare |
| **Figma** | Figma MCP, if connected | Semantic design data. Optional; only if the team actually works there |
| **Existing UI** | The running app | Visual baseline only — self-referential, catches drift not correctness |

A repo-committed artifact (mockup HTML, spec markdown, tokens file) is *better* for automated conformance than Figma, for three reasons worth internalizing: it is **versioned** alongside the code so a design change is a reviewable diff; it is **machine-readable** without an API round-trip; and if it's HTML, it renders in the **same browser engine** as the implementation, so you can compare computed styles directly instead of diffing an image against a render. Teams using spec-driven / AI-DLC-style workflows, where design artifacts are committed repository artifacts, are in the strongest possible position here — use those artifacts, and treat Figma as an optional extra rather than the default target.

If you can't find any artifact, say so and ask rather than fabricating expected values. "I compared it against what a typical design system would specify" is not a conformance test.

## Step 2 — Pick the layers worth building

Five layers, in ROI order. Don't reflexively build all five; each carries upkeep.

1. **Token conformance** — assert computed styles equal design tokens. Cheap, deterministic, catches the most common real drift (someone hardcoded a value instead of using the system). **Build this whenever a design system exists.** If the product ships **more than one theme**, start with the *theme matrix* half of this layer: assert every theme defines the same token contract before asserting any element. A token present in one theme and missing from another breaks exactly one control in exactly that theme, which per-element assertions cannot see and which nobody notices until they switch. It reads the token source rather than a rendered page, so unlike the rest of this layer it works unchanged on mobile and native desktop.
2. **Mockup comparison (DOM-to-DOM)** — render the HTML mockup and the implementation in the same engine, diff computed styles and geometry per element. Tells you *what* diverged, not just *that* something did. **Build this whenever an HTML mockup exists** — it's the highest-signal check available and the bundled script does the heavy lifting.
3. **Spec & flow coverage** — derive scenarios and state coverage from the written spec: every designed state (empty, loading, error, permission-denied) and every designed branch in the user flow. Costs nothing but discipline; catches the states people quietly skip.
4. **Visual regression baselines** — screenshot-vs-golden-image. Catches what no assertion enumerates (overlap, i18n text expansion, RTL breaks). Needs a human review seam, so add it once the higher layers are in place.
5. **Semantic role conformance** — assert that content of a given *kind* gets the treatment the design system assigns it: measured values in tabular mono, destructive actions in the danger token, currency at a fixed precision. Generic tools never check these because they cannot tell which content is which kind — so check at the **producer** (the formatter, the currency helper) rather than at the element. Cheap when the system states such a rule; skip the layer entirely when it doesn't.

**Responsive runs across all of them, not beside them.** Every layer above is viewport-dependent: a token check at 1440px says nothing about 375px, and a mockup comparison needs a mockup *for that width*. Two things follow. First, comparison checks only work where a per-viewport artifact exists. Second — and this is what makes responsive testing practical — **layout invariants need no artifact at all**: nothing overflows horizontally, nothing escapes the viewport, nothing designed collapsed to 0×0, touch targets are big enough. Those hold at every width by definition, so run them everywhere even when you only have one desktop mockup. **No artifact is not the same as no test ids** — the per-element invariants have to be anchored to something, so the bundled script needs at least one `data-testid` on the page and exits without running when it finds none. Tagging the handful of elements you care about is the price of entry for this layer, and it is the same tagging Layer 2 will need later. That gap is where most real responsive bugs live. See `references/responsive.md` for viewport selection, breakpoint-boundary probing, and what to check.

Accessibility conformance runs alongside all of these — see `references/layers.md`.

Full pixel-perfect matching of an entire app against a design is a well-known trap: the toolchain gets you ~65–80% of the way, then the remaining pixels cost more than the bugs are worth. Prefer **token + measurement** assertions everywhere, and reserve pixel diffing for the few screens where visual fidelity is a genuine business requirement.

## Step 3 — Run the checks

Use the bundled script rather than hand-rolling extraction each time. It sweeps every viewport you give it, comparing against a mockup where one exists and always applying layout invariants:

```bash
# Responsive sweep, config-driven (recommended)
node scripts/compare-design.mjs --config responsive.json --out report.json

# Single viewport, one mockup
node scripts/compare-design.mjs \
  --mockup file:///abs/mockups/trade.desktop.html \
  --impl http://localhost:3000/trade --viewport 1440x900

# Invariants only — no design artifact needed (page still needs data-testids)
node scripts/compare-design.mjs --impl http://localhost:3000/trade \
  --viewports 375x812,768x1024,1440x900
```

It matches elements by shared `data-testid` across both pages (supply an explicit `map` when the mockup uses different hooks), normalizes colors and font stacks so formatting noise isn't reported as drift, and groups findings by viewport so you can tell "wrong everywhere" from "wrong only on mobile" — a distinction that usually points straight at the offending media query:

```
FAIL | viewports: 3 | findings: 4 (high: 2)

  mobile
    [high] (document) · no-horizontal-overflow: document scrollWidth 420px exceeds viewport 375px by 45px
    [medium] filter-icon · touch-target-size: interactive element is 24x24px, below the 44x44px minimum
  desktop
    [high] primary-cta · paddingLeft: design=16px impl=24px (+8px)
```

For a multi-theme product, run the source-level contract check alongside it — no browser or device needed, so it is the one conformance check that costs the same on every platform:

```bash
node scripts/check-theme-contract.mjs --css tokens.css              # base+override (CSS default)
node scripts/check-theme-contract.mjs --json tokens.json --base ''  # peer themes
node scripts/check-theme-contract.mjs --android app/src/main/res
```

Verify both scripts' logic is intact in a new environment with `--self-test` (runs without a browser). Then read `references/layers.md` for the other layers, `references/responsive.md` for viewport selection and breakpoint probing, and `references/platforms.md` for mobile and desktop.

## How to report findings

A conformance run produces *design bugs*, and they need routing that a functional failure doesn't. For each finding, state:

- **What diverged**, concretely: the property, the expected value, the actual value, the delta.
- **Which artifact it was measured against** — "the committed mockup at `mockups/trade-screen.html`", not "the design".
- **Whether it's drift or an intentional change.** This is a judgment call you often can't make alone. If the implementation looks deliberate, flag it as "implementation diverges from artifact — confirm which is correct." Sometimes the artifact is the stale one, and silently "fixing" the code to match an outdated mockup is worse than the drift.

Never auto-update a baseline or auto-file a defect for every diff. Both convert signal into noise. A human decides whether a diff is a bug or an approved redesign.

## Prove each check by reversal

A conformance check that has only ever been seen passing has proved nothing — it may be asserting on an element it never found, in a theme it never loaded, against a token file it failed to parse. All three fail *green*.

So before trusting any check, **break the thing it watches and confirm it goes red**: put a hardcoded colour back, delete a token from one theme, strip the data class off a size cell, shrink a touch target. One reversal per check, not one for the suite. A `--self-test` proves the script's own logic is intact; it says nothing about whether the check is pointed at your app correctly.

This costs minutes once and is the difference between a suite that guards the design and a suite that reports success regardless of it.

## Honesty about scope

"Functional tests pass" and "verified against the design" are separate claims. State which layers you actually built and which screens they cover. If you couldn't run the comparison (no mockup found, dev server down, no browser available), say so plainly and state what's needed — an unverified conformance report is worse than none, because it grants false confidence in exactly the area it claims to cover.
