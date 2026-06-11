import { expect, describe as group, test } from 'bun:test';
import { describe } from '../index';

group('describe(reason)', () => {
  test('no-from uses the json-rules reason when present', () => {
    expect(describe({ kind: 'no-from', from: 'status must equal "pending"' })).toBe(
      'status must equal "pending"',
    );
  });

  test('no-from falls back without a reason string', () => {
    expect(describe({ kind: 'no-from' })).toBe(
      'transition is not available from the current state',
    );
  });

  test('no-to uses the json-rules reason when present', () => {
    expect(describe({ kind: 'no-to', to: 'status must equal "approved"' })).toBe(
      'status must equal "approved"',
    );
  });

  test('unauthorized names the denying level', () => {
    expect(describe({ kind: 'unauthorized', authz: 'from' })).toBe(
      'not authorized (from-level permission denied)',
    );
    expect(describe({ kind: 'unauthorized' })).toBe('not authorized');
  });
});
