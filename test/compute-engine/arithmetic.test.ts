import { check, checkJson, engine } from '../utils';

const ce = engine;

ce.assign('z', ['Complex', 0, 1]);

describe('CONSTANTS', () => {
  test(`ExponentialE`, () =>
    expect(checkJson(`ExponentialE`)).toMatchSnapshot());
  test(`ImaginaryUnit`, () =>
    expect(checkJson(`ImaginaryUnit`)).toMatchSnapshot());
  test(`MachineEpsilon`, () =>
    expect(checkJson(`MachineEpsilon`)).toMatchSnapshot());
  test(`CatalanConstant`, () =>
    expect(checkJson(`CatalanConstant`)).toMatchSnapshot());
  test(`GoldenRatio`, () => expect(checkJson(`GoldenRatio`)).toMatchSnapshot());
  test(`EulerGamma`, () => expect(checkJson(`EulerGamma`)).toMatchSnapshot());
});

describe('RELATIONAL OPERATOR', () => {
  test(`Equal`, () =>
    expect(ce.box(['Equal', 5, 5]).evaluate()).toMatchSnapshot());
  test(`Equal`, () =>
    expect(ce.box(['Equal', 11, 7]).evaluate()).toMatchSnapshot());
  test(`NotEqual`, () =>
    expect(ce.box(['NotEqual', 5, 5]).evaluate()).toMatchSnapshot());
  test(`NotEqual`, () =>
    expect(ce.box(['NotEqual', 11, 7]).evaluate()).toMatchSnapshot());
  test(`Greater`, () =>
    expect(ce.box(['Greater', 3, 19]).evaluate()).toMatchSnapshot());
  test(`Greater`, () =>
    expect(ce.box(['Greater', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Less`, () =>
    expect(ce.box(['Less', 3, 19]).evaluate()).toMatchSnapshot());
  test(`Less`, () =>
    expect(ce.box(['Less', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 3, 3]).evaluate()).toMatchSnapshot());
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 3, 19]).evaluate()).toMatchSnapshot());
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 3, 3]).evaluate()).toMatchSnapshot());
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 3, 19]).evaluate()).toMatchSnapshot());
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 2.5, 1.1]).evaluate()).toMatchSnapshot());
});

//
// When using `.evaluate()` if there are any non-exact arguments (literal
// numbers with fractional part), the result is an approximation (same as
// `N()`). Otherwise, if all the arguments are exact they are grouped as follow:
// - integers
// - rationals
// - square root of rationals
// - functions (trig, etc...)
// - constants
//
//
describe('EXACT EVALUATION', () => {
  test(`Sqrt: Exact integer`, () =>
    expect(check('\\sqrt{5}')).toMatchSnapshot());
  test(`Sqrt: Exact rational`, () =>
    expect(check('\\sqrt{\\frac{5}{7}}')).toMatchSnapshot());
  test(`Sqrt: Inexact Fractional part`, () =>
    expect(check('\\sqrt{5.1}')).toMatchSnapshot());

  test(`Cos: Exact integer`, () => expect(check('\\cos{5}')).toMatchSnapshot());

  test(`Cos: Exact rational`, () =>
    expect(check('\\cos{\\frac{5}{7}}')).toMatchSnapshot());
  test(`Cos: Inexact Fractional part`, () =>
    expect(check('\\cos(5.1)')).toMatchSnapshot());
  test(`Cos: Pi (simplify constructible value)`, () =>
    expect(check('\\cos{\\pi}')).toMatchSnapshot());

  test(`Add: All exact`, () =>
    expect(check('6+\\frac{10}{14}+\\sqrt{\\frac{18}{9}}')).toMatchSnapshot());

  test(`Add: All exact`, () =>
    expect(check('6+\\sqrt{2}+\\sqrt{5}')).toMatchSnapshot());

  test(`Add: All exact`, () =>
    expect(
      check('2+5+\\frac{5}{7}+\\frac{7}{9}+\\sqrt{2}+\\pi')
    ).toMatchSnapshot());
  test(`Add: one inexact`, () =>
    expect(
      check('1.1+2+5+\\frac{5}{7}+\\frac{7}{9}+\\sqrt{2}+\\pi')
    ).toMatchSnapshot());

  // 0.1 + 2 + 1/4 -> 2.35
  test(`Inexact values propagate`, () =>
    expect(check('0.1 + 2 + \\frac{1}{4}')).toMatchSnapshot());

  // Exact values are grouped together
  // Square rationals are preserved, not reduced
  test(`Exact values are grouped together`, () =>
    expect(
      check('2 + \\frac{1}{4} + \\frac{1}{4} + \\sqrt{5} + \\sqrt{7}')
    ).toMatchSnapshot());

  // If inexact values are canceled, exact values are grouped together
  test(`Canceled inexact values are ignored`, () =>
    expect(
      check('2.12 - 2.12 + \\frac{1}{4} + \\frac{1}{4} + \\sqrt{5} + \\sqrt{7}')
    ).toMatchSnapshot());

  // √5 + √5 = 2√5
  test(`Square rationals are grouped together`, () =>
    expect(check('\\sqrt{5} + \\sqrt{5}')).toMatchSnapshot());
});

describe('ADD', () => {
  test(`Add ['Add']`, () =>
    expect(ce.box(['Add']).evaluate()).toMatchSnapshot());

  test(`Add ['Add', 2.5]`, () =>
    expect(ce.box(['Add', 2.5]).evaluate()).toMatchSnapshot());

  test(`Add ['Add', 2.5, -1.1]`, () =>
    expect(ce.box(['Add', 2.5, -1.1]).evaluate()).toMatchSnapshot());

  test(`Add ['Add', 4, -1.1]`, () =>
    expect(ce.box(['Add', 4, -1.1]).evaluate()).toMatchSnapshot());

  test(`Add \\sqrt{3}+2\\sqrt{3}`, () =>
    expect(ce.parse('\\sqrt{3}+2\\sqrt{3}').evaluate()).toMatchSnapshot());

  test(`Add 8+\\sqrt{3}`, () =>
    expect(ce.parse('8+\\sqrt{3}').evaluate()).toMatchSnapshot());

  test(`Add 8.1+\\sqrt{3}`, () =>
    expect(ce.parse('8.1+\\sqrt{3}').evaluate()).toMatchSnapshot());

  test(`Add ['Add', 2.5, -1.1, 18.4]`, () =>
    expect(ce.box(['Add', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());

  test(`Add \\frac{2}{-3222233}+\\frac{1}{3}`, () =>
    expect(check('\\frac{2}{-3222233}+\\frac{1}{3}')).toMatchSnapshot());

  test(`Add `, () =>
    expect(
      check(
        '2+4+1.5+1.7+\\frac{5}{7}+\\frac{3}{11}+\\sqrt{5}+\\pi+\\sqrt{5}+\\sqrt{4}'
      )
    ).toMatchSnapshot());

  // Expected result: 12144966884186830401015120518973257/150534112785803114146067001510798 = 80.6792
  test(`Add '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'`, () =>
    expect(
      check(
        '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'
      )
    ).toMatchSnapshot());

  test('Add a real to a complex variable', () => {
    expect(ce.parse('z+5').evaluate()).toMatchSnapshot();
  });
});

describe('SUBTRACT', () => {
  test(`Subtract rational and float`, () =>
    expect(
      ce
        .box(['Subtract', ['Multiply', 0.5, 'x'], ['Divide', 'x', 2]])
        .evaluate()
    ).toMatchInlineSnapshot(`0`));

  test(`Subtract`, () =>
    expect(ce.box(['Subtract', 2.5]).evaluate()).toMatchSnapshot());
  test(`Subtract`, () =>
    expect(ce.box(['Subtract', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Subtract with single argument`, () =>
    expect(ce.box(['Subtract', 2.5]).evaluate()).toMatchSnapshot());
  test(`Subtract with multiple arguments`, () =>
    expect(ce.box(['Subtract', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('NEGATE', () => {
  test(`-2`, () => expect(checkJson(['Negate', 2])).toMatchSnapshot());
  test(`-0`, () => expect(checkJson(['Negate', 0])).toMatchSnapshot());
  test(`-(-2.1)`, () => expect(checkJson(['Negate', -2])).toMatchSnapshot());
  test(`-2.5`, () => expect(checkJson(['Negate', 2.5])).toMatchSnapshot());

  test(`-NaN`, () => expect(checkJson(['Negate', 'NaN'])).toMatchSnapshot());

  test(`-(+Infinity)`, () =>
    expect(checkJson(['Negate', { num: '+Infinity' }])).toMatchSnapshot());
  test(`-(-Infinity)`, () =>
    expect(checkJson(['Negate', { num: '-Infinity' }])).toMatchSnapshot());

  test(`-1234567890987654321`, () =>
    expect(
      checkJson(['Negate', { num: '1234567890987654321' }])
    ).toMatchSnapshot());

  test(`-1234567890987654321.123456789`, () =>
    expect(
      checkJson(['Negate', '1234567890987654321.123456789'])
    ).toMatchSnapshot());

  test(`-(1+i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1, 1]])).toMatchSnapshot());

  test(`-(1.1+1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1.1, 1.1]])).toMatchSnapshot());

  test(`-(1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 0, 1.1]])).toMatchSnapshot());

  test(`-(1.1+i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1.1, 1]])).toMatchSnapshot());
  test(`-(1+1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1, 1.1]])).toMatchSnapshot());

  test(`-(2/3)`, () =>
    expect(checkJson(['Negate', ['Rational', 2, 3]])).toMatchSnapshot());

  test(`-(-2/3)`, () =>
    expect(checkJson(['Negate', ['Rational', -2, 3]])).toMatchSnapshot());

  test(`-(1234567890987654321/3)`, () =>
    expect(
      checkJson(['Negate', ['Rational', { num: '1234567890987654321' }, 3]])
    ).toMatchSnapshot());
});

describe('INVALID NEGATE', () => {
  test(`INVALID Negate`, () =>
    expect(ce.box(['Negate', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`INVALID Negate`, () =>
    expect(ce.box(['Negate', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('MULTIPLY', () => {
  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5])).toMatchSnapshot());

  test(`5x2`, () => expect(checkJson(['Multiply', 5, 2])).toMatchSnapshot());

  test(`5x(-2.1)`, () =>
    expect(checkJson(['Multiply', 5, -2.1])).toMatchSnapshot());

  test(`with zero`, () =>
    expect(checkJson(['Multiply', 'x', 2, 3.1, 0])).toMatchSnapshot());

  test(`with NaN`, () =>
    expect(checkJson(['Multiply', 'x', 2, 3.1, 'NaN'])).toMatchSnapshot());

  test(`with <0`, () =>
    expect(checkJson(['Multiply', 'x', -2, 3.1, -5.2])).toMatchSnapshot());

  test(`with +Infinity`, () =>
    expect(
      checkJson(['Multiply', 'x', -2, 3.1, { num: '+Infinity' }])
    ).toMatchSnapshot());

  test(`with -Infinity`, () =>
    expect(
      checkJson([
        'Multiply',
        'x',
        -2,
        3.1,
        'NegativeInfinity',
        { num: '-Infinity' },
      ])
    ).toMatchSnapshot());

  test(`with -Infinity and +Infinity`, () =>
    expect(
      checkJson([
        'Multiply',
        'x',
        -2,
        3.1,
        'PositiveInfinity',
        { num: '-Infinity' },
        { num: '+Infinity' },
      ])
    ).toMatchSnapshot());

  test(`with Nan, -Infinity and +Infinity`, () =>
    expect(
      checkJson([
        'Multiply',
        'x',
        -2,
        3.1,
        'NaN',
        { num: '-Infinity' },
        { num: '+Infinity' },
      ])
    ).toMatchSnapshot());

  test(`2x1234567890987654321`, () =>
    expect(
      checkJson(['Multiply', 2, { num: '1234567890987654321' }])
    ).toMatchSnapshot());

  test(`2x-1234567890987654321.123456789`, () =>
    expect(
      checkJson(['Multiply', 2, '1234567890987654321.123456789'])
    ).toMatchSnapshot());

  test(`2x(1+i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1, 1]])).toMatchSnapshot()); // @fixme should be NaN for mach, big

  test(`2x(1.1+1.1i)`, () =>
    expect(
      checkJson(['Multiply', 2, ['Complex', 1.1, 1.1]])
    ).toMatchSnapshot());

  test(`2x(1.1i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 0, 1.1]])).toMatchSnapshot());

  test(`2x(1.1+i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1.1, 1]])).toMatchSnapshot());
  test(`2x(1+1.1i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1, 1.1]])).toMatchSnapshot());

  test(`2x(2/3)`, () =>
    expect(checkJson(['Multiply', 2, ['Rational', 2, 3]])).toMatchSnapshot());
  test(`2x(-2/3)`, () =>
    expect(checkJson(['Multiply', 2, ['Rational', -2, 3]])).toMatchSnapshot());
  test(`2x(1234567890987654321/3)`, () =>
    expect(
      checkJson([
        'Multiply',
        2,
        ['Rational', { num: '1234567890987654321' }, 3],
      ])
    ).toMatchSnapshot());

  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5, 1.1])).toMatchSnapshot());
  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5, -1.1, 18.4])).toMatchSnapshot());

  test(`Multiply: All exact`, () =>
    expect(check('2\\frac{5}{7}\\times\\frac{7}{9}')).toMatchSnapshot());

  test(`Multiply: All exact with symbol`, () =>
    expect(
      check(
        '2\\times 5\\times\\frac{5}{7}\\times\\frac{7}{9}\\times\\sqrt{2}\\times\\pi'
      )
    ).toMatchSnapshot());

  test(`Multiply: One inexact`, () =>
    expect(
      check(
        '1.1\\times 2\\times 5\\times\\frac{5}{7}\\times\\frac{7}{9}\\times\\sqrt{2}\\times\\pi'
      )
    ).toMatchSnapshot()); // @fixme eval-big should be same or better than evaluate
});

describe('DIVIDE', () => {
  test(`Divide (1/5)/7`, () =>
    expect(
      ce.box(['Divide', ['Divide', 1, 5], 7]).evaluate()
    ).toMatchSnapshot());
  test(`Divide 6/3`, () =>
    expect(ce.box(['Divide', 6, 3]).evaluate()).toMatchSnapshot());
  test(`Divide 2.5/1.1`, () =>
    expect(ce.box(['Divide', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Divide with single argument`, () =>
    expect(ce.box(['Divide', 2.5]).evaluate()).toMatchSnapshot());
  test(`Divide with many arguments`, () =>
    expect(ce.box(['Divide', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('POWER', () => {
  test(`Power with positive real exponent`, () =>
    expect(ce.box(['Power', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Power with negative exponent`, () =>
    expect(ce.box(['Power', 2.5, -3]).evaluate()).toMatchSnapshot());
  test(`Power with negative real exponent`, () =>
    expect(ce.box(['Power', 2.5, -3.2]).evaluate()).toMatchSnapshot());

  test(`INVALID Power`, () =>
    expect(ce.box(['Power', 2.5]).evaluate()).toMatchSnapshot());
  test(`INVALID Power`, () =>
    expect(ce.box(['Power', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('ROOT', () => {
  test(`Root 2.5`, () =>
    expect(ce.box(['Root', 2.5, 3]).evaluate()).toMatchSnapshot());

  test(`Root 5/7`, () =>
    expect(
      ce.box(['Root', ['Rational', 5, 7], 3]).evaluate()
    ).toMatchSnapshot());

  test(`Root 1234567890987654321`, () =>
    expect(
      ce.box(['Root', { num: '1234567890987654321' }, 3]).evaluate()
    ).toMatchSnapshot());

  test(`Root 1234567890987654321.123456789`, () =>
    expect(
      ce.box(['Root', { num: '1234567890987654321.123456789' }, 3]).evaluate()
    ).toMatchSnapshot());

  test(`Root of negative number with even exponent`, () =>
    expect(ce.box(['Root', -2, 2]).N()).toMatchSnapshot());

  test(`Root of negative number with odd exponent`, () =>
    expect(ce.box(['Root', -2, 3]).N()).toMatchSnapshot());
});

describe('INVALID ROOT', () => {
  test(`Too few args`, () =>
    expect(ce.box(['Root', 2.5]).evaluate()).toMatchSnapshot());
  test(`Too many args`, () =>
    expect(ce.box(['Root', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('SQRT', () => {
  test(`√0`, () => expect(checkJson(['Sqrt', 0])).toMatchSnapshot());

  test(`√2.5`, () => {
    expect(checkJson(['Sqrt', 2.5])).toMatchSnapshot();
  });

  test(`√(175)`, () => expect(checkJson(['Sqrt', 175])).toMatchSnapshot());

  test(`√(12345670000000000000000000)`, () =>
    expect(
      checkJson(['Sqrt', { num: '12345670000000000000000000' }])
    ).toMatchSnapshot());

  test(`√(5/7)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 5, 7]])).toMatchSnapshot());

  // √12345678901234567890 = 3 x √1371742100137174210
  test(`√12345678901234567890`, () =>
    expect(
      checkJson(['Sqrt', { num: '12345678901234567890' }])
    ).toMatchSnapshot());

  test(`√123456789.01234567890`, () =>
    expect(
      checkJson(['Sqrt', { num: '123456789.01234567890' }])
    ).toMatchSnapshot());

  test(`√(1000000/49)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 1000000, 49]])).toMatchSnapshot());

  test(`√(1000001/7)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 1000001, 7]])).toMatchSnapshot());

  test(`√(12345678901234567890/23456789012345678901)`, () =>
    expect(
      checkJson([
        'Sqrt',
        [
          'Rational',
          { num: '12345678901234567890' },
          { num: '23456789012345678901' },
        ],
      ])
    ).toMatchSnapshot());

  test(`√(3+4i)`, () =>
    expect(checkJson(['Sqrt', ['Complex', 3, 4]])).toMatchSnapshot());

  test(`√(4x)`, () =>
    expect(checkJson(['Sqrt', ['Multiply', 4, 'x']])).toMatchSnapshot());

  test(`√(3^2)`, () =>
    expect(checkJson(['Sqrt', ['Square', 3]])).toMatchSnapshot());

  test(`√(5x(3+2))`, () =>
    expect(
      checkJson(['Sqrt', ['Multiply', 5, ['Add', 3, 2]]])
    ).toMatchSnapshot());

  test('√ of list', () => {
    expect(
      ce
        .box(['Sqrt', ['List', 4, 1, 56, 18]])
        .N()
        .toString()
    ).toMatchSnapshot();
  });

  test(`INVALID Sqrt`, () =>
    expect(checkJson(['Sqrt', 2.5, 1.1])).toMatchSnapshot());
  test(`INVALID  Sqrt`, () =>
    expect(checkJson(['Sqrt', 2.5, -1.1, 18.4])).toMatchSnapshot());
});

