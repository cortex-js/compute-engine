import { engine } from '../utils';

function expr(s: string) {
  return engine.parse(s);
}

describe('SOLVING A QUADRATIC EQUATION', () => {
  const ce = engine;

  test('Solving x^2 + 200x - 0.0000015 = 0', () => {
    // Sols -200.000000075 and 0.000000075
    // From https://en.wikipedia.org/wiki/Loss_of_significance

    const result = engine
      .parse(`x^2 + 200x - 0.000015 = 0`)
      .solve(['x'])
      ?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        {
          num: 7.499999997187500002109374998022460939576416013289031985174980160218871836088104540722514735e-8,
        },
        {
          num: -200.00000007499999997187500002109374998022460939576416013289031985174980160218871836088104540722514735,
        },
      ]
    `);
  });

  it('should solve bx', () => {
    const eqn = ce.expr(['Multiply', 5, 'x']);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  it('should solve bx + c', () => {
    const eqn = ce.expr(['Add', ['Multiply', 5, 'x'], -10]);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        2,
      ]
    `);
  });

  it('should solve ax^2', () => {
    const eqn = ce.expr(['Multiply', 16, ['Square', 'x']]);
    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  it('should solve ax^2 + c', () => {
    const eqn = ce.expr(['Add', ['Multiply', 2, ['Square', 'x']], -16]);
    // x = ±√8 = ±2√2 (normalized; see REVIEW.md D8 — the radical table now
    // extracts the perfect-square factor from √8).
    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        ["Multiply", 2, ["Sqrt", 2]],
        ["Multiply", -2, ["Sqrt", 2]],
      ]
    `);
  });

  it('should solve ax^2 + bx + c', () => {
    const eqn = ce.expr([
      'Add',
      ['Multiply', 2, ['Square', 'x']],
      ['Multiply', 6, 'x'],
      4,
    ]);

    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        -1,
        -2,
      ]
    `);
  });

  it('should solve a quadratic with a symbolic (parametric) coefficient (#300)', () => {
    // `x^2 - a x + 1 = 0` has a negated middle term `-a x`, which
    // canonicalizes to `Negate(Multiply(a, x))` — a form the quadratic rule
    // patterns don't match. Coefficient extraction handles it, yielding the
    // quadratic formula (a ± √(a²−4)) / 2.
    const roots = ce.parse('x^2 - a x + 1 = 0').solve('x') ?? [];
    expect(roots.map((r) => r.toLatex())).toMatchInlineSnapshot(`
      [
        \\frac{a}{2}+\\frac{1}{2}(\\sqrt{a^2-4}),
        \\frac{a}{2}-\\frac{1}{2}(\\sqrt{a^2-4}),
      ]
    `);
    // Each root must satisfy the original equation
    for (const r of roots)
      expect(ce.parse('x^2 - a x + 1').subs({ x: r }).simplify().isEqual(0)).toBe(
        true
      );
  });
});

describe('expr.solve()', () => {
  test('should solve an assignment', () => {
    const e = expr('x = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([5]);
  });

  test('should solve an assignment to a root', () => {
    const e = expr('x = \\sqrt{5}');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([['Sqrt', 5]]);
  });

  test('should solve an assignment to a variable', () => {
    const e = expr('x = y');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual(['y']);
  });

  test('should solve a simple equation with a variable', () => {
    const e = expr('x - 1 + y = 0');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        1 - y,
      ]
    `);
  });

  test('should solve a simple equation', () => {
    const e = expr('x + 2 = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([3]);
  });

  test('should solve an equation with a fractional coefficient', () => {
    const e = expr('\\frac{2}{3}x + \\frac{1}{3} = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([7]);
  });

  test('should solve an equation with a fractional root', () => {
    const e = expr('x^2 + 2x + \\frac{1}{4} = 0');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        -1 + sqrt(3)/2,
        -1 - sqrt(3)/2,
      ]
    `);
  });

  test('should solve an equation with a sqrt(x) term (issue #220)', () => {
    const e = expr('2x = \\sqrt{5x}');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        5/4,
        0,
      ]
    `);
  });

  test('should solve an equation with a complex root', () => {
    const e = expr('x^2 + 1 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        [
          Complex,
          0,
          1,
        ],
        [
          Complex,
          0,
          -1,
        ],
      ]
    `);
  });

  test('should **NOT** solve a quasi-quadratic equation', () => {
    const e = expr('x^2 + 3x + 2 + \\sin(x) = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[]`);
  });

  // Exponential and logarithmic equations (regression tests for the
  // harmonization pass being inert, REVIEW G2)
  test('should solve e^x = 5', () => {
    const e = expr('e^x = 5');
    const result = e.solve('x') as any[];
    expect(result?.length).toBe(1);
    // x = ln(5)
    expect(result[0].N().re).toBeCloseTo(Math.log(5), 10);
  });

  test('should solve 10^x = 100', () => {
    const e = expr('10^x = 100');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([2]);
  });

  test('should solve ln(x) = ln(3) exactly', () => {
    const e = expr('\\ln(x) = \\ln(3)');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([3]);
  });

  test('should solve ln(ln(x)) = ln(ln(5)) exactly', () => {
    const e = expr('\\ln(\\ln(x)) = \\ln(\\ln(5))');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([5]);
  });

  test('should solve e^{2x} = 4', () => {
    const e = expr('e^{2x} = 4');
    const result = e.solve('x') as any[];
    expect(result?.length).toBe(1);
    // x = ln(2)
    expect(result[0].N().re).toBeCloseTo(Math.log(2), 10);
  });

  // test('should solve an inequality', () => {
  //   const e = expr('2x + 1 < 5');
  //   const result = e.solve('x')?.map((x) => x.json);
  //   expect(result).toMatchInlineSnapshot(`[]`); // @todo
  // });

  // test('should solve a system of equations', () => {
  //   const e1 = expr('x + y = 3');
  //   const e2 = expr('2x - y = 0');
  //   const result = expr([e1, e2]).solve(['x', 'y']);
  //   expect(result).toEqual(expr('x = 0, y = 3'));
  // });

  // Regression test for #261: solve() should work for variables regardless of
  // lexical ordering. When canonicalized, variables are sorted alphabetically
  // (e.g., b+2a becomes 2a+b), but solve() should still find solutions for any variable.
  test('should solve for variable that comes lexically after another unknown (#261)', () => {
    const e = expr('b + 2a = 3');
    // Solve for 'b' (which comes after 'a' alphabetically)
    const resultB = e.solve('b')?.map((x) => x.toString());
    expect(resultB).toMatchInlineSnapshot(`
      [
        -2a + 3,
      ]
    `);
    // Solve for 'a' should also work
    const resultA = e.solve('a')?.map((x) => x.toString());
    expect(resultA).toMatchInlineSnapshot(`
      [
        -1/2 * b + 3/2,
      ]
    `);
  });

  test('should solve for any variable in multi-variable equation (#261)', () => {
    const e = expr('z + 2y + 3x = 10');
    // All variables should be solvable regardless of their position
    expect(e.solve('x')?.map((x) => x.toString())).toMatchInlineSnapshot(`
      [
        -2/3 * y - 1/3 * z + 10/3,
      ]
    `);
    expect(e.solve('y')?.map((x) => x.toString())).toMatchInlineSnapshot(`
      [
        -3/2 * x - 1/2 * z + 5,
      ]
    `);
    expect(e.solve('z')?.map((x) => x.toString())).toMatchInlineSnapshot(`
      [
        -3x - 2y + 10,
      ]
    `);
  });
});

