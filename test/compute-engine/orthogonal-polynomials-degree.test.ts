/**
 * A degree that is not an integer leaves `ChebyshevT`, `ChebyshevU`,
 * `LegendreP`, `HermiteH` and `LaguerreL` unevaluated (it was a type error),
 * and `LaguerreL(n, a, x)` is the generalized Laguerre polynomial Lₙ⁽ᵃ⁾(x)
 * (DLMF 18.5.12, 18.9.13). Reference values: mpmath's explicit sum
 * Σₖ C(n+a, n−k) (−x)ᵏ / k! at 60 digits.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { orthogonalPolynomial } from '../../src/compute-engine/numerics/orthogonal-polynomials';

const ce = new ComputeEngine();

const heads = [
  'ChebyshevT',
  'ChebyshevU',
  'LegendreP',
  'HermiteH',
  'LaguerreL',
];

const evaluate = (json: unknown) =>
  ce
    .box(json as never)
    .evaluate()
    .toString();
const N = (json: unknown) => ce.box(json as never).N().re;

describe('a degree that is not an integer', () => {
  const degrees: [string, unknown][] = [
    ['2.5', 2.5],
    ['-2.5', -2.5],
    ['5/2', ['Rational', 5, 2]],
    ['pi', 'Pi'],
  ];
  for (const head of heads) {
    for (const [name, degree] of degrees) {
      test(`${head}(${name}, x) is valid and unevaluated`, () => {
        const expr = ce.box([head, degree, 'x'] as never);
        expect(expr.isValid).toBe(true);
        expect(expr.evaluate().operator).toBe(head);
        expect(expr.N().operator).toBe(head);
      });
      test(`${head}(${name}, 0.5) stays unevaluated under evaluate() and N()`, () => {
        const expr = ce.box([head, degree, 0.5] as never);
        expect(expr.isValid).toBe(true);
        expect(expr.evaluate().operator).toBe(head);
        expect(expr.N().operator).toBe(head);
      });
    }
    test(`${head}(n, x) of a symbolic degree stays unevaluated`, () => {
      expect(evaluate([head, 'n', 'x'])).toBe(`${head}(n, x)`);
    });
  }

  test('HermiteH(2.5, x) is the call, not an Error', () => {
    expect(evaluate(['HermiteH', 2.5, 'x'])).toBe('HermiteH(2.5, x)');
  });

  test('the parse route keeps a non-integer degree', () => {
    const expr = ce.parse('\\operatorname{HermiteH}(2.5, x)');
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().operator).toBe('HermiteH');
  });

  test('an integer degree is unchanged, a negative one keeps its rules', () => {
    expect(evaluate(['HermiteH', 3, 'x'])).toBe('8x^3 - 12x');
    expect(evaluate(['ChebyshevT', -3, 'x'])).toBe('4x^3 - 3x');
    expect(evaluate(['HermiteH', -1, 'x'])).toBe('HermiteH(-1, x)');
    expect(N(['HermiteH', 2.0, 0.5])).toBe(-1);
  });
});

describe('LaguerreL(n, a, x)', () => {
  test('a literal degree and a symbolic x or a gives the polynomial', () => {
    const cases: [unknown, string][] = [
      [['LaguerreL', 0, 'a', 'x'], '1'],
      [['LaguerreL', 1, 'a', 'x'], 'a - x + 1'],
      [['LaguerreL', 2, 1, 'x'], '1/2 * x^2 - 3x + 3'],
      [['LaguerreL', 2, -3, 'x'], '1/2 * x^2 + x + 1'],
      [['LaguerreL', 2, ['Rational', 1, 2], 'x'], '1/2 * x^2 - 5/2 * x + 15/8'],
    ];
    for (const [json, expected] of cases) expect(evaluate(json)).toBe(expected);
  });

  test('a symbolic a gives the expanded polynomial in a and x', () => {
    // L₂⁽ᵃ⁾ = (a² + 3a + 2)/2 − (a + 2) x + x²/2
    expect(evaluate(['LaguerreL', 2, 'a', 'x'])).toBe(
      '1/2 * a^2 + 1/2 * x^2 - a * x + 3/2 * a - 2x + 1'
    );
    // x = 1: a symbolic a and a number x
    const p = ce.box(['LaguerreL', 2, 'a', 1]).evaluate();
    expect(p.subs({ a: 2 }).evaluate().toString()).toBe('5/2');
  });

  test('a = 0 is the two-operand form on every route', () => {
    for (const x of ['x', 0.3, ['Rational', 2, 7], 40]) {
      for (const n of [0, 1, 4, 9]) {
        const two = ce.box(['LaguerreL', n, x] as never);
        const three = ce.box(['LaguerreL', n, 0, x] as never);
        expect(three.evaluate().toString()).toBe(two.evaluate().toString());
        expect(three.N().toString()).toBe(two.N().toString());
      }
    }
    expect(evaluate(['LaguerreL', 'n', 0, 'x'])).toBe('LaguerreL(n, x)');
    expect(
      ce.parse('\\operatorname{LaguerreL}(6, 0, x)').evaluate().toString()
    ).toBe(evaluate(['LaguerreL', 6, 'x']));
  });

  test('an exact rational x and a give the exact value', () => {
    // L₃⁽¹ᐟ²⁾(2) = −43/48, mpmath
    expect(evaluate(['LaguerreL', 3, ['Rational', 1, 2], 2])).toBe('-43/48');
    // L₄⁽³⁾(1/3), by the explicit sum
    expect(evaluate(['LaguerreL', 4, 3, ['Rational', 1, 3]])).toBe(
      '47545/1944'
    );
    // L₅⁽⁻²⁾(2/5): an integer a < 0 inside [−n, −1]
    expect(evaluate(['LaguerreL', 5, -2, ['Rational', 2, 5]])).toBe(
      '2396/46875'
    );
  });

  test('a float, or N(), gives the recurrence value', () => {
    expect(N(['LaguerreL', 3, 0.5, 2])).toBeCloseTo(-43 / 48, 14);
    expect(N(['LaguerreL', 3, ['Rational', 1, 2], 2])).toBeCloseTo(
      -43 / 48,
      14
    );
    expect(N(['LaguerreL', 3, 1, 0.5])).toBeCloseTo(1.4791666666666667, 14);
    expect(ce.box(['LaguerreL', 3, 'a', 0.5]).evaluate().operator).toBe('Add');
  });

  test('N() agrees with the exact value', () => {
    for (const a of [['Rational', -1, 2], 0, 2, ['Rational', 7, 3]]) {
      const json = ['LaguerreL', 9, a, ['Rational', -3, 7]];
      const exact = ce.box(json as never).evaluate();
      expect(N(json)).toBeCloseTo(exact.re, 12);
    }
  });

  test('values at 40 digits agree with the exact value', () => {
    const engine = new ComputeEngine();
    engine.precision = 40;
    const exact = engine
      .box(['LaguerreL', 12, ['Rational', 5, 2], ['Rational', 7, 10]])
      .evaluate();
    const approx = engine.box(['LaguerreL', 12, 2.5, 0.7]).N();
    expect(approx.toString().slice(0, 33)).toBe(
      exact.N().toString().slice(0, 33)
    );
  });

  test('a < −1 is summed explicitly where the recurrence cancels', () => {
    // mpmath: L₅₀⁽⁻³⁰·⁵⁾(0.1) = 3.2334063429519006e-16; the recurrence
    // gave a relative error of 10⁷ there
    expect(
      orthogonalPolynomial('LaguerreL', 50, 0.1, -30.5) / 3.2334063429519006e-16
    ).toBeCloseTo(1, 13);
    // L₅⁽⁻³⁾(x) = −x³ L₂⁽³⁾(x) / 60, exactly
    const x = 0.37;
    const l23 = orthogonalPolynomial('LaguerreL', 2, x, 3);
    const l5 = orthogonalPolynomial('LaguerreL', 5, x, -3);
    expect(l5 / ((-(x ** 3) * l23) / 60)).toBeCloseTo(1, 13);
  });

  test('a negative or non-integer degree stays unevaluated', () => {
    expect(evaluate(['LaguerreL', -2, 1, 'x'])).toBe('LaguerreL(-2, 1, x)');
    expect(evaluate(['LaguerreL', 2.5, 1, 'x'])).toBe('LaguerreL(2.5, 1, x)');
    expect(evaluate(['LaguerreL', 'n', 'a', 'x'])).toBe('LaguerreL(n, a, x)');
    expect(ce.box(['LaguerreL', 2.5, 1, 0.5]).N().operator).toBe('LaguerreL');
  });

  test('NaN propagates', () => {
    expect(evaluate(['LaguerreL', 3, 'NaN', 0.5])).toBe('NaN');
  });

  test('the type is real for a real a and x', () => {
    expect(ce.box(['LaguerreL', 3, 0.5, 2]).type.toString()).toBe('real');
    expect(ce.box(['LaguerreL', 3, 'a', 'x']).isValid).toBe(true);
  });

  test('a complex x', () => {
    // L₂⁽¹⁾(z) = z²/2 − 3z + 3 at z = 0.5 + 0.25i: 1.59375 − 0.625i
    const v = ce.box(['LaguerreL', 2, 1, ['Complex', 0.5, 0.25]]).N();
    expect(v.re).toBeCloseTo(1.59375, 14);
    expect(v.im).toBeCloseTo(-0.625, 14);
  });

  test('a list of x applies to each element', () => {
    expect(evaluate(['LaguerreL', 2, 1, ['List', 0, 2]])).toBe('[3,-1]');
  });

  test('the parse route', () => {
    const expr = ce.parse('\\operatorname{LaguerreL}(2, 1, x)');
    expect(expr.json).toEqual(['LaguerreL', 2, 1, 'x']);
    expect(expr.evaluate().toString()).toBe('1/2 * x^2 - 3x + 3');
    const latex = ce.box(['LaguerreL', 2, 'a', 'x']).latex;
    expect(ce.parse(latex).json).toEqual(['LaguerreL', 2, 'a', 'x']);
  });
});

describe('compiled LaguerreL(n, a, x)', () => {
  const engine = new ComputeEngine();
  for (const v of ['x', 'a']) engine.declare(v, 'real');
  engine.declare('n', 'integer');

  const run = (json: unknown, to = 'javascript') =>
    compile(engine.box(json as never), { to, fallback: false } as never)
      .run as unknown as (v: Record<string, number>) => number;

  test('JavaScript agrees with N()', () => {
    const f = run(['LaguerreL', 'n', 'a', 'x']);
    for (const [n, a, x] of [
      [0, 0.5, 0.3],
      [3, 0.5, 2],
      [7, 2, 10],
      [12, -0.5, 40],
      [10, -2.5, 3],
      [8, -3, 0.7],
    ]) {
      const expected = engine.box(['LaguerreL', n, a, x]).N().re;
      expect(Math.abs(f({ n, a, x }) - expected)).toBeLessThanOrEqual(
        1e-12 * Math.max(1, Math.abs(expected))
      );
    }
  });

  test('a = 0 is the two-operand compiled value', () => {
    const three = run(['LaguerreL', 'n', 0, 'x']);
    const two = run(['LaguerreL', 'n', 'x']);
    for (const [n, x] of [
      [3, 2],
      [9, 30.5],
    ])
      expect(three({ n, x })).toBe(two({ n, x }));
  });

  test('a non-integer literal degree is NaN where the interpreter has no value', () => {
    expect(run(['HermiteH', 2.5, 'x'])({ x: 0.5 })).toBeNaN();
    expect(run(['LaguerreL', 2.5, 'a', 'x'])({ a: 1, x: 0.5 })).toBeNaN();
  });

  test('GLSL and interval declines the three operands', () => {
    for (const to of ['glsl', 'interval-js'])
      expect(() => run(['LaguerreL', 'n', 'a', 'x'], to)).toThrow(
        /Could not compile/
      );
  });

  test('a degree that is not declared an integer still compiles', () => {
    const open = new ComputeEngine();
    open.declare('x', 'real');
    for (const to of ['javascript', 'glsl'])
      for (const head of heads) {
        const r = compile(open.box([head, 'n', 'x'] as never), {
          to,
          fallback: false,
        } as never);
        expect(r.success).toBe(true);
      }
    const f = compile(open.box(['HermiteH', 'n', 'x'] as never), {
      fallback: false,
    } as never).run as unknown as (v: Record<string, number>) => number;
    expect(f({ n: 3, x: 0.5 })).toBe(-5);
    // No value where the interpreter leaves the call unevaluated
    expect(f({ n: 2.5, x: 0.5 })).toBeNaN();
  });
});
