import { recordMouseDown } from '../src/request/content-script.js';

window.addEventListener('mousedown', (ev) => {
  const { event, context, href } = recordMouseDown(ev);
  chrome.runtime.sendMessage({
    action: 'mousedown',
    event,
    context,
    href,
  });
});

window.addEventListener('message', (ev) => {
  const data = ev.data;
  if (!data || data.source !== 'wtm-e2e' || ev.source !== window) return;
  chrome.runtime.sendMessage(
    { action: 'e2e', id: data.id, op: data.op, args: data.args },
    (response) => {
      window.postMessage(
        {
          source: 'wtm-e2e-response',
          id: data.id,
          ok: !chrome.runtime.lastError,
          error: chrome.runtime.lastError?.message,
          response,
        },
        '*',
      );
    },
  );
});
