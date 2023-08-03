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

import { parse } from '../../utils/url';
import Subject from '../utils/subject';
import pacemaker from '../../utils/pacemaker';

const DEFAULT_OPTIONS = {
  CLICK_TIMEOUT: 300000,
  VISIT_TIMEOUT: 240000,
};

function subscribeWithTimer(subject, store, keyPath, valuePath, timeout) {
  const timers = new Map();

  return subject.subscribe((event) => {
    const oldTimer = timers.get(event[keyPath]);
    if (oldTimer) {
      pacemaker.clearTimeout(oldTimer);
    }

    const timer = pacemaker.setTimeout(function oAuthDetectorTimeout() {
      pacemaker.clearTimeout(timer);
      delete store[event[keyPath]];
    }, timeout);

    timers.set(event[keyPath], timer);

    store[event[keyPath]] = event[valuePath];
  });
}

export default class OAuthDetector {
  constructor(options = DEFAULT_OPTIONS) {
    this.clickActivity = {};
    this.siteActivitiy = {};
    this.subjectMainFrames = new Subject();
    this.tabClicks = new Subject();
    Object.assign(this, DEFAULT_OPTIONS, options);
  }

  recordClick(ev, contextHTML, href, sender) {
    this.tabClicks.pub(sender.tab);
  }

  init() {
    this.tabActivitySubscription = subscribeWithTimer(
      this.tabClicks,
      this.clickActivity,
      'id',
      'url',
      this.CLICK_TIMEOUT,
    );

    // observe pages loaded for the last VISIT_TIMEOUT ms.
    this.pageOpenedSubscription = subscribeWithTimer(
      this.subjectMainFrames,
      this.siteActivitiy,
      'hostname',
      'tabId',
      this.VISIT_TIMEOUT,
    );
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
    const oAuthUrls = ['/oauth', '/authorize'];
    const mapper = (oAuthUrl) => state.urlParts.pathname.indexOf(oAuthUrl) > -1;
    const reducer = (accumulator, currentValue) => accumulator || currentValue;
    const isOAuthFlow = oAuthUrls.map(mapper).reduce(reducer);

    if (
      isOAuthFlow &&
      this.clickActivity[state.tabId] &&
      this.siteActivitiy[state.urlParts.hostname]
    ) {
      const clickedPage = parse(this.clickActivity[state.tabId]);
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
