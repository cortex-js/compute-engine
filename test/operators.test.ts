import {
  ADD,
  DIVIDE,
  SUBTRACT,
  MULTIPLY,
  POWER,
} from '../src/compute-engine/utils';
import { expression, expressionError, latex, printExpression } from './utils';

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
describe('ADD/SUBTRACT', () => {
  test('Add Valid forms', () => {
    expect(expression('1+2')).toMatchInlineSnapshot(`['Add', 1, 2]`);
    expect(expression('1+2+3')).toMatchInlineSnapshot(`['Add', 1, 2, 3]`);
    expect(expression('1+(2+3)')).toMatchInlineSnapshot(`['Add', 1, 2, 3]`);
    expect(expression('-1-2')).toMatchInlineSnapshot(`['Add', -2, -1]`);
    expect(expression('1+\\infty')).toMatchInlineSnapshot(
      `['Add', 1, {num: 'Infinity'}]`
    );
    expect(latex([ADD, 1, [DIVIDE, 3, 4]])).toMatchInlineSnapshot(
      `'1\\frac{3}{4}'`
    );
  });
  test('Subtract Valid forms', () => {
    expect(latex([SUBTRACT, 1, 2])).toMatchInlineSnapshot(`'1-2'`);
    expect(latex([SUBTRACT, -1, -2])).toMatchInlineSnapshot(`'-1--2'`);
  });
  test('Subtract Invalid forms', () => {
    expect(latex([SUBTRACT])).toMatchInlineSnapshot(`'syntax-error'`);
    expect(latex([SUBTRACT, null])).toMatchInlineSnapshot(`''`);
    expect(latex([SUBTRACT, undefined])).toMatchInlineSnapshot(
      `'syntax-error'`
    );
    expect(latex([SUBTRACT, 1])).toMatchInlineSnapshot(`'1'`);
    expect(latex([SUBTRACT, 1, 2, 3])).toMatchInlineSnapshot(`'1-2-3'`);
  });
});

describe('MULTIPLY', () => {
  test('Multiply Invalid forms', () => {
    expect(latex([MULTIPLY, 2, 3])).toMatchInlineSnapshot(`'2\\times3'`);
    expect(
      latex([MULTIPLY, [DIVIDE, 2, 'x'], [DIVIDE, 'x', 3]])
    ).toMatchInlineSnapshot(`'\\frac{2}{x}\\frac{x}{3}'`);
    expect(
      latex([MULTIPLY, [DIVIDE, 2, 'x'], [POWER, 'x', -2]])
    ).toMatchInlineSnapshot(`'\\frac{\\frac{2}{x}}{x^{2}}'`);
  });
  test('Multiply Invalid forms', () => {
    expect(latex([MULTIPLY])).toMatchInlineSnapshot(`''`);
    expect(latex([MULTIPLY, null])).toMatchInlineSnapshot(`''`);
    expect(latex([MULTIPLY, undefined])).toMatchInlineSnapshot(
      `'syntax-error'`
    );
    expect(latex([MULTIPLY, 1])).toMatchInlineSnapshot(`'1'`);
    expect(latex([MULTIPLY, NaN])).toMatchInlineSnapshot(`'NaN'`);
    expect(latex([MULTIPLY, Infinity])).toMatchInlineSnapshot(`'Infinity'`);
  });
});

describe('DIVIDE', () => {
  test('Divide Valid forms', () => {
    expect(latex([DIVIDE, 2, 3])).toMatchInlineSnapshot(`'\\frac{2}{3}'`);
  });
  test('Divide Invalid forms', () => {
    expect(latex([DIVIDE])).toMatchInlineSnapshot(`
            'syntax-error
            syntax-error'
        `);
    expect(latex([DIVIDE, 1])).toMatchInlineSnapshot(`'1'`);
    expect(latex([DIVIDE, null])).toMatchInlineSnapshot(`''`);
    expect(latex([DIVIDE, undefined])).toMatchInlineSnapshot(`'syntax-error'`);
    expect(latex([DIVIDE, NaN])).toMatchInlineSnapshot(`'NaN'`);
    expect(latex([DIVIDE, Infinity])).toMatchInlineSnapshot(`'Infinity'`);
  });
});

describe('FRACTIONS', () => {
  test('Basic', () => {
    expect(expression('\\frac12')).toMatchInlineSnapshot(`['Power', 2, -1]`);
    expect(expression('\\frac{1}{2}')).toMatchInlineSnapshot(
      `['Power', 2, -1]`
    );
  });
  test('Errors', () => {
    expect(expressionError('\\frac')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('\\frac{}')).toMatchInlineSnapshot(`[]`);
  });
});

