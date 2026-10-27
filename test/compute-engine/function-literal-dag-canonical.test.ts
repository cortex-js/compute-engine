import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// A function literal whose body is a raw expression built by sharing the
// node of the level below twice at each level (`t₀ = x`,
// `tₖ = Pair(tₖ₋₁, tₖ₋₁)`) has `n + 1` distinct nodes at depth `n`, but
// `2ⁿ` paths from the root to `x`. Two parts of the canonicalization of the
// literal went along every path: the canonical form of a raw node was made
// once for each path that reached it, so the canonical body was a tree of
// `2ⁿ` nodes, and the search for the names that the body assigns
// (`nestedAssignmentNames()`, `library/control-structures.ts`) read each
// path. At depth 24, the canonicalization took about 5 seconds or more.

const ce = new ComputeEngine();

// The raw body of depth `depth`, with one node for each level.
function rawDag(depth: number): Expression {
  let t: Expression = ce.symbol('x');
  for (let i = 0; i < depth; i++)
    t = ce.function('Pair', [t, t], { form: 'raw' });
  return t;
}

// The same body written as MathJSON: a tree, with no shared node.
function jsonTree(depth: number): Parameters<typeof ce.box>[0] {
  let t: Parameters<typeof ce.box>[0] = 'x';
  for (let i = 0; i < depth; i++) t = ['Pair', t, t];
  return t;
}

// The number of distinct nodes reachable from `e`.
function distinctNodes(e: Expression): number {
  const seen = new Set<Expression>();
  const walk = (node: Expression): void => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const op of node.ops ?? []) walk(op);
  };
  walk(e);
  return seen.size;
}

describe('A FUNCTION LITERAL WHOSE RAW BODY SHARES ITS NODES', () => {
  test('the canonical literal is the literal of the same tree', () => {
    const shared = ce.box(['Function', rawDag(6), 'x']);
    const tree = ce.box(['Function', jsonTree(6), 'x']);
    expect(shared.isCanonical).toBe(true);
    expect(shared.json).toEqual(tree.json);
    expect(ce.function('Function', [rawDag(6), ce.symbol('x')]).json).toEqual(
      tree.json
    );
  });

  // A small depth: without the sharing, a large one runs out of memory.
  test('the canonical body keeps the shared nodes', () => {
    const literal = ce.box(['Function', rawDag(12), 'x']);
    // The literal, its parameter, the `Block` of its body and the 13
    // nodes of the body.
    expect(distinctNodes(literal)).toBeLessThan(20);
  });

  test('the time is linear in the number of distinct nodes', () => {
    // Without the sharing, the canonical body of depth 24 has 2^24 nodes
    // and the test process runs out of memory: check the sharing first.
    expect(distinctNodes(ce.box(['Function', rawDag(12), 'x']))).toBeLessThan(
      20
    );
    const body = rawDag(24);
    const start = Date.now();
    const boxed = ce.box(['Function', body, 'x']);
    const built = ce.function('Function', [body, ce.symbol('x')]);
    expect(boxed.operator).toBe('Function');
    expect(built.operator).toBe('Function');
    // Measured at about 2 ms; 5 s or more before the fix.
    expect(Date.now() - start).toBeLessThan(500);
  });
});
