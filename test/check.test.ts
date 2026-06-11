import { describe, expect, test } from 'bun:test';
import { check as checkRule, Operator } from '@inixiative/json-rules';
import type { Authorize, Transition } from '../index';
import { checkTransition } from '../index';

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

describe('checkTransition — legality', () => {
  test('passes when from matches current and to matches merged', () => {
    const result = checkTransition(approve, { status: 'pending' }, { status: 'approved' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(approve);
  });

  test('no-from when the current state does not match', () => {
    const result = checkTransition(approve, { status: 'approved' }, { status: 'approved' });
    expect(result).toMatchObject({ ok: false, reason: { kind: 'no-from' } });
    if (!result.ok) expect(typeof result.reason.from).toBe('string');
  });

  test('no-to when the merged state is not a valid target', () => {
    const result = checkTransition(approve, { status: 'pending' }, { status: 'rejected' });
    expect(result).toMatchObject({ ok: false, reason: { kind: 'no-to' } });
    if (!result.ok) expect(typeof result.reason.to).toBe('string');
  });

  test('merge produces the record `to` is evaluated against', () => {
    // no changes → merged === current → status stays 'pending' → to fails
    const result = checkTransition(approve, { status: 'pending' });
    expect(result).toMatchObject({ ok: false, reason: { kind: 'no-to' } });
  });
});

describe('checkTransition — authz', () => {
  test('absent permission is open', () => {
    expect(
      checkTransition(approve, { status: 'pending' }, { status: 'approved' }, { authorize }).ok,
    ).toBe(true);
  });

  test('action baseline denial → unauthorized(action)', () => {
    const result = checkTransition(
      approve,
      { status: 'pending' },
      { status: 'approved' },
      { authorize, basePermission: 'DENY' },
    );
    expect(result).toMatchObject({ ok: false, reason: { kind: 'unauthorized', authz: 'action' } });
  });

  test('from permission denial → unauthorized(from)', () => {
    const t: Transition = { ...approve, from: { ...approve.from, permission: 'DENY' } };
    const result = checkTransition(t, { status: 'pending' }, { status: 'approved' }, { authorize });
    expect(result).toMatchObject({ ok: false, reason: { kind: 'unauthorized', authz: 'from' } });
  });

  test('to permission denial → unauthorized(to)', () => {
    const t: Transition = { ...approve, to: { ...approve.to, permission: 'DENY' } };
    const result = checkTransition(t, { status: 'pending' }, { status: 'approved' }, { authorize });
    expect(result).toMatchObject({ ok: false, reason: { kind: 'unauthorized', authz: 'to' } });
  });

  test('null permission is a terminal deny (vs undefined = open)', () => {
    const t: Transition = { ...approve, from: { ...approve.from, permission: null } };
    // reference-style authorize: null → false
    const denyNull: Authorize = (rule, record) =>
      rule === null ? false : authorize(rule, record, null);
    const result = checkTransition(
      t,
      { status: 'pending' },
      { status: 'approved' },
      { authorize: denyNull },
    );
    expect(result).toMatchObject({ ok: false, reason: { kind: 'unauthorized', authz: 'from' } });
  });

  test('legality is checked before authz', () => {
    const t: Transition = { ...approve, from: { ...approve.from, permission: 'DENY' } };
    // from.predicate already fails → we report no-from, never reach authz
    const result = checkTransition(
      t,
      { status: 'approved' },
      { status: 'approved' },
      { authorize },
    );
    expect(result).toMatchObject({ ok: false, reason: { kind: 'no-from' } });
  });
});

describe('the load-bearing asymmetry — from.permission sees the OLD value', () => {
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
    const result = checkTransition(
      removeOwner,
      { role: 'owner' },
      { role: 'member' },
      { authorize },
    );
    expect(result.ok).toBe(true);
  });

  test('to.permission authorizes against the merged (post-change) record', () => {
    const grantOwner: Transition = {
      from: { predicate: { field: 'role', operator: Operator.notEquals, value: 'owner' } },
      to: {
        predicate: { field: 'role', operator: Operator.equals, value: 'owner' },
        permission: { rule: { field: 'role', operator: Operator.equals, value: 'owner' } },
      },
    };
    const result = checkTransition(
      grantOwner,
      { role: 'member' },
      { role: 'owner' },
      { authorize },
    );
    expect(result.ok).toBe(true);
  });
});