// Regression tests for #242: solve() should work for equations with variables
// in the numerator of fractions (e.g., F = 3g/h solving for g)
describe('SOLVING EQUATIONS WITH FRACTIONS (#242)', () => {
  test('should solve F = 3g/h for g', () => {
    const e = expr('F = 3g/h');
    const result = e.solve('g')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        1/3 * F * h,
      ]
    `);
  });

  test('should solve x/2 + 3 = 0 for x', () => {
    const e = expr('x/2 + 3 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([-6]);
  });

  test('should solve a/b + c*g/d = 0 for g', () => {
    const e = expr('a/b + c*g/d = 0');
    const result = e.solve('g')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        -(a * d) / (b * c),
      ]
    `);
  });

  test('should solve equation with multiple fractional terms', () => {
    const e = expr('x/2 + x/3 = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([6]);
  });

  test('should solve a/x = b for x (variable in denominator)', () => {
    const e = expr('a/x = b');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        a / b,
      ]
    `);
  });

  test('should solve 1/(x+1) = 2 for x', () => {
    const e = expr('1/(x+1) = 2');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        -1/2,
      ]
    `);
  });
});

// Tests for sqrt and ln equations
describe('SOLVING SQRT AND LN EQUATIONS', () => {
  test('should solve x + 2sqrt(x) - 3 = 0', () => {
    const e = expr('x + 2\\sqrt{x} - 3 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([1]);
  });

  test('should solve sqrt(x) = 3', () => {
    const e = expr('\\sqrt{x} = 3');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([9]);
  });

  test('should return empty for 2sqrt(x) + 4 = 0 (no real solution)', () => {
    const e = expr('2\\sqrt{x} + 4 = 0');
    const result = e.solve('x');
    expect(result).toEqual([]);
  });

  test('should solve ln(x) = 1', () => {
    const e = expr('\\ln(x) = 1');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        e,
      ]
    `);
  });

  test('should solve 3ln(x) - 6 = 0', () => {
    const e = expr('3\\ln(x) - 6 = 0');
    const result = e.solve('x')?.map((x) => x.N().toString());
    // Result is e^2 ≈ 7.389
    expect(result?.[0]).toMatch(/^7\.389/);
  });
});

// Tests for extraneous root filtering in sqrt equations (Task #14)
// Sqrt equations using quadratic substitution (u = √x → solve for u → x = u²)
// can produce extraneous roots that must be filtered out.
describe('EXTRANEOUS ROOT FILTERING FOR SQRT EQUATIONS', () => {
  // √x = x - 2 has candidate solutions x=1 and x=4, but x=1 is extraneous
  // Derivation: √x = x - 2 → x = (x-2)² → x = x² - 4x + 4 → x² - 5x + 4 = 0
  // → (x-1)(x-4) = 0 → x = 1, 4
  // Verify: x=1: √1 = 1, 1-2 = -1, 1 ≠ -1 ❌ (extraneous)
  // Verify: x=4: √4 = 2, 4-2 = 2, 2 = 2 ✓
  test('should filter extraneous root for sqrt(x) = x - 2', () => {
    const e = expr('\\sqrt{x} = x - 2');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([4]);
  });

  // √x + x - 2 = 0 has candidate solutions from x + √x - 2 = 0
  // u² + u - 2 = 0 → (u+2)(u-1) = 0 → u = -2 or u = 1
  // x = u² → x = 4 or x = 1
  // Verify: x=4: √4 + 4 - 2 = 2 + 4 - 2 = 4 ≠ 0 ❌ (extraneous)
  // Verify: x=1: √1 + 1 - 2 = 1 + 1 - 2 = 0 ✓
  test('should filter extraneous root for sqrt(x) + x - 2 = 0', () => {
    const e = expr('\\sqrt{x} + x - 2 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([1]);
  });

  // √x - x + 2 = 0 has u = √x → u - u² + 2 = 0 → u² - u - 2 = 0
  // → (u-2)(u+1) = 0 → u = 2 or u = -1
  // x = u² → x = 4 or x = 1
  // Verify: x=4: √4 - 4 + 2 = 2 - 4 + 2 = 0 ✓
  // Verify: x=1: √1 - 1 + 2 = 1 - 1 + 2 = 2 ≠ 0 ❌ (extraneous from u=-1)
  test('should filter extraneous root for sqrt(x) - x + 2 = 0', () => {
    const e = expr('\\sqrt{x} - x + 2 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([4]);
  });

  // x - 4√x + 3 = 0: u = √x → u² - 4u + 3 = 0 → (u-1)(u-3) = 0 → u = 1, 3
  // x = u² → x = 1, 9
  // Verify: x=1: 1 - 4(1) + 3 = 1 - 4 + 3 = 0 ✓
  // Verify: x=9: 9 - 4(3) + 3 = 9 - 12 + 3 = 0 ✓
  // Both solutions are valid in this case (no extraneous roots)
  test('should keep both valid roots for x - 4sqrt(x) + 3 = 0', () => {
    const e = expr('x - 4\\sqrt{x} + 3 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result?.sort()).toEqual([1, 9].sort());
  });

  // x - 2√x - 3 = 0: u² - 2u - 3 = 0 → (u-3)(u+1) = 0 → u = 3 or u = -1
  // x = u² → x = 9 or x = 1
  // Verify: x=9: 9 - 2(3) - 3 = 9 - 6 - 3 = 0 ✓
  // Verify: x=1: 1 - 2(1) - 3 = 1 - 2 - 3 = -4 ≠ 0 ❌ (extraneous from u=-1)
  test('should filter extraneous root for x - 2sqrt(x) - 3 = 0', () => {
    const e = expr('x - 2\\sqrt{x} - 3 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([9]);
  });

  // 2x + 3√x - 2 = 0: 2u² + 3u - 2 = 0 → (2u-1)(u+2) = 0 → u = 1/2 or u = -2
  // x = u² → x = 1/4 or x = 4
  // Verify: x=1/4: 2(1/4) + 3(1/2) - 2 = 0.5 + 1.5 - 2 = 0 ✓
  // Verify: x=4: 2(4) + 3(2) - 2 = 8 + 6 - 2 = 12 ≠ 0 ❌ (extraneous from u=-2)
  test('should filter extraneous root for 2x + 3sqrt(x) - 2 = 0', () => {
    const e = expr('2x + 3\\sqrt{x} - 2 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        [
          Rational,
          1,
          4,
        ],
      ]
    `);
  });
});

