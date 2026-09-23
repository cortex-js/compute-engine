/**
 * The cost of the numeric evaluation (`.N()`) of nested sums and products,
 * and the memo of a symbol's stored value under a plain `evaluate()`.
 *
 * `Add` and `Multiply` are lazy: their evaluate handlers evaluate the
 * operands. Under a numeric approximation, the handler evaluates each operand
 * numerically, then gives the operands to `addN`/`mulN`. When these
 * numericized an operand that was already numeric, each nested level
 * evaluated its operands two or three times, and the cost of a polynomial in
 * Horner form grew by that factor at each level of nesting.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { BoxedFunction } from '../../src/compute-engine/boxed-expression/boxed-function';
import { BoxedSymbol } from '../../src/compute-engine/boxed-expression/boxed-symbol';
import type { MathJsonExpression } from '../../src/math-json/types';

/** The Horner form of 1 + 2x + 3x² + … + (d+1)x^d. */
function horner(d: number): MathJsonExpression {
  let e: MathJsonExpression = d + 1;
  for (let k = d; k >= 1; k--) e = ['Add', k, ['Multiply', 'x', e]];
  return e;
}

/** The value of the same polynomial at `x`, computed directly. */
function polynomialAt(d: number, x: number): number {
  let sum = 0;
  for (let k = 0; k <= d; k++) sum += (k + 1) * x ** k;
  return sum;
}

/** The number of calls of `BoxedFunction.prototype.evaluate` during `run`. */
function functionEvaluations(run: () => void): number {
  const spy = jest.spyOn(BoxedFunction.prototype, 'evaluate');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

// The Horner form of degree 6 has 12 nested `Add` and `Multiply` nodes, so
// one evaluation of each node is 12 evaluations. When each level evaluated
// its operands twice, `.N()` of the substituted form made 4,095 evaluations,
// and `.N()` of the form with a free `x` made about 30,000.
describe('N() of a polynomial in Horner form evaluates each node once', () => {
  const D = 6;

  test('with x substituted', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(horner(D)).subs({ x: 0.5 });
    let value = NaN;
    const count = functionEvaluations(() => {
      value = expr.N().re;
    });
    expect(value).toBeCloseTo(polynomialAt(D, 0.5), 12);
    expect(count).toBeLessThanOrEqual(4 * D);
  });

  test('with x assigned', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 0.5);
    const expr = ce.box(horner(D));
    let value = NaN;
    const count = functionEvaluations(() => {
      value = expr.N().re;
    });
    expect(value).toBeCloseTo(polynomialAt(D, 0.5), 12);
    expect(count).toBeLessThanOrEqual(4 * D);
  });

  test('with x free', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(horner(D));
    let result = '';
    const count = functionEvaluations(() => {
      result = expr.N().toString();
    });
    expect(result).toBe(
      'x * (x * (x * (x * (x * (7x + 6) + 5) + 4) + 3) + 2) + 1'
    );
    expect(count).toBeLessThanOrEqual(4 * D);
  });
});

// `_dereferenceMemoized` keeps the value of a symbol that holds an
// expression. It accepts a plain `evaluate()` and
// `evaluate({ numericApproximation: true })`. An option set
// `{ numericApproximation: false }` is the same evaluation as no options, and
// must use the same memo: the `Add` handler evaluated its operands with it,
// and each read of the symbol then evaluated the stored expression again.
describe('the stored value of a symbol is memoized under a plain evaluate()', () => {
  function dereferences(run: () => void): number {
    const spy = jest.spyOn(
      BoxedSymbol.prototype as unknown as { _dereference: () => unknown },
      '_dereference'
    );
    try {
      run();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  test('a symbol read as an operand of Add, twice', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.assign('h', ce.parse('\\sin(y)+y^2'));
    const sum = ce.parse('h + 1');
    let first = '';
    let second = '';
    const count = dereferences(() => {
      first = sum.evaluate().toString();
      second = sum.evaluate().toString();
    });
    expect(first).toBe('y^2 + sin(y) + 1');
    expect(second).toBe(first);
    expect(count).toBe(1);
  });

  test('an explicit numericApproximation: false uses the same memo', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.assign('h', ce.parse('\\sin(y)+y^2'));
    const h = ce.box('h');
    const count = dereferences(() => {
      h.evaluate();
      h.evaluate({ numericApproximation: false });
      h.evaluate({ numericApproximation: false });
    });
    expect(count).toBe(1);
  });
});
