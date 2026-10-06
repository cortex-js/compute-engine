import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * The step form of `Floor`, `Ceil` and `Truncate`: with a second argument,
 * the value is rounded to a multiple of that step instead of an integer.
 * `Floor(x, step)` is the greatest multiple of the step that is at most `x`,
 * `Ceil(x, step)` the least multiple that is at least `x`, and
 * `Truncate(x, step)` the multiple nearest to `x` in the direction of zero.
 * The sign of the step does not matter: the multiples of `−2` are the
 * multiples of `2`. A zero step has no multiple to round to: the result is
 * `Indeterminate` (`NaN` with a float operand), as for `Mod(x, 0)`.
 *
 * Requested in cortex-js/compute-engine#417 (`Floor[226, 10]` is `220` in
 * Mathematica).
 */

const ce = new ComputeEngine();

const value = (expr: unknown) =>
  ce
    .box(expr as never)
    .evaluate()
    .toString();

describe('the value of the step form', () => {
  test.each([
    [['Floor', 226, 10], '220'],
    [['Ceil', 226, 10], '230'],
    [['Truncate', 226, 10], '220'],
    [['Floor', -226, 10], '-230'],
    [['Ceil', -226, 10], '-220'],
    [['Truncate', -226, 10], '-220'],
    [['Floor', 230, 10], '230'],
    // The sign of the step does not matter.
    [['Floor', 7, -2], '6'],
    [['Ceil', 7, -2], '8'],
    [['Truncate', -7, -2], '-6'],
  ])('%j is %s', (expr, want) => expect(value(expr)).toBe(want));

  test('an exact step gives an exact result, also for a float operand', () => {
    expect(value(['Floor', 2.7, ['Rational', 1, 2]])).toBe('5/2');
    expect(value(['Ceil', 'Pi', ['Rational', 1, 100]])).toBe('63/20');
    expect(value(['Floor', 5, ['Sqrt', 2]])).toBe('3sqrt(2)');
  });

  test('a float step gives a float result', () => {
    const r = ce.box(['Floor', 2.7, 0.5]).evaluate();
    expect(r.toString()).toBe('2.5');
    expect(r.isExact).toBe(false);
  });

  test('a zero step is Indeterminate, or NaN with a float operand', () => {
    expect(value(['Floor', 5, 0])).toBe('Indeterminate');
    expect(value(['Ceil', 5.5, 0])).toBe('NaN');
  });

  test('an infinite or NaN operand', () => {
    expect(value(['Floor', 'PositiveInfinity', 2])).toBe('+oo');
    expect(value(['Truncate', 'NegativeInfinity', 2])).toBe('-oo');
    expect(value(['Floor', 'NaN', 2])).toBe('NaN');
    expect(value(['Floor', 5, 'NaN'])).toBe('NaN');
  });

  test('a symbolic operand or step stays unevaluated', () => {
    expect(value(['Floor', 'x', 10])).toBe('floor(x, 10)');
    expect(value(['Floor', 226, 'a'])).toBe('floor(226, a)');
  });

  test('over a list', () => {
    expect(
      value(['Floor', ['List', 1.25, 2.5, 3.75], ['Rational', 1, 2]])
    ).toBe('[1,5/2,7/2]');
  });
});

