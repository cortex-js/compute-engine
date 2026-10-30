import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';
import type { Value } from './gpu-shader-f32-eval';
import { TEST_PYTHON } from './test-python';

/**
 * ROADMAP CE-588: a selection with a written `Missing` (or `NaN`) value beside
 * a point, a list or a complex value must compile that value as the absence
 * marker of the shape of the other value, the marker the else-less
 * `If(c, (x, y))` and `When((x, y), c)` already gave.
 *
 * - GLSL and WGSL: the written value compiled to a scalar `_gpu_nan()` beside
 *   a `vec2` value. A GLSL ternary and a WGSL `select` need two operands of
 *   one type, so the shader was not valid. It is now `vec2(_gpu_nan())`
 *   (`vec2f` in WGSL). Beside a complex value the selection declined ("the
 *   value `Missing` is not a number"); it is now `vec2(_gpu_nan())` too. A
 *   2-element list `[x, y]` beside `Missing` declined, as did the else-less
 *   `If(c, [x, y])` and `When([x, y], c)` ("object-domain absent
 *   position"); the list lowers to a `vec2`, as a point does, and these now
 *   compile with a `vec2` NaN.
 * - Python: the written `Missing` compiled to `math.nan` beside a point or a
 *   list, where the interpreter gives `Missing`, which is `None` on this
 *   target, and the undecided condition gave `float('nan')`. Both are now
 *   `None`. Beside a complex value the marker stays `nan`, as for the
 *   else-less `If`.
 * - interval-js: an `If` with a point or a list value declined ("no lowering
 *   for `Tuple`"), with or without a `Missing` value, where `Which` and
 *   `When` compiled. An `If` is now spelled as the `Which` of the same
 *   clauses. A complex value still declines: the target has no complex
 *   numbers.
 * - JavaScript: no change. The values already agreed with the interpreter.
 *
 * A written `NaN` is a number in the interpreter, and stays `NaN` on
 * JavaScript and Python. On the shader targets it takes the shape of the
 * other value, as `Missing` does.
 */

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
  // The run-value of a present value, and the absence markers the else-less
  // `If` gives for the same shape: `undefined` for a point or a list, and
  // `undefined` or the complex NaN `{ re: NaN, im: NaN }` for a complex
  // value.
  const presentValue = (shape: Shape): unknown =>
    shape === 'complex' ? { re: X, im: Y } : [X, Y];
  const isAbsent = (v: unknown, shape: Shape, nan: boolean): boolean => {
    if (nan) return typeof v === 'number' && Number.isNaN(v);
    if (v === undefined) return true;
    if (shape !== 'complex' || typeof v !== 'object' || v === null)
      return false;
    const z = v as { re: number; im: number };
    return Number.isNaN(z.re) && Number.isNaN(z.im);
  };

  it.each(CASES)('$label', ({ json, shape, presentWhen, nan }) => {
    const ce = engine();
    const r = compile(ce.box(json as never), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const run = (vars: Record<string, unknown>) =>
      r.run!({ x: X, y: Y, d: true, ...vars } as never);
    expect(run({ c: presentWhen })).toEqual(presentValue(shape));
    expect(isAbsent(run({ c: !presentWhen }), shape, nan === true)).toBe(true);
    // `c` not supplied: the interpreter has no value (the `If` stays
    // unevaluated), and the compiled value is the absence marker.
    const unsupplied = run({});
    expect(
      unsupplied === undefined ||
        (typeof unsupplied === 'number' && Number.isNaN(unsupplied)) ||
        isAbsent(unsupplied, shape, false)
    ).toBe(true);
  });

  it('Which(c, (x, y), d, Missing) with d false selects no value', () => {
    const ce = engine();
    const json = ['Which', 'c', POINT, 'd', 'Missing'];
    const r = compile(ce.box(json as never), {
      to: 'javascript',
      fallback: false,
    });
    for (const [c, d] of [
      [true, false],
      [false, false],
      [false, true],
    ]) {
      const interpreted = ce
        .box(json as never)
        .subs({ x: X, y: Y, c: c ? 'True' : 'False', d: d ? 'True' : 'False' })
        .evaluate();
      const v = r.run!({ x: X, y: Y, c, d } as never);
      if (c) {
        expect(interpreted.json).toEqual(['Tuple', X, Y]);
        expect(v).toEqual([X, Y]);
      } else {
        expect(interpreted.json).toEqual('Missing');
        expect(v).toBeUndefined();
      }
    }
  });
});

