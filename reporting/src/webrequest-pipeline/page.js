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
  COMPLETE: 'complete',
};

export function create({ id, active, url, incognito, created }) {
  const page = {};
  page.id = id || 0;
  page.url = url;
  page.isRedirect = false;
  page.isPrivate = incognito;
  page.isPrivateServer = false;
  page.created = created || Date.now();
  page.destroyed = null;
  page.lastRequestId = null;
  page.frames = {
    0: {
      parentFrameId: -1,
      url,
    },
  };
  page.state = PAGE_LOADING_STATE.CREATED;

  page.activeTime = 0;
  page.activeFrom = active ? Date.now() : 0;

  page.requestStats = {};
  page.annotations = {};
  page.counter = 0;

  page.tsv = '';
  page.tsvId = undefined;
  return page;
}

export function setActive(page, active) {
  if (active && page.activeFrom === 0) {
    page.activeFrom = Date.now();
  } else if (!active && page.activeFrom > 0) {
    page.activeTime += Date.now() - page.activeFrom;
    page.activeFrom = 0;
  }
}

export function getStatsForDomain(page, domain) {
  let stats = page.requestStats[domain];
  if (!stats) {
    stats = {};
    page.requestStats[domain] = stats;
  }
  return stats;
}

export function getFrameAncestors(page, { parentFrameId }) {
  const ancestors = [];

  // Reconstruct frame ancestors
  let currentFrameId = parentFrameId;
  while (currentFrameId !== -1) {
    const frame = page.frames[currentFrameId];

    // If `frame` if undefined, this means we do not have any information
    // about the frame associated with `currentFrameId`. This can happen if
    // the event for `main_frame` or `sub_frame` was not emitted from the
    // webRequest API for this frame; this can happen when Service Workers
    // are used. In this case, we consider that the parent frame is the main
    // frame (which is very likely the case).
    if (frame === undefined) {
      ancestors.push({
        frameId: 0,
        url: page.url,
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
 * Return the URL of the frame.
 */
export function getFrameUrl(page, context) {
  const { frameId } = context;

  const frame = page.frames[frameId];

  // In some cases, frame creation does not trigger a webRequest event (e.g.:
  // if the iframe is specified in the HTML of the page directly). In this
  // case we try to fall-back to something else: documentUrl, originUrl,
  // initiator.
  if (frame === undefined) {
    return context.documentUrl || context.originUrl || context.initiator;
  }

  return frame.url;
}
