/**
 * The structured route of the JavaScript compiler (the `numeric-kernel`
 * profile) on a tower of shared subtrees: `t_0 = x`, `t_k = F(t_(k-1),
 * t_(k-1))` with the SAME node object as both operands, so a tower of depth
 * `d` has about `d` distinct nodes and `2^d` paths. Every walk of the route
 * over the subtree of a node visits each node object once (or once per
 * context, for a walk whose answer depends on the names bound around the
 * node), so the compilation of a tower of depth 40 (2^40 paths) ends, or
 * declines, in a few milliseconds
 * (docs/plans/2026-11-11-structured-shared-subexpressions.md, "Walks of
 * later rules").
 *
 * The witness: `Block(deep := Beta^30(x), z := q(u), 1 + z)` of
 * `compile-call-broadcast-result-operand.test.ts` did not end with
 * `CE_JS_PROFILE_SHADOW=1`: the admission of the root block read the free
 * symbols, the bound names and every value of the body once per path.
 *
 * Each tower of the table compiles or declines in well under a second; the
 * limit asserted is 5 s, for a loaded machine. The checks of the admission
 * are counted (`ADMISSION_WORK`): linear in the depth. The value of each
 * admitted tower at depth 12 is the value of the existing compiler with its
 * default options (`Object.is`). With `cse: false` the existing compiler
 * writes a non-canonical nested `Add` as a flat left fold, whose doubles
 * differ (the known limitation of `docs/COMPILATION-MODEL.md`), so the
 * default options are the reference.
 *
 * Not in the table: the shapes whose cost is in the engine, before or around
 * the compilation, for both compilers: `Power(t, t)`, `Sqrt(t)·t` and the
 * complex `Sin(t) + Cos(t)` (the `isFinite` and sign getters of a function
 * expression are not cached, so the type of the root is exponential in the
 * depth), `If(t > 0, t, -t)` (its boxing), a tower in the body of a `Loop`
 * (the type of the `Loop`), a tower in the bound of a `Sum` (its `N()`), a
 * product tower next to a call of a local function (the type of the sum),
 * a comparison of a list tower (`t < 1`) and an element-wise `If` over
 * one (the type of the comparison, `comparisonType()`), and a canonical
 * `Add(t, t)` or `Multiply(t, t)`, which the canonical form flattens into a
 * tree of `2^d` operands.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { ADMISSION_WORK } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { Expression } from '../../src/compute-engine/global-types';

type Build = (ce: ComputeEngine, t: Expression) => Expression;

interface Shape {
  readonly label: string;
  /** One level of the tower over `t`. */
  readonly level: Build;
  /** The root around the tower; the tower itself by default. */
  readonly root?: Build;
  /** The leaf of the tower: `x` by default. */
  readonly leaf?: string;
  /** The leaf of the tower, as an expression, in place of `leaf`. */
  readonly seed?: (ce: ComputeEngine) => Expression;
  readonly declare?: Record<string, string>;
  readonly options?: Record<string, unknown>;
  readonly angularUnit?: 'deg';
  /** The profile declines the tower. */
  readonly declines?: RegExp;
}

const sinCos: Build = (ce, t) =>
  ce.function('Add', [ce.function('Sin', [t]), ce.function('Cos', [t])]);
const fn =
  (head: string): Build =>
  (ce, t) =>
    ce.function(head, [t, t]);
/** A non-canonical sum or product: the canonical form would flatten the
 *  tower into `2^d` operands. */
const raw =
  (head: string): Build =>
  (ce, t) =>
    ce._fn(head, [t, t]);
const k = 'k';

