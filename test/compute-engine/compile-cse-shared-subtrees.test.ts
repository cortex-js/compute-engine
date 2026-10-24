// A boxed expression can hold the same node object at several positions (a
// DAG). `e_k = Add(e_(k-1), e_(k-1))` repeated `d` times has about `d`
// distinct nodes but about `2^d` paths. The common-subexpression analysis
// walked every path, so compiling such an expression took exponential time
// (397 ms at depth 18, out of memory at depth 30). The analysis now walks a
// node object once per region and counts its other paths by weight, so the
// time is linear in the distinct nodes, and each shared level is bound once
// to a temporary, so the code is linear too.
//
// The time limits below are generous on purpose (the measured times are under
// 50 ms); they only have to separate linear from exponential behavior.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  CSE_MAX_BINDINGS_PER_REGION,
  harvestCse,
} from '../../src/compute-engine/compilation/cse';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
const x = ce.symbol('x');
const y = ce.symbol('y');
const F = (op: string, ...ops: Expression[]) => ce.function(op, ops);

/** `e_0 = x + 1`, then `e_k = step(e_(k-1), k)`; returns `[e_0, …, e_d]`. */
function levels(
  d: number,
  step: (e: Expression, k: number) => Expression
): Expression[] {
  const result = [F('Add', x, ce.One)];
  for (let k = 1; k <= d; k++) result.push(step(result[k - 1], k));
  return result;
}

/** `Add(e, e)` with the SAME node object twice (no flattening). */
const doubling = (e: Expression) => ce._fn('Add', [e, e]);
const sinCos = (e: Expression) => F('Add', F('Sin', e), F('Cos', e));

/** A copy of `expr` with a distinct node object at every function position. */
const unshare = (expr: Expression): Expression =>
  expr.ops ? ce._fn(expr.operator, expr.ops.map(unshare)) : expr;

function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
}

describe('CSE over shared subtrees: linear analysis', () => {
  it('walks a 30-level doubling DAG in linear time and counts every path', () => {
    // Depth 30 keeps every path count below the weight cap
    // (`CSE_MAX_OCCURRENCE_WEIGHT`), so the counts are exact.
    const d = 30;
    const e = levels(d, doubling);
    const [harvest, ms] = timed(() => harvestCse(F('Floor', e[d])));
    expect(ms).toBeLessThan(2000);

    // The diagnostics still count every path: `Floor` + `e_d` + 2 paths to
    // each node of `e_(d-1)`, …: e_k has 2^(d-k) paths and e_0 = x + 1 has
    // three nodes.
    let paths = 1;
    for (let k = d; k >= 1; k--) paths += 2 ** (d - k);
    paths += 2 ** d * 3;
    expect(harvest.diagnostics.edges).toBe(paths);

    // Every level reached on two or more paths is a candidate, with its full
    // path count, and none is dropped by subsumption or by the binding cap.
    for (let k = 1; k < d; k++) {
      const candidate = harvest.root.candidates.find(
        (c) => c.representative === e[k]
      );
      expect(candidate).toBeDefined();
      const count = candidate!.occurrences.reduce((n, o) => n + o.weight, 0);
      expect(count).toBe(2 ** (d - k));
    }
    expect(harvest.diagnostics.droppedBySubsumption).toBe(0);
  });

  it('compiles a 40-level doubling DAG fast, to linear code', () => {
    const d = 40;
    const e = levels(d, doubling);
    const [result, ms] = timed(() =>
      compile(F('Floor', e[d]), { constantFold: false })
    );
    expect(ms).toBeLessThan(5000);
    expect(result.success).toBe(true);
    // One temporary per level: about 32 characters each.
    expect(result.code.length).toBeLessThan(60 * d);
    // Doubling a double is exact, so the compiled value is exact too.
    expect(result.run!({ x: 0.3 })).toBe(Math.floor(2 ** d * 1.3));
  });

  it('compiles a 30-level sin/cos DAG fast, to linear code', () => {
    const d = 30;
    const e = levels(d, sinCos);
    const [result, ms] = timed(() =>
      compile(F('Floor', e[d]), { constantFold: false })
    );
    expect(ms).toBeLessThan(5000);
    expect(result.success).toBe(true);
    expect(result.code.length).toBeLessThan(80 * d);
    let v = 0.3 + 1;
    for (let k = 1; k <= d; k++) v = Math.sin(v) + Math.cos(v);
    expect(result.run!({ x: 0.3 })).toBe(Math.floor(v));
  });

  it('keeps every shared level bound when the levels collide in one hash bucket and exceed the binding cap', () => {
    // 99 candidates are more than the per-region binding cap. (The structural
    // hash of `e_k` used to repeat every 64 levels for this shape, which put
    // the levels in one bucket; since CE-318 it no longer does, so this test
    // now checks the cap and the code size only.)
    const d = 100;
    expect(d - 1).toBeGreaterThan(CSE_MAX_BINDINGS_PER_REGION);
    const e = levels(d, doubling);
    const [result, ms] = timed(() =>
      compile(F('Floor', e[d]), { constantFold: false })
    );
    expect(ms).toBeLessThan(5000);
    expect(result.code.length).toBeLessThan(60 * d);

    const harvest = harvestCse(F('Floor', e[d]));
    expect(harvest.diagnostics.exhaustedBuckets).toBe(0);
    expect(harvest.diagnostics.droppedByRegionCap).toBe(0);
    expect(harvest.root.candidates).toHaveLength(d - 1);
  });

  it('keeps the binding cap for node objects that are only repeated', () => {
    // `Add(c_1, c_1, c_2, c_2, …)`: each `c_i` is the same node object twice,
    // at the top level. Inline emission emits it twice, as for a tree, so the
    // exemption from the cap for shared levels does not apply to it.
    const n = CSE_MAX_BINDINGS_PER_REGION + 10;
    const terms: Expression[] = [];
    for (let i = 1; i <= n; i++) {
      const c = F('Sin', F('Add', x, ce.number(i)));
      terms.push(c, c);
    }
    const expr = F('Floor', ce._fn('Add', terms));

    const harvest = harvestCse(expr);
    expect(harvest.root.candidates).toHaveLength(CSE_MAX_BINDINGS_PER_REGION);
    expect(harvest.diagnostics.droppedByRegionCap).toBe(10);

    const result = compile(expr, { constantFold: false });
    expect(result.success).toBe(true);
    expect(result.code.match(/\bconst _cse\d+\b/g)).toHaveLength(
      CSE_MAX_BINDINGS_PER_REGION
    );
  });
});

