import { Expression } from '../../../src/math-json/math-json-format';
import { parse, latex, check } from '../../utils';

describe('OPERATOR oprel', () => {
  test('x=1', () =>
    expect(check('x=1')).toMatchInlineSnapshot(`
      latex     = ["Equal", "x", 1]
      box       = ["Equal", "x", 1]
      evaluate  = False
    `));
  test('x=1+1', () =>
    expect(check('x=1+1')).toMatchInlineSnapshot(`
      latex     = ["Equal", "x", ["Add", 1, 1]]
      box       = ["Equal", "x", ["Add", 1, 1]]
      simplify  = ["Equal", "x", 2]
      evaluate  = False
    `));
  test('x+y=1+1', () =>
    expect(check('x+y=1+1')).toMatchInlineSnapshot(`
      latex     = ["Equal", ["Add", "x", "y"], ["Add", 1, 1]]
      box       = ["Equal", ["Add", "x", "y"], ["Add", 1, 1]]
      simplify  = ["Equal", ["Add", "x", "y"], 2]
      evaluate  = False
    `));

  test('x<1', () =>
    expect(check('x<1')).toMatchInlineSnapshot(`
      latex     = ["Less", "x", 1]
      ["Less", "x", 1]
    `));
  test('x<1+1', () =>
    expect(check('x<1+1')).toMatchInlineSnapshot(`
      latex     = ["Less", "x", ["Add", 1, 1]]
      box       = ["Less", "x", ["Add", 1, 1]]
      simplify  = ["Less", "x", 2]
    `));
  test('x+y<1+1', () =>
    expect(check('x+y<1+1')).toMatchInlineSnapshot(`
      latex     = ["Less", ["Add", "x", "y"], ["Add", 1, 1]]
      box       = ["Less", ["Add", "x", "y"], ["Add", 1, 1]]
      simplify  = ["Less", ["Add", "x", "y"], 2]
    `));

  test('x>=1', () =>
    expect(check('x>=1')).toMatchInlineSnapshot(`
      latex     = ["GreaterEqual", "x", 1]
      ["LessEqual", 1, "x"]
    `));
  test('x>=1+1', () =>
    expect(check('x>=1+1')).toMatchInlineSnapshot(`
      latex     = ["GreaterEqual", "x", ["Add", 1, 1]]
      box       = ["LessEqual", ["Add", 1, 1], "x"]
      simplify  = ["LessEqual", 2, "x"]
    `));
  test('x+y>=1+1', () =>
    expect(check('x+y>=1+1')).toMatchInlineSnapshot(`
      latex     = ["GreaterEqual", ["Add", "x", "y"], ["Add", 1, 1]]
      box       = ["LessEqual", ["Add", 1, 1], ["Add", "x", "y"]]
      simplify  = ["LessEqual", 2, ["Add", "x", "y"]]
    `));
});

describe('OPERATOR add/subtract', () => {
  test('1+2', () =>
    expect(check('1+2')).toMatchInlineSnapshot(`
      latex     = ["Add", 1, 2]
      box       = ["Add", 1, 2]
      simplify  = 3
    `));

  test('1+2+3', () =>
    expect(check('1+2+3')).toMatchInlineSnapshot(`
      latex     = ["Add", 1, 2, 3]
      box       = ["Add", 1, 2, 3]
      simplify  = 6
    `));

  test('1+(2+3)', () =>
    expect(check('1+(2+3)')).toMatchInlineSnapshot(`
      latex     = ["Add", 1, ["Delimiter", ["Add", 2, 3]]]
      box       = ["Add", 1, 2, 3]
      simplify  = 6
    `));

  test('1-2', () =>
    expect(check('1-2')).toMatchInlineSnapshot(`
      latex     = ["Subtract", 1, 2]
      box       = ["Subtract", 1, 2]
      simplify  = -1
    `));

  test('-1-2', () =>
    expect(check('-1-2')).toMatchInlineSnapshot(`
      latex     = ["Subtract", -1, 2]
      box       = ["Subtract", -1, 2]
      simplify  = -3
    `));

  test('1+\\infty', () =>
    expect(check('1+\\infty')).toMatchInlineSnapshot(`
      latex     = ["Add", 1, {num: "+Infinity"}]
      box       = ["Add", 1, {num: "+Infinity"}]
      simplify  = {num: "+Infinity"}
    `));
});

