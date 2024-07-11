import { Expression } from '../../../src/math-json/math-json-format';
import { engine as ce, latex, check, exprToString } from '../../utils';

describe('OPERATOR oprel', () => {
  test('x=1', () =>
    expect(check('x=1')).toMatchInlineSnapshot(`
      box       = ["Equal", "x", 1]
      evaluate  = False
    `));
  test('x=1+1', () =>
    expect(check('x=1+1')).toMatchInlineSnapshot(`
      box       = ["Equal", "x", ["Add", 1, 1]]
      simplify  = ["Equal", "x", 2]
      evaluate  = False
    `));
  test('x+y=1+1', () =>
    expect(check('x+y=1+1')).toMatchInlineSnapshot(`
      box       = ["Equal", ["Add", "x", "y"], ["Add", 1, 1]]
      simplify  = ["Equal", ["Add", "x", "y", -2], 0]
      evaluate  = False
    `));

  test('x<1', () =>
    expect(check('x<1')).toMatchInlineSnapshot(`["Less", "x", 1]`));
  test('x<1+1', () =>
    expect(check('x<1+1')).toMatchInlineSnapshot(`
      box       = ["Less", "x", ["Add", 1, 1]]
      simplify  = ["Less", "x", 2]
    `));
  test('x+y<1+1', () =>
    expect(check('x+y<1+1')).toMatchInlineSnapshot(`
      box       = ["Less", ["Add", "x", "y"], ["Add", 1, 1]]
      simplify  = ["Less", ["Add", "x", "y", -2], 0]
      evaluate  = ["Less", ["Add", "x", "y"], 2]
    `));

  test('x>=1', () =>
    expect(check('x>=1')).toMatchInlineSnapshot(`
      box       = ["GreaterEqual", "x", 1]
      canonical = ["LessEqual", 1, "x"]
    `));
  test('x>=1+1', () =>
    expect(check('x>=1+1')).toMatchInlineSnapshot(`
      box       = ["GreaterEqual", "x", ["Add", 1, 1]]
      canonical = ["LessEqual", ["Add", 1, 1], "x"]
      simplify  = ["LessEqual", 2, "x"]
    `));
  test('x+y>=1+1', () =>
    expect(check('x+y>=1+1')).toMatchInlineSnapshot(`
      box       = ["GreaterEqual", ["Add", "x", "y"], ["Add", 1, 1]]
      canonical = ["LessEqual", ["Add", 1, 1], ["Add", "x", "y"]]
      simplify  = ["LessEqual", 2, ["Add", "x", "y"]]
    `));
});

describe('OPERATOR add/subtract', () => {
  test('1+2', () =>
    expect(check('1+2')).toMatchInlineSnapshot(`
      box       = ["Add", 1, 2]
      simplify  = 3
    `));

  test('1+2+3', () =>
    expect(check('1+2+3')).toMatchInlineSnapshot(`
      box       = ["Add", 1, 2, 3]
      simplify  = 6
    `));

  test('1+(2+3)', () =>
    expect(check('1+(2+3)')).toMatchInlineSnapshot(`
      box       = ["Add", 1, ["Delimiter", ["Add", 2, 3]]]
      canonical = ["Add", 1, 2, 3]
      simplify  = 6
    `));

  test('1-2', () =>
    expect(check('1-2')).toMatchInlineSnapshot(`
      box       = ["Add", 1, -2]
      canonical = ["Subtract", 1, 2]
      simplify  = -1
    `));

  test('-1-2', () =>
    expect(check('-1-2')).toMatchInlineSnapshot(`
      box       = ["Add", -1, -2]
      canonical = ["Subtract", -1, 2]
      simplify  = -3
    `));

  test('1+\\infty', () =>
    expect(check('1+\\infty')).toMatchInlineSnapshot(`
      box       = ["Add", 1, "PositiveInfinity"]
      simplify  = PositiveInfinity
    `));
});

