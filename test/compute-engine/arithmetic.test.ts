import { check, checkJson, engine } from '../utils';

engine.jsonSerializationOptions = { precision: 20 };
const ce = engine;

describe('CONSTANTS', () => {
  test(`ExponentialE`, () =>
    expect(checkJson(`ExponentialE`)).toMatchInlineSnapshot(`
      box       = ExponentialE
      N-auto    = 2.7182818284590452354
      N-mach    = 2.718281828459045
    `));
  test(`ImaginaryUnit`, () =>
    expect(checkJson(`ImaginaryUnit`)).toMatchInlineSnapshot(`
      box       = ImaginaryUnit
      evaluate  = ["Complex", 0, 1]
      eval-big  = {num: "NaN"}
      eval-mach = {num: "NaN"}
      eval-cplx = ["Complex", 0, 1]
    `));
  test(`MachineEpsilon`, () =>
    expect(checkJson(`MachineEpsilon`)).toMatchInlineSnapshot(`
      box       = MachineEpsilon
      N-auto    = 2.220446049250313e-16
    `));
  test(`CatalanConstant`, () =>
    expect(checkJson(`CatalanConstant`)).toMatchInlineSnapshot(`
      box       = CatalanConstant
      N-auto    = 0.91596559417721901505
      N-mach    = 0.915965594177219
    `));
  test(`GoldenRatio`, () =>
    expect(checkJson(`GoldenRatio`)).toMatchInlineSnapshot(`
      box       = GoldenRatio
      simplify  = ["Multiply", ["Rational", 1, 2], ["Add", 1, ["Sqrt", 5]]]
      N-auto    = 1.6180339887498948482
      N-mach    = 1.618033988749895
    `));
  test(`EulerGamma`, () =>
    expect(checkJson(`EulerGamma`)).toMatchInlineSnapshot(`
      box       = EulerGamma
      N-auto    = 0.57721566490153286061
      N-mach    = 0.5772156649015329
    `));
});

