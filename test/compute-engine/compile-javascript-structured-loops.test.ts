import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import type {
  IRLoop,
  IROperation,
  IRProgram,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Step 6, change 6a, of docs/plans/2026-11-09-js-compiler-status-and-plan.md
// (design: docs/plans/2026-11-10-structured-ir-loops-and-lists.md), on the
// structured route of the internal scalar JavaScript fragment target: a
// `Loop` over an integer range with carried scalar values, `Declare` in a
// loop body and in a branch, and `LessEqual`, `Mod`, `Floor`, `Divide` and
// `Power` with the exponent 2.
//
// The interpreter rules that the tests follow:
// - `Range(a, b)` with `b < a` visits `a, a - 1, …, b`: the range from 1 to
//   0 has the two elements 1 and 0. The bounds are evaluated once.
// - The value of a `Loop` is `Nothing`.
// - The statements of a body run in order: `a := b; b := a + b` reads the
//   new `a` in the second statement.
// - `Mod` is the floored remainder, with the sign of the divisor.
// - `Floor` has the type `integer`.

const OPTIONS = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;

const typed = (name: string, type: string): MathJsonExpression => ['Typed', name, `'${type}'`];
const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  `'${type}'`,
  value,
];
/** The form of a `let` that `parseEpsil()` gives. */
const letLocal = (name: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  ['Dictionary', ['KeyValuePair', "'value'", value]],
];
const range = (k: string, a: MathJsonExpression, b: MathJsonExpression): MathJsonExpression => [
  'Element',
  k,
  ['Range', a, b],
];
const loop = (body: MathJsonExpression, k: string, a: MathJsonExpression, b: MathJsonExpression): MathJsonExpression => [
  'Loop',
  body,
  range(k, a, b),
];
/** A `Function` whose body is a block of `statements`, with `parameters`. */
const fn = (parameters: MathJsonExpression[], ...statements: MathJsonExpression[]): MathJsonExpression => [
  'Function',
  ['Block', ...statements],
  ...parameters,
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  // `console` is an impurity label: the definition states an effect.
  ce.declare('Trace', {
    signature: '(real) -> real',
    effects: ['console'],
    evaluate: (ops) => ops[0],
  } as never);
  ce.declare('TraceInt', {
    signature: '(integer) -> integer',
    effects: ['console'],
    evaluate: (ops) => ops[0],
  } as never);
  return ce;
}

const TESTS = new Map([
  ['Trace', 'trace'],
  ['TraceInt', 'traceInt'],
]);
const TRACE_SOURCE = (id: string, operands: readonly string[]) =>
  `globalThis.__ceTrace(${JSON.stringify(id)}, ${operands.join(', ')})`;
const structured = (hooks = {}) =>
  new ScalarFragmentJavaScriptTarget('structured', TESTS, { trace: TRACE_SOURCE, ...hooks });

type Value = number | boolean | { re: number; im: number };

function run(result: CompilationResult<'javascript'>, inputs: Value[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...inputs);
}

function boxValue(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of `json` on `inputs` by the interpreter. */
function interpret(ce: ComputeEngine, json: MathJsonExpression, inputs: Value[]): unknown {
  const value = ce.function('Apply', [ce.expr(json), ...inputs.map((v) => boxValue(ce, v))]).evaluate();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  const n = value.N();
  if (n.im === 0) return n.re;
  return { re: n.re, im: n.im };
}

/** Equal values, `0` equal to `-0`, within 1e-12 relative for a finite
 *  value (the interpreter computes a complex product exactly). */
function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  const pair = (v: unknown) =>
    typeof v === 'number' ? { re: v, im: 0 } : (v as { re: number; im: number });
  const near = (u: number, v: number) =>
    (Number.isNaN(u) && Number.isNaN(v)) ||
    u === v ||
    (Number.isFinite(u) &&
      Number.isFinite(v) &&
      Math.abs(u - v) <= 1e-12 * Math.max(1, Math.abs(u), Math.abs(v)));
  const p = pair(a);
  const q = pair(b);
  return near(p.re, q.re) && near(p.im, q.im);
}

/** The value of `a` and `b`, which the existing emitter and the
 *  structured route give, are the same number or object, `0` equal to
 *  `-0`. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null)
    return same((a as { re: number }).re, (b as { re: number }).re) && same((a as { im: number }).im, (b as { im: number }).im);
  return a === b;
}

const N = [typed('n', 'integer')];
const NX = [typed('n', 'integer'), typed('x', 'real')];

type Fixture = {
  name: string;
  json: MathJsonExpression;
  inputs: Value[][];
  /** The existing emitter declines the program: only the interpreter
   *  checks it. */
  existing?: false;
};

