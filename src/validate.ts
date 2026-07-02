import {
  type Condition,
  checkRuleAgainstLens,
  type Lens,
  type LensNarrowing,
  validateRule,
} from '@inixiative/json-rules';
import { actionRuleSchema } from '@inixiative/permissions/actionRuleSchema';
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
  predicate: Condition | undefined,
  errors: ValidationIssue[],
  path: string,
  lens?: Lens | LensNarrowing,
): void => {
  if (predicate === undefined) {
    errors.push({ path, message: 'predicate is required' });
    return;
  }
  const result = validateRule(predicate);
  for (const issue of result.errors)
    errors.push({ path: `${path}.${issue.path}`, message: issue.message });
  if (lens) {
    const lensCheck = checkRuleAgainstLens(predicate, lens);
    for (const violation of lensCheck.violations)
      errors.push({ path: `${path}.${violation.path}`, message: violation.reason });
  }
};

// Validate the whole ActionRule against `@inixiative/permissions`' zod schema — the single source of
// truth for the algebra (boolean terminals, string delegation, `{ rel, action }`, `{ self }`, abac
// `{ rule }`, `any`/`all`, `null`). A malformed rule yields a structured issue rather than throwing.
const validatePermission = (
  rule: ActionRule | undefined,
  errors: ValidationIssue[],
  path: string,
): void => {
  if (rule === undefined) return; // absent = open
  const parsed = actionRuleSchema.safeParse(rule);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    // A root union failure (zod reports an empty relative path) means none of the ActionRule shapes
    // matched; nested issues keep their zod path + message.
    if (issue.path.length === 0) {
      errors.push({ path, message: 'unrecognized ActionRule shape' });
    } else {
      errors.push({ path: `${path}.${issue.path.join('.')}`, message: issue.message });
    }
  }
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
  side: Side | ToSide | undefined,
  errors: ValidationIssue[],
  path: string,
  options: ValidateOptions,
): void => {
  if (side === null || typeof side !== 'object') {
    errors.push({ path, message: `\`${path}\` side is required` });
    return;
  }
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
 * Returns structured issues (never throws) on malformed input: predicate validity delegates to
 * json-rules (`validateRule`, plus `checkRuleAgainstLens` when a `lens` is supplied for
 * field/relation scoping); permission shape delegates to `@inixiative/permissions`' `actionRuleSchema`;
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
    });
  return { ok: errors.length === 0, errors };
};
