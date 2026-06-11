# @inixiative/transitions

A small, **stateless** primitive on top of [`@inixiative/json-rules`](https://github.com/inixiative/json-rules)
that answers two questions about an entity's lifecycle, declaratively:

- **"Can this change happen?"** — guard a proposed update (`check`).
- **"What changes can happen?"** — list available verbs for a record (`available`), and via
  `toPrisma`, every record currently eligible for a verb (`eligible`).

It is **not** a state machine (no statecharts/actors/hierarchy), does **not** own state, and does
**not** execute the change or run side effects. It is a guard + affordance layer. A transition is
**pure data** → serializable → tenant-configurable at runtime (stored in the DB, edited in a UI,
no deploy to change a lifecycle).

> Full design: [`docs/FEAT-018-transitions.md`](./docs/FEAT-018-transitions.md).

## Model

```
model → verb → Action { paths: Transition[], permission?, label? }
                         Transition { from: Side, to: Side & { merge? } }
                         Side       { predicate, permission?, requires? }
```

A `Transition` is one atomic `from → to` edge. An **Action** (a named verb) is the OR of its edges —
disjunction lives at the action level, never inside a `Transition`, so the kernel stays atomic and
serializable.

The `from`/`to` asymmetry is load-bearing and applies to **both** `predicate` (legality) and
`permission` (authz): `from.*` is evaluated against the **current** record, `to.*` against the
**resulting (merged)** record.

## Two failure modes, one check

```ts
import { checkTransition } from '@inixiative/transitions';

const approve = {
  from: { predicate: { field: 'status', operator: 'equals', value: 'pending' } },
  to: { predicate: { field: 'status', operator: 'equals', value: 'approved' } },
};

checkTransition(approve, { status: 'pending' }, { status: 'approved' });
// → { ok: true, path: approve }

checkTransition(approve, { status: 'approved' }, { status: 'approved' });
// → { ok: false, reason: { kind: 'no-from', from: 'status must equal "pending"' } }
```

`check` returns a **structured reason**, never a bare bool:

| `reason.kind`  | meaning                                            | suggested HTTP |
| -------------- | -------------------------------------------------- | -------------- |
| `no-from`      | no edge starts from the current state              | 409            |
| `no-to`        | the merged state is not a valid target             | 409            |
| `unauthorized` | a legal edge exists but a permission denied        | 403            |

`describe(reason)` builds a human-readable message; `reason.kind` drives the status code.

## Permissions are injected (the seam)

The kernel never imports an authorization library. Per-side `permission` is a serializable
`ActionRule` (the same rebac/abac/rbac algebra as `@template/permissions`), and you inject an
`authorize` callback to evaluate it:

```ts
import { check, createRebac } from '@inixiative/transitions';

const authorize = createRebac({ schema: rebacSchema })('inquiry');
check(transitions, 'inquiry', 'approve', record, changes, { actor, authorize });
```

Effective authz ANDs three rules, each against the record it reads:

```
action.permission   AND   from.permission   AND   to.permission
(verb capability)         (current record)        (merged record)
```

Absent = open; `null` = terminal deny.

### `createRebac` / `makeRebacAuthorize` — reference implementation

This package ships a **reference** rebac evaluator (`string` delegation, relation walk with cycle
detection, `{ self }`, json-rules `{ rule }`, `any`/`all`, per-row `permissionRules` override). It's
one implementation of the `Authorize` seam, kept deliberately swappable. It is slated to graduate
into a standalone `@inixiative/permissions` package — when it does, inject that instead; nothing in
the transition core changes.

## Affordance + set query

```ts
import { available, eligible } from '@inixiative/transitions';

available(transitions, 'inquiry', record, { actor, authorize });
// → ['approve', 'reject', 'cancel']   (from-side only — `to` needs proposed changes, so it defers to check)

eligible(transitions, 'inquiry', 'approve');
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
