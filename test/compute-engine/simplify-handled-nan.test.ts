/**
 * `simplify()` gives the answer of `evaluate()` for a `NaN` operand that the
 * operator's own `evaluate` handler reads (a position whose NaN policy is
 * `inert` or `handle`), when that answer is `NaN` or `Indeterminate`.
 * `Max` and `Min` are of this kind. Before 2026-09-30
 * `Max(x, NaN).simplify()` stayed `max(x, NaN)` while `evaluate()` answered
 * `NaN`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('SIMPLIFY WITH A NaN OPERAND THE HANDLER READS', () => {
  test.each([
    [['Max', 'x', 'NaN'], 'NaN'],
    [['Min', 'NaN', 'x'], 'NaN'],
    [['Max', 'x', 'Indeterminate'], 'Indeterminate'],
  ])('%j', (input, expected) => {
    const e = ce.box(input as any);
    expect(e.simplify().toString()).toBe(expected);
    expect(e.evaluate().toString()).toBe(expected);
  });

  test('without a NaN operand the extremum stays', () => {
    expect(ce.box(['Max', 'x', 1]).simplify().toString()).toBe('max(x, 1)');
  });

  test('the value of a symbol is not substituted', () => {
    const local = new ComputeEngine();
    local.assign('w', 3);
    expect(local.box(['Max', 'w', 'NaN']).simplify().toString()).toBe('NaN');
    expect(local.box(['Max', 'w', 1]).simplify().toString()).toBe('max(w, 1)');
  });
});
