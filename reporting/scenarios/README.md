# Scenarios

Pre-recorded `chrome.webRequest.*`, `chrome.webNavigation.*`, and
`chrome.tabs.*` event streams that drive `RequestReporter` in node-mocha
integration tests without a real browser.

## Layout

```
scenarios/<release>/events_<scenario>_<browser>.log   ← JSONL, one event per line
```

A `release` identifies the recording date and the schema version of the
events format. When a scenario needs to be re-recorded (browser API drift,
schema change), bump the release rather than editing an existing file —
earlier releases may still be referenced by tests pinned to them.

`events_*.log` files are also downloaded on demand from
`github.com/ghostery/webextension-event-recorder/releases` if they aren't
present locally — the repository tracks them once pulled. See
`test/helpers/scenarios.js` for the download logic.

## Current index

Scenarios actively used by `reporting/test/request/index.test.js`:

| Release          | Scenario          | What it covers                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------ |
| `2024-08-02`     | `0001-empty-page` | Plain page load with no third-party resources — `requestStats` must stay empty. |
| `2024-08-02`     | `0002-3rd-party`  | Page with a single third-party script; verifies detection + the `wtm.attrack.tp_events` report shape. |
| `2024-08-02`     | `0005-preload`    | `<link rel=preload>` triggers the tracker path through a different webRequest ordering. |
| `2024-08-02-1`   | `0004-ping`       | Navigator `sendBeacon`/ping endpoints (non-XHR background request). |
| `2024-08-02-2`   | `0008-navigation` | Two successive navigations on the same tab; each page's trackers must be reported to the right page hostname. |

Scenarios present on disk but not referenced by any current test (likely
WIP or kept for a future regression test):

- `2024-08-02-02/` (empty)
- `2024-09-27/{0001-quick-close,0002-quick-navigation,0003-prefetch}`
- `2024-09-30/0003-prefetch`

## Related: `../snapshots/`

A separate fixture set used only by the `snapshots` `describe` block in
`reporting/test/request/index.test.js`. Each `snapshots/<N>/` contains:

- `events.log.br` — brotli-compressed event stream (replayed by `playSnapshotScenario`)
- `snapshot.json` — expected telemetry messages after replay

Approximate content (by inspection of `tps` keys):

| Snapshot | Site          | Notes                                                          |
| -------- | ------------- | -------------------------------------------------------------- |
| `0001`   | onet.pl       | Polish news portal, ~160 third-party domains.                 |
| `0002`   | onet.pl       | Shorter session, ~94 third parties.                           |
| `0003`   | soundcloud.com| Stream playback, CDN + Statsig + OneTrust.                    |
| `0004`   | soundcloud.com| Smaller session.                                               |
| `0005`   | nike.com      | E-commerce, bluecore + doubleclick + bing.                    |
| `0006`   | nike.com      | Variant session.                                               |

The snapshot test replays each events stream twice — the second time with
URL rewrites (`onet.pl→wp.pl`, `soundcloud.com→google.com`,
`nike.com→adidas.com`) so the token-telemetry code sees the same trackers
on a different domain, which is needed to trigger quorum-based reporting.

## Re-recording snapshots

When a change in `src/request/` legitimately shifts the telemetry output,
re-record the expected snapshots:

```
npm --workspace=reporting run test.unit.request.record
```

Then `git diff reporting/snapshots/` and commit the expected changes
alongside the source change. The record step is idempotent — running it
twice produces byte-identical files.
