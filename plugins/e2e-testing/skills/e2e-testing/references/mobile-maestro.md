# Mobile (iOS & Android) — Maestro

Maestro is the recommended tool for agent-driven mobile E2E in 2026. Tests are human-readable YAML the agent generates and you can own without any SDK — a deliberate contrast to Appium's WebDriver scripts in Java/Python/JS. It drives iOS simulators and Android emulators locally; Maestro Cloud (paid) runs the same flows on hosted devices at scale. CLI and framework are open-source (Apache 2.0), free for local dev and CI.

Use Appium instead only if the team already has an Appium/Detox/XCUITest/Espresso suite and device farm you must fit into — see the bottom of this file.

## Table of contents
- [Setup](#setup)
- [Two ways to drive it](#two-ways-to-drive-it)
- [The authoring loop](#the-authoring-loop)
- [Writing a flow](#writing-a-flow)
- [Locators on mobile](#locators-on-mobile)
- [Running & CI](#running--ci)
- [A realistic expectation](#a-realistic-expectation)
- [Appium fallback](#appium-fallback)

## Setup

```bash
# Install Maestro
curl -Ls "https://get.maestro.mobile.dev" | bash

# iOS: boot a simulator (macOS only)
xcrun simctl boot "iPhone 15"
# Android: start an emulator
emulator -avd Pixel_7_API_34
```

Add the Maestro MCP server so the agent can drive the live device while authoring:

```bash
claude mcp add maestro -- maestro mcp
```

Maestro MCP works with Claude Code, Cursor, Copilot, Codex, Gemini CLI, and any MCP client.

## Two ways to drive it

- **Maestro MCP** — the agent boots the sim/emulator, taps around live, and captures the real view hierarchy while writing the flow. Use this for **authoring** and for debugging a failure interactively.
- **Maestro CLI** (`maestro test flow.yaml`) — runs a committed YAML flow deterministically. Use this in **CI** and for re-running the saved suite.

Author with MCP, commit the YAML, run the YAML with the CLI. Same split as web's MCP-vs-CLI.

## The authoring loop

1. **Boot the device and install the build.** A flow written against a device that isn't running is a guess.
2. **Launch the app and inspect the hierarchy.** Via MCP: navigate to the target screen, capture the view hierarchy, read the real element IDs/text. This is the anti-hallucination step.
3. **Tap through the flow once** live, confirming each step lands on the right element.
4. **Write the `.yaml` flow** using the identifiers you observed.
5. **Run it with the CLI**, watch it fail for real reasons, fix the wrong selector or missing wait, rerun.

## Writing a flow

Maestro YAML reads like plain English:

```yaml
appId: vn.kafi.trade
---
- launchApp
- tapOn: "Đăng nhập"
- tapOn:
    id: "username_field"
- inputText: "test@kafi.vn"
- tapOn:
    id: "password_field"
- inputText: "${MAESTRO_PASSWORD}"     # from env, never hardcoded
- tapOn: "Tiếp tục"
# Outcome assertion — the account dashboard actually loaded
- assertVisible: "Số dư khả dụng"
- assertVisible:
    id: "account_balance"
```

Key commands: `launchApp`, `tapOn`, `inputText`, `assertVisible`, `assertNotVisible`, `scroll`, `swipe`, `waitForAnimationToEnd`, `runFlow` (compose sub-flows for reuse — Maestro's answer to the Page Object Model).

Compose shared journeys so you don't repeat login in every flow:

```yaml
# login.yaml — reused via `runFlow: login.yaml`
```

## Locators on mobile

Same priority as everywhere (see SKILL.md), mapped to mobile:

1. **Accessibility ID** — `accessibilityIdentifier` (iOS), `testTag` (Compose), `resource-id` (Android). Most stable; ask devs to add them to key elements.
2. **Visible text** — convenient, but breaks under i18n. Your app is Vietnamese-first with English technical terms, so pin down which language the build renders and match it exactly (`"Đăng nhập"` vs `"Login"`).
3. **Index / position** — last resort, brittle.

The same YAML flow runs on both iOS and Android when the identifiers match — one flow, two platforms. In CI, split into two parallel jobs for speed.

## Running & CI

```bash
maestro test flows/login.yaml
maestro test flows/                      # whole suite
maestro test --format junit flows/       # JUnit XML for CI tracking
```

For CI, run one job per platform (iOS sim on macOS runners, Android emulator on Linux). Capture screenshots and the view hierarchy on failure — those artifacts are what make a failed run diagnosable instead of mysterious.

## A realistic expectation

First-generation Maestro flows from an agent are ~70–80% correct: syntactically valid YAML, but occasionally the wrong element identifier or a missing wait condition. The right workflow is: let the agent draft, validate with one real run, fix, then commit and hand ongoing maintenance to the agent. Don't present an un-run flow as passing.

## Appium fallback

If the project already standardizes on Appium, use the Appium MCP server:

```bash
claude mcp add appium-mcp -- npx -y appium-mcp@latest
# set ANDROID_HOME in the env for Android
```

It gives the agent natural-language mobile control, intelligent locator generation, and test authoring for both platforms, and bundles the UiAutomator2 (Android) and XCUITest (iOS) drivers for local sessions. Output is WebDriver-style scripts rather than YAML — heavier to own by hand, but the right choice when it matches the team's existing stack, CI, and device farm (AWS Device Farm, BrowserStack, etc.). Detox is the analogous choice for React Native shops.
