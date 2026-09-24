import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

// The matrix decompositions and the eigen solvers of the linear-algebra
// library do real arithmetic on the entries. They used to read only the real
// part of a complex entry, and so returned wrong values:
// `SingularValues([[1, i], [0, 1]])` was `[1, 1]` (correct: 1.618…, 0.618…),
// `Eigenvalues([[0, i], [i, 0]])` was `[0, 0]` (correct: ±i), and
// `Eigenvectors` of any complex matrix was `[[1, 0], [1, 0]]`.
//
// Now an operator whose kernel is real-only stays UNEVALUATED for a complex
// entry, and the operators that have a complex-safe method (the 2×2
// eigenvalue formula, the 2×2 symbolic eigenvector, the exact 2×2 Gram
// matrix of the singular values) compute the correct complex result.
//
// Every expected value below was computed independently with numpy
// (`np.linalg.eigvals`, `np.linalg.svd`) or by hand, as noted.
//
// `Conjugate` of an exact complex sum (`1 + √2 i`, which is an `Add`, not a
// number literal) used to stay unevaluated. The expected values are checked
// against the numeric value of the operand.

const ce = new ComputeEngine();

const I: MathJsonExpression = ['Complex', 0, 1];
const c = (re: number, im: number): MathJsonExpression => ['Complex', re, im];

// [[1, i], [0, 1]]
const A: MathJsonExpression = ['List', ['List', 1, I], ['List', 0, 1]];
const A_TEX = '\\begin{pmatrix}1 & i\\\\ 0 & 1\\end{pmatrix}';
// A Hermitian positive-definite matrix: [[2, 1+i], [1-i, 3]]
const H: MathJsonExpression = [
  'List',
  ['List', 2, c(1, 1)],
  ['List', c(1, -1), 3],
];
const H_TEX = '\\begin{pmatrix}2 & 1+i\\\\ 1-i & 3\\end{pmatrix}';
// [[1, i, 0], [0, 1, i], [i, 0, 1]]
const B: MathJsonExpression = [
  'List',
  ['List', 1, I, 0],
  ['List', 0, 1, I],
  ['List', I, 0, 1],
];
const B_TEX =
  '\\begin{pmatrix}1 & i & 0\\\\ 0 & 1 & i\\\\ i & 0 & 1\\end{pmatrix}';
// [[1, 2], [3, 4+i]]
const C: MathJsonExpression = ['List', ['List', 1, 2], ['List', 3, c(4, 1)]];
// [[0, i], [i, 0]]
const J: MathJsonExpression = ['List', ['List', 0, I], ['List', I, 0]];
const J_TEX = '\\begin{pmatrix}0 & i\\\\ i & 0\\end{pmatrix}';

/** The value of an expression as `[re, im]`, from its numeric value. */
function complexValue(x: Expression): [number, number] {
  const v = x.N();
  return [v.re, v.im];
}

/** The elements of a `List` result, or throws when it is not a list. */
function listOps(x: Expression): ReadonlyArray<Expression> {
  if (!isFunction(x, 'List')) throw new Error(`not a list: ${x.toString()}`);
  return x.ops;
}

/** Sort `[re, im]` pairs by real part, then by imaginary part. */
function sortPairs(xs: [number, number][]): [number, number][] {
  return [...xs].sort((a, b) =>
    Math.abs(a[0] - b[0]) > 1e-9 ? a[0] - b[0] : a[1] - b[1]
  );
}

function expectPairsClose(
  actual: [number, number][],
  expected: [number, number][]
): void {
  expect(actual.length).toBe(expected.length);
  const a = sortPairs(actual);
  const e = sortPairs(expected);
  a.forEach(([re, im], k) => {
    expect(re).toBeCloseTo(e[k][0], 9);
    expect(im).toBeCloseTo(e[k][1], 9);
  });
}

/**
 * Check that each eigenvector v with its eigenvalue λ satisfies M·v = λ·v and
 * is not the zero vector. An eigenvector is unique only up to a factor, so
 * this is the independent check, not a comparison with numpy's vectors.
 */
