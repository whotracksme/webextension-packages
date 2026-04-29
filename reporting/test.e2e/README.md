# Request reporter e2e tests

End-to-end tests that load the example extension into a real browser and exercise the request reporter against a self-hosted fixture site that simulates tracking.

These tests are intended to run **locally only** (not in CI).

## One-time setup

### 1. /etc/hosts entries

The fixture server uses three hostnames that all resolve to `127.0.0.1`. Add them to `/etc/hosts`:

```
127.0.0.1   site.test
127.0.0.1   tracker.test
127.0.0.1   analytics.test
```

`site.test` plays the role of a first-party page; `tracker.test` and `analytics.test` are the third parties it loads resources from.

### 2. Build the example extension

The runner loads the bundled example extension. Build it once before running tests, and rebuild whenever you change `reporting/src` or `reporting/example`:

```
npm --workspace=reporting run build
```

### 3. Browser-specific setup

- **Chrome**: nothing extra; the default config uses Chrome via WebDriver BiDi.
- **Safari** (optional): enable the driver and allow unsigned extensions:
  ```
  safaridriver --enable
  ```
  Then in Safari → Develop → enable "Allow Unsigned Extensions".

## Running

```
# default: Chrome
npm --workspace=reporting run test.e2e

# Safari
BROWSER=safari npm --workspace=reporting run test.e2e
```

## Layout

```
test.e2e/
  server.js          # fixture HTTP server, routes by Host header
  wdio.conf.js       # single wdio config; browser selected via BROWSER env
  fixtures/
    site.test/       # 1st-party site
    tracker.test/    # 3rd-party tracker assets
    analytics.test/  # 3rd-party analytics endpoint
  specs/             # mocha specs
```

The fixture server listens on `127.0.0.1:3300` (override with `FIXTURE_PORT`) and serves different content per `Host` header.

## How specs talk to the extension

`example/content.js` includes a `window.postMessage` bridge that forwards `{source:'wtm-e2e', op, args}` to the background service worker. `example/index.js` exposes a debug API:

- `getReporterMessages` — collected dry-run messages
- `resetReporterMessages` — clear the collected list
- `getPages` — current pageStore state per tab