describe('CSE over shared subtrees: the same output as an unshared tree', () => {
  // The walk does a second walk of a node object only once per region, and
  // counts the other paths by weight. The selection must make the same
  // decisions as a walk of every path: a DAG compiles to the same code as
  // the same expression with a distinct object at every position.
  const shapes: Record<string, (e: Expression, k: number) => Expression> = {
    doubling,
    'sin/cos': sinCos,
    'product of a sum': (e) => F('Multiply', F('Sin', e), F('Add', e, y)),
    'lazy Which arms': (e, k) =>
      F(
        'Add',
        F('Sin', e),
        F(
          'Which',
          F('Less', x, ce.number(k)),
          F('Cos', e),
          ce.symbol('True'),
          F('Exp', e)
        )
      ),
    'lazy If arms': (e, k) =>
      F(
        'If',
        F('Greater', e, ce.number(k)),
        F('Sin', e),
        F('Add', e, F('Cos', e))
      ),
    'power and log': (e) =>
      F('Add', F('Power', e, ce.number(3)), F('Ln', F('Add', e, ce.One))),
  };
  // The GLSL and Python targets are checked on the shapes without lazy
  // operands only. With a lazy operand, the emission of those targets (not
  // the analysis) already chose differently for a DAG and for a tree before
  // the analysis was made linear: it writes a `Which` arm that reads a
  // temporary as an if-statement for the DAG and as a conditional
  // expression for the tree. Both are correct and evaluate the same terms.
  const LAZY = new Set(['lazy Which arms', 'lazy If arms']);
  const targets = [
    ['javascript', {}],
    ['glsl', { to: 'glsl' }],
    ['python', { to: 'python' }],
  ] as const;

  for (const [name, step] of Object.entries(shapes))
    for (const [targetName, options] of targets) {
      if (targetName !== 'javascript' && LAZY.has(name)) continue;
      it(`${name}, ${targetName}`, () => {
        for (const d of [2, 3, 5]) {
          const shared = F('Floor', levels(d, step)[d]);
          const tree = unshare(shared);
          const a = compile(shared, { constantFold: false, ...options });
          const b = compile(tree, { constantFold: false, ...options });
          expect(a.code).toBe(b.code);
        }
      });
    }

  it('counts a shared level once per path, as the unshared tree does', () => {
    const shared = F('Floor', levels(4, sinCos)[4]);
    const summary = (expr: Expression) =>
      harvestCse(expr).candidates.map((c) => [
        c.representative.toString(),
        c.occurrences.reduce((n, o) => n + o.weight, 0),
        c.score,
      ]);
    expect(summary(shared)).toEqual(summary(unshare(shared)));
  });
});