const SHAPES: Shape[] = [
  // The witness: a declining head whose operand is outside its domain.
  {
    label: 'Beta(t, t)',
    level: fn('Beta'),
    declines: /Beta\(x, x\) with the operand x/,
  },
  { label: 'Gamma(t, t)', level: fn('Gamma'), declines: /Gamma\(x, x\)/ },
  {
    label: 'Block(deep := Beta^d(x); 1 + deep)',
    level: fn('Beta'),
    root: (ce, t) =>
      ce.box(['Block', ['Assign', 'deep', t], ['Add', 1, 'deep']] as never),
    declines: /Beta\(x, x\)/,
  },
  { label: 'Add(t, t)', level: raw('Add') },
  { label: 'Multiply(t, t)', level: raw('Multiply') },
  { label: 'Sin(t) + Cos(t)', level: sinCos },
  { label: 'Max(t, t)', level: fn('Max') },
  { label: 'GCD(t, t)', level: fn('GCD') },
  { label: 'Mod(t, t)', level: fn('Mod') },
  { label: 'Hypot(t, t)', level: fn('Hypot') },
  { label: 'Arctan2(t, t)', level: fn('Arctan2') },
  {
    label: 'Which(x > 0, t + t, True, t)',
    level: (ce, t) =>
      ce.function('Which', [
        ce.function('Greater', [ce.symbol('x'), ce.number(0)]),
        ce._fn('Add', [t, t]),
        ce.symbol('True'),
        t,
      ]),
    // The two branches hold the tower: the shape is exponential in the code
    // too, and the operation limit of the profile declines it.
    declines: /more than 100000 operations/,
  },
  {
    label: 'Which(t > 0, t, True, -t)',
    level: (ce, t) =>
      ce.function('Which', [
        ce.function('Greater', [t, ce.number(0)]),
        t,
        ce.symbol('True'),
        ce.function('Negate', [t]),
      ]),
  },
  {
    label: 't + If(x > 1, t, 1)',
    level: (ce, t) =>
      ce._fn('Add', [
        t,
        ce.function('If', [
          ce.function('Greater', [ce.symbol('x'), ce.number(1)]),
          t,
          ce.number(1),
        ]),
      ]),
  },
  {
    label: 'Floor(t) + t',
    level: (ce, t) => ce._fn('Add', [ce.function('Floor', [t]), t]),
  },
  {
    label: 'Sum(k t, k = 1..3)',
    level: raw('Add'),
    root: (ce, t) =>
      ce.function('Sum', [
        ce.function('Multiply', [ce.symbol(k), t]),
        ce.function('Limits', [ce.symbol(k), ce.number(1), ce.number(3)]),
      ]),
  },
  {
    label: '[t, t]',
    level: raw('Add'),
    root: (ce, t) => ce.function('List', [t, t]),
  },
  {
    label: '[[t, t], [t, t]]',
    level: raw('Add'),
    root: (ce, t) => {
      const row = ce.function('List', [t, t]);
      return ce.function('List', [row, row]);
    },
  },
  { label: 'List(t, t)', level: fn('List') },
  {
    label: 'L + L, element-wise',
    level: raw('Add'),
    leaf: 'L',
    declare: { L: 'list<real>' },
  },
  {
    label: 'Block(deep := Sin^d(x); 1 + deep)',
    level: sinCos,
    root: (ce, t) =>
      ce.box(['Block', ['Assign', 'deep', t], ['Add', 1, 'deep']] as never),
  },
  {
    label: 'a let and the tower',
    level: sinCos,
    root: (ce, t) =>
      ce.box([
        'Block',
        ['Declare', 'a', ['Dictionary', ['Tuple', "'value'", t]]],
        ['Add', 'a', t],
      ] as never),
  },
  {
    label: 'an If statement',
    level: sinCos,
    root: (ce, t) =>
      ce.box([
        'Block',
        ['Declare', 's', 'real', 0],
        [
          'If',
          ['Greater', 'x', 0],
          ['Assign', 's', t],
          ['Assign', 's', ['Negate', t]],
        ],
        's',
      ] as never),
  },
  {
    label: 'a block of declarations as an operand',
    level: sinCos,
    root: (ce, t) =>
      ce.box([
        'Add',
        1,
        [
          'Block',
          ['Declare', 'a', ['Dictionary', ['Tuple', "'value'", t]]],
          ['Add', 'a', t],
        ],
      ] as never),
  },
  {
    label: 'a comprehension',
    level: sinCos,
    root: (ce, t) =>
      ce.box([
        'Comprehension',
        ['Multiply', 'k', t],
        ['Element', 'k', ['Range', 1, 3]],
      ] as never),
  },
  {
    label: 'the body of a helper',
    level: sinCos,
    root: (ce, t) => {
      ce.declare('h', 'function');
      ce.assign('h', ce.function('Function', [t, ce.symbol('x')]));
      return ce.box(['h', 'y'] as never);
    },
  },
  {
    label: 'the body of a local function',
    level: sinCos,
    root: (ce, t) =>
      ce.box([
        'Block',
        ['Declare', 'g', 'function', ['Function', t, 'x']],
        ['g', 'y'],
      ] as never),
  },
  {
    label: 'the lambda of a Map',
    level: sinCos,
    declare: { L: 'list<real>' },
    root: (ce, t) =>
      ce.function('Map', [
        ce.function('Function', [t, ce.symbol('x')]),
        ce.symbol('L'),
      ]),
  },
  {
    label: 'Add(t, t) of a complex input',
    level: raw('Add'),
    leaf: 'z',
    declare: { z: 'complex' },
  },
  {
    label: 'Sin(t) + Cos(t), mode complex',
    level: sinCos,
    options: { mode: 'complex' },
  },
  {
    label: 'Add(t, t), mode bigint',
    level: raw('Add'),
    leaf: 'n',
    declare: { n: 'integer' },
    options: { mode: 'bigint' },
  },
  {
    label: 'Multiply(t, t), mode bigint',
    level: raw('Multiply'),
    leaf: 'n',
    declare: { n: 'integer' },
    options: { mode: 'bigint' },
  },
  {
    label: 'GCD(t, t), mode bigint',
    level: fn('GCD'),
    leaf: 'n',
    declare: { n: 'integer' },
    options: { mode: 'bigint' },
  },
  {
    label: 'Mod(t, t), mode bigint',
    level: fn('Mod'),
    leaf: 'n',
    declare: { n: 'integer' },
    options: { mode: 'bigint' },
  },
  { label: 'Sin(t) + Cos(t), in degrees', level: sinCos, angularUnit: 'deg' },
  {
    label: 'Sin(t) + t, in degrees',
    level: (ce, t) => ce._fn('Add', [ce.function('Sin', [t]), t]),
    angularUnit: 'deg',
  },
  {
    label: 'M + M of a matrix input',
    level: raw('Add'),
    leaf: 'M',
    declare: { M: 'matrix<2x2>' },
  },
  // A calculus node: the derivative of the tower has a closed form.
  {
    label: 'D(Sin(t) + Cos(t), x)',
    level: sinCos,
    root: (ce, t) => ce.function('D', [t, ce.symbol('x')]),
  },
  // Element-wise forms over lists (the broadcast of the structured route):
  // each level is a list of the length of `L`.
  {
    label: 'Sqrt(t) + t, element-wise',
    level: (ce, t) => ce._fn('Add', [ce.function('Sqrt', [t]), t]),
    leaf: 'L',
    declare: { L: 'list<real>' },
  },
  {
    label: 'Sin(t) + Cos(t), element-wise',
    level: (ce, t) =>
      ce._fn('Add', [ce.function('Sin', [t]), ce.function('Cos', [t])]),
    leaf: 'L',
    declare: { L: 'list<real>' },
  },
  {
    label: 'Arctan2(t, t): two list operands of one length key',
    level: fn('Arctan2'),
    leaf: 'L',
    declare: { L: 'list<real>' },
  },
  {
    label: 't + Arctan2(t, L)',
    level: (ce, t) =>
      ce._fn('Add', [t, ce.function('Arctan2', [t, ce.symbol('L')])]),
    leaf: 'L',
    declare: { L: 'list<real>' },
  },
  {
    label: 'a list of booleans: t || !t over L < 1',
    level: (ce, t) => ce._fn('Or', [t, ce.function('Not', [t])]),
    leaf: 'L',
    declare: { L: 'list<real>' },
    seed: (ce) => ce.function('Less', [ce.symbol('L'), ce.number(1)]),
  },
  {
    label: 'At(t, 2) of a list tower',
    level: raw('Add'),
    leaf: 'L',
    declare: { L: 'list<real>' },
    root: (ce, t) => ce.function('At', [t, ce.number(2)]),
  },
  {
    label: 'Length(t) of a list tower',
    level: raw('Add'),
    leaf: 'L',
    declare: { L: 'list<real>' },
    root: (ce, t) => ce.function('Length', [t]),
  },
  {
    label: 'an element-wise Which whose condition and arms share the tower',
    level: (ce, t) =>
      ce._fn('Which', [
        ce.function('Greater', [t, ce.number(0)]),
        t,
        ce.symbol('True'),
        ce._fn('Add', [t, ce.number(1)]),
      ]),
    leaf: 'L',
    declare: { L: 'list<real>' },
    declines: /Which with the list condition/,
  },
  {
    label: 'a tower over the index in a comprehension body of a stated range',
    level: (ce, t) => ce._fn('Add', [ce.function('Sin', [t]), t]),
    leaf: 'k',
    root: (ce, t) =>
      ce.function('Comprehension', [
        t,
        ce.function('Element', [
          ce.symbol('k'),
          ce.function('Range', [ce.number(1), ce.number(4)]),
        ]),
      ]),
  },
  {
    label: 'a tower over a comprehension of a stated range',
    level: raw('Add'),
    seed: (ce) =>
      ce.function('Comprehension', [
        ce.function('Multiply', [ce.symbol('k'), ce.symbol('x')]),
        ce.function('Element', [
          ce.symbol('k'),
          ce.function('Range', [ce.number(1), ce.number(4)]),
        ]),
      ]),
  },
  {
    label: 'Sqrt(t) + t of a matrix input',
    level: (ce, t) => ce._fn('Add', [ce.function('Sqrt', [t]), t]),
    leaf: 'M',
    declare: { M: 'matrix<2x2>' },
  },
];

