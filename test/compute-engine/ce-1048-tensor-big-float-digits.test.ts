import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// LIST AND MATRIX ARITHMETIC ABOVE MACHINE PRECISION
//
// The element-wise sum and product of lists, the product of a number and a
// list or a matrix, and the matrix product compute on a packed tensor
// (`packTensor()`, `boxed-expression/tensor-view.ts`). A float64 cell keeps
// only about 16 digits, so an element that is a big-number float with more
// digits than a double holds makes the tensor use the `expression` dtype
// (`float64HoldsDigits()`, `tensor/tensor-fields.ts`), whose cells are the
// boxed elements. At machine precision, every big-number float does so, also
// one that a double holds. These tests hold that each element of the result
// is the value that the interpreter computes for the same scalars.
//

const BIG = '0.123456789012345678901234567';
const BIG_TIMES_2 = '0.246913578024691357802469134';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 30;
  return ce;
}

/** The elements of a list or a matrix, at any depth, in row-major order. */
function cells(x: Expression): Expression[] {
  if (x.operator === 'Matrix') return cells(x.op1);
  if (x.operator === 'List') return x.ops!.flatMap(cells);
  return [x];
}

function json(xs: Expression[]): string[] {
  return xs.map((x) => JSON.stringify(x.json));
}

/** The product of `scalar` and `tensor`, and the product of `scalar` and
 * each element of `tensor`, element by element, both with `evaluate()`. */
function compare(
  ce: ComputeEngine,
  scalar: string,
  tensor: string
): { product: string[]; elementwise: string[] } {
  const product = cells(ce.parse(`${scalar}\\cdot ${tensor}`).evaluate());
  const elementwise = cells(ce.parse(tensor)).map((c) =>
    ce.box(['Multiply', ce.parse(scalar), c]).evaluate()
  );
  return { product: json(product), elementwise: json(elementwise) };
}

