import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { callsReach } from '../../src/compute-engine/boxed-expression/declared-parameter-result';
import { appliedLiteralResultType } from '../../src/compute-engine/boxed-expression/call-result-type';
import { describe, describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { harvestCse } from '../../src/compute-engine/compilation/cse';
import { isScalarValue } from '../../src/compute-engine/compilation/javascript-value-facts';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** Count operand-array reads, including repeated visits, without timing or a
 * production diagnostic. Stop a regressed walk before it unfolds a large tree.
 * `fields` names the accessors that are counted: the public `ops` getter, and
 * also the private `_ops` getter of `BoxedFunction` for a walk inside the
 * class (`subs()` reads `this._ops`). Each counting getter returns the array
 * that it captured, so a read through `ops` is not counted again as a read of
 * `_ops`. */
function countReads(
  nodes: Expression[],
  run: () => void,
  budget: number,
  fields: readonly ('ops' | '_ops')[] = ['ops']
): number {
  let reads = 0;
  for (const node of nodes) {
    const ops = node.ops;
    for (const field of fields)
      Object.defineProperty(node, field, {
        configurable: true,
        get: () => {
          if (++reads > budget) throw new Error('shared traversal work budget');
          return ops;
        },
      });
  }
  try {
    run();
    return reads;
  } finally {
    for (const node of nodes)
      for (const field of fields)
        delete (node as { ops?: unknown; _ops?: unknown })[field];
  }
}

function graph(ce: ComputeEngine, depth: number, fanout = 2, leaf = ce.symbol('x')) {
  const nodes: Expression[] = [];
  let root = leaf;
  for (let i = 0; i < depth; i++) {
    root = ce._fn('Add', Array.from({ length: fanout }, () => root));
    nodes.push(root);
  }
  return { root, nodes };
}

for (const depth of [4, 8, 16, 24]) {
  test(`substitution reads each shared function's operands once at depth ${depth}`, () => {
    const ce = new ComputeEngine();
    const { root, nodes } = graph(ce, depth);
    let result: Expression;
    expect(countReads(nodes, () => {
      result = root.subs({ x: 3 }, { canonical: false });
    }, depth, ['ops', '_ops'])).toBe(depth);
    for (let i = 0; i < depth; i++) {
      expect(result!.ops![0]).toBe(result!.ops![1]);
      result = result!.ops![0];
    }
    expect(result!.re).toBe(3);
  });

  test(`callee reachability makes two distinct-node passes at depth ${depth}`, () => {
    const ce = new ComputeEngine();
    const { root, nodes } = graph(ce, depth);
    expect(countReads(nodes, () => {
      expect(callsReach(root, 'absentCallee')).toBe(false);
    }, 2 * depth)).toBe(2 * depth);
  });

  test(`scalar proof has a linear operand-read budget at depth ${depth}`, () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const { root, nodes } = graph(ce, depth);
    const target = new JavaScriptTarget().createTarget({
      cse: { enabled: false, instances: [], harvestOptions: {} },
    });
    expect(countReads(nodes, () => {
      expect(isScalarValue(root, target)).toBe(true);
    }, 3 * depth)).toBeLessThanOrEqual(3 * depth);
  });

  test(`CSE harvest bounds actual operand reads at depth ${depth}`, () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const { root, nodes } = graph(ce, depth);
    countReads(nodes, () => {
      const result = harvestCse(root);
      expect(result.diagnostics.edges).toBe(2 ** (depth + 1) - 1);
    }, 30 * depth);
  });

  test(`compilation bounds operand reads with symbolic inputs at depth ${depth}`, () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const { root, nodes } = graph(ce, depth);
    countReads(nodes, () => {
      const result = compile(root);
      expect(result.success).toBe(true);
      expect(result.run!({ x: 0.25 })).toBe(2 ** depth * 0.25);
      expect(result.code.length).toBeLessThan(60 * depth);
    }, 150 * depth);
  });


}

for (const fanout of [2, 4]) {
  test(`a declined callback body is read once per shared parent, fanout ${fanout}`, () => {
    const ce = new ComputeEngine();
    const x = ce.symbol('x');
    const call = ce._fn('h', [x]);
    const { root, nodes } = graph(ce, 12, fanout, call);
    const literal = ce._fn('Function', [root, ce.symbol('h'), x]);
    const fn = {
      ...describe(literal),
      type: {
        kind: 'signature' as const,
        args: [{ name: 'h', type: 'function' as const }, { name: 'x', type: 'real' as const }],
        result: 'any' as const,
      },
    };
    // A callback parameter has no body for this derivation to inspect. Its
    // enclosing arithmetic must retain the decline, including on memo hits.
    const derive = jest.fn(() => 'real' as const);
    countReads(nodes, () => {
      expect(appliedLiteralResultType(fn, [describeType('function'), describeType('real')], 'any', derive)).toBeUndefined();
    }, 8 * nodes.length);
    expect(derive).not.toHaveBeenCalled();
  });
}
