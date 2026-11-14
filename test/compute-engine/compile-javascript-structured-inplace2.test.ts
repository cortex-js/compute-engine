import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  lowerStructuredFragment,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import { IN_PLACE_WORK, inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import { hostArrays } from '../../src/compute-engine/compilation/structured-execution';
import type {
  IROperation,
  IRProgram,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The copy of a carried list before its loop (`withOwnedCopies()` in
// structured-in-place.ts) and the update in place of a row of a list of
// lists that owns its rows (rules 4 to 6 of `inPlaceUpdates()`), on the
// structured route of the JavaScript compiler (the `numeric-kernel`
// profile). Result section of
// docs/plans/2026-11-10-structured-ir-loops-and-lists.md.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`) with the same shape at every depth, or both calls throw; the
// inputs must be the same after the call as a deep copy taken before it, at
// every depth; a second call with the same inputs gives the same value;
// after the host writes into every array of the result, a third call with
// new inputs gives the value again. `copies` states whether the emitted
// code of the profile still calls the copying `_SYS.replaceAt`: false for a
// pattern of the rule (each pass updates in place), true for a pattern that
// must copy.

const EXISTING = { cse: false, constantFold: false, fallback: false, mode: 'strict' } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false, mode: 'strict' } as const;

type Arg = number | Arg[];

const THROWS = Symbol('throws');
function run(result: CompilationResult<'javascript'>, args: readonly Arg[]): unknown {
  try {
    return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
  } catch {
    return THROWS;
  }
}

/** The same doubles and the same shape, at every depth. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return a === b;
}

/** Write into every array of `value`, at every depth. */
function scribble(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (let k = 0; k < value.length; k++) {
    scribble(value[k]);
    if (!Array.isArray(value[k])) value[k] = 12345;
  }
  value.push(54321);
}

function engineWith(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  expect(executeEpsil(ce, source).diagnostics).toEqual([]);
  return ce;
}

function literal(ce: ComputeEngine, name: string): Expression {
  const fn = (ce.lookupDefinition(name) as { operator?: { _lambdaLiteral?: Expression } } | undefined)
    ?.operator?._lambdaLiteral;
  if (fn === undefined) throw new Error(`no function literal for ${name}`);
  return fn;
}

type Pattern = {
  readonly name: string;
  readonly source: string;
  readonly entry?: string;
  readonly args: readonly (readonly Arg[])[];
  /** Whether the code of the profile still calls `_SYS.replaceAt`. */
  readonly copies: boolean;
  /** Whether the code of the profile writes in place (default: true). */
  readonly inPlace?: boolean;
  /** The value, where the existing compiler throws (its copy of two levels,
   *  `_SYS.ownedCopyLevels`, reads `slice` of an absent row). */
  readonly expected?: (args: readonly Arg[]) => unknown;
};

/** Compile the pattern with both compilers, compare them on each list of
 *  arguments, and return the code of the profile. */
function check(pattern: Pattern): string {
  const ce = engineWith(pattern.source);
  const expr = literal(ce, pattern.entry ?? 'f');
  const result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
  const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
  for (const args of pattern.args) {
    const inputs = structuredClone(args) as Arg[];
    const value = run(result, inputs);
    const existingValue = run(existing, structuredClone(args) as Arg[]);
    if (pattern.expected !== undefined) expect(existingValue).toBe(THROWS);
    const reference = pattern.expected?.(args) ?? existingValue;
    expect([args, value, same(value, reference)]).toEqual([args, value, true]);
    expect([args, same(inputs, args)]).toEqual([args, true]);
    const again = run(result, inputs);
    expect([args, same(again, value)]).toEqual([args, true]);
    expect([args, same(inputs, args)]).toEqual([args, true]);
    scribble(value);
    scribble(again);
    expect([args, same(run(result, structuredClone(args) as Arg[]), reference)]).toEqual([args, true]);
  }
  expect([pattern.name, result.code.includes('_SYS.replaceAt(')]).toEqual([pattern.name, pattern.copies]);
  expect([pattern.name, result.code.includes('_SYS.replaceAtInPlace(')]).toEqual([
    pattern.name,
    pattern.inPlace ?? true,
  ]);
  return result.code;
}

const FLAT: Arg[] = [[], [1], [1, 2, 3], [-0, 1e300, 5e-324, 7]];
const MATRICES: Arg[] = [[[1, 2], [3, 4]], [[-0, 0.5, 1e300], [7, -2, 5e-324]], [[2]], [[1], [2, 3]]];
const eachN = (lists: readonly Arg[], ns: readonly number[] = [1, 2, 3]) =>
  lists.flatMap((l) => ns.map((n) => [l, n]));

//
// The patterns of the rule: one copy before the loop, each pass in place
//

const OWNED: Pattern[] = [
  {
    name: 'the flat witness: a local from an input',
    source: `function f(L: list<real>, n: integer) -> list<real> {
  let A = L
  for k in 1..n { A = replaceAt(A, k, A[k] + 1) }
  A
}`,
    args: eachN(FLAT),
    copies: false,
  },
  {
    name: 'the nested witness: a local from an input, an element of a row',
    source: `function f(M: list<list<real>>, n: integer) -> list<list<real>> {
  let S = M
  for k in 1..n { S = replaceAt(S, 1, 1, S[1][1] + k) }
  S
}`,
    args: eachN(MATRICES),
    copies: false,
  },
  {
    name: 'an element of each row of an input',
    source: `function f(M: list<list<real>>) -> list<list<real>> {
  let S = M
  for k in 1..length(M) { S = replaceAt(S, k, -1, S[k][-1] * 2) }
  S
}`,
    args: MATRICES.map((m) => [m]),
    copies: false,
  },
  {
    name: 'rows of a literal: no copy, the rows in place',
    source: `function f(n: integer) -> list<list<real>> {
  let S = [[0 for j in 1..3] for i in 1..3]
  for k in 1..n { S = replaceAt(S, 1, 1, S[1][1] + k) }
  S
}`,
    args: [[1], [3], [5]],
    copies: false,
  },
  {
    name: 'a captured list (a constant of the program)',
    source: `const C = [1, 2, 3]
function f(n: integer) -> list<real> {
  let A = C
  for k in 1..n { A = replaceAt(A, k, A[k] * 2) }
  A
}`,
    args: [[1], [3], [4]],
    copies: false,
  },
  {
    name: 'the list parameter of a helper',
    source: `function fill(L: list<real>, n: integer) -> list<real> {
  let R = L
  for k in 1..n { R = replaceAt(R, k, 0.5 * k) }
  R
}
function f(L: list<real>, n: integer) -> real { fill(L, n)[1] + L[1] }`,
    args: eachN(FLAT),
    copies: false,
  },
  {
    name: 'nested loops: the outer copy serves the inner loop',
    source: `function f(L: list<real>, n: integer) -> list<real> {
  let A = L
  for i in 1..n { for k in 1..i { A = replaceAt(A, k, A[k] + i) } }
  A
}`,
    args: eachN(FLAT),
    copies: false,
  },
  {
    name: 'nested loops over the elements of a matrix',
    source: `function f(M: list<list<real>>) -> list<list<real>> {
  let S = M
  for i in 1..length(M) { for j in 1..2 { S = replaceAt(S, i, j, S[i][j] + i*j) } }
  S
}`,
    args: MATRICES.map((m) => [m]),
    copies: false,
  },
  {
    name: 'a loop that breaks with the list',
    source: `function f(L: list<real>, x: real) -> list<real> {
  let A = L
  for k in 1..length(L) {
    if A[k] > x { break }
    A = replaceAt(A, k, A[k] + 10)
  }
  A
}`,
    args: FLAT.flatMap((l) => [0, 2, 1e301].map((x) => [l, x])),
    copies: false,
  },
  {
    name: 'the initial value read after the loop by another local',
    source: `function f(L: list<real>, n: integer) -> real {
  let A = L
  let B = L
  for k in 1..n { A = replaceAt(A, k, 9) }
  B[1] + A[1] + L[n]
}`,
    args: eachN(FLAT),
    copies: false,
  },
  {
    name: 'an alias before the loop, both updated',
    source: `function f(L: list<real>, n: integer) -> list<real> {
  let A = L
  let B = A
  for k in 1..n {
    A = replaceAt(A, k, 1)
    B = replaceAt(B, k, B[k] + A[k])
  }
  [A[1], B[1], L[1]]
}`,
    args: eachN(FLAT),
    copies: false,
  },
  {
    name: 'a list returned from a helper and updated by the caller',
    source: `function id(L: list<real>) -> list<real> { L }
function f(L: list<real>, n: integer) -> list<real> {
  let A = id(L)
  for k in 1..n { A = replaceAt(A, k, A[k] - 1) }
  A
}`,
    args: eachN(FLAT),
    copies: false,
  },
  {
    name: 'a row read stored in a local, the row updated through S, the local read after',
    source: `function f(n: integer) -> real {
  let S = [[1, 2], [3, 4]]
  let r = S[1]
  for k in 1..n { S = replaceAt(S, 1, 1, S[1][1] + k) }
  r[1] * 100 + S[1][1]
}`,
    args: [[1], [3]],
    copies: false,
  },
  {
    name: 'a row placed twice: the copy of two levels separates the rows',
    source: `function f(n: integer) -> list<list<real>> {
  let R = [1, 2]
  let S = [R, R]
  for k in 1..n { S = replaceAt(S, 1, 1, S[1][1] + k) }
  S
}`,
    args: [[1], [2]],
    copies: false,
  },
  {
    name: 'a comprehension that repeats a row',
    source: `function f(n: integer) -> list<list<real>> {
  let R = [1, 2]
  let S = [R for i in 1..3]
  for k in 1..n { S = replaceAt(S, k, 2, S[k][2] * 3) }
  S
}`,
    args: [[1], [3]],
    copies: false,
  },
  {
    name: 'the rows of a Reverse of an input',
    source: `function f(M: list<list<real>>, n: integer) -> real {
  let S = reverse(M)
  for k in 1..n { S = replaceAt(S, 1, 1, S[1][1] + k) }
  S[1][1] + M[length(M)][1]
}`,
    args: eachN(MATRICES),
    copies: false,
  },
  {
    name: 'a straight-line update of the rows of a literal',
    source: `function f(x: real) -> list<list<real>> {
  let S = [[1.5, 2], [3, 4]]
  S = replaceAt(S, 1, 2, x)
  S = replaceAt(S, 2, 1, S[1][2] + x)
  S
}`,
    args: [[0.5], [-0]],
    copies: false,
  },
  {
    name: 'a literal of row reads, one of them absent: the copy of two levels keeps the absent row',
    source: `function f(M: list<list<real>>) -> list<list<real>> {
  let S = [M[5], M[1]]
  for k in 1..1 { S = replaceAt(S, 2, 1, 7) }
  S
}`,
    args: MATRICES.map((m) => [m]),
    copies: false,
    expected: ([m]) => [undefined, [7, ...(m as number[][])[0].slice(1)]],
  },
  {
    name: 'a comprehension of row reads that runs past the last row',
    source: `function f(M: list<list<real>>) -> list<list<real>> {
  let S = [M[j] for j in 1..3]
  for k in 1..1 { S = replaceAt(S, 1, 1, 7) }
  S
}`,
    args: MATRICES.map((m) => [m]),
    copies: false,
    expected: ([m]) => {
      const rows = m as number[][];
      return [[7, ...rows[0].slice(1)], rows[1], rows[2]];
    },
  },
];

describe('one copy before the loop, then each pass in place', () => {
  test.each(OWNED.map((p) => [p.name, p] as const))('%s', (_, pattern) => {
    check(pattern);
  });

  test('the code of the witnesses', () => {
    const flat = check(OWNED[0]);
    expect(flat).toContain('let _tv2 = L?.slice();');
    expect(flat).toContain('_tv2 = _SYS.replaceAtInPlace(_tv2, _tv3, ');
    const nested = check(OWNED[1]);
    expect(nested).toContain('let _tv2 = M?.map((_r) => _r?.slice());');
    expect(nested).toContain('_tv2 = _SYS.replaceAtInPlace(_tv2, 1, _SYS.replaceAtInPlace(');
    // From rows of a literal: no copy at all.
    expect(check(OWNED[3])).not.toContain('slice()');
  });
});

//
// The patterns that must copy
//

const COPIES: Pattern[] = [
  {
    name: 'a helper call reads the list in the pass',
    source: `function g(A: list<real>) -> real { A[1] + length(A) }
function f(L: list<real>, n: integer) -> list<real> {
  let A = L
  for k in 1..n { A = replaceAt(A, k, g(A)) }
  A
}`,
    args: eachN(FLAT),
    copies: true,
    inPlace: false,
  },
  {
    name: 'a branch writes the input to the carried list',
    source: `function f(L: list<real>, n: integer) -> list<real> {
  let A = L
  for k in 1..n {
    if k == 2 { A = L }
    A = replaceAt(A, k, A[k] + 1)
  }
  A
}`,
    args: eachN(FLAT),
    copies: true,
    inPlace: false,
  },
  {
    // A `Which` of lists is not in the profile (it declines).
    name: 'a list carried through an If expression that can give the input',
    source: `function f(L: list<real>, n: integer) -> list<real> {
  let A = L
  for k in 1..n { A = if k == 2 { L } else { replaceAt(A, k, A[k] + 1) } }
  A
}`,
    args: eachN(FLAT),
    copies: true,
    inPlace: false,
  },
  {
    name: 'a row swap in the pass, then an element of a row',
    source: `function f(M: list<list<real>>, n: integer) -> list<list<real>> {
  let S = M
  for k in 1..n {
    S = replaceAt(replaceAt(S, 1, S[2]), 2, S[1])
    S = replaceAt(S, 1, 1, S[1][1] + k)
  }
  S
}`,
    args: eachN(MATRICES.filter((m) => (m as Arg[]).length >= 2)),
    copies: true,
  },
  {
    name: 'a row of an input written into the list in the pass, then updated',
    source: `function f(M: list<list<real>>, n: integer) -> list<list<real>> {
  let S = [[0.5, 0], [0, 0]]
  for k in 1..n {
    S = replaceAt(S, 1, M[1])
    S = replaceAt(S, 1, 1, S[1][1] + k)
  }
  [S[1], M[1]]
}`,
    args: eachN(MATRICES),
    copies: true,
  },
  {
    name: 'a row placed at another index: the rows are shared',
    source: `function f(n: integer) -> list<list<real>> {
  let S = [[1, 2], [3, 4]]
  for k in 1..n { S = replaceAt(S, 2, replaceAt(S[1], 1, S[1][1] + k)) }
  S
}`,
    args: [[1], [2]],
    copies: true,
  },
  {
    name: 'a Take of a literal shares its rows; the literal is read after',
    source: `function f(x: real) -> real {
  let T = [[1.5, 2], [3, 4]]
  let S = take(T, 1)
  S = replaceAt(S, 1, 1, x)
  T[1][1] * 100 + S[1][1]
}`,
    args: [[0.5], [7]],
    // The outer array of the result of `take` is new: written in place.
    copies: true,
  },
  {
    name: 'a Join of a literal and itself: one row twice',
    source: `function f(x: real) -> list<list<real>> {
  let T = [[1.5, 2]]
  let S = join(T, T)
  S = replaceAt(S, 1, 1, x)
  S
}`,
    args: [[0.5]],
    copies: true,
  },
  {
    name: 'an update of a list made outside a lambda that Map runs for each element',
    source: `function f(L: list<real>) -> real {
  let A = [1, 2, 3]
  sum(map(v => sum(replaceAt(A, 1, A[1] + v)), L))
}`,
    args: FLAT.map((l) => [l]),
    copies: true,
    inPlace: false,
  },
  {
    name: 'a row read kept in a local before a straight-line update, read after it',
    source: `function f(x: real) -> real {
  let S = [[1.5, 2], [3, 4]]
  let r = S[1]
  S = replaceAt(S, 1, 1, x)
  r[1] * 100 + S[1][1]
}`,
    args: [[0.5]],
    copies: true,
  },
];

describe('the patterns that copy', () => {
  test.each(COPIES.map((p) => [p.name, p] as const))('%s', (_, pattern) => {
    check(pattern);
  });

  test('a row placed twice on each outer pass: one copy of one level, before the outer loop', () => {
    // A copy of every row in each outer pass would cost rows × columns per
    // pass to save two row copies: the inner loop keeps copying its row.
    const code = check({
      name: 'the outer loop places a row twice',
      source: `function f(M: list<list<real>>, n: integer) -> list<list<real>> {
  let S = M
  for i in 1..n {
    for j in 1..2 { S = replaceAt(S, 1, j, S[1][j] + i) }
    S = replaceAt(S, 2, S[1])
  }
  S
}`,
      args: eachN(MATRICES.filter((m) => (m as Arg[]).length >= 2 && (m as Arg[][])[0].length >= 2)),
      copies: true,
    });
    expect(code.split('?.slice()').length - 1).toBe(1);
    expect(code).not.toContain('?.map(');
    expect(code.indexOf('?.slice()')).toBeLessThan(code.indexOf('for ('));
  });
});

//
// The cost of the analysis
//

describe('the cost of the analysis', () => {
  const STEP = '    S = if c { replaceAt(S, 1, 1, S[1][1] + 1) } else { S }';
  const compileChain = (k: number, inLoop: boolean) => {
    const steps = Array.from({ length: k }, () => STEP).join('\n');
    const source = inLoop
      ? `function f(M: list<list<real>>, c: boolean) -> list<list<real>> {\n  let S = M\n  for i in 1..3 {\n${steps}\n  }\n  S\n}`
      : `function f(M: list<list<real>>, c: boolean) -> list<list<real>> {\n  let S = [[1.5, 2], [3, 4]]\n${steps}\n  S\n}`;
    const expr = literal(engineWith(source), 'f');
    IN_PLACE_WORK.evaluations = 0;
    const start = performance.now();
    const result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    return { result, ms: performance.now() - start, evaluations: IN_PLACE_WORK.evaluations };
  };

  test.each([false, true])('a chain of conditional row updates (in a loop: %s) is analyzed in linear time', (inLoop) => {
    const small = compileChain(20, inLoop);
    const large = compileChain(40, inLoop);
    // Each update is in place, and the input is not written.
    expect(large.result.code).not.toContain('_SYS.replaceAt(');
    const M = [[1, 2], [3, 4]];
    expect(run(large.result, [M, true])).toEqual([[inLoop ? 121 : 41.5, 2], [3, 4]]);
    expect(M).toEqual([[1, 2], [3, 4]]);
    // The answers computed grow with the program, not with its paths. The
    // time bound is a hang guard: far above the time of the work and above a
    // stall of a worker in a full run.
    expect(large.evaluations).toBeLessThan(2.5 * small.evaluations);
    expect(large.evaluations).toBeLessThan(20_000);
    expect(large.ms).toBeLessThan(30_000);
  });
});

//
// The operation `copy` in the representation
//

const OPTIONS = { cse: false, constantFold: false } as const;

function allOperations(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...(op.kind === 'if'
      ? [...allOperations(op.then), ...allOperations(op.else)]
      : op.kind === 'loop' || op.kind === 'build' || op.kind === 'seeded'
        ? allOperations(op.body)
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest.flatMap(allOperations)
          : []),
  ]);
}

