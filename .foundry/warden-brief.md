# transitions, for its Wardens

transitions (`@inixiative/transitions`) is a small published Bun/TypeScript package: a stateless,
declarative transition guard and affordance layer on top of `@inixiative/json-rules`. It answers
"can this change happen" (`checkTransition`, over the single-edge kernel `checkPath`) and "what
changes can happen" (`available` for one record, `eligible` for a Prisma plan). It is not a state
machine: it owns no state, never executes the change and never imports Prisma. Most work here
changes one of the existing parts; very little is new.

## Shape of the repository

- `index.ts`: the only export (`.`, built by tsup to `dist/`). It re-exports `src/` and imports
  `src/engineGlobals.ts` for its side effect.
- `src/`: one file per part: `types.ts` (the model, reasons, options), `check.ts`, `registry.ts`,
  `describe.ts`, `authorize.ts`, `merge.ts`, `serializable.ts`, `validate.ts`.
- `test/`: bun tests.
- `README.md` is the user doc; `docs/FEAT-018-transitions.md` is the design. Its preface, tasks,
  consumers, integration notes and open questions are history.

## Systems other code depends on

- The model: `resource -> action -> { paths: Transition[] }`, `Transition { from, to }`, each side
  `{ predicate, permission?, requires? }`. An action is the OR of its paths; `from` reads the
  current record, `to` reads the merged record.
- `Reason` (per path, per side, predicate and permission apart) is what callers map to 403 or 409.
- The `Authorize` callback seam: the kernel never evaluates permissions itself; `createAuthorize`
  adapts `@inixiative/permissions`' `createRebacCheck`.
- `to.merge` builds the merged record; keyword strategies are serializable, a callback is not.
- `validateTransition` is authoring validation for tenant-stored transitions and never throws.

## Words used here

Resource, action (a transition verb, not a permission capability), path, side, predicate,
permission, requires, merge, reason, affordance, eligible plan, lens (field scope, not authz).
