import { ComputeEngine, DomainExpression } from '../../src/compute-engine';

export const engine = new ComputeEngine();
engine.defaultDomain = null;

describe('Domain of function identifiers', () =>
  test('Domain of \\sin', () =>
    expect(engine.parse('\\sin').domain.toJSON()).toMatchInlineSnapshot(
      `"["Domain","Function"]"`
    )));

describe('Domain of function identifiers', () =>
  test('Domain of Sin', () =>
    expect(engine.box('Sin').domain.toJSON()).toMatchInlineSnapshot(
      `"["Domain","Function"]"`
    )));

describe('INFERRED DOMAINS', () => {
  test('42', () =>
    expect(engine.box(42).domain.toJSON()).toMatchInlineSnapshot(
      `"["Domain","PositiveInteger"]"`
    ));
  test('Pi', () =>
    expect(engine.box('Pi').domain.toJSON()).toMatchInlineSnapshot(
      `"["Domain","TranscendentalNumber"]"`
    ));
  test('-3.1415', () =>
    expect(engine.box(-3.1415).domain.toJSON()).toMatchInlineSnapshot(
      `"["Domain","NegativeNumber"]"`
    ));

  test('sym', () =>
    expect(engine.box('sym').domain.toJSON()).toMatchInlineSnapshot(
      `"["Domain","Anything"]"`
    ));

  test('True', () =>
    expect(engine.box('True').domain.json).toMatchInlineSnapshot(`
      [
        "Domain",
        "Boolean",
      ]
    `));
  test('["Range", 1, 5]', () =>
    expect(engine.box(['Range', 1, 5]).domain.json).toMatchInlineSnapshot(`
      [
        "Domain",
        "Void",
      ]
    `));
  test('["Range", 1, 5]', () =>
    expect(engine.box(['Range', 1, 5]).domain.json).toMatchInlineSnapshot(`
      [
        "Domain",
        "Void",
      ]
    `));

  // The symbol `Sin` references the sine function
  test('Symbol \\sin', () =>
    expect(() => engine.parse('\\sin').domain.json).toMatchInlineSnapshot(
      `[Function]`
    ));
  test('Symbol Sin', () =>
    expect(() => engine.box('Sin').domain.json).toMatchInlineSnapshot(
      `[Function]`
    ));

  test('\\sin(3)', () => {
    expect(engine.box(['Sin', 3]).domain.toJSON()).toMatchInlineSnapshot(
      `"["Domain",["Interval",-1,1]]"`
    );
  });
  test('Nothing', () => {
    expect(engine.box('Nothing').domain.json).toMatchInlineSnapshot(`
      [
        "Domain",
        "Nothing",
      ]
    `);
  });
});

describe('CANONICAL DOMAINS', () => {
  test("['Range', -Infinity, Infinity]", () =>
    expect(
      engine.box(['Range', -Infinity, Infinity]).toJSON()
    ).toMatchInlineSnapshot(
      `"["Range",{"num":"-Infinity"},{"num":"+Infinity"}]"`
    ));
  test("['Range', 0, Infinity]", () =>
    expect(engine.box(['Range', 0, Infinity]).toJSON()).toMatchInlineSnapshot(
      `"["Range",0,{"num":"+Infinity"}]"`
    ));

  // Domain of a domain
  test("['Range', -Infinity, Infinity]", () =>
    expect(engine.box(['Range', -Infinity, Infinity]).domain.json)
      .toMatchInlineSnapshot(`
      [
        "Domain",
        "Void",
      ]
    `));
});

describe('DOMAIN LITERALS', () => {
  test('Number <: String', () => {
    expect(
      engine.domain('Number').isCompatible(engine.domain('String'))
    ).toBeFalsy();
  });
  test('String <: Number', () => {
    expect(
      engine.domain('String').isCompatible(engine.domain('Number'))
    ).toBeFalsy();
  });
  test('Void <: Number', () => {
    expect(
      engine.domain('Void').isCompatible(engine.domain('Number'))
    ).toBeTruthy();
  });
  test('Number <: Void', () => {
    expect(
      engine.domain('Number').isCompatible(engine.domain('Void'))
    ).toBeFalsy();
  });
  test('Number <: Anything', () => {
    expect(
      engine.domain('Number').isCompatible(engine.domain('Anything'))
    ).toBeTruthy();
  });
  test('RealNumber <: Number', () => {
    expect(
      engine.domain('RealNumber').isCompatible(engine.domain('Number'))
    ).toBeTruthy();
  });
  test('RealNumber <: Value', () => {
    expect(
      engine.domain('RealNumber').isCompatible(engine.domain('Value'))
    ).toBeTruthy();
  });
  test('RealNumber <: Domain', () => {
    expect(
      engine.domain('RealNumber').isCompatible(engine.domain('Domain'))
    ).toBeFalsy();
  });
});