describe('the step form under N', () => {
  // `.N()` approximates the step before the handler runs. The exact step and
  // the exact operand are used: the float of `1/3` makes `1/(1/3)` the
  // float `2.999…`, whose floor is `2`, not `3`.
  test('a scalar', () => {
    expect(
      ce
        .box(['Floor', 1, ['Rational', 1, 3]])
        .N()
        .toString()
    ).toBe('1');
    expect(
      ce.box(['Ceil', ['Rational', 2, 3], ['Rational', 1, 3]]).N().re
    ).toBeCloseTo(2 / 3, 15);
  });

  test('a list of 6 elements (an eager broadcast)', () => {
    const r = ce
      .box(['Floor', ['Divide', ['Range', 1, 6], 3], ['Rational', 1, 3]])
      .N();
    expect([...r.each()].map((x) => x.re * 3)).toEqual(
      [1, 2, 3, 4, 5, 6].map((k) => expect.closeTo(k, 12))
    );
  });

  test('a list of 300 elements (a lazy broadcast)', () => {
    const r = ce
      .box(['Floor', ['Divide', ['Range', 1, 300], 3], ['Rational', 1, 3]])
      .N();
    expect(
      [...r.each()].slice(0, 6).map((x) => Math.round(x.re * 3 * 1e9) / 1e9)
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('the type of the step form', () => {
  const engine = new ComputeEngine();
  engine.declare('r', 'real');
  engine.declare('n', 'number');
  engine.declare('a', 'real');
  const type = (expr: unknown) => engine.box(expr as never).type.toString();

  test('the one-argument form is still integer-valued', () => {
    expect(type(['Floor', 'r'])).toBe('integer');
    expect(type(['Ceil', 'n'])).toBe('integer | nan | signed_infinity');
    expect(type(['Truncate', 'NaN'])).toBe('nan');
  });

  test('a multiple of an integer step is an integer, of a rational step a rational', () => {
    expect(type(['Floor', 'r', 10])).toBe('integer');
    expect(type(['Floor', 'r', ['Rational', 1, 2]])).toBe('rational');
    expect(type(['Floor', 'r', 0.5])).toBe('real');
  });

  test('a step that may be zero adds the nan arm', () => {
    expect(type(['Floor', 'r', 'a'])).toBe('nan | real');
    expect(type(['Floor', 'r', 0])).toBe('nan');
    expect(type(['Floor', 'r', 'NaN'])).toBe('nan');
  });
});

describe('the sign of the step form', () => {
  const sgn = (expr: unknown) => ce.box(expr as never).sgn;

  test('Floor is positive from the step on, and zero below it', () => {
    expect(sgn(['Floor', 10, 10])).toBe('positive');
    expect(sgn(['Floor', 9, 10])).toBe('zero');
    expect(sgn(['Floor', ['Rational', -1, 2], 10])).toBe('negative');
  });

  test('Ceil and Truncate', () => {
    expect(sgn(['Ceil', -9, 10])).toBe('zero');
    expect(sgn(['Ceil', -10, -10])).toBe('negative');
    expect(sgn(['Truncate', -9, 10])).toBe('zero');
    expect(sgn(['Truncate', 10, 10])).toBe('positive');
  });
});

describe('LaTeX', () => {
  test('the step form is written as a function, and it parses back', () => {
    for (const [expr, latex] of [
      [['Floor', 'x', 10], '\\mathrm{floor}(x, 10)'],
      [['Ceil', 'x', 10], '\\mathrm{ceil}(x, 10)'],
    ] as const) {
      const boxed = ce.box(expr as never);
      expect(boxed.latex).toBe(latex);
      expect(ce.parse(latex).isSame(boxed)).toBe(true);
    }
  });

  test('the one-argument form keeps its brackets', () => {
    expect(ce.box(['Floor', 'x']).latex).toBe('\\lfloor x\\rfloor');
    expect(ce.box(['Ceil', 'x']).latex).toBe('\\lceil x\\rceil');
  });
});

describe('compiled code', () => {
  const xs = [226, -226, 7, -7, 2.7, -2.7, 0, 225, 3.25, 0.3, 0.7, -0.3, 1.05];
  // The decimal steps have no exact double: `0.3 / 0.1` is
  // `2.9999999999999996`, and the compiled code takes such a quotient to
  // the nearest integer, as the interpreter's decimal division finds it.
  const steps = [10, -2, 0.5, 4, 0.1, 0.01, 0.05, 0.3];
  const near = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

  test.each(['Floor', 'Ceil', 'Truncate'])(
    '%s in JavaScript and interval JavaScript matches the interpreter',
    (h) => {
      const runtime = compile(ce.box([h, 'x', 'a']), { fallback: false });
      for (const a of steps) {
        const constant = compile(ce.box([h, 'x', a]), { fallback: false });
        const interval = compile(ce.box([h, 'x', a]), { to: 'interval-js' });
        for (const x of xs) {
          const want = ce.box([h, ce.number(x), ce.number(a)]).evaluate().re;
          const got = [constant.run!({ x }), runtime.run!({ x, a })];
          expect([h, x, a, got.every((v) => near(v, want))]).toEqual([
            h,
            x,
            a,
            true,
          ]);
          const r = interval.run!({ x: { lo: x, hi: x } }) as {
            value: { lo: number; hi: number };
          };
          expect(r.value.lo).toBeLessThanOrEqual(want + 1e-12);
          expect(r.value.hi).toBeGreaterThanOrEqual(want - 1e-12);
        }
      }
    }
  );

  test('JavaScript calls a runtime helper', () => {
    const f = compile(ce.box(['Floor', ['Add', 'x', 1], 10]), {
      fallback: false,
    });
    expect(f.code).toBe('_SYS.floorStep(_.x + 1, 10)');
    expect(f.run!({ x: 15 })).toBe(10);
  });

  test('a zero step is NaN in JavaScript, and the operand is evaluated', () => {
    expect(
      compile(ce.box(['Floor', 'x', 0]), { fallback: false }).run!({ x: 3 })
    ).toBeNaN();
    expect(
      compile(ce.box(['Floor', 'x', 'a']), { fallback: false }).run!({
        x: 3,
        a: 0,
      })
    ).toBeNaN();
    expect(
      compile(ce.box(['Floor', ['Random'], 0]), { fallback: false }).code
    ).toContain('Random');
  });

  test('a list operand in JavaScript', () => {
    const engine = new ComputeEngine();
    engine.declare('L', 'list<real>');
    const f = compile(engine.box(['Floor', 'L', 0.1]), { fallback: false });
    const r = f.run!({ L: [0.3, 0.7, 1.15] }) as number[];
    expect(r.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0.3, 0.7, 1.1]);
  });

  test('GLSL and WGSL', () => {
    const scalar = new GLSLTarget().compile(ce.box(['Floor', 'x', 0.1]), {});
    expect(scalar.code).toBe(
      '_gpu_step_fix(floor(_gpu_step_quotient(x, 0.1)) * 0.1, x, 0.1)'
    );
    expect(scalar.preamble).toContain('float _gpu_step_quotient(float x');
    expect(scalar.preamble).toContain('float _gpu_step_fix(float m');
    const engine = new ComputeEngine();
    engine.declare('v', 'vector<3>');
    const vector = new WGSLTarget().compile(
      engine.box(['Ceil', 'v', 0.5]),
      {}
    ).code;
    // The vector form is componentwise, with its quotients bound to
    // temporaries. Every choice is a `select` with vector operands on both
    // sides of each comparison (WGSL compares no vector with a scalar), so
    // an infinite value in the branch not taken cannot make the result
    // `NaN`. The last choice keeps `v` when the quotient overflows.
    expect(vector).toBe(
      'var _tv1: vec3f = (v / 0.5);\n' +
        'var _tv2: vec3f = select(_tv1, (sign(v) * 1.17549435e-38), ' +
        '_tv1 == vec3f(0.0));\n' +
        'var _tv3: vec3f = select(_tv2, round(_tv2), ' +
        'abs(_tv2 - round(_tv2)) <= 4.8e-7 * abs(_tv2));\n' +
        'return (select((ceil(_tv3) * 0.5), v, abs(_tv1) > vec3f(3.4e38)));'
    );
    // A shader has no NaN literal.
    expect(() =>
      new GLSLTarget().compile(ce.box(['Floor', 'x', 0]), {})
    ).toThrow(/no NaN literal/);
  });

  test('Python binds the operand and the step as arguments', () => {
    const python = new PythonTarget();
    const code = python.compileLambda(ce.box(['Floor', 'x', 'a']), ['x', 'a']);
    expect(code.startsWith('lambda x, a: (lambda _ce_x, _ce_k: ')).toBe(true);
    expect(code.endsWith('(np.asarray(x, dtype=float), np.abs(a))')).toBe(true);
  });

  test('a tiny quotient is not taken to be 0, and an extreme quotient keeps its value', () => {
    // The tolerance of the compiled quotient is relative to the quotient
    // only. A quotient that underflows keeps the sign of the operand, and
    // one that overflows gives the operand itself, the nearest double to
    // the multiple.
    for (const [h, x, a, want] of [
      ['Ceil', 1e-20, 1, 1],
      ['Floor', -1e-20, 1, -1],
      ['Ceil', 1e-300, 1e300, 1e300],
      ['Floor', -1e-300, 1e300, -1e300],
      ['Floor', 1e200, 1e-200, 1e200],
      ['Round', 1e-20, 1, 0],
    ] as const) {
      const f = compile(ce.box([h, 'x', 'a']), { fallback: false });
      expect([h, x, a, f.run!({ x, a }) + 0]).toEqual([h, x, a, want]);
      expect(ce.box([h, ce.number(x), ce.number(a)]).evaluate().re + 0).toBe(
        want
      );
    }
  });
});

describe('an exact constant step', () => {
  test('is rounded from enclosures of the quotient', () => {
    expect(value(['Floor', 10, 'Pi'])).toBe('3pi');
    expect(value(['Ceil', 10, 'Pi'])).toBe('4pi');
    expect(value(['Floor', 10, ['Negate', 'Pi']])).toBe('3pi');
    expect(value(['Floor', 'Pi', 'Pi'])).toBe('pi');
    expect(value(['Floor', 10, ['Sqrt', 2]])).toBe('7sqrt(2)');
  });

  test('with a float operand, the multiple is exact', () => {
    expect(value(['Floor', 7.5, 'Pi'])).toBe('2pi');
  });
});

describe('a step held by a symbol, under N', () => {
  test('the exact value of the step is used', () => {
    const engine = new ComputeEngine();
    engine.assign('a', engine.box(['Rational', 2, 3]));
    // `2/3 − 10⁻³⁰` is just below the step: its floor is 0. At 21 digits
    // the two floats are equal, and the floor was the step itself.
    expect(
      engine
        .box([
          'Floor',
          ['Subtract', ['Rational', 2, 3], ['Power', 10, -30]],
          'a',
        ])
        .N()
        .toString()
    ).toBe('0');
    engine.assign('b', engine.box(['Rational', 1, 3]));
    const r = engine.box(['Floor', ['Divide', ['Range', 1, 6], 3], 'b']).N();
    expect([...r.each()].map((x) => Math.round(x.re * 3 * 1e9) / 1e9)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('a broadcast of a jump operator under N uses its exact scalar operands', () => {
  // When an element of the list is near a jump, the cells are built from
  // the exact elements and from the exact scalar operands. The modulus was
  // approximated with the list, and some cells were `1e-21` or `0.333…`.
  test('Mod over a list of 6 and of 300 elements', () => {
    const small = ce
      .box(['Mod', ['Divide', ['Range', 1, 6], 3], ['Rational', 1, 3]])
      .N();
    expect([...small.each()].map((x) => x.re)).toEqual([0, 0, 0, 0, 0, 0]);
    const large = ce
      .box(['Mod', ['Divide', ['Range', 1, 300], 3], ['Rational', 1, 3]])
      .N();
    expect([...large.each()].slice(0, 6).map((x) => x.re)).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
  });
});

describe('the quotient of two floats', () => {
  // The quotient of two float literals is one division. It was a product
  // with the inverse of the divisor, which rounds twice.
  test('0.3/0.3 is 1, and Floor(0.3, 0.3) is 0.3', () => {
    expect(ce.number(0.3).div(ce.number(0.3)).toString()).toBe('1');
    expect(ce.box(['Divide', 0.3, 0.3]).N().toString()).toBe('1');
    expect(value(['Floor', 0.3, 0.3])).toBe('0.3');
  });

  test('a float divided by an exact rational multiplies by its exact inverse', () => {
    expect(ce.parse('0.3/(1/3)').evaluate().toString()).toBe('0.9');
    expect(value(['Floor', 1.0, ['Rational', 1, 7]])).toBe('1');
  });
});
