import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

// The profile `ir` maps a call of a user function over a list argument
// where the interpreter maps it, and binds the list whole where the
// interpreter binds it whole (`listMapsAt()` in `ir/lower-functions.ts`);
// where it would do the other, it declines (CE-1422). The interpreter maps
// over a list at a parameter when every parameter is a scalar
// (`paramsAreScalar()`), and, beside a parameter declared as a point
// (`pointListParamSlots()`), over a list of points at that parameter and
// over any list at a parameter of a scalar type or of no stated type.

const P = 'tuple<real, real>';
type Json = unknown;
type Case = {
  name: string;
  setup?: (ce: ComputeEngine) => void;
  decl?: Record<string, string>;
  expr: Json;
  inputs?: Record<string, number | number[] | number[][]>;
  /** The interpreter's value, as `toString()` prints it. */
  interpreted: string;
  /** The value of the code on JavaScript, or `undefined` for a decline. */
  js: number | number[] | number[][] | undefined;
  /** GLSL compiles (`true`) or declines (`false`). */
  glsl: boolean;
  /** The interval mode declines where JavaScript compiles. */
  intervalDeclines?: true;
};

const pointFn = (ce: ComputeEngine, declare: boolean) => {
  if (declare) ce.declare('g', 'function');
  ce.assign(
    'g',
    ce.box([
      'Function',
      ['Add', ['At', 'p', 1], ['At', 'p', 2]],
      ['Typed', 'p', `'${P}'`],
    ] as never)
  );
};
const pointAndX =
  (body: Json, x: Json = 'x') =>
  (ce: ComputeEngine) =>
    ce.assign(
      'k',
      ce.box(['Function', body, ['Typed', 'p', `'${P}'`], x] as never)
    );
const B = [
  [1, 2],
  [3, 4],
];

