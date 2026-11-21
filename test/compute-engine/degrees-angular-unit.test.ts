/**
 * A degree literal (`30^\circ`, parsed as `Degrees(30)`) is an angle in the
 * engine's `angularUnit`: `Degrees` converts degrees to that unit, and the
 * trigonometric functions then read the value in that same unit. So
 * `\sin(30^\circ)` is `1/2` whatever the unit.
 *
 * Before this was pinned, `Degrees` always converted to RADIANS, and in
 * grad or turn mode `\sin(30^\circ)` read `π/6` as grads (0.0082) or as
 * turns (−0.1477).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** `compile()` to `interval-js`, with the call shape of a target's `compile()`. */
const INTERVAL_JS = {
  compile: (expr: any, options: Record<string, unknown> = {}) =>
    compile(expr, { ...options, to: 'interval-js' } as any) as any,
};

const JS = {
  compile: (expr: any) =>
    compile(expr, { to: 'javascript', fallback: false } as any) as any,
};

type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';
const UNITS: AngularUnit[] = ['rad', 'deg', 'grad', 'turn'];

function engine(unit: AngularUnit): ComputeEngine {
  const ce = new ComputeEngine();
  ce.angularUnit = unit;
  return ce;
}

describe('DEGREE LITERALS IN EVERY ANGULAR UNIT', () => {
  test.each(UNITS)('%s: exact special values', (unit) => {
    const ce = engine(unit);
    expect(ce.parse('\\sin(30^\\circ)').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\cos(60^\\circ)').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\tan(45^\\circ)').evaluate().toString()).toBe('1');
    expect(ce.parse('\\sin(90^\\circ)').evaluate().toString()).toBe('1');
  });

  test.each(UNITS)('%s: numeric values', (unit) => {
    const ce = engine(unit);
    expect(ce.parse('\\sin(30^\\circ)').N().re).toBeCloseTo(0.5, 12);
    expect(ce.parse('\\cos(60^\\circ)').N().re).toBeCloseTo(0.5, 12);
    expect(ce.parse('\\tan(45^\\circ)').N().re).toBeCloseTo(1, 12);
  });

  test.each(UNITS)('%s: degree literal on an assigned symbol', (unit) => {
    const ce = engine(unit);
    ce.assign('y', 30);
    expect(ce.parse('\\sin(y^\\circ)').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\sin(y^\\circ)').N().re).toBeCloseTo(0.5, 12);
  });

  test.each(UNITS)('%s: DMS', (unit) => {
    const ce = engine(unit);
    expect(ce.box(['Sin', ['DMS', 30]]).evaluate().toString()).toBe('1/2');
    expect(ce.box(['Sin', ['DMS', 29, 60]]).evaluate().toString()).toBe(
      '1/2'
    );
    expect(ce.parse("\\sin(29^\\circ 60')").evaluate().toString()).toBe('1/2');
  });

  test('the literal is converted to the engine unit', () => {
    expect(engine('rad').box(['Degrees', 30]).toString()).toBe('1/6 * pi');
    expect(engine('deg').box(['Degrees', 30]).toString()).toBe('30');
    expect(engine('grad').box(['Degrees', 30]).toString()).toBe('100/3');
    expect(engine('turn').box(['Degrees', 30]).toString()).toBe('1/12');
    // The evaluate handler agrees with the canonical handler.
    expect(engine('grad').box(['Degrees', 'Pi']).evaluate().toString()).toBe(
      '10/9 * pi'
    );
    expect(engine('turn').box(['Degrees', 'Pi']).evaluate().toString()).toBe(
      '1/360 * pi'
    );
  });

  test.each(['rad', 'grad', 'turn'] as AngularUnit[])(
    '%s: a symbolic degree literal round-trips through LaTeX',
    (unit) => {
      const ce = engine(unit);
      const expr = ce.parse('x^\\circ');
      expect(expr.json).toEqual(['Degrees', 'x']);
      expect(expr.latex).toBe('x^{\\circ}');
      expect(ce.parse(expr.latex).json).toEqual(['Degrees', 'x']);
    }
  );

  test('deg: a symbolic degree literal is the angle itself', () => {
    // In degree mode `Degrees` is the identity, so the wrapper disappears.
    expect(engine('deg').parse('x^\\circ').json).toBe('x');
  });
});

