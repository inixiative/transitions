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

// The same guard, self-contained: each incident's window is read off the row, so nothing is bound.
const selfContained: TransitionMap = {
  incident: {
    autoResolve: {
      paths: [
        {
          from: {
            predicate: {
              all: [
                { field: 'status', operator: Operator.equals, value: 'firing' },
                {
                  field: 'lastBreachedAt',
                  dateOperator: 'before',
                  value: { ago: { seconds: { path: '$.windowSeconds' } } },
                },
              ],
            },
          },
          to: { predicate: { field: 'status', operator: Operator.equals, value: 'resolved' } },
        },
      ],
    },
  },
};

describe('a guard that reads its window off the row', () => {
  const quietForItsWindow = { ...quiet, windowSeconds: 7200 };
  const recentForItsWindow = { ...quiet, windowSeconds: 4 * 3600 };

  test('checkTransition and available read each record its own window', () => {
    const changes = { status: 'resolved' };
    expect(
      checkTransition(selfContained, 'incident', 'autoResolve', quietForItsWindow, changes, {
        now,
      }),
    ).toBe(true);
    expect(
      checkTransition(selfContained, 'incident', 'autoResolve', recentForItsWindow, changes, {
        now,
      }),
    ).not.toBe(true);
    expect(available(selfContained, 'incident', quietForItsWindow, { now })).toEqual([
      'autoResolve',
    ]);
  });

  test('eligible refuses a row-read window rather than return the wrong set', () => {
    expect(() => eligible(selfContained, 'incident', 'autoResolve', { now })).toThrow('toPrisma');
  });
});

describe('context reaches the predicates', () => {
  const contextual: TransitionMap = {
    incident: {
      autoResolve: {
        paths: [
          {
            from: {
              predicate: {
                field: 'lastBreachedAt',
                dateOperator: 'before',
                value: { ago: { seconds: { path: 'quietSeconds' } } },
              },
            },
            to: { predicate: true },
          },
        ],
      },
    },
  };
  const options = { now, context: { quietSeconds: 7200 } };

  test('checkTransition', () => {
    expect(checkTransition(contextual, 'incident', 'autoResolve', quiet, {}, options)).toBe(true);
    expect(checkTransition(contextual, 'incident', 'autoResolve', recent, {}, options)).not.toBe(
      true,
    );
  });

  test('eligible', () => {
    expect(eligible(contextual, 'incident', 'autoResolve', options)).toEqual({
      OR: [{ lastBreachedAt: { lt: new Date('2026-10-06T10:00:00Z') } }],
    });
  });
});
