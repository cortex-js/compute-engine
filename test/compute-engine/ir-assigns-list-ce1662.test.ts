/**
 * CE-1662: a root function literal that assigns a list variable of the
 * engine (the state of an animation whose timer callback updates a list)
 * compiles to JavaScript, as one that assigns a real does (CE-1620).
 *
 * The variable is a list local of a run-time length that the body writes
 * whole: the code takes the list after the arguments and returns its new
 * value, whose length can differ. `run()` reads the list in the engine at
 * each call and writes the new list back, as an evaluation of the call does.
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

function compiled(e: Expression) {
  const result = compile(e, { to: 'javascript', fallback: false });
  expect(result.success).toBe(true);
  return { result, run: result.run as Run };
}

function declined(e: Expression): string {
  const result = compile(e, { to: 'javascript' });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

/** The value of `name` after `calls` interpreted calls of `f`, in a fresh
 *  engine of `source`, and the value of each call. */
function interpreted(
  source: string,
  f: string,
  name: string,
  args: number[]
): { state: unknown; values: unknown[] } {
  const ce = engine(source);
  const values = args.map((t) => ce.box([f, t]).evaluate().json);
  return { state: valueOf(ce, name), values };
}

describe('a function that assigns a list variable of the engine', () => {
  const SOURCE = `let L = [0, 0, 0]
let M = [0, 0, 0]
let addList = (t: real) => do { L = L + [1, 2, 3] }
let setElement = (t: real) => do { M[2] = M[2] + 1 }`;

  test('the witness: three ticks write the list to the engine', () => {
    const ce = engine(SOURCE);
    const add = compiled(fn(ce, 'addList'));
    expect(add.result.assigns).toEqual(['L']);
    expect(add.result.shippable).toBe(false);
    for (let k = 0; k < 3; k++) expect(add.run(16)).toBeNaN();
    expect(valueOf(ce, 'L')).toEqual(['List', 3, 6, 9]);
    const set = compiled(fn(ce, 'setElement')).run;
    for (let k = 0; k < 3; k++) set(16);
    expect(valueOf(ce, 'M')).toEqual(['List', 0, 3, 0]);
    expect(interpreted(SOURCE, 'addList', 'L', [16, 16, 16]).state).toEqual([
      'List',
      3,
      6,
      9,
    ]);
    expect(interpreted(SOURCE, 'setElement', 'M', [16, 16, 16]).state).toEqual([
      'List',
      0,
      3,
      0,
    ]);
  });

  test.each([
    ['an append', 'do { L = Append(L, t) }'],
    ['a spread', 'do { L = [...L, t] }'],
    ['a list of no element', 'do { if t > 20 { L = [] }; Length(L) }'],
    ['a loop that appends', 'do { for i in 1..2 { L = Append(L, i) }; 0 }'],
    [
      'two arms of two lengths',
      'do { if t > 20 { L = Append(L, t) } else { L = L * 2 }; 0 }',
    ],
    [
      'a loop over the list, then an append',
      'do { let c = 0; for x in L { c = c + x }; L = Append(L, c); c }',
    ],
    ['the list as the value', 'do { L = L + 1; L }'],
    ['an element after a write', 'do { L = Reverse(L); L[1] }'],
    ['AddTo of the list', 'do { L += 1; Sum(L) }'],
  ])('%s gives the interpreter its state', (_, body) => {
    const source = `let L = [1, 2, 3]\nlet f = (t: real) => ${body}`;
    const args = [16, 32, 48];
    const expected = interpreted(source, 'f', 'L', args);
    const ce = engine(source);
    const { run } = compiled(fn(ce, 'f'));
    const values = args.map((t) => run(t));
    // The elements: the interpreter can hold the list lazily
    // (`Reverse(Reverse(List(…)))`).
    const elements = (x: Expression) => [...x.each()].map((y) => y.json);
    expect(valueOf(ce, 'L')).toEqual([
      'List',
      ...elements(ce.box(expected.state as never)),
    ]);
    expect(values.map((v) => (Number.isNaN(v) ? 'Nothing' : v))).toEqual(
      expected.values.map((v) =>
        Array.isArray(v) && v[0] === 'List' ? v.slice(1) : v
      )
    );
  });

  test('a list of booleans and a list of reals', () => {
    const ce = engine(`let B = [true, false]
let R = [0.5, 1.5]
let flip = (t: real) => do { B[1] = !B[1] }
let move = (t: real) => do { R[1] = R[1] + t / 1000 }`);
    const flip = compiled(fn(ce, 'flip')).run;
    flip(0);
    expect(valueOf(ce, 'B')).toEqual(['List', 'False', 'False']);
    flip(0);
    expect(valueOf(ce, 'B')).toEqual(['List', 'True', 'False']);
    const move = compiled(fn(ce, 'move')).run;
    move(16);
    expect(valueOf(ce, 'R')).toEqual(['List', 0.516, 1.5]);
  });

  test('each call reads the list that the engine holds', () => {
    const ce = engine(`let L = [1, 2, 3]
let f = (t: real) => do { L = Rest(L); Length(L) }`);
    const { run } = compiled(fn(ce, 'f'));
    expect(run(0)).toBe(2);
    // An interpreted call holds the list lazily: `Rest(List(2, 3))`.
    ce.box(['f', 0]).evaluate();
    expect(run(0)).toBe(0);
    expect(valueOf(ce, 'L')).toEqual(['List']);
    ce.assign('L', ce.box(['List', 7, 8]));
    expect(run(0)).toBe(1);
    expect(valueOf(ce, 'L')).toEqual(['List', 8]);
  });

  test('a list and a scalar state together', () => {
    const ce = engine(`let L = [1, 2, 3]
let c = 0
let f = (t: real) => do { L = L + 1; c = c + Sum(L); c }`);
    const { result, run } = compiled(fn(ce, 'f'));
    expect(result.assigns).toEqual(['L', 'c']);
    expect(run(0)).toBe(9);
    expect(run(0)).toBe(21);
    expect(valueOf(ce, 'L')).toEqual(['List', 3, 4, 5]);
    expect(valueOf(ce, 'c')).toBe(21);
  });

  test('the code takes the list after the arguments', () => {
    const ce = engine(SOURCE);
    const { result } = compiled(fn(ce, 'addList'));
    const load = createJavaScriptRuntime().load({ ...result }) as Run;
    const [value, list] = load(16, [1, 1, 1]) as [number, ArrayLike<number>];
    expect(value).toBeNaN();
    expect(Array.from(list)).toEqual([2, 3, 4]);
    // The engine is not read or written by the loaded code.
    expect(valueOf(ce, 'L')).toEqual(['List', 0, 0, 0]);
  });

  test('a variable that holds no list throws before the call', () => {
    const ce = engine(SOURCE);
    const { run } = compiled(fn(ce, 'addList'));
    ce.assign('L', undefined);
    expect(() => run(16)).toThrow(
      'The variable "L" that the compiled function assigns holds no value'
    );
  });

  test('a list of integers keeps its type', () => {
    const ce = engine(`let K: list<integer> = [1, 2]
let up = (t: real) => do { K = K + 1 }
let half = (t: real) => do { K = K + 0.5 }`);
    compiled(fn(ce, 'up')).run(0);
    expect(valueOf(ce, 'K')).toEqual(['List', 2, 3]);
    // The interpreter refuses a list of reals for the variable.
    expect(declined(fn(ce, 'half'))).toMatch(
      'a value of type list<real> written to a list local of type list<integer>'
    );
  });

  test('arithmetic of a list of lists declines', () => {
    // A list of lists is the host's rows (CE-1721,
    // ir-assigns-grid-ce1721.test.ts), which arithmetic does not read.
    const ce = engine(`let g = [[1, 0], [0, 1]]
let f = (t: real) => do { g = g + 1 }`);
    expect(declined(fn(ce, 'f'))).toMatch(
      'g of type list<list<number>> other than in an element read'
    );
  });

  test('AddTo of an element of the list', () => {
    const source = `let L = [1, 2, 3]
let f = (t: real) => do { L[2] += 1 }
let g = (t: real) => do { L[t] += 0.5; L[-1] += t; 0 }`;
    const ce = engine(source);
    const f = compiled(fn(ce, 'f'));
    expect(f.result.assigns).toEqual(['L']);
    // The value of the body is the list, as the interpreter's.
    expect(f.run(0)).toEqual([1, 3, 3]);
    expect(interpreted(source, 'f', 'L', [0]).values).toEqual([
      ['List', 1, 3, 3],
    ]);
    const g = compiled(fn(ce, 'g')).run;
    g(1);
    g(2);
    const ref = engine(source);
    for (const [h, t] of [
      ['f', 0],
      ['g', 1],
      ['g', 2],
    ] as const)
      ref.box([h, t]).evaluate();
    expect(valueOf(ce, 'L')).toEqual(valueOf(ref, 'L'));
    expect(valueOf(ce, 'L')).toEqual(['List', 1.5, 3.5, 6]);
  });

  test('AddTo of an element whose value writes the list declines', () => {
    const ce = engine(`let L = [1, 2, 3]
let f = (t: real) => do { L[2] += do { L = [0, 0]; 1 } }`);
    expect(declined(fn(ce, 'f'))).toMatch('whose value writes it');
  });
});
