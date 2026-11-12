import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { consumableLoopInitials, inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import { analyzeExecution, hostArrays } from '../../src/compute-engine/compilation/structured-execution';
import type { IRLoop, IROperation, IRProgram, IRRegion } from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// A helper whose body is a block of statements, on the structured route of
// the internal scalar JavaScript fragment target: the body of a helper has
// the admission and the lowering of the body of the root function (locals,
// writes, `If` statements, loops and `Break`), and is one function of the
// program (`IRFunction`), never inlined into its caller.
//
// The values are compared with the existing emitter (`compile()` with
// `fallback: false`) with `Object.is`, and with the interpreter.

const OPTIONS = { cse: false, constantFold: false } as const;

const structured = () => new ScalarFragmentJavaScriptTarget('structured', new Map(), {});

type Value = number | boolean | readonly number[];

function run(result: CompilationResult<'javascript'>, inputs: readonly Value[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...inputs.map((v) => (Array.isArray(v) ? [...v] : v)));
}

function box(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.function('List', (v as readonly number[]).map((x) => ce.number(x)));
}

/** A boxed value of the interpreter as a JavaScript value. */
function unbox(value: Expression): unknown {
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (value.type.matches('number')) return value.N().re;
  const list = value as Expression & { each(): Generator<Expression> };
  return [...list.each()].map((x) => x.N().re);
}

/** The same value: `Object.is` for numbers, element by element for lists. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  return Object.is(a, b);
}

/** Equal values, `0` equal to `-0`, within 1e-12 relative. */
function close(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (typeof a !== 'number' || typeof b !== 'number') return a === b;
  return (
    (Number.isNaN(a) && Number.isNaN(b)) ||
    a === b ||
    (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)))
  );
}

/** An engine with machine numbers that has executed `source`. */
function engineWith(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const { diagnostics } = executeEpsil(ce, source);
  expect(diagnostics).toEqual([]);
  return ce;
}

/** The `Function` literal that `executeEpsil()` made for `name`. */
function literal(ce: ComputeEngine, name: string): Expression {
  const definition = ce.lookupDefinition(name) as { operator?: { _lambdaLiteral?: Expression } } | undefined;
  const value = definition?.operator?._lambdaLiteral;
  if (value === undefined) throw new Error(`no function literal for ${name}`);
  return value;
}

/** Compile the function `name` of `source` on both routes and on the
 *  profile, and compare the values on each list of inputs with `Object.is`,
 *  and with the interpreter. */
