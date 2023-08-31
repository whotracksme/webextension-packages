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

export const PAGE_LOADING_STATE = {
  CREATED: 'created',
  NAVIGATING: 'navigating',
  COMMITTED: 'committed',
  LOADED: 'loaded',
  COMPLETE: 'complete',
};

export default class Page {
  constructor({ id, active, url, incognito }) {
    this.id = id || 0;
    this.url = url;
    this.isRedirect = false;
    this.isPrivate = incognito;
    this.isPrivateServer = false;
    this.created = Date.now();
    this.destroyed = null;
    this.lastRequestId = null;
    this.frames = {
      0: {
        parentFrameId: -1,
        url,
      },
    };
    this.state = PAGE_LOADING_STATE.CREATED;

    this.activeTime = 0;
    this.activeFrom = active ? Date.now() : 0;

    this.requestStats = {};
    this.annotations = {};
    this.counter = 0;

    this.tsv = '';
    this.tsvId = undefined;
  }

  setActive(active) {
    if (active && this.activeFrom === 0) {
      this.activeFrom = Date.now();
    } else if (!active && this.activeFrom > 0) {
      this.activeTime += Date.now() - this.activeFrom;
      this.activeFrom = 0;
    }
  }

  updateState(newState) {
    this.state = newState;
  }

  stage() {
    this.setActive(false);
    this.destroyed = Date.now();
    // unset previous (to prevent history chain memory leak)
    this.previous = undefined;
  }

  getStatsForDomain(domain) {
    let stats = this.requestStats[domain];
    if (!stats) {
      stats = {};
      this.requestStats[domain] = stats;
    }
    return stats;
  }

  setTrackingStatus(status) {
    this.tsv = status.value;
    this.tsvId = status.statusId;
  }

  getFrameAncestors({ parentFrameId }) {
    const ancestors = [];

    // Reconstruct frame ancestors
    let currentFrameId = parentFrameId;
    while (currentFrameId !== -1) {
      const frame = this.frames[currentFrameId];

      // If `frame` if undefined, this means we do not have any information
      // about the frame associated with `currentFrameId`. This can happen if
      // the event for `main_frame` or `sub_frame` was not emitted from the
      // webRequest API for this frame; this can happen when Service Workers
      // are used. In this case, we consider that the parent frame is the main
      // frame (which is very likely the case).
      if (frame === undefined) {
        ancestors.push({
          frameId: 0,
          url: this.url,
        });
        break;
      }

      // Continue going up the ancestors chain
      ancestors.push({
        frameId: currentFrameId,
        url: frame.url,
      });
      currentFrameId = frame.parentFrameId;
    }

    return ancestors;
  }

  /**
   * Return the URL of top-level document (i.e.: tab URL).
   */
  getTabUrl() {
    return this.url;
  }

  /**
   * Return the URL of the frame.
   */
  getFrameUrl(context) {
    const { frameId } = context;

    const frame = this.frames[frameId];

    // In some cases, frame creation does not trigger a webRequest event (e.g.:
    // if the iframe is specified in the HTML of the page directly). In this
    // case we try to fall-back to something else: documentUrl, originUrl,
    // initiator.
    if (frame === undefined) {
      return context.documentUrl || context.originUrl || context.initiator;
    }

    return frame.url;
  }
}
