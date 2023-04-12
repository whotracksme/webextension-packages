/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export const VALID_RESPONSE_PROPERTIES = {
  onBeforeRequest: ['cancel', 'redirectUrl'],
  onBeforeSendHeaders: ['cancel', 'requestHeaders'],
  onSendHeaders: [],
  onHeadersReceived: ['cancel', 'redirectUrl', 'responseHeaders'],
  onAuthRequired: ['cancel'],
  onResponseStarted: [],
  onBeforeRedirect: [],
  onCompleted: [],
  onErrorOccurred: [],
};

// TODO @chrmod: allow non blocking pipeline
// const VALID_RESPONSE_PROPERTIES = {
//   onBeforeRequest: [],
//   onBeforeSendHeaders: [],
//   onSendHeaders: [],
//   onHeadersReceived: [],
//   onAuthRequired: [],
//   onResponseStarted: [],
//   onBeforeRedirect: [],
//   onCompleted: [],
//   onErrorOccurred: [],
// };

function getOptionArray(options) {
  if (!options) {
    return [];
  }
  // get subset of options which are defined
  return [
    options.BLOCKING,
    // firefox and chrome disagree on how to name these
    options.REQUEST_HEADERS || options.REQUESTHEADERS,
    options.RESPONSE_HEADERS || options.RESPONSEHEADERS,
    // extra headers: Chrome 72:
    // https://groups.google.com/a/chromium.org/forum/#!topic/chromium-extensions/vYIaeezZwfQ
    options.EXTRA_HEADERS,
    // request body disabled to avoid the overhead when not needed
    // options.REQUEST_BODY,
  ].filter((o) => !!o);
}

// build allowed extraInfo options from <Step>Options objects.
export const EXTRA_INFO_SPEC = {
  onBeforeRequest: getOptionArray(chrome.webRequest.OnBeforeRequestOptions),
  onBeforeSendHeaders: getOptionArray(
    chrome.webRequest.OnBeforeSendHeadersOptions,
  ),
  onSendHeaders: getOptionArray(chrome.webRequest.OnSendHeadersOptions),
  onHeadersReceived: getOptionArray(chrome.webRequest.OnHeadersReceivedOptions),
  onAuthRequired: getOptionArray(chrome.webRequest.OnAuthRequiredOptions),
  onResponseStarted: getOptionArray(chrome.webRequest.OnResponseStartedOptions),
  onBeforeRedirect: getOptionArray(chrome.webRequest.OnBeforeRedirectOptions),
  onCompleted: getOptionArray(chrome.webRequest.OnCompletedOptions),
  onErrorOccurred: undefined,
};
// TODO @chrmod: make blocking optional
// export const EXTRA_INFO_SPEC = {
//   onBeforeRequest: [],
//   onBeforeSendHeaders: [],
//   onSendHeaders: [],
//   onHeadersReceived: [],
//   onAuthRequired: ['responseHeaders'],
//   onResponseStarted: ['responseHeaders'],
//   onBeforeRedirect: ['responseHeaders'],
//   onCompleted: ['responseHeaders'],
//   onErrorOccurred: undefined,
// };
