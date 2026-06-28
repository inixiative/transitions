import { describe, expect, test } from 'bun:test';
import { check as checkRule, Operator } from '@inixiative/json-rules';
import type { Authorize, TransitionMap } from '../index';
import { available, checkTransition, eligible } from '../index';

const authorize: Authorize = (rule, record) => {
  if (rule && typeof rule === 'object' && 'rule' in rule)
    return checkRule(rule.rule, record) === true;
  return rule !== 'DENY';
};

const eq = (field: string, value: string) => ({ field, operator: Operator.equals, value });

const map: TransitionMap = {
  inquiry: {
    approve: {
      paths: [
        {
          from: { predicate: eq('status', 'pending'), permission: 'resolve' },
          to: { predicate: eq('status', 'approved') },
        },
      ],
    },
    reject: {
      paths: [
        {
          from: { predicate: eq('status', 'pending'), permission: 'resolve' },
          to: { predicate: eq('status', 'rejected') },
        },
      ],
    },
    cancel: {
      paths: [
        {
          from: { predicate: eq('status', 'pending'), permission: { self: 'sourceUserId' } },
          to: { predicate: eq('status', 'cancelled') },
        },
      ],
    },
    // multi-path action: reachable from two states
    archive: {
      paths: [
        {
          from: { predicate: eq('status', 'approved') },
          to: { predicate: eq('status', 'archived') },
        },
        {
          from: { predicate: eq('status', 'rejected') },
          to: { predicate: eq('status', 'archived') },
        },
      ],
    },
  },
};

describe('checkTransition — first-match', () => {
  test('returns true on the first passing path', () => {
    expect(
      checkTransition(map, 'inquiry', 'archive', { status: 'rejected' }, { status: 'archived' }),
    ).toBe(true);
  });

  test('unknown action throws (programmer error)', () => {
    expect(() => checkTransition(map, 'inquiry', 'nope', { status: 'pending' })).toThrow(
      /no action "nope"/,
    );
  });

  test('no path matches the current state → reason with per-path detail', () => {
    const result = checkTransition(
      map,
      'inquiry',
      'approve',
      { status: 'archived' },
      { status: 'approved' },
    );
    expect(result).not.toBe(true);
    if (result !== true) {
      expect(result.paths).toHaveLength(1);
      expect(result.paths[0].from?.predicate).toBeDefined();
    }
  });

  test('multi-path failure carries one entry per candidate path', () => {
    const result = checkTransition(
      map,
      'inquiry',
      'archive',
      { status: 'pending' },
      { status: 'archived' },
    );
    expect(result).not.toBe(true);
    if (result !== true) expect(result.paths).toHaveLength(2);
  });
});

describe('checkTransition — predicate vs permission, per path', () => {
  const mixed: TransitionMap = {
    doc: {
      publish: {
        paths: [
          // legal edge, but denied
          {
            from: { predicate: eq('state', 'draft'), permission: 'DENY' },
            to: { predicate: eq('state', 'live') },
          },
          // illegal from this state
          { from: { predicate: eq('state', 'archived') }, to: { predicate: eq('state', 'live') } },
        ],
      },
    },
  };

  test('each path reports whether it failed on predicate or permission', () => {
    const result = checkTransition(
      mixed,
      'doc',
      'publish',
      { state: 'draft' },
      { state: 'live' },
      { authorize },
    );
    expect(result).not.toBe(true);
    if (result !== true) {
      expect(result.paths).toHaveLength(2);
      expect(result.paths[0].from?.permission).toBe('not authorized');
      expect(result.paths[0].from?.predicate).toBeUndefined();
      expect(result.paths[1].from?.predicate).toBeDefined();
    }
  });

  test('without authz the legal path passes', () => {
    expect(checkTransition(mixed, 'doc', 'publish', { state: 'draft' }, { state: 'live' })).toBe(
      true,
    );
  });
});

describe('available — from-side only', () => {
  test('lists actions whose from matches, ignoring to', () => {
    expect(available(map, 'inquiry', { status: 'pending' }).sort()).toEqual(
      ['approve', 'cancel', 'reject'].sort(),
    );
    expect(available(map, 'inquiry', { status: 'approved' })).toEqual(['archive']);
  });

  test('unknown model → empty', () => {
    expect(available(map, 'ghost', { status: 'pending' })).toEqual([]);
  });

  test('respects from permission when authorize is injected', () => {
    const actor = { id: 'u1' };
    const auth: Authorize = (rule, record) => {
      if (rule === 'resolve') return false;
      if (rule && typeof rule === 'object' && 'self' in rule) return record[rule.self] === actor.id;
      return true;
    };
    const actions = available(
      map,
      'inquiry',
      { status: 'pending', sourceUserId: 'u1' },
      { actor, authorize: auth },
    );
    expect(actions).toEqual(['cancel']);
  });

  test('to-side permission is NOT consulted by available', () => {
    const m: TransitionMap = {
      x: {
        go: {
          paths: [
            {
              from: { predicate: eq('s', 'a') },
              to: { predicate: eq('s', 'b'), permission: 'DENY' },
            },
          ],
        },
      },
    };
    // to.permission would deny in checkTransition(), but available only looks at the from side
    expect(available(m, 'x', { s: 'a' }, { authorize })).toEqual(['go']);
  });
});

describe('eligible — set query via toPrisma', () => {
  test('single-path action → OR of one from predicate', () => {
    expect(eligible(map, 'inquiry', 'approve')).toEqual({
      OR: [{ status: { equals: 'pending' } }],
    });
  });

  test('multi-path action → OR of all from predicates', () => {
    expect(eligible(map, 'inquiry', 'archive')).toEqual({
      OR: [{ status: { equals: 'approved' } }, { status: { equals: 'rejected' } }],
    });
  });
});
