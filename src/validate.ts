import {
  type Condition,
  checkRuleAgainstLens,
  type Lens,
  type LensNarrowing,
  validateRule,
} from '@inixiative/json-rules';
import { isSerializableMerge } from './merge';
import type { ActionRule, Merge, Side, ToSide, Transition } from './types';

export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { ok: boolean; errors: ValidationIssue[] };

export type ValidateOptions = {
  /** Optional field/relation allowlist; passed through to json-rules lens validation per predicate. */
  lens?: Lens | LensNarrowing;
  /** Reject callback merges (use when the transition must be persistable / tenant-configured). */
  requireSerializable?: boolean;
};

const MERGE_KEYWORDS = new Set(['spread', 'deepMerge']);
const ARRAY_KINDS = new Set(['append', 'appendUnique']);

const validatePredicate = (
  predicate: Condition,
  errors: ValidationIssue[],
  path: string,
  lens?: Lens | LensNarrowing,
): void => {
  const result = validateRule(predicate);
  for (const issue of result.errors)
    errors.push({ path: `${path}.${issue.path}`, message: issue.message });
  if (lens) {
    const lensCheck = checkRuleAgainstLens(predicate, lens);
    for (const violation of lensCheck.violations)
      errors.push({ path: `${path}.${violation.path}`, message: violation.reason });
  }
};

const validatePermission = (
  rule: ActionRule | undefined,
  errors: ValidationIssue[],
  path: string,
): void => {
  if (rule === undefined || rule === null || typeof rule === 'string') return;
  if ('rule' in rule) {
    const result = validateRule(rule.rule);
    for (const issue of result.errors)
      errors.push({ path: `${path}.rule.${issue.path}`, message: issue.message });
    return;
  }
  if ('rel' in rule) {
    if (!rule.rel || !rule.action)
      errors.push({ path, message: 'rel-rule requires non-empty `rel` and `action`' });
    return;
  }
  if ('self' in rule) {
    if (!rule.self) errors.push({ path, message: 'self-rule requires a non-empty field name' });
    return;
  }
  if ('any' in rule) {
    rule.any.forEach((sub, i) => {
      validatePermission(sub, errors, `${path}.any[${i}]`);
    });
    return;
  }
  if ('all' in rule) {
    rule.all.forEach((sub, i) => {
      validatePermission(sub, errors, `${path}.all[${i}]`);
    });
    return;
  }
  errors.push({ path, message: 'unrecognized ActionRule shape' });
};

const validateMerge = (merge: Merge | undefined, errors: ValidationIssue[], path: string): void => {
  if (merge === undefined || typeof merge === 'function') return;
  if (typeof merge === 'string') {
    if (!MERGE_KEYWORDS.has(merge))
      errors.push({ path, message: `unknown merge strategy "${merge}"` });
    return;
  }
  if (!ARRAY_KINDS.has(merge.kind))
    errors.push({ path, message: `unknown merge kind "${merge.kind}"` });
  else if (!merge.path) errors.push({ path, message: `merge "${merge.kind}" requires a \`path\`` });
};

const validateSide = (
  side: Side | ToSide,
  errors: ValidationIssue[],
  path: string,
  options: ValidateOptions,
): void => {
  validatePredicate(side.predicate, errors, `${path}.predicate`, options.lens);
  validatePermission(side.permission, errors, `${path}.permission`);
  if (side.requires !== undefined && (typeof side.requires !== 'object' || side.requires === null))
    errors.push({
      path: `${path}.requires`,
      message: '`requires` must be a Prisma-include-shaped object',
    });
  if ('merge' in side) validateMerge(side.merge, errors, `${path}.merge`);
};

/**
 * Authoring validation for a single transition — run on save before persisting a tenant config.
 * Predicate validity delegates to json-rules (`validateRule`, plus `checkRuleAgainstLens` when a
 * `lens` is supplied for field/relation scoping); merge strategy and permission shape are checked here.
 */
export const validateTransition = (
  transition: Transition,
  options: ValidateOptions = {},
): ValidationResult => {
  const errors: ValidationIssue[] = [];
  validateSide(transition.from, errors, 'from', options);
  validateSide(transition.to, errors, 'to', options);
  if (options.requireSerializable && !isSerializableMerge(transition.to.merge))
    errors.push({
      path: 'to.merge',
      message: 'callback merge is not serializable; use a keyword strategy',
    });
  return { ok: errors.length === 0, errors };
};
