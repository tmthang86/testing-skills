# Changelog

## 0.1.0 — unreleased

Initial draft of both skills.

### e2e-testing
- Platform router: web/Electron/Tauri → Playwright, iOS/Android → Maestro,
  native desktop → OS accessibility drivers
- Playwright CLI+Skill vs MCP guidance, Page Object Model, auth via storage
  state, flake triage, CI wiring
- Maestro-first mobile guidance with Appium fallback
- Explicit handoff boundary to design-conformance-testing

### design-conformance-testing
- Source-of-truth routing that prefers repo-committed artifacts (tokens, HTML
  mockups, markdown specs) over Figma
- Four layers: token conformance, DOM-to-DOM mockup comparison, spec & flow
  coverage, visual regression baselines; plus accessibility
- `compare-design.mjs`: multi-viewport comparator with six layout invariants,
  breakpoint boundary probing, and layout-responsiveness detection
- Responsive guidance: comparison needs a per-viewport reference, invariants
  don't

### Repo
- Marketplace + two plugin manifests
- `validate-repo.mjs` for frontmatter, cross-references, manifest consistency
- Fixture pair with five documented faults + integration test asserting on
  specific findings
- CI running validate → unit → integration on every push

### Known gaps
- Comparator has never run against a real application
- Neither skill has been evaluated for triggering accuracy or output quality
