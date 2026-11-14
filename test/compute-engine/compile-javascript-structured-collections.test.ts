import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import {
  listType,
  tupleType,
  type IROperation,
  type IRProgram,
  type IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slice 1 of docs/plans/2026-11-11-structured-collections-and-lambdas.md on
// the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): list literals and tuples as values, `At` and `Length` of them,
// list and tuple inputs, parameters and results, the folds `Sum`, `Product`,
// `Max` and `Min` of a list or a tuple, element-wise arithmetic of a list
// and reals, and a comprehension with a guard.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`), in the `strict` and `complex`
// modes. The values must be the same doubles (`Object.is`, element by
// element) and the same shape (a number, or an array of the same length),
// and agree with the interpreter within 1e-12 relative, or by the caveats of
// compiled code (`NaN` where the interpreter has no number).

const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];
const EXISTING = { cse: false, constantFold: false, fallback: false } as const;

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

/** A `Function` literal of the body `body` and the typed parameters. */
const fn = (
  body: MathJsonExpression,
  ...parameters: [string, string][]
): MathJsonExpression =>
  [
    'Function',
    ['Block', body],
    ...parameters.map(([n, t]) => typed(n, t)),
  ] as MathJsonExpression;

const L: [string, string] = ['L', 'list<real>'];
const M: [string, string] = ['M', 'list<real>'];
const I: [string, string] = ['I', 'list<integer>'];
const P: [string, string] = ['P', 'tuple<real, real>'];
const X: [string, string] = ['x', 'real'];
const Y: [string, string] = ['y', 'real'];
const N: [string, string] = ['n', 'integer'];
const K: [string, string] = ['k', 'integer'];

type Arg = number | number[];

function run(result: CompilationResult<'javascript'>, args: readonly Arg[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(
    ...args.map((a) => (Array.isArray(a) ? [...a] : a))
  );
}

/** The same doubles and the same shape. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return a === b;
}

/** Within 1e-12 relative of the interpreter, element by element; `NaN`
 *  where the interpreter gives no number. */
function close(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      value.every((v, i) => close(v, expected[i]))
    );
  if (typeof value !== 'number') return false;
  if (typeof expected !== 'number' || !Number.isFinite(expected))
    return (
      Number.isNaN(value) ||
      value === expected ||
      (typeof expected !== 'number' && !Number.isFinite(value))
    );
  return (
    value === expected ||
    Math.abs(value - expected) <=
      1e-12 * Math.max(1, Math.abs(value), Math.abs(expected))
  );
}

/** The value of the interpreter for `json` applied to `args`: a number, a
 *  list of numbers, or `undefined` when it is not a number. */
function interpret(
  ce: ComputeEngine,
  json: MathJsonExpression,
  args: readonly Arg[],
  tuples: readonly number[] = []
): unknown {
  const boxed = args.map((a, i) =>
    Array.isArray(a)
      ? ([tuples.includes(i) ? 'Tuple' : 'List', ...a] as MathJsonExpression)
      : a
  );
  const evaluated = ce
    .expr(['Apply', json, ...boxed] as MathJsonExpression)
    .evaluate();
  // A comprehension is a lazy view: its elements are read here.
  const value = (
    evaluated.operator === 'Comprehension'
      ? ce.function('List', [...evaluated.each()])
      : evaluated
  ).N();
  if (isFunction(value, 'List') || isFunction(value, 'Tuple'))
    return value.ops.map((op) => (isNumber(op) ? op.re : undefined));
  return isNumber(value) && value.im === 0 ? value.re : undefined;
}

type Program = {
  readonly name: string;
  readonly json: MathJsonExpression;
  readonly args: readonly (readonly Arg[])[];
  /** The positions of the arguments that are tuples. */
  readonly tuples?: readonly number[];
  /** No comparison with the interpreter (the caveats of compiled code). */
  readonly existingOnly?: boolean;
};

const LISTS = [[], [3], [1, -2.5, 7], [-0, 1e300, 5e-324, 1 / 3]];