const CASES: Case[] = [
  {
    name: 'witness A: a name declared `function`, a list of points at a point parameter',
    setup: (ce) => pointFn(ce, true),
    decl: { B: `list<${P}>` },
    expr: ['g', 'B'],
    inputs: { B },
    interpreted: '[3,7]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'a function assigned, a list of points at a point parameter',
    setup: (ce) => pointFn(ce, false),
    decl: { B: `list<${P}>` },
    expr: ['g', 'B'],
    inputs: { B },
    interpreted: '[3,7]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'Apply(g, B) of a name declared `function`',
    setup: (ce) => pointFn(ce, true),
    decl: { B: `list<${P}>` },
    expr: ['Apply', 'g', 'B'],
    inputs: { B },
    interpreted: '[3,7]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'g(B) of a name declared `function`, in a Sum body',
    setup: (ce) => pointFn(ce, true),
    decl: { B: `list<${P}>` },
    expr: [
      'Sum',
      ['Multiply', 'i', ['At', ['g', 'B'], 'i']],
      ['Limits', 'i', 1, 2],
    ],
    inputs: { B },
    interpreted: '17',
    js: undefined,
    glsl: false,
  },
  {
    name: 'two point parameters, a list of points at one',
    setup: (ce) =>
      ce.assign(
        'h',
        ce.box([
          'Function',
          ['Add', ['At', 'p', 1], ['At', 'q', 2]],
          ['Typed', 'p', `'${P}'`],
          ['Typed', 'q', `'${P}'`],
        ] as never)
      ),
    decl: { B: `list<${P}>` },
    expr: ['h', 'B', ['Tuple', 10, 20]],
    inputs: { B },
    interpreted: '[21,23]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'witness B: a list at an untyped parameter beside a point parameter',
    setup: pointAndX(42),
    expr: ['k', ['Tuple', 1, 2], ['List', 3, 4]],
    interpreted: '[42,42]',
    js: [42, 42],
    glsl: true,
  },
  {
    name: 'a list input at an untyped parameter beside a point parameter',
    setup: pointAndX(['Add', ['At', 'p', 1], 'x']),
    decl: { L: 'list<real>' },
    expr: ['k', ['Tuple', 1, 2], 'L'],
    inputs: { L: [3, 4, 5] },
    interpreted: '[4,5,6]',
    js: [4, 5, 6],
    // A list of a run-time length.
    glsl: false,
  },
  {
    name: 'a list of a stated length at an untyped parameter beside a point parameter',
    setup: pointAndX(['Add', ['At', 'p', 1], 'x']),
    decl: { L: 'list<real^2>' },
    expr: ['k', ['Tuple', 1, 2], 'L'],
    inputs: { L: [10, 20] },
    interpreted: '[11,21]',
    js: [11, 21],
    glsl: true,
  },
  {
    name: 'the same call in a Sum body',
    setup: pointAndX(['Add', ['At', 'p', 1], 'x']),
    decl: { L: 'list<real>' },
    expr: [
      'Sum',
      ['At', ['k', ['Tuple', 1, 2], 'L'], 'i'],
      ['Limits', 'i', 1, 2],
    ],
    inputs: { L: [3, 4] },
    interpreted: '9',
    js: 9,
    glsl: false,
  },
  {
    name: 'a list of points at the point parameter and a list at the other',
    setup: pointAndX(['Add', ['At', 'p', 1], 'x']),
    decl: { B: `list<${P}>`, L: 'list<real>' },
    expr: ['k', 'B', 'L'],
    inputs: { B, L: [10, 20] },
    interpreted: '[11,23]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'a list at a parameter typed list<real> beside a point parameter binds whole',
    setup: pointAndX(
      ['Add', ['At', 'p', 1], ['At', 'x', 2]],
      ['Typed', 'x', "'list<real>'"]
    ),
    decl: { L: 'list<real>' },
    expr: ['k', ['Tuple', 1, 2], 'L'],
    inputs: { L: [10, 20] },
    interpreted: '21',
    js: 21,
    glsl: false,
  },
  {
    name: 'a parameter typed list<real> binds a list whole',
    setup: (ce) =>
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['At', 'v', 1],
          ['Typed', 'v', "'list<real>'"],
        ] as never)
      ),
    decl: { L: 'list<real>' },
    expr: ['g', 'L'],
    inputs: { L: [1, 2, 3] },
    interpreted: '1',
    js: 1,
    glsl: false,
  },
  {
    name: 'a name declared `function` with an untyped parameter maps a list',
    setup: (ce) => {
      ce.declare('g', 'function');
      ce.assign('g', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as never));
    },
    decl: { L: 'list<real>' },
    expr: ['g', 'L'],
    inputs: { L: [1, 2, 3] },
    interpreted: '[2,4,6]',
    js: [2, 4, 6],
    glsl: false,
  },
  {
    name: 'a name declared `function` with an untyped parameter, a list of points',
    // The interpreter maps to the numbers of the points.
    setup: (ce) => {
      ce.declare('g', 'function');
      ce.assign('g', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as never));
    },
    decl: { B: `list<${P}>` },
    expr: ['g', 'B'],
    inputs: { B },
    interpreted: '[(2, 4),(6, 8)]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'a parameter typed real, a list of points',
    setup: (ce) =>
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['Multiply', 2, 'x'],
          ['Typed', 'x', "'real'"],
        ] as never)
      ),
    decl: { B: `list<${P}>` },
    expr: ['g', 'B'],
    inputs: { B },
    interpreted: '[(2, 4),(6, 8)]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'a name declared `function`, a parameter typed real, a list of points',
    setup: (ce) => {
      ce.declare('g', 'function');
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['Multiply', 2, 'x'],
          ['Typed', 'x', "'real'"],
        ] as never)
      );
    },
    decl: { B: `list<${P}>` },
    expr: ['g', 'B'],
    inputs: { B },
    interpreted: '[(2, 4),(6, 8)]',
    js: undefined,
    glsl: false,
  },
  {
    name: 'a name declared `function`, an indexed parameter binds a list of points whole',
    setup: (ce) => {
      ce.declare('g', 'function');
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['Add', ['At', 'p', 1], ['At', 'p', 2]],
          'p',
        ] as never)
      );
    },
    decl: { B: `list<${P}>` },
    expr: ['g', 'B'],
    inputs: { B },
    interpreted: '(4, 6)',
    js: [4, 6],
    glsl: false,
    // `At(p, 1)`: an index that can be out of range.
    intervalDeclines: true,
  },
  {
    name: 'a local function of a Block',
    expr: [
      'Block',
      [
        'Declare',
        'k',
        'function',
        [
          'Function',
          ['Add', ['At', 'p', 1], 'x'],
          ['Typed', 'p', `'${P}'`],
          'x',
        ],
      ],
      ['k', ['Tuple', 1, 2], 'L'],
    ],
    decl: { L: 'list<real>' },
    inputs: { L: [3, 4] },
    interpreted: '[4,5]',
    js: undefined,
    glsl: false,
  },
];

