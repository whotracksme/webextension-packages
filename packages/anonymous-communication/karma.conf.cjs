const { nodeResolve } = require('@rollup/plugin-node-resolve');
const sourcemaps = require('rollup-plugin-sourcemaps');
const nodePolyfills = require('rollup-plugin-polyfill-node');

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
    rollupPreprocessor: {
      plugins: [nodePolyfills(), nodeResolve(), sourcemaps()],
      external: ['chai', 'sinon'],
      output: {
        globals: {
          chai: 'chai',
          sinon: 'sinon',
        },
        format: 'iife',
        name: 'Test',
        sourcemap: 'inline',
      },
    },
  });
};
