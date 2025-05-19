chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen:urlReporting') {
    return;
  }

  if (message.type === 'request') {
    const url = message.data?.url;
    if (!url) {
      sendResponse({ ok: false, error: 'missing URL' });
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.credentialless = true;
    iframe.src = url;
    document.body.appendChild(iframe);

    sendResponse({ ok: true });
    return;
  }

  sendResponse({ ok: false, error: 'unexpected message type' });
});
