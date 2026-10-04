import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import type { Expression } from '../../src/math-json/types.ts';

import { engine } from '../utils';

const ce = engine;

/** Evaluate a `Solve` expression and return its solution values as numbers,
 *  sorted ascending. Throws if the result is not a decided `List`. */
function solutions(expr: BoxedExpression): number[] {
  const r = expr.evaluate();
  if (r.operator !== 'List')
    throw new Error(`Expected a List, got ${r.operator}: ${r.toString()}`);
  // `.N().re` (not `.re`): a periodic-expansion result is an EXACT π-multiple,
  // a symbolic value whose bare `.re` is `NaN` — numericize before comparing.
  return r.ops!.map((o) => o.N().re).sort((a, b) => a - b);
}

/** True if the `Solve` expression stayed unevaluated (undecided). */
function isUnevaluated(expr: BoxedExpression): boolean {
  return expr.evaluate().operator === 'Solve';
}

/** Evaluate a multi-variable `Solve` and return its solution tuples as arrays
 *  of numbers, in the (lexicographic) order the engine produced them. Throws if
 *  the result is not a decided `List` of `Tuple`s. */
function tuples(expr: BoxedExpression): number[][] {
  const r = expr.evaluate();
  if (r.operator !== 'List')
    throw new Error(`Expected a List, got ${r.operator}: ${r.toString()}`);
  return r.ops!.map((t) => {
    if (t.operator !== 'Tuple')
      throw new Error(`Expected a Tuple, got ${t.operator}: ${t.toString()}`);
    return t.ops!.map((o) => o.re);
  });
}

describe('SOLVE OVER A DOMAIN — symbolic + membership filter', () => {
  test('quadratic filtered by an integer range keeps both integer roots', () => {
    // x^2 - 5x + 6 = 0 → {2, 3}; both in 1..1000.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', -5, 'x'], 6], 0],
      ['Element', 'x', ['Range', 1, 1000]],
    ]);
    expect(solutions(expr)).toEqual([2, 3]);
  });

  test('quadratic drops the root that falls outside the range', () => {
    // Same equation, x ∈ 3..1000 → only 3 survives.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', -5, 'x'], 6], 0],
      ['Element', 'x', ['Range', 3, 1000]],
    ]);
    expect(solutions(expr)).toEqual([3]);
  });

  test('type refinement discards a non-integer root over an integer domain', () => {
    // 2x^2 - 3x + 1 = 0 → {1, 1/2}. Over an integer Range only 1 is kept, and
    // NOT via enumeration (symbolic path found roots).
    const expr = ce.box([
      'Solve',
      [
        'Equal',
        ['Add', ['Multiply', 2, ['Power', 'x', 2]], ['Multiply', -3, 'x'], 1],
        0,
      ],
      ['Element', 'x', ['Range', 0, 5]],
    ]);
    expect(solutions(expr)).toEqual([1]);
  });

  test('empty List (decided: no solutions) vs unevaluated', () => {
    // x^2 = 2 has real roots ±√2 (found symbolically) but none is an integer in
    // 1..10 → decided empty List, not "unevaluated".
    const expr = ce.box([
      'Solve',
      ['Equal', ['Power', 'x', 2], 2],
      ['Element', 'x', ['Range', 1, 10]],
    ]);
    const r = expr.evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.length).toBe(0);
  });
});

describe('SOLVE OVER A DOMAIN — predicate enumeration', () => {
  test('Congruent enumerates 2^n ≡ 1 (mod 7) over 1..20', () => {
    const expr = ce.box([
      'Solve',
      ['Congruent', ['Power', 2, 'n'], 1, 7],
      ['Element', 'n', ['Range', 1, 20]],
    ]);
    expect(solutions(expr)).toEqual([3, 6, 9, 12, 15, 18]);
  });

  test('enumeration yields ascending domain order', () => {
    const r = ce
      .box([
        'Solve',
        ['Congruent', ['Power', 2, 'n'], 1, 7],
        ['Element', 'n', ['Range', 1, 20]],
      ])
      .evaluate();
    // Values are already ascending without re-sorting.
    expect(r.ops!.map((o) => o.re)).toEqual([3, 6, 9, 12, 15, 18]);
  });

  test('Divides enumerates multiples of 3 in 1..20', () => {
    const expr = ce.box([
      'Solve',
      ['Divides', 3, 'n'],
      ['Element', 'n', ['Range', 1, 20]],
    ]);
    expect(solutions(expr)).toEqual([3, 6, 9, 12, 15, 18]);
  });

  test('3-operand Element applies the extra boolean condition', () => {
    // 2^n ≡ 1 (mod 7) AND n > 5 → drop 3.
    const expr = ce.box([
      'Solve',
      ['Congruent', ['Power', 2, 'n'], 1, 7],
      ['Element', 'n', ['Range', 1, 20], ['Greater', 'n', 5]],
    ]);
    expect(solutions(expr)).toEqual([6, 9, 12, 15, 18]);
  });
});

describe('SOLVE OVER A DOMAIN — exactness of confirmation', () => {
  test('large-integer solution confirmed exactly (2^n + n = 2^55 + 55)', () => {
    // 2^55 + 55 = 36028797018964023. No closed form (exponential + linear) →
    // enumeration. The compiled float sieve is exact only up to rounding; the
    // exact-confirmation stage certifies n = 55 via bigint arithmetic.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 2, 'n'], 'n'], { num: '36028797018964023' }],
      ['Element', 'n', ['Range', 1, 80]],
    ]);
    expect(solutions(expr)).toEqual([55]);
  });

  test('float-sieve false positive is rejected by exact confirmation', () => {
    // 2^n = 2^55 + 2 has NO solution, but at n = 55 the float residual rounds
    // to 0 (ulp = 8 at that magnitude) so the compiled sieve accepts it. Exact
    // confirmation (2^55 ≠ 2^55 + 2) rejects → decided empty List, no wrong
    // answer.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Power', 2, 'n'], { num: '36028797018963970' }],
      ['Element', 'n', ['Range', 50, 60]],
    ]);
    const r = expr.evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.length).toBe(0);
  });

  test('exact match at the same magnitude is found (2^n = 2^55)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Power', 2, 'n'], { num: '36028797018963968' }],
      ['Element', 'n', ['Range', 50, 60]],
    ]);
    expect(solutions(expr)).toEqual([55]);
  });
});

describe('SOLVE OVER A DOMAIN — budget and interruption', () => {
  test('over-budget unsolvable equation stays unevaluated (and is fast)', () => {
    // 2^x + x = C has no closed form → enumeration. Range 1..10^8 exceeds the
    // compiled budget (10^6) → return the expression unevaluated. Must NOT sweep
    // the range: assert it returns quickly.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 2, 'x'], 'x'], 999999999999],
      ['Element', 'x', ['Range', 1, 100000000]],
    ]);
    // Returning at all is the assertion: sweeping the enumeration this test
    // rejects does not finish, so an over-budget spec that was NOT declined
    // would hang here rather than answer slowly. The jest per-test timeout is
    // the backstop for that; an elapsed-millisecond check would only add
    // sensitivity to load on the machine running the suite.
    expect(isUnevaluated(expr)).toBe(true);
  });

  test('deadline interruption propagates a CancellationError', () => {
    const c = new ComputeEngine();
    // A zero-length span: the deadline is already reached when the
    // enumeration stride check runs (`checkDeadline` fires on `now >= at`).
    expect(() =>
      c.withTimeLimit(0, () =>
        c
          .box([
            'Solve',
            ['Divides', 3, 'n'],
            ['Element', 'n', ['Range', 1, 9000]],
          ])
          .evaluate()
      )
    ).toThrow();
  });
});

describe('SOLVE OVER A DOMAIN — API surface', () => {
  test('no-domain single-unknown Solve is unchanged', () => {
    const r = ce
      .box(['Solve', ['Equal', ['Power', 'x', 2], 4], 'x'])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.map((o) => o.re).sort((a, b) => a - b)).toEqual([-2, 2]);
  });

  test('LaTeX \\operatorname{Solve}(x^2=4, x \\in 1..10) parses to Element and evaluates', () => {
    const p = ce.parse('\\operatorname{Solve}(x^2=4, x \\in 1..10)');
    expect(p.json).toEqual([
      'Solve',
      ['Equal', ['Power', 'x', 2], 4],
      ['Element', 'x', ['Range', 1, 10]],
    ]);
    expect(solutions(p)).toEqual([2]);
  });

  test('an invalid spec reports the error, it does not solve', () => {
    // A number where a symbol/Element spec is expected → error operand. Rung
    // 3 of the error-propagation design bubbles it out of the frozen
    // `Solve(…Error…)` tree; what is pinned is that no solving happens.
    const expr = ce.box(['Solve', ['Equal', ['Power', 'x', 2], 4], 42]);
    expect(expr.evaluate().operator).toBe('Error');
  });
});

