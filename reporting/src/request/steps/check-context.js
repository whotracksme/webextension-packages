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

export function checkValidContext(state) {
  if (!state.page || !state.tabUrlParts || !state.urlParts) {
    return false;
  }

  // ignore requests that are related to page load but does not affect the page itself
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/ResourceType#other
  // examples:
  // * link rel=search
  // * link rel=manifest
  // * link rel=prefetch
  if (state.type === 'other') {
    return false;
  }

  if (
    !state.tabUrlParts.protocol.startsWith('http') ||
    !state.urlParts.protocol.startsWith('http')
  ) {
    return false;
  }

  return true;
}

export function checkSameGeneralDomain(state) {
  const gd1 = state.urlParts.generalDomain;
  const gd2 = state.tabUrlParts.generalDomain;
  return (
    gd1 !== undefined &&
    gd1 !== null &&
    gd2 !== undefined &&
    gd2 !== null &&
    gd1 !== gd2 &&
    gd1.split('.')[0] !== gd2.split('.')[0]
  );
}
