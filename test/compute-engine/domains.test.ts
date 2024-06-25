import { ComputeEngine, DomainExpression } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

export const engine = new ComputeEngine();

describe('Domain of function identifiers', () =>
  test('Domain of \\sin', () =>
    expect(engine.parse('\\sin')?.domain?.toJSON()).toMatchInlineSnapshot(`
      [
        FunctionOf,
        Numbers,
        Numbers,
      ]
    `)));

describe('Domain of function identifiers', () =>
  test('Domain of Sin', () =>
    expect(engine.box('Sin').domain?.toJSON()).toMatchInlineSnapshot(`
      [
        FunctionOf,
        Numbers,
        Numbers,
      ]
    `)));

describe('INFERRED DOMAINS', () => {
  test('42', () =>
    expect(engine.box(42).domain?.toJSON()).toMatchInlineSnapshot(
      `PositiveIntegers`
    ));
  test('Pi', () =>
    expect(engine.box('Pi').domain?.toJSON()).toMatchInlineSnapshot(
      `TranscendentalNumbers`
    ));
  test('-3.1415', () =>
    expect(engine.box(-3.1415).domain?.toJSON()).toMatchInlineSnapshot(
      `NegativeNumbers`
    ));

  test('sym', () =>
    expect(
      engine.box('sym').domain?.toJSON() ?? 'undefined'
    ).toMatchInlineSnapshot(`undefined`));

  test('True', () =>
    expect(engine.box('True').domain?.json).toMatchInlineSnapshot(`Booleans`));

  // The symbol `Sin` references the sine function
  test('Symbol \\sin', () =>
    expect(engine.parse('\\sin')?.domain?.toJSON()).toMatchInlineSnapshot(`
      [
        FunctionOf,
        Numbers,
        Numbers,
      ]
    `));

  test('Symbol Sin', () =>
    expect(engine.box('Sin').domain?.toJSON()).toMatchInlineSnapshot(`
      [
        FunctionOf,
        Numbers,
        Numbers,
      ]
    `));

  test('\\sin(3)', () => {
    expect(engine.box(['Sin', 3]).domain?.toJSON()).toMatchInlineSnapshot(
      `Numbers`
    );
  });
  test('Nothing', () => {
    expect(engine.symbol('Nothing').domain?.json).toMatchInlineSnapshot(
      `NothingDomain`
    );
  });

  test('Symbol domain inference', () => {
    engine.assign('numSymbol', 42);
    expect(engine.symbol('numSymbol').domain?.json).toMatchInlineSnapshot(
      `PositiveIntegers`
    );
    // Widening to reals
    engine.assign('numSymbol', 456.234);
    expect(engine.symbol('numSymbol').domain?.json).toMatchInlineSnapshot(
      `RealNumbers`
    );

    // Widening to Values
    engine.assign('numSymbol', "'hello'");
    expect(engine.symbol('numSymbol').domain?.json).toMatchInlineSnapshot(
      `Values`
    );

    // Booleans
    engine.assign('booleanSymbol', true);
    expect(engine.symbol('booleanSymbol').domain?.json).toMatchInlineSnapshot(
      `Booleans`
    );

    // Strings
    engine.assign('stringSymbol', "'hello'");
    expect(engine.symbol('stringSymbol').domain?.json).toMatchInlineSnapshot(
      `Strings`
    );
  });
});

describe('DOMAIN LITERALS', () => {
  test('Number <: String', () => {
    expect(
      engine.domain('Numbers').isCompatible(engine.domain('Strings'))
    ).toBeFalsy();
  });
  test('String <: Number', () => {
    expect(
      engine.domain('Strings').isCompatible(engine.domain('Numbers'))
    ).toBeFalsy();
  });
  test('Void <: Number', () => {
    expect(
      engine.domain('Void').isCompatible(engine.domain('Numbers'))
    ).toBeTruthy();
  });
  test('Number <: Void', () => {
    expect(
      engine.domain('Numbers').isCompatible(engine.domain('Void'))
    ).toBeFalsy();
  });
  test('Number <: Anything', () => {
    expect(
      engine.domain('Numbers').isCompatible(engine.domain('Anything'))
    ).toBeTruthy();
  });
  test('RealNumber <: Number', () => {
    expect(
      engine.domain('RealNumbers').isCompatible(engine.domain('Numbers'))
    ).toBeTruthy();
  });
  test('RealNumber <: Value', () => {
    expect(
      engine.domain('RealNumbers').isCompatible(engine.domain('Values'))
    ).toBeTruthy();
  });
  test('RealNumber <: Domain', () => {
    expect(
      engine.domain('RealNumbers').isCompatible(engine.domain('Domains'))
    ).toBeFalsy();
  });
});

