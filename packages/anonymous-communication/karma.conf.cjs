const rollupPreprocessor = require('./rollup.common-config.cjs');

module.exports = function (config) {
  config.set({
    frameworks: ['mocha', 'chai', 'sinon'],
    files: [{ pattern: 'test/**/*.spec.js', watched: false }],
    preprocessors: {
      'test/**/*.spec.js': ['rollup'],
    },
    reporters: ['mocha'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    browsers: ['ChromeHeadless'],
    autoWatch: false,
    concurrency: 0,
    rollupPreprocessor,
  });
};
