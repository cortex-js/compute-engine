/**
 * CE-1776: a user function that a compiled root function literal calls
 * reads and writes the variables of the engine that the literal assigns
 * (`CompilationResult.assigns`). The function takes each such variable as
 * an input and returns the record of its value and of the new value of each
 * variable that it writes; the call rebinds the variable, in the order of the
 * program. A `Loop` carries the variables; a function given by name to an
 * operator reads them at each application. A call in a `Sum` or a `Map`
 * callback, a call that maps over a list and a recursive function that
 * writes a variable decline.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import type { Expression } from '../../src/compute-engine/global-types';

type Run = (...args: unknown[]) => unknown;

const HEAD = `let ballX: real = 0.5
let n: integer = 0
`;

function engine(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  const program = executeEpsil(ce, HEAD + source);
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return ce;
}

const tick = (ce: ComputeEngine): Expression => ce.box('tick').evaluate();

const state = (ce: ComputeEngine) => [
  ce.box('ballX').evaluate().re,
  ce.box('n').evaluate().re,
];

/** The values of `tick(2)` and `tick(3)` and the state after them, from
 *  the code and from the interpreter, each on a new engine. */
function both(source: string): { code: unknown[]; interpreted: unknown[] } {
  const ce = engine(source);
  const result = compile(tick(ce), { to: 'javascript', fallback: false });
  expect(result.success).toBe(true);
  const run = result.run as Run;
  const code = [run(2), run(3), ...state(ce)];
  const ref = engine(source);
  const interpreted = [
    ref.box(['tick', 2]).evaluate().re,
    ref.box(['tick', 3]).evaluate().re,
    ...state(ref),
  ];
  return { code, interpreted };
}