describe('a number times a list or a matrix', () => {
  test('a vector keeps the digits of its elements', () => {
    const ce = engine();
    const x = ce.parse(`2\\cdot\\lbrack ${BIG}, 1.5\\rbrack`).evaluate();
    expect(x.json).toEqual(['List', { num: BIG_TIMES_2 }, { num: '3.0' }]);
  });

  test('each element is the product of the scalars', () => {
    const ce = engine();
    for (const scalar of ['2', '\\frac{1}{3}', '0.7', '-1']) {
      const { product, elementwise } = compare(
        ce,
        scalar,
        `\\lbrack ${BIG}, 1.5, 3, -${BIG}\\rbrack`
      );
      expect(product).toEqual(elementwise);
    }
  });

  // Under `N()` a cell of the list is the numeric product of the scalar and
  // the element, which can differ from `N()` of the scalar product in the
  // last digit of the precision. The test holds that the digits past the
  // 17th are kept.
  test('under N(), each element keeps the digits of the precision', () => {
    const ce = engine();
    for (const scalar of ['2', '\\frac{1}{3}', '0.7']) {
      const product = ce
        .parse(`${scalar}\\cdot\\lbrack ${BIG}, 1.5\\rbrack`)
        .N().op1;
      const expected = ce.parse(`${scalar}\\cdot ${BIG}`).N();
      const error = product.sub(expected).div(expected).abs().N().re;
      expect(error).toBeLessThan(1e-27);
    }
  });

  test('a matrix keeps the digits of its elements', () => {
    const ce = engine();
    const { product, elementwise } = compare(
      ce,
      '2',
      `\\begin{pmatrix}${BIG} & 1\\\\ 2 & 3.5\\end{pmatrix}`
    );
    expect(product).toEqual(elementwise);
    expect(product[0]).toBe(`{"num":"${BIG_TIMES_2}"}`);
  });

  test('a tensor of rank 3 keeps the digits of its elements', () => {
    const ce = engine();
    const tensor = ce.box([
      'List',
      ['List', ['List', { num: BIG }, 1], ['List', 2, 3]],
      ['List', ['List', 4, 5], ['List', 6, { num: BIG }]],
    ]);
    const values = json(cells(ce.box(['Multiply', 2, tensor]).evaluate()));
    expect(values[0]).toBe(`{"num":"${BIG_TIMES_2}"}`);
    expect(values[7]).toBe(`{"num":"${BIG_TIMES_2}"}`);
  });

  test('a list divided by a number keeps the digits', () => {
    const ce = engine();
    const x = ce.parse(`\\frac{\\lbrack ${BIG}, 1.5\\rbrack}{2}`).evaluate();
    expect(JSON.stringify(x.ops![0].json)).toBe(
      '{"num":"0.0617283945061728394506172835"}'
    );
  });

  test('a complex element keeps the digits of its real part', () => {
    const ce = engine();
    const { product, elementwise } = compare(
      ce,
      '2',
      `\\lbrack ${BIG}+2i, 1.5\\rbrack`
    );
    expect(product).toEqual(elementwise);
    expect(product[0]).toContain(BIG_TIMES_2);
  });

  test('a complex element keeps the digits of its imaginary part', () => {
    const ce = engine();
    const z = ce.box(['Complex', 1.5, { num: BIG }]);
    const x = ce.box(['Multiply', 2, ['List', z, 1]]).evaluate();
    expect(x.json).toEqual(['List', ['Complex', 3, { num: BIG_TIMES_2 }], 2]);
    const sum = ce.box(['Add', ['List', z, 1], ['List', 1, 1]]).evaluate();
    expect(sum.json).toEqual(['List', ['Complex', 2.5, { num: BIG }], 2]);
  });

  // A big-number float made at a higher precision keeps its digits when the
  // engine is set to machine precision, and the scalar product multiplies
  // those digits.
  test('a float made at a higher precision, then machine precision', () => {
    const ce = engine();
    const el = ce.parse(BIG);
    ce.precision = 'machine';
    const scalar = ce.box(['Multiply', 2, el]).evaluate();
    expect(scalar.json).toEqual({ num: BIG_TIMES_2 });
    const vector = ce.box(['Multiply', 2, ['List', el, 1.5]]).evaluate();
    expect(vector.ops![0].json).toEqual(scalar.json);
    const matrix = ce
      .box(['Multiply', 2, ['List', ['List', el, 1], ['List', 2, 3]]])
      .evaluate();
    expect(matrix.ops![0].ops![0].json).toEqual(scalar.json);
  });

  // A float such as `0.3` made at a higher precision is stored as a decimal,
  // and a double holds its value. At machine precision the scalar product
  // multiplies the decimal (`3·0.3` is `0.9`), so each element of a list or
  // a matrix must be multiplied as a decimal too, not as the double, which
  // gives `0.8999999999999999`.
  test('a float that a double holds, made at a higher precision, then machine precision', () => {
    const ce = engine();
    const el = ce.parse('0.3');
    ce.precision = 'machine';
    const scalar = ce.box(['Multiply', 3, el]).evaluate();
    expect(scalar.json).toEqual(0.9);
    const products: Expression[] = [
      ce.box(['Multiply', 3, ['List', el, 1.5]]).evaluate().ops![0],
      ce.box(['Multiply', ['List', el, 1.5], 3]).evaluate().ops![0],
      ce.box(['Multiply', ['List', el, 1], ['List', 3, 3]]).evaluate().ops![0],
      ce.box(['Multiply', 3, ['List', ['List', el, 1], ['List', 2, 3]]])
        .evaluate()
        .ops![0].ops![0],
      ce.box(['Dot', ['List', el, 1], ['List', 3, 0]]).evaluate(),
      ce
        .box([
          'MatrixMultiply',
          ['List', ['List', el, 1]],
          ['List', ['List', 3], ['List', 0]],
        ])
        .evaluate()
        .ops![0].ops![0],
    ];
    for (const x of products) expect(x.json).toEqual(scalar.json);
    // A division by a number, also as a product with its reciprocal.
    const quotient = ce.box(['Divide', el, 3]).evaluate();
    expect(quotient.json).toEqual(0.1);
    expect(
      ce.box(['Divide', ['List', el, 1.5], 3]).evaluate().ops![0].json
    ).toEqual(quotient.json);
  });

  test('a list of machine numbers is multiplied as doubles at machine precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const x = ce.box(['Multiply', 3, ['List', 0.3, 1.5]]).evaluate();
    expect(x.json).toEqual(['List', 0.8999999999999999, 4.5]);
    const m = ce
      .box(['Multiply', 3, ['List', ['List', 0.3, 1], ['List', 2, 3]]])
      .evaluate();
    expect(m.ops![0].ops![0].json).toEqual(0.8999999999999999);
  });

  test('a list of doubles gives the same answer as before', () => {
    const ce = engine();
    const x = ce.parse('2\\cdot\\lbrack 0.5, 1.5, 3\\rbrack').evaluate();
    expect(x.json).toEqual(['List', { num: '1.0' }, { num: '3.0' }, 6]);
  });

  test('a big decimal that a double holds gives the same answer as before', () => {
    // `0.1` and `1.4142135623730951` are big decimals at precision 30, and
    // each is the decimal of a double, so the tensor holds doubles.
    const ce = engine();
    const x = ce
      .parse('2\\cdot\\lbrack 0.1, 1.4142135623730951\\rbrack')
      .evaluate();
    expect(x.json).toEqual(['List', 0.2, { num: '2.8284271247461902' }]);
  });

  test('a 17-digit decimal that is not the decimal of a double keeps its digits', () => {
    // The double of `0.10000000000000001` prints as `0.1`, so the cell is
    // compared with its double and keeps the boxed decimal.
    const ce = engine();
    const { product, elementwise } = compare(
      ce,
      '2',
      '\\lbrack 0.10000000000000001, 1.5\\rbrack'
    );
    expect(product).toEqual(elementwise);
    expect(product[0]).toBe('{"num":"0.20000000000000002"}');
  });
});

