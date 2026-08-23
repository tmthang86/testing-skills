# Web, Electron & Tauri — Playwright

Playwright is the recommended engine for anything that renders in a browser or a webview (Electron, Tauri). It works cross-browser (Chromium, Firefox, WebKit), drives the page through the accessibility tree (no vision model needed), and produces tests a team can own.

## Table of contents
- [Two ways to drive it](#two-ways-to-drive-it) — CLI+Skill vs MCP
- [Setup: CLI + Skill (default)](#setup-cli--skill-default)
- [Setup: MCP (exploratory)](#setup-mcp-exploratory)
- [The authoring loop](#the-authoring-loop)
- [Writing the committed test](#writing-the-committed-test)
- [Authentication / logged-in state](#authentication--logged-in-state)
- [Electron apps](#electron-apps)
- [Tauri apps](#tauri-apps)
- [Flaky tests & debugging](#flaky-tests--debugging)
- [CI](#ci)

## Two ways to drive it

Both are from Microsoft and use the same underlying Playwright.

- **`@playwright/cli` + Skill** — token-efficient shell commands; snapshots go to disk, not context. **Default for durable suites and CI.** Microsoft explicitly recommends CLI+Skills over MCP for coding agents balancing browser work against a large codebase.
- **`@playwright/mcp`** — persistent session, ~34 tools, rich page introspection. Better for live exploration of an unfamiliar UI or self-healing loops.

Pick per the guidance in SKILL.md Step 2. When in doubt, CLI+Skill.

## Setup: CLI + Skill (default)

```bash
# Install the CLI globally (or pin per-project and commit it)
npm install -g @playwright/cli@latest
playwright-cli --help          # the agent reads available commands from here

# Install the skill docs locally so the agent has reference material
npx -y skills add microsoft/playwright --agent claude-code
```

Core commands the agent uses (names may vary slightly by version — always check `--help`):

```bash
playwright-cli open --headed          # start a visible Chromium session
playwright-cli goto https://localhost:3000
playwright-cli snapshot               # capture accessibility tree -> disk; read it to find refs
playwright-cli click e5               # click element by ref from the snapshot
playwright-cli fill e3 "test@kafi.vn" # fill input by ref
playwright-cli screenshot out.png     # visual capture for debugging
```

The `eN` refs come from the snapshot. **Always `snapshot` before you `click`/`fill`** — that's how you get real, current refs instead of guessing.

## Setup: MCP (exploratory)

```bash
claude mcp add playwright npx @playwright/mcp@latest
```

On Windows, Claude Code defaults to git-bash; if `npx` misbehaves, wrap it: `cmd /c npx -y @playwright/mcp@latest`. To keep a logged-in profile, add `--user-data-dir=./playwright-profile` to the args. The first time, say "use playwright mcp" explicitly so the agent doesn't shell out to raw Playwright instead.

Once connected, drive in plain language: "Open localhost:5173/login, sign in with the test user, verify the dashboard lists the four most recent runs." The agent calls `browser_navigate`, `browser_snapshot`, `browser_fill`, `browser_click`, then `browser_snapshot` again to read the result back.

## The authoring loop

1. **Start the app.** `npm run dev` (or target the deployed URL). Confirm it's actually up.
2. **Navigate + snapshot the target screen.** Read the snapshot to learn the real roles/labels/testids present.
3. **Walk the flow once** via CLI/MCP commands, checking each step's result before moving on.
4. **Generate the `.spec.ts`** using the refs you actually observed, with resilient locators.
5. **Run it** with the standard Playwright test runner, read real failures, fix, rerun.

## Writing the committed test

Prefer accessibility-first queries and the Page Object Model for anything non-trivial. Assert outcomes, not mechanics.

```ts
import { test, expect } from '@playwright/test';

test('places an order and it appears in Account Manager', async ({ page }) => {
  await page.goto('/trade');
  await page.getByRole('textbox', { name: 'Symbol' }).fill('VN30F2601');
  await page.getByRole('spinbutton', { name: 'Quantity' }).fill('1');
  await page.getByRole('button', { name: 'Place order' }).click();

  // Outcome assertion — the order actually shows up, with the right ID
  const row = page.getByRole('row', { name: /VN30F2601/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell', { name: /Filled|Pending/ })).toBeVisible();
});
```

Page Object Model keeps selectors in one place so a UI change is a one-line fix:

```ts
// pages/TradePage.ts
export class TradePage {
  constructor(private page: import('@playwright/test').Page) {}
  symbol = () => this.page.getByRole('textbox', { name: 'Symbol' });
  quantity = () => this.page.getByRole('spinbutton', { name: 'Quantity' });
  placeOrder = () => this.page.getByRole('button', { name: 'Place order' });
}
```

Use `data-testid` when a role/name isn't reliable (dynamic content, icon-only buttons). If the app lacks test IDs on key elements, adding them is usually the right fix — cheaper than fighting fragile CSS selectors forever.

## Authentication / logged-in state

Re-running login on every test is slow and flaky. Generate a storage-state file once, reuse it everywhere.

```ts
// global-setup: log in once, save cookies + localStorage
await page.context().storageState({ path: 'auth.json' });
```

```ts
// playwright.config.ts
use: { storageState: 'auth.json' }
```

With MCP, pass `--storage-state auth.json` in the server args so every session starts authenticated. Never hardcode real credentials in a committed test — read them from env vars.

## Electron apps

Playwright launches Electron directly — no browser install needed. Point it at the built main entry:

```ts
import { _electron as electron } from 'playwright';
const app = await electron.launch({ args: ['dist/main.js'] });
const window = await app.firstWindow();
await window.getByRole('button', { name: 'Connect' }).click();
```

From there it's the same accessibility-tree API as web. This covers most "desktop" apps that are actually web under the hood.

## Tauri apps

Tauri isn't Electron — the webview is native. Use `tauri-driver` (WebDriver protocol) instead of Playwright's Electron launcher:

```bash
cargo install tauri-driver
```

Then drive it with a WebDriver client (or the `mcp-tauri-automation` MCP server, which wraps `tauri-driver` for natural-language control: "click the submit button and check the result", plus instant screenshots for visual debugging). Read `desktop.md` if the Tauri app also has native OS chrome you need to test.

## Flaky tests & debugging

- **Trace Viewer** is the primary tool: run with `--trace on`, then `npx playwright show-trace trace.zip` to see a timeline of every action, network call, and DOM snapshot. Most "flaky" tests are a missing wait or a race, and the trace shows exactly where.
- Replace hard `waitForTimeout` sleeps with web-first assertions (`expect(...).toBeVisible()`) that auto-retry.
- Mock unstable upstreams (`page.route(...)`) so a slow third-party API doesn't make your UI test red.
- Run with `--repeat-each=10` to smoke out intermittency before you trust a fix.

## CI

- Run headless: the MCP server and CLI both run headless in CI unpromoted.
- Emit JUnit XML via the `reporter` setting in `playwright.config.ts` so failures become tracked artifacts, not a folder of scripts.
- Shard across workers for speed (`--shard=1/4`).
- Do **not** auto-open a defect/PR on every failure — gate any automated defect creation behind a human confirmation step, or you get noise instead of signal.
