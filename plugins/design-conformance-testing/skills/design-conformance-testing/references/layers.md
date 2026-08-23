# The Conformance Layers

## Table of contents
- [Layer 1 — Token conformance](#layer-1--token-conformance)
  - [The theme matrix](#the-theme-matrix)
- [Layer 2 — Mockup comparison (DOM-to-DOM)](#layer-2--mockup-comparison-dom-to-dom)
- [Layer 3 — Spec & flow coverage](#layer-3--spec--flow-coverage)
- [Layer 4 — Visual regression baselines](#layer-4--visual-regression-baselines)
- [Layer 5 — Semantic role conformance](#layer-5--semantic-role-conformance)
- [Responsive: cuts across every layer](#responsive-cuts-across-every-layer)
- [Accessibility conformance](#accessibility-conformance)
- [Figma (optional)](#figma-optional)
- [Wiring it into CI](#wiring-it-into-ci)

---

## Layer 1 — Token conformance

Read the computed style at runtime, assert it equals the design token. This directly answers "is this component using the design system, or did someone hardcode a one-off?"

```ts
import { test, expect } from '@playwright/test';
import tokens from '../design-tokens.json'; // the same file the app builds from

test('@token primary button uses design-system tokens', async ({ page }) => {
  await page.goto('/trade');
  const btn = page.getByRole('button', { name: 'Place order' });

  const styles = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor, color: s.color, radius: s.borderRadius,
      padX: s.paddingLeft, fontSize: s.fontSize, fontFamily: s.fontFamily,
    };
  });

  expect(styles.bg).toBe(tokens.color.primary);
  expect(styles.radius).toBe(tokens.radius.md);
  expect(styles.padX).toBe(tokens.space[4]);
  expect(styles.fontSize).toBe(tokens.typography.button.size);
});
```

Four things that decide whether this layer is useful or a maintenance sink:

- **Source the tokens, never retype them.** Import the same file the app builds from. Hand-copying values into the test creates a second thing that drifts, and then the test lies in both directions.
- **Assert the token, not the literal.** `expect(bg).toBe(tokens.color.primary)` survives an intentional token *value* change — app and test move together. `expect(bg).toBe('#0A84FF')` breaks on every rebrand and teaches people to ignore the suite.
- **Normalize units.** Browsers report colors as `rgb()`/`rgba()` and lengths in `px`. Convert tokens once in a shared helper. (The bundled `compare-design.mjs` exports `normalizeColor`, `parsePx`, and `normalizeFontFamily` — reuse them rather than rewriting.)
- **If the project has a design-system skill**, read it for the authoritative token values instead of guessing. That skill is the source of truth the humans use, so it should be the one the tests use.

This scales best at the component level with Storybook: render every variant in isolation and token-check it, so one upstream token change is verified across the whole library at once.

---

### The theme matrix

Everything above checks one element against one token set. As soon as the product ships **more than
one theme** — light/dark, brands, density modes, high contrast — a second failure appears that
per-element assertions are structurally blind to: **a token defined in one theme and missing from
another.**

Nothing breaks in the theme you develop in. Exactly one control breaks, in exactly one theme, and
only when somebody switches to it. Per-element token tests do not catch it because they run in
whichever theme the test happened to boot in, and the element they assert is not the one that
regressed.

So check the **contract** before checking any element: the union of token names any theme defines,
and whether every theme covers it. Two shapes exist and they need different arithmetic:

| Shape | Looks like | Contract is |
|---|---|---|
| **Peers** | `{ light: {...}, dark: {...} }`; Android `values/` vs `values-night/`; separate iOS appearance sets | The union across all themes |
| **Base + override** | `:root` plus `:root[data-theme="dark"]`; a default `ThemeData` the variants copy and modify | The union across the **overrides** only |

**Getting the second one wrong produces confident nonsense.** Treat the base as a peer and every
token declared once — font stacks, radii, a sidebar width — is reported missing from every
override, when at runtime it simply cascades. The signal drowns on the first run and the check gets
switched off.

**Why this layer is worth building even where the others thin out:** it reads the token *source*,
not a rendered page. No browser, no device, no `getComputedStyle`. That makes it the one piece of
Layer 1 that runs unchanged on iOS, Android, Flutter and native desktop — see `platforms.md`, where
everything else in this layer degrades.

```bash
node scripts/check-theme-contract.mjs --css tokens.css          # base defaults to :root
node scripts/check-theme-contract.mjs --json tokens.json --base ''   # peers
node scripts/check-theme-contract.mjs --android app/src/main/res
node scripts/check-theme-contract.mjs --self-test
```

**Two honest limits.** A colour declared only in the base and overridden by nobody is reported as an
*advisory*, never a failure — it might be a deliberate invariant brand colour or a value the other
themes never got, and structure cannot tell those apart. And with base+override and exactly **one**
override, removing a token from that override merely shrinks the contract, so the check degrades to
that same advisory. From the second override onward it fails precisely, naming the theme and the
token. **It strengthens as the theme count grows** — which is when this defect starts to bite
anyway.

---

### What drift actually looks like — one measured case

A desktop app with a documented design system, a committed `tokens.css`, and an ADR recording its
visual direction. Measured against its own source:

| | |
|---|---|
| Custom properties defined in `tokens.css` | **24** distinct names (43 declarations across the two schemes) |
| Distinct `var(--…)` tokens actually referenced from components | **14** |
| Inline `style={{…}}` blocks | **286**, across 14 files |
| Distinct hardcoded `px` literals | **48** |

The `px` list is the part worth staring at: `1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 20 21 22
24 26 28 30 34 36 40 48 52 62 72 80 90 120 180 …`

**Every integer from 1 to 18 appears.** That is not a spacing scale with a few exceptions, it is the
absence of a scale — a 4-point system would show 4, 8, 12, 16, 24 and very little else.

Two things follow for how you pitch this layer:

- **A design system existing is not evidence it is applied.** This project had the tokens, the ADR,
  and a test harness that checked contrast — and the spacing still fragmented. Token conformance is
  worth building *especially* where a system is documented, because that is where everyone assumes
  the problem is already solved.
- **Count the distinct literals first.** It is a five-second grep, it needs no browser, and the
  distribution alone tells you whether there is a scale. It is the cheapest possible opening
  measurement for a conformance engagement, and it produces a number a team can act on.

---

## Layer 2 — Mockup comparison (DOM-to-DOM)

When the design artifact is an HTML mockup (hand-written, generated by a spec-driven workflow, or exported from Claude Design), you have the strongest technique available: render **both** the mockup and the implementation in the same browser engine and compare computed styles element by element.

Why this beats comparing against an image: a pixel diff can only say "0.7% of pixels differ." A DOM diff says `paddingLeft: design=16px impl=24px (+8px)` — which points straight at the wrong spacing token. Diagnosis, not just detection.

Use the bundled script:

```bash
node scripts/compare-design.mjs \
  --mockup file:///abs/path/mockups/trade-screen.html \
  --impl http://localhost:3000/trade \
  --tolerance 1 --out report.json
```

**The matching contract.** By default it pairs elements by shared `data-testid`. This means the mockup needs testids matching the implementation. That's a small, worthwhile discipline: it makes the mockup machine-checkable and doubles as the locator contract for functional tests. If the mockup uses different hooks, supply a map:

```json
[
  { "name": "primary-cta",   "mockup": ".btn-primary",  "impl": "[data-testid=place-order]" },
  { "name": "balance-label", "mockup": "#balance .lbl", "impl": "[data-testid=balance]" }
]
```

**Interpreting the output.** Severity is assigned by property group — color, typography and spacing are `high` (almost always real drift); shape, layout and size are `medium` (more often legitimate responsive difference). Only high-severity diffs fail the gate by default, which keeps the check from crying wolf on the first run.

**What this technique can't do.** Absolute position is not comparable — the mockup and the app live in different page contexts, so the script compares box *dimensions* and spacing, not x/y coordinates. If you need position, compare offsets relative to a shared container instead.

**An unmatched element is a finding.** If a testid exists in the mockup and not in the implementation, something designed wasn't built (or was built differently). The script reports these separately rather than silently skipping.

---

## Layer 3 — Spec & flow coverage

The cheapest layer and the most-skipped. It's not a tool, it's a reading discipline: **derive what you check from the written spec and the designed user flow, not from what seems reasonable.**

Two things to extract from a markdown UI/UX spec:

**Stated values → assertions.** Specs usually name concrete things: "the confirm button uses the danger token", "table rows are 44px tall", "the error banner persists until dismissed". Each is directly assertable. Read the spec and turn its statements into checks rather than paraphrasing them.

**Designed states → scenarios.** Every state the design specifies deserves a test, because these are exactly the ones implementations quietly skip:

- empty state (no data yet)
- loading / skeleton state
- error state (and each distinct error the spec names)
- permission-denied / disabled state
- boundary states the domain requires (e.g. a limit reached, a value at zero)

**Designed flow → scenario sequence.** For each user flow in the design, walk the *same* sequence of screens and assert the designed branch points exist — the confirmation step, the warning interstitial, the dead-end the designer put there deliberately. A suite that tests invented paths gives confidence that what was *imagined* works. A suite derived from the designed flow verifies that what was *designed* shipped.

This layer is where conformance testing and functional E2E meet: the scenarios you derive here are the scenarios the e2e-testing skill should implement.

---

## Layer 4 — Visual regression baselines

Catches what no assertion enumerates: overlap, text expansion under i18n, RTL layout breaks, cross-browser rendering, dark-mode issues.

```ts
test('@visual trade screen matches baseline', async ({ page }) => {
  await page.goto('/trade');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('trade-screen.png', {
    maxDiffPixelRatio: 0.01,
    mask: [page.getByTestId('live-clock'), page.getByTestId('balance')],
  });
});
```

The loop has exactly **one human review seam**: capture baseline → run on every commit → review the diff → approve (update baseline) or reject. Never auto-update baselines in CI; that silently blesses regressions and hollows out the whole layer.

Two practical notes: **mask volatile content** (clocks, live prices, randomized data) or you'll get a red run every time, and **pin the rendering environment** — run baselines in the same container/OS as CI, since font rendering differs across platforms and will otherwise produce diffs that mean nothing.

Tooling: Playwright's built-in `toHaveScreenshot()` is free with baselines committed to the repo — start there. Move to Percy, Chromatic, or Applitools when the team is drowning in false-positive pixel noise; their value is the review dashboard and semantic diffing that judges whether a change is *meaningful* rather than comparing raw pixels. Chromatic is the natural fit if Storybook is already in use.

Capture baselines **per viewport** if you test responsively — a desktop golden image says nothing about mobile. Define a Playwright project per viewport so the snapshot name carries it.

**Screen capture needs an awake display.** On macOS, capturing a window while the display is asleep
returns a blank image — measured, and it fails silently rather than erroring, so an unattended
overnight visual run can produce a full set of blank "baselines". DOM-based layers (1–3) are
unaffected and run fine on a locked session. If you schedule conformance runs unattended, keep the
display awake for this layer specifically (`caffeinate -d` on macOS) or run it separately.

Note this layer is **self-referential**: it verifies nothing changed since the last approved state. It does not verify the approved state ever matched the design. Layers 1–3 do that.

---

## Layer 5 — Semantic role conformance

The first four layers ask whether a *component* matches its design. This one asks a question they
never reach: **does this content get the treatment its kind requires?**

Design systems routinely carry rules of the form *content of kind X is always rendered as Y*:

- Measured values — sizes, durations, percentages, timestamps — set in tabular mono, so a column of
  digits aligns and a fact does not look like prose.
- Destructive actions always in the danger token, never merely bold.
- Currency always at a fixed decimal precision with the same symbol placement.
- Untrusted or user-supplied text always in the quoted style.

No generic tool checks these, and the reason is worth understanding: **the tool cannot tell which
content is which kind.** A conformance comparator sees a string in a `<span>`. It has no way to know
that string is a byte count and therefore owes the mono face.

**The technique: check at the producer, not at the element.** You usually cannot classify rendered
text, but you can always find the code that *produced* it — a formatter, a currency helper, a typed
`<Money>` component. Assert the treatment at every one of those call sites.

| Platform | Producer | Assert |
|---|---|---|
| Web | `{formatBytes(n)}` in JSX | the enclosing element carries the data-type class, or its computed `fontFamily` is the mono stack |
| SwiftUI | `Text(formatBytes(n))` | the view chain carries `.monospacedDigit()` or the data text style |
| Compose | `Text(formatBytes(n))` | `style = Typography.data` |
| Flutter | `Text(formatBytes(n))` | `style: theme.textTheme.dataValue` |

**The allowlist is the point, not a concession.** Some producer output legitimately breaks the rule —
a count interpolated into a sentence should not be mono. Those exceptions are real, so the check
would be useless without a way to record them, and *dangerous* without a way to see them. Require
every allowlist entry to name its reason, and read the list aloud at review time. An allowlist that
has grown without anyone reading it is the same silent erosion the check was built to stop.

**Build this when the design system states such a rule.** If it doesn't, skip the layer entirely —
inventing role rules the designers never agreed is how a conformance suite acquires a reputation for
pedantry. When the rule *is* stated, this is one of the cheapest layers here: the producer list is
finite, usually a handful of functions, and a grep-level check catches most of it.

---

## Responsive: cuts across every layer

Everything above is viewport-dependent. A token assertion at 1440px says nothing about 375px; a mockup comparison is only meaningful against a mockup for *that* width. So each layer needs to be run per viewport rather than once.

The practical unlock is that **layout invariants need no design reference**: no horizontal overflow, nothing escaping the viewport, nothing collapsed to zero size, touch targets large enough. These are true at every width by definition, so they run even at viewports where no mockup exists — which is most of them, for most teams. That is where the majority of real responsive bugs are found.

The bundled script handles both: it sweeps configured viewports, compares wherever a mockup is supplied, and always applies invariants. It also probes breakpoint boundaries (`bp - 1` and `bp`), since media-query off-by-ones only show up there, and flags the case where the layout signature is identical across every viewport — a "responsive" page that never responds.

`responsive.md` has the full treatment: choosing viewports, the invariant table, orientation and text-scaling, and responsive visual baselines.

---

## Accessibility conformance

Design-system conformance and accessibility overlap more than teams expect. If the design system specifies AA contrast, minimum touch targets, or focus treatment, those are conformance assertions.

```ts
import AxeBuilder from '@axe-core/playwright';

test('@a11y trade screen has no accessibility violations', async ({ page }) => {
  await page.goto('/trade');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

Contrast ratios, focus order, ARIA roles, and target size are as much "does this match the design system" as color tokens are — and unlike most conformance checks, they have an objective external standard (WCAG) to appeal to.

**One caveat on contrast, because the default tooling is measured against a simplification.** An
automated checker pairs the declared foreground with the nearest *opaque ancestor* background. Two
increasingly common situations defeat that:

- **Ancestor opacity.** A parent at `opacity: 0.8` changes the composited colour of everything
  inside it, while the computed style still reports the declared value. The reported ratio is not
  the ratio a person sees.
- **A backdrop that is not one colour.** Translucent chrome over a gradient, an image, a video, or a
  platform material — iOS vibrancy, Android dynamic surfaces, macOS materials, web glassmorphism —
  has *no single* backdrop colour, so no single ratio exists. Sample the lightest and darkest points
  of what sits behind the element and **assert the worse of the two**; anything else reports a
  number that happens to be true at one pixel.

This is not theoretical fussiness. A palette can have every token individually above threshold and
still fail on the surface each one actually binds to — which is why the measurement has to name the
binding surface, not a nominal background.

Measured: a hand-rolled check that composited opacity **before** computing the ratio found **three
real defects** in one app's token set on its first run — in a project whose design system was
otherwise carefully specified. Compositing first is not a refinement you add later; it is the
difference between the check finding things and not.

### Focus treatment is the one conformance check you cannot drive from inside the page

If the design system specifies a focus ring — most do — verifying it has a constraint nothing else
in this file has: **`:focus-visible` depends on how focus was caused, not merely that it was.**

A `focus()` call from script, or any in-page technique, satisfies `:focus` and can **never** satisfy
`:focus-visible`. So a spec that focuses an element and then asserts on its outline is measuring the
wrong pseudo-class and will happily pass against an app with no focus treatment at all — a false
green of exactly the kind the e2e skill's `false-greens.md` catalogues.

What actually works is a real keyboard `Tab`, delivered by the OS, with the app's window **key**.
Measured on a Tauri app on macOS:

| Delivery | Result |
|---|---|
| Script `focus()` / in-page dispatch | `:focus` matches, `:focus-visible` never does |
| WebDriver synthetic `Tab` into WKWebView | focus never moved at all |
| OS-level key event, window key | works — 30 stops walked, each painting the app's own 2 px ring |
| OS-level key event, **session locked** | focus moves, but `:focus-visible` does **not** match and the outline falls back to the platform default ring |

That last row is the useful one for scheduling: a focus-treatment check cannot run on a locked or
sleeping machine even though the keys arrive, because the window is not key. Everything else in this
file can.

---

## Figma (optional)

Only relevant if the team actually designs in Figma and keeps it current. When the repo already holds committed mockups and specs, those are the better target — closer to the code, versioned with it, and renderable.

If you do use it: the Figma MCP server exposes designs semantically — structured data about components, spacing tokens, and layout constraints, not screenshots. The productive pattern is **measurement, not pixel diffing**:

1. Pull the node's spec from the MCP (dimensions, padding, gap, color, type ramp).
2. Measure the rendered element with Playwright (`boundingBox()`, computed styles).
3. Assert within tolerance — reporting *what* diverged, same principle as Layer 2.

Tools like `uimatch` package this: compare a Figma `fileKey:nodeId` against a rendered component and report computed-style and layout differences next to the pixel diff, with a pass/fail gate for CI. The style breakdown is the useful output; the pixel ratio alone rarely is.

Resist whole-app pixel matching against Figma. Layers 1 and 2 cover the same intent far more cheaply and produce diagnosable failures.

---

## Wiring it into CI

- **Separate files and tags per concern:** `*.token.spec.ts`, `*.visual.spec.ts`, `*.a11y.spec.ts`, mockup comparison as its own step. Never interleave with functional specs.
- **Different gating:** functional tests block the merge. Conformance runs alongside and reports; visual diffs in particular need the human seam and shouldn't auto-block.
- **One source of truth for tokens**, shared by app and tests.
- **Emit machine-readable output** (`--out report.json`, JUnit XML) so findings are tracked artifacts rather than console output nobody reads after the first week.
- **Don't auto-file defects** on every diff. Gate defect creation behind human confirmation, or the tracker fills with noise and the team learns to ignore the whole category.
