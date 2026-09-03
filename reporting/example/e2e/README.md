# reporting/example/e2e

End-to-end harness for `UrlReporter` (page & search reporting) that drives a
real, un-automated Chrome.

## Why it is built this way

Search engines fingerprint WebDriver and CDP, so the browser cannot be driven
from the outside. Control is inverted instead: **the extension dials out** to a
local hub over a WebSocket, and everything else talks to the hub over plain
HTTP.

```
Claude Code / shell  --curl-->  hub (127.0.0.1:7878)  <--WebSocket-->  example extension
                                      |                                       |
                              out/messages.jsonl                      chrome.tabs.create(...)
```

Consequences worth knowing:

- Navigation happens through `chrome.tabs`, which is what a user clicking a
  link produces. No `navigator.webdriver`, no `--enable-automation`, no
  debugger attached.
- Nothing injects synthetic keyboard or mouse events. Those carry
  `isTrusted: false` and are a *stronger* bot signal than a plain navigation.
  If a scenario genuinely needs human-like interaction, drive that part with
  the Claude in Chrome extension and leave the rest to the hub.
- The WebSocket keeps the MV3 service worker alive between steps, so commands
  do not have to wake it first.

`../run.mjs` (webdriverio + puppeteer) still exists for log capture on sites
that do not care about automation. Do not point it at a search engine.

## Setup (once)

```
npm ci                                     # repo root, if you have not already
npm --workspace=reporting run build
npm --workspace=reporting run e2e.launch
```

`e2e.launch` opens a dedicated `WTM-E2E` profile in your regular Chrome and
prints the one-time steps: `chrome://extensions` → Developer mode → Load
unpacked → `reporting/example`. The extension stays loaded in that profile
afterwards.

The profile is deliberately persistent: a brand new one has no cookies or
history, which is itself a mild bot signal. Let it age normally.

## Running

```
npm --workspace=reporting run e2e.hub          # terminal 1, keep running
npm --workspace=reporting run e2e -- smoke     # terminal 2
```

Scenarios live in `scenarios/*.json`.

| Scenario | What it proves |
| --- | --- |
| `smoke` | Hub ↔ extension wiring, and one public page reaching a `wtm.page` message |
| `privacy-guards` | A private-host URL is dropped, and denying quorum suppresses page messages |

Exit code is `0` only when every step ran and every expectation held.

### After changing `src/`

```
npm --workspace=reporting run build
```

…then **reload the extension** at `chrome://extensions`. The service worker
runs the bundle, so a rebuild alone changes nothing — this is the most common
reason a fix appears to have no effect.

### Flags

Everything after `--` is passed through by npm:

```
npm --workspace=reporting run e2e -- smoke --json
```

| Script | Flag | Default | Purpose |
| --- | --- | --- | --- |
| `e2e` | `<scenario>` | `smoke` | Name, or a path to a JSON file |
| | `--json` | off | Full capture + step trace instead of the summary |
| | `--keep-messages` | off | Do not clear captures first — accumulate across runs |
| | `--hub <url>` | `http://127.0.0.1:7878` | Where the hub is |
| | `--patterns <file>` | off | Replace the served patterns with a local file for this run (re-applied after every `reset`) |
| `e2e.hub` | `--port <n>` | `7878` | See the caveat below |
| | `--out-dir <path>` | `example/e2e/out` | Where captures are written |
| | `--quiet` | off | Suppress per-message logging |
| `e2e.launch` | `--profile <name>` | `WTM-E2E` | Chrome profile directory |
| | `--chrome <path>` | auto-detected | Explicit Chrome binary |

> **`--port` caveat.** The extension's hub URL is baked into the bundle
> (`example/index.js`), so changing the hub port also needs that constant
> changed and a rebuild. Only useful if `7878` is already taken.

## Talking to the hub directly

```
curl -s 127.0.0.1:7878/health
curl -s 127.0.0.1:7878/cmd -H 'content-type: application/json' -d '{"name":"flush"}'
curl -s '127.0.0.1:7878/messages?action=wtm.page'
curl -s '127.0.0.1:7878/events?since=0'
curl -s '127.0.0.1:7878/logs?tail=50'
```

Everything is appended to `out/messages.jsonl`, `out/events.jsonl` and
`out/console.log`.

### Routes

| Route | Purpose |
| --- | --- |
| `GET /health` | Is the extension connected, and the current `seq` |
| `POST /cmd {name, args?, timeout?}` | Run a command, wait for its result |
| `GET /messages?since=&action=` | Captured messages, filtered |
| `POST /messages/clear` | Drop captures and truncate the JSONL files |
| `GET /events?since=` | Job lifecycle events |
| `GET /logs?tail=` | Service worker console |
| `GET /pages/<name>` | Negative-fixture HTML pages from `pages/` |
| `POST /shutdown` | Stop the hub |

### Commands

| Command | Purpose |
| --- | --- |
| `navigate {url, tabId?, newTab?, waitForLoad?, timeoutInMs?, settleInMs?}` | Open a URL in a tab |
| `flush {maxRounds?, settleInMs?, forceExpiration?}` | Force everything through to messages — see below |
| `processPendingJobs` / `expirePages` | The individual halves of `flush` |
| `state` / `dumpJobs` / `selfChecks` | Inspect without guessing |
| `reset` | Clear storage and **restart the worker** — a true fresh install (see note) |
| `reload` | Restart the worker without clearing storage; picks up a rebuilt bundle |
| `setQuorum {mode}` | `always` or `never` |
| `setPatterns {rules}` | Replace the served patterns for this session (persisted; the next poll is pushed out by a full interval) |
| `closeTabs {urlContains?}` | Tidy between scenarios |
| `ping` | Liveness check |

