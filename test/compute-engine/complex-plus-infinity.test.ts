/**
 * A finite imaginary part beside an infinite real part gives the real
 * infinity.
 *
 * The direction of `x + i` as `x → ∞` is the positive real axis, and `Add`
 * gives `+∞` for `(1 + i) + ∞`. `Sum` and `Mean` now agree with it:
 * `Sum([1 + i, +∞])` was the complex number `∞ + i` (from the number-literal
 * arithmetic of its fold, `BoxedNumber.add()`), and `Mean([1 + i, +∞])` was
 * `NaN`.
 *
 * An infinite IMAGINARY part is the complex infinity: `Add` and `Sum` give
 * `~∞`, while `Mean` reads `~∞` as `NaN`, as every univariate statistic
 * does (`statistics.test.ts`, "`~oo` reads as NaN in every univariate
 * head").
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const C = (re: number, im: number) => ['Complex', re, im];
const iInf = ['Multiply', 'PositiveInfinity', 'ImaginaryUnit'];

const evaluated = (json: unknown): string =>
  ce
    .box(json as any)
    .evaluate()
    .toString();
const numeric = (json: unknown): string =>
  ce
    .box(json as any)
    .N()
    .toString();

describe('ADD, SUM AND MEAN AGREE', () => {
  test.each([
    [[C(1, 1), 'PositiveInfinity'], '+oo'],
    [[C(1, 1), 'NegativeInfinity'], '-oo'],
    [[C(1, -1), 'PositiveInfinity'], '+oo'],
    [[C(1.5, 1), 'PositiveInfinity'], '+oo'],
    [[C(1, 1), 'PositiveInfinity', C(2, 3)], '+oo'],
    [['PositiveInfinity', C(1, 1)], '+oo'],
    [[['Add', 1, 'ImaginaryUnit'], 'PositiveInfinity'], '+oo'],
  ])('%j', (terms, expected) => {
    for (const head of ['Add', 'Sum', 'Mean']) {
      const json =
        head === 'Add' ? ['Add', ...terms] : [head, ['List', ...terms]];
      expect(evaluated(json)).toBe(expected);
      expect(numeric(json)).toBe(expected);
    }
  });

  test('+oo beside -oo is the indeterminate form', () => {
    const terms = [C(1, 1), 'PositiveInfinity', 'NegativeInfinity'];
    expect(evaluated(['Sum', ['List', ...terms]])).toBe('Indeterminate');
    expect(evaluated(['Mean', ['List', ...terms]])).toBe('Indeterminate');
    expect(numeric(['Mean', ['List', ...terms]])).toBe('NaN');
  });

  test('an infinite imaginary part', () => {
    for (const terms of [
      [iInf, 1],
      [iInf, C(1, 1)],
      [iInf, 'PositiveInfinity'],
    ]) {
      expect(evaluated(['Add', ...terms])).toBe('~oo');
      expect(evaluated(['Sum', ['List', ...terms]])).toBe('~oo');
      expect(ce.box(['Mean', ['List', ...terms]] as any).evaluate().isNaN).toBe(
        true
      );
    }
  });

  test('a finite complex mean is unchanged', () => {
    expect(evaluated(['Mean', ['List', 1, C(1, 2)]])).toBe('(1 + i)');
  });

  test('parse route', () => {
    for (const latex of [
      '\\operatorname{Sum}([1+i, \\infty])',
      '\\operatorname{Mean}([1+i, \\infty])',
      '(1+i) + \\infty',
      '\\operatorname{Sum}([1+i, -\\infty, 2-3i])',
    ])
      expect(ce.parse(latex).evaluate().toString()).toMatch(/^[+-]oo$/);
  });
});

describe('THE NUMBER-LITERAL ARITHMETIC', () => {
  test('a finite complex literal plus a real infinity', () => {
    const c = ce.number(ce.complex(1, 1));
    expect(c.add(ce.PositiveInfinity).toString()).toBe('+oo');
    expect(ce.PositiveInfinity.add(c).toString()).toBe('+oo');
    expect(c.add(ce.NegativeInfinity).toString()).toBe('-oo');
    expect(c.add(Infinity).toString()).toBe('+oo');
    expect(c.sub(ce.PositiveInfinity).toString()).toBe('-oo');
    expect(ce.PositiveInfinity.sub(c).toString()).toBe('+oo');
  });

  test('a complex infinity plus a finite number is unchanged', () => {
    const c = ce.number(ce.complex(1, 1));
    expect(c.add(ce.ComplexInfinity).toString()).toBe('~oo');
  });
});
