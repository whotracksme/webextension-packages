# WhoTracks.Me report on SERP

This is WebExtension library to render WTM report on Search Engine Result Pages like google.com.

## Integrations with WebExtension

Copy `src` folder to `/vendor/@whotracksme/serp-report/src`.

Copy contents of manifest-v2.json or manifest-v3.json to the host WebExtension manifest.json.

Update import path accordingly.

in service worker `browser.runtime.onMessage` listener add:

```js
  if (tryWTMReportOnMessageHandler(msg, sender, sendResponse)) {
    return false;
  }
```

### Manifest V3

in service worker `index.js`:

```js
  importScripts('/vendor/@whotracksme/serp-report/src/background/data.js');
  importScripts('/vendor/@whotracksme/serp-report/src/background/index.js');
```