describe.each(['glsl', 'wgsl'] as const)('CE-588 — %s', (to) => {
  const vec2 = to === 'glsl' ? 'vec2' : 'vec2f';

  /** The compiled code, and a shader function `f(c, d, x, y)` that returns
   * it. A boolean argument is passed as 1 or 0 (the interpreter of
   * `gpu-shader-f32-eval.ts` takes numbers and vectors only). */
  function shader(json: unknown): {
    code: string;
    f: (c: boolean, d?: boolean) => Value;
  } {
    const ce = engine();
    const r = compile(ce.box(json as never), {
      to,
      fallback: false,
    } as never) as { success: boolean; code: string; preamble?: string };
    expect(r.success).toBe(true);
    const src =
      to === 'glsl'
        ? `${r.preamble ?? ''}\nvec2 f(bool c, bool d, float x, float y) {\nreturn ${r.code};\n}`
        : `${r.preamble ?? ''}\nfn f(c: bool, d: bool, x: f32, y: f32) -> vec2f {\nreturn ${r.code};\n}`;
    const run = shaderFunctions(src, to);
    return {
      code: r.code,
      f: (c, d = true) => run('f', c ? 1 : 0, d ? 1 : 0, X, Y),
    };
  }

  /** Every NaN of `code` is a `vec2` NaN: no scalar `_gpu_nan()` beside a
   * `vec2` value, which is not a valid shader. */
  const expectOnlyVectorNaN = (code: string): void => {
    expect(code).toContain(`${vec2}(_gpu_nan())`);
    expect(code.split(`${vec2}(_gpu_nan())`).join('')).not.toContain(
      '_gpu_nan()'
    );
  };
  const expectNaNVector = (v: Value): void => {
    expect(typeof v).toBe('object');
    const p = v as { x: number; y: number };
    expect([Number.isNaN(p.x), Number.isNaN(p.y)]).toEqual([true, true]);
  };

  it.each(CASES)('$label', ({ json, presentWhen }) => {
    const { code, f } = shader(json);
    expectOnlyVectorNaN(code);
    expect(f(presentWhen)).toEqual({ x: X, y: Y });
    expectNaNVector(f(!presentWhen));
  });

  it('Which(c, (x, y), d, Missing) with d false selects no value', () => {
    const { f } = shader(['Which', 'c', POINT, 'd', 'Missing']);
    expect(f(true, false)).toEqual({ x: X, y: Y });
    expectNaNVector(f(false, false));
    expectNaNVector(f(false, true));
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
      ['If', 'c', ['When', POINT, 'd'], 'Missing'],
      [true, true],
    ],
    ['If(c, If(d, (x, y)))', ['If', 'c', ['If', 'd', POINT]], [true, true]],
    ['When(If(d, (x, y)), c)', ['When', ['If', 'd', POINT], 'c'], [true, true]],
    [
      'If(c, If(d, [x, y], Missing), Missing)',
      ['If', 'c', ['If', 'd', LIST, 'Missing'], 'Missing'],
      [true, true],
    ],
  ] as [string, unknown, [boolean, boolean]][])(
    'a nested selection: %s',
    (_label, json, [c, d]) => {
      const { code, f } = shader(json);
      expectOnlyVectorNaN(code);
      // The present value at the given `c` and `d`; every other choice of
      // `c` and `d` selects no value.
      for (const cc of [true, false])
        for (const dd of [true, false]) {
          if (cc === c && dd === d) expect(f(cc, dd)).toEqual({ x: X, y: Y });
          else expectNaNVector(f(cc, dd));
        }
    }
  );

  // A value that needs statements (a `Sum` loop in a coordinate) takes the
  // statement form, an `if` statement that assigns a temporary. The
  // f32 interpreter has no loops, so the emitted text is checked.
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
    const ce = engine();
    const r = compile(ce.box(json as never), {
      to,
      fallback: false,
    } as never) as { success: boolean; code: string };
    expect(r.success).toBe(true);
    expect(r.code).toContain(to === 'glsl' ? 'vec2 _tv1;' : 'var _tv1: vec2f;');
    expect(r.code).toContain(`_tv1 = ${vec2}(_gpu_nan());`);
    expectOnlyVectorNaN(r.code);
  });

  it('the emitted code', () => {
    const t = (json: unknown) => shader(json).code;
    const nan = `${vec2}(_gpu_nan())`;
    const p = `${vec2}(x, y)`;
    if (to === 'glsl') {
      expect(t(['If', 'c', POINT, 'Missing'])).toBe(
        `((c) ? (${p}) : (${nan}))`
      );
      expect(t(['If', 'c', 'Missing', POINT])).toBe(
        `((c) ? (${nan}) : (${p}))`
      );
      expect(t(['If', 'c', LIST, 'Missing'])).toBe(`((c) ? (${p}) : (${nan}))`);
      expect(t(['If', 'c', COMPLEX, 'Missing'])).toBe(
        `((c) ? (${p}) : (${nan}))`
      );
    } else {
      expect(t(['If', 'c', POINT, 'Missing'])).toBe(`select(${nan}, ${p}, c)`);
      expect(t(['If', 'c', 'Missing', POINT])).toBe(`select(${p}, ${nan}, c)`);
      expect(t(['If', 'c', LIST, 'Missing'])).toBe(`select(${nan}, ${p}, c)`);
      expect(t(['If', 'c', COMPLEX, 'Missing'])).toBe(
        `select(${nan}, ${p}, c)`
      );
    }
  });

  it('the else-less If and When over a list of two numbers', () => {
    const nan = `${vec2}(_gpu_nan())`;
    for (const json of [
      ['If', 'c', LIST],
      ['When', LIST, 'c'],
    ]) {
      const { code, f } = shader(json);
      expect(code).toContain(nan);
      expect(f(true)).toEqual({ x: X, y: Y });
      const v = f(false) as { x: number; y: number };
      expect([Number.isNaN(v.x), Number.isNaN(v.y)]).toEqual([true, true]);
    }
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
    const ce = engine();
    const r = compile(ce.box(['If', 'c', 'x', 'Missing']), {
      to,
      fallback: false,
    } as never);
    expect(r.code).toBe(
      to === 'glsl' ? '((c) ? (x) : (_gpu_nan()))' : 'select(_gpu_nan(), x, c)'
    );
  });
});