describe('OPERATOR invisible', () => {
  test('2^{3}4+5 // Invisible operator', () =>
    expect(check('2^{3}4+5')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Multiply", ["Power", 2, 3], 4], 5]
      box       = ["Add", 5, 32]
      simplify  = 37
    `));

  test('2xyz // Invisible operator', () =>
    expect(check('2xyz')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, "x", "y", "z"]
      ["Multiply", 2, "x", "y", "z"]
    `));
  test('x2z // Invisible operator', () =>
    expect(check('x2z')).toMatchInlineSnapshot(`
      latex     = ["Multiply", "x", 2, "z"]
      ["Multiply", 2, "x", "z"]
    `));

  test('2(xyz) // Invisible operator', () =>
    expect(check('2(xyz)')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Delimiter", ["Multiply", "x", "y", "z"]]]
      ["Multiply", 2, "x", "y", "z"]
    `));
  test('(abc)(xyz) // Invisible operator', () =>
    expect(check('(abc)(xyz)')).toMatchInlineSnapshot(`
      latex     = [
        "Multiply",
        ["Delimiter", ["Multiply", "a", "b", "c"]],
        ["Delimiter", ["Multiply", "x", "y", "z"]]
      ]
      ["Multiply", "a", "b", "c", "x", "y", "z"]
    `));
  test('2\\frac{1}{4} // Invisible PLUS operator', () =>
    expect(check('2\\frac{1}{4}')).toMatchInlineSnapshot(`
      latex     = ["Add", 2, ["Divide", 1, 4]]
      box       = ["Add", ["Rational", 1, 4], 2]
      simplify  = ["Rational", 9, 4]
      N-auto    = 2.25
    `));
  test('2\\frac{a}{b} // Invisible MULTIPLY operator', () =>
    expect(check('2\\frac{a}{b}')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Divide", "a", "b"]]
      ["Divide", ["Multiply", 2, "a"], "b"]
    `));
});

describe('OPERATOR prefix', () => {
  test('-1 // Negate', () =>
    expect(check('-1')).toMatchInlineSnapshot(`
      latex     = -1
      -1
    `));
  test('-x // Negate', () =>
    expect(check('-x')).toMatchInlineSnapshot(`
      latex     = ["Negate", "x"]
      ["Negate", "x"]
    `));
  test('-x-1 // Negate', () =>
    expect(check('-x-1')).toMatchInlineSnapshot(`
      latex     = ["Subtract", ["Negate", "x"], 1]
      ["Subtract", -1, "x"]
    `));
  test('-x+1 // Negate', () =>
    expect(check('-x+1')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Negate", "x"], 1]
      ["Subtract", 1, "x"]
    `));
  test('-ab // Negate', () =>
    expect(check('-ab')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Multiply", "a", "b"]]
      ["Negate", ["Multiply", "a", "b"]]
    `));
  test('-(ab) // Negate', () =>
    expect(check('-(ab)')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Delimiter", ["Multiply", "a", "b"]]]
      ["Negate", ["Multiply", "a", "b"]]
    `));
  test('--x // Predecrement', () =>
    expect(check('--x')).toMatchInlineSnapshot(`
      latex     = ["PreDecrement", "x"]
      ["PreDecrement", "x"]
    `));
  test('-(-x) // Negate', () =>
    expect(check('-(-x)')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Delimiter", ["Negate", "x"]]]
      x
    `));
  test('-i // Negate', () =>
    expect(check('-i')).toMatchInlineSnapshot(`
      latex     = ["Negate", "i"]
      box       = ["Negate", "ImaginaryUnit"]
      evaluate  = ["Complex", 0, -1]
      eval-big  = {num: "NaN"}
      eval-mach = {num: "NaN"}
      eval-cplx = ["Complex", 0, -1]
    `));
  test('-\\infty // Negate', () =>
    expect(check('-\\infty')).toMatchInlineSnapshot(`
      latex     = {num: "-Infinity"}
      {num: "-Infinity"}
    `));

  test('+1 // Infix plus', () =>
    expect(check('+1')).toMatchInlineSnapshot(`
      latex     = 1
      1
    `));
  test('+x // Infix plus', () =>
    expect(check('+x')).toMatchInlineSnapshot(`
      latex     = x
      x
    `));
  test('+i // Infix plus', () =>
    expect(check('+i')).toMatchInlineSnapshot(`
      latex     = i
      box       = ImaginaryUnit
      evaluate  = ["Complex", 0, 1]
      eval-big  = {num: "NaN"}
      eval-mach = {num: "NaN"}
      eval-cplx = ["Complex", 0, 1]
    `));
  test('+\\infty // Infix plus', () =>
    expect(check('+\\infty')).toMatchInlineSnapshot(`
      latex     = {num: "+Infinity"}
      {num: "+Infinity"}
    `));
});

