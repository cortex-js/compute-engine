import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { isFunction, isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

// Values of the type `number` in the `strict` mode (the default mode) under
// the `numeric-kernel` profile: a list input or a list parameter of the type
// `list<number>`, `vector<n>` or `vector` is a list of reals, as the existing
// compiler reads it there (`_SYS.atNumeric(L, i, "number")`, a fold with
// `+`). A node whose engine type is `number` only because it reads such
// values (`L + 1`, `At(L, i)`, `Sum(L·x)`) is real; a node that the
// existing compiler can read on the complex lane (a radical or an inverse
// function of a real operand, a complex value) keeps its decline. In the
// `complex` mode a `number` element is complex, and such a list declines.
//
// Each admitted program is compared with the existing compiler (`cse:
// false`, `constantFold: false`, the same mode) with `Object.is` at every
// depth, the same program with its names declared `real` and `number`, and
// with the interpreter where its value is a real number.

const EXISTING = { cse: false, constantFold: false } as const;
const ce = new ComputeEngine();

type Arg = number | number[];

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

const fn = (
  body: MathJsonExpression,
  ...parameters: [string, string][]
): MathJsonExpression =>
  [
    'Function',
    ['Block', body],
    ...parameters.map(([n, t]) => typed(n, t)),
  ] as MathJsonExpression;

/** The mode options: the default mode (no option) and `strict`. */
const MODES = [{}, { mode: 'strict' }] as const;

function profile(json: MathJsonExpression, mode: object) {
  return compile(ce.expr(json), {
    profile: 'numeric-kernel',
    fallback: false,
    ...mode,
  } as never) as CompilationResult<'javascript'>;
}

function call(result: CompilationResult<'javascript'>, args: readonly Arg[]): unknown {
  try {
    return (result.run as unknown as (...a: unknown[]) => unknown)(
      ...args.map((a) => (Array.isArray(a) ? [...a] : a))
    );
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
}

/** The same doubles (`Object.is`) and the same shape, at every depth. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isComplex(a) && isComplex(b))
    return Object.is(a.re, b.re) && Object.is(a.im, b.im);
  return Object.is(a, b);
}

const isComplex = (v: unknown): v is { re: number; im: number } =>
  typeof v === 'object' && v !== null && 're' in v;

/** Within 1e-12 relative of the interpreter; `NaN` or an infinity where the
 *  interpreter gives no real number (a complex value in the `strict` mode,
 *  the undirected infinity of a quotient by zero). A complex value of the
 *  code is compared part by part. */
function close(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      value.every((v, i) => close(v, expected[i]))
    );
  if (isComplex(value) && isComplex(expected))
    return close(value.re, expected.re) && close(value.im, expected.im);
  if (typeof value !== 'number') return false;
  // A real double where the interpreter gives a complex value: `NaN` in the
  // `strict` mode; an infinity where it gives the undirected infinity.
  if (isComplex(expected))
    return Number.isFinite(expected.re) && Number.isFinite(expected.im)
      ? Number.isNaN(value)
      : !Number.isFinite(value);
  if (typeof expected !== 'number')
    return Number.isNaN(value) || !Number.isFinite(value);
  if (!Number.isFinite(expected))
    return Number.isNaN(value) || value === expected;
  return (
    value === expected ||
    Math.abs(value - expected) <= 1e-12 * Math.max(1, Math.abs(value), Math.abs(expected))
  );
}

function interpret(json: MathJsonExpression, args: readonly Arg[]): unknown {
  const boxed = args.map((a) =>
    Array.isArray(a) ? (['List', ...a] as MathJsonExpression) : a
  );
  const evaluated = ce.expr(['Apply', json, ...boxed] as MathJsonExpression).evaluate();
  // A lazy collection (a comprehension, `Filter`, `Map`, `Scan`, `Take`):
  // its elements are read here.
  const value = (
    evaluated.operator !== 'List' && evaluated.isCollection
      ? ce.function('List', [...evaluated.each()])
      : evaluated
  ).N();
  if (isFunction(value, 'List'))
    return value.ops.map((op) => numberOf(op));
  return numberOf(value);
}

/** A number, `{re, im}` for a complex number, `undefined` otherwise. */
function numberOf(value: ReturnType<typeof ce.expr>): unknown {
  if (!isNumber(value)) return undefined;
  return value.im === 0 ? value.re : { re: value.re, im: value.im };
}

// The values of each parameter: lists with `NaN`, `±0`, `±Infinity`,
// negative elements (under roots and logarithms) and the empty list.
const LISTS: number[][] = [
  [],
  [4],
  [-2, 0.5, 3],
  [-0, 0, NaN],
  [Infinity, -1, 2, -Infinity, 0.5],
  [0.3, 0.9, -0.7],
];
const LISTS3: number[][] = [
  [-1.5, 0.25, 2],
  [-0, NaN, Infinity],
  [0.5, -0.5, 1e300],
];
const SCALARS = [-2.5, -1, -0, 0, 0.25, 1, 3, NaN, Infinity, -Infinity];
const INDEXES = [-1, 0, 1, 2, 4];

const valuesOf = (type: string): Arg[] =>
  /^vector<3>|\^3/.test(type)
    ? LISTS3
    : /^(list|vector)/.test(type)
      ? LISTS
      : type === 'integer'
        ? INDEXES
        : SCALARS;

function points(types: readonly string[]): Arg[][] {
  let out: Arg[][] = [[]];
  for (const t of types) out = out.flatMap((p) => valuesOf(t).map((v) => [...p, v]));
  return out;
}

/** The parameters of a program: `L` a list, `x` a scalar, `i` an integer.
 *  `number` gives the declarations of the type `number`; otherwise `real`. */
type Program = {
  name: string;
  body: MathJsonExpression;
  parameters: ('L' | 'x' | 'i')[];
  /** The declared type of `L` in the `number` declaration. */
  list?: string;
};

const listType = (p: Program, wide: boolean) =>
  wide ? (p.list ?? 'list<number>') : 'list<real>';

function declarations(p: Program, wide: boolean): [string, string][] {
  return p.parameters.map((name) => [
    name,
    name === 'L' ? listType(p, wide) : name === 'i' ? 'integer' : wide ? 'number' : 'real',
  ]);
}

const PROGRAMS: Program[] = [
  { name: 'L + 1', body: ['Add', 'L', 1], parameters: ['L'] },
  { name: 'L·x', body: ['Multiply', 'L', 'x'], parameters: ['L', 'x'] },
  { name: '2L/x', body: ['Divide', ['Multiply', 2, 'L'], 'x'], parameters: ['L', 'x'] },
  { name: '−L', body: ['Negate', 'L'], parameters: ['L'] },
  { name: 'L + L', body: ['Add', 'L', 'L'], parameters: ['L'] },
  { name: 'L_i + 1', body: ['Add', ['At', 'L', 'i'], 1], parameters: ['L', 'i'] },
  { name: 'L_i + 1, vector<3>', body: ['Add', ['At', 'L', 'i'], 1], parameters: ['L', 'i'], list: 'vector<3>' },
  { name: 'L_i + 1, vector', body: ['Add', ['At', 'L', 'i'], 1], parameters: ['L', 'i'], list: 'vector' },
  { name: '√(L_i)', body: ['Sqrt', ['At', 'L', 'i']], parameters: ['L', 'i'] },
  { name: 'ln(L_1) + 1', body: ['Add', ['Ln', ['At', 'L', 1]], 1], parameters: ['L'] },
  { name: 'arcsin(L_1)·x', body: ['Multiply', 'x', ['Arcsin', ['At', 'L', 1]]], parameters: ['L', 'x'] },
  { name: 'L_i^x', body: ['Power', ['At', 'L', 'i'], 'x'], parameters: ['L', 'x', 'i'] },
  { name: '|L_1|', body: ['Abs', ['At', 'L', 1]], parameters: ['L'] },
  { name: 'L_i·(2/x)', body: ['Multiply', ['At', 'L', 'i'], ['Divide', 2, 'x']], parameters: ['L', 'x', 'i'] },
  { name: 'x·(2/‖L‖)', body: ['Multiply', 'x', ['Divide', 2, ['Norm', 'L']]], parameters: ['L', 'x'] },
  { name: 'L·(2/‖L‖)', body: ['Multiply', 'L', ['Divide', 2, ['Norm', 'L']]], parameters: ['L'] },
  { name: 'if L_1 < 0', body: ['If', ['Less', ['At', 'L', 1], 0], ['Negate', ['At', 'L', 1]], ['At', 'L', 2]], parameters: ['L'] },
  { name: 'which', body: ['Which', ['Less', ['At', 'L', 1], 0], ['Negate', ['At', 'L', 1]], 'True', ['Sqrt', ['At', 'L', 2]]], parameters: ['L'] },
  { name: 'Length(L)', body: ['Length', 'L'], parameters: ['L'] },
  { name: 'Sum(L)', body: ['Sum', 'L'], parameters: ['L'] },
  { name: 'Sum(L), vector<3>', body: ['Sum', 'L'], parameters: ['L'], list: 'vector<3>' },
  { name: 'Product(L)', body: ['Product', 'L'], parameters: ['L'] },
  { name: 'Max(L)', body: ['Max', 'L'], parameters: ['L'] },
  { name: 'Min(L)', body: ['Min', 'L'], parameters: ['L'] },
  { name: 'Norm(L)', body: ['Norm', 'L'], parameters: ['L'] },
  { name: 'Mean(L)', body: ['Mean', 'L'], parameters: ['L'] },
  { name: 'Sum(L + 1)', body: ['Sum', ['Add', 'L', 1]], parameters: ['L'] },
  { name: 'Sum(L·x)', body: ['Sum', ['Multiply', 'L', 'x']], parameters: ['L', 'x'] },
  { name: 'Max(2L)', body: ['Max', ['Multiply', 2, 'L']], parameters: ['L'] },
  { name: 'Product(L − 1)', body: ['Product', ['Subtract', 'L', 1]], parameters: ['L'] },
  { name: 'Sum(L/2.5)', body: ['Sum', ['Divide', 'L', 2.5]], parameters: ['L'] },
  { name: 'Sum(L·√x)', body: ['Sum', ['Multiply', 'L', ['Sqrt', 'x']]], parameters: ['L', 'x'] },
  { name: 'arcsin(Sum(L))', body: ['Arcsin', ['Sum', 'L']], parameters: ['L'] },
  { name: 'Sum of L_k, k in 1..3', body: ['Sum', ['At', 'L', 'k'], ['Limits', 'k', 1, 3]], parameters: ['L'] },
  { name: 'Sum of √(L_k), k to Length(L)', body: ['Sum', ['Sqrt', ['At', 'L', 'k']], ['Limits', 'k', 1, ['Length', 'L']]], parameters: ['L'] },
  { name: 'Filter', body: ['Filter', 'L', ['Function', ['Less', 't', 1], 't']], parameters: ['L'] },
  { name: 'Count', body: ['Count', 'L', ['Function', ['Greater', ['Sqrt', 't'], 1], 't']], parameters: ['L'] },
  { name: 'Map of arcsin', body: ['Map', ['Function', ['Arcsin', 't'], 't'], 'L'], parameters: ['L'] },
  { name: 'Reduce by Add', body: ['Reduce', 'L', 'Add'], parameters: ['L'] },
  { name: 'Reduce with a function', body: ['Reduce', 'L', ['Function', ['Add', 'a', ['Multiply', 'b', 'b']], 'a', 'b'], 0], parameters: ['L'] },
  { name: 'Scan', body: ['Scan', 'L', 'Add'], parameters: ['L'] },
  { name: 'Comprehension', body: ['Comprehension', ['Multiply', 2, ['At', 'L', 'j']], ['Element', 'j', ['Range', 1, ['Length', 'L']]]], parameters: ['L'] },
  { name: 'At of a comprehension of √', body: ['Multiply', 'x', ['At', ['Comprehension', ['Sqrt', ['At', 'L', 'j']], ['Element', 'j', ['Range', 1, 3]]], 2]], parameters: ['L', 'x'], list: 'vector<3>' },
  { name: 'First, Last', body: ['Add', ['First', 'L'], ['Last', 'L']], parameters: ['L'] },
  { name: 'ReplaceAt', body: ['ReplaceAt', 'L', 1, 'x'], parameters: ['L', 'x'], list: 'vector<3>' },
  { name: 'Sort, Take', body: ['Take', ['Sort', 'L'], 2], parameters: ['L'] },
  { name: 'a local', body: ['Block', ['Declare', 's', "'number'", ['Sum', 'L']], ['Divide', 's', ['Length', 'L']]], parameters: ['L'] },
  { name: 'a local list<number>', body: ['Block', ['Declare', 'M', "'list<number>'", ['Multiply', 'L', 2]], ['Sum', 'M']], parameters: ['L'] },
];

/**
 * Whether the value of the code at `args` is compared with the interpreter:
 * finite inputs, a list that is not empty and an index in its range (an
 * absent element is `NaN`, and every operator applied to it is unspecified
 * in compiled code), and a value that is not `NaN` (in the `strict` mode a
 * complex intermediate value is `NaN`, and `0 · NaN` is `NaN` where the
 * interpreter gives `0`). Each of these values is compared with the
 * existing compiler.
 */
function comparesWithInterpreter(
  parameters: readonly [string, string][],
  args: readonly Arg[],
  value: unknown
): boolean {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isNaN(value)))
    return false;
  const list = args.find((a): a is number[] => Array.isArray(a));
  return args.every((a, k) => {
    if (Array.isArray(a)) return a.length > 0 && a.every(Number.isFinite);
    if (!Number.isFinite(a)) return false;
    if (parameters[k][1] !== 'integer' || list === undefined) return true;
    return a !== 0 && Math.abs(a) <= list.length;
  });
}