const FIXTURES: Fixture[] = [
  {
    name: 'a sum of squares',
    json: fn(N, declare('s', 'real', 0), loop(['Assign', 's', ['Add', 's', ['Power', 'k', 2]]], 'k', 1, 'n'), 's'),
    inputs: [[5], [1], [0], [-3]],
  },
  // The digits of `s` are the indexes in the order of the passes.
  {
    name: 'number bounds: Range(1, 0) visits 1 then 0',
    json: fn(N, declare('s', 'real', 0), loop(['Assign', 's', ['Add', ['Multiply', 10, 's'], 'k', 1]], 'k', 1, 0), 's'),
    inputs: [[0]],
  },
  {
    name: 'number bounds: Range(3, 1) visits 3, 2, 1',
    json: fn(N, declare('s', 'real', 0), loop(['Assign', 's', ['Add', ['Multiply', 10, 's'], 'k']], 'k', 3, 1), 's'),
    inputs: [[0]],
  },
  {
    name: 'number bounds: Range(2, 2) visits 2 once',
    json: fn(N, declare('s', 'real', 0), loop(['Assign', 's', ['Add', ['Multiply', 10, 's'], 'k']], 'k', 2, 2), 's'),
    inputs: [[0]],
  },
  {
    name: 'a range that counts down from n to 1',
    json: fn(N, declare('s', 'real', 0), loop(['Assign', 's', ['Add', ['Multiply', 10, 's'], 'k']], 'k', 'n', 1), 's'),
    inputs: [[4], [1], [0], [-2]],
  },
  {
    name: 'a product',
    json: fn(N, declare('p', 'real', 1), loop(['Assign', 'p', ['Multiply', 'p', 'k']], 'k', 1, 'n'), 'p'),
    inputs: [[6], [0], [-2]],
  },
  {
    name: 'z := z^2 + c with a fixed count',
    json: fn(
      [typed('c', 'complex')],
      declare('z', 'complex', 'c'),
      loop(['Assign', 'z', ['Add', ['Multiply', 'z', 'z'], 'c']], 'k', 1, 6),
      'z'
    ),
    inputs: [[{ re: 0.25, im: 0.5 }], [{ re: -1, im: 0.125 }], [{ re: 0, im: 0 }]],
  },
  {
    name: 'z := Power(z, 2) + c',
    json: fn(
      [typed('c', 'complex')],
      declare('z', 'complex', 'c'),
      loop(['Assign', 'z', ['Add', ['Power', 'z', 2], 'c']], 'k', 1, 4),
      'z'
    ),
    inputs: [[{ re: 0.25, im: 0.5 }], [{ re: -0.5, im: -0.75 }]],
  },
  {
    // Sequential statements: the second reads the new value of `a`.
    name: 'two carried values that depend on each other',
    json: fn(
      N,
      declare('a', 'real', 0),
      declare('b', 'real', 1),
      loop(['Block', ['Assign', 'a', 'b'], ['Assign', 'b', ['Add', 'a', 'b']]], 'k', 1, 'n'),
      ['Add', 'a', ['Multiply', 1000, 'b']]
    ),
    inputs: [[6], [0], [-1]],
  },
  {
    // A swap through a local that the body writes and does not carry.
    name: 'a swap',
    json: fn(
      [typed('x', 'real'), typed('y', 'real'), typed('n', 'integer')],
      declare('a', 'real', 'x'),
      declare('b', 'real', 'y'),
      declare('t', 'real', 0),
      loop(['Block', ['Assign', 't', 'a'], ['Assign', 'a', 'b'], ['Assign', 'b', 't']], 'k', 1, 'n'),
      ['Add', 'a', ['Multiply', 10, 'b']]
    ),
    inputs: [[1, 2, 3], [1, 2, 4], [1, 2, 0]],
  },
  {
    name: 'a local declared in the body, in both forms',
    json: fn(
      NX,
      declare('s', 'real', 0),
      loop(
        [
          'Block',
          letLocal('q', ['Multiply', 'k', 'x']),
          declare('r', 'real', ['Add', 'q', 1]),
          ['Assign', 's', ['Add', 's', ['Multiply', 'q', 'r']]],
        ],
        'k',
        1,
        'n'
      ),
      's'
    ),
    inputs: [[4, 0.5], [0, 2]],
  },
  {
    name: 'an If in the body writes a carried local in one branch',
    json: fn(
      NX,
      declare('s', 'real', 0),
      loop(['If', ['Less', 'k', 'x'], ['Assign', 's', ['Add', 's', 'k']]], 'k', 1, 'n'),
      's'
    ),
    inputs: [[6, 3.5], [6, -1], [-2, 0]],
  },
  {
    // The canonical form writes `k >= x` as `LessEqual(x, k)`.
    name: 'GreaterEqual, and a declaration in a branch',
    json: fn(
      NX,
      declare('s', 'real', 0),
      loop(
        [
          'If',
          ['GreaterEqual', 'k', 'x'],
          ['Block', letLocal('d', ['Multiply', 2, 'k']), ['Assign', 's', ['Add', 's', 'd']]],
          ['Assign', 's', ['Add', 's', 1]],
        ],
        'k',
        1,
        'n'
      ),
      's'
    ),
    inputs: [[5, 3], [5, 2.5], [0, 0]],
  },
  {
    name: 'nested loops',
    json: fn(
      N,
      declare('s', 'real', 0),
      loop(loop(['Assign', 's', ['Add', 's', ['Multiply', 'i', 'j']]], 'j', 1, 'i'), 'i', 1, 'n'),
      's'
    ),
    inputs: [[4], [0], [-2]],
  },
  {
    name: 'nested loops: the inner one carries a local of the outer body',
    json: fn(
      N,
      declare('s', 'real', 0),
      loop(
        [
          'Block',
          declare('t', 'real', 0),
          loop(['Assign', 't', ['Add', 't', 'j']], 'j', 'i', 3),
          ['Assign', 's', ['Add', ['Multiply', 's', 2], 't']],
        ],
        'i',
        1,
        'n'
      ),
      's'
    ),
    inputs: [[4], [1], [-1]],
  },
  {
    name: 'a body writes a local that nobody reads',
    json: fn(
      N,
      declare('s', 'real', 0),
      declare('t', 'real', 0),
      loop(['Block', ['Assign', 't', ['Multiply', 'k', 2]], ['Assign', 's', ['Add', 's', 'k']]], 'k', 1, 'n'),
      's'
    ),
    inputs: [[4], [0]],
  },
  {
    name: 'Mod and Floor with negative operands',
    json: fn(
      NX,
      declare('s', 'real', 0),
      loop(
        ['Assign', 's', ['Add', ['Multiply', 's', 3], ['Mod', 'k', 3], ['Mod', 'x', ['Add', 'k', 0.5]], ['Floor', ['Divide', 'k', 'x']]]],
        'k',
        -7,
        'n'
      ),
      's'
    ),
    inputs: [[2, 2.5], [-9, -1.5], [3, -2.25]],
  },
  {
    name: 'Divide',
    json: fn(
      NX,
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', 's', ['Divide', 'x', ['Add', 'k', 'x']]]], 'k', 1, 'n'),
      's'
    ),
    inputs: [[5, 0.5], [3, -0.25]],
  },
  {
    // A carried local declared `integer`: its values are integers.
    name: 'an integer local',
    json: fn(
      N,
      declare('c', 'integer', 0),
      loop(['Assign', 'c', ['Add', 'c', ['Mod', 'k', 4], ['Floor', ['Divide', 'k', 3]]]], 'k', 1, 'n'),
      'c'
    ),
    inputs: [[9], [-5]],
  },
  {
    // The initial value is an integer, the next one a real.
    name: 'a carried value that becomes real',
    json: fn(NX, declare('s', 'real', 0), loop(['Assign', 's', ['Add', 's', 'x']], 'k', 1, 'n'), 's'),
    inputs: [[3, 0.75], [0, 0.75]],
  },
  {
    name: 'a value computed before the loop and read in its body',
    json: fn(
      NX,
      declare('h', 'real', ['Multiply', 'x', 'x']),
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', 's', 'h', 'k']], 'k', 1, 'n'),
      ['Add', 's', 'h']
    ),
    inputs: [[3, 1.5]],
  },
  {
    // `t` is carried by the inner loop, then by the outer one.
    name: 'a local written only in an inner loop and read after the outer loop',
    json: fn(
      N,
      declare('t', 'real', 1),
      loop(loop(['Assign', 't', ['Add', ['Multiply', 't', 2], 'j']], 'j', 1, 'i'), 'i', 1, 'n'),
      't'
    ),
    inputs: [[0], [1], [4], [-2]],
  },
  {
    // `a := b; b := a` with no temporary: the next value of `a` is the
    // parameter of `b`, and `b` is unchanged.
    name: 'a := b; b := a',
    json: fn(
      [typed('x', 'real'), typed('y', 'real'), typed('n', 'integer')],
      declare('a', 'real', 'x'),
      declare('b', 'real', 'y'),
      loop(['Block', ['Assign', 'a', 'b'], ['Assign', 'b', 'a']], 'k', 1, 'n'),
      ['Add', 'a', ['Multiply', 10, 'b']]
    ),
    inputs: [[1, 2, 0], [1, 2, 1], [1, 2, 5], [1, 2, -3]],
  },
  {
    // The next values are the parameters of other carried values.
    name: 'a rotation of three carried values',
    json: fn(
      [typed('x', 'real'), typed('y', 'real'), typed('n', 'integer')],
      declare('a', 'real', 'x'),
      declare('b', 'real', 'y'),
      declare('c', 'real', 3),
      loop(
        ['Block', ['Assign', 'a', 'b'], ['Assign', 'b', 'c'], ['Assign', 'c', ['Add', 'a', 'k']]],
        'k',
        1,
        'n'
      ),
      ['Add', 'a', ['Multiply', 10, 'b'], ['Multiply', 100, 'c']]
    ),
    inputs: [[1, 2, 0], [1, 2, 1], [1, 2, 5], [1, 2, -3]],
  },
  {
    // `x/49` is `Multiply(1/49, x)`: the code divides by 49, so the floor
    // is exact at each multiple of 49.
    name: 'Floor(k/49) over a range that holds multiples of 49',
    json: fn(
      N,
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', ['Multiply', 's', 2], ['Floor', ['Divide', 'k', 49]]]], 'k', 40, 'n'),
      's'
    ),
    inputs: [[49], [98], [150], [-50]],
  },
  {
    name: 'an integer let local as the bound of a loop',
    json: fn(
      N,
      letLocal('m', ['Add', 'n', 2]),
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', 's', 'k']], 'k', 1, 'm'),
      's'
    ),
    inputs: [[3], [-4]],
  },
  {
    // The interpreter accepts the real write; the engine infers `real`.
    name: 'a let local written with a real after an integer',
    json: fn(
      NX,
      letLocal('c', 1),
      loop(['Assign', 'c', ['Add', 'c', 'x']], 'k', 1, 'n'),
      'c'
    ),
    inputs: [[3, 0.25], [0, 0.25]],
  },
];

