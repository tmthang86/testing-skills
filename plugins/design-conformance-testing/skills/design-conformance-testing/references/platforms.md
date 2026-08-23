# Conformance on Mobile & Desktop

The four layers assume a DOM. Off the web the techniques change, and some degrade. Be explicit with the user about which layers are realistically available for their platform rather than promising web-grade conformance everywhere.

## What survives per platform

| Layer | Web | Electron / Tauri | Mobile (iOS/Android) | Native desktop |
|---|---|---|---|---|
| Token conformance | Full | Full | Partial — no `getComputedStyle` | Weak |
| **Theme matrix** (Layer 1) | **Full** | **Full** | **Full** | **Full** |
| Mockup DOM-to-DOM | Full | Full | Not applicable | Not applicable |
| Spec & flow coverage | Full | Full | Full | Full |
| Visual baselines | Full | Full | Full | Partial |
| Semantic role conformance | Full | Full | Full | Full |
| Accessibility | Full (axe) | Full (axe) | Full (platform a11y audits) | Platform-dependent |

Two rows survive everywhere, and they are the ones to lean on when the rest degrades.

**Spec & flow coverage works everywhere** and costs nothing but discipline. When the automated layers thin out, it carries more weight, not less.

**The theme matrix and semantic role conformance work everywhere for the same structural reason: they read source, not a rendered screen.** The theme matrix parses the token definitions — Android `values-night/`, an iOS asset catalog's appearance variants, a Flutter `ThemeData` pair, CSS custom properties — and asks whether every theme covers the same contract. Semantic role conformance inspects the call sites that *produce* a kind of content and asserts the treatment there. Neither needs a device, a browser, or a runtime style API, so neither loses anything off the web. On mobile in particular this matters: it recovers a genuine slice of Layer 1 on the platform where Layer 1 is otherwise the biggest loss.

## Electron & Tauri

These are web under the hood, so everything in `layers.md` applies unchanged — including the bundled `compare-design.mjs`, pointed at the app's rendered window instead of a URL. For Electron, launch via Playwright's `_electron` API and run token/mockup checks against the resulting page. This is the easy case; if the "desktop" app is Electron or Tauri, don't reach for native tooling.

## Mobile (iOS & Android)

**Token conformance is the loss** — but only the per-element half of it. The theme matrix runs fully here: `res/values/` against `res/values-night/`, or an asset catalog's Any/Dark appearances, is exactly the peer shape that check is built for, and `check-theme-contract.mjs --android app/src/main/res` reads it directly. Run that first; it is the cheapest conformance available on mobile and it needs no device.

For the per-element half there's no runtime `getComputedStyle` equivalent, so you can't read a rendered element's color and compare it to a token from the outside. Three practical substitutes, in order of value:

1. **Unit/snapshot tests inside the app** — assert at the component level that the view uses `Theme.color.primary` rather than a literal. This lives with the app code, not the E2E suite, but it's where token conformance genuinely belongs on mobile. Recommend it rather than trying to force the check from outside.
2. **Accessibility-identifier presence** — assert that every element the design names actually exists with its designated identifier. Cheap, and catches "the designed element was never built".
3. **Native inspector spot-checks** — read design values via the platform inspector during authoring, and encode the ones that matter as assertions where the framework exposes them.

**Visual baselines carry most of the load.** Maestro captures a screenshot per step, which you can diff against approved baselines; Applitools and Sauce Labs both ship mobile visual SDKs with review dashboards. Pin the device model and OS version — a baseline captured on an iPhone 15 simulator means nothing when compared against a Pixel emulator, and font/density differences will produce diffs that carry no information.

**State coverage matters more here, not less.** Mobile designs specify a lot of states that are easy to skip (offline, permission prompts, background/foreground return, small-screen truncation). Derive them from the spec explicitly.

## Native desktop

The weakest platform for automated conformance, and worth saying so plainly rather than over-promising.

- **Visual baselines** work: capture the window and diff against an approved image. Same rules — pin the OS, DPI, and theme, or every run is red for reasons unrelated to the design.
- **Token conformance** is largely unavailable from the outside. Where the UI framework exposes style properties through the accessibility API (some UIA properties, some AppKit attributes), you can spot-check; mostly you can't. Push token conformance into the app's own component tests instead.
- **Spec & flow coverage and accessibility** remain fully available and become the primary conformance mechanism.

If the app is even partly webview-based, steering the conformance work toward that surface will produce far better coverage for the effort.

## A note on cross-platform designs

When one design spec covers web and mobile, resist asserting identical values across platforms. Designs legitimately adapt — larger touch targets, different type scales, platform-idiomatic controls. Compare each platform against **its own** designed values from the spec. Asserting web values on mobile produces failures that are correct-by-the-letter and wrong in substance, which is the fastest way to get a conformance suite disabled.
