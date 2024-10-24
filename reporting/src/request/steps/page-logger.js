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

/* eslint no-param-reassign: 'off' */

import { truncateDomain } from '../utils.js';

// maps string (web-ext) to int (FF cpt). Anti-tracking still uses these legacy types.
const TYPE_LOOKUP = {
  other: 1,
  script: 2,
  image: 3,
  stylesheet: 4,
  object: 5,
  main_frame: 6,
  sub_frame: 7,
  xbl: 9,
  ping: 10,
  xmlhttprequest: 11,
  object_subrequest: 12,
  xml_dtd: 13,
  font: 14,
  media: 15,
  websocket: 16,
  csp_report: 17,
  xslt: 18,
  beacon: 19,
  imageset: 21,
  web_manifest: 22,
};

export default class PageLogger {
  constructor(config) {
    this.config = config;
    // maintain the request metadabase between pipeline steps
    this._requestCounters = new Map();
  }

  _attachCounters(state) {
    const stats = state.page.getStatsForDomain(
      truncateDomain(state.urlParts.domainInfo, 2),
    );
    state.reqLog = stats;
    const incrementStat = (statName, c) => {
      stats[statName] = (stats[statName] || 0) + (c || 1);
    };
    const setStat = (statName, value) => {
      stats[statName] = value;
    };
    state.incrementStat = incrementStat;
    state.setStat = setStat;

    if (state.requestId) {
      this._requestCounters.set(state.requestId, {
        incrementStat,
        setStat,
      });
    }
  }

  _loadStatCounters(state) {
    const meta = this._requestCounters.get(state.requestId);
    Object.keys(meta).forEach((k) => {
      state[k] = meta[k];
    });
  }

  onBeforeRequest(state) {
    this._attachCounters(state);
    const { incrementStat, urlParts } = state;

    incrementStat('c');
    if (urlParts.search.length > 0) {
      incrementStat('has_qs');
    }
    if (urlParts.hasParameterString() > 0) {
      incrementStat('has_ps');
    }
    if (urlParts.hash.length > 0) {
      incrementStat('has_fragment');
    }
    if (state.method === 'POST') {
      incrementStat('has_post');
    }

    incrementStat(`type_${TYPE_LOOKUP[state.type] || 'unknown'}`);

    // log protocol (secure or not)
    const isHTTP = (protocol) => protocol === 'http:' || protocol === 'https:';
    const scheme = isHTTP(urlParts.protocol) ? urlParts.scheme : 'other';
    incrementStat(`scheme_${scheme}`);

    if (state.url.indexOf(this.config.placeHolder) > -1) {
      incrementStat('hasPlaceHolder');
    }
  }

  onBeforeSendHeaders(state) {
    if (state.requestId && this._requestCounters.has(state.requestId)) {
      this._loadStatCounters(state);
    } else {
      this._attachCounters(state);
    }
    // referer stats
    const referrer = state.getReferrer();
    if (referrer && referrer.indexOf(state.tabUrl) > -1) {
      state.incrementStat('referer_leak_header');
    }
    if (
      state.url.indexOf(state.tabUrlParts.hostname) > -1 ||
      state.url.indexOf(encodeURIComponent(state.tabUrlParts.hostname)) > -1
    ) {
      state.incrementStat('referer_leak_site');
      if (
        state.url.indexOf(state.tabUrlParts.pathname) > -1 ||
        state.url.indexOf(encodeURIComponent(state.tabUrlParts.pathname)) > -1
      ) {
        state.incrementStat('referer_leak_path');
      }
    }
    // check if the request contains a cookie
    state.cookieData = state.getCookieData();
    const hasCookie = state.cookieData && state.cookieData.length > 5;
    if (hasCookie) {
      state.incrementStat('cookie_set');
    }
    state.hasCookie = hasCookie;
    return true;
  }

  onHeadersReceived(state) {
    if (state.requestId && this._requestCounters.has(state.requestId)) {
      this._loadStatCounters(state);
    } else {
      this._attachCounters(state);
    }
    state.incrementStat('resp_ob');
    state.incrementStat(
      'content_length',
      parseInt(state.getResponseHeader('Content-Length'), 10) || 0,
    );
    state.incrementStat(`status_${state.statusCode}`);

    const setCookie = state.getResponseHeader('Set-Cookie');
    const hasSetCookie = setCookie && setCookie.length > 5;
    if (hasSetCookie) {
      state.incrementStat('set_cookie_set');
      // log samesite=none: explicit cross site cookies
      if (setCookie.toLowerCase().indexOf('samesite=none') !== -1) {
        state.incrementStat('set_cookie_samesite_none');
      }
    }
    state.hasSetCookie = hasSetCookie;

    return true;
  }

  reattachStatCounter(state) {
    const { requestId } = state;
    if (requestId && this._requestCounters.has(requestId)) {
      this._loadStatCounters(state);
      this._requestCounters.delete(requestId);
      return true;
    }
    return false;
  }
}
