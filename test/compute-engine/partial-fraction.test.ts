import { engine } from '../utils';

function parse(s: string) {
  return engine.parse(s);
}

const ce = engine;

describe('PARTIAL FRACTION - LINEAR FACTORS', () => {
  test('1/((x+1)(x+2))', () => {
    const original = parse('\\frac{1}{(x+1)(x+2)}');
    const decomposed = ce
      .parse(
        '\\operatorname{PartialFraction}(\\frac{1}{(x+1)(x+2)}, x)'
      )
      .evaluate();
    for (const val of [0, 3, -3, 5]) {
      const v = ce.number(val);
      expect(decomposed.subs({ x: v }).N().re).toBeCloseTo(
        original.subs({ x: v }).N().re
      );
    }
  });

  test('(2x+3)/((x+1)(x+2))', () => {
    const original = parse('\\frac{2x+3}{(x+1)(x+2)}');
    const decomposed = ce
      .parse(
        '\\operatorname{PartialFraction}(\\frac{2x+3}{(x+1)(x+2)}, x)'
      )
      .evaluate();
    for (const val of [0, 3, -3, 5]) {
      const v = ce.number(val);
      expect(decomposed.subs({ x: v }).N().re).toBeCloseTo(
        original.subs({ x: v }).N().re
      );
    }
  });

  test('1/(x²-1) factors then decomposes', () => {
    const original = parse('\\frac{1}{x^2 - 1}');
    const decomposed = ce
      .parse(
        '\\operatorname{PartialFraction}(\\frac{1}{x^2 - 1}, x)'
      )
      .evaluate();
    for (const val of [2, -2, 3, 5]) {
      const v = ce.number(val);
      expect(decomposed.subs({ x: v }).N().re).toBeCloseTo(
        original.subs({ x: v }).N().re
      );
    }
  });
});

describe('PARTIAL FRACTION - REPEATED ROOTS', () => {
  test('(3x+5)/(x+1)²', () => {
    const original = parse('\\frac{3x+5}{(x+1)^2}');
    const decomposed = ce
      .parse(
        '\\operatorname{PartialFraction}(\\frac{3x+5}{(x+1)^2}, x)'
      )
      .evaluate();
    for (const val of [0, 1, -2, 3]) {
      const v = ce.number(val);
      expect(decomposed.subs({ x: v }).N().re).toBeCloseTo(
        original.subs({ x: v }).N().re
      );
    }
  });
});

describe('PARTIAL FRACTION - IRREDUCIBLE QUADRATIC', () => {
  test('1/((x+1)(x²+1))', () => {
    const original = parse('\\frac{1}{(x+1)(x^2+1)}');
    const decomposed = ce
      .parse(
        '\\operatorname{PartialFraction}(\\frac{1}{(x+1)(x^2+1)}, x)'
      )
      .evaluate();
    for (const val of [0, 1, -2, 3]) {
      const v = ce.number(val);
      expect(decomposed.subs({ x: v }).N().re).toBeCloseTo(
        original.subs({ x: v }).N().re
      );
    }
  });
});

describe('PARTIAL FRACTION - IMPROPER FRACTIONS', () => {
  test('(x³+1)/(x²-1) → polynomial + partial fractions', () => {
    const original = parse('\\frac{x^3+1}{x^2-1}');
    const decomposed = ce
      .parse(
        '\\operatorname{PartialFraction}(\\frac{x^3+1}{x^2-1}, x)'
      )
      .evaluate();
    for (const val of [2, -2, 3, 5]) {
      const v = ce.number(val);
      expect(decomposed.subs({ x: v }).N().re).toBeCloseTo(
        original.subs({ x: v }).N().re
      );
    }
  });
});

describe('PARTIAL FRACTION - EDGE CASES', () => {
  test('not a Divide returns unchanged', () => {
    const expr = parse('x^2 + 1');
    const result = ce
      .parse('\\operatorname{PartialFraction}(x^2 + 1, x)')
      .evaluate();
    expect(result.isSame(expr)).toBe(true);
  });

  test('non-polynomial numerator returns unchanged', () => {
    const result = ce
      .parse(
        '\\operatorname{PartialFraction}(\\frac{\\sin(x)}{x+1}, x)'
      )
      .evaluate();
    expect(result.operator).toBe('Divide');
  });

  test('already irreducible returns unchanged', () => {
    const original = parse('\\frac{1}{x+1}');
    const result = ce
      .parse('\\operatorname{PartialFraction}(\\frac{1}{x+1}, x)')
      .evaluate();
    for (const val of [0, 1, -2]) {
      const v = ce.number(val);
      expect(result.subs({ x: v }).N().re).toBeCloseTo(
        original.subs({ x: v }).N().re
      );
    }
  });
});
