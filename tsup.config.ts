import { node } from '@inixiative/config/tsup';

export default node({
  entry: ['index.ts'],
  minify: true,
  treeshake: true,
  external: ['@inixiative/json-rules', 'lodash-es'],
});
