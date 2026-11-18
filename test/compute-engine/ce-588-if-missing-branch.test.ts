import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';
import type { CompileDiagnostic } from '../../src/compute-engine/compilation/types';

/**
 * ROADMAP CE-588: a selection with a written `Missing` (or `NaN`) value beside
 * a point, a list or a complex value must compile that value as the absence
 * marker of the shape of the other value, the marker the else-less
 * `If(c, (x, y))` already gave.
 *
 * - GLSL: the written value compiled to a scalar `_gpu_nan()` beside
 *   a `vec2` value. A GLSL ternary needs two operands of
 *   one type, so the shader was not valid. It is now `vec2(_gpu_nan())`.
 *   Beside a complex value the selection declined ("the
 *   value `Missing` is not a number"); it is now `vec2(_gpu_nan())` too. A
 *   2-element list `[x, y]` beside `Missing` declined, as did the else-less
 *   `If(c, [x, y])` ("object-domain absent
 *   position"); the list lowers to a `vec2`, as a point does, and these now
 *   compile with a `vec2` NaN.
 * - interval-js: an `If` with a point or a list value declined ("no lowering
 *   for `Tuple`"), with or without a `Missing` value, where `Which`
 *   compiled. An `If` is now spelled as the `Which` of the same
 *   clauses. A complex value still declines: the target has no complex
 *   numbers.
 * - JavaScript: no change. The values already agreed with the interpreter.
 *
 * A written `NaN` is a number in the interpreter. Beside a point, the value
 * of the selection is a point for one value of `c` and the number `NaN` for
 * the other, so the shape of its value is known only at run time: the
 * compilation declines with `unsettled-shape` on every target
 * (`docs/COMPILATION-MODEL.md`, "Fail closed"). Before, the written `NaN`
 * stayed `NaN` on JavaScript and took the shape of the other
 * value on the shader targets.
 *
 * The compiler declines a written `Missing` on JavaScript and GLSL ("the
 * input Missing of type missing"): the interpreter fallback gives its value.
 */

/** Expect the compilation of `json` on `to` to decline because the shape of
 * its value is known only at run time. */
function expectUnsettled(json: unknown, to: string): void {
  const r = compile(engine().box(json as never), { to } as never);
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
}

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('c', 'boolean');
  ce.declare('d', 'boolean');
  return ce;
}

const POINT = ['Tuple', 'x', 'y'];
const LIST = ['List', 'x', 'y'];
const COMPLEX = ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']];

type Shape = 'point' | 'list' | 'complex';

/** A selection, its value shape, and which value of `c` selects the value
 * (`true`: the value is the then-branch). */
type Case = {
  label: string;
  json: unknown;
  shape: Shape;
  /** The value of `c` that selects the present value. */
  presentWhen: boolean;
  /** The written absent value is `NaN`, not `Missing`. */
  nan?: boolean;
};

const CASES: Case[] = [
  {
    label: 'If(c, (x, y), Missing)',
    json: ['If', 'c', POINT, 'Missing'],
    shape: 'point',
    presentWhen: true,
  },
  {
    label: 'If(c, Missing, (x, y))',
    json: ['If', 'c', 'Missing', POINT],
    shape: 'point',
    presentWhen: false,
  },
  {
    label: 'Which(c, (x, y), d, Missing)',
    json: ['Which', 'c', POINT, 'd', 'Missing'],
    shape: 'point',
    presentWhen: true,
  },
  {
    label: 'Which(c, (x, y), True, Missing)',
    json: ['Which', 'c', POINT, 'True', 'Missing'],
    shape: 'point',
    presentWhen: true,
  },
  {
    label: 'If(c, [x, y], Missing)',
    json: ['If', 'c', LIST, 'Missing'],
    shape: 'list',
    presentWhen: true,
  },
  {
    label: 'If(c, Missing, [x, y])',
    json: ['If', 'c', 'Missing', LIST],
    shape: 'list',
    presentWhen: false,
  },
  {
    label: 'If(c, x + iy, Missing)',
    json: ['If', 'c', COMPLEX, 'Missing'],
    shape: 'complex',
    presentWhen: true,
  },
  {
    label: 'If(c, Missing, x + iy)',
    json: ['If', 'c', 'Missing', COMPLEX],
    shape: 'complex',
    presentWhen: false,
  },
  {
    label: 'If(c, (x, y), NaN)',
    json: ['If', 'c', POINT, 'NaN'],
    shape: 'point',
    presentWhen: true,
    nan: true,
  },
];

