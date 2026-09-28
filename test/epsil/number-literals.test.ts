import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { validEpsil } from '../utils';

//
// Decimal literals and invisible multiplication (found 2026-09-28 while
// writing the arithmetic reference examples).
//
function payload(source: string): unknown {
  const [ast] = parseEpsil(source);
  return JSON.parse(
    JSON.stringify(ast).replace(/,"sourceOffsets":\[\d+,\d+\]/g, '')
  );
}

function diagnostics(source: string): unknown[] {
  return parseEpsil(source)[1].map((d) => d.message);
}

describe('a decimal literal keeps its value', () => {
  // The fraction digits were summed one float at a time (0.1·7 + 0.01·5), so
  // `0.75` read as `0.7500000000000001`.
  test.each([
    ['0.75', '0.75'],
    ['0.7', '0.7'],
    ['0.3', '0.3'],
    ['0.000001', '0.000001'],
    ['123.456', '123.456'],
    ['1.2000', '1.2'],
    ['-0.75', '-0.75'],
    ['12345678901234567890.5', '12345678901234567890.5'],
  ])('%s', (source, num) => {
    expect(payload(source)).toEqual({ num });
  });
});

describe('a literal with a fraction part is a float', () => {
  // The 0.139.0 rule: the LaTeX `1.0` is the float `1`. The normalized text
  // keeps a decimal point, so Epsil agrees.
  test.each([
    ['1.0', '1.0'],
    ['2.0', '2.0'],
    ['1.5e3', '1500.0'],
    ['0.0', '0.0'],
  ])('%s', (source, num) => {
    expect(payload(source)).toEqual({ num });
    const value = executeEpsil(new ComputeEngine(), source).value;
    expect((value as { isExact?: boolean }).isExact).toBe(false);
  });

  test('an integer, with or without an exponent, stays exact', () => {
    expect(payload('3')).toEqual({ num: '3' });
    expect(payload('1e3')).toEqual({ num: '1000' });
    expect(payload('1e21')).toEqual({ num: '1e21' });
  });

  test('a trailing point with no digit is not a fraction part', () => {
    // `2.` is the exact `2`, as `1500.` is in LaTeX.
    expect(payload('2.')).toEqual({ num: '2' });
    expect(payload('0x2.')).toEqual({ num: '2' });
  });

  test('the fraction digits are read after separators and in fullwidth', () => {
    expect(payload('2._0')).toEqual({ num: '2.0' });
    expect(payload('0x2.０')).toEqual({ num: '2.0' });
    expect(payload('0x1.8p1')).toEqual({ num: '3.0' });
  });

  test('an exponent after a fraction part keeps the point', () => {
    expect(payload('1.0e21')).toEqual({ num: '1.0e21' });
    expect(payload('1.5e30')).toEqual({ num: '1.5e30' });
  });

  test('a literal a double cannot hold keeps its digits', () => {
    // An underflow to 0 and a subnormal lost the literal's value.
    expect(payload('1e-400')).toEqual({ num: '1e-400' });
    expect(payload('1.0e-400')).toEqual({ num: '1.0e-400' });
    expect(payload('5e-324')).toEqual({ num: '5e-324' });
    expect(payload('1e400')).toEqual({ num: '1e400' });
  });
});

describe('invisible multiplication after an explicit * or /', () => {
  // The right operand of `*` and `/` refused an invisible multiplication:
  // `a * 2n` parsed as `a * 2` and reported the `n`.
  test.each([
    ['a * 2n', ['Multiply', 'a', ['Multiply', 2, 'n']]],
    ['a / 2n', ['Divide', 'a', ['Multiply', 2, 'n']]],
    ['a * 3x^2', ['Multiply', 'a', ['Multiply', 3, ['Power', 'x', 2]]]],
    ['a * 2(x + 1)', ['Multiply', 'a', ['Multiply', 2, ['Add', 'x', 1]]]],
  ])('%s', (source, expected) => {
    expect(diagnostics(source)).toEqual([]);
    expect(validEpsil(source)).toStrictEqual(expected);
  });

  test('the product evaluates', () => {
    const r = executeEpsil(new ComputeEngine(), 'let a = 3\nlet n = 5\na * 2n');
    expect(r.value.toString()).toBe('30');
  });

  test('a chain of coefficients stays left-nested, and ^ still refuses', () => {
    expect(diagnostics('2√3x')).toEqual([]);
    expect(diagnostics('2^2x')).toEqual([['unexpected-symbol', 'x']]);
    expect(diagnostics('a * 2 n')).toEqual([['unexpected-symbol', 'n']]);
  });
});
