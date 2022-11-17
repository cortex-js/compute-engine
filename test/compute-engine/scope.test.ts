import { engine } from '../utils';

engine.jsonSerializationOptions = { precision: 20 };
const ce = engine;

describe('SETTING/FORGETTING', () => {
  test(`Forget with forget()`, () => {
    ce.set({ x1: 42 });
    // This probe the value of the symbol
    expect(ce.box(`x1`).json).toMatchInlineSnapshot(`42`); // @fix me should 'x1'
    expect(ce.box(`x1`).evaluate().json).toMatchInlineSnapshot(`42`);
    // This probe the value of the symbol in an expression
    expect(ce.box(['Add', 'x1', 1]).evaluate().json).toMatchInlineSnapshot(
      `43`
    );

    const expr = ce.box(['Add', 'x1', -1]);
    expect(expr.json).toMatchInlineSnapshot(`["Subtract", 42, 1]`); // @fix me, should have `x1`
    expect(expr.evaluate().json).toMatchInlineSnapshot(`41`);

    ce.forget('x1');

    // Expression should be symbolic 'x1'
    expect(expr.evaluate().json).toMatchInlineSnapshot(`41`); // @fixme

    expect(ce.box(`x1`).domain).toMatchInlineSnapshot(
      `["Domain", "PositiveInteger"]`
    ); // @fixme, should be Number
    expect(ce.box(`x1`).json).toMatchInlineSnapshot(`42`); // @fixme should be 'x1'
    expect(ce.box(`x1`).evaluate().json).toMatchInlineSnapshot(`42`); // @fixme should be 'x1'
    expect(ce.box(['Add', 'x1', 5]).evaluate().json).toMatchInlineSnapshot(
      `47`
    ); // @fixme should be 'x1+5'
    expect(expr.evaluate().json).toMatchInlineSnapshot(`41`); // @fixme should be 'x1-1'
  });

  test(`Forget with set`, () => {
    ce.set({ x2: 42 });

    expect(ce.box(`x2`).json).toMatchInlineSnapshot(`42`);
    expect(ce.box(`x2`).evaluate().json).toMatchInlineSnapshot(`42`);

    expect(ce.box(['Add', 'x2', 1]).evaluate().json).toMatchInlineSnapshot(
      `43`
    );

    const expr = ce.box(['Add', 'x2', -1]);
    expect(expr.evaluate().json).toMatchInlineSnapshot(`41`);

    ce.set({ x2: null });

    // Expression should be symbolic 'y1'
    expect(expr.evaluate().json).toMatchInlineSnapshot(`41`);

    expect(ce.box(`x2`).domain).toMatchInlineSnapshot(
      `["Domain", "PositiveInteger"]`
    );
    expect(ce.box(`x2`).json).toMatchInlineSnapshot(`42`);
    expect(ce.box(`x2`).evaluate().json).toMatchInlineSnapshot(`42`);
    expect(ce.box(['Add', 'x2', 5]).evaluate().json).toMatchInlineSnapshot(
      `47`
    );
  });
});

describe('SETTING/FORGETTING', () => {
  test(`Properties with set`, () => {
    ce.set({ x3: 2017 });
    const x3 = ce.box(`x3`);
    expect(x3.isPrime).toMatchInlineSnapshot(`true`);
    expect(x3.isOdd).toMatchInlineSnapshot(`true`);

    ce.set({ x3: 1024 });
    expect(x3.isOdd).toMatchInlineSnapshot(`true`);
  });

  test(`Properties with assume`, () => {
    ce.assume(['Greater', 'x4', 42]);
    const x4 = ce.box('x4');
    const testX4_1 = ce.box(['Greater', 'x4', 30]);
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`["Less", 30, "x4"]`); // @fixme
    expect(x4.isPrime ?? 'undefined').toMatchInlineSnapshot(`undefined`);
    expect(x4.numericValue).toMatchInlineSnapshot(`null`);
    expect(x4.domain.json).toMatchInlineSnapshot(
      `["Domain", "ExtendedRealNumber"]`
    );

    ce.assume('x4', 17);
    expect(testX4_1.evaluate()).toMatchInlineSnapshot(`False`);
    expect(x4.isPrime ?? 'undefined').toMatchInlineSnapshot(`true`);
    expect(x4.numericValue).toMatchInlineSnapshot(`null`); // @fixme, should be 17
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