/** The root of `shape` over a tower of `depth` levels, and the tower. */
function tower(
  shape: Shape,
  depth: number
): { root: Expression; tower: Expression } {
  const ce = new ComputeEngine();
  if (shape.angularUnit !== undefined) ce.angularUnit = shape.angularUnit;
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  for (const [name, type] of Object.entries(shape.declare ?? {}))
    ce.declare(name, type);
  let t = shape.seed?.(ce) ?? ce.symbol(shape.leaf ?? 'x');
  for (let i = 0; i < depth; i++) t = shape.level(ce, t);
  return { root: shape.root?.(ce, t) ?? t, tower: t };
}

/** The number of node objects of `expr`, and whether it has more paths
 *  than nodes (the sharing is real). */
function sharing(expr: Expression): { nodes: number; shared: boolean } {
  const seen = new Set<Expression>();
  let shared = false;
  const visit = (e: Expression): void => {
    if (seen.has(e)) {
      if (e.ops !== undefined) shared = true;
      return;
    }
    seen.add(e);
    e.ops?.forEach(visit);
  };
  visit(expr);
  return { nodes: seen.size, shared };
}

const PROFILE = {
  to: 'javascript',
  profile: 'numeric-kernel',
  fallback: false,
};

function compileTimed(
  expr: Expression,
  options: Record<string, unknown> = {}
): { ms: number; result?: any; error?: Error; values: number } {
  ADMISSION_WORK.values = 0;
  const start = performance.now();
  try {
    const result = compile(expr, { ...PROFILE, ...options } as never);
    return {
      ms: performance.now() - start,
      result,
      values: ADMISSION_WORK.values,
    };
  } catch (error) {
    return {
      ms: performance.now() - start,
      error: error as Error,
      values: ADMISSION_WORK.values,
    };
  }
}