function expectEigenpairs(M: MathJsonExpression): void {
  const values = listOps(ce.box(['Eigenvalues', M]).evaluate());
  const vectors = listOps(ce.box(['Eigenvectors', M]).evaluate());
  expect(vectors.length).toBe(values.length);
  vectors.forEach((v, k) => {
    const residual = ce
      .box([
        'Norm',
        [
          'Subtract',
          ['MatrixMultiply', M, v.json],
          ['Multiply', values[k].json, v.json],
        ],
      ])
      .N();
    expect(residual.re).toBeLessThan(1e-9);
    expect(ce.box(['Norm', v.json]).N().re).toBeGreaterThan(0.1);
  });
}

describe('COMPLEX MATRIX — real-only kernels stay unevaluated', () => {
  const REAL_ONLY = [
    'LUDecomposition',
    'QRDecomposition',
    'CholeskyDecomposition',
    'SVD',
  ];
  for (const head of REAL_ONLY) {
    it(`${head} of a complex matrix (box route)`, () => {
      for (const M of [A, H, B, C])
        expect(ce.box([head, M]).evaluate().operator).toBe(head);
    });
    it(`${head} of a complex matrix (parse route)`, () => {
      for (const tex of [A_TEX, H_TEX, B_TEX]) {
        const expr = ce.parse(`\\operatorname{${head}}(${tex})`);
        expect(expr.operator).toBe(head);
        expect(expr.evaluate().operator).toBe(head);
        expect(expr.N().operator).toBe(head);
      }
    });
  }

  it('a 3×3 complex matrix keeps Eigenvalues and Eigenvectors unevaluated', () => {
    // The characteristic polynomial is (1 − λ)³ − i, whose roots numpy gives
    // as 1 + i, 0.134 − 0.5i, 1.866 − 0.5i. The cubic solver is real-only.
    expect(ce.box(['Eigenvalues', B]).evaluate().operator).toBe('Eigenvalues');
    expect(ce.box(['Eigenvectors', B]).evaluate().operator).toBe(
      'Eigenvectors'
    );
    expect(
      ce.parse(`\\operatorname{Eigenvalues}(${B_TEX})`).evaluate().operator
    ).toBe('Eigenvalues');
  });

  it('a real 3×3 matrix with complex eigenvalues keeps Eigenvectors unevaluated', () => {
    // The eigenvalues of this rotation are 1 and ±i. The float eigenvector
    // solver used the real part 0 of ±i and answered [1, 0, 0], which is not
    // an eigenvector.
    const R3: MathJsonExpression = [
      'List',
      ['List', 0, -1, 0],
      ['List', 1, 0, 0],
      ['List', 0, 0, 1],
    ];
    expect(ce.box(['Eigenvectors', R3]).evaluate().operator).toBe(
      'Eigenvectors'
    );
    // `Eigen` stays unevaluated too, not a tuple with an unevaluated part.
    expect(ce.box(['Eigen', R3]).evaluate().operator).toBe('Eigen');
  });

  it('Eigen of a 3×3 complex matrix stays unevaluated', () => {
    expect(ce.box(['Eigen', B]).evaluate().operator).toBe('Eigen');
    expect(
      ce.parse(`\\operatorname{Eigen}(${B_TEX})`).evaluate().operator
    ).toBe('Eigen');
  });
});

describe('COMPLEX MATRIX — Eigenvalues', () => {
  it('an entry `i` is not read as zero (box and parse routes)', () => {
    // numpy: eigvals([[0, 1j], [1j, 0]]) = [1j, -1j]
    const expected: [number, number][] = [
      [0, 1],
      [0, -1],
    ];
    expectPairsClose(
      listOps(ce.box(['Eigenvalues', J]).evaluate()).map(complexValue),
      expected
    );
    expectPairsClose(
      listOps(ce.parse(`\\operatorname{Eigenvalues}(${J_TEX})`).evaluate()).map(
        complexValue
      ),
      expected
    );
  });

  it('a Hermitian 2×2 matrix has real eigenvalues', () => {
    // numpy: eigvals([[2, 1+1j], [1-1j, 3]]) = [4, 1]
    expectPairsClose(
      listOps(ce.box(['Eigenvalues', H]).evaluate()).map(complexValue),
      [
        [4, 0],
        [1, 0],
      ]
    );
  });
});

