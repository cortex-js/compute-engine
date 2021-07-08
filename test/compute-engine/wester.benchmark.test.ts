// A Review of CAS mathematical capabilities
// Michael Wester, University of New Mexico
// Nov 1996
// See also http://yacas.sourceforge.net/essayschapter2.html
// or http://www.mlb.co.jp/linux/science/yacas/documentation/essayschapter2.html

// Other benchmarks:
// http://134.155.108.17/cabench/ca-challenge.html

import { ComputeEngine } from '../../src/cortex';

export const ce = new ComputeEngine();

describe.skip('Wester CAS Test Suite', () => {
  test(`Wester 1`, () => {
    expect(ce.evaluate(['Factorial', 50])).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 2`, () => {
    expect(ce.evaluate([['Factors', 'Factorial', 50]])).toMatchInlineSnapshot(
      `Promise {}`
    );
    // Verify(Factors(50!), {{2,47},{3,22},{5,12},
    // {7,8},{11,4},{13,3},{17,2},{19,2},{23,2},
    // {29,1},{31,1},{37,1},{41,1},{43,1},{47,1}});
  });

  test(`Wester 3`, () => {
    //['Divide', 4861 2520]
    expect(
      ce.evaluate(['Sum', ['Divide', 1, '_'], ['Range', 2, 10]])
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 4`, () => {
    // 262537412640768743
    expect(
      ce.N(['Exp', ['Multiply', 'Pi', ['Sqrt', 163]]], { precision: 50 })
    ).toMatchInlineSnapshot(`"Exp"`);
  });

  // To Do Wester 5

  test(`Wester 6`, () => {
    expect(
      // 0.142857
      ce.N(['Divide', 1, 7])
    ).toMatchInlineSnapshot(`"Divide"`);
  });

  // To Do Wester 7 (continuous fraction)

  test(`Wester 8`, () => {
    expect(
      // 1 + √3
      ce.evaluate(['Sqrt', ['Add', ['Multiply', 2, ['Sqrt', 3]], 4]])
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 9`, () => {
    // 3 + √2
    expect(
      ce.evaluate(
        ce.parse(
          '\\sqrt{14 + 3 \\sqrt{3 + 2 \\sqrt{5 - 12 \\sqrt{3 - 2 \\sqrt{2}}}}}'
        )
      )
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 10`, () => {
    expect(ce.evaluate(ce.parse('2\\infty -3'))).toMatchInlineSnapshot(
      `Promise {}`
    );
  });

  test(`Wester 14`, () => {
    // Expect \frac{x - 2}{x + 2}
    expect(
      ce.evaluate(ce.parse('\\frac{x ^{2} - 4}{x ^{2} + 4 x + 4}'))
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 21`, () => {
    ce.forget('x');
    ce.forget('y');
    ce.forget('z');
    ce.assume(ce.parse('x \\gte y'));
    ce.assume(ce.parse('y \\gte z'));
    ce.assume(ce.parse('z \\gte x'));
    expect(ce.is(ce.parse('x = z'))).toMatchInlineSnapshot(`undefined`);
  });

  test(`Wester 22`, () => {
    ce.forget('x');
    ce.forget('y');
    ce.assume(ce.parse('x \\gt y'));
    ce.assume(ce.parse('y \\gt 0'));
    expect(ce.is(ce.parse('2x^2 > 2y^2'))).toMatchInlineSnapshot(`undefined`);
  });

  test(`Wester 26`, () => {
    // Expect 0
    expect(
      ce.evaluate(ce.parse('\\sqrt{997} - (997^3)^{\\frac16}'))
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 27`, () => {
    // Expect 0
    expect(
      ce.evaluate(ce.parse('\\sqrt{999983} - (99983^3)^{\\frac16}'))
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 28`, () => {
    // Expect 0
    expect(
      ce.evaluate(
        ce.parse(
          '(2^{\\frac13} + 4^{\\frac13})^3 - 6(2^{\\frac13} + 4^{\\frac13}) - 6'
        )
      )
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 29`, () => {
    // Expect 0
    ce.assume(ce.parse('x > 0'));
    ce.assume(ce.parse('y > 0'));
    // Expect 0
    expect(
      ce.evaluate(ce.parse('x^{\\frac1n}y^{\\frac1n}-(xy)^{\\frac1n}'))
    ).toMatchInlineSnapshot(`Promise {}`);
  });

  test(`Wester 121`, () => {
    // Expect False
    expect(ce.evaluate(['And', 'True', 'False'])).toMatchInlineSnapshot(
      `Promise {}`
    );
  });

  test(`Wester 122`, () => {
    // Expect true
    expect(ce.evaluate(['Or', 'x', ['Not', 'x']])).toMatchInlineSnapshot(
      `Promise {}`
    );
  });

  test(`Wester 123`, () => {
    // Expect x or y
    expect(
      ce.evaluate(['Or', 'x', 'y', ['And', 'x', 'y']])
    ).toMatchInlineSnapshot(`Promise {}`);
  });
});