describe('SOLVE OVER A DOMAIN — multi-variable enumeration', () => {
  test('taxicab: x^3+y^3=1729 over 1..12 × 1..12, lexicographic order', () => {
    // The 4 representations of 1729 as a sum of two positive cubes, first spec
    // (x) varying slowest.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 3], ['Power', 'y', 3]], 1729],
      ['Element', 'x', ['Range', 1, 12]],
      ['Element', 'y', ['Range', 1, 12]],
    ]);
    expect(tuples(expr)).toEqual([
      [1, 12],
      [9, 10],
      [10, 9],
      [12, 1],
    ]);
  });

  test('boolean predicate: x+y even over 1..2 × 1..2', () => {
    const expr = ce.box([
      'Solve',
      ['Congruent', ['Add', 'x', 'y'], 0, 2],
      ['Element', 'x', ['Range', 1, 2]],
      ['Element', 'y', ['Range', 1, 2]],
    ]);
    expect(tuples(expr)).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  test('per-spec condition applies to its own variable (x > 5)', () => {
    // Same taxicab, but the condition on the x spec drops (1, 12).
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 3], ['Power', 'y', 3]], 1729],
      ['Element', 'x', ['Range', 1, 12], ['Greater', 'x', 5]],
      ['Element', 'y', ['Range', 1, 12]],
    ]);
    expect(tuples(expr)).toEqual([
      [9, 10],
      [10, 9],
      [12, 1],
    ]);
  });

  test('three variables: x+y+z=6 over 1..3 (lexicographic)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', 'x', 'y', 'z'], 6],
      ['Element', 'x', ['Range', 1, 3]],
      ['Element', 'y', ['Range', 1, 3]],
      ['Element', 'z', ['Range', 1, 3]],
    ]);
    expect(tuples(expr)).toEqual([
      [1, 2, 3],
      [1, 3, 2],
      [2, 1, 3],
      [2, 2, 2],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ]);
  });

  test('product over budget stays unevaluated (and is fast)', () => {
    // 10^4 × 10^4 = 10^8 exceeds the compiled budget (10^6) → inert, without
    // sweeping the product.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', 'x', 'y'], 5],
      ['Element', 'x', ['Range', 1, 10000]],
      ['Element', 'y', ['Range', 1, 10000]],
    ]);
    // Returning at all is the assertion: sweeping the enumeration this test
    // rejects does not finish, so an over-budget spec that was NOT declined
    // would hang here rather than answer slowly. The jest per-test timeout is
    // the backstop for that; an elapsed-millisecond check would only add
    // sensitivity to load on the machine running the suite.
    expect(isUnevaluated(expr)).toBe(true);
  });

  test('a bare-symbol spec mixed with domain specs stays inert', () => {
    // `y` has no domain → the whole thing is undecidable → unevaluated.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', 'x', 'y'], 5],
      ['Element', 'x', ['Range', 1, 3]],
      'y',
    ]);
    expect(expr.evaluate().operator).toBe('Solve');
  });

  test('deadline interruption propagates a CancellationError', () => {
    const c = new ComputeEngine();
    // Zero-length span, as above: expired on arrival.
    expect(() =>
      c.withTimeLimit(0, () =>
        c
          .box([
            'Solve',
            ['Equal', ['Add', 'x', 'y'], 5],
            ['Element', 'x', ['Range', 1, 200]],
            ['Element', 'y', ['Range', 1, 200]],
          ])
          .evaluate()
      )
    ).toThrow();
  });
});

describe('SOLVE OVER A DOMAIN — periodic root-family expansion', () => {
  /** Assert two ascending numeric lists agree within a small tolerance (CE's
   *  exact π-multiples numericize to the last ULP, not bit-identically to a
   *  JS `k*Math.PI/n`). */
  function expectClose(actual: number[], expected: number[]): void {
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < actual.length; i++)
      expect(actual[i]).toBeCloseTo(expected[i], 10);
  }

  /** True if every solution value is exact (a π-multiple or 0), not a float. */
  function allExactPi(expr: BoxedExpression): boolean {
    const r = expr.evaluate();
    if (r.operator !== 'List') return false;
    return r.ops!.every((o) => {
      const j = JSON.stringify(o.json);
      return j.includes('Pi') || j === '0';
    });
  }

  test('sin x = 1/2 over Interval(0, 4π) → [π/6, 5π/6, 13π/6, 17π/6], exact', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', 'x'], ['Rational', 1, 2]],
      ['Element', 'x', ['Interval', 0, ['Multiply', 4, 'Pi']]],
    ]);
    // π/6, 5π/6, 13π/6, 17π/6
    expectClose(solutions(expr), [
      Math.PI / 6,
      (5 * Math.PI) / 6,
      (13 * Math.PI) / 6,
      (17 * Math.PI) / 6,
    ]);
    expect(allExactPi(expr)).toBe(true);
    // Exact structural check on the first family member.
    const first = expr.evaluate().ops![0];
    expect(first.isSame(ce.box(['Multiply', ['Rational', 1, 6], 'Pi']))).toBe(
      true
    );
  });

  test('cos x = 1 over [0, 6.5π] → [0, 2π, 4π, 6π] (endpoint inclusion)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Cos', 'x'], 1],
      ['Element', 'x', ['Interval', 0, ['Multiply', 6.5, 'Pi']]],
    ]);
    expect(solutions(expr)).toEqual([0, 2 * Math.PI, 4 * Math.PI, 6 * Math.PI]);
    expect(allExactPi(expr)).toBe(true);
  });

  test('tan x = 1 over [0, 2π] → [π/4, 5π/4] (period π)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Tan', 'x'], 1],
      ['Element', 'x', ['Interval', 0, ['Multiply', 2, 'Pi']]],
    ]);
    expect(solutions(expr)).toEqual([Math.PI / 4, (5 * Math.PI) / 4]);
    expect(allExactPi(expr)).toBe(true);
  });

  test('scaled argument sin(2x) = 1 over [0, 2π] → [π/4, 5π/4] (period π)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', ['Multiply', 2, 'x']], 1],
      ['Element', 'x', ['Interval', 0, ['Multiply', 2, 'Pi']]],
    ]);
    expect(solutions(expr)).toEqual([Math.PI / 4, (5 * Math.PI) / 4]);
    expect(allExactPi(expr)).toBe(true);
  });

  test('scaled argument cos(2x) = 1/2 over [0, 2π] → [π/6, 5π/6, 7π/6, 11π/6]', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Cos', ['Multiply', 2, 'x']], ['Rational', 1, 2]],
      ['Element', 'x', ['Interval', 0, ['Multiply', 2, 'Pi']]],
    ]);
    expectClose(solutions(expr), [
      Math.PI / 6,
      (5 * Math.PI) / 6,
      (7 * Math.PI) / 6,
      (11 * Math.PI) / 6,
    ]);
    expect(allExactPi(expr)).toBe(true);
  });

  test('periodic expansion over an integer Range (sin x = 0 in 0..20)', () => {
    // Roots are multiples of π; none is an integer except 0, so an integer
    // Range keeps only 0 (the membership filter is step-aware).
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', 'x'], 0],
      ['Element', 'x', ['Range', 0, 20]],
    ]);
    expect(solutions(expr)).toEqual([0]);
  });

  test('mixed polynomial + trig (x + sin x = 1) is NOT expanded — stays inert', () => {
    // The unknown appears outside the trig function → not a candidate for
    // expansion; no closed form and an Interval is not enumerable → inert.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', 'x', ['Sin', 'x']], 1],
      ['Element', 'x', ['Interval', 0, 10]],
    ]);
    expect(expr.evaluate().operator).toBe('Solve');
  });

  test('huge domain does not hang: sin x = 0 over Interval(0, 10^9)', () => {
    // span / period ≈ 1.6·10^8 exceeds MAX_PERIODIC_EXPANSION. The list of
    // roots is too long to give, and the principal roots [0, π] are only a
    // part of it: the `Solve` stays unevaluated. The jest per-test timeout is
    // the backstop for the case that does not end (an expansion of ~1.6·10⁸
    // periods).
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', 'x'], 0],
      ['Element', 'x', ['Interval', 0, 1000000000]],
    ]);
    expect(isUnevaluated(expr)).toBe(true);
  });

  test('huge domain without a principal root: sin x = 0 over [10^8, 10^9] stays unevaluated', () => {
    // No principal root (0, π) is in the domain, but the domain holds about
    // 2.9·10^8 roots. The answer must not be the empty list.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', 'x'], 0],
      ['Element', 'x', ['Interval', 100000000, 1000000000]],
    ]);
    expect(isUnevaluated(expr)).toBe(true);
  });

  test('huge domain, scaled argument: cos(3x) = 1/2 over [0, 10^7] stays unevaluated', () => {
    // The period is 2π/3: the domain holds about 4.8·10^6 periods, with two
    // roots in each period.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Cos', ['Multiply', 3, 'x']], ['Rational', 1, 2]],
      ['Element', 'x', ['Interval', 0, 10000000]],
    ]);
    expect(isUnevaluated(expr)).toBe(true);
  });

  test('huge integer Range is enumerated: sin x = 0 over -10^4..10^4 → [0]', () => {
    // Over the cap of the expansion, but the integer domain is small enough to
    // enumerate. Of the multiples of π, only 0 is an integer.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', 'x'], 0],
      ['Element', 'x', ['Range', -10000, 10000]],
    ]);
    expect(solutions(expr)).toEqual([0]);
  });

  test('x·sin x = 0 over [-10, 10] → each multiple of π in the domain', () => {
    // The root finder gives [0, π]. The factor sin(x) is periodic: its
    // family in the domain gives ±π, ±2π and ±3π, and a numeric scan of the
    // product checks the list.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Multiply', 'x', ['Sin', 'x']], 0],
      ['Element', 'x', ['Interval', -10, 10]],
    ]);
    const actual = solutions(expr);
    expect(actual.length).toBe(7);
    actual.forEach((v, i) => expect(v).toBeCloseTo((i - 3) * Math.PI, 12));
  });

  test('x·sin x = 0 over [0, 3] → [0] (a numeric scan shows the list is complete)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Multiply', 'x', ['Sin', 'x']], 0],
      ['Element', 'x', ['Interval', 0, 3]],
    ]);
    expect(solutions(expr)).toEqual([0]);
  });

  test('sin(x²) = 0 over [0, 5] stays unevaluated (a trig function of a non-linear argument)', () => {
    // The roots are √(kπ) for k = 0..7; the root finder gives only 0.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', ['Power', 'x', 2]], 0],
      ['Element', 'x', ['Interval', 0, 5]],
    ]);
    expect(isUnevaluated(expr)).toBe(true);
  });

  test('non-periodic quadratic over a range is unaffected (exact roots)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', -5, 'x'], 6], 0],
      ['Element', 'x', ['Range', 1, 1000]],
    ]);
    expect(solutions(expr)).toEqual([2, 3]);
  });
});