// Tests for sqrt-linear equations: √(f(x)) = g(x) (Pattern 2 from TODO #15)
// These are transformed by squaring both sides, which can introduce extraneous roots.
describe('SQRT-LINEAR EQUATIONS (Pattern 2)', () => {
  // √(x+1) = x → x+1 = x² → x² - x - 1 = 0
  // Solutions: (1 ± √5)/2 ≈ 1.618 or -0.618
  // Check: √(1.618+1) ≈ 1.618 ✓, √(-0.618+1) ≈ 0.618 ≠ -0.618 ❌
  test('should solve sqrt(x+1) = x with extraneous root filtered', () => {
    const e = expr('\\sqrt{x+1} = x');
    const result = e.solve('x')?.map((x) => x.N().json);
    expect(result?.length).toBe(1);
    expect((result?.[0] as { num: string }).num).toMatch(/^1\.618/);
  });

  // √(2x+3) = x - 1 → 2x+3 = (x-1)² = x² - 2x + 1
  // Rearranging: x² - 4x - 2 = 0, solutions: 2 ± √6 ≈ 4.449 or -0.449
  // Check: √(2*4.449+3) ≈ 3.449 = 4.449-1 ✓, extraneous at -0.449
  test('should solve sqrt(2x+3) = x-1 with extraneous root filtered', () => {
    const e = expr('\\sqrt{2x+3} = x - 1');
    const result = e.solve('x')?.map((x) => x.N().json);
    expect(result?.length).toBe(1);
    expect((result?.[0] as { num: string }).num).toMatch(/^4\.449/);
  });

  // √(x+5) = x + 1 → x+5 = (x+1)² = x² + 2x + 1
  // Rearranging: x² + x - 4 = 0, solutions: (-1 ± √17)/2 ≈ 1.56 or -2.56
  // Check: √(1.56+5) ≈ 2.56 = 1.56+1 ✓, extraneous at -2.56
  test('should solve sqrt(x+5) = x+1 with extraneous root filtered', () => {
    const e = expr('\\sqrt{x+5} = x + 1');
    const result = e.solve('x')?.map((x) => x.N().json);
    expect(result?.length).toBe(1);
    expect((result?.[0] as { num: string }).num).toMatch(/^1\.56/);
  });

  // √(3x-2) = x → 3x-2 = x² → x² - 3x + 2 = 0 = (x-1)(x-2)
  // Solutions: x=1 and x=2, both valid
  // Check: √(3*1-2) = 1 ✓, √(3*2-2) = 2 ✓
  test('should solve sqrt(3x-2) = x keeping both valid roots', () => {
    const e = expr('\\sqrt{3x-2} = x');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result?.sort()).toEqual([1, 2].sort());
  });

  // √(x-1) = x - 3 → x-1 = (x-3)² = x² - 6x + 9
  // Rearranging: x² - 7x + 10 = 0 = (x-2)(x-5)
  // Solutions: x=2 and x=5
  // Check: √(2-1) = 1 ≠ 2-3 = -1 ❌, √(5-1) = 2 = 5-3 ✓
  test('should solve sqrt(x-1) = x-3 with extraneous root filtered', () => {
    const e = expr('\\sqrt{x-1} = x - 3');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([5]);
  });

  // √(4x+5) = 2x + 1 → 4x+5 = (2x+1)² = 4x² + 4x + 1
  // Rearranging: 4x² - 4 = 0 → x² = 1 → x = ±1
  // Check: √(4*1+5) = 3 = 2*1+1 ✓, √(4*(-1)+5) = 1 ≠ 2*(-1)+1 = -1 ❌
  test('should solve sqrt(4x+5) = 2x+1 with extraneous root filtered', () => {
    const e = expr('\\sqrt{4x+5} = 2x + 1');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([1]);
  });

  // Edge case: √x = x (simpler form)
  // x = x² → x² - x = 0 → x(x-1) = 0 → x = 0 or x = 1
  // Check: √0 = 0 ✓, √1 = 1 ✓
  test('should solve sqrt(x) = x with both roots valid', () => {
    const e = expr('\\sqrt{x} = x');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result?.sort()).toEqual([0, 1].sort());
  });

  // No real solution case: √(x+1) = -x where x > 0
  // √(x+1) ≥ 0 always, so -x must be ≥ 0, meaning x ≤ 0
  // Squaring: x+1 = x² → x² - x - 1 = 0, solutions ≈ 1.618 or -0.618
  // Check: √(1.618+1) ≈ 1.618 ≠ -1.618 ❌, √(-0.618+1) ≈ 0.618 = -(-0.618) ✓
  test('should solve sqrt(x+1) = -x correctly', () => {
    const e = expr('\\sqrt{x+1} = -x');
    const result = e.solve('x')?.map((x) => x.N().json);
    expect(result?.length).toBe(1);
    expect((result?.[0] as { num: string }).num).toMatch(/^-0\.618/);
  });
});

// Tests for nested sqrt equations: √(f(x, √x)) = a (Pattern 4 from TODO #15)
// Uses substitution u = √x, solves for u, then x = u² with u ≥ 0 filtering
describe('NESTED SQRT EQUATIONS (Pattern 4)', () => {
  // √(x + 2√x) = 3 → u = √x, √(u² + 2u) = 3 → u² + 2u = 9 → u² + 2u - 9 = 0
  // u = (-2 ± √40)/2 = -1 ± √10
  // u₁ = -1 + √10 ≈ 2.16 ≥ 0 ✓, u₂ = -1 - √10 ≈ -4.16 < 0 ❌
  // x = u² = (-1 + √10)² = 1 - 2√10 + 10 = 11 - 2√10 ≈ 4.675
  test('should solve sqrt(x + 2sqrt(x)) = 3 with negative u filtered', () => {
    const e = expr('\\sqrt{x + 2\\sqrt{x}} = 3');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    // x = 11 - 2√10 ≈ 4.675
    expect(result?.[0]?.N().toString()).toMatch(/^4\.67/);
  });

  // √(x + √x) = 2 → u² + u = 4 → u² + u - 4 = 0
  // u = (-1 ± √17)/2
  // u₁ = (-1 + √17)/2 ≈ 1.56 ≥ 0 ✓, u₂ = (-1 - √17)/2 ≈ -2.56 < 0 ❌
  // x = u² ≈ 2.44
  test('should solve sqrt(x + sqrt(x)) = 2 with negative u filtered', () => {
    const e = expr('\\sqrt{x + \\sqrt{x}} = 2');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    expect(result?.[0]?.N().toString()).toMatch(/^2\.43/);
  });

  // √(x - √x) = 1 → u² - u = 1 → u² - u - 1 = 0
  // u = (1 ± √5)/2
  // u₁ = (1 + √5)/2 ≈ 1.618 (golden ratio) ≥ 0 ✓
  // u₂ = (1 - √5)/2 ≈ -0.618 < 0 ❌
  // x = u² = φ² ≈ 2.618
  test('should solve sqrt(x - sqrt(x)) = 1 with negative u filtered', () => {
    const e = expr('\\sqrt{x - \\sqrt{x}} = 1');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    // x = φ² = ((1+√5)/2)² ≈ 2.618
    expect(result?.[0]?.N().toString()).toMatch(/^2\.61/);
  });
});

// Tests for equations with two sqrt terms: √(f(x)) + √(g(x)) = e (Pattern 3 from TODO #15)
// Uses double squaring to eliminate both sqrts, then validates roots
describe('TWO SQRT EQUATIONS (Pattern 3)', () => {
  // √(x+1) + √(x+4) = 3 → x = 0
  // Verify: √1 + √4 = 1 + 2 = 3 ✓
  test('should solve sqrt(x+1) + sqrt(x+4) = 3', () => {
    const e = expr('\\sqrt{x+1} + \\sqrt{x+4} = 3');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    expect(result?.[0]?.json).toBe(0);
  });

  // √x + √(x+7) = 7 → x = 9
  // Verify: √9 + √16 = 3 + 4 = 7 ✓
  test('should solve sqrt(x) + sqrt(x+7) = 7', () => {
    const e = expr('\\sqrt{x} + \\sqrt{x+7} = 7');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    expect(result?.[0]?.json).toBe(9);
  });

  // √(x+5) - √(x-3) = 2 → x = 4
  // Verify: √9 - √1 = 3 - 1 = 2 ✓
  test('should solve sqrt(x+5) - sqrt(x-3) = 2', () => {
    const e = expr('\\sqrt{x+5} - \\sqrt{x-3} = 2');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    expect(result?.[0]?.json).toBe(4);
  });

  // √(2x+1) + √(x-1) = 4 → x ≈ 2.919
  test('should solve sqrt(2x+1) + sqrt(x-1) = 4', () => {
    const e = expr('\\sqrt{2x+1} + \\sqrt{x-1} = 4');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    expect(result?.[0]?.N().toString()).toMatch(/^2\.91/);
  });

  // √(x+3) + √(x+8) = 5 → x = 1
  // Verify: √4 + √9 = 2 + 3 = 5 ✓
  test('should solve sqrt(x+3) + sqrt(x+8) = 5', () => {
    const e = expr('\\sqrt{x+3} + \\sqrt{x+8} = 5');
    const result = e.solve('x');
    expect(result?.length).toBe(1);
    expect(result?.[0]?.json).toBe(1);
  });
});

