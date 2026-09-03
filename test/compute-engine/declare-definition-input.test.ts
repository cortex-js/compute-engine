import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The type-level pins in this file (the contextual typing of handler
// parameters, the `@ts-expect-error` lines) are checked by
// `scripts/typecheck.sh`; ts-jest does not type-check, so the jest run alone
// proves only the runtime behavior.

describe('ce.declare() with a boxed operator definition', () => {
  test('re-declaring an operator from its boxed definition keeps the type-handler shape', () => {
    const ce = new ComputeEngine();
    const original = ce.expr('Ln').operatorDefinition!;
    expect(original.typeHandlerKind).toBe('types');

    ce.declare('Ln', {
      ...original,
      evaluate: ([x], options) =>
        x.is(0) ? ce.NaN : original.evaluate!([x], options),
    });

    const redeclared = ce.expr('Ln').operatorDefinition!;
    expect(redeclared.typeHandlerKind).toBe('types');
    expect(redeclared.type).toBe(original.type);
    expect(ce.parse('\\ln(0)').evaluate().isNaN).toBe(true);
    expect(ce.parse('\\ln(e)').evaluate().isSame(1)).toBe(true);
  });

  test('the map form accepts a spread boxed operator definition', () => {
    const ce = new ComputeEngine();
    const original = ce.expr('Ln').operatorDefinition!;
    // A boxed definition carries its `name`, so a spread can only re-declare
    // the SAME operator: `ce.declare({ Ln2: { ...original } })` throws
    // "cannot change name".
    ce.declare({
      Ln: {
        ...original,
        evaluate: ([x], options) =>
          x.is(0) ? ce.NaN : original.evaluate!([x], options),
      },
    });
    expect(ce.expr('Ln').operatorDefinition!.typeHandlerKind).toBe('types');
    expect(ce.parse('\\ln(0)').evaluate().isNaN).toBe(true);
  });

  test('a spread boxed value definition with an overridden value', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi2', { ...ce.expr('Pi').valueDefinition!, value: 3 });
    // The spread carried `holdUntil: 'N'` from `Pi`, so `evaluate()` holds the
    // symbol and only `N()` reads the value.
    expect(ce.expr('Pi2').evaluate().json).toBe('Pi2');
    expect(ce.expr('Pi2').N().isSame(3)).toBe(true);
  });
});

describe('ce.declare() inline type handlers', () => {
  test('the parameters of an inline `type` handler are contextually typed', () => {
    const ce = new ComputeEngine();
    // Two-argument form, legacy shape: `ops` is `ReadonlyArray<Expression>`.
    ce.declare('f', {
      signature: '(number) -> number',
      type: (ops) => ops[0].type,
    });
    expect(ce.box(['f', 2]).type.matches('integer')).toBe(true);

    // Two-argument form, descriptor shape: `ops` is a descriptor array.
    ce.declare('g', {
      signature: '(number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => ops[0].type,
    });
    expect(ce.box(['g', 2]).type.matches('integer')).toBe(true);

    // Map form: the entry type also admits a `Type` or a type string, so an
    // omitted `typeHandlerKind` cannot be discriminated there — the flag must
    // be stated (or the parameters annotated).
    ce.declare({
      h: {
        signature: '(number) -> number',
        typeHandlerKind: 'expressions',
        type: (ops) => ops[0].type,
      },
      k: {
        signature: '(number) -> number',
        type: (ops: ReadonlyArray<Expression>) => ops[0].type,
      },
    });
    expect(ce.box(['h', 2]).type.matches('integer')).toBe(true);
    expect(ce.box(['k', 2]).type.matches('integer')).toBe(true);

    // A `'types'`-shape handler written against expressions is rejected. The
    // error is an overload failure, reported at the call, so the directive
    // sits on the call.
    // @ts-expect-error the descriptor shape does not receive expressions
    ce.declare('m', {
      signature: '(number) -> number',
      typeHandlerKind: 'types',
      type: (ops: ReadonlyArray<Expression>) => ops[0].type,
    });
  });
});