describe('NUMERIC', () => {
  test('Number <: Number', () => {
    expect(
      engine.domain('Number').isCompatible(engine.domain('Number'))
    ).toBeTruthy();
  });
  test('RealNumber <: RealNumber', () => {
    expect(
      engine.domain('RealNumber').isCompatible(engine.domain('RealNumber'))
    ).toBeTruthy();
  });
  test('PositiveNumber <: Number', () => {
    expect(
      engine.domain('PositiveNumber').isCompatible(engine.domain('Number'))
    ).toBeTruthy();
  });
  test('NegativeInteger <: Integer', () => {
    expect(
      engine.domain('NegativeInteger').isCompatible(engine.domain('Integer'))
    ).toBeTruthy();
  });
  test('NegativeInteger <: Integer', () => {
    expect(
      engine.domain('NegativeInteger').isCompatible(engine.domain('Integer'))
    ).toBeTruthy();
  });
  test('Integer <: RealNumber', () => {
    expect(
      engine.domain('Integer').isCompatible(engine.domain('RealNumber'))
    ).toBeTruthy();
  });
  test('RationalNumber <: ExtendedRealNumber', () => {
    expect(
      engine.domain('RationalNumber').isCompatible('ExtendedRealNumber')
    ).toBeTruthy();
  });
  test('RealNumber <: Integer', () => {
    expect(engine.domain('RealNumber').isCompatible('Integer')).toBeFalsy();
  });

  test('["Range", 1, 5] <: Integer', () => {
    expect(engine.domain(['Range', 1, 5]).isCompatible('Integer')).toBeTruthy();
  });
  test('Integer <: ["Range", 1, 5]', () => {
    expect(
      engine.domain('Integer').isCompatible(engine.domain(['Range', 1, 5]))
    ).toBeFalsy();
  });
});

describe('INVALID DOMAINS', () => {
  test('NotADomainLiteral', () =>
    expect(engine.domain('NotADomainLiteral').toJSON()).toMatchInlineSnapshot(
      `"["Error","[\\"ErrorCode\\",\\"'invalid-domain'\\",\\"'\\\\\\"NotADomainLiteral\\\\\\"'\\"]"]"`
    ));

  test('NotADomainConstructor', () => {
    expect(
      engine
        .domain([
          'NotADomainConstructor',
          'Integer',
        ] as unknown as DomainExpression)
        .toJSON()
    ).toMatchInlineSnapshot(
      `"["Error","[\\"ErrorCode\\",\\"'invalid-domain'\\",\\"'[\\\\\\"NotADomainConstructor\\\\\\",\\\\\\"Integer\\\\\\"]'\\"]"]"`
    );
  });

  test('Missing parameters (Range)', () => {
    expect(
      engine.domain(['Range'] as unknown as DomainExpression).toJSON()
    ).toMatchInlineSnapshot(
      `"["Error","[\\"ErrorCode\\",\\"'invalid-domain'\\",\\"'[\\\\\\"Range\\\\\\"]'\\"]"]"`
    );
  });

  test('Missing parameters (Maybe)', () => {
    expect(
      engine.domain(['Maybe'] as unknown as DomainExpression)
    ).toMatchInlineSnapshot(
      `"["Error","[\\"ErrorCode\\",\\"'invalid-domain'\\",\\"'[\\\\\\"Maybe\\\\\\"]'\\"]"]"`
    );
  });

  test('NotADomainLiteral in parametric expression', () =>
    expect(() =>
      engine.domain(['Function', 'NotADomainLiteral'])
    ).toThrowError());
});

// describe('SYMBOLS, FUNCTION HEADS', () => {});

describe.skip('FUNCTION SIGNATURES', () => {
  test("['Function', 'PositiveInteger', 'Anything'] <: ['Function', 'Number', 'Number']", () => {
    expect(
      engine
        .domain(['Function', 'PositiveInteger', 'Anything'])
        .isCompatible(engine.domain(['Function', 'Number', 'Number']))
    ).toBeTruthy();
  });

  test("['Function', 'PositiveInteger', 'Anything'] <: ['Function', 'Number', ['Maybe', 'String'],'Number']", () => {
    expect(
      engine
        .domain(['Function', 'PositiveInteger', 'Anything'])
        .isCompatible(
          engine.domain(['Function', 'Number', ['Maybe', 'String'], 'Number'])
        )
    ).toBeTruthy();
  });

  test("['Function', 'PositiveInteger',  'String', 'Anything'] <: ['Function', 'Number', ['Maybe', 'String'], 'Number']", () => {
    expect(
      engine
        .domain(['Function', 'PositiveInteger', 'String', 'Anything'])
        .isCompatible(
          engine.domain(['Function', 'Number', ['Maybe', 'String'], 'Number'])
        )
    ).toBeTruthy();
  });

  test("['Function', 'PositiveInteger',  'Boolean', 'Anything'] <: ['Function', 'Number', ['Maybe', 'String'], 'Number']", () => {
    expect(
      engine
        .domain(['Function', 'PositiveInteger', 'Boolean', 'Anything'])
        .isCompatible(
          engine.domain(['Function', 'Number', ['Maybe', 'String'], 'Number'])
        )
    ).toBeFalsy();
  });
});
