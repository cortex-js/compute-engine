import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { CompilerState } from '../../src/compute-engine/compilation/compiler-state';
import { createSysRuntime } from '../../src/compute-engine/compilation/javascript-runtime';
import { emitStructuredProgram } from '../../src/compute-engine/compilation/javascript-structured-emit';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram as verifyProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import type {
  IROperation,
  IRProgram,
  IRRegion,
  IRValue,
  ScalarKind,
} from '../../src/compute-engine/compilation/structured-ir';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import type { FragmentScope } from '../../src/compute-engine/compilation/fragment';
import type {
  CompilationOptions,
  CompilationResult,
} from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Step 5, second change, of docs/plans/2026-11-09-js-compiler-status-and-plan.md,
// on the structured route of the internal JavaScript fragment target: `Sqrt`
// with its real or complex result decided from facts, helpers that call
// helpers, and captured values read as snapshots.

const typed = (name: string, type: string): MathJsonExpression => ['Typed', name, `'${type}'`];

const OPTIONS = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];

function install(
  ce: ComputeEngine,
  name: string,
  signature: string,
  body: MathJsonExpression,
  parameters: MathJsonExpression[]
) {
  ce.declare(name, signature);
  ce.assign(name, ce.expr(['Function', body, ...parameters]));
}

/** An engine with the inputs, the helpers and the captured bindings of the
 *  programs below. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of [
    ['x', 'real'],
    ['y', 'real'],
    ['z', 'complex'],
    ['C', 'boolean'],
    ['k', 'integer'],
    ['p', 'real<0..>'],
    ['n', 'real<..-1>'],
  ])
    ce.declare(name, type);
  // `a` and `b` have the sign of an assumption.
  ce.declare('a', 'real');
  ce.assume(ce.parse('a > 0'));
  ce.declare('b', 'real');
  ce.assume(ce.parse('b < 0'));
  // Captured bindings.
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  ce.declare('drop', 'real');
  ce.assign('drop', -3);
  ce.declare('count', 'integer');
  ce.assign('count', 4);
  // Helpers. `sq` is called from `up` and `down`; `g` reads `offset`; `h`
  // calls `g`; `cs` has a square root and a complex result.
  install(ce, 'sq', '(real) -> real', ['Multiply', 't', 't'], [typed('t', 'real')]);
  install(ce, 'up', '(real) -> real', ['Add', ['sq', 'u'], 1], [typed('u', 'real')]);
  install(ce, 'down', '(real) -> real', ['Negate', ['sq', 'v']], [typed('v', 'real')]);
  install(ce, 'g', '(real) -> real', ['Add', 'u', 'offset'], [typed('u', 'real')]);
  install(ce, 'h', '(real) -> real', ['Multiply', 2, ['g', 'v']], [typed('v', 'real')]);
  install(ce, 'cs', '(real) -> complex', ['Sqrt', 'u'], [typed('u', 'real')]);
  install(ce, 'ident', '(boolean) -> boolean', 'q', [typed('q', 'boolean')]);
  install(ce, 'twice', '(real) -> real', ['Add', ['h', 'w'], ['g', 'w']], [typed('w', 'real')]);
  // Recursion, direct and through another helper.
  install(ce, 'r1', '(real) -> real', ['r1', 'v'], [typed('v', 'real')]);
  ce.declare('ra', '(real) -> real');
  ce.declare('rb', '(real) -> real');
  ce.assign('ra', ce.expr(['Function', ['rb', 'v'], typed('v', 'real')]));
  ce.assign('rb', ce.expr(['Function', ['ra', 'v'], typed('v', 'real')]));
  // `console` is an impurity label: the definition states an effect.
  ce.declare('Trace', {
    signature: '(real) -> real',
    effects: ['console'],
    evaluate: (ops) => ops[0],
  } as never);
  install(ce, 'traced', '(real) -> real', ['Trace', 'u'], [typed('u', 'real')]);
  install(ce, 'outer', '(real) -> real', ['Add', ['traced', 'u'], 1], [typed('u', 'real')]);
  return ce;
}

const TESTS = new Map([['Trace', 'trace']]);
const TRACE_SOURCE = (id: string, operands: readonly string[]) =>
  `globalThis.__ceTrace(${JSON.stringify(id)}, ${operands.join(', ')})`;
const structured = (hooks = {}) =>
  new ScalarFragmentJavaScriptTarget('structured', TESTS, { trace: TRACE_SOURCE, ...hooks });

type Value = number | boolean | { re: number; im: number };
type Inputs = Record<string, Value> | Value[];

function run(result: CompilationResult<'javascript'>, inputs: Inputs): unknown {
  return Array.isArray(inputs)
    ? (result.run as unknown as (...a: unknown[]) => unknown)(...inputs)
    : result.run!(inputs as never);
}

function boxValue(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of `expr` on `inputs` by the interpreter. */
function interpret(ce: ComputeEngine, expr: Expression, inputs: Inputs): unknown {
  const value = Array.isArray(inputs)
    ? ce.function('Apply', [expr, ...inputs.map((v) => boxValue(ce, v))]).evaluate()
    : expr
        .subs(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, boxValue(ce, v)])))
        .evaluate();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  const n = value.N();
  if (n.im === 0) return n.re;
  return { re: n.re, im: n.im };
}

