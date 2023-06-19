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

import logger from '../logger';

export const VALID_RESPONSE_PROPERTIES = {
  onBeforeRequest: ['cancel', 'redirectUrl'],
  onBeforeSendHeaders: ['cancel', 'requestHeaders'],
  onHeadersReceived: ['cancel', 'redirectUrl', 'responseHeaders'],
  onAuthRequired: ['cancel'],
  onBeforeRedirect: [],
  onCompleted: [],
  onErrorOccurred: [],
};

const manifest = chrome.runtime.getManifest();

function getOptionArray(options) {
  if (!options) {
    return [];
  }
  // get subset of options which are defined
  const optionsSubset = [
    // firefox and chrome disagree on how to name these
    options.REQUEST_HEADERS || options.REQUESTHEADERS,
    options.RESPONSE_HEADERS || options.RESPONSEHEADERS,
    // extra headers: Chrome 72:
    // https://groups.google.com/a/chromium.org/forum/#!topic/chromium-extensions/vYIaeezZwfQ
    options.EXTRA_HEADERS,
    // request body disabled to avoid the overhead when not needed
    // options.REQUEST_BODY,
  ];

  if (manifest.permissions.includes('webRequestBlocking')) {
    optionsSubset.push(options.BLOCKING);
  }

  return optionsSubset.filter((o) => !!o);
}

// build allowed extraInfo options from <Step>Options objects.
export const EXTRA_INFO_SPEC = {
  onBeforeRequest: getOptionArray(chrome.webRequest.OnBeforeRequestOptions),
  onBeforeSendHeaders: getOptionArray(
    chrome.webRequest.OnBeforeSendHeadersOptions,
  ),
  onHeadersReceived: getOptionArray(chrome.webRequest.OnHeadersReceivedOptions),
  onAuthRequired: getOptionArray(chrome.webRequest.OnAuthRequiredOptions),
  onBeforeRedirect: getOptionArray(chrome.webRequest.OnBeforeRedirectOptions),
  onCompleted: getOptionArray(chrome.webRequest.OnCompletedOptions),
  onErrorOccurred: undefined,
};

const HANDLERS = {};
const urls = ['http://*/*', 'https://*/*'];

for (const event of Object.keys(EXTRA_INFO_SPEC)) {
  // It might be that the platform does not support all listeners:
  if (chrome.webRequest[event] === undefined) {
    logger.warn(`chrome.webRequest.${event} is not supported`);
    continue;
  }

  // Get allowed options for this event (e.g.: 'blocking', 'requestHeaders',
  // etc.)
  const extraInfoSpec = EXTRA_INFO_SPEC[event];

  const callback = (...args) => {
    if (!HANDLERS[event]) {
      logger.info(`webRequest.${event} called without listener being assigned`);
      return;
    }
    return HANDLERS[event](...args);
  };

  if (extraInfoSpec === undefined) {
    chrome.webRequest[event].addListener(callback, { urls });
  } else {
    chrome.webRequest[event].addListener(callback, { urls }, extraInfoSpec);
  }
}

export function addListener(event, listener) {
  if (HANDLERS[event]) {
    throw new Error(
      `webRequest.${event} expects only one listener as this all WebRequestPipeline should need`,
    );
  }
  HANDLERS[event] = listener;
}

export function removeListener(event, listener) {
  if (HANDLERS[event] !== listener) {
    throw new Error(`webRequest.${event} trying to remove wrong listener`);
  }
  HANDLERS[event] = null;
}
