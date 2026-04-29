import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(here, '..', 'example');
const browser = (process.env.BROWSER || 'chrome').toLowerCase();
const port = Number(process.env.FIXTURE_PORT || 3300);
const chromeChannel = process.env.CHROME_CHANNEL || 'canary';
const safariDriverPort = Number(process.env.SAFARIDRIVER_PORT || 4444);

for (const bundle of ['index.bundle.js', 'content.bundle.js']) {
  if (!fs.existsSync(path.join(exampleDir, bundle))) {
    throw new Error(`missing example/${bundle} — run \`npm run build\` first`);
  }
}
fs.copyFileSync(
  path.join(exampleDir, 'manifests', 'chromium.json'),
  path.join(exampleDir, 'manifest.json'),
);

const HOST_RESOLVER_RULES = [
  'MAP site.test 127.0.0.1',
  'MAP tracker.test 127.0.0.1',
  'MAP analytics.test 127.0.0.1',
].join(', ');

const headless = process.env.HEADLESS === '1';

const chromeArgs = [
  '--no-first-run',
  '--no-default-browser-check',
  '--enable-unsafe-extension-debugging',
  `--host-resolver-rules=${HOST_RESOLVER_RULES}`,
];
if (headless) chromeArgs.push('--headless=new');

const capabilities =
  browser === 'safari'
    ? [{ browserName: 'safari' }]
    : [
        {
          browserName: 'chrome',
          browserVersion: chromeChannel,
          'goog:chromeOptions': { args: chromeArgs },
          webSocketUrl: true,
        },
      ];

let fixtureServer;
let safariDriverProc;

async function safariInstallExtension(browserObj, extensionPath) {
  const baseUrl = `http://127.0.0.1:${safariDriverPort}`;
  const res = await fetch(
    `${baseUrl}/session/${browserObj.sessionId}/webextension`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'path', path: extensionPath }),
    },
  );
  const body = await res.json();
  if (body?.value?.error) {
    throw new Error(
      `safari /webextension install failed: ${
        body.value.message || body.value.error
      }`,
    );
  }
  return body.value.extension;
}

async function waitForDriver(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`safaridriver did not come up at ${url}`);
}

const baseConfig = {
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

    if (browser === 'safari') {
      safariDriverProc = spawn(
        'safaridriver',
        ['--port', String(safariDriverPort)],
        { stdio: 'inherit' },
      );
      await waitForDriver(`http://127.0.0.1:${safariDriverPort}/status`);
    }
  },

  before: async (_, __, browserObj) => {
    // Generous script timeout — the bridge may need to wait for the user
    // to dismiss Safari's per-host permission prompt before the content
    // script loads and starts responding to postMessage.
    await browserObj.setTimeout({ script: 60_000 });
    if (browser === 'safari') {
      browserObj.extensionId = await safariInstallExtension(
        browserObj,
        exampleDir,
      );
      return;
    }
    const result = await browserObj.webExtensionInstall({
      extensionData: { type: 'path', path: exampleDir },
    });
    browserObj.extensionId = result.extension;
  },

  after: async (_, __, browserObj) => {
    if (browser === 'safari') return; // session teardown removes it
    if (!browserObj.extensionId) return;
    try {
      await browserObj.webExtensionUninstall({
        extension: browserObj.extensionId,
      });
    } catch {
      /* noop */
    }
  },

  onComplete: async () => {
    if (safariDriverProc) safariDriverProc.kill('SIGINT');
    await fixtureServer?.close();
  },
};

export const config =
  browser === 'safari'
    ? {
        ...baseConfig,
        hostname: '127.0.0.1',
        port: safariDriverPort,
        path: '/',
      }
    : baseConfig;
