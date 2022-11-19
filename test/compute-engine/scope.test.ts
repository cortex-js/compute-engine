import { engine } from '../utils';

engine.jsonSerializationOptions = { precision: 20 };
const ce = engine;

describe('SETTING/FORGETTING', () => {
  test(`Forget with forget()`, () => {
    ce.set({ x1: 42 });
    // This probes the value of the symbol
    expect(ce.box(`x1`).json).toMatch('x1');
    expect(ce.symbol(`x1`).json).toMatch('x1');
    expect(ce.box(`x1`).evaluate().json).toEqual(42);
    // This probe the value of the symbol in an expression
    expect(ce.box(['Add', 'x1', 1]).evaluate().json).toEqual(43);

    const expr = ce.box(['Add', 'x1', -1]);
    expect(expr.json).toMatchObject(['Subtract', 'x1', 1]);
    expect(expr.evaluate().json).toEqual(41);

    ce.forget('x1');

    // Expression should be symbolic 'x1'
    expect(expr.json).toMatchObject(['Subtract', 'x1', 1]);
    expect(expr.evaluate().json).toMatchObject(['Subtract', 'x1', 1]);

    expect(ce.box(`x1`).domain).toMatchInlineSnapshot(
      `["Domain", "ExtendedRealNumber"]`
    );
    expect(ce.box(`x1`).json).toMatch('x1');
    expect(ce.box(`x1`).evaluate().json).toMatch('x1');
    expect(ce.box(['Add', 'x1', 5]).evaluate().json).toMatchInlineSnapshot(
      `["Add", 5, "x1"]`
    );
    expect(expr.evaluate().json).toMatchObject(['Subtract', 'x1', 1]);
  });

  test(`Forget with set`, () => {
    ce.set({ x2: 42 });

    expect(ce.box(`x2`).json).toMatchInlineSnapshot(`x2`);
    expect(ce.box(`x2`).evaluate().json).toEqual(42);

    expect(ce.box(['Add', 'x2', 1]).evaluate().json).toEqual(43);

    const expr = ce.box(['Add', 'x2', -1]);
    expect(expr.evaluate().json).toEqual(41);

    ce.set({ x2: null });

    // Expression should be symbolic 'y1'
    expect(expr.evaluate().json).toMatchObject(['Subtract', 'x2', 1]);

    expect(ce.box(`x2`).domain).toMatchInlineSnapshot(`["Domain", "Number"]`);
    expect(ce.box(`x2`).json).toMatch('x2');
    expect(ce.box(`x2`).evaluate().json).toMatch('x2');
    expect(ce.box(['Add', 'x2', 5]).evaluate().json).toMatchObject([
      'Add',
      5,
      'x2',
    ]);
  });
});

describe('SETTING/FORGETTING', () => {
  test(`Properties with set`, () => {
    ce.set({ x3: 2017 });
    const x3 = ce.box(`x3`);
    expect(x3.isPrime).toMatchInlineSnapshot(`true`);
    expect(x3.isOdd).toMatchInlineSnapshot(`true`);

    ce.set({ x3: 1024 });
    expect(x3.isOdd).toMatchInlineSnapshot(`false`);
  });

  test(`Properties with assume`, () => {
    ce.assume(['Greater', 'x4', 42]);
    const x4 = ce.box('x4');
    const testX4_1 = ce.box(['Greater', 'x4', 30]);
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`["Less", 30, "x4"]`); // @fixme
    expect(x4.isPrime ?? 'undefined').toMatchInlineSnapshot(`undefined`);
    expect(x4.evaluate().numericValue).toMatchInlineSnapshot(`null`);
    expect(x4.domain.json).toMatchInlineSnapshot(
      `["Domain", "ExtendedRealNumber"]`
    );

    ce.assume('x4', 17);
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`False`);
    expect(x4.isPrime ?? 'undefined').toEqual(true);
    expect(x4.evaluate().numericValue).toEqual(17);
    expect(x4.domain.json).toMatchInlineSnapshot(
      `["Domain", "ExtendedRealNumber"]`
    );

    ce.set({ x4: 2017 });
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`True`);
    expect(x4.isPrime ?? 'undefined').toMatchInlineSnapshot(`true`);
    expect(x4.numericValue).toMatchInlineSnapshot(`null`); // @fixme, should be 2017
    expect(x4.domain.json).toMatchInlineSnapshot(
      `["Domain", "ExtendedRealNumber"]`
    );
  });
});
