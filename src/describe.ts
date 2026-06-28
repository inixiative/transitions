import type { PathReason, Reason } from './types';

const describePath = (path: PathReason): string => {
  const segs: string[] = [];
  if (path.from?.predicate) segs.push(`from: ${path.from.predicate}`);
  if (path.from?.permission) segs.push(`from: ${path.from.permission}`);
  if (path.to?.predicate) segs.push(`to: ${path.to.predicate}`);
  if (path.to?.permission) segs.push(`to: ${path.to.permission}`);
  return segs.join('; ') || 'unknown';
};

/** Build a human-readable message from a structured {@link Reason} (logs / UI / error bodies). */
export const describe = (reason: Reason): string => {
  if (reason.paths.length === 0) return 'no transition path available';
  if (reason.paths.length === 1) return describePath(reason.paths[0]);
  return reason.paths.map((path, i) => `path ${i}: ${describePath(path)}`).join(' | ');
};
