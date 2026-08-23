# Native Desktop — macOS, Windows, Tauri

There is no single "Playwright of desktop." The right tool depends on how the app is built, and choosing wrong means fragile pixel-clicking instead of stable element targeting. Route first, then set up.

**Before anything else: is the app actually native?** A huge fraction of "desktop apps" are Electron/Tauri (web under the hood). If so, use Playwright's Electron launcher or `tauri-driver` — see `web-playwright.md`, it's far more reliable than any of the options below. Only reach for the native-OS tools when the UI is genuinely AppKit/SwiftUI/WPF/Win32 with no webview.

## Routing

| App | Tool | Why |
|---|---|---|
| Electron | Playwright `_electron` launcher | Same accessibility API as web; see `web-playwright.md` |
| Tauri | `tauri-driver` (WebDriver) or `mcp-tauri-automation` | Native webview needs WebDriver, not the Electron launcher |
| Native macOS | **Hammerspoon** driver, or built-in **computer use** | Accessibility-API element targeting vs. quick screen control |
| Native Windows | **Windows UI Automation (UIA)** | UIA/Win32 element targeting is stable; pixel-clicking isn't |
| Cross-platform native, quick/exploratory | **computer use** or Midscene.js | Pixel-vision, works anywhere, but less stable for a durable suite |

Principle that decides most cases: **prefer a tool that targets UI elements via the OS accessibility API (UIA, AppKit accessibility, Hammerspoon) over one that clicks pixel coordinates.** Element-based locators survive window moves, DPI changes, and layout tweaks; coordinates don't. Use pixel-vision tools for exploration or one-offs, not for a suite you'll rerun for months.