describe('COMPLEX MATRIX — Eigenvectors satisfy M·v = λ·v', () => {
  it('a Hermitian matrix', () => expectEigenpairs(H));
  it('a matrix with the entry `i` off the diagonal', () => expectEigenpairs(J));
  it('a complex matrix with complex eigenvalues', () => expectEigenpairs(C));
  it('a diagonal matrix with imaginary entries', () =>
    expectEigenpairs(['List', ['List', I, 0], ['List', 0, c(0, 2)]]));
  it('a real rotation matrix (complex eigenvalues ±i)', () =>
    expectEigenpairs(['List', ['List', 0, -1], ['List', 1, 0]]));

  it('the parse route gives the same eigenvectors', () => {
    const vectors = ce
      .parse(`\\operatorname{Eigenvectors}(${H_TEX})`)
      .evaluate();
    expect(vectors.isSame(ce.box(['Eigenvectors', H]).evaluate())).toBe(true);
  });

  it('an upper triangular matrix with a symbolic entry', () => {
    // [[1, x], [0, 2]]: for λ = 2, (A − 2I)·v = 0 gives v = [x, 1]. The
    // solver used to answer [0, 1], which is an eigenvector only for x = 0.
    const vectors = listOps(
      ce
        .box(['Eigenvectors', ['List', ['List', 1, 'x'], ['List', 0, 2]]])
        .evaluate()
    );
    expect(vectors[1].toString()).toBe('[x,1]');
    // For λ = 1 = a, the vector [x, 0] would be zero for x = 0; [1, 0] is an
    // eigenvector for every x.
    expect(vectors[0].toString()).toBe('[1,0]');
  });
});

describe('COMPLEX MATRIX — SingularValues', () => {
  function singularValues(x: Expression): number[] {
    return listOps(x.evaluate()).map((v) => v.N().re);
  }

  it('[[1, i], [0, 1]] (box and parse routes)', () => {
    // numpy: svd([[1, 1j], [0, 1]]) = [1.61803399, 0.61803399]. By hand, the
    // Gram matrix Aᴴ·A = [[1, i], [−i, 2]] has the trace 3 and the
    // determinant 1, so the singular values are √((3 ± √5)/2).
    const expected = [(1 + Math.sqrt(5)) / 2, (Math.sqrt(5) - 1) / 2];
    for (const expr of [
      ce.box(['SingularValues', A]),
      ce.parse(`\\operatorname{SingularValues}(${A_TEX})`),
    ]) {
      const actual = singularValues(expr);
      expect(actual[0]).toBeCloseTo(expected[0], 12);
      expect(actual[1]).toBeCloseTo(expected[1], 12);
      // The result is exact: `evaluate()` keeps the radicals.
      expect(expr.evaluate().toString()).toBe(
        '[sqrt(1/2 * (3 + sqrt(5))),sqrt(1/2 * (3 - sqrt(5)))]'
      );
    }
  });

  it('matches numpy on other complex matrices', () => {
    const cases: [MathJsonExpression, number[]][] = [
      // numpy: svd([[2, 1+1j], [1-1j, 3]]) = [4, 1]
      [H, [4, 1]],
      // numpy: svd([[1, 2], [3, 4+1j]]) = [5.55318482, 0.40266407]
      [C, [5.553184820459153, 0.40266407]],
      // numpy: svd([[1+1j, 2]]) = [2.44948974]
      [['List', ['List', c(1, 1), 2]], [Math.sqrt(6)]],
      // numpy: svd([[1, 1j], [0, 1], [2, 3]]) = [3.84477958, 1.10348086]
      [
        ['List', ['List', 1, I], ['List', 0, 1], ['List', 2, 3]],
        [3.84477958, 1.10348086],
      ],
    ];
    for (const [M, expected] of cases) {
      const actual = singularValues(ce.box(['SingularValues', M]));
      expect(actual.length).toBe(expected.length);
      actual.forEach((v, k) => expect(v).toBeCloseTo(expected[k], 7));
    }
  });

  it('a 3×3 complex matrix stays unevaluated', () => {
    expect(ce.box(['SingularValues', B]).evaluate().operator).toBe(
      'SingularValues'
    );
  });

  it('N() approximates the exact singular values', () => {
    // [[1, 1], [0, 1]]: √((3 ± √5)/2), the golden ratio and its inverse.
    const values = listOps(
      ce.box(['SingularValues', ['List', ['List', 1, 1], ['List', 0, 1]]]).N()
    );
    expect(values.every((v) => v.isNumberLiteral)).toBe(true);
    expect(values[0].re).toBeCloseTo((1 + Math.sqrt(5)) / 2, 12);
    expect(values[1].re).toBeCloseTo((Math.sqrt(5) - 1) / 2, 12);
  });
});

