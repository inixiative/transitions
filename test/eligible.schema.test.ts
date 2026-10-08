import { describe, expect, test } from 'bun:test';
import {
  type Condition,
  createLens,
  executePrismaPlan,
  type FieldMap,
  Operator,
} from '@inixiative/json-rules';
import type { TransitionMap } from '../index';
import { checkTransition, eligible, eligiblePlan } from '../index';

// A column compared with a column: a review may be approved while it still lacks approvals.
// check() reads both columns off the row; toPrisma compiles a field reference, which it can only
// do knowing the model — so eligiblePlan takes the schema (`map`/`mapName`/`model`, or `lens`).
const short: Condition = { field: 'approvals', operator: Operator.lessThan, path: 'required' };
const bareRef: Condition = { field: 'approvals', operator: Operator.lessThan, path: '$.required' };

const rulesFor = (predicate: Condition): TransitionMap => ({
  review: {
    approve: {
      paths: [
        {
          from: { predicate },
          to: { predicate: true },
        },
      ],
    },
  },
});

const map: FieldMap = {
  models: {
    Review: {
      fields: {
        id: { kind: 'scalar', type: 'String' },
        approvals: { kind: 'scalar', type: 'Int' },
        required: { kind: 'scalar', type: 'Int' },
        votes: { kind: 'object', type: 'Vote', isList: true, fromFields: [], toFields: [] },
      },
    },
    Vote: {
      fields: {
        id: { kind: 'scalar', type: 'String' },
        reviewId: { kind: 'scalar', type: 'String' },
        review: {
          kind: 'object',
          type: 'Review',
          isList: false,
          fromFields: ['reviewId'],
          toFields: ['id'],
        },
      },
    },
  },
};

// The Prisma client's field refs (`prisma.review.fields.required`), as executePrismaPlan reads them.
type FieldRef = { column: string };
const client = {
  review: { fields: { required: { column: 'required' }, approvals: { column: 'approvals' } } },
};

// Evaluate the one shape this suite compiles — `{ approvals: { lt: <field ref> } }` — on rows, the
// way Postgres would (a NULL compares to nothing).
const select = (where: Record<string, unknown>, rows: Record<string, number | null>[]) => {
  const { lt } = (where.approvals ?? {}) as { lt: FieldRef };
  return rows.filter((row) => {
    const left = row.approvals;
    const right = row[lt.column];
    return left != null && right != null && left < right;
  });
};

const rows = [
  { approvals: 1, required: 2 },
  { approvals: 2, required: 2 },
  { approvals: 3, required: 2 },
  { approvals: null, required: 2 },
  { approvals: 0, required: null },
];

describe('eligiblePlan compiles column comparisons with the schema', () => {
  test.each([
    ['bare path', short],
    ['$. path', bareRef],
  ])('%s: the plan run through executePrismaPlan selects what check accepts', async (_, predicate) => {
    const rules = rulesFor(predicate);
    const plan = eligiblePlan(rules, 'review', 'approve', { map, model: 'Review' });
    const where = await executePrismaPlan(plan, client);
    expect(where).toEqual({ approvals: { lt: { column: 'required' } } });
    expect(select(where, rows)).toEqual(
      rows.filter((row) => checkTransition(rules, 'review', 'approve', row) === true),
    );
    expect(select(where, rows)).toEqual([{ approvals: 1, required: 2 }]);
  });

  test('{ map: FieldMapSet, mapName, model } compiles too', async () => {
    const plan = eligiblePlan(rulesFor(short), 'review', 'approve', {
      map: { maps: { prisma: map } },
      mapName: 'prisma',
      model: 'Review',
    });
    expect(await executePrismaPlan(plan, client)).toEqual({
      approvals: { lt: { column: 'required' } },
    });
  });

  test('{ lens } compiles against the lens root', () => {
    const lens = createLens({ maps: { prisma: map }, mapName: 'prisma', model: 'Review' });
    expect(eligiblePlan(rulesFor(short), 'review', 'approve', { lens })).toEqual(
      eligiblePlan(rulesFor(short), 'review', 'approve', { map, model: 'Review' }),
    );
  });

  test('a count compiles to a multi-step plan', () => {
    const counted = rulesFor({
      field: 'votes',
      arrayOperator: 'atLeast',
      count: 2,
      condition: true,
    });
    expect(eligiblePlan(counted, 'review', 'approve', { map, model: 'Review' }).steps).toHaveLength(
      2,
    );
  });

  test('without the schema it refuses rather than return the wrong set', () => {
    expect(() => eligiblePlan(rulesFor(short), 'review', 'approve')).toThrow('Prisma');
  });
});

describe('eligible returns a where only when it stands alone', () => {
  test('a field ref or a step ref needs the client: eligible points at eligiblePlan', () => {
    const counted = rulesFor({
      field: 'votes',
      arrayOperator: 'atLeast',
      count: 2,
      condition: true,
    });
    for (const rules of [rulesFor(short), counted])
      expect(() => eligible(rules, 'review', 'approve', { map, model: 'Review' })).toThrow(
        'eligiblePlan',
      );
  });

  test('a self-contained guard still compiles to its where, schema or not', () => {
    const plain = rulesFor({ field: 'approvals', operator: Operator.lessThan, value: 2 });
    expect(eligible(plain, 'review', 'approve', { map, model: 'Review' })).toEqual({
      approvals: { lt: 2 },
    });
  });
});

describe('a bound timeZone reaches eligible', () => {
  // Before the start of today: where "today" starts depends on the zone.
  const rules = rulesFor({
    field: 'dueAt',
    dateOperator: 'before',
    value: { start: { this: 'day' } },
  });
  const now = new Date('2026-10-06T02:00:00Z'); // Oct 5, 22:00 in New York
  const options = { now, timeZone: { bind: 'tz' }, bindings: { tz: 'America/New_York' } };

  test('check resolves { bind: "tz" } from the bindings', () => {
    const lateOct5Utc = { dueAt: new Date('2026-10-05T12:00:00Z') }; // Oct 5 in New York too
    expect(checkTransition(rules, 'review', 'approve', lateOct5Utc, {}, options)).not.toBe(true);
    expect(checkTransition(rules, 'review', 'approve', lateOct5Utc, {}, { now })).toBe(true);
  });

  test('eligible resolves it the same way', () => {
    expect(eligible(rules, 'review', 'approve', options)).toEqual({
      dueAt: { lt: new Date('2026-10-05T04:00:00Z') },
    });
    expect(eligible(rules, 'review', 'approve', options)).not.toEqual(
      eligible(rules, 'review', 'approve', { now }),
    );
  });

  test('an unsupplied zone binding still throws', () => {
    expect(() => eligible(rules, 'review', 'approve', { now, timeZone: { bind: 'tz' } })).toThrow(
      'tz',
    );
  });
});