describe('SOLVE OVER A DOMAIN — periodic root families are complete', () => {
  // The solver expands its principal roots by the spacing of the roots, which
  // can be shorter than the period of the equation: `sin x + cos x` has the
  // period 2π, but its roots are π apart. A numeric scan of the domain checks
  // the final list; when the scan finds a root that is not in the list, the
  // `Solve` stays unevaluated. Each case below compares the result with the
  // roots listed by hand, and checks each root numerically.
  const pi = Math.PI;
  const cases: Array<
    [
      name: string,
      lhs: Expression,
      rhs: Expression,
      lo: number,
      hi: number,
      f: (x: number) => number,
      expected: number[],
    ]
  > = [
    [
      'sin x + cos x = 0',
      ['Add', ['Sin', 'x'], ['Cos', 'x']],
      0,
      0,
      7,
      (x) => Math.sin(x) + Math.cos(x),
      [(3 * pi) / 4, (7 * pi) / 4],
    ],
    [
      'sin x - cos x = 0',
      ['Subtract', ['Sin', 'x'], ['Cos', 'x']],
      0,
      0,
      7,
      (x) => Math.sin(x) - Math.cos(x),
      [pi / 4, (5 * pi) / 4],
    ],
    [
      'sin(2x) = 0',
      ['Sin', ['Multiply', 2, 'x']],
      0,
      0,
      7,
      (x) => Math.sin(2 * x),
      [0, pi / 2, pi, (3 * pi) / 2, 2 * pi],
    ],
    [
      'sin x cos x = 0',
      ['Multiply', ['Sin', 'x'], ['Cos', 'x']],
      0,
      0,
      7,
      (x) => Math.sin(x) * Math.cos(x),
      [0, pi / 2, pi, (3 * pi) / 2, 2 * pi],
    ],
    [
      'tan x = 1',
      ['Tan', 'x'],
      1,
      0,
      7,
      (x) => Math.tan(x) - 1,
      [pi / 4, (5 * pi) / 4],
    ],
    [
      'cos(2x) = 1/2',
      ['Cos', ['Multiply', 2, 'x']],
      ['Rational', 1, 2],
      0,
      7,
      (x) => Math.cos(2 * x) - 0.5,
      [pi / 6, (5 * pi) / 6, (7 * pi) / 6, (11 * pi) / 6, (13 * pi) / 6],
    ],
    [
      'sin x = 1/2',
      ['Sin', 'x'],
      ['Rational', 1, 2],
      0,
      7,
      (x) => Math.sin(x) - 0.5,
      [pi / 6, (5 * pi) / 6, (13 * pi) / 6],
    ],
    [
      'sin(x)^2 = 1/4',
      ['Power', ['Sin', 'x'], 2],
      ['Rational', 1, 4],
      0,
      7,
      (x) => Math.sin(x) ** 2 - 0.25,
      [pi / 6, (5 * pi) / 6, (7 * pi) / 6, (11 * pi) / 6, (13 * pi) / 6],
    ],
    [
      'sin(x/2) = 0',
      ['Sin', ['Divide', 'x', 2]],
      0,
      -7,
      14,
      (x) => Math.sin(x / 2),
      [-2 * pi, 0, 2 * pi, 4 * pi],
    ],
    [
      'sin(3x) = 0',
      ['Sin', ['Multiply', 3, 'x']],
      0,
      0,
      7,
      (x) => Math.sin(3 * x),
      [0, 1, 2, 3, 4, 5, 6].map((k) => (k * pi) / 3),
    ],
    [
      'sin(x + 1) = 0',
      ['Sin', ['Add', 'x', 1]],
      0,
      0,
      7,
      (x) => Math.sin(x + 1),
      [pi - 1, 2 * pi - 1],
    ],
    [
      'sin x + cos x = 0 over a wide interval',
      ['Add', ['Sin', 'x'], ['Cos', 'x']],
      0,
      -20,
      30,
      (x) => Math.sin(x) + Math.cos(x),
      Array.from({ length: 16 }, (_, k) => ((4 * k - 25) * pi) / 4),
    ],
    [
      // The periods 2π and 2π/√2 have no common multiple. The solver keeps
      // its roots only because the scan finds no other root.
      'sin(x) cos(√2 x) = 0 (no common period)',
      ['Multiply', ['Sin', 'x'], ['Cos', ['Multiply', ['Sqrt', 2], 'x']]],
      0,
      -1,
      3,
      (x) => Math.sin(x) * Math.cos(Math.SQRT2 * x),
      [0, pi / (2 * Math.SQRT2)],
    ],
  ];

  test.each(cases)('%s', (_name, lhs, rhs, lo, hi, f, expected) => {
    const expr = ce.box([
      'Solve',
      ['Equal', lhs, rhs],
      ['Element', 'x', ['Interval', lo, hi]],
    ]);
    const actual = solutions(expr);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < actual.length; i++) {
      expect(actual[i]).toBeCloseTo(expected[i], 10);
      expect(Math.abs(f(actual[i]))).toBeLessThan(1e-9);
    }
  });

  // The solver finds only some of the roots of these equations. A partial
  // list is not an answer: the `Solve` stays unevaluated.
  const incomplete: Array<
    [name: string, lhs: Expression, lo: number, hi: number]
  > = [
    // Roots: 2π/3, π, 4π/3, 2π. The solver finds none of them.
    [
      'sin x + sin(2x) = 0',
      ['Add', ['Sin', 'x'], ['Sin', ['Multiply', 2, 'x']]],
      0.1,
      7,
    ],
    // Roots: π/2 and the eight multiples of π/13 in the interval. The
    // solver finds only π/2.
    [
      'sin(13x) cos x = 0',
      ['Multiply', ['Sin', ['Multiply', 13, 'x']], ['Cos', 'x']],
      0.05,
      2,
    ],
  ];

  test.each(incomplete)('%s stays unevaluated', (_name, lhs, lo, hi) => {
    const expr = ce.box([
      'Solve',
      ['Equal', lhs, 0],
      ['Element', 'x', ['Interval', lo, hi]],
    ]);
    expect(isUnevaluated(expr)).toBe(true);
  });

  test('sin(x) sin(√2 x) = 0 over [1, 4] → π/√2, π', () => {
    // The periods of the two factors have no common multiple. Each factor
    // gives its own family in the domain, and a numeric scan of the product
    // checks the union.
    const actual = solutions(
      ce.box([
        'Solve',
        [
          'Equal',
          ['Multiply', ['Sin', 'x'], ['Sin', ['Multiply', ['Sqrt', 2], 'x']]],
          0,
        ],
        ['Element', 'x', ['Interval', 1, 4]],
      ])
    );
    expect(actual.length).toBe(2);
    expect(actual[0]).toBeCloseTo(Math.PI / Math.SQRT2, 12);
    expect(actual[1]).toBeCloseTo(Math.PI, 12);
  });
});

