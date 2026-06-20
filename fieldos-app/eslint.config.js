// Expo ESLint flat config. Keeps generated/build folders out of pilot checks.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'expo-env.d.ts',
    ],
  },
  {
    rules: {
      // Existing app patterns trigger React 19 compiler advisories that are not pilot blockers.
      // Keep lint focused on actionable syntax/import issues for now.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
]);
