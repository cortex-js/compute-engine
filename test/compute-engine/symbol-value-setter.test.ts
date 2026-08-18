import { ComputeEngine } from '../../src/compute-engine';

/**
 * The `BoxedSymbol.value` setter (the host route `expr.value = …`).
 *
 * Two defects fixed 2026-08-18, both pinned here:
 *
 * 1. The input dispatch sniffed `'re' in value && 'im' in value` BEFORE
 *    recognizing an already-boxed expression — and every BoxedExpression
 *    has `re`/`im` getters, so any boxed non-numeric value (a lambda, a
 *    list, a radical) was silently converted to a complex number whose
 *    parts are NaN. A MathJSON function expression (an array) was
 *    likewise swallowed by the `number[] → List` convenience arm.
 *
 * 2. The function branch installed a RAW `{signature, evaluate}` object
 *    literal as the operator half instead of routing through
 *    `updateDef()`, leaving the definition without a real
 *    `_BoxedOperatorDefinition` (no provenance adoption, no rollback
 *    journaling, no provisional-dependent repair, no `redefine` event).
 */

describe('BoxedSymbol.value setter', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('a boxed lambda installs a callable operator on a declared function symbol', () => {
    ce.declare('h', 'function');
    ce.box('h').value = ce.parse('x \\mapsto x^2 + 1');
    expect(ce.parse('h(3)').evaluate().toString()).toEqual('10');
  });

  test('a boxed lambda installs a callable operator on an undeclared symbol', () => {
    ce.box('g').value = ce.parse('x \\mapsto x^2 + 1');
    expect(ce.parse('g(3)').evaluate().toString()).toEqual('10');
    expect(ce.box('g').type.toString()).toMatch(/->/);
  });

  test('re-assigning a different lambda replaces the operator', () => {
    ce.box('g').value = ce.parse('x \\mapsto x^2 + 1');
    ce.box('g').value = ce.parse('x \\mapsto 2x');
    expect(ce.parse('g(3)').evaluate().toString()).toEqual('6');
  });

  test('a function symbol converts back to a plain value via assign', () => {
    ce.box('g').value = ce.parse('x \\mapsto x^2 + 1');
    ce.assign('g', ce.number(7));
    expect(ce.box('g').evaluate().toString()).toEqual('7');
  });

  test('a boxed List value is stored intact, not corrupted to NaN', () => {
    ce.box('m').value = ce.parse('\\lbrack 1, 2, 3 \\rbrack');
    expect(ce.box('m').evaluate().toString()).toEqual('[1,2,3]');
  });

  test('a boxed exact non-machine number is stored intact', () => {
    ce.box('r').value = ce.parse('\\sqrt{2}');
    expect(ce.box('r').evaluate().isNaN).not.toBe(true);
    expect(ce.box('r').evaluate().isSame(ce.parse('\\sqrt{2}').evaluate())).toBe(
      true
    );
  });

  test('a MathJSON function expression (array form) installs an operator', () => {
    ce.box('p').value = ['Function', ['Add', 'x', 1], 'x'];
    expect(ce.parse('p(3)').evaluate().toString()).toEqual('4');
  });

  test('the number[] convenience still produces a List', () => {
    ce.box('q').value = [1, 2, 3];
    expect(ce.box('q').evaluate().toString()).toEqual('[1,2,3]');
  });

  test('the {re, im} plain-object convenience still produces a complex number', () => {
    ce.box('z').value = { re: 1, im: 2 };
    expect(ce.box('z').evaluate().toString()).toEqual('(1 + 2i)');
  });

  test('a lambda cannot overwrite a constant', () => {
    ce.declare('c', { type: 'number', value: 5, isConstant: true });
    expect(() => {
      ce.box('c').value = ce.parse('x \\mapsto x + 1');
    }).toThrow(`The value of the constant "c" cannot be changed`);
    expect(ce.box('c').evaluate().toString()).toEqual('5');
  });

  test('a later untyped assign fully replaces a setter-installed operator (D6)', () => {
    ce.box('g').value = ce.parse('x \\mapsto x^2 + 1');
    ce.assign('g', ce.parse('(s) \\mapsto s + 10'));
    expect(ce.parse('g(3)').evaluate().toString()).toEqual('13');
  });
});
