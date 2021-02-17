import {
  NEGATE,
  SUBTRACT,
  MULTIPLY,
  ADD,
  POWER,
  DIVIDE,
  GROUP,
  PI,
} from '../src/dictionary/dictionary';
import { Expression } from '../src/public';
import { expression, printExpression, engine } from './utils';

beforeEach(() => {
  jest.spyOn(console, 'assert').mockImplementation((assertion) => {
    if (!assertion) debugger;
  });
  jest.spyOn(console, 'log').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'info').mockImplementation(() => {
    debugger;
  });
});
expect.addSnapshotSerializer({
  // test: (val): boolean => Array.isArray(val) || typeof val === 'object',
  test: (_val): boolean => true,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    return printExpression(val);
  },
});

describe('FORMS', () => {
  const exprs: [string, Expression, Expression][] = [
    ['-0', { num: '-0' }, { num: '-0' }],
    ['a-0', [SUBTRACT, 'a', 0], 'a'],
    ['0-a', [SUBTRACT, 0, 'a'], [MULTIPLY, -1, 'a']],
    ['7+2+5', [ADD, 7, 2, 5], [ADD, 2, 5, 7]],
    // This one is tricky:
    // the simplifications of POWER and MULTIPLY
    // have to be done in the right order to get the correct result
    ['1^2x', [MULTIPLY, [POWER, 1, 2], 'x'], 'x'],

    // Negative sign on denom, numer or both
    [
      '\\frac{-x}{-n}',
      [DIVIDE, [NEGATE, 'x'], [NEGATE, 'n']],
      [MULTIPLY, -1, [POWER, [MULTIPLY, -1, 'n'], -1], 'x'],
    ],
    [
      '\\frac{x}{-n}',
      [DIVIDE, 'x', [NEGATE, 'n']],
      [MULTIPLY, [POWER, [MULTIPLY, -1, 'n'], -1], 'x'],
    ],
    [
      '\\frac{-x}{n}',
      [DIVIDE, [NEGATE, 'x'], 'n'],
      [MULTIPLY, -1, [POWER, 'n', -1], 'x'],
    ],

    //
    [
      '\\frac{-101}{10^{\\frac{2}{3}}}',
      [DIVIDE, -101, [POWER, 10, [DIVIDE, 2, 3]]],
      [MULTIPLY, -101, [POWER, 10, [MULTIPLY, -2, [POWER, 3, -1]]]],
    ],

    // Flatten, to multiple levels
    [
      '(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))',
      [
        MULTIPLY,
        [GROUP, [ADD, 1, [GROUP, [ADD, 2, [GROUP, [ADD, 3, 4]]]]]],
        [
          GROUP,
          [
            MULTIPLY,
            [GROUP, [ADD, [GROUP, [ADD, 5, 6]], 7]],
            [GROUP, [GROUP, [ADD, 8, [GROUP, [ADD, 9, 10]]]]],
            [GROUP, [ADD, 11, [GROUP, [ADD, 12, 13]], 14]],
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
      [MULTIPLY, 0, 2, [POWER, 5, -1], 'x'],
    ],
    // Negative exponents become fractions
    [
      '2xy^{-n}',
      [MULTIPLY, 2, 'x', [POWER, 'y', [NEGATE, 'n']]],
      [MULTIPLY, 2, 'x', [POWER, 'y', [MULTIPLY, -1, 'n']]],
    ],

    [
      '2\\times0\\times5\\times4',
      [MULTIPLY, 2, 0, 5, 4],
      [MULTIPLY, 0, 2, 4, 5],
    ],
    [
      '2\\times(5-5)\\times5\\times4',
      [MULTIPLY, 2, [GROUP, [SUBTRACT, 5, 5]], 5, 4],
      [MULTIPLY, 2, 4, 5, [ADD, -5, 5]],
    ],

    [
      '2\\frac{x}{a}\\frac{y}{b}',
      [MULTIPLY, 2, [DIVIDE, 'x', 'a'], [DIVIDE, 'y', 'b']],
      [MULTIPLY, 2, [POWER, 'a', -1], [POWER, 'b', -1], 'x', 'y'],
    ],
  ];

  exprs.forEach((x) =>
    test('Full form "' + x[0] + '"', () => {
      // console.log(
      //     x[0] +
      //         ' full -> ' +
      //         JSON.stringify(expression(x[0], { form: 'full' }))
      // );
      expect(expression(x[0], { form: 'full' })).toStrictEqual(x[1]);
    })
  );
  exprs.forEach((x) =>
    test('Canonical form "' + x[0] + '"', () => {
      // console.log(
      //     x[0] +
      //         ' cano -> ' +
      //         JSON.stringify(expression(x[0]))
      // );
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
        3, // degree 0, 3 = 3
        5, // degree 0, 5 > 3
        [POWER, 4, -1], // degree 0,
        PI, // degree 0,
        'x', // degree 1, x < y
        'y', // degree 1, y < z
        [POWER, 'y', [POWER, 2, -1]], // degree 1, y >
        'z', // degree 1
      ],
    ],

    [
      'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2',
      [
        ADD,
        [MULTIPLY, [POWER, 'x', 4], 'y'],
        [MULTIPLY, [POWER, 'x', 3], [POWER, 'y', 2]],
        [MULTIPLY, [POWER, 'x', 2], [POWER, 'y', 3]],
        [MULTIPLY, 'x', [POWER, 'y', 4]],
        [MULTIPLY, [POWER, 'x', 2], [POWER, 'y', 2]],
      ],
    ],
    [
      '(b^3c^2d)(x^7y)(a^5f)(b^2x^5b3)',
      [
        MULTIPLY,
        3,
        [POWER, 'a', 5],
        'b',
        [POWER, 'b', 3],
        [POWER, 'b', 2],
        [POWER, 'c', 2],
        'd',
        'f',
        [POWER, 'x', 7],
        [POWER, 'x', 5],
        'y',
      ],
    ],
    [
      '(b^3c^2d)+(x^7y)+(a^5f)+(b^2x^5b3)',
      [
        ADD,
        [MULTIPLY, 3, 'b', [POWER, 'b', 2], [POWER, 'x', 5]],
        [MULTIPLY, [POWER, 'x', 7], 'y'],
        [MULTIPLY, [POWER, 'a', 5], 'f'],
        [MULTIPLY, [POWER, 'b', 3], [POWER, 'c', 2], 'd'],
      ],
    ],
    [
      '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)',
      [
        ADD,
        [MULTIPLY, [POWER, 'a', 5], 'b'],
        [POWER, 'b', 6],
        [MULTIPLY, [POWER, 'a', 3], [POWER, 'a', 2]],
        [POWER, 'a', 5],
        [MULTIPLY, [POWER, 'b', 3], [POWER, 'b', 2]],
      ],
    ],
    [
      '5c^2a^4+2b^8+7b^3a',
      [
        ADD,
        [MULTIPLY, 2, [POWER, 'b', 8]],
        [MULTIPLY, 5, [POWER, 'a', 4], [POWER, 'c', 2]],
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
    expect(expression('(00111)_{2}', { form: 'full' })).toMatchInlineSnapshot(
      `['BaseForm', 7, 2]`
    );
    expect(expression('(00111)_2', { form: 'full' })).toMatchInlineSnapshot(
      `['BaseForm', 7, 2]`
    );
    expect(expression('(00\\;111)_2', { form: 'full' })).toMatchInlineSnapshot(
      `['BaseForm', 7, 2]`
    );
    expect(
      expression('(\\mathtt{00\\;111})_2', { form: 'full' })
    ).toMatchInlineSnapshot(`['BaseForm', 7, 2]`);
  });
  test('decimal', () => {
    expect(expression('(123)_{10}', { form: 'full' })).toMatchInlineSnapshot(
      `['BaseForm', 123, 10]`
    );
    expect(expression('(12c3)_{10}', { form: 'full' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
  });
  test('hexadecimal', () => {
    expect(expression('(a1b23)_{16}', { form: 'full' })).toMatchInlineSnapshot(
      `['BaseForm', 662307, 16]`
    );
    expect(expression('(1x2gc3)_{16}', { form: 'full' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
  });
  test('base 36', () => {
    expect(
      expression('(a1xy9zb23)_{36}', { form: 'full' })
    ).toMatchInlineSnapshot(`['BaseForm', 28363369669563, 36]`);
  });
  test('base 37', () => {
    expect(expression('(a1b23)_{37}', { form: 'full' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
    expect(expression('(1x2gc3)_{37}', { form: 'full' })).toMatchInlineSnapshot(
      `['Nothing', 'base-out-of-range']`
    );
  });
});
