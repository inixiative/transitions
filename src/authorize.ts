import {
  type ActionRule,
  createRebacCheck,
  type PermixLike,
  type RebacSchema,
  type ResolveRelation,
  type Subject,
} from '@inixiative/permissions';
import type { Actor, Authorize, Row } from './types';

// permissions surfaces a cyclic permission graph by throwing; the transitions guard denies (fail
// closed) so a misconfigured schema terminates cleanly instead of propagating out of the kernel.
const CYCLE = /Cycle detected/;

export type PermissionsAuthorizeOptions<R extends string = string> = {
  /** The permissions rebac schema: `{ bridges?, permissions }`. */
  schema: RebacSchema<R>;
  /**
   * Resolve a hydrated relation field to the resource it points at (the ORM-specific seam).
   * Default: the relation segment name doubles as the resource key. Cross-map bridges are resolved
   * by the engine from `schema.bridges`, not here.
   */
  resolveRelation?: ResolveRelation<R>;
  /** Superadmin bypass, derived from the actor; checked before any rule. */
  isSuperadmin?: (actor: Actor) => boolean;
  /**
   * Supplemental hydrated rows (`map:model → rows`) for bridge (cross-map) `rel` walks, derived from
   * the record + actor — the same shape `Subject.data` takes. Only consulted when a walk crosses a
   * bridge and a downstream action reads the far record's fields.
   */
  data?: (record: Row, actor: Actor) => Subject<R>['data'];
};

// The transitions seam carries no pre-granted (role-derived) permix state, so a direct permix grant
// always misses and authorization is decided entirely by the schema. The actor supplies only its id
// (for `{ self }`) and an optional superadmin bypass.
const actorPermix = (actor: Actor, isSuperadmin?: (actor: Actor) => boolean): PermixLike => ({
  check: () => false,
  isSuperadmin: () => isSuperadmin?.(actor) ?? false,
  getUserId: () => actor?.id ?? null,
});

/**
 * Bridge `@inixiative/permissions`' rebac `check` onto transitions' {@link Authorize} seam — the
 * production evaluator, injected, not reimplemented. `createAuthorize(options)(resource)` returns an
 * `Authorize` bound to a (map-qualified) `resource`; each call evaluates a per-side `permission`
 * rule against a concrete record + actor. permissions owns the evaluation (string delegation with
 * cycle detection, intra-map `rel` walks via `resolveRelation`, cross-map bridge walks, `{ self }`,
 * abac `{ rule }`, boolean terminals, `any`/`all`, per-row `permissionRules` overrides).
 */
export const createAuthorize = <R extends string = string>(
  options: PermissionsAuthorizeOptions<R>,
): ((resource: R) => Authorize) => {
  const resolveRelation: ResolveRelation<R> =
    options.resolveRelation ?? ((_resource, segment) => segment as R);
  const check = createRebacCheck<R>(resolveRelation);

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
