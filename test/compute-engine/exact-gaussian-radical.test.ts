import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// An exact number literal holds one radical times a Gaussian rational,
// `√r·(a + b·i)` with `r` a square-free positive integer and `a`, `b` exact
// rationals. This set is closed under multiplication, division, inversion,
// negation and conjugation, so `evaluate()` keeps these operations exact:
// `√2·(1 + i)` is ONE literal, `√2 + √2·i`, serialized as
// `["Complex", ["Sqrt", 2], ["Sqrt", 2]]`. The set is not closed under
// addition: a value with two different radicals (`1 + √2·i`, `√2 + √3`) is
// a sum of literals.
//
// Every result is compared with an independent machine computation of the
// value.

const ce = new ComputeEngine();

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

function expectValue(x: Expression, re: number, im: number): void {
  const n = x.N();
  expect(Math.abs(n.re - re)).toBeLessThan(1e-14 * (1 + Math.abs(re)));
  expect(Math.abs(n.im - im)).toBeLessThan(1e-14 * (1 + Math.abs(im)));
}

/** Evaluate `latex`, check its value, and return its string form. */
function evaluate(latex: string, re: number, im: number): string {
  const result = ce.parse(latex).evaluate();
  expectValue(result, re, im);
  return result.toString();
}

describe('EXACT RADICAL TIMES A GAUSSIAN RATIONAL', () => {
  test('√2·(1 + i) is one literal', () => {
    expect(evaluate('\\sqrt2(1+i)', SQRT2, SQRT2)).toBe('(sqrt(2) + sqrt(2)i)');
    expect(JSON.stringify(ce.parse('\\sqrt2(1+i)').evaluate().json)).toBe(
      '["Complex",["Sqrt",2],["Sqrt",2]]'
    );
  });

  test('(1 + i)/√2', () =>
    expect(evaluate('\\frac{1+i}{\\sqrt2}', SQRT2 / 2, SQRT2 / 2)).toBe(
      '(sqrt(2)/2 + sqrt(2)/2i)'
    ));

  test('((1 + i)/√2)·√2', () =>
    expect(evaluate('\\frac{1+i}{\\sqrt2}\\cdot\\sqrt2', 1, 1)).toBe(
      '(1 + i)'
    ));

  test('(√2·(1 + i))²', () =>
    expect(evaluate('(\\sqrt2(1+i))^2', 0, 4)).toBe('4i'));

  test('(√2·(1 + i))³', () =>
    expect(evaluate('(\\sqrt2(1+i))^3', -4 * SQRT2, 4 * SQRT2)).toBe(
      '(-4sqrt(2) + 4sqrt(2)i)'
    ));

  test('(√2·(1 + i))⁻¹', () =>
    expect(evaluate('(\\sqrt2(1+i))^{-1}', SQRT2 / 4, -SQRT2 / 4)).toBe(
      '(sqrt(2)/4 - sqrt(2)/4i)'
    ));

  test('(√2 + √2·i)/√2', () =>
    expect(evaluate('\\frac{\\sqrt2+\\sqrt2 i}{\\sqrt2}', 1, 1)).toBe(
      '(1 + i)'
    ));

  test('(1 + i)/(√2·(1 − i))', () =>
    expect(evaluate('\\frac{1+i}{\\sqrt2(1-i)}', 0, SQRT2 / 2)).toBe(
      'sqrt(2)/2i'
    ));

  test('1/(√2·(1 + i))', () =>
    expect(evaluate('\\frac{1}{\\sqrt2(1+i)}', SQRT2 / 4, -SQRT2 / 4)).toBe(
      '(sqrt(2)/4 - sqrt(2)/4i)'
    ));

  test('(2 + 3i)/√5 and its product with √5', () => {
    const s5 = Math.sqrt(5);
    expect(evaluate('\\frac{2+3i}{\\sqrt5}', 2 / s5, 3 / s5)).toBe(
      '(2/5sqrt(5) + 3/5sqrt(5)i)'
    );
    expect(evaluate('\\frac{2+3i}{\\sqrt5}\\sqrt5', 2, 3)).toBe('(2 + 3i)');
  });

  test('√3·i stays a pure-imaginary literal', () => {
    expect(evaluate('\\sqrt3 i', 0, SQRT3)).toBe('sqrt(3)i');
    expect(ce.parse('\\sqrt3 i').type.toString()).toBe('imaginary');
  });

  test('the radical is square-free', () =>
    expect(evaluate('\\sqrt8(1+i)', 2 * SQRT2, 2 * SQRT2)).toBe(
      '(2sqrt(2) + 2sqrt(2)i)'
    ));

  test('(1 + i)·(1 + i)·√2 in every operand order', () => {
    for (const s of [
      '(1+i)(1+i)\\sqrt2',
      '\\sqrt2(1+i)(1+i)',
      '(1+i)\\sqrt2(1+i)',
    ])
      expect(evaluate(s, 0, 2 * SQRT2)).toBe('2sqrt(2)i');
  });

  test('a sum that cancels the imaginary part is real', () =>
    expect(evaluate('\\sqrt2(1+i)+\\sqrt2(1-i)', 2 * SQRT2, 0)).toBe(
      '2sqrt(2)'
    ));

  test('two different radicals stay a sum', () => {
    // `√2·(1 + √3·i)`: `1 + √3·i` is a sum of two literals, and `evaluate()`
    // leaves a product of a sum factored.
    expect(evaluate('\\sqrt2(1+\\sqrt3 i)', SQRT2, Math.sqrt(6))).toBe(
      'sqrt(2) * (1 + sqrt(3)i)'
    );
    // `Expand` distributes it into a sum of two literals with different
    // radicals, `√2 + √6·i`.
    const expanded = ce
      .box(['Expand', ce.parse('\\sqrt2(1+\\sqrt3 i)').json])
      .evaluate();
    expectValue(expanded, SQRT2, Math.sqrt(6));
    expect(JSON.stringify(expanded.json)).toBe(
      '["Add",["Sqrt",2],["Complex",0,["Sqrt",6]]]'
    );
    expect(evaluate('1+\\sqrt2 i', 1, SQRT2)).toBe('1 + sqrt(2)i');
    expect(evaluate('\\sqrt2+\\sqrt3', SQRT2 + SQRT3, 0)).toBe(
      'sqrt(2) + sqrt(3)'
    );
  });

  test('type', () => {
    expect(ce.parse('\\sqrt2(1+i)').evaluate().type.toString()).toBe('complex');
    expect(ce.parse('\\sqrt2(1+i)').evaluate().sgn).toBe('unsigned');
    expect(ce.parse('\\sqrt2(1+i)').evaluate().isNegative).toBeUndefined();
  });
});