const PROGRAMS: Program[] = [
  // (a) List literals, tuples, `At` and `Length` of them, list results.
  {
    name: 'a list literal of inputs and a literal',
    json: fn(['List', 'x', 'y', 1], X, Y),
    args: [[1.5, 2], [-0, 0.1], [1e300, -3]],
  },
  { name: 'a list literal of integers', json: fn(['List', 1, 2, 3]), args: [[]] },
  { name: 'the empty list', json: fn(['List']), args: [[]] },
  {
    name: 'a tuple of inputs',
    json: fn(['Tuple', 'x', 'y'], X, Y),
    args: [[1.5, 2], [-0, 0.1]],
  },
  { name: 'a tuple of integers', json: fn(['Tuple', 1, 2]), args: [[]] },
  {
    name: 'At of a list literal, in and out of range',
    json: fn(['At', ['List', 'x', 1], 'k'], X, K),
    args: [[3, 1], [3, 2], [3, -1], [3, -2]],
  },
  {
    name: 'At of a list literal out of range: NaN, the absent value',
    json: fn(['At', ['List', 'x', 1], 'k'], X, K),
    args: [[3, 5], [3, 0], [3, -3]],
    existingOnly: true,
  },
  {
    name: 'At of a tuple input',
    json: fn(['At', 'P', 'k'], P, K),
    args: [[[1, 2], 1], [[1, 2], 2], [[1, 2], -1], [[-0, 5e-324], 1]],
    tuples: [0],
  },
  {
    name: 'At of a tuple input out of range',
    json: fn(['At', 'P', 'k'], P, K),
    args: [[[1, 2], 3], [[1, 2], 0]],
    tuples: [0],
    existingOnly: true,
  },
  {
    name: 'At of a tuple literal plus 1',
    json: fn(['Add', ['At', ['Tuple', 'x', 'y'], 2], 1], X, Y),
    args: [[1, 2], [-0, -1]],
  },
  {
    name: 'Length of a tuple and of a list literal',
    json: fn(
      ['Add', ['Length', 'P'], ['Length', ['List', 'x', 'x', 'x']]],
      P,
      X
    ),
    args: [[[1, 2], 0]],
    tuples: [0],
  },
  {
    name: 'a tuple input as the result',
    json: fn('P', P),
    args: [[[1, 2]], [[-0, NaN]]],
    tuples: [0],
    existingOnly: true,
  },
  {
    name: 'an If of two list literals',
    json: fn(['If', ['Less', 'x', 0], ['List', 'x', 2], ['List', 1, 'x']], X),
    args: [[-1], [2], [-0]],
  },
  // (b) Folds of a list or a tuple.
  { name: 'Sum of a list', json: fn(['Sum', 'L'], L), args: LISTS.map((l) => [l]) },
  { name: 'Sum of a list of integers', json: fn(['Sum', 'I'], I), args: [[[]], [[1, 2, 3]], [[2 ** 53, 1, 1]]] },
  { name: 'Product of a list', json: fn(['Product', 'L'], L), args: LISTS.map((l) => [l]) },
  { name: 'Max of a list', json: fn(['Max', 'L'], L), args: [...LISTS.slice(1).map((l) => [l]), [[-0, 0]], [[0, -0]]] },
  { name: 'Max of an empty list: NaN', json: fn(['Max', 'L'], L), args: [[[]]], existingOnly: true },
  { name: 'Min of a list', json: fn(['Min', 'L'], L), args: [...LISTS.slice(1).map((l) => [l]), [[0, -0]]] },
  { name: 'Max of a list of integers', json: fn(['Max', 'I'], I), args: [[[1, 7, -2]]] },
  { name: 'Sum of a tuple', json: fn(['Sum', 'P'], P), args: [[[1, 2]], [[-0, -0]], [[1e300, 1e300]]], tuples: [0] },
  { name: 'Product of a tuple', json: fn(['Product', 'P'], P), args: [[[3, 2]], [[-0, 1]]], tuples: [0] },
  { name: 'Max and Min of a tuple', json: fn(['Add', ['Max', 'P'], ['Min', 'P']], P), args: [[[3, 2]], [[-0, 0]]], tuples: [0] },
  { name: 'Max of a list literal', json: fn(['Max', ['List', 'x', 1, 2]], X), args: [[5], [-1]] },
  { name: 'Sum of a list literal (a sum of its elements)', json: fn(['Sum', ['List', 'x', 'y']], X, Y), args: [[-0, -0], [0.1, 0.2]] },
  // (c) Element-wise arithmetic.
  { name: 'a list plus a number', json: fn(['Add', 'L', 1], L), args: LISTS.map((l) => [l]) },
  { name: 'a list of integers plus an integer', json: fn(['Add', 'I', 'k'], I, K), args: [[[1, 2], 3], [[], 1]] },
  { name: 'a number times a list', json: fn(['Multiply', 'x', 'L'], L, X), args: [[[1, 2, 3], 2], [[1e300], 1e300], [[-0], 1]] },
  { name: 'a list divided by 3: the double of 1/3', json: fn(['Divide', 'L', 3], L), args: [[[1, 2, 3, 49]]] },
  { name: 'a number divided by a list', json: fn(['Divide', 'x', 'L'], L, X), args: [[[1, 0.5, 7], 1]] },
  {
    name: 'a number divided by a list with zeros: the poles of compiled code',
    json: fn(['Divide', 'x', 'L'], L, X),
    args: [[[1, 0, -0, 7], 1]],
    existingOnly: true,
  },
  { name: 'a list minus a number', json: fn(['Subtract', 'L', 'x'], L, X), args: [[[1, 2], 0.5]] },
  { name: 'a number minus a list', json: fn(['Subtract', 'x', 'L'], L, X), args: [[[1, -0], 0]] },
  { name: 'the negation of a list', json: fn(['Negate', 'L'], L), args: [[[1, -0, 0]]] },
  { name: 'a list times itself', json: fn(['Multiply', 'L', 'L'], L), args: [[[1, 2, 3]], [[]]] },
  { name: 'a list plus twice itself', json: fn(['Add', 'L', ['Multiply', 2, 'L']], L), args: [[[1, 2, 0.1]]] },
  { name: 'two list literals of one length', json: fn(['Add', ['List', 'x', 1], ['List', 1, 2]], X), args: [[0.5]] },
  { name: 'three operands of a sum', json: fn(['Add', 'L', 'x', 1], L, X), args: [[[0.1, 0.2], 0.3]] },
  { name: 'the sum of a list plus 1', json: fn(['Sum', ['Add', 'L', 1]], L), args: [[[1, 2]], [[]]] },
  // (d) A comprehension with a guard.
  {
    name: 'a comprehension with a guard',
    json: fn(['Comprehension', 'k', ['Element', 'k', ['Range', 1, 9], ['Less', 'n', 'k']]], N),
    args: [[5], [0], [-3], [2], [20]],
  },
  {
    name: 'a comprehension with a guard and a body',
    json: fn(
      ['Comprehension', ['Multiply', 2, 'k'], ['Element', 'k', ['Range', 6, -2], ['Less', 'x', ['Multiply', 'n', 'k']]]],
      N,
      X
    ),
    args: [[5, 2.5], [5, 10], [-1, -5]],
  },
  {
    name: 'a comprehension with a guard that reads a list',
    json: fn(
      ['Comprehension', 'k', ['Element', 'k', ['Range', 1, ['Length', 'I']], ['Equal', ['At', 'I', 'k'], 1]]],
      I
    ),
    args: [[[1, 0, 1, 1]], [[]], [[0]]],
  },
  {
    name: 'the length of a comprehension with a guard',
    json: fn(
      ['Length', ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 64], ['Less', 'n', 'k']]]],
      N
    ),
    args: [[5], [1]],
  },
];

