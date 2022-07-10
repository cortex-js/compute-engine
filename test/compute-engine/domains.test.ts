import { ComputeEngine, DomainConstructor } from '../../src/compute-engine';
import type { Expression } from '../../src/math-json/math-json-format';

export const engine = new ComputeEngine();
engine.defaultDomain = null;

/*
    [a, b, compare(a,b)]
*/

const domains: Expression[] = [
  0,
  5,
  'Integer',
  'RationalNumber',
  'AlgebraicNumber',
  'RealNumber',
  'ComplexNumber',
  'Number',
  ['Range', 0, 0],
  ['Range', 1, 1],
  ['Range', -Infinity, Infinity],
  ['Range', 1, 5],
  ['Interval', 0, 0],
  ['Interval', -Infinity, Infinity],
  ['Interval', 0, Infinity],
  ['Interval', 0, 5],
  ['And', ['Greater', 0], ['Lesser', 5]],
  ['Union', ['Range', 1, 5], ['Range', 5, Infinity]],
];

describe('DOMAIN LITERALS', () => {
  test('Number <: String', () => {
    expect(engine.domain('Number').isCompatible('String')).toBeFalsy();
  });
  test('String <: Number', () => {
    expect(engine.domain('String').isCompatible('Number')).toBeFalsy();
  });
  test('Void <: Number', () => {
    expect(engine.domain('Void').isCompatible('Number')).toBeTruthy();
  });
  test('Number <: Void', () => {
    expect(engine.domain('Number').isCompatible('Void')).toBeFalsy();
  });
});

describe('NUMERIC', () => {
  test('Number <: Number', () => {
    expect(engine.domain('Number').isCompatible('Number')).toBeTruthy();
  });
  test('RealNumber <: RealNumber', () => {
    expect(engine.domain('RealNumber').isCompatible('RealNumber')).toBeTruthy();
  });
  test('PositiveNumber <: Number', () => {
    expect(engine.domain('PositiveNumber').isCompatible('Number')).toBeTruthy();
  });
  test('NegativeInteger <: Integer', () => {
    expect(
      engine.domain('NegativeInteger').isCompatible('Integer')
    ).toBeTruthy();
  });
  test('NegativeNumber <: Integer', () => {
    expect(engine.domain('NegativeNumber').isCompatible('Integer')).toBeFalsy();
  });
  test('Integer <: RealNumber', () => {
    expect(engine.domain('Integer').isCompatible('RealNumber')).toBeTruthy();
  });
  test('RationalNumber <: ExtendedRealNumber', () => {
    expect(
      engine.domain('RationalNumber').isCompatible('ExtendedRealNumber')
    ).toBeTruthy();
  });
  test('RealNumber <: Integer', () => {
    expect(engine.domain('RealNumber').isCompatible('Integer')).toBeFalsy();
  });
});

describe('INVALID DOMAINS', () => {
  test('NotADomainLiteral', () => {
    expect(
      () => engine.domain('NotADomainLiteral').domainExpression
    ).toThrowError();
  });
  test('NotADomainConstructor', () => {
    expect(
      () =>
        engine.domain(['NotADomainConstructor' as DomainConstructor, 'Integer'])
          .domainExpression
    ).toThrowError();
  });
  test('NotADomainLiteral in parametric expression', () => {
    expect(
      () => engine.domain(['Function', 'NotADomainLiteral']).domainExpression
    ).toThrowError();
  });
});

describe('SYMBOLS, FUNCTION HEADS', () => {
  test('Symbol Sin', () => {
    // `Sin` is a symbol, not related to the function with head `Sin`
    expect(engine.box('Sin').domain.domainExpression).toMatchInlineSnapshot(
      `"Anything"`
    );
  });
  // Function application, but `x` is of domain Anything
  // The function `Sin` is not matched to a particular definition, and
  // the domain of the expression is solely based on the arguments...
  test('\\sin(x)', () => {
    expect(engine.box(['Sin', 'x']).domain.domainExpression)
      .toMatchInlineSnapshot(`
      Array [
        "Function",
        "Anything",
        "Anything",
      ]
    `);
  });
  test('Nothing', () => {
    expect(engine.box('Nothing').domain.domainExpression).toMatchInlineSnapshot(
      `"Nothing"`
    );
  });
  test('3', () => {
    expect(engine.box(3).domain.domainExpression).toMatchInlineSnapshot(
      `"PositiveInteger"`
    );
  });
  test('Pi', () => {
    expect(engine.box('Pi').domain.domainExpression).toMatchInlineSnapshot(
      `"PositiveNumber"`
    );
  });
});

describe('FUNCTION SIGNATURES', () => {
  test("['Function', 'PositiveInteger', 'Anything'] <: ['Function', 'Number', 'Number']", () => {
    expect(
      engine
        .domain(['Function', 'PositiveInteger', 'Anything'])
        .isCompatible(engine.domain(['Function', 'Number', 'Number']))
    ).toBeTruthy();
  });
});
