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

// The setter follows the type rules of `ce.assign()`: an inferred type is
// refined or widened to hold the value, and a value that does not fit a
// declared type is refused. Before, the setter wrote only the value.
describe('BoxedSymbol.value setter applies the type rules of assign', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('a value refines the type of a symbol with no type', () => {
    const n = ce.expr('n');
    n.value = 5;
    expect(n.type.toString()).toBe('integer');
    expect(n.value?.toString()).toBe('5');
  });

  test('a value that does not fit an inferred type widens it, as assign does', () => {
    ce.assign('m', 1);
    const m = ce.expr('m');
    m.value = ce.string('hi');
    ce.assign('m2', 1);
    ce.assign('m2', ce.string('hi'));
    expect(m.type.toString()).toBe(ce.expr('m2').type.toString());
    expect(m.type.matches('string')).toBe(true);
  });

  test('a value that does not fit a declared type is refused', () => {
    ce.declare('k', 'integer');
    const k = ce.expr('k');
    expect(() => {
      k.value = ce.string('hi');
    }).toThrow();
    expect(k.value).toBeUndefined();
    k.value = 3;
    expect(k.type.toString()).toBe('integer');
    expect(k.value?.toString()).toBe('3');
  });

  test('the value is written to the binding of the symbol, not to a shadowing one', () => {
    const g = ce.expr('g');
    g.value = 1;
    ce.pushScope();
    ce.declare('g', 'string');
    g.value = 7;
    expect(ce.expr('g').value).toBeUndefined();
    expect(ce.expr('g').type.toString()).toBe('string');
    ce.popScope();
    expect(g.value?.toString()).toBe('7');
    expect(g.type.toString()).toBe('integer');
  });
});
