import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

// CE-1537: the sum and the difference of two lists of points of run-time
// lengths (`P, Q: list<tuple<X, X>>`) declined ("lists of different lengths
// or ranks"): the IR read two run-time lengths as a fit at rank 1 only.
// CE-1539: the power of a list of points (`Power(q, 2)`) declined as the
// power of a matrix; a list of points is not a matrix, and the interpreter
// raises each coordinate of each point.
//
// Each compiled value is compared with the interpreter's. GLSL is not
// tested: it refuses a parameter of rank 2 (a list of points as an input).

const X = 'real | signed_infinity | nan';
const P = [
  [1, 2],
  [3, 4],
];
const Q = [
  [10, 10],
  [20, 20],
];

/** The interpreter's value of `expr` at P, Q, x = 3, as nested arrays. */
function interpreted(decl: string, expr: MathJsonExpression): unknown {
  const ce = new ComputeEngine();
  ce.declare('P', decl);
  ce.declare('Q', decl);
  ce.declare('x', 'real');
  const e = ce.box(expr);
  ce.assign('P', ce.box(['List', ...P.map((p) => ['Tuple', ...p])]));
  ce.assign('Q', ce.box(['List', ...Q.map((p) => ['Tuple', ...p])]));
  ce.assign('x', 3);
  const value = e.evaluate().N();
  const plain = (v: typeof value): unknown =>
    v.isCollection ? [...v.each()].map(plain) : v.re;
  return plain(value);
}

function compiled(
  decl: string,
  expr: MathJsonExpression,
  to: 'javascript' | 'interval-js' = 'javascript'
): unknown {
  const ce = new ComputeEngine();
  ce.declare('P', decl);
  ce.declare('Q', decl);
  ce.declare('x', 'real');
  const result = compile(ce.box(expr), { to, fallback: false });
  expect(result.success).toBe(true);
  return result.run!({ P, Q, x: 3 });
}

const CASES: [string, MathJsonExpression, unknown][] = [
  [
    'Add(P, Q)',
    ['Add', 'P', 'Q'],
    [
      [11, 12],
      [23, 24],
    ],
  ],
  [
    'Subtract(P, Q)',
    ['Subtract', 'P', 'Q'],
    [
      [-9, -8],
      [-17, -16],
    ],
  ],
  ['PointX(Add(P, Q))', ['PointX', ['Add', 'P', 'Q']], [11, 23]],
  ['PointX(Subtract(P, Q))', ['PointX', ['Subtract', 'P', 'Q']], [-9, -17]],
  [
    'Add(P, Q, P)',
    ['Add', 'P', 'Q', 'P'],
    [
      [12, 14],
      [26, 28],
    ],
  ],
  [
    'Power(P, 2)',
    ['Power', 'P', 2],
    [
      [1, 4],
      [9, 16],
    ],
  ],
  [
    'Power(P, x)',
    ['Power', 'P', 'x'],
    [
      [1, 8],
      [27, 64],
    ],
  ],
  [
    'Power(P, Q)',
    ['Power', 'P', 'Q'],
    [
      [1, 1024],
      [3 ** 20, 4 ** 20],
    ],
  ],
  [
    'Multiply(P, 2)',
    ['Multiply', 'P', 2],
    [
      [2, 4],
      [6, 8],
    ],
  ],
  [
    'Negate(P)',
    ['Negate', 'P'],
    [
      [-1, -2],
      [-3, -4],
    ],
  ],
  [
    'Add(P, (1, 1))',
    ['Add', 'P', ['Tuple', 1, 1]],
    [
      [2, 3],
      [4, 5],
    ],
  ],
];

describe('CE-1537, CE-1539: arithmetic over lists of points compiles', () => {
  for (const decl of [
    `list<tuple<${X}, ${X}>>`,
    'list<tuple<real, real>>',
    'list<tuple<real, real>^2>',
  ]) {
    describe(decl, () => {
      test.each(CASES)('%s', (_, expr, expected) => {
        expect(interpreted(decl, expr)).toEqual(expected);
        expect(compiled(decl, expr)).toEqual(expected);
      });
    });
  }

  test('interval-js: the sum and the power of lists of points', () => {
    const decl = 'list<tuple<real, real>>';
    const point = (v: unknown) =>
      (v as { value: { lo: number; hi: number } }[]).map((c) => c.value.lo);
    expect(
      (compiled(decl, ['Add', 'P', 'Q'], 'interval-js') as unknown[]).map(point)
    ).toEqual(interpreted(decl, ['Add', 'P', 'Q']));
    expect(
      (compiled(decl, ['Power', 'P', 2], 'interval-js') as unknown[]).map(point)
    ).toEqual(interpreted(decl, ['Power', 'P', 2]));
  });

  test('interval-js: the power of a matrix input declines, of a list of points squares each coordinate', () => {
    // `A^2` is the matrix power in the interpreter (`[[7, 10], [15, 22]]` at
    // `[[1, 2], [3, 4]]`); the interval mode read `Power(A, 2)` as `square`
    // of each element.
    const ce = new ComputeEngine();
    ce.declare('A', 'list<vector<real^2>>');
    ce.declare('P', 'list<tuple<real, real>>');
    for (const k of [2, 3, 0.5] as MathJsonExpression[])
      expect(() =>
        compile(ce.box(['Power', 'A', k]), {
          to: 'interval-js',
          fallback: false,
        })
      ).toThrow(/Power of a matrix/);
    const r = compile(ce.box(['Power', 'P', 2]), {
      to: 'interval-js',
      fallback: false,
    });
    const lo = (v: unknown) =>
      (v as { value: { lo: number } }[]).map((c) => c.value.lo);
    expect((r.run!({ P } as never) as unknown[]).map(lo)).toEqual(
      interpreted('list<tuple<real, real>>', ['Power', 'P', 2])
    );
  });

  test('the power of a matrix is the matrix power (the interval mode declines it)', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box([
      'Power',
      ['List', ['List', 1, 'x'], ['List', 3, 4]],
      2,
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.run!({ x: 2 } as never)).toEqual([
      [7, 10],
      [15, 22],
    ]);
    expect(() =>
      compile(expr, { to: 'interval-js', fallback: false })
    ).toThrow(/Could not compile/);
  });
});