const X = 0.5;
const Y = -2;

/** The interpreter's value at `x = X`, `y = Y`, for a boolean `c` (and
 * `d = True`). */
function interpret(ce: ComputeEngine, json: unknown, c: boolean) {
  return ce
    .box(json as never)
    .subs({ x: X, y: Y, c: c ? 'True' : 'False', d: 'True' })
    .evaluate();
}

describe('CE-588 — the interpreter', () => {
  it.each(CASES)('$label', ({ json, presentWhen, nan, shape }) => {
    const ce = engine();
    const present = interpret(ce, json, presentWhen);
    const absent = interpret(ce, json, !presentWhen);
    expect(present.re).toBe(shape === 'complex' ? X : NaN);
    if (shape !== 'complex')
      expect(present.json).toEqual([
        shape === 'point' ? 'Tuple' : 'List',
        X,
        Y,
      ]);
    expect(absent.json).toEqual(nan ? 'NaN' : 'Missing');
  });
});

describe('CE-588 — javascript', () => {
  it.each(CASES.filter((k) => k.nan))('$label', ({ json }) =>
    expectUnsettled(json, 'javascript')
  );
});

describe.each(['glsl'] as const)('CE-588 — %s', (to) => {
  /** Expect the compilation of `json` to decline with `message`: the
   * compiler has no `Missing` value. */
  const expectDeclined = (json: unknown, message: RegExp): void => {
    expect(() =>
      compile(engine().box(json as never), {
        to,
        fallback: false,
      } as never)
    ).toThrow(message);
  };

  it.each(CASES)('$label', ({ json, nan }) => {
    if (nan) return expectUnsettled(json, to);
    expectDeclined(json, /the input Missing of type missing/);
  });

  it('Which(c, (x, y), d, Missing) with d false selects no value', () => {
    expectDeclined(
      ['Which', 'c', POINT, 'd', 'Missing'],
      /the input Missing of type missing/
    );
  });

  // A value that is itself a selection that may be absent, typed
  // `missing | tuple<real, real>`: its width is read with the `missing` arm
  // set aside (`BaseCompiler.withoutAbsentArms`).
  it.each([
    [
      'If(c, If(d, (x, y), Missing), Missing)',
      ['If', 'c', ['If', 'd', POINT, 'Missing'], 'Missing'],
      [true, true],
    ],
    [
      'If(c, Missing, If(d, Missing, (x, y)))',
      ['If', 'c', 'Missing', ['If', 'd', 'Missing', POINT]],
      [false, false],
    ],
    [
      'Which(c, If(d, (x, y)), True, Missing)',
      ['Which', 'c', ['If', 'd', POINT], 'True', 'Missing'],
      [true, true],
    ],
    [
      'If(c, When((x, y), d), Missing)',
      ['If', 'c', ['If', 'd', POINT], 'Missing'],
      [true, true],
    ],
    [
      'If(c, If(d, [x, y], Missing), Missing)',
      ['If', 'c', ['If', 'd', LIST, 'Missing'], 'Missing'],
      [true, true],
    ],
  ] as [string, unknown, [boolean, boolean]][])(
    'a nested selection: %s',
    (_label, json) => {
      expectDeclined(json, /the input Missing of type missing/);
    }
  );

  // A value that needs statements (a `Sum` loop in a coordinate).
  it.each([
    [
      'If(c, (Σ k·x, y), Missing)',
      [
        'If',
        'c',
        [
          'Tuple',
          ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, ['Floor', 'y']]],
          'y',
        ],
        'Missing',
      ],
    ],
    [
      'If(c, Missing, (Σ k·x, y))',
      [
        'If',
        'c',
        'Missing',
        [
          'Tuple',
          ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, ['Floor', 'y']]],
          'y',
        ],
      ],
    ],
  ] as [string, unknown][])('the statement form: %s', (_label, json) => {
    expectDeclined(json, /the input Missing of type missing/);
  });

  it('the emitted code', () => {
    for (const json of [
      ['If', 'c', POINT, 'Missing'],
      ['If', 'c', 'Missing', POINT],
      ['If', 'c', LIST, 'Missing'],
      ['If', 'c', COMPLEX, 'Missing'],
    ])
      expectDeclined(json, /the input Missing of type missing/);
  });

  it('a list of five numbers beside Missing still declines', () => {
    const ce = engine();
    expect(() =>
      compile(
        ce.box(['If', 'c', ['List', 'x', 'y', 'x', 'y', 'x'], 'Missing']),
        { to, fallback: false } as never
      )
    ).toThrow();
  });

  it('a scalar value beside Missing keeps the scalar NaN', () => {
    expectDeclined(['If', 'c', 'x', 'Missing'], /the input Missing of type missing/);
  });
});

