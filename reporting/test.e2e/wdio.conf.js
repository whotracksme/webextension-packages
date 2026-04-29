import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(here, '..', 'example');
const browser = (process.env.BROWSER || 'chrome').toLowerCase();
const port = Number(process.env.FIXTURE_PORT || 3300);

for (const bundle of ['index.bundle.js', 'content.bundle.js']) {
  if (!fs.existsSync(path.join(exampleDir, bundle))) {
    throw new Error(
      `missing example/${bundle} — run \`npm --workspace=reporting run build\` first`,
    );
  }
}
if (!fs.existsSync(path.join(exampleDir, 'manifest.json'))) {
  fs.copyFileSync(
    path.join(exampleDir, 'manifests', 'chromium.json'),
    path.join(exampleDir, 'manifest.json'),
  );
}

const capabilities =
  browser === 'safari'
    ? [{ browserName: 'safari' }]
    : [
        {
          browserName: 'chrome',
          'goog:chromeOptions': {
            args: [
              '--no-first-run',
              '--no-default-browser-check',
              '--enable-unsafe-extension-debugging',
            ],
          },
          webSocketUrl: true,
        },
      ];

let fixtureServer;

export const config = {
  runner: 'local',
  specs: [path.join(here, 'specs', '**', '*.spec.js')],
  maxInstances: 1,
  capabilities,
  logLevel: 'warn',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60_000 },

  onPrepare: async () => {
    fixtureServer = await startFixtureServer({ port });
  },

  before: async (_, __, browserObj) => {
    if (browser !== 'safari') {
      const result = await browserObj.webExtensionInstall({
        extensionData: { type: 'path', path: exampleDir },
      });
      browserObj.extensionId = result.extension;
    } else {
      const result = await browserObj.installAddOn(exampleDir, true);
      browserObj.extensionId = result;
    }
  },

  after: async (_, __, browserObj) => {
    if (browserObj.extensionId) {
      try {
        if (browser !== 'safari') {
          await browserObj.webExtensionUninstall({
            extension: browserObj.extensionId,
          });
        } else {
          await browserObj.uninstallAddOn(browserObj.extensionId);
        }
      } catch {
        /* noop */
      }
    }
  },

  onComplete: async () => {
    await fixtureServer?.close();
  },
};
