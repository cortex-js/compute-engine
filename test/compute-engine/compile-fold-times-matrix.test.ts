import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A compiled `Multiply` of a fold (`Sum(L)`, `Reduce(L, Add, 0)`), whose
// value may be a number or a list at run time, and a matrix (ROADMAP
// CE-388). The product is decided on the shapes of the values
// (`_SYS.mulChecked`), as the interpreter decides it: the matrix product when
// a factor is a matrix.

type C = { re: number; im: number };
const c = (re: number, im: number): C => ({ re, im });

function toJson(v: unknown): unknown {
  if (Array.isArray(v)) return ['List', ...v.map(toJson)];
  if (typeof v === 'object' && v !== null)
    return ['Complex', (v as C).re, (v as C).im];
  return v;
}

const M = [
  [0, 1],
  [1, 0],
];
const MATRICES = [
  [
    [1, 2],
    [3, 4],
  ],
  [
    [1, 0],
    [0, 1],
  ],
];

/** The compiled value and the interpreter's value, with `L` declared
 * `type` and `M` declared `matrix<number>`. */
function both(type: string, expr: unknown, value: unknown) {
  const ce = new ComputeEngine();
  ce.declare('L', type);
  ce.declare('M', 'matrix<number>');
  const r = compile(ce.box(expr as any), {
    to: 'javascript',
    fallback: false,
  } as any);
  expect(r.success).toBe(true);
  const ce2 = new ComputeEngine();
  ce2.declare('L', type);
  ce2.declare('M', 'matrix<number>');
  ce2.assign('L', ce2.box(toJson(value) as any));
  ce2.assign('M', ce2.box(toJson(M) as any));
  return {
    compiled: r.run!({ L: value, M } as never),
    evaluated: ce2
      .box(expr as any)
      .evaluate()
      .toString(),
  };
}

describe('THE PRODUCT OF A FOLD AND A MATRIX (CE-388)', () => {
  test.each([
    ['list<matrix<number>>', ['Multiply', ['Sum', 'L'], 'M']],
    ['list<tensor<number>>', ['Multiply', ['Sum', 'L'], 'M']],
    ['list<unknown>', ['Multiply', ['Sum', 'L'], 'M']],
  ])('%s: %j is the matrix product', (type, expr) => {
    const r = both(type, expr, MATRICES);
    expect(r.compiled).toEqual([
      [2, 2],
      [5, 3],
    ]);
    expect(r.evaluated).toBe('[[2,2],[5,3]]');
  });

  test.each([
    ['list<matrix<number>>'],
    ['list<tensor<number>>'],
    ['list<list<unknown>>'],
  ])('%s: M · Reduce(L, Add, 0) is the matrix product', (type) => {
    const r = both(
      type,
      ['Multiply', 'M', ['Reduce', 'L', 'Add', 0]],
      MATRICES
    );
    expect(r.compiled).toEqual([
      [3, 5],
      [2, 2],
    ]);
    expect(r.evaluated).toBe('[[3,5],[2,2]]');
  });

  test('a number scales the product', () => {
    const r = both(
      'list<matrix<number>>',
      ['Multiply', 2, ['Sum', 'L'], 'M'],
      MATRICES
    );
    expect(r.compiled).toEqual([
      [4, 4],
      [10, 6],
    ]);
    expect(r.evaluated).toBe('[[4,4],[10,6]]');
  });

  test('a vector times a matrix', () => {
    const r = both(
      'list<vector<number>>',
      ['Multiply', ['Sum', 'L'], 'M'],
      [
        [1, 2],
        [3, 4],
      ]
    );
    expect(r.compiled).toEqual([6, 4]);
    expect(r.evaluated).toBe('[6,4]');
  });

  test('Sum(L) · Sum(L) over list<unknown>', () => {
    const r = both(
      'list<unknown>',
      ['Multiply', ['Sum', 'L'], ['Sum', 'L']],
      MATRICES
    );
    expect(r.compiled).toEqual([
      [10, 14],
      [21, 31],
    ]);
    expect(r.evaluated).toBe('[[10,14],[21,31]]');
  });

  // The complex form (`_SYS.cmulChecked`) reads complex entries in the
  // matrix product and in the product of two numbers.
  test('complex matrices', () => {
    const r = both(
      'list<matrix<complex>>',
      ['Multiply', ['Sum', 'L'], 'M'],
      [
        [
          [c(1, 1), 2],
          [3, 4],
        ],
        [
          [1, 0],
          [0, 1],
        ],
      ]
    );
    expect(r.compiled).toEqual([
      [2, c(2, 1)],
      [5, 3],
    ]);
    expect(r.evaluated).toBe('[[2,(2 + i)],[5,3]]');
  });

  // The complex form gives `{re, im}` entries also when the values are
  // real at run time: `Real` of an entry reads `.re`.
  test('complex matrices whose values are real', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<matrix<complex^2x2>>');
    ce.declare('M', 'matrix<number>');
    const r = compile(
      ce.box(['Real', ['At', ['At', ['Multiply', ['Sum', 'L'], 'M'], 1], 1]]),
      { to: 'javascript', fallback: false }
    );
    expect(r.run!({ L: MATRICES, M } as never)).toBe(2);
  });

  test('complex numbers in a list of unknown type', () => {
    const r = both(
      'list<unknown>',
      ['Add', ['Multiply', ['Sum', 'L'], ['Sum', 'L']], 1],
      [c(1, 1), 2]
    );
    expect(r.compiled).toEqual(c(9, 6));
    expect(r.evaluated).toBe('(9 + 6i)');
  });

  // Dimensions that do not agree: `NaN` in compiled code, the
  // `incompatible-dimensions` error in the interpreter.
  test('dimensions that do not agree', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<matrix<number>>');
    ce.declare('M', 'matrix<number>');
    const r = compile(ce.box(['Multiply', ['Sum', 'L'], 'M']), {
      to: 'javascript',
      fallback: false,
    });
    expect(
      r.run!({
        L: [
          [
            [1, 2, 3],
            [3, 4, 5],
          ],
        ],
        M,
      } as never)
    ).toBeNaN();
  });

  // A point beside a matrix still does not compile: the interpreter scales
  // each entry of the matrix by the point, and compiled code holds a point
  // as an array, as it holds a vector.
  // The same holds for a value that may be a list of points: the run-time
  // product would read `[[1, 2], [3, 4]]` as a matrix. A `list<any>` may
  // hold points too (`Sum(L)` over `list<list<unknown>>`).
  test.each([
    ['list<tuple<number, number>>', ['Multiply', ['Sum', 'L'], 'M']],
    ['list<list<tuple<number, number>>>', ['Multiply', ['Sum', 'L'], 'M']],
    ['list<list<tuple<number, number>>>', ['Multiply', ['At', 'L', 1], 'M']],
    ['list<list<unknown>>', ['Multiply', ['Sum', 'L'], 'M']],
  ])('%s: %j does not compile', (type, expr) => {
    const ce = new ComputeEngine();
    ce.declare('L', type);
    ce.declare('M', 'matrix<number>');
    expect(() =>
      compile(ce.box(expr as any), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/Could not compile/);
  });
});