describe('NUMERIC', () => {
  test('Number <: Number', () => {
    expect(
      engine.domain('Numbers').isCompatible(engine.domain('Numbers'))
    ).toBeTruthy();
  });
  test('RealNumber <: RealNumber', () => {
    expect(
      engine.domain('RealNumbers').isCompatible(engine.domain('RealNumbers'))
    ).toBeTruthy();
  });
  test('PositiveNumber <: Number', () => {
    expect(
      engine.domain('PositiveNumbers').isCompatible(engine.domain('Numbers'))
    ).toBeTruthy();
  });
  test('NegativeInteger <: Integer', () => {
    expect(
      engine.domain('NegativeIntegers').isCompatible(engine.domain('Integers'))
    ).toBeTruthy();
  });
  test('NegativeInteger <: Integer', () => {
    expect(
      engine.domain('NegativeIntegers').isCompatible(engine.domain('Integers'))
    ).toBeTruthy();
  });
  test('Integer <: RealNumber', () => {
    expect(
      engine.domain('Integers').isCompatible(engine.domain('RealNumbers'))
    ).toBeTruthy();
  });
  test('RationalNumber <: ExtendedRealNumber', () => {
    expect(
      engine.domain('RationalNumbers').isCompatible('ExtendedRealNumbers')
    ).toBeTruthy();
  });
  test('RealNumber <: Integer', () => {
    expect(engine.domain('RealNumbers').isCompatible('Integers')).toBeFalsy();
  });
});

describe('INVALID DOMAINS', () => {
  test('NotADomainLiteral', () =>
    expect(() => engine.domain('NotADomainLiteral' as any).toJSON()).toThrow());

  test('NotADomainConstructor', () => {
    expect(() =>
      engine
        .domain([
          'NotADomainConstructor',
          'Integers',
        ] as unknown as DomainExpression)
        .toJSON()
    ).toThrow();
  });

  test('OptArg outside of FunctionOf', () => {
    expect(() =>
      engine.domain(['OptArg'] as unknown as DomainExpression)
    ).toThrow();
  });

  test('OptArg missing arguments', () => {
    expect(() =>
      engine.domain(['FunctionOf', ['OptArg']] as unknown as DomainExpression)
    ).toThrow();
  });

  test('NotADomainLiteral in parametric expression', () =>
    expect(() =>
      engine.domain(['FunctionOf', 'NotADomainLiteral' as any])
    ).toThrow());
});

// describe('SYMBOLS, FUNCTION HEADS', () => {});

describe.skip('FUNCTION SIGNATURES', () => {
  test("['FunctionOf', 'PositiveIntegers', 'Anything'] <: ['FunctionOf', 'Numbers', 'Numbers']", () => {
    expect(
      engine
        .domain(['FunctionOf', 'PositiveIntegers', 'Anything'])
        .isCompatible(engine.domain(['FunctionOf', 'Numbers', 'Numbers']))
    ).toBeTruthy();
  });

  test("['FunctionOf', 'PositiveIntegers', 'Anything'] <: ['FunctionOf', 'Numbers', ['OptArg', 'Strings'],'Numbers']", () => {
    expect(
      engine
        .domain(['FunctionOf', 'PositiveIntegers', 'Anything'])
        .isCompatible(
          engine.domain([
            'FunctionOf',
            'Numbers',
            ['OptArg', 'Strings'],
            'Numbers',
          ])
        )
    ).toBeTruthy();
  });

  test("['FunctionOf', 'PositiveIntegers',  'Strings', 'Anything'] <: ['FunctionOf', 'Numbers', ['OptArg', 'Strings'], 'Numbers']", () => {
    expect(
      engine
        .domain(['FunctionOf', 'PositiveIntegers', 'Strings', 'Anything'])
        .isCompatible(
          engine.domain([
            'FunctionOf',
            'Numbers',
            ['OptArg', 'Strings'],
            'Numbers',
          ])
        )
    ).toBeTruthy();
  });

  test("['FunctionOf', 'PositiveIntegers',  'Booleans', 'Anything'] <: ['FunctionOf', 'Numbers', ['OptArg', 'Strings'], 'Numbers']", () => {
    expect(
      engine
        .domain(['FunctionOf', 'PositiveIntegers', 'Booleans', 'Anything'])
        .isCompatible(
          engine.domain([
            'FunctionOf',
            'Numbers',
            ['OptArg', 'Strings'],
            'Numbers',
          ])
        )
    ).toBeFalsy();
  });
});
