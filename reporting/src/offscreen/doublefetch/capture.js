// Content script for a dynamic double-fetch step: sends back the rendered DOM.
(() => {
  const TARGET = 'doublefetch:capture';

  // Avoid performance bugs if pages are extremely large (>10MB).
  const MAX_HTML_LENGTH = 10 * 1024 * 1024;

  // This script is registered for the whole domain while a step runs, so it can
  // also land in a page that the user opened. Only the credentialless iframe
  // may be read: "credentialless" is false in the user's tabs, and since the
  // flag is inherited by nested iframes, also check that this is the document
  // the offscreen document embedded (a direct child of the top document).
  if (
    window.credentialless !== true ||
    window === window.top ||
    window.parent !== window.top
  ) {
    return;
  }

  let done = false;
  const send = (message) =>
    chrome.runtime.sendMessage({ target: TARGET, ...message }).catch(() => {
      // nobody is listening anymore
      done = true;
    });

  // When to capture the HTML? Once all selectors match. With no selectors,
  // right away, because then the delay is the whole wait. With no delay
  // either, at the load event, because before that the document is empty.
  const whenReady = (waitFor, delay, callback) => {
    if (waitFor.length === 0) {
      if (delay > 0 || document.readyState === 'complete') {
        callback();
      } else {
        window.addEventListener('load', callback, { once: true });
      }
      return;
    }

    const isReady = () => waitFor.every((x) => document.querySelector(x));
    if (isReady()) {
      callback();
      return;
    }
    const observer = new MutationObserver(() => {
      if (isReady()) {
        observer.disconnect();
        callback();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  };

  send({ type: 'config', url: location.href })
    .then((config) => {
      if (!config || done) {
        return;
      }
      const { waitFor = [], delay = 0 } = config;
      whenReady(waitFor, delay, () => {
        // A selector can match before the element is finished filling in.
        setTimeout(() => {
          if (!done) {
            done = true;
            const html = document.documentElement.outerHTML;
            if (html.length <= MAX_HTML_LENGTH) {
              send({ type: 'content', html });
            } else {
              send({
                type: 'permanent-error',
                code: 'too-large',
                details: { length: html.length },
              });
            }
          }
        }, delay);
      });
    })
    .catch((e) => {
      // The configuration cannot be used (for instance, it could contain a
      // selector that is not valid CSS). A retry will not fix that.
      done = true;
      send({
        type: 'permanent-error',
        code: 'bad-config',
        details: { message: `${e}` },
      });
    });
})();
