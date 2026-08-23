# The Conformance Layers

## Table of contents
- [Layer 1 — Token conformance](#layer-1--token-conformance)
  - [The theme matrix](#the-theme-matrix)
  - [What drift actually looks like — one measured case](#what-drift-actually-looks-like--one-measured-case)
  - [The token that is set and does nothing: framework alias indirection](#the-token-that-is-set-and-does-nothing-framework-alias-indirection)
  - [The cascade layer that silences a whole utility family](#the-cascade-layer-that-silences-a-whole-utility-family)
  - [Assert the promise, not the mechanism](#assert-the-promise-not-the-mechanism)
- [Layer 2 — Mockup comparison (DOM-to-DOM)](#layer-2--mockup-comparison-dom-to-dom)
- [Layer 3 — Spec & flow coverage](#layer-3--spec--flow-coverage)
- [Layer 4 — Visual regression baselines](#layer-4--visual-regression-baselines)
- [Layer 5 — Semantic role conformance](#layer-5--semantic-role-conformance)
- [Responsive: cuts across every layer](#responsive-cuts-across-every-layer)
- [Accessibility conformance](#accessibility-conformance)
- [Figma (optional)](#figma-optional)
- [Adopting conformance on a codebase that isn't conformant yet](#adopting-conformance-on-a-codebase-that-isnt-conformant-yet)
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
- **Count the distinct literals first.** It needs no browser, and the distribution alone tells you
  whether there is a scale. State the command with the number, because a reader who runs a slightly
  different grep gets a different count and then distrusts the whole measurement — the figures above
  come from arbitrary-value syntax in `.tsx` only:

  ```bash
  grep -rohE '\[[0-9]+px\]' src --include='*.tsx' | grep -oE '[0-9]+' | sort -n | uniq -c
  ```
 It is the cheapest possible opening
  measurement for a conformance engagement, and it produces a number a team can act on.

### The token that is set and does nothing: framework alias indirection

A design system that scopes tokens per-subtree — a theme preview, an inverted panel, a card that
advertises a palette the page is not currently using — will meet this, and it fails **silently and
convincingly**.

Utility frameworks map their own keys onto your tokens. Tailwind v4 does it in `@theme`:

```css
@theme {
  --color-ink-900: var(--ink-900);   /* compiles into :root */
}
```

A `var()` is substituted **at the element that declares it**. `--color-ink-900` therefore resolves
against the *root's* `--ink-900`, and descendants inherit a finished colour. So this does nothing:

```html
<div data-palette data-theme="amber">   <!-- redefines --ink-900 for its subtree -->
  <div class="bg-ink-900">…</div>       <!-- still reads the ROOT's resolved colour -->
</div>
```

The subtree's tokens are correct. Every attribute is correct. Nothing renders differently. The fix
is to re-declare the framework's alias keys inside the scope, where the substitution happens against
the scope's own tokens:

```css
[data-palette] {
  --color-ink-900: var(--ink-900);
  /* …one line per colour key… */
}
```

**Check for this whenever tokens are scoped below `:root`.** It is not specific to Tailwind: any
layer that renames your tokens into its own namespace on `:root` has the same property.

### The cascade layer that silences a whole utility family

The worst token failure this document has a measured case for is not a wrong
value. It is a correct value that never applies.

Measured on a Tailwind v4 project: every `p-*`, `px-*`, `py-*` and `m-*` in the
application computed to **0px** for an entire milestone, because a stylesheet
opened with

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
```

written at the top level, in no cascade layer. Tailwind emits its utilities into
`@layer utilities`. **An unlayered declaration beats a layered one outright —
specificity is never consulted across that boundary.** A bare `*` at (0,0,0)
therefore beat `.p-2` at (0,1,0) on every element in the tree.

Two properties of this failure make it worth its own section.

**`gap` survives.** A universal reset sets `margin` and `padding` and nothing
else, so flex and grid spacing kept working perfectly. The screens looked
cramped rather than broken, and — the part that matters for writing the check —
**a conformance probe that sampled only `gap` would have been green from the
first day to the last.** Sample the families a reset touches, not the one you
reach for first.

**Every cheap check reports healthy.** In the measured case:

- the source-reading guard was correct and irrelevant: `py-2` is on the 4px grid
  whatever it paints;
- the spacing variable was right and inherited correctly to every element, so
  reading the token from the failing element proved nothing;
- the same declaration applied INLINE rendered the right number, so the engine,
  the variable and the arithmetic were all fine;
- the built stylesheet was correct — `.p-2{padding:calc(var(--spacing) * 2)}`
  and `--spacing:4px` both present. Reading the CSS was not enough, because both
  halves are right and the failure is in the relationship between them.

The check that sees it is a rendered measurement and nothing cheaper:

```js
const el = document.createElement("div");
el.className = "p-2";
document.body.appendChild(el);
// kebab-case: getPropertyValue answers camelCase with "" rather than an error,
// which fails every probe for a reason unrelated to the app
const got = getComputedStyle(el).getPropertyValue("padding-top");
expect(got).toBe("8px");
```

**And the reason it survived a whole milestone is not technical.** A DOM-to-DOM
mockup comparison had been reporting it at every phase boundary — the nav item
at 19px against the mockup's 40px, the footer bar at 20px against 56px. It was
not acted on because the harness's own header said the mockup was "the likelier
stale one", and every reading of the report was filtered through that sentence.
A worklist that is habitually explained away is not a worklist. If you ship a
comparison in advisory mode, pair it with a rule for when a finding must be
*confirmed against the running app* rather than reasoned about — geometry that
differs by more than a token step is a good trigger.

### Assert the promise, not the mechanism

The measured case above shipped with a passing test. The spec clicked a theme card and asserted the
document's `data-theme` attribute had changed — and it had. Five cards that were supposed to preview
five different palettes rendered **pixel-identical**, and the suite was green, because the assertion
was pointed at the mechanism the feature uses rather than at the thing the feature promises.

The promise was "each card looks like the palette it offers." The assertion that states it is a
comparison of **computed colours**:

```js
const grounds = await page.$$eval('[data-palette]', els =>
  els.map(el => getComputedStyle(el).backgroundColor));
expect(new Set(grounds).size).toBe(grounds.length);   // five cards, five colours
```

Reversal on that assertion reports `Expected: 5, Received: 1` — which is the defect, named. The
attribute check cannot report it at all.

The general form is worth carrying into every layer of this document: **an attribute, a class name
and a data hook are inputs to rendering, not evidence of it.** If the claim is visual, the assertion
has to read something the renderer produced. What actually found this one was a person looking at a
screenshot and disagreeing with a green suite — the same ending as the blind-spot case in Layer 2,
one layer up.

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

### Pin both sides to the same theme state, or you measure the theme

Measured on a desktop app shipping five visual identities × light/dark, so ten palettes. The mockup declared `data-mode="light"` in its markup; the running app follows the user's stored preference and happened to be in dark. First run:

```
70 finding(s): 44 high, 26 medium
  [high] nav-browse · color: mockup rgba(10,109,148,1), implementation rgba(94,200,255,1)
  [high] nav-browse · backgroundColor: mockup rgba(10,109,148,0.13), implementation rgba(94,200,255,0.17)
  ...
```

Every one of those reads like real drift and points at a specific token. None of them was: the two sides were simply wearing different palettes. Reading the app's own theme attributes before navigating, then stamping them onto the mockup after it loads, gave **52 findings, 26 high** — eighteen high-severity findings were an artefact of the harness.

```js
const palette = await readThemeAttributes(app)   // e.g. { theme: "glass", mode: "dark" }
await goto(mockupUrl)
await applyThemeAttributes(palette)              // same state, both sides
```

The more palettes a product ships, the worse this gets: with ten, any run where the sides disagree reports a whole palette's worth of plausible, unreal drift — and a reviewer who chases the first three findings and finds them bogus stops reading the report. **Assert the pinning happened** rather than assuming it; a theme attribute that failed to apply produces exactly the same output as one that was never set.

The same applies to any global state that reaches computed style: locale (which changes fonts and text length), density or compact modes, high-contrast, and reduced-motion or reduced-transparency preferences.

### The mockup directory must be in your CSS toolchain's source set

With utility CSS — Tailwind, UnoCSS, anything that generates classes from what it scans — the generator only emits the utilities it *sees*. Mockups usually live outside the scanned source tree, so every class in the mockup resolves to nothing.

The failure mode is what makes this worth a section: the mockup renders **unstyled**, the comparison runs perfectly, and it reports a diff on every property of every element. That reads as a catastrophic design drift and is actually an empty stylesheet. It is much harder to diagnose than a blank screen, because the output looks like exactly the thing the tool exists to produce.

Point the scanner at the mockups (Tailwind v4: `@source "../mockups";`), then **verify the utilities are in the built stylesheet before trusting a single finding** — grep the output for a handful of the classes the mockup uses. Measured cost on one project: 56.39 kB → 58.77 kB, about 0.5 kB gzipped, and most of it stops being mockup-only as the implementation adopts the same utilities.

Serve the mockup from the **application's own origin** where you can. It sidesteps `file://` restrictions, keeps relative asset paths working, and on an embedded webview (Tauri, Electron) it is often the only navigation the host will allow at all. Copy the mockups into the build output as a test-build step rather than committing them to the product's public directory, so a design proposal never ships to users. Copy the stylesheet beside them under a **stable name** too — content-hashed filenames change every build, and a mockup linking a hashed file breaks silently into the unstyled case above.
### The blind spot this layer cannot see out of — measured, 2026-08-23

Rendering both sides in the same engine is what makes this layer diagnostic. It is also the exact reason it has one blind spot, and the blind spot is worth stating as a rule:

> **A same-instrument comparison can prove that two things match. It can never prove that either one is correct.**

The measured case. A Tailwind v4 project set its root font size to `14px` (a dense desktop app) and left `--spacing` at Tailwind's default of `.25rem`. `rem` resolves against the root, so every spacing utility in the application rendered at **87.5%** of the number written beside it: `p-6` was 21px, `h-8` 28px, `h-16` 56px. The design system documented a 4px grid; what shipped was a 3.5px grid.

The DOM-to-DOM comparison ran against a committed mockup across three viewport widths and reported clean agreement on spacing throughout. It was right: **the mockup was authored in the same utilities, so both sides were wrong by the same eighth.** The diff was zero because the error was common-mode.

The static source guard in the same project missed it for a different reason worth pairing with this one: it read *source*, where `h-14` is a clean multiple of 4 whatever it paints, and it rejected only arbitrary values like `h-[54px]`. Between the two instruments, one could not see past the shared authoring vocabulary and the other could not see past the source text.

**What actually found it** was a human looking at a screenshot and noticing a header bar shorter than the number the plan quoted, then reading the built stylesheet. No automated check in the project was capable of it.

**What to do about it.** Add a third check that reads the *declaration* rather than any rendered result — the scale's base unit, the root font size, the token definitions — because that is the only place a common-mode error is visible:

```js
// The scale base must be an ABSOLUTE unit. A rem here is silently rescaled by
// whatever the root font size is, and every rendered comparison agrees anyway.
if (!/--spacing\s*:\s*[\d.]+px/.test(themeCss)) fail("spacing scale not pinned");
```

More generally: whenever two artifacts are compared, ask what they *share* — an engine, a stylesheet, a component library, a token file, a code generator. Whatever they share is what the comparison is structurally unable to judge, and it needs its own check pointed at the shared thing itself.

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

### Sampling that backdrop is harder than it sounds — four ways it silently doesn't happen

The advice above — *sample the lightest and darkest points behind the element and assert the worse
of the two* — is correct and much harder to follow than one sentence suggests. Measured on a desktop
app whose default theme is a translucent "glass" scheme over an ambient gradient field, building
that check produced **four consecutive green runs that measured nothing**. Each failure is generic;
none is about gradients specifically.

**1. The layer you need may not be on the ancestor chain at all.**

Every contrast helper anyone writes composites `backgroundColor` up the ancestor chain. That reaches
exactly one class of layer: backgrounds of ancestors. It does not reach a `::before`/`::after`
backdrop, a fixed-position sibling behind the content root, a `backdrop-filter` result, or a
platform material. In the measured app the field was painted on `body::before` — above `body`'s
opaque background, below the app root — so the walk stepped straight over it and every contrast
number ever produced for that theme composited onto the flat page colour.

The check was not merely unimplemented. It was **unimplementable with computed styles**, because a
CSS gradient cannot be sampled from script at all: `getComputedStyle` returns the declaration, not
the paint. The two options are to re-implement the renderer's gradient evaluation, or to read real
pixels. Re-implementing it is a model of the thing presented as a measurement of the thing; the
honest route is a screenshot with the content root hidden, decoded, and sampled.

**2. Substituting a better ground must actually change a number — assert that it does.**

The first working version passed on all ten themes. A diagnostic added out of suspicion reported
`ground reached 0 of 50 measurements`: every ratio was byte-identical with and without the new
ground. The compositing function had replaced the *last* entry in the collected stack, and the
opaque page background sits one above it — so compositing the stack forward painted the opaque
colour back over the sampled ground and erased it exactly. Fifty green assertions, none of them
about the backdrop.

**Generalise this past contrast.** Whenever you replace an approximation with a more accurate input,
the run passing is not evidence the accurate input arrived. Count how many results the change moved,
and assert that count. If a more accurate measurement produces identical numbers, the likeliest
explanation is that it is not being used.

**3. "Behind the element" means behind *that* element, not the whole screen.**

Taking one pair of extremes for the entire viewport and grading every element against it feels
conservative. It is not conservative, it is wrong: it graded a bottom-docked status bar against the
brightest point of a field the bar never overlaps. Seven failures; four vanished when extremes were
read inside each element's own rectangle. **A measurement that reports failures a user cannot see
will be disabled**, and it deserves to be.

**4. Do not hard-code which themes have the backdrop. Read it.**

The spec carried "only the glass theme has a field" and passed. A second theme also had one, at low
alpha, and measured 0.0092 against a hard-coded flat-ground threshold of 0.01 — one thousandth from
failing a correct theme for the wrong reason. The source comment in the stylesheet said the same
wrong thing. Read the backdrop token off the document and branch on that; a list of which variants
have a feature is a second copy of the design system that nothing keeps in sync.

**What it was worth.** Once all four were fixed, the check found three real AA failures the existing
contrast run could not see — worst **3.76:1** on secondary text over the warm lobe of the field, in
the app's *default* theme. Two of the three fixes were the same idea: the accent wash sitting
between accent-coloured text and the ground was thinned, which moves the background away from the
text colour in light and dark at once, without touching the accent colour itself — the accent is
also the focus-ring colour and is graded at 3:1 against different surfaces.

**A pairing guard worth copying.** To prove the sampler was reading the backdrop and not the
application, assert **both** directions: a theme that declares a backdrop must measure a non-zero
spread, and a theme that declares none must measure zero. Either alone is satisfiable by a broken
sampler — if the content root is never hidden, every theme shows a large spread including the ones
that should be flat.

### Focus treatment is the one conformance check you cannot drive from inside the page

> **Canonical statement of this finding.** `platforms.md` and the e2e skill's `desktop.md` both
> reference it; when it changes, change it here and leave those as pointers.

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

## Adopting conformance on a codebase that isn't conformant yet

Every layer above assumes you are verifying a settled design against a settled artifact. **The two
moments teams actually reach for conformance are the opposite of that**: adopting it on an existing
codebase, and running it through a redesign. In both, the violation count on day one is large and
stays large for weeks.

That matters because of how a gate dies. Set the bar at zero violations, and the build is red from
the first run for reasons nobody caused that day. A gate that is always red is not a gate — within a
week someone adds `continue-on-error` and the layer is decorative. This is the most common way a
conformance suite is lost, and it happens before it has ever caught anything.

**Ratchet instead. Baseline the debt, then forbid it growing.**

1. Run every check, record the violation count per check, commit that file.
2. CI fails when any count **rises**, not when it is non-zero.
3. Lowering a count updates the baseline in the same commit that lowered it.

The gate is then honest on day one — it says "you added drift" — and the number only travels one
direction.

**Two ways the ratchet rots, both worth designing against:**

- **A baseline that never moves.** Debt frozen is debt kept. Give the number somewhere to go: a
  per-PR budget ("any PR touching a file must leave it no worse"), or a date the bar drops. Without
  one, the ratchet becomes a permanent record of the mess rather than a route out.
- **Re-baselining to make red go away.** Raising the baseline must look like what it is. Keep the
  baseline in a committed file so raising it appears in the diff and is reviewed like code, never as
  a CI flag or an auto-regenerated artifact. If the tooling can silently rewrite it, it will.

**Do not ratchet the checks that cannot false-positive.** Theme-contract symmetry and locale parity
are decidable: a token is defined in every theme or it is not. Those go straight to blocking, on day
one, because their day-one count is usually zero or nearly so, and a ratchet around them just adds
ceremony. Ratchet the layers carrying real existing debt — hardcoded values, spacing literals,
mockup diffs.

**During a redesign the comparison layer inverts.** The artifact is deliberately ahead of the code —
that is what a redesign *is* — so a diff against the mockup is the expected state, not a defect.
Run Layer 2 as a **worklist** while the migration is in flight: it tells you what has not been
migrated yet, ranked, which is genuinely useful. Flip it to a gate only when the migration closes.
Announce which mode it is in, in the report itself; a worklist read as a gate looks like catastrophe,
and a gate read as a worklist looks like success.

---

## Wiring it into CI

- **Separate files and tags per concern:** `*.token.spec.ts`, `*.visual.spec.ts`, `*.a11y.spec.ts`, mockup comparison as its own step. Never interleave with functional specs.
- **Different gating:** functional tests block the merge. Conformance runs alongside and reports; visual diffs in particular need the human seam and shouldn't auto-block.
- **One source of truth for tokens**, shared by app and tests.
- **Emit machine-readable output** (`--out report.json`, JUnit XML) so findings are tracked artifacts rather than console output nobody reads after the first week.
- **Don't auto-file defects** on every diff. Gate defect creation behind human confirmation, or the tracker fills with noise and the team learns to ignore the whole category.