## Table of contents
- [Built-in computer use (fastest to start)](#built-in-computer-use-fastest-to-start)
- [macOS: Hammerspoon](#macos-hammerspoon)
- [Windows: UI Automation](#windows-ui-automation)
- [Tauri](#tauri)
- [The webview keyboard boundary (measured)](#the-webview-keyboard-boundary-measured)
- [Building a native input driver](#building-a-native-input-driver)
- [The loop (all desktop)](#the-loop-all-desktop)
- [Reality check](#reality-check)

## Built-in computer use (fastest to start)

Claude Desktop / Claude Code have computer use built in — no install, good for exploratory testing or a quick smoke check of a native app.

- On macOS the first run prompts for two permissions: Accessibility (to click/type/scroll) and Screen Recording (to see the screen). That's the whole setup.
- Claude picks the fastest path automatically: a direct connector first, then Claude-in-Chrome, and screen control only as a last resort (it's slowest — screenshot, reason, click).
- Constraints to know: single-session lock (one Claude instance controls the screen at a time), the desktop must stay awake, and the app must stay running. It's a research preview on paid plans; availability shifts, so if the user needs current specifics, check the Claude Code desktop docs rather than asserting from here.

Good for: "does this flow work at all," visual verification, driving a GUI tool that has no CLI. Not ideal for: a large, fast, deterministic regression suite — for that, use the element-based tools below.

## macOS: Hammerspoon

Hammerspoon exposes macOS automation (window management, keyboard/mouse simulation, menu interaction, accessibility queries) via a Lua CLI, which an agent can script for E2E of native Mac apps, verifying via screenshots. Pair it with a TDD gate so the app is built, launched, and logging before automation runs. This gives element/menu-level targeting that's steadier than raw screen control.

Install Hammerspoon, enable its CLI (`hs`), grant Accessibility permission, then the agent drives it with `hs -c "..."` commands. Use it when you need a repeatable native-macOS suite rather than a one-off.

## Windows: UI Automation

Windows UI Automation (UIA) is the native accessibility framework — the correct foundation for testing WPF/WinForms/Win32 apps. A UIA-based skill discovers elements by control pattern and automates them with proper timeouts and permission tiers (read-only up to elevated), plus input-simulation safeguards. Target elements by their UIA properties (AutomationId, Name, ControlType), *not* screen coordinates — that's what makes the suite survive resolution and layout changes.

For a trading terminal or similar Win32 line-of-business app, this is the durable path. Reach for pixel-vision only when an element genuinely isn't exposed to UIA (some custom-drawn controls aren't).

## Tauri

`tauri-driver` speaks WebDriver to a Tauri app's native webview:

```bash
cargo install tauri-driver
```

Drive it with a WebDriver client, or use the `mcp-tauri-automation` MCP server for natural-language control ("click submit and check the result") with instant screenshots for visual debugging. If the Tauri app also has native OS chrome (tray, native menus) outside the webview, combine with the OS tool above for those parts.

**Before you write a keyboard test against it, read the next section.** On macOS the embedded
WebDriver silently drops synthetic key events, which means an Enter-to-submit test, a Tab-order
test, or a focus-ring test can run, pass, and have proven nothing.

## The webview keyboard boundary (measured)

Measured on macOS against a Tauri app's WKWebView, across three sequential runs and two different
WebDriver delivery paths:

| Action | Result |
|---|---|
| `browser.keys(["Enter"])` | no form submit |
| Actions API `key.down("\uE007")` / `\uE004` | no submit, focus never left `document.body` |
| Element-level `setValue(text)` | **works** |
| `element.click()` | **works** |

So text and clicks go in, and **keys do not**. The app is fine — a person pressing Return submits
the form normally. The webview does not route WebDriver's synthetic key events.

Three consequences, in increasing order of how much they cost:

1. **A keyboard test written this way is a false green.** It runs, the page does not change, and
   whatever it asserts about the unchanged page passes. See `false-greens.md`.
2. **`:focus-visible` cannot be tested from inside the page at all.** The selector depends on *how*
   focus was caused, not merely that it was. A `focus()` call from script satisfies `:focus` and can
   never satisfy `:focus-visible`. No in-page technique substitutes; only an interaction the OS
   itself classified as keyboard will do.
3. **The finding does not generalise to the app.** This is a fact about the *WebDriver channel*.
   Keys posted to the OS input layer reach the same webview normally. Carrying "synthetic keys don't
   work" over to "this app can't be driven from outside" is an easy and expensive mistake — in the
   project this was measured on, it produced a bug report that was simply wrong, written by reading
   the source instead of pressing a key.

**The fix is a split: input from outside, assertions from inside.** Deliver keys as real OS events;
keep reading state through WebDriver, which is good at exactly that. Each channel used for what it
can actually do.

## Building a native input driver

If you take the split above, you will write a small helper that posts OS-level keyboard and mouse
events. It is perhaps 200 lines. Six things will bite you, and all six were paid for:

**1. Input goes to whatever is frontmost — not to a window you have a handle on.** The OS event tap
has no notion of a target. During development, a URL and a Return were delivered to an unrelated
application because the app under test had quietly lost focus. **Check that your app is frontmost
before every event, not once at startup** — focus is lost *between* events, which is how that
happened — and refuse to send when it is not. Make the refusal loud and non-zero.

**2. Two processes can share the app's name.** A debug build launched by the test runner and a
release build the developer has open are both called the same thing. A driver that resolves the
target by name and takes the first match will send input to one process while every assertion reads
the other. It surfaces as a spec failing with "the field holds 0 characters" and then passing when
run alone — which looks exactly like flake and is not. **Refuse when more than one process matches,
name the pids, and accept an explicit pid to disambiguate.**

**3. An input method can swallow every key.** With a Vietnamese IME active (Telex), keys posted to
the macOS HID event tap never reached the app: the input method sits between the tap and the
application. Mouse events were unaffected, which makes it genuinely confusing — clicks land, focus
rings appear, a caret blinks in the field, and no text arrives. **Post directly to the target
process** (`CGEvent.postToPid` on macOS), which delivers downstream of the input method. The
alternative — switching the input source to a Latin layout and back — mutates a global setting that
stays wrong if the run dies. Note this is a *second* IME hazard: some older tools refuse outright
under a non-Latin layout, which at least tells you. This one fails silently.

**4. A locked screen blocks less than you think — and it is easy to conclude the wrong thing
twice.** Measured on macOS with the display asleep and `CGSSessionScreenIsLocked` true:

| Capability | Locked session |
|---|---|
| Keys delivered with `postToPid` — text and `Tab` | **works**, identically to awake |
| Focus movement through the tab order | **works** — a 30-stop walk completed |
| A spec asserting on DOM content and state | **passes** |
| `:focus-visible` semantics | **fails** — the outline falls back to the OS default ring |
| Coordinate-addressed clicks | **fail** — `loginwindow` holds the front |
| Screen capture | **fails** — returns a blank image |
| Video windows (`CVDisplayLink`) | **fail** — the backend stops without erroring |

The asymmetry has one cause: `postToPid` addresses the *process*, so it does not care who is
frontmost, while a click addresses a *screen coordinate* and therefore does. And `:focus-visible`
depends on the engine classifying the interaction as keyboard, which it will not do while the window
is not key — so keys arrive while focus *appearance* does not follow.

**Two conclusions were reached here before the right one, and both were reached without running
anything.** First: "display sleep is fine, only an explicit lock matters" — reasoned from the
session still being active. Second, after `pmset displaysleepnow` made the driver refuse: "a locked
session cannot be driven at all" — inferred from *the driver's own guard refusing*, which is not the
same as input failing. Only the third attempt bypassed the guard and actually typed.

**The design consequence:** apply a frontmost requirement to clicks, not to keys. A guard written for
one delivery mechanism quietly becomes a false constraint when the mechanism changes, and here it
was blocking precisely the unattended overnight case the suite was built for.

**Also worth knowing:** the screen locks the moment the display sleeps, whatever the screen-lock
*password* delay says. A machine set to 28,800 s still reported `CGSSessionScreenIsLocked = true`
immediately; that delay governs only whether a password is demanded on wake.

**5. A short-lived CLI helper reads stale system state.** Both "is this app active" and "who is
frontmost" are cached and refresh on the run loop. A helper process that activates an app, sleeps,
and then asks will be told the activation failed when it succeeded. **Service the run loop between
the action and the observation**, and poll rather than sleeping once.

**6. Coordinates go stale between one command and the next.** Windows move — between displays, and
after a dev-server reload. Header elements slide sideways as breadcrumbs grow. A click at a
remembered position lands on the wrong element, and every keystroke after it then measures the wrong
thing, which reads exactly like a dropped key. **Re-read the window bounds before every click**, and
confirm focus in a screenshot before believing a keyboard result.

Two more things worth knowing once you have it working:

**`document.body` is the tab-cycle boundary, not a tab stop.** Tabbing past the last focusable
element takes focus out of the document for exactly one press, and `document.activeElement` reads as
`body`. A walk that records every reading ends with a phantom stop that has no focus ring — because
nothing is focused — and reports it as an accessibility defect. Skip the boundary, and keep an
assertion that the walk found more than one real stop, so a channel that delivers nothing still
fails.

**Your test suite can damage the developer's running app.** Two shapes seen: a cleanup hook running
`pkill` by executable name, which matches the release build the developer has open; and a test that
signs out through the real control, deleting a keychain item the shipped app deliberately shares
with the test build. Both are correct in isolation and destructive together. If your suite does
either, say so in the guide — an app that appears to forget its login on its own is a bug report
filed against the wrong component.

## The loop (all desktop)

Same universal loop as SKILL.md, with desktop specifics:

1. **Launch the app** and wait until it's genuinely interactive (splash screens lie — wait for a known element, not a fixed sleep).
2. **Query the accessibility tree** (UIA / AppKit accessibility / Hammerspoon) to find real elements. With pixel-vision tools, take a screenshot and reason over it — but prefer element queries wherever the app exposes them.
3. **Walk the flow once**, confirming each element resolves before committing.
4. **Script the test** against element identifiers, not coordinates.
5. **Run, read real failures, stabilize.** Desktop timing is especially prone to "acted before the window was ready" — add explicit waits-for-element.

## Reality check

Native desktop automation is the least mature of the three platforms and the most environment-sensitive (OS version, permissions, DPI, app framework). Expect more setup friction and be honest with the user about it. If the app is even partly webview-based, steering toward the Playwright/Tauri path will save everyone a lot of pain. When you can't run something (no display in the sandbox, permissions not granted), say so and state exactly what's needed — don't fabricate a passing result.
