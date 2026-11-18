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

/** Compile `expr` with the default fallback, and evaluate it with the
 * interpreter. A fold over elements typed `unknown` has no settled shape:
 * the compilation declines with `unsettled-shape`, and the interpreter
 * gives the value (ROADMAP CE-805). */
function declined(
  type: string,
  expr: unknown,
  value: unknown,
  mode?: 'complex'
) {
  const ce = new ComputeEngine();
  ce.declare('L', type);
  ce.declare('M', 'matrix<number>');
  const r = compile(ce.box(expr as any), {
    to: 'javascript',
    ...(mode ? { mode } : {}),
  } as any);
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
  ce.assign('L', ce.box(toJson(value) as any));
  ce.assign('M', ce.box(toJson(M) as any));
  return ce
    .box(expr as any)
    .evaluate()
    .toString();
}

describe('THE PRODUCT OF A FOLD AND A MATRIX (CE-388)', () => {
  test('list<unknown>: Sum(L) · M declines, and the interpreter gives the matrix product', () => {
    expect(
      declined('list<unknown>', ['Multiply', ['Sum', 'L'], 'M'], MATRICES)
    ).toBe('[[2,2],[5,3]]');
  });

  test('Sum(L) · Sum(L) over list<unknown> declines', () => {
    expect(
      declined(
        'list<unknown>',
        ['Multiply', ['Sum', 'L'], ['Sum', 'L']],
        MATRICES
      )
    ).toBe('[[10,14],[21,31]]');
  });

  test('complex numbers in a list of unknown type decline', () => {
    expect(
      declined(
        'list<unknown>',
        ['Add', ['Multiply', ['Sum', 'L'], ['Sum', 'L']], 1],
        [c(1, 1), 2],
        'complex'
      )
    ).toBe('(9 + 6i)');
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