const fixture = (name: string) => FIXTURES.find((f) => f.name === name)!.json;

describe('differential: the interpreter decides, the existing emitter checks', () => {
  for (const mode of MODES)
    for (const f of FIXTURES)
      test(`${mode}: ${f.name}`, () => {
        const ce = engine();
        const expr = ce.expr(f.json);
        const result = structured().compile(expr, { ...OPTIONS, mode });
        expect(result.success).toBe(true);
        const existing =
          f.existing === false ? undefined : compile(expr, { ...OPTIONS, mode, fallback: false });
        for (const inputs of f.inputs) {
          const value = run(result, inputs);
          expect([inputs, close(value, interpret(ce, f.json, inputs))]).toEqual([inputs, true]);
          if (existing) expect([inputs, same(value, run(existing, inputs))]).toEqual([inputs, true]);
        }
      });

  test('the order of the passes over ranges with number bounds and over a range that counts down', () => {
    const value = (name: string, inputs: Value[]) =>
      run(structured().compile(engine().expr(fixture(name)), OPTIONS), inputs);
    expect(value('number bounds: Range(1, 0) visits 1 then 0', [0])).toBe(21);
    expect(value('number bounds: Range(3, 1) visits 3, 2, 1', [0])).toBe(321);
    expect(value('number bounds: Range(2, 2) visits 2 once', [0])).toBe(2);
    expect(value('a range that counts down from n to 1', [4])).toBe(4321);
    // Range(-2, 1) counts up: -2, -1, 0, 1.
    expect(value('a range that counts down from n to 1', [-2])).toBe(-2099);
  });
});

//
// Order and count, with the test operations
//

