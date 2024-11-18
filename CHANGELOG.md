# v5.1.36 (Mon Nov 18 2024)

#### 🐛 Bug Fix

- Request: fix typo [#134](https://github.com/whotracksme/webextension-packages/pull/134) ([@chrmod](https://github.com/chrmod))

#### 🏠 Internal

- Request: remove remote blocking configuration [#133](https://github.com/whotracksme/webextension-packages/pull/133) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.35 (Mon Nov 18 2024)

#### 🐛 Bug Fix

- Request: keys pipeline picks a random tokens if too many [#131](https://github.com/whotracksme/webextension-packages/pull/131) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.34 (Thu Nov 14 2024)

#### 🐛 Bug Fix

- Request: fix token telemetry cleanup [#130](https://github.com/whotracksme/webextension-packages/pull/130) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.33 (Tue Nov 12 2024)

#### 🐛 Bug Fix

- Request: ensure webRequest listeners are ready [#129](https://github.com/whotracksme/webextension-packages/pull/129) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.32 (Tue Nov 12 2024)

#### 🐛 Bug Fix

- Request reporter: simplify stats [#120](https://github.com/whotracksme/webextension-packages/pull/120) ([@chrmod](https://github.com/chrmod))
- Request reporting: remove redirect tagger [#126](https://github.com/whotracksme/webextension-packages/pull/126) ([@chrmod](https://github.com/chrmod))
- Reporting: fix pre-emptive unloading [#125](https://github.com/whotracksme/webextension-packages/pull/125) ([@chrmod](https://github.com/chrmod))

#### 🏠 Internal

- Request: fix tests [#128](https://github.com/whotracksme/webextension-packages/pull/128) ([@chrmod](https://github.com/chrmod))
- Request: redirect tests [#127](https://github.com/whotracksme/webextension-packages/pull/127) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.31 (Fri Nov 08 2024)

#### 🐛 Bug Fix

- Request: fix firefox page store [#123](https://github.com/whotracksme/webextension-packages/pull/123) ([@chrmod](https://github.com/chrmod))

#### 🏠 Internal

- Request: better snapshot tests [#124](https://github.com/whotracksme/webextension-packages/pull/124) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.30 (Thu Nov 07 2024)

#### 🐛 Bug Fix

- Request: simplify page store [#122](https://github.com/whotracksme/webextension-packages/pull/122) ([@chrmod](https://github.com/chrmod))

#### 🏠 Internal

- Request: process webRequest in sync [#121](https://github.com/whotracksme/webextension-packages/pull/121) ([@chrmod](https://github.com/chrmod))
- Improved error handling of anti-tracking lazy initialization [#119](https://github.com/whotracksme/webextension-packages/pull/119) ([@philipp-classen](https://github.com/philipp-classen))
- Request reporter: remove pacemaker [#118](https://github.com/whotracksme/webextension-packages/pull/118) ([@chrmod](https://github.com/chrmod))
- Request reporter: remove Subject abstraction [#116](https://github.com/whotracksme/webextension-packages/pull/116) ([@chrmod](https://github.com/chrmod))
- Marker to keep the context around the 1ms delays [#117](https://github.com/whotracksme/webextension-packages/pull/117) ([@philipp-classen](https://github.com/philipp-classen))
- More snapshot tests [#115](https://github.com/whotracksme/webextension-packages/pull/115) ([@chrmod](https://github.com/chrmod))
- Remove dead code [#113](https://github.com/whotracksme/webextension-packages/pull/113) ([@chrmod](https://github.com/chrmod))
- Reorganise RequestMonitor file structure [#112](https://github.com/whotracksme/webextension-packages/pull/112) ([@chrmod](https://github.com/chrmod))
- Remove WebRequest Pipeline [#111](https://github.com/whotracksme/webextension-packages/pull/111) ([@chrmod](https://github.com/chrmod))

#### Authors: 2

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.29 (Mon Nov 04 2024)

#### 🐛 Bug Fix

- Snapshot tests + keysv2 batching fix [#109](https://github.com/whotracksme/webextension-packages/pull/109) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.28 (Tue Oct 29 2024)

#### 🐛 Bug Fix

- Fix: page store tab active listener [#110](https://github.com/whotracksme/webextension-packages/pull/110) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.27 (Wed Oct 23 2024)

#### 🐛 Bug Fix

- Remove main_frame redirect detection [#108](https://github.com/whotracksme/webextension-packages/pull/108) ([@chrmod](https://github.com/chrmod))

#### 🏠 Internal

- webrequest-pipeline cleanup [#106](https://github.com/whotracksme/webextension-packages/pull/106) ([@chrmod](https://github.com/chrmod))
- PageStore cleanup [#105](https://github.com/whotracksme/webextension-packages/pull/105) ([@chrmod](https://github.com/chrmod))
- PageStore cleanup [#104](https://github.com/whotracksme/webextension-packages/pull/104) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.26 (Wed Oct 02 2024)

#### 🐛 Bug Fix

- Basic tp_events integration test [#103](https://github.com/whotracksme/webextension-packages/pull/103) ([@chrmod](https://github.com/chrmod))
- Preserve "openedFrom" information during redirects that are openend in a new tab. [#97](https://github.com/whotracksme/webextension-packages/pull/97) ([@philipp-classen](https://github.com/philipp-classen))
- Filter out uncommon URLs where the hostname is an IPv4 address. [#101](https://github.com/whotracksme/webextension-packages/pull/101) ([@philipp-classen](https://github.com/philipp-classen))
- Unit test: play pre-recorded events [#98](https://github.com/whotracksme/webextension-packages/pull/98) ([@chrmod](https://github.com/chrmod))

#### Authors: 2

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.25 (Mon Sep 23 2024)

#### 🐛 Bug Fix

- The new tests assume Node 22. Also, upgrade to Ubuntu 24.04. [#100](https://github.com/whotracksme/webextension-packages/pull/100) ([@philipp-classen](https://github.com/philipp-classen))
- Fix page store persistance [#99](https://github.com/whotracksme/webextension-packages/pull/99) ([@chrmod](https://github.com/chrmod))
- Fix storage values [#99](https://github.com/whotracksme/webextension-packages/pull/99) ([@chrmod](https://github.com/chrmod))
- Basic unit test setup [#94](https://github.com/whotracksme/webextension-packages/pull/94) ([@chrmod](https://github.com/chrmod))

#### Authors: 2

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.24 (Fri Sep 13 2024)

#### 🐛 Bug Fix

- When parsing JSON, we should no attempt to extract implicitly [#96](https://github.com/whotracksme/webextension-packages/pull/96) ([@philipp-classen](https://github.com/philipp-classen))
- Test fixed: lifted the unintended dependency on the LANG environment [#95](https://github.com/whotracksme/webextension-packages/pull/95) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.23 (Wed Sep 11 2024)

#### 🐛 Bug Fix

- New builtin: "trim" [#92](https://github.com/whotracksme/webextension-packages/pull/92) ([@philipp-classen](https://github.com/philipp-classen))
- Fix chrome example [#93](https://github.com/whotracksme/webextension-packages/pull/93) ([@chrmod](https://github.com/chrmod))
- Fixes a problem where the in-memory session could not be restored: [#90](https://github.com/whotracksme/webextension-packages/pull/90) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 2

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.22 (Wed Sep 04 2024)

#### 🐛 Bug Fix

- Update web-ext [#91](https://github.com/whotracksme/webextension-packages/pull/91) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.1.21 (Mon Aug 26 2024)

#### 🐛 Bug Fix

- Extend the list of public search engines [#89](https://github.com/whotracksme/webextension-packages/pull/89) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.20 (Thu Aug 01 2024)

#### 🐛 Bug Fix

- Support expansion for plain objects in deduplicator expressions [#86](https://github.com/whotracksme/webextension-packages/pull/86) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.19 (Thu Aug 01 2024)

#### 🐛 Bug Fix

- New builtin: filterExact [#87](https://github.com/whotracksme/webextension-packages/pull/87) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.1.18 (Thu Aug 01 2024)

#### 🐛 Bug Fix

- Abort if a transform rule is not well-formed [#88](https://github.com/whotracksme/webextension-packages/pull/88) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.17 (Mon Jul 08 2024)

#### 🐛 Bug Fix

- Reorganize the codebase [#85](https://github.com/whotracksme/webextension-packages/pull/85) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.0.16 (Mon Jun 10 2024)

#### 🐛 Bug Fix

- Better handling of situation where encoding gets broken after doublefetch [#84](https://github.com/whotracksme/webextension-packages/pull/84) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.15 (Tue Jun 04 2024)

#### 🐛 Bug Fix

- Improve the heuristics for double-fetch on pages where the [#83](https://github.com/whotracksme/webextension-packages/pull/83) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.14 (Thu May 16 2024)

#### 🐛 Bug Fix

- Clean up the handling of "ver" among messages. [#82](https://github.com/whotracksme/webextension-packages/pull/82) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.13 (Mon May 13 2024)

#### 🐛 Bug Fix

- Improves the pattern DSL: [#81](https://github.com/whotracksme/webextension-packages/pull/81) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.12 (Mon Apr 29 2024)

#### 🐛 Bug Fix

- Do not use sub-millisecond resolution for times. [#80](https://github.com/whotracksme/webextension-packages/pull/80) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.11 (Mon Apr 22 2024)

#### 🐛 Bug Fix

- Improve the heuristic that compares URLs before and after double-fetch. [#79](https://github.com/whotracksme/webextension-packages/pull/79) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.10 (Mon Apr 22 2024)

#### 🐛 Bug Fix

- reporting still had an overwrite of linkedom with an old version. [#78](https://github.com/whotracksme/webextension-packages/pull/78) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.9 (Fri Apr 12 2024)

#### 🐛 Bug Fix

- Fixed: do not depend on Array.toString for sorting Object.entries [#77](https://github.com/whotracksme/webextension-packages/pull/77) ([@philipp-classen](https://github.com/philipp-classen))
- * Rename "accumulator" argument in the builtins [#76](https://github.com/whotracksme/webextension-packages/pull/76) ([@philipp-classen](https://github.com/philipp-classen))
- Improvements to patterns and URL detection. Includes [#76](https://github.com/whotracksme/webextension-packages/pull/76) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.8 (Mon Apr 08 2024)

#### ⚠️ Pushed to `main`

- Request reporting ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v5.0.7 (Mon Mar 25 2024)

#### 🐛 Bug Fix

- Update to latest linkedom (fixes empty document.title) [#74](https://github.com/whotracksme/webextension-packages/pull/74) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.6 (Fri Mar 22 2024)

#### 🐛 Bug Fix

- Fixed: empty strings should also be treated as missing titles [#72](https://github.com/whotracksme/webextension-packages/pull/72) ([@philipp-classen](https://github.com/philipp-classen))
- Remove unused fields in the page structure analyzer [#73](https://github.com/whotracksme/webextension-packages/pull/73) ([@philipp-classen](https://github.com/philipp-classen))
- Enable linkedom caching. [#73](https://github.com/whotracksme/webextension-packages/pull/73) ([@philipp-classen](https://github.com/philipp-classen))
- Upgrade linkedom and pako [#73](https://github.com/whotracksme/webextension-packages/pull/73) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.5 (Mon Mar 18 2024)

#### 🐛 Bug Fix

- Improve static URL filtering [#71](https://github.com/whotracksme/webextension-packages/pull/71) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.4 (Wed Mar 13 2024)

#### 🐛 Bug Fix

- Fixed a regression with "auto" [#70](https://github.com/whotracksme/webextension-packages/pull/70) ([@philipp-classen](https://github.com/philipp-classen))
- Requests: backwards compatibility for telemetry messages [#69](https://github.com/whotracksme/webextension-packages/pull/69) ([@chrmod](https://github.com/chrmod))
- Improved alive messages [#68](https://github.com/whotracksme/webextension-packages/pull/68) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 2

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.3 (Wed Feb 14 2024)

#### 🐛 Bug Fix

- Improve sanitizers [#67](https://github.com/whotracksme/webextension-packages/pull/67) ([@philipp-classen](https://github.com/philipp-classen))
- Fixed missing redirects [#66](https://github.com/whotracksme/webextension-packages/pull/66) ([@philipp-classen](https://github.com/philipp-classen))
- Limit assumption about browser APIs [#65](https://github.com/whotracksme/webextension-packages/pull/65) ([@philipp-classen](https://github.com/philipp-classen))
- Reporting: fix example [#62](https://github.com/whotracksme/webextension-packages/pull/62) ([@chrmod](https://github.com/chrmod))

#### Authors: 2

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.2 (Wed Feb 07 2024)

#### 🐛 Bug Fix

- Improve logging [#64](https://github.com/whotracksme/webextension-packages/pull/64) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.1 (Tue Feb 06 2024)

#### 🐛 Bug Fix

- Fixed: detect more types of opaque requests in doublefetch [#63](https://github.com/whotracksme/webextension-packages/pull/63) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v5.0.0 (Mon Feb 05 2024)

#### 💥 Breaking Change

- wtm.page messages [#61](https://github.com/whotracksme/webextension-packages/pull/61) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v4.0.6 (Wed Dec 13 2023)

#### 🐛 Bug Fix

- Fix compatibility list check [#60](https://github.com/whotracksme/webextension-packages/pull/60) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v4.0.5 (Tue Oct 10 2023)

#### 🐛 Bug Fix

- Fix stats leakage [#58](https://github.com/whotracksme/webextension-packages/pull/58) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v4.0.4 (Tue Oct 03 2023)

#### ⚠️ Pushed to `main`

- Fix type in oAuthDetector ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v4.0.3 (Tue Sep 19 2023)

#### 🐛 Bug Fix

- Naming consistency (request-reporter != url-reporter) [#57](https://github.com/whotracksme/webextension-packages/pull/57) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v4.0.2 (Mon Sep 18 2023)

#### 🐛 Bug Fix

- Introduce new messages for MV3 anti-tracking. [#56](https://github.com/whotracksme/webextension-packages/pull/56) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v4.0.1 (Wed Sep 13 2023)

#### 🐛 Bug Fix

- Added "json" primitive to handle JSON data [#53](https://github.com/whotracksme/webextension-packages/pull/53) ([@philipp-classen](https://github.com/philipp-classen))
- Only warn once about missing listeners [#55](https://github.com/whotracksme/webextension-packages/pull/55) ([@philipp-classen](https://github.com/philipp-classen))
- fixed: unload should not throw if it called before the object is initialized [#54](https://github.com/whotracksme/webextension-packages/pull/54) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v4.0.0 (Tue Sep 05 2023)

#### 💥 Breaking Change

- Clean up `trackers-preview` and `prevent-serp-tracking` [#52](https://github.com/whotracksme/webextension-packages/pull/52) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v3.1.0 (Fri Sep 01 2023)

#### 🚀 Enhancement

- Cleanup [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- ChromeStorageMap check ttl on get [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- ChromeStorageMap stored in chrome.storage.session [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Bring back TempSet [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Backporting fixes from ghostery/common [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- WebRequestPipeline MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- CnameUnloak MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Remove SerializableMap [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Remove SerializableSet [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Await chrome storage maps and sets [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Cleanup and fix page-logger [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Remove DefaultMap [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Clean Firefox manifest for example extension [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- TokenTelemetry MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Reorganise token-telemetry [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- reorganise token checker [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- TokenDomain MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- TokenExaminer MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Replace TempSet with ChromeStorageSet [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- General purpose stored Map and Set [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- PageLogger MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- CookieContext MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Oauth-detector MV3 ready [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Expose time constants [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Encapsulate currentDay logic [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))
- Non persistant background for firefox example [#51](https://github.com/whotracksme/webextension-packages/pull/51) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v3.0.2 (Tue Aug 08 2023)

#### 🐛 Bug Fix

- Trackers preview: fix search results selector [#49](https://github.com/whotracksme/webextension-packages/pull/49) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v3.0.1 (Thu Aug 03 2023)

#### 🐛 Bug Fix

- Update auto [#48](https://github.com/whotracksme/webextension-packages/pull/48) ([@chrmod](https://github.com/chrmod))
- Fix reporting dependencies [#47](https://github.com/whotracksme/webextension-packages/pull/47) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v3.0.0 (Thu Aug 03 2023)

#### 💥 Breaking Change

- Import Anti-Tracking codebase [#44](https://github.com/whotracksme/webextension-packages/pull/44) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v2.1.7 (Tue Jul 18 2023)

#### 🐛 Bug Fix

- Update tldts to the latest version [#46](https://github.com/whotracksme/webextension-packages/pull/46) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v2.1.6 (Tue May 23 2023)

#### 🐛 Bug Fix

- Improve the heuristic to decide whether queries are safe to share [#45](https://github.com/whotracksme/webextension-packages/pull/45) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v2.1.5 (Fri Jan 27 2023)

#### 🐛 Bug Fix

- Fixed: caching keys didn't work since chrome.local doesn't support [#43](https://github.com/whotracksme/webextension-packages/pull/43) ([@philipp-classen](https://github.com/philipp-classen))
- Support more search pages [#42](https://github.com/whotracksme/webextension-packages/pull/42) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v2.1.4 (Wed Jan 11 2023)

#### ⚠️ Pushed to `main`

- Fix trackers-preview iframe styling ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v2.1.3 (Mon Jan 09 2023)

#### 🐛 Bug Fix

- Improve the test suite runner ("." should not match any char and [#41](https://github.com/whotracksme/webextension-packages/pull/41) ([@philipp-classen](https://github.com/philipp-classen))
- Update the comment in ProxiedHttp [#39](https://github.com/whotracksme/webextension-packages/pull/39) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v2.1.2 (Wed Dec 14 2022)

#### 🐛 Bug Fix

- Trackers Preview: fix import of pre-generated data [#40](https://github.com/whotracksme/webextension-packages/pull/40) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v2.1.1 (Thu Dec 08 2022)

#### 🐛 Bug Fix

- Adds functional tests, including optionally running external test [#38](https://github.com/whotracksme/webextension-packages/pull/38) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v2.1.0 (Thu Dec 01 2022)

#### 🚀 Enhancement

- Backport 0.4 changes [#37](https://github.com/whotracksme/webextension-packages/pull/37) ([@chrmod](https://github.com/chrmod) [@smalluban](https://github.com/smalluban))

#### 🐛 Bug Fix

- Fix trackers-preview iframe UI [#35](https://github.com/whotracksme/webextension-packages/pull/35) ([@smalluban](https://github.com/smalluban))

#### Authors: 2

- Dominik Lubański ([@smalluban](https://github.com/smalluban))
- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v2.0.1 (Thu Dec 01 2022)

#### 🐛 Bug Fix

- Fixed: URL#protocol ends with trailing colon [#36](https://github.com/whotracksme/webextension-packages/pull/36) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v2.0.0 (Thu Nov 17 2022)

#### 💥 Breaking Change

- Integrate reporting in Ghostery (Manifest V3) [#31](https://github.com/whotracksme/webextension-packages/pull/31) ([@philipp-classen](https://github.com/philipp-classen))

#### 🐛 Bug Fix

- Update README.md [#34](https://github.com/whotracksme/webextension-packages/pull/34) ([@chrmod](https://github.com/chrmod))

#### Authors: 2

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v1.0.0 (Wed Nov 16 2022)

#### 💥 Breaking Change

- Integrate reporting in Ghostery (Manifest V3) [#31](https://github.com/whotracksme/webextension-packages/pull/31) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v0.4.8 (Wed Nov 16 2022)

#### 🐛 Bug Fix

- Use native fetch [#28](https://github.com/whotracksme/webextension-packages/pull/28) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v0.4.7 (Wed Nov 16 2022)

#### 🐛 Bug Fix

- Fix regression in the Github release hook [#33](https://github.com/whotracksme/webextension-packages/pull/33) ([@philipp-classen](https://github.com/philipp-classen))
- Avoid parsing the trackers-preview-data on each startup. Instead ship [#30](https://github.com/whotracksme/webextension-packages/pull/30) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v0.4.6 (Tue Nov 15 2022)

#### 🐛 Bug Fix

- Add dependencies of reporting [#32](https://github.com/whotracksme/webextension-packages/pull/32) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v0.4.5 (Fri Oct 14 2022)

#### 🐛 Bug Fix

- Show errors when rendering the tracker preview [#29](https://github.com/whotracksme/webextension-packages/pull/29) ([@philipp-classen](https://github.com/philipp-classen))

#### Authors: 1

- Philipp Claßen ([@philipp-classen](https://github.com/philipp-classen))

---

# v0.4.4 (Thu Oct 13 2022)

#### 🐛 Bug Fix

- Remove dexie [#27](https://github.com/whotracksme/webextension-packages/pull/27) ([@chrmod](https://github.com/chrmod))
- Improve the storage key prefixes [#27](https://github.com/whotracksme/webextension-packages/pull/27) ([@chrmod](https://github.com/chrmod))
- Decuple code and competences of anonymouse-credentials and reporting [#27](https://github.com/whotracksme/webextension-packages/pull/27) ([@chrmod](https://github.com/chrmod))
- New package: reporting [#27](https://github.com/whotracksme/webextension-packages/pull/27) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v0.4.3 (Fri Sep 02 2022)

#### 🐛 Bug Fix

- Remove unused dependencies [#26](https://github.com/whotracksme/webextension-packages/pull/26) ([@smalluban](https://github.com/smalluban))

#### ⚠️ Pushed to `main`

- [trackers-preview] remove unused `setupCtx` ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.4.2 (Thu Sep 01 2022)

#### ⚠️ Pushed to `main`

- Merge branch 'main' of github.com:whotracksme/webextension-packages ([@smalluban](https://github.com/smalluban))
- Fix google search result anchor selector ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.4.1 (Thu Sep 01 2022)

#### ⚠️ Pushed to `main`

- Move height observer back to the trackers-preview package ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.4.0 (Thu Sep 01 2022)

#### 🚀 Enhancement

- Remove ui from the trackers-preview package [#25](https://github.com/whotracksme/webextension-packages/pull/25) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.3.2 (Fri Jul 15 2022)

#### ⚠️ Pushed to `main`

- Update ghostery/ui ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.3.1 (Mon May 16 2022)

#### 🐛 Bug Fix

- Update ghostery UI [#24](https://github.com/whotracksme/webextension-packages/pull/24) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.3.0 (Mon May 16 2022)

#### 🚀 Enhancement

- Move out the ui and use bare imports [#23](https://github.com/whotracksme/webextension-packages/pull/23) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.2.6 (Thu Apr 07 2022)

#### ⚠️ Pushed to `main`

- Force push trackers preview data to npm package ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.2.5 (Wed Apr 06 2022)

#### 🐛 Bug Fix

- Use new source for trackers-preview data [#22](https://github.com/whotracksme/webextension-packages/pull/22) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.2.4 (Tue Apr 05 2022)

#### 🐛 Bug Fix

- fix: account for message.data any type [#20](https://github.com/whotracksme/webextension-packages/pull/20) ([@chris-perts](https://github.com/chris-perts))

#### Authors: 1

- [@chris-perts](https://github.com/chris-perts)

---

# v0.2.3 (Tue Apr 05 2022)

#### 🐛 Bug Fix

- Add missing dexie dependency [#21](https://github.com/whotracksme/webextension-packages/pull/21) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.2.2 (Fri Apr 01 2022)

#### 🐛 Bug Fix

- New package: anonymous-communication [#18](https://github.com/whotracksme/webextension-packages/pull/18) ([@chrmod](https://github.com/chrmod))

#### Authors: 1

- Krzysztof Modras ([@chrmod](https://github.com/chrmod))

---

# v0.2.1 (Mon Mar 21 2022)

#### 🐛 Bug Fix

- Close popup when user clicks on a link [#17](https://github.com/whotracksme/webextension-packages/pull/17) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.2.0 (Thu Mar 03 2022)

#### 🚀 Enhancement

- Add support for mobile Firefox old layout for google [#14](https://github.com/whotracksme/webextension-packages/pull/14) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.1.5 (Wed Feb 23 2022)

#### 🐛 Bug Fix

- Use relative paths for vite support [#12](https://github.com/whotracksme/webextension-packages/pull/12) ([@smalluban](https://github.com/smalluban))

#### Authors: 1

- Dominik Lubański ([@smalluban](https://github.com/smalluban))

---

# v0.1.1 (Wed Feb 23 2022)

#### 🐛 Bug Fix

- Release automation [#13](https://github.com/whotracksme/webextension-packages/pull/13) ([@chrmod](https://github.com/chrmod))
- Add eslint & prettier [#11](https://github.com/whotracksme/webextension-packages/pull/11) ([@smalluban](https://github.com/smalluban))
- Update components for hybrids v7 [#8](https://github.com/whotracksme/webextension-packages/pull/8) ([@smalluban](https://github.com/smalluban))
- Version bump ([@chrmod](https://github.com/chrmod))
- Add option to disable trackers preview from the iframe directly [#7](https://github.com/whotracksme/webextension-packages/pull/7) ([@smalluban](https://github.com/smalluban))

#### Authors: 2

- Dominik Lubański ([@smalluban](https://github.com/smalluban))
- Krzysztof Modras ([@chrmod](https://github.com/chrmod))
