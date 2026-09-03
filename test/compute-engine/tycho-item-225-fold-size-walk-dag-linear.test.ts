/**
 * The fold-size walk stays linear on a DAG-shaped value.
 *
 * A boxed expression is a DAG: a value built from one sub-expression
 * referenced twice holds the same object twice. `expandedFoldSize` memoizes
 * per node, but the names a binder binds were gathered by a helper that walked
 * the binder's bound operands as a TREE, once per path, pushing every symbol
 * occurrence onto an array. A comprehension whose range bound reads a deeply
 * shared value made that array pass 2^32 entries: `Array.push` threw
 * `Invalid array length` inside the compile, minutes and gigabytes later,
 * where the fold-size refusal used to answer in seconds (Tycho item 225).
 * The sibling walkers over a value (`foldValueImpure`, `foldValueMentions`)
 * re-visited shared nodes the same way, and the size memo was keyed by the
 * identity of a bound-name set that every binder rebuilt.
 *
 * The walk is timed DIRECTLY on a built value: routing a value with 2^22
 * paths through `compile()` would also canonicalize `Length` over it, which
 * has its own recursion cost on such a shape and would dominate the timing.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

/** A value whose two components are the SAME object, nested `depth` times:
 * 2^depth paths, `depth + 1` distinct nodes. */
function sharedTower(ce: ComputeEngine, depth: number) {
  let t = ce.parse('x + 1');
  for (let k = 0; k < depth; k++) t = ce.function('Tuple', [t, t]);
  return t;
}

describe('a binder whose bound reads a shared tower', () => {
  test('is sized in linear time, and the size counts every path', () => {
    const ce = new ComputeEngine();
    const n = ce.symbol('n');
    const tower = sharedTower(ce, 22);
    const sum = ce.function('Sum', [
      n,
      ce.function('Element', [
        n,
        ce.function('Range', [ce.number(1), ce.function('Length', [tower])]),
      ]),
    ]);
    // Reaching into the compiler's size walk on purpose: the property under
    // test is the walk's own cost, not what the compile does after it.
    const walk = (BaseCompiler as any).expandedFoldSize as (
      engine: ComputeEngine,
      value: unknown,
      target: object
    ) => number;
    const t0 = Date.now();
    const size = walk(ce, sum, {});
    const elapsed = Date.now() - t0;
    // 2^22 leaves plus the tuple and binder nodes: the emitter would write
    // the shared value once per path, and that is what the size counts.
    expect(size).toBeGreaterThan(2 ** 22);
    // The unguarded walk took about 3 s here and doubled with every level;
    // the linear walk is a few milliseconds, so a wide bound still catches
    // the regression under a loaded suite.
    expect(elapsed).toBeLessThan(1500);
  });

  test('a tower of values under binders still compiles and evaluates', () => {
    // Each level mentions the index of its own sums, so inside a binder it is
    // inlined rather than bound once (the environment differs); six levels
    // stay under the size guard and check the walk did not change the value.
    const ce = new ComputeEngine();
    ce.assign('a_0', ce.parse('x'));
    for (let k = 1; k <= 6; k++)
      ce.assign(
        `a_${k}`,
        ce.parse(`\\sum_{i=1}^{2} a_{${k - 1}} + \\sum_{j=1}^{2} a_{${k - 1}}`)
      );
    const r = compile(ce.parse('a_{6} + x'), { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    // (2 + 2)^6 · x, plus x.
    expect(r.run!({ x: 1 })).toBe(4 ** 6 + 1);
    expect(String(ce.parse('a_{6} + x').evaluate())).toBe('4097x');
  });
});
