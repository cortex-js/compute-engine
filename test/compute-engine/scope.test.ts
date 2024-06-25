import { ComputeEngine } from '../../src/compute-engine/compute-engine';

import { engine } from '../utils';

const ce: ComputeEngine = engine;

describe('SETTING/FORGETTING', () => {
  test(`Forget with forget()`, () => {
    ce.assign({ x1: 42 });
    // This probes the value of the symbol
    expect(ce.box(`x1`).json).toMatch('x1');
    expect(ce.symbol(`x1`).json).toMatch('x1');
    expect(ce.box(`x1`).evaluate().json).toEqual(42);
    // This probe the value of the symbol in an expression
    expect(ce.box(['Add', 'x1', 1]).evaluate().json).toEqual(43);

    const expr = ce.box(['Add', 'x1', -1]);
    expect(expr).toMatchInlineSnapshot(`["Subtract", "x1", 1]`);
    expect(expr.evaluate().json).toEqual(41);

    ce.forget('x1');

    // Expression should be symbolic 'x1'
    expect(expr).toMatchInlineSnapshot(`["Subtract", "x1", 1]`);
    expect(expr.evaluate()).toMatchInlineSnapshot(`["Subtract", "x1", 1]`);

    expect(ce.box(`x1`).domain).toMatchInlineSnapshot(`PositiveIntegers`);
    expect(ce.box(`x1`)).toMatchInlineSnapshot(`x1`);
    expect(ce.box(`x1`).evaluate()).toMatchInlineSnapshot(`x1`);
    expect(ce.box(['Add', 'x1', 5]).evaluate()).toMatchInlineSnapshot(
      `["Add", "x1", 5]`
    );
    expect(expr.evaluate().json).toMatchInlineSnapshot(`
      [
        Add,
        x1,
        -1,
      ]
    `);
  });

  test(`Forget with assign`, () => {
    ce.assign('x2', 42);

    expect(ce.box(`x2`)).toMatchInlineSnapshot(`x2`);
    expect(ce.box(`x2`).evaluate().json).toEqual(42);

    expect(ce.box(['Add', 'x2', 1]).evaluate().json).toEqual(43);

    const expr = ce.box(['Add', 'x2', -1]);
    expect(expr.evaluate().json).toEqual(41);

    ce.assign('x2', undefined);

    // Expression should be symbolic 'y1'
    expect(expr.evaluate().json).toMatchInlineSnapshot(`
      [
        Add,
        x2,
        -1,
      ]
    `);

    expect(ce.box(`x2`).domain).toMatchInlineSnapshot(`PositiveIntegers`);
    expect(ce.box(`x2`).json).toMatch('x2');
    expect(ce.box(`x2`).evaluate().json).toMatch('x2');
    expect(ce.box(['Add', 'x2', 5]).evaluate().json).toMatchObject([
      'Add',
      'x2',
      5,
    ]);
  });
});

describe('SETTING/FORGETTING', () => {
  test(`Properties with set`, () => {
    ce.assign({ x3: 2017 });
    const x3 = ce.box(`x3`);
    expect(x3.isPrime).toMatchInlineSnapshot(`true`);
    expect(x3.isOdd).toMatchInlineSnapshot(`true`);

    ce.assign({ x3: 1024 });
    expect(x3.isOdd).toMatchInlineSnapshot(`false`);
  });

  test(`Properties with assume`, () => {
    ce.assume(['Greater', 'x4', 42]);
    const x4 = ce.box('x4');
    const testX4_1 = ce.box(['Greater', 'x4', 30]);
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`["Less", 30, "x4"]`); // @fixme
    expect(x4.isPrime ?? 'undefined').toMatchInlineSnapshot(`undefined`);
    expect(x4.evaluate().numericValue).toMatchInlineSnapshot(`null`);
    expect(x4.domain).toMatchInlineSnapshot(`ExtendedRealNumbers`);

    ce.assume(['Equal', 'x4', 17]);
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`False`);
    expect(x4.isPrime ?? 'undefined').toEqual(true);
    expect(x4.evaluate().value).toEqual(17);
    expect(x4.domain).toMatchInlineSnapshot(`ExtendedRealNumbers`);

    ce.assign({ x4: 2017 });
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`True`);
    expect(x4.isPrime ?? 'undefined').toMatchInlineSnapshot(`true`);
    expect(x4.value).toMatchInlineSnapshot(`2017`);
    expect(x4.domain).toMatchInlineSnapshot(`ExtendedRealNumbers`);
  });
});

// describe('NESTED SCOPES', () => {
//   let ce;
//   let outer;
//   let inner;
//   beforeAll(() => {
//     ce = new ComputeEngine();
//     ce.declare('global1, {domain: "Number", value: 5 }');
//     ce.pushScope();
//     outer = ce.context;
//     ce.declare('local1, {domain: "Number", value: 10 }');
//     ce.pushScope();
//     inner = ce.context;
//     ce.declare('local1, {domain: "Number", value: 20 }');
//     ce.box('local1').value = 25;
//     ce.popScope();
//     ce.popScope();
//   });

//   test(`Nested scopes`, () => {
//     expect(ce.box('local1').evaluate().json).toEqual(42);
//   });

//   /*

// */
// });
