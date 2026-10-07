# Changelog

## 0.3.0 — json-rules 3.0, permissions 0.4.0

- **Requires `@inixiative/json-rules@^3.0.0` and `@inixiative/permissions@^0.4.0`.** Predicates
  and abac `{ rule }` permissions take json-rules 3.0's semantics: an absent path reads as NULL,
  a negation keeps NULL rows, values compare as JSON (`"3"` never equals `3`), and a rule
  json-rules refuses (an `in` with a scalar, an unknown period unit or aggregate mode) throws out
  of `checkTransition` / `available` / `eligible` instead of answering. Review stored guards that
  leaned on the old coercions.
- **`validateTransition` returns json-rules' `ValidationResult`**: each issue is
  `{ path, message, code }`. json-rules' issues keep their codes; transitions' own are
  `missing_side`, `missing_predicate`, `invalid_permission`, `invalid_requires`, `invalid_merge`
  and `unserializable_merge`. The lens check is json-rules' `validateRuleInLens` (was
  `checkRuleAgainstLens`), so lens issues carry its codes (`not_in_lens`, …).
- `Row` and `ValidationIssue` / `ValidationResult` are json-rules' own types, re-exported.
  `PredicateOptions` is `CheckOptions` with `context` from `CompileOptions` (a `Row`), so one
  options object serves `check()` and `toPrisma`.
- `eligible` for a single-path action returns that path's `from` predicate unwrapped
  (`{ status: … }`, not `{ OR: [{ status: … }] }`); json-rules 3.0 no longer wraps a one-arm
  OR / AND. An empty action is still `{ OR: [] }` (match-nothing).
- `prepare` installs lefthook only inside a git checkout.

## 0.2.0 — predicates evaluate with json-rules' `check()` options

- `checkTransition`, `checkPath` and `available` take json-rules' own `check()` options —
  `now`, `timeZone`, `weekStart`, `bindings`, `context` — alongside `actor` / `authorize`
  (`TransitionOptions = AuthorizeOptions & PredicateOptions`, where `PredicateOptions` is
  json-rules' `CheckOptions` with `context` a row), and pass them to both sides. Before, the
  kernel called `check()` with no options, so a predicate with a relative date (`{ ago: … }`),
  a `{ bind }` token or a context path threw.
- `eligible(rules, resource, action, options?)` takes the same `PredicateOptions`: bindings are
  resolved into the union of `from` predicates, and `now` / `context` reach `toPrisma`, so the
  set query and the single check agree. A guard `toPrisma` can't express — a `$.` row ref in an
  offset or magnitude — throws rather than return the wrong set.
- json-rules `^2.27.0`: date and aggregate `bind` on `check()`, `offset` on path and bind,
  `{ path }` magnitudes.
- **First consumer:** Zealot platform alert incidents. `autoResolve` reads each incident's
  window off its own rule — `lastBreachedAt before { ago: { seconds: { path:
  '$.platformAlertRule.autoResolveAfterSeconds' } } }` — and is checked per incident under a row
  lock with `checkTransition`.

## 0.1.0 — reference rebac evaluator replaced by a permissions adapter

Breaking: the bundled reference rebac evaluator is removed and replaced by a thin adapter over `@inixiative/permissions` — the production engine, injected rather than re-forked.

- **Removed `src/rebac/`** (the forked evaluator). It had drifted from `@inixiative/permissions` and carried bugs the sibling already fixes: an infinite CPU hang on a string-delegation cycle, spurious cycle detection on id-less records, and crashes on the boolean terminals permissions added.
- **Added `createAuthorize({ schema, ... })`** — bridges permissions' `check` onto the `Authorize` seam; `createAuthorize(options)(resource)` returns an `Authorize` bound to a (map-qualified) resource. permissions owns the evaluation (string delegation with cycle detection, `rel` walks, `{ self }`, abac `{ rule }`, boolean terminals, `any`/`all`, per-row overrides).
- **`validateTransition` returns structured issues instead of throwing** on the malformed input it exists to validate (`permission: true`, a missing `to`, `{ any: 'x' }`), delegating ActionRule validation to permissions' zod `actionRuleSchema`.
- `ActionRule` is re-exported directly from `@inixiative/permissions` (single source of truth, including boolean terminals) — the parity is real, not asserted.
- Deps: `@inixiative/permissions@^0.3.0` (+ `zod` for the schema) and `@inixiative/json-rules@^2.12.1`. The guard/affordance kernel (`checkTransition`, `checkPath`, `merge`) is unchanged.
