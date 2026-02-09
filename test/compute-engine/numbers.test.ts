import { Expression } from '../../src/math-json/types.ts';
import type { BoxedExpression } from '../../src/compute-engine/global-types.ts';
import { engine as ce } from '../utils';

describe('BOXING OF NUMBER', () => {
  test('Boxing numbers including whitespace', () => {
    expect(
      ce
        .box({ num: '\u00091\u000a2\u000b3\u000c4\u000d5 6\u00a07.2' })
        .numericValue?.toString()
    ).toEqual('1234567.2');
  });

  test('Lenient num argument', () => {
    // num with a numeric value is accepted, although it's technically invalid
    expect(ce.box({ num: 4 } as any as Expression).numericValue).toEqual(4);
  });

  test('Not numbers', () => {
    expect(ce.box(NaN).numericValue).toEqual(NaN);
    expect(ce.box(Infinity).numericValue).toEqual(Infinity);
    // Invalid box
    expect(ce.box({ num: Infinity } as any as Expression).numericValue).toEqual(
      Infinity
    );
    expect(ce.box({ num: 'infinity' }).numericValue).toEqual(Infinity);
  });

  test('Bigints', () => {
    // expect(latex({ num: 12n })).toMatchInlineSnapshot();
    expect(ce.box({ num: '12n' }).numericValue).toEqual(12);
    // 1.873 461 923 786 192 834 612 398 761 298 192 306 423 768 912 387 649 238 476 9... × 10^196
    expect(
      ce.box({
        num: '187346192378619283461239876129819230642376891238764923847000000000000000000000',
      })
    ).toMatchInlineSnapshot(
      `{num: "187346192378619283461239876129819230642376891238764923847e+21"}`
    );

    expect(
      ce.box({
        num: '18734619237861928346123987612981923064237689123876492384769123786412837040123612308964123876412307864012346012837491237864192837641923876419238764123987642198764987162398716239871236912347619238764n',
      })
    ).toMatchInlineSnapshot(`
      {
        num: "18734619237861928346123987612981923064237689123876492384769123786412837040123612308964123876412307864012346012837491237864192837641923876419238764123987642198764987162398716239871236912347619238764"
      }
    `);
  });
});

function checkProps(x: BoxedExpression): string {
  const result: string[] = [];
  result.push('number literal: ' + x.isNumberLiteral);
  result.push('type: ' + x.type.toString());
  result.push('real: ' + x.isReal);
  result.push('rational: ' + x.isRational);
  result.push('integer: ' + x.isInteger);
  result.push('positive (>0): ' + x.isPositive);
  result.push('negative (<0): ' + x.isNegative);
  result.push('nonPositive (<=0): ' + x.isNonPositive);
  result.push('nonNegative (>=0): ' + x.isNonNegative);
  result.push('-1: ' + x.is(-1));
  result.push('0: ' + x.is(0));
  result.push('+1: ' + x.is(1));
  result.push('finite: ' + x.isFinite);
  result.push('infinite: ' + x.isInfinity);
  result.push('nan: ' + x.isNaN);
  result.push('even: ' + x.isEven);
  result.push('odd: ' + x.isOdd);

  return result.join('\n');
}

