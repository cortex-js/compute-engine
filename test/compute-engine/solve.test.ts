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
          num: -200.0000000749999999718750000210937499802246093957641601328903198517498016021887183608810454072251474,
        },
      ]
    `);
  });

  it('should solve bx', () => {
    const eqn = ce.box(['Multiply', 5, 'x']);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  it('should solve bx + c', () => {
    const eqn = ce.box(['Add', ['Multiply', 5, 'x'], -10]);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        2,
      ]
    `);
  });

  it('should solve ax^2', () => {
    const eqn = ce.box(['Multiply', 16, ['Square', 'x']]);
    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  it('should solve ax^2 + c', () => {
    const eqn = ce.box(['Add', ['Multiply', 2, ['Square', 'x']], -16]);
    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        ["Sqrt", 8],
        ["Negate", ["Sqrt", 8]],
      ]
    `);
  });

  it('should solve ax^2 + bx + c', () => {
    const eqn = ce.box([
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
          -0,
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

  test('should return null for under-determined system: single equation, two variables', () => {
    const e = expr('\\begin{cases}x+y=5\\end{cases}');
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
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
    expect(result === null || (Array.isArray(result) && result.length === 0)).toBe(true);
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
    const e = expr('\\begin{cases}x\\geq 0\\\\y\\geq 0\\\\x+y\\leq 10\\end{cases}');
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
    const e = expr('\\begin{cases}x\\geq 0\\\\x\\leq 5\\\\y\\geq 0\\\\y\\leq 5\\end{cases}');
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
    const e = expr('\\begin{cases}2x+3y\\leq 12\\\\x\\geq 0\\\\y\\geq 0\\end{cases}');
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
    const e = expr('\\begin{cases}x\\geq 0\\\\y\\geq 0\\\\x\\leq 4\\\\y\\leq 4\\\\x+y\\leq 6\\end{cases}');
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
    const e = expr('\\begin{cases}x\\geq 5\\\\x\\leq 2\\\\y\\geq 0\\end{cases}');
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
  });

  // Test non-linear inequality returns null
  test('should return null for non-linear inequalities: x^2+y<=10', () => {
    const e = expr('\\begin{cases}x^2+y\\leq 10\\\\x\\geq 0\\\\y\\geq 0\\end{cases}');
    const result = e.solve(['x', 'y']);
    expect(result).toBeNull();
  });

  // Test mixed equality and inequality (should not match)
  test('should return null for mixed equality and inequality', () => {
    const e = expr('\\begin{cases}x+y=5\\\\x\\geq 0\\end{cases}');
    const result = e.solve(['x', 'y']);
    // Currently returns null as we don't mix equalities and inequalities
    expect(result).toBeNull();
  });
});
