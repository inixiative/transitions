# FEAT-018: `@inixiative/transitions` — declarative transition guard + affordance layer

**Status**: 🆕 Not Started
**Assignee**: TBD
**Priority**: Medium
**Created**: 2026-06-08
**Updated**: 2026-06-08

---

## Overview

A small, **stateless** primitive on top of `@inixiative/json-rules` that answers two
questions about an entity's lifecycle, declaratively:

- **"Can this change happen?"** — guard a proposed update.
- **"What changes can happen?"** — list available transitions for a record (and, via
  `toPrisma`, every record currently eligible for a transition).

It is **not** a state machine (no statecharts/actors/hierarchy), does **not** own state,
and does **not** execute the change or run side effects (that stays in the hooks pipeline).
It is a guard + affordance layer. Depends on json-rules; does **not** live inside it
(json-rules = predicates + `toPrisma`; transitions = before/after + merge + registry).

The unlock: a transition is **pure data** → serializable → **tenant-configurable at runtime**
(stored in the DB, edited in a UI, no deploy to change a lifecycle).

## Shape

```ts
type Side = {
  predicate: Condition;     // json-rules — is this state shape legal?
  permission?: ActionRule;  // json-rules-native rebac rule; authz w.r.t. THIS side's record. Absent = open.
  requires?: Include;       // Prisma-include-shaped; relations the predicate reads (metadata)
};

type Merge =
  | ((record, changes) => next)              // code callers: full power, NOT serializable
  | MergeStrategy;                           // serializable keyword (see below)

type Transition = {
  from: Side;                                // predicate + permission evaluated against the CURRENT record
  to:   Side & { merge?: Merge };            // predicate + permission evaluated against the RESULTING (merged) record
};
// No edge-level `permission` knob: per-side authz subsumes it (every path owns its from/to sides) and
// splits authz by which record it reads — see "Permission placement (decided)" below.
```

- `from`/`to` share a shape; the asymmetry (current vs resulting record) is load-bearing —
  make it loud in types/docs. It applies to **both** `predicate` and `permission`: `from.*` reads the
  current record, `to.*` reads the merged record. This is why authz lives on the sides — an ABAC rule on a
  changing field's OLD value (e.g. "only admin may move a role *away from* owner") is only visible to
  `from.permission`; the merged record has already overwritten it.
- `merge` lives on `to` (it produces the resulting state). Default `spread`.

### Merge strategies (Mongo-flavored, serializable)
Hybrid: a raw callback is allowed for code callers; serialized/customer configs must use a
keyword strategy. Provide an `isSerializable(transition)` check so callers know whether a
given transition can be persisted/tenant-configured.

- `spread` (≈ `$set`, default) — shallow overwrite
- `deepMerge` (≈ `$merge`)
- `{ kind: 'append', path }` (≈ `$push`) — array concat (field-scoped → needs a path)
- `{ kind: 'appendUnique', path }` (≈ `$addToSet`) — concat + dedupe

> Gotcha: array strategies are **field-scoped** — `{ kind, path }`, not a bare keyword.

## Kernel (pure, ORM-agnostic, ~tiny)

```ts
check(t, record, changes, { actor, authorize }?) => {
  const next = applyMerge(t.to.merge, record, changes);
  // per side: legality (json-rules → true | reason string) AND authz (injected rebac.check → boolean).
  // from.* reads `record`; to.* reads `next`.
  → | { ok: true }
    | { ok: false, reason: {
        kind: 'no-from' | 'no-to' | 'unauthorized',  // drives 409 (illegal) vs 403 (unauthorized)
        from?: string,                // json-rules failure string when from.predicate fails
        to?: string,                  // json-rules failure string when to.predicate fails
        authz?: 'action' | 'from' | 'to',  // which permission level denied
      }}
}
```

Return a **structured reason**, not a bare bool — `kind` lets the caller map illegal→409 vs
unauthorized→403, and a `describe(reason)` helper assembles the combined human message
("can't reach `connected` from `disconnected`" / "not authorized to leave `owner`"). json-rules
already returns the per-predicate reason string; authz returns the denying level. Authz is injected
(`authorize`) — the kernel never imports permissions.

