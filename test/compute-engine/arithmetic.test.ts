import { ComputeEngine } from '../../src/compute-engine';

export const ce = new ComputeEngine();
ce.precision = 10;

describe('CONSTANTS', () => {
  test(`ExponentialE`, () =>
    expect(ce.box(`ExponentialE`).N()).toMatchInlineSnapshot(
      `"2.718281828459045"`
    ));
  test(`ImaginaryUnit`, () =>
    expect(ce.box(`ImaginaryUnit`).N()).toMatchInlineSnapshot(
      `"[\\"Complex\\",0,1]"`
    ));
  test(`MachineEpsilon`, () =>
    expect(ce.box(`MachineEpsilon`).N()).toMatchInlineSnapshot(
      `"2.220446049250313e-16"`
    ));
  test(`CatalanConstant`, () =>
    expect(ce.box(`CatalanConstant`).N()).toMatchInlineSnapshot(
      `"0.915965594177219"`
    ));
  test(`GoldenRatio`, () =>
    expect(ce.box(`GoldenRatio`).N()).toMatchInlineSnapshot(
      `"[\\"Multiply\\",[\\"Rational\\",1,2],[\\"Add\\",1,2.23606797749979]]"`
    )); // @todo
  test(`EulerGamma`, () =>
    expect(ce.box(`EulerGamma`).N()).toMatchInlineSnapshot(
      `"0.5772156649015329"`
    ));
});

describe('RELATIONAL OPERATOR', () => {
  test(`Equal`, () =>
    expect(ce.box(['Equal', 5, 5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Equal\\",5,5]"`
    )); // @todo
  test(`Equal`, () =>
    expect(ce.box(['Equal', 11, 7]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Equal\\",11,7]"`
    )); // @todo
  test(`NotEqual`, () =>
    expect(ce.box(['NotEqual', 5, 5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"NotEqual\\",5,5]"`
    )); // @todo
  test(`NotEqual`, () =>
    expect(ce.box(['NotEqual', 11, 7]).evaluate()).toMatchInlineSnapshot(
      `"[\\"NotEqual\\",11,7]"`
    )); // @todo
  test(`Greater`, () =>
    expect(ce.box(['Greater', 3, 19]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Greater\\",3,19]"`
    )); // @todo
  test(`Greater`, () =>
    expect(ce.box(['Greater', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Greater\\",2.5,1.1]"`
    )); // @todo
  test(`Less`, () =>
    expect(ce.box(['Less', 3, 19]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Less\\",3,19]"`
    )); // @todo
  test(`Less`, () =>
    expect(ce.box(['Less', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Less\\",2.5,1.1]"`
    )); // @todo
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 3, 3]).evaluate()).toMatchInlineSnapshot(
      `"[\\"GreaterEqual\\",3,3]"`
    )); // @todo
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 3, 19]).evaluate()).toMatchInlineSnapshot(
      `"[\\"GreaterEqual\\",3,19]"`
    )); // @todo
  test(`GreaterEqual`, () =>
    expect(ce.box(['GreaterEqual', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"GreaterEqual\\",2.5,1.1]"`
    )); // @todo
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 3, 3]).evaluate()).toMatchInlineSnapshot(
      `"[\\"LessEqual\\",3,3]"`
    )); // @todo
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 3, 19]).evaluate()).toMatchInlineSnapshot(
      `"[\\"LessEqual\\",3,19]"`
    )); // @todo
  test(`LessEqual`, () =>
    expect(ce.box(['LessEqual', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"LessEqual\\",2.5,1.1]"`
    )); // @todo
});

