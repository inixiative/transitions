import { check as checkRule, toPrisma } from '@inixiative/json-rules';
import { checkPath } from './check';
import type {
  Action,
  ActionRule,
  AuthorizeOptions,
  CheckResult,
  PathReason,
  Row,
  TransitionMap,
} from './types';

const getAction = (rules: TransitionMap, model: string, action: string): Action => {
  const found = rules[model]?.[action];
  if (!found) throw new Error(`transition: no action "${action}" registered on model "${model}"`);
  return found;
};

/**
 * Authoritative check: the FIRST path whose `from` matches the current record, whose `to` matches
 * the merged record, and whose permissions all pass, wins → `true`. If none pass, returns a
 * {@link Reason} with one {@link PathReason} per candidate path tried.
 */
export const checkTransition = (
  rules: TransitionMap,
  model: string,
  action: string,
  record: Row,
  changes: Row = {},
  options: AuthorizeOptions = {},
): CheckResult => {
  const found = getAction(rules, model, action);
  const paths: PathReason[] = [];
  for (const path of found.paths) {
    const result = checkPath(path, record, changes, options);
    if (result === true) return true;
    paths.push(result);
  }
  return { paths };
};

/**
 * Affordance hint: which actions are offerable from `record` right now. Evaluates ONLY the `from`
 * side (predicate + `from` permission against the current record) — `to` needs the merged record,
 * which doesn't exist without proposed changes, so it defers to {@link checkTransition}.
 */
export const available = (
  rules: TransitionMap,
  model: string,
  record: Row,
  options: AuthorizeOptions = {},
): string[] => {
  const actions = rules[model];
  if (!actions) return [];
  const { actor, authorize } = options;

  const allows = (rule: ActionRule | undefined, rec: Row): boolean =>
    !authorize || rule === undefined || authorize(rule, rec, actor);

  return Object.entries(actions)
    .filter(([, action]) =>
      action.paths.some(
        (path) =>
          checkRule(path.from.predicate, record) === true && allows(path.from.permission, record),
      ),
    )
    .map(([action]) => action);
};

/**
 * Set query: one OR'd Prisma `where` matching every record currently eligible for `action`
 * (the union of all its paths' `from` predicates). Empty action → match-nothing.
 */
export const eligible = (rules: TransitionMap, model: string, action: string): Row => {
  const found = getAction(rules, model, action);
  const { steps } = toPrisma({ any: found.paths.map((path) => path.from.predicate) });
  // json-rules guarantees the last step is the WhereStep. Assert it loudly rather than cast-and-swallow:
  // a silent `{}` fallback would mean match-EVERYTHING — the dangerous inverse of match-nothing.
  const last = steps[steps.length - 1] as { operation?: string; where?: Row } | undefined;
  if (last?.operation !== 'where' || last.where === undefined)
    throw new Error('transition: expected a terminal WhereStep from toPrisma; got none');
  return last.where;
};