describe('order and count, with the test operations', () => {
  let traces: string[] = [];
  beforeEach(() => {
    traces = [];
    (globalThis as Record<string, unknown>).__ceTrace = (id: string, ...args: number[]) => {
      traces.push(`${id}(${args.join(',')})`);
      return args[0] ?? 0;
    };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ceTrace;
  });

  test('the bounds are evaluated once, before the loop; the body runs once per element', () => {
    const json = fn(
      [typed('a', 'integer'), typed('b', 'integer')],
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', 's', ['Trace', 'k']]], 'k', ['TraceInt', 'a'], ['TraceInt', 'b']),
      's'
    );
    const result = structured().compile(engine().expr(json), OPTIONS);
    expect(run(result, [2, 5])).toBe(14);
    expect(traces).toEqual(['traceInt(2)', 'traceInt(5)', 'trace(2)', 'trace(3)', 'trace(4)', 'trace(5)']);
    traces = [];
    // `b < a`: the range counts down, `b - a + 1` is not the count.
    expect(run(result, [2, -1])).toBe(2);
    expect(traces).toEqual(['traceInt(2)', 'traceInt(-1)', 'trace(2)', 'trace(1)', 'trace(0)', 'trace(-1)']);
  });

  test('an effectful operation in an untaken branch of the body does not run', () => {
    const json = fn(
      N,
      declare('s', 'real', 0),
      loop(['If', ['Less', 2, 'k'], ['Assign', 's', ['Add', 's', ['Trace', 'k']]]], 'k', 1, 'n'),
      's'
    );
    const result = structured().compile(engine().expr(json), OPTIONS);
    expect(run(result, [4])).toBe(7);
    expect(traces).toEqual(['trace(3)', 'trace(4)']);
  });

  test('Power(x, 2) evaluates its operand once', () => {
    const json = fn(
      N,
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', 's', ['Power', ['Trace', 'k'], 2]]], 'k', 1, 'n'),
      's'
    );
    const result = structured().compile(engine().expr(json), OPTIONS);
    expect(run(result, [3])).toBe(14);
    expect(traces).toEqual(['trace(1)', 'trace(2)', 'trace(3)']);
  });
});

//
// The iteration budget
//

describe('a loop that can abort', () => {
  // A function that loops over `1..n` in a branch, writes a local that
  // nobody reads, and returns 0: the `If` has no result and no effect.
  const json = fn(
    [typed('n', 'integer'), typed('C', 'boolean')],
    declare('t', 'real', 0),
    ['If', 'C', loop(['Assign', 't', ['Add', 't', 'k']], 'k', 1, 'n')],
    0
  );

  test('with a budget, the If is kept, and the loop over the budget throws as on the ordinary target', () => {
    const ce = engine();
    const options = { ...OPTIONS, iterationBudget: 10 };
    const result = structured().compile(ce.expr(json), options);
    const ordinary = compile(ce.expr(json), { ...options, fallback: false });
    expect(run(result, [5, true])).toBe(0);
    const failure = (r: CompilationResult<'javascript'>) => {
      try {
        run(r, [20, true]);
      } catch (e) {
        return [(e as Error).name, (e as Error).message];
      }
      return undefined;
    };
    expect(failure(ordinary)?.[0]).toBe('CancellationError');
    expect(failure(result)).toEqual(failure(ordinary));
    expect(run(result, [20, false])).toBe(0);
    const program = lowerStructuredFragment(structured().prepareStructured(ce.expr(json), options));
    expect(program.root.canAbort).toBe(true);
  });

  test('with no budget, the If is pruned', () => {
    const ce = engine();
    const result = structured().compile(ce.expr(json), OPTIONS);
    expect(result.code).not.toContain('for (');
    const program = lowerStructuredFragment(structured().prepareStructured(ce.expr(json), OPTIONS));
    expect(program.root.canAbort).toBeUndefined();
  });

  test('the verifier checks the abort fact', () => {
    const ce = engine();
    const options = { ...OPTIONS, iterationBudget: 10 };
    const preparation = structured().prepareStructured(ce.expr(json), options);
    const program = lowerStructuredFragment(preparation);
    const nodes = new Set<Expression>();
    const collect = (scope: (typeof preparation.annotation)['scope']) => {
      for (const n of scope.facts.keys()) nodes.add(n);
      for (const n of scope.statements) nodes.add(n);
      for (const inner of scope.inner.values()) collect(inner);
    };
    collect(preparation.annotation.scope);
    const { canAbort: _, ...root } = program.root;
    expect(() => verifyJavaScriptProgram({ ...program, root }, nodes)).toThrow(
      /the abort fact of a region \(false\) does not agree with its operations \(true\)/
    );
  });
});

describe('the iteration budget', () => {
  const json = fn(
    N,
    declare('s', 'real', 0),
    loop(loop(['Assign', 's', ['Add', 's', 1]], 'j', 1, 2), 'k', 1, 'n'),
    's'
  );

  test('a loop over the budget fails as on the ordinary target', () => {
    const ce = engine();
    const expr = ce.expr(json);
    const options = { ...OPTIONS, iterationBudget: 10.5 };
    const result = structured().compile(expr, options);
    const ordinary = compile(expr, { ...options, fallback: false });
    expect(result.code).toContain('_SYS.countLoopPass(10);');
    // Three outer passes and six inner passes: nine.
    expect(run(result, [3])).toBe(6);
    expect(run(ordinary, [3])).toBe(6);
    const failure = (r: CompilationResult<'javascript'>) => {
      try {
        run(r, [4]);
      } catch (e) {
        return [(e as Error).name, (e as Error).message, (e as { cause?: unknown }).cause];
      }
      return undefined;
    };
    const expected = failure(ordinary);
    expect(expected?.[0]).toBe('CancellationError');
    expect(failure(result)).toEqual(expected);
    // Each call starts with a count of 0.
    expect(run(result, [3])).toBe(6);
  });

  test('with no budget, the code counts no pass', () => {
    const result = structured().compile(engine().expr(json), OPTIONS);
    expect(result.code).not.toContain('countLoopPass');
    expect(run(result, [100])).toBe(200);
  });
});

