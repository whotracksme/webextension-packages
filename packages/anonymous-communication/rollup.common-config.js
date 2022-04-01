import { nodeResolve } from '@rollup/plugin-node-resolve';
import sourcemaps from 'rollup-plugin-sourcemaps';
import nodePolyfills from 'rollup-plugin-polyfill-node';

export default {
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