/** `a` and `b` are the same value, a complex value with an imaginary part
 *  of 0 equal to the number of its real part, within `1e-12` relative. An
 *  infinite part equals only the same infinity. */
function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  const pair = (v: unknown) =>
    typeof v === 'number' ? { re: v, im: 0 } : (v as { re: number; im: number });
  const p = pair(a);
  const q = pair(b);
  const near = (u: number, v: number) =>
    (Number.isNaN(u) && Number.isNaN(v)) ||
    u === v ||
    (Number.isFinite(u) &&
      Number.isFinite(v) &&
      Math.abs(u - v) <= 1e-12 * Math.max(1, Math.abs(u), Math.abs(v)));
  return near(p.re, q.re) && near(p.im, q.im);
}

/** `a` and `b` are the same value, exactly: `Object.is` per number and per
 *  component of a complex value (`NaN` equals `NaN`, `0` differs from
 *  `-0`). The structured route and the existing emitter are compared so;
 *  `close()` is for the interpreter only. */
function exact(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null)
    return (
      Object.is((a as { re: number }).re, (b as { re: number }).re) &&
      Object.is((a as { im: number }).im, (b as { im: number }).im)
    );
  return Object.is(a, b);
}

test('control: the comparator of values', () => {
  expect(close(1, 1 + 1e-14)).toBe(true);
  expect(close(1, 1.001)).toBe(false);
  expect(close(1e300, Infinity)).toBe(false);
  expect(close(Infinity, 5)).toBe(false);
  expect(close(Infinity, -Infinity)).toBe(false);
  expect(close(Infinity, Infinity)).toBe(true);
  expect(close(-Infinity, -Infinity)).toBe(true);
  expect(close({ re: 1, im: Infinity }, { re: 1, im: 2 })).toBe(false);
  expect(close(NaN, NaN)).toBe(true);
  expect(close(NaN, 1)).toBe(false);
});

/** The value is not a real number: complex with a nonzero imaginary part. */
const nonReal = (v: unknown) =>
  typeof v === 'object' && v !== null && (v as { im: number }).im !== 0;

type Program = {
  name: string;
  json: MathJsonExpression;
  /** The input values. A root `Function` takes an array. */
  inputs: Inputs[];
  structural?: boolean;
};

const X = [-4, 0, 2.25, 9];
const xs = (extra: Record<string, Value> = {}) => X.map((x) => ({ x, ...extra }));

//
// Part 1: Sqrt
//

