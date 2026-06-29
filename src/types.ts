import type { Condition } from '@inixiative/json-rules';

export type Row = Record<string, unknown>;

/**
 * The serializable permission algebra. Re-declared here (not imported from any app's
 * permissions package) so this stays a zero-app-dependency primitive; structurally identical
 * to `@template/permissions`' rebac `ActionRule`. The kernel never interprets it — it hands the
 * rule to an injected {@link Authorize} callback.
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
 * Injected permission evaluator. Model-free: the kernel knows nothing about models or schemas,
 * so the consumer closes over whatever its rebac needs (see {@link makeRebacAuthorize}).
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
 * One half of a transition. `predicate` (legality) and `permission` (authz) are both evaluated
 * against the SAME record — the load-bearing asymmetry is WHICH record: `from.*` reads the
 * CURRENT record, `to.*` reads the RESULTING (merged) record.
 */
export type Side = {
  predicate: Condition; // json-rules — is this state shape legal?
  permission?: ActionRule; // authz against THIS side's record. Absent = open.
  requires?: Include; // relations the predicate reads (metadata; for the future loader)
};

export type ToSide<R extends Row = Row> = Side & { merge?: Merge<R> };

/** An atomic edge: `from → to`. Disjunction lives at the action level, never here. */
export type Transition<R extends Row = Row> = {
  from: Side;
  to: ToSide<R>;
};

/**
 * A named verb: the OR of its edges. An object (not a bare `Transition[]`) so the action can
 * carry affordance metadata (`label`). Authorization lives on the per-side `permission`s, which
 * always read a concrete record — there is no record-free action-level permission.
 */
export type Action<R extends Row = Row> = {
  paths: Transition<R>[]; // OR of edges; single-path action = array of one
  label?: string; // affordance UI
};

/** `resource → action → Action`, where `resource` is the (map-qualified) key — e.g. `db:Inquiry`,
 *  matching `@inixiative/permissions`' rebac schema keys so a transition's `permission` resolves
 *  against the same resource identity. */
export type TransitionMap = Record<string, Record<string, Action>>;

// --- check result ---

/** Why one side failed. Both keys are independent; either, both, or neither may be set. */
export type SideReason = {
  predicate?: string; // json-rules reason when the side's predicate failed
  permission?: string; // set when the side's permission denied
};

/** Why one candidate path failed — `from` and `to` reported separately. */
export type PathReason = {
  from?: SideReason;
  to?: SideReason;
};

/** Why an action failed: one {@link PathReason} per candidate path that was tried. */
export type Reason = {
  paths: PathReason[];
};

/** `true` when the transition is allowed, else a structured {@link Reason}. */
export type CheckResult = true | Reason;

/** Options threaded into a check. Omit `authorize` to evaluate legality only. */
export type AuthorizeOptions = {
  actor?: Actor;
  authorize?: Authorize;
};
