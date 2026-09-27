/**
 * `SVD` of a matrix with a complex entry.
 *
 * The kernel `singularValueDecomposition(re, im)` gives the complex `U` and
 * `V`, and `SVD` uses it for a complex matrix: `A = U Σ Vᴴ`, with U and V
 * unitary and `Vᴴ` the conjugate transpose of V. The entries are read as
 * `SingularValues` reads them, so a matrix of exact entries is decomposed
 * under `.N()` only.
 *
 * Each result is checked by reconstructing `U Σ Vᴴ` and comparing it to the
 * input, entry by entry.
 */

import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

const ce = new ComputeEngine();

type C = [number, number];

const c = (re: number, im: number): MathJsonExpression => ['Complex', re, im];

// A Hermitian positive-definite matrix, singular values 4 and 1.
const H: MathJsonExpression = [
  'List',
  ['List', 2, c(1, 1)],
  ['List', c(1, -1), 3],
];
const H_TEX = '\\begin{pmatrix}2 & 1+i\\\\ 1-i & 3\\end{pmatrix}';
// A 3 × 2 complex matrix.
const K: MathJsonExpression = [
  'List',
  ['List', c(1, 2), 3],
  ['List', c(0, -1), c(2, 1)],
  ['List', 4, c(-1, 1)],
];
// A 2 × 3 complex matrix (more columns than rows).
const W: MathJsonExpression = [
  'List',
  ['List', c(1, 1), 0, c(0, 2)],
  ['List', 2, c(3, -1), 1],
];

function rows(x: Expression): ReadonlyArray<Expression> {
  if (!isFunction(x, 'List')) throw new Error(`not a list: ${x.toString()}`);
  return x.ops;
}

/** A matrix expression as rows of `[re, im]`. */
function complexMatrix(x: Expression): C[][] {
  return rows(x).map((row) =>
    rows(row).map((e): C => {
      const v = e.N();
      return [v.re, v.im];
    })
  );
}

const mul = (a: C, b: C): C => [
  a[0] * b[0] - a[1] * b[1],
  a[0] * b[1] + a[1] * b[0],
];

/** `U Σ Vᴴ`. */
function reconstruct(U: C[][], S: C[][], V: C[][]): C[][] {
  const m = U.length;
  const n = V.length;
  const result: C[][] = [];
  for (let i = 0; i < m; i++) {
    result.push([]);
    for (let j = 0; j < n; j++) {
      let sum: C = [0, 0];
      for (let k = 0; k < Math.min(m, n); k++) {
        // (Vᴴ)ₖⱼ = conj(Vⱼₖ)
        const vh: C = [V[j][k][0], -V[j][k][1]];
        const t = mul(mul(U[i][k], S[k][k]), vh);
        sum = [sum[0] + t[0], sum[1] + t[1]];
      }
      result[i].push(sum);
    }
  }
  return result;
}

/** `Qᴴ Q`, which is the identity for a unitary `Q`. */
function gram(Q: C[][]): C[][] {
  const n = Q[0].length;
  const result: C[][] = [];
  for (let a = 0; a < n; a++) {
    result.push([]);
    for (let b = 0; b < n; b++) {
      let sum: C = [0, 0];
      for (let i = 0; i < Q.length; i++) {
        const t = mul([Q[i][a][0], -Q[i][a][1]], Q[i][b]);
        sum = [sum[0] + t[0], sum[1] + t[1]];
      }
      result[a].push(sum);
    }
  }
  return result;
}

function expectClose(actual: C[][], expected: C[][]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((row, i) => {
    expect(row.length).toBe(expected[i].length);
    row.forEach((x, j) => {
      expect(Math.abs(x[0] - expected[i][j][0])).toBeLessThan(1e-10);
      expect(Math.abs(x[1] - expected[i][j][1])).toBeLessThan(1e-10);
    });
  });
}

const identity = (n: number): C[][] =>
  Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j): C => [i === j ? 1 : 0, 0])
  );

function checkSVD(M: MathJsonExpression, result: Expression): void {
  if (!isFunction(result, 'Tuple'))
    throw new Error(`not a tuple: ${result.toString()}`);
  const [U, S, V] = result.ops.map(complexMatrix);
  const A = complexMatrix(ce.box(M));
  const m = A.length;
  const n = A[0].length;

  expect(U.length).toBe(m);
  expect(U[0].length).toBe(m);
  expect(S.length).toBe(m);
  expect(S[0].length).toBe(n);
  expect(V.length).toBe(n);
  expect(V[0].length).toBe(n);

  expectClose(reconstruct(U, S, V), A);
  expectClose(gram(U), identity(m));
  expectClose(gram(V), identity(n));

  // Σ is real, non-negative, diagonal, in descending order.
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      expect(S[i][j][1]).toBe(0);
      if (i !== j) expect(S[i][j][0]).toBe(0);
    }
  const sigma = Array.from({ length: Math.min(m, n) }, (_, k) => S[k][k][0]);
  for (let k = 0; k < sigma.length; k++) {
    expect(sigma[k]).toBeGreaterThanOrEqual(0);
    if (k > 0) expect(sigma[k]).toBeLessThanOrEqual(sigma[k - 1]);
  }

  // The singular values are those of `SingularValues`.
  const expected = rows(ce.box(['SingularValues', M]).N()).map((x) => x.re);
  expect(sigma.length).toBe(expected.length);
  sigma.forEach((s, k) =>
    expect(Math.abs(s - expected[k])).toBeLessThan(1e-10)
  );
}

describe('COMPLEX SVD', () => {
  test('SVD of [[2, 1+i], [1-i, 3]] under N() (box route)', () => {
    const result = ce.box(['SVD', H]).N();
    checkSVD(H, result);
    // The singular values of this Hermitian positive-definite matrix are its
    // eigenvalues, 4 and 1 (trace 5, determinant 6 − 2 = 4).
    if (!isFunction(result, 'Tuple')) throw new Error('not a tuple');
    const S = complexMatrix(result.ops[1]);
    expect(S[0][0][0]).toBeCloseTo(4, 12);
    expect(S[1][1][0]).toBeCloseTo(1, 12);
  });

  test('SVD of [[2, 1+i], [1-i, 3]] under N() (parse route)', () => {
    const expr = ce.parse(`\\operatorname{SVD}(${H_TEX})`);
    expect(expr.operator).toBe('SVD');
    checkSVD(H, expr.N());
  });

  test('SVD of a 3 × 2 complex matrix under N()', () => {
    checkSVD(K, ce.box(['SVD', K]).N());
  });

  test('SVD of a 2 × 3 complex matrix under N()', () => {
    checkSVD(W, ce.box(['SVD', W]).N());
  });

  test('SVD of exact complex entries stays unevaluated under evaluate()', () => {
    // As for `SingularValues`: only `.N()` gives a numeric answer for a
    // matrix of exact entries.
    expect(ce.box(['SVD', H]).evaluate().operator).toBe('SVD');
  });

  test('SVD of a complex matrix with a float entry evaluates', () => {
    const M: MathJsonExpression = [
      'List',
      ['List', c(1, 0.5), 2],
      ['List', 0, 3],
    ];
    checkSVD(M, ce.box(['SVD', M]).evaluate());
  });
});
