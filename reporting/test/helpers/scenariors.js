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

const scenariorsArgumentIndex = process.argv.findIndex(
  (arg) => arg === '--scenariors',
);

export const enableScenariors = scenariorsArgumentIndex >= 2;

let scenariors;

function getScenariorPaths() {
  const scenariorsPath = path.resolve(
    process.argv[scenariorsArgumentIndex + 1],
  );
  return fs
    .readdirSync(scenariorsPath, { withFileTypes: true })
    .filter((file) => !file.isDirectory())
    .filter((file) =>
      path.basename(file.name, path.extname(file.name)).startsWith('events_'),
    )
    .map((file) => path.join(file.parentPath, file.name));
}

function findScenario(name) {
  if (!scenariors) {
    scenariors = getScenariorPaths();
  }
  return scenariors.find((scenarioPath) =>
    path.basename(scenarioPath, path.extname(scenarioPath)).includes(name),
  );
}

function loadScenario(scenarioPath) {
  return fs
    .readFileSync(scenarioPath, { encoding: 'utf-8' })
    .split('\n')
    .map(JSON.parse);
}

export function playScenario(chrome, scenarioName) {
  const scenarioPath = findScenario(scenarioName);
  const events = loadScenario(scenarioPath);
  for (const event of events) {
    try {
      chrome[event.api][event.event].dispatch(...event.args);
    } catch (e) {
      console.error(`Could not dispatch event`, event, e);
    }
  }
}
