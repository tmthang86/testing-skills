# testing-skills

Two Claude Code agent skills for UI testing, plus the tooling to keep them honest.

| Skill | Answers | Platforms |
|---|---|---|
| **e2e-testing** | *Does the flow work?* | Web, Electron/Tauri, native desktop, iOS/Android |
| **design-conformance-testing** | *Does it match the design?* | Web (full), Electron/Tauri (full), mobile & desktop (partial) |

They're deliberately separate. Functional regressions and design drift are
different failure modes with different tooling and different review cadences —
when both turn the same suite red, people stop reading the failures.

## Install

**As a marketplace** (recommended — versioned, updatable):

```bash
/plugin marketplace add tmthang86/testing-skills
/plugin install e2e-testing@testing-skills
/plugin install design-conformance-testing@testing-skills
```

**Locally, for development:**

```bash
git clone https://github.com/tmthang86/testing-skills && cd testing-skills
/plugin marketplace add ./
/plugin install design-conformance-testing@testing-skills
```

**Or just copy the skill folders** if you don't want the plugin machinery:

```bash
cp -r plugins/*/skills/* .claude/skills/
```

To make the marketplace available to your whole team automatically, add it to
the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "testing-skills": {
      "source": { "source": "github", "repo": "tmthang86/testing-skills" }
    }
  },
  "enabledPlugins": {
    "e2e-testing@testing-skills": true,
    "design-conformance-testing@testing-skills": true
  }
}
```

## What's inside

```
.claude-plugin/marketplace.json     catalog
plugins/
  e2e-testing/
    skills/e2e-testing/
      SKILL.md                      platform router + universal loop
      references/
        false-greens.md             how a suite passes while proving nothing — measured cases
        web-playwright.md           Playwright CLI+Skill vs MCP, POM, auth, flake, CI
        mobile-maestro.md           Maestro (primary), Appium fallback
        desktop.md                  Electron/Tauri, Hammerspoon, Windows UIA, computer use,
                                    the WKWebView keyboard boundary, native input drivers
  design-conformance-testing/
    skills/design-conformance-testing/
      SKILL.md                      source-of-truth routing + the four layers
      references/
        layers.md                   tokens, mockup DOM-diff, spec/flow, visual, a11y, Figma
        responsive.md               viewport selection, breakpoint probes, invariants
        platforms.md                what survives on mobile/desktop
      scripts/compare-design.mjs    multi-viewport comparator + layout invariants
examples/
  responsive.json                   sample sweep config
  fixtures/{mockup,impl}.html       known-faulty pair used by the integration test
scripts/
  validate-repo.mjs                 frontmatter, cross-references, manifests
  integration-test.mjs              exercises the real browser path
```

## Development

```bash
npm run setup       # install deps + Chromium
npm test            # validate + unit + integration
```

Individually:

| Command | Checks | Needs a browser |
|---|---|---|
| `npm run validate` | Skill frontmatter, that every referenced file exists, manifest consistency | No |
| `npm run test:unit` | The comparator's pure logic — normalization, diffing, invariants, report assembly | No |
| `npm run test:integration` | The real browser path against fixtures with known faults | Yes |

Also worth running before you push:

```bash
claude plugin validate .
```

### Why the comparator is split the way it is

`compare-design.mjs` deliberately separates browser extraction from pure
comparison logic. The pure half — colour normalization, tolerance handling,
severity assignment, invariant rules — is where the subtle bugs live, and
keeping it browser-free means it's testable in a second with no Chromium
download. Extraction stays thin on purpose.

### The fixtures

`examples/fixtures/impl.html` carries five documented, deliberate faults against
`mockup.html`: a padding drift, a radius drift, a colour drift, a fixed-width
element that overflows at mobile, and an undersized touch target. That gives the
integration test known-correct expectations, so it can assert on *specific*
findings rather than just "the script ran" — a comparator that reported
everything, or nothing, would still pass a smoke test.

## Status

Honest state, so nobody trusts more than is warranted:

| | Status |
|---|---|
| Skill content | Drafted, reviewed, structurally valid |
| `false-greens.md` and the desktop native-input material | **Measured**, on one real Tauri app over about a week — not researched. Every case in them was observed, and the numbers are the observed ones |
| Comparator pure logic | **Verified** — 33 self-tests |
| Comparator browser path | Written; verified by CI on every push, not yet exercised against a real app |
| Skill triggering accuracy | **Not measured** |
| Skill output quality | **Not measured** |

Nothing here has been proven against a production UI yet. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next and the design decisions
worth preserving through refactors.

## License

MIT