describe('Conjugate of an exact expression that is not a number literal', () => {
  const cases: [string, string][] = [
    ['1+\\sqrt2 i', '1 - sqrt(2)i'],
    ['1-\\frac12\\sqrt3 i', '1 + sqrt(3)/2i'],
    ['\\pi i', '-i * pi'],
    ['\\sin(1)+\\sqrt5 i', '-sqrt(5)i + sin(1)'],
    ['\\frac{2+\\sqrt3 i}{1+\\sqrt2 i}', '(2 - sqrt(3)i) / (1 - sqrt(2)i)'],
  ];
  for (const [tex, expected] of cases)
    it(`Conjugate(${tex})`, () => {
      const z = ce.parse(tex);
      const [re, im] = complexValue(z);
      for (const conj of [
        ce.parse(`\\overline{${tex}}`),
        ce.box(['Conjugate', z.json]),
      ]) {
        const result = conj.evaluate();
        expect(result.toString()).toBe(expected);
        // The value is the conjugate of the numeric value of the operand.
        const [cre, cim] = complexValue(result);
        expect(cre).toBeCloseTo(re, 12);
        expect(cim).toBeCloseTo(-im, 12);
      }
    });

  it('a symbolic operand stays unevaluated', () => {
    for (const tex of ['z', 'z+1', 'z+i'])
      expect(ce.parse(`\\overline{${tex}}`).evaluate().operator).toBe(
        'Conjugate'
      );
  });

  it('ConjugateTranspose conjugates an exact complex sum', () => {
    const M: MathJsonExpression = [
      'List',
      ['List', 1, ['Add', 1, ['Multiply', ['Sqrt', 2], 'ImaginaryUnit']]],
      ['List', 0, 1],
    ];
    const expected = '[[1,0],[1 - sqrt(2)i,1]]';
    expect(ce.box(['ConjugateTranspose', M]).evaluate().toString()).toBe(
      expected
    );
    expect(
      ce
        .parse(
          '\\operatorname{ConjugateTranspose}(\\begin{pmatrix}1 & 1+\\sqrt2 i\\\\ 0 & 1\\end{pmatrix})'
        )
        .evaluate()
        .toString()
    ).toBe(expected);
  });
});

