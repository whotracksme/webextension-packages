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

// source https://stackoverflow.com/a/21797381
export function base64ToArrayBuffer(base64) {
  var binary_string = atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export const createFetchMock =
  ({
    version = '2018-10-11',
    useDiff = false,
    local = true,
    cdn = true,
  } = {}) =>
  async (url) => {
    const fail = {
      ok: false,
    };
    if (url.includes('local') && !local) {
      return fail;
    }
    if (url.includes('cdn') && !cdn) {
      return fail;
    }
    return {
      ok: true,
      // for config
      async json() {
        return {
          version,
          useDiff,
        };
      },
      // for bloom filter
      async arrayBuffer() {
        if (url.includes('diff')) {
          return base64ToArrayBuffer('AAAAAgp4yhHUIy5ERA==');
        }
        return base64ToArrayBuffer('AAAAAgrdwUcnN1113w==');
      },
    };
  };
