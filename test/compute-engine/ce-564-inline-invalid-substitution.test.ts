import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

//
// CE-564.2. The definitions below come from a Desmos document (Tycho census,
// document `ra1p9naofs`):
//
//   P(x, y) := [x, y]
//   d(p) := f(p[1])·sin(r(p)) + f(p[2])·cos(r(p))
//   r(p) := (T + floor(p[1]))·max(0, 0.5 - l(f(p)))
//   A(p: vector<2>) := [arctan2(p[2], p[1])/(2π) + 0.5, l(p)]
//   B(p: vector<2>) := [2.6(p[1] + floor(p[2] - p[1]))^2 - T, p[2] - p[1]]
//   f(p) := mod(p, 1) - 0.5
//   l(p: vector<2>) := sqrt(p[1]^2 + p[2]^2)
//
// The index read `p[1]` in `r` makes the engine infer the parameter of `r`
// as the one-element tuple `tuple<…>`. Such a tuple is not a contract: index
// reads do not prove that the argument is a point, and the interpreter binds
// a list argument whole (`isIndexReadTuple()`,
// `boxed-expression/index-read-tuple.ts`). With the list `[0.3, 0.4]`, `f`
// maps over the list. With the point `(0.3, 0.4)`, `f` is a tuple minus a
// number, which is refused (`incompatible-type`).
//
// Three changes in `compilation/base-compiler.ts`:
//
// 1. `substitutedUserFunctionBody` declines a substitution that makes the
//    body invalid. The nested inliner used to compile the `Error` that the
//    substitution made, and reported "Could not compile invalid expression".
// 2. On JavaScript, the call-shape specialization reads a tuple that only
//    index reads made as an open parameter type when the argument is not a
//    point (`ensureSpecializedUserCallEmitted`): the helper is compiled with
//    the argument's own list type, so `f` maps over the list.
// 3. On interval-js, a pure list argument at such a parameter may be
//    substituted whole when the definition cannot be emitted
//    (`tryCompileUserFunction`).
// 4. On interval-js, a list of real numbers that the interpreter binds whole
//    to a parameter with an open element type takes a copy of the callee
//    typed by the argument, as on JavaScript (ROADMAP CE-564,
//    `ensureSpecializedUserCallEmitted`). Scalar, point and complex
//    arguments keep the generic definition there. So `r([x, y])` now
//    compiles through the copy `_fn_r_vector_real_2_` (before through change
//    3), and `d(B(A(P(x, y))))`, which declined, compiles.
//
// A point argument, and a parameter whose tuple type is a contract (an
// annotation), keep their behavior.
//

const V2 = "'vector<2>'";

function engineWithDefinitions(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('T', 'real');
  ce.assign('T', 2.332);
  const defs: Record<string, unknown> = {
    f: ['Function', ['Block', ['Add', ['Mod', 'p', 1], -0.5]], 'p'],
    l: [
      'Function',
      [
        'Block',
        [
          'Sqrt',
          [
            'Add',
            ['Power', ['At', 'p', 1], 2],
            ['Power', ['At', 'p', 2], 2],
          ],
        ],
      ],
      ['Typed', 'p', V2],
    ],
    r: [
      'Function',
      [
        'Block',
        [
          'Multiply',
          ['Add', 'T', ['Floor', ['At', 'p', 1]]],
          ['Max', 0, ['Add', ['Negate', ['l', ['f', 'p']]], 0.5]],
        ],
      ],
      'p',
    ],
    d: [
      'Function',
      [
        'Block',
        [
          'Add',
          ['Multiply', ['f', ['At', 'p', 1]], ['Sin', ['r', 'p']]],
          ['Multiply', ['f', ['At', 'p', 2]], ['Cos', ['r', 'p']]],
        ],
      ],
      'p',
    ],
    A: [
      'Function',
      [
        'Block',
        [
          'List',
          [
            'Add',
            [
              'Divide',
              ['Arctan2', ['At', 'p', 2], ['At', 'p', 1]],
              ['Multiply', 2, 'Pi'],
            ],
            0.5,
          ],
          ['l', 'p'],
        ],
      ],
      ['Typed', 'p', V2],
    ],
    B: [
      'Function',
      [
        'Block',
        [
          'List',
          [
            'Add',
            ['Negate', 'T'],
            [
              'Multiply',
              2.6,
              [
                'Power',
                [
                  'Add',
                  ['At', 'p', 1],
                  ['Floor', ['Add', ['Negate', ['At', 'p', 1]], ['At', 'p', 2]]],
                ],
                2,
              ],
            ],
          ],
          ['Add', ['Negate', ['At', 'p', 1]], ['At', 'p', 2]],
        ],
      ],
      ['Typed', 'p', V2],
    ],
    P: ['Function', ['List', 'x', 'y'], 'x', 'y'],
  };
  for (const [name, def] of Object.entries(defs))
    ce.assign(name, ce.box(def as any));
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  return ce;
}

