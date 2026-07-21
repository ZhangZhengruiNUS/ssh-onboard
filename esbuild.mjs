import * as esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const context = await esbuild.context({
  bundle: true,
  entryPoints: ['src/extension.ts'],
  external: ['vscode'],
  format: 'cjs',
  logLevel: 'info',
  minify: production,
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: production ? false : 'linked',
  sourcesContent: false,
  target: 'node22',
});

if (watch) {
  await context.watch();
  globalThis.console.log('[watch] esbuild is watching for changes');
} else {
  await context.rebuild();
  await context.dispose();
}