describe('lists of numbers in the strict mode: the values of the existing compiler and of the interpreter', () => {
  test.each(PROGRAMS.map((p) => [p.name, p] as const))('%s', (_name, program) => {
    for (const wide of [false, true]) {
      const parameters = declarations(program, wide);
      const json = fn(program.body, ...parameters);
      for (const mode of MODES) {
        let result: CompilationResult<'javascript'>;
        try {
          result = profile(json, mode);
        } catch (e) {
          // With the names declared `real`, a few programs keep a decline
          // of their own (a radical of a real operand on the complex lane).
          if (!wide) continue;
          throw e;
        }
        const existing = compile(ce.expr(json), { ...EXISTING, ...mode } as never) as CompilationResult<'javascript'>;
        for (const args of points(parameters.map(([, t]) => t))) {
          const value = call(result, args);
          expect([wide, args, value, same(value, call(existing, args))]).toEqual([wide, args, value, true]);
          if (comparesWithInterpreter(parameters, args, value))
            expect([wide, args, close(value, interpret(json, args))]).toEqual([wide, args, true]);
        }
      }
    }
  });

  test('the code reads the elements as the existing compiler does, with the label number', () => {
    const json = fn(['Add', ['At', 'L', 'i'], 1], ['L', 'list<number>'], ['i', 'integer']);
    expect(profile(json, {}).code).toBe(
      '(L, i) => { return _SYS.atNumeric(L, i, "number") + 1; }'
    );
  });

  test('a list declared number is the same code as a list declared real, except the label', () => {
    for (const p of PROGRAMS) {
      if (p.body.toString().includes('Arcsin')) continue;
      let real: string;
      try {
        real = profile(fn(p.body, ...declarations(p, false)), {}).code;
      } catch {
        continue;
      }
      const wide = profile(fn(p.body, ...declarations(p, true)), {}).code;
      expect([p.name, wide.replace(/"number"/g, '"real"')]).toEqual([p.name, real]);
    }
  });
});

