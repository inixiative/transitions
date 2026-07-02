import { describe, expect, test } from 'bun:test';
import { Operator } from '@inixiative/json-rules';
import type { RebacSchema } from '@inixiative/permissions';
import type { Transition } from '../index';
import { checkPath, createAuthorize } from '../index';

const schema: RebacSchema = {
  permissions: {
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
  },
};

const authorizeFor = createAuthorize({ schema });

describe('permissions adapter (createAuthorize)', () => {
  test('abac { rule } leaf', () => {
    const authorize = authorizeFor('organization');
    expect(authorize('own', { role: 'owner' }, null)).toBe(true);
    expect(authorize('own', { role: 'member' }, null)).toBe(false);
  });

  test('string delegation (read → manage → own/admin)', () => {
    const authorize = authorizeFor('organization');
    expect(authorize('read', { role: 'admin' }, null)).toBe(true);
    expect(authorize('read', { role: 'member' }, null)).toBe(false);
  });

  // permissions 0.3.0 added boolean terminals — a bare `true` authorizes, `false` denies.
  test('boolean terminal: `true` authorizes, `false` denies', () => {
    const s: RebacSchema = { permissions: { m: { actions: { go: true, stop: false } } } };
    const authorize = createAuthorize({ schema: s })('m');
    expect(authorize('go', {}, null)).toBe(true);
    expect(authorize('stop', {}, null)).toBe(false);
    // inline (not via schema)
    expect(authorize(true, {}, null)).toBe(true);
    expect(authorize(false, {}, null)).toBe(false);
  });

  test('{ self } matches the actor id', () => {
    const authorize = authorizeFor('membership');
    expect(authorize('leave', { userId: 'u1' }, { id: 'u1' })).toBe(true);
    expect(authorize('leave', { userId: 'u2' }, { id: 'u1' })).toBe(false);
    expect(authorize('leave', { userId: 'u1' }, null)).toBe(false);
  });

  test('{ rel, action } walks the relation (default resolver: segment = resource)', () => {
    const authorize = authorizeFor('membership');
    expect(authorize('manage', { organization: { role: 'admin' } }, null)).toBe(true);
    expect(authorize('manage', { organization: { role: 'member' } }, null)).toBe(false);
    expect(authorize('manage', { organization: null }, null)).toBe(false);
  });

  test('any / all', () => {
    const authorize = authorizeFor('organization');
    expect(authorize({ any: ['own', 'manage'] }, { role: 'admin' }, null)).toBe(true);
    expect(authorize({ all: ['own', 'manage'] }, { role: 'admin' }, null)).toBe(false);
    expect(authorize({ all: ['own', 'manage'] }, { role: 'owner' }, null)).toBe(true);
  });

  test('null is a terminal deny', () => {
    const authorize = authorizeFor('organization');
    expect(authorize(null, { role: 'owner' }, null)).toBe(false);
  });

  test('per-row permissionRules override is additive (OR)', () => {
    const authorize = authorizeFor('organization');
    const record = { role: 'member', permissionRules: { own: { rule: true } } };
    expect(authorize('own', record, null)).toBe(true);
  });

  test('superadmin bypass (derived from the actor)', () => {
    const authorize = createAuthorize({ schema, isSuperadmin: (a) => a?.id === 'root' })(
      'organization',
    );
    expect(authorize(null, { role: 'member' }, { id: 'root' })).toBe(true);
    expect(authorize(null, { role: 'member' }, { id: 'u1' })).toBe(false);
  });

  test('resolveRelation maps a relation field → resource name', () => {
    const s: RebacSchema = {
      permissions: {
        space: { actions: { own: { rel: 'org', action: 'own' } } },
        organization: {
          actions: { own: { rule: { field: 'role', operator: Operator.equals, value: 'owner' } } },
        },
      },
    };
    const authorize = createAuthorize({
      schema: s,
      resolveRelation: (_resource, seg) => (seg === 'org' ? 'organization' : seg),
    })('space');
    expect(authorize('own', { org: { role: 'owner' } }, null)).toBe(true);
  });

  // The whole point of dropping the fork: a string-delegation cycle TERMINATES and denies (the fork
  // hung forever). permissions detects the cycle; the adapter fails closed.
  test('string self-delegation cycle (read: "read") terminates and denies — does not hang', () => {
    const s: RebacSchema = { permissions: { m: { actions: { read: 'read' } } } };
    const authorize = createAuthorize({ schema: s })('m');
    expect(authorize('read', { id: '1' }, null)).toBe(false);
  });

  test('mutual string-delegation cycle (x: "y", y: "x") terminates and denies', () => {
    const s: RebacSchema = { permissions: { m: { actions: { x: 'y', y: 'x' } } } };
    const authorize = createAuthorize({ schema: s })('m');
    expect(authorize('x', { id: '1' }, null)).toBe(false);
  });
});

describe('adapter wired into the transition kernel', () => {
  // end-to-end: the injected authorizer drives per-side authz on a real transition
  const promote: Transition = {
    from: {
      predicate: { field: 'role', operator: Operator.equals, value: 'member' },
      permission: { rel: 'organization', action: 'manage' },
    },
    to: { predicate: { field: 'role', operator: Operator.equals, value: 'admin' } },
  };

  test('authorized when the related org grants manage', () => {
    const authorize = createAuthorize({ schema })('membership');
    const record = { role: 'member', organization: { role: 'owner' } };
    expect(checkPath(promote, record, { role: 'admin' }, { authorize })).toBe(true);
  });

  test('from permission denied when the related org does not grant manage', () => {
    const authorize = createAuthorize({ schema })('membership');
    const record = { role: 'member', organization: { role: 'member' } };
    const result = checkPath(promote, record, { role: 'admin' }, { authorize });
    expect(result).not.toBe(true);
    if (result !== true) expect(result.from?.permission).toBe('not authorized');
  });
});
