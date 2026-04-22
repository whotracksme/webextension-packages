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

// Legacy Firefox content-policy type integers, kept for wire-format
// compatibility with existing tp_events consumers.
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

/**
 * Extracts per-request counters into the owning document's
 * `requestStats` bucket (via `state.incrementStat`).
 *
 * Two kinds of method here:
 *
 *   - `recordRequest*`: pure observational counters. Do not mutate
 *     pipeline-level state. Safe to add/remove without affecting
 *     downstream checks.
 *   - `extractRequestCookie` / `extractResponseCookie`: parse the
 *     Cookie / Set-Cookie headers into `state.hasCookie` /
 *     `state.hasSetCookie`, which the pipeline reads as a gate for
 *     cookie-blocking. These also emit their own observational
 *     counters because they touch the same bytes anyway.
 */
export default class RequestStats {
  constructor(placeHolder) {
    this.placeHolder = placeHolder;
  }

  recordRequestShape(state) {
    state.incrementStat('c');
    if (state.urlParts.search.length > 0) {
      state.incrementStat('has_qs');
    }
    if (state.urlParts.hasParameterString() > 0) {
      state.incrementStat('has_ps');
    }
    if (state.urlParts.hash.length > 0) {
      state.incrementStat('has_fragment');
    }
    if (state.method === 'POST') {
      state.incrementStat('has_post');
    }

    state.incrementStat(`type_${TYPE_LOOKUP[state.type] || 'unknown'}`);

    const isHTTP = (protocol) => protocol === 'http:' || protocol === 'https:';
    const scheme = isHTTP(state.urlParts.protocol)
      ? state.urlParts.scheme
      : 'other';
    state.incrementStat(`scheme_${scheme}`);

    if (state.url.indexOf(this.placeHolder) > -1) {
      state.incrementStat('hasPlaceHolder');
    }
  }

  recordRefererLeak(state) {
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
  }

  recordResponseShape(state) {
    state.incrementStat('resp_ob');
    state.incrementStat(
      'content_length',
      parseInt(state.getResponseHeader('Content-Length'), 10) || 0,
    );
    state.incrementStat(`status_${state.statusCode}`);
  }

  extractRequestCookie(state) {
    state.cookieData = state.getCookieData();
    const hasCookie = state.cookieData && state.cookieData.length > 5;
    if (hasCookie) {
      state.incrementStat('cookie_set');
    }
    state.hasCookie = hasCookie;
  }

  extractResponseCookie(state) {
    const setCookie = state.getResponseHeader('Set-Cookie');
    const hasSetCookie = setCookie && setCookie.length > 5;
    if (hasSetCookie) {
      state.incrementStat('set_cookie_set');
      if (setCookie.toLowerCase().indexOf('samesite=none') !== -1) {
        state.incrementStat('set_cookie_samesite_none');
      }
    }
    state.hasSetCookie = hasSetCookie;
  }
}
