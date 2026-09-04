import { ComputeEngine } from '../../src/compute-engine';
import { isTuple } from '../../src/compute-engine/collection-utils';

/**
 * A symbol declared with the BARE `tuple` type — `ce.declare('w', 'tuple')` —
 * names neither its arity nor its component types, but every value it can
 * hold is a tuple. The arithmetic and the component-wise lifts recognized a
 * tuple by the compound spelling only (`isTuple` in `collection-utils.ts`
 * answered `false` for the primitive), so `w · w` typed `number`, `Sin(w)` and
 * `Sqrt(w)` typed `number`, and `Abs(w)` took the scalar type — claims no
 * value of `w` can satisfy: with `w := (1, 2)`, `Sin(w)` evaluates to
 * `(sin 1, sin 2)` and `Sqrt(w)` to `(1, √2)`.
 *
 * A literal tuple never carries the bare spelling (its derived type keeps its
 * arity even past the derived-type size bound), so only declared symbols are
 * affected. `isTuple` now admits the bare primitive, the component-wise type
 * lift (`tupleBroadcastArity`, `boxed-expression/boxed-function.ts`) claims
 * the wide `tuple` for it, and the descriptor twin (`isTupleTypedOperand`,
 * `library/utils.ts`) follows.
 */
describe('a symbol declared with the bare `tuple` type', () => {
  function withW(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('w', 'tuple');
    return ce;
  }

  it('is a tuple to the structural predicate', () => {
    const ce = withW();
    expect(isTuple(ce.symbol('w'))).toBe(true);
  });

  it('scales as a tuple, never as a scalar', () => {
    const ce = withW();
    expect(ce.parse('2w').type.toString()).toBe('tuple');
    expect(ce.parse('-w').type.toString()).toBe('tuple');
    expect(ce.parse('w/2').type.toString()).toBe('tuple');
  });

  it('refuses a product of two tuples, as a compound-typed tuple does', () => {
    const ce = withW();
    ce.declare('p', 'tuple<number, number>');
    expect(ce.parse('w \\cdot w').json).toMatchObject([
      'Error',
      ['ErrorCode', "'no-product-between-points'", "'cross-applies'", expect.anything()],
    ]);
    expect(ce.parse('w \\cdot p').json).toMatchObject([
      'Error',
      ['ErrorCode', "'no-product-between-points'", "'no-cross'", expect.anything()],
    ]);
    expect(ce.parse('2/w').json).toMatchObject([
      'Error',
      ['ErrorCode', "'no-division-by-point'"],
    ]);
  });

  it('lifts a component-wise function to a tuple', () => {
    const ce = withW();
    expect(ce.parse('\\sin(w)').type.toString()).toBe('tuple');
    expect(ce.parse('\\sqrt{w}').type.toString()).toBe('tuple');
    expect(ce.parse('w^2').type.toString()).toBe('tuple');
  });

  it('yields the cells to a list sibling whatever the operand order', () => {
    // A list sibling supplies the broadcast cells, so the result is a list of
    // per-element results, and the claim must not depend on which operand
    // the type lift meets first.
    const ce = withW();
    ce.declare('L', 'list<number>');
    const w = ce.symbol('w');
    const L = ce.symbol('L');
    expect(ce.function('Power', [w, L]).type.toString()).toBe('list<number>');
    expect(ce.function('Power', [L, w]).type.toString()).toBe('list<number>');
  });

  it('takes the norm under Abs', () => {
    const ce = withW();
    const abs = ce.parse('|w|');
    expect(abs.type.toString()).toBe('number');
    expect(abs.evaluate().operator).toBe('Norm');
  });

  it('evaluates component-wise once assigned, within the claimed type', () => {
    const ce = withW();
    ce.assign('w', ce.box(['Tuple', 1, 2]));
    expect(ce.parse('2w').evaluate().toString()).toBe('(2, 4)');
    expect(ce.parse('\\sin(w)').evaluate().toString()).toBe('(sin(1), sin(2))');
    expect(ce.parse('\\sqrt{w}').evaluate().toString()).toBe('(1, sqrt(2))');
    expect(ce.parse('w^2').evaluate().toString()).toBe('(1, 4)');
    expect(ce.parse('|w|').evaluate().toString()).toBe('sqrt(5)');
  });

  it('stays atomic inside a list broadcast, and a unit factor folds away', () => {
    // A list times a symbolic tuple scales the tuple into every cell. The
    // symbolic tuple product (`mulTuples`, `arithmetic-mul-div.ts`) used to
    // build the cell for the factor `1` as `1p` through `_fn`, bypassing the
    // canonical `1 · x` fold, for the compound and the bare spelling alike.
    const ce = withW();
    ce.declare('p', 'tuple<number, number>');
    expect(
      ce.box(['Multiply', ['List', 1, 2, 3], 'w']).evaluate().toString()
    ).toBe('[w,2w,3w]');
    expect(
      ce.box(['Multiply', ['List', 1, 2, 3], 'p']).evaluate().toString()
    ).toBe('[p,2p,3p]');
    expect(ce.box(['Multiply', 1, 1, 'w']).evaluate().toString()).toBe('w');
  });
});
