const rollupPreprocessor = require('./rollup.common-config.cjs');

module.exports = function (config) {
  config.set({
    frameworks: ['mocha', 'chai', 'sinon'],
    files: [{ pattern: 'test/index.js', watched: false }],
    preprocessors: {
      'test/index.js': ['rollup'],
    },
    reporters: ['mocha'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    concurrency: 0,
    rollupPreprocessor,
    client: {
      TEST_FIXTURES_URL: process.env.TEST_FIXTURES_URL,
    }
  });
};
