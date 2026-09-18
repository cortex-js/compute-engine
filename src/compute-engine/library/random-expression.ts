import type { MathJsonExpression, MathJsonSymbol } from '../../math-json.js';

/** A source of uniform numbers in `[0, 1)`: the `entropy` handler of the
 * host capability registry, supplied by the `RandomExpression` operator. */
type Draw = () => number;

function oneOf<T = MathJsonExpression>(draw: Draw, xs: T[]): T {
  return xs[Math.floor(draw() * xs.length)];
}

/**
 * The most nested application a generated expression can hold. The grammar
 * levels below do not bound the depth by themselves: level 2 can return to
 * level 1, so a source of numbers that keeps answering the same value (a
 * constant `entropy` handler in a test) would recurse without end. Past this
 * depth every position is a leaf.
 */
const MAX_DEPTH = 24;

function randomExpressionWithHead(
  draw: Draw,
  operator: MathJsonSymbol,
  level: number,
  depth: number
): MathJsonExpression {
  if (operator === 'Add' || operator === 'Multiply') {
    const ops: MathJsonExpression[] = [];
    let count = 1 + Math.floor(draw() * 12);
    while (count > 0) {
      ops.push(randomExpression(draw, level + 1, depth + 1));
      count -= 1;
    }
    return [operator, ...ops];
  }
  if (operator === 'Divide' || operator === 'Power') {
    return [
      operator,
      randomExpression(draw, level + 1, depth + 1),
      randomExpression(draw, level + 1, depth + 1),
    ];
  }
  if (operator === 'Root') {
    return [
      operator,
      randomExpression(draw, level + 1, depth + 1),
      randomExpression(draw, 10, depth + 1),
    ];
  }

  if (operator === 'trig') return randomTrig(draw);

  return [operator, randomExpression(draw, level + 1, depth + 1)];
}

function randomTrig(draw: Draw): MathJsonExpression {
  return [
    oneOf(draw, ['Cos', 'Sin', 'Tan', 'Sinh', 'Arccos', 'Arsinh']),
    oneOf(draw, [
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

export function randomExpression(
  draw: Draw,
  level?: number,
  depth = 0
): MathJsonExpression {
  level ??= 1;
  if (depth > MAX_DEPTH) return leaf(draw);
  if (level === 1) {
    const h: MathJsonExpression = oneOf(draw, [
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
    if (typeof h === 'string')
      return randomExpressionWithHead(draw, h, 1, depth);
    return h as MathJsonExpression;
  }
  if (level === 2) {
    const r = draw();
    if (r > 0.75) return randomExpression(draw, 1, depth + 1);
    if (r > 0.5) return randomExpression(draw, 3, depth + 1);
    const h = oneOf(draw, [
      'Multiply',
      'Multiply',
      'Add',
      'Power',
      'trig',
      'Ln',
      'Exp',
    ]);
    return randomExpressionWithHead(draw, h, 2, depth);
  }

  return leaf(draw);
}

/** A terminal: a number, a symbol, or a constant. */
function leaf(draw: Draw): MathJsonExpression {
  return oneOf(draw, [
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