describe('the values of the existing compiler and of the interpreter', () => {
  test.each(PROGRAMS.map((p) => [p.name, p] as const))('%s', (_name, program) => {
    const ce = new ComputeEngine();
    for (const mode of MODES) {
      const expr = ce.expr(program.json);
      const result = compile(expr, {
        profile: 'numeric-kernel',
        fallback: false,
        mode,
      } as never) as CompilationResult<'javascript'>;
      const existing = compile(expr, { ...EXISTING, mode }) as CompilationResult<'javascript'>;
      expect(result.profile).toBe('numeric-kernel');
      for (const args of program.args) {
        const value = run(result, args);
        const reference = run(existing, args);
        expect([mode, args, same(value, reference)]).toEqual([mode, args, true]);
        if (program.existingOnly !== true)
          expect([mode, args, close(value, interpret(ce, program.json, args, program.tuples))]).toEqual([mode, args, true]);
      }
    }
  });
});

describe('declines that stay', () => {
  const ce = new ComputeEngine();
  // A user function with a list parameter and a real result, whose body can
  // return the list (the result check admits a list of reals); the engine
  // types its call `list<any> | real`.
  ce.declare('fm', '(list<real>) -> real');
  ce.assign(
    'fm',
    ce.expr([
      'Function',
      ['If', ['Greater', ['Max', 'Q'], 0], ['Add', ['Sum', 'Q'], ['Max', 'Q']], 'Q'],
      typed('Q', 'list<real>'),
    ])
  );
  const declines: [string, MathJsonExpression, RegExp][] = [
    [
      'two list inputs, whose lengths are not equal by construction',
      fn(['Add', 'L', 'M'], L, M),
      /Add of the lists L and M, whose lengths are not equal by construction, is not in the profile/,
    ],
    [
      'a list literal and a list input',
      fn(['Add', 'L', ['List', 1, 2]], L),
      /whose lengths are not equal by construction/,
    ],
    [
      'a tuple operand of a sum',
      fn(['At', ['Add', 'P', ['Tuple', 1, 2]], 1], P),
      /Add with the tuple operand P is not in the profile/,
    ],
    [
      'a list of lists',
      fn(['List', ['List', 'x'], 1], X),
      /a list literal of lists of different element types or of lists and other values is not in the profile/,
    ],
    [
      'a list of booleans',
      fn(['At', ['List', ['Less', 'x', 1]], 1], X),
      /a list literal with an element of the type `boolean`|At\(\[x < 1\], 1\) has the type boolean/,
    ],
    [
      'a list and a complex number',
      fn(['Add', 'L', ['Complex', 1, 2]], L),
      /Add of a list and the operand/,
    ],
    [
      // `Max` of a list and a number is admitted since slice 5 of
      // docs/plans/2026-11-12-structured-broadcast-over-lists.md.
      'Max of a list and a tuple',
      fn(['Max', 'L', ['Tuple', 'x', 1]], L, X),
      /Max with the list operand L and the operand/,
    ],
    // Since slice 1 of docs/plans/2026-11-12-structured-broadcast-over-lists.md
    // a function of a list is admitted in the `strict` mode
    // (compile-javascript-structured-broadcast.test.ts), but for the inverse
    // functions whose scalar code is complex.
    [
      'a function of a list whose scalar code is complex',
      fn(['Arccos', 'L'], L),
      /Arccos with the list operand L is not in the profile/,
    ],
    [
      'a comprehension with a guard that draws',
      fn(['Comprehension', 'k', ['Element', 'k', ['Range', 1, 3], ['Less', ['Random'], 0.5]]]),
      /Comprehension with a guard whose guard or body has the node Random\(\), which is not pure/,
    ],
    [
      'a comprehension with a guard and a bound that is an input',
      fn(['Comprehension', 'k', ['Element', 'k', ['Range', 1, 'n'], ['Less', 2, 'k']]], N),
      /Comprehension with a guard and the bound n is not in the profile/,
    ],
    [
      'Sum of a list literal with a sum as an element (the existing emitter writes the terms in one chain)',
      fn(['Sum', ['List', 'x', ['Add', 'y', -0.1]]], X, Y),
      /Sum of the list literal \[x,y - 0.1\] with an element of the head Add is not in the profile/,
    ],
    [
      'Product of a list literal with a product as an element (canonical: Reduce)',
      fn(['Product', ['List', 'y', ['Multiply', 'x', 'y']]], X, Y),
      /Reduce of the list literal .* with an element of the head Multiply is not in the profile/,
    ],
    [
      'Exp of an expression of a call whose type admits a list and a number',
      fn(['Exp', ['Add', ['fm', 'L'], 2]], L),
      /Power of the operand .* which admits a list and a number/,
    ],
    [
      'a product with a call whose type admits a list and a number',
      fn(['Multiply', 10, ['Divide', 2, ['fm', 'L']]], L),
      /Multiply of the operand 2 \/ fm\(L\) of the type .*, which admits a list and a number/,
    ],
    [
      'At of an element-wise product of a list literal with a product as an element',
      fn(['At', ['Multiply', 'y', ['List', 1, ['Multiply', 7, 'x']]], 2], X, Y),
      /At of .*, an element-wise Multiply of a list literal with an element of the head Multiply, is not in the profile/,
    ],
    [
      'Sum of a number',
      fn(['Sum', 'x'], X),
      /Sum of one operand of the type `real` is not in the profile/,
    ],
    [
      'a named tuple parameter',
      fn(['At', 'T', 1], ['T', 'tuple<x: real, y: real>']),
      /the parameter T of the function has the type tuple<x: real, y: real>, which is not in the profile/,
    ],
    [
      'a tuple of complex numbers',
      fn(['Tuple', 'x', ['Complex', 0, 1]], X),
      /a tuple with an element of the type `complex`/,
    ],
  ];
  test.each(declines)('%s', (_name, json, message) => {
    for (const mode of MODES)
      expect(() =>
        compile(ce.expr(json), { profile: 'numeric-kernel', fallback: false, mode } as never)
      ).toThrow(message);
  });

  // The type of the sum is `number`. In the `strict` mode the existing
  // compiler adds the elements with `+` (`0 + _tv1[0] + _tv1[1] + _tv1[2]`),
  // and so does the profile (`isWideRealInStrict()`); in the `complex` mode
  // it wraps the fold in `_SYS.cplx`.
  test('Sum of a tuple literal, whose type is number: the strict mode only', () => {
    const json = fn(['Sum', ['Tuple', 'x', 1, 2]], X);
    expect(() =>
      compile(ce.expr(json), { profile: 'numeric-kernel', fallback: false, mode: 'complex' } as never)
    ).toThrow(/Sum of \(x, 1, 2\) is not in the profile: its type number is not real/);
    const expr = ce.expr(json);
    const result = compile(expr, { profile: 'numeric-kernel', fallback: false, mode: 'strict' } as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, { ...EXISTING, mode: 'strict' }) as CompilationResult<'javascript'>;
    for (const x of [-2.5, -0, 0, 3, NaN, Infinity])
      expect([x, same(run(result, [x]), run(existing, [x]))]).toEqual([x, true]);
  });
});

