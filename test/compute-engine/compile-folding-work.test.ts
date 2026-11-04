import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import {
  CONSTANT_FOLD_MAX_VISITS,
  calleeBodyCost,
} from '../../src/compute-engine/compilation/compile-folding';

function graph(ce: ComputeEngine, depth: number) {
  let root = ce.function('Add', [ce.number(2), ce.function('Sqrt', [ce.number(3)])]);
  const nodes = [root];
  for (let i = 0; i < depth; i++) {
    root = ce._fn('Add', [root, root]);
    nodes.push(root);
  }
  return { root, nodes };
}

function countReads(nodes: Expression[], budget: number, run: () => void) {
  let reads = 0;
  for (const node of nodes) {
    const ops = node.ops;
    Object.defineProperty(node, 'ops', { configurable: true, get() {
      if (++reads > budget) throw Error('fold analysis operand-read budget');
      return ops;
    }});
  }
  try { run(); return reads; }
  finally { for (const node of nodes) delete (node as { ops?: unknown }).ops; }
}

test('fold estimation admits the closed depth-12 graph at its unfolded cost', () => {
  const ce = new ComputeEngine({ precision: 'machine' });
  const { root } = graph(ce, 12);
  expect(BaseCompiler.foldCostEstimate(root)).toBe(2 ** 14 - 1);
});

test('fold estimation stops at its visit limit on a larger closed graph', () => {
  const ce = new ComputeEngine({ precision: 'machine' });
  const { root, nodes } = graph(ce, 16);
  // The estimator and collection-size query each read at most one array
  // per charged visit on this fixture. This bounds one estimate, not a compile.
  expect(countReads(nodes, 2 * CONSTANT_FOLD_MAX_VISITS, () => {
    expect(BaseCompiler.foldCostEstimate(root)).toBe(Infinity);
  })).toBeLessThanOrEqual(2 * CONSTANT_FOLD_MAX_VISITS);
});


test('one estimate resolves a repeated built-in callee only once', () => {
  const ce = new ComputeEngine({ precision: 'machine' });
  const { root } = graph(ce, 8);
  const lookup = jest.spyOn(ce, 'lookupDefinition');
  try {
    expect(BaseCompiler.foldCostEstimate(root)).toBe(2 ** 10 - 1);
    expect(lookup.mock.calls.filter(([name]) => name === 'Add')).toHaveLength(1);
  } finally {
    lookup.mockRestore();
  }
});

test('a negative callee answer does not survive a definition change', () => {
  const ce = new ComputeEngine();
  const context = { cache: new Map<string, number>(), inProgress: new Set<string>(), visits: 0 };
  expect(calleeBodyCost(ce, 'foldProbe', 0, context)).toBe(0);
  ce.assign('foldProbe', ['Function', ['Add', 't', 1], 't']);
  expect(calleeBodyCost(ce, 'foldProbe', 0, context)).toBeGreaterThan(0);
});
