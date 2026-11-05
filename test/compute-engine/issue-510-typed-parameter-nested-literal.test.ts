/**
 * Issue #510: an annotated parameter `v` of an outer function literal, read
 * first in the body of a nested function literal, was declared in the body
 * scope of that nested literal. The declaration has an explicit type and no
 * value, so the application of the outer literal did not hide it
 * (`hideBodyScopeParams`, `function-utils.ts`). A read of `v` by name in the
 * nested body (the callback `j ↦ v[j]` that `Map` applies) found that
 * declaration before the call frame that holds the value, and the `Filter`
 * predicate gave a comparison that is neither `True` nor `False`.
 *
 * The declaration now goes in the body scope of the literal that declares the
 * parameter (`createSymbolExpression`, `engine-expression-entrypoints.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const at = (i: unknown) => ['At', 'v', i];
const MIN = ['Min', ['Map', ['Function', at('j'), 'j'], ['Range', 1, 3]]];

function countWhere(pred: unknown, param: unknown = ['Typed', 'v', "'list<integer>'"]) {
  return [
    'Apply',
    [
      'Function',
      ['Count', ['Filter', ['Range', 1, 1], ['Function', pred, 'c']]],
      param,
    ],
    ['List', 1, 0, 1],
  ];
}

describe('issue #510: a typed outer parameter read in a nested literal', () => {
  const ce = new ComputeEngine();
  const value = (e: unknown) => ce.box(e as any).evaluate().toString();

  it('reads the value of the parameter after a guard that reads it', () => {
    const pred = ['And', ['Equal', at(3), at(1)], ['GreaterEqual', MIN, 0]];
    expect(value(countWhere(pred))).toBe('1');
  });

  it('reads the value after a guard that reads the length', () => {
    const pred = [
      'And',
      ['Greater', ['Length', 'v'], 0],
      ['GreaterEqual', MIN, 0],
    ];
    expect(value(countWhere(pred))).toBe('1');
  });

  it('gives the same value with the operands of And swapped', () => {
    const pred = ['And', ['GreaterEqual', MIN, 0], ['Equal', at(3), at(1)]];
    expect(value(countWhere(pred))).toBe('1');
  });

  it('gives the same value with an untyped parameter', () => {
    const pred = ['And', ['Equal', at(3), at(1)], ['GreaterEqual', MIN, 0]];
    expect(value(countWhere(pred, 'v'))).toBe('1');
  });

  it('declares the parameter in the body scope of the outer literal', () => {
    const pred = ['And', ['Equal', at(3), 1], ['GreaterEqual', MIN, 0]];
    const boxed = ce.box(countWhere(pred) as any) as any;
    // Apply > Function > Block > Count > Filter > Function
    const predicate = boxed.op1.op1.op1.op1.op2;
    expect(predicate.operator).toBe('Function');
    expect(predicate.op1.localScope.bindings.has('v')).toBe(false);
    expect(boxed.op1.op1.localScope.bindings.has('v')).toBe(true);
  });
});
