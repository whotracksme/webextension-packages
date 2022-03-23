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

const WRAPPER_CLASS = 'wtm-popup-iframe-wrapper';

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

function closePopups() {
  [...document.querySelectorAll(`.${WRAPPER_CLASS}`)].forEach((popup) => {
    popup.parentElement.removeChild(popup);
  });
}

function resizePopup(height) {
  [...document.querySelectorAll(`.${WRAPPER_CLASS}`)].forEach((popup) => {
    popup.style.height = `${height}px`;
  });
}

const getTop = (el) =>
  el.offsetTop + (el.offsetParent && getTop(el.offsetParent));

function renderPopup(container, stats) {
  closePopups();

  const wrapper = document.createElement('div');
  wrapper.classList.add(WRAPPER_CLASS);
  if (isMobile) {
    wrapper.style.width = window.innerWidth - 20 + 'px';
    wrapper.style.left = '10px';
  } else {
    const left = container.getBoundingClientRect().left - 350 / 2 + 12;
    wrapper.style.left = (left < 20 ? 20 : left) + 'px';
  }
  wrapper.style.top = getTop(container) + 25 + 'px';

  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'src',
    chrome.runtime.getURL(
      `vendor/@whotracksme/serp-report/src/pages/iframe/index.html?domain=${stats.domain}`,
    ),
  );

  wrapper.appendChild(iframe);
  document.body.appendChild(wrapper);
}

function getWheelElement(WTMTrackerWheel, stats) {
  const count = stats.stats.length;

  if (count === 0) {
    return null;
  }

  const container = document.createElement('div');
  container.classList.add('wtm-tracker-wheel-container');

  const label = document.createElement('label');
  label.innerText = count;

  const canvas = document.createElement('canvas');
  canvas.classList.add('wtm-tracker-wheel');

  const ctx = canvas.getContext('2d');
  WTMTrackerWheel.setupCtx(ctx, 16);
  WTMTrackerWheel.draw(ctx, 16, stats.stats);

  container.appendChild(canvas);
  container.appendChild(label);

  container.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopImmediatePropagation();

    renderPopup(container, stats);
  });

  return container;
}

function removeWheel(anchor) {
  const container = anchor.parentElement.querySelector(
    '.wtm-tracker-wheel-container',
  );
  if (container) {
    container.parentElement.removeChild(container);
  }
}

(async function () {
  const elements = [
    ...window.document.querySelectorAll(
      '#main div.g div.yuRUbf > a, div.mnr-c.xpd.O9g5cc.uUPGi a.cz3goc, .ZINbbc > div:first-child a',
    ),
  ];

  if (elements.length) {
    const { default: WTMTrackerWheel } = await import(
      chrome.runtime.getURL('vendor/@whotracksme/ui/src/tracker-wheel.js')
    );

    const links = elements.map((el) => {
      if (el.hostname === window.location.hostname) {
        const url = new URL(el.href);
        return url.searchParams.get('url') || url.searchParams.get('q');
      }
      return el.href;
    });

    chrome.runtime.sendMessage(
      { action: 'getWTMReport', links },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            'Could not retrieve WTM information on URLs',
            chrome.runtime.lastError,
          );
          return;
        }

        document.addEventListener('click', (event) => {
          let el = event.target;
          while (el && !el.href) el = el.parentElement;

          if (!el) return;

          closePopups();
        });

        elements.forEach((anchor, i) => {
          const stats = response.wtmStats[i];
          if (stats) {
            try {
              const wheelEl = getWheelElement(WTMTrackerWheel, stats);
              if (!wheelEl) return;

              const parent = anchor.parentElement;

              const container =
                // Desktop flat
                parent.querySelector('.B6fmyf') ||
                // Mobile flat
                anchor.querySelector('div[role="link"]') ||
                // Mobile cards
                anchor.querySelector('div.UPmit.AP7Wnd');

              let tempEl = container.firstElementChild;
              if (tempEl && tempEl.textContent.includes(stats.domain)) {
                container.insertBefore(wheelEl, tempEl.nextElementSibling);
              } else {
                container.appendChild(wheelEl);
              }
            } catch (e) {
              // ignore errors
            }
          }
        });
      },
    );

    window.addEventListener('message', (message) => {
      if (message.origin + '/' !== chrome.runtime.getURL('/').toLowerCase()) {
        return;
      }

      if (message.data === 'WTMReportClosePopups') {
        closePopups();
        return;
      }

      if (message.data === 'WTMReportDisable') {
        closePopups();
        elements.forEach(removeWheel);
        chrome.runtime.sendMessage({ action: 'disableWTMReport' });
        return;
      }

      if (
        typeof message.data === 'string' &&
        message.data.startsWith('WTMReportResize')
      ) {
        const height = message.data.split(':')[1];
        resizePopup(height);
        return;
      }
    });
  }
})();