const VARS = {
  x: 0.7,
  y: 0.3,
  L: [0.2, -0.4, 1.5],
  z: { re: 0.3, im: -0.2 },
  M: [
    [0.5, -1],
    [2, 0.25],
  ],
};

/** `Object.is` on numbers, element by element on lists, and on both parts
 *  of a complex value. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    const p = a as { re: unknown; im: unknown };
    const q = b as { re: unknown; im: unknown };
    return Object.is(p.re, q.re) && Object.is(p.im, q.im);
  }
  return Object.is(a, b);
}

describe('a tower of shared subtrees of depth 40 on the structured route', () => {
  test.each(SHAPES.map((s) => [s.label, s] as const))(
    '%s: compiles or declines in linear time',
    (_label, shape) => {
      const { root: expr, tower: t } = tower(shape, 40);
      // The tower of a helper is in the value of the helper, not in the root.
      const { nodes, shared } = sharing(t);
      expect(shared).toBe(true);
      const { ms, result, error, values } = compileTimed(expr, shape.options);
      if (shape.declines !== undefined) {
        expect(error?.message).toMatch(shape.declines);
      } else {
        expect(error).toBeUndefined();
        expect(result.success).toBe(true);
        // The code is linear in the depth too (a level of an element-wise
        // form over a matrix is two loops, up to about 1,250 characters).
        expect(String(result.code).length).toBeLessThan(1_500 * 40);
      }
      // The checks of the admission: at most a few per node object (a node
      // is checked again only in a new context), where a walk of each path
      // would make 2^40.
      expect(values).toBeLessThan(10 * nodes + 50);
      expect(ms).toBeLessThan(5_000);
    }
  );
});

describe('the value of a tower of depth 12 is the value of the existing compiler', () => {
  test.each(
    SHAPES.filter((s) => s.declines === undefined).map(
      (s) => [s.label, s] as const
    )
  )('%s', (_label, shape) => {
    const expr = tower(shape, 12).root;
    const bigint = shape.options?.mode === 'bigint';
    const vars = bigint ? { n: 3n } : VARS;
    const profile = compile(expr, {
      ...PROFILE,
      ...shape.options,
    } as never) as any;
    const existing = compile(expr, {
      to: 'javascript',
      fallback: false,
      ...shape.options,
    } as never) as any;
    expect(same(profile.run(vars), existing.run(vars))).toBe(true);
  });
});

//
// A node object reached in two contexts
//

/** A copy of `expr` in which every node whose JSON is that of `pick` is one
 *  node object, the first one met. A scoped node keeps its scope. */
