import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// `evaluate()` returns the most exact form (the exactness contract in
// CLAUDE.md, "Evaluate vs. N"). Two cases broke it:
//
// 1. A product of a radical and a complex value. `√2·(1 + i)` evaluated to
//    the float `1.414… + 1.414…i`. An exact literal now holds one radical
//    times a Gaussian rational (`√2·(1 + i)`, serialized as
//    `["Complex", ["Sqrt", 2], ["Sqrt", 2]]`), so the product is one exact
//    literal. A value with two different radicals, such as `1 + √2·i`, is
//    still a sum of two exact literals.
//
// 2. The modulus of a constant complex value whose squared modulus is not a
//    number literal. `|π·i|` stayed unevaluated because `π²` is not a
//    number literal. It is now `π`.
//
// Every exact result is compared with `.N()` of the input to 12 digits.

const ce = new ComputeEngine();

function expectSameValue(exact: Expression, input: Expression): void {
  const a = exact.N();
  const b = input.N();
  expect(Math.abs(a.re - b.re)).toBeLessThan(1e-12 * (1 + Math.abs(b.re)));
  expect(Math.abs(a.im - b.im)).toBeLessThan(1e-12 * (1 + Math.abs(b.im)));
}

function check(input: Expression): string {
  const result = input.evaluate();
  expectSameValue(result, input);
  return JSON.stringify(result.json);
}

const box = (x: any) => check(ce.box(x));
const parse = (s: string) => check(ce.parse(s));

describe('EXACT PRODUCT OF A RADICAL AND A COMPLEX VALUE', () => {
  test('√2·(1 + i), box route', () =>
    expect(box(['Multiply', ['Sqrt', 2], ['Complex', 1, 1]])).toBe(
      '["Complex",["Sqrt",2],["Sqrt",2]]'
    ));

  test('√2·(1 + i), parse route', () =>
    expect(parse('\\sqrt{2}(1+\\imaginaryI)')).toBe(
      '["Complex",["Sqrt",2],["Sqrt",2]]'
    ));

  test('the result has the form of 1 + √2·i', () =>
    expect(parse('1+\\sqrt{2}\\imaginaryI')).toBe(
      '["Add",1,["Complex",0,["Sqrt",2]]]'
    ));

  test('√2·i stays one exact literal', () =>
    expect(box(['Multiply', ['Sqrt', 2], 'ImaginaryUnit'])).toBe(
      '["Complex",0,["Sqrt",2]]'
    ));

  test('(1/3)(2 + 3i) stays one exact literal', () =>
    expect(box(['Multiply', ['Rational', 1, 3], ['Complex', 2, 3]])).toBe(
      '["Complex",["Rational",2,3],1]'
    ));

  test('π(1 + i) stays a symbolic product', () =>
    expect(box(['Multiply', 'Pi', ['Complex', 1, 1]])).toBe(
      '["Multiply",["Complex",1,1],"Pi"]'
    ));

  test('(1 + i)√3 + 1, box route', () =>
    expect(box(['Add', ['Multiply', ['Complex', 1, 1], ['Sqrt', 3]], 1])).toBe(
      '["Add",1,["Complex",["Sqrt",3],["Sqrt",3]]]'
    ));

  test('(1 + i)√3 + 1, parse route', () =>
    expect(parse('(1+\\imaginaryI)\\sqrt{3}+1')).toBe(
      '["Add",1,["Complex",["Sqrt",3],["Sqrt",3]]]'
    ));

  test('a pure-imaginary radical times a Gaussian integer', () =>
    // (1 + i)·√2·i = −√2 + √2·i
    expect(
      box(['Multiply', ['Complex', 0, ['Sqrt', 2]], ['Complex', 1, 1]])
    ).toBe('["Complex",["Negate",["Sqrt",2]],["Sqrt",2]]'));

  test('several radicals and Gaussian integers', () =>
    // √3·(1 + i)·√2·(2 − i) = √6·(3 + i) = 3√6 + √6·i
    expect(parse('\\sqrt{3}(1+\\imaginaryI)\\sqrt{2}(2-\\imaginaryI)')).toBe(
      '["Complex",["Multiply",3,["Sqrt",6]],["Sqrt",6]]'
    ));

  test('a product that one exact literal can hold folds to it', () =>
    // √2·(1 + i)·(1 − i) = 2√2
    expect(parse('\\sqrt{2}(1+\\imaginaryI)(1-\\imaginaryI)')).toBe(
      '["Multiply",2,["Sqrt",2]]'
    ));

  test('a symbolic factor keeps the product factored and exact', () =>
    expect(
      JSON.stringify(ce.parse('\\sqrt{2}(1+\\imaginaryI)x').evaluate().json)
    ).toBe('["Multiply",["Complex",["Sqrt",2],["Sqrt",2]],"x"]'));

  test('(1 + i)/√2', () =>
    expect(box(['Divide', ['Complex', 1, 1], ['Sqrt', 2]])).toBe(
      '["Complex",["Divide",["Sqrt",2],2],["Divide",["Sqrt",2],2]]'
    ));

  test('√2/(1 + i)', () =>
    expect(box(['Divide', ['Sqrt', 2], ['Complex', 1, 1]])).toBe(
      '["Complex",["Divide",["Sqrt",2],2],["Negate",["Divide",["Sqrt",2],2]]]'
    ));

  test('.N() gives the float', () =>
    expect(ce.parse('\\sqrt{2}(1+\\imaginaryI)').N().toString()).toBe(
      '(1.414213562373095048801689 + 1.4142135623730951i)'
    ));

  test('an inexact factor makes the product a float', () =>
    expect(box(['Multiply', 1.5, ['Complex', 1, 1]])).toBe(
      '["Complex",1.5,1.5]'
    ));

  test('an inexact factor beside a radical makes the product a float', () =>
    expect(parse('\\sqrt{2}(1+\\imaginaryI)\\cdot 0.5')).toBe(
      '["Complex",{"num":"0.7071067811865475244008445"},0.7071067811865476]'
    ));
});

