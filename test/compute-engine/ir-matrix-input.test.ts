import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// An input, a typed parameter of a function literal or of `Apply`, and a
// parameter of a user function, of a matrix type of no stated dimensions
// (`matrix`, `matrix<real>`, `matrix<integer>`), is a value of the lane
// `rows` on JavaScript whose rows have one length (`rows.width`, the length
// of the first row; `README.md`, "The rows lane"). The type states it and
// the compiled code does not test it (R5): a value with rows of different
// lengths is outside its type. The readers of the lane and the matrix
// operators of a table read it; two lengths that the lowering does not
// prove equal are compared once at run time (`MatrixMultiply`, `Trace`), a
// `RangeError` where the interpreter gives an error. Each value must equal
// the interpreter's.
//
// An input of the entry is a list of rank 2 whose two lengths are parameters
// before it, its number of rows and the length of its first row (`README.md`,
// "Matrices"); the readers of the lane read it as its rows (`rows.of`).
//
// A read that no reader of the lane admits (arithmetic, a function of each
// element) reads the matrix as a list of rank 2 of its two lengths, so the
// operation threads over its elements; two matrices whose lengths the
// lowering does not prove equal are compared once at run time (CE-1834).

type Json = unknown;
type Grid = number[][];

const ce = new ComputeEngine();
ce.declare('M', 'matrix<real>');
ce.declare('A', 'matrix<real>');
ce.declare('I', 'matrix<integer>');
ce.declare('Q', 'matrix');
ce.declare('v', 'list<real>');
ce.declare('g', 'list<list<real>>');
ce.declare('C', 'matrix<complex>');
ce.declare('Z', 'matrix<boolean>');
ce.declare('H', 'matrix<real^2x?>');
ce.declare('K', 'matrix<real^2x3>');
ce.declare('n', 'integer');

const box = (json: Json): Expression => ce.box(json as never);
const F = (body: Json, ...params: Json[]) => ['Function', body, ...params];
const typed = (name: string, type: string) => ['Typed', name, `'${type}'`];

ce.declare('tr', '(matrix<real>) -> list<list<real>>');
ce.assign('tr', box(F(['Transpose', 'm'], 'm')));
ce.declare('gram', '(matrix<real>) -> list<list<real>>');
ce.assign('gram', box(F(['MatrixMultiply', 'm', ['Transpose', 'm']], 'm')));
ce.declare('inc', '(matrix<real>) -> list<list<real>>');
ce.assign('inc', box(F(['Add', 'm', 1], 'm')));
ce.declare('tk', '(real) -> list<list<real>>');
ce.assign(
  'tk',
  box(
    F(
      ['Map', F(['Map', F(['Multiply', 'k', 'x'], 'x'), 'r'], 'r'), ['Transpose', 'M']],
      'k'
    )
  )
);

/** The interpreter's value: a collection is an array (a `Map` is lazy). */
function read(e: Expression): unknown {
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (e.isCollection) return [...e.each()].map(read);
  return e.N().re;
}

const list = (g: Grid) => box(['List', ...g.map((r) => ['List', ...r])]);