describe('CE-588 — python', () => {
  const py = (json: unknown): string => {
    const ce = engine();
    const r = compile(ce.box(json as never), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    return r.code;
  };

  it('the emitted code', () => {
    const isBool = (v: string) => `isinstance(${v}, (bool, np.bool_))`;
    expect(py(['If', 'c', POINT, 'Missing'])).toBe(
      `(((x, y)) if (${isBool('c')} and c) else ((None) if ${isBool('c')} else None))`
    );
    expect(py(['If', 'c', 'Missing', POINT])).toBe(
      `((None) if (${isBool('c')} and c) else (((x, y)) if ${isBool('c')} else None))`
    );
    expect(py(['If', ['Greater', 'x', 0], POINT, 'Missing'])).toBe(
      '(((x, y)) if (0 < x) else (None))'
    );
    // The same code as the else-less `If`.
    expect(py(['If', 'c', LIST, 'Missing'])).toBe(py(['If', 'c', LIST]));
    expect(py(['If', 'c', POINT, 'Missing'])).toBe(py(['If', 'c', POINT]));
    // A scalar or complex value keeps the numeric marker.
    expect(py(['If', 'c', 'x', 'Missing'])).not.toContain('None');
    expect(py(['If', 'c', COMPLEX, 'Missing'])).not.toContain('None');
  });

  const run = TEST_PYTHON === undefined ? it.skip : it;
  run('the compiled code agrees with the interpreter', () => {
    // `None` for an absent point or list; `nan` for an absent complex value
    // and for a written `NaN`. The value of `c` that is not a boolean (`1`)
    // selects no value: the interpreter has none there either.
    const expected = (k: Case, c: 'True' | 'False' | '1'): string => {
      const present = c === (k.presentWhen ? 'True' : 'False');
      if (present)
        return k.shape === 'point'
          ? '(0.5, -2.0)'
          : k.shape === 'list'
            ? '[0.5, -2.0]'
            : '(0.5-2j)';
      return k.nan || k.shape === 'complex' ? 'nan' : 'None';
    };
    // `d` decides only `Which(c, (x, y), d, Missing)`, whose value is absent
    // when `c` is not `True` whatever `d` is: with `d` false no clause is
    // selected, and that absence is `None` too.
    for (const k of CASES) {
      const code = py(k.json);
      for (const c of ['True', 'False', '1'] as const)
        for (const d of ['True', 'False']) {
          const out = execFileSync(TEST_PYTHON!, [
            '-c',
            `import math\nimport numpy as np\nx = 0.5\ny = -2.0\nd = ${d}\nc = ${c}\nv = ${code}\nprint(repr(v) if not isinstance(v, float) else ('nan' if math.isnan(v) else repr(v)))`,
          ])
            .toString()
            .trim();
          expect([k.label, c, d, out]).toEqual([k.label, c, d, expected(k, c)]);
        }
    }
  });
});

describe('CE-588 — interval-js', () => {
  type Result = unknown;
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

  // A boolean input of this target is the verdict `'true'` or `'false'`.
  it.each(CASES.filter((k) => k.shape !== 'complex'))(
    '$label',
    ({ json, presentWhen }) => {
      const f = run(json);
      const verdict = (b: boolean) => (b ? 'true' : 'false');
      // `d` decides only `Which(c, (x, y), d, Missing)`, whose value is
      // absent when `c` is false whatever `d` is.
      for (const d of ['true', 'false']) {
        expect(f({ c: verdict(presentWhen), d })).toEqual([point(X), point(Y)]);
        // The run result of an absent value, `Missing` or `NaN`, is the
        // `empty` result, as for the else-less `If`.
        expect(f({ c: verdict(!presentWhen), d })).toEqual({ kind: 'empty' });
      }
    }
  );

  it('a condition over the interval input', () => {
    const f = run(['If', ['Greater', 'x', 0], POINT, 'Missing']);
    const g = run(['If', ['Greater', 'x', 0], POINT]);
    for (const x of [
      { lo: 1, hi: 2 },
      { lo: -2, hi: -1 },
      { lo: -1, hi: 1 },
    ]) {
      // The written `Missing` gives the result of the else-less `If`.
      expect(f({ x })).toEqual(g({ x }));
    }
    expect(f({ x: { lo: -2, hi: -1 } })).toEqual({ kind: 'empty' });
  });

  it('a nested selection as a value of an If', () => {
    // The value `If(d, (x, y), Missing)` is typed `missing | tuple<real,
    // real>`; the `If` is still spelled as a point selection.
    for (const json of [
      ['If', 'c', ['If', 'd', POINT, 'Missing'], 'Missing'],
      ['If', 'c', ['If', 'd', LIST]],
      ['If', 'c', ['When', POINT, 'd'], 'Missing'],
    ]) {
      const f = run(json);
      expect(f({ c: 'true', d: 'true' })).toEqual([point(X), point(Y)]);
      expect(f({ c: 'true', d: 'false' })).toEqual({ kind: 'empty' });
      expect(f({ c: 'false', d: 'true' })).toEqual({ kind: 'empty' });
    }
  });

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
        const r = compile(engine().box(json as never), {
          to: 'interval-js',
          fallback: false,
        } as never);
        expect([JSON.stringify(json), r.success]).toEqual([
          JSON.stringify(json),
          false,
        ]);
      }
    });

    it('are entire, not empty, where only the run time knows the lengths', () => {
      // `L` has no static length. Where `x > 0` is undecided the value is
      // `L` (length 2 here) or `[x]` (length 1): no array encloses both,
      // and `entire` says so. `empty` would say there is no value.
      const ce = engine();
      ce.declare('L', 'list<real>');
      const L = [point(1), point(2)];
      for (const json of [
        ['If', ['Greater', 'x', 0], 'L', ['List', 'x']],
        ['Which', ['Greater', 'x', 0], 'L', 'True', ['List', 'x']],
        ['Length', ['If', ['Greater', 'x', 0], 'L', ['List', 'x']]],
        ['Length', ['Which', ['Greater', 'x', 0], 'L', 'True', ['List', 'x']]],
      ]) {
        const r = compile(ce.box(json as never), {
          to: 'interval-js',
          fallback: false,
        } as never);
        expect(r.success).toBe(true);
        const at = (lo: number, hi: number) =>
          r.run!({ x: { lo, hi }, L: L.map((p) => p.value) } as never);
        expect(at(-1, 1)).toEqual({ kind: 'entire' });
        const length = json[0] === 'Length';
        expect(at(1, 2)).toEqual(length ? point(2) : L);
        expect(at(-2, -1)).toEqual(
          length ? point(1) : [{ kind: 'interval', value: { lo: -2, hi: -1 } }]
        );
      }
    });

    it('stay entire inside an enclosing selection', () => {
      // The inner `If(d, L, [2])` is `entire` where `d` is undecided (`L`
      // has length 2 here). The outer `If` hulls it with `[1]`: `entire`
      // beside an array is `entire`, not the absence marker of two domains,
      // which the runner reports as `empty`.
      const ce = engine();
      ce.declare('L', 'list<real>');
      const L = [point(1), point(2)];
      for (const json of [
        ['If', 'c', ['List', 1], ['If', 'd', 'L', ['List', 2]]],
        ['If', 'c', ['If', 'd', 'L', ['List', 2]], ['List', 1]],
        ['Which', 'c', ['List', 1], 'True', ['If', 'd', 'L', ['List', 2]]],
        ['If', 'c', ['List', 1], ['When', ['If', 'd', 'L', ['List', 2]], 'c']],
      ]) {
        const r = compile(ce.box(json as never), {
          to: 'interval-js',
          fallback: false,
        } as never);
        expect([JSON.stringify(json), r.success]).toEqual([
          JSON.stringify(json),
          true,
        ]);
        const v = r.run!({
          c: 'maybe',
          d: 'maybe',
          L: L.map((p) => p.value),
        } as never);
        expect([JSON.stringify(json), v]).toEqual([
          JSON.stringify(json),
          { kind: 'entire' },
        ]);
      }
    });
  });

  it('a deep chain of nested selections compiles each value once', () => {
    // `If(x > k, …, Missing)` nested 24 deep. Each level probed its value
    // and then compiled it again, so the compile time grew by a factor of
    // about 3 per level (depth 8 took about a second, depth 10 overflowed
    // the stack). Each value is now compiled once.
    const ce = engine();
    let json: unknown = POINT;
    for (let k = 0; k < 24; k++)
      json = ['If', ['Greater', 'x', k], json, 'Missing'];
    const start = performance.now();
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(r.success).toBe(true);
    const at = (lo: number, hi: number) =>
      r.run!({ x: { lo, hi }, y: { lo: Y, hi: Y } } as never);
    expect(at(30, 31)).toEqual([
      { kind: 'interval', value: { lo: 30, hi: 31 } },
      point(Y),
    ]);
    expect(at(10, 11)).toEqual({ kind: 'empty' });
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
      const r = compile(ce.box(json as never), {
        to: 'interval-js',
        fallback: false,
      } as never);
      expect(r.success).toBe(false);
    }
  });
});
