/**
 * CE-1721: a root function literal that assigns a list of lists variable of
 * the engine (the grid of the Game of Life, updated by the timer callback of
 * a notebook animation) compiles to JavaScript.
 *
 * The code takes the grid as the host's array of arrays (the lane `rows`, as
 * an input `list<list<integer>>`, CE-1607) after the arguments, and returns
 * the list of rank 2 that a statement of the body writes. A list of lists of
 * `number` is read as one of reals, and a parameter `g: list` of a user
 * function takes such a grid whole.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { createJavaScriptRuntime } from '../../src/runtime';
import type { Expression } from '../../src/compute-engine/global-types';

type Run = (...args: unknown[]) => unknown;

function engine(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  const program = executeEpsil(ce, source);
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return ce;
}

const fn = (ce: ComputeEngine, name: string): Expression =>
  ce.box(name).evaluate();

const valueOf = (ce: ComputeEngine, name: string) =>
  ce.box(name).evaluate().json;

function compiled(e: Expression, options: object = {}) {
  const result = compile(e, { to: 'javascript', fallback: false, ...options });
  expect(result.success).toBe(true);
  return { result, run: result.run as Run };
}

function declined(e: Expression, options: object = {}): string {
  const result = compile(e, { to: 'javascript', ...options });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

/** After each of `ticks` calls of `tick` compiled and interpreted, in two
 *  engines of `source`, the value of the call and of `g` are the same. */
function sameAsInterpreter(source: string, ticks = 3, body = 'tick') {
  const ce = engine(source);
  const ref = engine(source);
  const { result, run } = compiled(fn(ce, body));
  expect(result.assigns).toEqual(['g']);
  for (let k = 0; k < ticks; k++) {
    const value = run(16);
    const expected = ref.box([body, 16]).evaluate().json;
    if (expected === 'Nothing') expect(value).toBeNaN();
    else expect(value).toEqual(expected);
    expect(valueOf(ce, 'g')).toEqual(valueOf(ref, 'g'));
  }
}

const WITNESS = `let n = 8
let g = map(i => map(j => Mod(i + j, 2), Range(1, n)), Range(1, n))
count(g: list, i: integer, j: integer) = g[i][j]
step(g: list) = map(i => map(j => 1 - count(g, i, j), Range(1, n)), Range(1, n))
let tick = (t: real) => do { g = step(g) }`;

// The Game of Life of § 1 of Tycho's animation spec, on a grid of 8 × 8.
const LIFE = `let n = 8
glider(i: integer, j: integer) = (i == 1 && j == 2) || (i == 2 && j == 3) || (i == 3 && (j == 1 || j == 2 || j == 3))
let g = map(i => map(j => if glider(i, j) { 1 } else { 0 }, Range(1, n)), Range(1, n))
wrap(k: integer) = Mod(k - 1 + n, n) + 1
count(g: list, i: integer, j: integer) = sum(map(d => g[wrap(i + d[1])][wrap(j + d[2])], [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]))
nextCell(g: list, i: integer, j: integer) = if count(g, i, j) == 3 || (count(g, i, j) == 2 && g[i][j] == 1) { 1 } else { 0 }
step(g: list) = map(i => map(j => nextCell(g, i, j), Range(1, n)), Range(1, n))
let tick = (t: real) => do { g = step(g) }`;

