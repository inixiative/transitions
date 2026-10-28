import {
  type ActionRule,
  createRebacCheck,
  type PermixLike,
  type RebacSchema,
  type SchemaMap,
  type Subject,
} from '@inixiative/permissions';
import type { Actor, Authorize, Row } from './types';

const CYCLE = /Cycle detected/;

export type PermissionsAuthorizeOptions<R extends string = string> = {
  /** The permissions rebac schema: `{ bridges?, permissions }`. */
  schema: RebacSchema<R>;
  /** Which model each resource is, and its relations: where a `{ rel }` walk leads. */
  map: SchemaMap<R>;
  /** Superadmin bypass, derived from the actor; checked before any rule. */
  isSuperadmin?: (actor: Actor) => boolean;
  /**
   * Supplemental hydrated rows (`map:model → rows`) for bridge (cross-map) `rel` walks, derived from
   * the record + actor — the same shape `Subject.data` takes. Only consulted when a walk crosses a
   * bridge and a downstream action reads the far record's fields.
   */
  data?: (record: Row, actor: Actor) => Subject<R>['data'];
};

const actorPermix = (actor: Actor, isSuperadmin?: (actor: Actor) => boolean): PermixLike => ({
  check: () => false,
  isSuperadmin: () => isSuperadmin?.(actor) ?? false,
  getActor: () => actor ?? null,
});

/**
 * Bridge `@inixiative/permissions`' rebac `check` onto transitions' {@link Authorize} seam — the
 * production evaluator, injected, not reimplemented. `createAuthorize(options)(resource)` returns an
 * `Authorize` bound to a (map-qualified) `resource`; each call evaluates a per-side `permission`
 * rule against a concrete record + actor. permissions owns the evaluation (string delegation with
 * cycle detection, `rel` walks through the schema map, cross-map bridge walks, abac `{ rule }`
 * reading the actor as `__actor`, boolean terminals, `any`/`all`, per-row `permissionRules`
 * overrides).
 */
export const createAuthorize = <R extends string = string>(
  options: PermissionsAuthorizeOptions<R>,
): ((resource: R) => Authorize) => {
  const check = createRebacCheck<R>(options.map);

  return (resource: R): Authorize =>
    (rule, record, actor) => {
      const permix = actorPermix(actor, options.isSuperadmin);
      const subject: Subject<R> = { resource, record, data: options.data?.(record, actor) };
      try {
        return check(permix, options.schema, subject, rule as ActionRule);
      } catch (error) {
        if (error instanceof Error && CYCLE.test(error.message)) return false;
        throw error;
      }
    };
};