describe('OPERATOR infix', () => {
  test('- // Invalid negate', () =>
    expect(check('-')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Error", "'missing'"]]
      ["Negate", ["Error", "'missing'"]]
    `));
  test('1- // Invalid subtract', () =>
    expect(check('1-')).toMatchInlineSnapshot(`
      latex     = ["Subtract", 1, ["Error", "'missing'"]]
      ["Subtract", 1, ["Error", "'missing'"]]
    `));

  test('-1+2+3-4 // Add', () =>
    expect(check('-1+2+3-4')).toMatchInlineSnapshot(`
      latex     = ["Add", -1, 2, ["Subtract", 3, 4]]
      box       = ["Add", -4, -1, 2, 3]
      simplify  = 0
    `));
  test('a-b+c+d // Add', () =>
    expect(check('a-b+c+d')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Subtract", "a", "b"], "c", "d"]
      ["Add", ["Negate", "b"], "a", "c", "d"]
    `));

  test('-2+3x-4', () =>
    expect(check('-2+3x-4')).toMatchInlineSnapshot(`
      latex     = ["Add", -2, ["Subtract", ["Multiply", 3, "x"], 4]]
      box       = ["Add", ["Multiply", 3, "x"], -4, -2]
      simplify  = ["Subtract", ["Multiply", 3, "x"], 6]
    `));
});

describe('OPERATOR multiply', () => {
  test('2\\times-x', () =>
    expect(check('2\\times-x')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Negate", "x"]]
      ["Multiply", -2, "x"]
    `));
  test('2(x+1)', () =>
    expect(check('2(x+1)')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Delimiter", ["Add", "x", 1]]]
      box       = ["Multiply", 2, ["Add", "x", 1]]
      simplify  = ["Add", ["Multiply", 2, "x"], 2]
      evaluate  = ["Multiply", 2, ["Add", "x", 1]]
    `));
  test('2\\pi', () =>
    expect(check('2\\pi')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, "Pi"]
      box       = ["Multiply", 2, "Pi"]
      N-auto    = 6.283185307179586476925286766559005768394338798750211641949889184615632812572417997256069650684234136
      N-mach    = 6.283185307179586
    `));

  test('2\\sin(x), function apply', () =>
    expect(check('2\\sin(x)')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Sin", "x"]]
      ["Multiply", 2, ["Sin", "x"]]
    `));
  test('2\\sin(x)\\frac12, function apply', () =>
    expect(check('2\\sin(x)\\frac12')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Sin", "x"], "Half"]
      ["Sin", "x"]
    `));
  test('3\\pi5', () =>
    expect(check('3\\pi5')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 3, "Pi", 5]
      box       = ["Multiply", 15, "Pi"]
      N-auto    = 47.12388980384689857693965074919254326295754099062658731462416888461724609429313497942052238013175602
      N-mach    = 47.12388980384689
    `));
});

describe('OPERATOR divide', () => {
  test('\\frac12', () =>
    expect(check('\\frac12')).toMatchInlineSnapshot(`
      latex     = Half
      box       = Half
      N-auto    = 0.5
    `));
  test('\\frac31', () =>
    expect(check('\\frac31')).toMatchInlineSnapshot(`
      latex     = ["Divide", 3, 1]
      3
    `));
  test('\\frac75', () =>
    expect(check('\\frac75')).toMatchInlineSnapshot(`
      latex     = ["Divide", 7, 5]
      box       = ["Rational", 7, 5]
      N-auto    = 1.4
    `));
  test('\\frac{10}{5}', () =>
    expect(check('\\frac{10}{5}')).toMatchInlineSnapshot(`
      latex     = ["Divide", 10, 5]
      2
    `));
  test('\\frac{18}{-3}', () =>
    expect(check('\\frac{18}{-3}')).toMatchInlineSnapshot(`
      latex     = ["Divide", 18, -3]
      -6
    `));
  test('\\frac{-18}{-3}', () =>
    expect(check('\\frac{-18}{-3}')).toMatchInlineSnapshot(`
      latex     = ["Divide", -18, -3]
      6
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
      latex     = ["Add", ["Multiply", 2, 3], 4]
      box       = ["Add", 4, 6]
      simplify  = 10
    `));
  test('-2\\times-3-4 // Precedence', () =>
    expect(check('-2\\times-3-4')).toMatchInlineSnapshot(`
      latex     = ["Subtract", ["Multiply", -2, -3], 4]
      box       = ["Subtract", 6, 4]
      simplify  = 2
    `));

  test('2\\times3^{n+1}+4 // Precedence', () =>
    expect(check('2\\times3^{n+1}+4')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Multiply", 2, ["Power", 3, ["Add", "n", 1]]], 4]
      ["Add", ["Multiply", 2, ["Power", 3, ["Add", "n", 1]]], 4]
    `));
});

describe('OPERATOR postfix', () => {
  test('2+n! // Precedence', () =>
    expect(check('2+n!')).toMatchInlineSnapshot(`
      latex     = ["Add", 2, ["Factorial", "n"]]
      ["Add", ["Factorial", "n"], 2]
    `));
  test('-5!-2 // Precedence', () =>
    expect(check('-2-5!')).toMatchInlineSnapshot(`
      latex     = ["Subtract", -2, ["Factorial", 5]]
      box       = ["Subtract", -2, ["Factorial", 5]]
      evaluate  = -122
    `));
  test('-5! // Precedence', () =>
    expect(check('-5!')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Factorial", 5]]
      box       = ["Negate", ["Factorial", 5]]
      evaluate  = -120
    `));
  test('-n!', () =>
    expect(check('-n!')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Factorial", "n"]]
      ["Negate", ["Factorial", "n"]]
    `));
  test('-n!!', () =>
    expect(check('-n!')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Factorial", "n"]]
      ["Negate", ["Factorial", "n"]]
    `));
  test('-n!!!', () =>
    expect(parse('-n!')).toMatchInlineSnapshot(
      `["Negate", ["Factorial", "n"]]`
    ));
});