function share(
  ce: ComputeEngine,
  expr: Expression,
  pick: Expression
): Expression {
  const key = JSON.stringify(pick.json);
  let first: Expression | undefined;
  const visit = (node: Expression): Expression => {
    if (!node.ops) return node;
    const ops = node.ops.map(visit);
    const copy = ops.every((op, i) => op === node.ops![i])
      ? node
      : ce._fn(
          node.operator,
          ops,
          node.localScope ? { scope: node.localScope } : undefined
        );
    if (JSON.stringify(node.json) !== key) return copy;
    first ??= copy;
    return first;
  };
  return visit(expr);
}

type Case = [
  label: string,
  json: unknown,
  node: unknown,
  declare: Record<string, string>,
  options?: Record<string, unknown>,
];

// Each case reaches one node object in two contexts that differ in what a
// memo of the admission reads: the names that a binder binds around it
// (a `Sum`, a lambda, a `Loop`, an `Integrate`), the locals declared before
// it, a local written a value of another kind between the uses, the body of
// a local function and the root. The outcome (the code, or the message of
// the decline) is the one of the walk with no memo, at
// 881716b157129b29f2df132f455b40b351feb9bd.
const cases: Case[] = [];
const B = ['Block', ['Declare', 'k', 'integer', 'a'], 'k'];
cases.push([
  'value block: a local written another kind between uses',
  [
    'Function',
    [
      'Block',
      ['Declare', 'a', ['Dictionary', ['Tuple', "'value'", ['Length', 'L']]]],
      ['Declare', 'b', 'real', 0],
      ['Declare', 'c', 'real', 0],
      ['Declare', 'd', 'real', 0],
      ['Assign', 'b', ['Add', 1, B]],
      ['Assign', 'c', ['Add', 2, B]],
      ['Assign', 'a', 0.5],
      ['Assign', 'd', ['Add', 3, B]],
      ['Add', 'b', 'c', 'd'],
    ],
    ['Typed', 'L', "'list<real>'"],
  ],
  B,
  {},
]);
// The same node outside and inside a Sum that binds one of its names.
const N1 = ['Multiply', 'k', ['Sin', 'x']];
cases.push([
  'a node outside and inside a Sum that binds its name k',
  ['Add', N1, ['Sum', N1, ['Limits', 'k', 1, 3]]],
  N1,
  { x: 'real', k: 'real' },
]);
cases.push([
  'the same, in a root Block',
  [
    'Block',
    ['Assign', 'p', N1],
    ['Add', 'p', ['Sum', N1, ['Limits', 'k', 1, 3]]],
  ],
  N1,
  { x: 'real', k: 'real' },
]);
// Inside and outside a lambda that binds one of its names.
const N2 = ['Arctan2', ['Sin', 'x'], 2];
cases.push([
  'a node outside and inside a lambda that binds its name x',
  ['Add', ['Sum', ['Map', ['Function', N2, 'x'], 'L']], N2],
  N2,
  { x: 'real', L: 'list<real>' },
]);
// Before and after a local of the same name is declared.
const N3 = ['Arctan2', 'q', ['Sin', 'x']];
cases.push([
  'a node outside and inside a block that declares a local it reads',
  [
    'Function',
    [
      'Block',
      ['Declare', 'p', 'real', N3],
      ['Declare', 'r', 'real', ['Block', ['Declare', 'q', 'real', 2], N3]],
      ['Add', 'p', 'r'],
    ],
    ['Typed', 'x', "'real'"],
  ],
  N3,
  { q: 'real' },
]);
cases.push([
  'a node before and after a local that it reads is declared',
  [
    'Block',
    ['Assign', 'p', ['Arctan2', 'u', 'x']],
    ['Declare', 'q', 'real', 2],
    ['Assign', 'r', ['Add', 'q', ['Arctan2', 'u', 'x']]],
    ['Add', 'p', 'r'],
  ],
  ['Arctan2', 'u', 'x'],
  { x: 'real', u: 'real' },
]);
// A local reassigned to a complex value between the uses, complex mode.
const N4 = ['Arctan2', 'a', ['Sin', 'x']];
cases.push([
  'a node that reads a local before and after it is written a complex value',
  [
    'Function',
    [
      'Block',
      ['Declare', 'a', ['Dictionary', ['Tuple', "'value'", 1]]],
      ['Declare', 'p', 'real', 0],
      ['Assign', 'p', N4],
      ['Assign', 'a', ['Sqrt', ['Negate', 'x']]],
      ['Add', 'p', N4],
    ],
    ['Typed', 'x', "'real'"],
  ],
  N4,
  {},
  { mode: 'complex' },
]);
cases.push([
  'the same, strict mode',
  [
    'Function',
    [
      'Block',
      ['Declare', 'a', ['Dictionary', ['Tuple', "'value'", 1]]],
      ['Declare', 'p', 'real', 0],
      ['Assign', 'p', N4],
      ['Assign', 'a', ['Sqrt', ['Negate', 'x']]],
      ['Add', 'p', N4],
    ],
    ['Typed', 'x', "'real'"],
  ],
  N4,
  {},
]);
// Inside and outside a loop that binds an index.
const N5 = ['Arctan2', 's', ['Cos', 'x']];
cases.push([
  'a node before and inside a Loop that binds an index and carries its local',
  [
    'Function',
    [
      'Block',
      ['Declare', 's', 'real', 1],
      ['Declare', 'v', 'real', N5],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', N5]],
        ['Element', 'j', ['Range', 1, 3]],
      ],
      ['Add', 's', 'v'],
    ],
    ['Typed', 'x', "'real'"],
  ],
  N5,
  {},
]);
// In a helper body and in the root.
cases.push([
  'a node in the body of a local function and in the root',
  [
    'Block',
    ['Declare', 'g', 'function', ['Function', ['Add', N2, 'w'], 'w']],
    ['Add', ['g', 'y'], N2],
  ],
  N2,
  { x: 'real', y: 'real' },
]);
// A calculus node: a name free outside an integral, bound inside it.
const N7 = ['Multiply', 't', 'x'];
cases.push([
  'a node outside and inside an Integrate that binds its name t (t complex)',
  ['D', ['Add', N7, ['Integrate', N7, ['Limits', 't', 0, 1]]], 'x'],
  N7,
  { x: 'real', t: 'complex' },
]);
cases.push([
  'the same, t real',
  ['D', ['Add', N7, ['Integrate', N7, ['Limits', 't', 0, 1]]], 'x'],
  N7,
  { x: 'real', t: 'real' },
]);

