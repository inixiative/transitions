import type { Condition } from '@inixiative/json-rules';

export type Row = Record<string, unknown>;

/**
 * The serializable permission algebra.
 *
 * Re-declared here — deliberately NOT imported from any app's permissions package — so
 * `@inixiative/transition` stays a zero-app-dependency primitive. It is structurally
 * identical to the rebac `ActionRule` used by `@template/permissions`, so a permission
 * rule authored over there deserializes into a transition's `permission` field unchanged.
 *
 * The kernel never *interprets* an ActionRule; it hands the rule to an injected
 * {@link Authorize} callback. Resolving `string` (delegate) and `{ rel, action }`
 * (relation walk) requires a model + schema, which lives in the authorizer, not here.
 */
export type ActionRule =
  | string // delegate to another action on the same model (resolved by the authorizer)
  | { rel: string; action: string } // walk a relation, then check `action` on the target
  | { self: string } // record[field] === actor.id
  | { rule: Condition } // ABAC predicate over the record (json-rules)
  | { any: ActionRule[] } // OR
  | { all: ActionRule[] } // AND
  | null; // terminal deny

export type Actor = ({ id?: string | null } & Row) | null | undefined;

/**
 * Injected permission evaluator. Model-free by design: the kernel knows nothing about
 * models or schemas, so the consumer closes over whatever its rebac needs (see
 * {@link makeRebacAuthorize} for the reference implementation). Returns a bare boolean —
 * authz is yes/no; the structured-reason machinery lives in the kernel.
 */
export type Authorize = (rule: ActionRule, record: Row, actor: Actor) => boolean;

/** Serializable merge keywords (Mongo-flavored). Array strategies are field-scoped. */
export type MergeStrategy =
  | 'spread' // ≈ $set — shallow overwrite (default)
  | 'deepMerge' // ≈ $merge — recursive
  | { kind: 'append'; path: string } // ≈ $push — concat at path
  | { kind: 'appendUnique'; path: string }; // ≈ $addToSet — concat + dedupe at path

/** A merge is a raw callback (full power, NOT serializable) or a serializable keyword strategy. */
export type Merge<R extends Row = Row> = ((record: R, changes: Partial<R>) => R) | MergeStrategy;

/** Prisma-include-shaped metadata: the relations a side's predicate reads. Kernel ignores it. */
export type Include = Record<string, unknown>;

/**
 * One half of a transition. `predicate` (legality) and `permission` (authz) are evaluated
 * against the SAME record — and which record is the load-bearing asymmetry:
 * `from.*` reads the CURRENT record, `to.*` reads the RESULTING (merged) record.
 */
export type Side = {
  predicate: Condition; // json-rules — is this state shape legal?
  permission?: ActionRule; // authz w.r.t. THIS side's record. Absent = open.
  requires?: Include; // relations the predicate reads (metadata; for the future loader)
};

export type ToSide<R extends Row = Row> = Side & { merge?: Merge<R> };

/** An atomic edge: `from → to`. Disjunction lives at the action level, never here. */
export type Transition<R extends Row = Row> = {
  from: Side; // predicate + permission against the CURRENT record
  to: ToSide<R>; // predicate + permission against the RESULTING (merged) record
};

/**
 * A named verb: the OR of its edges. An object (not a bare `Transition[]`) because the
 * action is the unit of authorization (`permission`, ANDed with each side) and affordance
 * (`label`).
 */
export type Action<R extends Row = Row> = {
  paths: Transition<R>[]; // OR of edges; single-path action = array of one
  permission?: ActionRule; // verb capability, state-independent; ANDed with from/to permissions
  label?: string; // affordance UI
};

/** `model → verb → Action`. Mirrors the shape of a rebac schema. */
export type TransitionMap = Record<string, Record<string, Action>>;

// --- check result ---

export type FailureKind = 'no-from' | 'no-to' | 'unauthorized';
export type AuthzLevel = 'action' | 'from' | 'to';

export type PathFailure = {
  from?: string; // json-rules reason when from.predicate failed
  to?: string; // json-rules reason when to.predicate failed
  authz?: AuthzLevel; // which permission level denied
};

export type Reason = PathFailure & {
  kind: FailureKind; // drives 409 (no-from/no-to) vs 403 (unauthorized) at the callsite
  paths?: PathFailure[]; // per-candidate-path detail (registry-level, multi-path)
};

export type CheckResult<R extends Row = Row> =
  | { ok: true; path: Transition<R> }
  | { ok: false; reason: Reason };

/** Options threaded into a check. Omit `authorize` to evaluate legality only. */
export type CheckOptions = {
  actor?: Actor;
  authorize?: Authorize;
  /** Action-level baseline permission, ANDed against the current record (supplied by the registry). */
  basePermission?: ActionRule;
};

/** Options for affordance/check at the registry level. */
export type AuthorizeOptions = {
  actor?: Actor;
  authorize?: Authorize;
};
