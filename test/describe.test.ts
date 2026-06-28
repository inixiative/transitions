import { expect, describe as group, test } from 'bun:test';
import { describe } from '../index';

group('describe(reason)', () => {
  test('single path renders its side errors', () => {
    expect(describe({ paths: [{ from: { predicate: 'status must equal "pending"' } }] })).toBe(
      'from: status must equal "pending"',
    );
  });

  test('a side permission denial is rendered', () => {
    expect(describe({ paths: [{ to: { permission: 'not authorized' } }] })).toBe(
      'to: not authorized',
    );
  });

  test('multiple paths are enumerated', () => {
    expect(describe({ paths: [{ from: { predicate: 'a' } }, { to: { predicate: 'b' } }] })).toBe(
      'path 0: from: a | path 1: to: b',
    );
  });

  test('no paths → fallback', () => {
    expect(describe({ paths: [] })).toBe('no transition path available');
  });
});
