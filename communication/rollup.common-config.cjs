const { nodeResolve } = require('@rollup/plugin-node-resolve');
const sourcemaps = require('rollup-plugin-sourcemaps');
const nodePolyfills = require('rollup-plugin-polyfill-node');

module.exports = {
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
};
