# reporting/test

Two test suites live here, distinguished by filename suffix.

## Node (mocha, sinon-chrome) — fast

- Pattern: `*.test.js`
- Setup: `setup.unit.js`
- All: `npm --workspace=reporting run test.unit`
- Request subset: `npm --workspace=reporting run test.unit.request`
- Watch: `npm --workspace=reporting run test.unit.watch`

Prefer this suite for request-pipeline work — seconds vs. minutes.

## Browser (karma, headless Chrome) — covers DOM/CSSOM paths

- Pattern: `*.spec.js`
- Setup: `setup.js`
- Entry bundles: `test/index.js` (full) or `test/request.js` (subset)
- All: `npm --workspace=reporting run test`
- Request subset: `npm --workspace=reporting run test.karma.request`

New karma specs must be added to `index.js` (or `request.js` for the
request subset) — karma bundles a single entry with rollup, so a spec
that isn't imported there will not run.

## Re-recording request snapshots

`request/index.test.js` has a `snapshots` block that replays recorded
event streams (under `../snapshots/`) and asserts the emitted telemetry
matches `snapshot.json`. When a source change legitimately shifts the
output:

```
npm --workspace=reporting run test.unit.request.record
```

Sets `RECORD_SNAPSHOT=1`; inspect `git diff reporting/snapshots/` and
commit the expected changes alongside the source change. The record
step is idempotent — re-running produces byte-identical files.

See `../scenarios/README.md` for the scenario + snapshot index.