// A name declared `function`: the parameters annotated in the literal have
// the type of their annotation (the interpreter reads them). At a parameter
// annotated as a scalar, the interpreter maps a tuple over its components:
// the profile declines.
const scalarFn =
  (body: Json, type = 'real', more: Json[] = []) =>
  (ce: ComputeEngine) => {
    ce.declare('x', 'real');
    ce.declare('t', 'real');
    ce.declare('g', 'function');
    ce.assign(
      'g',
      ce.box(['Function', body, ['Typed', 'p', `'${type}'`], ...more] as never)
    );
  };
const POINT_XT: Json = ['Tuple', 'x', 't'];
const XT = { x: 3, t: -4 };

const ANNOTATED: Case[] = [
  ...(
    [
      ['Abs(p)', ['Abs', 'p'], 'real', POINT_XT, '(3, 4)'],
      ['Max(p, 0)', ['Max', 'p', 0], 'real', POINT_XT, '(3, 0)'],
      ['a constant body', 7, 'real', POINT_XT, '(7, 7)'],
      [
        'Abs(p), p: integer',
        ['Abs', 'p'],
        'integer',
        ['Tuple', 3, -4],
        '(3, 4)',
      ],
      ['Abs(p), p: number', ['Abs', 'p'], 'number', POINT_XT, '(3, 4)'],
      [
        'Abs(p), a tuple of three',
        ['Abs', 'p'],
        'real',
        ['Tuple', 'x', 't', 5],
        '(3, 4, 5)',
      ],
    ] as const
  ).map(([name, body, type, arg, interpreted]): Case => ({
    name: `a name declared \`function\`, a point at a parameter annotated as a scalar: ${name}`,
    setup: scalarFn(body as Json, type),
    expr: ['g', arg],
    inputs: XT,
    interpreted,
    js: undefined,
    glsl: false,
  })),
  {
    name: 'a name declared `function`, Apply(g, a point) at a parameter annotated as a scalar',
    setup: scalarFn(['Abs', 'p']),
    expr: ['Apply', 'g', POINT_XT],
    inputs: XT,
    interpreted: '(3, 4)',
    js: undefined,
    glsl: false,
  },
  ...(['list<real>', 'list<real^3>'] as const).map((decl): Case => ({
    name: `a name declared \`function\`, a point at a parameter annotated as a scalar beside a list (${decl})`,
    setup: scalarFn(['Add', ['Abs', 'p'], 'q'], 'real', ['q']),
    decl: { L: decl },
    expr: ['g', ['Tuple', 3, -4], 'L'],
    inputs: { L: [1, 2, 3] },
    interpreted: '[(4, 5),(5, 6),(6, 7)]',
    js: undefined,
    glsl: false,
  })),
];

// A parameter declared `broadcastable<T>` maps (`broadcastableParamSlots()`):
// a flat list at `broadcastable<real>` as at a scalar parameter; a list of
// points at `broadcastable<tuple<…>>` declines.
const BROADCASTABLE: Case[] = [false, true].flatMap((declare): Case[] => {
  const setup = (body: Json, type: string) => (ce: ComputeEngine) => {
    if (declare) ce.declare('g', 'function');
    ce.assign(
      'g',
      ce.box(['Function', body, ['Typed', 'p', `'${type}'`]] as never)
    );
  };
  const how = declare ? 'declared `function`' : 'assigned';
  return [
    {
      name: `broadcastable<tuple<real, real>>, ${how}, a list of points`,
      setup: setup(
        ['Add', ['At', 'p', 1], ['At', 'p', 2]],
        `broadcastable<${P}>`
      ),
      decl: { B: `list<${P}>` },
      expr: ['g', 'B'],
      inputs: { B },
      interpreted: '[3,7]',
      js: undefined,
      glsl: false,
    },
    {
      name: `broadcastable<real>, ${how}, a list of a stated length`,
      setup: setup(['Max', 'p', 0], 'broadcastable<real>'),
      decl: { L: 'list<real^3>' },
      expr: ['g', 'L'],
      inputs: { L: [1, -2, 3] },
      interpreted: '[1,0,3]',
      js: [1, 0, 3],
      glsl: true,
    },
  ];
});

