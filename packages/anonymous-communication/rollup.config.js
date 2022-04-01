import commonConfig from './rollup.common-config.js';

export default {
  ...commonConfig,
  input: 'example/index.js',
  output: {
    ...commonConfig.output,
    file: 'example/index.bundle.js',
  },
};
