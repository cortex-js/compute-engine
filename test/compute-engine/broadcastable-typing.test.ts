import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

/**
 * Phase B of the `broadcastable<T>` prototype: `Add`/`Multiply` produce a
 * `broadcastable<T>` result when an operand's collection-ness is not statically
 * visible (a top `unknown`/`any`/`value` leaf such as an undeclared/unknown-
 * return function call, or an already-`broadcastable<…>` inner node), and
 * `At` + argument validation honor it.
 */

/** True when any node in the tree is an `Error` operand. */
function hasErrorOperand(expr: BoxedExpression): boolean {
  if (expr.operator === 'Error') return true;
  return (expr.ops ?? []).some((op) => hasErrorOperand(op));
}

describe('broadcastable<T> typing (phase B)', () => {
  test('unknown-return call: inner Multiply and outer Add are broadcastable<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');

    const inner = ce.box(['Multiply', 2, ['h', 'x']]);
    expect(inner.type.toString()).toBe('broadcastable<number>');

    const e = ce.box(['Subtract', ['Multiply', 2, ['h', 'x']], 1]);
    expect(e.type.toString()).toBe('broadcastable<number>');

    // No `incompatible-type` (or other) Error baked in at canonicalization.
    expect(e.isValid).toBe(true);
    expect(hasErrorOperand(e)).toBe(false);
  });

  test('propagation: Add(broadcastable, scalar) and Multiply(broadcastable, broadcastable)', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const b = ce.box(['Multiply', 2, ['h', 'x']]);
    expect(b.type.toString()).toBe('broadcastable<number>');

    expect(ce.box(['Add', b, 5]).type.toString()).toBe('broadcastable<number>');
    expect(ce.box(['Multiply', b, b]).type.toString()).toBe(
      'broadcastable<number>'
    );
  });

  test('At over a broadcastable base is a valid canonical `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const at = ce.parse('(2h(x)-1)[1]');
    expect(at.operator).toBe('At');
    expect(at.isValid).toBe(true);
    expect(hasErrorOperand(at)).toBe(false);
    expect(at.type.toString()).toBe('number');
  });

  test('runtime agreement: list-returning `f` broadcasts, scalar `g` stays scalar', () => {
    const ce = new ComputeEngine();
    // f is list-returning; `2f(3)` is list/tensor-typed via existing lifts, so
    // this is out of the broadcastable prototype's scope — assert evaluation.
    ce.assign('f', ce.parse('x \\mapsto \\lbrack x, x+1 \\rbrack'));
    const fExpr = ce.box(['Subtract', ['Multiply', 2, ['f', 3]], 1]);
    expect(fExpr.evaluate().toString()).toBe('[5,7]');

    // g is scalar-returning: its body `2x` types scalar (a bare symbol's
    // `unknown` is inference-pending, not possibly-a-collection — see
    // `isPossiblyCollectionTyped`), so the application stays honestly scalar.
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const gExpr = ce.box(['Subtract', ['Multiply', 2, ['g', 3]], 1]);
    expect(gExpr.type.matches('number')).toBe(true);
    expect(gExpr.evaluate().toString()).toBe('11');
  });

  test('non-interference with scalars and statically-visible collections', () => {
    const ce = new ComputeEngine();
    // Inferred-number symbol: NOT triggered.
    expect(ce.box(['Add', 2, 'x']).type.toString()).toBe('number');
    expect(ce.box(['Multiply', 2, 'x']).type.toString()).toBe('finite_number');
    // Statically-visible collection/tuple/wrapper branches keep today's typing.
    expect(ce.box(['Multiply', 2, ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<3>'
    );
    expect(
      ce.box(['Add', ['Tuple', 1, 2], ['Tuple', 3, 4]]).type.toString()
    ).toBe('tuple<finite_integer, finite_integer>');
    expect(ce.box(['Multiply', 2, ['Range', 1, 5]]).type.toString()).toBe(
      'list<integer>'
    );
  });

  test('subtype interop at the boxed level', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const b = ce.box(['Multiply', 2, ['h', 'x']]);
    expect(b.type.matches('number')).toBe(false);
    expect(b.type.matches('broadcastable<number>')).toBe(true);
  });

  test('cold-engine symbol exclusion: bare unknown symbols do not trigger', () => {
    // A bare symbol's `unknown` type is inference-pending: on a COLD engine
    // (no prior inference) juxtaposition and arithmetic must stay scalar,
    // exactly as on a warm one. Regression: the trigger once fired on
    // unknown-typed symbols, flipping `2x` to `broadcastable<number>` and
    // mis-grouping `(b^3c^2d)(x^7y)` as `Tuple` via the invisible-operator
    // gate.
    let ce = new ComputeEngine();
    expect(ce.parse('2x').type.toString()).toBe('finite_number');
    ce = new ComputeEngine();
    const juxt = ce.parse('(b^3c^2d)(x^7y)');
    expect(juxt.operator).toBe('Multiply');
    expect(juxt.type.matches('number')).toBe(true);
  });

  test('union-typed operand contributes its unwrapped element', () => {
    // A declared `number | list<number>` return mixed with an unknown-return
    // call: the union operand's contribution is its scalar element, so the
    // element type stays clean (`number`), not `number | list<number>`. (The
    // generic wrapper then lifts the statically-visible list branch to
    // `list<number>`.)
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    ce.declare('g', '(number) -> number | list<number>');
    const e = ce.box(['Multiply', ['h', 1], ['g', 1]]);
    expect(e.type.toString()).toBe('list<number>');
  });

  test('invisible operator: juxtaposition with a broadcastable group multiplies', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const e = ce.parse('2(2h(x)-1)');
    expect(e.operator).toBe('Multiply');
    expect(e.type.toString()).toBe('broadcastable<number>');
  });
});
