/**
 * CE-1607: a list of lists of two lengths not stated (`list<list<integer>>`,
 * `list<list<real>>`) at an input, at a positional parameter of a root
 * function literal or at a parameter of a user function, on the JavaScript
 * target (README of `src/compute-engine/compilation/ir/`, "The rows lane").
 *
 * The value is the host's array of arrays, whose rows can have different
 * lengths. It is read by the element `At(At(g, i), j)`, NaN where an
 * index is out of range, and row by row by the readers of a list (#638); a
 * call passes it whole to a parameter of such a type. Every other read
 * declines. A user function whose result type is
 * such a list compiles when its body is a list of rank 2 of lengths that
 * the body settles (`Map` of a `Map` over `Range(1, n)` of a constant `n`).
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import type { Expression } from '../../src/compute-engine/global-types';

type Grid = number[][];
type Run = (...args: unknown[]) => unknown;

const N = 20;
const LIFE = `let n = ${N}
wrap(k: integer) = Mod(k - 1 + n, n) + 1
count(g: list<list<integer>>, i: integer, j: integer) = sum(map(d => g[wrap(i + d[1])][wrap(j + d[2])], [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]))
nextCell(g: list<list<integer>>, i: integer, j: integer) = if count(g, i, j) == 3 || (count(g, i, j) == 2 && g[i][j] == 1) { 1 } else { 0 }
step(g: list<list<integer>>) = map(i => map(j => nextCell(g, i, j), Range(1, n)), Range(1, n))
glider(i: integer, j: integer) = (i == 1 && j == 2) || (i == 2 && j == 3) || (i == 3 && (j == 1 || j == 2 || j == 3))
let grid = map(i => map(j => if glider(i, j) { 1 } else { 0 }, Range(1, n)), Range(1, n))
sq(g: list<list<integer>>) = map(i => map(j => g[i][j] * g[i][j], Range(1, 2)), Range(1, 2))
corner(g: list<list<integer>>) = g[1][1] + 1
twice(g: list<list<integer>>) = corner(g) * 2
untyped(g) = 1`;

const ce = new ComputeEngine();
const program = executeEpsil(ce, LIFE);
const errors = program.diagnostics.filter((d) => d.severity === 'error');
if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
ce.declare('G', 'list<list<integer>>');

const epsil = (source: string): Expression => executeEpsil(ce, source).value;
const rows = (e: Expression): Grid =>
  (e.json as unknown as unknown[])
    .slice(1)
    .map((row) => (row as unknown[]).slice(1) as number[]);
/** The interpreter's value of the Epsil expression `source`, a list of
 *  lists (`map` is lazy: `listFrom` makes the lists). */
const interpreted = (source: string): Grid =>
  rows(epsil(`listFrom(map(r => listFrom(r), ${source}))`));

function compiled(e: Expression, options: object = {}): Run {
  const result = compile(e, { to: 'javascript', fallback: false, ...options });
  expect(result.success).toBe(true);
  return result.run as Run;
}

