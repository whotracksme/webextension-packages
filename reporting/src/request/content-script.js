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

export function recordMouseDown(ev) {
  function getContextHTML(ev) {
    let target = ev.target;
    let html;

    try {
      for (let count = 0; count < 5; count += 1) {
        html = target.innerHTML;

        if (html.indexOf('http://') !== -1 || html.indexOf('https://') !== -1) {
          return html;
        }

        target = target.parentNode;

        count += 1;
      }
    } catch (ee) {
      console.warn('WTM Reporting: failed to record context from mousedown');
    }

    return undefined;
  }

  const linksSrc = [];
  if (window.parent !== window) {
    // collect srcipt links only for frames
    if (window.document && window.document.scripts) {
      for (let i = 0; i < window.document.scripts.length; i += 1) {
        const src = window.document.scripts[i].src;
        if (src.startsWith('http')) {
          linksSrc.push(src);
        }
      }
    }
  }

  let node = ev.target;
  if (node.nodeType !== 1) {
    node = node.parentNode;
  }

  let href = null;

  if (node.closest('a[href]')) {
    href = node.closest('a[href]').getAttribute('href');
  }

  const event = {
    target: {
      baseURI: ev.target.baseURI,
      value: ev.target.value,
      href: ev.target.href,
      parentNode: {
        href: ev.target.parentNode ? ev.target.parentNode.href : null,
      },
      linksSrc,
    },
  };

  return {
    event,
    context: getContextHTML(ev),
    href,
  };
}
