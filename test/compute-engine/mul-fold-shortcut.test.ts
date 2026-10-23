import { ComputeEngine } from '../../src/compute-engine';

// `mulImpl()` (`boxed-expression/arithmetic-mul-div.ts`) builds a product once
// when the fold of `expandProducts()` cannot change it
// (`expandProductsChanges()`). These products are the ones where the fold
// does change the answer, so the fold must still run for them.

const ce = new ComputeEngine();

describe('products that the fold of expandProducts changes', () => {
  test('two square roots of a sum give the sum, which is distributed', () => {
    const s = ce.box(['Sqrt', ['Add', 'x', 1]]);
    const evaluated = ce
      .function('Multiply', [ce.number(2), s, s], { form: 'structural' })
      .evaluate();
    expect(evaluated.json).toEqual(['Add', ['Multiply', 2, 'x'], 2]);
    expect(ce.box(2).mul(s.mul(s)).json).toEqual([
      'Add',
      ['Multiply', 2, 'x'],
      2,
    ]);
  });

  test('a power of a sum and its inverse power give the sum', () => {
    const base = ce.box(['Add', 'x', 1]);
    const product = ce
      .function(
        'Multiply',
        [
          ce.number(3),
          base.pow(ce.box(['Rational', 1, 3])),
          base.pow(ce.box(['Rational', 2, 3])),
        ],
        { form: 'structural' }
      )
      .evaluate();
    expect(product.json).toEqual(['Add', ['Multiply', 3, 'x'], 3]);
  });

  test('an error factor times 1 is the error', () => {
    const error = ce.error('missing');
    expect(error.mul(ce.One).json).toEqual(['Error', "'missing'"]);
    expect(ce.One.mul(error).json).toEqual(['Error', "'missing'"]);
  });

  test('a product with no such factor is built as before', () => {
    expect(ce.box(['Multiply', 3, ['Power', 'x', 2]]).evaluate().json).toEqual([
      'Multiply',
      3,
      ['Power', 'x', 2],
    ]);
    expect(
      ce.box(['Multiply', 'x', ['Power', 'x', -2]]).evaluate().json
    ).toEqual(['Divide', 1, 'x']);
  });
});
