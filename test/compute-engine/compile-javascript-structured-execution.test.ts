import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ComputeEngine, createKernelPool, type KernelPool } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  lowerStructuredFragment,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import {
  joinEffects,
  touchesField,
  type IRFunction,
  type IROperation,
  type IRProgram,
  type IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import {
  analyzeExecution,
  hostArrays,
  type ExecutionAnalysis,
  type LoopJudgment,
} from '../../src/compute-engine/compilation/structured-execution';
import { callPool, type StoredResult } from '../../src/compute-engine/kernel-pool';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';

// The first analysis for concurrency on the structured representation
// (`analyzeExecution()` in src/compute-engine/compilation/structured-execution.ts;
// design: docs/plans/2026-11-10-structured-ir-loops-and-lists.md, "The first
// analysis for concurrency"): independent calls, worker portability, and the
// candidate judgment for the iterations of each loop. The programs are Epsil
// definitions, compiled on the structured route of the internal scalar
// JavaScript fragment target, as in compile-javascript-structured-heat.test.ts.

/** The functions of the prelude of Tycho's heat showcase that the structured
 *  route compiles (`~/dev/tycho/src/graph-paper/onboarding/showcase-heat.js`;
 *  `heatseed` is left out; its test is in
 *  compile-javascript-structured-functions.test.ts). */
const HEAT = `
const N = 32
function heatwall(c: integer, r: integer, obstacle: real) -> boolean {
  obstacle > 0.5 && c == 16 && (r < 13 || r > 18)
}
function heatneighbor(H: list<real>, c: integer, r: integer, center: real, boundary: real, obstacle: real) -> real {
  if c < 0 || c >= N || r < 0 || r >= N {
    if boundary > 0.5 { 0 } else { center }
  } else if heatwall(c, r, obstacle) { center } else { H[1 + c + N*r] }
}
function heatstep(H: list<real>, diffusivity: real, boundary: real, obstacle: real) -> list<real> {
  let a = min(0.25, max(0, diffusivity))
  let L = [0 for j in 1..N^2]
  for k in 1..N^2 {
    let c = ((k - 1) % N)
    let r = floor((k - 1)/N)
    let v = H[k]
    if heatwall(c, r, obstacle) {
      L = replaceAt(L, k, v)
    } else {
      let neighbors = heatneighbor(H, c-1, r, v, boundary, obstacle) + heatneighbor(H, c+1, r, v, boundary, obstacle) + heatneighbor(H, c, r-1, v, boundary, obstacle) + heatneighbor(H, c, r+1, v, boundary, obstacle)
      L = replaceAt(L, k, v + a*(neighbors - 4*v))
    }
  }
  L
}
function heatpaint(H: list<real>, p: real, q: real, obstacle: real) -> list<real> {
  [if !heatwall(((k-1) % N), floor((k-1)/N), obstacle) && (((k-1) % N)+0.5-p)^2 + (floor((k-1)/N)+0.5-q)^2 <= 9 { 1 } else { H[k] } for k in 1..N^2]
}
`;

const OPTIONS = { cse: false, constantFold: false } as const;
const TESTS = new Map([
  ['Trace', 'trace'],
  ['Mystery', 'mystery'],
]);
const structured = () =>
  new ScalarFragmentJavaScriptTarget('structured', TESTS, {
    trace: (id: string, operands: readonly string[]) =>
      `globalThis.__ceTrace(${JSON.stringify(id)}, ${operands.join(', ')})`,
  });

/** An engine with the test operations, that has executed `source`. */
function engineWith(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  // `console` is an impurity label: the definition states an effect.
  ce.declare('Trace', {
    signature: '(real) -> real',
    effects: ['console'],
    evaluate: (ops: readonly Expression[]) => ops[0],
  } as never);
  // `pure: false` states no effect set: the effects are unknown.
  ce.declare('Mystery', {
    signature: '(real) -> real',
    pure: false,
    evaluate: (ops: readonly Expression[]) => ops[0],
  } as never);
  const { diagnostics } = executeEpsil(ce, source);
  expect(diagnostics).toEqual([]);
  return ce;
}

/** The `Function` literal that `executeEpsil()` made for `name`. */
function literal(ce: ComputeEngine, name: string): Expression {
  const definition = ce.lookupDefinition(name) as
    | { operator?: { _lambdaLiteral?: Expression } }
    | undefined;
  const fn = definition?.operator?._lambdaLiteral;
  if (fn === undefined) throw new Error(`no function literal for ${name}`);
  return fn;
}

/** The analysis of the program of `name` in `source`, lowered and verified
 *  on the structured route. */
function analyze(source: string, name: string, options: object = {}): ExecutionAnalysis {
  const ce = engineWith(source);
  const preparation = structured().prepareStructured(literal(ce, name), { ...OPTIONS, ...options });
  return analyzeExecution(lowerStructuredFragment(preparation));
}

/** `program` with the first operation of the kind `kind` in the body of the
 *  function `name` marked `effectful`, and the effects of every region, of
 *  every operation that evaluates a region and of every call joined again. */
function withEffect(program: IRProgram, name: string, kind: IROperation['kind']): IRProgram {
  let marked = false;
  const functions: IRFunction[] = [];
  const region = (r: IRRegion, mark: boolean): IRRegion => {
    const operations = r.operations.map((op) => operation(op, mark));
    return {
      ...r,
      operations,
      effect: joinEffects(...operations.map((op) => op.effect)),
      ...touchesField(...operations.map((op) => op.touches)),
    };
  };
  const operation = (op: IROperation, mark: boolean): IROperation => {
    if (mark && !marked && op.kind === kind) {
      marked = true;
      return { ...op, effect: 'effectful', touches: ['console'] } as IROperation;
    }
    if (op.kind === 'call')
      return {
        ...op,
        effect: joinEffects(op.effect, functions[op.function].body.effect),
        ...touchesField(op.touches, functions[op.function].body.touches),
      };
    if (op.kind === 'if') {
      const [then, otherwise] = [region(op.then, mark), region(op.else, mark)];
      return {
        ...op,
        then,
        else: otherwise,
        effect: joinEffects(op.effect, then.effect, otherwise.effect),
        ...touchesField(op.touches, then.touches, otherwise.touches),
      };
    }
    if (op.kind === 'loop' || op.kind === 'build') {
      const body = region(op.body, mark);
      return {
        ...op,
        body,
        effect: joinEffects(op.effect, body.effect),
        ...touchesField(op.touches, body.touches),
      } as IROperation;
    }
    if (op.kind === 'and' || op.kind === 'or') {
      const rest = op.rest.map((r) => region(r, mark));
      return {
        ...op,
        rest,
        effect: joinEffects(op.effect, ...rest.map((r) => r.effect)),
        ...touchesField(op.touches, ...rest.map((r) => r.touches)),
      };
    }
    return op;
  };
  for (const fn of program.functions) functions.push({ ...fn, body: region(fn.body, fn.name === name) });
  const result = { ...program, functions, root: region(program.root, false) };
  if (!marked) throw new Error(`no ${kind} in ${name}`);
  return result;
}

/** The operations of `region` and of the regions nested in it. */
function allOperations(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...(op.kind === 'if'
      ? [...allOperations(op.then), ...allOperations(op.else)]
      : op.kind === 'loop' || op.kind === 'build'
        ? allOperations(op.body)
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest.flatMap(allOperations)
          : []),
  ]);
}

