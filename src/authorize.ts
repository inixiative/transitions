import {
  type ActionRule,
  createRebacCheck,
  type PermixLike,
  type SchemaMap,
  type Subject,
} from '@inixiative/permissions';
import type { Actor, Authorize, Row } from './types';

const CYCLE = /Cycle detected/;

export type PermissionsAuthorizeOptions<R extends string = string, A = Actor> = {
  /** permissions' schema map, the one `createRebacCheck` takes: the field maps, the supplied maps, the bridges and the rules a `permission` delegates into. */
  map: SchemaMap<R>;
  /** Superadmin bypass, derived from the actor; checked before any rule. */
  isSuperadmin?: (actor: A) => boolean;
  /**
   * The rows each check is given (`map:Model → rows`), derived from the record and the actor: the
   * same shape `Subject.data` takes. It carries the supplied maps' rows (who is acting, as
   * `actor:User`, read by a `{ rule }`) and the far rows of joined bridges. Without it a rule that
   * reads who is acting is denied.
   */
  data?: (record: Row, actor: A) => Subject<R>['data'];
};

const actorPermix = <A>(actor: A, isSuperadmin?: (actor: A) => boolean): PermixLike => ({
  check: () => false,
  isSuperadmin: () => isSuperadmin?.(actor) ?? false,
});

/**
 * Bridge `@inixiative/permissions`' rebac `check` onto transitions' {@link Authorize} seam — the
 * production evaluator, injected, not reimplemented. `createAuthorize(options)(resource)` returns an
 * `Authorize` bound to a (map-qualified) `resource`; each call evaluates a per-side `permission`
 * rule against a concrete record + actor. permissions owns the evaluation (string delegation with
 * cycle detection, `rel` walks through the schema map, cross-map bridge walks, abac `{ rule }`
 * over the record and its supplied rows, boolean terminals, `any`/`all`, per-row `permissionRules`
 * overrides). The actor reaches a rule only as the rows `options.data` gives for it.
 */
export const createAuthorize = <R extends string = string, A = Actor>(
  options: PermissionsAuthorizeOptions<R, A>,
): ((resource: R) => Authorize) => {
  const check = createRebacCheck<R>(options.map);

  return (resource: R): Authorize =>
    (rule, record, actor) => {
      // unchecked: the kernel takes any actor, and the caller passes the type it named here
      const acting = actor as A;
      const permix = actorPermix(acting, options.isSuperadmin);
      const subject: Subject<R> = { resource, record, data: options.data?.(record, acting) };
      try {
        return check(permix, subject, rule as ActionRule);
      } catch (error) {
        if (error instanceof Error && CYCLE.test(error.message)) return false;
        throw error;
      }
    };
};