## Duality (why it earns a package)

Every `from.predicate` is also a query:
- **point**: `check(t, record, changes)` — guard one change.
- **set**: `toPrisma(t.from.predicate)` → a `where` for *all* records eligible for `t`,
  e.g. `prisma.inquiry.findMany({ where: toPrisma(resolve.from.predicate) })`.

## Registry + Actions (the affordance layer)

A `Transition` is atomic (one `from→to→merge`). An **action** is a named group of
transitions — its *paths* — so one logical verb can be valid via several edges
(`a→b` OR `c→d`) without losing that they're one action. Disjunction lives at the
action level, never inside a `Transition` (keeps the kernel atomic + serializable).

```
type Action = {
  paths: Transition[];      // OR of edges; single-path action = array of one
  permission?: ActionRule;  // @monorepo/permissions rebac rule (serializable); see Verified notes
  label?: string;           // affordance UI
};
Map<model, Record<actionName, Action>>
```
An action is an **object**, not a bare `Transition[]`: actions are the unit of authorization
(per-action, state-independent) and affordance (label/icon), and a bare array has nowhere to
hang those — both are already on the roadmap, so the object isn't speculative.
- `available(model, record, { actor, authorize })` → action names with **any** path whose
  `from.predicate(record)` is true **and** both `action.permission` and that path's `from.permission`
  authorize against the current record → drives action-button enablement, API affordances, "what can I do".
  **`to.predicate`/`to.permission` are NOT evaluated here** — they need the merged record, which doesn't
  exist without proposed changes. The `to` side defers to `check()`; `available()` is an affordance hint,
  `check()` is authoritative.
