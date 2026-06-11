import { cloneDeep, get, isEqual, mergeWith, set, uniqWith } from 'lodash-es';
import type { Merge, MergeStrategy, Row } from './types';

const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

// deepMerge replaces arrays wholesale rather than index-merging them (the intuitive default).
const replaceArrays = (_target: unknown, source: unknown): unknown[] | undefined =>
  Array.isArray(source) ? source : undefined;

/** A transition is persistable iff its merge is absent or a keyword strategy (callbacks are not). */
export const isSerializableMerge = (merge?: Merge): boolean => typeof merge !== 'function';

/**
 * Produce the resulting record from a current record + proposed changes.
 *
 * - `spread` (default) — shallow overwrite (`{ ...record, ...changes }`)
 * - `deepMerge` — recursive object merge, arrays replaced
 * - `{ kind: 'append', path }` — concat `changes[path]` onto `record[path]`
 * - `{ kind: 'appendUnique', path }` — append + dedupe (deep equality)
 * - a callback — full power, not serializable
 */
export const applyMerge = <R extends Row>(
  merge: Merge<R> | undefined,
  record: R,
  changes: Partial<R> = {},
): R => {
  if (typeof merge === 'function') return merge(record, changes);

  const strategy: MergeStrategy = merge ?? 'spread';

  if (strategy === 'spread') return { ...record, ...changes };
  // clone BOTH inputs: mergeWith assigns nested objects/arrays from `changes` by reference, which
  // would alias the caller's `changes` into the returned record (a mutation footgun for a pure guard).
  if (strategy === 'deepMerge')
    return mergeWith(cloneDeep(record), cloneDeep(changes), replaceArrays);

  // field-scoped array strategies: spread the rest of `changes`, then concat at `path`.
  const { kind, path } = strategy;
  const base = cloneDeep({ ...record, ...changes }) as R;
  const merged = [...toArray(get(record, path)), ...toArray(get(changes, path))];
  set(base as Row, path, kind === 'appendUnique' ? uniqWith(merged, isEqual) : merged);
  return base;
};
