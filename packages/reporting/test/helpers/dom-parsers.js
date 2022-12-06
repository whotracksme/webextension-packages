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

import * as linkedom from 'linkedom';

/**
 * Different implementations of the DOM API.
 *
 * In most cases, all should be close to the browser API, but in edge
 * cases like broken HTML, the results may differ. If possible, we
 * should write code in such a way that works well in all environments.
 */
export const mockDocumentWith = {
  // https://github.com/WebReflection/linkedom
  linkedom(html) {
    const { window, document } = linkedom.parseHTML(html);
    const noop = () => {};
    window.close = window.close || noop;
    return { window, document };
  },
};

export const allAvailableParsers = Object.keys(mockDocumentWith);
export const allSupportedParsers = allAvailableParsers;
