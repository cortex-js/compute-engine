import { ADD, DIVIDE, SUBTRACT, MULTIPLY, POWER } from '../../src/common/utils';
import { Expression } from '../../src/math-json/math-json-format';
import { expression, expressionError, latex } from '../utils';

describe('RELATIONAL', () => {
  test('Complete', () => {
    expect(expression('x=1')).toMatchInlineSnapshot(`['Equal', 1, 'x']`);
    expect(expression('x=1+1')).toMatchInlineSnapshot(
      `['Equal', ['Add', 1, 1], 'x']`
    );
    expect(expression('x+y=1+1')).toMatchInlineSnapshot(
      `['Equal', ['Add', 1, 1], ['Add', 'x', 'y']]`
    );
  });
  test('Partial', () => {
    expect(expression('x=')).toMatchInlineSnapshot(`['Equal', 'Missing', 'x']`);
    expect(expression('=x')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '=x'}], ''syntax-error'']`
    );
    expect(expression('2 \\times 2 = ')).toMatchInlineSnapshot(
      `['Equal', ['Multiply', 2, 2], 'Missing']`
    );
  });
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
    expect(latex([SUBTRACT])).toMatchInlineSnapshot(`''`);
    expect(
      latex([SUBTRACT, null as unknown as Expression])
    ).toMatchInlineSnapshot(`''`);
    expect(
      latex([SUBTRACT, undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`''`);
    expect(latex([SUBTRACT, 1])).toMatchInlineSnapshot(`'1'`);
    expect(latex([SUBTRACT, 1, 2, 3])).toMatchInlineSnapshot(`'1-2-3'`);
  });
});

describe('MULTIPLY', () => {
  test('Multiply Valid forms', () => {
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
    expect(
      latex([MULTIPLY, null as unknown as Expression])
    ).toMatchInlineSnapshot(`''`);
    expect(
      latex([MULTIPLY, undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`''`);
    expect(latex([MULTIPLY, 1])).toMatchInlineSnapshot(`'1'`);
    expect(latex([MULTIPLY, 'NaN'])).toMatchInlineSnapshot(
      `'\\operatorname{NaN}'`
    );
    expect(latex([MULTIPLY, 'Infinity'])).toMatchInlineSnapshot(
      `'\\operatorname{Infinity}'`
    );
  });
});

describe('DIVIDE', () => {
  test('Divide Valid forms', () => {
    expect(latex([DIVIDE, 2, 3])).toMatchInlineSnapshot(`'\\frac{2}{3}'`);
  });
  test('Divide Invalid forms', () => {
    expect(latex([DIVIDE])).toMatchInlineSnapshot(`'\\frac{}{}'`);
    expect(latex([DIVIDE, 1])).toMatchInlineSnapshot(`'1'`);
    expect(
      latex([DIVIDE, null as unknown as Expression])
    ).toMatchInlineSnapshot(`'Error: syntax-error,'`);
    expect(
      latex([DIVIDE, undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`'Error: syntax-error,'`);
    expect(latex([DIVIDE, 'NaN'])).toMatchInlineSnapshot(
      `'\\operatorname{NaN}'`
    );
    expect(latex([DIVIDE, '+Infinity'])).toMatchInlineSnapshot(
      `'\\operatorname{+Infinity}'`
    );
  });
});

describe('FRACTIONS', () => {
  test('Basic', () => {
    expect(expression('\\frac12')).toMatchInlineSnapshot(`'Half'`);
    expect(expression('\\frac{1}{2}')).toMatchInlineSnapshot(`'Half'`);
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
    expect(expression('-x')).toMatchInlineSnapshot(`['Negate', 'x']`);
    expect(expression('-ab')).toMatchInlineSnapshot(
      `['Multiply', ['Negate', 'a'], 'b']`
    );
    expect(expression('-(ab)')).toMatchInlineSnapshot(
      `['Multiply', ['Negate', 'a'], 'b']`
    );
    expect(expression('-x-1')).toMatchInlineSnapshot(
      `['Add', ['Negate', 'x'], -1]`
    );
    expect(expression('-(x+1)')).toMatchInlineSnapshot(
      `['Add', ['Negate', 'x'], -1]`
    );
    expect(expression('-x+(-(x+1))')).toMatchInlineSnapshot(
      `['Add', ['Negate', 'x'], ['Negate', 'x'], -1]`
    );
    expect(
      expression('-\\frac{-x+2\\times x}{-2\\times x + 1}')
    ).toMatchInlineSnapshot(
      `['Negate', ['Divide', ['Add', ['Multiply', 2, 'x'], ['Negate', 'x']], ['Add', ['Negate', ['CartesianProduct', 2, 'x']], 1]]]`
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
      `['Sequence', ['Add', ['Negate', 'x'], -1], ['Error', ['LatexString', {str: '(2)'}], ''syntax-error'']]`
    );
  });
  test('Postfix', () => {
    expect(expression('-2!-2')).toMatchInlineSnapshot(
      `['Add', -2, ['Negate', ['Factorial', 2]]]`
    );
    expect(expression('-2!')).toMatchInlineSnapshot(
      `['Negate', ['Factorial', 2]]`
    );
    expect(expression('2+n!')).toMatchInlineSnapshot(
      `['Add', ['Factorial', 'n'], 2]`
    );
    expect(expression('x!!!')).toMatchInlineSnapshot(
      `['Factorial', ['Factorial2', 'x']]`
    );
  });
  test('Errors', () => {
    expect(expressionError('+')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('12+')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('\\times')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('\\times5')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('3\\times\\times5')).toMatchInlineSnapshot(`[]`);
  });
});

describe('MINUS OPERATOR', () => {
  test('Invalid forms', () => {
    expect(expression('-')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '-'}], ''syntax-error'']`
    );
    expect(expression('1-')).toMatchInlineSnapshot(
      `['Sequence', 1, ['Error', ['LatexString', {str: '-'}], ''syntax-error'']]`
    );
  });
});

