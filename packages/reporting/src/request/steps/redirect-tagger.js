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

import TempSet from '../temp-set';

const CACHE_TIMEOUT = 10 * 1000;

/**
 * Caches 302 redirects so that we can ensure that the resulting request is properly
 * passed through the token logic.
 */
export default class RedirectTagger {
  constructor() {
    this.redirectCache = new TempSet();
    this.redirectTaggerCache = new TempSet();
  }

  isFromRedirect(url) {
    return this.redirectCache.has(url);
  }

  checkRedirectStatus(state) {
    if (state.statusCode === 302) {
      const location = state.getResponseHeader('Location');
      if (!location) {
        // 302 without "Location" in header?
        console.log(state, '302 without "Location" in header?');
        return true;
      }
      if (location.startsWith('/')) {
        // relative redirect
        const redirectUrl = `${state.urlParts.protocol}://${state.urlParts.hostname}${location}`;
        this.redirectCache.add(redirectUrl, CACHE_TIMEOUT);
      } else if (
        location.startsWith('http://') ||
        location.startsWith('https://')
      ) {
        // absolute redirect
        this.redirectCache.add(location, CACHE_TIMEOUT);
      }
    }
    return true;
  }

  checkRedirect(details) {
    if (details.isRedirect && details.requestId !== undefined) {
      this.redirectTaggerCache.add(details.requestId, CACHE_TIMEOUT);
      return false;
    }
    return true;
  }

  confirmRedirect(details) {
    if (
      details.requestId !== undefined &&
      this.redirectTaggerCache.has(details.requestId)
    ) {
      return false;
    }

    if (details.isMainFrame && details.isRedirect) {
      return false;
    }

    return true;
  }
}
