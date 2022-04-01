const commonConfig = require('./rollup.common-config.cjs');

module.exports = {
  ...commonConfig,
  input: 'example/index.js',
  output: {
    ...commonConfig.output,
    file: 'example/index.bundle.js',
  },
};