describe('PROPERTIES OF NUMBERS', () => {
  test('ComplexInfinity is a non-finite-number', () => {
    expect(checkProps(ce.box('ComplexInfinity'))).toMatchInlineSnapshot(`
      number literal: true
      type: complex
      real: false
      rational: false
      integer: false
      positive (>0): undefined
      negative (<0): undefined
      nonPositive (<=0): undefined
      nonNegative (>=0): undefined
      -1: false
      0: false
      +1: false
      finite: false
      infinite: true
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('PositiveInfinity is a non-finite-number', () => {
    expect(checkProps(ce.box('PositiveInfinity'))).toMatchInlineSnapshot(`
      number literal: true
      type: non_finite_number
      real: true
      rational: false
      integer: false
      positive (>0): true
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): true
      -1: false
      0: false
      +1: false
      finite: false
      infinite: true
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('NegativeInfinity is a non-finite-number', () => {
    expect(checkProps(ce.box('NegativeInfinity'))).toMatchInlineSnapshot(`
      number literal: true
      type: non_finite_number
      real: true
      rational: false
      integer: false
      positive (>0): false
      negative (<0): true
      nonPositive (<=0): true
      nonNegative (>=0): false
      -1: false
      0: false
      +1: false
      finite: false
      infinite: true
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('NaN is a non-finite-number', () => {
    expect(checkProps(ce.box('NaN'))).toMatchInlineSnapshot(`
      number literal: true
      type: number
      real: true
      rational: false
      integer: false
      positive (>0): false
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): false
      -1: false
      0: false
      +1: false
      finite: false
      infinite: false
      nan: true
      even: undefined
      odd: undefined
    `);
  });

  test('i is a complex number', () => {
    expect(checkProps(ce.box('i'))).toMatchInlineSnapshot(`
      number literal: true
      type: imaginary
      real: false
      rational: false
      integer: false
      positive (>0): undefined
      negative (<0): undefined
      nonPositive (<=0): undefined
      nonNegative (>=0): undefined
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('ImaginaryUnit is a complex number', () => {
    expect(checkProps(ce.box('ImaginaryUnit'))).toMatchInlineSnapshot(`
      number literal: false
      type: imaginary
      real: false
      rational: false
      integer: false
      positive (>0): undefined
      negative (<0): undefined
      nonPositive (<=0): undefined
      nonNegative (>=0): undefined
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('Complex(0,1) is a complex number', () => {
    expect(checkProps(ce.box(['Complex', 0, 1]))).toMatchInlineSnapshot(`
      number literal: true
      type: imaginary
      real: false
      rational: false
      integer: false
      positive (>0): undefined
      negative (<0): undefined
      nonPositive (<=0): undefined
      nonNegative (>=0): undefined
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('1 is an integer', () => {
    expect(checkProps(ce.number(1))).toMatchInlineSnapshot(`
      number literal: true
      type: finite_integer
      real: true
      rational: true
      integer: true
      positive (>0): true
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): true
      -1: false
      0: false
      +1: true
      finite: true
      infinite: false
      nan: false
      even: false
      odd: true
    `);
  });

  test('Half is a rational', () => {
    expect(checkProps(ce.box('Half'))).toMatchInlineSnapshot(`
      number literal: true
      type: finite_rational
      real: true
      rational: true
      integer: false
      positive (>0): true
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): true
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('1/2 is a rational', () => {
    expect(checkProps(ce.box(['Rational', 1, 2]))).toMatchInlineSnapshot(`
      number literal: true
      type: finite_rational
      real: true
      rational: true
      integer: false
      positive (>0): true
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): true
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('1.5 is a real number', () => {
    expect(checkProps(ce.number(1.5))).toMatchInlineSnapshot(`
      number literal: true
      type: finite_real
      real: true
      rational: false
      integer: false
      positive (>0): true
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): true
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: undefined
      odd: undefined
    `);
  });

  test('3 is a positive integer', () => {
    expect(checkProps(ce.number(3))).toMatchInlineSnapshot(`
      number literal: true
      type: finite_integer
      real: true
      rational: true
      integer: true
      positive (>0): true
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): true
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: false
      odd: true
    `);
  });

  test('-5 is a negative integer', () => {
    expect(checkProps(ce.number(-5))).toMatchInlineSnapshot(`
      number literal: true
      type: finite_integer
      real: true
      rational: true
      integer: true
      positive (>0): false
      negative (<0): true
      nonPositive (<=0): true
      nonNegative (>=0): false
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: false
      odd: true
    `);
  });

  test('Pi is a real number', () => {
    expect(checkProps(ce.symbol('Pi'))).toMatchInlineSnapshot(`
      number literal: false
      type: finite_real
      real: true
      rational: false
      integer: false
      positive (>0): true
      negative (<0): false
      nonPositive (<=0): false
      nonNegative (>=0): true
      -1: false
      0: false
      +1: false
      finite: true
      infinite: false
      nan: false
      even: undefined
      odd: undefined
    `);
  });
});

// Issue #283: parseNumbers: 'rational' loses precision for large integers
describe('PARSING LARGE INTEGERS WITH parseNumbers: rational', () => {
  test('Integers at MAX_SAFE_INTEGER boundary', () => {
    // MAX_SAFE_INTEGER = 9007199254740991
    expect(ce.parse('9007199254740991', { parseNumbers: 'rational' }).toString())
      .toBe('9007199254740991');

    // Just above MAX_SAFE_INTEGER - these previously lost precision
    expect(ce.parse('9007199254740992', { parseNumbers: 'rational' }).toString())
      .toBe('9007199254740992');
    expect(ce.parse('9007199254740993', { parseNumbers: 'rational' }).toString())
      .toBe('9007199254740993');
    expect(ce.parse('9007199254740999', { parseNumbers: 'rational' }).toString())
      .toBe('9007199254740999');
  });

  test('Very large integers preserve precision', () => {
    const veryLarge = '12345678901234567890';
    expect(ce.parse(veryLarge, { parseNumbers: 'rational' }).toString())
      .toBe(veryLarge);

    const huge = '123456789012345678901234567890';
    expect(ce.parse(huge, { parseNumbers: 'rational' }).toString())
      .toBe(huge);
  });

  test('Negative large integers preserve precision', () => {
    expect(ce.parse('-9007199254740993', { parseNumbers: 'rational' }).toString())
      .toBe('-9007199254740993');
    expect(ce.parse('-12345678901234567890', { parseNumbers: 'rational' }).toString())
      .toBe('-12345678901234567890');
  });

  test('Large integers use string num format in JSON', () => {
    const result = ce.parse('9007199254740993', { parseNumbers: 'rational' });
    expect(result.json).toEqual({ num: '9007199254740993' });
  });

  test('Small integers still use number format', () => {
    const result = ce.parse('123', { parseNumbers: 'rational' });
    expect(result.json).toBe(123);
  });

  test('Large decimal numerators preserve precision', () => {
    // 9007199254740993.5 should become 18014398509481987/2
    const result = ce.parse('9007199254740993.5', { parseNumbers: 'rational' });
    expect(result.json).toEqual(['Rational', { num: '18014398509481987' }, 2]);
  });

  test('Arithmetic on large integers is exact', () => {
    const a = ce.parse('9007199254740993', { parseNumbers: 'rational' });
    const b = ce.parse('1', { parseNumbers: 'rational' });
    expect(a.add(b).toString()).toBe('9007199254740994');
  });
});

describe('OPERATOR PROPERTY RETURNS SPECIFIC NUMERIC TYPE', () => {
  test('Integer literals return "Integer"', () => {
    expect(ce.box(42).operator).toBe('Integer');
    expect(ce.box(-5).operator).toBe('Integer');
    expect(ce.box(0).operator).toBe('Integer');
    expect(ce.number(1000).operator).toBe('Integer');
  });

  test('Floating point numbers return "Real"', () => {
    expect(ce.box(3.14).operator).toBe('Real');
    expect(ce.box(-2.5).operator).toBe('Real');
    expect(ce.number(0.5).operator).toBe('Real');
  });

  test('Rational numbers return "Rational"', () => {
    expect(ce.box(['Rational', 1, 2]).operator).toBe('Rational');
    expect(ce.box(['Rational', 3, 4]).operator).toBe('Rational');
    expect(ce.box('Half').operator).toBe('Rational');
  });

  test('Complex numbers return "Complex"', () => {
    expect(ce.box(['Complex', 1, 2]).operator).toBe('Complex');
    expect(ce.box(['Complex', 0, 1]).operator).toBe('Complex');
    expect(ce.box('i').operator).toBe('Complex');
  });

  test('Special numeric values return specific operators', () => {
    expect(ce.box(NaN).operator).toBe('NaN');
    expect(ce.box(Infinity).operator).toBe('PositiveInfinity');
    expect(ce.box(-Infinity).operator).toBe('NegativeInfinity');
    expect(ce.box('NaN').operator).toBe('NaN');
    expect(ce.box('PositiveInfinity').operator).toBe('PositiveInfinity');
    expect(ce.box('NegativeInfinity').operator).toBe('NegativeInfinity');
  });

  test('Real constants return "Real"', () => {
    // Numbers with radicals are represented as real
    expect(ce.parse('\\sqrt{2}').evaluate().operator).toBe('Real');
  });
});
