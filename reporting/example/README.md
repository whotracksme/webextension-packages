# reporting/example

Scripted extension runner with log capture. For the interactive
`web-ext run` loop, see the package-level `../README.md`.

## Usage

```
node reporting/example/run.mjs --url https://example.com --wait 10
```

Requires built bundles — run `npm --workspace=reporting run build` first.

What it does:

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

## Control server (`--keep-open`)

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

## Verifying request attribution end-to-end

The request reporter emits two kinds of line you can grep out of
`logs/run.log`:

- `[attrib] <type> <url> doc=<documentId> -> <pageUrl>` — one per
  `onBeforeRequest`, showing which page each request resolved to. Driven
  by a `logger.debug` in `RequestReporter.onBeforeRequest`; requires
  `setLogLevel('debug')` (the example sets it).
- `[tp_events] {...}` — each `wtm.attrack.tp_events` message, printed
  by the example's `onMessageReady`. Fires ~15s after a document
  leaves its tab (the `HOLD_MS` in `document-store.js`).

Typical session:

```
# terminal A
npm --workspace=reporting run build
node reporting/example/run.mjs --keep-open

# terminal B
curl -sX POST http://127.0.0.1:7878/navigate -H 'content-type: application/json' \
  -d '{"url":"https://www.aarp.org/"}'
sleep 12
curl -sX POST http://127.0.0.1:7878/navigate -H 'content-type: application/json' \
  -d '{"url":"https://www.ghostery.com/"}'
sleep 20          # stage delay + headroom

# inspect reports
curl -s 'http://127.0.0.1:7878/logs/tail?lines=30000' \
  | jq -r '.lines[]' | grep '\[tp_events\]' | sed 's/.*\[tp_events\] //' \
  | jq -c '{host: .payload.data[0].hostname, tps: (.payload.data[0].tps | keys | length)}'
```

Things to check:

- **Late beacons land on the source document.** Filter `[attrib]` lines
  timestamped *after* the ghostery nav, resolved to an aarp URL — that
  is the `#evicted` map working. E.g. a `ping` to
  `aarpprivacy.my.onetrust.com/request/v1/consentreceipts` arriving a
  few milliseconds after navigating away should still attribute to
  `https://www.aarp.org`.
- **No cross-page leaks.** Group `[attrib]` by request-host → page-host
  (`gawk`-friendly). The only legitimate cross-host line you should see
  is the *main-frame* request for the new page (`main_frame
  https://www.next/ -> https://www.prev/`), because main-frame requests
  fire before `onCommitted` and fall back to the current tab's page so
  `oAuthDetector.checkMainFrames` can still run. Those requests are
  filtered out of reporting by the `!state.isMainFrame` pipeline guard
  before any stats accumulate.
- **Reports only fire when there is something to report.** Pages whose
  `tps` is empty (e.g. `ghostery.com`, which only loads its own
  first-party assets) are suppressed in `#reportPage` — expected.

## Why Chrome Canary

Two reasons stable Chrome doesn't work today:

1. Stable Chrome refuses `--load-extension` as a security hardening (the
   old web-ext path). BiDi `webExtension.install` sidesteps this.
2. Chromedriver's BiDi mapper in stable doesn't yet implement
   `webExtension.install` — it returns "Method not available". Canary
   (paired with the matching chromedriver wdio auto-fetches) does.

When `browserVersion` is `canary` and wdio doesn't find a local Canary
install, it downloads Chrome for Testing via `@puppeteer/browsers`.
