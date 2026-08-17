/**
 * WhoTracks.Me
 * https://whotracks.me/
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'WTM-E2E' },
    chrome: { type: 'string' },
  },
});

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.dirname(e2eDir);

for (const bundle of ['index.bundle.js', 'content.bundle.js']) {
  if (!fs.existsSync(path.join(exampleDir, bundle))) {
    console.error(
      `missing example/${bundle} — run \`npm --workspace=reporting run build\` first`,
    );
    process.exit(1);
  }
}

if (!fs.existsSync(path.join(exampleDir, 'manifest.json'))) {
  fs.copyFileSync(
    path.join(exampleDir, 'manifests', 'chromium.json'),
    path.join(exampleDir, 'manifest.json'),
  );
}

const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

function findChrome() {
  if (values.chrome) {
    return values.chrome;
  }
  const candidates = CHROME_CANDIDATES[os.platform()] || [];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    console.error(
      'could not locate Chrome — pass --chrome=/path/to/chrome explicitly',
    );
    process.exit(1);
  }
  return found;
}

const chrome = findChrome();

// No --enable-automation, --remote-debugging-port or WebDriver: sites fingerprint them.
const args = ['--no-first-run', '--no-default-browser-check'];

args.push(`--profile-directory=${values.profile}`);
console.log(`profile:   "${values.profile}" in your regular Chrome`);
console.log(`extension: load once by hand, then it persists:`);
console.log(`  1. chrome://extensions in the new window`);
console.log(`  2. enable "Developer mode"`);
console.log(`  3. "Load unpacked" -> ${exampleDir}`);

const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
child.unref();

console.log(`\nlaunched: ${chrome}`);
console.log('start the hub in another shell if it is not running yet:');
console.log('  npm --workspace=reporting run e2e.hub');
