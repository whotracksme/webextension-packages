# Request reporter e2e tests

Loads the example extension into a real browser and runs it against a self-hosted fixture site that simulates tracking. Local-only, not for CI.

## Setup

```
npm run build
```

For Safari only, add to `/etc/hosts`:

```
127.0.0.1   site.test tracker.test analytics.test
```

(Chrome resolves these in-process via `--host-resolver-rules`.)

## Running

```
npm run test.e2e                  # Chrome Canary (default)
HEADLESS=1 npm run test.e2e       # Chrome Canary, no visible window
BROWSER=safari npm run test.e2e   # Safari
```

`CHROME_CHANNEL=beta` or a specific version overrides the default. Stable Chrome's chromedriver doesn't expose the BiDi `webExtension.install` command, so the default is Canary. `HEADLESS=1` only applies to Chrome.

## Safari one-time setup

```
safaridriver --enable
```

Enable Safari → Develop → "Allow Unsigned Web Extensions".

Each Safari WebDriver session installs the extension fresh and unsigned, so Safari prompts *"The extension would like to access site.test"* on every run. **You must:**

1. Tick the **"Remember for other websites"** checkbox (Safari may default it to off).
2. Click **Always Allow**.

If "Remember for other websites" is unchecked, only `site.test` is granted — the extension won't see the requests to `tracker.test` / `analytics.test` and `tp_events` will be empty. AppleScript-based auto-dismissal isn't viable: any external click on a WebDriver-controlled Safari window trips Safari's *"This Safari window is remotely controlled"* interruption dialog and aborts the session, and `safaridriver` exposes no programmatic permission API.

## Bridge

`example/content.js` posts messages from the page to the service worker. The SW exposes:

- `waitReady` — wait for `requestReporter.init()`
- `getReporterMessages` / `resetReporterMessages` — read/clear collected dry-run messages (e.g. `wtm.attrack.tp_events`)
- `getPages` — current pageStore state per tab
- `forceFlushPages` — bypass the BFCACHE TTL to deterministically stage pages whose docs are no longer live
