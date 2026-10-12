import js from '@eslint/js';
import globals from 'globals';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

const jsFilesOnly = (config) => ({ ...config, files: ['**/*.js'] });

export default [
  {
    // keep the lint scope at **/*.js (flat config would also collect .mjs/.cjs)
    ignores: [
      '**/*.bundle.js',
      '**/trackers-preview-generated.js',
      '**/scripts/**/*.js',
      'reporting/example/offscreen/**',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  jsFilesOnly({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
        ...globals.mocha,
      },
    },
  }),
  jsFilesOnly(js.configs.recommended),
  jsFilesOnly(eslintPluginPrettierRecommended),
];
