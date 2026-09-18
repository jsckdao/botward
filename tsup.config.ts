import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node20',
  bundle: true,
  splitting: false,
  clean: true,
  minify: false,
  sourcemap: true,
  outExtension: () => ({ js: '.js' }),
});