const SQRT_PROGRAMS: Program[] = [
  // The programs of compile-javascript-fragment.test.ts with a square root.
  // `Sqrt(-4)` is the literal `2i` in the canonical form: its structural
  // form is below.
  { name: 'Sqrt(x)', json: ['Sqrt', 'x'], inputs: xs() },
  { name: 'Sqrt(z)', json: ['Sqrt', 'z'], inputs: [{ z: { re: 3, im: 4 } }, { z: { re: -4, im: 0 } }] },
  { name: 'If(C, Sqrt(x), -z)', json: ['If', 'C', ['Sqrt', 'x'], ['Negate', 'z']], inputs: [true, false].flatMap((C) => xs({ C, z: { re: 3, im: 4 } })) },
  { name: 'Sqrt(x) + Sqrt(y)', json: ['Add', ['Sqrt', 'x'], ['Sqrt', 'y']], inputs: xs({ y: 4 }) },
  {
    name: 'Sqrt(x) + Sqrt(Sqrt(x) + y)',
    json: ['Add', ['Sqrt', 'x'], ['Sqrt', ['Add', ['Sqrt', 'x'], 'y']]],
    inputs: xs({ y: 4 }),
  },
  { name: 'structural Sqrt(-4)', json: ['Sqrt', -4], inputs: [{}], structural: true },
  // Ranged inputs, literals and assumptions.
  { name: 'Sqrt(p), p: real<0..>', json: ['Sqrt', 'p'], inputs: [{ p: 0 }, { p: 6.25 }] },
  { name: 'Sqrt(n), n: real<..-1>', json: ['Sqrt', 'n'], inputs: [{ n: -1 }, { n: -6.25 }] },
  { name: 'Sqrt(p + 1)', json: ['Sqrt', ['Add', 'p', 1]], inputs: [{ p: 0 }, { p: 3 }] },
  { name: 'Sqrt(2p)', json: ['Sqrt', ['Multiply', 2, 'p']], inputs: [{ p: 0 }, { p: 8 }] },
  { name: 'Sqrt(Max(0, x))', json: ['Sqrt', ['Max', 0, 'x']], inputs: xs() },
  { name: 'Sqrt(Min(p, 3))', json: ['Sqrt', ['Min', 'p', 3]], inputs: [{ p: 1 }, { p: 9 }] },
  { name: 'Sqrt(-p)', json: ['Sqrt', ['Negate', 'p']], inputs: [{ p: 0 }, { p: 4 }] },
  { name: 'Sqrt(-n)', json: ['Sqrt', ['Negate', 'n']], inputs: [{ n: -1 }, { n: -4 }] },
  { name: 'Sqrt(k), k: integer', json: ['Sqrt', 'k'], inputs: [{ k: -4 }, { k: 0 }, { k: 9 }] },
  { name: 'Sqrt(2)', json: ['Sqrt', 2], inputs: [{}] },
  { name: 'Sqrt(-2)', json: ['Sqrt', -2], inputs: [{}] },
  { name: 'x + Sqrt(-2.5)', json: ['Add', 'x', ['Sqrt', -2.5]], inputs: xs() },
  { name: 'Sqrt(a), a > 0', json: ['Sqrt', 'a'], inputs: [{ a: 4 }] },
  { name: 'Sqrt(b), b < 0', json: ['Sqrt', 'b'], inputs: [{ b: -4 }] },
  // Nested square roots, and square roots under an If.
  { name: 'Sqrt(Sqrt(x))', json: ['Sqrt', ['Sqrt', 'x']], inputs: xs() },
  { name: 'Sqrt(Sqrt(p))', json: ['Sqrt', ['Sqrt', 'p']], inputs: [{ p: 16 }] },
  { name: 'Sqrt(Sqrt(p) + 1)', json: ['Sqrt', ['Add', ['Sqrt', 'p'], 1]], inputs: [{ p: 9 }] },
  { name: 'If(C, Sqrt(x), Sqrt(p))', json: ['If', 'C', ['Sqrt', 'x'], ['Sqrt', 'p']], inputs: [true, false].flatMap((C) => xs({ C, p: 4 })) },
  { name: 'If(C, Sqrt(x), 1) + y', json: ['Add', ['If', 'C', ['Sqrt', 'x'], 1], 'y'], inputs: [true, false].flatMap((C) => xs({ C, y: 1 })) },
  // Captured bindings, a local, a helper.
  { name: 'Sqrt(offset), offset = 2', json: ['Sqrt', 'offset'], inputs: [{}] },
  { name: 'x + Sqrt(drop), drop = -3', json: ['Add', 'x', ['Sqrt', 'drop']], inputs: xs() },
  { name: 'Sqrt(count), count = 4', json: ['Sqrt', 'count'], inputs: [{}] },
  {
    name: 'Sqrt of a local after a write',
    json: ['Function', ['Block', ['Declare', 'q', "'real'", 'x'], ['Assign', 'q', ['Negate', 'q']], ['Sqrt', 'q']], typed('x', 'real')],
    inputs: X.map((x) => [x]),
  },
  { name: 'cs(x), (real) -> complex', json: ['cs', 'x'], inputs: xs() },
  // Closed nodes with a complex fact, which the existing route refuses
  // (`refuseClosedComplex()`, because its constant folding writes a real
  // literal for them): the structured route has no folding and admits them.
  { name: 'Negate(Sqrt(-2))', json: ['Negate', ['Sqrt', -2]], inputs: [{}] },
  { name: 'Sqrt(-2) + -Sqrt(-2)', json: ['Add', ['Sqrt', -2], ['Negate', ['Sqrt', -2]]], inputs: [{}] },
  { name: 'x + If(ident(True), 1, Sqrt(-2))', json: ['Add', 'x', ['If', ['ident', 'True'], 1, ['Sqrt', -2]]], inputs: xs() },
];

/** The value facts of every `Sqrt` node of the annotation of `expr` on the
 *  structured route: true for a complex fact. */
