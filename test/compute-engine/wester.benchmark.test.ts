// A Review of CAS mathematical capabilities
// Michael Wester, University of New Mexico
// Nov 1996
// See also http://yacas.sourceforge.net/essayschapter2.html
// or http://www.mlb.co.jp/linux/science/yacas/documentation/essayschapter2.html

// Other benchmarks:
// http://134.155.108.17/cabench/ca-challenge.html

import { ComputeEngine } from '../../src/compute-engine';

export const ce = new ComputeEngine();

describe.skip('Wester CAS Test Suite', () => {
  test(`Wester 1`, () => {
    expect(ce.box(['Factorial', 50]).evaluate()).toMatchInlineSnapshot(
      `"[\\"Factorial\\",50]"`
    );
  });

  test(`Wester 2`, () => {
    expect(
      ce.box([['Factors', 'Factorial', 50]]).evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Pattern\\",[[\\"Pattern\\",\\"Factors\\"],[\\"Pattern\\",\\"Factorial\\"],[\\"Pattern\\",50]]]"`
    );
    // Verify(Factors(50!), {{2,47},{3,22},{5,12},
    // {7,8},{11,4},{13,3},{17,2},{19,2},{23,2},
    // {29,1},{31,1},{37,1},{41,1},{43,1},{47,1}});
  });

  test(`Wester 3`, () => {
    //['Divide', 4861 2520]
    expect(
      ce
        .parse(
          '\\frac12+\\frac13+\\frac14+\\frac15+\\frac16+\\frac17+\\frac18+\\frac19+\\frac{1}{10}'
        )
        .evaluate()
    ).toMatchInlineSnapshot(`"[\\"Rational\\",4861,2520]"`);
  });

  // test(`Wester 3`, () => {
  //   //['Divide', 4861 2520]
  //   expect(
  //     ce.box(['Sum', ['Divide', 1, '_'], ['Range', 2, 10]]).evaluate()
  //   ).toMatchInlineSnapshot();
  // });

  test(`Wester 4`, () => {
    // 262537412640768743
    // @todo: precision 50
    expect(
      ce.box(['Exp', ['Multiply', 'Pi', ['Sqrt', 163]]]).N()
    ).toMatchInlineSnapshot(
      `"{\\"num\\":\\"262537412640768743.9999999999992500725971981856888793538563373369908627075374103782106479101186073091\\"}"`
    );
  });

  // To Do Wester 5

  test(`Wester 6`, () => {
    expect(
      // 0.142857
      ce.box(['Divide', 1, 7]).N()
    ).toMatchInlineSnapshot(
      `"{\\"num\\":\\"0.1428571428571428571428571428571428571428571428571428571428571428571428571428571428571428571428571429\\"}"`
    );
  });

  // To Do Wester 7 (continuous fraction)

  test(`Wester 8`, () => {
    expect(
      // √(2√3+4) -> 1 + √3
      ce.parse('\\sqrt{2\\sqrt{3}+4}').evaluate()
      // ce.box(['Sqrt', ['Add', ['Multiply', 2, ['Sqrt', 3]], 4]]).evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Sqrt\\",[\\"Add\\",4,[\\"Multiply\\",2,[\\"Sqrt\\",3]]]]"`
    );
  });

  test(`Wester 9`, () => {
    // 3 + √2
    expect(
      ce
        .parse(
          '\\sqrt{14 + 3 \\sqrt{3 + 2 \\sqrt{5 - 12 \\sqrt{3 - 2 \\sqrt{2}}}}}'
        )!
        .evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Sqrt\\",[\\"Add\\",14,[\\"Multiply\\",3,[\\"Sqrt\\",[\\"Add\\",3,[\\"Multiply\\",2,[\\"Sqrt\\",[\\"Add\\",5,[\\"Multiply\\",-12,[\\"Sqrt\\",[\\"Add\\",3,[\\"Multiply\\",-2,[\\"Sqrt\\",2]]]]]]]]]]]]]"`
    );
  });

  test(`Wester 10`, () => {
    expect(ce.parse('2\\infty -3')!.evaluate()).toMatchInlineSnapshot(
      `Promise {}`
    );
  });

  test(`Wester 14`, () => {
    // Expect \frac{x - 2}{x + 2}
    expect(
      ce.parse('\\frac{x ^{2} - 4}{x ^{2} + 4 x + 4}').evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Divide\\",[\\"Subtract\\",[\\"Square\\",\\"x\\"],4],[\\"Add\\",4,[\\"Multiply\\",4,\\"x\\"],[\\"Square\\",\\"x\\"]]]"`
    );
  });

  test(`Wester 21`, () => {
    ce.forget('x');
    ce.forget('y');
    ce.forget('z');
    ce.assume(ce.parse('x \\gte y'));
    ce.assume(ce.parse('y \\gte z'));
    ce.assume(ce.parse('z \\gte x'));
    expect(ce.parse('x = z').evaluate()).toMatchInlineSnapshot(`"\\"False\\""`);
  });

  test(`Wester 22`, () => {
    ce.forget('x');
    ce.forget('y');
    ce.assume(ce.parse('x \\gt y'));
    ce.assume(ce.parse('y \\gt 0'));
    expect(ce.parse('2x^2 > 2y^2').evaluate()).toMatchInlineSnapshot(
      `"[\\"Greater\\",[\\"Multiply\\",2,[\\"Square\\",\\"x\\"]],[\\"Multiply\\",2,[\\"Square\\",\\"y\\"]]]"`
    );
  });

  test(`Wester 26`, () => {
    // Expect 0
    expect(
      ce.parse('\\sqrt{997} - (997^3)^{\\frac16}').evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Subtract\\",[\\"Sqrt\\",997],[\\"Root\\",991026973,6]]"`
    );
  });

  test(`Wester 27`, () => {
    // Expect 0
    expect(
      ce.parse('\\sqrt{999983} - (99983^3)^{\\frac16}').evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Subtract\\",[\\"Sqrt\\",999983],[\\"Root\\",[\\"Power\\",99983,3],6]]"`
    );
  });

  test(`Wester 28`, () => {
    // Expect 0
    expect(
      ce
        .parse(
          '(2^{\\frac13} + 4^{\\frac13})^3 - 6(2^{\\frac13} + 4^{\\frac13}) - 6'
        )!
        .evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Add\\",-6,[\\"Multiply\\",-6,[\\"Root\\",2,3]],[\\"Multiply\\",-6,[\\"Root\\",4,3]],[\\"Power\\",[\\"Add\\",[\\"Root\\",2,3],[\\"Root\\",4,3]],3]]"`
    );
  });

  test(`Wester 29`, () => {
    // Expect 0
    ce.assume(ce.parse('x > 0'));
    ce.assume(ce.parse('y > 0'));
    // Expect 0
    expect(
      ce.parse('x^{\\frac1n}y^{\\frac1n}-(xy)^{\\frac1n}')!.evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Subtract\\",[\\"Multiply\\",[\\"Power\\",\\"x\\",[\\"Divide\\",1,\\"n\\"]],[\\"Power\\",\\"y\\",[\\"Divide\\",1,\\"n\\"]]],[\\"Power\\",[\\"Multiply\\",\\"x\\",\\"y\\"],[\\"Divide\\",1,\\"n\\"]]]"`
    );
  });

  test(`Wester 121`, () => {
    // Expect False
    expect(ce.box(['And', 'True', 'False']).evaluate()).toMatchInlineSnapshot(
      `"\\"False\\""`
    );
  });

  test(`Wester 122`, () => {
    // Expect true
    expect(ce.box(['Or', 'x', ['Not', 'x']]).evaluate()).toMatchInlineSnapshot(
      `"\\"True\\""`
    );
  });

  test(`Wester 123`, () => {
    // Expect x or y
    expect(
      ce.box(['Or', 'x', 'y', ['And', 'x', 'y']]).evaluate()
    ).toMatchInlineSnapshot(
      `"[\\"Or\\",\\"x\\",\\"y\\",[\\"And\\",\\"x\\",\\"y\\"]]"`
    );
  });
});
