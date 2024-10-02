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
import { brotliDecompressSync } from 'zlib';

async function download(release, scenario, browser) {
  const scenartioFileName = `events_${scenario}_${browser}.log`;

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

  const scenarioPath = path.join(scenariosPath, scenartioFileName);
  if (fs.existsSync(scenarioPath)) {
    return scenarioPath;
  }
  const downloadUrl = `https://github.com/ghostery/webextension-event-recorder/releases/download/${release}/${scenartioFileName}.br`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(
      `Cound not download scenario "${scenartioFileName}" from "${downloadUrl}: ${response.status} - ${response.statusText}`,
    );
  }
  const compressedBuffer = await response.arrayBuffer();
  const decompressedBuffer = brotliDecompressSync(
    new Uint8Array(compressedBuffer),
  );

  fs.writeFileSync(scenarioPath, decompressedBuffer);
  return scenarioPath;
}

function loadScenario(scenarioPath) {
  return fs
    .readFileSync(scenarioPath, { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
}

function rewriteIp(event) {
  // prerecorded scenarios have local IPs, which will be ignored by the request monitor
  if (event.ip) {
    event.ip = '198.51.100.1';
  }
  return event;
}

export async function playScenario(
  chrome,
  { scenarioRelease, scenarioName, browser = 'chrome' },
) {
  if (!scenarioRelease) {
    throw new Error('specify scenario release');
  }

  const scenarioPath = await download(scenarioRelease, scenarioName, browser);
  const events = loadScenario(scenarioPath);
  for (const event of events) {
    try {
      const args = event.args.map(rewriteIp);
      chrome[event.api][event.event].dispatch(...args);
    } catch (e) {
      console.error(`Could not dispatch event`, event, e);
    }
  }
}