describe('Real, Imaginary, Argument and Abs of an exact complex sum', () => {
  // An exact complex value such as `1 + √2·i` is an `Add`, not one number
  // literal, and `Real`, `Imaginary` and `Argument` stayed unevaluated for
  // it. The expected values are hand calculations:
  // (2 − 3i)(1 + √2·i) = (2 + 3√2) + (2√2 − 3)i, and
  // |(2 − 3i)(1 + √2·i)| = √13 · √3 = √39.
  const cases: [string, string, string, string, string | undefined][] = [
    // operand, Real, Imaginary, Argument, Abs. `|πi|` stays unevaluated:
    // the exact route of `Abs` requires the squared modulus to be a number
    // literal, and `π²` is not.
    ['1+\\sqrt2 i', '1', 'sqrt(2)', 'arctan(sqrt(2))', 'sqrt(3)'],
    [
      '(2-3i)(1+\\sqrt2 i)',
      '2 + 3sqrt(2)',
      '-3 + 2sqrt(2)',
      'arctan((-3 + 2sqrt(2)) / (2 + 3sqrt(2)))',
      'sqrt(39)',
    ],
    ['\\pi i', '0', 'pi', '1/2 * pi', undefined],
    ['-1-\\sqrt2 i', '-1', '-sqrt(2)', '-pi + arctan(sqrt(2))', 'sqrt(3)'],
    // 1/(1 + √2·i) = (1 − √2·i)/3
    [
      '\\frac{1}{1+\\sqrt2 i}',
      '1/3',
      '-sqrt(2)/3',
      'arctan(-sqrt(2))',
      undefined,
    ],
    // (2 + i)/(1 + √2·i) = ((2 + √2) + (1 − 2√2)i)/3
    [
      '\\frac{2+i}{1+\\sqrt2 i}',
      '1/3 * (2 + sqrt(2))',
      '1/3 * (1 - 2sqrt(2))',
      'arctan((1 - 2sqrt(2)) / (2 + sqrt(2)))',
      undefined,
    ],
    // (1 + √2·i)² = −1 + 2√2·i
    ['(1+\\sqrt2 i)^2', '-1', '2sqrt(2)', 'pi + arctan(-2sqrt(2))', undefined],
    // (1 + √2·i)⁻² = 1/(−1 + 2√2·i) = (−1 − 2√2·i)/9
    [
      '(1+\\sqrt2 i)^{-2}',
      '-1/9',
      '-2/9sqrt(2)',
      '-pi + arctan(2sqrt(2))',
      undefined,
    ],
  ];
  for (const [tex, re, im, arg, abs] of cases)
    it(`parts of ${tex}`, () => {
      const z = ce.parse(tex);
      const [zre, zim] = complexValue(z);
      const expected: [string, string, number][] = [
        ['Real', re, zre],
        ['Imaginary', im, zim],
        ['Argument', arg, Math.atan2(zim, zre)],
      ];
      if (abs !== undefined) expected.push(['Abs', abs, Math.hypot(zre, zim)]);
      for (const [op, str, value] of expected) {
        const latex =
          op === 'Real'
            ? `\\operatorname{Re}(${tex})`
            : op === 'Imaginary'
              ? `\\operatorname{Im}(${tex})`
              : op === 'Argument'
                ? `\\arg(${tex})`
                : `|${tex}|`;
        for (const expr of [ce.parse(latex), ce.box([op, z.json])]) {
          const result = expr.evaluate();
          expect(result.toString()).toBe(str);
          // The exact value agrees with the numeric value of the operand.
          expect(result.N().re).toBeCloseTo(value, 12);
          expect(expr.N().re).toBeCloseTo(value, 12);
        }
      }
    });

  it('a symbolic operand stays unevaluated', () => {
    for (const [op, tex] of [
      ['Real', 'z+i'],
      ['Imaginary', 'z+1'],
      ['Argument', '1+z i'],
    ])
      expect(ce.box([op, ce.parse(tex).json]).evaluate().operator).toBe(op);
  });

  it('a power with an exponent past 16 stays unevaluated', () => {
    for (const op of ['Real', 'Imaginary', 'Argument'])
      expect(
        ce.box([op, ce.parse('(1+\\sqrt2 i)^{17}').json]).evaluate().operator
      ).toBe(op);
  });

  it('the argument of a real constant sum is 0 or π', () => {
    // √2 − π < 0 and π − √2 > 0. `isNegative` does not know the sign of
    // the sum, so the exact comparison with zero decides it.
    for (const [tex, str, value] of [
      ['\\sqrt2-\\pi', 'pi', Math.PI],
      ['\\pi-\\sqrt2', '0', 0],
    ] as const) {
      for (const expr of [
        ce.parse(`\\arg(${tex})`),
        ce.box(['Argument', ce.parse(tex).json]),
      ]) {
        expect(expr.evaluate().toString()).toBe(str);
        expect(expr.N().re).toBeCloseTo(value, 12);
      }
    }
  });
});

// The quotient rule of `partsOfConstant` needs `c² + d² > 0`. For a constant
// such as `1 + (√2 − π)²`, `isPositive` is not known, so an exact comparison
// with zero decides it.
describe('REAL PART OF A QUOTIENT WITH A CONSTANT-SUM DENOMINATOR', () => {
  test('Re(1/((√2 − π) + i)) evaluates and agrees with N()', () => {
    const ce = new ComputeEngine();
    const e = ce.parse(
      '\\operatorname{Re}(\\frac{1}{(\\sqrt{2}-\\pi)+\\imaginaryI})'
    );
    const v = e.evaluate();
    expect(v.operator).not.toBe('Real');
    expect(v.N().re).toBeCloseTo(e.N().re, 12);
    expect(v.N().re).toBeCloseTo(-0.433596663237069, 12);
  });
});
