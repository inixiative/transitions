import type { ActionRule, Actor } from '../types';

export type ModelPermission = { actions: Record<string, ActionRule> };

/** `model → { actions: { actionName → ActionRule } }`. Mirrors `@template/permissions` RebacSchema. */
export type RebacSchema = Record<string, ModelPermission>;

export type RebacOptions = {
  schema: RebacSchema;
  /**
   * Resolve the model a relation points at, given the source model + relation segment.
   * Default: the relation segment name doubles as the target model key. Supply this when your
   * relation field names differ from your model names (the template binds this via prismaMap).
   */
  resolveModel?: (model: string, relationSegment: string) => string;
  /** Optional superadmin bypass, checked before any rule. */
  isSuperadmin?: (actor: Actor) => boolean;
};
