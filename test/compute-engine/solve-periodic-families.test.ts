import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// With no domain, or over the real or the complex numbers, `Solve` of a
// periodic equation returns its families of roots `x₀ + T·t` with a fresh
// integer parameter `t` (the same names as the diophantine solver). Over a
// bounded domain, the result is the list of the roots in the domain.

const ce = new ComputeEngine();

function solve(latex: string, unknown = 'x'): Expression {
  return ce.parse(`\\operatorname{Solve}(${latex}, ${unknown})`).evaluate();
}

/**
 * Check a list of families numerically, independently of the solver:
 * - each member of each family near `[lo, hi]` is a root of `f`;
 * - each root of `f` in `[lo, hi]` (found by a dense scan of sign changes
 *   and of near-zero minima of `|f|`) is a member of a family.
 */
function checkFamilies(
  result: Expression,
  f: (x: number) => number,
  lo = -9,
  hi = 9,
  param = 't'
): void {
  expect(result.operator).toBe('List');
  const members: number[] = [];
  for (const family of result.ops!) {
    const at = (k: number) => family.subs({ [param]: k }).N().re;
    const step = Math.abs(at(1) - at(0));
    // A family without the parameter is one root.
    const kmax =
      step > 0 ? Math.ceil((Math.max(-lo, hi) + Math.abs(at(0))) / step) : 0;
    for (let k = -kmax; k <= kmax; k++) {
      const v = at(k);
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(f(v))).toBeLessThan(1e-9);
      members.push(v);
    }
  }
  const n = 200_000;
  const h = (hi - lo) / n;
  const near = (x: number) => members.some((m) => Math.abs(m - x) < 2 * h);
  let prev = f(lo);
  for (let i = 1; i <= n; i++) {
    const x = lo + i * h;
    const y = f(x);
    if (Number.isFinite(prev) && Number.isFinite(y)) {
      // A sign change with a small value on one side: a root (not a pole).
      if (prev * y < 0 && Math.min(Math.abs(prev), Math.abs(y)) < 1e-2) {
        if (!near(x)) throw new Error(`root near ${x} is in no family`);
      }
      // A root where `f` touches zero.
      if (Math.abs(y) < 1e-12 && !near(x))
        throw new Error(`root near ${x} is in no family`);
    }
    prev = y;
  }
}