describe('PARTS AND MODULUS OF √r·(a + b·i)', () => {
  test('|√2·(1 + i)|', () =>
    expect(evaluate('|\\sqrt2(1+i)|', 2, 0)).toBe('2'));

  test('|√2·(1 + 2i)|', () =>
    expect(evaluate('|\\sqrt2(1+2i)|', Math.sqrt(10), 0)).toBe('sqrt(10)'));

  test('|(1 + 2i)/√3|', () =>
    expect(evaluate('|\\frac{1+2i}{\\sqrt3}|', Math.sqrt(5 / 3), 0)).toBe(
      'sqrt(15)/3'
    ));

  test('|π·(1 + i)| is unchanged', () =>
    expect(evaluate('|\\pi(1+i)|', SQRT2 * Math.PI, 0)).toBe('sqrt(2) * pi'));

  test('conjugate', () =>
    expect(evaluate('\\overline{\\sqrt2(1+i)}', SQRT2, -SQRT2)).toBe(
      '(sqrt(2) - sqrt(2)i)'
    ));

  test('real and imaginary parts', () => {
    expect(evaluate('\\operatorname{Re}(\\sqrt2(1+i))', SQRT2, 0)).toBe(
      'sqrt(2)'
    );
    expect(evaluate('\\operatorname{Im}(\\sqrt2(1-i))', -SQRT2, 0)).toBe(
      '-sqrt(2)'
    );
  });
});

describe('SIMPLIFY AND EXPAND OF A SUM WITH √r·(a + b·i)', () => {
  // The coefficient of a sum holds one numeric value. `√3 + √3·i` is one
  // value, so neither `simplify()` nor `Expand` gives a float.
  test('simplify()', () => {
    const r = ce.parse('\\sqrt3(1+i)+1').simplify();
    expectValue(r, 1 + SQRT3, SQRT3);
    expect(JSON.stringify(r.json)).toBe(
      '["Add",1,["Complex",["Sqrt",3],["Sqrt",3]]]'
    );
  });

  test('Expand', () => {
    const r = ce
      .box(['Expand', ['Add', ['Multiply', ['Sqrt', 3], ['Complex', 1, 1]], 1]])
      .evaluate();
    expectValue(r, 1 + SQRT3, SQRT3);
    expect(JSON.stringify(r.json)).toBe(
      '["Add",1,["Complex",["Sqrt",3],["Sqrt",3]]]'
    );
  });
});