describe('inputs of the type list<number> and vector<n>', () => {
  const engine = new ComputeEngine();
  engine.declare('LN', 'list<number>');
  engine.declare('VN', 'vector<3>');
  engine.declare('xn', 'number');
  const rows: [string, MathJsonExpression][] = [
    ['LN + xn', ['Add', 'LN', 'xn']],
    ['Sum(LN) + Max(VN)', ['Add', ['Sum', 'LN'], ['Max', 'VN']]],
    ['Dot(LN, LN)·xn', ['Multiply', ['Dot', 'LN', 'LN'], 'xn']],
    ['arccos(At(VN, 2))', ['Arccos', ['At', 'VN', 2]]],
  ];
  test.each(rows)('%s', (_name, json) => {
    const expr = engine.expr(json);
    const result = compile(expr, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, EXISTING as never) as CompilationResult<'javascript'>;
    const run = (r: CompilationResult<'javascript'>, v: object) => {
      try {
        return (r.run as unknown as (v: object) => unknown)(v);
      } catch (e) {
        return `throws ${(e as Error).message}`;
      }
    };
    for (const LN of LISTS)
      for (const VN of LISTS3)
        for (const xn of SCALARS) {
          const v = { LN: [...LN], VN: [...VN], xn };
          expect([v, same(run(result, v), run(existing, v))]).toEqual([v, true]);
        }
  });
});

