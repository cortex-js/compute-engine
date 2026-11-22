import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { exactOrder } from '../../src/compute-engine/boxed-expression/compare';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// `Arctan2` with a float operand is a float, also when the other operand is
// an exact constant that is not a number literal. And `exactOrder` (the
// order of `Max`, `Min` and `Sort`) has an error bound for `Arctan2`, so it
// orders a constant that holds one. Without them, a loop that keeps a
// `max(…)` of such a value (Tycho's black-hole showcase) held a symbolic
// `max` that grew at each pass, and took seconds for one point.

const ce = new ComputeEngine();

const COS_PI_60: MathJsonExpression = [
  'Cos',
  ['Multiply', ['Rational', 1, 60], 'Pi'],
];

describe('ARCTAN2 WITH A FLOAT OPERAND', () => {
  test.each([
    [[COS_PI_60, 0.5], 1.1065999300753556],
    [[0.5, COS_PI_60], 0.4641963967195411],
    [[COS_PI_60, -0.5], 2.0349927235144377],
    [[-0.5, COS_PI_60], -0.4641963967195411],
  ] as [MathJsonExpression[], number][])(
    'Arctan2%j',
    (ops: MathJsonExpression[], expected: number) => {
      const v = ce.box(['Arctan2', ...ops]).evaluate();
      expect(isNumber(v) && !v.isExact).toBe(true);
      expect(v.re).toBeCloseTo(expected, 14);
    }
  );

  test('an operand with an unknown keeps the call symbolic', () => {
    expect(ce.box(['Arctan2', 'x', 0.5]).evaluate().toString()).toBe(
      'Arctan2(x, 0.5)'
    );
  });
});

describe('THE ORDER OF A CONSTANT THAT HOLDS ARCTAN2', () => {
  const EPSILON: MathJsonExpression = ['Power', 10, -30];
  // sin(π + 10⁻³⁰) is −10⁻³⁰: the point is just under the negative x-axis,
  // where atan2 jumps from π to −π. Its value is about −π.
  const BELOW_CUT: MathJsonExpression = [
    'Arctan2',
    ['Sin', ['Add', 'Pi', EPSILON]],
    -1,
  ];
  // About π − 10⁻³⁰.
  const ABOVE_CUT: MathJsonExpression = [
    'Arctan2',
    ['Negate', ['Sin', ['Add', 'Pi', EPSILON]]],
    -1,
  ];

  test('a value in the second quadrant', () => {
    // atan2(cos(π/60), −√2) is 2.5267…
    const a = ce.box(['Arctan2', COS_PI_60, ['Negate', ['Sqrt', 2]]]);
    expect(exactOrder(a, ce.number(2.5))).toBe(1);
    expect(exactOrder(a, ce.number(2.6))).toBe(-1);
  });

  test('a value next to the branch cut is on its side of the cut', () => {
    expect(exactOrder(ce.box(BELOW_CUT), ce.number(0))).toBe(-1);
    expect(exactOrder(ce.box(ABOVE_CUT), ce.number(0))).toBe(1);
    expect(ce.box(['Max', BELOW_CUT, 0]).evaluate().toString()).toBe('0');
  });

  test('in degrees', () => {
    const e = new ComputeEngine();
    e.angularUnit = 'deg';
    // atan2(cos(π/60), −√2) is 144.73…°
    const a = e.box(['Arctan2', COS_PI_60, ['Negate', ['Sqrt', 2]]]);
    expect(exactOrder(a, e.number(144))).toBe(1);
    expect(exactOrder(a, e.number(145))).toBe(-1);
  });
});

describe('A LOOP THAT KEEPS THE MAX OF AN ANGLE', () => {
  // The shape of the black-hole showcase: an inclination that is an exact
  // multiple of π, a float coordinate, and twelve passes of a fixed-point
  // step with `max`.
  const source = `
function f(x: real, a: real) -> real {
  let inc = a*pi/180
  let psi = arctan2(cos(inc), -x*sin(inc))
  let r = max(x/max(sin(psi), 0.05), 1.5)
  for n in 1..12 {
    let s = sqrt(max(1 - (1 - (1 - cos(psi))*(1 - 1/r))^2, 0.000000001))
    r = max(x*sqrt(1 - 1/r)/s, 1.01)
  }
  r
}
`;
  function expected(x: number, a: number): number {
    const inc = (a * Math.PI) / 180;
    const psi = Math.atan2(Math.cos(inc), -x * Math.sin(inc));
    let r = Math.max(x / Math.max(Math.sin(psi), 0.05), 1.5);
    for (let n = 1; n <= 12; n++) {
      const c = 1 - (1 - Math.cos(psi)) * (1 - 1 / r);
      const s = Math.sqrt(Math.max(1 - c * c, 0.000000001));
      r = Math.max((x * Math.sqrt(1 - 1 / r)) / s, 1.01);
    }
    return r;
  }

  test.each([
    [0.75, 3],
    [5.5, 84],
  ])('f(%f, %i) is a number', (x, a) => {
    const engine = new ComputeEngine();
    executeEpsil(engine, source);
    for (const v of [
      engine.box(['f', x, a]).evaluate(),
      engine.box(['f', x, a]).N(),
    ]) {
      expect(isNumber(v)).toBe(true);
      expect(v.re).toBeCloseTo(expected(x, a), 12);
    }
  });
});
