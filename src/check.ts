import { check as checkRule } from '@inixiative/json-rules';
import { applyMerge } from './merge';
import type {
  ActionRule,
  Actor,
  Authorize,
  CheckOptions,
  CheckResult,
  Row,
  Transition,
} from './types';

const reasonString = (result: boolean | string): string =>
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
 * The kernel: evaluate one atomic transition.
 *
 * Legality (json-rules) AND authz (injected, per side), with the load-bearing asymmetry —
 * `from.*` reads the current `record`, `to.*` reads the merged `next` record. Authz order is
 * action baseline → from → to, all ANDed. Returns a structured {@link CheckResult} whose
 * `reason.kind` lets a caller map illegal → 409 vs unauthorized → 403.
 *
 * Omit `options.authorize` to check legality only.
 */
export const checkTransition = <R extends Row>(
  transition: Transition<R>,
  record: R,
  changes: Partial<R> = {},
  options: CheckOptions = {},
): CheckResult<R> => {
  const { actor, authorize, basePermission } = options;
  const next = applyMerge(transition.to.merge, record, changes);

  const fromResult = checkRule(transition.from.predicate, record as Row);
  if (fromResult !== true)
    return { ok: false, reason: { kind: 'no-from', from: reasonString(fromResult) } };

  const toResult = checkRule(transition.to.predicate, next as Row);
  if (toResult !== true)
    return { ok: false, reason: { kind: 'no-to', to: reasonString(toResult) } };

  if (denies(authorize, basePermission, record as Row, actor))
    return { ok: false, reason: { kind: 'unauthorized', authz: 'action' } };
  if (denies(authorize, transition.from.permission, record as Row, actor))
    return { ok: false, reason: { kind: 'unauthorized', authz: 'from' } };
  if (denies(authorize, transition.to.permission, next as Row, actor))
    return { ok: false, reason: { kind: 'unauthorized', authz: 'to' } };

  return { ok: true, path: transition };
};