function sqrtFacts(expr: Expression, mode: Mode): Map<Expression, boolean> {
  const preparation = structured().prepareStructured(expr, { ...OPTIONS, mode });
  const result = new Map<Expression, boolean>();
  const visit = (scope: FragmentScope<string>) => {
    for (const [node, facts] of scope.facts)
      if (isFunction(node, 'Sqrt') && 'representation' in facts)
        result.set(node, facts.representation === 'complex');
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(preparation.annotation.scope as FragmentScope<string>);
  for (const fn of preparation.annotation.functions.values()) visit(fn.scope as FragmentScope<string>);
  return result;
}

/** The answers of `isComplexValued()` for each node that the ordinary
 *  JavaScript compiler asks about while it compiles `expr`. */
function ordinaryAnswers(expr: Expression, options: CompilationOptions<Expression>) {
  const answers = new Map<Expression, Set<boolean>>();
  const reader = core.isComplexValued;
  const record = (node: Expression, answer: boolean) => {
    if (CompilerState._compileDepth === 0) return;
    const set = answers.get(node) ?? new Set<boolean>();
    set.add(answer);
    answers.set(node, set);
  };
  jest.spyOn(core, 'isComplexValued').mockImplementation((node) => {
    const answer = reader(node);
    record(node, answer);
    return answer;
  });
  const emit = core.compileWithCse;
  jest.spyOn(core, 'compileWithCse').mockImplementation((node, target, prec) => {
    record(node, reader(node));
    return emit(node, target, prec);
  });
  try {
    compile(expr, options);
  } finally {
    jest.restoreAllMocks();
  }
  return answers;
}

const make = (ce: ComputeEngine, program: Program) =>
  ce.expr(program.json, program.structural ? { form: 'structural' } : undefined);

describe('Sqrt', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of SQRT_PROGRAMS)
        test(program.name, () => {
          const ce = engine();
          const expr = make(ce, program);
          let result: CompilationResult<'javascript'>;
          try {
            result = structured().compile(expr, { ...OPTIONS, mode });
          } catch (e) {
            // A decline: listed in the comparison test below.
            expect(DECLINED.has(`${program.name} (${mode})`)).toBe(true);
            expect((e as Error).message).toMatch(/^JS scalar fragment: /);
            return;
          }
          expect(DECLINED.has(`${program.name} (${mode})`)).toBe(false);
          const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
          for (const inputs of program.inputs) {
            const value = run(result, inputs);
            const expected = interpret(ce, expr, inputs);
            // The `strict` mode gives NaN where the exact value is not real
            // ("NaN for a complex value on the real lane",
            // docs/COMPILATION-MODEL.md).
            const agrees =
              close(value, expected) ||
              (mode === 'strict' && Number.isNaN(value) && nonReal(expected));
            expect([inputs, value, expected, agrees]).toEqual([inputs, value, expected, true]);
            const other = run(existing, inputs);
            expect([inputs, value, other, exact(value, other)]).toEqual([inputs, value, other, true]);
          }
        });
    });

  test('the facts of the rule equal isComplexValued(), or the program declines', () => {
    const differences: string[] = [];
    const declines: string[] = [];
    let compared = 0;
    for (const mode of MODES)
      for (const program of SQRT_PROGRAMS) {
        const ce = engine();
        const expr = make(ce, program);
        let facts: Map<Expression, boolean>;
        try {
          facts = sqrtFacts(expr, mode);
        } catch {
          declines.push(`${program.name} (${mode})`);
          continue;
        }
        const answers = ordinaryAnswers(expr, { ...OPTIONS, mode, fallback: false });
        for (const [node, complex] of facts) {
          const answer = answers.get(node);
          const where = `${program.name} (${mode}): ${node.toString()}`;
          if (answer === undefined) {
            differences.push(`${where}: not asked`);
            continue;
          }
          compared += 1;
          if (answer.size !== 1 || !answer.has(complex))
            differences.push(`${where}: fact ${complex}, isComplexValued ${[...answer].join('/')}`);
        }
      }
    expect(differences).toEqual([]);
    expect(declines).toEqual([...DECLINED]);
    expect(compared).toBeGreaterThan(50);
  });
});

/** The programs that the structured route declines, each with its mode. */
const DECLINED = new Set<string>([
  // The square root of a real helper parameter is real in the `strict`
  // mode, and the declared result of `cs` is complex.
  'cs(x), (real) -> complex (strict)',
  // The engine proves `-n` non-negative (its type is `real<1..>`); the rule
  // of Sqrt does not model `Negate`. In the `strict` mode only a negative
  // operand changes the result, so the program compiles there.
  'Sqrt(-n) (complex)',
]);

//
// Part 2: helpers
//

const HELPER_PROGRAMS: Program[] = [
  { name: 'sq called from up and down', json: ['Add', ['up', 'x'], ['down', 'y']], inputs: [{ x: 3, y: 2 }, { x: -1.5, y: 0 }] },
  { name: 'a chain: h calls g', json: ['h', 'x'], inputs: xs() },
  { name: 'twice calls h and g; h calls g', json: ['twice', 'x'], inputs: xs() },
  { name: 'helpers in both branches of an If', json: ['If', 'C', ['up', 'x'], ['h', 'x']], inputs: [true, false].flatMap((C) => xs({ C })) },
  {
    name: 'a helper call in a bound body with a local',
    json: ['Function', ['Block', ['Declare', 's', "'real'", ['up', 'x']], ['Assign', 's', ['Add', 's', ['down', 'x']]], 's'], typed('x', 'real')],
    inputs: X.map((x) => [x]),
  },
  // The programs of compile-javascript-fragment-calls.test.ts.
  { name: 'four-input helper', json: ['neighborSum', 'x', 'y', 'p', 'k'], inputs: [{ x: 1, y: 2, p: 3, k: 4 }] },
];

function withCallsFixtures(ce: ComputeEngine): ComputeEngine {
  install(ce, 'neighborSum', '(real, real, real, real) -> real', ['Add', 'a1', 'b1', 'c1', 'd1'],
    ['a1', 'b1', 'c1', 'd1'].map((name) => typed(name, 'real')));
  return ce;
}

