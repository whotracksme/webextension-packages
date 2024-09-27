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

import { parse } from '../../utils/url.js';
import Subject from '../utils/subject.js';
import ChromeStorageMap from '../utils/chrome-storage-map.js';

const DEFAULT_OPTIONS = {
  CLICK_TIMEOUT: 5 * 60 * 1000,
  VISIT_TIMEOUT: 4 * 60 * 1000,
};

export default class OAuthDetector {
  constructor(options = DEFAULT_OPTIONS) {
    Object.assign(this, DEFAULT_OPTIONS, options);

    this.clickActivity = new ChromeStorageMap({
      storageKey: 'wtm-request-reporting:oauth-detector:click-activity',
      ttlInMs: this.CLICK_TIMEOUT,
    });
    this.siteActivitiy = new ChromeStorageMap({
      storageKey: 'wtm-request-reporting:oauth-detector:site-activity',
      ttlInMs: this.VISIT_TIMEOUT,
    });
    this.subjectMainFrames = new Subject();
    this.tabClicks = new Subject();
  }

  recordClick(ev, contextHTML, href, sender) {
    this.tabClicks.pub(sender.tab);
  }

  async init() {
    await this.clickActivity.isReady;
    await this.siteActivitiy.isReady;
    this.tabActivitySubscription = this.tabClicks.subscribe((event) => {
      this.clickActivity.set(event.id, event.url);
    });
    this.pageOpenedSubscription = this.subjectMainFrames.subscribe((event) => {
      this.siteActivitiy.set(event.hostname, event.tabId);
    });
  }

  unload() {
    if (this.tabActivitySubscription) {
      this.tabActivitySubscription.unsubscribe();
    }
    if (this.pageOpenedSubscription) {
      this.pageOpenedSubscription.unsubscribe();
    }
  }

  checkMainFrames(state) {
    if (state.isMainFrame) {
      this.subjectMainFrames.pub({
        tabId: state.tabId,
        hostname: state.urlParts.hostname,
      });
    }
  }

  /**
   * Pipeline step to check if this request is part of a OAuth flow. This is done by
   * checking that the following three conditions are met:
   *  - The third-party url path contains '/oauth' or '/authorize'
   *  - The user has recently clicked in the source tab (i.e. the site wanting to authenticate the
   * user)
   *  - The user has recently visited the oauth domain (the authentication provider)
   * @param state
   * @returns false if the request is an oauth request, true otherwise
   */
  checkIsOAuth(state, type) {
    const isOAuthFlow = ['/oauth', '/authorize'].some((pattern) =>
      state.urlParts.pathname.includes(pattern),
    );

    if (
      isOAuthFlow &&
      this.clickActivity.get(state.tabId) &&
      this.siteActivitiy.get(state.urlParts.hostname)
    ) {
      const clickedPage = parse(this.clickActivity.get(state.tabId));
      if (
        clickedPage !== null &&
        clickedPage.hostname === state.tabUrlParts.hostname
      ) {
        state.incrementStat(`${type}_allow_oauth`);
        return false;
      }
    }
    return true;
  }
}