describe('RELATIONAL OPERATOR', () => {
  test(`Equal`, () =>
    expect(ce.box(['Equal', 5, 5]).evaluate()).toMatchInlineSnapshot(`True`));
  test(`Equal`, () =>
    expect(ce.box(['Equal', 11, 7]).evaluate()).toMatchInlineSnapshot(`False`));
  test(`NotEqual`, () =>
    expect(ce.box(['NotEqual', 5, 5]).evaluate()).toMatchInlineSnapshot(
      `False`
    ));
  test(`NotEqual`, () =>
    expect(ce.box(['NotEqual', 11, 7]).evaluate()).toMatchInlineSnapshot(
      `True`
    ));
  test(`Greater`, () =>
    expect(ce.box(['Greater', 3, 19]).evaluate()).toMatchInlineSnapshot(
      `False`
    ));
  test(`Greater`, () =>
    expect(ce.box(['Greater', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `True`
    ));
  test(`Less`, () =>
    expect(ce.box(['Less', 3, 19]).evaluate()).toMatchInlineSnapshot(`True`));
  test(`Less`, () =>
    expect(ce.box(['Less', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `False`
    ));
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 3, 3]).evaluate()).toMatchInlineSnapshot(
      `True`
    ));
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 3, 19]).evaluate()).toMatchInlineSnapshot(
      `False`
    ));
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `True`
    ));
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 3, 3]).evaluate()).toMatchInlineSnapshot(
      `True`
    ));
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 3, 19]).evaluate()).toMatchInlineSnapshot(
      `True`
    ));
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `False`
    ));
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
    expect(check('\\sqrt{5}')).toMatchInlineSnapshot(`
      latex     = ["Sqrt", 5]
      box       = ["Sqrt", 5]
      N-auto    = 2.2360679774997896964
      N-mach    = 2.23606797749979
    `));
  test(`Sqrt: Exact rational`, () =>
    expect(check('\\sqrt{\\frac{5}{7}}')).toMatchInlineSnapshot(`
      latex     = ["Sqrt", ["Rational", 5, 7]]
      box       = ["Sqrt", ["Rational", 5, 7]]
      N-auto    = 0.84515425472851657751
      N-mach    = 0.8451542547285166
    `));
  test(`Sqrt: Inexact Fractional part`, () =>
    expect(check('\\sqrt{5.1}')).toMatchInlineSnapshot(`
      latex     = ["Sqrt", 5.1]
      box       = ["Sqrt", 5.1]
      evaluate  = 2.258317958127242985
      eval-mach = 2.258317958127243
    `));

  test(`Cos: Exact integer`, () =>
    expect(check('\\cos{5}')).toMatchInlineSnapshot(`
      latex     = ["Cos", 5]
      box       = ["Cos", 5]
      simplify  = [
        "Divide",
        [
          "Subtract",
          [
            "Exp",
            [
              "Multiply",
              "ImaginaryUnit",
              ["Add", 5, ["Multiply", ["Rational", 1, 2], "Pi"]]
            ]
          ],
          [
            "Exp",
            [
              "Multiply",
              "ImaginaryUnit",
              ["Subtract", ["Multiply", ["Rational", -1, 2], "Pi"], 5]
            ]
          ]
        ],
        ["Complex", 0, 2]
      ]
      evaluate  = ["Cos", 5]
      N-auto    = 0.28366218546322626447
      N-mach    = 0.28366218546322625
    `));

  test(`Cos: Exact rational`, () =>
    expect(check('\\cos{\\frac{5}{7}}')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["Rational", 5, 7]]
      box       = ["Cos", ["Rational", 5, 7]]
      simplify  = [
        "Divide",
        [
          "Subtract",
          [
            "Exp",
            [
              "Multiply",
              "ImaginaryUnit",
              [
                "Add",
                ["Rational", 5, 7],
                ["Multiply", ["Rational", 1, 2], "Pi"]
              ]
            ]
          ],
          [
            "Exp",
            [
              "Multiply",
              "ImaginaryUnit",
              [
                "Subtract",
                ["Multiply", ["Rational", -1, 2], "Pi"],
                ["Rational", 5, 7]
              ]
            ]
          ]
        ],
        ["Complex", 0, 2]
      ]
      evaluate  = ["Cos", ["Rational", 5, 7]]
      N-auto    = 0.75556134670069659847
      N-mach    = 0.7555613467006966
    `));
  test(`Cos: Inexact Fractional part`, () =>
    expect(check('\\cos(5.1)')).toMatchInlineSnapshot(`
      latex     = ["Cos", 5.1]
      box       = ["Cos", 5.1]
      simplify  = [
        "Divide",
        [
          "Subtract",
          [
            "Exp",
            [
              "Multiply",
              "ImaginaryUnit",
              ["Add", 5.1, ["Multiply", ["Rational", 1, 2], "Pi"]]
            ]
          ],
          [
            "Exp",
            [
              "Multiply",
              "ImaginaryUnit",
              ["Add", -5.1, ["Multiply", ["Rational", -1, 2], "Pi"]]
            ]
          ]
        ],
        ["Complex", 0, 2]
      ]
      evaluate  = 0.37797774271298056332
      eval-mach = 0.37797774271298024
    `));
  test(`Cos: Pi (simplify constructible value)`, () =>
    expect(check('\\cos{\\pi}')).toMatchInlineSnapshot(`
      latex     = ["Cos", "Pi"]
      box       = ["Cos", "Pi"]
      simplify  = -1
    `));

  test(`Add: All exact`, () =>
    expect(check('6+\\frac{10}{14}+\\sqrt{\\frac{18}{9}}'))
      .toMatchInlineSnapshot(`
      latex     = ["Add", 6, ["Rational", 10, 14], ["Sqrt", ["Rational", 18, 9]]]
      box       = ["Add", ["Rational", 5, 7], 6, ["Sqrt", 2]]
      simplify  = ["Add", ["Rational", 47, 7], ["Sqrt", 2]]
      N-auto    = 8.1284992766588093345
      N-mach    = 8.12849927665881
    `));

  test(`Add: All exact`, () =>
    expect(check('6+\\sqrt{2}+\\sqrt{5}')).toMatchInlineSnapshot(`
      latex     = ["Add", 6, ["Sqrt", 2], ["Sqrt", 5]]
      box       = ["Add", 6, ["Sqrt", 2], ["Sqrt", 5]]
      N-auto    = 9.6502815398728847452
      N-mach    = 9.650281539872886
    `));

  test(`Add: All exact`, () =>
    expect(check('2+5+\\frac{5}{7}+\\frac{7}{9}+\\sqrt{2}+\\pi'))
      .toMatchInlineSnapshot(`
      latex     = [
        "Add",
        2,
        5,
        ["Rational", 5, 7],
        ["Rational", 7, 9],
        ["Sqrt", 2],
        "Pi"
      ]
      box       = [
        "Add",
        ["Rational", 5, 7],
        ["Rational", 7, 9],
        2,
        5,
        ["Sqrt", 2],
        "Pi"
      ]
      simplify  = ["Add", ["Rational", 535, 63], ["Sqrt", 2], "Pi"]
      N-auto    = 13.047869708026380351
      N-mach    = 13.047869708026381
      N-cplx   = 13.04786970802638
    `));
  test(`Add: one inexact`, () =>
    expect(check('1.1+2+5+\\frac{5}{7}+\\frac{7}{9}+\\sqrt{2}+\\pi'))
      .toMatchInlineSnapshot(`
      latex     = [
        "Add",
        1.1,
        2,
        5,
        ["Rational", 5, 7],
        ["Rational", 7, 9],
        ["Sqrt", 2],
        "Pi"
      ]
      box       = [
        "Add",
        ["Rational", 5, 7],
        ["Rational", 7, 9],
        1.1,
        2,
        5,
        ["Sqrt", 2],
        "Pi"
      ]
      simplify  = ["Add", 1.1, ["Rational", 535, 63], ["Sqrt", 2], "Pi"]
      evaluate  = 14.147869708026380351
      eval-mach = 14.14786970802638
    `));
});

describe('ADD', () => {
  test(`Add ['Add']`, () =>
    expect(ce.box(['Add']).evaluate()).toMatchInlineSnapshot(`0`));

  test(`Add ['Add', 2.5]`, () =>
    expect(ce.box(['Add', 2.5]).evaluate()).toMatchInlineSnapshot(`2.5`));

  test(`Add ['Add', 2.5, -1.1]`, () =>
    expect(ce.box(['Add', 2.5, -1.1]).evaluate()).toMatchInlineSnapshot(`1.4`));
  test(`Add ['Add', 2.5, -1.1, 18.4]`, () =>
    expect(ce.box(['Add', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `19.8`
    ));

  test(`Add \\frac{2}{-3222233}+\\frac{1}{3}`, () =>
    expect(check('\\frac{2}{-3222233}+\\frac{1}{3}')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Divide", 2, -3222233], ["Rational", 1, 3]]
      box       = ["Subtract", ["Rational", 1, 3], ["Rational", 2, 3222233]]
      simplify  = ["Rational", 3222227, 9666699]
      N-auto    = 0.33333271264575425386
      N-mach    = 0.33333271264575426
    `));

  test(`Add `, () =>
    expect(
      check(
        '2+4+1.5+1.7+\\frac{5}{7}+\\frac{3}{11}+\\sqrt{5}+\\pi+\\sqrt{5}+\\sqrt{4}'
      )
    ).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        2,
        4,
        1.5,
        1.7,
        ["Rational", 5, 7],
        ["Rational", 3, 11],
        ["Sqrt", 5],
        "Pi",
        ["Sqrt", 5],
        ["Sqrt", 4]
      ]
      box       = [
        "Add",
        ["Rational", 3, 11],
        ["Rational", 5, 7],
        1.5,
        1.7,
        2,
        2,
        4,
        ["Sqrt", 5],
        ["Sqrt", 5],
        "Pi"
      ]
      simplify  = ["Add", 3.2, ["Rational", 692, 77], ["Multiply", 2, ["Sqrt", 5]], "Pi"]
      evaluate  = 19.800741595602359644
      eval-mach = 19.80074159560236
    `));

  // Expected result: 12144966884186830401015120518973257/150534112785803114146067001510798 = 80.6792
  test(`Add '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'`, () =>
    expect(
      check(
        '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'
      )
    ).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        ["Rational", 2, 3],
        ["Rational", "12345678912345678", "987654321987654321"],
        ["Rational", "987654321987654321", "12345678912345678"]
      ]
      box       = [
        "Add",
        ["Divide", 1371742101371742, "109739369109739369"],
        ["Rational", 2, 3],
        ["Divide", "109739369109739369", 1371742101371742]
      ]
      canonical = [
        "Add",
        ["Rational", 1371742101371742, "109739369109739369"],
        ["Rational", 2, 3],
        ["Rational", "109739369109739369", 1371742101371742]
      ]
      simplify  = [
        "Rational",
        "12144966884186830401015120518973257",
        "150534112785803114146067001510798"
      ]
      N-auto    = 80.679167395552772882
      N-mach    = 80.67916739555278
    `));
});
describe('Subtract', () => {
  test(`Subtract`, () =>
    expect(ce.box(['Subtract', 2.5]).evaluate()).toMatchInlineSnapshot(`-2.5`));
  test(`Subtract`, () =>
    expect(ce.box(['Subtract', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `1.4`
    ));
  test(`INVALID Subtract`, () =>
    expect(
      ce.box(['Subtract', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(
      `["Subtract", 2.5, -1.1, ["Error", "'unexpected-argument'", 18.4]]`
    ));
});

describe('NEGATE', () => {
  test(`-2`, () =>
    expect(checkJson(['Negate', 2])).toMatchInlineSnapshot(`-2`));
  test(`-0`, () => expect(checkJson(['Negate', 0])).toMatchInlineSnapshot(`0`));
  test(`-(-2.1)`, () =>
    expect(checkJson(['Negate', -2])).toMatchInlineSnapshot(`2`));
  test(`-2.5`, () =>
    expect(checkJson(['Negate', 2.5])).toMatchInlineSnapshot(`-2.5`));

  test(`-NaN`, () =>
    expect(checkJson(['Negate', 'NaN'])).toMatchInlineSnapshot(`{num: "NaN"}`));

  test(`-(+Infinity)`, () =>
    expect(checkJson(['Negate', '+Infinity'])).toMatchInlineSnapshot(
      `{num: "-Infinity"}`
    ));
  test(`-(-Infinity)`, () =>
    expect(checkJson(['Negate', '-Infinity'])).toMatchInlineSnapshot(
      `{num: "+Infinity"}`
    ));

  test(`-1234567890987654321`, () =>
    expect(
      checkJson(['Negate', { num: '1234567890987654321' }])
    ).toMatchInlineSnapshot(`-1234567890987654321`));

  test(`-1234567890987654321.123456789`, () =>
    expect(
      checkJson(['Negate', '1234567890987654321.123456789'])
    ).toMatchInlineSnapshot(`-1234567890987654321.1`));

  test(`-(1+i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1, 1]])).toMatchInlineSnapshot(
      `["Complex", -1, -1]`
    ));

  test(`-(1.1+1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1.1, 1.1]])).toMatchInlineSnapshot(
      `["Complex", -1.1, -1.1]`
    ));

  test(`-(1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 0, 1.1]])).toMatchInlineSnapshot(
      `["Complex", 0, -1.1]`
    ));

  test(`-(1.1+i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1.1, 1]])).toMatchInlineSnapshot(
      `["Complex", -1.1, -1]`
    ));
  test(`-(1+1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1, 1.1]])).toMatchInlineSnapshot(
      `["Complex", -1, -1.1]`
    ));

  test(`-(2/3)`, () =>
    expect(checkJson(['Negate', ['Rational', 2, 3]])).toMatchInlineSnapshot(`
      box       = ["Rational", -2, 3]
      N-auto    = -0.(6)
      N-mach    = -0.6666666666666666
    `));
  test(`-(-2/3)`, () =>
    expect(checkJson(['Negate', ['Rational', -2, 3]])).toMatchInlineSnapshot(`
      box       = ["Rational", 2, 3]
      N-auto    = 0.(6)
      N-mach    = 0.6666666666666666
    `));
  test(`-(1234567890987654321/3)`, () =>
    expect(
      checkJson(['Negate', ['Rational', { num: '1234567890987654321' }, 3]])
    ).toMatchInlineSnapshot(`-411522630329218107`));
});

describe('INVALID NEGATE', () => {
  test(`INVALID Negate`, () =>
    expect(ce.box(['Negate', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `["Negate", 2.5, ["Error", "'unexpected-argument'", 1.1]]`
    ));
  test(`INVALID Negate`, () =>
    expect(ce.box(['Negate', 2.5, -1.1, 18.4]).evaluate())
      .toMatchInlineSnapshot(`
      [
        "Negate",
        2.5,
        ["Error", "'unexpected-argument'", -1.1],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `));
});

describe('MULTIPLY', () => {
  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5])).toMatchInlineSnapshot(`
      box       = ["Multiply", 2.5]
      canonical = 2.5
    `));

  test(`5x2`, () =>
    expect(checkJson(['Multiply', 5, 2])).toMatchInlineSnapshot(`
      box       = ["Multiply", 5, 2]
      canonical = 10
    `));

  test(`5x(-2.1)`, () =>
    expect(checkJson(['Multiply', 5, -2.1])).toMatchInlineSnapshot(`
      box       = ["Multiply", 5, -2.1]
      canonical = ["Multiply", -5, 2.1]
      evaluate  = -10.5
    `));

  test(`with zero`, () =>
    expect(checkJson(['Multiply', 'x', 2, 3.1, 0])).toMatchInlineSnapshot(`
      box       = ["Multiply", "x", 2, 3.1, 0]
      canonical = 0
    `));
  test(`with NaN`, () =>
    expect(checkJson(['Multiply', 'x', 2, 3.1, 'NaN'])).toMatchInlineSnapshot(`
      box       = ["Multiply", "x", 2, 3.1, {num: "NaN"}]
      canonical = {num: "NaN"}
    `));
  test(`with <0`, () =>
    expect(checkJson(['Multiply', 'x', -2, 3.1, -5.2])).toMatchInlineSnapshot(`
      box       = ["Multiply", "x", -2, 3.1, -5.2]
      canonical = ["Multiply", 2, 16.12, "x"]
      evaluate  = ["Multiply", 32.24, "x"]
    `));

  test(`with +Infinity`, () =>
    expect(checkJson(['Multiply', 'x', -2, 3.1, '+Infinity']))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", "x", -2, 3.1, {num: "+Infinity"}]
      canonical = ["Multiply", -2, 3.1, {num: "+Infinity"}, "x"]
      evaluate  = {num: "+Infinity"}
    `));

  test(`with -Infinity`, () =>
    expect(checkJson(['Multiply', 'x', -2, 3.1, '-Infinity']))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", "x", -2, 3.1, {num: "-Infinity"}]
      canonical = ["Multiply", 2, 3.1, {num: "+Infinity"}, "x"]
      evaluate  = {num: "+Infinity"}
    `));

  test(`with -Infinity and +Infinity`, () =>
    expect(checkJson(['Multiply', 'x', -2, 3.1, '-Infinity', '+Infinity']))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", "x", -2, 3.1, {num: "-Infinity"}, {num: "+Infinity"}]
      canonical = ["Multiply", 2, 3.1, {num: "+Infinity"}, "x"]
      evaluate  = {num: "+Infinity"}
    `));

  test(`2x1234567890987654321`, () =>
    expect(checkJson(['Multiply', 2, { num: '1234567890987654321' }]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, "1234567890987654321"]
      canonical = 2469135781975308642
    `));

  test(`2x-1234567890987654321.123456789`, () =>
    expect(checkJson(['Multiply', 2, '1234567890987654321.123456789']))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, "1234567890987654321.1"]
      evaluate  = 2469135781975308642.2
      eval-mach = 2469135781975309000
    `));

  test(`2x(1+i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1, 1]]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Complex", 1, 1]]
      N-auto    = ["Complex", 2, 2]
      N-big     = {num: "NaN"}
      N-cplx   = ["Complex", 2, 2]
    `)); // @fixme should be NaN for mach, big

  test(`2x(1.1+1.1i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1.1, 1.1]]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Complex", 1.1, 1.1]]
      evaluate  = ["Complex", 2.2, 2.2]
      eval-big  = {num: "NaN"}
      eval-mach = {num: "NaN"}
      eval-cplx = ["Complex", 2.2, 2.2]
    `));

  test(`2x(1.1i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 0, 1.1]]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Complex", 0, 1.1]]
      evaluate  = ["Complex", 0, 2.2]
      eval-big  = {num: "NaN"}
      eval-mach = {num: "NaN"}
      eval-cplx = ["Complex", 0, 2.2]
    `));

  test(`2x(1.1+i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1.1, 1]]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Complex", 1.1, 1]]
      evaluate  = ["Complex", 2.2, 2]
      eval-big  = {num: "NaN"}
      eval-mach = {num: "NaN"}
      eval-cplx = ["Complex", 2.2, 2]
    `));
  test(`2x(1+1.1i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1, 1.1]]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Complex", 1, 1.1]]
      evaluate  = ["Complex", 2, 2.2]
      eval-big  = {num: "NaN"}
      eval-mach = {num: "NaN"}
      eval-cplx = ["Complex", 2, 2.2]
    `));

  test(`2x(2/3)`, () =>
    expect(checkJson(['Multiply', 2, ['Rational', 2, 3]]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Rational", 2, 3]]
      canonical = ["Rational", 4, 3]
      N-auto    = 1.(3)
      N-mach    = 1.3333333333333333
    `));
  test(`2x(-2/3)`, () =>
    expect(checkJson(['Multiply', 2, ['Rational', -2, 3]]))
      .toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Rational", -2, 3]]
      canonical = ["Rational", -4, 3]
      N-auto    = -1.(3)
      N-mach    = -1.3333333333333333
    `));
  test(`2x(1234567890987654321/3)`, () =>
    expect(
      checkJson([
        'Multiply',
        2,
        ['Rational', { num: '1234567890987654321' }, 3],
      ])
    ).toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Rational", "1234567890987654321", 3]]
      canonical = 823045260658436214
    `));

  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5, 1.1])).toMatchInlineSnapshot(`
      box       = ["Multiply", 2.5, 1.1]
      canonical = 2.75
    `));
  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Multiply", 2.5, -1.1, 18.4]
      canonical = -50.6
      evaluate  = -50.6
      eval-mach = -50.599999999999994
    `));

  test(`Multiply: All exact`, () =>
    expect(check('2\\frac{5}{7}\\times\\frac{7}{9}')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Rational", 5, 7], ["Rational", 7, 9]]
      box       = ["Rational", 10, 9]
      N-auto    = 1.(1)
      N-mach    = 1.1111111111111112
    `));

  test(`Multiply: All exact`, () =>
    expect(
      check(
        '2\\times 5\\times\\frac{5}{7}\\times\\frac{7}{9}\\times\\sqrt{2}\\times\\pi'
      )
    ).toMatchInlineSnapshot(`
      latex     = [
        "Multiply",
        2,
        5,
        ["Rational", 5, 7],
        ["Rational", 7, 9],
        ["Sqrt", 2],
        "Pi"
      ]
      box       = ["Multiply", ["Rational", 50, 9], "Pi", ["Sqrt", 2]]
      N-auto    = 24.682682989768701372
      N-mach    = 24.6826829897687
    `));
  test(`Multiply: One inexact`, () =>
    expect(
      check(
        '1.1\\times 2\\times 5\\times\\frac{5}{7}\\times\\frac{7}{9}\\times\\sqrt{2}\\times\\pi'
      )
    ).toMatchInlineSnapshot(`
      latex     = [
        "Multiply",
        1.1,
        2,
        5,
        ["Rational", 5, 7],
        ["Rational", 7, 9],
        ["Sqrt", 2],
        "Pi"
      ]
      box       = ["Multiply", 1.1, ["Rational", 50, 9], "Pi", ["Sqrt", 2]]
      evaluate  = 27.15095128874557151
      eval-mach = 27.150951288745578
    `)); // @fixme eval-big should be same or bettern than evaluate
});

describe('Divide', () => {
  test(`INVALID  Divide`, () =>
    expect(ce.box(['Divide', 2.5]).evaluate()).toMatchInlineSnapshot(
      `["Divide", 2.5, ["Error", ["ErrorCode", "'missing'", "Number"]]]`
    ));
  test(`Divide`, () =>
    expect(ce.box(['Divide', 6, 3]).evaluate()).toMatchInlineSnapshot(`2`));
  test(`Divide`, () =>
    expect(ce.box(['Divide', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `2.(27)`
    ));
  test(`INVALID Divide`, () =>
    expect(
      ce.box(['Divide', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(
      `["Divide", 2.5, -1.1, ["Error", "'unexpected-argument'", 18.4]]`
    ));
});

describe('Power', () => {
  test(`INVALID Power`, () =>
    expect(ce.box(['Power', 2.5]).evaluate()).toMatchInlineSnapshot(
      `["Power", 2.5, ["Error", ["ErrorCode", "'missing'", "Number"]]]`
    ));
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `2.7398955659630432724`
    ));
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5, -3]).evaluate()).toMatchInlineSnapshot(
      `0.064`
    ));
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5, -3.2]).evaluate()).toMatchInlineSnapshot(
      `0.053283405273719880987`
    ));
  test(`INVALID Power`, () =>
    expect(ce.box(['Power', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `["Power", 2.5, -1.1, ["Error", "'unexpected-argument'", 18.4]]`
    ));
});

describe('Root', () => {
  test(`Root 2.5`, () =>
    expect(ce.box(['Root', 2.5, 3]).evaluate()).toMatchInlineSnapshot(
      `1.3572088082974532443`
    ));

  test(`Root 5/7`, () =>
    expect(
      ce.box(['Root', ['Rational', 5, 7], 3]).evaluate()
    ).toMatchInlineSnapshot(`0.89390353509656766727`));

  test(`Root 1234567890987654321`, () =>
    expect(
      ce.box(['Root', { num: '1234567890987654321' }, 3]).evaluate()
    ).toMatchInlineSnapshot(`["Root", "1234567890987654321", 3]`));

  test(`Root 1234567890987654321.123456789`, () =>
    expect(
      ce.box(['Root', { num: '1234567890987654321.123456789' }, 3]).evaluate()
    ).toMatchInlineSnapshot(`1072765.9799271567916`));
});

describe('INVALID ROOT', () => {
  test(`Too few args`, () =>
    expect(ce.box(['Root', 2.5]).evaluate()).toMatchInlineSnapshot(
      `["Root", 2.5, ["Error", ["ErrorCode", "'missing'", "Number"]]]`
    ));
  test(`Too many args`, () =>
    expect(ce.box(['Root', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `["Root", 2.5, -1.1, ["Error", "'unexpected-argument'", 18.4]]`
    ));
});

describe('Sqrt', () => {
  test(`√0`, () =>
    expect(checkJson(['Sqrt', 0])).toMatchInlineSnapshot(`
      box       = ["Sqrt", 0]
      canonical = 0
    `));

  test(`√2.5`, () => {
    expect(checkJson(['Sqrt', 2.5])).toMatchInlineSnapshot(`
      box       = ["Sqrt", 2.5]
      evaluate  = 1.581138830084189666
      eval-mach = 1.5811388300841898
    `);
  });

  test(`√(175)`, () =>
    expect(checkJson(['Sqrt', 175])).toMatchInlineSnapshot(`
      box       = ["Sqrt", 175]
      canonical = ["Multiply", 5, ["Sqrt", 7]]
      N-auto    = 13.228756555322952953
      N-mach    = 13.228756555322953
    `));

  test(`√(12345670000000000000000000)`, () =>
    expect(checkJson(['Sqrt', { num: '12345670000000000000000000' }]))
      .toMatchInlineSnapshot(`
      box       = ["Sqrt", 1.234567e+25]
      simplify  = ["Multiply", 1000000000, ["Sqrt", 12345670]]
      evaluate  = ["Multiply", 1000000000, ["Sqrt", 12345670]]
      N-auto    = 3513640562152.025248
      eval-mach = ["Sqrt", 1.234567e+25]
      N-mach    = 3513640562152.0254
    `));

  test(`√(5/7)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 5, 7]])).toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Rational", 5, 7]]
      N-auto    = 0.84515425472851657751
      N-mach    = 0.8451542547285166
    `));

  test(`√12345678901234567890`, () =>
    expect(checkJson(['Sqrt', { num: '12345678901234567890' }]))
      .toMatchInlineSnapshot(`
      box       = ["Sqrt", "12345678901234567890"]
      simplify  = ["Multiply", 15, ["Sqrt", "1371742100137174210"]]
      N-auto    = 3513641828.8201442531
      N-mach    = 3513641828.820144
    `));

  test(`√123456789.01234567890`, () =>
    expect(checkJson(['Sqrt', { num: '123456789.01234567890' }]))
      .toMatchInlineSnapshot(`
      box       = ["Sqrt", "123456789.0123456789"]
      evaluate  = 11111.111061111110994
      N-mach    = 11111.11106111111
    `));

  test(`√(1000000/49)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 1000000, 49]]))
      .toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Rational", 1000000, 49]]
      simplify  = ["Rational", 1000, 7]
      N-auto    = 142.85714285714285714
      N-mach    = 142.85714285714286
    `));

  test(`√(1000001/7)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 1000001, 7]]))
      .toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Rational", 1000001, 7]]
      N-auto    = 377.96466199141648629
      N-mach    = 377.9646619914165
    `));

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
    ).toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Rational", "12345678901234567890", "23456789012345678901"]]
      canonical = ["Sqrt", ["Rational", 137174210, 260630989]]
      N-auto    = 0.7254762640277013131
      N-mach    = 0.7254762640277013
    `));

  test(`√(3+4i)`, () =>
    expect(checkJson(['Sqrt', ['Complex', 3, 4]])).toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Complex", 3, 4]]
      evaluate  = ["Complex", 2, 1]
      N-big     = {num: "NaN"}
    `));

  test(`√(4x)`, () =>
    expect(checkJson(['Sqrt', ['Multiply', 4, 'x']])).toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Multiply", 4, "x"]]
      simplify  = ["Multiply", 2, ["Sqrt", "x"]]
    `));

  test(`√(3^2)`, () =>
    expect(checkJson(['Sqrt', ['Square', 3]])).toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Square", 3]]
      canonical = 3
    `));

  test(`√(5x(3+2))`, () =>
    expect(checkJson(['Sqrt', ['Multiply', 5, ['Add', 3, 2]]]))
      .toMatchInlineSnapshot(`
      box       = ["Sqrt", ["Multiply", 5, ["Add", 3, 2]]]
      canonical = ["Sqrt", ["Multiply", 5, ["Add", 2, 3]]]
      simplify  = 5
    `));

  test(`INVALID Sqrt`, () =>
    expect(checkJson(['Sqrt', 2.5, 1.1])).toMatchInlineSnapshot(`
      box       = ["Sqrt", 2.5, 1.1]
      canonical = ["Sqrt", 2.5, ["Error", "'unexpected-argument'", 1.1]]
    `));
  test(`INVALID  Sqrt`, () =>
    expect(checkJson(['Sqrt', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Sqrt", 2.5, -1.1, 18.4]
      canonical = [
        "Sqrt",
        2.5,
        ["Error", "'unexpected-argument'", -1.1],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `));
});

