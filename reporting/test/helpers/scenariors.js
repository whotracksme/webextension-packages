/**
 * WhoTracks.Me
 * https://ghostery.com/whotracksme
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { decompress } from 'brotli';

const scenariorsArgumentIndex = process.argv.findIndex(
  (arg) => arg === '--scenariors',
);

export const enableScenariors = scenariorsArgumentIndex >= 2;

async function download(release, scenarior, browser) {
  const scenartionFileName = `events_${scenarior}_${browser}.log`;

  const scenariorsPath = path.join(
    import.meta.dirname,
    '..',
    '..',
    'scenariors',
    release,
  );
  if (!fs.existsSync(scenariorsPath)) {
    fs.mkdirSync(scenariorsPath, { recursive: true });
  }

  const scenariorPath = path.join(scenariorsPath, scenartionFileName);
  if (fs.existsSync(scenariorPath)) {
    return scenariorPath;
  }
  const downloadUrl = `https://github.com/ghostery/webextension-event-recorder/releases/download/${release}/${scenartionFileName}.br`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(
      `Cound not download scenarior "${scenartionFileName}" from "${downloadUrl}: ${response.status} - ${response.statusText}`,
    );
  }
  const compressedBuffer = await response.arrayBuffer();
  const decompressedBuffer = await decompress(new Uint8Array(compressedBuffer));

  fs.writeFileSync(scenariorPath, decompressedBuffer);
  return scenariorPath;
}

function loadScenario(scenarioPath) {
  return fs
    .readFileSync(scenarioPath, { encoding: 'utf-8' })
    .split('\n')
    .map(JSON.parse);
}

export async function playScenario(
  chrome,
  {
    scenariorRelease = process.argv[scenariorsArgumentIndex + 1],
    scenariorName,
    browser = 'chrome',
  },
) {
  if (!scenariorRelease) {
    throw new Error(
      'specify scenarior release by passing a command line argument --scenariors <release_name>',
    );
  }
  const scenarioPath = await download(scenariorRelease, scenariorName, browser);
  const events = loadScenario(scenarioPath);
  for (const event of events) {
    try {
      chrome[event.api][event.event].dispatch(...event.args);
    } catch (e) {
      console.error(`Could not dispatch event`, event, e);
    }
  }
}
