# whotracksme/webextension-packages

Monorepo with two npm workspaces: `reporting/` and `communication/`. Most
work happens in `reporting/`, and within that, in `src/request/` and
`test/request/`.

All commands below are run from the repo root unless noted.

## Build

```
npm --workspace=reporting run build
```

Runs rollup and produces `reporting/example/index.bundle.js`,
`reporting/example/content.bundle.js`, and the offscreen bundle. The example
extension loads these directly — karma does its own bundling per-spec and does
not need this step.

## Tests — two suites

The `test/` tree mixes two suites distinguished by filename:

### Node (mocha, sinon-chrome) — fast, preferred for request-pipeline work
- Pattern: `*.test.js`
- Setup: `reporting/test/setup.unit.js`
- All: `npm --workspace=reporting run test.unit`
- Request subset: `npm --workspace=reporting run test.unit.request`
- Watch: `npm --workspace=reporting run test.unit.watch`

### Browser (karma, headless Chrome) — covers DOM/CSSOM paths
- Pattern: `*.spec.js`
- Setup: `reporting/test/setup.js`
- Entry bundles: `reporting/test/index.js` (full) or `reporting/test/request.js` (subset)
- All: `npm --workspace=reporting run test`
- Request subset: `npm --workspace=reporting run test.karma.request`
  (sets `KARMA_TEST_ENTRY=test/request.js`)

When iterating on request code, run the node subset — it's seconds vs. minutes.

### Re-recording snapshots

`test/request/index.test.js` has a `snapshots` block that replays recorded
event streams (under `reporting/snapshots/`) and asserts the emitted
telemetry matches `snapshot.json`. When a source change legitimately shifts
the output:

```
npm --workspace=reporting run test.unit.request.record
```

This sets `RECORD_SNAPSHOT=1` so the block overwrites expectations instead
of asserting. Inspect `git diff reporting/snapshots/`, sanity-check, and
commit the snapshots alongside the source change. The record step is
idempotent — re-running produces byte-identical files.

See `reporting/scenarios/README.md` for the index of scenarios + snapshots
and what each covers.

## Example extension with webdriver control

For automated browsing with the extension loaded and the SW/page/content
console captured to a log file:

```
node reporting/example/run.mjs --url https://example.com --wait 10
```

What it does:
- Verifies bundles exist (exits with a message if `npm run build` is needed)
- Launches Chrome Canary via wdio with `--enable-unsafe-extension-debugging`
- Installs the unpacked extension via WebDriver BiDi `webExtension.install`
- Subscribes to BiDi `log.entryAdded` for page + content-script console output
- Attaches puppeteer-core to chromedriver's debug port for service-worker
  console (BiDi doesn't currently forward SW console events)
- Writes all entries to `reporting/example/logs/run.log`
- Navigates to each `--url`, waits `--wait` seconds, uninstalls, exits

Flags:
- `--url <URL>` — can be repeated; visited in order
- `--wait <seconds>` — total time to keep the browser open (default `10`)
- `--headless` — run headless (extension registration may differ)
- `--log-file <path>` — override log output path
- `--keep-open` — don't auto-close; exposes the control server (below)
- `--port <n>` — control server port when `--keep-open` (default `7878`)
- `--browser-version <channel>` — `canary` (default), `dev`, `beta`, `stable`,
  or an explicit version

### Control server (with `--keep-open`)

Drive a long-lived runner without restarting the browser between steps:

```
POST /navigate       {"url": "https://..."}         → {url, title}
POST /eval           {"code": "return ...", "target": "page"}  → {result}
POST /eval           {"code": "chrome.runtime.id", "target": "sw"}  → {result}
POST /shutdown                                       → {ok: true}, exits
GET  /state                                          → {extensionId, tabs, sw}
GET  /logs/tail?lines=N                              → {lines: [...]}
```

- `/eval` page target: `code` is a function body; write `return <expr>`.
- `/eval` sw target: `code` is an expression evaluated in the SW realm
  (e.g. `"chrome.runtime.id"`, `"await chrome.storage.local.get(null)"`).
  Returns `409` if no SW is currently attached (MV3 SW may have idled out —
  poke it first with a navigation or message).

### Why Chrome Canary

Two reasons stable Chrome doesn't work today:
1. Stable Chrome refuses `--load-extension` as a security hardening (the
   old web-ext path). BiDi `webExtension.install` sidesteps this.
2. Chromedriver's BiDi mapper in stable doesn't yet implement
   `webExtension.install` — it returns "Method not available". Canary
   (paired with the matching chromedriver wdio auto-fetches) does.

When `browserVersion` is `canary` and wdio doesn't find a local Canary
install, it downloads Chrome for Testing via `@puppeteer/browsers`. On a
dev machine with Canary already installed, wdio uses that.

### Interactive human use

For DevTools + reload-on-change, use the existing script:

```
npm --workspace=reporting start
```

This runs `web-ext run -t chromium` with no automation control — useful for
manual exploration, not for Claude-driven flows.

## Conventions

- No `Co-Authored-By` lines; no Claude/AI mentions in commits or PR bodies
- Prefer editing existing files over creating new ones
- When fixing request-pipeline bugs, check whether a `reporting/scenarios/`
  snapshot reproduces it before writing new fixtures
- The two test suites test different things; don't assume a `.spec.js` and
  `.test.js` with the same name cover the same code
