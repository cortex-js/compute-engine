import { Expression } from '../../math-json';

function oneOf<T = Expression>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

function randomExpressionWithHead(head: string, level: number): Expression {
  if (head === 'Add' || head === 'Multiply') {
    const ops: Expression[] = [];
    let count = 1 + Math.floor(Math.random() * 12);
    while (count > 0) {
      ops.push(randomExpression(level + 1));
      count -= 1;
    }
    return [head, ...ops];
  }
  if (head === 'Divide' || head === 'Power') {
    return [head, randomExpression(level + 1), randomExpression(level + 1)];
  }
  if (head === 'Root') {
    return [head, randomExpression(level + 1), randomExpression(10)];
  }

  if (head === 'trig') return randomTrig();

  return [head, randomExpression(level + 1)];
}

function randomTrig(): Expression {
  return [
    oneOf(['Cos', 'Sin', 'Tan', 'Sinh', 'Arccos', 'Arsinh']),
    oneOf([
      'Pi',
      '-1',
      '0',
      '1',
      ['Divide', 'Pi', -5],
      ['Multiply', -2, ['Divide', 'Pi', 11]],
      ['Multiply', 'Half', 'Pi'],
      ['Multiply', 5, 'Pi'],
      ['Multiply', 12, 'Pi'],
      ['Divide', 'Pi', 5],
      ['Divide', 'Pi', 9],
      ['Multiply', 5, ['Divide', 'Pi', 9]],
      ['Multiply', 2, ['Divide', 'Pi', 11]],
      ['Multiply', 2, ['Divide', 'Pi', 3]],
    ]),
  ];
}

export function randomExpression(level?: number): Expression {
  level ??= 1;
  if (level === 1) {
    const h = oneOf([
      [
        'Sqrt',
        [
          'Multiply',
          6,
          [
            'Sum',
            ['Divide', 1, ['Power', 'n', 2]],
            ['Triple', ['Hold', 'n'], 1, 'PositiveInfinity'],
          ],
        ],
      ],

      'Add',
      'Add',
      'Add',
      'Add',
      'Add',
      'Multiply',
      'Multiply',
      'Multiply',
      'Multiply',
      'Divide',
      'Divide',
      'Divide',
      'Root',
      'Sqrt',
      'Subtract',
      'Negate',
      'trig',
    ]);
    if (typeof h === 'string') return randomExpressionWithHead(h, 1);
    return h as Expression;
  }
  if (level === 2) {
    const r = Math.random();
    if (r > 0.75) return randomExpression(1);
    if (r > 0.5) return randomExpression(3);
    const h = oneOf([
      'Multiply',
      'Multiply',
      'Add',
      'Power',
      'trig',
      'Ln',
      'Exp',
    ]);
    return randomExpressionWithHead(h, 2);
  }

  return oneOf([
    -0.000012345,
    -2,
    -2,
    -2,
    -3,
    -5,
    -6,
    -12,
    -1.654e-57,
    0,
    0,
    0.00012345,
    1.654e-57,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    5,
    5,
    6,
    6,
    1234.5678,
    5678.1234,
    10,
    15,
    18,
    30,
    60,
    1.234e57,
    '123456789.12345678912345e200',
    '987654321.12345678912345',

    ['Rational', -6, 10],
    ['Rational', -12, 15],
    ['Rational', -15, 12],
    ['Rational', 3, 5],
    ['Rational', 12, 15],
    ['Rational', 15, 12],

    'ExponentialE',
    // 'ImaginaryUnit',
    ['Sqrt', 3],
    ['Sqrt', 5],
    ['Sqrt', 15],
    ['Sqrt', 25],
    ['Complex', -1.1, 1.1],
    ['Complex', 4, 5],

    'x',
    'x',
    'x',
    'x',
    ['Add', 'x', 1],
    ['Divide', 'x', 3],
    ['Square', 'x'],
    ['Power', 'x', 3],
    ['Power', 'x', 4],
    ['Subtract', 'x', 1],
    ['Add', 'x', 1],
    // 'a',
    // 'b',
    'Pi',
  ]);
}