describe('DEGREE LITERALS — compiled output agrees with evaluate()', () => {
  test.each(UNITS)('%s: javascript', (unit) => {
    const ce = engine(unit);
    // In degree mode `x^\circ` is the bare input `x`, which has no type of
    // its own.
    ce.declare('x', 'real');
    const js = JS;
    expect(js.compile(ce.parse('\\sin(x^\\circ)')).run!({ x: 30 })).toBeCloseTo(
      0.5,
      12
    );
    // A bare degree literal compiles to its value in the engine unit.
    expect(js.compile(ce.parse('x^\\circ')).run!({ x: 30 })).toBeCloseTo(
      ce.parse('x^\\circ').subs({ x: 30 }).N().re,
      12
    );
  });

  test.each(UNITS)('%s: interval-js', (unit) => {
    const ce = engine(unit);
    const ijs = INTERVAL_JS;
    const r = ijs.compile(ce.parse('\\sin(x^\\circ)')).run!({ x: 30 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeLessThanOrEqual(0.5);
    expect(r.value.hi).toBeGreaterThanOrEqual(0.5);
    expect(r.value.hi - r.value.lo).toBeLessThan(1e-12);
  });

  test('rad: interval-js encloses π/180', () => {
    const ce = engine('rad');
    const ijs = INTERVAL_JS;
    const r = ijs.compile(ce.parse('x^\\circ')).run!({ x: 1 }) as {
      value: { lo: number; hi: number };
    };
    // π/180 = 0.017453292519943295769236907684886…; the double nearest to
    // it is the same as `Math.PI / 180`, so the enclosure must be wider.
    expect(r.value.lo).toBeLessThan(Math.PI / 180);
    expect(r.value.hi).toBeGreaterThan(Math.PI / 180);
  });
});

/**
 * `Argument` (the phase angle of a complex number) gives an angle in the
 * engine's `angularUnit`, as the inverse trigonometric functions do. Before
 * this was pinned, in degree mode `Argument(-1)` was `π` (radians, from the
 * real-axis branches of the evaluate handler) while `Argument(i)` was `90`
 * (through `Arctan2`, which follows the unit), and the compiled `Argument`
 * always returned radians.
 */
describe('ARGUMENT IN EVERY ANGULAR UNIT', () => {
  // The exact half turn and quarter turn in each unit, as `toString()`
  // prints them, and the factor that converts radians to the unit.
  const HALF: Record<AngularUnit, string> = {
    rad: 'pi',
    deg: '180',
    grad: '200',
    turn: '1/2',
  };
  const QUARTER: Record<AngularUnit, string> = {
    rad: '1/2 * pi',
    deg: '90',
    grad: '100',
    turn: '1/4',
  };
  const EIGHTH: Record<AngularUnit, string> = {
    rad: '1/4 * pi',
    deg: '45',
    grad: '50',
    turn: '1/8',
  };
  const FACTOR: Record<AngularUnit, number> = {
    rad: 1,
    deg: 180 / Math.PI,
    grad: 200 / Math.PI,
    turn: 1 / (2 * Math.PI),
  };

  test.each(UNITS)('%s: exact values', (unit) => {
    const ce = engine(unit);
    expect(ce.box(['Argument', -1]).evaluate().toString()).toBe(HALF[unit]);
    expect(ce.box(['Argument', 0]).evaluate().toString()).toBe('0');
    expect(ce.box(['Argument', 3]).evaluate().toString()).toBe('0');
    expect(ce.parse('\\arg(i)').evaluate().toString()).toBe(QUARTER[unit]);
    expect(ce.parse('\\arg(1+i)').evaluate().toString()).toBe(EIGHTH[unit]);
    // A constant sum on the negative real axis takes the real-axis branch.
    expect(ce.parse('\\arg(\\sqrt{2}-\\pi)').evaluate().toString()).toBe(
      HALF[unit]
    );
    expect(
      ce.box(['Argument', 'NegativeInfinity']).evaluate().toString()
    ).toBe(HALF[unit]);
    // The `Arg` alias and `AbsArg` give the same angle.
    expect(ce.box(['Arg', -1]).evaluate().toString()).toBe(HALF[unit]);
    expect(ce.box(['AbsArg', -2]).evaluate().toString()).toBe(
      `(2, ${HALF[unit]})`
    );
  });

  test.each(UNITS)('%s: numeric values and float operands', (unit) => {
    const ce = engine(unit);
    const k = FACTOR[unit];
    expect(ce.box(['Argument', -1]).N().re).toBeCloseTo(Math.PI * k, 12);
    expect(ce.box(['Argument', 0]).N().re).toBe(0);
    // A float operand numericizes under evaluate() too.
    expect(ce.box(['Argument', -5.1]).evaluate().re).toBeCloseTo(
      Math.PI * k,
      12
    );
    expect(
      ce.box(['Argument', ['Complex', 1.5, 2.5]]).evaluate().re
    ).toBeCloseTo(Math.atan2(2.5, 1.5) * k, 12);
    expect(ce.parse('\\arg(-1-i)').N().re).toBeCloseTo(
      Math.atan2(-1, -1) * k,
      12
    );
    expect(ce.parse('\\arg(1+\\sqrt{2}i)').N().re).toBeCloseTo(
      Math.atan2(Math.SQRT2, 1) * k,
      12
    );
  });

  test.each(UNITS)('%s: a symbol stays symbolic', (unit) => {
    const ce = engine(unit);
    expect(ce.parse('\\arg(x)').evaluate().toString()).toBe('Argument(x)');
  });

  // Under `.N()`, exact operands give the exact angle in the unit before it
  // is rounded: in degrees the angle of `i` is `90`, not
  // `89.9999999999999999999` (the float angle in radians times the float
  // `180/π`).
  const QUARTER_TURN: Partial<Record<AngularUnit, number>> = {
    deg: 90,
    grad: 100,
    turn: 0.25,
  };
  test.each(['deg', 'grad', 'turn'] as AngularUnit[])(
    '%s: N() of an exact angle on an axis is exact',
    (unit) => {
      const ce = engine(unit);
      const q = QUARTER_TURN[unit]!;
      expect(ce.box(['Argument', 'ImaginaryUnit']).N().re).toBe(q);
      expect(ce.box(['Arctan2', 1, 0]).N().re).toBe(q);
      expect(ce.box(['Arctan2', -1, 0]).N().re).toBe(-q);
      expect(ce.box(['Arctan2', 0, -1]).N().re).toBe(2 * q);
      expect(ce.box(['Arctan2', 1, -1]).N().re).toBe(1.5 * q);
      expect(
        ce.box(['Equal', ['N', ['Argument', 'ImaginaryUnit']], q]).evaluate()
          .symbol
      ).toBe('True');
    }
  );

  // A symbol with a known sign has no float angle: the exact angle answers,
  // in every unit.
  test.each(UNITS)('%s: N() of Arctan2 of a positive symbol', (unit) => {
    const ce = engine(unit);
    ce.assume(ce.parse('x > 0'));
    const q = unit === 'rad' ? Math.PI / 2 : QUARTER_TURN[unit]!;
    expect(ce.box(['Arctan2', 'x', 0]).N().re).toBeCloseTo(q, 15);
    expect(ce.box(['Arctan2', 'x', 'x']).N().re).toBeCloseTo(q / 2, 15);
    expect(ce.box(['Arctan2', 0, 'x']).N().re).toBe(0);
  });

  // Without a numeric exact angle, the float angle answers.
  test('deg: N() of Arctan2 with no special angle, and of a symbol', () => {
    const ce = engine('deg');
    expect(ce.box(['Arctan2', 2, 3]).N().toString()).toBe(
      '33.6900675259797869135'
    );
    expect(ce.box(['Arctan2', 'x', 1]).N().toString()).toBe('Arctan2(x, 1)');
  });

  test.each(UNITS)(
    '%s: the angles inside Ln, Sqrt and ComplexRoots stay in radians',
    (unit) => {
      const ce = engine(unit);
      const ln = ce.parse('\\ln(-1)').N();
      expect(ln.re).toBeCloseTo(0, 12);
      expect(ln.im).toBeCloseTo(Math.PI, 12);
      expect(ce.parse('\\ln(1+i)').N().im).toBeCloseTo(Math.PI / 4, 12);
      expect(ce.parse('\\sqrt{-4}').evaluate().toString()).toBe('2i');
      expect(ce.box(['ComplexRoots', -8, 3]).evaluate().toString()).toBe(
        '[1 + sqrt(3)i,-2,1 - sqrt(3)i]'
      );
    }
  );
});

describe('ARGUMENT — compiled output agrees with .N()', () => {
  const POINTS: [number, number][] = [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [-2, 0],
    [3, 0],
    [0.5, -2.5],
  ];
  // The value of `Argument(x + iy)` given by the interpreter.
  const interpreted = (ce: ComputeEngine, x: number, y: number) =>
    ce.box(['Argument', ['Complex', x, y]]).N().re;

  test.each(UNITS)('%s: javascript', (unit) => {
    const ce = engine(unit);
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const js = JS;
    const parts = js.compile(
      ce.box(['Argument', ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']]])
    ).run!;
    const real = js.compile(ce.box(['Argument', 'x'])).run!;
    ce.declare('z', 'complex');
    const complex = js.compile(ce.box(['Argument', 'z'])).run!;
    for (const [x, y] of POINTS) {
      const expected = interpreted(ce, x, y);
      expect(parts({ x, y }) as number).toBeCloseTo(expected, 12);
      expect(complex({ z: { re: x, im: y } }) as number).toBeCloseTo(
        expected,
        12
      );
      if (y === 0) expect(real({ x }) as number).toBeCloseTo(expected, 12);
    }
    // A constant operand is folded at compile time, in the engine unit.
    expect(js.compile(ce.box(['Argument', -1])).run!({}) as number).toBeCloseTo(
      ce.box(['Argument', -1]).N().re,
      12
    );
  });

  test.each(UNITS)('%s: interval-js', (unit) => {
    const ce = engine(unit);
    const ijs = INTERVAL_JS;
    const parts = ijs.compile(
      ce.box(['Argument', ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']]])
    ).run!;
    for (const [x, y] of POINTS) {
      const expected = interpreted(ce, x, y);
      const r = parts({ x, y }) as {
        kind: string;
        value: { lo: number; hi: number };
      };
      // A complex value declines on interval-js: the interpreter fallback
      // gives a point only for a value that is exactly a double.
      if (r.kind === 'entire') continue;
      expect(r.kind).toBe('interval');
      expect(r.value.lo).toBeLessThanOrEqual(expected + 1e-12);
      expect(r.value.hi).toBeGreaterThanOrEqual(expected - 1e-12);
      expect(r.value.hi - r.value.lo).toBeLessThan(1e-9);
    }
  });
});

describe('Sinc does not depend on the angular unit', () => {
  // Sinc(x) = sin(x)/x with x in radians, whatever the angular unit. Its
  // exact branch computes `Sin` of the operand, and `Sin` reads its operand
  // in `ce.angularUnit`, so the branch converts the operand from radians to
  // that unit first. Without the conversion, in degrees `Sin(30)` is 1/2,
  // which made `Sinc(10·Floor(π))` 1/60 instead of −0.0329. With the
  // conversion, the exact values `Sinc(π) = 0` and `Sinc(π/2) = 2/π` are kept
  // in every unit.
  test.each(['rad', 'deg', 'grad', 'turn'])('%s', (unit) => {
    const ce = new ComputeEngine();
    ce.angularUnit = unit as 'rad' | 'deg' | 'grad' | 'turn';
    const v = ce.box(['Sinc', ['Multiply', 10, ['Floor', 'Pi']]]);
    expect(v.evaluate().N().re).toBeCloseTo(Math.sin(30) / 30, 12);
    expect(v.N().re).toBeCloseTo(Math.sin(30) / 30, 12);
    expect(ce.box(['Sinc', ['Divide', 'Pi', 2]]).evaluate().N().re).toBeCloseTo(
      2 / Math.PI,
      12
    );
    expect(ce.box(['Sinc', 'Pi']).evaluate().toString()).toBe('0');
    expect(ce.box(['Sinc', 'Pi']).N().toString()).toBe('0');
    expect(ce.box(['Sinc', ['Divide', 'Pi', 2]]).evaluate().toString()).toBe(
      '2 / pi'
    );
    expect(
      ce.box(['Sinc', ['Divide', 'Pi', 3]]).evaluate().toString()
    ).toBe('3sqrt(3) / (2pi)');
  });
});