const EXPECTED: Record<string, string> = {
  'value block: a local written another kind between uses':
    "throw Could not compile with the profile 'numeric-kernel': a value written to the integer local k does not have the type integer",
  'a node outside and inside a Sum that binds its name k':
    'code _.k * Math.sin(_.x) + (1 * Math.sin(_.x) + 2 * Math.sin(_.x) + 3 * Math.sin(_.x))',
  'the same, in a root Block':
    "throw Could not compile with the profile 'numeric-kernel': the Sum index k has the name of a parameter, a local or another index",
  'a node outside and inside a lambda that binds its name x':
    'code (() => { const _tv1 = _.L; const _tv2 = _tv1.length; const _tv3 = []; const _tv5 = _tv2 - 1; for (let _tv6 = 0; _tv6 <= _tv5; _tv6++) { const _tv4 = 1 + _tv6; _tv3.push(Math.atan2(Math.sin(_SYS.atNumeric(_tv1, _tv4, "real")), 2)); } const _tv7 = _tv3.length; let _tv8 = 0; const _tv10 = _tv7 - 1; for (let _tv11 = 0; _tv11 <= _tv10; _tv11++) { const _tv9 = 1 + _tv11; _tv8 = _tv8 + _SYS.atNumeric(_tv3, _tv9, "real"); } return _tv8 + Math.atan2(Math.sin(_.x), 2); })()',
  'a node outside and inside a block that declares a local it reads':
    "throw Could not compile with the profile 'numeric-kernel': unsupported capture q",
  'a node before and after a local that it reads is declared':
    'code Math.atan2(_.u, _.x) + (2 + Math.atan2(_.u, _.x))',
  'a node that reads a local before and after it is written a complex value':
    "throw Could not compile with the profile 'numeric-kernel': the local a has the type number, which is not real, in the complex mode",
  'the same, strict mode':
    "throw Could not compile with the profile 'numeric-kernel': the local a is written a real value and a complex value (sqrt(-x) has the type complex)",
  'a node before and inside a Loop that binds an index and carries its local':
    'code (x) => { let _tv1 = 1; const _tv3 = 3 < 1 ? -1 : 1; const _tv4 = _tv3 * (3 - 1); for (let _tv5 = 0; _tv5 <= _tv4; _tv5++) { const _tv2 = _tv3 < 0 ? 1 - _tv5 : 1 + _tv5; _tv1 = _tv1 + Math.atan2(_tv1, Math.cos(x)); } return _tv1 + Math.atan2(1, Math.cos(x)); }',
  'a node in the body of a local function and in the root':
    'code Math.atan2(Math.sin(_.x), 2) + _tv1(_.y, _.x)',
  'a node outside and inside an Integrate that binds its name t (t complex)':
    "throw Could not compile with the profile 'numeric-kernel': D(t * x + int_(0)^(1)(t * x dt), x) reads the complex value t",
  'the same, t real': 'code _.t + 0.5',
};

describe('a node object reached in two contexts', () => {
  test.each(cases.map((c) => [c[0], c] as const))('%s', (_label, c) => {
    const [label, json, node, declare, options] = c;
    const ce = new ComputeEngine();
    for (const [name, type] of Object.entries(declare)) ce.declare(name, type);
    const expr = share(ce, ce.box(json as never), ce.box(node as never));
    // The node is shared.
    const seen = new Set<Expression>();
    let reused = 0;
    const walk = (e: Expression): void => {
      if (seen.has(e)) {
        if (e.ops) reused += 1;
        return;
      }
      seen.add(e);
      e.ops?.forEach(walk);
    };
    walk(expr);
    expect(reused).toBeGreaterThan(0);
    let outcome: string;
    try {
      const result = compile(expr, { ...PROFILE, ...options } as never) as any;
      outcome = 'code ' + String(result.code);
    } catch (error) {
      outcome = 'throw ' + (error as Error).message;
    }
    expect(outcome).toBe(EXPECTED[label]);
  });
});
