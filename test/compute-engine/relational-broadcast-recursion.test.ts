import { ComputeEngine } from '../../src/compute-engine';

// `Equal`/`NotEqual` broadcast element-wise over a list operand only in the
// list-vs-scalar case. That decision is taken TWICE: once before evaluation
// (`skipBroadcastForVectorOps`, step 2 in `boxed-function`) and once inside the
// evaluate handler, which step 2 defers to "with full information".
//
// The two rules disagreed. Step 2 skips when two or more operands are
// collections OR possibly-collection typed; the handler counted only actual
// collections. An application with a top type (`A(t)` with `A` undeclared,
// `q(2)` declared `(number) -> unknown`) is possibly-collection typed and stays
// so after evaluation — it never resolves. So step 2 skipped, the handler
// counted one collection and rebuilt the identical node, evaluating it
// re-entered step 2, and `A(t) = [t]` overflowed the stack out of `evaluate()`
// on a bare engine.

describe('Equal/NotEqual over an opaque operand and a list', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('an undeclared head against a list does not recurse', () => {
    // The reported witness: one line, bare engine, no declarations.
    expect(ce.parse('A(t) = [t]').evaluate().toString()).toBe('A(t) == [t]');
  });

  test('a top-typed application against a list does not recurse', () => {
    ce.declare('q', '(number) -> unknown');
    expect(ce.box(['Equal', ['q', 2], ['List', 1, 2]]).evaluate().toString()).toBe(
      'q(2) == [1,2]'
    );
    expect(
      ce.box(['NotEqual', ['q', 2], ['List', 1, 2]]).evaluate().toString()
    ).toBe('q(2) != [1,2]');
  });

  test('the comparison stays INERT rather than claiming a mismatch', () => {
    // `q(2)` may still BE `[1,2]` — the engine cannot see either way, so
    // `False` would be a wrong answer, not a conservative one.
    ce.declare('q', '(number) -> unknown');
    const r = ce.box(['Equal', ['q', 2], ['List', 1, 2]]).evaluate();
    expect(r.operator).toBe('Equal');
    // Not a boolean verdict of either polarity.
    expect(r.symbol).toBe(undefined);
  });

  test('a resolved operand still decides, both ways', () => {
    ce.assign('q', ce.parse('x \\mapsto [1,2]'));
    // A single boolean, not `["True","True"]`: `q(2)` is statically typed as
    // a collection (`vector<2>`), and a collection-typed application follows
    // the same documented rule as a literal list — whole-collection equality
    // against another collection. The elementwise result this test originally
    // pinned was the step-2 gate missing definitely-collection-TYPED operands
    // (it counted only collection nodes and possibly-collection types), fixed
    // 2026-08-15 when placeholder-signature refinement made such types common.
    expect(
      ce.box(['Equal', ['q', 2], ['List', 1, 2]]).evaluate().symbol
    ).toBe('True');
    expect(
      ce.box(['NotEqual', ['q', 2], ['List', 1, 2]]).evaluate().symbol
    ).toBe('False');
  });

  test('whole-collection equality is unchanged', () => {
    expect(
      ce.box(['Equal', ['List', 1, 2], ['List', 1, 2]]).evaluate().symbol
    ).toBe('True');
    expect(
      ce.box(['Equal', ['List', 1, 2], ['List', 1, 2, 3]]).evaluate().symbol
    ).toBe('False');
  });

  test('list-vs-scalar broadcast is unchanged', () => {
    // A bare SYMBOL is deliberately not possibly-collection typed, so this
    // broadcasts at step 2 exactly as before.
    expect(ce.box(['Equal', 'x', ['List', 1, 2]]).evaluate().toString()).toBe(
      '[x == 1,x == 2]'
    );
    // An application with a CONCRETE result type is not opaque either.
    expect(
      ce.box(['Equal', ['Sin', 't'], ['List', 't']]).evaluate().toString()
    ).toBe('[sin(t) == t]');
  });

  test('the inequality operators were never affected', () => {
    expect(ce.box(['Less', ['A', 't'], ['List', 't']]).evaluate().toString()).toBe(
      '[A(t) < t]'
    );
  });
});

// The same disagreement, reintroduced from the other side in 0.110.0.
//
// Step 2 gained a third disjunct (`x.type.matches('collection')`) when
// placeholder-signature refinement started giving applications their concrete
// collection types, so an operand that is collection-TYPED but not a collection
// NODE — a symbol declared `vector<2>` with no value, or `L(1)` under
// `L: (number) -> vector<2>` — began counting there. The evaluate handler's
// twin predicate did not gain it, so the two rules disagreed again and the
// identical loop returned: step 2 skipped, the handler broadcast, the rebuilt
// node re-entered step 2. `M = [1,2]` overflowed the stack on a bare engine.
//
// These operands are undecidable rather than false: nothing has resolved, so
// the comparison stays inert, which is what the whole-collection rule says.
describe('Equal/NotEqual over a collection-TYPED operand and a list', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('a declared, unassigned collection-typed symbol does not recurse', () => {
    ce.declare('M', 'vector<2>');
    expect(ce.box(['Equal', 'M', ['List', 1, 2]]).evaluate().toString()).toBe(
      'M == [1,2]'
    );
  });

  test('a collection-typed application does not recurse, in either order', () => {
    ce.declare('L', '(number) -> vector<2>');
    expect(
      ce.box(['Equal', ['L', 1], ['List', 1, 2]]).evaluate().toString()
    ).toBe('L(1) == [1,2]');
    expect(
      ce.box(['Equal', ['List', 1, 2], ['L', 1]]).evaluate().toString()
    ).toBe('[1,2] == L(1)');
  });

  test('NotEqual and a list<number> return type behave the same', () => {
    ce.declare('L', '(number) -> vector<2>');
    expect(
      ce.box(['NotEqual', ['L', 1], ['List', 1, 2]]).evaluate().toString()
    ).toBe('L(1) != [1,2]');
    const ce2 = new ComputeEngine();
    ce2.declare('K', '(number) -> list<number>');
    expect(
      ce2.box(['Equal', ['K', 1], ['List', 1, 2]]).evaluate().toString()
    ).toBe('K(1) == [1,2]');
  });

  test('a SCALAR-typed application still broadcasts element-wise', () => {
    // The new disjunct must not swallow the list-vs-scalar case: `L(1)` is a
    // number here, so fanning the list out is still correct.
    ce.declare('L', '(number) -> number');
    expect(
      ce.box(['Equal', ['L', 1], ['List', 1, 2]]).evaluate().toString()
    ).toBe('[L(1) == 1,L(1) == 2]');
  });

  test('a DEFINED vector-valued function still decides whole-collection', () => {
    ce.box(['Assign', 'L', ['Function', ['List', 1, 2], 'k']]).evaluate();
    expect(
      ce.box(['Equal', ['L', 1], ['List', 1, 2]]).evaluate().symbol
    ).toBe('True');
  });
});