/** A judgment in a form that a test compares: the candidate with its
 *  carried lists and indices, or the reason. */
function summary(judgment: LoopJudgment) {
  return judgment.candidate
    ? {
        candidate: true,
        updates: judgment.updates.map((u) => [u.list.json, u.index.json, u.initialUnique]),
        conditions: judgment.conditions,
      }
    : { candidate: false, reason: judgment.reason.reason, kind: judgment.reason.kind };
}

/** A program with a list `L` of `n` zeros, a loop over `k` from `a` to `n`
 *  with the statement `statement`, and the value `L`. */
const listLoop = (statement: string, a = '1') => `
function f(n: integer) -> list<real> {
  let L = [0 for j in 1..n]
  for k in ${a}..n { ${statement} }
  L
}`;

describe('the heat functions', () => {
  test('heatstep: independent calls, worker portable, its loop a candidate on L at k', () => {
    const analysis = analyze(HEAT, 'heatstep');
    expect(analysis.independentCalls).toEqual({ holds: true, blockers: [], caveats: [] });
    expect(analysis.workerPortable).toEqual({ holds: true, blockers: [] });
    // `Range(1, N^2)` with the capture `N = 32`: the bound `N^2` is the
    // product of two captures of 32, so both bounds are proved at least 1.
    expect(analysis.parallelLoops.map(summary)).toEqual([
      { candidate: true, updates: [['L', 'k', true]], conditions: [] },
    ]);
    const [loop] = analysis.parallelLoops;
    expect(loop.candidate && loop.canAbort).toBe(false);
    expect(loop.function).toBeUndefined();
  });

  test('heatstep with an iteration budget: the caveat, not a failure; the loop can abort and stays a candidate', () => {
    const analysis = analyze(HEAT, 'heatstep', { iterationBudget: 10_000 });
    expect(analysis.independentCalls.holds).toBe(true);
    expect(analysis.independentCalls.caveats.map((c) => [c.name, c.loops.length])).toEqual([
      ['iteration-budget', 1],
    ]);
    expect(analysis.independentCalls.caveats[0].text).toMatch(/cannot interleave.*own runtime/s);
    const [loop] = analysis.parallelLoops;
    expect(loop.candidate && loop.canAbort).toBe(true);
  });

  test('heatpaint and heatneighbor: independent calls and worker portable, no loop', () => {
    for (const name of ['heatpaint', 'heatneighbor']) {
      const analysis = analyze(HEAT, name);
      expect([name, analysis]).toEqual([
        name,
        {
          independentCalls: { holds: true, blockers: [], caveats: [] },
          workerPortable: { holds: true, blockers: [] },
          parallelLoops: [],
        },
      ]);
    }
  });
});