const SAMPLES: [number, number][] = [
  [0.3, 0.4],
  [1.7, -2.2],
  [-0.9, 3.1],
];

/** The message of a decline, whether the target throws it or returns it. */
function declineMessage(ce: ComputeEngine, json: unknown, to: string): string {
  try {
    const result = compile(ce.box(json as any), {
      to,
      fallback: false,
    } as any) as { success: boolean; error?: unknown };
    expect(result.success).toBe(false);
    return String(result.error ?? '');
  } catch (e) {
    return String((e as Error).message);
  }
}

/** The real value of a compiled result: a number, or the midpoint of an
 * interval result (interval-js). */
function realOf(v: any): number {
  if (typeof v === 'number') return v;
  if (v?.kind === 'interval') return (v.value.lo + v.value.hi) / 2;
  throw new Error(`unexpected compiled value ${JSON.stringify(v)}`);
}

/** The interpreter's real value of `json` at `(x, y)`. */
function interpreterValue(
  ce: ComputeEngine,
  json: unknown,
  x: number,
  y: number
): number {
  return ce
    .box(json as any)
    .subs({ x, y })
    .evaluate().re;
}

/** The bounds of an interval-js result: `[lo, hi]` of its band, or
 * `[-∞, +∞]` for `entire`. Any other result (empty, singular) fails. */
function bounds(v: any): [number, number] {
  if (v?.kind === 'entire') return [-Infinity, Infinity];
  if (v?.kind === 'interval' || v?.kind === 'partial')
    return [v.value.lo, v.value.hi];
  throw new Error(`unexpected interval result ${JSON.stringify(v)}`);
}

function expectInterpreterValues(
  ce: ComputeEngine,
  json: unknown,
  to: string
): void {
  const result = compile(ce.box(json as any), {
    to,
    fallback: false,
  } as any) as { success: boolean; run: (v: object) => unknown };
  expect(result.success).toBe(true);
  for (const [x, y] of SAMPLES) {
    const expected = ce
      .box(json as any)
      .subs({ x, y })
      .evaluate().re;
    expect(realOf(result.run({ x, y }))).toBeCloseTo(expected, 10);
  }
}

