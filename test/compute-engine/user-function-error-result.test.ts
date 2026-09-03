import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { applicable } from '../../src/compute-engine/function-utils';

//
// A user function answers with the error VALUE its body evaluates to
// (`bodyResultValue` in src/compute-engine/function-utils.ts; "Error values
// propagate through ordinary function application", docs/LANGUAGE-MODEL.md,
// the rule docs/ERROR-MODEL.md §3 lays out). Until 2026-09-03 an invalid body result DECLINED the
// application, which left the call inert: `len(5)` answered `len(5)` where
// `Length(5)` itself is the `incompatible-type` error.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('USER FUNCTION — a body that evaluates to an error value', () => {
  test('a parameterized function bubbles the error its body produced', () => {
    ce.declare('len', { value: ce.box(['Function', ['Length', 'x'], 'x']) });
    const direct = ce.box(['Length', 5]).evaluate();
    const applied = ce.box(['len', 5]).evaluate();
    expect(isFunction(applied, 'Error')).toBe(true);
    expect(applied.isSame(direct)).toBe(true);
    // A well-typed argument still answers normally.
    expect(
      ce
        .box(['len', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('3');
  });

  test('a nullary closure bubbles the error its body produced', () => {
    ce.declare('boom', { value: ce.box(['Function', ['Length', 5]]) });
    expect(isFunction(ce.box(['boom']).evaluate(), 'Error')).toBe(true);
  });

  test('a selecting body demands the failing arm only when it selects it', () => {
    ce.declare('h', {
      signature: '(number) -> unknown',
      evaluate: ce.box([
        'Function',
        ['If', ['Greater', 'x', 0], 'x', ['Length', 'x']],
        'x',
      ]),
    });
    expect(ce.box(['h', 2]).evaluate().toString()).toBe('2');
    expect(isFunction(ce.box(['h', -2]).evaluate(), 'Error')).toBe(true);
  });

  test('a frozen collection result is the answer, with its failed cell in place', () => {
    ce.declare('cells', {
      value: ce.box(['Function', ['List', 1, ['Length', 'x']], 'x']),
    });
    const r = ce.box(['cells', 5]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.nops).toBe(2);
    expect(r.isValid).toBe(false);
  });

  test('an INVALID callee is not applicable: the consumer reports it', () => {
    // A predicate the compatibility gate rejected at canonicalization is an
    // `Error` node in the operand slot. `applicable()` answers `undefined`
    // for it, so `Filter` reports the predicate's own diagnostic instead of
    // reading an error VALUE as a per-element failure
    // (test/compute-engine/filter-predicate-errors.test.ts pins the throw).
    const filter = ce.box([
      'Filter',
      ['List', 1, 2, 3],
      ['Function', ['Add', 'k', 1], 'k'],
    ]);
    expect(filter.isValid).toBe(false);
    expect(() => filter.count).toThrow('incompatible-type');
  });

  test('a callee whose only error sits under a selecting arm stays applicable', () => {
    // `isValid` is false for this literal, but no error is reachable without
    // crossing the `If`, so it is a sound callee that answers per call.
    const fn = ce.box([
      'Function',
      ['If', ['Greater', 'x', 0], 'True', ['Length', 'x']],
      'x',
    ]);
    const f = applicable(fn);
    expect(f([ce.number(2)])?.symbol).toBe('True');
    expect(isFunction(f([ce.number(-2)]), 'Error')).toBe(true);
  });
});
