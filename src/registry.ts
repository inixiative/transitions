import {
  bindRule,
  type Condition,
  check as checkRule,
  Operator,
  type RuleValue,
  type TimeZoneConfig,
  type ToPrismaResult,
  toPrisma,
} from '@inixiative/json-rules';
import { checkPath } from './check';
import type {
  Action,
  ActionRule,
  CheckResult,
  EligibleOptions,
  PathReason,
  Row,
  TransitionMap,
  TransitionOptions,
} from './types';

const getAction = (rules: TransitionMap, resource: string, action: string): Action => {
  const found = rules[resource]?.[action];
  if (!found)
    throw new Error(`transition: no action "${action}" registered on resource "${resource}"`);
  return found;
};

/**
 * Authoritative check: the FIRST path whose `from` matches the current record, whose `to` matches
 * the merged record, and whose permissions all pass, wins → `true`. If none pass, returns a
 * {@link Reason} with one {@link PathReason} per candidate path tried.
 *
 * `resource` is the (map-qualified) key into the map — e.g. `db:Inquiry`. Cross-source `permission`
 * checks are handled by the injected {@link Authorize} (wire it to a bridge-aware rebac check, bound
 * to this resource); a `predicate` that reads a bridged relation expects a stitched record.
 */
export const checkTransition = (
  rules: TransitionMap,
  resource: string,
  action: string,
  record: Row,
  changes: Row = {},
  options: TransitionOptions = {},
): CheckResult => {
  const found = getAction(rules, resource, action);
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
  resource: string,
  record: Row,
  options: TransitionOptions = {},
): string[] => {
  const actions = rules[resource];
  if (!actions) return [];
  const { actor, authorize, ...evaluation } = options;

  const allows = (rule: ActionRule | undefined, rec: Row): boolean =>
    !authorize || rule === undefined || authorize(rule, rec, actor);

  return Object.entries(actions)
    .filter(([, action]) =>
      action.paths.some(
        (path) =>
          checkRule(path.from.predicate, record, evaluation) === true &&
          allows(path.from.permission, record),
      ),
    )
    .map(([action]) => action);
};

// A `{ bind }` zone, resolved the way the rule's own tokens are: json-rules' bindRule over a
// carrier leaf. An uncovered token stays a token, and toPrisma reports it unresolved.
const bindTimeZone = (
  timeZone: TimeZoneConfig | undefined,
  bindings: Record<string, RuleValue>,
): TimeZoneConfig | undefined => {
  if (timeZone === undefined || typeof timeZone === 'string') return timeZone;
  const carrier = { field: 'timeZone', operator: Operator.equals, ...timeZone } as Condition;
  const { field: _field, operator: _operator, ...source } = bindRule(carrier, bindings) as Row;
  return source as TimeZoneConfig;
};

/**
 * Set query as a json-rules Prisma plan: every record currently eligible for `action` (the union
 * of all its paths' `from` predicates; a single path compiles to its predicate alone; an empty
 * action matches nothing). Takes the json-rules `check()` options plus toPrisma's schema:
 * `bindings` are resolved into the predicate and a `{ bind }` timeZone before compiling, `now`
 * reaches `toPrisma`, and `map` / `mapName` / `model` (or `lens`) let it compile a column
 * compared with a column or a count. Run it with json-rules' `executePrismaPlan(plan, prisma)`,
 * which resolves the plan's references, and the `where` selects the rows the single check
 * accepts. A guard toPrisma cannot express (a `$.` row ref in an offset or magnitude, a column
 * ref without the schema) throws.
 */
export const eligiblePlan = (
  rules: TransitionMap,
  resource: string,
  action: string,
  options: EligibleOptions = {},
): ToPrismaResult => {
  const found = getAction(rules, resource, action);
  const { bindings = {}, timeZone, ...compile } = options;
  const predicate = bindRule({ any: found.paths.map((path) => path.from.predicate) }, bindings);
  return toPrisma(predicate, { ...compile, timeZone: bindTimeZone(timeZone, bindings) });
};

/**
 * Set query: {@link eligiblePlan}'s `where`, when it stands alone. A plan holding references —
 * a column compared with a column (a Prisma field ref) or a count (a groupBy step) — needs the
 * client to resolve, so `eligible` throws on it; use `eligiblePlan` with `executePrismaPlan`.
 */
export const eligible = (
  rules: TransitionMap,
  resource: string,
  action: string,
  options: EligibleOptions = {},
): Row => {
  const { steps } = eligiblePlan(rules, resource, action, options);
  const [step] = steps;
  if (steps.length !== 1 || step?.operation !== 'where' || step.refs?.length)
    throw new Error(
      `transition: "${action}" on "${resource}" compiles to a plan with references (a column compared with a column, or a count); run eligiblePlan with executePrismaPlan`,
    );
  return step.where;
};
