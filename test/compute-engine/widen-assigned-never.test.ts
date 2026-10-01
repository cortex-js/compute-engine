/**
 * `widenAssignedType()` maps the type of an assigned value to the tier a
 * binding records (`5` → `integer`). `never` is the bottom type, so it
 * matched the first row of that table and was read as `integer`. A value
 * typed `never` has no value to widen, so it stays `never` (2026-09-30).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { widenAssignedType } from '../../src/compute-engine/boxed-expression/boxed-value-definition';

const ce = new ComputeEngine();

describe('WIDENING THE TYPE OF AN ASSIGNED VALUE', () => {
  test('never stays never', () => {
    expect(widenAssignedType(ce as any, 'never')).toBe('never');
  });
  test.each([
    ['integer', 'integer'],
    ['rational', 'real'],
    ['real', 'real'],
    ['complex', 'number'],
    ['nan', 'nan'],
    ['boolean', 'boolean'],
  ])('%s widens to %s', (t, expected) => {
    expect(widenAssignedType(ce as any, t as any)).toBe(expected);
  });
});
