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
  test('a user function with a list result (othello `legal`)', () => {
    const B = [1, 2, 1, -1, 2, 0, 1, 2];
    const points = [{ J: B }, { J: B.map((n) => 3 - n) }];
    check(['legal', 'J', ['At', 'J', 1]], points, TYCHO);
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
    // `Abs` of a point is its norm; of a list, the absolute values.
    check(['Abs', ['Tuple', 'x', 1]], points);
  });
  test('any other operator declines a tuple', () => {
    // `Equal(Tuple(1, 2), List(1, 2))` is False. Two tuples of numbers are
    // compared (`ir-statistics-binomial-equality.test.ts`).
    expect(declined(['Equal', ['Tuple', 'x', 1], ['List', 'x', 1]])).toMatch(
      /Equal of a tuple/
    );
    expect(declined(['Less', ['Tuple', 'x', 1], 3])).toMatch(/Less of a tuple/);
    expect(
      declined(['If', ['Less', 'x', 0], ['Tuple', 'x', 1], ['List', 1, 'x']])
    ).toMatch(/arms of a tuple and a list/);
    // A tuple of tuples, and of a number and a boolean, is a record
    // (CE-1652, `compile-records.test.ts`), which `Length` does not read.
    expect(
      declined(['Length', ['Tuple', ['Tuple', 'x', 1], ['Tuple', 'x', 1]]])
    ).toMatch(/a scalar where a list is required/);
    expect(declined(['Length', ['Tuple', 'x', 'True']])).toMatch(
      /a scalar where a list is required/
    );
    expect(
      declined(['Comprehension', 'k', ['Element', 'k', ['Tuple', 'x', 1]]])
    ).toMatch(/a tuple where a list is read/);
    // A tuple typed as a list reaches the check of a call.
    expect(
      declined(['sumsq', ['Typed', ['Tuple', 'x', 1], "'list<real>'"]])
    ).toMatch(/an argument of sumsq/);
  });
  test('a tuple input of scalars is an array of its elements, a tuple', () => {
    ce.declare('Pt', 'tuple<real, real>');
    ce.declare('Qt', 'tuple<real, integer>');
    const tuple = (v: number[]) =>
      ce.function(
        'Tuple',
        v.map((n) => ce.number(n))
      );
    for (const json of [
      ['Add', ['Multiply', 2, 'Pt'], 'Qt'],
      ['At', 'Pt', 2],
      ['Sum', 'Qt'],
      ['Sin', 'Pt'],
      ['Abs', 'Pt'],
    ])
      for (const [Pt, Qt] of [
        [
          [1, 2],
          [0.5, -1],
        ],
        [
          [-3, 0.25],
          [2, 7],
        ],
      ]) {
        const want = ce.withValues({ Pt: tuple(Pt), Qt: tuple(Qt) }, () =>
          read(box(json).evaluate().N())
        );
        expect(agree(ir(json).run!({ Pt, Qt } as never), want)).toBe(true);
      }
    expect(declined(['Less', 'Pt', 3])).toMatch(/Less of a tuple/);
    expect(
      declined(['At', 'P2', 1], { inputs: { P2: 'tuple<real, boolean>' } })
    ).toMatch(/the input P2/);
    // An element of type `unknown` or `any` declines, as in a list; a
    // `number` element is a real.
    for (const T of ['tuple<unknown, unknown>', 'tuple<any, real>'])
      expect(declined(['Add', ['At', 'T', 1], 1], { inputs: { T } })).toMatch(
        /the input T/
      );
    expect(
      ir(['Add', ['At', 'T', 1], 1], {
        inputs: { T: 'tuple<number, number>' },
      }).run!({ T: [1.5, 2] } as never)
    ).toBe(2.5);
  });
  test('a root Function literal with a tuple parameter, and a tuple input in the bigint mode', () => {
    const f = ir([
      'Function',
      ['Add', ['At', 'p', 1], ['Multiply', 2, ['At', 'p', 2]]],
      ['Typed', 'p', "'tuple<real, real>'"],
    ]);
    expect(f.calling).toBe('lambda');
    expect((f.run as (p: number[]) => number)([3, 4])).toBe(11);
    const b = ir(['Add', ['At', 'N', 1], ['Multiply', 2, ['At', 'N', 2]]], {
      mode: 'bigint',
      inputs: { N: 'tuple<integer, integer>' },
    });
    expect(b.run!({ N: [3n, 4n] } as never)).toBe(11n);
    expect(b.run!({ N: [2n ** 60n, 1n] } as never)).toBe(2n ** 60n + 2n);
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
  test('GLSL: a tuple of 2 to 4 numbers is a vector', () => {
    const code = compileSlice(box(['Tuple', ['Cos', 'x'], ['Sin', 'x']]), {
      target: 'glsl',
    }).code;
    expect(code).toMatch(/vec2 f\(float in0_x\)/);
    expect(code).toMatch(/return vec2\(cos\(in0_x\), sin\(in0_x\)\);/);
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
    // As long as the shortest, also of a run-time length.
    check(['PointList', ['List', 1, 2, 3], ['List', 'x', 5]], points);
    check(['PointList', 'D', ['List', 1, 2]], points);
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
    // Two clauses: the flat Cartesian product (batch G17).
    check(
      [
        'Comprehension',
        ['Add', 'j', 'k'],
        ['Element', 'k', ['Range', 1, 2]],
        ['Element', 'j', ['Range', 1, 3]],
      ],
      points
    );
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
  test('a scalar parameter maps over a list argument, as the interpreter does', () => {
    ce.declare('twice', '(real) -> real');
    ce.assign('twice', box(['Function', ['Multiply', 2, 'a'], 'a']));
    check(['twice', 'D'], [{ D: [1, 2, 3] }, { D: [] }]);
  });
});

// The declines of Tycho's third corpus run: the result and parameter types
// of user functions that are unions with an absent member, Prelude
// statements whose value is a list or a tuple, and list results of user
// functions.
describe('result types with an absent member', () => {
  const define = (name: string, type: string, json: Json) => {
    ce.declare(name, type);
    ce.assign(name, box(json));
  };
  test('missing | rational, nan | number, complex | nan, nan | real', () => {
    define('l0', '(real) -> missing | rational', [
      'Function',
      ['Which', ['Less', 't', 1], ['Rational', 1, 2], ['Greater', 't', 3], 2],
      't',
    ]);
    define('rr', '(real, real) -> nan | number', [
      'Function',
      ['Sqrt', ['Add', ['Power', 'a', 2], ['Power', 'b', 2]]],
      'a',
      'b',
    ]);
    define('yy', '(real) -> complex | nan', [
      'Function',
      ['Multiply', ['Sin', 't'], ['Sqrt', ['Subtract', 1, ['Power', 'x', 2]]]],
      't',
    ]);
    define('pp', '(nan | real) -> real', [
      'Function',
      ['Multiply', 2, 's'],
      's',
    ]);
    const points = [
      { x: 0.5, y: 2 },
      { x: 4, y: -1 },
      { x: -0.3, y: 0.3 },
    ];
    check(['Add', ['l0', 'x'], 1], points);
    check(['rr', 'x', 'y'], points);
    check(['Add', ['yy', 'y'], 1], [points[0], points[2]]);
    check(['pp', 'x'], points);
    // Where the interpreter gives `Missing`, the compiled code gives NaN.
    expect(ir(['l0', 'x']).run!({ x: 2 } as never)).toBeNaN();
  });
});

/** The attributes of a constant local of the value `value`. */
const constantOf = (value: Json) => [
  'Dictionary',
  ['KeyValuePair', { str: 'value' }, value],
  ['KeyValuePair', { str: 'constant' }, 'True'],
];

describe('Prelude statements of a list or a tuple', () => {
  const constant = (name: string, value: Json, last: Json) => [
    'Block',
    ['Declare', name, constantOf(value)],
    last,
  ];
  test('a list local of run-time length in a one-element tuple', () => {
    const json = constant(
      'H',
      [
        'Comprehension',
        ['Multiply', 'k', 'x'],
        ['Element', 'k', ['Range', 1, 'n']],
      ],
      ['Tuple', 'H']
    );
    check(
      json,
      [
        { n: 3, x: 0.5 },
        { n: 1, x: 2 },
      ],
      { inputs: { n: 'integer' } }
    );
  });
  test('a tuple local in a one-element tuple, a tuple of tuples', () => {
    check(constant('O', ['Tuple', -1, 0, 0], ['Tuple', 'O']), [{}]);
    check(['Tuple', ['Tuple', 'x', 1], ['Tuple', 2, 'x']], [{ x: 0.5 }]);
  });
  test('a root Tuple of a number, a boolean and a list', () => {
    const r = check(
      ['Tuple', 'x', ['Less', 'x', 0], 'D'],
      [
        { x: 0.5, D: [1, 2] },
        { x: -1, D: [3] },
      ]
    );
    expect(r.run!({ x: -1, D: [3] } as never)).toEqual([-1, true, [3]]);
  });
  test('a root Tuple of a list and a scalar: an input list is itself', () => {
    const r = check(['Tuple', 'D', 'x'], [{ D: [1, 2, 3], x: 0.5 }]);
    const D = [1, 2];
    const got = r.run!({ D, x: 1 } as never) as unknown[];
    expect(got).toEqual([[1, 2], 1]);
    expect(got[0]).toBe(D);
    expect(r.broadcastOutputs).toBeUndefined();
  });
  test('a list local that is not written; one written whole is its value', () => {
    check(
      constant(
        'L',
        ['Map', ['Function', ['Sin', 'z'], 'z'], 'D'],
        ['Add', 'L', 'L']
      ),
      [{ D: [1, 2, 3] }]
    );
    // A list local written whole (CE-1481).
    check(
      [
        'Block',
        [
          'Declare',
          't',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, 'D']],
        ],
        ['Assign', 't', ['List', 1]],
        't',
      ],
      [{ D: [1, 2, 3] }]
    );
    // An inner block that writes the outer list local; one that then
    // declares its own of that name is an error of the canonical form.
    const value = (v: Json) => [
      'Dictionary',
      ['KeyValuePair', { str: 'value' }, v],
    ];
    const outer = (...rest: Json[]) => [
      'Block',
      ['Declare', 'H', value('D')],
      ['Block', ['Assign', 'H', ['List', 1]], ...rest],
      ['At', 'H', 1],
    ];
    const inner = (...rest: Json[]) => declined(outer(...rest));
    check(outer(0), [{ D: [1, 2, 3] }]);
    expect(inner(['Declare', 'H', value(['List', 5, 6])], 'H')).toMatch(
      /static type error/
    );
    expect(declined(['Block', ['Declare', 't', "'real'", 'D'], 0])).toMatch(
      /a list value for a local declared real/
    );
  });
  test('GLSL declines a root Tuple of several shapes', () => {
    expect(() =>
      compileSlice(box(['Tuple', ['List', 1, 'x'], 'x']), { target: 'glsl' })
    ).toThrow(/a Tuple of elements of several shapes/);
  });
});