describe('the representation', () => {
  const structured = () => new ScalarFragmentJavaScriptTarget('structured');
  const OPTIONS = { cse: false, constantFold: false } as const;
  const lower = (json: MathJsonExpression): IRProgram =>
    lowerStructuredFragment(
      structured().prepareStructured(new ComputeEngine().expr(json), OPTIONS)
    );
  const operations = (region: IRRegion, out: IROperation[] = []): IROperation[] => {
    for (const op of region.operations) {
      out.push(op);
      if (op.kind === 'if') {
        operations(op.then, out);
        operations(op.else, out);
      }
      if (op.kind === 'loop' || op.kind === 'build') operations(op.body, out);
    }
    return out;
  };

  test('the types are interned', () => {
    expect(listType('real')).toBe(listType('real'));
    expect(tupleType(['real', 'real'])).toBe(tupleType(['real', 'real']));
    expect(String(tupleType(['real', 'integer']))).toBe('tuple<real, integer>');
    expect(String(listType('integer'))).toBe('list<integer>');
  });

  test('a list literal and a tuple are the operations list and tuple', () => {
    const program = lower(fn(['Add', ['At', ['List', 'x', 1], 1], ['At', ['Tuple', 'x', 2], 2]], X));
    const ops = operations(program.root);
    const list = ops.find((op) => op.kind === 'list')!;
    expect(list.result!.type).toBe(listType('real'));
    const tuple = ops.find((op) => op.kind === 'tuple')!;
    expect(tuple.result!.type).toBe(tupleType(['real', 'real']));
    expect(list.effect).toBe('pure');
  });

  test('a fold of a list is an ascending loop; of a tuple, the sum of its elements', () => {
    const loop = operations(lower(fn(['Sum', 'L'], L)).root).find((op) => op.kind === 'loop');
    expect(loop?.kind === 'loop' && loop.ascending).toBe(true);
    const tuple = operations(lower(fn(['Sum', 'P'], P)).root);
    expect(tuple.filter((op) => op.kind === 'get')).toHaveLength(2);
    expect(tuple.some((op) => op.kind === 'loop')).toBe(false);
  });

  test('an element-wise sum is an ascending build', () => {
    const build = operations(lower(fn(['Add', 'L', 1], L)).root).find((op) => op.kind === 'build');
    expect(build?.kind === 'build' && build.ascending).toBe(true);
  });

  test('the append of a comprehension with a guard is in place, and the program is pure', () => {
    const program = lower(fn(['Comprehension', 'k', ['Element', 'k', ['Range', 1, 9], ['Less', 'n', 'k']]], N));
    const append = operations(program.root).filter((op) => op.kind === 'append');
    expect(append).toHaveLength(1);
    expect(inPlaceUpdates(program).has(append[0])).toBe(true);
    const analysis = analyzeExecution(program);
    expect(analysis.independentCalls.holds).toBe(true);
    expect(analysis.workerPortable.holds).toBe(true);
  });

  test('a list value read twice is not updated in place by a later ReplaceAt', () => {
    // `R` is a list literal, shared by two reads: the `ReplaceAt` copies it,
    // and the second read sees the elements before the write.
    const json: MathJsonExpression = [
      'Function',
      [
        'Block',
        ['Declare', 'R', "'list<real>'", ['List', 'x', 2, 3]],
        ['Declare', 'S', "'list<real>'", ['ReplaceAt', 'R', 1, 9]],
        ['Add', ['At', 'S', 1], ['At', 'R', 1]],
      ],
      typed('x', 'real'),
    ];
    const ce = new ComputeEngine();
    const program = lower(json);
    const replace = operations(program.root).find((op) => op.kind === 'replace-at')!;
    expect(inPlaceUpdates(program).has(replace)).toBe(false);
    for (const mode of MODES) {
      const result = compile(ce.expr(json), { profile: 'numeric-kernel', fallback: false, mode } as never) as CompilationResult<'javascript'>;
      const existing = compile(ce.expr(json), { ...EXISTING, mode }) as CompilationResult<'javascript'>;
      expect(run(result, [5])).toBe(14);
      expect(run(existing, [5])).toBe(14);
    }
  });

  test('a list literal reached twice (a DAG) is one value; an update in place of it copies', () => {
    const ce = new ComputeEngine();
    const x = ce.box('x');
    const list = ce.function('List', [x, ce.number(2)]);
    const replaced = ce.function('ReplaceAt', [list, ce.number(1), ce.number(9)]);
    const expr = ce.function('Add', [
      ce.function('At', [replaced, ce.number(1)]),
      ce.function('At', [list, ce.number(1)]),
    ]);
    ce.declare('x', 'real');
    const result = compile(expr, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    expect((result.run as unknown as (v: object) => number)({ x: 5 })).toBe(14);
  });
});

describe('the corpus witnesses: legal, stones and score of the Othello prelude', () => {
  // The functions of Tycho's Othello showcase
  // (~/dev/tycho/src/graph-paper/onboarding/showcase-othello.js), with the
  // helpers they call.
  const OTHELLO = `
function ray(B: list<integer>, k: integer, p: integer, dx: integer, dy: integer) -> integer {
  let col = k - 1 - 8 * floor((k - 1) / 8) + dx
  let row = floor((k - 1) / 8) + dy
  let n = 0
  let found = 0
  for j in 1..7 {
    if col < 0 || col > 7 || row < 0 || row > 7 { break }
    let v = B[1 + col + 8 * row]
    if v == -p {
      n = n + 1
    } else {
      if v == p { found = n }
      break
    }
    col = col + dx
    row = row + dy
  }
  found
}
function flips(B: list<integer>, k: integer, p: integer) -> integer {
  let n = 0
  if k >= 1 && k <= 64 && p != 0 {
    if B[k] == 0 {
      for dx in -1..1 {
        for dy in -1..1 {
          if dx != 0 || dy != 0 { n = n + ray(B, k, p, dx, dy) }
        }
      }
    }
  }
  n
}
function legal(B: list<integer>, p: integer) -> list<integer> {
  [k for k in 1..64 if flips(B, k, p) > 0]
}
function score(B: list<integer>, p: integer) -> integer {
  length(stones(B, p))
}
function stones(B: list<integer>, p: integer) -> list<integer> {
  [k for k in 1..64 if B[k] == p]
}
`;
  const START = Array.from({ length: 65 }, (_, i) =>
    i === 27 || i === 36 ? -1 : i === 28 || i === 35 || i === 64 ? 1 : 0
  );
  const LATER = START.map((v, i) => (i === 19 || i === 20 ? 1 : i === 44 ? -1 : v));
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  expect(executeEpsil(ce, OTHELLO).diagnostics).toEqual([]);
  const literal = (name: string): Expression =>
    (ce.lookupDefinition(name) as { operator: { _lambdaLiteral: Expression } }).operator
      ._lambdaLiteral;

  test.each(['legal', 'stones', 'score'])('%s', (name) => {
    const result = compile(literal(name), { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    expect(result.pure).toBe(true);
    expect(result.shippable).toBe(true);
    const existing = compile(literal(name), EXISTING) as CompilationResult<'javascript'>;
    for (const board of [START, LATER])
      for (const p of [1, -1, 0]) {
        const value = run(result, [board, p]);
        expect(same(value, run(existing, [board, p]))).toBe(true);
      }
    // The four legal moves of the start position for black.
    if (name === 'legal') expect(run(result, [START, 1])).toEqual([20, 27, 38, 45]);
  });
});

describe('lists and the functions of the host', () => {
  // A function of the host (the option `functions`) takes and gives numbers
  // only: a list argument or a list result declines. A call that is not
  // declared pure has the effect `unknown`: a list value read before it is
  // read again after it, and a comprehension whose guard or body calls it
  // declines (the interpreter's comprehension is a lazy view).
  const host = globalThis as unknown as Record<string, unknown>;
  host.__collectionsImpure = (t: number) => t + 1;
  host.__collectionsPure = (t: number) => 2 * t;
  host.__collectionsLength = (t: unknown) => (Array.isArray(t) ? t.length : 0);
  host.__collectionsPair = (t: number) => [t, t];
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('L', 'list<real>');
  ce.declare('hq', '(real) -> real');
  ce.declare('hp', '(real) -> real');
  ce.declare('hl', '(list<real>) -> real');
  ce.declare('hr', '(real) -> list<real>');
  const FUNCTIONS = {
    hq: '__collectionsImpure',
    hp: { source: '__collectionsPure', pure: true },
    hl: '__collectionsLength',
    hr: '__collectionsPair',
  };
  const OPTIONS = {
    profile: 'numeric-kernel',
    fallback: false,
    functions: FUNCTIONS,
  } as never;
  const declines: [string, MathJsonExpression, RegExp][] = [
    ['a list argument', ['hl', 'L'], /No signature of `hl` in the profile takes operands of the types \(list<real>\)/],
    ['a list result', ['At', ['hr', 'x'], 1], /the function hr of the host has the result type list<real>/],
    [
      'a guard that calls a function that is not pure',
      ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 5], ['Less', ['hq', 'k'], 3]]],
      /Comprehension with a guard whose guard or body has the node hq\(k\), which is not pure/,
    ],
    [
      'a guarded body that calls a function that is not pure',
      ['Comprehension', ['hq', 'k'], ['Element', 'k', ['Range', 1, 5], ['Less', 'k', 3]]],
      /Comprehension with a guard whose guard or body has the node hq\(k\), which is not pure/,
    ],
    [
      // The admission reads the effect that the engine gives the call, not
      // the declaration of the option: a simple, sound decline.
      'a guard that calls a function declared pure',
      ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 5], ['Less', ['hp', 'k'], 7]]],
      /Comprehension with a guard whose guard or body has the node hp\(k\), which is not pure/,
    ],
    [
      'a guarded body that draws',
      ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 5], ['Less', 'k', 3]]],
      /Comprehension with a guard whose guard or body has the node Random\(\), which is not pure/,
    ],
  ];
  test.each(declines)('%s declines', (_name, json, message) => {
    expect(() => compile(ce.box(json), OPTIONS)).toThrow(message);
  });

  test('a list read before and after a call that is not pure is read twice', () => {
    const result = compile(
      ce.box(['Add', ['Sum', 'L'], ['hq', 'x'], ['Sum', 'L']]),
      OPTIONS
    ) as CompilationResult<'javascript'>;
    expect(result.code.match(/_\.L\b/g)?.length).toBe(2);
    expect((result.run as unknown as (v: object) => number)({ L: [1, 2], x: 1 })).toBe(8);
  });

  test('an element-wise sum with a call: the call once, before the elements, as on the existing compiler', () => {
    for (const json of [['Add', 'L', ['hq', 'x']]] as MathJsonExpression[]) {
      const result = compile(ce.box(json), OPTIONS) as CompilationResult<'javascript'>;
      const existing = compile(ce.box(json), {
        ...EXISTING,
        functions: FUNCTIONS,
      } as never) as CompilationResult<'javascript'>;
      const call = (r: CompilationResult<'javascript'>) =>
        (r.run as unknown as (v: object) => unknown)({ L: [1, -0, 2.5], x: 0.5 });
      expect(same(call(result), call(existing))).toBe(true);
    }
  });
});