describe('ADD', () => {
  test(`Add`, () =>
    expect(ce.box(['Add', 2.5]).evaluate()).toMatchInlineSnapshot(`"2.5"`)); // @todo
  test(`Add`, () =>
    expect(ce.box(['Add', 2.5, -1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Add\\",-1.1,2.5]"`
    )); // @todo
  test(`Add`, () =>
    expect(ce.box(['Add', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Add\\",-1.1,2.5,18.4]"`
    )); // @todo
});
describe('Subtract', () => {
  test(`Subtract`, () =>
    expect(ce.box(['Subtract', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Subtract\\",2.5]"`
    )); // @todo
  test(`Subtract`, () =>
    expect(ce.box(['Subtract', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Add\\",-1.1,2.5]"`
    )); // @todo
  test(`Subtract`, () =>
    expect(
      ce.box(['Subtract', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Add\\",1.1,2.5]"`)); // @todo
});

describe('Negate', () => {
  test(`Negate`, () =>
    expect(ce.box(['Negate', 2.5]).evaluate()).toMatchInlineSnapshot(`"-2.5"`)); // @todo
  test(`Negate`, () =>
    expect(ce.box(['Negate', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"-2.5"`
    )); // @todo
  test(`Negate`, () =>
    expect(
      ce.box(['Negate', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"-2.5"`)); // @todo
});

describe('Multiply', () => {
  test(`Multiply`, () =>
    expect(ce.box(['Multiply', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"2.5"`
    )); // @todo
  test(`Multiply`, () =>
    expect(ce.box(['Multiply', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Multiply\\",1.1,2.5]"`
    )); // @todo
  test(`Multiply`, () =>
    expect(
      ce.box(['Multiply', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Multiply\\",-1,1.1,2.5,18.4]"`)); // @todo
});

describe('Divide', () => {
  test(`Divide`, () =>
    expect(ce.box(['Divide', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Divide\\",2.5,\\"Missing\\"]"`
    )); // @todo
  test(`Divide`, () =>
    expect(ce.box(['Divide', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Divide\\",2.5,1.1]"`
    )); // @todo
  test(`Divide`, () =>
    expect(
      ce.box(['Divide', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Negate\\",[\\"Divide\\",2.5,1.1]]"`)); // @todo
});

describe('Power', () => {
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Power\\",2.5,\\"Missing\\"]"`
    )); // @todo
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Power\\",2.5,1.1]"`
    )); // @todo
  test(`Power`, () =>
    expect(ce.box(['Power', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Power\\",2.5,-1.1]"`
    )); // @todo
});

describe('Root', () => {
  test(`Root`, () =>
    expect(ce.box(['Root', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Root\\",2.5]"`
    )); // @todo
  test(`Root`, () =>
    expect(ce.box(['Root', 2.5, 3]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Root\\",2.5,3]"`
    )); // @todo
  test(`Root`, () =>
    expect(ce.box(['Root', 2.5, 3.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Root\\",2.5,3.1]"`
    )); // @todo
  test(`Root`, () =>
    expect(ce.box(['Root', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Root\\",2.5,-1.1,18.4]"`
    )); // @todo
});

describe('Sqrt', () => {
  test(`Sqrt`, () =>
    expect(ce.box(['Sqrt', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Sqrt\\",2.5]"`
    )); // @todo
  test(`Sqrt`, () =>
    expect(ce.box(['Sqrt', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Sqrt\\",2.5]"`
    )); // @todo
  test(`Sqrt`, () =>
    expect(ce.box(['Sqrt', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Sqrt\\",2.5]"`
    )); // @todo
});

describe('Square', () => {
  test(`Square`, () =>
    expect(ce.box(['Square', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Square\\",2.5]"`
    )); // @todo
  test(`Square`, () =>
    expect(ce.box(['Square', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Square\\",2.5]"`
    )); // @todo
  test(`Square`, () =>
    expect(
      ce.box(['Square', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Square\\",2.5]"`)); // @todo
});

describe('Max', () => {
  test(`Max`, () =>
    expect(ce.box(['Max', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Max\\",2.5]"`
    )); // @todo
  test(`Max`, () =>
    expect(ce.box(['Max', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Max\\",2.5,1.1]"`
    )); // @todo
  test(`Max`, () =>
    expect(ce.box(['Max', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Max\\",2.5,-1.1,18.4]"`
    )); // @todo
  test(`Max`, () =>
    expect(
      ce.box(['Max', 2.5, -1.1, 'NaN', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Max\\",2.5,-1.1,\\"NaN\\",18.4]"`)); // @todo
  test(`Max`, () =>
    expect(
      ce.box(['Max', 2.5, -1.1, 'foo', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Max\\",2.5,-1.1,\\"foo\\",18.4]"`)); // @todo
  test(`Max`, () =>
    expect(ce.box(['Max', 'foo', 'bar']).evaluate()).toMatchInlineSnapshot(
      `"[\\"Max\\",\\"foo\\",\\"bar\\"]"`
    )); // @todo
});

describe('Min', () => {
  test(`Min`, () =>
    expect(ce.box(['Min', 2.5]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Min\\",2.5]"`
    )); // @todo
  test(`Min`, () =>
    expect(ce.box(['Min', 2.5, 1.1]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Min\\",2.5,1.1]"`
    )); // @todo
  test(`Min`, () =>
    expect(ce.box(['Min', 2.5, -1.1, 18.4]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Min\\",2.5,-1.1,18.4]"`
    )); // @todo
  test(`Min`, () =>
    expect(
      ce.box(['Min', 2.5, -1.1, 'NaN', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Min\\",2.5,-1.1,\\"NaN\\",18.4]"`)); // @todo
  test(`Min`, () =>
    expect(
      ce.box(['Min', 2.5, -1.1, 'foo', 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Min\\",2.5,-1.1,\\"foo\\",18.4]"`)); // @todo
  test(`Min`, () =>
    expect(ce.box(['Min', 'foo', 'bar']).evaluate()).toMatchInlineSnapshot(
      `"[\\"Min\\",\\"foo\\",\\"bar\\"]"`
    )); // @todo
});

describe('Rational', () => {
  test(`Rational`, () =>
    expect(ce.box(['Rational', 2.5]).N()).toMatchInlineSnapshot(
      `"[\\"Rational\\",2.5]"`
    )); // @todo
  test(`Rational`, () =>
    expect(ce.box(['Rational', 3, 4]).N()).toMatchInlineSnapshot(
      `"[\\"Rational\\",3,4]"`
    ));
  test(`Rational`, () =>
    expect(
      ce.box(['Rational', 2.5, -1.1, 18.4]).evaluate()
    ).toMatchInlineSnapshot(`"[\\"Rational\\",5,2]"`)); // @todo
  test(`Rational`, () =>
    expect(ce.box(['Rational', 3.1, 2.8]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Divide\\",3.1,2.8]"`
    )); // @todo
  test(`Rational`, () =>
    expect(ce.box(['Rational', 'Pi']).evaluate()).toMatchInlineSnapshot(
      `"[\\"Rational\\",3.141592653589793]"`
    )); // @todo
});