/** `v` and `w` have one shape and agree within 1e-12 (booleans: equal). */
function agree(v: unknown, w: unknown): boolean {
  if (typeof w === 'boolean') return v === w;
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

type Point = {
  M: Grid;
  A: Grid;
  I: Grid;
  Q: Grid;
  v: number[];
  K: Grid;
  n: number;
};

// 2 × 3, 3 × 2 and 1 × 1, of integers and of reals; `A` is 2 × 2 or
// 3 × 3, so that `MatrixMultiply(M, A)` agrees at some points only.
const POINTS: Point[] = [
  {
    M: [[1, 2, 3], [4, 5, 6]],
    A: [[1, 0.5], [2, -1]],
    I: [[1, 2], [3, 4], [5, 6]],
    Q: [[0.25, 2]],
    v: [1, -2, 0.5],
    K: [[1, 2, 3], [4, 5, 6]],
    n: 2,
  },
  {
    M: [[1.5, -2], [0.25, 4], [3, 1]],
    A: [[2, 1], [0, 1]],
    I: [[7]],
    Q: [[1], [2], [3]],
    v: [3, 4],
    K: [[0.5, -1, 2], [3, 0, 1]],
    n: 1,
  },
  {
    M: [[7]],
    A: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    I: [[-3, 2]],
    Q: [[5]],
    v: [2, 3],
    K: [[1, 1, 1], [2, 2, 2]],
    n: 3,
  },
  {
    M: [[1, 2, 3], [4, 5, 6], [7, 8, 10]],
    A: [[0.5, 1, 2], [1, 1, 1], [3, 2, 1]],
    I: [[1, 2], [3, 4]],
    Q: [[1, 2], [3, 4]],
    v: [1, 1, 1],
    K: [[2, 0, 1], [1, 3, 5]],
    n: 4,
  },
];

/** An error, or a collection that holds one at any depth (`Arctan2` and
 *  `Less` of two matrices of two sizes). */
const holdsError = (e: Expression): boolean =>
  e.operator === 'Error' || (e.isCollection && [...e.each()].some(holdsError));

/** The interpreter's value of `json` at `p`, or `'error'`. */
function interpreted(json: Json, p: Point): unknown {
  const values = {
    M: list(p.M),
    A: list(p.A),
    I: list(p.I),
    Q: list(p.Q),
    v: box(['List', ...p.v]),
    K: list(p.K),
    n: ce.number(p.n),
  };
  return ce.withValues(values as never, () => {
    const r = box(json).evaluate();
    return holdsError(r) ? 'error' : read(r);
  });
}

/** `json` compiles, and its value at each point is the interpreter's, or
 *  a `RangeError` where the interpreter gives an error. `args` gives the
 *  positional arguments of a root function literal at a point. */
function check(json: Json, args?: (p: Point) => unknown[], interp?: Json) {
  const r = compile(box(json), { fallback: false });
  expect(r.success).toBe(true);
  let errors = 0;
  for (const p of POINTS) {
    const want = interpreted(interp ?? json, p);
    const run = () =>
      args === undefined ? r.run!(p as never) : (r.run as any)(...args(p));
    if (want === 'error') {
      expect(run).toThrow(RangeError);
      errors += 1;
      continue;
    }
    const got = run();
    if (!agree(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return { r, errors };
}

/** The message of the decline of `json`. */
function declines(json: Json, options: object = {}): string {
  try {
    const r = compile(box(json), { ...options, fallback: false } as never);
    return r.success ? '' : (r.diagnostic?.message ?? '');
  } catch (x) {
    return (
      (x as { diagnostic?: { message: string } }).diagnostic?.message ??
      (x as Error).message
    );
  }
}

const twice = (t: Json) => [
  'Map',
  F(['Map', F(['Multiply', 2, 'x'], 'x'), 'r'], 'r'),
  t,
];

describe('a matrix input: the readers of the lane rows', () => {
  test.each([
    ['Length', ['Length', 'M']],
    ['Count', ['Count', 'I']],
    ['an element', ['At', ['At', 'M', 1], 2]],
    ['an element from the end', ['At', ['At', 'M', -1], -1]],
    ['the sum of a row', ['Sum', ['At', 'M', 1]]],
    ['Map of Sum', ['Map', F(['Sum', 'r'], 'r'), 'M']],
    ['Map of each element', twice('I')],
    ['Flatten', ['Flatten', 'M']],
    ['Reduce of the rows', ['Map', F(['Reduce', 'r', 'Add', 0], 'r'), 'Q']],
  ])('%s', (_, json) => {
    check(json);
  });
});

describe('a matrix input: the matrix operators', () => {
  test.each([
    ['Transpose', ['Transpose', 'M']],
    ['Transpose of integers', ['Transpose', 'I']],
    ['Transpose of a matrix of numbers', ['Transpose', 'Q']],
    ['ConjugateTranspose', ['ConjugateTranspose', 'M']],
    ['Transpose of a Transpose', ['Transpose', ['Transpose', 'M']]],
    ['M times its transpose', ['MatrixMultiply', 'M', ['Transpose', 'M']]],
    ['the transpose of M times M', ['MatrixMultiply', ['Transpose', 'M'], 'M']],
    ['Transpose of a Map of each element', ['Transpose', twice('M')]],
    ['Trace of M times its transpose', ['Trace', ['MatrixMultiply', 'M', ['Transpose', 'M']]]],
  ])('%s', (_, json) => {
    const { r, errors } = check(json);
    expect(errors).toBe(0);
    // No run-time comparison where the lengths are one value.
    expect(r.code).not.toMatch(/_agree|_square/);
  });

  // Lengths that are not one value: compared once at run time.
  test.each([
    ['two inputs', ['MatrixMultiply', 'M', 'A']],
    ['a matrix times a vector', ['MatrixMultiply', 'M', 'v']],
    ['a vector times a matrix', ['MatrixMultiply', 'v', 'M']],
    ['integers times reals', ['MatrixMultiply', 'I', 'Q']],
    ['Trace', ['Trace', 'M']],
    ['Trace of a product', ['Trace', ['MatrixMultiply', 'M', 'A']]],
  ])('%s: compared at run time', (_, json) => {
    const { r, errors } = check(json);
    expect(errors).toBeGreaterThan(0);
    expect(r.code).toMatch(/_agree|_square/);
  });
});

describe('a matrix input: its two lengths', () => {
  const code = (json: Json) => compile(box(json), { fallback: false }).code;

  test('the length of the first row is one statement at the start', () => {
    const lines = code(['MatrixMultiply', 'M', ['Transpose', 'M']]).split('\n');
    expect(lines[1]).toBe(
      '  const v1 = (_.M.length === 0 ? 0 : _.M[0].length);'
    );
    expect(lines.filter((l) => l.includes('_.M[0].length'))).toHaveLength(1);
  });

  test('code that reads no row length has no such statement', () => {
    expect(code(['Length', 'M'])).toBe(
      ['(() => {', '  return _.M.length;', '})()'].join('\n')
    );
    expect(code(['At', ['At', 'M', 1], 2])).not.toMatch(/M\[0\]\.length/);
  });

  test('a positional parameter: its lengths read the same argument', () => {
    const r = compile(
      box(
        F(
          ['Add', ['Trace', ['MatrixMultiply', 'm', 'n']], 'k', ['Length', 'u']],
          typed('k', 'real'),
          typed('m', 'matrix<real>'),
          typed('u', 'list<real>'),
          typed('n', 'matrix<integer>')
        )
      ),
      { fallback: false }
    );
    expect(r.success).toBe(true);
    const run = r.run as (...args: unknown[]) => number;
    // Trace([[1, 2], [3, 4]] · [[2, 0], [1, 1]]) is 8, and the list has 3
    // elements.
    expect(run(10, [[1, 2], [3, 4]], [5, 6, 7], [[2, 0], [1, 1]])).toBe(21);
    expect(() => run(10, [[1, 2, 3]], [5], [[2, 0], [1, 1]])).toThrow(
      RangeError
    );
    expect(r.code).toMatch(/a1\.length === 0 \? 0 : a1\[0\]\.length/);
    expect(r.code).toMatch(/a3\.length === 0 \? 0 : a3\[0\]\.length/);
  });

  test('the report of the input: an array', () => {
    const r = compile(box(['Transpose', 'M']), { fallback: false });
    expect(r.freeSymbolTypes?.M).toEqual({
      type: 'matrix<real>',
      lowered: 'array',
      provenance: 'declared',
    });
  });

  // The two lengths are parameters, as the length of a `list<real>` input
  // is, so a list made from the input has a length that is known outside
  // an arm and outside a term.
  test('an If with no else whose list arm reads the input', () => {
    const json = ['If', ['Greater', 'n', 2], ['Map', F(['Sum', 'r'], 'r'), 'M']];
    const r = compile(box(json), { fallback: false });
    expect(r.success).toBe(true);
    const M = [[1, 2, 3], [4, 5, 6]];
    expect(r.run!({ M, n: 3 } as never)).toEqual([6, 15]);
    // The interpreter gives `Missing`: a list of NaN, as for a list input.
    expect(r.run!({ M, n: 1 } as never)).toEqual([NaN, NaN]);
    ce.withValues({ M: list(M), n: ce.number(1) } as never, () =>
      expect(box(json).evaluate().json).toBe('Missing')
    );
  });

  test('a Sum whose term is a list made from the input', () => {
    const { errors } = check([
      'Sum',
      ['Multiply', 'k', ['Map', F(['Sum', 'r'], 'r'), 'M']],
      ['Limits', 'k', 1, 200],
    ]);
    expect(errors).toBe(0);
  });

});

// CE-1834. `A` has the size of `M` at the last point only, and `K` at the
// first.
describe('a matrix input: operations on its elements', () => {
  const code = (json: Json) => compile(box(json), { fallback: false }).code;
  const rowSum = F(['Sum', 'r'], 'r');
  const table = [
    'Map',
    F(['Map', F(['Multiply', 'i', 'j'], 'j'), ['Range', 1, 'n']], 'i'),
    ['Range', 1, 'n'],
  ];

  test.each([
    ['a scalar factor', ['Multiply', 2, 'M']],
    ['an integer input as a factor', ['Multiply', 'n', 'M']],
    ['a scalar term', ['Add', 'M', 1]],
    ['a function of each element', ['Sin', 'M']],
    ['the negation', ['Negate', 'M']],
    ['a quotient by a scalar', ['Divide', 'M', 2]],
    ['a scalar divided by each element', ['Divide', 1, 'M']],
    ['a scalar to the power of each element', ['Power', 2, 'M']],
    ['Abs and Mod', ['Add', ['Abs', 'M'], ['Mod', 'M', 2]]],
    ['a matrix of integers', ['Multiply', 2, 'I']],
    ['integers divided: reals', ['Divide', 'I', 2]],
    ['a matrix of no stated element type', ['Add', 'Q', 1]],
    ['the matrix and itself', ['Add', 'M', 'M']],
    ['the matrix and a function of it', ['Add', 'M', ['Multiply', 2, 'M'], 1]],
    ['of a transpose', ['Multiply', 2, ['Transpose', 'M']]],
    ['of a product', ['Add', ['MatrixMultiply', 'M', ['Transpose', 'M']], 1]],
    ['of a table that the program builds', ['Add', table, 1]],
    ['of a Map of the rows', ['Add', ['Map', F(['Multiply', 2, 'r'], 'r'), 'M'], 1]],
    ['of a Filter of the rows', ['Sin', ['Filter', 'M', F(['Greater', ['Sum', 'r'], 5], 'r')]]],
  ])('one matrix: %s', (_, json) => {
    expect(check(json).errors).toBe(0);
  });

  test.each([
    ['a sum', ['Add', 'M', 'A']],
    ['a difference', ['Subtract', 'M', 'A']],
    ['a sum of three', ['Add', 'M', 'A', 'M']],
    ['functions of each', ['Add', ['Exp', 'M'], ['Cos', 'A']]],
    ['a transpose and a matrix', ['Add', ['Transpose', 'M'], 'A']],
    ['a product and a matrix', ['Add', ['MatrixMultiply', 'M', ['Transpose', 'M']], 'A']],
    ['a matrix of integers and a matrix of reals', ['Add', 'I', 'M']],
    ['a matrix of stated size, second', ['Add', 'M', 'K']],
    ['a matrix of stated size, first', ['Subtract', 'K', 'M']],
    ['a table that the program builds', ['Add', 'A', table]],
    ['a function of two operands', ['Arctan2', 'M', 'A']],
    ['a comparison: a matrix of booleans', ['Less', 'M', 'A']],
    // A check throws only where the interpreter gives an error: the arm is
    // taken at `n > 2` only.
    ['in an arm', ['If', ['Greater', 'n', 2], ['Trace', ['Add', 'M', 'A']], 0]],
  ])('two matrices: %s', (_, json) => {
    // A size that differs is a `RangeError`, where the interpreter gives
    // the error `incompatible-dimensions` (`check()`).
    const { r, errors } = check(json);
    expect(errors).toBeGreaterThan(0);
    expect(r.code).toMatch(/_agree\(|_order\(/);
  });

  test('the message of two sizes', () => {
    const r = compile(box(['Add', 'M', 'A']), { fallback: false });
    const run = (M: Grid, A: Grid) => r.run!({ M, A } as never);
    expect(run([[1, 2], [3, 4]], [[1, 1], [1, 1]])).toEqual([[2, 3], [4, 5]]);
    // Two numbers of rows, then two lengths of the rows (the canonical
    // sum reads `A` first).
    expect(() => run([[1, 2]], [[1, 1], [1, 1]])).toThrow(
      'incompatible-dimensions: lists of lengths 2 and 1'
    );
    expect(() => run([[1, 2, 3], [4, 5, 6]], [[1, 1], [1, 1]])).toThrow(
      'incompatible-dimensions: lists of lengths 2 and 3'
    );
  });

  test('a comparison with a scalar: a matrix of booleans', () => {
    const json = ['Greater', 'M', 2];
    const M = [[1, 2, 3], [4, 5, 6]];
    const r = compile(box(json), { fallback: false });
    expect(r.run!({ M } as never)).toEqual([[false, false, true], [true, true, true]]);
    ce.withValues({ M: list(M) } as never, () =>
      expect(read(box(json).evaluate())).toEqual(r.run!({ M } as never))
    );
  });

  test('lengths that are proved equal are not compared', () => {
    for (const json of [
      ['Add', 'M', 'M'],
      ['Add', 'M', ['Multiply', 2, 'M'], 1],
      ['Subtract', ['Sin', 'M'], ['Cos', 'M']],
    ])
      expect(code(json)).not.toMatch(/_agree/);
    // One comparison of each length for two matrices, also where a second
    // operation reads them.
    expect(code(['Add', 'M', 'A']).match(/_agree\(/g)).toHaveLength(2);
    const twice = code(['Subtract', ['Sin', ['Add', 'M', 'A']], ['Add', 'M', 'A']]);
    expect(twice.match(/_agree\(/g)).toHaveLength(2);
    // Two for each further matrix; one for a transpose (the two lengths of
    // `M`); two for a matrix of stated size.
    expect(code(['Add', 'M', 'A', 'Q']).match(/_agree\(/g)).toHaveLength(4);
    expect(code(['Add', 'M', ['Transpose', 'M']]).match(/_agree\(/g)).toHaveLength(1);
    expect(code(['Add', 'M', 'K']).match(/_agree\(/g)).toHaveLength(2);
  });

  // An operand that is itself an operation on the elements is read at each
  // element, not built: one build of builds, two arrays.
  test.each([
    ['2·M + A', ['Add', ['Multiply', 2, 'M'], 'A']],
    ['(M + A)·2 − Q', ['Subtract', ['Multiply', ['Add', 'M', 'A'], 2], 'Q']],
    ['Sin(M) + A', ['Add', ['Sin', 'M'], 'A']],
  ])('one build: %s', (_, json) => {
    const { r, errors } = check(json);
    expect(errors).toBeGreaterThan(0);
    const point = {
      ...POINTS[3],
      Q: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    };
    const expected = interpreted(json, point);
    expect(expected).not.toBe('error');
    expect(agree(r.run!(point as never), expected)).toBe(true);
    expect(r.code.match(/new Array\(/g)).toHaveLength(2);
  });

  // A check runs only where the interpreter evaluates the operation: a loop
  // of no pass compares nothing.
  test('in a loop of no pass', () => {
    const json = ['Sum', ['Trace', ['Add', 'M', 'A']], ['Tuple', 'i', 1, 'n']];
    const r = compile(box(json), { fallback: false });
    const [M, A] = [[[1, 2]], [[1, 2], [3, 4]]];
    expect(r.run!({ M, A, n: 0 } as never)).toBe(0);
    expect(() => r.run!({ M, A, n: 1 } as never)).toThrow(RangeError);
  });

  test.each([
    ['Length', ['Length', ['Multiply', 2, 'M']]],
    ['Map of Sum', ['Map', rowSum, ['Multiply', 2, 'M']]],
    ['the sum of the sums of the rows', ['Sum', ['Map', rowSum, ['Add', ['Multiply', 2, 'M'], 1]]]],
    ['Flatten', ['Flatten', ['Multiply', 2, 'M']]],
    ['Flatten of a sum', ['Flatten', ['Add', 'M', 'A']]],
    ['Filter', ['Filter', ['Multiply', 2, 'M'], F(['Greater', ['Sum', 'r'], 10], 'r')]],
    ['Transpose', ['Transpose', ['Multiply', 2, 'M']]],
    ['Transpose of a sum', ['Transpose', ['Add', 'M', 'A']]],
    ['Shape', ['Shape', ['Add', 'M', 'A']]],
    ['Rank', ['Rank', ['Multiply', 2, 'M']]],
    ['Diagonal', ['Diagonal', ['Add', 'M', 1]]],
    ['Trace', ['Trace', ['Multiply', 2, 'M']]],
    ['Determinant', ['Determinant', ['Add', 'M', 'A']]],
    ['MatrixPower', ['MatrixPower', ['Multiply', 2, 'A'], 2]],
    ['a product, first', ['MatrixMultiply', ['Add', 'M', 1], 'A']],
    ['a product, second', ['MatrixMultiply', 'A', ['Multiply', 2, 'A']]],
    ['a product with a list', ['MatrixMultiply', ['Multiply', 2, 'M'], 'v']],
    ['a parameter of a user function', ['tr', ['Add', 'M', 1]]],
    ['a parameter of Apply', ['Apply', F(['Trace', 'm'], typed('m', 'matrix<real>')), ['Multiply', 2, 'M']]],
    ['a local', ['Block', ['Declare', 'c', "'unknown'", ['Add', 'M', 1]], ['Add', 'c', 'c']]],
    ['a local that holds a transpose', ['Block', ['Declare', 'c', "'unknown'", ['Transpose', 'M']], ['Add', 'c', 'A']]],
    ['the arms of an If', ['If', ['Greater', 'n', 2], ['Multiply', 2, 'M'], ['Add', 'M', 1]]],
    // Read where a list of rows is read whole (the result, a local, an
    // element read), a result is its rows (step 4 of the plan).
    ['arms of two sizes, as the result', ['If', ['Greater', 'n', 2], ['Multiply', 2, 'M'], ['Multiply', 2, 'A']]],
    ['an arm that is the input, as the result', ['If', ['Greater', 'n', 2], ['Add', 'M', 1], 'A']],
    // Arms of one size are a matrix of that size.
    ['a matrix operator of arms of one size', ['Transpose', ['If', ['Greater', 'n', 2], ['Multiply', 2, 'M'], ['Add', 'M', 1]]]],
    ['a matrix operator of an input and a result of its size', ['Trace', ['If', ['Greater', 'n', 2], 'A', ['Multiply', 2, 'A']]]],
    ['an operation on a local that holds arms of one size', ['Block', ['Declare', 'c', "'unknown'", ['If', ['Greater', 'n', 2], ['Multiply', 2, 'M'], ['Multiply', 3, 'M']]], ['Add', 'c', 1]]],
    ['an element', ['At', ['At', ['Multiply', 2, 'M'], 1], 1]],
    ['an element at an index known at run time', ['At', ['At', ['Add', 'M', 'M'], 'n'], -1]],
    ['a local that is written again', ['Block', ['Declare', 'c', "'unknown'", 'M'], ['Assign', 'c', ['Add', 'c', 1]], ['Assign', 'c', ['Transpose', 'c']], 'c']],
  ])('a reader of the result: %s', (_, json) => {
    check(json);
  });

  test('a parameter of a matrix type', () => {
    // A user function, whose value is its rows.
    expect(check(['inc', 'M']).errors).toBe(0);
    expect(check(['inc', ['Multiply', 2, 'M']]).errors).toBe(0);
    expect(
      check(['Apply', F(['Add', 'm', 1], typed('m', 'matrix<real>')), 'M']).errors
    ).toBe(0);
    // Two parameters of a root function literal.
    const literal = F(
      ['Add', 'm', 'k'],
      typed('m', 'matrix<real>'),
      typed('k', 'matrix<real>')
    );
    const { errors } = check(
      literal,
      (p) => [p.M, p.A],
      ['Add', 'M', 'A']
    );
    expect(errors).toBeGreaterThan(0);
  });

  // The interpreter's value of these is not the value element by element,
  // or the shape of the value is not settled.
  test.each([
    ['a list of lists whose rows can differ', ['Add', 'g', 'g'], /g of type list<list<real>> other than in an element read g\[i\]\[j\]/],
    ['a matrix and a list', ['Add', 'M', 'v'], /lists of different lengths or ranks/],
    ['a product of two matrices', ['Multiply', 'M', 'A'], /Multiply of a matrix/],
    ['a product of a matrix and a list', ['Multiply', 'M', 'v'], /Multiply of a matrix/],
    ['a power of a matrix', ['Power', 'M', 'n'], /Power of a matrix/],
    ['a matrix and a list of lists', ['Add', 'M', 'g'], /g of type list<list<real>> other than in an element read/],
    ['Equal of two matrices', ['Equal', 'M', 'A'], /Equal of a list/],
    ['the sum of the rows', ['Sum', ['Multiply', 2, 'M']], /a term that is not a number/],
    ['RowReduce', ['RowReduce', ['Multiply', 2, 'M']], /RowReduce of a matrix whose number of rows is known at run time only/],
    ['a row of the result as the value', ['At', ['Add', 'M', 'A'], 1], /a row at an index known at run time as the result/],
    ['a matrix operator of arms of two sizes', ['Transpose', ['If', ['Greater', 'n', 2], ['Multiply', 2, 'M'], ['Multiply', 2, 'A']]], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a call result', ['Add', ['inc', 'M'], 1], /a list of lists of run-time length read whole/],
    ['a join', ['Add', ['Join', 'M', 'A'], 1], /a list of lists of run-time length read whole/],
  ])('declines: %s', (_, json, message) => {
    expect(declines(json)).toMatch(message);
  });

  // Step 3 of the plan: a table that the program builds, whose rows have
  // one length that is known at run time only.
  test.each([
    ['Tabulate plus a scalar', ['Add', ['Tabulate', F(['Multiply', 'i', 'j'], 'i', 'j'), 'n', ['Length', 'v']], 1]],
    ['a function of each element of a Tabulate', ['Sin', ['Tabulate', F(['Add', 'i', 'j'], 'i', 'j'), 'n', 'n']]],
    ['a function of each element of a Map of a Map', ['Sin', ['Map', F(['Map', F(['Multiply', 'p', 'q'], 'q'), 'v'], 'p'), 'v']]],
    ['two tables of one size', ['Add', table, ['Transpose', table]]],
    ['a table of rows of a stated length', ['Add', ['Tabulate', F(['Multiply', 'i', 'j'], 'i', 'j'), 'n', 3], 1]],
  ])('a table: %s', (_, json) => {
    expect(check(json).errors).toBe(0);
  });

  // A known limitation of `docs/COMPILATION-MODEL.md`: the comparison of a
  // length runs when that length or an element is read.
  test('Length of a sum of matrices whose rows have two lengths', () => {
    const r = compile(box(['Length', ['Add', 'M', 'A']]), { fallback: false });
    const [M, A] = [[[1, 2, 3], [4, 5, 6]], [[1, 0], [0, 1]]];
    expect(r.run!({ M, A } as never)).toBe(2);
    expect(() => r.run!({ M, A: [[1, 0]] } as never)).toThrow(RangeError);
    // A reader of no length runs no comparison.
    const rank = compile(box(['Rank', ['Add', 'M', 'A']]), { fallback: false });
    expect(rank.code).not.toMatch(/_agree/);
    expect(rank.run!({ M, A: [[1, 0]] } as never)).toBe(2);
  });

  test.each([
    ['GLSL', { to: 'glsl' }],
    ['the interval mode', { to: 'interval-js' }],
    ['the bigint mode', { mode: 'bigint' }],
  ])('%s declines the input', (_, options) => {
    expect(declines(['Add', 'I', 1], options)).toMatch(
      /the input I of type matrix<integer>/
    );
  });
});

describe('a parameter of a matrix type', () => {
  test('a typed parameter of a root function literal', () => {
    check(
      F(['MatrixMultiply', ['Transpose', 'm'], 'm'], typed('m', 'matrix<real>')),
      (p) => [p.M],
      ['MatrixMultiply', ['Transpose', 'M'], 'M']
    );
  });

  test('a typed parameter of Apply', () => {
    check([
      'Apply',
      F(
        ['Trace', ['MatrixMultiply', 'm', ['Transpose', 'm']]],
        typed('m', 'matrix<real>')
      ),
      'M',
    ]);
  });

  test('a parameter of a user function', () => {
    check(['tr', 'M']);
    check(['gram', 'I']);
  });

  test('a user function that reads a matrix input', () => {
    check(['tk', 2]);
  });

  test('a variable of the engine of a matrix type that a root literal assigns', () => {
    const engine = new ComputeEngine();
    engine.declare('S', 'matrix<real>');
    engine.assign('S', engine.box(['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]));
    const json = F(
      [
        'Block',
        ['Declare', 'u', "'unknown'", ['Trace', ['MatrixMultiply', 'S', ['Transpose', 'S']]]],
        ['Assign', 'S', ['List', ['List', 'u', 't']]],
        'u',
      ],
      typed('t', 'real')
    );
    const r = compile(engine.box(json as never), { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as any)(2)).toBe(91);
    expect(engine.box('S').evaluate().json).toEqual(['List', ['List', 91, 2]]);
  });

  // A call result has no fact of its rows (the interpreter does not check
  // the declared result type of a user function: `f := m ↦ [[1, 2], [3]]`
  // declared `(matrix<real>) -> matrix<real>` gives the ragged list): the
  // matrix operators decline it, and so does a parameter of a matrix type,
  // which takes a value whose rows have one length only (the interpreter
  // gives `incompatible-type` for rows of different lengths).
  test.each([
    ['Transpose of a call', ['Transpose', ['tr', 'M']], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a call of a call', ['tr', ['tr', 'M']], /an argument of tr for the parameter 1, a matrix, whose rows can have different lengths/],
    ['a list<list<real>> argument', ['tr', 'g'], /an argument of tr for the parameter 1, a matrix, whose rows can have different lengths/],
    ['a list<list<real>> argument of Apply', ['Apply', F(['Length', 'm'], typed('m', 'matrix<real>')), 'g'], /an argument of Apply for the parameter m, a matrix, whose rows can have different lengths/],
    ['a Filter inside the rows', ['tr', ['Map', F(['Filter', 'r', F(['Greater', 'x', 1], 'x')], 'r'), 'M']], /an argument of tr for the parameter 1, a matrix, whose rows can have different lengths/],
    ['reals at a parameter of integers', ['Apply', F(['Transpose', 'm'], typed('m', 'matrix<integer>')), 'K'], /an argument of Apply of type matrix<real\^\(2x3\)> for the parameter m of lists of integers/],
  ])('%s declines', (_, json, cause) => {
    expect(declines(json)).toMatch(cause);
  });
});

/** A table of `n` rows of 3 elements (a list of rank 2), and a table of
 *  `n` rows of `n` elements (the lane `rows`, with the fact). */
const build3 = [
  'Map',
  F(['Map', F(['Add', 'i', ['Multiply', 10, 'j']], 'j'), ['Range', 1, 3]], 'i'),
  ['Range', 1, 'n', 1],
];
const square = [
  'Map',
  F(['Map', F(['Add', 'i', ['Multiply', 0.5, 'j']], 'j'), ['Range', 1, 'n', 1]], 'i'),
  ['Range', 1, 'n', 1],
];
const lit = ['List', ['List', 1, 2], ['List', 3, 4]];
/** The interpreter leaves a matrix operator of a lazy table unevaluated:
 *  its value is compared with the operator of the listed table. */
const listed = (x: Json) => ['ListFrom', x];

// An argument whose rows provably have one length: a value of stated size,
// a literal, a build of a constant row length (the rows of the list,
// `matrixRows()`), and a built table that carries the fact.
describe('an argument of one row length at a parameter of a matrix type', () => {
  test.each([
    ['a matrix of stated size', ['tr', 'K']],
    ['a literal', ['tr', lit]],
    ['a build of a constant row length', ['gram', build3], ['gram', listed(build3)]],
    ['a square build', ['gram', square], ['gram', listed(square)]],
    ['a Map of each element', ['tr', twice('M')]],
    ['Apply of a matrix of stated size', ['Apply', F(['MatrixMultiply', 'm', ['Transpose', 'm']], typed('m', 'matrix<real>')), 'K']],
    ['Apply of a literal', ['Apply', F(['Trace', 'm'], typed('m', 'matrix<real>')), lit]],
    ['Apply of a build', ['Apply', F(['Transpose', 'm'], typed('m', 'matrix<real>')), build3]],
    ['Apply of a square build', ['Apply', F(['Trace', 'm'], typed('m', 'matrix<real>')), square], ['Trace', listed(square)]],
    ['a literal of integers at a parameter of integers', ['Apply', F(['Transpose', 'm'], typed('m', 'matrix<integer>')), lit]],
  ] as [string, Json, Json?][])('%s', (...row) => {
    // A rest parameter: jest passes a callback at a missing third element.
    const [, json, interp] = row;
    const { errors } = check(json, undefined, interp);
    expect(errors).toBe(0);
  });

  // The rows of a stated size: the two lengths are constants, so `Trace`
  // of a matrix that is not square declines, as the interpreter's error.
  test('Trace of a parameter bound to a 2 × 3 matrix declines', () => {
    expect(
      declines(['Apply', F(['Trace', 'm'], typed('m', 'matrix<real>')), 'K'])
    ).toMatch(/Trace of a matrix that is not square/);
  });
});

describe('Shape and Rank of a matrix of run-time size', () => {
  test.each([
    ['Shape(M)', ['Shape', 'M']],
    ['Rank(M)', ['Rank', 'M']],
    ['Shape(I)', ['Shape', 'I']],
    ['Shape of a transpose', ['Shape', ['Transpose', 'M']]],
    ['Shape of a product', ['Shape', ['MatrixMultiply', 'M', ['Transpose', 'M']]]],
    ['Shape of a build of a constant row length', ['Shape', build3]],
    ['Rank of a build of a constant row length', ['Rank', build3]],
    ['Shape of a square build', ['Shape', square]],
    ['Rank of a square build', ['Rank', square]],
    ['Shape of a typed parameter', ['Apply', F(['Shape', 'm'], typed('m', 'matrix<real>')), 'M']],
  ])('%s', (_, json) => {
    const { errors } = check(json);
    expect(errors).toBe(0);
  });

  // `[[]]` is a value of the type, of shape `(1, 0)`; `[]` is not (the
  // engine refuses it as the value of `M`).
  test('a matrix of one empty row', () => {
    const shape = compile(box(['Shape', 'M']), { fallback: false });
    const rank = compile(box(['Rank', 'M']), { fallback: false });
    expect(shape.run!({ M: [[]] } as never)).toEqual([1, 0]);
    expect(rank.run!({ M: [[]] } as never)).toBe(2);
    ce.withValues({ M: list([[]]) } as never, () => {
      expect(box(['Shape', 'M']).evaluate().json).toEqual(['Tuple', 1, 0]);
      expect(box(['Rank', 'M']).evaluate().json).toBe(2);
    });
  });

  // A known limitation (`docs/COMPILATION-MODEL.md`): the interpreter's
  // empty list of rows has rank 1 and the shape `(0)`.
  test('a table that the program builds, of no row', () => {
    const shape = compile(box(['Shape', build3]), { fallback: false });
    const rank = compile(box(['Rank', square]), { fallback: false });
    expect(shape.run!({ n: 0 } as never)).toEqual([0, 3]);
    expect(rank.run!({ n: 0 } as never)).toBe(2);
    ce.withValues({ n: ce.number(0) } as never, () => {
      expect(box(['Shape', build3]).evaluate().json).toEqual(['Tuple', 0]);
      expect(box(['Rank', square]).evaluate().json).toBe(1);
    });
  });
});

describe('Apply whose value is a list of rows', () => {
  const T = ['Apply', F(['Transpose', 'm'], typed('m', 'matrix<real>')), 'M'];
  test.each([
    ['the transpose of a parameter', T],
    ['a matrix operator of it (the fact)', ['MatrixMultiply', T, 'M']],
    ['Transpose of it', ['Transpose', T]],
    ['a body of a parameter of lists of lists', ['Apply', F(twice('m'), typed('m', 'list<list<real>>')), 'M']],
    ['the parameter itself', ['Apply', F('m', typed('m', 'matrix<integer>')), 'I']],
  ])('%s', (_, json) => {
    const { errors } = check(json);
    expect(errors).toBe(0);
  });
});

describe('a matrix type of stated dimensions keeps its code', () => {
  // The code of the base commit (a3421e13d) for these forms.
  test('Transpose of a 2 × 3 matrix', () => {
    const r = compile(box(['Transpose', 'K']), { fallback: false });
    expect(r.code).toBe(
      [
        '(() => {',
        '  const v4 = _.K[0];',
        '  const v7 = _.K[1];',
        '  return [[v4[0], v7[0]], [v4[1], v7[1]], [v4[2], v7[2]]];',
        '})()',
      ].join('\n')
    );
  });

  test('a 2 × 3 matrix times its transpose', () => {
    const r = compile(box(['MatrixMultiply', 'K', ['Transpose', 'K']]), {
      fallback: false,
    });
    expect(r.code).not.toMatch(/_agree|for \(/);
  });

  // A stated inner length beside a run-time one: the code of a3421e13d,
  // whose sums are written out, plus one check, whose 0 starts each sum.
  test('a 2 × 3 matrix times a list input: written out, one check', () => {
    const r = compile(box(['MatrixMultiply', 'K', 'v']), { fallback: false });
    expect(r.code).toBe(
      [
        '(() => {',
        '  const v4 = _agree(3, _.v.length);',
        '  const v7 = _.K[0];',
        '  const v9 = _.v[0];',
        '  const v14 = _.v[1];',
        '  const v18 = _.v[2];',
        '  const v22 = _.K[1];',
        '  return [(((v4 + (v7[0] * v9)) + (v7[1] * v14)) + (v7[2] * v18)), (((v4 + (v22[0] * v9)) + (v22[1] * v14)) + (v22[2] * v18))];',
        '})()',
      ].join('\n')
    );
    expect(r.code).not.toMatch(/for \(/);
    expect(r.code.match(/_agree\(/g)).toHaveLength(1);
    const K = [[1, 2, 3], [4, 5, 6]];
    expect(r.run!({ K, v: [1, -1, 2] } as never)).toEqual([5, 11]);
    expect(() => r.run!({ K, v: [1, 2] } as never)).toThrow(RangeError);
  });
});

describe('what declines', () => {
  test.each([
    ['RowReduce', ['RowReduce', 'M'], {}, /RowReduce of a matrix whose number of rows is known at run time only/],
    ['Determinant of a list<list<real>> input', ['Determinant', 'g'], {}, /Determinant of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['Transpose of a list<list<real>> input', ['Transpose', 'g'], {}, /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a complex matrix', ['Transpose', 'C'], {}, /the input C of type matrix<complex>/],
    ['a boolean matrix', ['Transpose', 'Z'], {}, /the input Z of type matrix<boolean>/],
    ['a matrix of one stated dimension', ['Transpose', 'H'], {}, /the input H of type matrix<real\^\(2x\?\)>/],
    ['a matrix of numbers in the complex mode', ['Transpose', 'Q'], { mode: 'complex' }, /the input Q of type matrix/],
    ['GLSL', ['Transpose', 'M'], { to: 'glsl' }, /the input M of type matrix<real>/],
    ['the interval mode', ['Transpose', 'M'], { to: 'interval-js' }, /Transpose on interval-js/],
    ['the bigint mode', ['Length', 'M'], { mode: 'bigint' }, /the input M of type matrix<real>/],
  ] as [string, Json, object, RegExp][])('%s', (_, json, options, cause) => {
    expect(declines(json, options)).toMatch(cause);
  });
});

// `Determinant`, `Inverse`, `MatrixPower` and `Diagonal` of a matrix of
// run-time size: the order is the number of rows, compared with the length
// of the rows at run time where the compiler does not prove them equal
// (`rows.order`, a `RangeError` where the interpreter gives
// `expected-square-matrix`).
describe('the kernels of a matrix of run-time size', () => {
  ce.declare('X', 'matrix<real>');
  ce.declare('Y', 'matrix<integer>');
  const REALS: Grid[] = [
    [[7]],
    [[1.5, -2], [0.25, 4]],
    [[0.5, 1, 2], [1, 1, 1], [3, 2, 1]],
    [[2, 1, 0, 3], [1, 3, 2, 0], [0, 1, 4, 1], [3, 0, 1, 5]],
    [[1, 2], [2, 4]],
    [[1, 2, 3], [4, 5, 6]],
    [[1], [2]],
  ];
  const INTEGERS: Grid[] = [
    [[-3]],
    [[1, 2], [3, 4]],
    [[2, 0, 1], [1, 3, 2], [1, 1, 2]],
    [[2, 0, 1], [1, 3, 2], [1, 1, 1]],
    [[1, 2, 3], [4, 5, 6]],
  ];

  /** `json` of `X` (reals) or `Y` (integers) compiles, and at each grid
   *  gives the interpreter's value, a `RangeError` where the interpreter
   *  gives an error, and a matrix of NaN where it leaves an `Inverse`
   *  unevaluated (a singular matrix). The counts of each case. */
  function kernel(json: Json, name: 'X' | 'Y') {
    const r = compile(box(json), { fallback: false });
    expect(r.success).toBe(true);
    const counts = { value: 0, error: 0, singular: 0 };
    for (const grid of name === 'X' ? REALS : INTEGERS) {
      const run = () => r.run!({ [name]: grid } as never);
      const want = ce.withValues({ [name]: list(grid) } as never, () =>
        box(json).evaluate()
      );
      if (want.operator === 'Error') {
        expect(run).toThrow(RangeError);
        counts.error += 1;
      } else if (JSON.stringify(want.json).includes('"Inverse"')) {
        // A matrix of NaN, of the order of the matrix (its `Length`), as
        // for a matrix of stated order.
        const got = run();
        if (typeof got === 'number') expect(got).toBe(grid.length);
        else expect([got].flat(2).every((x) => Number.isNaN(x))).toBe(true);
        counts.singular += 1;
      } else {
        const got = run();
        if (!agree(got, read(want)))
          throw new Error(
            `${JSON.stringify(json)} at ${JSON.stringify(grid)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(read(want))}`
          );
        counts.value += 1;
      }
    }
    return { r, counts };
  }

  test.each([
    ['Determinant', ['Determinant', 'X']],
    ['Inverse', ['Inverse', 'X']],
    ['MatrixPower by 2', ['MatrixPower', 'X', 2]],
    ['MatrixPower by 5', ['MatrixPower', 'X', 5]],
    ['MatrixPower by 1', ['MatrixPower', 'X', 1]],
    ['MatrixPower by 0', ['MatrixPower', 'X', 0]],
    ['MatrixPower by -1', ['MatrixPower', 'X', -1]],
    ['MatrixPower by -2', ['MatrixPower', 'X', -2]],
    ['the length of an inverse', ['Length', ['Inverse', 'X']]],
    ['the shape of a power', ['Shape', ['MatrixPower', 'X', 2]]],
    ['Transpose of an inverse', ['Transpose', ['Inverse', 'X']]],
    ['Determinant of integers', ['Determinant', 'Y']],
    ['Inverse of integers', ['Inverse', 'Y']],
    ['MatrixPower of integers', ['MatrixPower', 'Y', 3]],
  ] as [string, Json][])('%s', (label, json) => {
    const name = label.endsWith('integers') ? 'Y' : 'X';
    const { r, counts } = kernel(json, name);
    // Each non-square grid is a `RangeError`, read where no element of the
    // result is (`Length`): the kernels and the count read the order.
    expect(counts.error).toBe(name === 'X' ? 2 : 1);
    expect(r.code).toMatch(/_order\(/);
  });

  test('Diagonal: the elements of the main diagonal of any shape', () => {
    expect(kernel(['Diagonal', 'X'], 'X').counts).toEqual({
      value: REALS.length,
      error: 0,
      singular: 0,
    });
    expect(kernel(['Diagonal', 'Y'], 'Y').counts.value).toBe(INTEGERS.length);
  });

  // The order is one value: nothing to compare.
  test.each([
    ['Determinant of a product', ['Determinant', ['MatrixMultiply', 'M', ['Transpose', 'M']]]],
    ['MatrixPower of a product', ['MatrixPower', ['MatrixMultiply', ['Transpose', 'A'], 'A'], 2]],
  ])('%s: no comparison', (_, json) => {
    const { r } = check(json);
    expect(r.code).not.toMatch(/_order/);
  });

  const vander = [
    'Map',
    F(['Map', F(['Power', 'i', ['Subtract', 'j', 1]], 'j'), ['Range', 1, 'n', 1]], 'i'),
    ['Range', 1, 'n', 1],
  ];
  // A table that the program builds: a square one, and one of 3 columns,
  // square at `n = 3` only (the other points are a `RangeError`).
  test.each([
    ['Determinant of a square build', ['Determinant', square], ['Determinant', listed(square)], 0],
    ['Inverse of a Vandermonde build', ['Inverse', vander], ['Inverse', listed(vander)], 0],
    ['Determinant of a build of 3 columns', ['Determinant', build3], ['Determinant', listed(build3)], 3],
    ['MatrixPower of a build of 3 columns', ['MatrixPower', build3, 2], ['MatrixPower', listed(build3), 2], 3],
    ['Trace of a build of 3 columns', ['Trace', build3], ['Trace', listed(build3)], 3],
  ] as [string, Json, Json, number][])('%s', (_, json, interp, errors) => {
    const { errors: got } = check(json, undefined, interp);
    expect(got).toBe(errors);
  });

  test('the message of a matrix that is not square', () => {
    const r = compile(box(['Determinant', 'X']), { fallback: false });
    expect(() => r.run!({ X: [[1, 2, 3], [4, 5, 6]] } as never)).toThrow(
      'expected-square-matrix: a matrix of 2 rows and 3 columns'
    );
  });

  // A matrix of stated order keeps its code: no comparison, the kernel of
  // the order 1 is the element.
  test('a matrix of stated order', () => {
    ce.declare('P', 'matrix<real^2x2>');
    ce.declare('S', 'matrix<real^1x1>');
    const code = (json: Json) => compile(box(json), { fallback: false }).code;
    expect(code(['Determinant', 'S'])).toBe(
      ['(() => {', '  return _.S[0][0];', '})()'].join('\n')
    );
    expect(code(['Inverse', 'P'])).toBe(
      ['(() => {', '  return _SYS.matrixInverse(_.P);', '})()'].join('\n')
    );
  });
});