describe('the copy before a loop in the representation', () => {
  const lowered = (source: string, name = 'f') => {
    const ce = engineWith(source);
    const preparation = new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
      literal(ce, name),
      OPTIONS
    );
    return { program: lowerStructuredFragment(preparation), nodes: preparedNodesOf(preparation) };
  };

  test('the copy is the initial value of the loop, and every update of the body is in place', () => {
    const { program } = lowered(OWNED[1].source);
    const operations = allOperations(program.root);
    const copy = operations.find((op) => op.kind === 'copy');
    const loop = operations.find((op) => op.kind === 'loop');
    expect([copy?.kind === 'copy' ? copy.levels : undefined, loop?.operands[2].id]).toEqual([2, copy?.result?.id]);
    const updates = operations.filter((op) => op.kind === 'replace-at');
    expect(updates).toHaveLength(2);
    const inPlace = inPlaceUpdates(program);
    expect(updates.every((op) => inPlace.has(op))).toBe(true);
  });

  test('no copy for a loop that only reads the list, or whose list the program owns', () => {
    for (const source of [
      `function f(L: list<real>) -> real {
  let s = 0
  for k in 1..length(L) { s = s + L[k] }
  s
}`,
      `function f(n: integer) -> list<real> {
  let A = [0 for j in 1..n]
  for k in 1..n { A = replaceAt(A, k, k) }
  A
}`,
    ])
      expect(allOperations(lowered(source).program.root).some((op) => op.kind === 'copy')).toBe(false);
  });

  test('the guard of the execution analysis follows the rows of the host in other lists', () => {
    // A wrong set of updates in place, made by hand: the update of the row
    // of each list below writes an array of the host, and `hostArrays()`
    // reports it (`inPlaceUpdates()` copies each of them).
    for (const value of ['[M[1], M[2]]', '[M[j] for j in 1..2]', 'take(M, 2)', 'reverse(M)', 'join(M, M)']) {
      const { program } = lowered(`function f(M: list<list<real>>, x: real) -> list<list<real>> {
  let S = ${value}
  S = replaceAt(S, 1, 1, x)
  S
}`);
      const updates = allOperations(program.root).filter((op) => op.kind === 'replace-at');
      const row = updates.find((op) => String(op.result!.type) === 'list<real>')!;
      expect([value, inPlaceUpdates(program).has(row)]).toEqual([value, false]);
      expect([value, hostArrays(program, new Set([row])).has(row.operands[0].id)]).toEqual([value, true]);
    }
    // A copy of one level of the input in place of the copy of two levels.
    const { program } = lowered(OWNED[1].source);
    const oneLevel: IRProgram = {
      ...program,
      root: {
        ...program.root,
        operations: program.root.operations.map((op) =>
          op.kind === 'copy' ? ({ ...op, levels: 1 } as IROperation) : op
        ),
      },
    };
    const row = allOperations(oneLevel.root).find(
      (op) => op.kind === 'replace-at' && String(op.result!.type) === 'list<real>'
    )!;
    expect(hostArrays(oneLevel, new Set([row])).has(row.operands[0].id)).toBe(true);
    // With the copy of two levels, the row is the program's own.
    expect(hostArrays(program, inPlaceUpdates(program)).has(row.operands[0].id)).toBe(false);
  });

  test('the verifier checks the copy', () => {
    const { program, nodes } = lowered(OWNED[0].source);
    const replaceCopy = (f: (op: IROperation) => IROperation): IRProgram => ({
      ...program,
      root: {
        ...program.root,
        operations: program.root.operations.map((op) => (op.kind === 'copy' ? f(op) : op)),
      },
    });
    expect(() => verifyJavaScriptProgram(program, nodes)).not.toThrow();
    // Two levels of a list of reals.
    expect(() => verifyJavaScriptProgram(replaceCopy((op) => ({ ...op, levels: 2 }) as IROperation), nodes)).toThrow(
      /copies 2 levels/
    );
    // A result of another type than the operand.
    expect(() =>
      verifyJavaScriptProgram(
        replaceCopy((op) => ({ ...op, result: { ...op.result!, type: 'real', representation: 'number' } }) as IROperation),
        nodes
      )
    ).toThrow();
    // An effect.
    expect(() =>
      verifyJavaScriptProgram(replaceCopy((op) => ({ ...op, effect: 'effectful' }) as IROperation), nodes)
    ).toThrow();
  });
});

