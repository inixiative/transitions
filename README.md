# @inixiative/transitions

A small, **stateless** primitive on top of [`@inixiative/json-rules`](https://github.com/inixiative/json-rules)
that answers two questions about an entity's lifecycle, declaratively:

- **"Can this change happen?"** — guard a proposed update (`checkTransition`).
- **"What changes can happen?"** — list available actions for a record (`available`), and via
  `toPrisma`, every record currently eligible for an action (`eligible`).

It is **not** a state machine (no statecharts/actors/hierarchy), does **not** own state, and does
**not** execute the change or run side effects. It is a guard + affordance layer. A transition is
**pure data** → serializable → tenant-configurable at runtime (stored in the DB, edited in a UI,
no deploy to change a lifecycle).

> Full design: [`docs/FEAT-018-transitions.md`](./docs/FEAT-018-transitions.md).

## Model

```
resource → action → Action { paths: Transition[], label? }
                             Transition { from: Side, to: Side & { merge? } }
                             Side       { predicate, permission?, requires? }
```

A `resource` key is map-qualified (`map:Model`, e.g. `db:Inquiry`) — the same convention
`@inixiative/permissions` uses, so a transition's `permission` can delegate into the rebac schema.

A `Transition` is one atomic `from → to` edge. An **Action** (a named verb) is the OR of its edges —
disjunction lives at the action level, never inside a `Transition`, so the kernel stays atomic and
serializable.

The `from`/`to` asymmetry is load-bearing and applies to **both** `predicate` (legality) and
`permission` (authz): `from.*` is evaluated against the **current** record, `to.*` against the
**resulting (merged)** record. Permission only ever lives on a side — every authz check reads a
concrete record, so there is no record-free action-level permission.

## Check

```ts
import { checkTransition } from '@inixiative/transitions';

const rules = {
  'db:Inquiry': {
    approve: {
      paths: [
        {
          from: { predicate: { field: 'status', operator: 'equals', value: 'pending' } },
          to: { predicate: { field: 'status', operator: 'equals', value: 'approved' } },
        },
      ],
    },
  },
};

checkTransition(rules, 'db:Inquiry', 'approve', { status: 'pending' }, { status: 'approved' });
// → true

checkTransition(rules, 'db:Inquiry', 'approve', { status: 'approved' }, { status: 'approved' });
// → { paths: [{ from: { predicate: 'status must equal "pending"' } }] }
```

`checkTransition(rules, resource, action, record, changes, { actor, authorize })` returns **`true`** when
allowed, else a structured **`Reason`** — never a bare bool:

```ts
type SideReason = { predicate?: string; permission?: string }; // why one side failed
type PathReason = { from?: SideReason; to?: SideReason };       // why one candidate path failed
type Reason = { paths: PathReason[] };                          // one entry per path tried
```

Each side reports its `predicate` (legality) and `permission` (authz) failures independently, and
`from`/`to` are kept separate — so the caller sees the whole picture, not just the first failure. To
map to HTTP: a path that fails purely on `permission` is a 403; any `predicate` failure is a 409.
`describe(reason)` builds a human-readable message.

`checkPath(transition, record, changes, options)` is the single-edge kernel underneath, returning
`true | PathReason`; `checkTransition` walks an action's paths with it and returns the first `true`,
else every path's `PathReason`.

## Permissions are injected (the seam)

The kernel never imports an authorization library. Per-side `permission` is a serializable
`ActionRule` re-exported straight from [`@inixiative/permissions`](https://github.com/inixiative/permissions)
(`string` delegation, `{ rel, action }`, `{ self }`, abac `{ rule }`, `any`/`all`, boolean terminals
`true`/`false`, `null`), and you inject an `authorize` callback to evaluate it:

```ts
import { checkTransition, createAuthorize } from '@inixiative/transitions';

const authorize = createAuthorize({ schema: rebacSchema })('db:Inquiry');
checkTransition(rules, 'db:Inquiry', 'approve', record, changes, { actor, authorize });
```

Effective authz ANDs the two side rules, each against the record it reads:

```
from.permission   AND   to.permission
(current record)        (merged record)
```

Absent = open; `null` (or `false`) = terminal deny. Omit `authorize` to check legality only.

### `createAuthorize` — the `@inixiative/permissions` adapter

Authorization is **not** reimplemented here. `createAuthorize` is a thin adapter that bridges
`@inixiative/permissions`' production rebac `check` onto the `Authorize` seam:
`createAuthorize(options)(resource)` returns an `Authorize` bound to a (map-qualified) `resource`.
permissions owns the whole evaluation — `string` delegation with **cycle detection**, intra-map `rel`
walks (via an injected `resolveRelation`), cross-map bridge walks, `{ self }`, abac `{ rule }`, boolean
terminals, `any`/`all`, and per-row `permissionRules` overrides. It speaks the same map-qualified
`resource` keys as this package.

```ts
import type { RebacSchema } from '@inixiative/permissions';
import { createAuthorize } from '@inixiative/transitions';

const schema: RebacSchema = { permissions: { 'db:Inquiry': { actions: { /* … */ } } } };
const authorize = createAuthorize({
  schema,
  resolveRelation, // optional; default: the relation segment name is the resource key
  isSuperadmin,    // optional; derived from the actor
})('db:Inquiry');
```

`options`: `schema` (permissions' `{ bridges?, permissions }`), optional `resolveRelation`,
`isSuperadmin`, and `data` (supplemental hydrated rows for bridge walks). A cyclic permission graph —
which permissions surfaces by throwing — is caught and denied (fail closed), so the guard terminates
cleanly.

## Affordance + set query

```ts
import { available, eligible } from '@inixiative/transitions';

available(rules, 'db:Inquiry', record, { actor, authorize });
// → ['approve', 'reject', 'cancel']   (from-side only — `to` needs proposed changes, so it defers to checkTransition)

eligible(rules, 'db:Inquiry', 'approve');
// → { OR: [{ status: { equals: 'pending' } }] }   (Prisma where for "every record eligible for approve")
```

## Merge strategies

`to.merge` produces the resulting record. Keyword strategies are serializable; a callback is full-power
but not (`isSerializable(transition)` tells you which).

- `spread` (default) — shallow overwrite
- `deepMerge` — recursive, arrays replaced
- `{ kind: 'append', path }` — concat at a field path
- `{ kind: 'appendUnique', path }` — concat + dedupe

## Authoring validation

`validateTransition(t, { lens?, requireSerializable? })` validates predicates (via json-rules
`validateRule`, plus `checkRuleAgainstLens` when a `lens` scopes referenceable fields), merge
strategy, and permission shape (via `@inixiative/permissions`' zod `actionRuleSchema`) — run it on
save before persisting a tenant config. It returns structured `{ ok, errors }` (never throws), even on
malformed input.

## Not built yet (designed — see the plan)

- **`requires` relation loader** — derive a Prisma `include` from a side's `requires`, auto-load, fail
  loud on unloaded reads, respect tenancy. The kernel ignores `requires` (it's metadata).
- **Permission-filtered `available()`** beyond the from-side static check.
- **Lens-aware structural composition** check (does A's `to` lens line up with B's `from`).
- **Non-goals:** statecharts, side effects / on-transition callbacks, a workflow engine, a config UI.

## License

MIT
