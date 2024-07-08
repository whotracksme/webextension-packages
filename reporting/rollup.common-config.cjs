const { nodeResolve } = require('@rollup/plugin-node-resolve');
const sourcemaps = require('rollup-plugin-sourcemaps');
const nodePolyfills = require('rollup-plugin-polyfill-node');
const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');

module.exports = {
  plugins: [nodePolyfills(), nodeResolve(), sourcemaps(), commonjs(), json()],
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
};