// A scalar name with no declared type, or declared `unknown`, beside a list
// (the ruling of 2026-11-11: under the profile such a name is a number,
// real in the `strict` mode). The existing compiler writes the same
// `_SYS.bcast` closure as for a name declared `real`.
describe('element-wise arithmetic with a scalar name of no declared type', () => {
  const engine = new ComputeEngine();
  engine.declare('L', 'list<real>');
  engine.declare('x', 'real');
  engine.declare('w', 'unknown');
  const rows: [string, MathJsonExpression][] = [
    ['L·u', ['Multiply', 'L', 'u']],
    ['2·u·L', ['Multiply', 2, 'u', 'L']],
    ['x·L·u', ['Multiply', 'x', 'L', 'u']],
    ['L/(u·u)', ['Divide', 'L', ['Multiply', 'u', 'u']]],
    ['u/L', ['Divide', 'u', 'L']],
    ['L + u·x', ['Add', 'L', ['Multiply', 'u', 'x']]],
    ['u·(L + 1)', ['Multiply', 'u', ['Add', 'L', 1]]],
    ['Sum(L·√u)', ['Sum', ['Multiply', 'L', ['Sqrt', 'u']]]],
    ['L·w, w declared unknown', ['Multiply', 'L', 'w']],
  ];
  test.each(rows)('%s: the values of the existing compiler', (_name, json) => {
    const expr = engine.expr(json);
    const result = compile(expr, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, EXISTING as never) as CompilationResult<'javascript'>;
    expect(result.defaultedSymbols ?? []).not.toContain('x');
    const run = (r: CompilationResult<'javascript'>, v: object) => {
      try {
        return (r.run as unknown as (v: object) => unknown)(structuredClone(v));
      } catch (e) {
        return `throws ${(e as Error).message}`;
      }
    };
    for (const L of LISTS)
      for (const s of SCALARS)
        for (const x of [-1.5, -0, 2]) {
          const v = { L, u: s, w: s, x };
          expect([v, same(run(result, v), run(existing, v))]).toEqual([v, true]);
        }
  });

  test('the complex mode keeps its decline', () => {
    expect(() =>
      compile(engine.expr(['Multiply', 'L', 'u']), {
        profile: 'numeric-kernel',
        fallback: false,
        mode: 'complex',
      } as never)
    ).toThrow(/Multiply of a list and the operand u of the type `complex`/);
  });
});

