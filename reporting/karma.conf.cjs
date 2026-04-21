const rollupPreprocessor = require('./rollup.common-config.cjs');

module.exports = function (config) {
  const entry = process.env.KARMA_TEST_ENTRY || 'test/index.js';
  config.set({
    frameworks: ['mocha', 'chai', 'sinon'],
    files: [{ pattern: entry, watched: false }],
    preprocessors: {
      [entry]: ['rollup'],
    },
    reporters: ['mocha'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    concurrency: 0,
    rollupPreprocessor,
    client: {
      TEST_FIXTURES_URL: process.env.TEST_FIXTURES_URL, // for test/search-extractor.spec.js
      REPLAY_FIXTURES_URL: process.env.REPLAY_FIXTURES_URL, // for test/pages.spec.js
      VERBOSE_REPLAY: process.env.VERBOSE_REPLAY, // for test/pages.spec.js (better debugging)
      ENABLE_SELF_CHECKS: process.env.ENABLE_SELF_CHECKS, // for test/pages.spec.js (might catch different bugs)
    },
  });
};
