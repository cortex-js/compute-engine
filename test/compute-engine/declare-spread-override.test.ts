import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 82 follow-up: the "spread a built-in definition, override the
 * parts you need" idiom for narrow operator overrides —
 * `ce.declare('At', { ...ce.lookupDefinition('At').operator, evaluate })`.
 *
 * Redeclaring REPLACES the binding (the old boxed def object stays intact), so
 * a new handler can close over `oldDef` and delegate to `oldDef.evaluate`
 * without any pre-capture. A fresh engine is used per test since a redeclare
 * persists for the engine's lifetime.
 */

function overrideAt(): ComputeEngine {
  const ce = new ComputeEngine();
  const oldDef = ce.lookupDefinition('At')!.operator!;
  ce.declare('At', {
    ...oldDef,
    evaluate: (ops, options) => {
      const idx = ops[1]?.re;
      if (typeof idx === 'number' && idx < 0) return options.engine.NaN;
      return oldDef.evaluate!(ops, options);
    },
  });
  return ce;
}

describe('declare() spread-override of a boxed operator definition', () => {
  test('naive spread pattern works end-to-end', () => {
    const ce = overrideAt();
    const stock = new ComputeEngine();

    // Custom behavior: negative index -> NaN
    expect(
      ce.box(['At', ['List', 10, 20, 30], -1]).evaluate().toString()
    ).toEqual('NaN');

    // Delegated behavior: positive index -> stock result
    expect(
      ce.box(['At', ['List', 10, 20, 30], 2]).evaluate().toString()
    ).toEqual('20');

    // The spread carried the built-in `type` handler: the result type matches
    // stock (a minimal non-spread override would degrade this to a wider type).
    expect(
      ce.box(['At', ['List', 10, 20, 30], 2]).evaluate().type.toString()
    ).toEqual(
      stock.box(['At', ['List', 10, 20, 30], 2]).evaluate().type.toString()
    );
    expect(
      ce.box(['At', ['List', 10, 20, 30], 2]).evaluate().type.toString()
    ).toEqual('finite_integer');

    // The spread carried the signature: a non-conforming operand produces the
    // same `incompatible-type` error as stock.
    expect(ce.box(['At', { str: 'abcd' }, 2]).evaluate().toString()).toEqual(
      stock.box(['At', { str: 'abcd' }, 2]).evaluate().toString()
    );

    // A symbolic index stays symbolic (delegated).
    expect(
      ce.box(['At', ['List', 10, 20, 30], 'n']).evaluate().toString()
    ).toEqual(stock.box(['At', ['List', 10, 20, 30], 'n']).evaluate().toString());
  });

  test('delegation without pre-capture (replace-not-mutate semantics)', () => {
    const ce = overrideAt();
    // The handler closes over `oldDef` and delegates: no recursion/throw.
    expect(() =>
      ce.box(['At', ['List', 10, 20, 30], 2]).evaluate()
    ).not.toThrow();
    expect(
      ce.box(['At', ['List', 10, 20, 30], 2]).evaluate().toString()
    ).toEqual('20');
    expect(
      ce.box(['At', ['List', 10, 20, 30], -5]).evaluate().toString()
    ).toEqual('NaN');
  });

  test('a genuine typo key still throws', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('Foo9x', {
        signature: '(number) -> number',
        evaluete: () => 1,
      } as any)
    ).toThrow(/evaluete/);
  });

  test('a BoxedType signature is accepted', () => {
    const ce = new ComputeEngine();
    const someBoxedType = ce.lookupDefinition('At')!.operator!.signature;
    expect(() =>
      ce.declare('Bar9x', {
        signature: someBoxedType,
        evaluate: (ops, options) => options.engine.number(42),
      } as any)
    ).not.toThrow();
  });

  test('regression: plain value / description+value / bare description', () => {
    const ce = new ComputeEngine();

    // Plain value declare
    ce.declare('valA', { value: 5 });
    expect(ce.box('valA').evaluate().toString()).toEqual('5');

    // Description + value declare
    ce.declare('valB', { description: 'a constant', value: 7 });
    expect(ce.box('valB').evaluate().toString()).toEqual('7');

    // Bare description declare still throws the helpful error
    expect(() => ce.declare('valC', { description: 'no type or value' })).toThrow(
      /`type` or `value` field/
    );
  });
});
