import { check as checkRule } from '@inixiative/json-rules';
import { applyMerge } from './merge';
import type {
  ActionRule,
  Actor,
  Authorize,
  AuthorizeOptions,
  PathReason,
  Row,
  SideReason,
  Transition,
} from './types';

const predicateReason = (result: boolean | string): string =>
  typeof result === 'string' ? result : 'predicate not satisfied';

/**
 * Does this permission DENY?
 * - no authorizer injected → can't deny (legality-only mode)
 * - `undefined` rule → permission absent → open → can't deny
 * - any other rule (incl. `null` = terminal deny) → delegate to the authorizer
 */
const denies = (
  authorize: Authorize | undefined,
  rule: ActionRule | undefined,
  record: Row,
  actor: Actor,
): boolean => {
  if (!authorize || rule === undefined) return false;
  return !authorize(rule, record, actor);
};

/**
 * The kernel: evaluate one atomic edge. Reports every failure rather than short-circuiting —
 * `from`/`to` and predicate/permission are independent slots — so a caller sees the whole
 * picture. `from.*` reads the current `record`, `to.*` reads the merged `next` record. Returns
 * `true` when the edge is allowed, else the {@link PathReason}. Omit `authorize` for legality only.
 */
export const checkPath = <R extends Row>(
  transition: Transition<R>,
  record: R,
  changes: Partial<R> = {},
  options: AuthorizeOptions = {},
): true | PathReason => {
  const { actor, authorize } = options;
  const next = applyMerge(transition.to.merge, record, changes);

  const from: SideReason = {};
  const fromPredicate = checkRule(transition.from.predicate, record as Row);
  if (fromPredicate !== true) from.predicate = predicateReason(fromPredicate);
  if (denies(authorize, transition.from.permission, record as Row, actor))
    from.permission = 'not authorized';

  const to: SideReason = {};
  const toPredicate = checkRule(transition.to.predicate, next as Row);
  if (toPredicate !== true) to.predicate = predicateReason(toPredicate);
  if (denies(authorize, transition.to.permission, next as Row, actor))
    to.permission = 'not authorized';

  const reason: PathReason = {};
  if (from.predicate || from.permission) reason.from = from;
  if (to.predicate || to.permission) reason.to = to;
  return reason.from || reason.to ? reason : true;
};
