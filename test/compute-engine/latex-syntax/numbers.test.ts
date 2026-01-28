import { SerializeLatexOptions } from '../../../src/compute-engine/latex-syntax/public.ts';
import { exprToString, engine as ce } from '../../utils';

function parse(s: string) {
  return ce.parse(s);
}

/** parseVal checks that the result is a numericValue (or an integer) */
function parseVal(s: string): string | number {
  const result = ce.parse(s).numericValue;
  if (typeof result === 'number') return result;
  if (result === null) return NaN;
  return result.toString();
}

describe('PARSING OF NUMBER', () => {
  test('Basic Parsing', () => {
    expect(parseVal('1')).toEqual(1);
    expect(parseVal('-1')).toEqual(-1);
    expect(parseVal('1.0')).toEqual(1);
    expect(parseVal('-1.0')).toEqual(-1);
    expect(parseVal('-12.1234')).toEqual('-12.1234');
    expect(parseVal('-123 456.123 4')).toEqual('-123456.1234');
  });

  test('Parsing Exponents', () => {
    expect(parseVal('-12.1234 e 5')).toEqual('-1212340');
    expect(parseVal('-12.1234 E 5')).toEqual('-1212340');
    expect(parseVal('-12.1234e-5')).toEqual('-0.000121234');
    expect(parseVal('3 \\times 10 ^ 4')).toEqual(30000);
    expect(parse('1.234\\times 10^ { -5678 }')).toMatchInlineSnapshot(
      `1.234e-5678`
    );
    // Invalid exponent (decimal point in exponent)
    expect(parseVal('1.234\\times10^{1.234}')).toMatchInlineSnapshot(`NaN`);
  });

  test('Special Values', () => {
    expect(parseVal('+0')).toEqual(0);
    expect(parseVal('-0')).toEqual(0);
    expect(parseVal('-\\infty')).toEqual(-Infinity);
    expect(parseVal('\\mathrm{NaN}')).toEqual(NaN);
  });

  test('Parsing plus/minus', () => {
    expect(parseVal('+1')).toEqual(1);
    expect(parseVal('-1')).toEqual(-1);
    expect(parse('++1')).toMatchInlineSnapshot(`1`);
    expect(parse('-++1')).toMatchInlineSnapshot(`-1`);
    expect(parse('--1')).toMatchInlineSnapshot(`1`);
    expect(parse('-+-1')).toMatchInlineSnapshot(`1`);

    expect(parse('2--1')).toMatchInlineSnapshot(`["Add", 1, 2]`);
    expect(parse('2++1')).toMatchInlineSnapshot(`["Add", 1, 2]`);
  });

  test('Parsing invisible add/mixed fraction', () => {
    expect(parse('3\\frac14')).toMatchInlineSnapshot(
      `["Add", 3, ["Rational", 1, 4]]`
    );
    // Negative mixed fraction -> -(3 + 1/4)
    expect(parse('-3\\frac14')).toMatchInlineSnapshot(
      `["Subtract", ["Rational", -1, 4], 3]`
    );
    expect(parse('3\\frac14+\\frac12')).toMatchInlineSnapshot(
      `["Add", 3, ["Rational", 1, 4], ["Rational", 1, 2]]`
    );
  });

  test('Parsing numbers with repeating pattern', () => {
    expect(parse('1.(3)')).toMatchInlineSnapshot(`1.(3)`);
    expect(parse('0.(142857)')).toMatchInlineSnapshot(`0.(142857)`);
    expect(exprToString(ce.box({ num: '1.(3)' }))).toMatchInlineSnapshot(
      `1.(3)`
    );
    expect(exprToString(ce.box({ num: '0.(142857)' }))).toMatchInlineSnapshot(
      `0.(142857)`
    );
    expect(parse('x=.123')).toMatchInlineSnapshot(`["Equal", "x", 0.123]`);
    expect(parse('x=.123(45)')).toMatchInlineSnapshot(
      `["Equal", "x", "0.123(45)"]`
    );
    expect(parse('x=-987.123(45)')).toMatchInlineSnapshot(
      `["Equal", "x", "-987.123(45)"]`
    );

    // Vinculum
    expect(parse('0.\\overline{142857}')).toMatchInlineSnapshot(`0.(142857)`);

    // Dots
    expect(parse('1.\\overset{.}{3}')).toMatchInlineSnapshot(`1.(3)`);
    expect(parse('0.\\overset{.}{1}4285\\overset{.}{7}')).toMatchInlineSnapshot(
      `0.(142857)`
    );

    // Parentheses
    expect(parse('1.54\\left(2345\\right)')).toMatchInlineSnapshot(
      `1.54(2345)`
    );

    // Arc
    expect(parse('1.54\\overarc{2345}')).toMatchInlineSnapshot(`1.54(2345)`);

    // Repeating number with no whole part
    expect(parse('.\\overline{1234}')).toMatchInlineSnapshot(`0.(1234)`);

    // Repeating number with trailing dots
    expect(parse('.\\overline{1234}\\ldots')).toMatchInlineSnapshot(`0.(1234)`);
  });

  test('Parsing numbers with truncation mark', () => {
    expect(parse('x=.123\\ldots')).toMatchInlineSnapshot(
      `["Equal", "x", 0.123]`
    );
    expect(parse('x=.123\\ldots e4')).toMatchInlineSnapshot(
      `["Equal", "x", 1230]`
    );
    expect(parse('x=.123\\ldots e4+1')).toMatchInlineSnapshot(
      `["Equal", "x", ["Add", 1, 1230]]`
    );
    expect(parse('x=.123\\ldots e-423+1')).toMatchInlineSnapshot(
      `["Equal", "x", ["Add", 1, "1.23e-424"]]`
    );
  });

  test('Parsing numbers with INVALID truncation mark', () => {
    // Invalid: \ldots after repeating pattern
    expect(parse('x=.123(45)\\ldots')).toMatchInlineSnapshot(
      `["Equal", "x", "0.123(45)"]`
    );
  });

  test('Parsing numbers with grouping', () => {
    expect(parse('123\\,456')).toMatchInlineSnapshot(`123456`);
    expect(parse('123\\,45\\,67')).toMatchInlineSnapshot(`1234567`);
    expect(parse('123\\,45\\,67.123\\,456\\,78')).toMatchInlineSnapshot(
      `1234567.12345678`
    );
  });

  test('Parsing numbers with spacing', () => {
    expect(parse('123\\,45\\,67.123\\,456\\,')).toMatchInlineSnapshot(
      `1234567.123456`
    );
    expect(parse('123\\,45\\,67.123\\,456\\,e5')).toMatchInlineSnapshot(
      `123456712345.6`
    );
    expect(parse('123\\,45\\,67.123\\,456\\,e12\\,345')).toMatchInlineSnapshot(
      `{num: "1234567123456e+12339"}`
    );

    expect(parse('-1 2')).toMatchInlineSnapshot(`-12`);
  });

  test('Parsing whitespace with number sign', () => {
    expect(parseVal('  1')).toEqual(1);
    expect(parseVal('+ 1')).toEqual(1);
    expect(parseVal(' -  +   -   -1')).toEqual(-1);
  });

  test('Parsing digits', () => {
    // Number with exactly three digits after the decimal point
    expect(parseVal('3.423e4')).toEqual(34230);
    // Number with more than three, less than six digits after the decimal point
    expect(parseVal('3.42334e4')).toEqual('34233.4');
    // Number with more than 6 digits after the decimal point
    expect(parseVal('3.424242334e4')).toEqual('34242.42334');
  });

  test('Complex Numbers', () => {
    expect(parseVal('2i')).toMatchInlineSnapshot(`2i`);
    expect(parseVal('1-i')).toMatchInlineSnapshot(`(1 - i)`);
    expect(parseVal('2-3i')).toMatchInlineSnapshot(`(2 - 3i)`);
    expect(parseVal('-1.2345-5.6789i')).toMatchInlineSnapshot(
      `(-1.2345 - 5.6789i)`
    );
    // This is an expression, not a number
    expect(parseVal('2-1.2345-5.6789i')).toMatchInlineSnapshot(`NaN`);
  });

  test('Rationals and radicals', () => {
    expect(parseVal('\\sqrt{2}')).toMatchInlineSnapshot(`sqrt(2)`);
    expect(parseVal('3\\sqrt{2}')).toMatchInlineSnapshot(`3sqrt(2)`);
    expect(parseVal('\\frac{3}{4}\\sqrt{2}')).toMatchInlineSnapshot(
      `3/4sqrt(2)`
    );
    // This is an expression, not a number, should be NaN
    expect(parseVal('\\sqrt{2.1}')).toMatchInlineSnapshot(`NaN`);

    // This is also an expression (not a small integer), so should be NaN
    expect(parseVal('\\sqrt{9007199254740997}')).toMatchInlineSnapshot(`NaN`);

    expect(parseVal('9007199254741033\\sqrt{3}')).toMatchInlineSnapshot(
      `9007199254741033sqrt(3)`
    );

    // We expect to get NaN because the radical is too large for this
    // to be represented as a numeric value
    expect(
      parseVal('9007199254741033\\sqrt{9007199254740997}')
    ).toMatchInlineSnapshot(`NaN`);
    expect(
      parseVal(
        '\\frac{9007199254741033}{9007199254740997}\\sqrt{9007199254740997}'
      )
    ).toMatchInlineSnapshot(`NaN`);
  });

  test('Non-machine number', () => {
    // Exponent larger than 10^308 (Number.MAX_VALUE = 1.7976931348623157e+308)
    expect(ce.parse('421.35e+1000')).toMatchInlineSnapshot(
      `{num: "42135e+998"}`
    );
    // Exponent smaller than 10^-323 (Number.MIN_VALUE = 5e-324)
    expect(ce.parse('421.35e-323')).toMatchInlineSnapshot(`4.2135e-321`);

    //  More than 15 digits
    expect(ce.parse('9007199234534554740991')).toMatchInlineSnapshot(
      `{num: "9007199234534554740991"}`
    );

    expect(ce.parse('900719923453434553453454740992')).toMatchInlineSnapshot(
      `{num: "900719923453434553453454740992"}`
    );
    expect(
      ce.parse(
        '900719923453434553982347938645934876598347659823479234879234867923487692348792348692348769234876923487692348769234876923487634876234876234987692348762348769234876348576453454740992123456789'
      )
    ).toMatchInlineSnapshot(`
      {
        num: "900719923453434553982347938645934876598347659823479234879234867923487692348792348692348769234876923487692348769234876923487634876234876234987692348762348769234876348576453454740992123456789"
      }
    `);
    expect(ce.parse('31324234.23423143\\times10^{5000}')).toMatchInlineSnapshot(
      `{num: "3132423423423143e+4992"}`
    );
  });

  test('Non-finite numbers', () => {
    expect(parseVal('-\\infty')).toEqual(-Infinity);
    expect(parse('2+\\infty')).toMatchInlineSnapshot(
      `["Add", 2, "PositiveInfinity"]`
    );
    expect(parse('\\infty-\\infty')).toMatchInlineSnapshot(
      `["Subtract", "PositiveInfinity", "PositiveInfinity"]`
    );
    // Should not be interpreted as infinity
    expect(parseVal('\\frac{0}{0}')).toEqual(NaN);
  });

  test('Not numbers', () => {
    expect(parse('3\\times x')).toMatchInlineSnapshot(`["Multiply", 3, "x"]`);
    expect(parse('3\\times10^n')).toMatchInlineSnapshot(
      `["Multiply", 3, ["Power", 10, "n"]]`
    );
    expect(parseVal('\\frac{2}{0}')).toMatchInlineSnapshot(`NaN`);
    expect(parseVal('\\operatorname{NaN}')).toEqual(NaN);
  });

  test('Bigints', () => {
    expect(parse('9007199254741033')).toMatchInlineSnapshot(
      `{num: "9007199254741033"}`
    );
  });
});

