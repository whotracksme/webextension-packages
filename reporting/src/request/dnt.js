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

/**
 * Extacts values from the DNT Tk header, given a list of response headers for a request
 * https://www.w3.org/TR/tracking-dnt/#dfn-tk
 * @param responseHeaders
 */
export default function getTrackingStatus(state) {
  const status = state.getResponseHeader('tk');
  if (status) {
    const [value, statusId] = status.split(';');
    return { value, statusId };
  }
  return null;
}