describe('SOLVE OVER A DOMAIN — the numeric scan that checks a root list', () => {
  const solve = (
    lhs: Expression,
    rhs: Expression,
    lo: Expression,
    hi: Expression,
    engine: ComputeEngine = ce
  ) =>
    engine.box([
      'Solve',
      ['Equal', lhs, rhs],
      ['Element', 'x', ['Interval', lo, hi]],
    ]);

  // Near x = 10^8, a tolerance proportional to |x| (10^-6·|x| = 100) let a
  // root that is not in the list match a root that is.
  test('a partial list near 10^8 is not an answer', () => {
    // Roots: the multiples of π/13 and the odd multiples of π/2. The solver
    // finds only some of them.
    expect(
      isUnevaluated(
        solve(
          ['Multiply', ['Sin', ['Multiply', 13, 'x']], ['Cos', 'x']],
          0,
          100000000,
          100000007
        )
      )
    ).toBe(true);
    // Roots: four multiples of π/13. The root finder gives the principal
    // roots of sin(13x) = 0 (0 and π/13, period 2π/13), and the expansion
    // gives all four.
    const actual = solutions(
      solve(['Sin', ['Multiply', 13, 'x']], 0, 100000000, 100000001)
    );
    expect(actual.length).toBe(4);
    for (const [i, v] of actual.entries())
      expect(v).toBeCloseTo(((413802853 + i) * Math.PI) / 13, 6);
  });

  // Near 10^17 the index k of a root kπ is above 2^53, where `k + 1` can be
  // the same float as `k`: the expansion loop did not end.
  test('a domain near 10^17 gives no answer, and no endless loop', () => {
    expect(
      isUnevaluated(solve(['Sin', 'x'], 0, 100000000000000000, 1e17 + 64))
    ).toBe(true);
  });

  test('a complete list near 10^8 is still an answer', () => {
    const actual = solutions(solve(['Sin', 'x'], 0, 100000000, 100000007));
    expect(actual.length).toBe(2);
    expect(actual[0]).toBeCloseTo(31830989 * Math.PI, 6);
    expect(actual[1]).toBeCloseTo(31830990 * Math.PI, 6);
  });

  // A root where f touches zero between an end of the domain and the first
  // sample of the scan.
  test('a root that touches zero next to an end of the domain', () => {
    // Roots: 6π/13 ≈ 1.449966 (sin(13x)^2 touches zero) and π/2. The solver
    // finds only π/2.
    expect(
      isUnevaluated(
        solve(
          [
            'Multiply',
            ['Power', ['Sin', ['Multiply', 13, 'x']], 2],
            ['Cos', 'x'],
          ],
          0,
          1.4499,
          1.6
        )
      )
    ).toBe(true);
    // The root π is in the first cell of the scan, and it is in the list.
    const actual = solutions(solve(['Power', ['Sin', 'x'], 2], 0, 3.1415, 3.2));
    expect(actual).toEqual([Math.PI]);
  });

  // x·√(cos x + 99/100) is not real between arccos(-0.99) and
  // 2π - arccos(-0.99), and it is 0 at both ends of that interval.
  test('a root at the edge of a region where f is not real', () => {
    const lhs: Expression = [
      'Multiply',
      'x',
      ['Sqrt', ['Add', ['Cos', 'x'], ['Rational', 99, 100]]],
    ];
    const edge = Math.acos(-0.99);
    expect(Math.abs(Math.cos(2 * Math.PI - edge) + 0.99)).toBeLessThan(1e-15);
    // The root `2π - arccos(-0.99) ≈ 3.28313` is in the list: the factor
    // `√(cos x + 99/100)` gives its family in the domain. The scan checks
    // the edges of the region where the function is not real.
    const all = solutions(solve(lhs, 0, 0, 7));
    expect(all.length).toBe(3);
    expect(all[0]).toBe(0);
    expect(all[1]).toBeCloseTo(edge, 12);
    expect(all[2]).toBeCloseTo(2 * Math.PI - edge, 12);
    const right = solutions(solve(lhs, 0, 3.1, 7));
    expect(right.length).toBe(1);
    expect(right[0]).toBeCloseTo(2 * Math.PI - edge, 12);
    // The two roots in [0, 3.2] are in the list.
    const actual = solutions(solve(lhs, 0, 0, 3.2));
    expect(actual.length).toBe(2);
    expect(actual[0]).toBe(0);
    expect(actual[1]).toBeCloseTo(edge, 12);
  });

  // When the scan finds no root, the empty list is a decision.
  test.each([
    ['sin x = 0 over [0.1, 0.2]', ['Sin', 'x'], 0, 0.1, 0.2],
    ['sin x = 2 over [0, 7]', ['Sin', 'x'], 2, 0, 7],
    [
      '√(cos x + 99/100) + 1 = 0 over [0, 7]',
      ['Add', ['Sqrt', ['Add', ['Cos', 'x'], ['Rational', 99, 100]]], 1],
      0,
      0,
      7,
    ],
  ] as Array<[string, Expression, Expression, number, number]>)(
    '%s has no root',
    (_name, lhs, rhs, lo, hi) => {
      expect(solutions(solve(lhs, rhs, lo, hi))).toEqual([]);
    }
  );

  // A trig function reads its argument in the angular unit of the engine,
  // thus the period of `sin x` is 360 in degree mode. A half turn is π rad,
  // 180 deg, 200 grad or 1/2 turn.
  test.each([
    ['rad', Math.PI],
    ['deg', 180],
    ['grad', 200],
    ['turn', 0.5],
  ] as const)('periodic roots in the angular unit %s', (unit, h) => {
    const engine = new ComputeEngine();
    engine.angularUnit = unit;
    // `k` half turns. An end of the domain at a multiple of π is exact in
    // radians.
    const halfTurns = (k: number): Expression =>
      unit === 'rad' ? ['Multiply', k, 'Pi'] : k * h;

    // The upper end of the domain and the roots, in half turns
    const cases: Array<
      [lhs: Expression, rhs: Expression, hi: number, expected: number[]]
    > = [
      [['Sin', 'x'], ['Rational', 1, 2], 4, [1, 5, 13, 17].map((k) => k / 6)],
      [['Sin', ['Multiply', 2, 'x']], 0, 2, [0, 0.5, 1, 1.5, 2]],
      [['Add', ['Sin', 'x'], ['Cos', 'x']], 0, 4, [0.75, 1.75, 2.75, 3.75]],
      [['Tan', 'x'], 1, 2, [0.25, 1.25]],
      [['Sin', 'x'], 0, 0.5, [0]],
    ];
    for (const [lhs, rhs, hi, expected] of cases) {
      const actual = solutions(solve(lhs, rhs, 0, halfTurns(hi), engine));
      expect(actual.length).toBe(expected.length);
      expected.forEach((k, i) => expect(actual[i]).toBeCloseTo(k * h, 10));
      const f = engine.box(['Subtract', lhs, rhs]);
      for (const x of actual) {
        const y = f.subs({ x: engine.number(x) }).N().re;
        expect(Math.abs(y)).toBeLessThan(1e-9);
      }
    }

    // No root between 1/18 and 1/9 of a half turn (10 and 20 degrees)
    expect(solutions(solve(['Sin', 'x'], 0, h / 18, h / 9, engine))).toEqual(
      []
    );
  });
});

