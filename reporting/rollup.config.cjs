const commonConfig = require('./rollup.common-config.cjs');
const copy = require('rollup-plugin-copy');

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
  {
    ...commonConfig,
    input: 'src/offscreen/doublefetch/index.js',
    output: {
      ...commonConfig.output,
      file: 'example/offscreen/doublefetch/index.js',
    },
    plugins: [
      copy({
        targets: [
          { src: 'src/offscreen/doublefetch/index.html', dest: 'example/offscreen/doublefetch/' },
        ]
      })
    ]
  },
];