describe('helpers', () => {
  for (const mode of MODES)
    for (const program of HELPER_PROGRAMS)
      test(`${program.name} (${mode})`, () => {
        const ce = withCallsFixtures(engine());
        const expr = make(ce, program);
        const result = structured().compile(expr, { ...OPTIONS, mode });
        const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
        for (const inputs of program.inputs) {
          const value = run(result, inputs);
          expect([inputs, close(value, interpret(ce, expr, inputs))]).toEqual([inputs, true]);
          expect([inputs, value]).toEqual([inputs, run(existing, inputs)]);
        }
      });

  test('each helper is lowered once, also when two helpers call it', () => {
    const ce = engine();
    const preparation = structured().prepareStructured(
      ce.expr(['Add', ['up', 'x'], ['down', 'y'], ['up', 'y']]),
      OPTIONS
    );
    const program = lowerStructuredFragment(preparation);
    // A called helper comes before its caller.
    expect(program.functions.map((f) => f.name)).toEqual(['sq', 'up', 'down']);
    const calls: string[] = [];
    const visit = (region: IRRegion) => {
      for (const op of region.operations)
        if (op.kind === 'call') calls.push(program.functions[op.function].name);
    };
    for (const fn of program.functions) visit(fn.body);
    visit(program.root);
    expect(calls.sort()).toEqual(['down', 'sq', 'sq', 'up', 'up']);
    const code = structured().compile(ce.expr(['Add', ['up', 'x'], ['down', 'y']]), OPTIONS);
    expect((code.preamble ?? '').match(/function /g)).toHaveLength(3);
  });

  test('the effect of a call is the effect of the functions it reaches', () => {
    const ce = engine();
    const program = lowerStructuredFragment(
      structured().prepareStructured(ce.expr(['Add', ['outer', 'x'], 1]), OPTIONS)
    );
    expect(program.functions.map((f) => [f.name, f.body.effect])).toEqual([
      ['traced', 'effectful'],
      ['outer', 'effectful'],
    ]);
    const call = program.root.operations.find((op) => op.kind === 'call')!;
    expect(call.effect).toBe('effectful');
    expect(program.root.effect).toBe('effectful');
    // The trace runs once per evaluation.
    const traces: string[] = [];
    (globalThis as Record<string, unknown>).__ceTrace = (id: string, v: number) => {
      traces.push(`${id}(${v})`);
      return v;
    };
    try {
      const result = structured().compile(ce.expr(['Add', ['outer', 'x'], 1]), OPTIONS);
      expect(result.run!({ x: 3 })).toBe(5);
      expect(traces).toEqual(['trace(3)']);
    } finally {
      delete (globalThis as Record<string, unknown>).__ceTrace;
    }
  });

  test.each([
    ['direct recursion', ['r1', 'x']],
    ['recursion through another helper', ['ra', 'x']],
  ] as [string, MathJsonExpression][])('%s is refused at admission', (_name, json) => {
    expect(() => structured().compile(engine().expr(json), OPTIONS)).toThrow(
      /calls itself, directly or through another helper: the structured route has no recursion/
    );
  });
});

//
// Part 3: captures
//

