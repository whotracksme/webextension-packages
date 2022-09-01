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

### HTML Iframe Page

```js
import { getStats, close, disable } from "@whotracksme/webextension-packages/packages/trackers-preview/page_scripts";

// Display information, and use close and disable signals
...
```