describe('the candidate judgment of a loop', () => {
  test('a sum: a carried scalar is not a candidate', () => {
    const analysis = analyze(
      `function f(n: integer) -> real {
  let s = 0
  for k in 1..n { s = s + k^2 }
  s
}`,
      'f'
    );
    const [loop] = analysis.parallelLoops;
    expect(loop.candidate).toBe(false);
    if (loop.candidate) return;
    expect(loop.reason.reason).toMatch(/^carried scalar /);
    expect(loop.reason.kind).toBe('add');
    // The calls are still independent: the sum is a value of one call.
    expect(analysis.independentCalls.holds).toBe(true);
  });

  test('a read of the carried list at another index is not a candidate', () => {
    const [loop] = analyze(listLoop('L = replaceAt(L, k, L[k - 1] + 1)', '2'), 'f').parallelLoops;
    expect(summary(loop)).toEqual({ candidate: false, reason: 'a read of the carried list', kind: 'at' });
  });

  test('a read of the length of the carried list is not a candidate', () => {
    const [loop] = analyze(listLoop('L = replaceAt(L, k, length(L))'), 'f').parallelLoops;
    expect(summary(loop)).toEqual({ candidate: false, reason: 'a read of the carried list', kind: 'length' });
  });

  test('an update at an index other than the loop index is not a candidate: k + 1, a constant', () => {
    for (const index of ['k + 1', '1']) {
      const [loop] = analyze(listLoop(`L = replaceAt(L, ${index}, k)`), 'f').parallelLoops;
      expect([index, summary(loop)]).toEqual([
        index,
        {
          candidate: false,
          reason: 'an update of the carried list at an index other than the loop index',
          kind: 'replace-at',
        },
      ]);
    }
  });

  test('a list read in the body that is not carried is allowed', () => {
    const analysis = analyze(
      `function f(H: list<real>, n: integer) -> list<real> {
  let L = [0 for j in 1..n]
  for k in 1..n { L = replaceAt(L, k, H[k] + H[1]) }
  L
}`,
      'f'
    );
    expect(analysis.parallelLoops.map(summary)).toEqual([
      { candidate: true, updates: [['L', 'k', true]], conditions: ['bounds-at-least-one'] },
    ]);
  });

  test('an update in one branch only: the other branch keeps the list, which is the carried list', () => {
    const analysis = analyze(listLoop('if k < 3 { L = replaceAt(L, k, 1) }'), 'f');
    expect(analysis.parallelLoops.map(summary)).toEqual([
      { candidate: true, updates: [['L', 'k', true]], conditions: ['bounds-at-least-one'] },
    ]);
  });

  test('a branch that replaces the list with a new list is not a candidate', () => {
    const [loop] = analyze(
      listLoop('if k < 3 { L = replaceAt(L, k, 1) } else { L = [2 for j in 1..n] }'),
      'f'
    ).parallelLoops;
    expect(summary(loop)).toEqual({
      candidate: false,
      reason: 'a branch replaces the carried list with another list',
      kind: 'if',
    });
  });

  test('nested loops: the inner loop is a candidate, the outer loop is not', () => {
    // Each pass of the outer loop writes the same elements: the value of
    // the call is the writes of the last pass, so the order of the outer
    // passes matters. The rule sees this as a use of the carried list that
    // is not an update at the outer index: the inner loop receives it as its
    // initial value. The inner loop writes each element at its own index.
    const analysis = analyze(
      `function f(n: integer) -> list<real> {
  let L = [0 for j in 1..n]
  for i in 1..3 { for j in 1..n { L = replaceAt(L, j, i*j) } }
  L
}`,
      'f'
    );
    expect(analysis.parallelLoops.map(summary)).toEqual([
      { candidate: false, reason: 'the carried list is the initial value of an inner loop', kind: 'loop' },
      { candidate: true, updates: [['L', 'j', true]], conditions: ['bounds-at-least-one'] },
    ]);
  });

  test('an inner loop whose body yields the outer carried list: not a candidate', () => {
    // In order, every element becomes 1; in reverse order, each element is
    // the next one plus 1. The inner loop makes a new value for `M` that is
    // the outer `L`, and `M[k+1]` reads it.
    const source = (inner: string) => `
function f(n: integer) -> list<real> {
  let L = [0 for j in 1..n]
  for k in 1..n-1 {
    let M = [0 for j in 1..n]
    for j in 1..1 { ${inner} }
    L = replaceAt(L, k, M[k + 1] + 1)
  }
  L
}`;
    for (const inner of ['M = L', 'if k > 0 { M = L }']) {
      const [outer] = analyze(source(inner), 'f').parallelLoops;
      expect([inner, summary(outer)]).toEqual([
        inner,
        { candidate: false, reason: 'a use of the carried list inside the body of an inner loop', kind: 'yield' },
      ]);
    }
  });

  test('an update of the carried list inside an inner loop at the outer index: not a candidate', () => {
    // The inner loop carries the list: its initial value is the outer
    // carried list, a use that the rule does not admit.
    const [outer] = analyze(listLoop('for j in 1..2 { L = replaceAt(L, k, j) }'), 'f').parallelLoops;
    expect(summary(outer)).toEqual({
      candidate: false,
      reason: 'the carried list is the initial value of an inner loop',
      kind: 'loop',
    });
  });

  test('the bounds: proved at least 1, or the condition bounds-at-least-one', () => {
    const range = (a: string, b: string, statement = 'L = replaceAt(L, k, 1)') => `
function f(n: integer) -> list<real> {
  let L = [0 for j in 1..8]
  for k in ${a}..${b} { ${statement} }
  L
}`;
    const conditions = (source: string) => {
      const [loop] = analyze(source, 'f').parallelLoops;
      return loop.candidate ? loop.conditions : summary(loop);
    };
    // -3 and 3 name the same element of a list of 3 elements; 0 throws,
    // unless a guard skips it.
    expect(conditions(range('-3', '3', 'if k < 0 || k > 0 { L = replaceAt(L, k, 1) }'))).toEqual([
      'bounds-at-least-one',
    ]);
    // A range that counts down below 1, and one that stays at 1 or more.
    expect(conditions(range('2', '(-2)', 'if k < 0 || k > 0 { L = replaceAt(L, k, 1) }'))).toEqual([
      'bounds-at-least-one',
    ]);
    expect(conditions(range('3', '1'))).toEqual([]);
    // A bound that is an input; a sum and a product of literals.
    expect(conditions(range('1', 'n'))).toEqual(['bounds-at-least-one']);
    expect(conditions(range('2*3', '1+1'))).toEqual([]);
  });

  test('a loop over an input list: a candidate whose initial list is not unique', () => {
    // The sequential code copies `H` at the first update; a parallel run
    // must copy it once before it writes.
    const analysis = analyze(
      `function f(H: list<real>, n: integer) -> list<real> {
  let L = H
  for k in 1..n { L = replaceAt(L, k, 0) }
  L
}`,
      'f'
    );
    expect(analysis.parallelLoops.map(summary)).toEqual([
      { candidate: true, updates: [['L', 'k', false]], conditions: ['bounds-at-least-one'] },
    ]);
  });

  test('an initial list that the body or later code reads is not unique', () => {
    // The sequential code copies `L0` at the first update, because the body
    // reads it, or because the code after the loop reads it.
    const readInBody = analyze(
      `function f(n: integer) -> list<real> {
  let L0 = [0 for j in 1..n]
  let L = L0
  for k in 1..n { L = replaceAt(L, k, L0[k] + 1) }
  L
}`,
      'f'
    );
    const readAfter = analyze(
      `function f(n: integer) -> real {
  let L0 = [0 for j in 1..n]
  let L = L0
  for k in 1..n { L = replaceAt(L, k, k) }
  L[1] + L0[1]
}`,
      'f'
    );
    for (const analysis of [readInBody, readAfter])
      expect(analysis.parallelLoops.map(summary)).toEqual([
        { candidate: true, updates: [['L', 'k', false]], conditions: ['bounds-at-least-one'] },
      ]);
  });

  test('the carried list as an argument of a call', () => {
    const [loop] = analyze(
      `function g(L: list<real>) -> real { L[1] }
function f(n: integer) -> list<real> {
  let L = [0 for j in 1..n]
  for k in 1..n { L = replaceAt(L, k, g(L)) }
  L
}`,
      'f'
    ).parallelLoops;
    expect(summary(loop)).toEqual({ candidate: false, reason: 'the carried list is an argument of a call', kind: 'call' });
  });

  test('two carried lists: one flows into the other, or one reads the other', () => {
    // The value of the function is `M`, so that `M` is a carried value (a
    // local that no code reads after the loop is not carried).
    const two = (statements: string) => `
function f(n: integer) -> list<real> {
  let L = [0 for j in 1..n]
  let M = [0 for j in 1..n]
  for k in 1..n { ${statements} }
  M
}`;
    const reasons = (source: string) =>
      analyze(source, 'f').parallelLoops.map((j) => (j.candidate ? 'candidate' : j.reason.reason));
    // The first carried value is `L`: its update flows into `M`.
    expect(reasons(two('L = replaceAt(L, k, 1); M = L'))).toEqual(['the carried list flows into another carried value']);
    // The first carried value is `M`: its next value is the old `L`, not an
    // update of `M`.
    expect(reasons(two('M = L; L = replaceAt(L, k, 1)'))).toEqual([
      'the body replaces the carried list with another list',
    ]);
    expect(reasons(two('L = replaceAt(L, k, M[k]); M = replaceAt(M, k, 2)'))).toEqual(['a read of the carried list']);
  });

  test('the body replaces the carried list with another list', () => {
    const [loop] = analyze(listLoop('L = [k for j in 1..n]'), 'f').parallelLoops;
    expect(summary(loop)).toEqual({
      candidate: false,
      reason: 'the body replaces the carried list with another list',
      kind: 'yield',
    });
  });

  test('an operation with unknown effects in the body', () => {
    const [loop] = analyze(listLoop('L = replaceAt(L, k, Mystery(k))'), 'f').parallelLoops;
    expect(summary(loop)).toEqual({
      candidate: false,
      reason: 'the body has an operation whose definition does not state its effects',
      kind: 'trace',
    });
  });

  test('the index: a local equal to k, and Mod(k, n) + 1', () => {
    const [local] = analyze(listLoop('let i = k\n L = replaceAt(L, i, 1)'), 'f').parallelLoops;
    const [mod] = analyze(listLoop('L = replaceAt(L, (k % n) + 1, 1)'), 'f').parallelLoops;
    expect(summary(mod)).toEqual({
      candidate: false,
      reason: 'an update of the carried list at an index other than the loop index',
      kind: 'replace-at',
    });
    // `let i = k` makes no operation: `i` is the value of the index, and the
    // rule accepts it.
    expect(summary(local)).toEqual({
      candidate: true,
      updates: [['L', 'i', true]],
      conditions: ['bounds-at-least-one'],
    });
  });

  test('a body with an operation that is not pure is not a candidate', () => {
    const [loop] = analyze(listLoop('L = replaceAt(L, k, Trace(k))'), 'f').parallelLoops;
    expect(summary(loop)).toEqual({
      candidate: false,
      reason: 'the body has an operation whose definition states an effect',
      kind: 'trace',
    });
  });
});