//
// Integrals with no closed form: the body of a `routine` runs at each point
// that the quadrature samples
//

describe('the integrand of a numeric integral', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('L', 'list<real>');
  ce.declare('a', 'real');
  type Json = MathJsonExpression;
  const F = (x: Json): Json => ['Sqrt', ['Add', 1, ['Power', x, 4]]];
  const loopOver = (update: Json): Json => ['Loop', update, ['Element', 'k', ['Range', 1, ['Length', 'L']]]];
  const POINTS = [
    { L: [0.5, 1.5, -2], a: 1.25 },
    { L: [3], a: -0.75 },
    { L: [-0, 1e-3, 7, 2], a: 2 },
  ];

  /** The profile and the existing compiler give the same doubles at each
   *  point, the input is not written, and a second call gives the value
   *  again; the code of the profile. */
  const agree = (json: Json): string => {
    const expr = ce.box(json);
    const result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    const call = (r: CompilationResult<'javascript'>, vars: object) =>
      (r.run as unknown as (v: object) => unknown)(vars);
    for (const point of POINTS) {
      const vars = structuredClone(point);
      const value = call(result, vars);
      expect([point, same(value, call(existing, structuredClone(point)))]).toEqual([point, true]);
      expect(vars).toEqual(point);
      expect(same(call(result, vars), value)).toBe(true);
    }
    return result.code;
  };

  test('a list updated in place before the integral, read by the integrand', () => {
    // The integrand, called at each sample, reads the final array of the
    // loop, after its last write.
    const code = agree([
      'Block',
      ['Declare', 'A', "'list<real>'", 'L'],
      loopOver(['Assign', 'A', ['ReplaceAt', 'A', 'k', ['Add', ['At', 'A', 'k'], 1]]]),
      ['Integrate', F(['Multiply', 't', ['At', 'A', 1]]), ['Limits', 't', 0, 'a']],
    ] as Json);
    expect(code).toContain('_SYS.integrate(');
    expect(code).toContain('?.slice()');
    expect(code).not.toContain('_SYS.replaceAt(');
  });

  test('a list defined outside the integrand and updated in it is copied at each sample', () => {
    const code = agree([
      'Block',
      ['Declare', 'A', "'list<real>'", ['List', 1.5, 2.5]],
      ['Integrate', F(['Add', 't', ['Sum', ['ReplaceAt', 'A', 1, ['Add', ['At', 'A', 1], 't']]]]), ['Limits', 't', 0, 'a']],
    ] as Json);
    expect(code).toContain('_SYS.integrate(');
    expect(code).toContain('_SYS.replaceAt(');
    expect(code).not.toContain('_SYS.replaceAtInPlace(');
  });

  test('a loop in the integrand that carries a list from an input is not in the profile', () => {
    // Loops in an integrand decline on both compilers
    // (docs/plans/2026-11-11-structured-numeric-calculus.md). When they are
    // admitted, a copy before such a loop has one level and is made in the
    // body, at each sample (`withOwnedCopies()`).
    const expr = ce.box([
      'Integrate',
      [
        'Block',
        ['Declare', 'A', "'list<real>'", 'L'],
        loopOver(['Assign', 'A', ['ReplaceAt', 'A', 'k', ['Multiply', ['At', 'A', 'k'], 't']]]),
        F(['Add', 't', ['At', 'A', 1]]),
      ],
      ['Limits', 't', 0, 'a'],
    ] as Json);
    expect(() => compile(expr, PROFILE as never)).toThrow(/numeric-kernel/);
  });
});
