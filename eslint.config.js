// ESLint flat configuration (ESLint 9+).
// Applies to Backend, Frontend and Models from a single source of truth.
// Run with: npm run lint
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ---------------------------------------------------------------------------
  // Ignored paths. Keep in sync with .gitignore / .prettierignore.
  // ---------------------------------------------------------------------------
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/*.config.js',
      '**/vite.config.ts',
      'Models/models/**',
      'Models/data/**',
      'Frontend/public/**',
    ],
  },

  // ---------------------------------------------------------------------------
  // Baseline rules for every JavaScript file.
  // ---------------------------------------------------------------------------
  js.configs.recommended,

  // ---------------------------------------------------------------------------
  // TypeScript: non type-aware recommended rules (fast, no project service).
  // ---------------------------------------------------------------------------
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // ---------------------------------------------------------------------------
  // Backend + Models: Node.js runtime.
  // ---------------------------------------------------------------------------
  {
    files: ['Backend/**/*.ts', 'Models/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Security: never ship debugger statements or eval-like constructs.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-debugger': 'error',
      'no-console': 'off',

      // Correctness
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-return-await': 'error',
      'require-await': 'error',

      // TypeScript hygiene
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Frontend: browser runtime + React.
  // ---------------------------------------------------------------------------
  {
    files: ['Frontend/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Colocating a component with its own constants/helpers is deliberate in
      // this codebase (36 files). Enforcing this rule would mean splitting
      // those modules purely to satisfy HMR; the cost outweighs the benefit.
      // Re-enable if we ever migrate those helpers into `src/data`/`src/utils`.
      'react-refresh/only-export-components': 'off',
      'no-eval': 'error',
      'no-debugger': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Tests: relax strictness.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.{test,spec}.{ts,tsx,js,jsx}', '**/__tests__/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
