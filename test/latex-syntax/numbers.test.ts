import { Expression } from '../../src/math-json/math-json-format';
import { expression, latex } from '../utils';

describe('NUMBERS', () => {
  test('Parsing', () => {
    expect(expression('1')).toMatchInlineSnapshot(`1`);
    expect(expression('-1')).toMatchInlineSnapshot(`-1`);
    expect(expression('1.0')).toMatchInlineSnapshot(`{num: '1.0'}`);
    expect(expression('-1.0')).toMatchInlineSnapshot(`{num: '-1.0'}`);
    expect(expression('-1.1234')).toMatchInlineSnapshot(`-1.1234`);
    expect(expression('-1.1234e5')).toMatchInlineSnapshot(`{num: '-1.1234e5'}`);
    expect(expression('-1.1234E5')).toMatchInlineSnapshot(`{num: '-1.1234e5'}`);
    expect(expression('-1.1234e-5')).toMatchInlineSnapshot(
      `{num: '-1.1234e-5'}`
    );
    // Invalid expression (the argument of "num" should be a string)
    expect(latex({ num: 4 } as any as Expression)).toMatchInlineSnapshot(`'4'`);
    expect(expression('3\\times10^4')).toMatchInlineSnapshot(`{num: '3e4'}`);
  });
  test('Parsing plus/minus', () => {
    expect(expression('+1')).toMatchInlineSnapshot(`1`);
    expect(expression('++1')).toMatchInlineSnapshot(`['PreIncrement', 1]`);
    expect(expression('-1')).toMatchInlineSnapshot(`-1`);
    expect(expression('--1')).toMatchInlineSnapshot(`['PreDecrement', 1]`);
    expect(expression('-+-1')).toMatchInlineSnapshot(`1`);
  });
  test('Parsing whitespace with number sign', () => {
    expect(expression('  1')).toMatchInlineSnapshot(`1`);
    expect(expression('+ 1')).toMatchInlineSnapshot(`1`);
    expect(expression(' -  +   -   -1')).toMatchInlineSnapshot(`['Negate', 1]`);
  });
  test('Parsing digits', () => {
    // Number with exactly three digits after the decimal point
    expect(expression('3.423e4')).toMatchInlineSnapshot(`{num: '3.423e4'}`);
    // Number with more than three, less than six digits after the decimal point
    expect(expression('3.42334e4')).toMatchInlineSnapshot(`{num: '3.42334e4'}`);
    // Number with more than 6 digits after the decimal point
    expect(expression('3.424242334e4')).toMatchInlineSnapshot(
      `{num: '3.424242334e4d'}`
    );
  });

  test('Large numbers', () => {
    expect(expression('421.35d+1000')).toMatchInlineSnapshot(
      `{num: '421.35e1000'}`
    );
    expect(expression('9007199234534554740991')).toMatchInlineSnapshot(
      `{num: '9007199234534554740991n'}`
    );
    expect(expression('900719923453434553453454740992')).toMatchInlineSnapshot(
      `{num: '900719923453434553453454740992n'}`
    );
    expect(
      expression(
        '900719923453434553982347938645934876598347659823479234879234867923487692348792348692348769234876923487692348769234876923487634876234876234987692348762348769234876348576453454740992123456789'
      )
    ).toMatchInlineSnapshot(
      `{num: '900719923453434553982347938645934876598347659823479234879234867923487692348792348692348769234876923487692348769234876923487634876234876234987692348762348769234876348576453454740992123456789n'}`
    );
    expect(
      expression('31324234.23423143\\times10^{5000}')
    ).toMatchInlineSnapshot(`{num: '31324234.23423143e5000d'}`);
  });
  test('Non-finite numbers', () => {
    expect(expression('-\\infty')).toMatchInlineSnapshot(`{num: '-Infinity'}`);
    expect(expression('2+\\infty')).toMatchInlineSnapshot(
      `['Add', 2, {num: 'Infinity'}]`
    );
    expect(expression('\\infty-\\infty')).toMatchInlineSnapshot(
      `['Add', {num: '-Infinity'}, {num: 'Infinity'}]`
    );
    // Should not be interpreted as infinity
    expect(expression('\\frac{0}{0}')).toMatchInlineSnapshot(
      `['Divide', 0, 0]`
    );
    expect(latex({ num: 'NaN' })).toMatchInlineSnapshot(
      `'\\operatorname{NaN}'`
    );
    expect(latex({ num: 'Infinity' })).toMatchInlineSnapshot(`'\\infty'`);
  });
  test('Not numbers', () => {
    expect(latex(NaN)).toMatchInlineSnapshot(`'\\operatorname{NaN}'`);
    expect(latex(Infinity)).toMatchInlineSnapshot(`'\\infty'`);
    // Invalid expression
    expect(latex({ num: Infinity } as any as Expression)).toMatchInlineSnapshot(
      `'\\infty'`
    );
    expect(latex({ num: 'infinity' })).toMatchInlineSnapshot(
      `'Error: syntax-error,{"num":"infinity"}'`
    );
    expect(expression('3\\times x')).toMatchInlineSnapshot(
      `['Multiply', 3, 'x']`
    );
    expect(expression('3\\times10^n')).toMatchInlineSnapshot(
      `['Multiply', 3, ['Power', 10, 'n']]`
    );
    expect(expression('\\operatorname{NaN}'))
      .toMatchInlineSnapshot
      // @todo
      (
        `['Error', ['LatexString', {str: '\\operatorname{NaN}'}], 'unknown-command']`
      );
  });
  test('Bigints', () => {
    // expect(latex({ num: 12n })).toMatchInlineSnapshot();
    expect(latex({ num: '12n' })).toMatchInlineSnapshot(`'12'`);
    // 1.873 461 923 786 192 834 612 398 761 298 192 306 423 768 912 387 649 238 476 9... × 10^196
    expect(
      latex({
        num: '18734619237861928346123987612981923064237689123876492384769123786412837040123612308964123876412307864012346012837491237864192837641923876419238764123987642198764987162398716239871236912347619238764n',
      })
    ).toMatchInlineSnapshot(
      `'1.873\\,461\\,923\\,786\\,19\\ldots\\cdot10^{196}'`
    );
  });
});
