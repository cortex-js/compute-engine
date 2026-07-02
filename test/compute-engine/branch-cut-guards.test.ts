/**
 * Regression tests for the branch-cut / realness P0 pair (WP-2.10):
 *
 *  - SYM P0-2: `ln(x²) → 2·ln(x)` was wrong for every negative real (the
 *    fail-open branch-cut guard). The sound form is `2·ln|x|`.
 *  - SYM P0-4: real-only rewrites (`√(x²) → |x|`, `|x|² → x²`, `|x²| → x²`,
 *    `ln(x²) → 2ln x`) fired on symbols *declared* complex/imaginary.
 *
 * Policies: D3 (three-valued `onBranchCut`, compared `=== false`/`=== true`,
 * never negated) and D4 (the generic-real convention is kept for *unconstrained*
 * symbols, but every real-only rewrite bails when the operand is declared/
 * inferred complex or imaginary).
 */

import { ComputeEngine } from '../../src/compute-engine';

/** [re, im] pair of `expr.N()` (NaN-safe). */
function nv(e: any): [number, number] {
  const n = e.N();
  return [n.re ?? NaN, n.im ?? NaN];
}
function close(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs((a[1] || 0) - (b[1] || 0)) < 1e-9;
}
/** simplify(src) must be numerically identical to src at the substitution. */
function identityAt(
  ce: ComputeEngine,
  src: string,
  subs: Record<string, any>
): boolean {
  const orig = ce.parse(src);
  const simplified = orig.simplify();
  return close(nv(orig.subs(subs)), nv(simplified.subs(subs)));
}

describe('SYM P0-2 — ln(x²) is 2·ln|x|, not 2·ln x', () => {
  test('ln(x²) unconstrained → 2ln(|x|) and is sound at x = -2', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\ln(x^2)').simplify().toString()).toBe('2ln(|x|)');
    expect(identityAt(ce, '\\ln(x^2)', { x: -2 })).toBe(true);
  });

  test('ln(x⁴) unconstrained → 4ln(|x|) and is sound at x = -2', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\ln(x^4)').simplify().toString()).toBe('4ln(|x|)');
    expect(identityAt(ce, '\\ln(x^4)', { x: -2 })).toBe(true);
  });

  test('declared-real base also routes even powers through |x|', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    expect(ce.parse('\\ln(t^2)').simplify().toString()).toBe('2ln(|t|)');
  });

  test('assume(x>0) keeps ln(x²) → 2ln(x)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x>0'));
    expect(ce.parse('\\ln(x^2)').simplify().toString()).toBe('2ln(x)');
  });

  test('assume(x<0) gives ln(x²) → 2ln(-x)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x<0'));
    expect(ce.parse('\\ln(x^2)').simplify().toString()).toBe('2ln(-x)');
  });

  test('ln(x³) stays symbolic when x is provably negative', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x<0'));
    expect(ce.parse('\\ln(x^3)').simplify().toString()).toBe('ln(x^3)');
  });

  test('generic-real convention kept: odd/irrational powers of an unconstrained base still fold', () => {
    const ce = new ComputeEngine();
    // ln(x³) - 3ln(x) → 0 under the documented convention (D4).
    expect(ce.parse('\\ln(x^3)-3\\ln(x)').simplify().isSame(0)).toBe(true);
    // ln(x^√2) → √2·ln(x)
    expect(ce.parse('\\ln(x^{\\sqrt2})').simplify().toString()).toBe(
      'sqrt(2) * ln(x)'
    );
  });
});

describe('SYM P0-4 — real-only rewrites bail on declared-complex operands', () => {
  // Each rewrite must be the identity for a declared-complex `z`, and the
  // un-simplified/ simplified forms must agree numerically at z = i (where the
  // wrong rewrite diverges, e.g. √(i²)=i but |i|=1).
  const complexTable: Array<[string, string]> = [
    ['\\sqrt{z^2}', 'sqrt(z^2)'],
    ['|z|^2', '|z|^2'],
    ['\\ln(z^2)', 'ln(z^2)'],
    ['|z^2|', '|z^2|'],
  ];

  for (const [src, expected] of complexTable) {
    test(`${src} with z:complex stays ${expected}`, () => {
      const ce = new ComputeEngine();
      ce.declare('z', 'complex');
      expect(ce.parse(src).simplify().toString()).toBe(expected);
      // Numeric identity at z = i.
      const orig = ce.parse(src);
      const simp = orig.simplify();
      expect(close(nv(orig.subs({ z: ce.I })), nv(simp.subs({ z: ce.I })))).toBe(
        true
      );
    });
  }

  test('√(w²) with w:imaginary stays √(w²)', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'imaginary');
    expect(ce.parse('\\sqrt{w^2}').simplify().toString()).toBe('sqrt(w^2)');
  });

  test('ln(z)+ln(w) does not combine for declared-complex z,w', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    ce.declare('w', 'complex');
    expect(ce.parse('\\ln(z)+\\ln(w)').simplify().isSame(ce.parse('\\ln(zw)'))).toBe(
      false
    );
  });
});

describe('generic-real convention still fires for unconstrained symbols', () => {
  const cases: Array<[string, string]> = [
    ['\\sqrt{x^2}', '|x|'],
    ['|x^2|', 'x^2'],
    ['|x|^2', 'x^2'],
    ['|x^3|', '|x|^3'], // odd: keeps Abs (sound for complex too)
    ['\\ln(x)+\\ln(y)', 'ln(x * y)'],
  ];
  for (const [src, expected] of cases) {
    test(`${src} → ${expected}`, () => {
      const ce = new ComputeEngine();
      expect(ce.parse(src).simplify().toString()).toBe(expected);
    });
  }
});

describe('branch-cut-safe behaviors that must not regress', () => {
  const unchanged: Array<[string, string]> = [
    ['(x^{1/2})^2', 'x'],
    ['e^{\\ln x}', 'x'],
    ['(x^3)^{1/2}', '|x| * sqrt(x)'],
    ['\\sqrt{x}\\sqrt{y}', 'sqrt(x) * sqrt(y)'],
    ['\\ln(x y)', 'ln(x * y)'],
    ['|\\sinh x|', 'sinh(|x|)'],
  ];
  for (const [src, expected] of unchanged) {
    test(`${src} → ${expected}`, () => {
      const ce = new ComputeEngine();
      expect(ce.parse(src).simplify().toString()).toBe(expected);
    });
  }

  test('√(x²) → -x under assume(x<0)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x<0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().toString()).toBe('-x');
  });

  test('∫cot³x keeps the ln(|sin x|) term', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int \\cot^3(x) dx').evaluate().toString()).toContain(
      'ln(|sin(x)|)'
    );
  });
});