describe('effects, functions and captures', () => {
  test('an effectful operation: calls are not independent and the code is not portable', () => {
    const analysis = analyze(`function f(x: real) -> real { Trace(x) + 1 }`, 'f');
    expect(analysis.independentCalls.holds).toBe(false);
    expect(analysis.independentCalls.blockers.map((b) => [b.kind, b.origin.json, b.reason])).toEqual([
      ['trace', ['Trace', 'x'], 'an operation whose definition states an effect'],
    ]);
    expect(analysis.workerPortable.holds).toBe(false);
    expect(analysis.workerPortable.blockers.map((b) => [b.kind, b.origin.json])).toEqual([['trace', ['Trace', 'x']]]);
    expect(analysis.workerPortable.blockers[0].reason).toMatch(/effect facts do not name/);
  });

  test('an operation with unknown effects: the same answers, with the reason of a possible host closure', () => {
    const analysis = analyze(`function f(x: real) -> real { Mystery(x) + 1 }`, 'f');
    expect(analysis.independentCalls.blockers.map((b) => [b.kind, b.origin.json, b.reason])).toEqual([
      ['trace', ['Mystery', 'x'], 'an operation whose definition does not state its effects'],
    ]);
    expect(analysis.workerPortable.holds).toBe(false);
    expect(analysis.workerPortable.blockers[0].reason).toMatch(/closure of the host/);
  });

  test('an effect in a helper two levels down is named in that helper, once', () => {
    // The structured route admits only helpers whose definition states no
    // effect (`resolveHelper()` in javascript-fragment-target.ts), so the
    // program is made: the program of a chain of pure helpers, where the
    // `add` of `g2` is marked `effectful`, and the effects of the regions
    // and of the calls are joined again. The verifier accepts it.
    const source = (body: string) => `function g2(x: real) -> real { ${body} }
function g1(x: real) -> real { g2(x) + g2(x + 1) }
function f(x: real) -> real { g1(x) * 2 }`;
    for (const head of ['Trace', 'Mystery'])
      expect(() => analyze(source(`${head}(x)`), 'f')).toThrow(/the helper g1 is not pure: its signature has effects/);

    const ce = engineWith(source('x + 0.5'));
    const preparation = structured().prepareStructured(literal(ce, 'f'), OPTIONS);
    const program = withEffect(lowerStructuredFragment(preparation), 'g2', 'add');
    verifyJavaScriptProgram(program, preparedNodesOf(preparation));
    const analysis = analyzeExecution(program);
    for (const answer of [analysis.independentCalls, analysis.workerPortable]) {
      expect(answer.holds).toBe(false);
      expect(answer.blockers.map((b) => [b.kind, b.function, b.origin.json])).toEqual([
        ['add', 'g2', ['Add', 'x', 0.5]],
      ]);
    }
  });

  test('a program with a capture is portable: the snapshot is a number', () => {
    const analysis = analyze(
      `const M = 2.5
function g(x: real) -> real { M * x }
function f(x: real) -> real { g(x) + M }`,
      'f'
    );
    expect(analysis.workerPortable).toEqual({ holds: true, blockers: [] });
    expect(analysis.independentCalls.holds).toBe(true);
  });

  test('host arrays: a call of a function of a higher index reads its final fact', () => {
    // The lowering gives `g` (which returns its list parameter) a lower
    // index than `h`, which calls it. The made program exchanges the two
    // functions, so that `h` calls a function of a higher index.
    const ce = engineWith(`function g(H: list<real>) -> list<real> { H }
function h(H: list<real>) -> list<real> { g(H) }
function f(H: list<real>) -> list<real> { h(H) }`);
    const program = lowerStructuredFragment(structured().prepareStructured(literal(ce, 'f'), OPTIONS));
    expect(program.functions.map((fn) => fn.name)).toEqual(['g', 'h']);
    const swap = (i: number) => (i === 0 ? 1 : i === 1 ? 0 : i);
    const region = (r: IRRegion): IRRegion => ({
      ...r,
      operations: r.operations.map((op) => (op.kind === 'call' ? { ...op, function: swap(op.function) } : op)),
    });
    const made: IRProgram = {
      ...program,
      functions: [program.functions[1], program.functions[0]].map((fn) => ({ ...fn, body: region(fn.body) })),
      root: region(program.root),
    };
    const result = (p: IRProgram) => p.root.operations[p.root.operations.length - 1].operands[0].id;
    expect(hostArrays(made, new Set()).has(result(made))).toBe(true);
    expect(hostArrays(program, new Set()).has(result(program))).toBe(true);
    // The defensive blocker of independentCalls (an update in place of a
    // host array) is not reached by any program while `inPlaceUpdates()`
    // never selects such an update: it is not tested here.
  });

  test('host arrays: an update in place of an input, in a loop and in a branch, is followed', () => {
    // `inPlaceUpdates()` never selects these updates; the made set does, so
    // that the alias analysis of the defensive check is exercised.
    for (const statement of ['L = replaceAt(L, k, 0)', 'if k < 2 { L = replaceAt(L, k, 0) }']) {
      const ce = engineWith(`function f(H: list<real>, n: integer) -> list<real> {
  let L = H
  for k in 1..n { ${statement} }
  L
}`);
      const program = lowerStructuredFragment(structured().prepareStructured(literal(ce, 'f'), OPTIONS));
      const loop = program.root.operations.find((op) => op.kind === 'loop');
      if (loop?.kind !== 'loop') throw new Error('no loop');
      const update = allOperations(loop.body).find((op) => op.kind === 'replace-at')!;
      const shared = hostArrays(program, new Set([update]));
      const branch = loop.body.operations.find((op) => op.kind === 'if');
      expect([
        statement,
        shared.has(update.result!.id),
        shared.has(loop.body.parameters![1].id),
        shared.has(loop.results[0].id),
        branch?.kind === 'if' ? shared.has(branch.results[0].id) : 'no branch',
      ]).toEqual([statement, true, true, true, statement.startsWith('if') ? true : 'no branch']);
      // Without the made set, the update copies: its result is a new array.
      expect(hostArrays(program, new Set()).has(update.result!.id)).toBe(false);
    }
  });

  test('a list input is never written in place: the calls of a function that updates its input are independent', () => {
    // `replaceAt(H, k, v)` of an input copies (the host owns the array), so
    // two calls on one array do not see each other's writes.
    const analysis = analyze(
      `function f(H: list<real>, k: integer, v: real) -> list<real> { replaceAt(H, k, v) }`,
      'f'
    );
    expect(analysis.independentCalls).toEqual({ holds: true, blockers: [], caveats: [] });
    const loopOverInput = analyze(
      `function f(H: list<real>, n: integer) -> list<real> {
  let L = H
  for k in 1..n { L = replaceAt(L, k, 0) }
  L
}`,
      'f'
    );
    expect(loopOverInput.independentCalls.holds).toBe(true);
  });
});

