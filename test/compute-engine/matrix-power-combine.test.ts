import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// A positive whole-number power of a matrix is the matrix power, and the
// powers of one matrix commute with each other. So the product of two such
// powers of one matrix is one matrix power: `A^2·A^3` is `A^5`. The product
// of matrices is not commutative, so two powers of `A` that another matrix
// separates are not merged: `A^2·B·A^3` stays as it is.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('A', 'matrix<2x2>');
  ce.declare('B', 'matrix<2x2>');
  ce.declare('C', 'matrix<2x2>');
  return ce;
}

const ce = engine();

const str = (x: Expression) => x.toString();

describe('PRODUCT OF POWERS OF ONE MATRIX', () => {
  test.each([
    ['A^2 A^3', 'MatrixPower(A, 5)'],
    ['A^2\\cdot A^3', 'MatrixPower(A, 5)'],
    ['A A^2', 'MatrixPower(A, 3)'],
    ['A^2 A', 'MatrixPower(A, 3)'],
    ['A^2 A^2', 'MatrixPower(A, 4)'],
    ['A^2 A^3 A^4', 'MatrixPower(A, 9)'],
    ['2A^2 A^3', '2MatrixPower(A, 5)'],
    ['A^2 A^3 B', 'MatrixPower(A, 5) * B'],
    ['B A A^2', 'B * MatrixPower(A, 3)'],
  ])('evaluate %s', (latex, expected) => {
    expect(str(ce.parse(latex).evaluate())).toBe(expected);
  });

  test.each([
    ['A^2 A^3', 'MatrixPower(A, 5)'],
    ['A A^2', 'MatrixPower(A, 3)'],
  ])('simplify %s', (latex, expected) => {
    expect(str(ce.parse(latex).simplify())).toBe(expected);
  });

  test('the box route and the ce.function route merge too', () => {
    expect(
      str(ce.box(['Multiply', ['Power', 'A', 2], ['Power', 'A', 3]]).evaluate())
    ).toBe('MatrixPower(A, 5)');
    expect(
      str(
        ce
          .box(['Multiply', ['MatrixPower', 'A', 2], ['MatrixPower', 'A', 3]])
          .evaluate()
      )
    ).toBe('MatrixPower(A, 5)');
    expect(
      str(
        ce
          .function('Multiply', [
            ce.box(['MatrixPower', 'A', 2]),
            ce.box(['MatrixPower', 'A', 3]),
          ])
          .evaluate()
      )
    ).toBe('MatrixPower(A, 5)');
    expect(
      str(
        ce.function('Multiply', [ce.symbol('A'), ce.box(['Power', 'A', 2])])
          .evaluate()
      )
    ).toBe('MatrixPower(A, 3)');
  });
});

describe('PRODUCTS OF MATRIX POWERS THAT DO NOT MERGE', () => {
  test.each([
    // Another matrix is between the two powers of `A`
    ['A^2 B A^3', 'MatrixPower(A, 2) * B * MatrixPower(A, 3)'],
    ['A B A^2', 'A * B * MatrixPower(A, 2)'],
    // The merge of a positive and a negative power needs an invertible `A`
    ['A^2 A^{-1}', 'MatrixPower(A, 2) * Inverse(A)'],
    ['A^{-2} A^2', 'MatrixPower(A, -2) * MatrixPower(A, 2)'],
    // `MatrixPower(A, 0)` is the identity matrix, not the number 1
    ['A A^0', 'A * MatrixPower(A, 0)'],
    // A non-integer power of a matrix is element-wise
    ['A^2 A^{1/2}', 'MatrixPower(A, 2) * sqrt(A)'],
    // Two different matrices with the same exponent are not grouped:
    // `A^2·B^2` is not `(A·B)^2`
    ['A^2 B^2', 'MatrixPower(A, 2) * MatrixPower(B, 2)'],
    ['A A B B', 'MatrixPower(A, 2) * MatrixPower(B, 2)'],
    ['A B^2 C^2', 'A * MatrixPower(B, 2) * MatrixPower(C, 2)'],
    ['A^2 x B^2', 'x * MatrixPower(A, 2) * MatrixPower(B, 2)'],
    // Two powers of `A` with the same exponent that `B` separates are not
    // grouped either: `A^2·B·A^2` is not `(A·A)^2·B`
    ['A^2 B A^2', 'MatrixPower(A, 2) * B * MatrixPower(A, 2)'],
    [
      'A^2 B^2 A^2',
      'MatrixPower(A, 2) * MatrixPower(B, 2) * MatrixPower(A, 2)',
    ],
    // A positive and a negative power of `A` are not merged. The quotient of
    // two matrices is element-wise, so it is not a matrix power at all.
    ['\\frac{A^2}{A}', 'MatrixPower(A, 2) / A'],
    ['\\frac{AA}{A}', 'MatrixPower(A, 2) / A'],
  ])('evaluate %s', (latex, expected) => {
    expect(str(ce.parse(latex).evaluate())).toBe(expected);
  });

  test('the power of a product of matrices is one factor', () => {
    // `(A·B)^2·B` is `A·B·A·B·B`, not `A^2·B^3`
    expect(
      str(
        ce
          .box(['Multiply', ['MatrixPower', ['Multiply', 'A', 'B'], 2], 'B'])
          .evaluate()
      )
    ).toBe('MatrixPower(A * B, 2) * B');
    expect(
      str(
        ce
          .box(['Multiply', 'B', ['MatrixPower', ['Multiply', 'A', 'B'], 2]])
          .evaluate()
      )
    ).toBe('B * MatrixPower(A * B, 2)');
  });
});

