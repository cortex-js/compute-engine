import { Expression } from '../../../src/math-json/math-json-format';
import { box, latex, parse, engine as ce } from '../../utils';

describe('NUMBERS', () => {
  test('Parsing', () => {
    expect(parse('1')).toMatch('1');
    expect(parse('-1')).toMatch('-1');
    expect(parse('1.0')).toMatch('1');
    expect(parse('-1.0')).toMatch('-1');
    expect(parse('-1.1234')).toMatch('-1.1234');
    expect(parse('-1.1234e5')).toMatch('-112340');
    expect(parse('-1.1234E5')).toMatch('-112340');
    expect(parse('-1.1234e-5')).toMatchInlineSnapshot(`-0.000011234`);
    // Invalid box (the argument of "num" should be a string), but accepted
    expect(box({ num: 4 } as any as Expression)).toMatch('4');
    expect(parse('3\\times10^4')).toMatch('30000');
  });
  test('Parsing plus/minus', () => {
    expect(parse('+1')).toMatch('1');
    expect(parse('++1')).toMatchInlineSnapshot(`["PreIncrement", 1]`);
    expect(parse('-1')).toMatchInlineSnapshot(`-1`);
    expect(parse('--1')).toMatchInlineSnapshot(`["PreDecrement", 1]`);
    expect(parse('-+-1')).toMatchInlineSnapshot(`1`);
  });
  test('Parsing numbers with repeating pattern', () => {
    expect(parse('1.(3)')).toMatchInlineSnapshot(`1.(3)`);
    expect(parse('0.(142857)')).toMatchInlineSnapshot(`0.(142857)`);
    expect(box({ num: '1.(3)' })).toMatch('1.(3)');
    expect(box({ num: '0.(142857)' })).toMatch('0.(142857)');
    expect(parse('x=.123')).toMatchInlineSnapshot(`["Equal", "x", 0.123]`);
    expect(parse('x=.123(45)')).toMatchInlineSnapshot(
      `["Equal", "x", "0.123(45)"]`
    );
    expect(parse('x=-987.123(45)')).toMatchInlineSnapshot(
      `["Equal", "x", "-987.123(45)"]`
    );
  });
  test('Parsing numbers with truncation  mark', () => {
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
      `["Equal", "x", ["Add", "1.23e-424", 1]]`
    );
  });

  test('Parsing numbers with truncation  mark', () => {
    // Invalid: \ldots after repeating pattern
    expect(parse('x=.123(45)\\ldots')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Equal", "x", "0.123(45)"],
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\ldots'"],
          ["LatexString", "'\\ldots'"]
        ]
      ]
    `);
  });

  test('Parsing numbers including whitespace', () => {
    expect(
      box({ num: '\u00091\u000a2\u000b3\u000c4\u000d5 6\u00a07.2' })
    ).toMatch('1234567.2');
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
      `1.234567123456e+12351`
    );

    expect(parse('-1 2')).toMatchInlineSnapshot(`-12`);
  });

  test('Parsing whitespace with number sign', () => {
    expect(parse('  1')).toMatch('1');
    expect(parse('+ 1')).toMatch('1');
    expect(parse(' -  +   -   -1')).toMatch('-1');
  });
  test('Parsing digits', () => {
    // Number with exactly three digits after the decimal point
    expect(parse('3.423e4')).toMatch('34230');
    // Number with more than three, less than six digits after the decimal point
    expect(parse('3.42334e4')).toMatch('34233.4');
    // Number with more than 6 digits after the decimal point
    expect(parse('3.424242334e4')).toMatch('34242.42334');
  });

  test('Non-machine number', () => {
    // Exponent larger than 10^308 (Number.MAX_VALUE = 1.7976931348623157e+308)
    expect(parse('421.35e+1000')).toMatch('4.2135e+1002');
    // Exponent smaller than 10^-323 (Number.MIN_VALUE = 5e-324)
    expect(parse('421.35e-323')).toMatch('4.2135e-321');

    //  More than 15 digits
    expect(parse('9007199234534554740991')).toMatchInlineSnapshot(
      `9007199234534554740991`
    );

    expect(parse('900719923453434553453454740992')).toMatch(
      '900719923453434553453454740992'
    );
    expect(
      parse(
        '900719923453434553982347938645934876598347659823479234879234867923487692348792348692348769234876923487692348769234876923487634876234876234987692348762348769234876348576453454740992123456789'
      )
    ).toMatchInlineSnapshot(
      `900719923453434553982347938645934876598347659823479234879234867923487692348792348692348769234876923487692348769234876923487634876234876234987692348762348769234876348576453454740992123456789`
    );
    expect(parse('31324234.23423143\\times10^{5000}')).toMatchInlineSnapshot(
      `3.132423423423143e+5007`
    );
  });
  test('Non-finite numbers', () => {
    expect(parse('-\\infty')).toMatch('{num: "-Infinity"}');
    expect(parse('2+\\infty')).toMatchInlineSnapshot(
      `["Add", 2, {num: "+Infinity"}]`
    );
    expect(parse('\\infty-\\infty')).toMatchInlineSnapshot(
      `["Add", {num: "-Infinity"}, {num: "+Infinity"}]`
    );
    // Should not be interpreted as infinity
    expect(parse('\\frac{0}{0}')).toMatchInlineSnapshot(`{num: "NaN"}`);
    expect(box({ num: 'NaN' })).toMatch('{num: "NaN"}');
    expect(latex({ num: 'Infinity' })).toMatch('\\infty');
  });
  test('Not numbers', () => {
    expect(box(NaN)).toMatch('{num: "NaN"}');
    expect(box(Infinity)).toMatch('{num: "+Infinity"}');
    // Invalid box
    expect(box({ num: Infinity } as any as Expression)).toMatch(
      '{num: "+Infinity"}'
    );
    expect(box({ num: 'infinity' })).toMatchInlineSnapshot(
      `{num: "+Infinity"}`
    );
    expect(parse('3\\times x')).toMatchInlineSnapshot(`["Multiply", 3, "x"]`);
    expect(parse('3\\times10^n')).toMatchInlineSnapshot(
      `["Multiply", 3, ["Power", 10, "n"]]`
    );
    expect(parse('\\operatorname{NaN}')).toMatch('{num: "NaN"}');
  });
  test('Bigints', () => {
    // expect(latex({ num: 12n })).toMatchInlineSnapshot();
    expect(box({ num: '12n' })).toMatch('12');
    // 1.873 461 923 786 192 834 612 398 761 298 192 306 423 768 912 387 649 238 476 9... × 10^196
    expect(
      box({
        num: '187346192378619283461239876129819230642376891238764923847000000000000000000000',
      })
    ).toMatchInlineSnapshot(
      `1.87346192378619283461239876129819230642376891238764923847e+77`
    );

    expect(
      box({
        num: '18734619237861928346123987612981923064237689123876492384769123786412837040123612308964123876412307864012346012837491237864192837641923876419238764123987642198764987162398716239871236912347619238764n',
      })
    ).toMatchInlineSnapshot(
      `18734619237861928346123987612981923064237689123876492384769123786412837040123612308964123876412307864012346012837491237864192837641923876419238764123987642198764987162398716239871236912347619238764`
    );
  });
});

describe('NUMBER SERIALIZATION', () => {
  test('Auto', () => {
    ce.latexOptions.notation = 'auto';
    ce.latexOptions.avoidExponentsInRange = null;
    ce.latexOptions.exponentProduct = '\\times';
    expect(ce.parse('0').latex).toMatchInlineSnapshot(`0`);
    expect(ce.parse('0.00001').latex).toMatchInlineSnapshot(`0.000\\,01`);
    expect(ce.parse('0.0123').latex).toMatchInlineSnapshot(`0.012\\,3`);
    expect(ce.parse('0.001').latex).toMatchInlineSnapshot(`0.001`);
    expect(ce.parse('0.123').latex).toMatchInlineSnapshot(`0.123`);
    expect(ce.parse('5').latex).toMatchInlineSnapshot(`5`);
    expect(ce.parse('5.1234').latex).toMatchInlineSnapshot(`5.123\\,4`);
    expect(ce.parse('42').latex).toMatchInlineSnapshot(`42`);
    expect(ce.parse('420').latex).toMatchInlineSnapshot(`420`);
    expect(ce.parse('700').latex).toMatchInlineSnapshot(`700`);
    expect(ce.parse('1420').latex).toMatchInlineSnapshot(`1\\,420`);
    expect(ce.parse('1420.567').latex).toMatchInlineSnapshot(`1\\,420.567`);
    expect(ce.parse('12420').latex).toMatchInlineSnapshot(`12\\,420`);
    expect(ce.parse('7000').latex).toMatchInlineSnapshot(`7\\,000`);
    expect(ce.parse('12420\\times10^{7}').latex).toMatchInlineSnapshot(
      `124\\,200\\,000\\,000`
    );
    expect(ce.parse('12420.54\\times10^{7}').latex).toMatchInlineSnapshot(
      `124\\,205\\,400\\,000`
    );

    // *NOT* a repeating pattern (fewer digits than precision)
    expect(ce.parse('1.234234234').latex).toMatchInlineSnapshot(
      `1.234\\,234\\,234`
    );
  });

  test('Scientific', () => {
    ce.latexOptions.notation = 'scientific';
    ce.latexOptions.avoidExponentsInRange = null;
    ce.latexOptions.exponentProduct = '\\times';
    expect(ce.parse('0').latex).toMatchInlineSnapshot(`0`);
    expect(ce.parse('0.00001').latex).toMatchInlineSnapshot(`10^{-5}`);
    expect(ce.parse('0.0123').latex).toMatchInlineSnapshot(
      `1.23\\times10^{-2}`
    );
    expect(ce.parse('0.001').latex).toMatchInlineSnapshot(`10^{-3}`);
    expect(ce.parse('0.123').latex).toMatchInlineSnapshot(`1.23\\times10^{-1}`);
    expect(ce.parse('5').latex).toMatchInlineSnapshot(`5`);
    expect(ce.parse('5.1234').latex).toMatchInlineSnapshot(`5.123\\,4`);
    expect(ce.parse('42').latex).toMatchInlineSnapshot(`4.2\\times10^{1}`);
    expect(ce.parse('420').latex).toMatchInlineSnapshot(`4.2\\times10^{2}`);
    expect(ce.parse('700').latex).toMatchInlineSnapshot(`7\\times10^{2}`);
    expect(ce.parse('1420').latex).toMatchInlineSnapshot(`1.42\\times10^{3}`);
    expect(ce.parse('1420.567').latex).toMatchInlineSnapshot(
      `1.420\\,567\\times10^{3}`
    );
    expect(ce.parse('12420').latex).toMatchInlineSnapshot(`1.242\\times10^{4}`);
    expect(ce.parse('7000').latex).toMatchInlineSnapshot(`7\\times10^{3}`);
    expect(ce.parse('12420\\times10^{7}').latex).toMatchInlineSnapshot(
      `1.242\\times10^{11}`
    );
    expect(ce.parse('12420.54\\times10^{7}').latex).toMatchInlineSnapshot(
      `1.242\\,054\\times10^{11}`
    );

    // *NOT* a repeating pattern (fewer digits than precision)
    expect(ce.parse('1.234234234').latex).toMatchInlineSnapshot(
      `1.234\\,234\\,234`
    );

    ce.latexOptions.notation = 'auto';
  });

  test('Auto', () => {
    ce.latexOptions.notation = 'engineering';
    ce.latexOptions.avoidExponentsInRange = null;
    ce.latexOptions.exponentProduct = '\\times';
    expect(ce.parse('0').latex).toMatchInlineSnapshot(`0`);
    expect(ce.parse('0.00001').latex).toMatchInlineSnapshot(
      `100\\times10^{-3}`
    );
    expect(ce.parse('0.0123').latex).toMatchInlineSnapshot(
      `12.3\\times10^{-3}`
    );
    expect(ce.parse('0.001').latex).toMatchInlineSnapshot(`10^{-3}`);
    expect(ce.parse('0.123').latex).toMatchInlineSnapshot(`123\\times10^{-3}`);
    expect(ce.parse('5').latex).toMatchInlineSnapshot(`5`);
    expect(ce.parse('5.1234').latex).toMatchInlineSnapshot(`5.123\\,4`);
    expect(ce.parse('42').latex).toMatchInlineSnapshot(`42`);
    expect(ce.parse('420').latex).toMatchInlineSnapshot(`420`);
    expect(ce.parse('700').latex).toMatchInlineSnapshot(`700`);
    expect(ce.parse('1420').latex).toMatchInlineSnapshot(`1.42\\times10^{3}`);
    expect(ce.parse('1420.567').latex).toMatchInlineSnapshot(
      `1.420\\,567\\times10^{3}`
    );
    expect(ce.parse('12420').latex).toMatchInlineSnapshot(`12.42\\times10^{3}`);
    expect(ce.parse('7000').latex).toMatchInlineSnapshot(`7\\times10^{3}`);
    expect(ce.parse('12420\\times10^{7}').latex).toMatchInlineSnapshot(
      `124.2\\times10^{9}`
    );
    expect(ce.parse('12420.54\\times10^{7}').latex).toMatchInlineSnapshot(
      `124.205\\,4\\times10^{9}`
    );

    // *NOT* a repeating pattern (fewer digits than precision)
    expect(ce.parse('1.234234234').latex).toMatchInlineSnapshot(
      `1.234\\,234\\,234`
    );

    ce.latexOptions.notation = 'auto';
  });
});
