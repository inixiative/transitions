import { describe, expect, test } from 'bun:test';
import { check as checkRule, Operator } from '@inixiative/json-rules';
import type { Authorize, TransitionMap } from '../index';
import { available, check, eligible } from '../index';

const authorize: Authorize = (rule, record) => {
  if (rule && typeof rule === 'object' && 'rule' in rule)
    return checkRule(rule.rule, record) === true;
  return rule !== 'DENY';
};

const eq = (field: string, value: string) => ({ field, operator: Operator.equals, value });

const map: TransitionMap = {
  inquiry: {
    approve: {
      permission: 'resolve',
      paths: [
        {
          from: { predicate: eq('status', 'pending') },
          to: { predicate: eq('status', 'approved') },
        },
      ],
    },
    reject: {
      permission: 'resolve',
      paths: [
        {
          from: { predicate: eq('status', 'pending') },
          to: { predicate: eq('status', 'rejected') },
        },
      ],
    },
    cancel: {
      permission: { self: 'sourceUserId' },
      paths: [
        {
          from: { predicate: eq('status', 'pending') },
          to: { predicate: eq('status', 'cancelled') },
        },
      ],
    },
    // multi-path verb: reachable from two states
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

describe('check — first-match', () => {
  test('returns the first passing path', () => {
    const result = check(map, 'inquiry', 'archive', { status: 'rejected' }, { status: 'archived' });
    expect(result.ok).toBe(true);
  });

  test('unknown action throws (programmer error)', () => {
    expect(() => check(map, 'inquiry', 'nope', { status: 'pending' })).toThrow(/no action "nope"/);
  });

  test('no path matches the current state → no-from', () => {
    const result = check(map, 'inquiry', 'approve', { status: 'archived' }, { status: 'approved' });
    expect(result).toMatchObject({ ok: false, reason: { kind: 'no-from' } });
  });

  test('aggregated reason carries per-path detail', () => {
    const result = check(map, 'inquiry', 'archive', { status: 'pending' }, { status: 'archived' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.paths).toHaveLength(2);
  });
});

describe('check — failure precedence (unauthorized > no-to > no-from)', () => {
  // one path is legal-but-unauthorized, another is illegal → surface unauthorized (403, not 409)
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

  test('a legal-but-unauthorized path wins over an illegal one', () => {
    const result = check(
      mixed,
      'doc',
      'publish',
      { state: 'draft' },
      { state: 'live' },
      { authorize },
    );
    expect(result).toMatchObject({ ok: false, reason: { kind: 'unauthorized' } });
  });

  test('without authz the same call is just no-from for the other path', () => {
    const result = check(mixed, 'doc', 'publish', { state: 'draft' }, { state: 'live' });
    // path 1 passes legality (no authorizer) → ok
    expect(result.ok).toBe(true);
  });
});

describe('available — from-side only', () => {
  test('lists verbs whose from matches, ignoring to', () => {
    expect(available(map, 'inquiry', { status: 'pending' }).sort()).toEqual(
      ['approve', 'cancel', 'reject'].sort(),
    );
    expect(available(map, 'inquiry', { status: 'approved' })).toEqual(['archive']);
  });

  test('unknown model → empty', () => {
    expect(available(map, 'ghost', { status: 'pending' })).toEqual([]);
  });

  test('respects action + from permission when authorize is injected', () => {
    // actor is the source user → cancel allowed; resolve denied for approve/reject
    const actor = { id: 'u1' };
    const auth: Authorize = (rule, record) => {
      if (rule === 'resolve') return false;
      if (rule && typeof rule === 'object' && 'self' in rule) return record[rule.self] === actor.id;
      return true;
    };
    const verbs = available(
      map,
      'inquiry',
      { status: 'pending', sourceUserId: 'u1' },
      { actor, authorize: auth },
    );
    expect(verbs).toEqual(['cancel']);
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
    // to.permission would deny in check(), but available only looks at the from side
    expect(available(m, 'x', { s: 'a' }, { authorize })).toEqual(['go']);
  });
});

describe('eligible — set query via toPrisma', () => {
  test('single-path verb → OR of one from predicate', () => {
    const where = eligible(map, 'inquiry', 'approve');
    expect(where).toEqual({ OR: [{ status: { equals: 'pending' } }] });
  });

  test('multi-path verb → OR of all from predicates', () => {
    const where = eligible(map, 'inquiry', 'archive') as { OR: unknown[] };
    expect(where.OR).toHaveLength(2);
    expect(where).toEqual({
      OR: [{ status: { equals: 'approved' } }, { status: { equals: 'rejected' } }],
    });
  });

  test('eligible where agrees with from.predicate (round-trip)', () => {
    // a record matching the where should also satisfy the from predicate
    expect(checkRule(eq('status', 'approved'), { status: 'approved' })).toBe(true);
    const where = eligible(map, 'inquiry', 'archive') as { OR: { status: { equals: string } }[] };
    expect(where.OR.map((w) => w.status.equals)).toEqual(['approved', 'rejected']);
  });
});
