import { check as checkRule } from '@inixiative/json-rules';
import type { ActionRule, Actor, Authorize, Row } from '../types';
import type { RebacOptions, RebacSchema } from './types';

type Context = {
  schema: RebacSchema;
  resolveModel?: (model: string, relationSegment: string) => string;
  isSuperadmin?: (actor: Actor) => boolean;
};

const evaluate = (
  ctx: Context,
  model: string,
  record: Row,
  actor: Actor,
  rule: ActionRule,
  visited: Set<string>,
): boolean => {
  if (ctx.isSuperadmin?.(actor)) return true;
  if (rule === null) return false;

  // string → delegate to the named action on this model, additively merged with any per-row override.
  if (typeof rule === 'string') {
    const schemaRule = ctx.schema[model]?.actions[rule] ?? null;
    const rowRules = record.permissionRules as Record<string, ActionRule> | null | undefined;
    const rowRule = rowRules?.[rule];
    const merged: ActionRule = rowRule !== undefined ? { any: [schemaRule, rowRule] } : schemaRule;
    return evaluate(ctx, model, record, actor, merged, visited);
  }

  // { rel, action } → walk the relation (dot-paths supported), then check `action` on the target.
  if ('rel' in rule && 'action' in rule) {
    const segments = rule.rel.split('.');
    let current: Row = record;
    let currentModel = model;
    for (const segment of segments) {
      const related = current[segment] as Row | null | undefined;
      if (!related) return false;
      currentModel = ctx.resolveModel ? ctx.resolveModel(currentModel, segment) : segment;
      current = related;
    }
    const key = `${currentModel}:${String(current.id)}:${rule.action}`;
    if (visited.has(key)) throw new Error(`Cycle detected in permission graph: ${key}`);
    visited.add(key);
    return evaluate(ctx, currentModel, current, actor, rule.action, visited);
  }

  // { self } → record[field] matches the current actor.
  if ('self' in rule) {
    const actorId = actor?.id ?? null;
    return actorId !== null && record[rule.self] === actorId;
  }

  // { rule } → ABAC predicate (json-rules) over the record.
  if ('rule' in rule) return checkRule(rule.rule, record) === true;

  // Fork `visited` per branch — parallel paths through any/all aren't cycles.
  if ('any' in rule)
    return rule.any.some((sub) => evaluate(ctx, model, record, actor, sub, new Set(visited)));
  if ('all' in rule)
    return rule.all.every((sub) => evaluate(ctx, model, record, actor, sub, new Set(visited)));

  return false;
};

/**
 * A reference rebac evaluator — one implementation of the injected {@link Authorize} seam,
 * bound to a single `model`. Faithful to `@template/permissions`' `rebac/check` (string-delegate,
 * relation walk with cycle detection, self, json-rules `{ rule }`, any/all, per-row
 * `permissionRules` override) but standalone. Swap it for a richer authorizer in production;
 * this is slated to graduate into `@inixiative/permissions`.
 */
export const makeRebacAuthorize = (options: RebacOptions & { model: string }): Authorize => {
  const { model, ...rest } = options;
  return (rule, record, actor) => evaluate(rest, model, record, actor, rule, new Set());
};

/** Curried form: `createRebac({ schema })(model)` → an {@link Authorize} for that model. */
export const createRebac =
  (options: RebacOptions) =>
  (model: string): Authorize =>
    makeRebacAuthorize({ ...options, model });
