import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

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
    const start = Date.now();
    expect(isUnevaluated(expr)).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('deadline interruption propagates a CancellationError', () => {
    const c = new ComputeEngine();
    // A deadline already in the past: the enumeration stride check throws.
    c._deadline = Date.now() - 1;
    expect(() =>
      c
        .box([
          'Solve',
          ['Divides', 3, 'n'],
          ['Element', 'n', ['Range', 1, 9000]],
        ])
        .evaluate()
    ).toThrow();
  });
});

describe('SOLVE OVER A DOMAIN — API surface', () => {
  test('no-domain single-unknown Solve is unchanged', () => {
    const r = ce.box(['Solve', ['Equal', ['Power', 'x', 2], 4], 'x']).evaluate();
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

  test('an invalid spec leaves the expression inert', () => {
    // A number where a symbol/Element spec is expected → error operand →
    // unevaluated.
    const expr = ce.box(['Solve', ['Equal', ['Power', 'x', 2], 4], 42]);
    expect(expr.evaluate().operator).toBe('Solve');
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
    const start = Date.now();
    expect(isUnevaluated(expr)).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
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
    c._deadline = Date.now() - 1;
    expect(() =>
      c
        .box([
          'Solve',
          ['Equal', ['Add', 'x', 'y'], 5],
          ['Element', 'x', ['Range', 1, 200]],
          ['Element', 'y', ['Range', 1, 200]],
        ])
        .evaluate()
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
    expect(solutions(expr)).toEqual([
      0,
      2 * Math.PI,
      4 * Math.PI,
      6 * Math.PI,
    ]);
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
    // span / period ≈ 1.6·10^8 exceeds MAX_PERIODIC_EXPANSION → degrade to the
    // (filtered) principal roots [0, π]. Must be fast.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Sin', 'x'], 0],
      ['Element', 'x', ['Interval', 0, 1000000000]],
    ]);
    const start = Date.now();
    // Principal roots 0 and π both lie in the domain.
    expect(solutions(expr)).toEqual([0, Math.PI]);
    expect(Date.now() - start).toBeLessThan(2000);
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
    expect(roots(e.box(['Solve', ['Equal', ['Power', 'n', 2], 16], 'n']))).toEqual(
      [4]
    );
    // Via `expr.solve('n')` (same outer boundary).
    const m = e.parse('n^2 = 16').solve('n') as BoxedExpression[];
    expect(m.map((x) => x.N().re).sort((a, b) => a - b)).toEqual([4]);
  });

  test('assume(n ∈ 1..10) keeps the in-range root of n^2 = 16', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('n \\in 1..10'));
    expect(roots(e.box(['Solve', ['Equal', ['Power', 'n', 2], 16], 'n']))).toEqual(
      [4]
    );
  });

  test('assume(n ∈ 1..10) drops a root past the upper bound → decided empty', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('n \\in 1..10'));
    // n^2 = 400 → {-20, 20}; 20 > 10 → both dropped, empty List is the answer.
    const r = e.box(['Solve', ['Equal', ['Power', 'n', 2], 400], 'n']).evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.length).toBe(0);
  });

  test('NotEqual assumption drops the excluded root', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('x \\ne 3'));
    expect(roots(e.box(['Solve', ['Equal', ['Power', 'x', 2], 9], 'x']))).toEqual([
      -3,
    ]);
  });

  test('an assumption on a different symbol does not filter', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('m > 0')); // constrains `m`, not the unknown `n`
    expect(roots(e.box(['Solve', ['Equal', ['Power', 'n', 2], 16], 'n']))).toEqual(
      [-4, 4]
    );
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
