import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // dist = build output; .worktrees = scratch git worktrees; android/ios =
  // native shells whose generated assets (e.g. native-bridge.js) aren't ours.
  globalIgnores(['dist', '.worktrees', 'android', 'ios']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Each context file exports its provider beside its hook, the usual React
    // pairing. The rule only protects hot reload, which these files do not
    // need, and splitting them would move every import in the app.
    files: ['src/context/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Tests are never hot reloaded, and their mocks reassign outer variables
    // on purpose, which the compiler rule reads as mutating component state.
    files: ['src/__tests__/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/immutability': 'off',
    },
  },
])
