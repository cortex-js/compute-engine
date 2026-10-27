// Value kinds, phase 3: the compiled form of the value kind `enclosure` on
// the `interval-js` target (`ENCLOSURE_COMPILE`,
// `src/compute-engine/library/enclosure-compile.ts`;
// `docs/plans/2026-10-26-value-kinds.md`, section 4.9.2, "Compilation", and
// the compile rows of its acceptance table).
//
// The compiled code calls the same kernel as the `.N()` route of the
// interpreter for the same form, so a closed expression gives the same
// doubles on the two routes. A row that names a value of the library is
// checked against `IntervalArithmetic` called directly.

import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import {
  IntervalArithmetic as IA,
  type Interval,
} from '../../src/compute-engine/interval';
import { createIntervalRuntime } from '../../src/compute-engine/compilation/interval-runtime';
import { INTERVAL_KIND } from '../../src/compute-engine/compilation/broadcast';
import { UNARY_RULES } from '../../src/compute-engine/library/enclosure-arithmetic';
import { ENCLOSURE_UNARY_KERNELS } from '../../src/compute-engine/library/enclosure-compile';

type Json = MathJsonExpression;

/** The message of a decline of the kind. */
const KIND = /kind type 'enclosure'/;

/** The message of a refused host value of `name`. */
const entryError = (name: string, type = 'enclosure'): string =>
  `"${name}" (type \`${type}\`) is compiled as a value of its kind type`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'enclosure');
  return ce;
}

/** The compilation of `x` on `interval-js`, which throws when it declines. */
function compileI(x: Expression, fallback = false) {
  return compile(x, { to: 'interval-js', fallback });
}

/** The compilation of `x` declines (`success: false`, as the `interval-js`
 * target reports a decline without `fallback`) with a message that matches
 * `message`. */
function expectDecline(x: Expression, message: RegExp | string): void {
  const result = compileI(x);
  expect(result.success).toBe(false);
  if (typeof message === 'string') expect(result.error).toContain(message);
  else expect(result.error).toMatch(message);
}

/** `run()` throws with a message that matches `message`, and no
 * `console.warn` is printed: a kind decline has no interpreter fallback, so
 * no "Compilation fallback" warning announces one. */
function expectThrowsWithoutWarning(run: () => unknown, message: RegExp): void {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(run).toThrow(message);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
}

/** The value of the `interval` result `r`. */
function valueOf(r: unknown): Interval {
  expect(r).toMatchObject({ kind: 'interval' });
  return (r as { value: Interval }).value;
}

/** The doubles of the enclosure `x`, the value of an `.N()`. */
function doublesOf(x: Expression): Interval {
  expect(x.operator).toBe('Enclosure');
  return { lo: x.ops![0].re, hi: x.ops![1].re };
}

/** The value of `r` mapped as the interpreter maps a library result. */
function enclosed(r: unknown): unknown {
  return IA.enclose(r as never);
}