function agreeEpsil(source: string, name: string, cases: readonly (readonly Value[])[]): CompilationResult<'javascript'> {
  const ce = engineWith(source);
  const expr = literal(ce, name);
  const result = structured().compile(expr, OPTIONS);
  const existing = compile(expr, { ...OPTIONS, fallback: false });
  const profile = compile(expr, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
  for (const inputs of cases) {
    const value = run(result, inputs);
    expect([inputs, same(value, run(existing, inputs))]).toEqual([inputs, true]);
    expect([inputs, same(value, run(profile, inputs))]).toEqual([inputs, true]);
    const interpreted = unbox(ce.function(name, inputs.map((v) => box(ce, v))).evaluate());
    expect([inputs, value, close(value, interpreted)]).toEqual([inputs, value, true]);
  }
  return result;
}

/** The program of the function `name` of `source`, lowered and verified. */
function programOf(source: string, name: string, options: object = {}): IRProgram {
  const ce = engineWith(source);
  return lowerStructuredFragment(structured().prepareStructured(literal(ce, name), { ...OPTIONS, ...options }));
}

/** Every operation of `region` and of the regions nested in it. */
function operationsOf(region: IRRegion): IROperation[] {
  const result: IROperation[] = [];
  const visit = (r: IRRegion) => {
    for (const op of r.operations) {
      result.push(op);
      if (op.kind === 'if') {
        visit(op.then);
        visit(op.else);
      }
      if (op.kind === 'loop' || op.kind === 'build') visit(op.body);
      if (op.kind === 'and' || op.kind === 'or') op.rest.forEach(visit);
    }
  };
  visit(region);
  return result;
}

/** The compilation of `expr` with the profile, or the message of its
 *  decline. */
function profileOutcome(expr: Expression): string | (CompilationResult<'javascript'> & { pure?: boolean; shippable?: boolean }) {
  try {
    return compile(expr, { profile: 'numeric-kernel', fallback: false } as never) as never;
  } catch (e) {
    return (e as Error).message;
  }
}

//
// The statement bodies
//

const LOCALS = `
function g(x: real) -> real {
  let a = 2 * x
  let b = a + 1
  b = b * a
  b - x
}
function f(x: real) -> real { g(x) + g(x + 1) }
`;

const BRANCHES = `
function g(x: real) -> real {
  let a = 0.0
  if x > 0 { a = x } else { a = -2 * x }
  if x > 10 { a = a + 1 }
  a
}
function f(x: real) -> real { g(x) * 3 }
`;

const LOOP = `
function g(n: integer, x: real) -> real {
  let s = 0.0
  for k in 1..n { s = s + x * k + 1 / (k + 10) }
  s
}
function f(n: integer, x: real) -> real { g(n, x) - g(2, x) }
`;

const LOOP_BREAK = `
function g(x: real) -> integer {
  let n = 0
  for k in 1..20 {
    if x * k > 10 { break }
    n = n + 1
  }
  n
}
function f(x: real) -> integer {
  let s = 0
  for j in 1..3 { s = s + g(x + j) }
  s
}
`;

/** A helper with a statement body that calls another one. */
const NESTED = `
function inner(x: real) -> real {
  let a = x
  for k in 1..3 { a = a * 0.5 + 1 }
  a
}
function outer(x: real) -> real {
  let b = 0.0
  if x < 0 { b = inner(-x) } else { b = inner(x) + 1 }
  b
}
function f(x: real) -> real { outer(x) + inner(x) }
`;

describe('a helper with a statement body', () => {
  test('locals and writes', () => {
    agreeEpsil(LOCALS, 'f', [[0], [1.5], [-3], [1e10]]);
  });

  test('If statements, with and without an else branch', () => {
    agreeEpsil(BRANCHES, 'f', [[0], [2], [-2], [11], [-0]]);
  });

  test('a loop', () => {
    agreeEpsil(LOOP, 'f', [
      [1, 1],
      [5, 0.3],
      [0, 2], // Range(1, 0) visits 1 and 0
      [-3, 1],
    ]);
  });

  test('a loop with Break, called from a loop of the root', () => {
    agreeEpsil(LOOP_BREAK, 'f', [[0], [0.4], [3], [-1], [100]]);
  });

  test('a helper that calls a helper with a statement body', () => {
    agreeEpsil(NESTED, 'f', [[0], [2], [-2], [0.25]]);
  });

  test('each helper is one function of the program, emitted once, the callee first', () => {
    const program = programOf(NESTED, 'f');
    expect(program.functions.map((fn) => fn.name)).toEqual(['inner', 'outer']);
    // `inner` has a loop in its body, and the root calls each helper once by
    // a `call`: no body is inlined.
    expect(operationsOf(program.functions[0].body).some((op) => op.kind === 'loop')).toBe(true);
    expect(operationsOf(program.root).some((op) => op.kind === 'loop')).toBe(false);
    expect(operationsOf(program.root).filter((op) => op.kind === 'call')).toHaveLength(2);
  });

  test('a call from an expression, not a Function literal', () => {
    const ce = engineWith(LOOP_BREAK);
    ce.declare('x', 'real');
    const expr = ce.expr(['Add', ['g', 'x'], ['g', ['Multiply', 2, 'x']]] as MathJsonExpression);
    const result = structured().compile(expr, OPTIONS);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const x of [0, 0.3, 1, 4, -2]) {
      const value = (result.run as unknown as (v: { x: number }) => number)({ x });
      expect([x, value]).toEqual([x, (existing.run as unknown as (v: { x: number }) => number)({ x })]);
      expect([x, value]).toEqual([x, ce.expr(['Add', ['g', x], ['g', 2 * x]] as MathJsonExpression).evaluate().re]);
    }
  });

  // A local computed from the length of a list is an integer in its own
  // body: a local of the same name in another body does not change it.
  test('the root `n` is a length local, the helper `n` is real', () => {
    const source = `
function g(x: real) -> real { let n = x * 0.5; n = n + 1; n }
function f(L: list<real>, x: real) -> real {
  let n = Length(L)
  let s = 0.0
  for k in 1..n { s = s + L[k] }
  s + g(x)
}
`;
    agreeEpsil(source, 'f', [
      [[1, 2], 1],
      [[0.5, -2, 4], 3],
      [[7], -1],
    ]);
    expect(run(structured().compile(literal(engineWith(source), 'f'), OPTIONS), [[1, 2], 1])).toBe(4.5);
  });

  test('the helper `n` is a length local, the root `n` is real', () => {
    agreeEpsil(
      `
function g(L: list<real>) -> real {
  let n = Length(L)
  let s = 0.0
  for k in 1..n { s = s + L[k] }
  s
}
function f(L: list<real>, x: real) -> real { let n = x * 0.5; n = n + 1; n + g(L) }
`,
      'f',
      [
        [[1, 2], 1],
        [[0.5, -2, 4], 3],
      ]
    );
  });

  test('a length local of the same name in the root and in the helper', () => {
    agreeEpsil(
      `
function g(L: list<real>) -> real {
  let n = Length(L)
  let s = 0.0
  for k in 1..n { s = s + 2 * L[k] }
  s
}
function f(L: list<real>) -> real {
  let n = Length(L) - 1
  let s = 0.0
  for k in 1..n { s = s + L[k] }
  s + g(L)
}
`,
      'f',
      [[[1, 2]], [[0.5, -2, 4]], [[3, 4, 5, 6]]]
    );
  });

  test('a captured number read in a statement body is a snapshot', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.declare('offset', 'real');
    ce.assign('offset', 2);
    expect(
      executeEpsil(
        ce,
        `
function g(x: real) -> real {
  let a = x + offset
  if a > 3 { a = a * offset }
  a
}
function f(x: real) -> real { g(x) + offset }
`
      ).diagnostics
    ).toEqual([]);
    const result = structured().compile(literal(ce, 'f'), OPTIONS);
    const existing = compile(literal(ce, 'f'), { ...OPTIONS, fallback: false });
    for (const x of [0, 1, 2.5])
      expect([x, run(result, [x])]).toEqual([x, run(existing, [x])]);
    expect(run(result, [2])).toBe(10); // (2 + 2) * 2 + 2
    const program = lowerStructuredFragment(structured().prepareStructured(literal(ce, 'f'), OPTIONS));
    expect(program.captures.map((c) => [c.name, c.snapshot])).toEqual([['offset', 2]]);
    // The compiled code holds the value of the binding at the compilation.
    ce.assign('offset', 5);
    expect(run(result, [2])).toBe(10);
  });

  test('on the profile: pure and shippable', () => {
    for (const source of [LOCALS, BRANCHES, LOOP, LOOP_BREAK, NESTED]) {
      const result = profileOutcome(literal(engineWith(source), 'f'));
      expect(typeof result === 'string' ? result : [result.success, result.pure, result.shippable]).toEqual([
        true,
        true,
        true,
      ]);
    }
  });
});