describe('SOLVE OVER A DOMAIN — a root list is given only when it is complete', () => {
  const solveIn = (
    f: Expression,
    domain: Expression,
    engine: ComputeEngine = ce
  ) => engine.box(['Solve', f, ['Element', 'x', domain]]);

  // Each value is a root of `f`, numerically.
  const expectRoots = (f: Expression, roots: number[]) => {
    const fn = ce.box(f);
    for (const x of roots)
      expect(Math.abs(fn.subs({ x: ce.number(x) }).N().re)).toBeLessThan(1e-9);
  };

  // Two principal roots 1.15·10^-10 apart give two families. Their numeric
  // positions were compared to 10^-9 of the spacing, so one family was lost:
  // the result was a list of 3 of the 6 roots.
  test('two principal roots that are very near give two families', () => {
    const f: Expression = [
      'Multiply',
      ['Subtract', ['Sin', 'x'], ['Rational', 1, 2]],
      [
        'Subtract',
        ['Sin', 'x'],
        ['Add', ['Rational', 1, 2], ['Power', 10, -10]],
      ],
    ];
    const actual = solutions(solveIn(f, ['Interval', 0, 7]));
    const a = Math.asin(0.5 + 1e-10);
    const expected = [
      Math.PI / 6,
      a,
      Math.PI - a,
      (5 * Math.PI) / 6,
      (13 * Math.PI) / 6,
      2 * Math.PI + a,
    ];
    expect(actual.length).toBe(6);
    expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 12));
    expectRoots(f, actual);
  });

  // The root finder does not give all the roots of an equation with a
  // function such as `BesselJ` or `Sinc`, and the scan cannot check it. The
  // results were `[1]`.
  test.each([
    [
      '(x - 1)·Haversine(x) over [0.5, 20]',
      ['Multiply', ['Subtract', 'x', 1], ['Haversine', 'x']],
      ['Interval', 0.5, 20],
    ],
    [
      '(x - 1)·Sinc(x) over [0.5, 20]',
      ['Multiply', ['Subtract', 'x', 1], ['Sinc', 'x']],
      ['Interval', 0.5, 20],
    ],
    [
      '(x - 1)·BesselJ(0, x) over [0.5, 10]',
      ['Multiply', ['Subtract', 'x', 1], ['BesselJ', 0, 'x']],
      ['Interval', 0.5, 10],
    ],
    // A factor that oscillates much faster than the trig terms can have
    // roots between two samples of the scan.
    [
      'sin(x)·(BesselJ(0, 500x) + 1/100) over [3, 3.3]',
      [
        'Multiply',
        ['Sin', 'x'],
        ['Add', ['BesselJ', 0, ['Multiply', 500, 'x']], ['Rational', 1, 100]],
      ],
      ['Interval', 3, 3.3],
    ],
  ] as Array<[string, Expression, Expression]>)(
    '%s stays unevaluated',
    (_name, f, domain) => {
      expect(isUnevaluated(solveIn(f, domain))).toBe(true);
    }
  );

  test('a haversine is a periodic term of the equation', () => {
    // hav(x) = (1 - cos x)/2 is 0 at 2kπ: no such root is in [0.5, 6].
    expect(
      solutions(
        solveIn(
          ['Multiply', ['Subtract', 'x', 1], ['Haversine', 'x']],
          ['Interval', 0.5, 6]
        )
      )
    ).toEqual([1]);
    // A finite domain is enumerated: hav(πx) = 0 for each even x.
    expect(
      solutions(
        solveIn(
          [
            'Multiply',
            ['Subtract', 'x', 1],
            ['Haversine', ['Multiply', 'Pi', 'x']],
          ],
          ['Range', -4, 4]
        )
      )
    ).toEqual([-4, -2, 0, 1, 2, 4]);
  });

  // Over a domain that is not bounded, the principal roots are the answer
  // only over the whole real line and the complex numbers. `sin(πx) = 0`
  // over the integers was `[0]`, but each integer is a root.
  test('a periodic equation over an unbounded domain', () => {
    const sinPiX: Expression = ['Sin', ['Multiply', 'Pi', 'x']];
    expect(isUnevaluated(solveIn(sinPiX, 'Integers'))).toBe(true);
    expect(solutions(solveIn(sinPiX, ['Range', -3, 3]))).toEqual([
      -3, -2, -1, 0, 1, 2, 3,
    ]);
    expect(
      isUnevaluated(solveIn(['Sin', 'x'], ['Interval', 0, 'PositiveInfinity']))
    ).toBe(true);
    expect(
      isUnevaluated(solveIn(['Multiply', 'x', ['Sin', 'x']], 'Integers'))
    ).toBe(true);
    // A finite set is enumerated: 1 is also a root.
    expect(
      solutions(solveIn(sinPiX, ['Set', 0, ['Rational', 1, 2], 1]))
    ).toEqual([0, 1]);
    // The principal roots over the real numbers
    expect(solutions(solveIn(['Sin', 'x'], 'RealNumbers'))).toEqual([
      0,
      Math.PI,
    ]);
  });

  // A root where f is flat: near the root π of sin(x)^10, |f| < 10^-16 on
  // an interval of width 0.05. A sample in that interval was taken as the
  // position of a root that is not in the list, and the list was rejected.
  test('a root of high multiplicity', () => {
    expect(
      solutions(
        solveIn(
          ['Power', ['Sin', 'x'], 10],
          ['Interval', 0, ['Multiply', 2, 'Pi']]
        )
      )
    ).toEqual([0, Math.PI, 2 * Math.PI]);
    expect(
      solutions(solveIn(['Power', ['Cos', 'x'], 20], ['Interval', 0, 7]))
    ).toEqual([Math.PI / 2, (3 * Math.PI) / 2]);
    const f: Expression = [
      'Multiply',
      ['Power', ['Subtract', 'x', 1], 9],
      ['Sin', 'x'],
    ];
    expect(solutions(solveIn(f, ['Interval', 0.5, 4]))).toEqual([1, Math.PI]);
  });

  // The principal roots represent the periodic families of a trig function.
  // A function that the root finder cannot invert and that is not periodic
  // has no such convention: the list `[1]` was only a part of the roots.
  test('a function that is not periodic, over ℝ and without a domain', () => {
    const f: Expression = [
      'Multiply',
      ['Subtract', 'x', 1],
      ['BesselJ', 0, 'x'],
    ];
    expect(isUnevaluated(ce.box(['Solve', f, 'x']))).toBe(true);
    expect(isUnevaluated(solveIn(f, 'RealNumbers'))).toBe(true);
    // A trig function keeps its principal roots
    expect(solutions(ce.box(['Solve', ['Sin', 'x'], 'x']))).toEqual([
      0,
      Math.PI,
    ]);
  });

  // `x + e^x = 0` has the root -W(1) ≈ -0.567143, which the root finder does
  // not find. The answer was `[2]`.
  test('a factor with no closed-form root', () => {
    const f: Expression = [
      'Multiply',
      ['Subtract', 'x', 2],
      ['Add', 'x', ['Exp', 'x']],
    ];
    const w = -0.5671432904097838;
    expect(Math.abs(w + Math.exp(w))).toBeLessThan(1e-15);
    expect(isUnevaluated(ce.box(['Solve', f, 'x']))).toBe(true);
    expect(isUnevaluated(solveIn(f, 'RealNumbers'))).toBe(true);
    expect(isUnevaluated(solveIn(f, ['Interval', -1, 3]))).toBe(true);

    // A factor with no root is shown to have none: these do not change
    const cases: Array<[Expression, number[]]> = [
      [
        ['Multiply', ['Subtract', 'x', 2], ['Add', 'x', 3]],
        [-3, 2],
      ],
      [['Multiply', ['Subtract', 'x', 2], ['Exp', 'x']], [2]],
      [['Multiply', ['Subtract', 'x', 2], ['Add', ['Exp', 'x'], 1]], [2]],
      [['Multiply', ['Subtract', 'x', 2], ['Add', ['Power', 'x', 2], 1]], [2]],
      [['Multiply', 'x', ['Ln', 'x']], [1]],
    ];
    for (const [g, expected] of cases) {
      expect(solutions(ce.box(['Solve', g, 'x']))).toEqual(expected);
      expect(solutions(solveIn(g, 'RealNumbers'))).toEqual(expected);
    }

    // Over a bounded domain, the numeric scan can show that the list is
    // complete: `Haversine(x)` gives no root, and has none in [0.5, 6].
    expect(
      solutions(
        solveIn(
          ['Multiply', ['Subtract', 'x', 1], ['Haversine', 'x']],
          ['Interval', 0.5, 6]
        )
      )
    ).toEqual([1]);
  });

  // `expr.solve()` returns `null` (no answer) for a list that is only a
  // part of the roots. It returned `[1]` and `[2]`.
  test('expr.solve() gives no partial list', () => {
    const solve = (f: Expression) => ce.box(f).solve('x');
    expect(
      solve(['Multiply', ['Subtract', 'x', 1], ['BesselJ', 0, 'x']])
    ).toBeNull();
    expect(
      solve(['Multiply', ['Subtract', 'x', 2], ['Add', 'x', ['Exp', 'x']]])
    ).toBeNull();
    const values = (f: Expression) =>
      (solve(f) as ReadonlyArray<BoxedExpression>)
        .map((r) => r.N().re)
        .sort((a, b) => a - b);
    expect(values(['Multiply', ['Subtract', 'x', 2], ['Exp', 'x']])).toEqual([
      2,
    ]);
    expect(values(['Multiply', ['Subtract', 'x', 2], ['Add', 'x', 3]])).toEqual(
      [-3, 2]
    );
    expect(values(['Multiply', 'x', ['Ln', 'x']])).toEqual([1]);
    const sin = values(['Equal', ['Sin', 'x'], ['Rational', 1, 2]]);
    expect(sin.length).toBe(2);
    expect(sin[0]).toBeCloseTo(Math.PI / 6, 12);
    expect(sin[1]).toBeCloseTo((5 * Math.PI) / 6, 12);
  });

  // The common roots of a list of equations in one unknown are the
  // candidates of an equation that gives all its roots. A list where each
  // equation gives only a part of its roots has no answer: it was `[2]`.
  test('the common roots of equations that give a part of their roots', () => {
    const f: Expression = [
      'Equal',
      ['Multiply', ['Subtract', 'x', 2], ['Add', 'x', ['Exp', 'x']]],
      0,
    ];
    const g: Expression = [
      'Equal',
      [
        'Multiply',
        ['Subtract', 'x', 2],
        ['Add', 'x', ['Exp', 'x']],
        ['Add', 'x', 5],
      ],
      0,
    ];
    expect(isUnevaluated(ce.box(['Solve', ['List', f, g], 'x']))).toBe(true);
    // `sin(πx) = 0` gives its principal roots: the only common root is 2
    // (`sin(-0.567π)` is not 0).
    expect(
      solutions(
        ce.box([
          'Solve',
          ['List', f, ['Equal', ['Sin', ['Multiply', 'Pi', 'x']], 0]],
          'x',
        ])
      )
    ).toEqual([2]);
  });

  // The alternatives of an `Or` have the union of their roots as solutions.
  // When one alternative has no answer, the union is not an answer.
  test('expr.solve() of alternatives with a partial list', () => {
    const partial: Expression = [
      'Equal',
      ['Multiply', ['Subtract', 'x', 1], ['BesselJ', 0, 'x']],
      0,
    ];
    expect(ce.box(['Or', ['Equal', 'x', 3], partial]).solve('x')).toBeNull();
    const both = ce
      .box(['Or', ['Equal', 'x', 3], ['Equal', 'x', 4]])
      .solve('x') as ReadonlyArray<BoxedExpression>;
    expect(both.map((r) => r.re)).toEqual([3, 4]);
  });

  // `explain('solve')` gives the same result as `solve()`: the explanation
  // of a partial list says that there is no complete answer, and why.
  test('explain("solve") of a partial list', () => {
    const product = ce.box([
      'Multiply',
      ['Subtract', 'x', 2],
      ['Add', 'x', ['Exp', 'x']],
    ]);
    const e = product.explain('solve', { variable: 'x' });
    expect(e.result.operator).toBe('Solve');
    expect(e.steps.at(-1)!.id).toBe('solve.incomplete-factor');
    expect(e.steps.at(-1)!.description).toMatch(/^No complete answer/);

    // The unknown in a function that the solver cannot invert, with no
    // factor of a product
    const bessel = ce.box(['Subtract', ['BesselJ', 0, 'x'], 'x']);
    expect(bessel.solve('x')).toBeNull();
    const b = bessel.explain('solve', { variable: 'x' });
    expect(b.result.operator).toBe('Solve');
    expect(b.steps.at(-1)!.id).toBe('solve.incomplete-non-invertible');

    // A complete list is unchanged
    const quadratic = ce.box(['Equal', ['Power', 'x', 2], 4]);
    const q = quadratic.explain('solve', { variable: 'x' });
    expect(q.result.operator).toBe('List');
    expect(q.result.ops!.map((r) => r.re).sort()).toEqual([-2, 2]);
  });

  // A root template that the host adds to `ce.solveRules` is the host's
  // claim of a solution: it is used also for a function that the solver
  // cannot invert. J₁(0) = 0.
  test('a user root template for a function the solver cannot invert', () => {
    const engine = new ComputeEngine();
    const j1: Expression = ['BesselJ', 1, 'x'];
    expect(engine.box(j1).solve('x')).toBeNull();
    engine.solveRules.push({ match: ['BesselJ', 1, '_x'], replace: 0 });
    const roots = engine.box(j1).solve('x') as ReadonlyArray<BoxedExpression>;
    expect(roots.map((r) => r.re)).toEqual([0]);
    expect(solutions(engine.box(['Solve', j1, 'x']))).toEqual([0]);
    const product: Expression = ['Multiply', ['Subtract', 'x', 1], j1];
    expect(solutions(engine.box(['Solve', product, 'x']))).toEqual([0, 1]);
    expect(
      engine.box(product).explain('solve', { variable: 'x' }).result.operator
    ).toBe('List');
    // A candidate of a template that the check rejects does not show that
    // there is no root: J₀(2.405) is not 0.
    const other = new ComputeEngine();
    other.solveRules.push({
      match: ['BesselJ', 0, '_x'],
      replace: ['Rational', 2405, 1000],
    });
    expect(isUnevaluated(other.box(['Solve', ['BesselJ', 0, 'x'], 'x']))).toBe(
      true
    );
    // For the same reason, such a rejected candidate does not show that a
    // factor of a product has no root: the template J₀(x) → 0 is wrong, and
    // J₀ has real roots (2.405, …), thus `[1]` is not all the roots.
    const zero = new ComputeEngine();
    zero.solveRules.push({ match: ['BesselJ', 0, '_x'], replace: 0 });
    const j0Product: Expression = [
      'Multiply',
      ['Subtract', 'x', 1],
      ['BesselJ', 0, 'x'],
    ];
    expect(zero.box(j0Product).solve('x')).toBeNull();
    expect(isUnevaluated(zero.box(['Solve', j0Product, 'x']))).toBe(true);
  });

  // A root written with the library π names `Pi` in its MathJSON, and it
  // has the user value when it is boxed again.
  test('a user value of Pi', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.declare('Pi', { value: 3 });
    // `[0, Pi]` boxed again to `[0, 3]`
    expect(
      isUnevaluated(
        solveIn(['Multiply', 'x', ['Sin', 'x']], ['Interval', 0, 4], engine)
      )
    ).toBe(true);
    expect(isUnevaluated(solveIn(['Sin', 'x'], 'RealNumbers', engine))).toBe(
      true
    );
    // The root π is not in the domain
    expect(
      solutions(
        solveIn(
          ['Multiply', ['Subtract', 'x', 1], ['Sin', 'x']],
          ['Interval', 0.5, 2],
          engine
        )
      )
    ).toEqual([1]);
    engine.popScope();

    // In degrees, the half turn is 180 and the roots hold no π
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    deg.pushScope();
    deg.declare('Pi', { value: 3 });
    const r = solveIn(['Sin', 'x'], ['Interval', 0, 360], deg).evaluate();
    expect(r.json).toEqual(['List', 0, 180, 360]);
    deg.popScope();
  });
});

