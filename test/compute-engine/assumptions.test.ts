import { ComputeEngine } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

export const ce = new ComputeEngine();

ce.assume(ce.box(['Equal', 'one', 1]));
ce.assume(ce.box(['Greater', 'x', 4]));
// ce.assume(['Element', 'm', ['Range', -Infinity, Infinity]]);   @fixme
// ce.assume(['Element', 'n', ['Range', 0, Infinity]]);   @fixme
ce.assume(ce.box(['Equal', 'o', 1]));
ce.assume(ce.box(['Equal', 'p', 11]));
// ce.assume(['Element', 'q', ['Range', -Infinity, 0]]);  @fixme
// ce.assume(['Element', 'r', ['Interval', ['Open', 0], +Infinity]]); @fixme

ce.assume(ce.box(['Greater', 's', 5]));
ce.assume(ce.box(['Greater', 't', 0]));

// console.info([...ce.context!.dictionary!.symbols.keys()]);

// TODO #18: Value Resolution from Equality Assumptions
// When `ce.assume(['Equal', 'one', 1])` is made, `ce.box('one').evaluate()` should return `1`
describe.skip('VALUE RESOLUTION FROM EQUALITY ASSUMPTIONS', () => {
  test(`one.value should be 1`, () => {
    expect(ce.box('one').evaluate().json).toEqual(1);
  });

  test(`one.domain should be integer`, () => {
    expect(ce.box('one').type.toString()).toBe('integer');
  });

  test(`Equal(one, 1) should evaluate to True`, () => {
    expect(ce.box(['Equal', 'one', 1]).evaluate().json).toEqual('True');
  });

  test(`Equal(o, 1) should evaluate to True`, () => {
    expect(ce.box(['Equal', 'o', 1]).evaluate().json).toEqual('True');
  });

  test(`NotEqual(one, 1) should evaluate to False`, () => {
    expect(ce.box(['NotEqual', 'one', 1]).evaluate().json).toEqual('False');
  });

  test(`Equal(one, 0) should evaluate to False`, () => {
    expect(ce.box(['Equal', 'one', 0]).evaluate().json).toEqual('False');
  });
});

// TODO #19: Inequality Evaluation Using Assumptions
// When `x > 4` is assumed, `['Greater', 'x', 0]` should evaluate to True
describe.skip('INEQUALITY EVALUATION USING ASSUMPTIONS', () => {
  test(`Greater(x, 0) should be True (x > 4 assumed)`, () => {
    expect(ce.box(['Greater', 'x', 0]).evaluate().json).toEqual('True');
  });

  test(`Less(x, 0) should be False (x > 4 assumed)`, () => {
    expect(ce.box(['Less', 'x', 0]).evaluate().json).toEqual('False');
  });

  test(`Greater(t, 0) should be True (t > 0 assumed)`, () => {
    expect(ce.box(['Greater', 't', 0]).evaluate().json).toEqual('True');
  });

  test(`Greater(one, 0) should be True (one = 1 assumed)`, () => {
    expect(ce.box(['Greater', 'one', 0]).evaluate().json).toEqual('True');
  });

  test(`Less(one, 0) should be False (one = 1 assumed)`, () => {
    expect(ce.box(['Less', 'one', 0]).evaluate().json).toEqual('False');
  });

  test(`GreaterEqual(one, 1) should be True`, () => {
    expect(ce.box(['GreaterEqual', 'one', 1]).evaluate().json).toEqual('True');
  });
});

