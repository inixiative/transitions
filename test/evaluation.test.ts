import { describe, expect, test } from 'bun:test';
import { Operator } from '@inixiative/json-rules';
import type { TransitionMap } from '../index';
import { available, checkTransition, eligible } from '../index';

// A guard that needs the clock and a per-call value: an open incident may auto-resolve once it
// has been quiet for its rule's window. One declaration answers both "may THIS one?" and
// "which ones may?".
const map: TransitionMap = {
  incident: {
    autoResolve: {
      paths: [
        {
          from: {
            predicate: {
              all: [
                { field: 'status', operator: Operator.equals, value: 'firing' },
                { field: 'lastBreachedAt', dateOperator: 'before', bind: 'quietWindow' },
              ],
            },
          },
          to: { predicate: { field: 'status', operator: Operator.equals, value: 'resolved' } },
        },
      ],
    },
  },
};

const now = new Date('2026-10-06T12:00:00Z');
const evaluation = { now, bindings: { quietWindow: { ago: { hours: 2 } } } };
const quiet = { status: 'firing', lastBreachedAt: new Date('2026-10-06T09:00:00Z') };
const recent = { status: 'firing', lastBreachedAt: new Date('2026-10-06T11:00:00Z') };

describe('now and bindings reach the predicates', () => {
  test('checkTransition evaluates a bound relative window', () => {
    const changes = { status: 'resolved' };
    expect(checkTransition(map, 'incident', 'autoResolve', quiet, changes, evaluation)).toBe(true);
    expect(checkTransition(map, 'incident', 'autoResolve', recent, changes, evaluation)).not.toBe(
      true,
    );
  });

  test('available evaluates the from side with them', () => {
    expect(available(map, 'incident', quiet, evaluation)).toEqual(['autoResolve']);
    expect(available(map, 'incident', recent, evaluation)).toEqual([]);
  });

  test('eligible resolves the bindings and anchors the window on now', () => {
    expect(eligible(map, 'incident', 'autoResolve', evaluation)).toEqual({
      OR: [
        {
          AND: [
            { status: { equals: 'firing' } },
            { lastBreachedAt: { lt: new Date('2026-10-06T10:00:00Z') } },
          ],
        },
      ],
    });
  });

  test('an unsupplied binding throws rather than matching everything', () => {
    expect(() => checkTransition(map, 'incident', 'autoResolve', quiet, {}, { now })).toThrow(
      'quietWindow',
    );
  });
});
