import { describe, expect, test } from 'bun:test';
import { Operator } from '@inixiative/json-rules';
import {
  type RebacSchema,
  ruleFieldEqualsPath,
  type SchemaMap,
  type Subject,
} from '@inixiative/permissions';
import type { Transition } from '../index';
import { checkPath, createAuthorize } from '../index';

// Who is acting, as this test's app holds it; `suppliedRowsOf` turns it into the rows a check reads.
type TestActor = { model: 'User' | 'Token'; record: { id: string } } | null;

const suppliedRowsOf = (_record: unknown, actor: TestActor): Subject['data'] =>
  actor
    ? { 'actor:Acting': [{ model: actor.model }], [`actor:${actor.model}`]: [actor.record] }
    : {};

const supplied: SchemaMap['supplied'] = {
  maps: {
    actor: {
      models: {
        Acting: { fields: { model: { kind: 'enum', type: 'ActingKind' } } },
        User: { fields: { id: { kind: 'scalar', type: 'String', isId: true } } },
        Token: { fields: { id: { kind: 'scalar', type: 'String', isId: true } } },
      },
      enums: { ActingKind: ['User', 'Token'] },
    },
  },
  bridges: [],
};

const mapOf = (relations: Record<string, Record<string, string>>): SchemaMap => {
  const resources = [
    ...new Set([...Object.keys(relations), ...Object.values(relations).flatMap(Object.values)]),
  ];
  return {
    resources: Object.fromEntries(resources.map((resource) => [resource, resource])),
    supplied,
    fieldMap: {
      models: Object.fromEntries(
        resources.map((resource) => [
          resource,
          {
            // Every model has the columns its rules and keys read: an id, a role, and each
            // relation's foreign key (permissions judges every rule path against the map).
            fields: {
              id: { kind: 'scalar', type: 'String', isId: true },
              role: { kind: 'scalar', type: 'String' },
              ...Object.fromEntries(
                Object.entries(relations[resource] ?? {}).flatMap(([segment, target]) => [
                  [
                    segment,
                    {
                      kind: 'object',
                      type: target,
                      isList: false,
                      fromFields: [`${segment}Id`],
                      toFields: ['id'],
                    },
                  ],
                  [`${segment}Id`, { kind: 'scalar', type: 'String' }],
                ]),
              ),
            },
          },
        ]),
      ),
    },
  };
};

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
        leave: { rel: 'user', action: 'operate' },
        manage: { rel: 'organization', action: 'manage' },
      },
    },
    user: {
      actions: {
        operate: ruleFieldEqualsPath('id', 'actor:User.id'),
      },
    },
  },
};

const map = mapOf({ membership: { organization: 'organization', user: 'user' } });
const authorizeFor = createAuthorize<string, TestActor>({ schema, map, data: suppliedRowsOf });
const asUser = (id: string): TestActor => ({ model: 'User', record: { id } });

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

  test('boolean terminal: `true` authorizes, `false` denies', () => {
    const s: RebacSchema = { permissions: { m: { actions: { go: true, stop: false } } } };
    const authorize = createAuthorize({ schema: s, map: mapOf({ m: {} }) })('m');
    expect(authorize('go', {}, null)).toBe(true);
    expect(authorize('stop', {}, null)).toBe(false);
    expect(authorize(true, {}, null)).toBe(true);
    expect(authorize(false, {}, null)).toBe(false);
  });

  test('acting as yourself is a walk to your own entry', () => {
    const authorize = authorizeFor('membership');
    expect(authorize('leave', { userId: 'u1', user: { id: 'u1' } }, asUser('u1'))).toBe(true);
    expect(authorize('leave', { userId: 'u2', user: { id: 'u2' } }, asUser('u1'))).toBe(false);
    expect(authorize('leave', { userId: 'u1', user: { id: 'u1' } }, null)).toBe(false);
  });

  test('a row without its relation loaded is denied', () => {
    const authorize = authorizeFor('membership');
    expect(authorize('leave', { userId: 'u1' }, asUser('u1'))).toBe(false);
  });

  test('a { rule } reads who is acting from the rows `data` supplies', () => {
    const s: RebacSchema = {
      permissions: {
        m: {
          actions: {
            go: { rule: { field: 'actor:Acting.model', operator: Operator.equals, value: 'User' } },
          },
        },
      },
    };
    const authorize = createAuthorize<string, TestActor>({
      schema: s,
      map: mapOf({ m: {} }),
      data: suppliedRowsOf,
    })('m');
    expect(authorize('go', {}, asUser('u1'))).toBe(true);
    expect(authorize('go', {}, { model: 'Token', record: { id: 't1' } })).toBe(false);
    expect(authorize('go', {}, null)).toBe(false);
  });

  test('{ rel, action } walks the relation the map names', () => {
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
    const authorize = createAuthorize<string, TestActor>({
      schema,
      map,
      isSuperadmin: (actor) => actor?.record.id === 'root',
    })('organization');
    expect(authorize(null, { role: 'member' }, asUser('root'))).toBe(true);
    expect(authorize(null, { role: 'member' }, asUser('u1'))).toBe(false);
  });

  test('the map says which resource a relation leads to', () => {
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
      map: mapOf({ space: { org: 'organization' } }),
    })('space');
    expect(authorize('own', { org: { role: 'owner' } }, null)).toBe(true);
  });

  test('string self-delegation cycle (read: "read") terminates and denies — does not hang', () => {
    const s: RebacSchema = { permissions: { m: { actions: { read: 'read' } } } };
    const authorize = createAuthorize({ schema: s, map: mapOf({ m: {} }) })('m');
    expect(authorize('read', { id: '1' }, null)).toBe(false);
  });

  test('mutual string-delegation cycle (x: "y", y: "x") terminates and denies', () => {
    const s: RebacSchema = { permissions: { m: { actions: { x: 'y', y: 'x' } } } };
    const authorize = createAuthorize({ schema: s, map: mapOf({ m: {} }) })('m');
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
    const authorize = createAuthorize({ schema, map })('membership');
    const record = { role: 'member', organization: { role: 'owner' } };
    expect(checkPath(promote, record, { role: 'admin' }, { authorize })).toBe(true);
  });

  test('from permission denied when the related org does not grant manage', () => {
    const authorize = createAuthorize({ schema, map })('membership');
    const record = { role: 'member', organization: { role: 'member' } };
    const result = checkPath(promote, record, { role: 'admin' }, { authorize });
    expect(result).not.toBe(true);
    if (result !== true) expect(result.from?.permission).toBe('not authorized');
  });
});