//
// The representation
//

function loopsOf(region: IRRegion): IRLoop[] {
  const result: IRLoop[] = [];
  const visit = (r: IRRegion) => {
    for (const op of r.operations) {
      if (op.kind === 'loop') result.push(op);
      if (op.kind === 'if') {
        visit(op.then);
        visit(op.else);
      }
      if (op.kind === 'loop') visit(op.body);
    }
  };
  visit(region);
  return result;
}

const lower = (json: MathJsonExpression) =>
  lowerStructuredFragment(structured().prepareStructured(engine().expr(json), OPTIONS));

describe('the loop in the representation', () => {
  test('one parameter and one result per carried local, the index first', () => {
    const program = lower(fixture('two carried values that depend on each other'));
    const [op] = loopsOf(program.root);
    expect(op.results.map((r) => r.type)).toEqual(['real', 'real']);
    expect(op.body.parameters!.map((p) => p.type)).toEqual(['integer', 'real', 'real']);
    // The bounds, then the two initial values.
    expect(op.operands).toHaveLength(4);
    expect(op.iterationBudget).toBeUndefined();
  });

  test('a local that the body writes and that nobody reads is not carried', () => {
    const program = lower(fixture('a body writes a local that nobody reads'));
    const [op] = loopsOf(program.root);
    expect(op.results).toHaveLength(1);
    // The swap: `t` is written before it is read in each iteration.
    const swap = loopsOf(lower(fixture('a swap')).root)[0];
    expect(swap.results).toHaveLength(2);
  });

  test('a carried value whose next value is real has a real parameter', () => {
    const [op] = loopsOf(lower(fixture('a carried value that becomes real')).root);
    // The local is declared `real`: its integer initial value is converted
    // to a real where it is declared.
    expect(op.operands[2].type).toBe('real');
    expect(op.body.parameters![1].type).toBe('real');
    // A local declared `integer` whose values are integers.
    const [integer] = loopsOf(lower(fixture('an integer local')).root);
    expect(integer.body.parameters![1].type).toBe('integer');
  });

  test('the loop records the iteration budget', () => {
    const preparation = structured().prepareStructured(engine().expr(fixture('a product')), {
      ...OPTIONS,
      iterationBudget: 1000,
    });
    const [op] = loopsOf(lowerStructuredFragment(preparation).root);
    expect(op.iterationBudget).toBe(1000);
  });
});

//
// The verifier
//

describe('the verifier, a loop', () => {
  /** The lowered `a product`, with the loop and the place to change it. */
  function lowered() {
    const preparation = structured().prepareStructured(engine().expr(fixture('a product')), OPTIONS);
    const program = lowerStructuredFragment(preparation);
    const nodes = new Set<Expression>();
    const collect = (scope: (typeof preparation.annotation)['scope']) => {
      for (const n of scope.facts.keys()) nodes.add(n);
      for (const n of scope.statements) nodes.add(n);
      for (const inner of scope.inner.values()) collect(inner);
    };
    collect(preparation.annotation.scope);
    const ops = program.root.operations as IROperation[];
    const index = ops.findIndex((op) => op.kind === 'loop');
    const op = ops[index] as IRLoop;
    const replace = (changed: IRLoop, root?: IROperation[]): IRProgram => {
      const rootOps = root ?? [...ops];
      rootOps[index] = changed;
      return { ...program, root: { ...program.root, operations: rootOps } };
    };
    return { program, nodes, op, ops, index, replace };
  }

  test('control: the lowered program verifies', () => {
    const m = lowered();
    expect(() => verifyJavaScriptProgram(m.program, m.nodes)).not.toThrow();
  });

  test('a parameter used outside its region', () => {
    const m = lowered();
    const parameter = m.op.body.parameters![1];
    const root = [...m.ops];
    const last = root[root.length - 1];
    root[root.length - 1] = { ...last, operands: [parameter] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.op, root), m.nodes)).toThrow(
      /the value \d+ is used outside the region of its definition/
    );
  });

  test('a body that yields another count of values than the results', () => {
    const m = lowered();
    const body = m.op.body.operations;
    const yields = body[body.length - 1];
    const changed: IRLoop = {
      ...m.op,
      body: { ...m.op.body, operations: [...body.slice(0, -1), { ...yields, operands: [] } as IROperation] },
    };
    expect(() => verifyJavaScriptProgram(m.replace(changed), m.nodes)).toThrow(
      /the body of a loop yields 0 values, and the loop has 1 results/
    );
  });

  test('a carried value whose next value has another representation', () => {
    const m = lowered();
    const body = m.op.body.operations;
    const yields = body[body.length - 1];
    const flag = { ...yields.operands[0], id: 9999, type: 'boolean' as const, representation: 'boolean' };
    const literal: IROperation = {
      kind: 'literal',
      value: true,
      result: flag,
      operands: [],
      effect: 'pure',
      origin: m.op.origin,
    };
    const changed: IRLoop = {
      ...m.op,
      body: {
        ...m.op.body,
        operations: [...body.slice(0, -1), literal, { ...yields, operands: [flag] } as IROperation],
      },
    };
    expect(() => verifyJavaScriptProgram(m.replace(changed), m.nodes)).toThrow(
      /the carried value 1 of a loop has the representations number, boolean/
    );
  });

  test('a parameter defined twice, and a region with parameters that is not a loop body', () => {
    const m = lowered();
    const [index, parameter] = m.op.body.parameters!;
    const twice: IRLoop = { ...m.op, body: { ...m.op.body, parameters: [index, parameter, parameter] } };
    expect(() => verifyJavaScriptProgram(m.replace(twice), m.nodes)).toThrow(/is defined twice/);
    const real: IRLoop = {
      ...m.op,
      body: { ...m.op.body, parameters: [{ ...index, type: 'real' }, parameter] },
    };
    expect(() => verifyJavaScriptProgram(m.replace(real), m.nodes)).toThrow(
      /used with another type or representation than its definition|the index of a loop has the type real/
    );
  });
});