describe('EXACT MODULUS OF A CONSTANT COMPLEX VALUE', () => {
  test('|π·i|, box route', () =>
    expect(box(['Abs', ['Multiply', 'Pi', 'ImaginaryUnit']])).toBe('"Pi"'));

  test('|π·i|, parse route', () =>
    expect(parse('|\\pi\\imaginaryI|')).toBe('"Pi"'));

  test('|−π·i|', () =>
    expect(box(['Abs', ['Multiply', ['Complex', 0, -1], 'Pi']])).toBe('"Pi"'));

  test('|π(1 + i)|', () =>
    expect(box(['Abs', ['Multiply', 'Pi', ['Complex', 1, 1]]])).toBe(
      '["Multiply",["Sqrt",2],"Pi"]'
    ));

  test('|π + π·i|', () =>
    expect(parse('|\\pi+\\pi\\imaginaryI|')).toBe(
      '["Multiply",["Sqrt",2],"Pi"]'
    ));

  test('|e + π·i|', () =>
    expect(
      box(['Abs', ['Add', 'ExponentialE', ['Multiply', 'Pi', 'ImaginaryUnit']]])
    ).toBe('["Sqrt",["Add",["Power","ExponentialE",2],["Power","Pi",2]]]'));

  test('|√π·i|', () =>
    expect(parse('|\\sqrt{\\pi}\\imaginaryI|')).toBe('["Sqrt","Pi"]'));

  test('|x·i| stays unevaluated: evaluate() does not take factors out', () =>
    expect(JSON.stringify(ce.parse('|x\\imaginaryI|').evaluate().json)).toBe(
      '["Abs",["Multiply",["Complex",0,1],"x"]]'
    ));

  test('the modulus of a Gaussian integer is unchanged', () =>
    expect(box(['Abs', ['Complex', 1, 1]])).toBe('["Sqrt",2]'));

  test('.N() gives the float', () =>
    expect(ce.parse('|\\pi\\imaginaryI|').N().toString()).toBe(
      '3.141592653589793'
    ));

  test('an inexact factor makes the modulus a float', () =>
    expect(box(['Abs', ['Multiply', 1.5, 'Pi', 'ImaginaryUnit']])).toBe(
      '4.71238898038469'
    ));
});
