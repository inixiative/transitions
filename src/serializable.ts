import { isSerializableMerge } from './merge';
import type { Transition } from './types';

/**
 * Can this transition be persisted (stored in the DB, edited in a UI, sent over the wire)?
 *
 * Predicates (json-rules) and permissions (ActionRule) are always plain JSON; the only
 * non-data escape hatch is a `to.merge` callback. So serializability reduces to the merge.
 */
export const isSerializable = (transition: Transition): boolean =>
  isSerializableMerge(transition.to.merge);
