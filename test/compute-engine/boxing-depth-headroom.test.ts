import { ComputeEngine } from '../../src/compute-engine';

/**
 * Boxing recurses once per level of the MathJSON tree, so the number of stack
 * frames spent per level bounds how deep a tree can be boxed at all before
 * `RangeError: Maximum call stack size exceeded`. Two pieces of plumbing used
 * to sit on that recursive path without doing any work once a root repair was
 * active: the `withDevolveRepair`/`withRootRepair` wrappers (entered twice per
 * level, in `box()` and again in `boxFunction()`) and the public `ce.expr()`
 * entry point used to box each operand (five frames of scope re-installation
 * per operand). Both are bypassed on the nested path in
 * `boxed-expression/box.ts` now, which took canonical boxing from 20 frames
 * per level to 9, and canonicalizing an already raw-boxed tree from 26 to 15
 * (Node 22, 2026-08-15) — the ceiling on the default stack went from ~225 to
 * ~385 canonical levels and from ~400 to ~675 raw.
 *
 * A second trim the same day removed the frames that only dispatched: the
 * operands are boxed by a `for` loop calling `boxInternal()` directly (not
 * `Array.prototype.map` + callback + `box()`, whose two brackets are no-ops
 * inside a root pass — see `boxOperands()` in `box.ts`), `boxInternal()`
 * calls `boxFunctionInternal()` directly when the root is active, and
 * `canonicalForm()` with no scope is just the `.canonical` getter. Canonical
 * boxing: 9 → 5 frames per level (`boxInternal → boxFunctionInternal →
 * makeCanonicalFunction → makeCanonicalFunctionCore →
 * applyOperatorDefinition`); canonicalizing a raw-boxed tree: 15 → 8. Bytes of
 * stack per level (Δ`--stack-size` / Δceiling): canonical 2 080 → 1 570, raw
 * boxing 1 220 → 630 — the remaining frames are the large ones, whose Ignition
 * register files are the next thing to shrink.
 *
 * The frames-per-level count is measured, not the ceiling: a probe operator's
 * canonical handler records the JS stack depth when it runs, and the
 * difference between two nest sizes divided by the size difference is exactly
 * the per-level cost — deterministic, and independent of the stack size of
 * the machine or the test runner's own frames. Per the wall-clock doctrine
 * (ROADMAP "Test assertions on wall-clock time") this asserts a count. The
 * bounds below sit between the old and new counts with room on both sides.
 *
 * The ceiling is moved, not removed: `1-2-3-…` still parses to a left-nested
 * `Subtract` chain that overflows past a few hundred terms (ROADMAP "Boxing a
 * long `1-2-3-…` chain overflows the stack").
 */
describe('boxing stack frames per nesting level', () => {
  function stackDepth(): number {
    const saved = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;
    try {
      return new Error().stack!.split('\n').length;
    } finally {
      Error.stackTraceLimit = saved;
    }
  }

  const nest = (n: number) => {
    let d: any = 'x';
    for (let i = 0; i < n; i++) d = ['Probe', d];
    return d;
  };

  function framesPerLevel(form: 'canonical' | 'raw'): number {
    const ce = new ComputeEngine();
    let depthAtLeaf = 0;
    ce.declare('Probe', {
      signature: '(any) -> any',
      // Runs at every level; record the maximum, which is the leaf.
      canonical: (ops, { engine }) => {
        depthAtLeaf = Math.max(depthAtLeaf, stackDepth());
        return engine._fn('Probe', ops);
      },
    });
    const measure = (n: number) => {
      depthAtLeaf = 0;
      const expr = ce.box(nest(n), { form });
      // A raw box does not run the handler; canonicalize explicitly so the
      // probe fires at every level of the raw-built tree too.
      if (form === 'raw') expr.canonical;
      return depthAtLeaf;
    };
    const a = measure(20);
    const b = measure(60);
    return (b - a) / 40;
  }

  // Measured 5 and 8 on Node 22 (2026-08-15). The bounds leave ~4 frames of
  // room: a Node/V8 upgrade can change how `Error.prototype.stack` reports
  // frames for inlined or optimized code, and a failure here after a runtime
  // bump should first be read as that, not as a boxing regression.
  test('canonical boxing spends fewer than 9 frames per level (was 20, then 9, now 5)', () => {
    const f = framesPerLevel('canonical');
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(9);
  });

  test('canonicalizing a raw-boxed tree spends fewer than 13 frames per level (was 26, then 15, now 8)', () => {
    const f = framesPerLevel('raw');
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(13);
  });

  // The frame trim boxes nested operands through `boxInternal()` directly,
  // skipping `box()`'s inference-transaction bracket. That is only a no-op
  // when a transaction is already open: `ce.box()` opens one at the root, but
  // `ce.function()` roots a construction WITHOUT opening one, so each of its
  // top-level operands must still get its own bracket (one boxing epoch per
  // operand — provenance entries stamp the epoch so a consumer can ask
  // "recorded by the pass running now?"). Both are pinned by counting epoch
  // bumps; a guard that only checked `isRootActive` would make the
  // `ce.function()` counts 0.
  test('a ce.box() root opens exactly one boxing epoch for the whole tree', () => {
    const ce = new ComputeEngine();
    let d: any = 'x';
    for (let i = 0; i < 30; i++) d = ['Sin', d];
    const before = ce._boxingEpoch;
    ce.box(d);
    expect(ce._boxingEpoch - before).toBe(1);
  });

  test('a ce.function() root still opens one boxing epoch per top-level operand', () => {
    const ce = new ComputeEngine();
    const deep = () => {
      let d: any = 'x';
      for (let i = 0; i < 30; i++) d = ['Sin', d];
      return d;
    };
    let before = ce._boxingEpoch;
    ce.function('Sin', [deep()]);
    expect(ce._boxingEpoch - before).toBe(1);
    before = ce._boxingEpoch;
    ce.function('Tuple', [deep(), deep(), deep()]);
    expect(ce._boxingEpoch - before).toBe(3);
  });

  test('a 300-deep Sin nest boxes canonically', () => {
    // Outcome check with wide margin: the pre-trim ceiling was ~225 levels
    // in a bare process (~325 under jest), the trimmed one ~385 (~600).
    const ce = new ComputeEngine();
    let d: any = 'x';
    for (let i = 0; i < 300; i++) d = ['Sin', d];
    let e = ce.box(d);
    let depth = 0;
    while (e.operator === 'Sin') {
      e = e.op1;
      depth += 1;
    }
    expect(depth).toBe(300);
    expect(e.symbol).toBe('x');
  });
});
