import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';

// A derivative of order 2 or more is computed one order at a time. Each
// derivative of order 1 or more is simplified before it is differentiated
// again (`derivative()` in `src/compute-engine/symbolic/derivative.ts`), and
// so is the inner derivative of a nested `D` (`differentiateNode()`). Without
// that step the chain rule distributes each order over the previous one and
// the result grows quickly. The tests below check three things:
//
// - the results are numerically correct: each one is compared with a finite
//   difference of the derivative one order lower, at sample points;
// - the results stay small: the length of the printed result is pinned below
//   a fixed bound (the length, not the time, so the pin does not depend on
//   the load of the machine; the time is asserted only in a `CE_PERF=1` run);
// - `simplify()` of an expression that holds a derivative of order 2
//   terminates and keeps the value. `simplify()` can reach the derivative
//   code when it folds a constant subexpression such as `f'''(2)`: it then
//   evaluates the `Derivative`. In that case the derivative code does not
//   simplify the intermediate derivatives (`isFoldingConstant()` in
//   `src/compute-engine/boxed-expression/simplify.ts`).
//
// ROADMAP entry CE-332 records the measurements.

const ce = new ComputeEngine();

const RADICAL = '\\sqrt{x+\\sqrt{x+\\sqrt{x+\\sqrt{x+x}}}}';
const POINTS = [0.7, 1.3, 2.3];

function valueAt(fn: Expression, x: number): number {
  return ce.box(['Apply', fn, x]).N().re;
}

// The derivative of `lower` at `x`, by the five-point central difference.
// Its error is of order h⁴ (about 1e-11 for h = 1e-3 on these functions),
// far below the tolerance of the comparison.
function finiteDifference(lower: Expression, x: number): number {
  const h = 1e-3;
  return (
    (-valueAt(lower, x + 2 * h) +
      8 * valueAt(lower, x + h) -
      8 * valueAt(lower, x - h) +
      valueAt(lower, x - 2 * h)) /
    (12 * h)
  );
}

function expectClose(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    1e-6 * Math.max(1, Math.abs(expected))
  );
}

describe('CE-332: derivatives of a nested radical', () => {
  ce.assign('f', ce.parse(`x \\mapsto ${RADICAL}`));
  const order = (n: number) => ce.box(['Derivative', 'f', n]).evaluate();

  // The upper bounds are about 10% above the lengths measured on 2026-10-25
  // with the simplification of the intermediate derivatives: 2,515
  // characters at order 2 and 19,919 at order 3. Without it the lengths were
  // 2,515 and 31,386, so a return to the old behavior fails the pin at
  // order 3.
  test.each([
    [2, 2800],
    [3, 22000],
  ])('order %i is numerically correct and small', (n, bound) => {
    const lower = order(n - 1);
    const start = performance.now();
    const result = order(n);
    const elapsed = performance.now() - start;
    expect(result.operator).toBe('Function');
    for (const x of POINTS)
      expectClose(valueAt(result, x), finiteDifference(lower, x));
    expect(result.toString().length).toBeLessThan(bound);
    if (process.env.CE_PERF === '1' && n === 3)
      expect(elapsed).toBeLessThan(3000);
  });
});

describe('CE-332: nested D of a nested radical', () => {
  const body = ce.parse(RADICAL, { form: 'raw' }).json;
  const nested = (n: number) => {
    let e: any = body;
    for (let i = 0; i < n; i++) e = ['D', e, 'x'];
    return ce.box(e).evaluate();
  };
  const asFunction = (e: Expression) => ce.box(['Function', e, 'x']);

  // Measured 2026-10-25: 3,572 characters for two nested `D` and 30,070
  // for three. Without the simplification of the inner derivative: 3,572 and
  // 78,793.
  test.each([
    [2, 3950],
    [3, 33000],
  ])('%i nested D are numerically correct and small', (n, bound) => {
    const lower = asFunction(nested(n - 1));
    const result = nested(n);
    expect(result.has('D')).toBe(false);
    for (const x of POINTS)
      expectClose(
        result.subs({ x }).N().re,
        finiteDifference(lower, x)
      );
    expect(result.toString().length).toBeLessThan(bound);
  });
});

