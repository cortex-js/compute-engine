/**
 * Targeted pins for the generic runtime conformance check and the handler
 * throw-to-error-value conversion (§4.4 of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`). The broad sweep lives
 * in `runtime-conformance-fuzz.test.ts`; this file pins the individual
 * behaviors and the route/mode boundaries.
 */
import { ComputeEngine } from '../../src/compute-engine';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** An `any`-typed symbol holding `value` — the permissive route: boxing
 * admits it, so the wrong-kind value reaches evaluation. */
function anySym(name: string, value: any): string {
  ce.declare(name, 'any');
  ce.assign(name, ce.box(value));
  return name;
}

describe('generic runtime conformance at non-lazy dispatch (§4.4)', () => {
  test('a concrete wrong-kind value produces an incompatible-type error value', () => {
    anySym('n', 2.5);
    const result = ce.box(['FactorInteger', 'n']).evaluate();
    expect(result.isValid).toBe(false);
    expect(result.toString()).toContain('incompatible-type');
    // The defect this closes (ROADMAP "Integer-domain operators ROUND a
    // non-integer operand"): the handler used to answer [(3, 1)] for 2.5.
    expect(result.toString()).not.toContain('3');
  });

  test('route parity: ce.function with a pre-boxed literal errs at boxing, the symbol route at evaluation', () => {
    // The literal route is refused by the static gate…
    const literal = ce.box(['FactorInteger', 2.5]);
    expect(literal.isValid).toBe(false);
    // …and the symbol route now reaches the same verdict at evaluation.
    anySym('m', 2.5);
    const viaSymbol = ce.box(['FactorInteger', 'm']);
    expect(viaSymbol.isValid).toBe(true); // admitted at boxing
    expect(viaSymbol.evaluate().isValid).toBe(false);
  });

  test('async route reaches the same verdict', async () => {
    anySym('p', 2.5);
    const result = await ce.box(['FactorInteger', 'p']).evaluateAsync();
    expect(result.isValid).toBe(false);
    expect(result.toString()).toContain('incompatible-type');
  });

  test('a complex value at an integer parameter errors instead of dropping the imaginary part', () => {
    anySym('z', ['Complex', 1, 2]);
    const result = ce.box(['Fibonacci', 'z']).evaluate();
    expect(result.isValid).toBe(false);
  });

  test('a still-symbolic operand is left alone (stays inert)', () => {
    ce.declare('k', 'integer');
    const result = ce.box(['FactorInteger', 'k']).evaluate();
    expect(result.isValid).toBe(true);
    expect(result.operator).toBe('FactorInteger');
  });

  test('a conforming value still evaluates', () => {
    anySym('q', 12);
    expect(ce.box(['FactorInteger', 'q']).evaluate().toString()).toEqual(
      '[(2, 2),(3, 1)]'
    );
  });

  test('an optional position gets the same verdict', () => {
    // `ZeroMatrix(integer, integer?)`: a conforming required dimension, and
    // the complex value at the OPTIONAL second dimension — which errors
    // instead of being rounded.
    anySym('d', ['Complex', 1, 2]);
    const result = ce.box(['ZeroMatrix', 2, 'd']).evaluate();
    expect(result.isValid).toBe(false);
    // Control: the required position refutes it too.
    const req = ce.box(['ZeroMatrix', 'd']).evaluate();
    expect(req.isValid).toBe(false);
  });

  test('the ground Nothing value is decidable, not "still symbolic"', () => {
    // `Nothing` has no `concreteValueOf`, but it is a fully-evaluated unit
    // value whose type (`nothing`) is provably disjoint from `integer` — the
    // static gate refuses the literal, and the runtime check must agree
    // (before this pin, `IsTriangular(Nothing)` through an `any` symbol
    // leniently answered `False`).
    anySym('nada', 'Nothing');
    const result = ce.box(['IsTriangular', 'nada']).evaluate();
    expect(result.isValid).toBe(false);
  });

  test('NaN at a number parameter is NOT refuted (propagation preserved)', () => {
    anySym('v', NaN);
    const result = ce.box(['Sin', 'v']).evaluate();
    expect(result.isValid).toBe(true);
    expect(ce.box(['Sin', 'v']).N().isNaN).toBe(true);
  });

  test('a collection value at a broadcastable operator still broadcasts', () => {
    anySym('xs', ['List', 0, ['Divide', 'Pi', 2]]);
    const result = ce.box(['Sin', 'xs']).evaluate();
    expect(result.isValid).toBe(true);
    expect(result.toString()).toEqual('[0,1]');
  });

  test('strict: false skips the check (documented opt-out, O8)', () => {
    ce.strict = false;
    anySym('w', 2.5);
    const result = ce.box(['IsTriangular', 'w']).evaluate();
    // The non-strict engine keeps the old permissive behavior: the handler
    // runs and answers from the rounded value ("results may be incorrect …
    // if the input is not valid" — the engine's `strict` contract).
    expect(result.isValid).toBe(true);
  });

  test('the check runs per cell on the broadcast route', () => {
    // A broadcastable operator over a list with a wrong-kind cell: each
    // cell re-enters evaluation, where the conformance check runs — the bad
    // cell becomes an error value in place, the good cell evaluates.
    anySym('bad', { str: 'not-a-number' });
    const result = ce.box(['Sin', ['List', 1, 'bad']]).evaluate();
    expect(result.operator).toBe('List');
    expect(result.op1.isValid).toBe(true);
    expect(result.op2.isValid).toBe(false);
    expect(result.op2.toString()).toContain('incompatible-type');
  });
});