describe('SOLVE OVER A DOMAIN — Interval domains (filter-only)', () => {
  test('quadratic keeps the root inside the interval', () => {
    // x^2 - 5x + 6 = 0 → {2, 3}; Interval(Open(2.5), 10] keeps only 3.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', -5, 'x'], 6], 0],
      ['Element', 'x', ['Interval', ['Open', 2.5], 10]],
    ]);
    expect(solutions(expr)).toEqual([3]);
  });

  test('open endpoint drops a root that lands on it', () => {
    // Root 3 sits exactly on the open lower endpoint → dropped.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', -5, 'x'], 6], 0],
      ['Element', 'x', ['Interval', ['Open', 3], 10]],
    ]);
    const r = expr.evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.length).toBe(0);
  });

  test('closed endpoint keeps a root that lands on it', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', -5, 'x'], 6], 0],
      ['Element', 'x', ['Interval', 3, 10]],
    ]);
    expect(solutions(expr)).toEqual([3]);
  });

  test('infinite endpoint keeps positive roots, drops negative', () => {
    // x^2 = 4 → {-2, 2}; Interval(Open(0), +∞) keeps only 2.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Power', 'x', 2], 4],
      ['Element', 'x', ['Interval', ['Open', 0], 'PositiveInfinity']],
    ]);
    expect(solutions(expr)).toEqual([2]);
  });

  test('no real root in the interval → decided empty List', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', -5, 'x'], 6], 0],
      ['Element', 'x', ['Interval', 10, 20]],
    ]);
    const r = expr.evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.length).toBe(0);
  });

  test('symbolically unsolved equation over an interval stays inert', () => {
    // 2^x + x = 100 has no closed form → no symbolic roots; an Interval is not
    // enumerable → the expression stays unevaluated (never enumerated).
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 2, 'x'], 'x'], 100],
      ['Element', 'x', ['Interval', 0, 10]],
    ]);
    expect(isUnevaluated(expr)).toBe(true);
  });
});

