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

describe.skip('TAUTOLOGY one = 1', () => {
  test(`one.value`, () => {
    expect(ce.box('one').evaluate().json).toEqual(1);
  });
  test(`one.domain`, () => {
    expect(ce.box('one').type.toString()).toMatchInlineSnapshot(`unknown`);
  });
  test(`'one' compared to 0`, () => {
    expect(ce.assume(ce.box(['Greater', 'one', 0]))).toMatchInlineSnapshot(
      `ok`
    );
    expect(ce.box(['Greater', 'one', 0]).evaluate().json).toEqual('True');
    expect(ce.box(['Less', 'one', 0]).evaluate().json).toEqual('False');
    expect(ce.box(['Equal', 'one', 0]).evaluate().json).toEqual('False');
    expect(ce.box(['Greater', 'one', 0]).evaluate().json).toEqual('True');
    expect(ce.box(['Greater', 'one', -10]).evaluate().json).toEqual('True');
  });
  test(`one >= 1`, () => {
    expect(ce.assume(ce.box(['GreaterEqual', 'one', 1]))).toMatchInlineSnapshot(
      `ok`
    );
    expect(ce.box(['Greater', 'one', 0]).evaluate().json).toEqual('True');
    expect(ce.box(['Less', 'one', 0]).evaluate().json).toEqual('False');
    expect(ce.box(['Equal', 'one', 0]).evaluate().json).toEqual('False');
    expect(ce.box(['Equal', 'one', 1]).evaluate().json).toEqual('True');
  });
  test(`one = 1`, () => {
    expect(ce.assume(ce.box(['Equal', 'one', 1]))).toEqual(`tautology`);
    expect(ce.box(['Equal', 'one', 1]).evaluate().json).toEqual('True');
    expect(ce.box(['Equal', 'one', 0]).evaluate().json).toEqual('False');
  });
});

describe.skip('CONTRADICTIONS', () => {
  test(`a < 0`, () => {
    expect(ce.assume(ce.box(['Less', 'one', 0]))).toEqual(`contradiction`);
  });
});

describe.skip('is() values', () => {
  // test(`> 0`, () => {
  //   expect(ce.box(['Greater', 'x', 0]).evaluate().symbol!).toBe('False');
  //   expect(ce.box(['Greater', 'one', 0]).evaluate().symbol!).toBe('True');
  // });

  test(`= 0`, () => {
    // expect(ce.is(['Equal', 'x', 0])).toBeFalsy();
    // expect(ce.is(['Equal', 'one', 0])).toBeFalsy();
  });

  test(`= 1`, () => {
    // expect(ce.is(['Equal', 'x', 1])).toBeFalsy();
    // expect(ce.is(['Equal', 'one', 1])).toBeTruthy();
    // expect(ce.is(['Equal', 'o', 1])).toBeTruthy();
  });

  test(`!= 1`, () => {
    // expect(ce.is(['NotEqual', 'x', 1])).toBeTruthy();
    // expect(ce.is(['NotEqual', 'one', 1])).toBeFalsy();
    // expect(ce.is(['NotEqual', 'o', 1])).toBeFalsy();
  });

  test(`< 0`, () => {
    // expect(ce.is(['Less', 'x', 0])).toBeFalsy();
    // expect(ce.is(['Less', 'one', 0])).toBeFalsy();
  });
});

describe.skip('is() values', () => {
  test(`is positive`, () => {
    // expect(ce.is(['Element', 'r', 'RealNumber'])).toBeTruthy();
    // expect(ce.is(['Greater', 'r', 0])).toBeTruthy();
  });
});

describe.skip('canonical types', () => {
  test(`Range types`, () => {
    expect(ce.box('m').type.toString() ?? 'undefined').toMatchInlineSnapshot(
      `unknown`
    );
    expect(ce.box('n').type.toString() ?? 'undefined').toMatchInlineSnapshot(
      `unknown`
    );
    expect(ce.box('q').type.toString() ?? 'undefined').toMatchInlineSnapshot(
      `unknown`
    );
  });

  test(`Interval types`, () => {
    expect(ce.box('t').type.toString() ?? 'undefined').toMatchInlineSnapshot(
      `unknown`
    );
    expect(ce.box('s').type.toString() ?? 'undefined').toMatchInlineSnapshot(
      `unknown`
    );
  });
});

// Tests for assumption-based simplification (Issue #8 from TODO.md)
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