function engine(c: Case): ComputeEngine {
  const ce = new ComputeEngine();
  c.setup?.(ce);
  for (const [k, t] of Object.entries(c.decl ?? {})) ce.declare(k, t);
  return ce;
}

function boxed(x: number | number[] | number[][], point = false): Json {
  if (typeof x === 'number') return x;
  if (point) return ['Tuple', ...x];
  return ['List', ...x.map((y) => boxed(y, typeof y !== 'number'))];
}

/** The compiled result, or `undefined` when the profile declines. */
function compiled(c: Case, to?: string): any {
  try {
    const r: any = compile(engine(c).box(c.expr as never), {
      profile: 'ir',
      fallback: false,
      ...(to ? { to } : {}),
    } as never);
    return r.success ? r : undefined;
  } catch {
    return undefined;
  }
}

/** The numbers of `x`, flattened. */
const leaves = (x: unknown): number[] =>
  Array.isArray(x) ? x.flatMap(leaves) : [x as number];

describe('CE-1422: A CALL OF A USER FUNCTION MAPS OR BINDS AS THE INTERPRETER', () => {
  test.each(
    [...CASES, ...ANNOTATED, ...BROADCASTABLE].map((c) => [c.name, c] as const)
  )('%s', (_, c) => {
    // The interpreter.
    const ce = engine(c);
    for (const [k, v] of Object.entries(c.inputs ?? {}))
      ce.assign(k, ce.box(boxed(v) as never));
    expect(
      ce
        .box(c.expr as never)
        .evaluate()
        .toString()
    ).toBe(c.interpreted);

    // JavaScript: the interpreter's value and shape, or a decline.
    const js = compiled(c);
    if (c.js === undefined) expect(js).toBeUndefined();
    else {
      expect(js).toBeDefined();
      expect(js.run(c.inputs ?? {})).toEqual(c.js);
    }

    // GLSL: compiles or declines.
    expect(compiled(c, 'glsl') !== undefined).toBe(c.glsl);

    // The interval mode: compiles where JavaScript does (the same lowering),
    // except where marked, and each interval holds the value.
    const iv = compiled(c, 'interval-js');
    expect(iv !== undefined).toBe(c.js !== undefined && !c.intervalDeclines);
    if (iv !== undefined) {
      const out = iv.run(c.inputs ?? {});
      const boxes = (Array.isArray(out) ? out : [out]).map((b: any) => b.value);
      const expected = leaves(c.js);
      expect(boxes.length).toBe(expected.length);
      boxes.forEach((b: { lo: number; hi: number }, i: number) => {
        expect(b.lo).toBeLessThanOrEqual(expected[i]);
        expect(b.hi).toBeGreaterThanOrEqual(expected[i]);
      });
    }
  });

  test('the decline of a list of points at a point parameter names the case', () => {
    const c = CASES[0];
    expect(() =>
      compile(engine(c).box(c.expr as never), {
        profile: 'ir',
        fallback: false,
      } as never)
    ).toThrow(
      /a list argument of g that the parameter 1, a list or a point, would take whole \(the interpreter maps the function over the list\)/
    );
  });

  // The interpreter gives an `incompatible-type` error; the decline names
  // the argument (CE-1423).
  test.each(['javascript', 'glsl', 'interval-js'])(
    'a number at a list parameter declines on %s, naming the argument',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('f', '(unknown) -> unknown');
      ce.assign(
        'f',
        ce.box(['Function', ['Sum', 'p'], ['Typed', 'p', "'list<real>'"]])
      );
      expect(() =>
        compile(ce.box(['f', 'x']), { to, fallback: false } as never)
      ).toThrow(
        'x: a scalar argument of f for the parameter 1, a list or a point'
      );
    }
  );
});
