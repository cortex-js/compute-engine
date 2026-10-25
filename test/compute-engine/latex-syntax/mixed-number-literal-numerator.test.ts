import { ComputeEngine } from '../../../src/compute-engine';

const ce = new ComputeEngine();

// A mixed number is written with integer literals only. An integer followed
// by a fraction whose numerator or denominator is an expression is a product.
describe('MIXED NUMBER: THE FRACTION MUST BE WRITTEN WITH LITERALS', () => {
  test('2\\frac{1}{3} is the mixed number 7/3', () => {
    expect(ce.parse('2\\frac{1}{3}').N().re).toBeCloseTo(7 / 3, 12);
  });

  test('-2\\frac{1}{3} is the mixed number -7/3', () => {
    expect(ce.parse('-2\\frac{1}{3}').N().re).toBeCloseTo(-7 / 3, 12);
  });

  test('2\\frac{1+1}{3} is the product 4/3', () => {
    expect(ce.parse('2\\frac{1+1}{3}').N().re).toBeCloseTo(4 / 3, 12);
  });

  test('2\\frac{2}{1+2} is the product 4/3', () => {
    expect(ce.parse('2\\frac{2}{1+2}').N().re).toBeCloseTo(4 / 3, 12);
  });

  test('2\\frac{x}{3} is still a product', () => {
    expect(ce.parse('2\\frac{x}{3}').json).toEqual([
      'Multiply',
      ['Rational', 2, 3],
      'x',
    ]);
  });
});

// A mixed number is written with EXACT integer literals only. A float in the
// integer part, the numerator or the denominator makes the juxtaposition a
// product, and the product stays inexact.
describe('MIXED NUMBER: A FLOAT LITERAL MAKES A PRODUCT', () => {
  test.each(['2\\frac{1.0}{3}', '2.0\\frac{1}{3}', '2\\frac{1}{3.0}'])(
    '%s is the product 2/3',
    (latex) => {
      const expr = ce.parse(latex);
      expect(expr.operator).toBe('Multiply');
      const value = expr.N();
      expect(value.re).toBeCloseTo(2 / 3, 12);
      expect(value.isExact).toBe(false);
    }
  );
});

// The serializer writes a sum as a mixed number only when the whole part is
// an exact integer literal. A float whole part (`2.0`) is written with a `+`,
// so that the parser reads back the same value.
describe('MIXED NUMBER: SERIALIZE A FLOAT WHOLE PART AS A SUM', () => {
  test.each([
    ['Add', { num: '2.0' }, ['Rational', 1, 3]],
    ['Add', ['Rational', 1, 3], { num: '2.0' }],
    ['Add', { num: '2.5' }, ['Rational', 1, 3]],
    ['Add', 2, ['Rational', 1, 3]],
  ])('%j keeps its value through a round trip', (...json) => {
    const expr = ce.box(json as any, { form: 'raw' });
    const latex = expr.latex;
    expect(ce.parse(latex).N().re).toBeCloseTo(expr.N().re, 12);
  });

  test('2.0 + 1/3 is not written as a mixed number', () => {
    const expr = ce.box(['Add', { num: '2.0' }, ['Rational', 1, 3]], {
      form: 'raw',
    });
    expect(expr.latex).toBe('2.0+\\frac{1}{3}');
  });

  test('the canonical form of 2.0 + 1/3 is not written as a mixed number', () => {
    const expr = ce.box(['Add', { num: '2.0' }, ['Rational', 1, 3]]);
    expect(expr.latex).toBe('2.0+\\frac{1}{3}');
  });

  test('2 + 1/3 is still written as a mixed number', () => {
    const expr = ce.box(['Add', 2, ['Rational', 1, 3]], { form: 'raw' });
    expect(expr.latex).toBe('2\\frac{1}{3}');
  });
});