describe('a function that assigns a list of lists variable of the engine', () => {
  test('the witness: three ticks write the grid to the engine', () => {
    sameAsInterpreter(WITNESS);
  });

  test('the Game of Life', () => {
    sameAsInterpreter(LIFE, 4);
  });

  test('the code takes the rows after the arguments and returns the grid', () => {
    const ce = engine(WITNESS);
    const { result } = compiled(fn(ce, 'tick'));
    expect(result.shippable).toBe(false);
    const load = createJavaScriptRuntime().load({ ...result }) as Run;
    const rows = Array.from({ length: 8 }, () => Array(8).fill(1));
    const [value, grid] = load(16, rows) as [number, number[][]];
    expect(value).toBeNaN();
    expect(grid.map((row) => Array.from(row))).toEqual(
      Array.from({ length: 8 }, () => Array(8).fill(0))
    );
  });

  test.each([
    ['a read after the write', 'do { g = step(g); g[1][2] + Length(g) }'],
    ['a read before the write', 'do { let s = Length(g); g = step(g); s }'],
    ['a write of a reversed grid', 'do { g = Reverse(step(g)) }'],
    ['a literal grid', 'do { g = [[1, 2], [3, 4]] }'],
    [
      'a grid of a run-time count of rows',
      'do { g = map(i => map(j => t, Range(1, 2)), Range(1, Length(g) - 1)) }',
    ],
  ])('%s gives the interpreter its state', (_, body) => {
    sameAsInterpreter(
      `let n = 3
let g = map(i => map(j => Mod(i + j, 2), Range(1, n)), Range(1, n))
step(g: list) = map(i => map(j => 1 - g[i][j], Range(1, n)), Range(1, n))
let tick = (t: real) => ${body}`,
      2
    );
  });

  test('a write of a map that reads the grid gives the next grid', () => {
    const source = `let n = 3
let g = map(i => map(j => Mod(i + j, 2), Range(1, n)), Range(1, n))
let tick = (t: real) => do { g = map(i => map(j => 1 - g[i][j], Range(1, n)), Range(1, n)) }`;
    sameAsInterpreter(source);
    const ref = engine(source);
    ref.box(['tick', 16]).evaluate();
    expect(valueOf(ref, 'g')).toEqual([
      'List',
      ['List', 1, 0, 1],
      ['List', 0, 1, 0],
      ['List', 1, 0, 1],
    ]);
  });

  test('each call reads the grid that the engine holds', () => {
    const ce = engine(WITNESS);
    const { run } = compiled(fn(ce, 'tick'));
    ce.assign(
      'g',
      ce.box([
        'List',
        ...Array.from({ length: 8 }, () => ['List', ...Array(8).fill(1)]),
      ] as never)
    );
    run(0);
    expect(valueOf(ce, 'g')).toEqual([
      'List',
      ...Array.from({ length: 8 }, () => ['List', ...Array(8).fill(0)]),
    ]);
  });

  test('a variable that holds no list of lists throws before the call', () => {
    const ce = engine(WITNESS);
    const { run } = compiled(fn(ce, 'tick'));
    ce.assign('g', undefined);
    expect(() => run(16)).toThrow(
      'The variable "g" that the compiled function assigns holds no value'
    );
  });

  test('a grid of integers keeps its type', () => {
    const ce = engine(`let K: list<list<integer>> = [[1, 2], [3, 4]]
let up = (t: real) => do { K = [[1, 1], [1, 2]] }
let half = (t: real) => do { K = [[0.5, 1], [1, 2]] }`);
    compiled(fn(ce, 'up')).run(0);
    expect(valueOf(ce, 'K')).toEqual(['List', ['List', 1, 1], ['List', 1, 2]]);
    // The interpreter refuses a list of lists of reals for the variable.
    expect(declined(fn(ce, 'half'))).toMatch(
      'written to a list of lists of integer elements'
    );
  });

  test.each([
    ['a write in a branch', 'do { if t > 20 { g = step(g) }; 0 }'],
    ['a write in a loop', 'do { for i in 1..2 { g = step(g) }; 0 }'],
    ['AddTo of the grid', 'do { g += 1 }'],
  ])('%s declines', (_, body) => {
    const ce = engine(`let n = 3
let g = map(i => map(j => Mod(i + j, 2), Range(1, n)), Range(1, n))
step(g: list) = map(i => map(j => 1 - g[i][j], Range(1, n)), Range(1, n))
let tick = (t: real) => ${body}`);
    expect(declined(fn(ce, 'tick'))).toMatch(
      'an assignment of g, a list of lists, other than by an Assign that is a statement of the body'
    );
  });

  test.each([
    ['a second write that reads the first', 'do { g = step(g); g = step(g) }'],
    ['a write of rows of two lengths', 'do { g = [[1, 2], [3]] }'],
    ['a write of a list', 'do { g = [1, 2] }'],
  ])('%s declines', (_, body) => {
    const ce = engine(`let n = 3
let g = map(i => map(j => Mod(i + j, 2), Range(1, n)), Range(1, n))
step(g: list) = map(i => map(j => 1 - g[i][j], Range(1, n)), Range(1, n))
let tick = (t: real) => ${body}`);
    declined(fn(ce, 'tick'));
  });

  test("the mode 'complex' declines a grid of numbers", () => {
    const ce = engine(WITNESS);
    expect(declined(fn(ce, 'tick'), { mode: 'complex' })).toMatch(
      'an assignment of g, of type list<list<number>>'
    );
  });
});

describe('a list of lists of numbers, and a parameter g: list', () => {
  test('an input list<list<number>> is the host rows of reals', () => {
    const ce = engine('let f = (g: list<list<number>>) => g[2][1] + 0.5');
    const { run } = compiled(fn(ce, 'f'));
    expect(
      run([
        [1, 2],
        [3.25, 4],
      ])
    ).toBe(3.75);
    // An element there can be a complex number.
    expect(declined(fn(ce, 'f'), { mode: 'complex' })).toMatch(
      'the input g of type list<list<number>>'
    );
  });

  test('a parameter g: list takes the rows whole', () => {
    const source = `let n = 2
count(g: list, i: integer, j: integer) = g[i][j]
step(g: list) = map(i => map(j => 1 - count(g, i, j), Range(1, n)), Range(1, n))
let f = (g: list<list<integer>>) => step(g)`;
    const ce = engine(source);
    const { run } = compiled(fn(ce, 'f'));
    const g = [
      [1, 0],
      [0, 0],
    ];
    expect(run(g)).toEqual([
      [0, 1],
      [1, 1],
    ]);
    // The interpreter can hold the value lazily (a `Map`): its elements.
    const value = ce
      .box(['f', ['List', ['List', 1, 0], ['List', 0, 0]]] as never)
      .evaluate();
    expect(
      [...value.each()].map((row) => [...row.each()].map((x) => x.re))
    ).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});