// TODO #20: Tautology and Contradiction Detection
// ce.assume() should return 'tautology' for redundant assumptions and 'contradiction' for conflicting ones
describe.skip('TAUTOLOGY AND CONTRADICTION DETECTION', () => {
  test(`assuming one = 1 again should return tautology`, () => {
    expect(ce.assume(ce.box(['Equal', 'one', 1]))).toEqual('tautology');
  });

  test(`assuming one < 0 should return contradiction (one = 1)`, () => {
    expect(ce.assume(ce.box(['Less', 'one', 0]))).toEqual('contradiction');
  });

  test(`assuming x < 0 should return contradiction (x > 4)`, () => {
    expect(ce.assume(ce.box(['Less', 'x', 0]))).toEqual('contradiction');
  });

  test(`assuming x > 0 should return tautology (x > 4 implies x > 0)`, () => {
    expect(ce.assume(ce.box(['Greater', 'x', 0]))).toEqual('tautology');
  });
});

// TODO #21: Type Inference from Assumptions
// When assumptions are made, symbol types should be inferred
describe.skip('TYPE INFERENCE FROM ASSUMPTIONS', () => {
  test(`x should have type real (x > 4 assumed)`, () => {
    expect(ce.box('x').type.toString()).toBe('real');
  });

  test(`s should have type real (s > 5 assumed)`, () => {
    expect(ce.box('s').type.toString()).toBe('real');
  });

  test(`t should have type real (t > 0 assumed)`, () => {
    expect(ce.box('t').type.toString()).toBe('real');
  });

  test(`one should have type integer (one = 1 assumed)`, () => {
    expect(ce.box('one').type.toString()).toBe('integer');
  });

  test(`o should have type integer (o = 1 assumed)`, () => {
    expect(ce.box('o').type.toString()).toBe('integer');
  });

  test(`p should have type integer (p = 11 assumed)`, () => {
    expect(ce.box('p').type.toString()).toBe('integer');
  });
});

// Tests for assumption-based simplification (Issue #8 from TODO.md) - IMPLEMENTED
describe('ASSUMPTION-BASED SIMPLIFICATION', () => {
  test('sqrt(x^2) simplifies to x when x > 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('x');
  });

  test('sqrt(x^2) simplifies to x when x >= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\ge 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('x');
  });

  test('sqrt(x^2) simplifies to -x when x < 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x < 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('-x');
  });

  test('sqrt(x^2) simplifies to -x when x <= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\le 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('-x');
  });

  test('sqrt(x^2) returns |x| without assumptions', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('\\vert x\\vert');
  });

  test('|x| simplifies to x when x > 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('x');
  });

  test('|x| simplifies to x when x >= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\ge 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('x');
  });

  test('|x| simplifies to -x when x < 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x < 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('-x');
  });

  test('|x| simplifies to -x when x <= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\le 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('-x');
  });

  test('fourth root of x^4 simplifies to x when x > 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('\\sqrt[4]{x^4}').simplify().latex).toBe('x');
  });

  test('isPositive returns true when x > 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.box('x').isPositive).toBe(true);
    expect(ce.box('x').isNonNegative).toBe(true);
    expect(ce.box('x').isNegative).toBe(false);
  });

  test('isNegative returns true when x < 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x < 0'));
    expect(ce.box('x').isNegative).toBe(true);
    expect(ce.box('x').isNonPositive).toBe(true);
    expect(ce.box('x').isPositive).toBe(false);
  });

  test('isNonNegative returns true when x >= 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\ge 0'));
    expect(ce.box('x').isNonNegative).toBe(true);
    // Could be zero, so not strictly positive
    expect(ce.box('x').isPositive).toBe(undefined);
  });

  test('isNonPositive returns true when x <= 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\le 0'));
    expect(ce.box('x').isNonPositive).toBe(true);
    // Could be zero, so not strictly negative
    expect(ce.box('x').isNegative).toBe(undefined);
  });

  test('assumptions do not leak between engine instances', () => {
    const ce1 = new ComputeEngine();
    ce1.assume(ce1.parse('x > 0'));

    const ce2 = new ComputeEngine();
    // x should have unknown sign in ce2
    expect(ce2.parse('\\sqrt{x^2}').simplify().latex).toBe('\\vert x\\vert');
    expect(ce2.box('x').isPositive).toBe(undefined);
  });
});