//
// The analyses across a call
//

/** `id` returns its list parameter unchanged; `set` writes into a copy of
 *  it; `fill` writes into it in a loop. */
const LISTS = `
function id(L: list<real>) -> list<real> {
  let M = L
  M
}
function set(L: list<real>) -> list<real> {
  let R = replaceAt(L, 1, 9.0)
  R
}
function fill(L: list<real>, n: integer) -> list<real> {
  let R = L
  for k in 1..n { R = replaceAt(R, k, 0.0) }
  R
}
function update(L: list<real>) -> list<real> {
  let R = id(L)
  R = replaceAt(R, 1, 5.0)
  R
}
function later(n: integer) -> real {
  let A = [1.0 * j for j in 1..3]
  let R = id(A)
  R = replaceAt(R, 1, 5.0)
  A[1] + R[1] + n
}
function through(L: list<real>) -> list<real> { set(L) }
function both(L: list<real>) -> real {
  let R = set(L)
  let F = fill(L, 2)
  R[1] + L[1] + F[1] + L[2]
}
`;

describe('the analyses across a call', () => {
  test('a helper that returns its list parameter: the caller copies a host array', () => {
    const program = programOf(LISTS, 'update');
    // The `replace-at` of the root updates the value of a call of `id`,
    // whose body yields its parameter: not unique, so it copies.
    const root = operationsOf(program.root).filter((op) => op.kind === 'replace-at');
    expect(root).toHaveLength(1);
    expect(inPlaceUpdates(program).has(root[0])).toBe(false);
    // The value of the call can be the array of the host.
    const call = operationsOf(program.root).find((op) => op.kind === 'call')!;
    expect(hostArrays(program, inPlaceUpdates(program)).has(call.result!.id)).toBe(true);
    // The host's array is not written.
    const result = structured().compile(literal(engineWith(LISTS), 'update'), OPTIONS);
    const L = [1, 2, 3];
    expect((result.run as unknown as (l: number[]) => number[])(L)).toEqual([5, 2, 3]);
    expect(L).toEqual([1, 2, 3]);
    agreeEpsil(LISTS, 'update', [[[1, 2, 3]], [[0.5]]]);
  });

  test('a helper that returns its list parameter: the caller copies a list that it reads later', () => {
    const program = programOf(LISTS, 'later');
    const root = operationsOf(program.root).filter((op) => op.kind === 'replace-at');
    expect(inPlaceUpdates(program).has(root[0])).toBe(false);
    // A[1] + R[1] + n is 1 + 5 + n: an update in place would give 5 + 5 + n.
    agreeEpsil(LISTS, 'later', [[0], [2]]);
  });

  test('a helper that applies ReplaceAt to its list parameter never writes the host array', () => {
    for (const name of ['set', 'through', 'both']) {
      const program = programOf(LISTS, name);
      const inPlace = inPlaceUpdates(program);
      // The update of `set` copies its parameter. The loop of `fill` starts
      // from a copy of its parameter (`withOwnedCopies()`), which every pass
      // updates in place.
      for (const fn of program.functions)
        for (const op of operationsOf(fn.body))
          if (op.kind === 'replace-at')
            expect([fn.name, inPlace.has(op)]).toEqual([fn.name, fn.name === 'fill']);
      for (const fn of program.functions.filter((f) => f.name === 'fill')) {
        const operations = operationsOf(fn.body);
        for (const op of operations)
          if (op.kind === 'loop') {
            expect(consumableLoopInitials(program).get(op)).toEqual([true]);
            const copy = operations.find((o) => o.result?.id === op.operands[2].id);
            expect([copy?.kind, copy?.operands[0].id]).toEqual(['copy', fn.parameters[0].id]);
          }
      }
    }
    const ce = engineWith(LISTS);
    const through = structured().compile(literal(ce, 'through'), OPTIONS);
    const L = [1, 2, 3];
    expect((through.run as unknown as (l: number[]) => number[])(L)).toEqual([9, 2, 3]);
    expect(L).toEqual([1, 2, 3]);
    const both = structured().compile(literal(ce, 'both'), OPTIONS);
    const M = [1, 2, 3];
    // 9 + 1 + 0 + 2: the host array is unchanged after both calls.
    expect((both.run as unknown as (l: number[]) => number)(M)).toBe(12);
    expect(M).toEqual([1, 2, 3]);
    agreeEpsil(LISTS, 'through', [[[1, 2, 3]], [[4]]]);
    agreeEpsil(LISTS, 'both', [[[1, 2, 3]], [[4, -1, 7]]]);
  });

  test('a helper with a loop that has an iteration budget: canAbort reaches the regions of the caller', () => {
    const source = `
function count(x: real) -> integer {
  let n = 0
  for k in 1..20 {
    if x * k > 10 { break }
    n = n + 1
  }
  n
}
function f(L: list<real>, x: real) -> list<real> {
  let R = L
  for k in 1..3 { R = replaceAt(R, k, count(x + k)) }
  R
}
`;
    const program = programOf(source, 'f', { iterationBudget: 1000 });
    const [count] = program.functions;
    expect(count.name).toBe('count');
    expect(count.body.canAbort).toBe(true);
    const loop = program.root.operations.find((op): op is IRLoop => op.kind === 'loop')!;
    expect(loop.body.canAbort).toBe(true);
    expect(program.root.canAbort).toBe(true);
    const analysis = analyzeExecution(program);
    const judgment = analysis.parallelLoops.find((j) => j.loop === loop)!;
    expect(judgment.candidate).toBe(true);
    if (judgment.candidate) expect(judgment.canAbort).toBe(true);
    expect(analysis.independentCalls.caveats.map((c) => c.name)).toEqual(['iteration-budget']);
    // Without a budget, nothing can abort.
    const unbounded = programOf(source, 'f');
    expect(unbounded.root.canAbort).toBeUndefined();
    // A budget too small for the passes of one call aborts it.
    const ce = engineWith(source);
    const small = structured().compile(literal(ce, 'f'), { ...OPTIONS, iterationBudget: 5 });
    expect(() => run(small, [[1, 2, 3], 0])).toThrow();
  });

  test('pure and shippable of a root that calls such helpers', () => {
    const ce = engineWith(LISTS);
    for (const name of ['update', 'later', 'through', 'both']) {
      const result = profileOutcome(literal(ce, name));
      expect([name, typeof result === 'string' ? result : [result.pure, result.shippable]]).toEqual([
        name,
        [true, true],
      ]);
    }
  });
});

