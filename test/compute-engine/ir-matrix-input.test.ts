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

const box = (json: Json): Expression => ce.box(json as never);
const F = (body: Json, ...params: Json[]) => ['Function', body, ...params];
const typed = (name: string, type: string) => ['Typed', name, `'${type}'`];

ce.declare('tr', '(matrix<real>) -> list<list<real>>');
ce.assign('tr', box(F(['Transpose', 'm'], 'm')));
ce.declare('gram', '(matrix<real>) -> list<list<real>>');
ce.assign('gram', box(F(['MatrixMultiply', 'm', ['Transpose', 'm']], 'm')));
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

/** `v` and `w` have one shape and agree within 1e-12. */
function agree(v: unknown, w: unknown): boolean {
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

type Point = { M: Grid; A: Grid; I: Grid; Q: Grid; v: number[] };

// 2 × 3, 3 × 2 and 1 × 1, of integers and of reals; `A` is 2 × 2 or
// 3 × 3, so that `MatrixMultiply(M, A)` agrees at some points only.
const POINTS: Point[] = [
  {
    M: [[1, 2, 3], [4, 5, 6]],
    A: [[1, 0.5], [2, -1]],
    I: [[1, 2], [3, 4], [5, 6]],
    Q: [[0.25, 2]],
    v: [1, -2, 0.5],
  },
  {
    M: [[1.5, -2], [0.25, 4], [3, 1]],
    A: [[2, 1], [0, 1]],
    I: [[7]],
    Q: [[1], [2], [3]],
    v: [3, 4],
  },
  { M: [[7]], A: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], I: [[-3, 2]], Q: [[5]], v: [2, 3] },
  {
    M: [[1, 2, 3], [4, 5, 6], [7, 8, 10]],
    A: [[0.5, 1, 2], [1, 1, 1], [3, 2, 1]],
    I: [[1, 2], [3, 4]],
    Q: [[1, 2], [3, 4]],
    v: [1, 1, 1],
  },
];

/** The interpreter's value of `json` at `p`, or `'error'`. */
function interpreted(json: Json, p: Point): unknown {
  const values = {
    M: list(p.M),
    A: list(p.A),
    I: list(p.I),
    Q: list(p.Q),
    v: box(['List', ...p.v]),
  };
  return ce.withValues(values as never, () => {
    const r = box(json).evaluate();
    return r.operator === 'Error' ? 'error' : read(r);
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

  // A call result has no fact of its rows: the matrix operators decline it,
  // and so does a parameter of a matrix type, which takes a value whose
  // rows have one length only (the interpreter gives `incompatible-type`
  // for rows of different lengths).
  test.each([
    ['Transpose of a call', ['Transpose', ['tr', 'M']], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a call of a call', ['tr', ['tr', 'M']], /an argument of tr for the parameter 1, a matrix, whose rows can have different lengths/],
    ['a list<list<real>> argument', ['tr', 'g'], /an argument of tr for the parameter 1, a matrix, whose rows can have different lengths/],
    ['a list<list<real>> argument of Apply', ['Apply', F(['Length', 'm'], typed('m', 'matrix<real>')), 'g'], /an argument of Apply for the parameter m, a matrix, whose rows can have different lengths/],
  ])('%s declines', (_, json, cause) => {
    expect(declines(json)).toMatch(cause);
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
    ['Determinant', ['Determinant', 'M'], {}, /Determinant of a matrix whose number of rows is known at run time only/],
    ['Inverse', ['Inverse', 'M'], {}, /Inverse of a matrix whose number of rows is known at run time only/],
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
