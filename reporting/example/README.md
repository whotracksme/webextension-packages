# reporting/example

Example extension that loads the reporting library. Two ways to run it.

## Build

```
npm --workspace=reporting run build
```

Produces `index.bundle.js`, `content.bundle.js`, and the offscreen
bundle. The scripted runner below requires these; karma does its own
bundling per-spec and does not need this step.

## Interactive (DevTools + live reload)

```
npm --workspace=reporting start
```

Runs `web-ext run -t chromium` with DevTools — useful for manual
exploration.

## Scripted runner with log capture

```
node reporting/example/run.mjs --url https://example.com --wait 10
```

What it does:

- Verifies `index.bundle.js` and `content.bundle.js` exist (exits with
  a message if `npm run build` is needed)
- Launches Chrome Canary via wdio with `--enable-unsafe-extension-debugging`
- Installs the unpacked extension via WebDriver BiDi `webExtension.install`
- Subscribes to BiDi `log.entryAdded` for page + content-script console
- Attaches puppeteer-core to chromedriver's debug port for service-worker
  console (BiDi doesn't currently forward SW console events)
- Writes all entries to `logs/run.log`
- Navigates to each `--url`, waits `--wait` seconds, uninstalls, exits

Flags:

- `--url <URL>` — can be repeated; visited in order
- `--wait <seconds>` — total time to keep the browser open (default `10`)
- `--headless` — run headless (extension registration may differ)
- `--log-file <path>` — override log output path
- `--keep-open` — don't auto-close; exposes the control server (below)
- `--port <n>` — control server port when `--keep-open` (default `7878`)
- `--browser-version <channel>` — `canary` (default), `dev`, `beta`,
  `stable`, or an explicit version

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
  Returns `409` if no SW is currently attached — MV3 service workers may
  have idled out; poke it first with a navigation.

### Why Chrome Canary

Two reasons stable Chrome doesn't work today:

1. Stable Chrome refuses `--load-extension` as a security hardening (the
   old web-ext path). BiDi `webExtension.install` sidesteps this.
2. Chromedriver's BiDi mapper in stable doesn't yet implement
   `webExtension.install` — it returns "Method not available". Canary
   (paired with the matching chromedriver wdio auto-fetches) does.

When `browserVersion` is `canary` and wdio doesn't find a local Canary
install, it downloads Chrome for Testing via `@puppeteer/browsers`.