describe('a matrix that is singular in exact arithmetic', () => {
  test('its determinant at 21 digits is a rounding residue, not 0', () => {
    // The cells of `N([[1/3, 2/3], [1/7, 2/7]])` have 21 digits, and the
    // determinant computed on them is the residue of their rounding, as the
    // scalar arithmetic gives it. With float64 cells, the doubles cancelled
    // to `0` by chance.
    const ce = new ComputeEngine();
    const m = ce
      .box([
        'List',
        ['List', ['Rational', 1, 3], ['Rational', 2, 3]],
        ['List', ['Rational', 1, 7], ['Rational', 2, 7]],
      ])
      .N();
    const det = ce.box(['Determinant', m]).evaluate();
    const scalar = ce
      .box([
        'Subtract',
        ['Multiply', m.ops![0].ops![0], m.ops![1].ops![1]],
        ['Multiply', m.ops![0].ops![1], m.ops![1].ops![0]],
      ])
      .evaluate();
    expect(det.json).toEqual(scalar.json);
    expect(Math.abs(det.re)).toBeLessThan(1e-20);
  });
});

describe('two lists, and the matrix product', () => {
  test('the element-wise product keeps the digits', () => {
    const ce = engine();
    const x = ce
      .parse(`\\lbrack ${BIG}, 1.5\\rbrack\\cdot\\lbrack 2, 1\\rbrack`)
      .evaluate();
    expect(x.json).toEqual(['List', { num: BIG_TIMES_2 }, 1.5]);
  });

  test('the element-wise sum keeps the digits', () => {
    const ce = engine();
    const x = ce
      .parse(`\\lbrack ${BIG}, 1.5\\rbrack+\\lbrack 2, 1\\rbrack`)
      .evaluate();
    expect(x.json).toEqual([
      'List',
      { num: '2.123456789012345678901234567' },
      2.5,
    ]);
  });

  test('the matrix product keeps the digits', () => {
    const ce = engine();
    const x = ce
      .parse(
        `\\begin{pmatrix}${BIG} & 1\\\\ 2 & 3\\end{pmatrix}\\begin{pmatrix}2 & 0\\\\ 0 & 1\\end{pmatrix}`
      )
      .evaluate();
    // The cells of the boxed elements follow their own exactness, as for a
    // matrix that holds an exact rational beside a float: `2·2 + 3·0` is
    // the exact `4`.
    expect(json(cells(x))).toEqual([
      `{"num":"${BIG_TIMES_2}"}`,
      '1',
      '4',
      '3',
    ]);
    // The same product with `MatrixMultiply`.
    const y = ce
      .box([
        'MatrixMultiply',
        ['List', ['List', { num: BIG }, 1], ['List', 2, 3]],
        ['List', ['List', 2, 0], ['List', 0, 1]],
      ])
      .evaluate();
    expect(json(cells(y))[0]).toBe(`{"num":"${BIG_TIMES_2}"}`);
  });

  test("Newton's iteration over a list reaches a fixed point", () => {
    // Each step mixes a quotient of a number by a list, a sum of two lists
    // and the quotient of a list by a number. When some of these routes
    // kept the digits of a big decimal and others rounded it to a double,
    // the iteration alternated between two values and stayed unevaluated.
    const ce = engine();
    const newton = [
      'Function',
      ['Divide', ['Add', 'x', ['Divide', 2, 'x']], 2],
      'x',
    ];
    const v = ce
      .box(['FixedPoint', newton, ['List', { num: '1.0' }, { num: '1.0' }]])
      .evaluate();
    expect(v.operator).toBe('List');
    const sqrt2 = ce.box(['Sqrt', 2]).N();
    for (const x of v.ops!) {
      const error = x.sub(sqrt2).abs().N().re;
      expect(error).toBeLessThan(1e-28);
    }
  });
});
