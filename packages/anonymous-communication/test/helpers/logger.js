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

import sinon from 'sinon';

const VERBOSE = false;
function wrapLog(log) {
  return VERBOSE ? log : () => {};
}

export function mockConsole() {
  sinon.stub(console, 'debug').callsFake(wrapLog(console.debug));
  sinon.stub(console, 'log').callsFake(wrapLog(console.log));
  sinon.stub(console, 'info').callsFake(wrapLog(console.info));
  sinon.stub(console, 'error').callsFake(wrapLog(console.error));
  sinon.stub(console, 'warn').callsFake(wrapLog(console.warn));
}

export function restoreConsole() {
  console.debug.restore();
  console.log.restore();
  console.info.restore();
  console.error.restore();
  console.warn.restore();
}