describe('N() OF √r·(a + b·i)', () => {
  test('the real part keeps the working precision', () => {
    const n = ce.parse('\\sqrt2(1+i)').evaluate().N();
    expect(n.isExact).toBeFalsy();
    // √2 to 22 significant digits
    expect(n.bignumRe!.toString().startsWith('1.414213562373095048801')).toBe(
      true
    );
    expect(n.im).toBe(Math.SQRT2);
  });
});

describe('ONE FORM FOR ONE VALUE', () => {
  const spellings: (string | ['box', any])[] = [
    '\\sqrt2(1+i)',
    '\\sqrt2+\\sqrt2 i',
    '(1+i)\\sqrt2',
    '\\frac{2+2i}{\\sqrt2}',
    '\\frac{4i}{\\sqrt2(1+i)}',
    '\\frac{\\sqrt8}{2}(1+i)',
    ['box', ['Complex', ['Sqrt', 2], ['Sqrt', 2]]],
    ['box', ['Multiply', ['Sqrt', 2], ['Complex', 1, 1]]],
  ];
  const values = spellings.map((s) =>
    (typeof s === 'string' ? ce.parse(s) : ce.box(s[1])).evaluate()
  );

  test('isSame and hash agree', () => {
    for (const v of values) {
      expectValue(v, SQRT2, SQRT2);
      expect(v.isSame(values[0])).toBe(true);
      expect(v.hash).toBe(values[0].hash);
    }
  });

  test('a different value is not the same', () => {
    const other = ce.parse('\\sqrt2(1-i)').evaluate();
    expect(other.isSame(values[0])).toBe(false);
    const other2 = ce.parse('\\sqrt3(1+i)').evaluate();
    expect(other2.isSame(values[0])).toBe(false);
  });
});

describe('SERIALIZATION ROUND TRIP OF √r·(a + b·i)', () => {
  const cases = [
    '\\sqrt2(1+i)',
    '\\frac{1+i}{\\sqrt2}',
    '\\frac{1}{\\sqrt2(1+i)}',
    '\\frac{2+3i}{\\sqrt5}',
    '-\\sqrt6(3+i)',
    '\\sqrt3 i',
  ];
  test.each(cases)('MathJSON: %s', (s) => {
    const x = ce.parse(s).evaluate();
    const y = ce.box(x.json);
    expect(y.isSame(x)).toBe(true);
    expect(y.hash).toBe(x.hash);
  });
  test.each(cases)('LaTeX: %s', (s) => {
    const x = ce.parse(s).evaluate();
    const y = ce.parse(x.latex);
    expect(y.isSame(x)).toBe(true);
  });
  test('LaTeX form', () =>
    expect(ce.parse('\\sqrt2(1+i)').evaluate().latex).toBe(
      '\\sqrt{2}+\\sqrt{2}\\imaginaryI'
    ));
});

describe('MODULUS OF √r·(a + b·i) IS EXACT', () => {
  // |√r·(a + b·i)| = √(r·(a² + b²)), taken in one step so that a norm that
  // is not a perfect square can still give an exact root after the product
  // with r.
  test.each([
    ['|\\sqrt2(1000+1000i)|', 2000, '2000'],
    ['|\\sqrt2(10^{30}+10^{30} i)|', 2e30, '2e+30'],
    ['|1000+1000i|', 1000 * SQRT2, '1000sqrt(2)'],
    ['|10^{30}+10^{30} i|', 1e30 * SQRT2, '1e+30sqrt(2)'],
    ['|\\sqrt3(1+2i)|', Math.sqrt(15), 'sqrt(15)'],
    ['|\\sqrt2(1+i)|', 2, '2'],
    ['|\\sqrt5(\\frac23+\\frac17i)|', (5 * Math.sqrt(41)) / 21, '5/21sqrt(41)'],
  ])('%s', (latex, value, expected) => {
    const result = ce.parse(latex).evaluate();
    expect(result.toString()).toBe(expected);
    expect(result.isNumberLiteral).toBe(true);
    expect(result.numericValue).not.toBeNull();
    expect(
      typeof result.numericValue === 'number' || result.numericValue!.isExact
    ).toBe(true);
    expect(Math.abs(result.N().re - value)).toBeLessThan(1e-14 * value);
  });

  test('2000 is the exact integer, not a float close to it', () =>
    expect(
      ce.parse('|\\sqrt2(1000+1000i)|').evaluate().isSame(ce.number(2000))
    ).toBe(true));

  // The exactness contract: when the modulus has no exact form, `Abs` of an
  // exact argument stays symbolic under `evaluate()`; `.N()` gives the float.
  test('A modulus with no exact form stays symbolic', () => {
    const x = ce.parse('|\\sqrt2(1000000+7i)|');
    expect(x.evaluate().operator).toBe('Abs');
    expect(
      Math.abs(x.N().re - Math.hypot(1e6 * SQRT2, 7 * SQRT2))
    ).toBeLessThan(1e-8);
  });
});