describe('OPERATOR invisible', () => {
  test('2^{3}4+5 // Invisible operator', () =>
    expect(check('2^{3}4+5')).toMatchInlineSnapshot(`
      box       = ["Add", ["InvisibleOperator", ["Power", 2, 3], 4], 5]
      canonical = ["Add", ["Multiply", 4, ["Power", 2, 3]], 5]
      simplify  = 37
    `));

  test('2xyz // Invisible operator', () =>
    expect(check('2xyz')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, "x", "y", "z"]
      canonical = ["Multiply", 2, "x", "y", "z"]
    `));
  test('x2z // Invisible operator', () =>
    expect(check('x2z')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "x", 2, "z"]
      canonical = ["Multiply", 2, "x", "z"]
    `));

  test('2(xyz) // Invisible operator', () =>
    expect(check('2(xyz)')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        2,
        ["Delimiter", ["InvisibleOperator", "x", "y", "z"]]
      ]
      canonical = ["Multiply", 2, "x", "y", "z"]
    `));

  test('q(2q) // Invisible operator as multiply', () =>
    expect(check('q(2q)')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        "q",
        ["Delimiter", ["InvisibleOperator", 2, "q"]]
      ]
      canonical = ["Multiply", 2, "q", "q"]
      evaluate  = ["Multiply", 2, ["Square", "q"]]
    `));

  test('f(2q) // Invisible operator as a function', () =>
    expect(check('f(2q)')).toMatchInlineSnapshot(`
      box       = ["f", ["InvisibleOperator", 2, "q"]]
      canonical = ["f", ["Multiply", 2, "q"]]
    `));

  test('(abc)(xyz) // Invisible operator', () =>
    expect(check('(abc)(xyz)')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        ["Delimiter", ["InvisibleOperator", "a", "b", "c"]],
        ["Delimiter", ["InvisibleOperator", "x", "y", "z"]]
      ]
      canonical = ["Multiply", "a", "b", "c", "x", "y", "z"]
    `));
  test('2\\frac{1}{4} // Invisible PLUS operator', () =>
    expect(check('2\\frac{1}{4}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, ["Divide", 1, 4]]
      canonical = ["Add", 2, ["Rational", 1, 4]]
      simplify  = ["Rational", 9, 4]
      N-auto    = 2.25
    `));
  test('2\\frac{a}{b} // Invisible MULTIPLY operator', () =>
    expect(check('2\\frac{a}{b}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, ["Divide", "a", "b"]]
      canonical = ["Divide", ["Multiply", 2, "a"], "b"]
    `));
});

describe('OPERATOR prefix', () => {
  test('-1 // Negate', () => expect(check('-1')).toMatchInlineSnapshot(`-1`));
  test('-x // Negate', () =>
    expect(check('-x')).toMatchInlineSnapshot(`["Negate", "x"]`));
  test('-x-1 // Negate', () =>
    expect(check('-x-1')).toMatchInlineSnapshot(`
      box       = ["Add", ["Negate", "x"], -1]
      canonical = ["Subtract", -1, "x"]
    `));
  test('-x+1 // Negate', () =>
    expect(check('-x+1')).toMatchInlineSnapshot(`
      box       = ["Add", ["Negate", "x"], 1]
      canonical = ["Subtract", 1, "x"]
    `));
  test('-ab // Negate', () =>
    expect(check('-ab')).toMatchInlineSnapshot(`
      box       = ["Negate", ["InvisibleOperator", "a", "b"]]
      canonical = ["Negate", ["Multiply", "a", "b"]]
    `));
  test('-(ab) // Negate', () =>
    expect(check('-(ab)')).toMatchInlineSnapshot(`
      box       = ["Negate", ["Delimiter", ["InvisibleOperator", "a", "b"]]]
      canonical = ["Negate", ["Multiply", "a", "b"]]
    `));
  test('--x // Predecrement', () =>
    expect(check('--x')).toMatchInlineSnapshot(`
      box       = ["Negate", ["Negate", "x"]]
      canonical = x
    `));
  test('-(-x) // Negate', () =>
    expect(check('-(-x)')).toMatchInlineSnapshot(`
      box       = ["Negate", ["Delimiter", ["Negate", "x"]]]
      canonical = x
    `));
  test('-i // Negate', () =>
    expect(check('-i')).toMatchInlineSnapshot(`
      box       = ["Negate", "i"]
      canonical = ["Negate", "ImaginaryUnit"]
      evaluate  = ["Complex", 0, -1]
      eval-big  = NaN
      eval-mach = NaN
      eval-cplx = ["Complex", 0, -1]
    `));
  test('-\\infty // Negate', () =>
    expect(check('-\\infty')).toMatchInlineSnapshot(`NegativeInfinity`));

  test('+1 // Infix plus', () =>
    expect(check('+1')).toMatchInlineSnapshot(`1`));
  test('+x // Infix plus', () =>
    expect(check('+x')).toMatchInlineSnapshot(`x`));
  test('+i // Infix plus', () =>
    expect(check('+i')).toMatchInlineSnapshot(`
      box       = i
      canonical = ImaginaryUnit
      evaluate  = ["Complex", 0, 1]
      eval-big  = NaN
      eval-mach = NaN
      eval-cplx = ["Complex", 0, 1]
    `));
  test('+\\infty // Infix plus', () =>
    expect(check('+\\infty')).toMatchInlineSnapshot(`PositiveInfinity`));
});

describe('OPERATOR infix', () => {
  test('- // Invalid negate', () =>
    expect(check('-')).toMatchInlineSnapshot(
      `["Negate", ["Error", "'missing'"]]`
    ));
  test('1- // Invalid subtract', () =>
    expect(check('1-')).toMatchInlineSnapshot(
      `["Add", 1, ["Negate", ["Error", "'missing'"]]]`
    ));

  test('-1+2+3-4 // Add', () =>
    expect(check('-1+2+3-4')).toMatchInlineSnapshot(`
      box       = ["Add", -1, 2, 3, -4]
      canonical = ["Add", -4, -1, 2, 3]
      simplify  = 0
    `));
  test('a-b+c+d // Add', () =>
    expect(check('a-b+c+d')).toMatchInlineSnapshot(`
      box       = ["Add", "a", ["Negate", "b"], "c", "d"]
      canonical = ["Add", ["Negate", "b"], "a", "c", "d"]
    `));

  test('-2+3x-4', () =>
    expect(check('-2+3x-4')).toMatchInlineSnapshot(`
      box       = ["Add", -2, ["InvisibleOperator", 3, "x"], -4]
      canonical = ["Add", ["Multiply", 3, "x"], -4, -2]
      simplify  = ["Subtract", ["Multiply", 3, "x"], 6]
    `));
});

describe('OPERATOR multiply', () => {
  test('2\\times-x', () =>
    expect(check('2\\times-x')).toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Negate", "x"]]
      canonical = ["Multiply", -2, "x"]
    `));
  test('2(x+1)', () =>
    expect(check('2(x+1)')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, ["Delimiter", ["Add", "x", 1]]]
      canonical = ["Multiply", 2, ["Add", "x", 1]]
      evaluate  = ["Add", ["Multiply", 2, "x"], 2]
    `));
  test('2\\pi', () =>
    expect(check('2\\pi')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, "Pi"]
      canonical = ["Multiply", 2, "Pi"]
      N-auto    = 6.283185307179586
    `));

  test('2\\sin(x), function apply', () =>
    expect(check('2\\sin(x)')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, ["Sin", "x"]]
      canonical = ["Multiply", 2, ["Sin", "x"]]
    `));
  test('2\\sin(x)\\frac12, function apply', () =>
    expect(check('2\\sin(x)\\frac12')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, ["Sin", "x"], ["Divide", 1, 2]]
      canonical = ["Multiply", "Half", 2, ["Sin", "x"]]
      simplify  = ["Sin", "x"]
    `));
  test('3\\pi5', () =>
    expect(check('3\\pi5')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, "Pi", 5]
      canonical = ["Multiply", 3, 5, "Pi"]
      simplify  = ["Multiply", 15, "Pi"]
      N-auto    = 47.12388980384689
    `));
});

describe('OPERATOR divide', () => {
  test('\\frac12', () =>
    expect(check('\\frac12')).toMatchInlineSnapshot(`
      box       = ["Divide", 1, 2]
      canonical = Half
      N-auto    = 0.5
    `));
  test('\\frac31', () =>
    expect(check('\\frac31')).toMatchInlineSnapshot(`
      box       = ["Divide", 3, 1]
      canonical = 3
    `));
  test('\\frac75', () =>
    expect(check('\\frac75')).toMatchInlineSnapshot(`
      box       = ["Divide", 7, 5]
      canonical = ["Rational", 7, 5]
      N-auto    = 1.4
    `));

  test('\\frac 7 5', () =>
    expect(check('\\frac 7 5')).toMatchInlineSnapshot(`
      box       = ["Divide", 7, 5]
      canonical = ["Rational", 7, 5]
      N-auto    = 1.4
    `));

  test('\\frac    7    5', () =>
    expect(check('\\frac    7    5')).toMatchInlineSnapshot(`
      box       = ["Divide", 7, 5]
      canonical = ["Rational", 7, 5]
      N-auto    = 1.4
    `));

  test('\\frac{10}{5}', () =>
    expect(check('\\frac{10}{5}')).toMatchInlineSnapshot(`
      box       = ["Divide", 10, 5]
      canonical = 2
    `));
  test('\\frac{18}{-3}', () =>
    expect(check('\\frac{18}{-3}')).toMatchInlineSnapshot(`
      box       = ["Divide", 18, -3]
      canonical = -6
    `));
  test('\\frac{-18}{-3}', () =>
    expect(check('\\frac{-18}{-3}')).toMatchInlineSnapshot(`
      box       = ["Divide", -18, -3]
      canonical = 6
    `));
});

describe.skip('OPERATOR partial derivative', () => {
  test('\\partial f', () =>
    expect(check('\\partial f')).toMatchInlineSnapshot());

  test('\\partial_x f', () =>
    expect(check('\\partial_x f')).toMatchInlineSnapshot());

  test('\\partial_x f(x)', () =>
    expect(check('\\partial_x f(x)')).toMatchInlineSnapshot());

  test('\\frac{\\partial f}{\\partial x}', () =>
    expect(check('\\frac{\\partial f}{\\partial x}')).toMatchInlineSnapshot());

  test('\\partial_{x,y} f(x,y)', () =>
    expect(check('\\partial_{x,y} f(x,y)')).toMatchInlineSnapshot());

  test('\\partial^2_{x,y} f(x,y)', () =>
    expect(check('\\partial^2_{x,y} f(x,y)')).toMatchInlineSnapshot());

  test('\\frac{\\partial^2}{\\partial_{x,y}} f(x,y)', () =>
    expect(
      check('\\frac{\\partial^2}{\\partial_{x,y}} f(x,y)')
    ).toMatchInlineSnapshot());

  test('\\frac{\\partial^2 f(x, y, z)}{\\partial_{x,y}}', () =>
    expect(
      check('\\frac{\\partial^2 f(x, y, z)}{\\partial_{x,y}}')
    ).toMatchInlineSnapshot());
});

describe('OPERATOR precedence', () => {
  test('2\\times3+4 // Precedence', () =>
    expect(check('2\\times3+4')).toMatchInlineSnapshot(`
      box       = ["Add", ["Multiply", 2, 3], 4]
      simplify  = 10
    `));
  test('-2\\times-3-4 // Precedence', () =>
    expect(check('-2\\times-3-4')).toMatchInlineSnapshot(`
      box       = ["Add", ["Multiply", -2, -3], -4]
      canonical = ["Subtract", ["Multiply", 2, 3], 4]
      simplify  = 2
    `));

  test('2\\times3^{n+1}+4 // Precedence', () =>
    expect(check('2\\times3^{n+1}+4')).toMatchInlineSnapshot(
      `["Add", ["Multiply", 2, ["Power", 3, ["Add", "n", 1]]], 4]`
    ));
});

describe('OPERATOR postfix', () => {
  test('2+n! // Precedence', () =>
    expect(check('2+n!')).toMatchInlineSnapshot(`
      box       = ["Add", 2, ["Factorial", "n"]]
      canonical = ["Add", ["Factorial", "n"], 2]
    `));
  test('-5!-2 // Precedence', () =>
    expect(check('-2-5!')).toMatchInlineSnapshot(`
      box       = ["Add", -2, ["Factorial", -5]]
      canonical = ["Subtract", -2, ["Factorial", 5]]
      evaluate  = -122
    `));
  test('-5! // Precedence', () =>
    expect(check('-5!')).toMatchInlineSnapshot(`
      box       = ["Factorial", -5]
      canonical = ["Negate", ["Factorial", 5]]
      evaluate  = -120
    `));
  test('-n!', () =>
    expect(check('-n!')).toMatchInlineSnapshot(
      `["Negate", ["Factorial", "n"]]`
    ));
  test('-n!!', () =>
    expect(check('-n!!')).toMatchInlineSnapshot(
      `["Negate", ["Factorial2", "n"]]`
    ));
  test('-n!!!', () =>
    expect(ce.parse('-n!!!')).toMatchInlineSnapshot(
      `["Negate", ["Factorial", ["Factorial2", "n"]]]`
    ));
});

describe('OPERATOR serialize, valid', () => {
  test('1 3/4', () =>
    expect(latex(['Add', 1, ['Divide', 3, 4]])).toMatch('1\\frac{3}{4}'));

  test('1-2', () =>
    expect(latex(['Subtract', 1, 2])).toMatchInlineSnapshot(`1-2`));

  test('1-x', () =>
    expect(latex(['Subtract', 1, 'x'])).toMatchInlineSnapshot(`1-x`));

  test('1-(-2)', () =>
    expect(latex(['Subtract', 1, -2])).toMatchInlineSnapshot(`1+2`));

  test('1-(x+1)', () =>
    expect(latex(['Subtract', 1, ['Add', 'x', 1]])).toMatchInlineSnapshot(
      `-x-1+1`
    ));

  test('1-(2i+1)', () =>
    expect(latex(['Subtract', 1, ['Complex', 1, 2]])).toMatchInlineSnapshot(
      `1+(-1-2\\imaginaryI)`
    ));

  test(`['Multiply', 2, 3]`, () =>
    expect(latex(['Multiply', 2, 3])).toMatchInlineSnapshot(`2\\times3`));

  test(`['Multiply', 2, 3, 4]`, () =>
    expect(latex(['Multiply', 2, 3, 4])).toMatchInlineSnapshot(
      `2\\times3\\times4`
    ));

  test(`['Multiply', ['Divide', 2, 'x'], ['Divide', 'x', 3]]`, () =>
    expect(
      latex(['Multiply', ['Divide', 2, 'x'], ['Divide', 'x', 3]])
    ).toMatchInlineSnapshot(`\\frac{2}{3}`));

  test(`['Multiply', ['Divide', 2, 'x'], ['Power', 'x', -2]]`, () =>
    expect(
      latex(['Multiply', ['Divide', 2, 'x'], ['Power', 'x', -2]])
    ).toMatchInlineSnapshot(`\\frac{2}{x^3}`));

  test(`['Divide', 2, 3]`, () =>
    expect(latex(['Divide', 2, 3])).toMatchInlineSnapshot(`\\frac{2}{3}`));
});

describe('OPERATOR serialize, invalid', () => {
  test('1- // Invalid form', () =>
    expect(latex(['Subtract', 1])).toMatchInlineSnapshot(`1`));

  test(`['Subtract', null] // Invalid form`, () =>
    expect(
      latex(['Subtract', null as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}`));
  test(`['Subtract', undefined] // Invalid form`, () =>
    expect(
      latex(['Subtract', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}`));
  test(`['Subtract', 1] // Invalid form`, () =>
    expect(latex(['Subtract', 1])).toMatchInlineSnapshot(`1`));
  test(`['Subtract', 1, 2, 3] // Invalid form`, () =>
    expect(latex(['Subtract', 1])).toMatchInlineSnapshot(`1`));

  test(`['Multiply', null] // Invalid form`, () =>
    expect(
      latex(['Multiply', null as unknown as Expression])
    ).toMatchInlineSnapshot(`1`));
  test(`['Multiply', undefined] // Invalid form`, () =>
    expect(
      latex(['Multiply', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`1`));
  test(`['Multiply', 1] // Invalid form`, () =>
    expect(latex(['Multiply', 1])).toMatchInlineSnapshot(`1`));
  test(`['Multiply', 'NaN'] // Invalid form`, () =>
    expect(latex(['Multiply', 'NaN'])).toMatchInlineSnapshot(
      `\\operatorname{NaN}`
    ));
  test(`['Multiply', 1] // Invalid form`, () =>
    expect(latex(['Multiply', 'Infinity'])).toMatchInlineSnapshot(`\\infty`));

  test(`['Divide'] // Invalid form`, () =>
    expect(latex(['Divide'])).toMatchInlineSnapshot(`\\error{\\blacksquare}`));

  test(`['Divide', 2] // Invalid form`, () =>
    expect(latex(['Divide', 2])).toMatchInlineSnapshot(`2`));

  test(`['Divide', 2, 3, 4] // Invalid form`, () =>
    expect(latex(['Divide', 2, 3, 4])).toMatchInlineSnapshot(`\\frac{1}{6}`));

  test(`['Divide', null] // Invalid form`, () =>
    expect(
      latex(['Divide', null as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}`));

  test(`['Divide, undefined'] // Invalid form`, () =>
    expect(
      latex(['Divide', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}`));

  test(`['Divide', NaN] // Invalid form`, () =>
    expect(latex(['Divide', NaN])).toMatchInlineSnapshot(
      `\\operatorname{NaN}`
    ));
});
