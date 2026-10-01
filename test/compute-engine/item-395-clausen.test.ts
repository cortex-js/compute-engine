/**
 * #395: `ClausenCl(n, θ)`, the Clausen functions Clₙ(θ) = Im Liₙ(e^{iθ})
 * (even n) and Re Liₙ(e^{iθ}) (odd n). Reference values are mpmath's
 * `clsin`/`clcos`, which agree with Wolfram's Im/Re `PolyLog[n, E^(I θ)]`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { clausen } from '../../src/compute-engine/numerics/clausen';

const ce = new ComputeEngine();

// [n, θ, mpmath value]
const values: [number, number, number][] = [
  [1, 0.1, 2.303001794388447],
  [1, 2.5, -0.64078449284416],
  [1, -1.2, -0.12158464197660519],
  [1, 7.5, -0.13376367344434573],
  [1, 0.001, 6.907755320648804],
  [2, 0.1, 0.3302723988828167],
  [2, 1, 1.0139591323607684],
  [2, 2.5, 0.4335982032355328],
  [2, 4, -0.5681439444298698],
  [2, -1.2, -1.0053898137648567],
  [2, 7.5, 1.0032427051361714],
  [2, 0.001, 0.007907755292871027],
  [2, 3.14159, 1.83932828354511e-6],
  [3, 0.1, 1.1830436304608267],
  [3, 2.5, -0.7606561109685137],
  [3, 4, -0.6518926267198991],
  [3, -1.2, 0.24609343361388586],
  [3, 0.001, 1.2020526992819514],
  [3, 3.14159, -0.9015426773672554],
  [4, 0.1, 0.1195163636336284],
  [4, 2.5, 0.5481400618844826],
  [4, 4, -0.70179798183542],
  [4, 0.001, 0.0012020554463114915],
  [4, 3.14159, 2.3923244468349423e-6],
  [5, 1, 0.5228208076420943],
  [5, 7.5, 0.31977644158923824],
  [8, 0.1, 0.10066220651994497],
  [8, 2.5, 0.5948611027437986],
  [8, 3.14159, 2.6339368293757717e-6],
  [11, 4, -0.6537101214165743],
  [11, 3.14159, -0.9995171434945467],
];

/** Relative error against the reference, the digits a double kernel carries. */
const close = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-13 * Math.max(1, Math.abs(expected)) ||
  Math.abs(actual - expected) <= 1e-12 * Math.abs(expected);

describe('ClausenCl kernel', () => {
  for (const [n, theta, expected] of values)
    test(`Cl_${n}(${theta}) = ${expected}`, () => {
      expect(close(clausen(n, theta), expected)).toBe(true);
    });

  test('Cl_n(θ) is 2π-periodic', () => {
    expect(clausen(3, 1 + 2 * Math.PI)).toBeCloseTo(clausen(3, 1), 12);
    expect(clausen(2, 1 - 6 * Math.PI)).toBeCloseTo(clausen(2, 1), 12);
  });

  test('even orders are odd in θ, odd orders are even', () => {
    expect(clausen(2, -0.7)).toBeCloseTo(-clausen(2, 0.7), 14);
    expect(clausen(5, -0.7)).toBeCloseTo(clausen(5, 0.7), 14);
  });

  test('declines outside its domain', () => {
    expect(clausen(0, 1)).toBeNaN();
    expect(clausen(-2, 1)).toBeNaN();
    expect(clausen(2.5, 1)).toBeNaN();
    expect(clausen(171, 1)).toBeNaN();
    expect(clausen(2, Infinity)).toBeNaN();
  });

  test('Cl_1(0) = +∞', () => {
    expect(clausen(1, 0)).toBe(Infinity);
    expect(clausen(1, 2 * Math.PI)).toBe(Infinity);
  });
});