describe('OPERATORS', () => {
  test('Basic', () => {
    expect(expression('3+5')).toMatchInlineSnapshot(`['Add', 3, 5]`);
    expect(expression('-2-1')).toMatchInlineSnapshot(`['Add', -2, -1]`);
    expect(expression('a+b')).toMatchInlineSnapshot(`['Add', 'a', 'b']`);
    expect(expression('3\\times5')).toMatchInlineSnapshot(`['Multiply', 3, 5]`);
    expect(expression('13\\times15')).toMatchInlineSnapshot(
      `['Multiply', 13, 15]`
    );
  });
  test('Prefix', () => {
    expect(expression('-1')).toMatchInlineSnapshot(`-1`);
    expect(expression('-x')).toMatchInlineSnapshot(`['Multiply', -1, 'x']`);
    expect(expression('-ab')).toMatchInlineSnapshot(
      `['Multiply', -1, 'a', 'b']`
    );
    expect(expression('-(ab)')).toMatchInlineSnapshot(
      `['Multiply', -1, 'a', 'b']`
    );
    expect(expression('-x-1')).toMatchInlineSnapshot(
      `['Add', ['Multiply', -1, 'x'], -1]`
    );
    expect(expression('-(x+1)')).toMatchInlineSnapshot(
      `['Multiply', -1, ['Add', 'x', 1]]`
    );
    expect(expression('-x+(-(x+1))')).toMatchInlineSnapshot(
      `['Add', ['Multiply', -1, 'x'], ['Multiply', -1, ['Add', 'x', 1]]]`
    );
    expect(
      expression('-\\frac{-x+2\\times x}{-2\\times x + 1}')
    ).toMatchInlineSnapshot(
      `['Multiply', -1, ['Power', ['Add', ['Multiply', -2, 'x'], 1], -1], ['Add', ['Multiply', 2, 'x'], ['Negate', 'x']]]`
    );
  });

  test('Infix-prefix associative', () => {
    expect(expression('2+3x+4')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 3, 'x'], 2, 4]`
    );
    expect(expression('-5-3-2')).toMatchInlineSnapshot(`['Add', -5, -3, -2]`);
    expect(expression('13+15+17')).toMatchInlineSnapshot(`['Add', 13, 15, 17]`);
    expect(expression('+23')).toMatchInlineSnapshot(`23`);
    expect(expression('+\\pi')).toMatchInlineSnapshot(`'Pi'`);
    expect(expression('-1-x(2)')).toMatchInlineSnapshot(
      `['Add', ['Multiply', -1, 2, 'x'], -1]`
    );
  });
  test('Postfix', () => {
    expect(expression('-2!-2')).toMatchInlineSnapshot(
      `['Add', -2, ['Factorial', -2]]`
    );
    expect(expression('-2!')).toMatchInlineSnapshot(`['Factorial', -2]`);
    expect(expression('2+n!')).toMatchInlineSnapshot(
      `['Add', ['Factorial', 'n'], 2]`
    );
    expect(expression('x!!!')).toMatchInlineSnapshot(
      `['Factorial', ['Factorial2', 'x']]`
    );
  });
  test('Errors', () => {
    expect(expressionError('+')).toMatchInlineSnapshot(`'syntax-error'`);
    expect(expressionError('12+')).toMatchInlineSnapshot(`'syntax-error'`);
    expect(expressionError('\\times')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('\\times5')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('3\\times\\times5')).toMatchInlineSnapshot(`[]`);
  });
});

describe('MINUS OPERATOR', () => {
  test('Invalid forms', () => {
    expect(expression('-')).toMatchInlineSnapshot(`['', 'syntax-error']`);
    expect(expression('1-')).toMatchInlineSnapshot(`[1, 'syntax-error']`);
  });
});

describe('ALL OPERATORS', () => {
  test('First order partial Derivative', () => {
    expect(expression('\\partial f')).toMatchInlineSnapshot(
      `['Multiply', '\\partial', 'f']`
    ); // @todo
    expect(expression('\\partial_x f')).toMatchInlineSnapshot(
      `['Multiply', ['Subscript', '\\partial', 'x'], 'f']`
    ); // @todo
    expect(expression('\\partial_x f(x)')).toMatchInlineSnapshot(
      `['Multiply', ['Subscript', '\\partial', 'x'], ['f', 'x']]`
    ); // @todo

    expect(
      expression('\\frac{\\partial f}{\\partial x} ')
    ).toMatchInlineSnapshot(
      `['Multiply', '\\partial', ['Power', ['Multiply', '\\partial', 'x'], -1], 'f']`
    );
  }); // @todo
  test('Second order partial Derivative', () => {
    return; // @todo
  });

  test('Second order mixed Derivative', () => {
    expect(expression('\\partial_{x,y} f(x,y)')).toMatchInlineSnapshot(
      `['Multiply', ['Subscript', '\\partial', ['Sequence', 'x', 'y']], ['f', 'x', 'y']]`
    ); // @todo
    expect(expression('\\partial^2_{x,y} f(x,y)')).toMatchInlineSnapshot(
      `['Multiply', ['Subscript', ['Power', '\\partial', 2], ['Sequence', 'x', 'y']], ['f', 'x', 'y']]`
    ); // @todo
    expect(
      expression('\\frac{\\partial^2}{\\partial_{x,y}} f(x,y)')
    ).toMatchInlineSnapshot(
      `['Multiply', ['Power', '\\partial', 2], ['Power', ['Subscript', '\\partial', ['Sequence', 'x', 'y']], -1], ['f', 'x', 'y']]`
    ); // @todo
    expect(
      expression('\\frac{\\partial^2 f(x, y, z)}{\\partial_{x,y}} ')
    ).toMatchInlineSnapshot(
      `['Multiply', ['Power', '\\partial', 2], ['Power', ['Subscript', '\\partial', ['Sequence', 'x', 'y']], -1], ['f', 'x', 'y', 'z']]`
    ); // @todo
  });
});

describe('ARITHMETIC FUNCTIONS', () => {
  test('Invisible operator', () => {
    expect(expression('2^{3}4+5')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 4, ['Power', 2, 3]], 5]`
    );
    expect(expression('2x3')).toMatchInlineSnapshot(`['Multiply', 2, 3, 'x']`);
  });
  test('Negate', () => {
    expect(expression('-1')).toMatchInlineSnapshot(`-1`);
    expect(expression('-2+3-4')).toMatchInlineSnapshot(`['Add', -4, -2, 3]`);
    expect(expression('-x')).toMatchInlineSnapshot(`['Multiply', -1, 'x']`);
    expect(expression('--x')).toMatchInlineSnapshot(`['PreDecrement', 'x']`);
    expect(expression('-(-x)')).toMatchInlineSnapshot(
      `['Multiply', -1, ['Negate', 'x']]`
    ); // @todo ["Negate", ["Negate", "x"]] ?
    expect(expression('-i')).toMatchInlineSnapshot(
      `['Multiply', -1, 'ImaginaryI']`
    );
    expect(expression('-\\infty')).toMatchInlineSnapshot(`{num: '-Infinity'}`);
  });
  test('Infix plus', () => {
    expect(expression('+1')).toMatchInlineSnapshot(`1`);
    expect(expression('+x')).toMatchInlineSnapshot(`'x'`);
    expect(expression('+i')).toMatchInlineSnapshot(`'ImaginaryI'`);
    expect(expression('+\\infty')).toMatchInlineSnapshot(`{num: 'Infinity'}`);
  });
  test('Add/subtract', () => {
    expect(expression('-1-2+3-4')).toMatchInlineSnapshot(
      `['Add', -4, -2, -1, 3]`
    );
    expect(expression('a-b+c-d')).toMatchInlineSnapshot(
      `['Add', 'a', ['Multiply', -1, 'b'], 'c', ['Multiply', -1, 'd']]`
    );
  });
  test('Precedence of add/multiply', () => {
    expect(expression('2\\times3+4')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, 3], 4]`
    );
    expect(expression('-2\\times-3-4')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, 3], -4]`
    );
  });
});

