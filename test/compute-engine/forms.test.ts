import { expression, engine } from '../utils';

describe('FORMS', () => {
  let latex = '-0';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });

  latex = 'a-0';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });

  latex = '0-a';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });

  latex = '7 + 2 + 5';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  // This one is tricky:
  // the simplifications of POWER and MULTIPLY
  // have to be done in the right order to get the correct result
  latex = '2^3x';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  // Negative sign on denom, numer or both
  latex = '\\frac{-x}{-n}';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  latex = '\\frac{x}{-n}';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  latex = '\\frac{-x}{n}';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  latex = '\\frac{-101}{10^{\\frac{2}{3}}}';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  // Flatten, to multiple levels
  latex = '(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  // \frac should get hoisted with multiply, but not cancel
  // (multiplication by 0 does not always = 0)
  latex = '2x\\frac{0}{5}';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  // Negative exponents become fractions
  latex = '2xy^{-n}';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  latex = '2\\times0\\times5\\times4';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  latex = '2\\times(5-5)\\times5\\times4';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
  latex = '2\\frac{x}{a}\\frac{y}{b}';
  test('Full form "' + latex + '"', () => {
    expect(expression(latex, { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "' + latex + '"', () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
});

describe('ORDER', () => {
  // multiply is commutative and regular canonical sort order applies
  // (numbers before symbols)
  let latex = 'yx5z';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  // addition is deglex ordered, numbers after symbols
  latex = 'c+7+a+5+b';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  // 7a -> degree 1 > degree 0
  // 2b -> degree 1, b > a
  // 5c -> degree 1, c > b
  // 6 -> degree 0
  latex = '6+5c+2b+3+7a';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  // Arguments sorted by value
  latex = '5a+3a+7a';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  // deglex sorting order
  // by total degree, then lexicographically
  // If degree is the same, longest factor
  latex = 'x^{3}2\\pi+3x^{3}4\\pi+x^3';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  // The arguments of commutative functions are sorted lexicographically
  // numerical constants (by value), then constants (lexicographically),
  // then free variables (lex),
  latex = '-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  latex = 'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  latex = '(b^3c^2d)(x^7y)(a^5f)(b^2x^5b3)';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  latex = '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });

  latex = '5c^2a^4+2b^8+7b^3a';
  test(`Canonical form ${latex}`, () => {
    expect(expression(latex)).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, ['Power', 'b', 8]], ['Multiply', 5, ['Power', 'a', 4], ['Square', 'c']], ['Multiply', 7, 'a', ['Power', 'b', 3]]]`
    );
  });
});

describe('OBJECT LITERAL FORM', () => {
  test('Shorthand expression', () => {
    expect(
      engine.format(['Add', 'x', ['Sin', 'Pi'], 2], ['object-literal'])
    ).toMatchInlineSnapshot(
      `{fn: [{sym: 'Add'}, {sym: 'x'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}]}, {num: '2'}]}`
    );
  });
  test('Expression with metadata', () => {
    expect(
      engine.format(
        [
          { sym: 'Add', metadata: 'add' },
          { sym: 'x', metadata: 'ecks' },
          { fn: ['Sin', 'Pi'], metadata: 'fn-md' },
          { num: '1', metadata: 'one' },
        ] as any,
        ['object-literal']
      )
    ).toMatchInlineSnapshot(
      `{fn: [{sym: 'Add', metadata: 'add'}, {sym: 'x', metadata: 'ecks'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}], metadata: 'fn-md'}, {num: '1', metadata: 'one'}]}`
    );
  });
});