describe('captures', () => {
  const CAPTURE_PROGRAMS: Program[] = [
    { name: 'a capture in the root and in a helper', json: ['Add', 'offset', ['g', 'x']], inputs: xs() },
    { name: 'two bindings', json: ['Add', 'offset', ['Multiply', 'drop', 'x']], inputs: xs() },
    { name: 'an integer capture', json: ['Add', 'x', 'count'], inputs: xs() },
    { name: 'a capture in a chain of helpers', json: ['twice', 'x'], inputs: xs() },
    {
      name: 'a capture in a bound body',
      json: ['Function', ['Block', ['Declare', 's', "'real'", 'offset'], ['If', ['Less', 'x', 0], ['Assign', 's', ['Add', 's', 'drop']]], ['Multiply', 's', 'x']], typed('x', 'real')],
      inputs: X.map((x) => [x]),
    },
  ];
  for (const mode of MODES)
    for (const program of CAPTURE_PROGRAMS)
      test(`${program.name} (${mode})`, () => {
        const ce = engine();
        const expr = make(ce, program);
        const result = structured().compile(expr, { ...OPTIONS, mode });
        const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
        for (const inputs of program.inputs) {
          const value = run(result, inputs);
          expect([inputs, close(value, interpret(ce, expr, inputs))]).toEqual([inputs, true]);
          expect([inputs, value]).toEqual([inputs, run(existing, inputs)]);
        }
      });

  test('the program lists one capture per binding; each read names it', () => {
    const ce = engine();
    const program = lowerStructuredFragment(
      structured().prepareStructured(ce.expr(['Add', 'offset', ['g', 'x'], ['h', 'y']]), OPTIONS)
    );
    expect(program.captures.map((c) => [c.name, c.snapshot, c.type, c.representation])).toEqual([
      ['offset', 2, 'integer', 'number'],
    ]);
    const binding = ce.expr('offset').valueDefinition;
    expect(program.captures[0].binding).toBe(binding);
    const reads: IROperation[] = [];
    const visit = (region: IRRegion) => {
      for (const op of region.operations) if (op.kind === 'capture') reads.push(op);
    };
    for (const fn of program.functions) visit(fn.body);
    visit(program.root);
    expect(reads).toHaveLength(2);
    for (const read of reads)
      expect(read).toMatchObject({ capture: 0, binding, snapshot: 2, effect: 'pure' });
    // The snapshot is written as a literal.
    const result = structured().compile(ce.expr(['g', 'x']), OPTIONS);
    expect(result.preamble).toMatch(/function (\w+)\((\w+)\) \{ return 2 \+ \2; \}/);
  });

  test('a change of the binding after compilation: the old code keeps the snapshot, a new compilation reads the new value', () => {
    const ce = engine();
    // The existing route captures in a helper only.
    const expr = ce.expr(['Add', ['g', 'x'], 1]);
    const depsStructured = new Set<string>();
    const depsExisting = new Set<string>();
    const old = structured().compile(expr, { ...OPTIONS, symbolDeps: depsStructured });
    const legacy = new ScalarFragmentJavaScriptTarget().compile(expr, { ...OPTIONS, symbolDeps: depsExisting });
    // The result records the dependency on the binding and on the helper,
    // as the existing route does.
    expect([...depsStructured].sort()).toEqual([...depsExisting].sort());
    expect(depsStructured).toEqual(new Set(['offset', 'g']));
    const root = structured().compile(ce.expr(['Add', 'offset', 'x']), OPTIONS);
    expect(old.run!({ x: 1 })).toBe(4);
    expect(root.run!({ x: 1 })).toBe(3);
    ce.assign('offset', 7);
    expect(old.run!({ x: 1 })).toBe(4);
    expect(legacy.run!({ x: 1 })).toBe(4);
    expect(root.run!({ x: 1 })).toBe(3);
    const fresh = structured().compile(expr, OPTIONS);
    expect(fresh.run!({ x: 1 })).toBe(9);
    expect(structured().compile(ce.expr(['Add', 'offset', 'x']), OPTIONS).run!({ x: 1 })).toBe(8);
    expect(fresh.run!({ x: 1 })).toBe(compile(expr, { ...OPTIONS, fallback: false }).run!({ x: 1 }));
  });

  test('a change of the binding between preparation and emission fails closed', () => {
    const ce = engine();
    class Changed extends ScalarFragmentJavaScriptTarget {
      protected prepareCompilation(expr: Expression, options: CompilationOptions<Expression>, batch?: unknown) {
        const prepared = super.prepareCompilation(expr, options, batch);
        ce.assign('offset', 7);
        return prepared;
      }
    }
    expect(() => new Changed('structured').compile(ce.expr(['Add', 'offset', 'x']), OPTIONS)).toThrow(
      /different captured binding or value/
    );
  });

  test('a binding with the same name in another scope is refused', () => {
    const ce = engine();
    const inHelper = ce.expr(['g', 'x']);
    const inRoot = ce.expr(['Add', 'offset', 'x']);
    ce.pushScope();
    try {
      ce.declare('offset', 'real');
      ce.assign('offset', 99);
      expect(() => structured().compile(inHelper, OPTIONS)).toThrow(/unsupported helper capture offset/);
      expect(() => structured().compile(inRoot, OPTIONS)).toThrow(/unsupported binding offset/);
    } finally {
      ce.popScope();
    }
    // Control: without the inner binding, both compile.
    expect(structured().compile(inHelper, OPTIONS).run!({ x: 1 })).toBe(3);
    expect(structured().compile(inRoot, OPTIONS).run!({ x: 1 })).toBe(3);
  });

  test('the fixtures of compile-javascript-fragment-captures.test.ts', () => {
    for (const mode of MODES) {
      const ce = engine();
      ce.declare('flag', 'boolean');
      ce.declare('off', 'real');
      ce.assign('off', -2.5);
      install(ce, 'branchy', '(boolean, real) -> real',
        ['If', 'b', ['Add', 'off', 'u'], ['Negate', ['Add', 'u', 'off']]],
        [typed('b', 'boolean'), typed('u', 'real')]);
      const result = structured().compile(ce.expr(['branchy', 'flag', 'x']), { ...OPTIONS, mode });
      expect(result.run!({ flag: true, x: 4 })).toBe(1.5);
      expect(result.run!({ flag: false, x: 4 })).toBe(-1.5);
      // A parameter shadows a captured binding.
      install(ce, 'shadow', '(real) -> real', ['Negate', 'offset'], [typed('offset', 'real')]);
      expect(structured().compile(ce.expr(['shadow', 'x']), { ...OPTIONS, mode }).run!({ x: 3 })).toBe(-3);
      // A stored value that is not a number literal, and a complex binding.
      ce.declare('lazy', 'real');
      ce.assign('lazy', ce.expr(['Add', 'x', 1]));
      install(ce, 'readsLazy', '(real) -> real', ['Add', 'u', 'lazy'], [typed('u', 'real')]);
      expect(() => structured().compile(ce.expr(['readsLazy', 'x']), { ...OPTIONS, mode })).toThrow(
        /unsupported helper capture lazy/
      );
      ce.declare('w', 'complex');
      ce.declare('cplx', 'complex');
      ce.assign('cplx', 2);
      install(ce, 'readsComplex', '(complex) -> complex', ['Add', 'u', 'cplx'], [typed('u', 'complex')]);
      expect(() => structured().compile(ce.expr(['readsComplex', 'w']), { ...OPTIONS, mode })).toThrow(
        /unsupported helper capture cplx/
      );
    }
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
  const PROGRAMS: [MathJsonExpression, Inputs][] = [
    [['Sqrt', 'x'], { x: -4 }],
    [['Add', ['Sqrt', 'x'], ['Sqrt', ['Add', ['Sqrt', 'x'], 'y']]], { x: 4, y: 1 }],
    [['If', 'C', ['Sqrt', 'x'], ['Sqrt', 'p']], { C: false, x: 1, p: 4 }],
    [['Sqrt', 'z'], { z: { re: 3, im: 4 } }],
    [['Add', ['up', 'x'], ['down', 'y']], { x: 3, y: 2 }],
    [['twice', 'x'], { x: 3 }],
    [['Add', 'offset', ['g', 'x']], { x: 1 }],
    [['cs', 'x'], { x: -4 }],
  ];

  for (const mode of MODES)
    test(`${mode} mode: the readers throw, and the programs compile and run`, () => {
      for (const [json, inputs] of PROGRAMS) {
        // `cs` has a complex result, which the `strict` mode declines.
        if (mode === 'strict' && JSON.stringify(json).includes('"cs"')) continue;
        const ce = engine();
        const phases: StructuredPhase[] = [];
        const onPhase = (phase: StructuredPhase) => {
          phases.push(phase);
          if (phase === 'preparation')
            for (const [object, name] of READERS)
              jest.spyOn(object as never, name as never).mockImplementation((() => {
                throw new Error(`${name} called from preparation to emission`);
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
        const expected = interpret(ce, ce.expr(json), inputs);
        const value = run(result, inputs);
        expect(close(value, expected) || (mode === 'strict' && Number.isNaN(value) && nonReal(expected))).toBe(true);
      }
    });

  test('the structured route does not enter withOutermostCompilerState()', () => {
    // Inside another compilation, that function refuses a square root, so
    // the existing route declines and the structured route compiles.
    const ce = engine();
    CompilerState._compileDepth += 1;
    try {
      expect(structured().compile(ce.expr(['Sqrt', 'x']), { ...OPTIONS, mode: 'complex' }).code).toContain('_SYS.csqrt');
      expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['Sqrt', 'x']), { mode: 'complex' })).toThrow(
        /a square root inside another compilation/
      );
    } finally {
      CompilerState._compileDepth -= 1;
    }
  });
});

//
// The verifier: captures and call cycles
//

describe('the verifier', () => {
  function maker() {
    const owner = {};
    let id = 0;
    const origin = engine().expr('x');
    const value = (type: ScalarKind): IRValue => ({
      owner,
      revision: 1,
      id: id++,
      type,
      representation: type === 'boolean' ? 'boolean' : 'number',
    });
    const region = (operations: IROperation[], effect: 'pure' | 'effectful' = 'pure'): IRRegion => ({ operations, effect });
    const yieldOf = (v: IRValue) => ({ kind: 'yield', operands: [v], effect: 'pure', origin }) as IROperation;
    return { owner, origin, value, region, yieldOf };
  }

  /** A program that reads the captured binding `binding` twice. */
  function captureProgram(change: (reads: Record<string, unknown>[], captures: Record<string, unknown>[]) => void) {
    const m = maker();
    const binding = {};
    const captures: Record<string, unknown>[] = [
      { binding, name: 'offset', type: 'real', representation: 'number', snapshot: 2 },
    ];
    const r1 = m.value('real');
    const r2 = m.value('real');
    const sum = m.value('real');
    const reads: Record<string, unknown>[] = [
      { kind: 'capture', capture: 0, binding, snapshot: 2, result: r1, operands: [], effect: 'pure', origin: m.origin },
      { kind: 'capture', capture: 0, binding, snapshot: 2, result: r2, operands: [], effect: 'pure', origin: m.origin },
    ];
    change(reads, captures);
    const program = {
      owner: m.owner,
      revision: 1,
      inputs: [],
      numericPolicy: 'strict',
      captures,
      functions: [],
      root: m.region([
        ...(reads as unknown as IROperation[]),
        { kind: 'add', result: sum, operands: [reads[0].result, reads[1].result], effect: 'pure', origin: m.origin } as IROperation,
        m.yieldOf(sum),
      ]),
    } as unknown as IRProgram;
    return { program, origin: m.origin };
  }
  const check = (made: { program: IRProgram; origin: Expression }) =>
    () => verifyProgram(made.program, new Set([made.origin]));

  test('control: a well-formed program with two reads of one binding', () => {
    const made = captureProgram(() => {});
    expect(check(made)).not.toThrow();
    let n = 0;
    const emitted = emitStructuredProgram(made.program, { input: (name) => `_.${name}`, fresh: () => `_v${++n}` });
    expect(emitted.value).toBe('2 + 2');
  });

  test.each([
    ['a read of a capture that the program does not list', (reads: Record<string, unknown>[]) => (reads[1].capture = 1), /which the program does not list/],
    ['a read that names another binding', (reads: Record<string, unknown>[]) => (reads[1].binding = {}), /names another binding/],
    ['a read with another snapshot', (reads: Record<string, unknown>[]) => (reads[1].snapshot = 3), /has another snapshot/],
    ['a read that is not pure', (reads: Record<string, unknown>[]) => (reads[1].effect = 'effectful'), /is not pure/],
    [
      'two reads of one binding with different types',
      (reads: Record<string, unknown>[]) => (reads[1].result = { ...(reads[1].result as object), type: 'integer' }),
      // Each read must match the one listed capture, so two reads agree.
      /a read of the capture offset does not match the capture/,
    ],
    [
      'a boolean capture',
      (_reads: Record<string, unknown>[], captures: Record<string, unknown>[]) => (captures[0].type = 'boolean', captures[0].representation = 'boolean'),
      /the capture offset has the type boolean/,
    ],
    [
      // The reads are changed too, so that only the check of the capture
      // itself can refuse the program.
      'a complex capture with matching complex reads',
      (reads: Record<string, unknown>[], captures: Record<string, unknown>[]) => {
        captures[0].type = 'complex';
        captures[0].representation = 'complex';
        for (const read of reads)
          read.result = { ...(read.result as object), type: 'complex', representation: 'complex' };
      },
      /the capture offset has the type complex/,
    ],
    [
      'a snapshot that is not finite',
      (reads: Record<string, unknown>[], captures: Record<string, unknown>[]) => {
        captures[0].snapshot = Infinity;
        for (const read of reads) read.snapshot = Infinity;
      },
      /the snapshot of the capture offset is not finite/,
    ],
    [
      'an integer capture with a snapshot that is not an integer',
      (reads: Record<string, unknown>[], captures: Record<string, unknown>[]) => {
        captures[0].type = 'integer';
        captures[0].snapshot = 2.5;
        for (const read of reads) read.snapshot = 2.5;
      },
      /the snapshot of the integer capture offset is not an integer/,
    ],
    [
      'a binding captured twice',
      (_reads: Record<string, unknown>[], captures: Record<string, unknown>[]) => captures.push({ ...captures[0] }),
      /the binding offset is captured twice/,
    ],
  ] as [string, (r: Record<string, unknown>[], c: Record<string, unknown>[]) => void, RegExp][])(
    '%s',
    (_name, change, reason) => {
      expect(check(captureProgram(change))).toThrow(reason);
    }
  );

  test('a call cycle is accepted, and a call in a cycle must carry the effect of the cycle', () => {
    // f0(p) = If(p < 1, trace(p), f1(p + -1)); f1(q) = f0(q).
    const build = (callEffect: 'pure' | 'effectful') => {
      const m = maker();
      const p = m.value('real');
      const one = m.value('real');
      const less = m.value('boolean');
      const traced = m.value('real');
      const minusOne = m.value('real');
      const next = m.value('real');
      const called = m.value('real');
      const result = m.value('real');
      const q = m.value('real');
      const back = m.value('real');
      const x = m.value('real');
      const r = m.value('real');
      const o = m.origin;
      const lit = (v: IRValue, value: number) =>
        ({ kind: 'literal', value, result: v, operands: [], effect: 'pure', origin: o }) as IROperation;
      const f0 = {
        name: 'f0',
        parameters: [p],
        result: { type: 'real' as const, representation: 'number' },
        body: m.region(
          [
            lit(one, 1),
            { kind: 'less', result: less, operands: [p, one], effect: 'pure', origin: o } as IROperation,
            {
              kind: 'if',
              results: [result],
              operands: [less],
              then: m.region([{ kind: 'trace', trace: 'trace', result: traced, operands: [p], effect: 'effectful', origin: o } as IROperation, m.yieldOf(traced)], 'effectful'),
              else: m.region([
                lit(minusOne, -1),
                { kind: 'add', result: next, operands: [p, minusOne], effect: 'pure', origin: o } as IROperation,
                { kind: 'call', function: 1, result: called, operands: [next], effect: 'effectful', origin: o } as IROperation,
                m.yieldOf(called),
              ], 'effectful'),
              effect: 'effectful',
              origin: o,
            } as IROperation,
            m.yieldOf(result),
          ],
          'effectful'
        ),
        origin: o,
      };
      const f1 = {
        name: 'f1',
        parameters: [q],
        result: { type: 'real' as const, representation: 'number' },
        body: m.region(
          [{ kind: 'call', function: 0, result: back, operands: [q], effect: callEffect, origin: o } as IROperation, m.yieldOf(back)],
          callEffect
        ),
        origin: o,
      };
      return {
        program: {
          owner: m.owner,
          revision: 1,
          inputs: [{ name: 'x', type: 'real', representation: 'number' }],
          numericPolicy: 'strict',
          captures: [],
          functions: [f0, f1],
          root: m.region(
            [
              { kind: 'input', input: 0, result: x, operands: [], effect: 'pure', origin: o } as IROperation,
              { kind: 'call', function: 0, result: r, operands: [x], effect: 'effectful', origin: o } as IROperation,
              m.yieldOf(r),
            ],
            'effectful'
          ),
        } as IRProgram,
        origin: o,
      };
    };
    const good = build('effectful');
    expect(check(good)).not.toThrow();
    // The emitted cycle runs: f0(2.5) traces 0.5.
    const traces: number[] = [];
    let n = 0;
    const e = emitStructuredProgram(good.program, { input: (name) => `_.${name}`, fresh: () => `_v${++n}` }, {
      trace: (_id, operands) => `__trace(${operands.join(', ')})`,
    });
    const value = new Function('_SYS', '_', '__trace', `${e.definitions.join('\n')}\n${e.statements.join(' ')} return ${e.value};`)(
      createSysRuntime(),
      { x: 2.5 },
      (v: number) => (traces.push(v), v)
    );
    expect([value, traces]).toEqual([0.5, [0.5]]);
    // A call of the cycle that is marked pure omits the effect of the body
    // that it reaches.
    expect(check(build('pure'))).toThrow(/the effect of a call of f0 \(pure\) omits the effect of its body \(effectful\)/);
  });
});
