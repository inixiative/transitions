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
`ActionRule` (the same rebac/abac/rbac algebra as `@template/permissions`), and you inject an
`authorize` callback to evaluate it:

```ts
import { checkTransition, createRebac } from '@inixiative/transitions';

const authorize = createRebac({ schema: rebacSchema })('db:Inquiry');
checkTransition(rules, 'db:Inquiry', 'approve', record, changes, { actor, authorize });
```

Effective authz ANDs the two side rules, each against the record it reads:

```
from.permission   AND   to.permission
(current record)        (merged record)
```

Absent = open; `null` = terminal deny. Omit `authorize` to check legality only.

### `createRebac` / `makeRebacAuthorize` — reference implementation

This package ships a **reference** rebac evaluator (`string` delegation, relation walk with cycle
detection, `{ self }`, json-rules `{ rule }`, `any`/`all`, per-row `permissionRules` override). It's
one implementation of the `Authorize` seam, kept deliberately swappable. The standalone
[`@inixiative/permissions`](https://github.com/inixiative/permissions) package is the production
evaluator — inject its `check` as the `authorize` seam (it speaks the same map-qualified
`resource` keys); nothing in the transition core changes.

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
strategy, and permission shape — run it on save before persisting a tenant config.

## Not built yet (designed — see the plan)

- **`requires` relation loader** — derive a Prisma `include` from a side's `requires`, auto-load, fail
  loud on unloaded reads, respect tenancy. The kernel ignores `requires` (it's metadata).
- **Permission-filtered `available()`** beyond the from-side static check.
- **Lens-aware structural composition** check (does A's `to` lens line up with B's `from`).
- **Non-goals:** statecharts, side effects / on-transition callbacks, a workflow engine, a config UI.

## License

MIT
