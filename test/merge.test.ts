import { describe, expect, test } from 'bun:test';
import type { Transition } from '../index';
import { applyMerge, isSerializable, isSerializableMerge } from '../index';

describe('applyMerge', () => {
  const record = { status: 'pending', tags: ['a'], meta: { x: 1, y: 2 } as Record<string, number> };

  test('spread (default) shallow-overwrites', () => {
    expect(applyMerge(undefined, record, { status: 'approved' })).toEqual({
      ...record,
      status: 'approved',
    });
    expect(applyMerge('spread', record, { status: 'approved' })).toEqual({
      ...record,
      status: 'approved',
    });
  });

  test('spread replaces nested objects wholesale', () => {
    expect(applyMerge('spread', record, { meta: { x: 9 } })).toEqual({
      status: 'pending',
      tags: ['a'],
      meta: { x: 9 },
    });
  });

  test('deepMerge recurses into objects but replaces arrays', () => {
    expect(applyMerge('deepMerge', record, { meta: { x: 9 } })).toEqual({
      status: 'pending',
      tags: ['a'],
      meta: { x: 9, y: 2 },
    });
    expect(applyMerge('deepMerge', record, { tags: ['z'] })).toEqual({
      status: 'pending',
      tags: ['z'],
      meta: { x: 1, y: 2 },
    });
  });

  test('append concatenates at the field path', () => {
    expect(applyMerge({ kind: 'append', path: 'tags' }, record, { tags: ['b', 'a'] })).toEqual({
      status: 'pending',
      tags: ['a', 'b', 'a'],
      meta: { x: 1, y: 2 },
    });
  });

  test('append coerces a non-array incoming value', () => {
    const r = applyMerge({ kind: 'append', path: 'tags' }, record, { tags: 'b' } as never);
    expect(r.tags).toEqual(['a', 'b']);
  });

  test('appendUnique dedupes by deep equality', () => {
    const r = { items: [{ id: 1 }] };
    const out = applyMerge({ kind: 'appendUnique', path: 'items' }, r, {
      items: [{ id: 1 }, { id: 2 }],
    });
    expect(out.items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('append at a nested path', () => {
    const r = { box: { items: ['a'] } };
    const out = applyMerge({ kind: 'append', path: 'box.items' }, r, { box: { items: ['b'] } });
    expect(out.box.items).toEqual(['a', 'b']);
  });

  test('callback merge gets full power', () => {
    const out = applyMerge(
      (rec: { n: number }, ch: { n?: number }) => ({ n: rec.n + (ch.n ?? 0) }),
      { n: 1 },
      { n: 4 },
    );
    expect(out).toEqual({ n: 5 });
  });

  test('does not mutate the input record', () => {
    applyMerge({ kind: 'append', path: 'tags' }, record, { tags: ['b'] });
    expect(record.tags).toEqual(['a']);
  });
});

describe('serializability', () => {
  test('isSerializableMerge', () => {
    expect(isSerializableMerge(undefined)).toBe(true);
    expect(isSerializableMerge('spread')).toBe(true);
    expect(isSerializableMerge({ kind: 'append', path: 'tags' })).toBe(true);
    expect(isSerializableMerge(() => ({}))).toBe(false);
  });

  test('isSerializable(transition) reflects the merge', () => {
    const base: Transition = {
      from: { predicate: true },
      to: { predicate: true },
    };
    expect(isSerializable(base)).toBe(true);
    expect(isSerializable({ ...base, to: { predicate: true, merge: 'deepMerge' } })).toBe(true);
    expect(isSerializable({ ...base, to: { predicate: true, merge: () => ({}) } })).toBe(false);
  });
});