describe('ENCLOSURE COMPILE: x + 1 with x: enclosure', () => {
  const ce = engine();
  const result = compileI(ce.parse('x + 1'));

  test('the type and the representation', () => {
    expect(ce.parse('x + 1').type.toString()).toBe('enclosure');
    expect(result.success).toBe(true);
    expect(result.freeSymbolTypes?.x).toMatchObject({
      type: 'enclosure',
      lowered: 'interval',
      provenance: 'declared',
    });
    expect(result.shippable).toBe(false);
    expect(result.valueKinds).toEqual(['enclosure']);
  });

  test('run', () => {
    expect(result.run({ x: { lo: 0, hi: 1 } } as never)).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 2 },
    });
    // A finite number is a point.
    expect(valueOf(result.run({ x: 2 } as never))).toEqual({ lo: 3, hi: 3 });
  });

  test('a host value that is not an enclosure throws at entry', () => {
    for (const x of [
      { lo: 1, hi: 0 },
      { lo: NaN, hi: 1 },
      { lo: Infinity, hi: Infinity },
      Infinity,
      NaN,
      'a',
      undefined,
    ])
      expect(() => result.run({ x } as never)).toThrow(entryError('x'));
    expect(() => result.run({} as never)).toThrow(entryError('x'));
    // An unbounded enclosure is admitted.
    expect(
      valueOf(result.run({ x: { lo: 0, hi: Infinity } } as never))
    ).toEqual({ lo: 1, hi: Infinity });
  });

  test('broadcast checks every cell before the loop', async () => {
    expect(() =>
      result.broadcast!({ x: new Float64Array([1, 0]) } as never)
    ).toThrow(entryError('x'));
    expect(() =>
      result.broadcast!({
        x: new Float64Array([0, 1, Infinity, Infinity]),
      } as never)
    ).toThrow(entryError('x'));
    await expect(
      result.broadcastAsync!({ x: new Float64Array([1, 0]) } as never)
    ).rejects.toThrow(entryError('x'));
    const out = result.broadcast!({
      x: new Float64Array([0, 1, 2, 3]),
    } as never);
    expect([...out.slice(0, 2)]).toEqual([1, 2]);
    expect([...out.slice(3, 5)]).toEqual([3, 4]);
    const asyncOut = await result.broadcastAsync!({
      x: new Float64Array([0, 1]),
    } as never);
    expect([...asyncOut.out.slice(0, 2)]).toEqual([1, 2]);
    expect(result.willUsePool?.({ x: new Float64Array([0, 1]) } as never)).toBe(
      false
    );
  });

  test('the stored code cannot be loaded', () => {
    const runtime = createIntervalRuntime();
    const message = "value kind type 'enclosure'";
    expect(() => runtime.load(result as never)).toThrow(message);
    expect(() => runtime.loadBroadcast(result as never)).toThrow(message);
    expect(() => runtime.loadBroadcastSlice(result as never)).toThrow(message);
  });

  test('the javascript target declines with the kind message', () => {
    expect(() =>
      compile(ce.parse('x + 1'), { to: 'javascript', fallback: false })
    ).toThrow(KIND);
  });

  test('a decline with an enclosure input throws, even with fallback', () => {
    expectThrowsWithoutWarning(
      () => compileI(ce.box(['Factorial', 'x']), true),
      KIND
    );
    expectDecline(ce.box(['Factorial', 'x']), KIND);
  });
});

