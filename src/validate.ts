import {
  type Condition,
  type Lens,
  type LensNarrowing,
  type ValidationIssue,
  type ValidationResult,
  validateRule,
  validateRuleInLens,
} from '@inixiative/json-rules';
import { type SchemaMap, validateActionRule } from '@inixiative/permissions';
import { isSerializableMerge } from './merge';
import type { ActionRule, Merge, Side, ToSide, Transition } from './types';

export type { ValidationIssue, ValidationResult };

export type ValidateOptions = {
  /** The lens each predicate is judged in (a field and relation allowlist); passed through to json-rules lens validation per predicate. */
  predicateLens?: Lens | LensNarrowing;
  /** Where the transition's permissions are judged: with it, each side's `permission` is checked for everything a permissions check refuses at that resource (a read outside its lens included); without it, its shape alone. */
  permission?: { map: SchemaMap; resource: string };
  /** Reject callback merges (use when the transition must be persistable / tenant-configured). */
  requireSerializable?: boolean;
};

const MERGE_KEYWORDS = new Set(['spread', 'deepMerge']);
const ARRAY_KINDS = new Set(['append', 'appendUnique']);

const validatePredicate = (
  predicate: Condition | undefined,
  errors: ValidationIssue[],
  path: string,
  lens?: Lens | LensNarrowing,
): void => {
  if (predicate === undefined) {
    errors.push({ path, message: 'predicate is required', code: 'missing_predicate' });
    return;
  }
  const issues = [
    ...validateRule(predicate).errors,
    ...(lens ? validateRuleInLens(predicate, lens).errors : []),
  ];
  for (const issue of issues) errors.push({ ...issue, path: `${path}.${issue.path}` });
};

const validatePermission = (
  rule: ActionRule | undefined,
  errors: ValidationIssue[],
  path: string,
  place: ValidateOptions['permission'],
): void => {
  if (rule === undefined) return;
  for (const issue of validateActionRule(rule, place).errors)
    errors.push({ ...issue, path: `${path}${issue.path.slice(1)}`, code: 'invalid_permission' });
};

const validateMerge = (merge: Merge | undefined, errors: ValidationIssue[], path: string): void => {
  if (merge === undefined || typeof merge === 'function') return;
  if (typeof merge === 'string') {
    if (!MERGE_KEYWORDS.has(merge))
      errors.push({ path, message: `unknown merge strategy "${merge}"`, code: 'invalid_merge' });
    return;
  }
  if (!ARRAY_KINDS.has(merge.kind))
    errors.push({ path, message: `unknown merge kind "${merge.kind}"`, code: 'invalid_merge' });
  else if (!merge.path)
    errors.push({
      path,
      message: `merge "${merge.kind}" requires a \`path\``,
      code: 'invalid_merge',
    });
};

const validateSide = (
  side: Side | ToSide | undefined,
  errors: ValidationIssue[],
  path: string,
  options: ValidateOptions,
): void => {
  if (side === null || typeof side !== 'object') {
    errors.push({ path, message: `\`${path}\` side is required`, code: 'missing_side' });
    return;
  }
  validatePredicate(side.predicate, errors, `${path}.predicate`, options.predicateLens);
  validatePermission(side.permission, errors, `${path}.permission`, options.permission);
  if (side.requires !== undefined && (typeof side.requires !== 'object' || side.requires === null))
    errors.push({
      path: `${path}.requires`,
      message: '`requires` must be a Prisma-include-shaped object',
      code: 'invalid_requires',
    });
  if ('merge' in side) validateMerge(side.merge, errors, `${path}.merge`);
};

/**
 * Authoring validation for a single transition — run on save before persisting a tenant config.
 * Returns structured issues (never throws) on malformed input: predicate validity delegates to
 * json-rules (`validateRule`, plus `validateRuleInLens` when a `predicateLens` is supplied for
 * field/relation scoping); a permission delegates to `@inixiative/permissions`' `validateActionRule` (its shape, and with
 * `permission: { map, resource }` everything a check refuses there);
 * merge strategy is checked here.
 */
export const validateTransition = (
  transition: Transition,
  options: ValidateOptions = {},
): ValidationResult => {
  const errors: ValidationIssue[] = [];
  validateSide(transition?.from, errors, 'from', options);
  validateSide(transition?.to, errors, 'to', options);
  if (options.requireSerializable && !isSerializableMerge(transition?.to?.merge))
    errors.push({
      path: 'to.merge',
      message: 'callback merge is not serializable; use a keyword strategy',
      code: 'unserializable_merge',
    });
  return { ok: errors.length === 0, errors };
};