describe('SIMPLIFY OF AN EXACT COMPLEX LITERAL IS THE LITERAL', () => {
  test.each(['\\sqrt2(1+i)', '\\sqrt2 i', '\\frac12+\\frac i3'])('%s', (s) => {
    const x = ce.parse(s);
    const simplified = x.simplify();
    expect(simplified.isNumberLiteral).toBe(true);
    expect(simplified.isSame(x.evaluate())).toBe(true);
  });
});

describe('LATEX OF A NEGATIVE EXACT IMAGINARY PART', () => {
  test.each([
    ['\\sqrt2(1-i)', '\\sqrt{2}-\\sqrt{2}\\imaginaryI'],
    ['-\\sqrt2(1+i)', '-\\sqrt{2}-\\sqrt{2}\\imaginaryI'],
    [
      '\\frac12-\\frac{\\sqrt3}{2}i',
      '\\frac{1}{2}-\\frac{\\sqrt{3}}{2}\\imaginaryI',
    ],
  ])('%s', (s, expected) => {
    const x = ce.parse(s).evaluate();
    expect(x.latex).toBe(expected);
    expect(ce.parse(x.latex).isSame(x)).toBe(true);
  });
});

describe('.is() OF AN EXACT VALUE AND A DOUBLE', () => {
  // `isSame` compares an exact value with a double exactly; `.is()` is the
  // tolerant check and compares their values within the engine tolerance.
  test('.is() is tolerant', () => {
    expect(ce.number([1, 3]).is(1 / 3)).toBe(true);
    expect(ce.parse('\\sqrt2').is(Math.SQRT2)).toBe(true);
    expect(ce.number([1, 2]).is(0.5)).toBe(true);
    expect(ce.number([1, 3]).is(ce.number(1 / 3))).toBe(true);
    expect(ce.box(2).is(2.0000001)).toBe(false);
    expect(ce.number([1, 3]).is(0.3334)).toBe(false);
  });
  test('isSame stays exact', () => {
    expect(ce.number([1, 3]).isSame(1 / 3)).toBe(false);
    expect(ce.parse('\\sqrt2').isSame(Math.SQRT2)).toBe(false);
    expect(ce.number([1, 2]).isSame(0.5)).toBe(true);
  });
});

describe('SQUARE ROOT OF AN EXACT IMAGINARY NUMBER', () => {
  // √(k·i) = √(k/2)·(1 + i) is in the representable set.
  test.each([
    [4, '(sqrt(2) + sqrt(2)i)'],
    [16, '(2sqrt(2) + 2sqrt(2)i)'],
    [-4, '(sqrt(2) - sqrt(2)i)'],
    [3, '(sqrt(6)/2 + sqrt(6)/2i)'],
    [2, '(1 + i)'],
  ])('√(%s·i)', (k, expected) => {
    const result = ce.box(['Sqrt', ['Complex', 0, k]]).evaluate();
    expect(result.toString()).toBe(expected);
    const root = Math.sqrt(Math.abs(k) / 2);
    expectValue(result, root, Math.sign(k) * root);
  });
  test('√(4i) is √2·(1 + i)', () =>
    expect(
      ce
        .box(['Sqrt', ['Complex', 0, 4]])
        .evaluate()
        .isSame(ce.parse('\\sqrt2(1+i)').evaluate())
    ).toBe(true));
});

describe('BOXING A COMPLEX WITH TWO DIFFERENT RADICALS', () => {
  test("['Complex', √2, √3] is the exact sum √2 + √3·i", () => {
    const x = ce.box(['Complex', ['Sqrt', 2], ['Sqrt', 3]]);
    expect(x.json).toEqual(['Add', ['Sqrt', 2], ['Complex', 0, ['Sqrt', 3]]]);
    expectValue(x, SQRT2, SQRT3);
  });
  test("['Complex', 1, √3] is the exact sum 1 + √3·i", () => {
    const x = ce.box(['Complex', 1, ['Sqrt', 3]]);
    expect(x.json).toEqual(['Add', 1, ['Complex', 0, ['Sqrt', 3]]]);
    expectValue(x, 1, SQRT3);
  });
});