describe('ENCLOSURE COMPILE: the runner', () => {
  test('y: real | missing keeps the absence reading of NaN', () => {
    const ce = engine();
    ce.declare('y', 'real | missing');
    const result = compileI(ce.parse('x + y'));
    expect(result.run({ x: { lo: 0, hi: 1 }, y: NaN } as never)).toEqual({
      kind: 'empty',
    });
  });

  test('x < y and Max(x, y) with y: number run with y: Infinity', () => {
    const ce = engine();
    ce.declare('y', 'number');
    expect(
      compileI(ce.parse('x < y')).run({
        x: { lo: 0, hi: 1 },
        y: Infinity,
      } as never)
    ).toBe('true');
    expect(
      compileI(ce.box(['Max', 'x', 'y'])).run({
        x: { lo: 0, hi: 1 },
        y: Infinity,
      } as never)
    ).toEqual({ kind: 'interval', value: { lo: Infinity, hi: Infinity } });
  });

  test('x + y, x * y and x / y with y: number run with y: Infinity', () => {
    const ce = engine();
    ce.declare('y', 'number');
    for (const json of [
      ['Add', 'x', 'y'],
      ['Multiply', 'x', 'y'],
      ['Divide', 'x', 'y'],
    ] as Json[])
      expect(
        compileI(ce.box(json)).run({
          x: { lo: 0, hi: 1 },
          y: Infinity,
        } as never)
      ).toEqual({ kind: 'empty' });
  });

  test('y: number | enclosure admits Infinity by its numeric arm', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'number | enclosure');
    const result = compileI(ce.parse('y + 1'));
    expect(result.run({ y: Infinity } as never)).toEqual({ kind: 'empty' });
    expect(valueOf(result.run({ y: { lo: 0, hi: 1 } } as never))).toEqual({
      lo: 1,
      hi: 2,
    });
    expect(() => result.run({ y: { lo: 1, hi: 0 } } as never)).toThrow(
      entryError('y', 'enclosure | number')
    );
    const out = result.broadcast!({
      y: new Float64Array([Infinity, Infinity]),
    } as never);
    expect(out[2]).toBe(INTERVAL_KIND.empty);
  });

  test('y: enclosure | nan admits NaN, and refuses Infinity', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'enclosure | nan');
    const result = compileI(ce.parse('y + 1'));
    expect(result.run({ y: NaN } as never)).toEqual({ kind: 'empty' });
    expect(() => result.run({ y: Infinity } as never)).toThrow(
      entryError('y', 'enclosure | nan')
    );
  });

  test('x + +oo and x + Max(x, +oo) are empty', () => {
    const ce = engine();
    expect(
      compileI(ce.box(['Add', 'x', 'PositiveInfinity'])).run({
        x: { lo: 0, hi: 1 },
      } as never)
    ).toEqual({ kind: 'empty' });
    expect(
      compileI(ce.box(['Add', 'x', ['Max', 'x', 'PositiveInfinity']])).run({
        x: { lo: 0, hi: 1 },
      } as never)
    ).toEqual({ kind: 'empty' });
  });

  test('x + 0.1 promotes the scalar by the outward conversion', () => {
    const ce = engine();
    const run = compileI(ce.parse('x + 0.1')).run({
      x: { lo: 0, hi: 0 },
    } as never);
    expect(valueOf(run)).toEqual({ lo: 0.09999999999999999, hi: 0.1 });
    expect(doublesOf(ce.box(['Add', ['Enclosure', 0, 0], 0.1]).N())).toEqual(
      valueOf(run)
    );
  });

  test('Max(x, c) with c := Enclosure(1, 3)', () => {
    const ce = engine();
    ce.assign('c', ce.box(['Enclosure', 1, 3]));
    expect(
      compileI(ce.box(['Max', 'x', 'c'])).run({ x: { lo: 0, hi: 2 } } as never)
    ).toEqual({ kind: 'interval', value: { lo: 1, hi: 3 } });
  });

  test('Sqrt(x) < 3: the clipping metadata is removed', () => {
    const ce = engine();
    expect(
      compileI(ce.box(['Less', ['Sqrt', 'x'], 3])).run({
        x: { lo: -1, hi: 4 },
      } as never)
    ).toBe('true');
  });

  test('a possible enclosure reaches the hooks: Sqrt(If(t > 0, x, 0)) < 3', () => {
    const ce = engine();
    ce.declare('t', 'real');
    const result = compileI(
      ce.box(['Less', ['Sqrt', ['If', ['Greater', 't', 0], 'x', 0]], 3])
    );
    expect(result.code).toContain('_IA.enclose(_IA.sqrt(');
    expect(result.run({ x: { lo: -1, hi: 4 }, t: 1 } as never)).toBe('true');
  });

  test('Mod(x, m) with m: real and x^n with n: integer', () => {
    const ce = engine();
    ce.declare('m', 'real');
    ce.declare('n', 'integer');
    const mod = compileI(ce.box(['Mod', 'x', 'm']));
    expect(mod.run({ x: { lo: 5, hi: 7 }, m: 3 } as never)).toEqual(
      enclosed(IA.mod({ lo: 5, hi: 7 }, { lo: 3, hi: 3 }))
    );
    // A zero divisor is the indeterminate value.
    expect(mod.run({ x: { lo: 5, hi: 7 }, m: 0 } as never)).toEqual({
      kind: 'empty',
    });
    const power = compileI(ce.box(['Power', 'x', 'n']));
    expect(power.run({ x: { lo: -2, hi: 3 }, n: 2 } as never)).toEqual(
      enclosed(IA.powInterval({ lo: -2, hi: 3 }, { lo: 2, hi: 2 }))
    );
    // The fourth accepted difference: a non-integer point exponent with a
    // negative base at run time.
    expect(power.run({ x: { lo: -8, hi: -8 }, n: 0.5 } as never)).toEqual({
      kind: 'empty',
    });
  });

  test('the acceptance example: Sin(x) + c with c := Enclosure(0, 1)', () => {
    const ce = new ComputeEngine();
    ce.assign('c', ce.box(['Enclosure', 0, 1]));
    const result = compileI(ce.parse('\\sin(x) + c'));
    const expected = IA.add(
      (IA.sin({ lo: 0, hi: 1 }) as { value: Interval }).value,
      { lo: 0, hi: 1 }
    );
    expect(result.run({ x: { lo: 0, hi: 1 } } as never)).toEqual(expected);
    expect(valueOf(expected)).toEqual({ lo: 0, hi: 1.841470984807897 });
  });

  test('Cos(x) in turn mode contains 0 at a quarter turn', () => {
    const ce = engine();
    ce.angularUnit = 'turn';
    const v = valueOf(
      compileI(ce.box(['Cos', 'x'])).run({ x: { lo: 0.25, hi: 0.25 } } as never)
    );
    expect(v.lo).toBeLessThanOrEqual(0);
    expect(v.hi).toBeGreaterThanOrEqual(0);
  });
});