describe('SERIALIZATION OF NUMBERS', () => {
  test('Auto', () => {
    const format: Partial<SerializeLatexOptions> = {
      notation: 'auto',
      avoidExponentsInRange: null,
      exponentProduct: '\\times',
    };
    const reformat = (s: string) => {
      return ce.parse(s).toLatex(format);
    };
    expect(reformat('0')).toMatchInlineSnapshot(`0`);
    expect(reformat('0.00001')).toMatchInlineSnapshot(`0.000\\,01`);
    expect(reformat('0.0123')).toMatchInlineSnapshot(`0.012\\,3`);
    expect(reformat('0.001')).toMatchInlineSnapshot(`0.001`);
    expect(reformat('0.123')).toMatchInlineSnapshot(`0.123`);
    expect(reformat('5')).toMatchInlineSnapshot(`5`);
    expect(reformat('5.1234')).toMatchInlineSnapshot(`5.123\\,4`);
    expect(reformat('42')).toMatchInlineSnapshot(`42`);
    expect(reformat('420')).toMatchInlineSnapshot(`420`);
    expect(reformat('700')).toMatchInlineSnapshot(`700`);
    expect(reformat('1420')).toMatchInlineSnapshot(`1\\,420`);
    expect(reformat('1420.567')).toMatchInlineSnapshot(`1\\,420.567`);
    expect(reformat('12420')).toMatchInlineSnapshot(`12\\,420`);
    expect(reformat('7000')).toMatchInlineSnapshot(`7\\,000`);
    expect(reformat('12420\\times10^{7}')).toMatchInlineSnapshot(
      `124\\,200\\,000\\,000`
    );
    expect(reformat('12420.54\\times10^{7}')).toMatchInlineSnapshot(
      `124\\,205\\,400\\,000`
    );

    // *NOT* a repeating pattern (fewer digits than precision)
    expect(reformat('1.234234234')).toMatchInlineSnapshot(`1.234\\,234\\,234`);
  });

  test('Scientific', () => {
    const reformat = (s: string) =>
      ce.parse(s).toLatex({
        notation: 'scientific',
        avoidExponentsInRange: null,
        exponentProduct: '\\times',
      });
    expect(reformat('0')).toMatchInlineSnapshot(`0`);
    expect(reformat('1')).toMatchInlineSnapshot(`1`);
    expect(reformat('0.00001')).toMatchInlineSnapshot(`1\\times10^{-5}`);
    expect(reformat('0.0123')).toMatchInlineSnapshot(`1.23\\times10^{-2}`);
    expect(reformat('0.001')).toMatchInlineSnapshot(`1\\times10^{-3}`);
    expect(reformat('0.123')).toMatchInlineSnapshot(`1.23\\times10^{-1}`);
    expect(reformat('5')).toMatchInlineSnapshot(`5`);
    expect(reformat('5.1234')).toMatchInlineSnapshot(`5.123\\,4`);
    expect(reformat('42')).toMatchInlineSnapshot(`4.2\\times10^{1}`);
    expect(reformat('420')).toMatchInlineSnapshot(`4.2\\times10^{2}`);
    expect(reformat('700')).toMatchInlineSnapshot(`7\\times10^{2}`);
    expect(reformat('1420')).toMatchInlineSnapshot(`1.42\\times10^{3}`);
    expect(reformat('1420.567')).toMatchInlineSnapshot(
      `1.420\\,567\\times10^{3}`
    );
    expect(reformat('12420')).toMatchInlineSnapshot(`1.242\\times10^{4}`);
    expect(reformat('7000')).toMatchInlineSnapshot(`7\\times10^{3}`);
    expect(reformat('12420\\times10^{7}')).toMatchInlineSnapshot(
      `1.242\\times10^{11}`
    );
    expect(reformat('12420.54\\times10^{7}')).toMatchInlineSnapshot(
      `1.242\\,054\\times10^{11}`
    );
    expect(reformat('70000')).toMatchInlineSnapshot(`7\\times10^{4}`);

    // *NOT* a repeating pattern (fewer digits than precision)
    expect(reformat('1.234234234')).toMatchInlineSnapshot(`1.234\\,234\\,234`);
  });

  test('Engineering', () => {
    const reformat = (s: string) =>
      ce.parse(s).toLatex({
        notation: 'engineering',
        avoidExponentsInRange: null,
        exponentProduct: '\\times',
      });
    expect(reformat('0')).toMatchInlineSnapshot(`0`);
    expect(reformat('1')).toMatchInlineSnapshot(`1`);
    expect(reformat('0.00001')).toMatchInlineSnapshot(`100\\times10^{-3}`);
    expect(reformat('0.0123')).toMatchInlineSnapshot(`12.3\\times10^{-3}`);
    expect(reformat('0.001')).toMatchInlineSnapshot(`1\\times10^{-3}`);
    expect(reformat('0.123')).toMatchInlineSnapshot(`123\\times10^{-3}`);
    expect(reformat('5')).toMatchInlineSnapshot(`5`);
    expect(reformat('5.1234')).toMatchInlineSnapshot(`5.123\\,4`);
    expect(reformat('42')).toMatchInlineSnapshot(`42`);
    expect(reformat('420')).toMatchInlineSnapshot(`420`);
    expect(reformat('700')).toMatchInlineSnapshot(`700`);
    expect(reformat('1420')).toMatchInlineSnapshot(`1.42\\times10^{3}`);
    expect(reformat('1420.567')).toMatchInlineSnapshot(
      `1.420\\,567\\times10^{3}`
    );
    expect(reformat('12420')).toMatchInlineSnapshot(`12.42\\times10^{3}`);
    expect(reformat('7000')).toMatchInlineSnapshot(`7\\times10^{3}`);
    expect(reformat('12420\\times10^{7}')).toMatchInlineSnapshot(
      `124.2\\times10^{9}`
    );
    expect(reformat('12420.54\\times10^{7}')).toMatchInlineSnapshot(
      `124.205\\,4\\times10^{9}`
    );
    expect(reformat('70000')).toMatchInlineSnapshot(`70\\times10^{3}`);

    // *NOT* a repeating pattern (fewer digits than precision)
    expect(reformat('1.234234234')).toMatchInlineSnapshot(`1.234\\,234\\,234`);
  });

  test('Number with lakh digit grouping', () => {
    const format = (num: string) =>
      ce.box({ num }).toLatex({ digitGroup: 'lakh' });

    expect(format('12345678')).toMatchInlineSnapshot(`12345\\,678`);
    expect(format('12345678.12345678')).toMatchInlineSnapshot(
      `12345\\,678.123\\,456\\,78`
    );
  });

  test('scientific notation within avoidExponentsInRange', () => {
    const result = ce.box(1 / 7000000).toLatex({
      notation: 'scientific',
    });
    expect(result).toMatchInlineSnapshot(
      `1.428\\,571\\,428\\,571\\,428\\,5\\cdot10^{-7}`
    );
  });

  test('scientific notation outside avoidExponentsInRange', () => {
    const result = ce.box(1 / 70000000).toLatex({
      notation: 'scientific',
    });
    expect(result).toMatchInlineSnapshot(
      `1.428\\,571\\,428\\,571\\,428\\,6\\cdot10^{-8}`
    );
  });

  test('auto notation within avoidExponentsInRange', () => {
    const result = ce.box(1 / 7000000).toLatex({
      notation: 'auto',
    });
    expect(result).toMatchInlineSnapshot(
      `0.000\\,000\\,142\\,857\\,142\\,857\\,142\\,85`
    );
  });

  test('auto notation outside avoidExponentsInRange', () => {
    const result = ce.box(1 / 70000000).toLatex({
      notation: 'auto',
    });
    expect(result).toMatchInlineSnapshot(
      `14\\,285\\,714\\,285\\,714\\,286\\cdot10^{-24}`
    );
  });

  test('adaptiveScientific notation within avoidExponentsInRange', () => {
    const result = ce.box(1 / 7000000).toLatex({
      notation: 'adaptiveScientific',
    });
    expect(result).toMatchInlineSnapshot(
      `0.000\\,000\\,142\\,857\\,142\\,857\\,142\\,85`
    );
  });

  test('adaptiveScientific notation outside avoidExponentsInRange', () => {
    const result = ce.box(1 / 70000000).toLatex({
      notation: 'adaptiveScientific',
    });
    expect(result).toMatchInlineSnapshot(
      `1.428\\,571\\,428\\,571\\,428\\,6\\cdot10^{-8}`
    );
  });

  test('Number with repeating pattern', () => {
    const format = (num: string, p: string) =>
      ce.box({ num }).toLatex({
        repeatingDecimal: p as any,
      });
    expect(format('0.(142857)', 'vinculum')).toMatchInlineSnapshot(
      `0.\\overline{142857}`
    );
    expect(format('0.(142857)', 'dots')).toMatchInlineSnapshot(
      `0.\\overset{\\cdots}{1}42857\\overset{\\cdots}{7}`
    );
    expect(format('0.(142857)', 'parentheses')).toMatchInlineSnapshot(
      `0.(142857)`
    );
    expect(format('0.(142857)', 'arc')).toMatchInlineSnapshot(
      `0.\\wideparen{142857}`
    );
  });
});