describe('CE-588 — interval-js', () => {
  type Result = unknown;
  /** The diagnostic of the decline that the interval mode throws. */
  function declineOf(
    ce: ComputeEngine,
    json: unknown
  ): CompileDiagnostic | undefined {
    try {
      compile(ce.box(json as never), {
        to: 'interval-js',
        fallback: false,
      } as never);
    } catch (e) {
      return compileDiagnosticOf(e);
    }
    return undefined;
  }
  const point = (lo: number) => ({ kind: 'interval', value: { lo, hi: lo } });

  function run(json: unknown) {
    const ce = engine();
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    return (vars: Record<string, unknown>): Result =>
      r.run!({ x: { lo: X, hi: X }, y: { lo: Y, hi: Y }, ...vars } as never);
  }

  it.each(CASES.filter((k) => k.shape !== 'complex' && k.nan))(
    '$label',
    ({ json }) => expectUnsettled(json, 'interval-js')
  );

  it('a value that is never selected is not compiled', () => {
    // interval-js has no lowering for `Zeta`. The condition `x < -1` with
    // `x` in [0, 1] is false by its type (`BaseCompiler.booleanClaim`), and
    // `False` is false as written.
    const ce = new ComputeEngine();
    ce.declare('x', 'real<0..1>');
    const ZETA_LIST = ['List', ['Zeta', 'x'], 1];
    const LIST_1X = ['List', 1, 'x'];
    const list = [point(1), point(0.5)];
    const one = point(1);
    for (const [json, expected] of [
      [['If', ['Less', 'x', -1], ZETA_LIST, LIST_1X], list],
      [['If', ['Less', 'x', -1], ZETA_LIST, 1], one],
      [['If', 'False', ZETA_LIST, LIST_1X], list],
      [['If', 'False', ZETA_LIST, 1], one],
      [['If', 'True', LIST_1X, ZETA_LIST], list],
      [['If', ['Equal', 'x', 'x'], LIST_1X, ZETA_LIST], list],
      [['Which', ['Less', 'x', -1], ZETA_LIST, 'True', LIST_1X], list],
      [['Which', 'False', ZETA_LIST, 'True', LIST_1X], list],
      [['If', 'False', ['Zeta', 'x'], 1], one],
      [['Which', 'False', ['Zeta', 'x'], 'True', 1], one],
    ] as [unknown, unknown][]) {
      const r = compile(ce.box(json as never), {
        to: 'interval-js',
        fallback: false,
      } as never);
      expect([JSON.stringify(json), r.success]).toEqual([
        JSON.stringify(json),
        true,
      ]);
      expect(r.run!({ x: { lo: 0.5, hi: 0.5 } } as never)).toEqual(expected);
    }
  });

  describe('collection values of different lengths', () => {
    it('decline when the lengths are known', () => {
      for (const json of [
        ['If', ['Greater', 'x', 0], LIST, ['List', 'x']],
        ['Which', ['Greater', 'x', 0], LIST, 'True', ['List', 'x']],
        ['Length', ['If', ['Greater', 'x', 0], LIST, ['List', 'x']]],
      ]) {
        const diagnostic = declineOf(engine(), json);
        expect([JSON.stringify(json), diagnostic?.code]).toEqual([
          JSON.stringify(json),
          'outside-profile',
        ]);
      }
    });
  });

  it('an If between two points', () => {
    const f = run(['If', 'c', POINT, ['Tuple', 'y', 'x']]);
    expect(f({ c: 'true' })).toEqual([point(X), point(Y)]);
    expect(f({ c: 'false' })).toEqual([point(Y), point(X)]);
  });

  it('a complex value still declines: the target has no complex numbers', () => {
    const ce = engine();
    for (const json of [
      ['If', 'c', COMPLEX, 'Missing'],
      ['If', 'c', COMPLEX],
    ]) {
      expect(declineOf(ce, json)?.code).toBe('outside-profile');
    }
  });
});
