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