describe('SOLVE: FAMILIES OF ROOTS OF A PERIODIC EQUATION', () => {
  test('a trig equation gives its families with an integer parameter', () => {
    const r = solve('\\sin x = \\frac12');
    expect(r.json).toEqual([
      'List',
      [
        'Add',
        ['Multiply', 2, 'Pi', 't'],
        ['Multiply', ['Rational', 1, 6], 'Pi'],
      ],
      [
        'Add',
        ['Multiply', 2, 'Pi', 't'],
        ['Multiply', ['Rational', 5, 6], 'Pi'],
      ],
    ]);
    checkFamilies(r, (x) => Math.sin(x) - 0.5);
  });

  test('the box route gives the same families', () => {
    const r = ce
      .box(['Solve', ['Equal', ['Sin', 'x'], ['Rational', 1, 2]], 'x'])
      .evaluate();
    expect(r.toString()).toBe(solve('\\sin x = \\frac12').toString());
  });

  test('families with the same roots become one family', () => {
    // 0 + 2πt and π + 2πt are πt
    expect(solve('\\sin x = 0').toString()).toBe('[pi * t]');
    expect(solve('\\cos x = 0').toString()).toBe('[pi * t + 1/2 * pi]');
    expect(solve('\\sin x + \\cos x = 0').toString()).toBe(
      '[pi * t - 1/4 * pi]'
    );
    expect(solve('\\sin(x)^2 = 1').toString()).toBe('[pi * t + 1/2 * pi]');
    // π/2, 7π/6 and 11π/6 are a third of a turn apart
    const r = solve('2\\sin(x)^2 - \\sin x - 1 = 0');
    expect(r.nops).toBe(1);
    checkFamilies(r, (x) => 2 * Math.sin(x) ** 2 - Math.sin(x) - 1);
    // sin(πn) = 0 for every integer n
    expect(solve('\\sin(\\pi n) = 0', 'n').toString()).toBe('[t]');
  });

  test('each family has its root in (-T/2, T/2]', () => {
    expect(solve('\\sin x = -\\frac12').toString()).toBe(
      '[2pi * t - 5/6 * pi,2pi * t - 1/6 * pi]'
    );
    expect(solve('\\cos x = -1').toString()).toBe('[2pi * t + pi]');
    expect(solve('\\sin(x + 1) = 0').toString()).toBe('[pi * t - 1]');
  });

  test('a tangent gives families with the period π', () => {
    expect(solve('\\tan x = 1').toString()).toBe('[pi * t + 1/4 * pi]');
    checkFamilies(
      solve('\\tan x = \\sqrt3'),
      (x) => Math.tan(x) - Math.sqrt(3)
    );
  });

  test('each factor of a product gives families with its own period', () => {
    const r = solve('\\sin(2x)\\cos(3x) = 0');
    // the roots kπ/2 of sin(2x) and π/6 + kπ/3 of cos(3x)
    expect(r.toString()).toBe('[1/2 * pi * t,1/3 * pi * t + 1/6 * pi]');
    checkFamilies(r, (x) => Math.sin(2 * x) * Math.cos(3 * x));
    // The periods π and √2·π have no common multiple
    checkFamilies(
      solve('\\sin(x)\\sin(\\sqrt2 x) = 0'),
      (x) => Math.sin(x) * Math.sin(Math.SQRT2 * x)
    );
    // πt is in πt/2
    expect(solve('\\sin(x)\\sin(2x) = 0').toString()).toBe('[1/2 * pi * t]');
  });

  test('a polynomial factor gives its roots as they are', () => {
    const r = solve('(x - 1)\\sin x = 0');
    expect(r.toString()).toBe('[1,pi * t]');
    checkFamilies(r, (x) => (x - 1) * Math.sin(x));
    // 0 is a root of both factors
    expect(solve('x\\sin x = 0').toString()).toBe('[pi * t]');
  });

  test('a factor with poles gives the families of the whole product', () => {
    // cos(x) = 0 where tan(x) has a pole: only the roots of tan(x)
    const r = solve('\\tan(x)\\cos(x) = 0');
    expect(r.toString()).toBe('[pi * t]');
  });

  test('a free parameter of the equation is kept', () => {
    expect(solve('\\sin x = a').toString()).toBe(
      '[2pi * t + arcsin(a) {|a| <= 1},2pi * t - arcsin(a) + pi {|a| <= 1}]'
    );
    expect(solve('\\tan x = a').toString()).toBe('[pi * t + arctan(a)]');
  });

  test('the parameter is not a symbol of the equation', () => {
    const engine = new ComputeEngine();
    const r = engine
      .parse('\\operatorname{Solve}(\\sin x = \\frac{b}{2}, x)')
      .evaluate();
    expect(r.has('t')).toBe(true);
    const s = engine
      .parse('\\operatorname{Solve}(\\sin(x) + t = 1, x)')
      .evaluate();
    expect(s.has('t_1')).toBe(true);
  });

  test('a float root gives a family', () => {
    checkFamilies(solve('\\cos x = 0.5'), (x) => Math.cos(x) - 0.5);
  });

  test('the period is in the angular unit of the engine', () => {
    const engine = new ComputeEngine();
    engine.angularUnit = 'deg';
    expect(
      engine
        .parse('\\operatorname{Solve}(\\sin x = \\frac12, x)')
        .evaluate()
        .toString()
    ).toBe('[360t + 30,360t + 150]');
  });

  test('over the real or the complex numbers, the result is the same', () => {
    const expected = solve('\\sin x = \\frac12').toString();
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Sin', 'x'], ['Rational', 1, 2]],
          ['Element', 'x', 'RealNumbers'],
        ])
        .evaluate()
        .toString()
    ).toBe(expected);
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Sin', 'x'], ['Rational', 1, 2]],
          ['Element', 'x', 'ComplexNumbers'],
        ])
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test('over a bounded domain, the result is the roots in the domain', () => {
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Sin', 'x'], 1],
          ['Element', 'x', ['Interval', 0, 10]],
        ])
        .evaluate()
        .toString()
    ).toBe('[1/2 * pi,5/2 * pi]');
  });

  test('a condition on the unknown gives no answer', () => {
    // A family cannot exclude its members that are not positive
    expect(solve('\\sin(x) = 0 \\land x > 0').operator).toBe('Solve');
    // The same for an assumption (the answer was `[π]`), and for a type
    // narrower than `real` (the answer was `[0, 2]`, but each even integer
    // is a root)
    const engine = new ComputeEngine();
    engine.assume(engine.parse('y > 0'));
    expect(
      engine.parse('\\operatorname{Solve}(\\sin(y) = 0, y)').evaluate().operator
    ).toBe('Solve');
    engine.declare('k', 'integer');
    expect(
      engine
        .parse('\\operatorname{Solve}(\\sin(\\frac{\\pi k}{2}) = 0, k)')
        .evaluate().operator
    ).toBe('Solve');
  });

  test('the common roots of periodic equations are families', () => {
    expect(
      ce
        .box([
          'Solve',
          [
            'List',
            ['Equal', ['Sin', ['Multiply', 2, 'x']], 0],
            ['Equal', ['Cos', 'x'], -1],
          ],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('[2pi * t + pi]');
    // A rational coefficient: the common period of sin(x) and cos(x/4) is
    // 8π, and the common roots are 2π + 4πk
    expect(
      ce
        .box([
          'Solve',
          [
            'List',
            ['Equal', ['Sin', 'x'], 0],
            ['Equal', ['Cos', ['Divide', 'x', 4]], 0],
          ],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('[4pi * t + 2pi]');
    // cos(3kπ) is ±1: no common root, and this is a decision
    expect(
      ce
        .box([
          'Solve',
          [
            'List',
            ['Equal', ['Sin', 'x'], 0],
            ['Equal', ['Cos', ['Multiply', 3, 'x']], 0],
          ],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('[]');
  });

  test('a condition on the common roots of periodic equations gives no answer', () => {
    // The common roots are 2πt, which holds 0 and the negative roots: the
    // filter of the roots cannot remove them
    const system = [
      ['Equal', ['Sin', 'x'], 0],
      ['Equal', ['Cos', 'x'], 1],
    ];
    expect(
      ce
        .box(['Solve', ['List', ...system, ['Greater', 'x', 0]], 'x'])
        .evaluate().operator
    ).toBe('Solve');
    expect(
      ce.box(['Solve', ['And', ...system, ['Greater', 'x', 0]], 'x']).evaluate()
        .operator
    ).toBe('Solve');
    expect(
      ce
        .box([
          'Solve',
          ['List', ...system],
          ['Element', 'x', 'RealNumbers', ['Greater', 'x', 0]],
        ])
        .evaluate().operator
    ).toBe('Solve');
    // With no condition, the answer is the families
    expect(
      ce
        .box(['Solve', ['List', ...system], 'x'])
        .evaluate()
        .toString()
    ).toBe('[2pi * t]');
    // A condition with no common root keeps the decision
    expect(
      ce
        .box([
          'Solve',
          [
            'List',
            ['Equal', ['Sin', 'x'], 0],
            ['Equal', ['Cos', ['Multiply', 3, 'x']], 0],
            ['Greater', 'x', 0],
          ],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('[]');
    // An assumption on the unknown, and a type narrower than `real`
    const engine = new ComputeEngine();
    engine.assume(engine.parse('y > 0'));
    expect(
      engine
        .box([
          'Solve',
          ['List', ['Equal', ['Sin', 'y'], 0], ['Equal', ['Cos', 'y'], 1]],
          'y',
        ])
        .evaluate().operator
    ).toBe('Solve');
    engine.declare('k', 'integer');
    expect(
      engine
        .box([
          'Solve',
          [
            'List',
            ['Equal', ['Sin', ['Multiply', ['Rational', 1, 2], 'Pi', 'k']], 0],
            ['Equal', ['Cos', ['Multiply', 'Pi', 'k']], 1],
          ],
          'k',
        ])
        .evaluate().operator
    ).toBe('Solve');
  });

  test('families with spacings that are near but not equal stay distinct', () => {
    // The spacings π and π/a are nearer than any tolerance, and both
    // families hold 0, but they are different sets of roots
    const a = ['Rational', 2000000001, 2000000000];
    const sinAx = ['Sin', ['Multiply', a, 'x']];
    const or = ce
      .box([
        'Solve',
        ['Or', ['Equal', ['Sin', 'x'], 0], ['Equal', sinAx, 0]],
        'x',
      ])
      .evaluate();
    expect(or.toString()).toBe('[pi * t,2000000000/2000000001 * pi * t]');
    const product = ce
      .box(['Solve', ['Equal', ['Multiply', ['Sin', 'x'], sinAx], 0], 'x'])
      .evaluate();
    expect(product.toString()).toBe(or.toString());
    // The common roots of sin(x) = 0 and sin(a·x) = 0 are 2000000000·πt,
    // not 2πt (the answer when the two periods were the same). The common
    // period 4000000000·π holds too many roots of sin(x) to check: there is
    // no answer
    const common = ce
      .box([
        'Solve',
        ['List', ['Equal', ['Sin', 'x'], 0], ['Equal', sinAx, 0]],
        'x',
      ])
      .evaluate();
    expect(common.operator).toBe('Solve');
    // A family that is inside another one is removed: 2πt is in πt
    expect(
      ce
        .box([
          'Solve',
          [
            'Or',
            ['Equal', ['Sin', 'x'], 0],
            ['Equal', ['Sin', ['Divide', 'x', 2]], 0],
          ],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('[pi * t]');
  });

  test('the alternatives of an Or give the union of their families', () => {
    expect(solve('\\sin(x) = 0 \\lor x = 2').toString()).toBe('[2,pi * t]');
    expect(solve('\\sin(x) = 2 \\lor x = 2').toString()).toBe('[2]');
  });

  test('the unknown outside a trig function of a quotient gives no answer', () => {
    // The roots are kπ with k ≠ 0: no family holds them
    expect(solve('\\frac{\\sin(x)}{x} = 0').operator).toBe('Solve');
  });
});

// Over the complex numbers, a periodic family can be only a part of the
// roots. `e^{sin x} = 1` holds when `sin x = 2πik` for an integer `k`: the
// roots are `arcsin(2πik) + 2πm` and `π − arcsin(2πik) + 2πm`, with two
// integer parameters. A list of families has one parameter, thus it cannot
// hold these roots, and the equation stays unevaluated. The answer was
// `[πt]`, the roots with `k = 0` only.
describe('SOLVE: PERIODIC FAMILIES OVER THE COMPLEX NUMBERS', () => {
  const overC = (eq: unknown): Expression =>
    ce.box(['Solve', eq, ['Element', 'x', 'ComplexNumbers']] as any).evaluate();

  test('e^{sin x} = 1 has roots that are not in a family', () => {
    // `z = arcsin(2πi)` is a root that is not real, thus not in `[πt]`
    const z = ce.parse('\\arcsin(2\\pi i)').N();
    expect(Math.abs(z.im)).toBeGreaterThan(1);
    const value = ce.box(['Exp', ['Sin', z]]).N();
    expect(Math.hypot(value.re - 1, value.im)).toBeLessThan(1e-12);

    expect(overC(['Equal', ['Exp', ['Sin', 'x']], 1]).operator).toBe('Solve');
    expect(
      overC(['Equal', ['Exp', ['Multiply', 2, ['Sin', 'x']]], 1]).operator
    ).toBe('Solve');
    expect(
      overC(['Equal', ['Exp', ['Cos', 'x']], 'ExponentialE']).operator
    ).toBe('Solve');
    // Over the real numbers and with no domain, `sin x = 2πik` has a real
    // root only for `k = 0`: the families are all the roots
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Exp', ['Sin', 'x']], 1],
          ['Element', 'x', 'RealNumbers'],
        ])
        .evaluate()
        .toString()
    ).toBe('[pi * t]');
    expect(solve('e^{\\sin(x)} = 1').toString()).toBe('[pi * t]');
  });

  test('a hyperbolic function has an imaginary period', () => {
    // `sinh(iπ) = 0` and `cosh(2πi) = 1`: over the complex numbers, the
    // roots are not only the real ones
    const s = ce.box(['Sinh', ['Multiply', 'ImaginaryUnit', 'Pi']]).N();
    expect(Math.hypot(s.re, s.im)).toBeLessThan(1e-12);
    const c = ce
      .box([
        'Cosh',
        ['Add', ['Arcosh', 2], ['Multiply', 2, 'ImaginaryUnit', 'Pi']],
      ])
      .N();
    expect(Math.hypot(c.re - 2, c.im)).toBeLessThan(1e-12);
    expect(overC(['Equal', ['Sinh', 'x'], 0]).operator).toBe('Solve');
    expect(overC(['Equal', ['Cosh', 'x'], 2]).operator).toBe('Solve');
    expect(overC(['Equal', ['Tanh', 'x'], ['Rational', 1, 2]]).operator).toBe(
      'Solve'
    );
    // Over the real numbers, the roots are unchanged
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Sinh', 'x'], 0],
          ['Element', 'x', 'RealNumbers'],
        ])
        .evaluate()
        .toString()
    ).toBe('[0]');
    expect(solve('\\cosh(x) = 2').toString()).toBe('[arcosh(2),-arcosh(2)]');
  });

  test('the families of sin(x) = c hold all the complex roots', () => {
    // `sin z = c` has the roots `arcsin(c) + 2πk` and `π − arcsin(c) + 2πk`
    // for each complex `c`
    const result = overC(['Equal', ['Sin', 'x'], 'ImaginaryUnit']);
    expect(result.toString()).toBe(
      '[2pi * t + arcsin(i),2pi * t + pi - arcsin(i)]'
    );
    for (const family of result.ops!) {
      for (const k of [-2, 0, 3]) {
        const z = family.subs({ t: k }).N();
        const v = ce.box(['Sin', z]).N();
        expect(Math.hypot(v.re, v.im - 1)).toBeLessThan(1e-12);
      }
    }
    expect(
      overC([
        'Equal',
        ['Power', ['Sin', 'x'], 2],
        ['Rational', 1, 4],
      ]).toString()
    ).toBe('[pi * t - 1/6 * pi,pi * t + 1/6 * pi]');
  });
});