describe('ALL OPERATORS', () => {
  test('First order partial Derivative', () => {
    expect(expression('\\partial f')).toMatchInlineSnapshot(
      `['PartialDerivative', ['f', 'N', 'o', 't', 'h', 'i', 'n', 'g'], 'Nothing', 'Nothing']`
    ); // @todo
    expect(expression('\\partial_x f')).toMatchInlineSnapshot(
      `['PartialDerivative', ['f', 'N', 'o', 't', 'h', 'i', 'n', 'g'], 'x', 'Nothing']`
    ); // @todo
    expect(expression('\\partial_x f(x)')).toMatchInlineSnapshot(
      `['PartialDerivative', ['f', 'x'], 'x', 'Nothing']`
    ); // @todo

    expect(
      expression('\\frac{\\partial f}{\\partial x} ')
    ).toMatchInlineSnapshot(
      `['PartialDerivative', ['f', 'N', 'o', 't', 'h', 'i', 'n', 'g'], ['Nothing'], 'Nothing']`
    );
  }); // @todo
  test('Second order partial Derivative', () => {
    return; // @todo
  });

  test('Second order mixed Derivative', () => {
    expect(expression('\\partial_{x,y} f(x,y)')).toMatchInlineSnapshot(
      `['PartialDerivative', ['f', 'x', 'y'], ['List', 'x', 'y'], 'Nothing']`
    ); // @todo
    expect(expression('\\partial^2_{x,y} f(x,y)')).toMatchInlineSnapshot(
      `['PartialDerivative', ['f', 'x', 'y'], ['List', 'x', 'y'], 2]`
    ); // @todo
    expect(
      expression('\\frac{\\partial^2}{\\partial_{x,y}} f(x,y)')
    ).toMatchInlineSnapshot(
      `['Sequence', ['PartialDerivative', 'Nothing', [['List', 'x', 'y']], 2], ['Error', ['LatexString', {str: 'f(x,y)'}], ''syntax-error'']]`
    ); // @todo
    expect(
      expression('\\frac{\\partial^2 f(x, y, z)}{\\partial_{x,y}} ')
    ).toMatchInlineSnapshot(
      `['PartialDerivative', ['f', 'x', 'y', 'z'], [['List', 'x', 'y']], 2]`
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
    expect(expression('-x')).toMatchInlineSnapshot(`['Negate', 'x']`);
    expect(expression('--x')).toMatchInlineSnapshot(`['PreDecrement', 'x']`);
    expect(expression('-(-x)')).toMatchInlineSnapshot(`'x'`); // @todo ["Negate", ["Negate", "x"]] ?
    expect(expression('-i')).toMatchInlineSnapshot(
      `['Negate', 'ImaginaryUnit']`
    );
    expect(expression('-\\infty')).toMatchInlineSnapshot(`{num: '-Infinity'}`);
  });
  test('Infix plus', () => {
    expect(expression('+1')).toMatchInlineSnapshot(`1`);
    expect(expression('+x')).toMatchInlineSnapshot(`'x'`);
    expect(expression('+i')).toMatchInlineSnapshot(`'ImaginaryUnit'`);
    expect(expression('+\\infty')).toMatchInlineSnapshot(`{num: 'Infinity'}`);
  });
  test('Add/subtract', () => {
    expect(expression('-1-2+3-4')).toMatchInlineSnapshot(
      `['Add', -4, -2, -1, 3]`
    );
    expect(expression('a-b+c-d')).toMatchInlineSnapshot(
      `['Add', 'a', 'c', ['Negate', 'd'], ['Negate', 'b']]`
    );
  });
  test('Precedence of add/multiply', () => {
    expect(expression('2\\times3+4')).toMatchInlineSnapshot(
      `['Add', ['Multiply', 2, 3], 4]`
    );
    expect(expression('-2\\times-3-4')).toMatchInlineSnapshot(
      `['Add', ['Negate', ['CartesianProduct', 2, ['Negate', 3]]], -4]`
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
      `['Sequence', 2, ['Error', ['LatexString', {str: '(x+1)'}], ''syntax-error'']]`
    );
    expect(expression('3\\pi')).toMatchInlineSnapshot(`['Multiply', 3, 'Pi']`);
    expect(expression('\\frac{1}{2}\\pi')).toMatchInlineSnapshot(`'HalfPi'`);
    expect(expression('2\\sin(x)')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Sin', 'x']]`
    );
    expect(expression('2x\\sin(x)\\frac{1}{2}')).toMatchInlineSnapshot(
      `['Multiply', 2, 'Half', 'x', ['Sin', 'x']]`
    );
    expect(expression('3\\pi5')).toMatchInlineSnapshot(`['Multiply', 3, 'Pi']`);
    expect(expression('2\\times-x')).toMatchInlineSnapshot(
      `['Multiply', -2, 'x']`
    );
  });
  test('Invisible Plus', () => {
    expect(expression('2\\frac{3}{4}')).toMatchInlineSnapshot(
      `['Add', 'ThreeQuarter', 2]`
    );
    expect(expression('2\\frac{a}{b}')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Divide', 'a', 'b']]`
    );
  });
});
