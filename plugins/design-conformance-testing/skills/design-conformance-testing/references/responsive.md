# Responsive Conformance

Responsive is where designs break most and where conformance testing pays off hardest — because a single-viewport check is blind to all of it. A screen can be pixel-perfect at 1440px and completely broken at 375px, and every functional test still passes.

## The key distinction: comparison vs invariants

Two kinds of check, with very different prerequisites. Getting this split right is what makes responsive conformance practical:

- **Comparison checks** need a design reference *for that viewport*. If the mockup only exists at desktop width, you can only compare at desktop. There is no way around this — comparing a 375px render against a 1440px mockup produces nothing but noise.
- **Invariant checks** need no reference at all. "Nothing overflows horizontally", "no element escapes the viewport", "no interactive element is smaller than a fingertip", "nothing designed collapsed to zero size" — these are true at every width by definition.

This matters because most teams have one or two mockups and a dozen real-world widths. Invariants cover the gap. Run them at every viewport unconditionally; run comparisons wherever a matching artifact exists. The bundled script does exactly this, so a viewport without a mockup is still worth testing.

## Choosing viewports

Don't test arbitrary widths. Derive them from two sources:

**1. The design's own breakpoints.** Whatever the design system or spec declares (`sm/md/lg/xl`, or explicit px values) — those are the contract. Test inside each range.

**2. The boundaries themselves.** This is the part people skip. Breakpoint bugs are almost always off-by-one in a media query (`max-width: 768px` vs `min-width: 768px` leaving 768 unhandled), and those never show up mid-range. Probe at `bp - 1` and `bp`. The script generates these automatically from a `breakpoints` array in the config.

**3. Real device widths that matter for the product.** 375×812 (small phone) and 390/393 (modern phone) are the ones that expose crowding; 768×1024 for tablet; 1280 and 1440 for laptop. If analytics show a dominant real-world width, include it.

A workable default sweep: `375×812, 768×1024, 1280×800, 1440×900`, plus boundary probes.

## What to check at each viewport

**Layout invariants** (automated by the script):

| Rule | Why it matters | Severity |
|---|---|---|
| `no-horizontal-overflow` | The page scrolls sideways — the single most common responsive bug | high |
| `within-viewport` | An element's edge extends past the screen; content is unreachable | high |
| `not-collapsed` | A designed element renders at 0×0 — present in the DOM, invisible to the user | high |
| `no-clipped-content` | Content is wider than its box (truncated). Often an intentional ellipsis, so review rather than fail | medium |
| `touch-target-size` | Interactive element under 44×44px on a touch-width viewport (WCAG 2.5.5) | medium |
| `layout-responds` | The layout signature is identical across all viewports — responsive rules may not be applying at all | medium |

That last one deserves attention: a "responsive" page whose layout never changes across a 375→1440 sweep is a silent failure. Maybe the CSS didn't load, maybe a fixed width leaked in, maybe the media queries target the wrong container. No single-viewport check can see it; only comparing across viewports can.

**Comparison checks** (where a per-viewport mockup exists): the same style/geometry diffing as any other conformance run, just repeated per viewport. Findings are tagged with the viewport so you can tell "wrong padding everywhere" from "wrong padding only on mobile" — a distinction that usually points straight at which media query is wrong.

**Things worth checking manually or by extending the sweep:**

- **Orientation** on mobile — landscape is a viewport swap (812×375), so add it as another entry rather than treating it specially.
- **Text scaling / zoom** — WCAG 1.4.4 expects usability at 200% text zoom, and 1.4.10 expects reflow without horizontal scrolling at a 320px-equivalent width. Testing at 320px width covers much of the reflow requirement with the invariants you already have.
- **Content-length extremes** — responsive bugs hide behind convenient test data. A Vietnamese label, a German compound noun, or a 40-character account name will wrap where "Test" never did. Where the design specifies max lengths, test at them.
- **Device pixel ratio** — mostly affects image asset selection rather than layout. Worth a spot check with `deviceScaleFactor: 2` if the design specifies @2x assets.

## Running it

Config-driven sweep, with mockups where they exist:

```json
{
  "impl": "http://localhost:3000/trade",
  "tolerance": 1,
  "breakpoints": [768, 1024],
  "viewports": [
    { "name": "mobile",  "width": 375,  "height": 812,
      "mockup": "file:///abs/mockups/trade.mobile.html" },
    { "name": "tablet",  "width": 768,  "height": 1024 },
    { "name": "desktop", "width": 1440, "height": 900,
      "mockup": "file:///abs/mockups/trade.desktop.html" }
  ]
}
```

```bash
node scripts/compare-design.mjs --config responsive.json --out report.json
```

Invariants only, when no design artifact exists yet — still valuable, and the fastest way to find real bugs on day one. **The page still needs at least one `data-testid`**: per-element invariants are anchored to tracked elements, so an untagged page exits with "nothing to track" rather than reporting a clean sweep. Measured against an untagged HTML mockup, which is exactly the shape of page a reader is likeliest to try first:

```bash
node scripts/compare-design.mjs \
  --impl http://localhost:3000/trade \
  --viewports 375x812,768x1024,1440x900
```

Output groups findings by viewport, so the shape of the problem is visible at a glance:

```
FAIL | viewports: 3 | findings: 4 (high: 2)

  mobile
    [high] (document) · no-horizontal-overflow: document scrollWidth 420px exceeds viewport 375px by 45px
    [high] order-table · within-viewport: right edge at 420px exceeds viewport width 375px
    [medium] filter-icon · touch-target-size: interactive element is 24x24px, below the 44x44px minimum
  desktop
    [high] primary-cta · paddingLeft: design=16px impl=24px (+8px)
```

## Responsive visual baselines

If you add screenshot baselines, capture one **per viewport** — a desktop baseline says nothing about mobile. In Playwright, define projects per viewport and let the snapshot name carry the project, so `trade-screen.png` becomes a set rather than one image. Keep the same discipline as any visual layer: mask volatile content, pin the rendering environment, and never auto-update baselines in CI.

## Mobile-native responsiveness

On iOS/Android the equivalent axis is device size and dynamic type, not CSS breakpoints:

- Run the flow on at least a small device (e.g. iPhone SE class) and a large one — small screens are where designed layouts crowd and truncate.
- Test with the OS text-size setting raised. Dynamic Type / font scaling breaks fixed-height rows constantly and is a genuine accessibility requirement, not an edge case.
- Check both orientations if the app supports them.
- Split-screen and foldable states, where the app targets them.

The invariant *ideas* carry over — nothing clipped, targets big enough, nothing collapsed — even though the DOM-based script doesn't. Assert them via the mobile testing tooling instead, and see `platforms.md`.
