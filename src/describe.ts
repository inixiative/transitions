import type { Reason } from './types';

/** Build a human-readable message from a structured {@link Reason} (logs / UI / error bodies). */
export const describe = (reason: Reason): string => {
  switch (reason.kind) {
    case 'no-from':
      return reason.from ?? 'transition is not available from the current state';
    case 'no-to':
      return reason.to ?? 'the resulting state is not a valid target';
    case 'unauthorized':
      return reason.authz
        ? `not authorized (${reason.authz}-level permission denied)`
        : 'not authorized';
  }
};