- `check(model, action, record, changes)` → **first** path whose `from` matches the current
  record AND `to` matches the merged next-state (that path's `merge` applies).
- `eligible(model, action)` → `toPrisma(Any[...paths.map(p => p.from.predicate)])` — one OR'd
  `where` for bulk "who can take this action" (verified: `toPrisma(Any) → { OR: [...] }`).

## Serializable → tenant-configurable

Because predicates (json-rules), `requires` (include shape), and keyword merge strategies are
all JSON, a transition set can be stored per-tenant and edited without a deploy. This turns a
code primitive into a configuration surface. Requirements that fall out of this:

- **Authoring validation** (mirror json-rules' existing **lens validation** — read its impl,
  don't invent a parallel API): on save, validate predicate fields/types exist, `requires` is
  a valid include, `merge` is a known strategy.
- **Field/relation allowlist per model** — a customer predicate compiles via `toPrisma` to a
  real `where` (customer-controlled DB query) and `requires` to real loads. Without scoping,
  that's a data-exposure / access-control hole. The configurable surface must constrain which
  fields/relations a tenant may reference.
- **Relation loads respect permissions/tenancy** (see relations layer below).

## Lens-awareness / composition (scoped)

Make transitions lens-aware so **composition** can be checked — but scope it:
- **Cheap (do this):** structural / lens alignment — does A's `to` lens line up with B's
  `from` lens; mirror json-rules' lens validation.
- **Expensive (do NOT promise):** reachability / "do these predicates ever co-satisfy" is
  predicate **satisfiability** — SAT-hard for arbitrary conditions. No solver.

## Relations (`requires`) — designed, NOT built yet

Kernel ignores `requires` (it's metadata). A **separate optional loader** later derives the
Prisma `include` from `requires`, auto-loads before eval, fails loud if a predicate reads an
unloaded relation (vs silently `undefined`), and **respects permissions/tenancy**. The kernel
must never import Prisma. Build only when the first relation-referencing transition appears.

## Scope

- **Now:** kernel + merge (cb + keyword strategies + `isSerializable`) + registry +
  `available()` + `toPrisma` set-query + authoring validation + field allowlist.
- **Later (design in README, unbuilt):** `requires`/relation-loader, permission-filtered
  `available()`, lens composition checks beyond structural.
- **Non-goals:** statecharts, side effects / on-transition callbacks, a workflow engine, a
  config UI. Core stays a pure evaluator over data.

## Tasks

- [x] Package skeleton `@inixiative/transitions`, depends on `@inixiative/json-rules`
- [x] Kernel `checkTransition()` (from/to predicate eval + merge application + per-side authz) returning structured `{ ok, reason }`
- [x] Merge: raw cb + keyword strategies (`spread`, `deepMerge`, `append`, `appendUnique`) +
      `isSerializableMerge` / `isSerializable(transition)`
- [x] Registry: `check`, `available(model, record)`, `eligible(model, verb)` over `TransitionMap`
- [x] `toPrisma` set-query helper off `from.predicate` (`eligible` = `toPrisma(Any[...froms])`)
- [x] Authoring validator (`validateTransition`) — predicates via json-rules `validateRule` + optional
      `checkRuleAgainstLens` for the field allowlist; merge + permission shape. _(per-model allowlist is
      injected as a `lens`; deriving it from `@template/db` lens is consumer-side / Later.)_
- [ ] Lens-aware structural composition check (no SAT solver) — **deferred** (Later; not blocking)
- [x] Tests: kernel (from/to asymmetry incl. old-value authz), merge strategies, serializability,
      registry first-match + precedence + `available()` + `eligible()` round-trip, validator
      rejections, reference rebac authorizer. **60 tests, all passing.**
- [x] README: model, injection seam, reference-rebac graduation note, Later scope / non-goals
- [x] `describe(reason)` human-message helper (shipped alongside the kernel)
- [ ] Adopt for first consumers (ZLT-2652 reference lifecycle; template inquiry status)

## Consumers (template-first)

Ships as the base primitive any status-bearing model adopts. Reference adopter in template:
- **Inquiry status** lifecycle (`available()` powers the inquiry action surface).

Downstream apps adopt it for their own lifecycles (e.g. tribe: Bot status, ChatMessage
`pending → sent → failed`). Pairs with typing status as a discriminated union (compile-time);
this is the runtime half.

## Verified integration notes
_Source-checked 2026-06-08 against `@inixiative/json-rules@2.5.0` + `@monorepo/permissions`._

- **Permissions (rebac) is serializable + json-rules-native.** `ActionRule` (Zod, recursive):
  `string | null | { rel, action } | { self } | { rule } | { any: [] } | { all: [] }`, where the
  `{ rule }` leaf is a json-rules `Condition` (`check(rule.rule, record)`). So a transition's
  `action.permission` *is* an `ActionRule` — same serializable algebra as the from/to predicates.
  Inject `rebac.check(permix, schema, model, record, action.permission)` as the `authorize`
  callback. **Don't depend on / move permissions** — that dependency points the wrong way
  (generic primitive → app authz); injection keeps transitions zero-app-dep. Permission rules
  already live in the schema **and per-row** (`record.permissionRules`), so transition authz is
  tenant/row-configurable for free.
- **Lens is field-scope, NOT authz.** `LensNarrowing` is purely structural (`parent`,
  `root: ModelNarrowing`, `mapDefaults`; `EnumNarrowing.picks`) — no actor/context field. Use it
  for the referenceable-field allowlist (derive a narrowed lens per context) and
  `checkRuleAgainstLens` for **authoring validation** (already exists — don't reinvent). Two
  orthogonal axes: field-scope → lens; actor-authz → injected `rebac.check`.
- **`toPrisma` compiles booleans** (verified in impl): `Any → { OR: [...] }` (empty →
  match-nothing), `All → { AND: [...] }`. So `eligible(action) = toPrisma(Any[...froms])` yields
  one OR'd `where`.

- **Field-scope = reuse `@monorepo/db/lens`, don't build.** `lensFor(model)` is the base lens;
  `redactLens(lens)` narrows out redacted fields (from `HOOK_REDACT_FIELDS`); the read route
  already composes `projectByPath(redactLens(filterLens))` for its filter surface. So a
  transition's field allowlist + authoring validation = `checkRuleAgainstLens(predicate,
  redactLens(lensFor(model)) [+ context narrowings])`. No new field-security layer.
- **Registry mirrors `RebacSchema`.** Both are `Record<model, Record<actionName, …>>` over the
  same models on the same json-rules substrate — transitions is "the rebac schema for state
  changes." Keep shapes parallel; reuse the per-row override pattern (`record.permissionRules` ↔
  a per-row transitions override).
- **"action" is overloaded** — permission-action (authz capability: `read`, `own`) vs
  transition-action (state op: `connect`, `forcePair`). They compose (a transition's `permission`
  may name a permission-action), but keep the two registries conceptually distinct in docs.
- **⚠️ Prerequisite — the per-request context-narrowing cb lives in ZEALOT and is NOT ported.**
  The contextual lens form — `filterLens: (c) => LensNarrowing` (Hono ctx → narrowing, e.g. scope
  to the actor's tenant/role) — exists in zealot, but template only has the **static**
  `filterLens: LensNarrowing` (`appEnv.ts`, `prepareMiddleware.ts`, `routeTemplates/types.ts`).
  **Verified in zealot** (`apps/api/src/middleware/resources/scopeNarrowing.ts`): a
  `scopeNarrowing(scope)` middleware where `scope: (c: Context<AppEnv>) => WhereScope | Promise<WhereScope>`
  reads the route's static `filterLens`, then `mergeNarrowingWheres(current, await scope(c))` folds a
  per-request context where-narrowing into it. The narrowing *mechanism* (chains, `root.where`,
  `redactLens`) is in template; the **un-ported pieces are `scopeNarrowing` +
  `mergeNarrowingWheres` + the `Scope = (c) => WhereScope` route field** (zealot:
  `apps/api/src/middleware/resources/{scopeNarrowing,mergeNarrowingWheres}.ts`,
  `apps/api/src/lib/requestTemplates/types.ts`). Port those first for per-actor field/where-scoping
  of transition predicates.

## Worked example: validation → transition

Authz is **intrinsic** to a valid transition — one with no passing permission isn't valid; the
effective check ANDs every permission that applies. Absent = open; use deliberately.

**Permission placement — DECIDED: per-side (on `from`/`to`), drop the edge-level knob.**

Authz is ABAC-aware (`{ rule: Condition }` over record fields), so it carries the **same current-vs-merged
record dependency as the predicate** — which is exactly why it belongs on the `Side`. Effective authz:

```
effective = action.permission  AND  from.permission  AND  to.permission
            (verb capability)       (current record)      (merged record)
            all ANDed; absent = open (use deliberately)
```

- **Why not action-level only / merged-record only:** a single rule must pick one record and loses the
  other. Authz on a **changing field's OLD value** ("only admin may move a role *away from* owner") is
  only visible to `from.permission` — the merged record overwrote it. Not exotic; it's most
  "who-may-leave-this-state" rules.
- **Why this beats Option A (target-split verbs):** no verb explosion. `changeRole` stays ONE verb with
  a path per target role, each path's `to.permission` carrying that target's authz.
- **Why no standalone `Transition.permission`:** per-side subsumes it — every path already owns its
  `from`/`to` sides. Fewer knobs than A (action+path), strictly more expressive.
- **`available()` consequence:** only `action.permission` + `from.permission` are checkable from the
  current record; `to.permission` defers to `check()` (see Registry section). Consistent with `to.predicate`.

Big payoff: a class of imperative validation collapses into from/to predicates.

**"Can't remove the last org owner."** Imperative today = a service checks "is this the last
owner?" and throws. As a transition on `organizationUser`:

```
removeOwner = {
  permission: 'manage',                              // rebac action: who may manage members
  paths: [{
    from: {
      predicate: All[
        { field: 'role', op: equals, value: 'owner' },                   // currently an owner
        <aggregate: organization.organizationUsers where role=owner → count > 1>  // another owner remains
      ],
      requires: { organization: { organizationUsers: true } },           // load siblings for the aggregate
    },
    to: { predicate: { field: 'role', op: notEquals, value: 'owner' } }, // result: no longer owner
  }],
};
```

`available(record)` won't offer `removeOwner` to the last owner (its `from` aggregate fails);
`check()` rejects it. The "last owner?" guard disappears into a declarative `from`. (Aggregate via
json-rules `AggregateRule` / `AGGREGATE_OPERATORS` — exact syntax TBD at build.)

**Inquiry (status lifecycle).** Maps almost 1:1; the per-type resolution *effects* stay in handlers
(gate, don't do):

```
approve = { permission: 'resolve',                 paths: [{ from: { status: pending }, to: { status: approved } }] }
reject  = { permission: 'resolve',                 paths: [{ from: { status: pending }, to: { status: rejected  } }] }
cancel  = { permission: { self: 'sourceUserId' },  paths: [{ from: { status: pending }, to: { status: cancelled } }] }
```

`available(inquiry)` → which of approve/reject/cancel to show (status=pending + actor); the existing
per-type `RESOLUTION_EFFECTS` + sent/resolved appEvents fire after, unchanged. So transitions owns
the inquiry *gate + affordance*; the inquiry handlers keep the *do*.

**Subsumes:** preconditions on current state, target-state shape, cardinality / "last-of-kind"
(aggregates over `requires`'d relations). **Does NOT replace:** cross-entity side effects,
multi-step sagas — anything that must *do*, not *gate*.

## Relevant files & references

- **json-rules** (`@inixiative/json-rules@2.5.0`): `check`, `toPrisma` (`Any→{OR}`, `All→{AND}`),
  `Any`/`All`, `applyLens`, `checkRuleAgainstLens`, `createLens`, `Lens`/`LensNarrowing`, `projectByPath`.
- **permissions**: `packages/permissions/src/rebac/{types,check,schema,permissionRulesSchema,ownerActions}.ts`.
- **db lens**: `packages/db/src/lens/{lensFor,redactLens,rootLens,searchablePaths,orderablePaths}.ts`;
  `packages/db/src/registries/redactFields.ts` (`HOOK_REDACT_FIELDS`).
- **route helpers (lens-scoped filtering precedent)**: `apps/api/src/lib/routeTemplates/read.ts`,
  `.../filters/{buildSearchFieldsSchema,buildOrderBySchema}.ts`, `.../utils/prepareMiddleware.ts`,
  `apps/api/src/lib/prisma/buildWhereClause.ts`, `apps/api/src/types/appEnv.ts`, `routeTemplates/types.ts`.
- **docs**: `docs/claude/CONTEXT.md`, `docs/claude/API_ROUTES.md` (filterLens semantics).
- **zealot**: source of the un-ported `(c) => LensNarrowing` context cb (not on this machine).

## Decisions & open questions

- **DECIDED — first-match passing.** First path whose `from` matches the current record, whose `to`
  matches the merged record, and whose permissions pass wins. If none pass, return the structured failure.
- **DECIDED — structured failure reasons.** `check()` returns `kind: 'no-from' | 'no-to' | 'unauthorized'`
  + per-side json-rules strings + the denying authz level, so callers map illegal→409 vs unauthorized→403;
  a `describe(reason)` helper builds the combined human message. Subsumes the old "does `available()`
  report near-miss reasons" question — the reason rides on `check()`.
- **CONFIRMED present in zealot (Later scope) —** `apps/api/src/middleware/resources/{scopeNarrowing,
  mergeNarrowingWheres}.ts` exist with `WhereScope` + the `Scope = (c: Context<AppEnv>) => WhereScope` cb
  form. Caveat: applied as ad-hoc middleware, **not** a first-class route field — porting needs the
  route-field ergonomics built on top. Not needed for the Now kernel.
- Per-request context-scope: zealot's dedicated `mergeNarrowingWheres` merge **vs** a second
  narrowing layer underneath the lens chain (`{ parent: redactLens(lensFor(model)), root: { where } }`).
  Chain form is more uniform with redaction/picks; the merge form may exist because stacking multiple
  `root.where`s needs explicit AND-ing (json-rules narrowing where-semantics — "implication/negate to
  preserve filter-first meaning", per `applyLens`). Decide at build.
- "Must something change" (no-op guard) is **not** a tool concern — express it in the from/to
  predicates (`from: x=a`, `to: x=b`). Recorded as a decision, not a question.
