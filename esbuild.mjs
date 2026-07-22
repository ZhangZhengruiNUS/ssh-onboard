import * as esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const extensionContext = await esbuild.context({
  bundle: true,
  entryPoints: ['src/extension.ts'],
  // ssh2 optionally loads native accelerators inside try/catch blocks. Keep
  // those platform-specific binaries external so the bundled extension uses
  // ssh2's portable JavaScript fallback on every supported host.
  external: ['vscode', '*.node'],
  format: 'cjs',
  logLevel: 'info',
  minify: production,
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: production ? false : 'linked',
  sourcesContent: false,
  target: 'node22',
});

const webviewContext = await esbuild.context({
  bundle: true,
  entryPoints: ['src/webview/hostFormClient.ts'],
  format: 'iife',
  logLevel: 'info',
  minify: production,
  outfile: 'media/hostForm.js',
  platform: 'browser',
  sourcemap: production ? false : 'linked',
  sourcesContent: false,
  target: 'es2022',
});

if (watch) {
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
  globalThis.console.log('[watch] esbuild is watching for changes');
} else {
  await Promise.all([extensionContext.rebuild(), webviewContext.rebuild()]);
  await Promise.all([extensionContext.dispose(), webviewContext.dispose()]);
}
