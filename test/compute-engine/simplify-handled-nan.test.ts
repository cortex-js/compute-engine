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

describe('SIMPLIFY WITH A NaN OPERAND: WHEN THE ANSWER IS NOT NaN', () => {
  test('a symbol that holds an infinity has precedence in Hypot', () => {
    // `Hypot(+∞, NaN)` is `+∞`. The handler answered `NaN` for the symbol
    // `w`, and the rule `hypot(x, y) → √(x² + y²)` gave `√(w² + NaN)`.
    const local = new ComputeEngine();
    local.assign('w', local.PositiveInfinity);
    const e = local.box(['Hypot', 'w', 'NaN']);
    expect(e.evaluate().toString()).toBe('+oo');
    expect(e.simplify().isNaN).not.toBe(true);
    expect(local.box(['Hypot', 2, 'NaN']).simplify().toString()).toBe('NaN');
  });

  test('an operand with an effect is not run or dropped', () => {
    const local = new ComputeEngine();
    let calls = 0;
    local.declare('g', {
      signature: '(number) -> number',
      pure: false,
      evaluate: ([x]) => {
        calls += 1;
        return x;
      },
    });
    // The handler of `Max` evaluated the `Map`, and called `g`.
    local.box(['Max', ['Map', 'g', ['List', 1]], 'NaN']).simplify();
    expect(calls).toBe(0);
    // `NaN` dropped the call that `evaluate()` makes.
    const e = local.box(['Arctan2', 'NaN', ['g', 1]]);
    expect(e.simplify().isNaN).not.toBe(true);
    expect(calls).toBe(0);
  });

  test('an operand that gives an error is not dropped', () => {
    const e = ce.box(['Arctan2', 'NaN', ['RuntimeError', "'boom'"]]);
    expect(e.evaluate().toString()).toBe('Error("boom")');
    expect(e.simplify().isNaN).not.toBe(true);
  });
});