//
// The emitted code
//

describe('the emitted code', () => {
  const code = (json: MathJsonExpression) => structured().compile(engine().expr(json), OPTIONS).code;

  test('a sum of squares', () => {
    expect(code(fixture('a sum of squares'))).toBe(
      '(n) => { const _tv1 = n; let _tv2 = 0; const _tv4 = _tv1 < 1 ? -1 : 1; const _tv5 = _tv4 * (_tv1 - 1); for (let _tv6 = 0; _tv6 <= _tv5; _tv6++) { const _tv3 = _tv4 < 0 ? 1 - _tv6 : 1 + _tv6; _tv2 = _tv3 * _tv3 + _tv2; } return _tv2; }'
    );
  });

  test('two carried values that depend on each other: the next values are read first', () => {
    expect(code(fixture('two carried values that depend on each other'))).toBe(
      '(n) => { const _tv1 = n; let _tv2 = 0, _tv3 = 1; const _tv5 = _tv1 < 1 ? -1 : 1; const _tv6 = _tv5 * (_tv1 - 1); for (let _tv7 = 0; _tv7 <= _tv6; _tv7++) { const _tv4 = _tv5 < 0 ? 1 - _tv7 : 1 + _tv7; const _tv8 = _tv3; _tv3 = _tv3 + _tv3; _tv2 = _tv8; } return _tv2 + 1000 * _tv3; }'
    );
  });
});

//
// Refusals
//