describe('INVISIBLE OPERATOR', () => {
  test('Invisible product', () => {
    expect(expression('2x')).toMatchInlineSnapshot(`['Multiply', 2, 'x']`);
    expect(expression('2\\times-x')).toMatchInlineSnapshot(
      `['Multiply', -2, 'x']`
    );
    expect(expression('2(x+1)')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Add', 'x', 1]]`
    );
    expect(expression('3\\pi')).toMatchInlineSnapshot(`['Multiply', 3, 'Pi']`);
    expect(expression('\\frac{1}{2}\\pi')).toMatchInlineSnapshot(
      `['Multiply', ['Power', 2, -1], 'Pi']`
    );
    expect(expression('2\\sin(x)')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Sin', 'x']]`
    );
    expect(expression('2x\\sin(x)\\frac{1}{2}')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Power', 2, -1], 'x', ['Sin', 'x']]`
    );
    expect(expression('3\\pi5')).toMatchInlineSnapshot(
      `['Multiply', 3, 5, 'Pi']`
    );
    expect(expression('2\\times-x')).toMatchInlineSnapshot(
      `['Multiply', -2, 'x']`
    );
  });
  test('Invisible Plus', () => {
    expect(expression('2\\frac{3}{4}')).toMatchInlineSnapshot(
      `['Add', 2, ['Multiply', 3, ['Power', 4, -1]]]`
    );
    expect(expression('2\\frac{a}{b}')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 'a', ['Power', 'b', -1]], 2]`
    );
  });
});