describe('OPERATOR serialize, valid', () => {
  test('1 3/4', () =>
    expect(latex(['Add', 1, ['Divide', 3, 4]])).toMatch('1\\frac{3}{4}'));

  test('1-2', () =>
    expect(latex(['Subtract', 1, 2])).toMatchInlineSnapshot(`1-2`));

  test('1-(-2)', () =>
    expect(latex(['Subtract', 1, -2])).toMatchInlineSnapshot(`1+2`));

  test(`['Multiply', 2, 3]`, () =>
    expect(latex(['Multiply', 2, 3])).toMatchInlineSnapshot(`6`));

  test(`['Multiply', 2, 3, 4]`, () =>
    expect(latex(['Multiply', 2, 3, 4])).toMatchInlineSnapshot(`24`));

  test(`['Multiply', ['Divide', 2, 'x'], ['Divide', 'x', 3]]`, () =>
    expect(
      latex(['Multiply', ['Divide', 2, 'x'], ['Divide', 'x', 3]])
    ).toMatchInlineSnapshot(`\\frac{2}{3}`));

  test(`['Multiply', ['Divide', 2, 'x'], ['Power', 'x', -2]]`, () =>
    expect(
      latex(['Multiply', ['Divide', 2, 'x'], ['Power', 'x', -2]])
    ).toMatchInlineSnapshot(`\\frac{2}{x^{3}}`));

  test(`['Divide', 2, 3]`, () =>
    expect(latex(['Divide', 2, 3])).toMatchInlineSnapshot(`\\frac{2}{3}`));
});

describe('OPERATOR serialize, invalid', () => {
  test('1- // Invalid form', () =>
    expect(latex(['Subtract', 1])).toMatchInlineSnapshot(`-1`));

  test(`['Subtract', null] // Invalid form`, () =>
    expect(
      latex(['Subtract', null as unknown as Expression])
    ).toMatchInlineSnapshot(`-\\mathrm{Nothing}`));
  test(`['Subtract', undefined] // Invalid form`, () =>
    expect(
      latex(['Subtract', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`-\\mathrm{Nothing}`));
  test(`['Subtract', 1] // Invalid form`, () =>
    expect(latex(['Subtract', 1])).toMatchInlineSnapshot(`-1`));
  test(`['Subtract', 1, 2, 3] // Invalid form`, () =>
    expect(latex(['Subtract', 1])).toMatchInlineSnapshot(`-1`));

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
    expect(latex(['Divide'])).toMatchInlineSnapshot(
      `\\frac{\\error{\\blacksquare}}{\\error{\\blacksquare}}`
    ));

  test(`['Divide', 2] // Invalid form`, () =>
    expect(latex(['Divide', 2])).toMatchInlineSnapshot(
      `\\frac{2}{\\error{\\blacksquare}}`
    ));

  test(`['Divide', 2, 3, 4] // Invalid form`, () =>
    expect(latex(['Divide', 2, 3, 4])).toMatchInlineSnapshot(`\\frac{2}{3}`));

  test(`['Divide', null] // Invalid form`, () =>
    expect(
      latex(['Divide', null as unknown as Expression])
    ).toMatchInlineSnapshot(
      `\\frac{\\error{\\blacksquare}}{\\error{\\blacksquare}}`
    ));

  test(`['Divide, undefined'] // Invalid form`, () =>
    expect(
      latex(['Divide', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(
      `\\frac{\\error{\\blacksquare}}{\\error{\\blacksquare}}`
    ));

  test(`['Divide', NaN] // Invalid form`, () =>
    expect(latex(['Divide', NaN])).toMatchInlineSnapshot(
      `\\frac{\\operatorname{NaN}}{\\error{\\blacksquare}}`
    ));
});
