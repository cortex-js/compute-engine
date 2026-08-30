/**
 * Compiling a symbol whose assigned value is a shared graph must not emit an
 * exponentially large program.
 *
 * The generated source is text, so folding a value that mentions the same
 * sub-value from several places writes that sub-value out once per reference
 * PATH. A tower built as `f(n+1) = f(n) + 2 f(n)` grows by three distinct
 * nodes per level while its emission quadruples.
 *
 * Two mechanisms in `BaseCompiler` answer this, by target:
 * - The JavaScript-family targets bind each folded compound value ONCE as a
 *   preamble local (`const _val_f7 = …;`) and read it by name, so the tower
 *   emits three nodes per level (see `compile-fold-shared-values.test.ts`).
 * - A target without that channel (Python here) keeps the inline fold, and a
 *   guard measures the EXPANDED (per-path) node count — not the number of
 *   distinct nodes — with a walk that memoizes each node object so it stays
 *   linear in the DISTINCT node count. Above the limit the compiler fails
 *   CLOSED rather than declining: a decline makes the caller emit a bare
 *   identifier for a symbol the engine knows, a dangling name in the artifact.
 *   The same guard applies to the bound emission, charging each bound value
 *   once.
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
    const js = ce._getCompilationTarget('javascript')!;
    const { code, run } = js.compile(ce.parse('2a'));
    // The value is baked into the artifact (as a bound local on this
    // target), not read from the vars object.
    expect(code).toBe('2 * _val_a');
    expect(code).not.toContain('_.a');
    expect(run!({ x: 4 })).toBe(26);
  });

  it('a shallow tower folds on every target', () => {
    // Level 8 expands to 1021 nodes, well under the limit even inline.
    const ce = towerEngine(8);
    const js = ce._getCompilationTarget('javascript')!;
    const { code, run } = js.compile(ce.box('f8'));
    expect(code).not.toContain('_.f7');
    expect(run!({ x: 2 })).toBe(2 * 3 ** 8);
    const py = ce._getCompilationTarget('python')!;
    expect(py.compile(ce.box('f8')).code).not.toContain('f7');
  });

  describe('above the limit on a target that folds inline (Python)', () => {
    it('the direct registered-target route refuses with a compile-time error', () => {
      // Level 15 expands to 131 069 nodes — past the limit, and ~400 KB of
      // source if it were baked in.
      const ce = towerEngine(15);
      const py = ce._getCompilationTarget('python')!;
      const started = Date.now();
      expect(() => py.compile(ce.box('f15'))).toThrow(
        /above the fold-size limit/
      );
      const elapsed = Date.now() - started;
      // The message names the symbol, the measured expansion and the reason.
      expect(() => py.compile(ce.box('f15'))).toThrow(/f15/);
      expect(() => py.compile(ce.box('f15'))).toThrow(/131069 nodes/);
      expect(() => py.compile(ce.box('f15'))).toThrow(
        /once per reference path/
      );
      // A loose ceiling: refusing costs a walk over ~46 distinct nodes, while
      // emitting this fold took ~20 s before the guard. Only an order-of-
      // magnitude regression can trip this, so machine load cannot.
      expect(elapsed).toBeLessThan(4000);
    });

    it('the public route degrades to the interpreter and still computes the right value', () => {
      const ce = towerEngine(15);
      const result = compile(ce.box('f15'), { to: 'python' });
      // The refusal is a compile-time decline, so `fallback: true` (the
      // default) hands back an interpreter-backed runner rather than throwing.
      expect(result.success).toBe(false);
      expect(result.run).toBeDefined();
      expect(result.run!({ x: 2 })).toBe(2 * 3 ** 15);
    });
  });

  it('sizing a deep tower is linear in the DISTINCT nodes, not the paths', () => {
    // Level 30 expands to 4 294 967 293 nodes. A per-path walk would never
    // finish; the memoized walk resolves each of the 31 stored values once.
    const ce = towerEngine(30);
    const py = ce._getCompilationTarget('python')!;

    // `_getSymbolValue` is the walk's only lookup, so counting its calls is a
    // load-independent measure of how much of the graph was visited.
    const original = ce._getSymbolValue.bind(ce);
    let lookups = 0;
    (
      ce as { _getSymbolValue: ComputeEngine['_getSymbolValue'] }
    )._getSymbolValue = ((id: string) => {
      lookups += 1;
      return original(id);
    }) as ComputeEngine['_getSymbolValue'];

    const started = Date.now();
    try {
      expect(() => py.compile(ce.box('f30'))).toThrow(
        /above the fold-size limit/
      );
    } finally {
      (
        ce as { _getSymbolValue: ComputeEngine['_getSymbolValue'] }
      )._getSymbolValue = original;
    }
    const elapsed = Date.now() - started;

    // Two symbol nodes per level plus the root, each looked up once.
    expect(lookups).toBeLessThan(200);
    expect(elapsed).toBeLessThan(4000);
  });
});