// A helper with a declared signature whose literal has no annotation: each
// parameter has the type of the signature (a scalar, a list, a tuple), and a
// parameter of the type `unknown` has the default kind of the mode, as the
// parameter of a helper with an inferred signature (part B).
describe('a helper whose literal has no annotation', () => {
  type Helper = [string, string, MathJsonExpression, string[]];
  const HELPERS: Helper[] = [
    ['fu', '(unknown) -> number', ['Add', ['Sqrt', 't'], ['Multiply', 't', 't']], ['t']],
    ['fa', '(unknown) -> number', ['Arcsin', 't'], ['t']],
    ['fr', '(unknown, unknown, unknown) -> number', ['Add', ['Multiply', 'a', 'b'], 'c'], ['a', 'b', 'c']],
    ['fq', '(unknown) -> real', ['Multiply', 't', 't'], ['t']],
    ['fl', '(list<real>) -> real', ['Add', ['Sum', 't'], ['Max', 't']], ['t']],
    ['fn', '(list<number>) -> number', ['Add', ['Sum', 't'], ['At', 't', 1]], ['t']],
    ['fv', '(vector<2>) -> number', ['Subtract', ['At', 't', 1], ['At', 't', 2]], ['t']],
    ['ft', '(tuple<number, number>) -> number', ['Multiply', ['At', 't', 1], ['At', 't', 2]], ['t']],
    ['fp', '(tuple<number, number>, unknown) -> tuple<number, number>', ['Tuple', ['Add', ['At', 'p', 1], 's'], ['At', 'p', 2]], ['p', 's']],
    ['fw', '(list<real^3>) -> real', ['Sum', 't'], ['t']],
    ['kw', '(list<real^3>) -> real', ['Sum', 't'], ['t']],
    ['fb', '(broadcastable<real>) -> real', ['Add', 't', 1], ['t']],
  ];
  const engine = new ComputeEngine();
  engine.declare('x', 'real');
  engine.declare('xn', 'number');
  engine.declare('n', 'integer');
  engine.declare('L', 'list<real>');
  engine.declare('LN', 'list<number>');
  engine.declare('V', 'vector<2>');
  engine.declare('V3', 'vector<3>');
  for (const [name, signature, body, parameters] of HELPERS) {
    engine.declare(name, signature);
    engine.assign(name, engine.expr(['Function', body, ...parameters] as MathJsonExpression));
  }
  const INPUTS: Record<string, unknown[]> = {
    x: SCALARS,
    xn: SCALARS,
    n: INDEXES,
    L: LISTS,
    LN: LISTS,
    V: [[1, -2], [-0, NaN], [Infinity, 0.5]],
    V3: [[1, 2, 3], [-0, -0, -0], [NaN, 1, Infinity]],
  };
  const inputsOf = (json: MathJsonExpression) =>
    Object.keys(INPUTS).filter((k) => JSON.stringify(json).includes(`"${k}"`));
  const rows: [string, MathJsonExpression, object][] = [
    ['fu(x)', ['fu', 'x'], {}],
    ['fu(xn) + 1', ['Add', ['fu', 'xn'], 1], {}],
    ['fu(n)/2', ['Divide', ['fu', 'n'], 2], {}],
    ['fa(x)', ['fa', 'x'], {}],
    ['fa(√x)', ['fa', ['Sqrt', 'x']], {}],
    ['fr(20, x, xn) − 3', ['Add', ['fr', 20, 'x', 'xn'], -3], {}],
    ['x + fq(√(x − 1))', ['Add', 'x', ['fq', ['Sqrt', ['Add', 'x', -1]]]], {}],
    ['fl(L)', ['fl', 'L'], {}],
    ['fn(LN)', ['fn', 'LN'], {}],
    ['2·fv(V)', ['Multiply', 2, ['fv', 'V']], {}],
    ['ft((x, 2))', ['ft', ['Tuple', 'x', 2]], {}],
    ['fp((1, 2), x)_1', ['At', ['fp', ['Tuple', 1, 2], 'x'], 1], {}],
    ['fu(xn) in the complex mode', ['fu', 'xn'], { mode: 'complex' }],
    // An argument that states the width of the parameter.
    ['kw(V3)', ['kw', 'V3'], {}],
    ['a local function g(v: vector<3>) of V3', ['Block', ['DefineFunction', 'g', ['Function', ['Sum', 'v'], typed('v', 'vector<3>')]], ['g', 'V3']], {}],
  ];
  test.each(rows)('%s: the values of the existing compiler', (_name, json, mode) => {
    const expr = engine.expr(json);
    const result = compile(expr, { profile: 'numeric-kernel', fallback: false, ...mode } as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, { ...EXISTING, ...mode } as never) as CompilationResult<'javascript'>;
    const names = inputsOf(json);
    let vars: Record<string, unknown>[] = [{}];
    for (const name of names)
      vars = vars.flatMap((v) => INPUTS[name].map((value) => ({ ...v, [name]: value })));
    const run = (r: CompilationResult<'javascript'>, v: object) => {
      try {
        return (r.run as unknown as (v: object) => unknown)(structuredClone(v));
      } catch (e) {
        return `throws ${(e as Error).message}`;
      }
    };
    for (const v of vars) expect([v, same(run(result, v), run(existing, v))]).toEqual([v, true]);
  });

  const declines: [string, MathJsonExpression, object, RegExp][] = [
    // The existing compiler compiles a copy of the helper for each
    // argument type (`_fn_fq_list_real_`); the parameter of the profile is
    // real.
    ['fq(L) + 1', ['Add', ['fq', 'L'], 1], {}, /The argument `L` of `fq` has the type `list<real>`, and the parameter `t` has the type `real`/],
    // In the `complex` mode the parameter is complex, and a real argument
    // declines, as for a helper with an inferred signature.
    ['fu(x) in the complex mode', ['fu', 'x'], { mode: 'complex' }, /The argument `x` of `fu` has the type `real`, and the parameter `t` has no declared type: it is complex in the `complex` mode/],
    // The existing compiler reads the width of the parameter.
    ['fw(L)', ['fw', 'L'], {}, /the argument L of the type list<real> of the helper fw is not in the profile: the parameter has the type vector<real\^3>, whose width the existing compiler reads/],
    // The same for a local function: at `L = [1]` the existing compiler
    // gives `NaN` (`0 + v[0] + v[1] + v[2]`).
    ['a local function g(v: vector<3>) of L', ['Block', ['DefineFunction', 'g', ['Function', ['Sum', 'v'], typed('v', 'vector<3>')]], ['g', 'L']], {}, /the argument L of the type list<real> of the helper g is not in the profile: the parameter has the type vector<3>, whose width the existing compiler reads/],
    // The existing compiler applies the helper to each element of a list.
    ['fb(L)', ['fb', 'L'], {}, /the parameter t of the helper fb has no type annotation, and the type broadcastable<real> of its signature is not in the profile/],
  ];
  test.each(declines)('%s declines', (_name, json, mode, message) => {
    expect(() =>
      compile(engine.expr(json), { profile: 'numeric-kernel', fallback: false, ...mode } as never)
    ).toThrow(message);
  });
});

