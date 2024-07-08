const commonConfig = require('./rollup.common-config.cjs');

module.exports = [
  {
    ...commonConfig,
    input: 'example/index.js',
    output: {
      ...commonConfig.output,
      file: 'example/index.bundle.js',
    },
  },
  {
    ...commonConfig,
    input: 'example/content.js',
    output: {
      ...commonConfig.output,
      file: 'example/content.bundle.js',
    },
  },
];