describe('lists and tuples in blocks and local functions', () => {
  // The forms of the blocks change (nested blocks, a block of declarations
  // as an operand, `Declare(a, 'unknown', v)`, a first write to a name that
  // no `Declare` declares, local functions in the `strict` mode) with a
  // list or a tuple value: the values and the shapes of the existing
  // compiler, or a decline with a message.
  const ce = new ComputeEngine();
  const blocks: [string, MathJsonExpression, readonly Mode[]][] = [
    [
      'a first write of a list (an implicit local), read with At',
      fn(['Block', ['Declare', 'R', "'unknown'", ['List', 'x', 2]], ['At', 'R', 2]], X),
      MODES,
    ],
    [
      'a first write of a list, updated with ReplaceAt and returned',
      fn(
        ['Block', ['Declare', 'R', "'unknown'", ['List', 'x', 2]], ['Assign', 'R', ['ReplaceAt', 'R', 1, 7]], 'R'],
        X
      ),
      MODES,
    ],
    [
      'a first write of a guarded comprehension',
      fn(
        [
          'Block',
          ['Declare', 'R', "'unknown'", ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 9], ['Less', 'x', 'k']]]],
          ['Length', 'R'],
        ],
        X
      ),
      MODES,
    ],
    [
      'a local declared unknown with a list value',
      fn(['Block', ['Declare', 'R', "'unknown'", ['List', 'x', 2]], ['Sum', 'R']], X),
      ['strict'],
    ],
    [
      'a local declared unknown with a tuple value',
      fn(['Block', ['Declare', 'R', "'unknown'", ['Tuple', 'x', 2]], ['At', 'R', 1]], X),
      ['strict'],
    ],
    [
      'a list local of a nested block',
      fn(
        [
          'Block',
          ['Declare', 's', "'real'", 0],
          ['Block', ['Declare', 'R', "'list<real>'", ['List', 'x', 2]], ['Assign', 's', ['Sum', 'R']]],
          's',
        ],
        X
      ),
      ['strict'],
    ],
    [
      'a list in a block of declarations as an operand',
      fn(['Add', 1, ['Block', ['Declare', 'R', "'list<real>'", ['List', 'x', 2]], ['Max', 'R']]], X),
      ['strict'],
    ],
    [
      'a tuple in a block of declarations as an operand',
      fn(
        [
          'Add',
          1,
          ['Block', ['Declare', 'P', ['Dictionary', ['KeyValuePair', "'value'", ['Tuple', 'x', 2]]]], ['At', 'P', 2]],
        ],
        X
      ),
      ['strict'],
    ],
  ];
  test.each(blocks)('%s', (_name, json, modes) => {
    for (const mode of modes) {
      const expr = ce.expr(json);
      const result = compile(expr, { profile: 'numeric-kernel', fallback: false, mode } as never) as CompilationResult<'javascript'>;
      const existing = compile(expr, { ...EXISTING, mode }) as CompilationResult<'javascript'>;
      for (const x of [1.5, -0, 20])
        expect([mode, x, same(run(result, [x]), run(existing, [x]))]).toEqual([mode, x, true]);
    }
  });

  // In the `complex` mode, a tuple local declines (the existing compiler
  // reads a local of a type that is not real as a complex value), and so
  // does a fold of a list local (it reads the local with `_SYS.cplx`).
  test.each([
    [
      fn(['Block', ['Declare', 'R', "'unknown'", ['Tuple', 'x', 2]], ['At', 'R', 1]], X),
      /the local R has the type tuple<real, integer>, which is not real, in the complex mode/,
    ],
    [
      fn(['Add', 1, ['Block', ['Declare', 'R', "'list<real>'", ['List', 'x', 2]], ['Max', 'R']]], X),
      /Max of R is not in the profile: in the complex mode the existing compiler reads a local list with _SYS.cplx/,
    ],
  ] as [MathJsonExpression, RegExp][])('in the complex mode %#: a decline', (json, message) => {
    expect(() =>
      compile(ce.expr(json), { profile: 'numeric-kernel', fallback: false, mode: 'complex' } as never)
    ).toThrow(message);
  });

  const literalOf = (source: string, name: string): Expression => {
    const engine = new ComputeEngine();
    engine.precision = 'machine';
    expect(executeEpsil(engine, source).diagnostics).toEqual([]);
    return (engine.lookupDefinition(name) as { operator: { _lambdaLiteral: Expression } })
      .operator._lambdaLiteral;
  };

  test.each([
    [
      'a list parameter of a local function',
      `function f(x: real) -> real {
  function g(Q: list<real>) -> real { Q[1] + Q[2] }
  g([x, 2])
}`,
    ],
    [
      'a list result of a local function',
      `function f(x: real) -> real {
  function g(t: real) -> list<real> { [t, 2 * t] }
  g(x)[2]
}`,
    ],
    [
      'a tuple result of a local function',
      `function f(x: real) -> real {
  function g(t: real) -> tuple<real, real> { (t, 2 * t) }
  g(x)[2]
}`,
    ],
  ])('%s: the values of the existing compiler', (_name, source) => {
    const literal = literalOf(source, 'f');
    const result = compile(literal, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    const existing = compile(literal, EXISTING) as CompilationResult<'javascript'>;
    for (const x of [1.5, -0, 1e300]) expect(same(run(result, [x]), run(existing, [x]))).toBe(true);
  });

  // A local function that reads a list local of the body would receive the
  // list as an extra parameter, and the body can update the list in place
  // between two calls: the profile declines it (the simple, sound version).
  test.each([
    [
      'a list local read by a local function',
      `function f(x: real) -> real {
  let R = [x, 2, 3]
  function g(k: integer) -> real { R[k] }
  g(1) + g(3)
}`,
    ],
    [
      'a list updated between two calls of a local function that reads it',
      `function f(x: real) -> real {
  let R: list<real> = [x, 2, 3]
  function g(k: integer) -> real { R[k] + 1 }
  let a = g(2)
  R = ReplaceAt(R, 2, a)
  R[2] + g(2)
}`,
    ],
  ])('%s declines', (_name, source) => {
    expect(() =>
      compile(literalOf(source, 'f'), { profile: 'numeric-kernel', fallback: false } as never)
    ).toThrow(/The parameter `R` of `g` has no type in the profile/);
  });
});

