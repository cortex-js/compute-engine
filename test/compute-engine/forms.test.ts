import { expression, engine } from '../utils';

describe('FORMS', () => {
  test('Full form "-0"', () => {
    expect(expression('-0', { form: 'json' })).toMatchInlineSnapshot(
      `['Negate', 0]`
    );
  });
  test('Canonical form "-0"', () => {
    expect(expression('-0')).toMatchInlineSnapshot(`{num: '-0'}`);
  });

  test('Full form "a-0"', () => {
    expect(expression('a-0', { form: 'json' })).toMatchInlineSnapshot(
      `['Subtract', 'a', 0]`
    );
  });
  test('Canonical form "a-0"', () => {
    expect(expression('a-0')).toMatchInlineSnapshot(`'a'`);
  });

  test('Full form "0-a"', () => {
    expect(expression('0-a', { form: 'json' })).toMatchInlineSnapshot(
      `['Subtract', 0, 'a']`
    );
  });
  test('Canonical form "0-a"', () => {
    expect(expression('0-a')).toMatchInlineSnapshot(`['Negate', 'a']`);
  });

  test('Full form "7 + 2 + 5"', () => {
    expect(expression('7 + 2 + 5', { form: 'json' })).toMatchInlineSnapshot(
      `['Add', 7, 2, 5]`
    );
  });
  test('Canonical form "7 + 2 + 5"', () => {
    expect(expression('7 + 2 + 5')).toMatchInlineSnapshot(`['Add', 2, 5, 7]`);
  });
  // This one is tricky:
  // the simplifications of POWER and MULTIPLY
  // have to be done in the right order to get the correct result
  test('Full form "2^3x"', () => {
    expect(expression('2^3x', { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', ['Power', 2, 3], 'x']`
    );
  });
  test('Canonical form "2^3x"', () => {
    expect(expression('2^3x')).toMatchInlineSnapshot(
      `['Multiply', ['Power', 2, 3], 'x']`
    );
  });
  // Negative sign on denom, numer or both
  test('Full form "\\frac{-x}{-n}"', () => {
    expect(
      expression('\\frac{-x}{-n}', { form: 'json' })
    ).toMatchInlineSnapshot(`['Divide', ['Negate', 'x'], ['Negate', 'n']]`);
  });
  test('Canonical form "\\frac{-x}{-n}"', () => {
    expect(expression('\\frac{-x}{-n}')).toMatchInlineSnapshot(
      `['Divide', ['Negate', 'x'], ['Negate', 'n']]`
    );
  });
  test('Full form "\\frac{x}{-n}"', () => {
    expect(expression('\\frac{x}{-n}', { form: 'json' })).toMatchInlineSnapshot(
      `['Divide', 'x', ['Negate', 'n']]`
    );
  });
  test('Canonical form "\\frac{x}{-n}"', () => {
    expect(expression('\\frac{x}{-n}')).toMatchInlineSnapshot(
      `['Divide', 'x', ['Negate', 'n']]`
    );
  });
  test('Full form "\\frac{-x}{n}"', () => {
    expect(expression('\\frac{-x}{n}', { form: 'json' })).toMatchInlineSnapshot(
      `['Divide', ['Negate', 'x'], 'n']`
    );
  });
  test('Canonical form "\\frac{-x}{n}"', () => {
    expect(expression('\\frac{-x}{n}')).toMatchInlineSnapshot(
      `['Divide', ['Negate', 'x'], 'n']`
    );
  });
  test('Full form "\\frac{-101}{10^{\\frac{2}{3}}}"', () => {
    expect(
      expression('\\frac{-101}{10^{\\frac{2}{3}}}', { form: 'json' })
    ).toMatchInlineSnapshot(
      `['Divide', ['Negate', 101], ['Power', 10, ['Divide', 2, 3]]]`
    );
  });
  test('Canonical form "\\frac{-101}{10^{\\frac{2}{3}}}"', () => {
    expect(expression('\\frac{-101}{10^{\\frac{2}{3}}}')).toMatchInlineSnapshot(
      `['Divide', -101, ['Power', 10, 'TwoThird']]`
    );
  });
  // Flatten, to multiple levels
  test('Full form "(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))"', () => {
    expect(
      expression('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))', {
        form: 'json',
      })
    ).toMatchInlineSnapshot(
      `['Sequence', ['Delimiter', ['Add', 1, ['Delimiter', ['Add', 2, ['Delimiter', ['Add', 3, 4]]]]]], ['Error', ['LatexString', {str: '(((5+6)+7)((8+(9+10)))(11+(12+13)+14))'}], ''syntax-error'']]`
    );
  });
  test('Canonical form "(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))"', () => {
    expect(
      expression('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))')
    ).toMatchInlineSnapshot(
      `['Sequence', ['Delimiter', ['Add', 1, 2, 3, 4]], ['Error', ['LatexString', {str: '(((5+6)+7)((8+(9+10)))(11+(12+13)+14))'}], ''syntax-error'']]`
    );
  });
  // \frac should get hoisted with multiply, but not cancel
  // (multiplication by 0 does not always = 0)
  test('Full form "2x\\frac{0}{5}"', () => {
    expect(
      expression('2x\\frac{0}{5}', { form: 'json' })
    ).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', 'x', ['Divide', 0, 5]]]`
    );
  });
  test('Canonical form "2x\\frac{0}{5}"', () => {
    expect(expression('2x\\frac{0}{5}')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 0, 5], 'x']`
    );
  });
  // Negative exponents become fractions
  test('Full form "2xy^{-n}"', () => {
    expect(expression('2xy^{-n}', { form: 'json' })).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', 'x', ['Power', 'y', ['Negate', 'n']]]]`
    );
  });
  test('Canonical form "2xy^{-n}"', () => {
    expect(expression('2xy^{-n}')).toMatchInlineSnapshot(
      `['Multiply', 2, 'x', ['Power', 'y', ['Negate', 'n']]]`
    );
  });
  test('Full form "2\\times0\\times5\\times4"', () => {
    expect(
      expression('2\\times0\\times5\\times4', { form: 'json' })
    ).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', 0, ['Multiply', 5, 4]]]`
    );
  });
  test('Canonical form "2\\times0\\times5\\times4"', () => {
    expect(expression('2\\times0\\times5\\times4')).toMatchInlineSnapshot(
      `['Multiply', 0, 2, 4, 5]`
    );
  });
  test('Full form "2\\times(5-5)\\times5\\times4"', () => {
    expect(
      expression('2\\times(5-5)\\times5\\times4', { form: 'json' })
    ).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Delimiter', ['Subtract', 5, 5]], ['Multiply', 5, 4]]]`
    );
  });
  test('Canonical form "2\\times(5-5)\\times5\\times4"', () => {
    expect(expression('2\\times(5-5)\\times5\\times4')).toMatchInlineSnapshot(
      `['Multiply', 2, 4, 5, ['Add', -5, 5]]`
    );
  });
  test('Full form "2\\frac{x}{a}\\frac{y}{b}"', () => {
    expect(
      expression('2\\frac{x}{a}\\frac{y}{b}', { form: 'json' })
    ).toMatchInlineSnapshot(
      `['Multiply', 2, ['Multiply', ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]]`
    );
  });
  test('Canonical form "2\\frac{x}{a}\\frac{y}{b}"', () => {
    expect(expression('2\\frac{x}{a}\\frac{y}{b}')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']]`
    );
  });
});