describe('declines that stay', () => {
  const declines: [string, MathJsonExpression, object, RegExp][] = [
    [
      'a list of numbers in the complex mode',
      fn(['Sum', 'L'], ['L', 'list<number>']),
      { mode: 'complex' },
      /the parameter L has the type list<number>, and the profile admits a list only of the type list<real> or list<integer>/,
    ],
    [
      'vector<3> in the complex mode',
      fn(['At', 'L', 1], ['L', 'vector<3>']),
      { mode: 'complex' },
      /the parameter L has the type vector<3>/,
    ],
    [
      // A matrix plus a number is in the profile since slice 2 of the nested
      // lists (compile-javascript-structured-nested2.test.ts); two matrices
      // of no stated dimensions are not.
      'two matrices',
      fn(['Add', 'M', 'N'], ['M', 'matrix'], ['N', 'matrix']),
      {},
      /Add of the lists M and N, whose lengths are not equal by construction at every depth, is not in the profile/,
    ],
    [
      'a list of complex numbers',
      fn(['Sum', 'C'], ['C', 'list<complex>']),
      {},
      /the parameter C has the type list<complex>/,
    ],
    // The existing compiler reads `√x` with `x: real` in a fold on the
    // complex lane (`_SYS.cplx((…).reduce(_SYS.sadd, 0))`).
    [
      'Sum(L·√x) with x real',
      fn(['Sum', ['Multiply', 'L', ['Sqrt', 'x']]], ['L', 'list<number>'], ['x', 'real']),
      {},
      /Sum of .* is not in the profile: its type number is not real, and the existing compiler wraps the fold in _SYS.cplx/,
    ],
    [
      'Sum(L + arcsin(p)) with p real<0..>',
      fn(['Sum', ['Add', 'L', ['Arcsin', 'p']]], ['L', 'list<number>'], ['p', 'real<0..>']),
      {},
      /Sum of .* is not in the profile: its type number is not real/,
    ],
    [
      'Sum(L·i)',
      fn(['Sum', ['Multiply', 'L', 'ImaginaryUnit']], ['L', 'list<number>']),
      {},
      /Sum of .* is not in the profile: its type number is not real/,
    ],
    [
      'an element-wise radical of a list',
      fn(['Sqrt', 'L'], ['L', 'list<number>']),
      {},
      /Sqrt with the list operand L is not in the profile/,
    ],
    // As for `list<real^3>`: the existing compiler writes the sum of the
    // products of a list whose width its type states.
    [
      'Dot of a vector<3>',
      fn(['Dot', 'V', 'V'], ['V', 'vector<3>']),
      {},
      /Dot of V is not in the profile/,
    ],
    [
      'At with a slice',
      fn(['Sum', ['At', 'L', ['Range', 'a', 'b']]], ['L', 'vector<5>'], ['a', 'integer'], ['b', 'integer']),
      {},
      /At with a Range index \(a slice\) is not in the profile/,
    ],
  ];
  test.each(declines)('%s', (_name, json, mode, message) => {
    expect(() => profile(json, mode)).toThrow(message);
  });
});