describe('SOLVE — assumption bounds routed through root filtering', () => {
  // A fresh engine per test: assumptions are process-global within an engine's
  // scope, and these tests deliberately install bound assumptions — use an
  // isolated engine so nothing leaks into the shared `engine` other suites use.
  const roots = (r: BoxedExpression): number[] => {
    const v = r.evaluate();
    if (v.operator !== 'List')
      throw new Error(`Expected a List, got ${v.operator}: ${v.toString()}`);
    return v.ops!.map((o) => o.N().re).sort((a, b) => a - b);
  };

  test('assume(n > 0) drops the negative root of n^2 = 16 (operator + method)', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('n > 0'));
    // Via the `Solve` operator.
    expect(
      roots(e.box(['Solve', ['Equal', ['Power', 'n', 2], 16], 'n']))
    ).toEqual([4]);
    // Via `expr.solve('n')` (same outer boundary).
    const m = e.parse('n^2 = 16').solve('n') as BoxedExpression[];
    expect(m.map((x) => x.N().re).sort((a, b) => a - b)).toEqual([4]);
  });

  test('assume(n ∈ 1..10) keeps the in-range root of n^2 = 16', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('n \\in 1..10'));
    expect(
      roots(e.box(['Solve', ['Equal', ['Power', 'n', 2], 16], 'n']))
    ).toEqual([4]);
  });

  test('assume(n ∈ 1..10) drops a root past the upper bound → decided empty', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('n \\in 1..10'));
    // n^2 = 400 → {-20, 20}; 20 > 10 → both dropped, empty List is the answer.
    const r = e
      .box(['Solve', ['Equal', ['Power', 'n', 2], 400], 'n'])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.length).toBe(0);
  });

  test('NotEqual assumption drops the excluded root', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('x \\ne 3'));
    expect(
      roots(e.box(['Solve', ['Equal', ['Power', 'x', 2], 9], 'x']))
    ).toEqual([-3]);
  });

  test('an assumption on a different symbol does not filter', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('m > 0')); // constrains `m`, not the unknown `n`
    expect(
      roots(e.box(['Solve', ['Equal', ['Power', 'n', 2], 16], 'n']))
    ).toEqual([-4, 4]);
  });

  test('symbolic/parametric root kept when the bound is undecidable', () => {
    // x^2 = a → {±√a}. With `x > 0` we test `-√a < 0` / `√a < 0`; even with
    // `a > 0` the engine does not settle the sign of `√a`, so BOTH roots are
    // undecidable → conservatively kept (never silently drop a valid solution).
    const e = new ComputeEngine();
    e.assume(e.parse('a > 0'));
    e.assume(e.parse('x > 0'));
    const m = e.parse('x^2 = a').solve('x') as BoxedExpression[];
    expect(m.map((x) => x.toString()).sort()).toEqual(
      ['-sqrt(a)', 'sqrt(a)'].sort()
    );
  });

  test('popScope restores unfiltered behavior', () => {
    const e = new ComputeEngine();
    e.pushScope();
    e.assume(e.parse('n > 0'));
    let m = e.parse('n^2 = 16').solve('n') as BoxedExpression[];
    expect(m.map((x) => x.N().re).sort((a, b) => a - b)).toEqual([4]);
    e.popScope();
    // The assumption is gone with its scope → both roots return.
    m = e.parse('n^2 = 16').solve('n') as BoxedExpression[];
    expect(m.map((x) => x.N().re).sort((a, b) => a - b)).toEqual([-4, 4]);
  });

  test('explicit domain and assumption restrict conjunctively', () => {
    // n ∈ -10..10 keeps {-4, 4}; assume(n > 3) further drops -4.
    const e = new ComputeEngine();
    e.assume(e.parse('n > 3'));
    const expr = e.box([
      'Solve',
      ['Equal', ['Power', 'n', 2], 16],
      ['Element', 'n', ['Range', -10, 10]],
    ]);
    expect(roots(expr)).toEqual([4]);
  });
});