describe('refusals', () => {
  const body = (statement: MathJsonExpression) =>
    fn(N, declare('s', 'real', 0), loop(statement, 'k', 1, 'n'), 's');
  const refusals: [string, MathJsonExpression, RegExp][] = [
    // A `Break` is admitted only as the last statement of a branch of an `If`
    // (compile-javascript-structured-break.test.ts).
    [
      'a Break',
      body(['Break']),
      /the structured route admits a Break only as the last statement of a branch of an If, not as a statement of the body of a Loop/,
    ],
    ['a Continue', body(['Continue']), /the structured route admits no statement Continue in the body of a Loop/],
    [
      'a Return in a branch of the body',
      body(['If', ['Less', 'k', 2], ['Return', 's']]),
      /the structured route admits no statement Return in a branch of an If/,
    ],
    [
      'a loop with a step',
      fn(N, declare('s', 'real', 0), ['Loop', ['Assign', 's', 'k'], ['Element', 'k', ['Range', 1, 'n', 2]]], 's'),
      /admits a Loop only over Element\(k, Range\(a, b\)\), with no step and no guard/,
    ],
    [
      'a loop over a list',
      fn(N, declare('s', 'real', 0), ['Loop', ['Assign', 's', 'k'], ['Element', 'k', ['List', 1, 2]]], 's'),
      /admits a Loop only over Element\(k, Range\(a, b\)\)/,
    ],
    [
      'a loop with a guard',
      fn(N, declare('s', 'real', 0), ['Loop', ['Assign', 's', 'k'], ['Element', 'k', ['Range', 1, 'n'], ['Less', 'k', 3]]], 's'),
      /admits a Loop only over Element\(k, Range\(a, b\)\)/,
    ],
    ['a write to the index', body(['Assign', 'k', 1]), /admits no write to the loop index k/],
    [
      // The interpreter gives a `Loop` the value `Nothing`.
      'a loop used as a value',
      fn(N, declare('s', 'real', 0), loop(['Assign', 's', 'k'], 'k', 1, 'n')),
      /a Loop used as a value is not in the structured route: the interpreter gives a Loop the value Nothing/,
    ],
    [
      'a bound that is not an integer',
      fn([typed('x', 'real')], declare('s', 'real', 0), loop(['Assign', 's', 'k'], 'k', 1, 'x'), 's'),
      /the bound x of a Loop does not have the type integer/,
    ],
    [
      'an index with the name of a parameter',
      fn(N, declare('s', 'real', 0), loop(['Assign', 's', 'n'], 'n', 1, 3), 's'),
      /the loop index n has the name of a parameter, a local or another index/,
    ],
    [
      'a Power with the exponent 0.5',
      body(['Assign', 's', ['Power', 'k', 0.5]]),
      /Power with the exponent 0\.5 is not in the structured route/,
    ],
    [
      'Mod with a complex operand',
      fn([typed('z', 'complex')], declare('t', 'real', 0), ['Mod', 'z', 2]),
      /Mod with a complex operand is not in the structured route/,
    ],
    [
      'Floor with a complex operand',
      fn([typed('z', 'complex')], declare('t', 'real', 0), ['Floor', 'z']),
      /Floor with a complex operand is not in the structured route/,
    ],
    [
      'Less of a complex quotient',
      fn([typed('z', 'complex'), typed('x', 'real')], declare('t', 'real', 0), ['Less', ['Divide', 'x', 'z'], 1]),
      /Less with a complex operand is not in the structured route/,
    ],
    [
      'LessEqual with a boolean operand',
      fn([typed('C', 'boolean'), typed('x', 'real')], declare('t', 'real', 0), ['LessEqual', 'C', 'x']),
      /LessEqual with a boolean operand is not in the structured route|No signature/,
    ],
    [
      'Abs of the product of a real and a complex operand',
      fn([typed('z', 'complex'), typed('x', 'real')], declare('t', 'real', 0), ['Abs', ['Multiply', 'x', 'z']]),
      /Abs of the complex operand .* is in the structured route only when the operand is a name/,
    ],
  ];
  test.each(refusals)('%s', (_name, json, reason) => {
    expect(() => structured().prepareStructured(engine().expr(json), OPTIONS)).toThrow(reason);
  });

  // The existing compiler rewrites or declines a rounding function whose
  // operand adds integer variables to an exact constant that no double
  // holds (`jumpShiftRewrite()`); the structured route declines it.
  test.each([
    ['Floor(k + 2/3)', ['Floor', ['Add', 'k', ['Rational', 2, 3]]], '2/3'],
    ['Floor(k/3 + 1/7)', ['Floor', ['Add', ['Divide', 'k', 3], ['Rational', 1, 7]]], '1/7'],
  ] as [string, MathJsonExpression, string][])('%s', (_name, body, constant) => {
    const json = fn([typed('k', 'integer')], declare('t', 'real', 0), body);
    expect(() => structured().prepareStructured(engine().expr(json), OPTIONS)).toThrow(
      new RegExp(`Floor of an operand with the exact constant ${constant}, which no double holds exactly`)
    );
  });

  test('Floor of a rational factor or of a quotient by an integer capture stays admitted', () => {
    const ce = engine();
    ce.declare('N', 'integer');
    ce.assign('N', 7);
    for (const body of [
      ['Floor', ['Divide', 'k', 49]],
      ['Floor', ['Divide', ['Multiply', 29, 'k'], 50]],
      ['Floor', ['Divide', ['Add', 'k', -1], 'N']],
    ] as MathJsonExpression[]) {
      const json = fn([typed('k', 'integer')], declare('t', 'real', 0), body);
      const result = structured().compile(ce.expr(json), OPTIONS);
      const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
      for (const k of [0, 1, 7, 8, 49, 50, 98, 100, 2 ** 52, -50]) {
        expect([body, k, run(result, [k])]).toEqual([body, k, run(existing, [k])]);
        expect([body, k, run(result, [k])]).toEqual([body, k, interpret(ce, json, [k])]);
      }
    }
  });

  // The emitter writes the value of a capture as a number literal, so a
  // rational or float capture under `Floor` would be a rounded double:
  // `Floor(C * k)` with `C = 1/49` would give 0 at `k = 49`, where the value
  // is 1. Only a rational literal is written as a division.
  test.each([
    ['a rational capture as a factor', { re: [1, 49] }, ['Floor', ['Multiply', 'C', 'k']]],
    ['a float capture as a term', { re: 0.9 }, ['Floor', ['Add', 'k', 'C']]],
  ] as [string, { re: number | [number, number] }, MathJsonExpression][])(
    'Floor with %s is refused',
    (_name, value, body) => {
      const ce = engine();
      ce.declare('C', 'real');
      ce.assign(
        'C',
        Array.isArray(value.re) ? ce.expr(['Rational', ...value.re]) : value.re
      );
      const json = fn([typed('k', 'integer')], declare('t', 'real', 0), body);
      expect(() => structured().prepareStructured(ce.expr(json), OPTIONS)).toThrow(
        /inexact-jump-operand/
      );
    }
  );

  test('a Range that is a user function', () => {
    const ce = engine();
    ce.declare('Range', '(integer, integer) -> list<integer>');
    ce.assign('Range', ce.expr(['Function', ['List', 'a', 'b'], typed('a', 'integer'), typed('b', 'integer')]));
    const json = fn(N, declare('s', 'real', 0), loop(['Assign', 's', ['Add', 's', 'k']], 'k', 1, 'n'), 's');
    expect(() => structured().prepareStructured(ce.expr(json), OPTIONS)).toThrow(
      /admits a Loop only over Element\(k, Range\(a, b\)\), with no step and no guard, and not over Element\(k, Range\(1, n\)\)/
    );
  });

  test('a loop outside the body of a root Function', () => {
    const ce = engine();
    ce.declare('n', 'integer');
    expect(() =>
      structured().prepareStructured(ce.expr(loop(['Add', 'k', 1], 'k', 1, 'n')), OPTIONS)
    ).toThrow(/admits a Loop only as a statement of the body of a root Function/);
  });
});

//
// Rational factors and literals
//

