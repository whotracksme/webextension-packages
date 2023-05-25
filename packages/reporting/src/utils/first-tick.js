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

let isFirstTick = true;

if (typeof window !== 'undefined') {
  window.addEventListener('message', function onMessage(message) {
    if (message === 'guardFirstTick' || !isFirstTick) {
      window.removeEventListener('message', onMessage);
      isFirstTick = false;
    }
  });

  window.postMessage('guardFirstTick');
}

Promise.resolve().then(() => {
  isFirstTick = false;
});

setTimeout(() => {
  isFirstTick = false;
}, 0);

export default function guardFirstTick() {
  if (isFirstTick) {
    return;
  }
  throw new Error('Called not in the first tick');
}

// used only to ensure the module is load
export function checkFistTick() {
  return isFirstTick;
}