describe('a closed form of an integral or a derivative that reads a name of the type number', () => {
  const engine = new ComputeEngine();
  engine.declare('x', 'number');
  test.each<[string, MathJsonExpression]>([
    ['Integrate(x·t, Limits(t, 0, 1))', ['Integrate', ['Multiply', 'x', 't'], ['Limits', 't', 0, 1]]],
    ['D(x^3, x)', ['D', ['Power', 'x', 3], 'x']],
  ])('%s: the values of the existing compiler', (_name, json) => {
    const expr = engine.expr(json);
    for (const mode of MODES) {
      const result = compile(expr, { profile: 'numeric-kernel', fallback: false, ...mode } as never) as CompilationResult<'javascript'>;
      const existing = compile(expr, { ...EXISTING, ...mode } as never) as CompilationResult<'javascript'>;
      for (const x of SCALARS) {
        const run = (r: CompilationResult<'javascript'>) => (r.run as unknown as (v: object) => unknown)({ x });
        expect([x, same(run(result), run(existing))]).toEqual([x, true]);
      }
    }
    // The `complex` mode declines, as for `x: real`.
    expect(() =>
      compile(expr, { profile: 'numeric-kernel', fallback: false, mode: 'complex' } as never)
    ).toThrow(/in the complex mode is not in the profile/);
  });
});