describe('POWER OF A POWER OF ONE MATRIX', () => {
  test.each([
    ['(A^2)^3', 'MatrixPower(A, 6)'],
    ['((A^2)^3)^2', 'MatrixPower(A, 12)'],
    // A zero or negative exponent is left as it is
    ['(A^2)^0', 'MatrixPower(MatrixPower(A, 2), 0)'],
    ['(A^2)^{-1}', 'Inverse(MatrixPower(A, 2))'],
  ])('canonical %s', (latex, expected) => {
    expect(str(ce.parse(latex))).toBe(expected);
  });

  test('a MatrixPower of a MatrixPower evaluates to one MatrixPower', () => {
    expect(
      str(ce.box(['MatrixPower', ['MatrixPower', 'A', 2], 3]).evaluate())
    ).toBe('MatrixPower(A, 6)');
  });
});

describe('THE MERGED POWER HAS THE VALUE OF THE PRODUCT', () => {
  // The forms are built while `A` has no value, so that they are merged,
  // then evaluated after `A` is assigned a matrix.
  test.each([
    ['A^2 A^3', 'A^5'],
    ['A A^2', 'A^3'],
    ['A^2 A^2', 'A^4'],
    ['(A^2)^3', 'A^6'],
  ])('%s = %s', (product, power) => {
    const ce = engine();
    const p = ce.parse(product);
    const q = ce.parse(power);
    // The product written with the matrix literal in place of `A`
    const direct = ce.parse(
      product.replace(/A/g, '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}')
    );
    expect(str(p.evaluate())).toBe(str(q.evaluate()));
    ce.assign('A', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    const value = str(p.evaluate());
    expect(value).toBe(str(q.evaluate()));
    expect(value).toBe(str(direct.evaluate()));
  });

  test('A^5 of [[1, 2], [3, 4]]', () => {
    const ce = engine();
    const p = ce.parse('A^2 A^3');
    ce.assign('A', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(str(p.evaluate())).toBe('[[1069,1558],[2337,3406]]');
  });
});

describe('THE EVALUATED PRODUCT HAS THE VALUE OF THE WRITTEN PRODUCT', () => {
  // The product is evaluated while `A` and `B` have no value. That result is
  // then evaluated after `A` and `B` are assigned matrices, and compared with
  // the product of the matrix literals in the written order.
  const a = ['List', ['List', 1, 2], ['List', 3, 4]];
  const b = ['List', ['List', 0, 1], ['List', 1, 1]];
  const literals = (x: unknown): unknown =>
    x === 'A'
      ? ['Matrix', a]
      : x === 'B'
        ? ['Matrix', b]
        : Array.isArray(x)
          ? x.map(literals)
          : x;
  test.each([
    [['Multiply', ['Power', 'A', 2], ['Power', 'B', 2]]],
    [['Multiply', ['Power', 'A', 2], 'B', ['Power', 'A', 2]]],
    [['Multiply', 'A', 'A', 'B', 'B']],
    [['Multiply', ['MatrixPower', ['Multiply', 'A', 'B'], 2], 'B']],
    [['Multiply', 'B', 'A', ['Power', 'A', 2]]],
    [['Multiply', ['Power', 'A', 2], ['Power', 'A', 3], 'B']],
    [['Divide', ['Power', 'A', 2], 'A']],
    [['MatrixPower', ['MatrixPower', 'A', 2], 1]],
  ])('%j', (product) => {
    const ce = engine();
    const symbolic = ce.box(product as any).evaluate();
    const direct = ce.box(literals(product) as any).evaluate();
    ce.assign('A', ce.box(a as any));
    ce.assign('B', ce.box(b as any));
    expect(str(symbolic.evaluate())).toBe(str(direct));
  });
});

describe('A MATRIX POWER WITH THE EXPONENT 1', () => {
  test('MatrixPower(MatrixPower(A, 2), 1) evaluates to MatrixPower(A, 2)', () => {
    expect(
      str(ce.box(['MatrixPower', ['MatrixPower', 'A', 2], 1]).evaluate())
    ).toBe('MatrixPower(A, 2)');
  });
});

describe('A FACTOR OF UNKNOWN TYPE BETWEEN TWO POWERS OF ONE MATRIX', () => {
  // `g(A)` could be a matrix, so `A^2·g(A)·A^3` is not `A^5·g(A)` in
  // general. The canonical form of the product moves `g(A)` before the
  // matrices, because the canonical order treats a factor that is not
  // known to be a matrix as a scalar. So the merge cannot see that `g(A)`
  // was between the two powers.
  test.todo('A^2 g(A) A^3 does not merge the two powers of A');
});
