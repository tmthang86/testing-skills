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

## The loop (all desktop)

Same universal loop as SKILL.md, with desktop specifics:

1. **Launch the app** and wait until it's genuinely interactive (splash screens lie — wait for a known element, not a fixed sleep).
2. **Query the accessibility tree** (UIA / AppKit accessibility / Hammerspoon) to find real elements. With pixel-vision tools, take a screenshot and reason over it — but prefer element queries wherever the app exposes them.
3. **Walk the flow once**, confirming each element resolves before committing.
4. **Script the test** against element identifiers, not coordinates.
5. **Run, read real failures, stabilize.** Desktop timing is especially prone to "acted before the window was ready" — add explicit waits-for-element.

## Reality check

Native desktop automation is the least mature of the three platforms and the most environment-sensitive (OS version, permissions, DPI, app framework). Expect more setup friction and be honest with the user about it. If the app is even partly webview-based, steering toward the Playwright/Tauri path will save everyone a lot of pain. When you can't run something (no display in the sandbox, permissions not granted), say so and state exactly what's needed — don't fabricate a passing result.