describe('Square', () => {
  test(`Square`, () =>
    expect(checkJson(['Square', 2.5])).toMatchInlineSnapshot(`
      box       = ["Square", 2.5]
      evaluate  = 6.25
    `));
  test(`INVALID Square`, () =>
    expect(checkJson(['Square', 2.5, 1.1])).toMatchInlineSnapshot(`
      box       = ["Square", 2.5, 1.1]
      canonical = ["Square", 2.5, ["Error", "'unexpected-argument'", 1.1]]
    `));
  test(`INVALID Square`, () =>
    expect(checkJson(['Square', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Square", 2.5, -1.1, 18.4]
      canonical = [
        "Square",
        2.5,
        ["Error", "'unexpected-argument'", -1.1],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `));
});

describe('Max', () => {
  test(`Max`, () =>
    expect(checkJson(['Max', 2.5])).toMatchInlineSnapshot(`
      box       = ["Max", 2.5]
      simplify  = 2.5
    `));
  test(`Max`, () =>
    expect(checkJson(['Max', 2.5, 1.1])).toMatchInlineSnapshot(`
      box       = ["Max", 2.5, 1.1]
      evaluate  = 2.5
    `));
  test(`Max`, () =>
    expect(checkJson(['Max', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Max", 2.5, -1.1, 18.4]
      evaluate  = 2.5
    `));
  test(`Max`, () =>
    expect(checkJson(['Max', 2.5, -1.1, 'NaN', 18.4])).toMatchInlineSnapshot(`
      box       = ["Max", 2.5, -1.1, {num: "NaN"}, 18.4]
      evaluate  = 2.5
    `));
  test(`Max`, () =>
    expect(checkJson(['Max', 2.5, -1.1, 'foo', 18.4])).toMatchInlineSnapshot(`
      box       = ["Max", 2.5, -1.1, "foo", 18.4]
      evaluate  = 2.5
    `));
  test(`Max`, () =>
    expect(checkJson(['Max', 'foo', 'bar'])).toMatchInlineSnapshot(`
      box       = ["Max", "foo", "bar"]
      evaluate  = foo
    `));
});

describe('Min', () => {
  test(`Min`, () =>
    expect(checkJson(['Min', 2.5])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5]
      simplify  = 2.5
    `));
  test(`Min`, () =>
    expect(checkJson(['Min', 2.5, 1.1])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, 1.1]
      evaluate  = 2.5
    `));
  test(`Min`, () =>
    expect(checkJson(['Min', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, 18.4]
      evaluate  = 2.5
    `));
  test(`Min`, () =>
    expect(checkJson(['Min', 2.5, -1.1, 'NaN', 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, {num: "NaN"}, 18.4]
      evaluate  = 2.5
    `));
  test(`Min`, () =>
    expect(checkJson(['Min', 2.5, -1.1, 'foo', 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, "foo", 18.4]
      evaluate  = 2.5
    `));
  test(`Min`, () =>
    expect(checkJson(['Min', 'foo', 'bar'])).toMatchInlineSnapshot(`
      box       = ["Min", "foo", "bar"]
      evaluate  = foo
    `));
});

describe('Rational', () => {
  test(`Rational`, () =>
    expect(checkJson(['Rational', 3, 4])).toMatchInlineSnapshot(`
      box       = ["Rational", 3, 4]
      N-auto    = 0.75
    `));

  test(`Bignum rational`, () =>
    expect(
      checkJson([
        'Rational',
        { num: '12345678901234567890' },
        { num: '23456789012345678901' },
      ])
    ).toMatchInlineSnapshot(`
      box       = ["Rational", "12345678901234567890", "23456789012345678901"]
      canonical = ["Rational", 137174210, 260630989]
      N-auto    = 0.52631580966759098627
    `));

  test(`INVALID Rational`, () => {
    expect(checkJson(['Rational', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Rational", 2.5, -1.1, 18.4]
      canonical = [
        "Rational",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Integer",
            ["Domain", "PositiveNumber"]
          ],
          2.5
        ],
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Integer",
            ["Domain", "NegativeNumber"]
          ],
          -1.1
        ],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `);
    expect(checkJson(['Rational', 2, 3, 5])).toMatchInlineSnapshot(`
      box       = ["Rational", 2, 3, 5]
      canonical = ["Rational", 2, 3, ["Error", "'unexpected-argument'", 5]]
    `);
  });
  test(`Rational as Divide`, () =>
    expect(checkJson(['Rational', 3.1, 2.8])).toMatchInlineSnapshot(`
      box       = ["Divide", 3.1, 2.8]
      evaluate  = 1.1071428571428571429
      eval-mach = 1.1071428571428572
    `));
  test(`Rational approximation`, () =>
    expect(checkJson(['Rational', 2.5])).toMatchInlineSnapshot(`
      box       = ["Rational", 2.5]
      evaluate  = ["Rational", 5, 2]
      N-auto    = 2.5
    `));
  test(`Rational approximation`, () =>
    expect(checkJson(['Rational', 'Pi'])).toMatchInlineSnapshot(`
      box       = ["Rational", "Pi"]
      evaluate  = ["Rational", 80143857, 25510582]
      N-auto    = 3.1415926535897932385
      N-mach    = 3.141592653589793
    `));
});

describe('Ln', () => {
  expect(checkJson(['Ln', 1.1])).toMatchInlineSnapshot(`
    box       = ["Ln", 1.1]
    N-auto    = 0.095310179804324860044
    N-mach    = 0.09531017980432493
  `);
  expect(checkJson(['Ln', 1])).toMatchInlineSnapshot(`
    box       = ["Ln", 1]
    N-auto    = 0
  `);
  expect(checkJson(['Ln', 0])).toMatchInlineSnapshot(`
    box       = ["Ln", 0]
    N-auto    = {num: "-Infinity"}
  `);
  expect(checkJson(['Ln', -1])).toMatchInlineSnapshot(`
    box       = ["Ln", -1]
    N-auto    = ["Complex", 0, 3.141592653589793]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0, 3.141592653589793]
  `);
  expect(checkJson(['Ln', 'Pi'])).toMatchInlineSnapshot(`
    box       = ["Ln", "Pi"]
    N-auto    = 1.1447298858494001741
    N-mach    = 1.1447298858494002
  `);
  expect(checkJson(['Ln', ['Complex', 1.1, 1.1]])).toMatchInlineSnapshot(`
    box       = ["Ln", ["Complex", 1.1, 1.1]]
    N-auto    = ["Complex", 0.4418837700842976, 0.7853981633974483]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0.4418837700842976, 0.7853981633974483]
  `);
});

describe('Lb', () => {
  expect(checkJson(['Lb', 1.1])).toMatchInlineSnapshot(`
    box       = ["Lb", 1.1]
    N-auto    = 0.13750352374993502
  `);
  expect(checkJson(['Lb', 1])).toMatchInlineSnapshot(`
    box       = ["Lb", 1]
    N-auto    = 0
  `);
  expect(checkJson(['Lb', 0])).toMatchInlineSnapshot(`
    box       = ["Lb", 0]
    N-auto    = ComplexInfinity
    N-big     = {num: "NaN"}
    N-mach    = {num: "-Infinity"}
  `);
  expect(checkJson(['Lb', -1])).toMatchInlineSnapshot(`
    box       = ["Lb", -1]
    N-auto    = {num: "NaN"}
    N-cplx   = ["Complex", 0, 4.532360141827194]
  `);
  expect(checkJson(['Lb', 'Pi'])).toMatchInlineSnapshot(`
    box       = ["Lb", "Pi"]
    N-auto    = 1.651496129472319
    N-mach    = 1.6514961294723187
  `);
  expect(checkJson(['Lb', ['Complex', 1.1, 1.1]])).toMatchInlineSnapshot(`
    box       = ["Lb", ["Complex", 1.1, 1.1]]
    N-auto    = ["Complex", 0.637503523749935, 1.1330900354567985]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0.637503523749935, 1.1330900354567985]
  `);
});

describe('Lg', () => {
  expect(checkJson(['Lg', 1.1])).toMatchInlineSnapshot(`
    box       = ["Lg", 1.1]
    N-auto    = 0.04139268515822504075
    N-mach    = 0.04139268515822507
  `);
  expect(checkJson(['Lg', 1])).toMatchInlineSnapshot(`
    box       = ["Lg", 1]
    N-auto    = 0
  `);
  expect(checkJson(['Lg', 0])).toMatchInlineSnapshot(`
    box       = ["Lg", 0]
    N-auto    = {num: "-Infinity"}
  `);
  expect(checkJson(['Lg', -1])).toMatchInlineSnapshot(`
    box       = ["Lg", -1]
    N-auto    = ["Complex", 0, 1.3643763538418412]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0, 1.3643763538418412]
  `);
  expect(checkJson(['Lg', 'Pi'])).toMatchInlineSnapshot(`
    box       = ["Lg", "Pi"]
    N-auto    = 0.49714987269413385435
    N-mach    = 0.4971498726941338
  `);
  expect(checkJson(['Lg', ['Complex', 1.1, 1.1]])).toMatchInlineSnapshot(`
    box       = ["Lg", ["Complex", 1.1, 1.1]]
    N-auto    = ["Complex", 0.19190768299021566, 0.3410940884604603]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0.19190768299021566, 0.3410940884604603]
  `);
});

describe('Log(a,b)', () => {
  expect(checkJson(['Log', 1.1])).toMatchInlineSnapshot(`
    box       = ["Log", 1.1]
    N-auto    = 0.04139268515822504075
    N-mach    = 0.04139268515822507
  `);
  expect(checkJson(['Log', 1])).toMatchInlineSnapshot(`
    box       = ["Log", 1]
    N-auto    = 0
  `);
  expect(checkJson(['Log', 0])).toMatchInlineSnapshot(`
    box       = ["Log", 0]
    N-auto    = {num: "-Infinity"}
  `);
  expect(checkJson(['Log', -1])).toMatchInlineSnapshot(`
    box       = ["Log", -1]
    N-auto    = ["Complex", 0, 1.3643763538418412]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0, 1.3643763538418412]
  `);
  expect(checkJson(['Log', 'Pi'])).toMatchInlineSnapshot(`
    box       = ["Log", "Pi"]
    N-auto    = 0.49714987269413385435
    N-mach    = 0.4971498726941338
  `);
  expect(checkJson(['Log', ['Complex', 1.1, 1.1]])).toMatchInlineSnapshot(`
    box       = ["Log", ["Complex", 1.1, 1.1]]
    N-auto    = ["Complex", 0.19190768299021566, 0.3410940884604603]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0.19190768299021566, 0.3410940884604603]
  `);

  expect(checkJson(['Log', 1.1, 5])).toMatchInlineSnapshot(`
    box       = ["Log", 1.1, 5]
    N-auto    = 0.059219544331585022129
    N-mach    = 0.05921954433158507
  `);
  expect(checkJson(['Log', 1, 5])).toMatchInlineSnapshot(`
    box       = ["Log", 1, 5]
    N-auto    = 0
  `);
  expect(checkJson(['Log', 0, 5])).toMatchInlineSnapshot(`
    box       = ["Log", 0, 5]
    N-auto    = {num: "-Infinity"}
  `);
  expect(checkJson(['Log', -1, 5])).toMatchInlineSnapshot(`
    box       = ["Log", -1, 5]
    N-auto    = {num: "NaN"}
  `);
  expect(checkJson(['Log', 'Pi', 5])).toMatchInlineSnapshot(`
    box       = ["Log", "Pi", 5]
    N-auto    = 0.71126066871266895533
    N-mach    = 0.711260668712669
  `);
  expect(checkJson(['Log', ['Complex', 1.1, 1.1], 5])).toMatchInlineSnapshot(`
    box       = ["Log", ["Complex", 1.1, 1.1], 5]
    N-auto    = ["Complex", 0.2745578233682816, 0.48799531645779287]
    N-big     = {num: "NaN"}
    N-cplx   = ["Complex", 0.2745578233682816, 0.48799531645779287]
  `);
});

describe('Log Invalid', () => {
  expect(checkJson(['Ln'])).toMatchInlineSnapshot(`
    box       = ["Ln"]
    canonical = ["Ln", ["Error", ["ErrorCode", "'missing'", "Number"]]]
  `);
  expect(checkJson(['Ln', "'string'"])).toMatchInlineSnapshot(`
    box       = ["Ln", "'string'"]
    canonical = [
      "Ln",
      [
        "Error",
        [
          "ErrorCode",
          "'incompatible-domain'",
          "Number",
          ["Domain", "String"]
        ],
        "'string'"
      ]
    ]
  `);
  expect(checkJson(['Ln', 3, 4])).toMatchInlineSnapshot(`
    box       = ["Ln", 3, 4]
    canonical = ["Ln", 3, ["Error", "'unexpected-argument'", 4]]
  `);
});
