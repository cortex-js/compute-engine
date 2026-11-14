import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { createJavaScriptRuntime } from '../../src/compute-engine/compilation/javascript-runtime';
import { compileSlice } from '../../src/compute-engine/compilation/ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

// Tuples, `PointList`, `Comprehension` and the list parameters of user
// functions in the profile `ir` (`ir/README.md`, "Tuples"): a tuple is a
// list of fixed length in the representation, an array in JavaScript, and
// an operator reads a tuple only where its value on a tuple is its value
// on the list of the same elements.

type Json = unknown;
type Point = Record<string, number | number[]>;
type JsResult = CompilationResult<'javascript'>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('D', 'list<real>');
ce.declare('J', 'list<integer>');
ce.declare('sumsq', '(list<real>) -> real');
ce.assign(
  'sumsq',
  ce.box([
    'Function',
    ['Sum', ['Map', ['Function', ['Power', 'z', 2], 'z'], 'B']],
    'B',
  ] as never)
);
// A board of the othello showcase, reduced: `flips(B, k, p)` counts, and
// `moves(B, p)` counts the squares `k` with a flip.
ce.declare('flips', '(list<integer>, integer, integer) -> integer');
ce.assign(
  'flips',
  ce.box([
    'Function',
    ['If', ['Equal', ['At', 'B', 'k'], 'p'], ['Add', 'k', 'p'], 0],
    'B',
    'k',
    'p',
  ] as never)
);
ce.declare('moves', '(list<integer>, integer) -> integer');
ce.assign(
  'moves',
  ce.box([
    'Function',
    [
      'Length',
      [
        'Comprehension',
        'k',
        [
          'Element',
          'k',
          ['Range', 1, 8],
          ['Less', 0, ['flips', 'B', 'k', 'p']],
        ],
      ],
    ],
    'B',
    'p',
  ] as never)
);
ce.declare('legal', '(list<integer>, integer) -> list<integer>');
ce.assign(
  'legal',
  ce.box([
    'Function',
    [
      'Comprehension',
      'k',
      ['Element', 'k', ['Range', 1, 8], ['Less', 0, ['flips', 'B', 'k', 'p']]],
    ],
    'B',
    'p',
  ] as never)
);

const box = (json: Json): Expression => ce.box(json as never);

function ir(json: Json, options: Record<string, unknown> = {}): JsResult {
  const r = compile(box(json), {
    profile: 'ir',
    fallback: false,
    ...options,
  } as never) as JsResult;
  expect(r.profile).toBe('ir');
  return r;
}

/** The cause of the decline of `json`. */
function declined(json: Json, options: Record<string, unknown> = {}): string {
  try {
    ir(json, options);
  } catch (e) {
    return String(e);
  }
  throw new Error(`${JSON.stringify(json)} compiles`);
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isSymbol(e, 'True') || isSymbol(e, 'False')) return isSymbol(e, 'True');
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function interpret(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((n) => ce.number(n))
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within `tolerance`. */
function agree(v: unknown, w: unknown, tolerance = 1e-12): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x, tolerance))
    );
  if (typeof w !== 'number') return v === w;
  return (
    typeof v === 'number' &&
    Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w))
  );
}

