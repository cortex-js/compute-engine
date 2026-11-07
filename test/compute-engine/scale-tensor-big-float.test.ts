import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// A NUMBER TIMES A LIST OR A MATRIX, ABOVE MACHINE PRECISION
//
// The product of a scalar and a vector or a matrix multiplies each cell by
// the scalar (`scaleTensor()`, `boxed-expression/arithmetic-mul-div.ts`).
// The cells of a packed tensor are doubles, so they would keep only about 16
// digits of an element that is a big-number float with more digits than a
// double holds. These tests hold that each element of the product is the
// product of the scalar and that element, as the interpreter computes it for
// the two scalars.
//

const BIG = '0.123456789012345678901234567';

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

/** The product of `scalar` and the tensor, and the product of `scalar` and
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
  return {
    product: product.map((x) => JSON.stringify(x.json)),
    elementwise: elementwise.map((x) => JSON.stringify(x.json)),
  };
}

describe('a number times a list above machine precision', () => {
  test('a vector keeps the digits of its elements', () => {
    const ce = engine();
    const x = ce.parse(`2\\cdot\\lbrack ${BIG}, 1.5\\rbrack`).evaluate();
    expect(x.json).toEqual([
      'List',
      { num: '0.246913578024691357802469134' },
      { num: '3.0' },
    ]);
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
  // last digit of the precision (`(1/3·[1.5]).N()` is `0.4999…95`). The
  // test holds that the digits past the 17th are kept.
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
    expect(product[0]).toBe('{"num":"0.246913578024691357802469134"}');
  });

  test('a tensor of rank 3 keeps the digits of its elements', () => {
    const ce = engine();
    const tensor = ce.box([
      'List',
      ['List', ['List', { num: BIG }, 1], ['List', 2, 3]],
      ['List', ['List', 4, 5], ['List', 6, { num: BIG }]],
    ]);
    const x = ce.box(['Multiply', 2, tensor]).evaluate();
    const values = cells(x).map((c) => JSON.stringify(c.json));
    expect(values[0]).toBe('{"num":"0.246913578024691357802469134"}');
    expect(values[7]).toBe('{"num":"0.246913578024691357802469134"}');
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
    expect(product[0]).toContain('0.246913578024691357802469134');
  });

  test('a complex element keeps the digits of its imaginary part', () => {
    const ce = engine();
    const z = ce.box(['Complex', 1.5, { num: BIG }]);
    const x = ce.box(['Multiply', 2, ['List', z, 1]]).evaluate();
    expect(x.json).toEqual([
      'List',
      ['Complex', 3, { num: '0.246913578024691357802469134' }],
      2,
    ]);
  });

  // A big-number float made at a higher precision keeps its digits when the
  // engine is set to machine precision, and the scalar product multiplies
  // those digits.
  test('a float made at a higher precision, then machine precision', () => {
    const ce = engine();
    const el = ce.parse(BIG);
    ce.precision = 'machine';
    const scalar = ce.box(['Multiply', 2, el]).evaluate();
    expect(scalar.json).toEqual({ num: '0.246913578024691357802469134' });
    const vector = ce.box(['Multiply', 2, ['List', el, 1.5]]).evaluate();
    expect(vector.ops![0].json).toEqual(scalar.json);
    const matrix = ce
      .box(['Multiply', 2, ['List', ['List', el, 1], ['List', 2, 3]]])
      .evaluate();
    expect(matrix.ops![0].ops![0].json).toEqual(scalar.json);
  });

  test('a list of doubles gives the same answer as before', () => {
    const ce = engine();
    const x = ce.parse('2\\cdot\\lbrack 0.5, 1.5, 3\\rbrack').evaluate();
    expect(x.json).toEqual(['List', { num: '1.0' }, { num: '3.0' }, 6]);
  });
});