/** The message of the decline of `e`. */
function declined(e: Expression, options: object = {}): string {
  const result = compile(e, { to: 'javascript', ...options });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

describe('CE-1607: a step of the Game of Life compiles', () => {
  executeEpsil(ce, 'let g4 = grid\nfor k in Range(1, 4) { g4 = step(g4) }');
  const reference = interpreted('g4');
  const start = rows(ce.box('grid').evaluate());

  test('a root function literal with a list<list<integer>> parameter', () => {
    const run = compiled(epsil('(g: list<list<integer>>) => step(g)'));
    let a = start;
    for (let k = 0; k < 4; k++) a = run(a) as Grid;
    expect(a).toEqual(reference);
  });

  test('a call of the function with an input declared list<list<integer>>', () => {
    const run = compiled(ce.box(['step', 'G']));
    let a = start;
    for (let k = 0; k < 4; k++) a = run({ G: a }) as Grid;
    expect(a).toEqual(reference);
  });
});

describe('CE-1607: the element of a list of rows of different lengths', () => {
  const J = [[1, 2, 3], [4]];
  const at = (i: string, j: string) =>
    compiled(epsil(`(g: list<list<integer>>) => g[${i}][${j}]`))(J);

  test('an index in range, from the start or from the end', () => {
    expect(at('2', '1')).toBe(4);
    expect(at('1', '3')).toBe(3);
    expect(at('-1', '-1')).toBe(4);
    expect(at('-2', '-3')).toBe(1);
  });

  test('NaN where an index is out of range of the list or of its row', () => {
    for (const [i, j] of [
      ['2', '3'],
      ['0', '1'],
      ['3', '1'],
      ['1', '0'],
      ['1.5', '1'],
    ])
      expect(at(i, j)).toBeNaN();
    // The interpreter gives NaN, or Missing for the index 0.
    expect(
      ce
        .box(['At', ['At', ['List', ['List', 1, 2, 3], ['List', 4]], 2], 3])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('a list of lists of reals', () => {
    const run = compiled(epsil('(g: list<list<real>>) => 2 * g[1][2]'));
    expect(run([[0.5, 1.5]])).toBe(3);
  });

  test('an input of the entry, read by name', () => {
    expect(compiled(ce.box(['At', ['At', 'G', 2], 1]))({ G: J })).toBe(4);
  });

  test('passed whole to a parameter of a user function', () => {
    expect(compiled(epsil('(g: list<list<integer>>) => twice(g)'))(J)).toBe(4);
    expect(
      compiled(epsil('(g: list<list<integer>>) => sq(g)'))([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [1, 4],
      [9, 16],
    ]);
  });

  test('a row at a constant index of a count known at run time', () => {
    expect(compiled(epsil('(g: list<list<integer>>) => Length(g[1])'))(J)).toBe(
      3
    );
    expect(compiled(epsil('(g: list<list<integer>>) => sum(g[1])'))(J)).toBe(6);
    // Out of range, `Length` of the row is NaN (the interpreter's `Missing`).
    expect(
      compiled(epsil('(g: list<list<integer>>) => Length(g[3])'))(J)
    ).toBeNaN();
  });
});

describe('CE-1607: every other read declines', () => {
  const READ = 'other than in an element read';
  test.each([['g + 1'], ['untyped(g)']])('%s', (body) => {
    expect(declined(epsil(`(g: list<list<integer>>) => ${body}`))).toContain(
      READ
    );
  });

  // The rows are read one by one by `Length`, `Map` and the other readers
  // of a list, also at an index known at run time (#638,
  // `ir-rows-input-readers.test.ts`); a row as the result still declines.
  // The input as the result, and a list of its rows, are the lane `rows`
  // (CE-1736, `ir-rows-build-ce1736.test.ts`).
  test('g[1]', () => {
    expect(declined(epsil('(g: list<list<integer>>) => g[1]'))).toContain(
      'a row at an index known at run time as the result'
    );
  });

  test.each([['g'], ['map(r => r, g)']])('%s is the rows', (body) => {
    const J = [[1, 2, 3], [4], []];
    expect(
      compiled(epsil(`(g: list<list<integer>>) => ${body}`))(J)
    ).toEqual(J);
  });

  test('a list of rank 2 that the program makes, at a parameter of that type', () => {
    expect(declined(epsil('(g: list<list<integer>>) => sq(sq(g))'))).toContain(
      'that is not a list of lists of run-time length'
    );
  });

  test('a list of lists of reals at a parameter of lists of integers', () => {
    expect(declined(epsil('(g: list<list<real>>) => twice(g)'))).toContain(
      'for the parameter 1 of lists of integers'
    );
  });

  test('an input read whole beside an element read', () => {
    expect(
      declined(ce.box(['Add', ['At', ['At', 'G', 1], 1], ['Add', 'G', 1]]))
    ).toContain(READ);
  });

  test('a list of lists of booleans', () => {
    expect(declined(epsil('(g: list<list<boolean>>) => g[1][1]'))).toContain(
      'the input g of type list<list<boolean>>'
    );
  });

  test.each([
    ['interval-js', { to: 'interval-js' }],
    ['glsl', { to: 'glsl' }],
    ['the bigint mode', { mode: 'bigint' }],
  ])('%s', (_, options) => {
    expect(
      declined(epsil('(g: list<list<integer>>) => g[1][1]'), options)
    ).toContain('the input g of type list<list<integer>>');
  });
});

describe('CE-1607: a list of lists of a constant inner length', () => {
  test('a Map of a Map over Range(1, 20) keeps its loops', () => {
    const e = ce.box([
      'Map',
      [
        'Function',
        ['Map', ['Function', ['Multiply', 'i', 'j'], 'j'], ['Range', 1, 20]],
        'i',
      ],
      ['Range', 1, 20],
    ]);
    const result = compile(e, { to: 'javascript', fallback: false });
    expect(result.success).toBe(true);
    expect(result.code).toContain('for (');
    const value = (result.run as Run)() as Grid;
    expect(value.length).toBe(20);
    expect(value[6][8]).toBe(63);
    expect(value).toEqual(
      interpreted('map(i => map(j => i * j, Range(1, 20)), Range(1, 20))')
    );
  });

  // A length of 0 is not a shape of the IR: the rows (CE-1736).
  test('an inner list of no element is the lane rows', () => {
    const e = ce.box([
      'Map',
      [
        'Function',
        ['Map', ['Function', ['Multiply', 'i', 'j'], 'j'], ['Range', 1, 0, 1]],
        'i',
      ],
      ['Range', 1, 20],
    ]);
    const result = compile(e, { to: 'javascript', fallback: false });
    expect(result.rows).toBe(true);
    expect((result.run as Run)()).toEqual(
      interpreted('map(i => map(j => i * j, Range(1, 0, 1)), Range(1, 20))')
    );
  });
});
