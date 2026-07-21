import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/extension/**/*.test.js',
  version: 'stable',
  mocha: {
    timeout: 20_000,
    ui: 'tdd',
  },
});