describe('ENCLOSURE COMPILE: the declines', () => {
  test('the operators that the interpreter leaves unevaluated', () => {
    const ce = engine();
    ce.declare('c', 'enclosure');
    ce.declare('t', 'real');
    for (const json of [
      ['Factorial', 'x'],
      ['Factorial', ['If', ['Greater', 't', 0], 'x', 0]],
      ['Log', 'x', 'c'],
      ['Mod', 5, 'c'],
      ['Mean', ['List', 'x', 1]],
      ['Gamma', ['Enclosure', 1, 2], 3],
      ['Mod', 5, ['Enclosure', 2, 4]],
      ['Power', -2, ['Enclosure', 1, 2]],
      ['Power', ['Enclosure', -1, 1], { num: '9007199254740993' }],
    ] as Json[])
      expectDecline(ce.box(json), KIND);
  });

  test('a possible enclosure is lowered by the contract', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real | enclosure');
    expectDecline(ce.box(['Factorial', 'y']), KIND);
  });

  test('a collection of enclosures declines', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<enclosure>');
    expectDecline(
      ce.box(['Add', 'L', 1]),
      "collection of values of the kind type 'enclosure'"
    );
  });

  test('a measurement keeps the interpreter fallback', () => {
    const ce = new ComputeEngine();
    const result = compileI(
      ce.box(['Add', ['Measurement', 1, 0.1], 't']),
      true
    );
    expect(result.success).toBe(false);
    expect(result.run({ t: 1 } as never)).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('an enclosure result throws with fallback: true', () => {
    const ce = new ComputeEngine();
    expectThrowsWithoutWarning(
      () => compileI(ce.box(['Mean', ['List', ['Enclosure', 0, 1], 1]]), true),
      KIND
    );
  });
});

