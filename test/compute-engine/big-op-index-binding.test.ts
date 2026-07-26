import { ComputeEngine } from '../../src/compute-engine';

/**
 * `Sum`/`Product` declare their index with the sanctioned binder mechanism
 * (`scoped: indexingSetSites(1, 'integer')`,
 * `docs/plans/2026-07-26-binder-mechanism-design.md`). The index is bound in
 * the big op's OWN scope, which is what makes it shadow a same-named library
 * constant or global value, and what makes the parse, `ce.box()` and
 * `ce.function()` routes agree about the same expression.
 */

describe('big-op index binding', () => {
  test('the index shadows a library constant (i, e)', () => {
    const ce = new ComputeEngine();
    // `i` is the imaginary unit and `e` is Euler's number in the root scope;
    // as an index each is a different variable.
    expect(ce.parse('\\sum_{i=1}^{4} i').evaluate().re).toEqual(10);
    expect(ce.parse('\\sum_{e=1}^{4} e').evaluate().re).toEqual(10);
    expect(ce.parse('\\prod_{i=1}^{4} i').evaluate().re).toEqual(24);
    expect(ce.parse('\\prod_{e=1}^{4} e').evaluate().re).toEqual(24);
  });

  test('the index shadows a global value of the same name', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 100);
    expect(ce.parse('\\sum_{k=1}^{3} k').evaluate().re).toEqual(6);
    expect(ce.box('k').evaluate().re).toEqual(100);
  });

  test('the index is bound by the big op itself', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{k=1}^{3} k');
    expect([...(sum.localScope?.bindings.keys() ?? [])]).toEqual(['k']);
  });

  test('the parse, box and function routes agree', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('\\sum_{k=1}^{3} k');
    const boxed = ce.box(['Sum', 'k', ['Limits', 'k', 1, 3]]);
    const applied = ce.function('Sum', [
      ce.symbol('k'),
      ce.function('Limits', [ce.symbol('k'), ce.number(1), ce.number(3)]),
    ]);
    expect(parsed.isSame(boxed)).toBe(true);
    expect(parsed.isSame(applied)).toBe(true);
    expect(applied.evaluate().re).toEqual(6);
  });
});

/**
 * `Comprehension`'s own description states the contract: "Later clauses see
 * earlier bindings; independent clauses produce a Cartesian product." So an
 * EARLIER clause's collection must resolve a name a LATER clause binds in the
 * ENCLOSING scope — the binder hook's sites are `clauseLocal`.
 */
describe('binder clause ordering', () => {
  test('an earlier clause sees the enclosing binding of a later index', () => {
    const ce = new ComputeEngine();
    ce.assign('j', 7);
    // `q` is drawn from [j, j+1] = [7, 8] — the GLOBAL `j`, not the loop's.
    const boxed = ce.box([
      'Comprehension',
      ['Tuple', 'q', 'j'],
      ['Element', 'q', ['List', 'j', ['Add', 'j', 1]]],
      ['Element', 'j', ['List', 10, 20]],
    ]);
    expect(boxed.evaluate().toString()).toEqual(
      '[(7, 10),(7, 20),(8, 10),(8, 20)]'
    );
    // The loop's `j` did not leak into the enclosing scope.
    expect(ce.box('j').evaluate().re).toEqual(7);
  });

  test('the box and function routes agree about clause ordering', () => {
    const ce = new ComputeEngine();
    ce.assign('j', 7);
    const boxed = ce.box([
      'Comprehension',
      ['Tuple', 'q', 'j'],
      ['Element', 'q', ['List', 'j', ['Add', 'j', 1]]],
      ['Element', 'j', ['List', 10, 20]],
    ]);
    const applied = ce.function('Comprehension', [
      ce.function('Tuple', [ce.symbol('q'), ce.symbol('j')]),
      ce.function('Element', [
        ce.symbol('q'),
        ce.function('List', [ce.symbol('j'), ce.symbol('j').add(1)]),
      ]),
      ce.function('Element', [
        ce.symbol('j'),
        ce.function('List', [ce.number(10), ce.number(20)]),
      ]),
    ]);
    expect(boxed.isSame(applied)).toBe(true);
    expect(applied.evaluate().toString()).toEqual(boxed.evaluate().toString());
  });

  test('the body sees every clause binding', () => {
    const ce = new ComputeEngine();
    const boxed = ce.box([
      'Comprehension',
      ['Add', 'q', 'r'],
      ['Element', 'q', ['List', 1, 2]],
      ['Element', 'r', ['List', 10, 20]],
    ]);
    expect([...(boxed.localScope?.bindings.keys() ?? [])]).toEqual(['q', 'r']);
    expect(boxed.evaluate().toString()).toEqual('[11,21,12,22]');
  });
});

/**
 * A binder whose operands hold no binding site (a bare `Loop(body)`) must not
 * canonicalize its body inside a scope that is pushed and then discarded.
 */
describe('a binder with no binding site pushes no scope', () => {
  test('a bare Loop carries no local scope', () => {
    const ce = new ComputeEngine();
    const loop = ce.box(['Loop', ['Block', ['Break']]]);
    expect(loop.localScope).toBeUndefined();
  });

  test('a nested binder in a bare Loop body is parented to the ambient scope', () => {
    const ce = new ComputeEngine();
    const loop = ce.box(['Loop', ['Sum', 'k', ['Limits', 'k', 1, 3]]]);
    const sum = loop.ops![0];
    expect([...(sum.localScope?.bindings.keys() ?? [])]).toEqual(['k']);
    // No discarded frame between the `Sum` scope and the ambient one.
    expect(sum.localScope?.parent === ce.context.lexicalScope).toBe(true);
  });

  test('`Series` still finds its default expansion variable', () => {
    const ce = new ComputeEngine();
    const series = ce.box(['Series', ['Sin', 'x']]);
    expect(series.toString()).toEqual('Series(sin(x), x, 0, 5)');
    expect([...(series.localScope?.bindings.keys() ?? [])]).toEqual(['x']);
    expect(ce.parse('\\sin x').evaluate().toString()).toEqual('sin(x)');
  });
});