describe('ClausenCl evaluate and N', () => {
  const exact: [string, string][] = [
    ['["ClausenCl", 2, 0]', '0'],
    ['["ClausenCl", 4, 0]', '0'],
    ['["ClausenCl", 1, 0]', '+oo'],
    ['["ClausenCl", 2, "Pi"]', '0'],
    ['["ClausenCl", 6, "Pi"]', '0'],
  ];
  for (const [input, expected] of exact)
    test(`${input}.evaluate() = ${expected}`, () => {
      expect(ce.box(JSON.parse(input)).evaluate().toString()).toBe(expected);
    });

  test("Cl_2(π/2) = Catalan's constant", () => {
    expect(ce.box(['ClausenCl', 2, ['Divide', 'Pi', 2]]).evaluate().json).toBe(
      'CatalanConstant'
    );
  });

  test('odd orders at 0 are ζ(n) and at π are −η(n)', () => {
    expect(ce.box(['ClausenCl', 3, 0]).N().re).toBeCloseTo(
      1.2020569031595942,
      14
    );
    expect(ce.box(['ClausenCl', 3, 'Pi']).N().re).toBeCloseTo(
      -0.9015426773696957,
      14
    );
    expect(ce.box(['ClausenCl', 3, ['Divide', 'Pi', 2]]).N().re).toBeCloseTo(
      -(3 / 32) * 1.2020569031595942,
      14
    );
    expect(ce.box(['ClausenCl', 1, ['Divide', 'Pi', 2]]).N().re).toBeCloseTo(
      -Math.LN2 / 2,
      14
    );
  });

  test('N(ClausenCl(2, 1)) = 1.0139591323607684', () => {
    expect(ce.box(['ClausenCl', 2, 1]).N().re).toBeCloseTo(
      1.0139591323607684,
      13
    );
  });

  test('ClausenCl(2, 1) stays exact under evaluate()', () => {
    expect(ce.box(['ClausenCl', 2, 1]).evaluate().operator).toBe('ClausenCl');
  });

  test('a float operand gives a float: ClausenCl(2, 1.25) = 0.9984130668031057', () => {
    expect(ce.box(['ClausenCl', 2, 1.25]).evaluate().re).toBeCloseTo(
      0.9984130668031057,
      13
    );
    expect(ce.box(['ClausenCl', 3, 1.25]).evaluate().re).toBeCloseTo(
      0.19599094844799589,
      13
    );
  });

  test('rational θ: Cl_2(1/3) = 0.7000521189884235', () => {
    expect(ce.box(['ClausenCl', 2, ['Rational', 1, 3]]).N().re).toBeCloseTo(
      0.7000521189884235,
      13
    );
  });

  test('parse route: \\operatorname{ClausenCl}(2, 1)', () => {
    const e = ce.parse('\\operatorname{ClausenCl}(2, 1)');
    expect(e.operator).toBe('ClausenCl');
    expect(e.N().re).toBeCloseTo(1.0139591323607684, 13);
  });

  test('compound argument reducing to a literal: ClausenCl(2, x - x)', () => {
    expect(
      ce
        .box(['ClausenCl', 2, ['Subtract', 'x', 'x']])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  const unevaluated: [string, string][] = [
    ['order 0', '["ClausenCl", 0, 1]'],
    ['negative order', '["ClausenCl", -2, 1]'],
    ['symbolic order', '["ClausenCl", "n", 1]'],
    ['symbolic θ', '["ClausenCl", 2, "t"]'],
  ];
  test('a non-integer order or a complex θ is rejected at boxing', () => {
    expect(ce.box(['ClausenCl', ['Rational', 3, 2], 1]).isValid).toBe(false);
    expect(ce.box(['ClausenCl', 2, ['Complex', 1, 1]]).isValid).toBe(false);
  });

  for (const [name, input] of unevaluated)
    test(`${name} stays unevaluated`, () => {
      expect(ce.box(JSON.parse(input)).N().operator).toBe('ClausenCl');
    });
});

describe('ClausenCl routes agree', () => {
  // Cl_n(θ) = Im/Re Li_n(e^{iθ}); the native PolyLog is the cross-check.
  for (const n of [2, 3, 4, 5])
    for (const theta of [0.3, 1.7, 2.9, -2.2]) {
      test(`Cl_${n}(${theta}) matches ${n % 2 === 0 ? 'Im' : 'Re'} PolyLog(${n}, e^{iθ})`, () => {
        const li = ce
          .box(['PolyLog', n, ['Exp', ['Multiply', 'ImaginaryUnit', theta]]])
          .N();
        const expected = n % 2 === 0 ? li.im : li.re;
        const actual = ce.box(['ClausenCl', n, theta]).N().re;
        expect(Math.abs(actual - expected)).toBeLessThan(1e-12);
      });
    }

  test('compiled JavaScript agrees with N()', () => {
    const fn = compile(ce.box(['ClausenCl', 3, 'x']));
    expect(fn.success).toBe(true);
    const run = fn.run as (v: { x: number }) => number;
    expect(run({ x: 2.5 })).toBeCloseTo(-0.7606561109685137, 13);
    expect(run({ x: 0.1 })).toBeCloseTo(1.1830436304608267, 13);
  });
});
