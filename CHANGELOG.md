# Changelog

## 0.2.0 — predicates evaluate with `now` and `bindings`

- `checkTransition`, `checkPath` and `available` take `now`, `timeZone`, `weekStart` and
  `bindings` alongside `actor` / `authorize` (`CheckOptions = AuthorizeOptions & EvaluationOptions`),
  and pass them to json-rules for both sides. Before, the kernel called `check()` with no
  options, so a predicate with a relative date (`{ ago: … }`) or a `{ bind }` token threw.
- `eligible(rules, resource, action, options?)` takes the same `EvaluationOptions`: bindings are
  resolved into the union of `from` predicates and `now` anchors relative dates before
  `toPrisma`, so the set query and the single check agree.
- json-rules `^2.27.0`, where date rules honor `bind` in `check()`.
- **First consumer:** Zealot platform alert incidents. `autoResolve` is guarded by
  `lastBreachedAt before { bind: 'quietWindow' }`; the evaluator binds each rule's
  `{ ago: { seconds: autoResolveAfterSeconds } }` and selects the incidents with `eligible`.

## 0.1.0 — reference rebac evaluator replaced by a permissions adapter

Breaking: the bundled reference rebac evaluator is removed and replaced by a thin adapter over `@inixiative/permissions` — the production engine, injected rather than re-forked.

- **Removed `src/rebac/`** (the forked evaluator). It had drifted from `@inixiative/permissions` and carried bugs the sibling already fixes: an infinite CPU hang on a string-delegation cycle, spurious cycle detection on id-less records, and crashes on the boolean terminals permissions added.
- **Added `createAuthorize({ schema, ... })`** — bridges permissions' `check` onto the `Authorize` seam; `createAuthorize(options)(resource)` returns an `Authorize` bound to a (map-qualified) resource. permissions owns the evaluation (string delegation with cycle detection, `rel` walks, `{ self }`, abac `{ rule }`, boolean terminals, `any`/`all`, per-row overrides).
- **`validateTransition` returns structured issues instead of throwing** on the malformed input it exists to validate (`permission: true`, a missing `to`, `{ any: 'x' }`), delegating ActionRule validation to permissions' zod `actionRuleSchema`.
- `ActionRule` is re-exported directly from `@inixiative/permissions` (single source of truth, including boolean terminals) — the parity is real, not asserted.
- Deps: `@inixiative/permissions@^0.3.0` (+ `zod` for the schema) and `@inixiative/json-rules@^2.12.1`. The guard/affordance kernel (`checkTransition`, `checkPath`, `merge`) is unchanged.