describe('handler crashes become error values (§4.4 hardening)', () => {
  test('a native-fault crash in a non-lazy built-in handler is converted to an error value', () => {
    // A TypeError/RangeError/ReferenceError is the shape an engine bug
    // produces — never a deliberate diagnostic. It degrades to an error
    // value instead of crashing the caller.
    ce.declare('crashy', {
      signature: '(number) -> number',
      evaluate: () => (undefined as any).boom,
    });
    const result = ce.box(['crashy', 1]).evaluate();
    expect(result.isValid).toBe(false);
    expect(result.toString()).toContain('evaluation-error');
  });

  test('a deliberate plain-Error diagnostic still throws (predicate contract)', () => {
    // The predicate-contract family throws `new Error(...)` on purpose —
    // `collections.test.ts` pins Count/Filter as hard errors. The crash
    // conversion must not swallow it. Routed through an `any`-typed symbol:
    // spelled inline the identity lambda is refused at boxing (its inferred
    // `-> integer` result fails the boolean slot).
    ce.declare('pred', 'any');
    ce.assign('pred', ce.box(['Function', 'x', 'x']));
    expect(() =>
      ce.box(['CountIf', ['List', 1, 2, 3], 'pred']).evaluate()
    ).toThrow(/must return/);
  });

  test('a lazy operator keeps its deliberate throw (redefinition discipline)', () => {
    // Assigning to a constant throws by contract (the same scenario
    // `attrs-bag-encoding.test.ts` pins) — the catch must not convert a
    // LAZY handler's throw.
    ce.box(['Declare', 'c2', { dict: { constant: true, value: 5 } } as any]).evaluate();
    expect(() => ce.box(['Assign', 'c2', 7]).evaluate()).toThrow();
  });

  test('a user function keeps its over-application throw', () => {
    ce.assign('g', ce.box(['Function', ['Add', 'x', 1], 'x']));
    expect(() => ce.box(['g', 1, 2, 3]).evaluate()).toThrow(/Too many/);
  });
});

describe('unknown rule-condition names fail closed', () => {
  test('Condition with a nonsense condition name does not throw', () => {
    anySym('cc', 2.5);
    expect(() =>
      ce.box(['Condition', 'x', 'cc']).evaluate()
    ).not.toThrow();
  });
});
