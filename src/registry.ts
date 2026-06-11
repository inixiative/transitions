import { check as checkRule, toPrisma } from '@inixiative/json-rules';
import { checkTransition } from './check';
import type {
  Action,
  AuthorizeOptions,
  CheckOptions,
  CheckResult,
  PathFailure,
  Reason,
  Row,
  TransitionMap,
} from './types';

const getAction = (map: TransitionMap, model: string, verb: string): Action => {
  const action = map[model]?.[verb];
  if (!action) throw new Error(`transition: no action "${verb}" registered on model "${model}"`);
  return action;
};

// Pick the most-progressed failure across an action's paths:
//   unauthorized (a legal edge existed but authz denied) → 403
//   no-to        (from matched, target invalid)          → 409
//   no-from      (no edge even starts here)              → 409
const aggregate = (failures: Reason[]): Reason => {
  const paths: PathFailure[] = failures.map(({ kind: _kind, paths: _paths, ...rest }) => rest);
  const pick = (kind: Reason['kind']) => failures.find((failure) => failure.kind === kind);
  const chosen = pick('unauthorized') ?? pick('no-to') ?? pick('no-from');
  if (!chosen) return { kind: 'no-from', paths };
  const { paths: _omit, ...representative } = chosen;
  return { ...representative, paths };
};

/**
 * Authoritative check: the FIRST path whose `from` matches the current record, whose `to`
 * matches the merged record, and whose permissions all pass, wins. If none pass, returns the
 * aggregated structured failure (see {@link aggregate}).
 */
export const check = (
  map: TransitionMap,
  model: string,
  verb: string,
  record: Row,
  changes: Row = {},
  options: AuthorizeOptions = {},
): CheckResult => {
  const action = getAction(map, model, verb);
  const opts: CheckOptions = { ...options, basePermission: action.permission };

  const failures: Reason[] = [];
  for (const path of action.paths) {
    const result = checkTransition(path, record, changes, opts);
    if (result.ok) return result;
    failures.push(result.reason);
  }
  return { ok: false, reason: aggregate(failures) };
};

/**
 * Affordance hint: which verbs are offerable from `record` right now. Evaluates ONLY the
 * `from` side (predicate + `action`/`from` permission against the current record) — `to` needs
 * the merged record, which doesn't exist without proposed changes, so it defers to {@link check}.
 */
export const available = (
  map: TransitionMap,
  model: string,
  record: Row,
  options: AuthorizeOptions = {},
): string[] => {
  const actions = map[model];
  if (!actions) return [];
  const { actor, authorize } = options;

  const allows = (rule: Action['permission'], rec: Row): boolean =>
    !authorize || rule === undefined || authorize(rule, rec, actor);

  return Object.entries(actions)
    .filter(([, action]) =>
      action.paths.some(
        (path) =>
          checkRule(path.from.predicate, record) === true &&
          allows(action.permission, record) &&
          allows(path.from.permission, record),
      ),
    )
    .map(([verb]) => verb);
};

/**
 * Set query: one OR'd Prisma `where` matching every record currently eligible for `verb`
 * (the union of all its paths' `from` predicates). Empty action → match-nothing.
 */
export const eligible = (map: TransitionMap, model: string, verb: string): Row => {
  const action = getAction(map, model, verb);
  const { steps } = toPrisma({ any: action.paths.map((path) => path.from.predicate) });
  // json-rules guarantees the last step is the WhereStep. Assert it loudly rather than cast-and-swallow:
  // a silent `{}` fallback would mean match-EVERYTHING — the dangerous inverse of the intended
  // match-nothing — if a future json-rules emits a trailing non-where step or multi-step relation refs.
  const last = steps[steps.length - 1] as { operation?: string; where?: Row } | undefined;
  if (last?.operation !== 'where' || last.where === undefined)
    throw new Error('transition: expected a terminal WhereStep from toPrisma; got none');
  return last.where;
};
