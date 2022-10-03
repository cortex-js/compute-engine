import { ComputeEngine } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

export const ce = new ComputeEngine();
ce.precision = 10;

describe('CONSTANTS', () => {
  test(`ExponentialE`, () =>
    expect(ce.box(`ExponentialE`).N()).toMatchInlineSnapshot(
      `2.718281828459045`
    ));
  test(`ImaginaryUnit`, () =>
    expect(ce.box(`ImaginaryUnit`).N()).toMatchInlineSnapshot(
      `["Complex", 0, 1]`
    ));
  test(`MachineEpsilon`, () =>
    expect(ce.box(`MachineEpsilon`).N()).toMatchInlineSnapshot(
      `2.220446049250313e-16`
    ));
  test(`CatalanConstant`, () =>
    expect(ce.box(`CatalanConstant`).N()).toMatchInlineSnapshot(
      `0.915965594177219`
    ));
  test(`GoldenRatio`, () =>
    expect(ce.box(`GoldenRatio`).N()).toMatchInlineSnapshot(
      `1.618033988749895`
    ));
  test(`EulerGamma`, () =>
    expect(ce.box(`EulerGamma`).N()).toMatchInlineSnapshot(
      `0.5772156649015329`
    ));
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

describe('ADD', () => {
  test(`Add ['Add']`, () =>
    expect(ce.box(['Add']).evaluate()).toMatchInlineSnapshot(
      `["Add", ["Error", ["ErrorCode", "'missing'", ["Sequence", "Number"]]]]`
    ));

  test(`Add ['Add', 2.5]`, () =>
    expect(ce.box(['Add', 2.5]).evaluate()).toMatchInlineSnapshot(`2.5`));

  test(`Add ['Add', 2.5, -1.1]`, () =>
    expect(ce.box(['Add', 2.5, -1.1]).evaluate()).toMatchInlineSnapshot(`1.4`));
  test(`Add ['Add', 2.5, -1.1, 18.4]`, () =>
    expect(ce.box(['Add', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `19.799999999999997`
    ));

  test(`Add \\frac{2}{-3222233}+\\frac{1}{3}`, () =>
    expect(ce.parse('\\frac{2}{-3222233}+\\frac{1}{3}')).toMatchInlineSnapshot(
      `["Add", ["Divide", 2, -3222233], ["Rational", 1, 3]]`
    ));

  test(`Add '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'`, () =>
    expect(
      ce.parse(
        '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'
      )
    ).toMatchInlineSnapshot(`
      [
        "Add",
        ["Rational", 2, 3],
        ["Rational", 12345678912345678, 987654321987654300],
        ["Rational", 987654321987654300, 12345678912345678]
      ]
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
  test(`Negate`, () =>
    expect(ce.box(['Negate', 2.5]).evaluate()).toMatchInlineSnapshot(`-2.5`));
  test(`Negate`, () =>
    expect(ce.box(['Negate', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `["Negate", 2.5, ["Error", "'unexpected-argument'", 1.1]]`
    ));
  test(`Negate`, () =>
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

describe('Multiply', () => {
  test(`Multiply`, () =>
    expect(ce.box(['Multiply', 2.5]).evaluate()).toMatchInlineSnapshot(`2.5`));
  test(`Multiply`, () =>
    expect(ce.box(['Multiply', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `2.75`
    ));
  test(`Multiply`, () =>
    expect(
      ce.box(['Multiply', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(`-50.599999999999994`));
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
      `2.2727272727272725`
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
      `2.7398955659630433`
    ));
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5, -3]).evaluate()).toMatchInlineSnapshot(
      `0.064`
    ));
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5, -3.2]).evaluate()).toMatchInlineSnapshot(
      `0.05328340527371987`
    ));
  test(`INVALID Power`, () =>
    expect(ce.box(['Power', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `["Power", 2.5, -1.1, ["Error", "'unexpected-argument'", 18.4]]`
    ));
});

describe('Root', () => {
  test(`INVALID Root`, () =>
    expect(ce.box(['Root', 2.5]).evaluate()).toMatchInlineSnapshot(
      `["Root", 2.5, ["Error", ["ErrorCode", "'missing'", "RationalNumber"]]]`
    ));
  test(`Root`, () =>
    expect(ce.box(['Root', 2.5, 3]).evaluate()).toMatchInlineSnapshot(
      `1.3572088082974534`
    ));
  test(`INVALID Root`, () =>
    expect(ce.box(['Root', 2.5, 3.1]).evaluate()).toMatchInlineSnapshot(`
      [
        "Root",
        2.5,
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "RationalNumber"]
          ],
          3.1
        ]
      ]
    `));
  test(`INVALID Root`, () =>
    expect(ce.box(['Root', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(`
      [
        "Root",
        2.5,
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "RationalNumber"]
          ],
          -1.1
        ],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `));
});

describe('Sqrt', () => {
  test(`Sqrt`, () =>
    expect(ce.box(['Sqrt', 2.5]).evaluate()).toMatchInlineSnapshot(
      `1.5811388300841898`
    ));
  test(`INVALID Sqrt`, () =>
    expect(ce.box(['Sqrt', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `["Sqrt", 2.5, ["Error", "'unexpected-argument'", 1.1]]`
    ));
  test(`INVALID  Sqrt`, () =>
    expect(ce.box(['Sqrt', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(`
      [
        "Sqrt",
        2.5,
        ["Error", "'unexpected-argument'", -1.1],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `));
});

describe('Square', () => {
  test(`Square`, () =>
    expect(ce.box(['Square', 2.5]).evaluate()).toMatchInlineSnapshot(`6.25`));
  test(`INVALID Square`, () =>
    expect(ce.box(['Square', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `["Square", 2.5, ["Error", "'unexpected-argument'", 1.1]]`
    ));
  test(`INVALID Square`, () =>
    expect(ce.box(['Square', 2.5, -1.1, 18.4]).evaluate())
      .toMatchInlineSnapshot(`
      [
        "Square",
        2.5,
        ["Error", "'unexpected-argument'", -1.1],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `));
});

describe('Max', () => {
  test(`Max`, () =>
    expect(ce.box(['Max', 2.5]).evaluate()).toMatchInlineSnapshot(`2.5`));
  test(`Max`, () =>
    expect(ce.box(['Max', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(`2.5`));
  test(`Max`, () =>
    expect(ce.box(['Max', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `18.4`
    ));
  test(`Max`, () =>
    expect(
      ce.box(['Max', 2.5, -1.1, 'NaN', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`18.4`));
  test(`Max`, () =>
    expect(
      ce.box(['Max', 2.5, -1.1, 'foo', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`["Max", 18.4, "foo"]`));
  test(`Max`, () =>
    expect(ce.box(['Max', 'foo', 'bar']).evaluate()).toMatchInlineSnapshot(
      `["Max", "foo", "bar"]`
    ));
});

describe('Min', () => {
  test(`Min`, () =>
    expect(ce.box(['Min', 2.5]).evaluate()).toMatchInlineSnapshot(`2.5`));
  test(`Min`, () =>
    expect(ce.box(['Min', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(`1.1`));
  test(`Min`, () =>
    expect(ce.box(['Min', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `-1.1`
    ));
  test(`Min`, () =>
    expect(
      ce.box(['Min', 2.5, -1.1, 'NaN', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`-1.1`));
  test(`Min`, () =>
    expect(
      ce.box(['Min', 2.5, -1.1, 'foo', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`["Min", -1.1, "foo"]`));
  test(`Min`, () =>
    expect(ce.box(['Min', 'foo', 'bar']).evaluate()).toMatchInlineSnapshot(
      `["Min", "foo", "bar"]`
    ));
});

describe('Rational', () => {
  test(`Rational`, () =>
    expect(ce.box(['Rational', 2.5]).evaluate()).toMatchInlineSnapshot(
      `["Rational", 5, 2]`
    ));
  test(`Rational`, () =>
    expect(ce.box(['Rational', 3, 4]).evaluate()).toMatchInlineSnapshot(
      `["Rational", 3, 4]`
    ));
  test(`Rational`, () =>
    expect(ce.box(['Rational', 3, 4]).N()).toMatchInlineSnapshot(`0.75`));
  test(`INVALID Rational`, () =>
    expect(ce.box(['Rational', 2.5, -1.1, 18.4]).evaluate())
      .toMatchInlineSnapshot(`
      [
        "Rational",
        2.5,
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", ["Domain", ["Maybe"]]],
          -1.1
        ],
        ["Error", "'unexpected-argument'", 18.4]
      ]
    `));
  test(`Rational as Divide`, () =>
    expect(ce.box(['Rational', 3.1, 2.8]).N()).toMatchInlineSnapshot(
      `1.1071428571428572`
    ));
  test(`Rational approximation`, () =>
    expect(ce.box(['Rational', 'Pi']).evaluate()).toMatchInlineSnapshot(
      `["Rational", 80143857, 25510582]`
    ));
});