/** The `Function` literal that `executeEpsil()` made for `name` in an
 *  engine of its own. */
function epsilLiteral(source: string, name: string): { ce: ComputeEngine; literal: Expression } {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  expect(executeEpsil(ce, source).diagnostics).toEqual([]);
  return {
    ce,
    literal: (ce.lookupDefinition(name) as { operator: { _lambdaLiteral: Expression } })
      .operator._lambdaLiteral,
  };
}

describe('the forms of the slice in the body of a helper', () => {
  // The existing compiler prepares the body of a declared helper on its
  // own, and writes there the element of an element-wise sum of a list
  // literal as one sum in an order of its own: `g` below is
  // `(x) => x + 2 + -0.1` there. The refusals of the root are also made on
  // each helper body and each local-function body.
  test.each([
    ['Sum of a list literal with a sum element', 'Sum([2, x - 0.1])', /Sum of the list literal \[2,x - 0\.1\] with an element of the head Add/],
    ['At of an element-wise sum with a scalar sum', '([1, 2] + (x - 0.1))[2]', /an element-wise Add of a list literal in the body of a helper/],
    ['At of an element-wise sum of three operands', '([1, 2] + x + 0.1)[2]', /an element-wise Add of a list literal in the body of a helper/],
    ['At of an element-wise product', '([1, 2] * (x * 0.1))[2]', /an element-wise Multiply of a list literal in the body of a helper/],
  ])('%s declines in a declared helper', (_name, body, message) => {
    const { literal } = epsilLiteral(
      `function g(x: real) -> real { ${body} }\nfunction f(x: real) -> real { g(x) }`,
      'f'
    );
    expect(() => compile(literal, { profile: 'numeric-kernel', fallback: false } as never)).toThrow(message);
  });

  test('At of an element-wise sum declines in a local function', () => {
    const { literal } = epsilLiteral(
      `function f(x: real) -> real {\n  function g(t: real) -> real { ([1, 2] + (t - 0.1))[2] }\n  g(x)\n}`,
      'f'
    );
    expect(() => compile(literal, { profile: 'numeric-kernel', fallback: false } as never)).toThrow(
      /an element-wise Add of a list literal in the body of a helper/
    );
  });

  // The neighbours that stay: at the root, the existing compiler writes the
  // element as the route does; in a helper, a list local, a whole list
  // result and a fold of an element-wise sum have the values of the
  // existing compiler.
  test.each([
    ['At of an element-wise sum at the root', 'function f(x: real) -> real { ([1, 2] + (x - 0.1))[2] }'],
    ['At of an element-wise sum of a list local in a helper', 'function g(x: real) -> real { let L = [1, 2]; (L + (x - 0.1))[2] }\nfunction f(x: real) -> real { g(x) }'],
    ['a list result of an element-wise sum in a helper', 'function g(x: real) -> list<real> { [1, 2] + (x - 0.1) }\nfunction f(x: real) -> real { g(x)[2] }'],
    ['a fold of an element-wise sum in a helper', 'function g(x: real) -> real { Sum([1, 2] + (x - 0.1)) }\nfunction f(x: real) -> real { g(x) }'],
    ['a guarded comprehension in a helper', 'function g(x: real) -> integer { length([k for k in 1..9 if x < k]) }\nfunction f(x: real) -> real { g(x) + 1 }'],
  ])('%s: the values of the existing compiler', (_name, source) => {
    const { literal } = epsilLiteral(source, 'f');
    const result = compile(literal, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    const existing = compile(literal, EXISTING) as CompilationResult<'javascript'>;
    for (const x of [0.3, -0.7, 4.5]) expect([x, same(run(result, [x]), run(existing, [x]))]).toEqual([x, true]);
  });
});

describe('a list made before a write of a local that it reads', () => {
  // The interpreter's comprehension is a lazy view, but an assignment
  // stores the elements of a lazy collection that reads a variable
  // (`listedAssignedValue()` in `library/core.ts`): the list keeps the
  // values that the variables had at the assignment, as the eager list of
  // the route and of the existing compiler.
  test.each([
    ['a guard', 'let cutoff: integer = 1; let xs = [k for k in 1..3 if cutoff < k]; cutoff = 2; length(xs)', 2],
    ['a body', 'let c: real = 1; let xs = [k + c for k in 1..3]; c = 5; xs[1]', 2],
    ['a bound', 'let n: integer = 3; let xs = [k for k in 1..n]; n = 1; length(xs)', 3],
    ['an element-wise sum', 'let c: real = 1; let xs = [1, 2] + c; c = 5; xs[1]', 2],
    ['a list made in a loop that writes the local after', 'let s: real = 0; let t: real = 0; for j in 1..2 { let xs = [k + s for k in 1..2]; s = s + 10; t = t + xs[1] }; t', 12],
    ['a list made before a loop that writes the local', 'let s: real = 0; let t: real = 0; let xs = [k + s for k in 1..2]; for j in 1..2 { s = s + 10; t = t + xs[1] }; t', 2],
    ['a local function that reads the local', 'let c: real = 1; let g = (k: real) => k + c; let xs = [g(k) for k in 1..3]; c = 5; xs[1]', 2],
    ['a parameter in the guard', 'let xs = [k for k in 1..3 if a < k]; length(xs)', 3],
  ])('%s: the interpreter, the route and the existing compiler agree', (_name, body, expected) => {
    const { ce, literal } = epsilLiteral(`function f(a: real) -> real { ${body} }`, 'f');
    const result = compile(literal, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    const existing = compile(literal, EXISTING) as CompilationResult<'javascript'>;
    expect(run(result, [0.5])).toBe(expected);
    expect(run(existing, [0.5])).toBe(expected);
    expect(ce.expr(['f', 0.5]).evaluate().re).toBe(expected);
  });
});