describe('CE-332: simplify() of an expression that holds a second derivative', () => {
  test('D(D(n/π, n), n) terminates and has the value 0', () => {
    const expr = ce.box(['D', ['D', ['Divide', 'n', 'Pi'], 'n'], 'n']);
    const simplified = expr.simplify();
    expect(simplified.evaluate().is(0)).toBe(true);
  });

  test('D(D(√(x+√x), x), x) + x terminates and keeps its value', () => {
    const expr = ce.box([
      'Add',
      ['D', ['D', ['Sqrt', ['Add', 'x', ['Sqrt', 'x']]], 'x'], 'x'],
      'x',
    ]);
    const before = expr.evaluate();
    const after = expr.simplify().evaluate();
    for (const x of POINTS)
      expectClose(after.subs({ x }).N().re, before.subs({ x }).N().re);
    // An independent value: d²/dx² √(x+√x) + x, by a finite difference of
    // the first derivative.
    const first = ce.box([
      'Function',
      ce.box(['D', ['Sqrt', ['Add', 'x', ['Sqrt', 'x']]], 'x']).evaluate(),
      'x',
    ]);
    for (const x of POINTS)
      expectClose(after.subs({ x }).N().re, finiteDifference(first, x) + x);
  });

});

describe('CE-332: a cached derivative and the state of the engine', () => {
  // With `b` an integer, the simplification of the first derivative
  // `3x²·sin(πb)` gives 0, so the second derivative is 0 and holds no `b`.
  // A write to the type of `b` must still invalidate it.
  test('a type write to a symbol that a simplification removed', () => {
    const e = new ComputeEngine();
    e.declare('b', 'integer');
    e.assign(
      'f',
      e.box([
        'Function',
        ['Multiply', ['Power', 'x', 3], ['Sin', ['Multiply', 'Pi', 'b']]],
        'x',
      ])
    );
    expect(e.box(['Derivative', 'f', 2]).evaluate().toString()).toBe(
      '(x) => 0'
    );
    // This write advances the cache generation, but not the semantic
    // version of the engine.
    e.box('b').valueDefinition!.type = 'real';
    expect(e.box(['Derivative', 'f', 2]).evaluate().toString()).toBe(
      '(x) => 6x * sin(pi * b)'
    );
    expect(e.box(['Derivative', 'f', 3]).evaluate().toString()).toBe(
      '(x) => 6sin(pi * b)'
    );
  });

  test('a partial derivative of a nested D after a type write', () => {
    // The multi-index arm of `Derivative` differentiates the body
    // `D(g(u), u)`. The inner derivative `3u²·sin(πb)` is simplified before
    // it is differentiated again, which gives 0 when `b` is an integer.
    const e = new ComputeEngine();
    e.declare('b', 'integer');
    e.assign(
      'g',
      e.box([
        'Function',
        ['Multiply', ['Power', 't', 3], ['Sin', ['Multiply', 'Pi', 'b']]],
        't',
      ])
    );
    e.assign('F', e.box(['Function', ['D', ['g', 'u'], 'u'], 'u', 'v']));
    expect(e.box(['Derivative', 'F', 1, 0]).evaluate().toString()).toBe(
      '(u, v) => 0'
    );
    e.box('b').valueDefinition!.type = 'real';
    expect(e.box(['Derivative', 'F', 1, 0]).evaluate().toString()).toBe(
      '(u, v) => 6u * sin(pi * b)'
    );
  });

  test('the form of a derivative does not depend on an earlier fold', () => {
    // `simplify()` folds the constant `f'''(0.7)` by evaluating it, which
    // runs the derivative code inside the fold. The function is a literal:
    // a fold does not read an assigned value, so `f'''(0.7)` with `f`
    // assigned is not folded. Inside the fold the intermediate derivatives
    // are not simplified. A derivative computed after the fold, of the same
    // function literal, has the form it has in a fresh engine.
    const e = new ComputeEngine();
    const lit = e.parse(`x \\mapsto ${RADICAL}`);
    const folded = e
      .box(['Add', 1, ['Apply', ['Derivative', lit, 3], 0.7]])
      .simplify();
    expect(folded.isNumberLiteral).toBe(true);
    const third = e.box(['Derivative', lit, 3]).evaluate();
    expectClose(folded.N().re, 1 + valueAt(third, 0.7));
    const after = third.toString();

    const fresh = new ComputeEngine();
    const expected = fresh
      .box(['Derivative', fresh.parse(`x \\mapsto ${RADICAL}`), 3])
      .evaluate()
      .toString();
    expect(after).toBe(expected);
  });
});