describe('ORDER', () => {
  // multiply is commutative and regular canonical sort order applies
  // (numbers before symbols)
  test(`Canonical form yx5z`, () => {
    expect(expression('yx5z')).toMatchInlineSnapshot(
      `['Multiply', 5, 'x', 'y', 'z']`
    );
  });

  // addition is deglex ordered, numbers after symbols
  test(`Canonical form c+7+a+5+b`, () => {
    expect(expression('c+7+a+5+b')).toMatchInlineSnapshot(
      `['Add', 'a', 'b', 'c', 5, 7]`
    );
  });

  // 7a -> degree 1 > degree 0
  // 2b -> degree 1, b > a
  // 5c -> degree 1, c > b
  // 6 -> degree 0
  test(`Canonical form 6+5c+2b+3+7a'`, () => {
    expect(expression('6+5c+2b+3+7a')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 7, 'a'], ['Multiply', 2, 'b'], ['Multiply', 5, 'c'], 3, 6]`
    );
  });

  // Arguments sorted by value
  test(`Canonical form 5a+3a+7a`, () => {
    expect(expression('5a+3a+7a')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 3, 'a'], ['Multiply', 5, 'a'], ['Multiply', 7, 'a']]`
    );
  });

  // deglex sorting order
  // by total degree, then lexicographically
  // If degree is the same, longest factor
  test(`Canonical form x^{3}2\\pi+3x^{3}4\\pi+x^3`, () => {
    expect(expression('x^{3}2\\pi+3x^{3}4\\pi+x^3')).toMatchInlineSnapshot(
      `['Add', ['Power', 'x', 3], ['Multiply', 2, 'Pi', ['Power', 'x', 3]], ['Multiply', 3, 4, 'Pi', ['Power', 'x', 3]]]`
    );
  });

  // The arguments of commutative functions are sorted lexicographically
  // numerical constants (by value), then constants (lexicographically),
  // then free variables (lex),
  test(`Canonical form '-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y'`, () => {
    expect(
      expression('-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y')
    ).toMatchInlineSnapshot(
      `['Multiply', -2, 3, 5, 'Pi', 'ThreeQuarter', 'x', 'y', ['Sqrt', 'y'], 'z']`
    );
  });

  test(`Canonical form 'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2'`, () => {
    expect(expression('x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2')).toMatchInlineSnapshot(
      `['Add', ['Multiply', ['Power', 'x', 4], 'y'], ['Multiply', 'x', ['Power', 'y', 4]], ['Multiply', ['Power', 'x', 3], ['Square', 'y']], ['Multiply', ['Square', 'x'], ['Power', 'y', 3]], ['Multiply', ['Square', 'x'], ['Square', 'y']]]`
    );
  });

  test(`Canonical form '(b^3c^2d)(x^7y)(a^5f)(b^2x^5b3)'`, () => {
    expect(expression('(b^3c^2d)(x^7y)(a^5f)(b^2x^5b3)')).toMatchInlineSnapshot(
      `['Sequence', ['Delimiter', ['Multiply', ['Power', 'b', 3], ['Square', 'c'], 'd']], ['Error', ['LatexString', {str: '(x^7y)(a^5f)(b^2x^5b3)'}], ''syntax-error'']]`
    );
  });

  test(`Canonical form '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'`, () => {
    expect(
      expression('(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)')
    ).toMatchInlineSnapshot(
      `['Add', ['Multiply', ['Power', 'a', 5], 'b'], ['Power', 'b', 6], ['Power', 'a', 5], ['Multiply', ['Square', 'a'], ['Power', 'a', 3]], ['Multiply', ['Square', 'b'], ['Power', 'b', 3]]]`
    );
  });

  test(`Canonical form '5c^2a^4+2b^8+7b^3a'`, () => {
    expect(expression('5c^2a^4+2b^8+7b^3a')).toMatchInlineSnapshot(
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
