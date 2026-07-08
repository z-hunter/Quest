import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // Ignore build output
  globalIgnores(['dist', 'src-tauri']),

  // Node scripts (CI utilities, local tooling)
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        fetch: 'readonly',
      },
    },
  },

  // Base recommended configs (Flat Config composition, without "extends")
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Plugins and project rules (avoid plugin-provided configs to prevent classic "extends" paths)
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      prettier,
    },
  },

  // CommonJS files (root-level *.cjs utilities)
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Project-specific tweaks (applied to TS/TSX files)
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/no-unused-expressions': 'warn',
      'prefer-const': 'warn',
      'no-case-declarations': 'warn',
      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React Refresh (Vite)
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Prettier as a rule (flat config)
      'prettier/prettier': 'warn',
    },
  },
]);