describe('SOLVE — collection-shaped first argument (lifted constraints)', () => {
  // The digit puzzle: 100a+10b+c = 11(a²+b²+c²), a ∈ 1..9, b,c ∈ 0..9.
  const digitEq: Expression = [
    'Equal',
    ['Add', ['Multiply', 100, 'a'], ['Multiply', 10, 'b'], 'c'],
    [
      'Multiply',
      11,
      ['Add', ['Power', 'a', 2], ['Power', 'b', 2], ['Power', 'c', 2]],
    ],
  ];

  test('full LaTeX expression with brace-set constraints and brace variable list', () => {
    const expr = ce.parse(
      '\\mathrm{Solve}(\\{100a+10b+c=11(a^2+b^2+c^2),a\\in\\{1,\\dots,9\\},b\\in\\{0,\\dots,9\\},c\\in\\{0,\\dots,9\\}\\},\\{a,b,c\\})'
    );
    expect(tuples(expr)).toEqual([
      [5, 5, 0],
      [8, 0, 3],
    ]);
  });

  test('bracket spelling (regression) stays working', () => {
    const expr = ce.parse(
      '\\mathrm{Solve}(100a+10b+c=11(a^2+b^2+c^2), a\\in\\lbrack1,\\dots,9\\rbrack, b\\in\\lbrack0,\\dots,9\\rbrack, c\\in\\lbrack0,\\dots,9\\rbrack)'
    );
    expect(tuples(expr)).toEqual([
      [5, 5, 0],
      [8, 0, 3],
    ]);
  });

  test('Set variable list: Solve(x^2=4, {x}) returns both roots', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Power', 'x', 2], 4],
      ['Set', 'x'],
    ]);
    expect(solutions(expr)).toEqual([-2, 2]);
  });

  test('pure system spelled as a Set solves like the List form', () => {
    const eq1: Expression = ['Equal', ['Add', 'x', 'y'], 3];
    const eq2: Expression = ['Equal', ['Subtract', 'x', 'y'], 1];
    const asSet = ce.box(['Solve', ['Set', eq1, eq2], ['List', 'x', 'y']]);
    const asList = ce.box(['Solve', ['List', eq1, eq2], ['List', 'x', 'y']]);
    expect(tuples(asSet)).toEqual([[2, 1]]);
    expect(tuples(asSet)).toEqual(tuples(asList));
  });

  test('And-joined equation + Element constraints with an explicit variable list', () => {
    const expr = ce.box([
      'Solve',
      [
        'And',
        digitEq,
        ['Element', 'a', ['Range', 1, 9]],
        ['Element', 'b', ['Range', 0, 9]],
        ['Element', 'c', ['Range', 0, 9]],
      ],
      ['List', 'a', 'b', 'c'],
    ]);
    expect(tuples(expr)).toEqual([
      [5, 5, 0],
      [8, 0, 3],
    ]);
  });

  test('arity-1: Set bundling equation + Elements, no variable list', () => {
    const expr = ce.box([
      'Solve',
      [
        'Set',
        digitEq,
        ['Element', 'a', ['Range', 1, 9]],
        ['Element', 'b', ['Range', 0, 9]],
        ['Element', 'c', ['Range', 0, 9]],
      ],
    ]);
    expect(tuples(expr)).toEqual([
      [5, 5, 0],
      [8, 0, 3],
    ]);
  });

  test('duplicate domain merges conjunctively (intersection honored)', () => {
    // 2a = a + 5 → a = 5. The lifted domain 1..9 and the arg-position domain
    // 1..5 both hold at a = 5.
    const eq: Expression = ['Equal', ['Multiply', 2, 'a'], ['Add', 'a', 5]];
    // A single unknown → Phase 1 univariate pipeline → a List of scalar values.
    const inBoth = ce.box([
      'Solve',
      ['Set', eq, ['Element', 'a', ['Range', 1, 9]]],
      ['List', ['Element', 'a', ['Range', 1, 5]]],
    ]);
    expect(solutions(inBoth)).toEqual([5]);

    // 2a = a + 7 → a = 7: inside the lifted 1..9 but outside the arg 1..5, so
    // the intersection rules it out (decided empty).
    const eqOut: Expression = ['Equal', ['Multiply', 2, 'a'], ['Add', 'a', 7]];
    const outside = ce.box([
      'Solve',
      ['Set', eqOut, ['Element', 'a', ['Range', 1, 9]]],
      ['List', ['Element', 'a', ['Range', 1, 5]]],
    ]);
    expect(solutions(outside)).toEqual([]);
  });

  test('lifted Element for a symbol not in the variable list stays inert', () => {
    const expr = ce.box([
      'Solve',
      ['Set', digitEq, ['Element', 'z', ['Range', 1, 9]]],
      ['List', 'a', 'b'],
    ]);
    expect(isUnevaluated(expr)).toBe(true);
  });

  // §D: the value-bound-unknown shield is computed from the positional specs,
  // which are EMPTY for an arity-1 bundled solve — the unknown is discovered
  // only when the bundled `Element` specs are lifted, AFTER the nested
  // transformer reduces. So a value-bound bundled unknown had its global value
  // folded away before the code learned it was the solve target. The unknown
  // must sit DIRECTLY under the transformer (the `s := (9-w²)/4` indirection
  // form does not exhibit the gap). A fresh engine — `assign` mutates it.
  test('a value-bound bundled unknown is shielded (§D)', () => {
    const fresh = new ComputeEngine();
    fresh.assign('w', 9);
    const eqn: Expression = [
      'Equal',
      ['Simplify', ['Subtract', 9, ['Power', 'w', 2]]],
      8,
    ];
    const elem: Expression = ['Element', 'w', ['Range', -3, 3]];
    // The positional form already conforms; the bundled form must match it.
    const positional = fresh.box(['Solve', eqn, elem]);
    const bundled = fresh.box(['Solve', ['Set', eqn, elem]]);
    // 9 − w² = 8 ⟺ w² = 1 ⟺ w = ±1, within −3..3.
    expect(solutions(positional)).toEqual([-1, 1]);
    expect(solutions(bundled)).toEqual([-1, 1]);
    // The global value survives the solve.
    expect(fresh.box('w').evaluate().re).toBe(9);
  });
});

describe('SOLVE — trailing bare domain-name spec (Mathematica)', () => {
  test('bare Integers domain applies to the unknown', () => {
    // Solve(x^2 = 4, x, Integers) → both integer roots.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Power', 'x', 2], 4],
      'x',
      'Integers',
    ]);
    expect(solutions(expr)).toEqual([-2, 2]);
  });

  test('bare Integers domain: no integer solution decides []', () => {
    // 2x = 3 → x = 3/2, not an integer → [] (a decision, via the integer path).
    const linear = ce.box([
      'Solve',
      ['Equal', ['Multiply', 2, 'x'], 3],
      'x',
      'Integers',
    ]);
    expect(solutions(linear)).toEqual([]);

    // x^2 = 2 → ±√2, irrational → [] over the integers.
    const quad = ce.box([
      'Solve',
      ['Equal', ['Power', 'x', 2], 2],
      'x',
      'Integers',
    ]);
    expect(solutions(quad)).toEqual([]);
  });

  test('bare Reals domain applies to the unknown (real roots)', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Power', 'x', 2], 4],
      'x',
      'RealNumbers',
    ]);
    expect(solutions(expr)).toEqual([-2, 2]);
  });

  test('no bare domain: real-domain solve is unchanged', () => {
    // x^2 = 2 without a domain keeps the two symbolic sqrt roots.
    const expr = ce.box(['Solve', ['Equal', ['Power', 'x', 2], 2], 'x']);
    const r = expr.evaluate();
    expect(r.operator).toBe('List');
    expect(r.nops).toBe(2);
  });
});

describe('SOLVE — inequality/predicate side conditions', () => {
  test('single-variable side condition filters the roots (keeps positive)', () => {
    // Solve({x^2 = 4, x > 0}, x) → [2]  (was an overclaimed []).
    const expr = ce.box([
      'Solve',
      ['Set', ['Equal', ['Power', 'x', 2], 4], ['Greater', 'x', 0]],
      'x',
    ]);
    expect(solutions(expr)).toEqual([2]);
  });

  test('side condition that excludes every root decides []', () => {
    const expr = ce.box([
      'Solve',
      ['Set', ['Equal', ['Power', 'x', 2], 4], ['Greater', 'x', 5]],
      'x',
    ]);
    expect(solutions(expr)).toEqual([]);
  });

  test('multi-variable side condition filters candidate tuples', () => {
    // Solve({a + b = 5, a ∈ 0..5, b ∈ 0..5, a < b}, {a, b}).
    const expr = ce.box([
      'Solve',
      [
        'Set',
        ['Equal', ['Add', 'a', 'b'], 5],
        ['Element', 'a', ['Range', 0, 5]],
        ['Element', 'b', ['Range', 0, 5]],
        ['Less', 'a', 'b'],
      ],
      ['List', 'a', 'b'],
    ]);
    expect(tuples(expr)).toEqual([
      [0, 5],
      [1, 4],
      [2, 3],
    ]);
  });
});

describe('SOLVE OVER A DOMAIN — complete root lists', () => {
  const solveIn = (latex: string, lo: number, hi: number) =>
    ce.box([
      'Solve',
      ce.parse(latex).json,
      ['Element', 'x', ['Interval', lo, hi]],
    ]);

  test('a partial list is not certified when a missing root is very near a listed one', () => {
    // Roots: 0 and about 5·10^-9. The factor x + e^x - 1 - 10^-8 is not
    // solved, and its root is within the tolerance of the scan from 0.
    expect(
      isUnevaluated(solveIn('\\sin(x)\\cdot(x+e^x-1-10^{-8})=0', -1, 1))
    ).toBe(true);
  });

  test('a partial list is certified when each root found is resolved', () => {
    // The factor x + e^x + 5 is not solved, but it has no root in [1, 4]
    // (its root is near -5): the only root in the domain is π.
    expect(solutions(solveIn('\\sin(x)\\cdot(x+e^x+5)=0', 1, 4))).toEqual([
      Math.PI,
    ]);
  });

  test('ln(x^2) = 2 over [-5, 5] → -e, e', () => {
    const actual = solutions(solveIn('\\ln(x^2)=2', -5, 5));
    expect(actual.length).toBe(2);
    expect(actual[0]).toBeCloseTo(-Math.E, 12);
    expect(actual[1]).toBeCloseTo(Math.E, 12);
  });

  test('a product: each periodic factor gives its family in the domain', () => {
    const a = solutions(solveIn('(x-1)\\cos(x)=0', 0, 5));
    expect(a.length).toBe(3);
    expect(a[0]).toBeCloseTo(1, 12);
    expect(a[1]).toBeCloseTo(Math.PI / 2, 12);
    expect(a[2]).toBeCloseTo((3 * Math.PI) / 2, 12);
    const b = solutions(solveIn('e^x\\sin(x)=0', -1, 7));
    expect(b.length).toBe(3);
    b.forEach((v, i) => expect(v).toBeCloseTo(i * Math.PI, 12));
  });

  test('sin(2x) = 0 over [0, 7] uses the period π', () => {
    const actual = solutions(solveIn('\\sin(2x)=0', 0, 7));
    expect(actual.length).toBe(5);
    actual.forEach((v, i) => expect(v).toBeCloseTo((i * Math.PI) / 2, 12));
  });
});
