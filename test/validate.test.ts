import { describe, expect, test } from 'bun:test';
import { Operator } from '@inixiative/json-rules';
import type { Transition } from '../index';
import { validateTransition } from '../index';

const valid: Transition = {
  from: {
    predicate: { field: 'status', operator: Operator.equals, value: 'pending' },
    permission: { all: ['resolve', { self: 'userId' }] },
  },
  to: {
    predicate: { field: 'status', operator: Operator.equals, value: 'approved' },
    merge: 'spread',
  },
};

describe('validateTransition', () => {
  test('accepts a well-formed transition', () => {
    expect(validateTransition(valid)).toEqual({ ok: true, errors: [] });
  });

  test('flags an invalid predicate (delegates to json-rules)', () => {
    const t: Transition = {
      from: { predicate: { field: 'status', operator: 'wat' as never, value: 1 } },
      to: { predicate: true },
    };
    const result = validateTransition(t);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith('from.predicate'))).toBe(true);
  });

  test('flags an unknown merge strategy', () => {
    const t: Transition = {
      from: { predicate: true },
      to: { predicate: true, merge: 'smush' as never },
    };
    expect(validateTransition(t).errors).toContainEqual({
      path: 'to.merge',
      message: 'unknown merge strategy "smush"',
    });
  });

  test('flags an array merge kind missing its path', () => {
    const t: Transition = {
      from: { predicate: true },
      to: { predicate: true, merge: { kind: 'append' } as never },
    };
    expect(validateTransition(t).errors).toContainEqual({
      path: 'to.merge',
      message: 'merge "append" requires a `path`',
    });
  });

  test('flags a malformed permission rule', () => {
    const t: Transition = {
      from: { predicate: true, permission: { rel: '', action: '' } },
      to: { predicate: true },
    };
    const result = validateTransition(t);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === 'from.permission')).toBe(true);
  });

  test('flags an unrecognized ActionRule shape', () => {
    const t: Transition = {
      from: { predicate: true, permission: { bogus: true } as never },
      to: { predicate: true },
    };
    expect(validateTransition(t).errors).toContainEqual({
      path: 'from.permission',
      message: 'unrecognized ActionRule shape',
    });
  });

  test('requireSerializable rejects a callback merge', () => {
    const t: Transition = { from: { predicate: true }, to: { predicate: true, merge: () => ({}) } };
    expect(validateTransition(t).ok).toBe(true); // callbacks are valid...
    expect(validateTransition(t, { requireSerializable: true }).errors).toContainEqual({
      path: 'to.merge',
      message: 'callback merge is not serializable; use a keyword strategy',
    });
  });

  test('flags a non-object `requires`', () => {
    const t: Transition = {
      from: { predicate: true, requires: 'nope' as never },
      to: { predicate: true },
    };
    expect(validateTransition(t).errors).toContainEqual({
      path: 'from.requires',
      message: '`requires` must be a Prisma-include-shaped object',
    });
  });
});
