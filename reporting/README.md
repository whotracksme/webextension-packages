# Reporting

## Development setup

Run `npm ci` in the project root.

- Build: `npm --workspace=reporting run build`
- Watch: `npm --workspace=reporting run watch`

## Running the example extension

Interactive (DevTools + web-ext live reload):

```
npm --workspace=reporting start           # Chromium
npm --workspace=reporting run start.firefox
```

For a scripted runner with log capture and an HTTP control surface,
see `example/README.md`.

## End-to-end runs

`example/e2e/` drives page & search reporting in a real, un-automated Chrome
and captures the outgoing messages for verification:

```
npm --workspace=reporting run e2e.launch   # once: opens the WTM-E2E profile
npm --workspace=reporting run e2e.hub      # terminal 1
npm --workspace=reporting run e2e -- smoke # terminal 2
```

See `example/e2e/README.md`.

## Tests

See `test/README.md` for the two test suites (node-mocha + karma),
subset scripts, and the snapshot record workflow. Scenario/snapshot
fixtures are documented in `scenarios/README.md`.
