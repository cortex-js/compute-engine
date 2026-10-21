import { ComputeEngine } from '../../src/compute-engine';
import {
  factorRationalExpression,
  rationalPolynomialCoefficients,
} from '../../src/compute-engine/polynomial/boxed-factor';

describe('Factor with certified rational polynomial fallback', () => {
  const ce = new ComputeEngine();
  test.each([
    ['x^4+3x^2+2', '(x^2+1)(x^2+2)'],
    ['x^4+4', '(x^2-2x+2)(x^2+2x+2)'],
    ['x^4+2x^3+3x^2+2x+2', '(x^2+1)(x^2+2x+2)'],
  ])('finds nonlinear factors of %s', (source, target) => {
    const f = ce.parse(source),
      result = ce.box(['Factor', f, 'x']).evaluate();
    expect(result.operator).toBe('Multiply');
    expect(result.isSame(ce.parse(target))).toBe(true);
    expect(ce.box(['Expand', result]).evaluate().isSame(f)).toBe(true);
  });
  test('does not invent a coefficient field for symbolic or irrational inputs', () => {
    expect(rationalPolynomialCoefficients(ce.parse('x^2+a'), 'x')).toBeNull();
    expect(
      rationalPolynomialCoefficients(ce.parse('x^2+\\sqrt{2}'), 'x')
    ).toBeNull();
    expect(
      rationalPolynomialCoefficients(
        ce.box(['Add', ['Power', 'x', 2], ['Divide', 1, 'x']]),
        'x'
      )
    ).toBeNull();
    expect(
      rationalPolynomialCoefficients(ce.parse('x^{10000}+1'), 'x')
    ).toBeNull();
  });
  test('explicit variables remain protected from assigned values', () => {
    const engine = new ComputeEngine();
    const f = engine.parse('x^4+3x^2+2');
    engine.assign('x', 5);
    const result = engine.box(['Factor', f, 'x']).evaluate();
    expect(result.has('x')).toBe(true);
  });
  test('a recognized rational input defers to other strategies on resource exhaustion', () => {
    const input = ce.function('Add', [
      ce.function('Power', [ce.symbol('x'), ce.number(3)]),
      ce.number(1n << 5000n),
    ]);
    expect(factorRationalExpression(input, 'x')).toBeNull();
  });
  test.each([10n ** 24n, 10n ** 80n + 123456789n])(
    'reads large exact coefficients without display or precision round-trips',
    (large) => {
      const engine = new ComputeEngine({ precision: 20 });
      for (const coefficient of [
        engine.number(large),
        engine.number([1n, large]),
      ]) {
        const input = engine.function('Add', [
          engine.parse('x^3+x'),
          coefficient,
        ]);
        const cs = rationalPolynomialCoefficients(input, 'x');
        expect(cs?.[0]).toEqual(
          coefficient.isInteger
            ? { numerator: large, denominator: 1n }
            : { numerator: 1n, denominator: large }
        );
        const result = engine.box(['Factor', input, 'x']).evaluate();
        expect(engine.box(['Expand', result]).evaluate().isSame(input)).toBe(
          true
        );
      }
    }
  );
  test('large coefficients in an expanded product do not throw', () => {
    const product = ce.function(
      'Multiply',
      Array.from({ length: 30 }, (_, i) => ce.symbol('x').sub(ce.number(i + 1)))
    );
    const input = ce.box(['Expand', product]).evaluate();
    const coefficients = rationalPolynomialCoefficients(input, 'x');
    expect(coefficients).toHaveLength(31);
    expect(coefficients?.[0]).toEqual({
      numerator: 265252859812191058636308480000000n,
      denominator: 1n,
    });
    const result = ce.box(['Factor', input, 'x']).evaluate();
    expect(ce.box(['Expand', result]).evaluate().isSame(input)).toBe(true);
  });
  test('reads an expanded high-degree binomial within the reader budget', () => {
    const target = ce.parse('(x+1)^{100}');
    const input = ce.box(['Expand', target]).evaluate();
    expect(rationalPolynomialCoefficients(input, 'x')).toHaveLength(101);
    const result = ce.box(['Factor', input, 'x']).evaluate();
    expect(result.isSame(target)).toBe(true);
  });
  test.each([
    ['3x^{72}-5x^{71}-2x^{70}-3x^3+2x^2+7x+2', '(3x+1)(x-2)(x^{70}-x-1)'],
    ['2x^{122}-5x^{121}-3x^{120}+2x^2-5x-3', '(x^{120}+1)(x-3)(2x+1)'],
  ])(
    'keeps useful rational-root factors when certification is incomplete: %s',
    (source, target) => {
      const input = ce.parse(source);
      const result = ce.box(['Factor', input, 'x']).evaluate();
      expect(result.operator).toBe('Multiply');
      expect(result.isSame(ce.parse(target))).toBe(true);
      expect(ce.box(['Expand', result]).evaluate().isSame(input)).toBe(true);
    }
  );
  test('partial fractions tolerate a large exact denominator coefficient', () => {
    const input = ce.parse('\\frac{1}{x^3+x+10^{24}}');
    const result = ce.box(['PartialFraction', input, 'x']).evaluate();
    expect(result.has('Error')).toBe(false);
    expect(
      result
        .subs({ x: 0 })
        .evaluate()
        .isSame(ce.number([1n, 10n ** 24n]))
    ).toBe(true);
  });
});
