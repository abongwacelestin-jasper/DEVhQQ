import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { browserGlobals, ignores, sharedRules, typescriptRules } from '../eslint.config.mjs';

export default [
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...typescriptRules,
      ...sharedRules,
      // The codebase deliberately disables exhaustive-deps where a value is read for its
      // current snapshot; the rule stays on so a new omission has to be argued for.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // TypeScript already reports undefined identifiers, and browser globals are declared above.
      'no-undef': 'off',
    },
  },
  {
    // Node measurement scripts (bundle report, Lighthouse runner).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly' },
    },
  },
];