describe('Square', () => {
  test(`Square`, () => expect(checkJson(['Square', 2.5])).toMatchSnapshot());
  test(`INVALID Square`, () =>
    expect(checkJson(['Square', 2.5, 1.1])).toMatchSnapshot());
  test(`INVALID Square`, () =>
    expect(checkJson(['Square', 2.5, -1.1, 18.4])).toMatchSnapshot());
});

describe('Min/Max', () => {
  test(`Max`, () => {
    expect(checkJson(['Max', 2.5])).toMatchSnapshot();
    expect(checkJson(['Max', 2.5, 1.1])).toMatchSnapshot();
    expect(checkJson(['Max', 2.5, -1.1, 18.4])).toMatchSnapshot();
  });
  expect(checkJson(['Max', 2.5, -1.1, 'NaN', 18.4])).toMatchSnapshot();
  expect(checkJson(['Max', 2.5, -1.1, 'foo', 18.4])).toMatchSnapshot();
  expect(checkJson(['Max', 'foo', 'bar'])).toMatchSnapshot();

  expect(ce.box(['Max', ['Range', 1, 10]]).N().value).toMatchInlineSnapshot(
    `10`
  );

  expect(ce.box(['Max', ['Range', 1.2, 4.5]]).N().value).toMatchInlineSnapshot(
    `5`
  );

  expect(ce.box(['Max', ['Range', 1, 10, 7]]).N().value).toMatchInlineSnapshot(
    `8`
  );
  expect(
    ce.box(['Max', ['Interval', 1.1, 7.8]]).N().value
  ).toMatchInlineSnapshot(`7.8`);
  expect(
    ce.box(['Max', ['List', 4, 1, 56, 18]]).N().value
  ).toMatchInlineSnapshot(`56`);
  expect(
    ce.box(['Max', ['Set', 4, 1, 56, 18]]).N().value
  ).toMatchInlineSnapshot(`56`);

  expect(
    ce
      .box(['Max', ['List', 4, 1, 'bar', 56, 'foo', 18]])
      .N()
      .toString()
  ).toMatchInlineSnapshot(`max(56, "bar", "foo")`);
  test(`Min`, () =>
    expect(checkJson(['Min', 2.5])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5]
      simplify  = 2.5
    `));
  expect(checkJson(['Min', 2.5, 1.1])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, 1.1]
      eval-auto = 1.1
    `);
  expect(checkJson(['Min', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, 18.4]
      eval-auto = -1.1
    `);
  expect(checkJson(['Min', 2.5, -1.1, 'NaN', 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, "NaN", 18.4]
      eval-auto = NaN
    `);
  expect(checkJson(['Min', 2.5, -1.1, 'foo', 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, "foo", 18.4]
      eval-auto = min(-1.1, "foo")
    `);
  expect(checkJson(['Min', 'foo', 'bar'])).toMatchInlineSnapshot(
    `["Min", "foo", "bar"]`
  );

  expect(ce.box(['Min', ['Range', 1, 10]]).N().value).toMatchInlineSnapshot(
    `1`
  );

  expect(ce.box(['Min', ['Range', 1.2, 4.5]]).N().value).toMatchInlineSnapshot(
    `1`
  );
  expect(ce.box(['Min', ['Range', 1, 10, 7]]).N().value).toMatchInlineSnapshot(
    `1`
  );
  expect(
    ce.box(['Min', ['Interval', 1.1, 7.8]]).N().value
  ).toMatchInlineSnapshot(`1.1`);
});

describe('RATIONAL', () => {
  test(`Rational`, () =>
    expect(checkJson(['Rational', 3, 4])).toMatchSnapshot());

  test(`Bignum rational`, () =>
    expect(
      checkJson([
        'Rational',
        { num: '12345678901234567890' },
        { num: '23456789012345678901' },
      ])
    ).toMatchSnapshot());

  test(`INVALID Rational`, () => {
    expect(checkJson(['Rational', 2.5, -1.1, 18.4])).toMatchSnapshot();
    expect(checkJson(['Rational', 2, 3, 5])).toMatchSnapshot();
  });
  test(`Rational as Divide`, () =>
    expect(checkJson(['Rational', 3.1, 2.8])).toMatchSnapshot());
  test(`Rational approximation`, () =>
    expect(checkJson(['Rational', 2.5])).toMatchSnapshot());
  test(`Rational approximation`, () =>
    expect(checkJson(['Rational', 'Pi'])).toMatchSnapshot());
});

describe('Log', () => {
  test(`Log 1.1`, () => expect(checkJson(['Log', 1.1])).toMatchSnapshot());
  test(`Log 1`, () => expect(checkJson(['Log', 1])).toMatchSnapshot());
  test(`Log 0`, () => expect(checkJson(['Log', 0])).toMatchSnapshot());
  test(`Log -1`, () => expect(checkJson(['Log', -1])).toMatchSnapshot());
  test(`Log -2`, () => expect(checkJson(['Log', -2])).toMatchSnapshot());
  test(`Log 'Pi'`, () => expect(checkJson(['Log', 'Pi'])).toMatchSnapshot());
  test(`Log ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Log', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('LN', () => {
  test(`Ln 1.1`, () => expect(checkJson(['Ln', 1.1])).toMatchSnapshot());
  test(`Ln 1`, () => expect(checkJson(['Ln', 1])).toMatchSnapshot());
  test(`Ln 0`, () => expect(checkJson(['Ln', 0])).toMatchSnapshot());
  test(`Ln -1`, () => expect(checkJson(['Ln', -1])).toMatchSnapshot());
  test(`Ln -2`, () => expect(checkJson(['Ln', -2])).toMatchSnapshot());
  test(`Ln 'Pi'`, () => expect(checkJson(['Ln', 'Pi'])).toMatchSnapshot());
  test(`Ln ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Ln', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('LB', () => {
  test(`Lb 1.1`, () => expect(checkJson(['Lb', 1.1])).toMatchSnapshot());
  test(`Lb 1`, () => expect(checkJson(['Lb', 1])).toMatchSnapshot());
  test(`Lb 0`, () => expect(checkJson(['Lb', 0])).toMatchSnapshot());
  test(`Lb -1`, () => expect(checkJson(['Lb', -1])).toMatchSnapshot());
  test(`Lb -2`, () => expect(checkJson(['Lb', -2])).toMatchSnapshot());
  test(`Lb 'Pi'`, () => expect(checkJson(['Lb', 'Pi'])).toMatchSnapshot());
  test(`Lb ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Lb', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('LG', () => {
  test(`LG 1.1`, () => expect(checkJson(['Lg', 1.1])).toMatchSnapshot());
  test(`LG 1`, () => expect(checkJson(['Lg', 1])).toMatchSnapshot());
  test(`LG 0`, () => expect(checkJson(['Lg', 0])).toMatchSnapshot());
  test(`LG -1`, () => expect(checkJson(['Lg', -1])).toMatchSnapshot());
  test(`LG 'Pi'`, () => expect(checkJson(['Lg', 'Pi'])).toMatchSnapshot());
  test(`LG ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Lg', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('LOG(a,b)', () => {
  test(`Log 1.1, 5`, () =>
    expect(checkJson(['Log', 1.1, 5])).toMatchSnapshot());
  test(`Log 1, 5`, () => expect(checkJson(['Log', 1, 5])).toMatchSnapshot());
  test(`Log 0, 5`, () => expect(checkJson(['Log', 0, 5])).toMatchSnapshot());
  test(`Log -1, 5`, () => expect(checkJson(['Log', -1, 5])).toMatchSnapshot());
  test(`Log 'Pi', 5`, () =>
    expect(checkJson(['Log', 'Pi', 5])).toMatchSnapshot());
  test(`Log ['Complex', 1.1, 1.1], 5`, () =>
    expect(checkJson(['Log', ['Complex', 1.1, 1.1], 5])).toMatchSnapshot());
});

describe('INVALID LOG', () => {
  test(`Ln`, () => expect(checkJson(['Ln'])).toMatchSnapshot());
  test(`Ln with string argument`, () =>
    expect(checkJson(['Ln', "'string'"])).toMatchSnapshot());
  test(`Ln with two numeric arguments`, () =>
    expect(checkJson(['Ln', 3, 4])).toMatchSnapshot());
});

describe('EXP', () => {
  test(`Exp 1.1`, () => expect(checkJson(['Exp', 1.1])).toMatchSnapshot());
  test(`Exp 1`, () => expect(checkJson(['Exp', 1])).toMatchSnapshot());
  test(`Exp 0`, () => expect(checkJson(['Exp', 0])).toMatchSnapshot());
  test(`Exp -1`, () => expect(checkJson(['Exp', -1])).toMatchSnapshot());
  test(`Exp 'Pi'`, () => expect(checkJson(['Exp', 'Pi'])).toMatchSnapshot());
  test(`Exp ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Exp', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
  test(`Exp ['List', 1.1, 2, 4]`, () =>
    expect(checkJson(['Exp', ['List', 1.1, 2, 4]])).toMatchSnapshot());
});

describe('SUM', () => {
  it('should compute the sum of a function over a closed interval', () =>
    expect(
      ce
        .box(['Sum', ['Divide', 1, 'x'], ['Tuple', 'x', 1, 10]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`7381/2520`));

  it('should compute the sum of a function over an open interval', () =>
    expect(
      ce
        .box(['Sum', ['Divide', 1, 'x'], 'x'])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`44057567621371730/3061099221058841`));

  it('should compute the sum of a collection', () =>
    expect(
      ce
        .box(['Sum', ['Range', 1, 10]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`55`));

  it('should compute the sum of a function over two indices (with optional Hold)', () =>
    expect(
      ce
        .box([
          'Sum',
          ['Multiply', 'i', 'j'],
          ['Tuple', ['Hold', 'i'], 1, 10],
          ['Tuple', 'j', 3, 13],
        ])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`4840`));

  // Regression tests for issue #252: Sum with free variables
  it('should handle sum with free variable (issue #252)', () =>
    expect(
      ce.parse('\\sum_{n=1}^{10}(x)').evaluate().toString()
    ).toMatchInlineSnapshot(`10x`));

  it('should handle sum with mixed index and free variable (issue #252)', () =>
    expect(
      ce.parse('\\sum_{n=1}^{10}(n \\cdot x)').evaluate().toString()
    ).toMatchInlineSnapshot(`55x`));

  it('should handle sum with addition of index and free variable (issue #252)', () =>
    expect(
      ce
        .parse('\\sum_{n=1}^{3}(n + x)')
        .evaluate()
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`3x + 6`));
});

describe('PRODUCT', () => {
  it('should compute the product of a collection', () =>
    expect(
      ce.box(['Product', ['Range', 1, 5]]).evaluate().toString()
    ).toMatchInlineSnapshot(`120`));

  it('should compute the product of a function over an interval', () =>
    expect(
      ce
        .box(['Product', 'n', ['Tuple', 'n', 1, 5]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`120`));

  // Regression tests for issue #252: Product with free variables
  it('should handle product with free variable (issue #252)', () =>
    expect(
      ce.parse('\\prod_{n=1}^{5}(x)').evaluate().toString()
    ).toMatchInlineSnapshot(`x^5`));

  it('should handle product with mixed index and free variable (issue #252)', () =>
    expect(
      ce.parse('\\prod_{n=1}^{3}(n \\cdot x)').evaluate().toString()
    ).toMatchInlineSnapshot(`6x^3`));
});

describe('GCD/LCM', () => {
  it('should compute the GCD of two integers', () => {
    expect(ce.box(['GCD', 60, 12]).evaluate().toString()).toMatchInlineSnapshot(
      `12`
    );

    expect(ce.box(['GCD', 10, 15]).evaluate().toString()).toMatchInlineSnapshot(
      `5`
    );
  });

  it('should compute the LCM of two integers', () => {
    expect(ce.box(['LCM', 60, 12]).evaluate().toString()).toMatchInlineSnapshot(
      `60`
    );
    expect(ce.box(['LCM', 10, 15]).evaluate().toString()).toMatchInlineSnapshot(
      `30`
    );
  });

  it('should compute the GCD of some integers and other stuff', () =>
    expect(
      ce.box(['GCD', 60, 'foo', 12]).evaluate().toString()
    ).toMatchInlineSnapshot(`gcd(12, "foo")`));

  it('should compute the GCD of only stuff', () =>
    expect(
      ce.box(['GCD', 'foo', 'bar']).evaluate().toString()
    ).toMatchInlineSnapshot(`gcd("foo", "bar")`));

  it('should compute the GCD of a single number', () =>
    expect(ce.box(['GCD', 42]).evaluate().toString()).toMatchInlineSnapshot(
      `42`
    ));

  it('should compute the GCD of some numbers', () =>
    expect(
      ce.box(['GCD', 60, 12, 3.1415]).evaluate().toString()
    ).toMatchInlineSnapshot(`gcd(12, 3.1415)`));

  it('should compute the GCD of a list', () =>
    expect(
      ce
        .box(['GCD', ['List', 60, 12, 3.1415]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`gcd([60,12,3.1415])`));

  it('should compute the LCM of some integers and other stuff', () =>
    expect(
      ce.box(['LCM', 60, 'foo', 12]).evaluate().toString()
    ).toMatchInlineSnapshot(`lcm(60, "foo")`));

  it('should compute the LCM of only stuff', () =>
    expect(
      ce.box(['LCM', 'foo', 'bar']).evaluate().toString()
    ).toMatchInlineSnapshot(`lcm("foo", "bar")`));

  it('should compute the LCM of a single number', () =>
    expect(ce.box(['LCM', 42]).evaluate().toString()).toMatchInlineSnapshot(
      `42`
    ));

  it('should compute the LCM of some numbers', () =>
    expect(
      ce.box(['LCM', 60, 12, 3.1415]).evaluate().toString()
    ).toMatchInlineSnapshot(`lcm(60, 3.1415)`));

  it('should compute the LCM of a list', () =>
    expect(
      ce
        .box(['LCM', ['List', 60, 12, 3.1415]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`lcm([60,12,3.1415])`));
});

describe('FACTOR', () => {
  it('should factor a relational operator with fractional roots', () =>
    expect(
      ce
        .box(['Factor', ce.parse('\\sqrt{7}\\sqrt{35}x^2 \\lt \\sqrt{5}x')])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`7x^2 < x`));

  it('should factor integers', () =>
    expect(
      ce
        .box(['Factor', ce.parse('2a \\lt 4b')])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`a < 2b`));

  it('should factor additions', () =>
    expect(
      ce
        .box(['Factor', ce.parse('\\sqrt{3}x+2\\sqrt{3}x')])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`3sqrt(3) * x`));
});
