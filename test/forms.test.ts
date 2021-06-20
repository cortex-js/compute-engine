import { Expression } from '../src/public';
import {
  SUBTRACT,
  MULTIPLY,
  ADD,
  POWER,
  DIVIDE,
  NEGATE,
  PARENTHESES,
  PI,
} from '../src/common/utils';
import { expression, engine } from './utils';

describe('FORMS', () => {
  const exprs: [string, Expression, Expression][] = [
    ['-0', { num: '-0' }, { num: '-0' }],
    ['a-0', [SUBTRACT, 'a', 0], 'a'],
    ['0-a', [SUBTRACT, 0, 'a'], ['Negate', 'a']],
    ['7+2+5', [ADD, 7, 2, 5], [ADD, 2, 5, 7]],
    // This one is tricky:
    // the simplifications of POWER and MULTIPLY
    // have to be done in the right order to get the correct result
    [
      '1^2x',
      ['Multiply', ['Power', 1, 2], 'x'],
      [MULTIPLY, ['Square', 1], 'x'],
    ],

    // Negative sign on denom, numer or both
    [
      '\\frac{-x}{-n}',
      [DIVIDE, [NEGATE, 'x'], [NEGATE, 'n']],
      ['Divide', ['Negate', 'x'], ['Negate', 'n']],
    ],
    [
      '\\frac{x}{-n}',
      [DIVIDE, 'x', [NEGATE, 'n']],
      ['Divide', 'x', ['Negate', 'n']],
    ],
    [
      '\\frac{-x}{n}',
      [DIVIDE, [NEGATE, 'x'], 'n'],
      ['Divide', ['Negate', 'x'], 'n'],
    ],

    //
    [
      '\\frac{-101}{10^{\\frac{2}{3}}}',
      [DIVIDE, -101, [POWER, 10, [DIVIDE, 2, 3]]],
      ['Divide', -101, ['Power', 10, 'TwoThird']],
    ],

    // Flatten, to multiple levels
    [
      '(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))',
      [
        MULTIPLY,
        [
          PARENTHESES,
          [ADD, 1, [PARENTHESES, [ADD, 2, [PARENTHESES, [ADD, 3, 4]]]]],
        ],
        [
          PARENTHESES,
          [
            MULTIPLY,
            [PARENTHESES, [ADD, [PARENTHESES, [ADD, 5, 6]], 7]],
            [PARENTHESES, [PARENTHESES, [ADD, 8, [PARENTHESES, [ADD, 9, 10]]]]],
            [PARENTHESES, [ADD, 11, [PARENTHESES, [ADD, 12, 13]], 14]],
          ],
        ],
      ],
      // Shorter operations first
      [
        MULTIPLY,
        [ADD, 5, 6, 7],
        [ADD, 8, 9, 10],
        [ADD, 1, 2, 3, 4],
        [ADD, 11, 12, 13, 14],
      ],
    ],

    // \frac should get hoisted with multiply, but not cancel
    // (multiplication by 0 does not always = 0)
    [
      '2x\\frac{0}{5}',
      [MULTIPLY, 2, 'x', [DIVIDE, 0, 5]],
      ['Multiply', 2, ['Divide', 0, 5], 'x'],
    ],
    // Negative exponents become fractions
    [
      '2xy^{-n}',
      [MULTIPLY, 2, 'x', [POWER, 'y', [NEGATE, 'n']]],
      ['Multiply', 2, 'x', ['Power', 'y', ['Negate', 'n']]],
    ],

    [
      '2\\times0\\times5\\times4',
      [MULTIPLY, 2, 0, 5, 4],
      [MULTIPLY, 0, 2, 4, 5],
    ],
    [
      '2\\times(5-5)\\times5\\times4',
      [MULTIPLY, 2, [PARENTHESES, [SUBTRACT, 5, 5]], 5, 4],
      [MULTIPLY, 2, 4, 5, [ADD, -5, 5]],
    ],

    [
      '2\\frac{x}{a}\\frac{y}{b}',
      [MULTIPLY, 2, [DIVIDE, 'x', 'a'], [DIVIDE, 'y', 'b']],
      ['Multiply', 2, ['Divide', 'x', 'a'], ['Divide', 'y', 'b']],
    ],
  ];

  exprs.forEach((x) =>
    test('Full form "' + x[0] + '"', () => {
      // console.log(
      //   x[0] + ' full -> ' + JSON.stringify(expression(x[0], { form: 'json' }))
      // );
      expect(expression(x[0], { form: 'json' })).toStrictEqual(x[1]);
    })
  );
  exprs.forEach((x) =>
    test('Canonical form "' + x[0] + '"', () => {
      // console.log(x[0] + ' cano -> ' + JSON.stringify(expression(x[0])));
      expect(expression(x[0])).toStrictEqual(x[2]);
    })
  );
});