describe('list results of user functions', () => {
  ce.declare('total', '(list<integer>) -> integer');
  ce.assign('total', box(['Function', ['Sum', 'S'], 'S']));
  ce.declare('same', '(list<real>) -> list<real>');
  ce.assign('same', box(['Function', 'L', 'L']));
  ce.declare('three', '(real) -> list<real^3>');
  ce.assign(
    'three',
    box(['Function', ['List', 'a', ['Multiply', 2, 'a'], 3], 'a'])
  );
  ce.declare('pt', '(real) -> tuple<real, real>');
  ce.assign(
    'pt',
    box(['Function', ['Tuple', ['Cos', 'a'], ['Sin', 'a']], 'a'])
  );
  ce.declare('pairz', '(real) -> list<complex^2>');
  ce.assign('pairz', box(['Function', ['List', 'a', 'a'], 'a']));
  const B = [1, 0, 1, -1, 1, 0, 0, 1];
  const boards = [{ J: B }, { J: B.map((n) => -n) }];
  const legal = ['legal', 'J', ['At', 'J', 3]];
  test('the othello witness, read by the list readers', () => {
    for (const json of [
      legal,
      ['Length', legal],
      ['At', legal, 1],
      ['Sum', legal],
      ['total', legal],
      ['Block', ['Declare', 'X', constantOf(legal)], ['Add', 'X', 'X']],
      ['Block', ['Declare', 'X', constantOf(legal)], ['Tuple', 'X']],
    ])
      check(json, boards, TYCHO);
  });
  test('two calls with lists of different lengths', () => {
    check(
      [
        'Add',
        ['Length', ['legal', 'J', 1]],
        ['Length', ['legal', ['List', 1, 2, 1], 1]],
      ],
      boards,
      TYCHO
    );
  });
  test('a call in a Map body and in a Sum body', () => {
    check(
      ['Sum', ['Length', ['legal', 'J', 'k']], ['Limits', 'k', -1, 1]],
      boards,
      TYCHO
    );
    check(
      [
        'Map',
        ['Function', ['Sum', ['legal', 'J', 'k']], 'k'],
        ['Range', -1, 1],
      ],
      boards,
      TYCHO
    );
  });
  test('a function that returns its list parameter: the result is the input', () => {
    const r = check(['same', 'D'], [{ D: [1, 2, 3] }, { D: [4] }]);
    const D = [1, 2];
    expect(r.run!({ D } as never)).toBe(D);
  });
  test('a fixed-length list or tuple result; a complex list result declines', () => {
    const points = [{ x: 0.5 }, { x: -2 }];
    check(['three', 'x'], points);
    check(['Add', ['three', 'x'], ['List', 1, 2, 3]], points);
    check(['pt', 'x'], points);
    check(['Add', ['Multiply', 2, ['pt', 'x']], ['Tuple', 1, 'x']], points);
    // A declared complex element: a real body would take the real lane
    // (`Sqrt(At(pairz(x), 1))` at x = -4 is 2i in the interpreter).
    expect(declined(['Sqrt', ['At', ['pairz', 'x'], 1]])).toMatch(
      /the result of pairz is not a scalar/
    );
  });
  test('stored code loads and gives the values of run()', () => {
    const r = ir(legal, TYCHO);
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
    for (const p of boards) expect(f(p)).toEqual(r.run!(p as never));
  });
  test('broadcast() of a scalar program that calls such a function', () => {
    const r = ir(['Add', 'x', ['Length', ['three', 'x']]]);
    expect(Array.from(r.broadcast!({ x: new Float64Array([1, 2]) }))).toEqual([
      4, 5,
    ]);
  });
  test('the bigint mode', () => {
    const r = ir(['Length', legal], { ...TYCHO, mode: 'bigint' });
    expect(r.run!({ J: B } as never)).toBe(
      BigInt(interpret(['Length', legal], { J: B }) as number)
    );
  });
  test('GLSL admits a list result of a stated length and declines one of a run-time length', () => {
    expect(
      compileSlice(box(['Sum', ['three', 'x']]), { target: 'glsl' }).code
    ).toMatch(/^vec3 _fn_\w+_three\(float/m);
    expect(() =>
      compileSlice(box(['Sum', ['legal', ['List', 1, 0, 1], 1]]), {
        target: 'glsl',
      })
    ).toThrow(
      /the list made by the program \(a Range or a Filter\) has a run-time length/
    );
  });
});

describe('the causes of the third corpus run', () => {
  ce.declare('A', 'list<real>');
  ce.declare('U', 'list<real>');
  ce.declare('Xs', 'list<real>');
  ce.declare('Ls', 'list<real^3>');
  ce.declare('Qr', 'list<list<real^2>>');
  ce.declare('Rr', 'list<list<real^2>>');
  test('ElementMax and ElementMin: scalars, a list and a scalar', () => {
    const uv = { ...TYCHO, inputs: { u: 'real', v: 'real' } };
    const points = [
      { u: 0.2, v: 0.1 },
      { u: 1.5, v: 0.5 },
      { u: -2, v: 0.9 },
    ];
    // The witness (art/n7uhaaoq1q), its first component.
    const twist = [
      'Multiply',
      0.25,
      ['Cos', ['Multiply', 3, 'u']],
      ['ElementMin', 'v', 0.8],
    ];
    check(
      ['Tuple', ['Add', ['Negate', ['ElementMax', 'v', 0.3]], 2], twist],
      points,
      uv
    );
    check(['ElementMin', 'v', 0.8, 'u'], points, uv);
    check(['ElementMax', 'n', 3], [{ n: 7 }, { n: -1 }], {
      inputs: { n: 'integer' },
    });
    check(['ElementMax', 'D', 0.3], [{ D: [0.1, 0.5, 0.9] }]);
    check(['ElementMin', 'x', 'D'], [{ D: [0.1, 0.5, 0.9], x: 0.4 }]);
    // galton-board: a nested clamp of a fractional part.
    check(
      [
        'ElementMin',
        ['ElementMax', ['Add', ['Multiply', 2, ['Fract', 'x']], -0.5], 0],
        1,
      ],
      [{ x: 0.1 }, { x: 3.4 }, { x: 0.9 }]
    );
    const glsl = compileSlice(box(['ElementMax', 'x', 0.3]), {
      target: 'glsl',
    });
    expect(glsl.code).toMatch(/max\(in0_x, 0\.3/);
  });
  test('If of a tuple with no else: the tuple of NaN', () => {
    // The witness (showcase/spiral-galaxy).
    const grow = ['Power', 'ExponentialE', ['Multiply', 0.1, 't']];
    const json = [
      'If',
      ['LessEqual', 't', 'W'],
      [
        'Tuple',
        ['Multiply', ['Cos', 't'], grow],
        ['Multiply', ['Sin', 't'], grow],
      ],
    ];
    const opts = { ...TYCHO, inputs: { t: 'real', W: 'real<-10..10>' } };
    const r = check(
      json,
      [
        { t: 0.5, W: 1 },
        { t: -3, W: 2 },
      ],
      opts
    );
    const off = { t: 2, W: 1 };
    expect(r.run!(off as never)).toEqual([NaN, NaN]);
    expect(interpret(json, off)).toEqual([NaN, NaN]);
    // An integer tuple; the scalar arm stays NaN.
    const ints = ['If', ['Less', 'x', 0], ['Tuple', 1, 2]];
    expect(ir(ints).run!({ x: 1 } as never)).toEqual(interpret(ints, { x: 1 }));
    const one = ['If', ['Less', 'x', 0], 'x'];
    expect(ir(one).run!({ x: 1 } as never)).toEqual(NaN);
    // A list arm gives `Missing` in the interpreter: the compiled value is
    // the list of NaN of its length (CE-1564).
    expect(
      ir(['If', ['Less', 'x', 0], ['List', 'x', 1]]).run!({ x: 1 } as never)
    ).toEqual([NaN, NaN]);
    expect(
      ir(['If', ['Less', 'x', 0], ['Multiply', 2, 'D']]).run!({
        x: 1,
        D: [1, 2, 3],
      } as never)
    ).toEqual([NaN, NaN, NaN]);
    // A `Which` and a boolean tuple give `Missing` in the interpreter, not
    // a tuple of NaN.
    expect(
      declined([
        'If',
        ['Less', 'x', 0],
        ['Tuple', ['Less', 'x', 1], ['Less', 'x', 2]],
      ])
    ).toMatch(/arms of two types/);
    expect(declined(['Which', ['Less', 'x', 0], ['Tuple', 'x', 1]])).toMatch(
      /arms of two types/
    );
    ce.pushScope();
    ce.declare('W', 'real<-10..10>');
    const glsl = compileSlice(box(json), { target: 'glsl' }).code;
    ce.popScope();
    expect(glsl).toMatch(/vec2\(/);
  });
  test('a Range of real operands: its elements are lo + k·step', () => {
    const points = [{ K: 3.5 }, { K: 4 }, { K: -2.5 }];
    const opts = { ...TYCHO, symbolic: ['K', 'x', 'y'] };
    check(['Sum', ['Range', 1, 'K']], points, opts);
    check(
      [
        'Comprehension',
        ['Multiply', 2, 'k'],
        ['Element', 'k', ['Range', 1, 'K']],
      ],
      points,
      opts
    );
    check(['Length', ['Range', 2, 'K', 2]], points, opts);
    // A real first element or step: the elements are reals (batch G12).
    check(['Range', 'x', 5], [{ x: 0.5 }, { x: -1.25 }], opts);
    check(['Range', 1, 5, 'x'], [{ x: 1.5 }, { x: -1 }], opts);
  });
  test('lists of two run-time lengths: the length of the first', () => {
    // The witness (showcase/three-body-problem).
    const json = [
      'Add',
      ['Multiply', ['Rational', 1, 2], 'A', ['Power', 'h', 2]],
      ['Multiply', 'U', 'h'],
      'Xs',
    ];
    const opts = { ...TYCHO, inputs: { h: 'real' } };
    const p = { A: [1, -2, 0.5], U: [3, 4, 2], Xs: [5, 6, -1], h: 0.25 };
    const r = check(json, [p, { ...p, h: -3 }], opts);
    // Two lengths: the interpreter's value is an error (the static type
    // `list<real>` does not show it), so the value is unspecified.
    expect(() => interpret(json, { ...p, Xs: [5, 6] })).toThrow(/no value/);
    expect(r.run!({ ...p, Xs: [5, 6] } as never)).toHaveLength(3);
    // Two stated lengths that differ still decline.
    expect(declined(['Add', ['List', 1, 'x'], ['List', 1, 2, 3]])).toMatch(
      /different lengths|static type error/
    );
  });
  test('a run-time length and a stated one', () => {
    // Two stated lengths that differ decline.
    expect(
      declined(['Add', ['Multiply', ['List', 1, 2, 3], 'D'], ['List', 4, 5]])
    ).toMatch(/different lengths/);
    // A run-time length and a known one, at equal lengths.
    const p = { D: [0.5, -1, 2], A: [3, 1, -4], Ls: [1, 2, 7], x: 0.3 };
    for (const json of [
      ['Add', 'D', 'A'],
      ['Add', 'D', 'Ls'],
      ['Add', 'Ls', 'D'],
      ['Multiply', 'Ls', ['Add', 'D', 'x']],
    ])
      check(json, [p]);
  });
  test('lists of rank 2 of two run-time lengths and one inner length', () => {
    // The outer length is read as at rank 1 (CE-1537): the result has the
    // length of the first list, unspecified when the lengths differ.
    const r = ir(['Add', 'Qr', 'Rr']);
    expect(
      (r.run as (v: unknown) => unknown)({
        Qr: [
          [1, 2],
          [3, 4],
        ],
        Rr: [
          [10, 20],
          [30, 40],
        ],
      })
    ).toEqual([
      [11, 22],
      [33, 44],
    ]);
    check(
      ['Add', ['PointList', 'D', 'D'], ['PointList', 'A', 'A']],
      [{ D: [0.5, -1, 2], A: [3, 1, -4] }]
    );
  });
});
