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
  return r.ops!.map((o) => o.re).sort((a, b) => a - b);
}

/** True if the `Solve` expression stayed unevaluated (undecided). */
function isUnevaluated(expr: BoxedExpression): boolean {
  return expr.evaluate().operator === 'Solve';
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