describe('CE-564.2: a parameter typed as a tuple by index reads only', () => {
  test('the interpreter maps f over a list argument', () => {
    const ce = engineWithDefinitions();
    // f([0.3, 0.4]) = [-0.2, -0.1]; l of it = sqrt(0.05);
    // r = (2.332 + 0)·max(0, 0.5 - sqrt(0.05)) = 0.64454…
    expect(ce.box(['r', ['List', 0.3, 0.4]]).evaluate().re).toBeCloseTo(
      2.332 * (0.5 - Math.sqrt(0.05)),
      12
    );
    expect(
      ce.box(['d', ['B', ['A', ['P', 0.3, 0.4]]]]).evaluate().re
    ).toBeCloseTo(0.3524163823495667, 12);
  });

  test.each(['javascript', 'interval-js'])(
    'r([x, y]) compiles to the interpreter value on %s',
    (to) => {
      const ce = engineWithDefinitions();
      expectInterpreterValues(ce, ['r', ['List', 'x', 'y']], to);
    }
  );

  // Change 4 in the header: on interval-js the call takes the copy of `r`
  // typed by the list argument.
  test('r([x, y]) on interval-js calls the copy typed by its argument', () => {
    const ce = engineWithDefinitions();
    const result = compile(ce.box(['r', ['List', 'x', 'y']] as any), {
      to: 'interval-js',
      fallback: false,
    } as any) as { success: boolean; code: string };
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/_fn_r_vector_real_2_\(/);
  });

  // When the copy of `r` does not compile, the call takes the routes after
  // the copy (here the substitution of the list argument, change 3 in the
  // header) and the definitions that the failed copy added are removed. The
  // copy is made to fail after it emitted its definitions, which a body
  // that does not compile does too (`emitFunctionLiteralDefinition` removes
  // only the definitions of its own failure).
  test('r([x, y]) on interval-js compiles when the copy fails', () => {
    const ce = engineWithDefinitions();
    const original = (BaseCompiler as any).ensureSpecializedUserCallEmitted;
    const spy = jest
      .spyOn(BaseCompiler as any, 'ensureSpecializedUserCallEmitted')
      .mockImplementation(function (this: unknown, ...args: any[]) {
        const emitted = original.apply(this, args);
        if (args[1] === 'r') throw new Error('the copy of r does not compile');
        return emitted;
      });
    try {
      const json = ['r', ['List', 'x', 'y']];
      const result = compile(ce.box(json as any), {
        to: 'interval-js',
        fallback: false,
      } as any) as {
        success: boolean;
        code: string;
        preamble: string;
        run: (v: object) => any;
      };
      expect(result.success).toBe(true);
      expect(result.code).not.toMatch(/_fn_r_vector_real_2_/);
      expect(result.preamble ?? '').not.toMatch(/_fn_r_vector_real_2_/);
      for (const [x, y] of SAMPLES) {
        const expected = interpreterValue(ce, json, x, y);
        const [lo, hi] = bounds(
          result.run({ x: { lo: x, hi: x }, y: { lo: y, hi: y } })
        );
        expect(lo).toBeLessThanOrEqual(expected);
        expect(hi).toBeGreaterThanOrEqual(expected);
        expect(hi - lo).toBeLessThan(1e-9);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test('d(B(A(P(x, y)))) compiles to the interpreter value on javascript', () => {
    const ce = engineWithDefinitions();
    expectInterpreterValues(
      ce,
      ['d', ['B', ['A', ['P', 'x', 'y']]]],
      'javascript'
    );
  });

  // ROADMAP CE-564. The parameter of `d` is inferred as
  // `dictionary<any> | indexed_collection<any>`, which the call of `r`
  // inside the generic definition of `d` refuses. interval-js now compiles a
  // copy of `d` (and of `r`) typed by the list argument, `vector<2>`, as
  // javascript does (`ensureSpecializedUserCallEmitted`,
  // compilation/base-compiler.ts). The call declined before, with "call of
  // `r`: argument 1 has the type `dictionary<any> | indexed_collection<any>`".
  test('d(B(A(P(x, y)))) compiles to the interpreter value on interval-js', () => {
    const ce = engineWithDefinitions();
    expectInterpreterValues(
      ce,
      ['d', ['B', ['A', ['P', 'x', 'y']]]],
      'interval-js'
    );
  });

  test('d(B(A(P(x, y)))) on interval-js: a point interval encloses the interpreter value', () => {
    const ce = engineWithDefinitions();
    const json = ['d', ['B', ['A', ['P', 'x', 'y']]]];
    const result = compile(ce.box(json as any), {
      to: 'interval-js',
      fallback: false,
    } as any) as { success: boolean; run: (v: object) => any };
    expect(result.success).toBe(true);
    for (const [x, y] of SAMPLES) {
      const expected = interpreterValue(ce, json, x, y);
      const [lo, hi] = bounds(
        result.run({ x: { lo: x, hi: x }, y: { lo: y, hi: y } })
      );
      expect(lo).toBeLessThanOrEqual(expected);
      expect(hi).toBeGreaterThanOrEqual(expected);
      expect(hi - lo).toBeLessThan(1e-9);
    }
  });

  test('d(B(A(P(x, y)))) on interval-js: a small box encloses the interpreter values at its corners and centre', () => {
    const ce = engineWithDefinitions();
    const json = ['d', ['B', ['A', ['P', 'x', 'y']]]];
    const result = compile(ce.box(json as any), {
      to: 'interval-js',
      fallback: false,
    } as any) as { success: boolean; run: (v: object) => any };
    expect(result.success).toBe(true);
    const h = 1e-3;
    for (const [cx, cy] of SAMPLES) {
      const [lo, hi] = bounds(
        result.run({
          x: { lo: cx - h, hi: cx + h },
          y: { lo: cy - h, hi: cy + h },
        })
      );
      // The box is narrow, so the enclosure is bounded, not `entire`.
      expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
      for (const [x, y] of [
        [cx, cy],
        [cx - h, cy - h],
        [cx - h, cy + h],
        [cx + h, cy - h],
        [cx + h, cy + h],
      ]) {
        const expected = interpreterValue(ce, json, x, y);
        expect(lo).toBeLessThanOrEqual(expected);
        expect(hi).toBeGreaterThanOrEqual(expected);
      }
    }
  });

  test('d(B(A(P(x, y)))) on javascript: the call takes the copy typed by its argument', () => {
    const ce = engineWithDefinitions();
    const result = compile(
      ce.box(['d', ['B', ['A', ['P', 'x', 'y']]]] as any),
      { to: 'javascript', fallback: false } as any
    ) as { success: boolean; code: string };
    expect(result.success).toBe(true);
    expect(result.code).toBe('_fn_d_vector_2_(_fn_B(_fn_A(_fn_P(_.x, _.y))))');
  });

  test.each(['javascript', 'interval-js'])(
    'r((x, y)) with a point argument still declines on %s',
    (to) => {
      // The interpreter refuses it: `f` of a point is a tuple minus a
      // number.
      const ce = engineWithDefinitions();
      expect(ce.box(['r', ['Tuple', 0.3, 0.4]]).evaluate().isValid).toBe(
        false
      );
      const message = declineMessage(ce, ['r', ['Tuple', 'x', 'y']], to);
      expect(message).toMatch(/call of `f`/);
      expect(message).not.toMatch(/invalid expression/);
    }
  );

  test.each(['javascript', 'interval-js'])(
    'an annotated point parameter still declines a point argument on %s',
    (to) => {
      const ce = engineWithDefinitions();
      ce.assign(
        'ra',
        ce.box([
          'Function',
          [
            'Block',
            [
              'Multiply',
              ['Add', 'T', ['Floor', ['At', 'p', 1]]],
              ['Max', 0, ['Add', ['Negate', ['l', ['f', 'p']]], 0.5]],
            ],
          ],
          ['Typed', 'p', "'tuple<real, real>'"],
        ])
      );
      const message = declineMessage(ce, ['ra', ['Tuple', 'x', 'y']], to);
      expect(message).toMatch(/call of `f`/);
    }
  );

  // A point type that a CALL in the body requires is a contract, unlike one
  // that index reads alone made. `rc`'s parameter is inferred as
  // `tuple<real, real>` from the call of `h2`; the interpreter refuses a list
  // there (`h2` raises incompatible-type). The compiled call computed 0.5,
  // since a point and a list are the same array at run time. It now declines
  // (`checkScalarListAtContractPointParam`, compilation/base-compiler.ts).
  function engineWithContractCall(): ComputeEngine {
    const ce = engineWithDefinitions();
    ce.assign(
      'h2',
      ce.box([
        'Function',
        ['Add', ['At', 'q', 1], ['At', 'q', 2]],
        ['Typed', 'q', "'tuple<real, real>'"],
      ])
    );
    ce.assign(
      'rc',
      ce.box([
        'Function',
        ['Block', ['Add', ['h2', 'p'], ['f', ['At', 'p', 1]]]],
        'p',
      ])
    );
    return ce;
  }

  test('the interpreter refuses a list at the contract of h2', () => {
    const ce = engineWithContractCall();
    const v = ce.box(['rc', ['List', 0.3, 0.4]]).evaluate();
    expect(v.isValid).toBe(false);
    expect(JSON.stringify(v.json)).toMatch(/incompatible-type/);
  });

  test.each(['javascript', 'interval-js'])(
    'rc([x, y]) declines on %s',
    (to) => {
      const ce = engineWithContractCall();
      const message = declineMessage(ce, ['rc', ['List', 'x', 'y']], to);
      expect(message).toMatch(/call of `rc`/);
      expect(message).toMatch(/tuple<real, real>/);
    }
  );

  test('rc([x, y]) declines on glsl', () => {
    const ce = engineWithContractCall();
    expect(() =>
      new GLSLTarget().compile(ce.box(['rc', ['List', 'x', 'y']]))
    ).toThrow(/call of `rc`.*tuple<real, real>/);
  });

  test.each(['javascript', 'interval-js'])(
    'h2([x, y]) called directly declines on %s',
    (to) => {
      // The argument check of the call refuses the list when the call is
      // boxed; the decline names `h2` and the declared point type.
      const ce = engineWithContractCall();
      const message = declineMessage(ce, ['h2', ['List', 'x', 'y']], to);
      expect(message).toMatch(/h2/);
      expect(message).toMatch(/tuple<real, real>/);
    }
  );

  test.each(['javascript', 'interval-js'])(
    'h2((x, y)) and rc((x, y)) with a point compile to the interpreter value on %s',
    (to) => {
      const ce = engineWithContractCall();
      expectInterpreterValues(ce, ['h2', ['Tuple', 'x', 'y']], to);
      expectInterpreterValues(ce, ['rc', ['Tuple', 'x', 'y']], to);
    }
  );

  test.each(['javascript', 'interval-js'])(
    'an annotated point parameter still refuses a list argument on %s',
    (to) => {
      const ce = engineWithDefinitions();
      ce.assign(
        'ra',
        ce.box([
          'Function',
          ['Block', ['Add', ['f', ['At', 'p', 1]], ['At', 'p', 2]]],
          ['Typed', 'p', "'tuple<real, real>'"],
        ])
      );
      // The interpreter refuses a list at a parameter declared as a point.
      expect(ce.box(['ra', ['List', 0.3, 0.4]]).isValid).toBe(false);
      const message = declineMessage(ce, ['ra', ['List', 'x', 'y']], to);
      expect(message).toMatch(/incompatible-type|invalid/);
    }
  );
});