describe('rational literals, against the interpreter and the existing emitter', () => {
  // The existing emitter writes a product with an exact rational factor
  // `p/q` (`q` not a power of two) as `x / q * p`, and a rational literal
  // elsewhere as its double. Both routes must give the same doubles.
  const PARAMETERS = [typed('k', 'integer'), typed('x', 'real')];
  const CASES: [string, MathJsonExpression, string][] = [
    ['Floor(k/49)', ['Floor', ['Divide', 'k', 49]], 'Math.floor(k / 49)'],
    ['Floor(29k/50)', ['Floor', ['Divide', ['Multiply', 29, 'k'], 50]], 'Math.floor(k / 50 * 29)'],
    ['x/3', ['Divide', 'x', 3], 'x / 3'],
    ['2x/3', ['Divide', ['Multiply', 2, 'x'], 3], 'x / 3 * 2'],
    ['-x/3', ['Negate', ['Divide', 'x', 3]], '-(x / 3)'],
    ['-2kx/7', ['Multiply', ['Rational', -2, 7], 'k', 'x'], 'k * x / 7 * -2'],
    ['x/2', ['Divide', 'x', 2], '0.5 * x'],
    ['x + 1/3', ['Add', 'x', ['Rational', 1, 3]], 'x + 0.3333333333333333'],
  ];
  const INPUTS: Value[][] = [
    [49, 3],
    [98, 1.5],
    [100, -0.75],
    [147, 0.3333333333333333],
    [-49, 1 / 3 + 2 ** -54],
    [0, 7],
  ];
  test.each(CASES)('%s', (_name, body, text) => {
    const ce = engine();
    const json = fn(PARAMETERS, declare('t', 'real', 0), body);
    const result = structured().compile(ce.expr(json), OPTIONS);
    expect(result.code).toContain(text);
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    for (const inputs of INPUTS) {
      const value = run(result, inputs);
      expect([inputs, value]).toEqual([inputs, run(existing, inputs)]);
      expect([inputs, close(value, interpret(ce, json, inputs))]).toEqual([inputs, true]);
    }
  });

  test('Floor(k/49) is 1 at k = 49, and Floor(29n/50) is 58 at n = 100', () => {
    const ce = engine();
    const a = structured().compile(ce.expr(fn([typed('k', 'integer')], declare('t', 'real', 0), ['Floor', ['Divide', 'k', 49]])), OPTIONS);
    expect([49, 98, 147, 48].map((k) => run(a, [k]))).toEqual([1, 2, 3, 0]);
    const b = structured().compile(
      ce.expr(fn([typed('n', 'integer')], declare('t', 'real', 0), ['Floor', ['Divide', ['Multiply', 29, 'n'], 50]])),
      OPTIONS
    );
    expect(run(b, [100])).toBe(58);
  });

  test('a comparison with a rational literal reads its double, as the existing emitter', () => {
    const ce = engine();
    const json = fn([typed('x', 'real')], declare('t', 'real', 0), ['Less', 'x', ['Rational', 1, 3]]);
    const result = structured().compile(ce.expr(json), OPTIONS);
    expect(result.code).toContain('x < 0.3333333333333333');
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    for (const x of [0.25, 0.3333333333333333, 1 / 3 + 2 ** -54, 0.5]) {
      expect([x, run(result, [x])]).toEqual([x, run(existing, [x])]);
      expect([x, run(result, [x])]).toEqual([x, interpret(ce, json, [x])]);
    }
  });
});

//
// Integer locals
//

describe('integer locals', () => {
  test('an integer let local is an integer; a let local written with a real is real', () => {
    const integer = loopsOf(lower(fixture('an integer let local as the bound of a loop')).root)[0];
    expect(integer.operands[1].type).toBe('integer');
    const real = loopsOf(lower(fixture('a let local written with a real after an integer')).root)[0];
    expect(real.body.parameters![1].type).toBe('real');
  });

  test('a helper with integer parameters called with a Mod local and a Floor local', () => {
    const ce = engine();
    ce.declare('cell', '(integer, integer) -> integer');
    ce.assign(
      'cell',
      ce.expr(['Function', ['Add', 'c', ['Multiply', 10, 'r']], typed('c', 'integer'), typed('r', 'integer')])
    );
    const json = fn(
      N,
      declare('s', 'real', 0),
      loop(
        [
          'Block',
          letLocal('c', ['Mod', ['Add', 'k', -1], 4]),
          letLocal('r', ['Floor', ['Divide', ['Add', 'k', -1], 4]]),
          ['Assign', 's', ['Add', ['Multiply', 's', 3], ['cell', 'c', 'r']]],
        ],
        'k',
        1,
        'n'
      ),
      's'
    );
    const expr = ce.expr(json);
    const result = structured().compile(expr, OPTIONS);
    for (const n of [0, 1, 9, 16, -3]) {
      const value = run(result, [n]);
      expect([n, close(value, interpret(ce, json, [n]))]).toEqual([n, true]);
    }
  });

  // The admission refuses the write before the walk of `Assign` runs. No
  // program reaches the refusal of that walk (a real fact written to a
  // `let` local that the engine infers `integer`): on the structured route,
  // each node whose engine type is `integer` has an integer fact (the
  // signatures read the engine type, `Mod`, `Floor` and `Power` of integers
  // are integers, and a quotient or a product by a rational factor is not
  // typed `integer` by the engine), so the engine infers `real` for a
  // local that is written with a real fact.
  test('the admission refuses a real value written to a local declared integer', () => {
    const json = fn(NX, declare('c', 'integer', 0), loop(['Assign', 'c', ['Add', 'c', 'x']], 'k', 1, 'n'), 'c');
    expect(() => structured().prepareStructured(engine().expr(json), OPTIONS)).toThrow(
      /a value written to the integer local c does not have the type integer/
    );
  });
});

//
// The existing readers are not called from preparation to emission
//

describe('the existing readers are not called from preparation to emission', () => {
  const READERS: [object, string][] = [
    [core, 'isComplexValued'],
    [core, 'staticTypeOf'],
    [core, 'userFunctionParamLanes'],
    [core, 'compile'],
    [BaseCompiler, 'compileCseRoot'],
  ];
  const PROGRAMS: [string, Value[]][] = [
    ['nested loops: the inner one carries a local of the outer body', [4]],
    ['z := z^2 + c with a fixed count', [{ re: 0.25, im: 0.5 }]],
    ['Mod and Floor with negative operands', [2, 2.5]],
  ];
  for (const mode of MODES)
    test(`${mode} mode: the readers throw, and the loop programs compile and run`, () => {
      for (const [name, inputs] of PROGRAMS) {
        const ce = engine();
        const json = fixture(name);
        const phases: StructuredPhase[] = [];
        const onPhase = (phase: StructuredPhase) => {
          phases.push(phase);
          if (phase === 'preparation')
            for (const [object, reader] of READERS)
              jest.spyOn(object as never, reader as never).mockImplementation((() => {
                throw new Error(`${reader} called from preparation to emission`);
              }) as never);
          if (phase === 'emission') jest.restoreAllMocks();
        };
        let result: CompilationResult<'javascript'>;
        try {
          result = structured({ onPhase }).compile(ce.expr(json), { ...OPTIONS, mode });
        } finally {
          jest.restoreAllMocks();
        }
        expect(phases).toEqual(['preparation', 'annotation', 'lowering', 'verification', 'emission', 'assembly']);
        expect(close(run(result, inputs), interpret(ce, json, inputs))).toBe(true);
      }
    });
});