describe('ENCLOSURE COMPILE: the same doubles as .N()', () => {
  const ce = new ComputeEngine();

  /** The compiled value of the closed expression `json`. */
  const compiled = (json: Json): unknown =>
    compileI(ce.box(json)).run({} as never);

  test.each<[string, Json]>([
    ['Exp(Enclosure(0, 1))', ['Exp', ['Enclosure', 0, 1]]],
    ['Sin(Enclosure(0, 1))', ['Sin', ['Enclosure', 0, 1]]],
    ['Enclosure(0, 1) + 2', ['Add', ['Enclosure', 0, 1], 2]],
    ['Enclosure(0, 1) + 1/3', ['Add', ['Enclosure', 0, 1], ['Rational', 1, 3]]],
    ['Enclosure(0, 1) * Pi', ['Multiply', ['Enclosure', 0, 1], 'Pi']],
    ['Enclosure(-2, 3)^2', ['Power', ['Enclosure', -2, 3], 2]],
    ['Enclosure(-2, 3)^3', ['Power', ['Enclosure', -2, 3], 3]],
    ['Enclosure(1, 2)^-1', ['Power', ['Enclosure', 1, 2], -1]],
    ['Enclosure(1, 3)^-3', ['Power', ['Enclosure', 1, 3], -3]],
    [
      'Enclosure(-8, 8)^(1/3)',
      ['Power', ['Enclosure', -8, 8], ['Rational', 1, 3]],
    ],
    [
      'Enclosure(-8, 8)^(2/3)',
      ['Power', ['Enclosure', -8, 8], ['Rational', 2, 3]],
    ],
    ['Root(Enclosure(-8, 8), 3)', ['Root', ['Enclosure', -8, 8], 3]],
    ['Sqrt(Enclosure(-1, 4))', ['Sqrt', ['Enclosure', -1, 4]]],
    ['Enclosure(-32, 32)^0.2', ['Power', ['Enclosure', -32, 32], 0.2]],
    [
      'Enclosure(-32, -32)^0.6000000000000001',
      ['Power', ['Enclosure', -32, -32], 0.6000000000000001],
    ],
    ['2^Enclosure(1, 3)', ['Power', 2, ['Enclosure', 1, 3]]],
    ['(-2)^Enclosure(2, 2)', ['Power', -2, ['Enclosure', 2, 2]]],
    [
      'Enclosure(1, 2) / Enclosure(4, 8)',
      ['Divide', ['Enclosure', 1, 2], ['Enclosure', 4, 8]],
    ],
    ['Ln(Enclosure(0, 1))', ['Ln', ['Enclosure', 0, 1]]],
    ['Log(Enclosure(1, 4), 2)', ['Log', ['Enclosure', 1, 4], 2]],
    ['Log(Enclosure(1, 4), 3)', ['Log', ['Enclosure', 1, 4], 3]],
    ['Log(Enclosure(1, 4))', ['Log', ['Enclosure', 1, 4]]],
    ['Artanh(Enclosure(0, 1))', ['Artanh', ['Enclosure', 0, 1]]],
    ['Arctan2(Enclosure(-1, 1), -1)', ['Arctan2', ['Enclosure', -1, 1], -1]],
    ['Mod(Enclosure(5, 7), 3)', ['Mod', ['Enclosure', 5, 7], 3]],
    ['Floor(Enclosure(0.5, 2.5))', ['Floor', ['Enclosure', 0.5, 2.5]]],
    [
      'Round(Enclosure(0.1, 0.9), 0.25)',
      ['Round', ['Enclosure', 0.1, 0.9], 0.25],
    ],
    [
      'Round(Enclosure(0, 1), 1/100)',
      ['Round', ['Enclosure', 0, 1], ['Rational', 1, 100]],
    ],
    ['Sign(Enclosure(-1, 2))', ['Sign', ['Enclosure', -1, 2]]],
    ['Gamma(Enclosure(1, 2))', ['Gamma', ['Enclosure', 1, 2]]],
    ['Gamma(Enclosure(-0.9, -0.1))', ['Gamma', ['Enclosure', -0.9, -0.1]]],
    ['Hypot(Enclosure(-3, 3), 4)', ['Hypot', ['Enclosure', -3, 3], 4]],
    ['Abs(Enclosure(-1, 2))', ['Abs', ['Enclosure', -1, 2]]],
    ['Tan(Enclosure(0, Pi))', ['Tan', ['Enclosure', 0, 'Pi']]],
    [
      'Fract(Enclosure(-1e-20, -1e-20))',
      ['Fract', ['Enclosure', -1e-20, -1e-20]],
    ],
    [
      'Enclosure(0, +oo) * Enclosure(0, 1)',
      ['Multiply', ['Enclosure', 0, 'PositiveInfinity'], ['Enclosure', 0, 1]],
    ],
    [
      'Arctan2(Enclosure(-1, 1), +oo)',
      ['Arctan2', ['Enclosure', -1, 1], 'PositiveInfinity'],
    ],
    [
      'Log(Enclosure(1, 4), +oo)',
      ['Log', ['Enclosure', 1, 4], 'PositiveInfinity'],
    ],
  ])('%s', (_, json) => {
    expect(valueOf(compiled(json))).toEqual(doublesOf(ce.box(json).N()));
  });

  test.each<[string, Json]>([
    [
      'Floor(Enclosure(1, +oo))',
      ['Floor', ['Enclosure', 1, 'PositiveInfinity']],
    ],
    ['Tan(Enclosure(0, Pi/2))', ['Tan', ['Enclosure', 0, ['Divide', 'Pi', 2]]]],
  ])('%s: the whole line, on both routes', (_, json) => {
    expect(valueOf(compiled(json))).toEqual({ lo: -Infinity, hi: Infinity });
    expect(doublesOf(ce.box(json).N())).toEqual({
      lo: -Infinity,
      hi: Infinity,
    });
  });

  test.each<[string, Json]>([
    ['1 / Enclosure(0, 0)', ['Divide', 1, ['Enclosure', 0, 0]]],
    ['Ln(Enclosure(0, 0))', ['Ln', ['Enclosure', 0, 0]]],
    ['Mod(Enclosure(5, 7), 0)', ['Mod', ['Enclosure', 5, 7], 0]],
    [
      'Hypot(Enclosure(0, 1), +oo)',
      ['Hypot', ['Enclosure', 0, 1], 'PositiveInfinity'],
    ],
    ['Enclosure(0, 1) + +oo', ['Add', ['Enclosure', 0, 1], 'PositiveInfinity']],
    [
      'Enclosure(-4, -1)^(1/2)',
      ['Power', ['Enclosure', -4, -1], ['Rational', 1, 2]],
    ],
    ['Round(Enclosure(0, 1), 0)', ['Round', ['Enclosure', 0, 1], 0]],
  ])('%s: indeterminate, empty when compiled', (_, json) => {
    expect(compiled(json)).toEqual({ kind: 'empty' });
    expect(ce.box(json).N().isNaN).toBe(true);
  });

  test('Enclosure(-1, 1)^-2 is [1, +oo] on both routes (1 / x^2)', () => {
    // The row of the plan says that `.N()` and the compiled code give the
    // whole line; the composition `1 / square(x)` of the `.N()` route gives
    // the half-line `[1, +oo]`, the exact value, on both routes.
    const json: Json = ['Power', ['Enclosure', -1, 1], -2];
    expect(valueOf(compiled(json))).toEqual({ lo: 1, hi: Infinity });
    expect(doublesOf(ce.box(json).N())).toEqual({ lo: 1, hi: Infinity });
  });

  test('Enclosure(-32, -32)^0.6000000000000001 is below -8', () => {
    const v = valueOf(
      compiled(['Power', ['Enclosure', -32, -32], 0.6000000000000001])
    );
    expect(v.lo).toBeLessThan(-8);
  });

  test('the literal value: the outward record, ordered', () => {
    expect(valueOf(compiled(['Enclosure', 0, 'Pi']))).toEqual({
      lo: 0,
      hi: 3.1415926535897936,
    });
    expect(valueOf(compiled(['Enclosure', 0.1, 0.2]))).toEqual({
      lo: 0.09999999999999999,
      hi: 0.2,
    });
    // An order that is not decided: the record is `[min, max]`.
    const json: Json = ['Enclosure', ['Sin', ['Power', 10, 600]], 0];
    expect(ce.box(json).ops![1].re).toBe(0);
    const v = valueOf(compiled(json));
    expect(v.lo).toBeLessThanOrEqual(v.hi);
    expect(v).toEqual(doublesOf(ce.box(json).N()));
    // A symbolic endpoint declines.
    expectDecline(
      ce.box(['Enclosure', 'a', 2]),
      'Could not compile a value of `Enclosure`'
    );
  });

  test('the comparisons and the extrema', () => {
    const run = (json: Json): unknown => compiled(json);
    expect(run(['Less', ['Enclosure', 0, 1], ['Enclosure', 2, 3]])).toBe(
      'true'
    );
    expect(run(['Less', ['Enclosure', 0, 2], ['Enclosure', 1, 3]])).toBe(
      'maybe'
    );
    expect(run(['LessEqual', ['Enclosure', 0, 1], ['Enclosure', 1, 2]])).toBe(
      'true'
    );
    expect(run(['Less', ['Enclosure', 0, 1], 'PositiveInfinity'])).toBe('true');
    expect(
      run([
        'LessEqual',
        ['Enclosure', 0, 'PositiveInfinity'],
        'PositiveInfinity',
      ])
    ).toBe('true');
    expect(
      valueOf(run(['Max', ['Enclosure', 0, 2], ['Enclosure', 1, 3]]))
    ).toEqual({ lo: 1, hi: 3 });
    expect(
      valueOf(run(['ElementMax', ['Enclosure', 0, 2], ['Enclosure', 1, 3]]))
    ).toEqual({ lo: 1, hi: 3 });
    expect(
      valueOf(run(['Min', ['Enclosure', 0, 1], 'PositiveInfinity']))
    ).toEqual({ lo: 0, hi: 1 });
    expect(
      valueOf(
        run([
          'Clamp',
          ['Enclosure', 0, 1],
          'NegativeInfinity',
          'PositiveInfinity',
        ])
      )
    ).toEqual({ lo: 0, hi: 1 });
  });

  test('Equal(x, c, c2) and NotEqual(x, c, c2) agree with the interpreter', () => {
    // A chain of three operands is the conjunction of the comparisons of
    // each pair of neighbours, on the two routes: `True` is `'true'`,
    // `False` is `'false'`, and an undecided comparison (which the
    // interpreter leaves unevaluated) is `'maybe'`. No two neighbours are
    // the same enclosure wider than a point: the interpreter decides such a
    // pair by identity (`Equal(c, c)` is `True`), the compiled code cannot.
    const ce = engine();
    ce.declare('c', 'enclosure');
    ce.declare('c2', 'enclosure');
    const values: [number, number][][] = [
      [
        [1, 1],
        [1, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
        [2, 2],
      ],
      [
        [0, 1],
        [2, 3],
        [0, 1],
      ],
      [
        [0, 1],
        [0.5, 2],
        [3, 4],
      ],
      [
        [0, 2],
        [1, 3],
        [5, 6],
      ],
      [
        [0, 2],
        [1, 3],
        [2, 4],
      ],
    ];
    for (const operator of ['Equal', 'NotEqual']) {
      const result = compileI(ce.box([operator, 'x', 'c', 'c2']));
      expect(result.success).toBe(true);
      for (const [x, c, c2] of values) {
        const interpreted = ce
          .box([
            operator,
            ['Enclosure', ...x],
            ['Enclosure', ...c],
            ['Enclosure', ...c2],
          ])
          .evaluate();
        const expected =
          interpreted.symbol === 'True'
            ? 'true'
            : interpreted.symbol === 'False'
              ? 'false'
              : 'maybe';
        const actual = result.run({
          x: { lo: x[0], hi: x[1] },
          c: { lo: c[0], hi: c[1] },
          c2: { lo: c2[0], hi: c2[1] },
        } as never);
        expect([operator, x, c, c2, actual]).toEqual([
          operator,
          x,
          c,
          c2,
          expected,
        ]);
      }
    }
  });

  test('a chained comparison evaluates its middle operand once', () => {
    // `x < F() < y` is two comparisons that share `F()`. The compiled code
    // must call `F` once for each run, as the interpreter evaluates each
    // operand once: a function with an effect must not run twice.
    // The operand reads `t`, so the compiler cannot evaluate it once at
    // compile time as a constant.
    const ce = engine();
    ce.declare('y', 'enclosure');
    ce.declare('t', 'real');
    let calls = 0;
    const host = globalThis as { encCountedMiddle?: (v: unknown) => unknown };
    host.encCountedMiddle = (v) => {
      calls += 1;
      return v;
    };
    ce.declare('EncCountedMiddle', {
      signature: '(real) -> real',
      evaluate: ([v]) => v,
      compile: (args, compile) =>
        `globalThis.encCountedMiddle(${compile(args[0])})`,
    });
    let actual: unknown;
    try {
      const result = compileI(
        ce.box(['Less', 'x', ['EncCountedMiddle', 't'], 'y'])
      );
      expect(result.success).toBe(true);
      actual = result.run({
        x: { lo: 0, hi: 1 },
        y: { lo: 2, hi: 3 },
        t: 1.5,
      } as never);
    } finally {
      delete host.encCountedMiddle;
    }
    expect(calls).toBe(1);
    const interpreted = ce
      .box(['Less', ['Enclosure', 0, 1], 1.5, ['Enclosure', 2, 3]])
      .evaluate();
    expect(interpreted.symbol).toBe('True');
    expect(actual).toBe('true');
  });

  test('the unary kernels cover the apply table', () => {
    expect(Object.keys(ENCLOSURE_UNARY_KERNELS).sort()).toEqual(
      Object.keys(UNARY_RULES).sort()
    );
  });
});