//
// The independent-calls answer of heatstep, run
//

/** The worker entry of the kernel pool, from source: the tsx loader of the
 *  worker thread compiles it (as in kernel-pool.test.ts). */
const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

/** Fields of 32 × 32 different temperatures, one per seed. */
function field(seed: number): number[] {
  return Array.from(
    { length: 1024 },
    (_, k) => Math.round((Math.sin(0.37 * (k + 1) + seed) + (k + 1) / 1000) * 2 ** 20) / 2 ** 20
  );
}

describe('the calls of heatstep, run at the same time', () => {
  const ce = engineWith(HEAT);
  const STEP = structured().compile(literal(ce, 'heatstep'), OPTIONS) as CompilationResult<'javascript'>;
  const step = STEP.run as unknown as (...args: unknown[]) => number[];
  const INPUTS = Array.from({ length: 8 }, (_, i) => [field(i), [0.22, 0.1, 0.25, 0][i % 4], i % 2, (i >> 1) % 2]);
  const SEQUENTIAL = INPUTS.map((args) => [...step(...args)]);

  test('the analysis says the calls are independent', () => {
    expect(analyze(HEAT, 'heatstep').independentCalls.holds).toBe(true);
  });

  test('the calls in another order leave no state: every value equals the sequential value', async () => {
    // A call is synchronous, so two calls cannot interleave on one thread.
    // Each async wrapper waits a different number of turns before its call,
    // so that the calls run in an order other than the order of the inputs:
    // a call that left state behind would change the value of the next.
    const turns = async (n: number) => {
      for (let i = 0; i < n; i++) await Promise.resolve();
    };
    const values = await Promise.all(
      INPUTS.map(async (args, i) => {
        await turns((INPUTS.length - i) * 3);
        const value = [...step(...args)];
        await turns(i);
        return value;
      })
    );
    expect(values).toEqual(SEQUENTIAL);
  });

  let pool: KernelPool | undefined;
  afterAll(() => pool?.dispose());

  test('in two worker_threads workers that load the stored code: every value equals the sequential value', async () => {
    const workers: number[] = [];
    let created = 0;
    pool = createKernelPool({
      size: 2,
      create: () => {
        const index = created++;
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
            if ((m as { type: string }).type === 'call') workers.push(index);
            w.postMessage(m, transfer ?? []);
          },
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
    });
    await pool.prewarm();
    const calls = callPool(pool);
    if (calls === undefined) throw new Error('not a usable pool');
    // The pool sends the stored fields of the result; the worker rebuilds
    // the function with `createJavaScriptRuntime().load()`.
    expect(STEP.calling).toBe('lambda');
    const values = await Promise.all(
      INPUTS.map((args) => calls.runCall(STEP as unknown as StoredResult, args, undefined, undefined))
    );
    expect(values.map((v) => [...(v as number[])])).toEqual(SEQUENTIAL);
    // Both workers ran calls.
    expect(new Set(workers)).toEqual(new Set([0, 1]));
  }, 60_000);
});
