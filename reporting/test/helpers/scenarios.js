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
import { decompress } from 'brotli';

async function download(release, scenarior, browser) {
  const scenartioFileName = `events_${scenarior}_${browser}.log`;

  const scenariosPath = path.join(
    import.meta.dirname,
    '..',
    '..',
    'scenarios',
    release,
  );
  if (!fs.existsSync(scenariosPath)) {
    fs.mkdirSync(scenariosPath, { recursive: true });
  }

  const scenariorPath = path.join(scenariosPath, scenartioFileName);
  if (fs.existsSync(scenariorPath)) {
    return scenariorPath;
  }
  const downloadUrl = `https://github.com/ghostery/webextension-event-recorder/releases/download/${release}/${scenartioFileName}.br`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(
      `Cound not download scenarior "${scenartioFileName}" from "${downloadUrl}: ${response.status} - ${response.statusText}`,
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
    .filter(Boolean)
    .map(JSON.parse);
}

export async function playScenario(
  chrome,
  { scenariorRelease, scenariorName, browser = 'chrome' },
) {
  if (!scenariorRelease) {
    throw new Error('specify scenarior release');
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
