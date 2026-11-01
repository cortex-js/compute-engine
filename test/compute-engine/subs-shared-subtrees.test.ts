import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// `subs()` on an expression that uses the same boxed node more than once
// substitutes that node once for each context in which the call meets it, not
// once for each path from the root. Before, a raw `Add(e, e)` chain (with
// `e` the same boxed object twice at each level) took a time that grew as
// 2^depth: about 0.5 s at depth 18, doubling with each level.
//
// A node below a binder that binds a substitution key is substituted without
// that key, so the same node can have two different results in one call. The
// tests below compare each result with the result for a tree that has the
// same structure but no shared node.

const ce = new ComputeEngine();

type Form = 'raw' | 'canonical';

function addChain(depth: number, form: Form): Expression {
  let e = ce.expr('x', { form });
  for (let i = 0; i < depth; i++) e = ce.function('Add', [e, e], { form });
  return e;
}

/** Build a tree with `build`, once with one shared node `t` and once with a
 * new copy of `t` at each use, and substitute both. */
function sharedAndUnshared(
  makeT: () => Expression,
  build: (t: () => Expression) => Expression,
  sub: Record<string, number>
): [Expression, Expression] {
  const t = makeT();
  const shared = build(() => t).subs(sub);
  const unshared = build(makeT).subs(sub);
  return [shared, unshared];
}

describe('SUBS OF AN EXPRESSION WITH SHARED NODES', () => {
  test('a raw Add chain of depth 30 is substituted in linear time', () => {
    const e = addChain(30, 'raw');
    const result = e.subs({ x: 3 });
    // The result keeps the sharing: the two operands are one node.
    expect(result.ops![0]).toBe(result.ops![1]);
    let node = result;
    for (let i = 0; i < 30; i++) node = node.ops![0];
    expect(node.json).toEqual(3);
  });

  test('the value of a substituted raw Add chain', () => {
    const result = addChain(12, 'raw').subs({ x: 3 });
    expect(result.N().re).toBe(3 * 2 ** 12);
  });

  test('a raw Add chain substituted with an explicit form', () => {
    const result = addChain(30, 'raw').subs({ x: 3 }, { canonical: false });
    expect(result.isCanonical).toBe(false);
    const canonical = addChain(10, 'raw').subs({ x: 3 }, { canonical: true });
    expect(canonical.json).toEqual(3 * 2 ** 10);
  });

  test('a shared node outside and inside a Function literal that binds x', () => {
    for (const order of ['outside first', 'inside first']) {
      const [shared, unshared] = sharedAndUnshared(
        () => ce.function('Add', ['x', 'y'], { form: 'raw' }),
        (t) => {
          const fn = ce.function('Function', [t(), 'x'], { form: 'raw' });
          return ce.function(
            'Pair',
            order === 'outside first' ? [t(), fn] : [fn, t()],
            { form: 'raw' }
          );
        },
        { x: 3, y: 5 }
      );
      expect(shared.json).toEqual(unshared.json);
      const fn = shared.ops!.find((x) => x.operator === 'Function')!;
      expect(fn.json).toEqual(['Function', ['Add', 'x', 5], 'x']);
    }
  });

  test('a shared node in the body and in the bound of a Sum over x', () => {
    // The body reads the index `x`; the upper bound reads the `x` outside
    // the `Sum`. The tree is structural: in a raw `Sum`, `subs()` leaves
    // the bound unchanged when it reads the name of the index.
    const [shared, unshared] = sharedAndUnshared(
      () => ce.function('Add', ['x', 1], { form: 'structural' }),
      (t) =>
        ce.function(
          'Sum',
          [t(), ce.function('Limits', ['x', 1, t()], { form: 'structural' })],
          { form: 'structural' }
        ),
      { x: 2 }
    );
    expect(shared.json).toEqual(unshared.json);
    expect(shared.json).toEqual([
      'Sum',
      ['Add', 'x', 1],
      ['Limits', 'x', 1, ['Add', 2, 1]],
    ]);
    // 2 + 3 + 4
    expect(shared.evaluate().json).toEqual(9);
  });

  test('a shared node outside and inside a Block that declares x', () => {
    const [shared, unshared] = sharedAndUnshared(
      () => ce.function('Multiply', ['x', 'y'], { form: 'raw' }),
      (t) =>
        ce.function(
          'Add',
          [
            t(),
            ce.function(
              'Block',
              [ce.function('Declare', ['x', "'real'"], { form: 'raw' }), t()],
              { form: 'raw' }
            ),
          ],
          { form: 'raw' }
        ),
      { x: 2, y: 7 }
    );
    expect(shared.json).toEqual(unshared.json);
    expect(shared.ops![0].json).toEqual(['Multiply', 2, 7]);
    expect(shared.ops![1].ops![1].json).toEqual(['Multiply', 'x', 7]);
  });

  test('a shared canonical node outside and inside a Function literal', () => {
    const t = ce.expr(['Add', 'x', 'y']);
    const shared = ce
      .expr(['Pair', t, ['Function', t, 'x']])
      .subs({ x: 3, y: 5 });
    const unshared = ce
      .expr(['Pair', ['Add', 'x', 'y'], ['Function', ['Add', 'x', 'y'], 'x']])
      .subs({ x: 3, y: 5 });
    expect(shared.json).toEqual(unshared.json);
    expect(shared.ops![0].json).toEqual(8);
  });
});
