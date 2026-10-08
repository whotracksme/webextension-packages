const { nodeResolve } = require('@rollup/plugin-node-resolve');
const sourcemaps = require('rollup-plugin-sourcemaps');
const nodePolyfills = require('rollup-plugin-polyfill-node');
const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');

// rollup-plugin-sourcemaps reads every file itself; since rollup 3, plugin-loaded
// files are only watched when the plugin registers them, so without this wrapper
// `npm run watch` never rebuilds. Register every file the plugin loads.
function sourcemapsWithWatch() {
  const plugin = sourcemaps();
  return {
    ...plugin,
    async load(id) {
      const result = await plugin.load.call(this, id);
      if (result != null) {
        this.addWatchFile(id);
      }
      return result;
    },
  };
}

module.exports = {
  plugins: [
    nodePolyfills(),
    nodeResolve(),
    sourcemapsWithWatch(),
    commonjs({ strictRequires: ['**/cssom/**'] }),
    json(),
  ],
  external: ['sinon'],
  output: {
    globals: {
      sinon: 'sinon',
    },
    format: 'iife',
    name: 'Test',
    sourcemap: 'inline',
  },
};