### `reset` restarts the worker

`reset` clears `chrome.storage.local` and then calls `chrome.runtime.reload()`
rather than `unload()` + `init()`. That is not a stylistic choice: `Pages#init`
guards its whole setup with `if (!this._ready)` and installs the
`chrome.tabs`/`webNavigation` listeners *inside* that guard
(`src/pages.js:411`), so a second `init()` leaves `isActive === true` with no
listeners attached and nothing is ever tracked again. `Pages` is effectively
one-shot; a worker restart is also a more faithful fresh install.

Resetting matters for correctness, not just tidiness: `PersistedHashes`
deduplicates messages, so re-running a scenario without a reset silently drops
every message it already sent.

The hub waits for the worker to reconnect before the next step runs, so
scenarios do not need to sleep after a `reset`.

### `flush`

The reporter is built to spread work out over time: pages wait an hour in
`PageDB` before they expire, jobs get randomized `readyIn` delays, and
`doublefetch-page` has a per-type cooldown. `flush` collapses all of that —
it force-expires pages and drains the job queue in a loop until nothing is
pending, then reports how many rounds it took.

If a message you expected never arrives, check `/events` before anything else.
`jobRejected`, `jobFailed` and `jobExpired` distinguish "never scheduled" from
"rejected by a privacy check" from "doublefetch failed", which is otherwise
indistinguishable from the outside.

## Behaviour worth knowing before writing scenarios

- **Search result pages never produce a `wtm.page`.** The log says
  `Mark page as private ... reason: "ignore search engine result pages"`.
  Do not go looking for one.
- **Tabs already open before the worker started never produce page messages.**
  They are dropped with `incomplete information: preDoublefetch missing`,
  because page structure is injected on navigation. Always `closeTabs` and
  navigate within the scenario rather than relying on whatever the browser had
  open.
- **Whether any given engine returns extractable content to an anonymous
  refetch is a property of that engine and your network, not of the harness.**
  A scenario that stops passing has not necessarily regressed — check
  `/events` for `jobFailed` before assuming a code change broke it.

## Writing scenarios

```json
{
  "name": "my-scenario",
  "steps": [
    { "reset": {} },
    { "navigate": { "url": "https://example.com/" } },
    { "flush": {} }
  ],
  "expect": {
    "messages": { "wtm.page": [{ "url": "~example.com" }] },
    "mustNotAppear": ["some-secret"],
    "forbiddenActions": []
  }
}
```

- A step's command is its one non-reserved key. `timeout` (ms, per step) and
  `continueOnError` (keep going after a failed step) are reserved and may sit
  alongside it:
  `{ "navigate": { "url": "..." }, "timeout": 90000, "continueOnError": true }`
- In `expect.messages`, `~foo` means "contains", a plain string means equality,
  and dotted keys (`qr.q`) walk into the payload.
- Action keys match by **prefix**, so a primary action also accepts a fallback
  whose name extends it. Prefix `=` for an exact match when that matters.
- `mustNotAppear` is scanned across every string **and every object key** in
  every captured message. This is the assertion that matters most: it is the
  only one that fails when a privacy guard regresses.
- `forbiddenActions` asserts an action was never sent at all.
- Payload shape is checked on every run whether or not the scenario asks —
  `REQUIRED_FIELDS` in `verify.mjs` lists the fields each action must carry.
  A `[shape]` failure comes from there, not from the scenario.

Pages under `pages/` are served from `127.0.0.1:7878`, which `sanitizeUrl`
must reject on two independent grounds (private hostname, uncommon port). That
makes them a dependable negative fixture.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| `hub is up but the extension has not connected` | Is the extension enabled in the `WTM-E2E` profile? Reload it at `chrome://extensions` — the worker connects on startup |
| Connected, but a command times out | `GET /logs?tail=100` for the worker console; an exception in `init()` leaves commands registered but the reporter inactive |
| A `wtm.page` never arrives | `GET /events` — `jobRejected` means a privacy check dropped it, `jobFailed` on `doublefetch-page` means the anonymous refetch failed, no event at all means the page never entered `PageDB` |
| `flush` returns `drained: false` | Raise `maxRounds`; check `dumpJobs` for a job stuck in `retryable` |
| A code change had no effect | Rebuild **and** reload the extension |
| Got a fallback action instead of the primary one | Extraction found less than the pattern expected — the selectors may have drifted, or the page was not the expected shape |

## Testing the harness itself

`mock-extension.mjs` speaks the same protocol without a browser, so the hub,
runner and verifier can be checked in isolation:

```
node example/e2e/hub.mjs --quiet &
node example/e2e/mock-extension.mjs &
node example/e2e/run.mjs smoke              # expect PASSED
node example/e2e/run.mjs privacy-guards     # expect PASSED

pkill -f mock-extension.mjs                 # only one may be connected
node example/e2e/mock-extension.mjs --leak & # emits a page it should not
node example/e2e/run.mjs privacy-guards     # expect FAILED
```

The last two lines are the important ones: they prove the leak assertions
actually fire. A verifier that never fails is indistinguishable from one that
has nothing to check.

## Known gaps

- **Quorum is stubbed.** The example has no hpnv2 transport, so
  `sendInstant` returns a canned verdict. Runs exercise message construction
  and the quorum *gate*, not the quorum protocol.
- **Doublefetch hits the live web.** Search engines may answer a cookieless
  fetch with a consent wall or a 429. That is a real signal, not a harness
  bug — look for `jobFailed` on `doublefetch-query` in `/events`.
- **`CountryProvider` calls the live config endpoint**, so `ctry` depends on
  network and on `ALLOWED_COUNTRY_CODES`.
