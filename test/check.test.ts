import { describe, expect, test } from 'bun:test';
import { check as checkRule, Operator } from '@inixiative/json-rules';
import type { Authorize, Transition } from '../index';
import { checkPath } from '../index';

const approve: Transition = {
  from: { predicate: { field: 'status', operator: Operator.equals, value: 'pending' } },
  to: { predicate: { field: 'status', operator: Operator.equals, value: 'approved' } },
};

// authorizer for tests: handles ABAC `{ rule }` via json-rules; treats the string 'DENY' as a hard no.
const authorize: Authorize = (rule, record) => {
  if (rule && typeof rule === 'object' && 'rule' in rule)
    return checkRule(rule.rule, record) === true;
  return rule !== 'DENY';
};

describe('checkPath — legality', () => {
  test('passes when from matches current and to matches merged', () => {
    expect(checkPath(approve, { status: 'pending' }, { status: 'approved' })).toBe(true);
  });

  test('reports from when the current state does not match', () => {
    const result = checkPath(approve, { status: 'approved' }, { status: 'approved' });
    expect(result).not.toBe(true);
    if (result !== true) {
      expect(typeof result.from?.predicate).toBe('string');
      expect(result.to).toBeUndefined();
    }
  });

  test('reports to when the merged state is not a valid target', () => {
    const result = checkPath(approve, { status: 'pending' }, { status: 'rejected' });
    expect(result).not.toBe(true);
    if (result !== true) {
      expect(typeof result.to?.predicate).toBe('string');
      expect(result.from).toBeUndefined();
    }
  });

  test('merge produces the record `to` is evaluated against', () => {
    // no changes → merged === current → status stays 'pending' → to fails
    const result = checkPath(approve, { status: 'pending' });
    expect(result).not.toBe(true);
    if (result !== true) expect(result.to?.predicate).toBeDefined();
  });
});

describe('checkPath — authz', () => {
  test('absent permission is open', () => {
    expect(checkPath(approve, { status: 'pending' }, { status: 'approved' }, { authorize })).toBe(
      true,
    );
  });

  test('from permission denial → from.permission', () => {
    const t: Transition = { ...approve, from: { ...approve.from, permission: 'DENY' } };
    const result = checkPath(t, { status: 'pending' }, { status: 'approved' }, { authorize });
    expect(result).not.toBe(true);
    if (result !== true) expect(result.from?.permission).toBe('not authorized');
  });

  test('to permission denial → to.permission', () => {
    const t: Transition = { ...approve, to: { ...approve.to, permission: 'DENY' } };
    const result = checkPath(t, { status: 'pending' }, { status: 'approved' }, { authorize });
    expect(result).not.toBe(true);
    if (result !== true) expect(result.to?.permission).toBe('not authorized');
  });

  test('null permission is a terminal deny (vs undefined = open)', () => {
    const t: Transition = { ...approve, from: { ...approve.from, permission: null } };
    const denyNull: Authorize = (rule, record) =>
      rule === null ? false : authorize(rule, record, null);
    const result = checkPath(
      t,
      { status: 'pending' },
      { status: 'approved' },
      { authorize: denyNull },
    );
    expect(result).not.toBe(true);
    if (result !== true) expect(result.from?.permission).toBe('not authorized');
  });

  test('predicate and permission failures on a side are reported together', () => {
    // from.predicate fails AND from.permission denies → both surface on the from side
    const t: Transition = { ...approve, from: { ...approve.from, permission: 'DENY' } };
    const result = checkPath(t, { status: 'approved' }, { status: 'approved' }, { authorize });
    expect(result).not.toBe(true);
    if (result !== true) {
      expect(result.from?.predicate).toBeDefined();
      expect(result.from?.permission).toBe('not authorized');
    }
  });
});

describe('the load-bearing asymmetry', () => {
  // "only when currently an owner" — an ABAC rule on a CHANGING field.
  const removeOwner: Transition = {
    from: {
      predicate: { field: 'role', operator: Operator.equals, value: 'owner' },
      permission: { rule: { field: 'role', operator: Operator.equals, value: 'owner' } },
    },
    to: { predicate: { field: 'role', operator: Operator.notEquals, value: 'owner' } },
  };

  test('from.permission authorizes against the current (pre-change) record', () => {
    // merged record has role: 'member' — if from.permission were evaluated there it would WRONGLY deny.
    expect(checkPath(removeOwner, { role: 'owner' }, { role: 'member' }, { authorize })).toBe(true);
  });

  test('to.permission authorizes against the merged (post-change) record', () => {
    const grantOwner: Transition = {
      from: { predicate: { field: 'role', operator: Operator.notEquals, value: 'owner' } },
      to: {
        predicate: { field: 'role', operator: Operator.equals, value: 'owner' },
        permission: { rule: { field: 'role', operator: Operator.equals, value: 'owner' } },
      },
    };
    expect(checkPath(grantOwner, { role: 'member' }, { role: 'owner' }, { authorize })).toBe(true);
  });
});
