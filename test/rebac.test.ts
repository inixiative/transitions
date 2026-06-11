import { describe, expect, test } from 'bun:test';
import { Operator } from '@inixiative/json-rules';
import type { RebacSchema, Transition } from '../index';
import { checkTransition, createRebac, makeRebacAuthorize } from '../index';

const schema: RebacSchema = {
  organization: {
    actions: {
      own: { rule: { field: 'role', operator: Operator.equals, value: 'owner' } },
      manage: {
        any: ['own', { rule: { field: 'role', operator: Operator.equals, value: 'admin' } }],
      },
      read: 'manage',
    },
  },
  membership: {
    actions: {
      leave: { self: 'userId' },
      manage: { rel: 'organization', action: 'manage' },
    },
  },
};

const rebac = createRebac({ schema });

describe('reference rebac authorizer', () => {
  test('ABAC { rule } leaf', () => {
    const authorize = rebac('organization');
    expect(authorize('own', { role: 'owner' }, null)).toBe(true);
    expect(authorize('own', { role: 'member' }, null)).toBe(false);
  });

  test('string delegation (read → manage → own/admin)', () => {
    const authorize = rebac('organization');
    expect(authorize('read', { role: 'admin' }, null)).toBe(true);
    expect(authorize('read', { role: 'member' }, null)).toBe(false);
  });

  test('{ self } matches the actor id', () => {
    const authorize = rebac('membership');
    expect(authorize('leave', { userId: 'u1' }, { id: 'u1' })).toBe(true);
    expect(authorize('leave', { userId: 'u2' }, { id: 'u1' })).toBe(false);
    expect(authorize('leave', { userId: 'u1' }, null)).toBe(false);
  });

  test('{ rel, action } walks the relation', () => {
    const authorize = rebac('membership');
    expect(authorize('manage', { organization: { role: 'admin' } }, null)).toBe(true);
    expect(authorize('manage', { organization: { role: 'member' } }, null)).toBe(false);
    expect(authorize('manage', { organization: null }, null)).toBe(false);
  });

  test('any / all', () => {
    const authorize = makeRebacAuthorize({ schema, model: 'organization' });
    expect(authorize({ any: ['own', 'manage'] }, { role: 'admin' }, null)).toBe(true);
    expect(authorize({ all: ['own', 'manage'] }, { role: 'admin' }, null)).toBe(false);
    expect(authorize({ all: ['own', 'manage'] }, { role: 'owner' }, null)).toBe(true);
  });

  test('null is a terminal deny', () => {
    const authorize = makeRebacAuthorize({ schema, model: 'organization' });
    expect(authorize(null, { role: 'owner' }, null)).toBe(false);
  });

  test('per-row permissionRules override is additive (OR)', () => {
    const authorize = rebac('organization');
    // member normally can't `own`, but a per-row grant opens it
    const record = { role: 'member', permissionRules: { own: { rule: true } } };
    expect(authorize('own', record, null)).toBe(true);
  });

  test('cycle detection throws', () => {
    const cyclic: RebacSchema = { a: { actions: { x: { rel: 'parent', action: 'x' } } } };
    // resolveModel keeps the model 'a' so the rel walk returns to the same model:id:action key
    const authorize = makeRebacAuthorize({ schema: cyclic, model: 'a', resolveModel: () => 'a' });
    const record: Record<string, unknown> = { id: '1' };
    record.parent = record; // a:1:x → a:1:x …
    expect(() => authorize('x', record, null)).toThrow(/Cycle detected/);
  });

  test('superadmin bypass', () => {
    const authorize = makeRebacAuthorize({
      schema,
      model: 'organization',
      isSuperadmin: (actor) => actor?.id === 'root',
    });
    expect(authorize(null, { role: 'member' }, { id: 'root' })).toBe(true);
    expect(authorize(null, { role: 'member' }, { id: 'u1' })).toBe(false);
  });

  test('resolveModel maps relation field → model name', () => {
    const s: RebacSchema = {
      space: { actions: { own: { rel: 'org', action: 'own' } } },
      organization: {
        actions: { own: { rule: { field: 'role', operator: Operator.equals, value: 'owner' } } },
      },
    };
    const authorize = makeRebacAuthorize({
      schema: s,
      model: 'space',
      resolveModel: (_m, seg) => (seg === 'org' ? 'organization' : seg),
    });
    expect(authorize('own', { org: { role: 'owner' } }, null)).toBe(true);
  });
});

describe('rebac wired into the transition kernel', () => {
  // end-to-end: the injected authorizer drives per-side authz on a real transition
  const promote: Transition = {
    from: {
      predicate: { field: 'role', operator: Operator.equals, value: 'member' },
      permission: { rel: 'organization', action: 'manage' }, // current org membership of the actor's record
    },
    to: { predicate: { field: 'role', operator: Operator.equals, value: 'admin' } },
  };

  test('authorized when the related org grants manage', () => {
    const authorize = rebac('membership');
    const record = { role: 'member', organization: { role: 'owner' } };
    const result = checkTransition(promote, record, { role: 'admin' }, { authorize });
    expect(result.ok).toBe(true);
  });

  test('unauthorized(from) when the related org does not', () => {
    const authorize = rebac('membership');
    const record = { role: 'member', organization: { role: 'member' } };
    const result = checkTransition(promote, record, { role: 'admin' }, { authorize });
    expect(result).toMatchObject({ ok: false, reason: { kind: 'unauthorized', authz: 'from' } });
  });
});
