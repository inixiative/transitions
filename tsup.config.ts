import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['cjs', 'esm'],
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
  minify: true,
  treeshake: true,
  outDir: 'dist',
  external: ['@inixiative/json-rules', 'lodash-es'],
});
