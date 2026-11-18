/**
 * Compiling a symbol whose assigned value is a shared graph must not emit an
 * exponentially large program.
 *
 * The generated source is text, so folding a value that mentions the same
 * sub-value from several places would write that sub-value out once per
 * reference PATH. A tower built as `f(n+1) = f(n) + 2 f(n)` grows by three
 * distinct nodes per level while its expansion quadruples. The compiled code
 * reads each shared value once, so its size grows linearly with the depth.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Assign `f0 := x` and then `f(k) := f(k-1) + 2 f(k-1)` up to `depth`, storing
 * each level RAW so the reference to the previous level survives as a symbol
 * rather than being folded at assignment time. Level `k` expands to
 * `4·2^k − 3` nodes and is worth `3^k · x`.
 */
function towerEngine(depth: number): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('f0', ce.box('x'));
  for (let k = 1; k <= depth; k++)
    ce.assign(
      `f${k}`,
      ce.box(['Add', ['Multiply', `f${k - 1}`, 2], `f${k - 1}`], {
        form: 'raw',
      })
    );
  return ce;
}

describe('COMPILE: fold-size guard for DAG-shared symbol values', () => {
  it('still folds an ordinary assigned value', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('3x + 1'));
    const { run } = compile(ce.parse('2a'), { fallback: false });
    expect(run!({ x: 4 })).toBe(26);
  });

  it.each(['javascript', 'glsl'] as const)(
    'a deep tower compiles to code linear in its depth on %s',
    (to) => {
      // Level 30 expands to 4 294 967 293 nodes; the code of level 30 is
      // within a small factor of twice the code of level 15.
      const size = (depth: number): number => {
        const ce = towerEngine(depth);
        const r = compile(ce.box(`f${depth}`), { to, fallback: false });
        expect(r.success).toBe(true);
        return (r.code ?? '').length;
      };
      expect(size(30)).toBeLessThan(4 * size(15));
    }
  );

  it('a deep tower has the interpreter value', () => {
    for (const depth of [8, 15, 30]) {
      const ce = towerEngine(depth);
      const r = compile(ce.box(`f${depth}`), { fallback: false });
      expect(r.run!({ x: 2 })).toBe(2 * 3 ** depth);
    }
  });
});