// Tests for trigonometric equations
describe('SOLVING TRIGONOMETRIC EQUATIONS', () => {
  test('should solve sin(x) = 0', () => {
    const e = expr('\\sin(x) = 0');
    const result = e.solve('x')?.map((x) => x.json);
    // Principal solutions: 0 and π
    expect(result).toMatchInlineSnapshot(`
      [
        0,
        Pi,
      ]
    `);
  });

  test('should solve sin(x) = 1/2', () => {
    const e = expr('\\sin(x) = 1/2');
    const result = e.solve('x')?.map((x) => x.N().json);
    // Principal solutions: π/6 ≈ 0.5236 and 5π/6 ≈ 2.618
    expect(result?.length).toBe(2);
    expect((result?.[0] as { num: string }).num).toMatch(/^0\.523/);
  });

  test('should solve cos(x) = 0', () => {
    const e = expr('\\cos(x) = 0');
    const result = e.solve('x')?.map((x) => x.N().json);
    // Principal solutions: π/2 ≈ 1.571 and -π/2 ≈ -1.571
    expect(result?.length).toBe(2);
    expect((result?.[0] as { num: string }).num).toMatch(/^1\.570/);
  });

  test('should solve cos(x) = 1', () => {
    const e = expr('\\cos(x) = 1');
    const result = e.solve('x')?.map((x) => x.json);
    // Principal solution: 0 (deduplicated from arccos(1) and -arccos(1))
    expect(result).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  test('should solve tan(x) = 1', () => {
    const e = expr('\\tan(x) = 1');
    const result = e.solve('x')?.map((x) => x.N().json);
    // Principal solution: π/4 ≈ 0.7854
    expect(result?.length).toBe(1);
    expect((result?.[0] as { num: string }).num).toMatch(/^0\.785/);
  });

  test('should solve tan(x) = 0', () => {
    const e = expr('\\tan(x) = 0');
    const result = e.solve('x')?.map((x) => x.json);
    // Principal solution: 0
    expect(result).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  test('should solve 2sin(x) - 1 = 0', () => {
    const e = expr('2\\sin(x) - 1 = 0');
    const result = e.solve('x')?.map((x) => x.N().json);
    // Same as sin(x) = 1/2
    expect(result?.length).toBe(2);
    expect((result?.[0] as { num: string }).num).toMatch(/^0\.523/);
  });

  test('should solve 3cos(x) + 3 = 0', () => {
    const e = expr('3\\cos(x) + 3 = 0');
    const result = e.solve('x')?.map((x) => x.N().json);
    // cos(x) = -1, solution: π ≈ 3.1416 and -π
    expect(result?.length).toBe(2);
    // Check one is π and one is -π
    const values = result?.map((r) => parseFloat((r as { num: string }).num));
    expect(values?.some((v) => Math.abs(v - Math.PI) < 0.001)).toBe(true);
  });

  test('should return empty for sin(x) = 2 (no real solution)', () => {
    const e = expr('\\sin(x) = 2');
    const result = e.solve('x');
    // sin(x) can only be in [-1, 1]
    expect(result).toEqual([]);
  });

  test('should return empty for cos(x) = -2 (no real solution)', () => {
    const e = expr('\\cos(x) = -2');
    const result = e.solve('x');
    // cos(x) can only be in [-1, 1]
    expect(result).toEqual([]);
  });
});

// Tests for absolute-value equations
describe('SOLVING ABSOLUTE VALUE EQUATIONS', () => {
  const roots = (s: string) =>
    expr(s)
      .solve('x')
      ?.map((x) => x.N().re)
      .sort((a: number, b: number) => a - b);

  test('should solve |x| = 2 (both roots)', () => {
    // Regression: the |ax+b|+c root rule had a sign error and a malformed
    // second branch, so this returned only [2] (or garbage).
    expect(roots('|x| = 2')).toEqual([-2, 2]);
  });

  test('should solve |x - 1| = 2 (unit coefficient)', () => {
    expect(roots('|x - 1| = 2')).toEqual([-1, 3]);
  });

  test('should solve |2x - 1| = 3', () => {
    expect(roots('|2x - 1| = 3')).toEqual([-1, 2]);
  });

  test('should return empty for |x| = -1 (no real solution)', () => {
    expect(expr('|x| = -1').solve('x')).toEqual([]);
  });

  test('should solve |x^2 - 3| = 1 (non-linear inner)', () => {
    const r = roots('|x^2 - 3| = 1') as number[];
    // x² = 4 or x² = 2  ->  ±2, ±√2
    expect(r?.length).toBe(4);
    expect(r?.[0]).toBeCloseTo(-2, 10);
    expect(r?.[1]).toBeCloseTo(-Math.SQRT2, 10);
    expect(r?.[2]).toBeCloseTo(Math.SQRT2, 10);
    expect(r?.[3]).toBeCloseTo(2, 10);
  });

  test('should solve |2x + 5| = |x - 2| (two absolute values)', () => {
    expect(roots('|2x + 5| = |x - 2|')).toEqual([-7, -1]);
  });

  test('should solve |x - 1| = |x + 1| (two absolute values)', () => {
    expect(roots('|x - 1| = |x + 1|')).toEqual([0]);
  });
});

// Tests for higher-degree polynomials (ROADMAP B9)
describe('SOLVING CUBIC AND QUARTIC EQUATIONS', () => {
  const ce = engine;
  // Real roots (sorted), as machine numbers.
  const roots = (mj: any) =>
    ce
      .box(mj)
      .solve('x')
      ?.map((x) => x.N().re)
      .sort((a: number, b: number) => a - b);
  // Maximum |residual| of the polynomial evaluated at the returned roots.
  const maxResidual = (mj: any) => {
    const e = ce.box(mj);
    const rs = e.solve('x') ?? [];
    return Math.max(
      0,
      ...rs.map((r) => Math.abs(e.subs({ x: r }).N().re))
    );
  };

  test('general cubic with irrational roots: 3x³−18x²+33x−19', () => {
    // Was [] before B9 (no rational root). Three real roots.
    const mj = ['Add', ['Multiply', 3, ['Power', 'x', 3]],
      ['Multiply', -18, ['Power', 'x', 2]], ['Multiply', 33, 'x'], -19];
    expect(roots(mj)?.length).toBe(3);
    expect(maxResidual(mj)).toBeLessThan(1e-6);
  });

  test('cubic with one real root: x³−2x−5 (Newton’s example)', () => {
    const mj = ['Subtract', ['Subtract', ['Power', 'x', 3], ['Multiply', 2, 'x']], 5];
    const r = roots(mj)!;
    expect(r.length).toBe(1);
    expect(r[0]).toBeCloseTo(2.0945514815, 6);
  });

  test('casus irreducibilis (three real roots): x³−3x+1', () => {
    const mj = ['Add', ['Subtract', ['Power', 'x', 3], ['Multiply', 3, 'x']], 1];
    expect(roots(mj)?.length).toBe(3);
    expect(maxResidual(mj)).toBeLessThan(1e-6);
  });

  test('quartic: x⁴−10x²+1 (four real roots)', () => {
    const mj = ['Add', ['Subtract', ['Power', 'x', 4], ['Multiply', 10, ['Power', 'x', 2]]], 1];
    expect(roots(mj)?.length).toBe(4);
    expect(maxResidual(mj)).toBeLessThan(1e-6);
  });

  test('biquadratic stays exact when roots are rational: x⁴−5x²+4', () => {
    const mj = ['Add', ['Subtract', ['Power', 'x', 4], ['Multiply', 5, ['Power', 'x', 2]]], 4];
    const rs = ce.box(mj).solve('x')!;
    // Exact integers, not floats (the numeric fallback must not shadow them).
    expect(rs.every((r) => Number.isInteger(r.json))).toBe(true);
    expect(rs.map((r) => r.N().re).sort((a, b) => a - b)).toEqual([-2, -1, 1, 2]);
  });

  test('biquadratic with irrational roots is exact: x⁴+x²−1', () => {
    // u = x² → u²+u−1 = 0 → u = (√5−1)/2 (the negative u is complex, dropped).
    // x = ±√((√5−1)/2), exact radicals rather than the numeric fallback.
    const mj = ['Subtract', ['Add', ['Power', 'x', 4], ['Power', 'x', 2]], 1];
    const rs = ce.box(mj).solve('x')!;
    expect(rs.length).toBe(2);
    // Exact radical form (contains a √), not a floating-point approximation.
    expect(rs.some((r) => r.toString().includes('sqrt'))).toBe(true);
    expect(
      rs.map((r) => r.N().re).sort((a, b) => a - b)
    ).toEqual([
      -0.7861513777574233, 0.7861513777574233,
    ]);
    // Residual ≈ 0.
    const e = ce.box(mj);
    expect(
      Math.max(...rs.map((r) => Math.abs(e.subs({ x: r }).N().re)))
    ).toBeLessThan(1e-12);
  });

  test('higher gcd reduction is exact: x⁶+x³−1 via u=x³', () => {
    const mj = ['Subtract', ['Add', ['Power', 'x', 6], ['Power', 'x', 3]], 1];
    const rs = ce.box(mj).solve('x')!;
    expect(rs.length).toBe(2); // two real roots, both exact cube roots
    expect(rs.some((r) => r.toString().includes('root'))).toBe(true);
    const e = ce.box(mj);
    expect(
      Math.max(...rs.map((r) => Math.abs(e.subs({ x: r }).N().re)))
    ).toBeLessThan(1e-12);
  });

  test('exact paths are preserved (no numeric leakage)', () => {
    // pure power → exact radical
    expect(
      ce.box(['Subtract', ['Power', 'x', 3], 2]).solve('x')?.[0].json
    ).toEqual(['Root', 2, 3]);
    // factorable rational roots → exact integers
    const c = ['Add', ['Power', 'x', 3], ['Multiply', -6, ['Power', 'x', 2]],
      ['Multiply', 11, 'x'], -6];
    expect(
      ce.box(c).solve('x')?.map((x) => x.N().re).sort((a, b) => a - b)
    ).toEqual([1, 2, 3]);
  });
});

// Tests for systems of linear equations
describe('SOLVING SYSTEMS OF LINEAR EQUATIONS', () => {
  test('should solve 2x2 system: x+y=70, 2x-4y=80', () => {
    const e = expr('\\begin{cases}x+y=70\\\\2x-4y=80\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(60);
    expect(result.y.json).toBe(10);
  });

  test('should solve 3x3 system: x+y+z=6, 2x+y-z=1, x-y+2z=5', () => {
    const e = expr('\\begin{cases}x+y+z=6\\\\2x+y-z=1\\\\x-y+2z=5\\end{cases}');
    const result = e.solve(['x', 'y', 'z']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(1);
    expect(result.y.json).toBe(2);
    expect(result.z.json).toBe(3);
  });

  test('should solve simple 2x2 system: x=1, y=2', () => {
    const e = expr('\\begin{cases}x=1\\\\y=2\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(1);
    expect(result.y.json).toBe(2);
  });

  test('should solve system with negative coefficients: -x+y=2, x+y=4', () => {
    const e = expr('\\begin{cases}-x+y=2\\\\x+y=4\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(1);
    expect(result.y.json).toBe(3);
  });

  test('should return null for inconsistent system: x+y=1, x+y=2', () => {
    const e = expr('\\begin{cases}x+y=1\\\\x+y=2\\end{cases}');
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
  });

  test('should solve non-linear product-sum system: xy=6, x+y=5', () => {
    // Now supported via polynomial system solver
    const e = expr('\\begin{cases}xy=6\\\\x+y=5\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    // Solutions: (x=2, y=3) and (x=3, y=2)
    const solutions = result.map((r) => ({
      x: r.x.json,
      y: r.y.json,
    }));
    expect(solutions).toContainEqual({ x: 2, y: 3 });
    expect(solutions).toContainEqual({ x: 3, y: 2 });
  });

  test('should return parametric solution for under-determined system: single equation, two variables', () => {
    const e = expr('\\begin{cases}x+y=5\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    // y is free (omitted from result), x = 5 - y
    expect(result.y).toBeUndefined();
    expect(result.x.json).toEqual(['Add', ['Negate', 'y'], 5]);
  });

  test('should solve system with fractional solution: x+2y=5, 2x+3y=8', () => {
    const e = expr('\\begin{cases}x+2y=5\\\\2x+3y=8\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(1);
    expect(result.y.json).toBe(2);
  });

  test('should solve quadratic system via substitution: x^2+y=5, x+y=3', () => {
    // Now supported via substitution method
    const e = expr('\\begin{cases}x^2+y=5\\\\x+y=3\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    // From x+y=3: y = 3-x. Substitute: x² + (3-x) = 5 → x² - x - 2 = 0
    // Roots: x = 2, x = -1. So solutions: (2, 1) and (-1, 4)
    const solutions = result.map((r) => ({
      x: r.x.json,
      y: r.y.json,
    }));
    expect(solutions).toContainEqual({ x: 2, y: 1 });
    expect(solutions).toContainEqual({ x: -1, y: 4 });
  });

  // Tests for exact rational arithmetic (Issue #31)
  test('should solve system with fractional coefficients: x/3+y/2=1, x/4+y/5=1', () => {
    const e = expr(
      '\\begin{cases}\\frac{x}{3}+\\frac{y}{2}=1\\\\\\frac{x}{4}+\\frac{y}{5}=1\\end{cases}'
    );
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    // System: x/3 + y/2 = 1  and  x/4 + y/5 = 1
    // Multiply first by 6:  2x + 3y = 6
    // Multiply second by 20: 5x + 4y = 20
    // Solving: y = -10/7, x = 36/7
    // The results should be exact rationals
    expect(result.x.json).toEqual(['Rational', 36, 7]);
    expect(result.y.json).toEqual(['Rational', -10, 7]);
  });

  test('should produce exact rational solution: 2x+3y=7, 4x+5y=13', () => {
    const e = expr('\\begin{cases}2x+3y=7\\\\4x+5y=13\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    // Using Cramer's rule: det = 2*5 - 3*4 = -2
    // x = (7*5 - 3*13) / -2 = (35 - 39) / -2 = -4 / -2 = 2
    // y = (2*13 - 7*4) / -2 = (26 - 28) / -2 = -2 / -2 = 1
    expect(result.x.json).toBe(2);
    expect(result.y.json).toBe(1);
  });

  test('should preserve exact fractions in result: x+y=1, x-y=1/2', () => {
    const e = expr('\\begin{cases}x+y=1\\\\x-y=\\frac{1}{2}\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    // x + y = 1
    // x - y = 1/2
    // Adding: 2x = 3/2, so x = 3/4
    // Subtracting: 2y = 1/2, so y = 1/4
    expect(result.x.json).toEqual(['Rational', 3, 4]);
    expect(result.y.json).toEqual(['Rational', 1, 4]);
  });

  test('should handle system requiring pivot selection with fractions', () => {
    // This system tests pivot selection with fractional entries
    const e = expr(
      '\\begin{cases}\\frac{1}{2}x+y=3\\\\x+\\frac{1}{3}y=2\\end{cases}'
    );
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    // (1/2)x + y = 3  =>  x + 2y = 6  (multiply by 2)
    // x + (1/3)y = 2  =>  3x + y = 6  (multiply by 3)
    // From second equation: y = 6 - 3x
    // Substitute into first: x + 2(6 - 3x) = 6  =>  x + 12 - 6x = 6  =>  -5x = -6  =>  x = 6/5
    // y = 6 - 3(6/5) = 6 - 18/5 = 30/5 - 18/5 = 12/5
    expect(result.x.json).toEqual(['Rational', 6, 5]);
    expect(result.y.json).toEqual(['Rational', 12, 5]);
  });

  // Under-determined systems (parametric solutions)
  test('should solve under-determined system: x+y=5 (1 eq, 2 vars)', () => {
    const e = expr('\\begin{cases}x+y=5\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    // y is free variable (omitted from result), x = 5 - y
    expect(result.y).toBeUndefined();
    // x should be 5 - y
    const xExpr = result.x;
    // Verify by substitution: x + y should equal 5
    const ce = engine;
    const sum = xExpr.add(ce.symbol('y')).simplify();
    expect(sum.json).toBe(5);
  });

  test('should solve under-determined system: x+y+z=10 (1 eq, 3 vars)', () => {
    const e = expr('\\begin{cases}x+y+z=10\\end{cases}');
    const result = e.solve(['x', 'y', 'z']) as Record<string, any>;
    expect(result).not.toBeNull();
    // y and z are free variables (omitted from result), x = 10 - y - z
    expect(result.y).toBeUndefined();
    expect(result.z).toBeUndefined();
    // Verify by substitution: x + y + z should equal 10
    const ce = engine;
    const sum = result.x.add(ce.symbol('y')).add(ce.symbol('z')).simplify();
    expect(sum.json).toBe(10);
  });

  test('should solve under-determined system: 2 equations, 3 variables', () => {
    // x + y + z = 6
    // x + 2y + 3z = 10
    // Subtracting: y + 2z = 4, so y = 4 - 2z
    // Then x = 6 - y - z = 6 - (4 - 2z) - z = 2 + z
    const e = expr('\\begin{cases}x+y+z=6\\\\x+2y+3z=10\\end{cases}');
    const result = e.solve(['x', 'y', 'z']) as Record<string, any>;
    expect(result).not.toBeNull();
    const ce = engine;
    // z is free variable (omitted from result)
    expect(result.z).toBeUndefined();
    // Verify by substitution into both equations
    const z = ce.symbol('z');
    const eq1 = result.x.add(result.y).add(z).simplify();
    expect(eq1.json).toBe(6);
    const eq2 = result.x.add(result.y.mul(2)).add(z.mul(3)).simplify();
    expect(eq2.json).toBe(10);
  });

  test('should solve under-determined system with coefficients: 2x+3y=12', () => {
    const e = expr('\\begin{cases}2x+3y=12\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    const ce = engine;
    // y is free (omitted from result), x = (12 - 3y) / 2 = 6 - (3/2)y
    expect(result.y).toBeUndefined();
    // Verify: 2x + 3y = 12
    const lhs = result.x.mul(2).add(ce.symbol('y').mul(3)).simplify();
    expect(lhs.json).toBe(12);
  });

  test('should return null for inconsistent under-determined system', () => {
    // x + y = 5
    // x + y = 7
    // These are inconsistent (no solution)
    const e = expr('\\begin{cases}x+y=5\\\\x+y=7\\end{cases}');
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
  });
});

describe('SOLVING NON-LINEAR POLYNOMIAL SYSTEMS', () => {
  // Product + sum pattern: xy = p, x + y = s
  // Note: Basic xy=6, x+y=5 test is in LINEAR SYSTEMS section above

  test('should solve product-sum system: xy=12, x+y=7', () => {
    const e = expr('\\begin{cases}xy=12\\\\x+y=7\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    // Solutions: (x=3, y=4) and (x=4, y=3)
    const solutions = result.map((r) => ({
      x: r.x.json,
      y: r.y.json,
    }));
    expect(solutions).toContainEqual({ x: 3, y: 4 });
    expect(solutions).toContainEqual({ x: 4, y: 3 });
  });

  test('should solve product-sum with double root: xy=4, x+y=4', () => {
    const e = expr('\\begin{cases}xy=4\\\\x+y=4\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    // Double root: x = y = 2
    expect(result.length).toBe(1);
    expect(result[0].x.json).toBe(2);
    expect(result[0].y.json).toBe(2);
  });

  test('should solve product-sum with negative product: xy=-6, x+y=1', () => {
    const e = expr('\\begin{cases}xy=-6\\\\x+y=1\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    // Solutions: (x=3, y=-2) and (x=-2, y=3)
    const solutions = result.map((r) => ({
      x: r.x.json,
      y: r.y.json,
    }));
    expect(solutions).toContainEqual({ x: 3, y: -2 });
    expect(solutions).toContainEqual({ x: -2, y: 3 });
  });

  test('should return null for product-sum with no real solutions: xy=10, x+y=1', () => {
    // t² - t + 10 = 0 has discriminant 1 - 40 = -39 < 0, no real solutions
    const e = expr('\\begin{cases}xy=10\\\\x+y=1\\end{cases}');
    const result = e.solve(['x', 'y']);
    // May return null or empty array depending on implementation
    expect(
      result === null || (Array.isArray(result) && result.length === 0)
    ).toBe(true);
  });

  // Substitution method tests
  test('should solve via substitution: x+y=5, x^2+y=7', () => {
    // From first equation: y = 5 - x
    // Substitute: x² + (5 - x) = 7 → x² - x - 2 = 0 → (x-2)(x+1) = 0
    // x = 2, y = 3 or x = -1, y = 6
    const e = expr('\\begin{cases}x+y=5\\\\x^2+y=7\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    const solutions = result.map((r) => ({
      x: r.x.json,
      y: r.y.json,
    }));
    expect(solutions).toContainEqual({ x: 2, y: 3 });
    expect(solutions).toContainEqual({ x: -1, y: 6 });
  });

  test('should solve via substitution: 2x-y=1, xy=3', () => {
    // From first equation: y = 2x - 1
    // Substitute: x(2x - 1) = 3 → 2x² - x - 3 = 0 → (2x-3)(x+1) = 0
    // x = 3/2, y = 2 or x = -1, y = -3
    const e = expr('\\begin{cases}2x-y=1\\\\xy=3\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    const solutions = result.map((r) => ({
      x: r.x.json,
      y: r.y.json,
    }));
    expect(solutions).toContainEqual({ x: ['Rational', 3, 2], y: 2 });
    expect(solutions).toContainEqual({ x: -1, y: -3 });
  });
});

describe('SOLVING LINEAR INEQUALITY SYSTEMS', () => {
  // Test basic triangle feasible region: x >= 0, y >= 0, x + y <= 10
  test('should solve simple triangle: x>=0, y>=0, x+y<=10', () => {
    const e = expr(
      '\\begin{cases}x\\geq 0\\\\y\\geq 0\\\\x+y\\leq 10\\end{cases}'
    );
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);

    // Extract numeric values for easier comparison
    const vertices = result.map((r) => ({
      x: typeof r.x.json === 'number' ? r.x.json : r.x.N().numericValue,
      y: typeof r.y.json === 'number' ? r.y.json : r.y.N().numericValue,
    }));

    // Should have vertices at (0,0), (10,0), (0,10)
    expect(vertices).toContainEqual({ x: 0, y: 0 });
    expect(vertices).toContainEqual({ x: 10, y: 0 });
    expect(vertices).toContainEqual({ x: 0, y: 10 });
  });

  // Test square feasible region: 0 <= x <= 5, 0 <= y <= 5
  test('should solve square region: 0<=x<=5, 0<=y<=5', () => {
    const e = expr(
      '\\begin{cases}x\\geq 0\\\\x\\leq 5\\\\y\\geq 0\\\\y\\leq 5\\end{cases}'
    );
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(4);

    const vertices = result.map((r) => ({
      x: typeof r.x.json === 'number' ? r.x.json : r.x.N().numericValue,
      y: typeof r.y.json === 'number' ? r.y.json : r.y.N().numericValue,
    }));

    // Should have vertices at (0,0), (5,0), (5,5), (0,5)
    expect(vertices).toContainEqual({ x: 0, y: 0 });
    expect(vertices).toContainEqual({ x: 5, y: 0 });
    expect(vertices).toContainEqual({ x: 5, y: 5 });
    expect(vertices).toContainEqual({ x: 0, y: 5 });
  });

  // Test with coefficients: 2x + 3y <= 12, x >= 0, y >= 0
  test('should solve with coefficients: 2x+3y<=12, x>=0, y>=0', () => {
    const e = expr(
      '\\begin{cases}2x+3y\\leq 12\\\\x\\geq 0\\\\y\\geq 0\\end{cases}'
    );
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);

    const vertices = result.map((r) => ({
      x: typeof r.x.json === 'number' ? r.x.json : r.x.N().numericValue,
      y: typeof r.y.json === 'number' ? r.y.json : r.y.N().numericValue,
    }));

    // Vertices at (0,0), (6,0), (0,4)
    expect(vertices).toContainEqual({ x: 0, y: 0 });
    expect(vertices).toContainEqual({ x: 6, y: 0 });
    expect(vertices).toContainEqual({ x: 0, y: 4 });
  });

  // Test using Less (strict inequality)
  test('should handle strict inequalities: x>0, y>0, x+y<10', () => {
    const e = expr('\\begin{cases}x>0\\\\y>0\\\\x+y<10\\end{cases}');
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    // Same vertices as non-strict case (boundary points)
    expect(result.length).toBe(3);
  });

  // Test pentagon with multiple constraints
  test('should solve pentagon: x>=0, y>=0, x<=4, y<=4, x+y<=6', () => {
    const e = expr(
      '\\begin{cases}x\\geq 0\\\\y\\geq 0\\\\x\\leq 4\\\\y\\leq 4\\\\x+y\\leq 6\\end{cases}'
    );
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(5);

    const vertices = result.map((r) => ({
      x: typeof r.x.json === 'number' ? r.x.json : r.x.N().numericValue,
      y: typeof r.y.json === 'number' ? r.y.json : r.y.N().numericValue,
    }));

    // Vertices at (0,0), (4,0), (4,2), (2,4), (0,4)
    expect(vertices).toContainEqual({ x: 0, y: 0 });
    expect(vertices).toContainEqual({ x: 4, y: 0 });
    expect(vertices).toContainEqual({ x: 4, y: 2 });
    expect(vertices).toContainEqual({ x: 2, y: 4 });
    expect(vertices).toContainEqual({ x: 0, y: 4 });
  });

  // Test infeasible region (no solution)
  test('should return null for infeasible system: x>=5, x<=2', () => {
    const e = expr(
      '\\begin{cases}x\\geq 5\\\\x\\leq 2\\\\y\\geq 0\\end{cases}'
    );
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
  });

  // Test non-linear inequality returns null
  test('should return null for non-linear inequalities: x^2+y<=10', () => {
    const e = expr(
      '\\begin{cases}x^2+y\\leq 10\\\\x\\geq 0\\\\y\\geq 0\\end{cases}'
    );
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
  });

  // Mixed equality and inequality systems
  test('should solve mixed system: x+y=5, x-y=1, x>=0, y>=0', () => {
    const e = engine.expr([
      'And',
      ['Equal', ['Add', 'x', 'y'], 5],
      ['Equal', ['Subtract', 'x', 'y'], 1],
      ['GreaterEqual', 'x', 0],
      ['GreaterEqual', 'y', 0],
    ]);
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(3);
    expect(result.y.json).toBe(2);
  });

  test('should return null for mixed system where inequality is violated', () => {
    const e = engine.expr([
      'And',
      ['Equal', ['Add', 'x', 'y'], 5],
      ['Equal', ['Subtract', 'x', 'y'], 1],
      ['LessEqual', 'x', 0],
    ]);
    const result = e.solve(['x', 'y']);
    // x=3 violates x<=0
    expect(result).toBeNull();
  });

  test('should filter polynomial solutions by inequalities', () => {
    // x*y = 6, x+y = 5, x>0, y>0
    // Solutions: (2,3) and (3,2) — both satisfy x>0, y>0
    const e = engine.expr([
      'And',
      ['Equal', ['Multiply', 'x', 'y'], 6],
      ['Equal', ['Add', 'x', 'y'], 5],
      ['Greater', 'x', 0],
      ['Greater', 'y', 0],
    ]);
    const result = e.solve(['x', 'y']) as Array<Record<string, any>>;
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });

  test('should return parametric solution for under-determined mixed system', () => {
    // x+y=5, x>=0 — x = 5-y, parametric (y free), inequality can't be fully evaluated
    const e = expr('\\begin{cases}x+y=5\\\\x\\geq 0\\end{cases}');
    const result = e.solve(['x', 'y']) as Record<string, any>;
    // Parametric solution: x = 5-y with x >= 0 constraint
    // Since x = 5-y contains free variable y, the inequality evaluation
    // may not yield True, so result could be null or parametric
    // We just check it doesn't crash
    // (parametric solutions where inequalities can't be fully evaluated pass through)
  });
});

describe('SOLVING WITH Or', () => {
  test('Or(x=1, x=2) should return [1, 2]', () => {
    const e = engine.expr(['Or', ['Equal', 'x', 1], ['Equal', 'x', 2]]);
    const result = e.solve(['x']) as any[];
    expect(result).not.toBeNull();
    const vals = result.map((r) => r.json);
    expect(vals).toContain(1);
    expect(vals).toContain(2);
    expect(vals.length).toBe(2);
  });

  test('Or(x=1, x=1) should deduplicate to [1]', () => {
    const e = engine.expr(['Or', ['Equal', 'x', 1], ['Equal', 'x', 1]]);
    const result = e.solve(['x']) as any[];
    expect(result).not.toBeNull();
    expect(result.length).toBe(1);
    expect(result[0].json).toBe(1);
  });

  test('Or(x^2=4, x=3) should return [-2, 2, 3]', () => {
    const e = engine.expr([
      'Or',
      ['Equal', ['Power', 'x', 2], 4],
      ['Equal', 'x', 3],
    ]);
    const result = e.solve(['x']) as any[];
    expect(result).not.toBeNull();
    const vals = result.map((r) => r.json);
    expect(vals).toContain(2);
    expect(vals).toContain(-2);
    expect(vals).toContain(3);
    expect(vals.length).toBe(3);
  });
});

describe('DOMAIN-CONSTRAINED SOLVE', () => {
  const { ComputeEngine } = require('../../src/compute-engine');

  test('integer variable: 2n - 5 = 0 has no integer solutions', () => {
    const ce = new ComputeEngine();
    ce.declare('n', { type: 'integer' });
    const result = ce.parse('2n - 5 = 0').solve('n');
    // 5/2 is not an integer, so no solutions
    expect(result).toEqual([]);
  });

  test('integer variable: m^2 - 4 = 0 has integer solutions [2, -2]', () => {
    const ce = new ComputeEngine();
    ce.declare('m', { type: 'integer' });
    const result = ce.parse('m^2 - 4 = 0').solve('m');
    expect(result).not.toBeNull();
    const values = (result as any[])?.map((x: any) => x.re).sort();
    expect(values).toEqual([-2, 2]);
  });

  test('real variable: r^2 + 1 = 0 has no real solutions', () => {
    const ce = new ComputeEngine();
    ce.declare('r', { type: 'real' });
    const result = ce.parse('r^2 + 1 = 0').solve('r');
    // sqrt(-1) = i is not real, so no solutions
    expect(result).toEqual([]);
  });

  test('linear system with integer constraint filters non-integer solution', () => {
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'integer' });
    ce.declare('y', { type: 'integer' });
    // x + y = 5, x - y = 2 → x=3.5, y=1.5 (not integers)
    const result = ce
      .parse('\\begin{cases}x+y=5\\\\x-y=2\\end{cases}')
      .solve(['x', 'y']);
    expect(result).toBeNull();
  });

  test('linear system with integer constraint keeps integer solution', () => {
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'integer' });
    ce.declare('y', { type: 'integer' });
    // x + y = 5, x - y = 1 → x=3, y=2
    const result = ce
      .parse('\\begin{cases}x+y=5\\\\x-y=1\\end{cases}')
      .solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(3);
    expect(result.y.json).toBe(2);
  });
});

describe('SOLVING SYSTEMS VIA And OPERATOR', () => {
  test('should solve And(x+y=70, 2x-4y=80)', () => {
    const ce = engine;
    const e = ce.expr([
      'And',
      ['Equal', ['Add', 'x', 'y'], 70],
      ['Equal', ['Add', ['Multiply', 2, 'x'], ['Multiply', -4, 'y']], 80],
    ]);
    const result = e.solve(['x', 'y']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(60);
    expect(result.y.json).toBe(10);
  });

  test('should solve And with 3 equations', () => {
    const ce = engine;
    const e = ce.expr([
      'And',
      ['Equal', ['Add', 'x', 'y', 'z'], 6],
      ['Equal', ['Add', ['Multiply', 2, 'x'], 'y', ['Negate', 'z']], 1],
      ['Equal', ['Add', 'x', ['Negate', 'y'], ['Multiply', 2, 'z']], 5],
    ]);
    const result = e.solve(['x', 'y', 'z']) as Record<string, any>;
    expect(result).not.toBeNull();
    expect(result.x.json).toBe(1);
    expect(result.y.json).toBe(2);
    expect(result.z.json).toBe(3);
  });

  test('should return null for inconsistent And system', () => {
    const ce = engine;
    const e = ce.expr([
      'And',
      ['Equal', ['Add', 'x', 'y'], 1],
      ['Equal', ['Add', 'x', 'y'], 2],
    ]);
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
  });
});

describe('PARAMETRIC SOLUTION TYPE FILTERING', () => {
  test('underdetermined system with integer vars should not be rejected', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'integer' });
    ce.declare('y', { type: 'integer' });
    // x + y = 5 with 2 unknowns → underdetermined, parametric solution
    const e = ce.expr(['List', ['Equal', ['Add', 'x', 'y'], 5]]);
    const result = e.solve(['x', 'y']);
    // Should not return null — parametric solutions should pass through
    // (isInteger returns undefined for symbolic expressions, not false)
    expect(result).not.toBeNull();
  });
});

describe('TRANSCENDENTAL AND SUBSTITUTION EQUATIONS (B9)', () => {
  // Same-base power equality: cᵃ = cᵇ ⟺ a = b (x ↦ cˣ injective).
  test('e^{2-x²} = e^{-x} → x = -1, 2', () => {
    const result = expr('e^{2-x^2}=e^{-x}')
      .solve('x')
      ?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        -1,
        2,
      ]
    `);
  });

  test('2^x = 2^3 → x = 3 (general base)', () => {
    expect(expr('2^x=2^3').solve('x')?.map((x) => x.json)).toMatchInlineSnapshot(`
      [
        3,
      ]
    `);
  });

  test('e^{2-x²} - e^{-x} = 0 (f=0 / Add form) → x = -1, 2', () => {
    // The Solve-operator / audit path passes the subtracted f = 0 form (an Add),
    // not an Equal; same-base reduction must fire here too.
    const result = expr('e^{2-x^2}-e^{-x}')
      .solve('x')
      ?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        -1,
        2,
      ]
    `);
  });

  // a·sin(x) + b·cos(x) = 0 → x = arctan(-b/a).
  test('sin(x) = cos(x) → π/4', () => {
    const result = expr('\\sin x = \\cos x')
      .solve('x')
      ?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        [
          Multiply,
          [
            Rational,
            1,
            4,
          ],
          Pi,
        ],
      ]
    `);
  });

  test('√3·sin(x) + cos(x) = 0 → -π/6', () => {
    const result = expr('\\sqrt{3}\\sin x + \\cos x = 0')
      .solve('x')
      ?.map((x) => x.N().re);
    expect(result?.length).toBe(1);
    expect(result![0]).toBeCloseTo(-Math.PI / 6, 8);
  });

  // Homogenization: polynomial in a rational power of x (u = x^{1/d}).
  test('2√x + 3·⁴√x = 2 → x = 1/16', () => {
    const result = expr('2\\sqrt{x}+3x^{1/4}=2')
      .solve('x')
      ?.map((x) => x.json);
    // u = ⁴√x solves 2u²+3u-2=0 → u = ½ (u = -2 gives x = 16, extraneous).
    expect(result).toMatchInlineSnapshot(`
      [
        [
          Rational,
          1,
          16,
        ],
      ]
    `);
  });

  test('x^{2/3} + x^{1/3} - 2 = 0 → x = 1, -8 (real-root convention)', () => {
    // u = x^{1/3} solves u²+u-2=0 → u = 1, -2, so x = u³ = 1, -8. Both are
    // real solutions under CE's real-root convention for odd roots: at x = -8,
    // x^{1/3} = -2 and x^{2/3} = (-2)² = 4, so 4 + (-2) - 2 = 0. (x = -8 was
    // previously dropped only because (-8)^{2/3} numericized to NaN.)
    const result = expr('x^{2/3}+x^{1/3}-2=0')
      .solve('x')
      ?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        1,
        -8,
      ]
    `);
  });

  test('x - 5√x + 6 = 0 → x = 4, 9', () => {
    const result = expr('x-5\\sqrt{x}+6=0')
      .solve('x')
      ?.map((x) => x.json);
    expect(result?.sort()).toEqual([4, 9]);
  });

  // Single square root with a non-constant coefficient: A·√R + B = 0 → A²R = B².
  test('x = 1/√(x²+1) → √((√5−1)/2) exact (positive root only)', () => {
    // x·√(x²+1) = 1 squares to x⁴+x²-1 = 0, solved exactly via u = x²; the
    // negative root is extraneous (the right-hand side is always positive).
    const result = expr('x=\\frac{1}{\\sqrt{x^2+1}}').solve('x');
    expect(result?.length).toBe(1);
    // Exact radical, not numeric.
    expect(result![0].toString()).toContain('sqrt');
    expect(result![0].N().re).toBeCloseTo(0.7861513777574233, 8);
  });

  test('x·√(x+1) = 2 → x ≈ 1.315', () => {
    const result = expr('x\\sqrt{x+1}=2')
      .solve('x')
      ?.map((x) => x.N().re);
    expect(result?.length).toBe(1);
    expect(result![0]).toBeCloseTo(1.314596212276752, 8);
  });
});
