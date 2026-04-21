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

## Tests

See `test/README.md` for the two test suites (node-mocha + karma),
subset scripts, and the snapshot record workflow. Scenario/snapshot
fixtures are documented in `scenarios/README.md`.
