# `@whotracksme/serp-report`

> Renders WTM report on Search Engine Result Pages of the google.com

## Setup

In your background process add the following lines:

```js
import tryWTMReportOnMessageHandler from '/vendor/@whotracksme/serp-report/background/serp-report.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // other stuff ...

  if (tryWTMReportOnMessageHandler(msg, sender, sendResponse)) {
    return false;
  }
});
```