function declined(source: string): string {
  const ce = engine(source);
  const result = compile(tick(ce), { to: 'javascript' });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

describe('a user function that writes a variable of the engine', () => {
  test('the witness: a helper of the callback moves the ball', () => {
    const source = `function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
let tick = (dt: real) => moveBall(dt)`;
    const ce = engine(source);
    const result = compile(tick(ce), { to: 'javascript', fallback: false });
    expect(result.assigns).toEqual(['ballX']);
    const run = result.run as Run;
    expect([run(2), run(3), ...state(ce)]).toEqual([2.5, 5.5, 5.5, 0]);
    expect(both(source).interpreted).toEqual([2.5, 5.5, 5.5, 0]);
  });

  test('a helper declared as a lambda', () => {
    const { code, interpreted } =
      both(`let moveBall = (dt: real) => do { ballX = ballX + dt; ballX }
let tick = (dt: real) => moveBall(dt)`);
    expect(code).toEqual(interpreted);
  });

  test('two calls write in the order of the program', () => {
    const { code, interpreted } =
      both(`function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
let tick = (dt: real) => moveBall(dt) + moveBall(dt) * 10`);
    expect(code).toEqual([29.5, 85.5, 10.5, 0]);
    expect(code).toEqual(interpreted);
  });

  test('the body reads the state after the call', () => {
    const { code, interpreted } =
      both(`function moveBall(dt: real) scope { ballX = ballX + dt; 0 }
let tick = (dt: real) => do { moveBall(dt); ballX * 100 + n }`);
    expect(code).toEqual([250, 550, 5.5, 0]);
    expect(code).toEqual(interpreted);
  });

  test('a helper that calls a helper, two variables', () => {
    const { code, interpreted } =
      both(`function inner(dt: real) scope { ballX = ballX * 2 + dt; n = n + 1; 0 }
function outer(dt: real) scope { inner(dt); ballX + n }
let tick = (dt: real) => do { let a = outer(dt); a + ballX }`);
    expect(code).toEqual([7, 20, 9, 2]);
    expect(code).toEqual(interpreted);
  });

  test('a call in an arm of the body, a write in an arm of the helper', () => {
    const a = both(`function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
let tick = (dt: real) => do { if (dt > 2) { moveBall(dt) } else { ballX = -ballX }; ballX }`);
    expect(a.code).toEqual([-0.5, 2.5, 2.5, 0]);
    expect(a.code).toEqual(a.interpreted);
    const b =
      both(`function moveBall(dt: real) scope { if (dt > 2) { ballX = ballX + dt } else { n = n + 1 }; ballX + n }
let tick = (dt: real) => moveBall(dt)`);
    expect(b.code).toEqual([1.5, 4.5, 3.5, 1]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a helper of result nothing', () => {
    const { code, interpreted } =
      both(`function moveBall(dt: real) scope -> nothing { ballX = ballX + dt }
let tick = (dt: real) => do { moveBall(dt); ballX }`);
    expect(code).toEqual([2.5, 5.5, 5.5, 0]);
    expect(code).toEqual(interpreted);
  });

  test('an integer variable', () => {
    const { code, interpreted } =
      both(`function bump(dt: real) scope { n = n + 1; n * dt }
let tick = (dt: real) => bump(dt) + n`);
    // The canonical Add reads n before the call, in both.
    expect(code).toEqual([2, 7, 0.5, 2]);
    expect(code).toEqual(interpreted);
  });

  test('a helper that reads the state, twice, after writes', () => {
    const { code, interpreted } = both(`function getX() scope { ballX }
let tick = (dt: real) => do { ballX = ballX + dt; let a = getX(); ballX = ballX + dt; a + getX() }`);
    expect(code).toEqual([7, 18, 10.5, 0]);
    expect(code).toEqual(interpreted);
  });

  test('a helper that reads the state in a loop of the body', () => {
    const { code, interpreted } = both(`function getX() scope { ballX }
let tick = (dt: real) => do { let s = 0; for i in 1..3 { ballX = ballX + dt; s = s + getX() }; s + getX() }`);
    expect(code).toEqual([20, 53, 15.5, 0]);
    expect(code).toEqual(interpreted);
  });

  test('a local of the helper of the same name is not the variable', () => {
    const { code, interpreted } =
      both(`function f(dt: real) scope { let ballX = dt; ballX = ballX + 1; ballX }
let tick = (dt: real) => do { ballX = ballX + 1; f(dt) + ballX }`);
    expect(code).toEqual([4.5, 6.5, 2.5, 0]);
    expect(code).toEqual(interpreted);
  });
});

describe('a loop carries the variables that a user function writes', () => {
  const MOVE = `function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
`;
  const cases: [string, string, number[]][] = [
    [
      'a call in a for loop of the body',
      `let tick = (dt: real) => do { for i in 1..3 { moveBall(dt) }; ballX }`,
      [6.5, 15.5, 15.5, 0],
    ],
    [
      'the value of the call in the loop',
      `let tick = (dt: real) => do { let s = 0; for i in 1..3 { s = s + moveBall(dt * i) }; s + ballX }`,
      [34, 98, 30.5, 0],
    ],
    [
      'a write in a loop of the helper',
      `function f(dt: real) scope { for i in 1..3 { ballX = ballX + dt * i }; ballX }
let tick = (dt: real) => f(dt)`,
      [12.5, 30.5, 30.5, 0],
    ],
    [
      'a loop of the helper that calls a helper, two variables',
      `function f(dt: real) scope { for i in 1..3 { moveBall(dt); n = n + 1 }; ballX + n }
let tick = (dt: real) => f(dt) + f(1)`,
      [25, 61, 21.5, 12],
    ],
    [
      'nested loops',
      `let tick = (dt: real) => do { for i in 1..2 { for j in 1..2 { moveBall(dt) } }; ballX }`,
      [8.5, 20.5, 20.5, 0],
    ],
    [
      'a call in an arm in a loop',
      `let tick = (dt: real) => do { for i in 1..4 { if (i > 2) { moveBall(dt) } else { n = n + 1 } }; ballX + n }`,
      [6.5, 14.5, 10.5, 4],
    ],
    [
      'a break',
      `let tick = (dt: real) => do { for i in 1..10 { if (ballX > 6) { break }; moveBall(dt) }; ballX }`,
      [6.5, 6.5, 6.5, 0],
    ],
    [
      'a while loop',
      `let tick = (dt: real) => do { while (ballX < 6) { moveBall(dt) }; ballX }`,
      [6.5, 6.5, 6.5, 0],
    ],
  ];
  test.each(cases)('%s', (_, body, want) => {
    const { code, interpreted } = both(MOVE + body);
    expect(code).toEqual(want);
    expect(code).toEqual(interpreted);
  });
});

describe('a function given by name to an operator reads the state', () => {
  // The views read the variable `L` of the engine, so the interpreter
  // lists them at the assignment.
  const GET = `function getX(d: real) scope { ballX + d }
let L = [2, 3]
`;
  const cases: [string, string][] = [
    [
      // Before CE-1776's scan followed names, the second map reused the
      // value of the first one (6 for 10).
      'map, with writes between',
      `let tick = (dt: real) => do { ballX = 1; let A = map(getX, L); ballX = 5; let B = map(getX, L); A[1] + B[1] }`,
    ],
    [
      'map, and a call of the same function',
      `let tick = (dt: real) => do { ballX = 1; let A = map(getX, L); ballX = 5; let B = map(getX, L); A[1] + B[1] + getX(dt) }`,
    ],
    [
      'filter and reduce',
      `function pos(d: real) scope { d > ballX }
function add(a: real, b: real) scope { a + b + ballX }
let tick = (dt: real) => do { ballX = 1; let a = length(filter(L, pos)); ballX = 2; let b = reduce([dt, 1], add); a * 100 + b }`,
    ],
    [
      // The interpreter lists at the assignment a view that reads a
      // variable (`L`), so a later write does not change it.
      'a view over a variable kept in a local, read after a write',
      `let tick = (dt: real) => do { ballX = 1; let A = map(getX, L); let B = map((i) => getX(i) * dt, L); ballX = 5; A[2] + B[1] * 10 }`,
    ],
    [
      'map in a helper that writes the state',
      `function step(dt: real) scope { ballX = ballX + dt; map(getX, L)[1] }
let tick = (dt: real) => step(dt) + step(1)`,
    ],
  ];
  test.each(cases)('%s', (_, body) => {
    const { code, interpreted } = both(GET + body);
    expect(code).toEqual(interpreted);
  });
});

describe('the cases that decline', () => {
  test('a loop that declares a local of the name after the call', () => {
    // The facts of the loop body drop the name its Block declares: the
    // loop would not carry the write (2.5 for 6.5, or an IR error).
    const MOVE = `function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
`;
    const why = 'in a loop that does not carry it';
    expect(
      declined(
        MOVE +
          `let tick = (dt: real) => do { for i in 1..3 { moveBall(dt); let ballX = 1 }; ballX }`
      )
    ).toMatch(why);
    expect(
      declined(
        MOVE +
          `function f(dt: real) scope { for i in 1..3 { moveBall(dt); let ballX = 1 }; ballX }
let tick = (dt: real) => f(dt)`
      )
    ).toMatch(why);
    expect(
      declined(
        MOVE +
          `let tick = (dt: real) => do { let k = 0; while (k < 3) { moveBall(dt); k = k + 1; let ballX = 7 }; ballX }`
      )
    ).toMatch(why);
  });

  test('a call in a callback of map, in a loop', () => {
    expect(
      declined(`function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
let tick = (dt: real) => do { let s = 0; for i in 1..2 { s = s + map((x) => moveBall(x), [dt])[1] }; s }`)
    ).toMatch(/in a loop|a lazy collection whose callback/);
  });

  test('a call in a callback of map, a call that maps over a list', () => {
    expect(
      declined(`function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
let tick = (dt: real) => map((x) => moveBall(x), [dt, dt])[1]`)
    ).toMatch(/in a loop|a lazy collection whose callback/);
    expect(
      declined(`function moveBall(dt: real) scope { ballX = ballX + dt; ballX }
let tick = (dt: real) => moveBall([dt, dt])[1]`)
    ).toMatch('a call of moveBall that maps over a list');
  });

  test('a lazy view that reads the state only through a user function', () => {
    // The interpreter keeps the view lazy and reads `ballX = 5` at `A[2]`
    // (7); the code would build it at the `let` (3).
    const GET = `function getX(d: real) scope { ballX + d }
function pr(d: real) scope { d > ballX }
function mk(d: real) scope { map(getX, [d, 1]) }
`;
    const why = 'a lazy collection whose callback reads a variable of the engine through a user function';
    for (const view of [
      'map(getX, [1, 2])',
      'map(getX, 1..2)',
      'tabulate(getX, 2)',
      'map((i) => getX(i), [1, 2])',
      'filter(1..3, pr)',
      // A view over a local or a parameter stays lazy too.
      'map(getX, M)',
      'map(getX, 1..m)',
      'map(getX, [dt, 1])',
      'mk(dt)',
    ])
      expect(
        declined(
          GET +
            `let tick = (dt: real) => do { ballX = 1; let M = [dt, 1]; let m = 2; let A = ${view}; ballX = 5; A[1] + M[1] + m }`
        )
      ).toMatch(why);
  });

  test('a writer given by name to map', () => {
    // The callback of the map is a frame of a loop.
    expect(
      declined(`function setX(d: real) scope { ballX = ballX + d; ballX }
let tick = (dt: real) => map(setX, [dt, dt])[1]`)
    ).toMatch(/in a loop|a lazy collection whose callback/);
  });

  test('a recursive function', () => {
    expect(
      declined(`function moveBall(k: integer) scope -> real { ballX = ballX + 1; if (k > 0) { moveBall(k - 1) } else { ballX } }
let tick = (dt: real) => moveBall(2)`)
    ).toMatch('a recursive call of moveBall, which assigns the variable ballX');
  });

  test('a list variable', () => {
    expect(
      declined(`let L = [0, 0]
function push(dt: real) scope { L = L + [dt, dt]; 0 }
let tick = (dt: real) => do { push(dt); L[1] }`)
    ).toMatch('an assignment of L, a list, by a user function that the body calls');
  });
});
