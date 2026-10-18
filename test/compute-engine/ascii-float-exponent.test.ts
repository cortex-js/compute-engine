import { ComputeEngine } from '../../src/compute-engine';

// The ASCII serializer (`boxed-expression/ascii-math.ts`) printed a float
// exponent of one half, and a float root index of two, as a square root:
// `Power(2, 0.5)` and `Root(2, 2.0)` printed `sqrt(2)`, where the JSON, the
// LaTeX and the values keep the float. Only an exact half, or an exact two,
// is a square root.
describe('ASCII serialization of a float exponent', () => {
  const ce = new ComputeEngine();
  test('a float exponent is printed as a power', () => {
    expect(ce.box(['Power', 2, 0.5]).toString()).toBe('2^(0.5)');
    expect(ce.box(['Power', 'x', -0.5]).toString()).toBe('x^(-0.5)');
  });
  test('an exact half is a square root', () => {
    expect(ce.box(['Power', 'x', ['Rational', 1, 2]]).toString()).toBe(
      'sqrt(x)'
    );
    expect(ce.box(['Sqrt', 2]).toString()).toBe('sqrt(2)');
  });
  test('a float root index of two is printed as a root', () => {
    const root = ce.parse('\\sqrt[2.0]{2}');
    expect(root.json).toEqual(['Root', 2, { num: '2.0' }]);
    expect(root.toString()).toBe('root(2)(2)');
    expect(ce.box(['Root', 'x', 3]).toString()).toBe('root(3)(x)');
  });
});
