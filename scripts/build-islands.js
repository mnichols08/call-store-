// Builds the small interactive pieces (Svelte) into public/islands. The built files are committed, so
// running the shop needs no build step: only changing an island does.
//   npm run build:islands
import { build } from 'esbuild';
import esbuildSvelte from 'esbuild-svelte';

await build({
  entryPoints: { 'part-helper': 'src/islands/part-helper.js' },
  outdir: 'public/islands',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  plugins: [esbuildSvelte({ compilerOptions: { css: 'external' } })],
  logLevel: 'info',
});