describe('ORDER', () => {
  const exprs: [string, Expression][] = [
    // multiply is commutative and regular canonical sort order applies
    // (numbers before symbols)
    ['yx5z', [MULTIPLY, 5, 'x', 'y', 'z']],

    // addition is deglex ordered, numbers after symbols
    ['c+7+a+5+b', [ADD, 'a', 'b', 'c', 5, 7]],

    // 7a -> degree 1 > degree 0
    // 2b -> degree 1, b > a
    // 5c -> degree 1, c > b
    // 6 -> degree 0
    [
      '6+5c+2b+3+7a',
      [ADD, [MULTIPLY, 7, 'a'], [MULTIPLY, 2, 'b'], [MULTIPLY, 5, 'c'], 3, 6],
    ],
    // Arguments sorted by value
    [
      '5a+3a+7a',
      [ADD, [MULTIPLY, 3, 'a'], [MULTIPLY, 5, 'a'], [MULTIPLY, 7, 'a']],
    ],
    // deglex sorting order
    // by total degree, then lexicographically

    // If degree is the same, longest factor
    [
      'x^{3}2\\pi+3x^{3}4\\pi+x^3',
      [
        ADD,
        [POWER, 'x', 3],
        [MULTIPLY, 2, PI, [POWER, 'x', 3]],
        [MULTIPLY, 3, 4, PI, [POWER, 'x', 3]],
      ],
    ],

    // The arguments of commutative functions are sorted lexicographically
    // constants (by value), then constants (lexicographically),
    // then symbols (lex),
    [
      '-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y',
      [
        MULTIPLY,
        -2, // degree 0, -2 < 3
        3, // degree 0, 3 = 3
        5, // degree 0, 5 > 3
        PI, // degree 0,
        'ThreeQuarter', // degree 0,
        'x', // degree 1, x < y
        'y', // degree 1, y < z
        ['Sqrt', 'y'], // degree 1, y >
        'z', // degree 1
      ],
    ],

    [
      'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2',
      [
        ADD,
        [MULTIPLY, [POWER, 'x', 4], 'y'],
        [MULTIPLY, 'x', [POWER, 'y', 4]],
        [MULTIPLY, [POWER, 'x', 3], ['Square', 'y']],
        [MULTIPLY, ['Square', 'x'], [POWER, 'y', 3]],
        [MULTIPLY, ['Square', 'x'], ['Square', 'y']],
      ],
    ],
    [
      '(b^3c^2d)(x^7y)(a^5f)(b^2x^5b3)',
      [
        MULTIPLY,
        3,
        [POWER, 'a', 5],
        'b',
        ['Square', 'b'],
        [POWER, 'b', 3],
        ['Square', 'c'],
        'd',
        'f',
        [POWER, 'x', 5],
        [POWER, 'x', 7],
        'y',
      ],
    ],
    [
      '(b^3c^2d)+(x^7y)+(a^5f)+(b^2x^5b3)',
      [
        ADD,
        [MULTIPLY, [POWER, 'x', 7], 'y'],
        [MULTIPLY, [POWER, 'a', 5], 'f'],
        [MULTIPLY, 3, 'b', ['Square', 'b'], [POWER, 'x', 5]],
        [MULTIPLY, [POWER, 'b', 3], ['Square', 'c'], 'd'],
      ],
    ],
    [
      '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)',
      [
        ADD,
        [MULTIPLY, [POWER, 'a', 5], 'b'],
        [POWER, 'b', 6],
        [POWER, 'a', 5],
        [MULTIPLY, ['Square', 'a'], [POWER, 'a', 3]],
        [MULTIPLY, ['Square', 'b'], [POWER, 'b', 3]],
      ],
    ],
    [
      '5c^2a^4+2b^8+7b^3a',
      [
        ADD,
        [MULTIPLY, 2, [POWER, 'b', 8]],
        [MULTIPLY, 5, [POWER, 'a', 4], ['Square', 'c']],
        [MULTIPLY, 7, 'a', [POWER, 'b', 3]],
      ],
    ],
  ];

  exprs.forEach((x) =>
    test('Canonical form "' + x[0] + '"', () => {
      // console.log(
      //     x[0] +
      //         ' order -> ' +
      //         JSON.stringify(expression(x[0]))
      // );
      expect(expression(x[0])).toStrictEqual(x[1]);
    })
  );
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

describe('BASE FORM', () => {
  test('binary', () => {
    expect(expression('(00111)_{2}', { form: 'json' })).toMatchInlineSnapshot(
      `['BaseForm', 7, 2]`
    );
    expect(expression('(00111)_2', { form: 'json' })).toMatchInlineSnapshot(
      `['BaseForm', 7, 2]`
    );
    expect(expression('(00\\;111)_2', { form: 'json' })).toMatchInlineSnapshot(
      `['BaseForm', 7, 2]`
    );
    expect(
      expression('(\\mathtt{00\\;111})_2', { form: 'json' })
    ).toMatchInlineSnapshot(`['BaseForm', 7, 2]`);
  });
  test('decimal', () => {
    expect(expression('(123)_{10}', { form: 'json' })).toMatchInlineSnapshot(
      `['BaseForm', 123, 10]`
    );
    expect(expression('(12c3)_{10}', { form: 'json' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
  });
  test('hexadecimal', () => {
    expect(expression('(a1b23)_{16}', { form: 'json' })).toMatchInlineSnapshot(
      `['BaseForm', 662307, 16]`
    );
    expect(expression('(1x2gc3)_{16}', { form: 'json' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
  });
  test('base 36', () => {
    expect(
      expression('(a1xy9zb23)_{36}', { form: 'json' })
    ).toMatchInlineSnapshot(`['BaseForm', 28363369669563, 36]`);
  });
  test('base 37', () => {
    expect(expression('(a1b23)_{37}', { form: 'json' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
    expect(expression('(1x2gc3)_{37}', { form: 'json' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
  });
});
