import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  bundle: true,
  splitting: false,
  clean: true,
  minify: false,
  sourcemap: true,
  // Emit .d.ts only for the library entry. The CLI is an executable, not a
  // library; its users call it as a binary.
  dts: { entry: { index: 'src/index.ts' } },
  outExtension: () => ({ js: '.js' }),
});