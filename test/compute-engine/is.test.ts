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
    const expr = engine.expr(a);
    if (
      typeof b === 'number' ||
      typeof b === 'bigint' ||
      typeof b === 'boolean'
    ) {
      expect(expr.is(b)).toBe(expected);
    } else {
      expect(expr.is(engine.expr(b))).toBe(expected);
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
    const expr = engine.expr(a);
    if (
      typeof b === 'number' ||
      typeof b === 'bigint' ||
      typeof b === 'boolean' ||
      typeof b === 'string'
    ) {
      expect(expr.isSame(b)).toBe(expected);
    } else {
      expect(expr.isSame(engine.expr(b))).toBe(expected);
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

describe('is() with assigned variables', () => {
  test('expression with assigned variable evaluates', () => {
    engine.assign('v', 2);
    expect(engine.parse('1 + 4 / v').is(3)).toBe(true);
    engine.forget('v');
  });

  test('expression with unassigned variable does not evaluate', () => {
    expect(engine.parse('1 + 4 / w').is(3)).toBe(false);
  });

  test('assigned variable via symbol', () => {
    engine.assign('v', 42);
    expect(engine.symbol('v').is(42)).toBe(true);
    engine.forget('v');
  });

  test('reassigned variable reflects new value', () => {
    engine.assign('v', 2);
    expect(engine.parse('v + 1').is(3)).toBe(true);
    engine.assign('v', 10);
    expect(engine.parse('v + 1').is(11)).toBe(true);
    engine.forget('v');
  });
});

describe('is() with explicit tolerance', () => {
  test('literal number within custom tolerance', () => {
    expect(engine.number(1e-17).is(0, 1e-16)).toBe(true);
  });

  test('literal number outside custom tolerance', () => {
    expect(engine.number(1e-17).is(0, 1e-18)).toBe(false);
  });

  test('literal number without tolerance (exact)', () => {
    expect(engine.number(1e-17).is(0)).toBe(false);
  });

  test('pi within custom tolerance', () => {
    expect(engine.parse('\\pi').is(3.14, 0.01)).toBe(true);
  });

  test('pi outside custom tolerance', () => {
    expect(engine.parse('\\pi').is(3.14, 0.0001)).toBe(false);
  });

  test('expression vs expression with tolerance', () => {
    // sin(pi) ≈ 1.2e-16, compare to a small nonzero number
    const expr = engine.parse('\\sin(\\pi)');
    expect(expr.is(engine.number(1e-10), 1e-9)).toBe(true);
    expect(expr.is(engine.number(1e-10), 1e-17)).toBe(false);
  });

  test('tolerance with assigned variable', () => {
    engine.assign('v', 2);
    // 4/v = 2, so 1 + 4/v = 3
    expect(engine.parse('1 + 4 / v').is(3.001, 0.01)).toBe(true);
    expect(engine.parse('1 + 4 / v').is(3.001, 0.0001)).toBe(false);
    engine.forget('v');
  });
});

describe('is() with expansion', () => {
  test('(x+1)^2 is x^2+2x+1', () => {
    const a = engine.parse('(x+1)^2');
    const b = engine.parse('x^2+2x+1');
    expect(a.is(b)).toBe(true);
  });

  test('(a+b)(a-b) is a^2-b^2', () => {
    const a = engine.parse('(a+b)(a-b)');
    const b = engine.parse('a^2-b^2');
    expect(a.is(b)).toBe(true);
  });

  test('2(x+1) is 2x+2', () => {
    const a = engine.parse('2(x+1)');
    const b = engine.parse('2x+2');
    expect(a.is(b)).toBe(true);
  });

  test('expansion does not fire for simple Add', () => {
    // This should still work via isSame, not expansion
    const a = engine.parse('x+1');
    const b = engine.parse('x+1');
    expect(a.is(b)).toBe(true);
  });

  test('non-equivalent expressions are not equal', () => {
    const a = engine.parse('(x+1)^2');
    const b = engine.parse('x^2+1');
    expect(a.is(b)).toBe(false);
  });
});

describe('is() symmetry', () => {
  test('number.is(expression) equals expression.is(number)', () => {
    const num = engine.number(1.4142135623730951);
    const expr = engine.parse('\\sqrt{2}');
    expect(expr.is(num)).toBe(true);
    expect(num.is(expr)).toBe(true);
  });

  test('number.is(trig expression) equals trig expression.is(number)', () => {
    const zero = engine.number(0);
    const sinPi = engine.parse('\\sin(\\pi)');
    expect(sinPi.is(zero)).toBe(true);
    expect(zero.is(sinPi)).toBe(true);
  });

  test('symmetry with explicit tolerance', () => {
    const num = engine.number(3.14);
    const pi = engine.parse('\\pi');
    expect(pi.is(num, 0.01)).toBe(true);
    expect(num.is(pi, 0.01)).toBe(true);
    expect(pi.is(num, 0.0001)).toBe(false);
    expect(num.is(pi, 0.0001)).toBe(false);
  });

  test('symmetry with assigned variable', () => {
    engine.assign('v', 2);
    const num = engine.number(3);
    const expr = engine.parse('1 + 4 / v');
    expect(expr.is(num)).toBe(true);
    expect(num.is(expr)).toBe(true);
    engine.forget('v');
  });

  test('symmetry: both false when free variables present', () => {
    const num = engine.number(5);
    const expr = engine.parse('x + 1');
    expect(expr.is(num)).toBe(false);
    expect(num.is(expr)).toBe(false);
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