//
// The refusals
//

describe('the refusals of a helper with a statement body', () => {
  const declines = (source: string, name: string, message: RegExp) => {
    const ce = engineWith(source);
    expect(() => structured().compile(literal(ce, name), OPTIONS)).toThrow(message);
    const result = profileOutcome(literal(ce, name));
    expect(typeof result === 'string' ? result : 'compiled').toMatch(/Could not compile with the profile 'numeric-kernel'/);
  };

  test('a helper that calls itself in a loop', () => {
    declines(
      `
function r(n: integer) -> integer {
  let s = 1
  for k in 1..n { if n > 1 { s = s + r(n - 1) } }
  s
}
function f(n: integer) -> integer { r(n) }
`,
      'f',
      /the helper r calls itself, directly or through another helper: the structured route has no recursion/
    );
  });

  // The engine gives the functions of a cycle the effects `any`, so the
  // signature check refuses the cycle before the check of recursion.
  test('two helpers that call each other', () => {
    declines(
      `
function a(n: integer) -> integer {
  let s = 0
  if n > 0 { s = b(n - 1) }
  s
}
function b(n: integer) -> integer {
  let s = 1
  if n > 0 { s = a(n - 1) }
  s
}
function f(n: integer) -> integer { a(n) }
`,
      'f',
      /the helper a is not pure: its signature has effects/
    );
  });

  // A helper with no declared signature is admitted: its untyped parameter
  // is a real number in the strict mode, as an untyped parameter of the
  // root (compile-javascript-profile-undeclared-helpers.test.ts).
  test('a helper with no declared signature is admitted', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.expr([
        'Function',
        ['Block', ['Declare', 'a', "'real'", ['Multiply', 2, 'u']], ['Assign', 'a', ['Add', 'a', 1]], 'a'],
        'u',
      ] as MathJsonExpression)
    );
    const root = ce.expr(['Function', ['Block', ['h', 'x']], ['Typed', 'x', "'real'"]] as MathJsonExpression);
    const result = structured().compile(root, OPTIONS);
    const existing = compile(root, { ...OPTIONS, fallback: false });
    for (const x of [-1.5, 0, 2.25]) expect(Object.is(run(result, [x]), run(existing, [x]))).toBe(true);
    expect(typeof profileOutcome(root)).toBe('object');
  });

  // A `Continue` that ends a branch of an `If` of the loop body is admitted
  // (compile-javascript-structured-statements.test.ts); one in a nested `If`
  // is not.
  test('a statement outside the admitted list: a Continue in a nested If', () => {
    declines(
      `
function g(x: real) -> real {
  let s = 0.0
  for k in 1..5 {
    if k > 1 { if k == 2 { continue } }
    s = s + x
  }
  s
}
function f(x: real) -> real { g(x) }
`,
      'f',
      /the structured route admits a Continue only as the last statement of a branch of an If that is a statement of the body of a Loop/
    );
  });

  test('a write to a parameter of the helper', () => {
    declines(
      `
function g(x: real) -> real {
  x = x + 1
  x
}
function f(x: real) -> real { g(x) }
`,
      'f',
      /only writes to a declared local are supported, and x is a parameter/
    );
  });
});
