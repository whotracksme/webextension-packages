# @whotracksme/trackers-preview

## Setup

To add the trackers preview feature you must add an background script, content script for the `google.*` domains, and create an html page for displaying the popup:

### Background

```js
import {
  tryWTMReportOnMessageHandler,
  isDisableWTMReportMessage,
} from '@whotracksme/webextension-packages/packages/trackers-preview/background';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ...

  if (tryWTMReportOnMessageHandler(msg, sender, sendResponse)) {
    return false;
  }

  if (isDisableWTMReportMessage(msg)) {
    // disable the feature ...

    return false;
  }
});
```

### Content Scripts

```js
import setupTrackersPreview from '@whotracksme/webextension-packages/packages/trackers-preview/content_scripts';

setupTrackersPreview(
  chrome.runtime.getURL('...'), // PATH_TO_HTML_PAGE
);
```

### HTML Page

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Whotracks.me Report</title>
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"
    />
    <meta content="text/html;charset=utf-8" http-equiv="Content-Type" />
    <meta content="utf-8" http-equiv="encoding" />
    <script src="./index.js" type="module" async></script>
  </head>
  <body>
    <wtm-trackers-preview></wtm-trackers-preview>
  </body>
</html>
```

```js
import '@ghostery/ui/css';
import '@whotracksme/webextension-packages/packages/trackers-preview/components';
```
