import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression as Expression } from '../../src/math-json/types';

export const engine = new ComputeEngine();

const tests: [Expression, Expression | number | bigint | boolean, boolean][] = [
  [1, 1, true],
  [1, 1n, true],
  [1, 2, false],
  [1, false, false],
  [1, 1.0, true],
  [1, 1.0000000000000001, true],
  [1, 1.0000000000000002, false],
  ['one', 1, true],
  ['one', 'one', true],
  ['one', 'zero', false],
  ['one', 1n, true],
  ['one', 2, false],
  ['zero', 0, true],
  ['zero', 0n, true],
  ['zero', 1, false],
  ['x', 1, false],
  ['boolean', true, true],
  ['boolean', false, false],
  ['boolean', 1, false],
  ['string', "'hello'", true],
  ['string', "'world'", false],
  ['string', 1, false],
  ['undeclared', 1, false],
  ['nan', NaN, true],
  ['nan', 1, false],
  [['Divide', 84, 2], 42, true],
  [['Divide', 'x', 2], 42, false],
  ['nan', 'nan', true],
];

describe('is()', () => {
  beforeAll(() => {
    engine.declare('x', 'real');
    engine.assign('one', 1);
    engine.assign('zero', 0);
    engine.assign('boolean', true);
    engine.assign('string', "'hello'");
    engine.assign('nan', NaN);
    engine.assign('infinity', Infinity);
  });

  // https://jestjs.io/docs/next/api#testeachtablename-fn-timeout
  test.each(tests)('is("%p")', (a, b, expected) => {
    const expr = engine.box(a);
    if (
      typeof b === 'number' ||
      typeof b === 'bigint' ||
      typeof b === 'boolean'
    ) {
      expect(expr.is(b)).toBe(expected);
    } else {
      expect(expr.is(engine.box(b))).toBe(expected);
    }
  });
});

const isSameTests: [
  Expression,
  Expression | number | bigint | boolean | string,
  boolean,
][] = [
  // Number primitives
  [42, 42, true],
  [42, 43, false],
  [0, 0, true],
  [1, 1n, true],
  [NaN, NaN, true],

  // Boolean primitives
  ['True', true, true],
  ['False', false, true],
  ['True', false, false],
  ['False', true, false],

  // String primitives
  [{ str: 'hello' }, 'hello', true],
  [{ str: 'hello' }, 'world', false],

  // Expression arguments (structural equality)
  [1, 1, true],
  [['Add', 'x', 1], ['Add', 'x', 1], true],

  // Symbol with value binding
  ['one', 1, true],
  ['one', 2, false],
  ['zero', 0, true],
  ['nan', NaN, true],
];

describe('isSame()', () => {
  test.each(isSameTests)('isSame(%p, %p)', (a, b, expected) => {
    const expr = engine.box(a);
    if (
      typeof b === 'number' ||
      typeof b === 'bigint' ||
      typeof b === 'boolean' ||
      typeof b === 'string'
    ) {
      expect(expr.isSame(b)).toBe(expected);
    } else {
      expect(expr.isSame(engine.box(b))).toBe(expected);
    }
  });
});

describe('smart is() with numeric evaluation fallback', () => {
  test('sin(pi) is 0', () => {
    expect(engine.parse('\\sin(\\pi)').is(0)).toBe(true);
  });

  test('cos(0) is 1', () => {
    expect(engine.parse('\\cos(0)').is(1)).toBe(true);
  });

  test('sin(1) is not 0', () => {
    expect(engine.parse('\\sin(1)').is(0)).toBe(false);
  });

  test('literal number 1e-17 is not 0 (no tolerance for literals)', () => {
    expect(engine.number(1e-17).is(0)).toBe(false);
  });

  test('x + 1 is not 1 (not constant, no fallback)', () => {
    expect(engine.parse('x + 1').is(1)).toBe(false);
  });

  test('cos(pi) is -1', () => {
    expect(engine.parse('\\cos(\\pi)').is(-1)).toBe(true);
  });

  test('cos(pi/2) is 0', () => {
    expect(engine.parse('\\cos(\\frac{\\pi}{2})').is(0)).toBe(true);
  });

  test('exp(0) is 1', () => {
    expect(engine.parse('e^0').is(1)).toBe(true);
  });
});

describe('edge cases: infinity and NaN', () => {
  test('PositiveInfinity.isSame(Infinity)', () => {
    expect(engine.symbol('PositiveInfinity').isSame(Infinity)).toBe(true);
  });

  test('NegativeInfinity.isSame(-Infinity)', () => {
    expect(engine.symbol('NegativeInfinity').isSame(-Infinity)).toBe(true);
  });

  test('PositiveInfinity.is(Infinity)', () => {
    expect(engine.symbol('PositiveInfinity').is(Infinity)).toBe(true);
  });

  test('NaN symbol.is(NaN)', () => {
    expect(engine.symbol('NaN').is(NaN)).toBe(true);
  });

  test('ComplexInfinity.is(Infinity) should be false', () => {
    // ComplexInfinity has no definite sign, should not equal +Infinity
    expect(engine.symbol('ComplexInfinity').is(Infinity)).toBe(false);
  });

  test('expression vs expression: PositiveInfinity.is(PositiveInfinity)', () => {
    const a = engine.symbol('PositiveInfinity');
    const b = engine.symbol('PositiveInfinity');
    expect(a.is(b)).toBe(true);
  });

  test('1/0 is ComplexInfinity, not +Infinity', () => {
    // 1/0 canonicalizes to ComplexInfinity (unsigned infinity)
    // ComplexInfinity should NOT equal +Infinity
    const expr = engine.parse('\\frac{1}{0}');
    expect(expr.is(Infinity)).toBe(false);
  });

  test('expression vs expression: both evaluate to infinity', () => {
    // Two constant expressions that both diverge to +infinity
    // should match via isSame on the symbols, not via numeric comparison
    const a = engine.parse('\\frac{1}{0}');
    const b = engine.parse('\\frac{2}{0}');
    // Both are ComplexInfinity, so they are isSame
    expect(a.is(b)).toBe(true);
  });

  test('number Infinity roundtrip', () => {
    // ce.number(Infinity) creates a BoxedNumber with value Infinity
    expect(engine.number(Infinity).is(Infinity)).toBe(true);
    expect(engine.number(-Infinity).is(-Infinity)).toBe(true);
    expect(engine.number(Infinity).is(-Infinity)).toBe(false);
  });

  test('NaN roundtrip', () => {
    expect(engine.number(NaN).is(NaN)).toBe(true);
    expect(engine.number(NaN).is(0)).toBe(false);
  });
});