function check(
  json: Json,
  points: Point[],
  options = {},
  tolerance = 1e-12
): JsResult {
  const r = ir(json, options);
  for (const p of points) {
    const got = (r.run as (v: unknown) => unknown)(p);
    const want = interpret(json, p);
    if (!agree(got, want, tolerance))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

// The options of Tycho's audit.
const TYCHO = {
  mode: 'strict',
  iterationBudget: 1000000,
  symbolic: ['x', 'y', 'u', 'v'],
};

describe('the witnesses of the audit', () => {
  test('a parametric curve: Tuple(Cos(t), Sin(t)) is an array of two numbers', () => {
    check(
      ['Tuple', ['Cos', 't'], ['Sin', 't']],
      [{ t: 0.3 }, { t: 2 }, { t: 6.1 }],
      { ...TYCHO, inputs: { t: 'real<-0.31..6.6>', a: 'real<-10..10>' } }
    );
  });
  test('a Prelude statement: a constant in a one-element tuple', () => {
    const json = [
      'Block',
      ['Declare', 'L', { dict: { value: 240, constant: true } }],
      ['Tuple', 'L'],
    ];
    expect(check(json, [{}], { iterationBudget: 100000000 }).run!({})).toEqual([
      240,
    ]);
  });
  test('PointList of scalar components is a point', () => {
    check(
      [
        'PointList',
        ['Multiply', -0.4, ['Sin', 't'], 't'],
        ['Multiply', 0.4, ['Cos', 't'], 't'],
      ],
      [{ t: -4 }, { t: 1.5 }],
      { ...TYCHO, inputs: { t: 'real<-4..84>' } }
    );
  });
  test('a Comprehension of tuples over a Range of a run-time length', () => {
    const frac = (c: number) => [
      'Add',
      ['Multiply', c, ['Sin', ['Multiply', 0.7, 'k']]],
      ['Negate', ['Floor', ['Multiply', c, ['Sin', ['Multiply', 0.7, 'k']]]]],
    ];
    const json = [
      'Comprehension',
      [
        'Tuple',
        ['Multiply', 1.4, ['Cos', ['Multiply', 2, 'Pi', frac(24634.6345)]]],
        ['Multiply', 1.4, ['Sin', ['Multiply', 2, 'Pi', frac(24634.6345)]]],
      ],
      [
        'Element',
        'k',
        ['Range', 1, ['Floor', ['Multiply', ['Rational', 1, 3], 'K']]],
      ],
    ];
    // The fractional part of 24634.6345·Sin(0.7k) scales the rounding of
    // the double `Sin` by about 2·10^5 (the interpreter computes it with
    // more digits): an ill-conditioned point, compared within 1e-9.
    check(
      json,
      [{ K: 10 }, { K: 2 }],
      { ...TYCHO, symbolic: ['K', 'x', 'y'] },
      1e-9
    );
  });
  test('a Comprehension with a condition in a function with a list parameter', () => {
    const B = [1, 2, 1, 1, 2, 2, 1, 2];
    check(['moves', 'J', 1], [{ J: B }, { J: B.map((n) => 3 - n) }], TYCHO);
    check(['moves', 'J', ['At', 'J', 2]], [{ J: B }], TYCHO);
  });
  test('a user function with a list result still declines (othello `legal`)', () => {
    expect(declined(['legal', 'J', ['At', 'J', 1]], TYCHO)).toMatch(
      /the result of legal is not a scalar/
    );
  });
});

describe('the tuple-consumption rule', () => {
  test('an operator whose value on a tuple is its value on a list reads it', () => {
    const points = [{ x: 0.5 }, { x: -2 }];
    check(['Multiply', 2, ['Tuple', 'x', 1]], points);
    check(['Add', ['Tuple', 'x', 1], ['Tuple', 1, ['Sin', 'x']]], points);
    check(['Divide', ['Tuple', 'x', 1], 4], points);
    check(['Power', ['Tuple', 'x', 3], 2], points);
    check(['Sin', ['Tuple', 'x', 1]], points);
    check(['At', ['Tuple', 'x', 7], 2], points);
    check(['Length', ['Tuple', 'x', 7]], points);
    check(['Sum', ['Tuple', 'x', 7]], points);
    check(['Max', ['Tuple', 'x', 7], 3], points);
    check(
      ['If', ['Less', 'x', 0], ['Tuple', 'x', 1], ['Tuple', 1, 'x']],
      points
    );
    check(['At', ['List', ['Tuple', 'x', 1], ['Tuple', 2, 3]], 2], points);
    check(
      ['Multiply', 3, ['List', ['Tuple', 'x', 1], ['Tuple', 2, 3]]],
      points
    );
  });
  test('any other operator declines a tuple', () => {
    // `Abs` of a point is its norm; of a list, the absolute values.
    expect(declined(['Abs', ['Tuple', 'x', 1]])).toMatch(/Abs of a tuple/);
    // `Equal(Tuple(1, 2), List(1, 2))` is False.
    expect(declined(['Equal', ['Tuple', 'x', 1], ['Tuple', 'x', 1]])).toMatch(
      /Equal of a tuple/
    );
    expect(declined(['Less', ['Tuple', 'x', 1], 3])).toMatch(/Less of a tuple/);
    expect(
      declined(['If', ['Less', 'x', 0], ['Tuple', 'x', 1], ['List', 1, 'x']])
    ).toMatch(/arms of a tuple and a list/);
    expect(declined(['Tuple', ['Tuple', 'x', 1], ['Tuple', 'x', 1]])).toMatch(
      /a tuple of tuples/
    );
    expect(declined(['Tuple', 'x', 'True'])).toMatch(/elements of two types/);
    expect(
      declined(['Comprehension', 'k', ['Element', 'k', ['Tuple', 'x', 1]]])
    ).toMatch(/a tuple where a list is read/);
    // A tuple typed as a list reaches the check of a call.
    expect(
      declined(['sumsq', ['Typed', ['Tuple', 'x', 1], "'list<real>'"]])
    ).toMatch(/an argument of sumsq/);
  });
});

describe('the static type error and effects', () => {
  const TL = ['Tuple', ['List', 'x', 2, 3], ['List', 4, 'x', 6]];
  test('a sub-expression of the type error declines', () => {
    ce.declare('w', 'vector<3>');
    for (const json of [
      ['Sin', ['Tuple', 'w']],
      ['Multiply', 2, TL],
      ['Add', TL, TL],
      ['Power', TL, 2],
      ['Negate', TL],
      ['Sin', ['Tuple', ['List', 'x', 1], ['List', 2, 3]]],
    ])
      expect(declined(json)).toMatch(/static type error/);
  });
  test('a tuple of lists is read where its type is valid', () => {
    const points = [{ x: 0.5 }, { x: -2 }];
    for (const json of [
      TL,
      ['Length', TL],
      ['At', TL, 2],
      ['Abs', ['At', TL, 2]],
    ])
      check(json, points);
  });
  test('a Comprehension with an effect declines (the interpreter is lazy)', () => {
    expect(
      declined([
        'WithRandomSeed',
        1,
        [
          'Tuple',
          ['Length', ['Comprehension', ['Random'], ['Element', 'z', 'D']]],
          ['Random'],
        ],
      ])
    ).toMatch(/a Comprehension with an effect/);
    check(
      [
        'WithRandomSeed',
        1,
        [
          'Tuple',
          [
            'Sum',
            ['Comprehension', ['Multiply', 2, 'z'], ['Element', 'z', 'D']],
          ],
          ['Random'],
        ],
      ],
      [{ D: [1, 2, 3] }]
    );
  });
});

describe('results', () => {
  test('a tuple result in broadcast(): the stride of its type', () => {
    const r = ir(['Tuple', ['Cos', 'x'], ['Multiply', 2, 'x']]);
    expect(r.broadcastOutputs).toBe(2);
    const xs = new Float64Array([0, 0.5, 2]);
    const got = r.broadcast!({ x: xs }, { outputs: 2 });
    expect(Array.from(got)).toEqual(
      Array.from(xs).flatMap((x) => [Math.cos(x), 2 * x])
    );
  });
  test('stored code loads and gives the values of run()', () => {
    const r = ir([
      'PointList',
      'D',
      ['Map', ['Function', ['Multiply', 'x', 'z'], 'z'], 'D'],
    ]);
    const stored = JSON.parse(
      JSON.stringify({
        code: r.code,
        preambleOnce: r.preambleOnce,
        reconstructionDigits: r.reconstructionDigits,
        calling: r.calling,
        entryPlan: r.entryPlan,
        mode: r.mode,
        runtimeVersion: r.runtimeVersion,
      })
    );
    const f = createJavaScriptRuntime().load(stored);
    const p = { D: [1, 2, 3], x: 0.5 };
    expect(f(p)).toEqual(r.run!(p as never));
    expect(f(p)).toEqual([
      [1, 0.5],
      [2, 1],
      [3, 1.5],
    ]);
  });
  test('GLSL: a tuple is an array of floats', () => {
    const code = compileSlice(box(['Tuple', ['Cos', 'x'], ['Sin', 'x']]), {
      target: 'glsl',
    }).code;
    expect(code).toMatch(/float\[2\] f\(float in0_x\)/);
    expect(code).toMatch(/return float\[2\]\(cos\(in0_x\), sin\(in0_x\)\);/);
  });
});

describe('PointList and Comprehension', () => {
  test('PointList of lists: one point per index, a scalar in each', () => {
    const points = [
      { D: [1, -2, 3], x: 0.5 },
      { D: [4], x: 2 },
    ];
    check(
      ['PointList', 'D', ['Map', ['Function', ['Sin', 'z'], 'z'], 'D']],
      points
    );
    check(['PointList', 'D', 'x'], points);
    // Static lengths: as long as the shortest.
    check(['PointList', ['List', 1, 2, 3], ['List', 'x', 5]], points);
    expect(declined(['PointList', 'D', ['List', 1, 2]])).toMatch(
      /not one length/
    );
  });
  test('Comprehension over a Range and over a list, with and without a condition', () => {
    const points = [
      { D: [1, -2, 3, 0.5], x: 0.5 },
      { D: [4], x: 2 },
    ];
    check(
      [
        'Comprehension',
        ['Multiply', 'k', 'x'],
        ['Element', 'k', ['Range', 1, 5]],
      ],
      points
    );
    check(
      ['Comprehension', ['Multiply', 2, 'z'], ['Element', 'z', 'D']],
      points
    );
    check(
      [
        'Comprehension',
        ['Tuple', 'z', ['Sin', 'z']],
        ['Element', 'z', 'D', ['Less', 0, 'z']],
      ],
      points
    );
    check(
      [
        'Comprehension',
        'k',
        ['Element', 'k', ['Range', 1, 9], ['Less', ['Multiply', 4, 'x'], 'k']],
      ],
      points
    );
    check(
      ['Sum', ['Comprehension', ['Power', 'z', 2], ['Element', 'z', 'D']]],
      points
    );
    expect(
      declined([
        'Comprehension',
        ['Add', 'j', 'k'],
        ['Element', 'k', ['Range', 1, 2]],
        ['Element', 'j', ['Range', 1, 3]],
      ])
    ).toMatch(/of one clause/);
  });
});

describe('list parameters of user functions', () => {
  test('called twice with lists of different lengths', () => {
    check(
      [
        'Add',
        ['sumsq', 'D'],
        ['sumsq', ['List', 1, 2]],
        ['sumsq', ['Map', ['Function', ['Multiply', 'x', 'z'], 'z'], 'D']],
      ],
      [
        { D: [1, 2, 3], x: 0.5 },
        { D: [-1], x: 2 },
      ]
    );
  });
  test('a scalar parameter still declines a list argument', () => {
    ce.declare('twice', '(real) -> real');
    ce.assign('twice', box(['Function', ['Multiply', 2, 'a'], 'a']));
    expect(declined(['twice', 'D'])).toMatch(/a list argument of twice/);
  });
});
