/**
 * A size limit for the code that the GLSL and WGSL targets write for one
 * expression.
 *
 * An expression is a graph: one node can have several parents. The emitter
 * writes a node once for each path from the root to it, unless the
 * common-subexpression pass (`cse.ts`) binds the node to a temporary. Then
 * the node is written once and each path reads the temporary. When the pass
 * cannot bind the nodes of a deep graph, the code grows exponentially with
 * the depth: `e_{k+1} = e_k + sin(e_k)` over 20 levels, with each `e_k`
 * reading a `vars` source that the pass must not share, gave 24 MB of WGSL
 * in 25 seconds (ROADMAP CE-584). The shader targets refuse such an
 * expression before they write it.
 */

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import { lazyOperandRegions, operandEmissionOrder } from './cse.js';

/**
 * Most nodes that the shader targets write for the root expression, as
 * {@link gpuWrittenSize} estimates them. In the Tycho code-generation audit
 * (2,040 GPU compilations) and in the shader tests of this repository, the
 * largest estimate of a compilation that succeeds is about 3,400 nodes.
 */
export const GPU_MAX_WRITTEN_NODES = 50_000;

/**
 * An estimate of the number of nodes that the shader targets write for
 * `expr`: the larger of two estimates, each of which is smaller than the
 * code in the cases where the other one is exact.
 *
 * Two nodes with the same operator and the same operands, to any depth,
 * count as one node, as the common-subexpression pass compares them by
 * structure, not by object. The canonical form of a function literal can
 * hold a tree where its source held a graph: the body of `h(t) := e_16`
 * holds 262,146 node objects for 35 distinct structures.
 *
 * `rules` are the rules of the common-subexpression pass
 * (`cseRecordingRules()`, `cse.ts`, built with the options of the pass):
 * which nodes it can bind, and which operators are emitted by caller
 * source (below them it records nothing, and their operands are written
 * as the caller's code decides). `rules.share` is `false` when no pass
 * runs on the code: then no node is shared, and `isCallerMapped` is still
 * read. With no `rules`, no node is shared and no operator is caller
 * source.
 *
 * The first estimate follows the order in which the code is written
 * (`operandEmissionOrder()`, `cse.ts`: the condition of a `When` before
 * its value, the other operands in their order). It
 * counts a node once in each conditionally evaluated arm (an `If` branch,
 * a lazy operand: `lazyOperandRegions()`, `cse.ts`) that reaches it, unless
 * the node was already written before the arm, in the code around the arm:
 * the pass binds a node at its first unconditional occurrence, and an arm
 * after it reads the temporary (the dominance rule of `cse.ts`). A node
 * that only two sibling arms reach is written in each arm, so a chain of
 * `If` whose two branches read the level below doubles the code at each
 * level: 2 MB in 62 seconds at depth 14. In
 * `e_{k+1} = Arctan2(e_k, If(x > k, e_k, 0))`, the first operand writes
 * `e_k`, and the arm reads it. The count stops when it passes `limit`, so
 * its cost is bounded by `limit` and the number of distinct nodes, and the
 * result is then a number just above `limit`.
 *
 * The second estimate counts the nodes that the pass cannot bind once for
 * each path. Its cost is one visit of each distinct node. It binds a node
 * to a temporary when two or more paths from the root reach it that do not
 * go through an operator emitted by caller source (`isCallerMapped`), and
 * `mayRecord` accepts it. `mayRecord` refuses a node that is not pure, or
 * that holds, at any depth, a `vars` source that may have an effect or an
 * operator that the caller replaces (the `functions` option) or compiles
 * with its own handler. A bound node counts its own nodes once, and each of
 * its parents counts it as one node (the read of the temporary), except an
 * operator emitted by caller source: the caller's code receives its
 * operands as text, so everything below it counts once for each path.
 * Every other node counts its own nodes once for each parent that writes
 * it.
 *
 * Both estimates bind more nodes than the pass does, so the result can be
 * smaller than the code, never much larger. They ignore:
 * - the size and benefit thresholds of the pass (`CSE_MIN_SIZE`,
 *   `CSE_MIN_SCORE`): a node of fewer than 4 nodes, or of 4 to 7 nodes that
 *   two paths reach, is written once per path by the pass, so the code for
 *   such a node can be up to 3 times the estimate;
 * - the scopes: two equal nodes under different binders (two `Sum` with the
 *   same index name) count as one, and an assignment between two
 *   occurrences does not stop the binding;
 * - the cap on the bindings of one region (`CSE_MAX_BINDINGS_PER_REGION`);
 * - the bodies of the user-defined functions that the code calls, which are
 *   written as shader functions of their own and checked one by one
 *   (`CompileTarget.checkDefinitionBody`).
 *
 * The estimate is a heuristic model of the emitter, not a copy of it. It
 * covers the cases that were measured: shared graphs, conditional arms,
 * binder bodies, operators emitted by caller source, and bodies written
 * at each call site. A rare graph shape can still pass it and give large
 * code. Then the compilation is slow, but its result is never wrong: the
 * limit only refuses code, it does not change the code that is written.
 */
export function gpuWrittenSize(
  expr: Expression,
  rules:
    | {
        mayRecord: (node: Expression) => boolean;
        isCallerMapped: (node: Expression) => boolean;
        share?: boolean;
      }
    | undefined,
  limit: number = GPU_MAX_WRITTEN_NODES
): number {
  // A number for each distinct structure, given to each node object after
  // its operands (post-order). `nodes[id]` is the first node object with
  // that structure, `operands[id]` the numbers of its operands, and the
  // numbers are in post-order: the operands of a node have smaller numbers.
  const idOfNode = new Map<Expression, number>();
  const idOfKey = new Map<string, number>();
  const nodes: Expression[] = [];
  // The operands that the emitter writes (`writtenOperands`), as numbers.
  const operands: number[][] = [];
  // The nodes whose written operands are not all their operands.
  const reduced = new Set<number>();
  const stack: Array<[Expression, number, readonly Expression[]]> = [
    [expr, 0, writtenOperands(expr, rules?.isCallerMapped)],
  ];
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const [node, next, kept] = top;
    if (next < kept.length) {
      top[1] = next + 1;
      const op = kept[next];
      if (!idOfNode.has(op))
        stack.push([op, 0, writtenOperands(op, rules?.isCallerMapped)]);
      continue;
    }
    stack.pop();
    if (idOfNode.has(node)) continue;
    const ops = kept.map((op) => idOfNode.get(op)!);
    const isReduced = isFunction(node) && kept.length !== node.nops;
    const key = isFunction(node)
      ? `${isReduced ? `R${node.nops}` : ''}${node.operator}(${ops.join(',')})`
      : isSymbol(node)
        ? `S${node.symbol}`
        : `L${JSON.stringify(node.json)}`;
    let id = idOfKey.get(key);
    if (id === undefined) {
      id = nodes.length;
      idOfKey.set(key, id);
      nodes.push(node);
      operands.push(ops);
      if (isReduced) reduced.add(id);
    }
    idOfNode.set(node, id);
  }
  const root = idOfNode.get(expr)!;
  const n = nodes.length;

  // The first estimate: a walk in the order of the code. Each region that
  // the walk enters (a lazy arm, the body or a clause of a binder:
  // `regionOf`) is a new instance, inside the instance of its parent. A
  // node counts once in an instance, and not at all when an enclosing
  // instance wrote it before (`isWritten`). In an inert region the pass
  // records nothing, so a node counts each time the walk reaches it.
  const regions = new Map<number, Array<Region | undefined>>();
  const regionsOf = (id: number): Array<Region | undefined> => {
    let result = regions.get(id);
    if (result === undefined) {
      const node = nodes[id];
      result =
        isFunction(node) && !reduced.has(id)
          ? operandRegions(node)
          : new Array(operands[id].length).fill(undefined);
      regions.set(id, result);
    }
    return result;
  };
  const orders = new Map<number, number[]>();
  const orderOf = (id: number): number[] => {
    let result = orders.get(id);
    if (result === undefined) {
      const node = nodes[id];
      result =
        isFunction(node) && !reduced.has(id)
          ? operandEmissionOrder(node)
          : operands[id].map((_, i) => i);
      orders.set(id, result);
    }
    return result;
  };
  // The symbol names in each node, computed when a binder region is
  // crossed.
  const symbols = new Map<number, Set<string>>();
  const symbolsOf = (id: number): Set<string> => {
    let result = symbols.get(id);
    if (result === undefined) {
      result = new Set<string>();
      const node = nodes[id];
      if (isSymbol(node)) result.add(node.symbol);
      for (const op of operands[id])
        for (const name of symbolsOf(op)) result.add(name);
      symbols.set(id, result);
    }
    return result;
  };
  const written: Array<Set<number>> = [new Set()];
  const enclosingOf: number[] = [-1];
  const regionOfInstance: Array<Region | undefined> = [undefined];
  const isWritten = (id: number, instance: number): boolean => {
    for (let i = instance; i >= 0; i = enclosingOf[i]) {
      if (written[i].has(id)) return true;
      // A node of an enclosing instance is read here only through its
      // temporary, which the pass does not offer across a region whose
      // bound names are unknown, or that binds a name the node mentions.
      const region = regionOfInstance[i];
      if (region === undefined) continue;
      if (region.opaque) return false;
      if (region.boundNames.length > 0) {
        const names = symbolsOf(id);
        if (region.boundNames.some((name) => names.has(name))) return false;
      }
    }
    return false;
  };
  const isInert = (instance: number): boolean => {
    for (let i = instance; i >= 0; i = enclosingOf[i])
      if (regionOfInstance[i]?.inert === true) return true;
    return false;
  };
  let branches = 0;
  // Each entry: a node, its instance, and the position of the next operand
  // in the emission order.
  const walk: Array<[number, number, number]> = [[root, 0, 0]];
  written[0].add(root);
  branches = 1;
  while (walk.length > 0) {
    const top = walk[walk.length - 1];
    const [id, instance, position] = top;
    const order = orderOf(id);
    if (position >= order.length) {
      walk.pop();
      continue;
    }
    top[2] = position + 1;
    const index = order[position];
    const op = operands[id][index];
    let opInstance = instance;
    const region = regionsOf(id)[index];
    if (region !== undefined) {
      opInstance = written.length;
      written.push(new Set());
      enclosingOf.push(instance);
      regionOfInstance.push(region);
    }
    // Each operand costs at least one node: the read of a temporary, or of
    // a variable, when the node was written before.
    branches += 1;
    if (branches > limit) return branches;
    if (!isInert(opInstance)) {
      if (isWritten(op, opInstance)) continue;
      written[opInstance].add(op);
    }
    walk.push([op, opInstance, 0]);
  }

  // Is the node emitted by caller source? Nothing below it is shared.
  const mapped = new Array<boolean>(n);
  for (let id = 0; id < n; id++)
    mapped[id] = rules !== undefined && rules.isCallerMapped(nodes[id]);

  // The number of paths from the root to each node that do not go through
  // an operator emitted by caller source. A parent has a larger number than
  // its operands. Only "one" or "two or more" matters, so the count stops
  // at 2.
  const paths = new Array<number>(n).fill(0);
  paths[root] = 1;
  for (let id = n - 1; id >= 0; id--) {
    if (mapped[id]) continue;
    for (const op of operands[id])
      paths[op] = Math.min(2, paths[op] + paths[id]);
  }

  const bound = new Array<boolean>(n);
  for (let id = 0; id < n; id++)
    bound[id] =
      rules !== undefined &&
      rules.share !== false &&
      id !== root &&
      paths[id] >= 2 &&
      rules.mayRecord(nodes[id]);

  // The nodes written for one copy of the node: its own node, one node for
  // each bound operand, and the nodes written for each other operand. Below
  // an operator emitted by caller source, each operand is written in full
  // (`tree`, the number of nodes of the tree that the node unfolds to).
  const tree = new Array<number>(n);
  const local = new Array<number>(n);
  let total = 0;
  for (let id = 0; id < n; id++) {
    let treeSize = 1;
    for (const op of operands[id]) treeSize += tree[op];
    tree[id] = treeSize;
    let size = 1;
    if (mapped[id]) size = treeSize;
    else for (const op of operands[id]) size += bound[op] ? 1 : local[op];
    local[id] = size;
    if (bound[id]) total += size;
  }
  return Math.max(branches, total + local[root]);
}

/** A region that the common-subexpression pass opens on an operand: the
 * body or a clause of a binder, or a lazy operand (`Harvester.operandPlans`,
 * `cse.ts`). */
type Region = {
  /** The pass records nothing in the region. */
  readonly inert: boolean;
  /** The names that the region binds are not known: no temporary of an
   * enclosing region is read in it. */
  readonly opaque: boolean;
  /** The names that the region binds. A temporary of an enclosing region
   * whose node mentions one of them is not read in it. */
  readonly boundNames: readonly string[];
};

/**
 * The region of each operand of `node`, or `undefined` for an operand that
 * is in the region of `node`. These are the regions of
 * `Harvester.operandPlans` (`cse.ts`): an operator with a scope (`Sum`,
 * `Product`, a comprehension) opens a region for its body, where its bound
 * names are new, and an inert region for its clauses (all its operands
 * when its binding sites are not known); `lazyOperandRegions()` gives the
 * lazy operands.
 *
 * The body of a binder does not read a temporary of an enclosing region:
 * in `e_{k+1} = e_k + Sum(j·e_k, j, 1, N)` the loop of the inner `Sum` is
 * written again inside the body of the outer one, and the code doubles at
 * each level (43,641 characters of WGSL at depth 8). Two sibling binder
 * bodies do not share a node either (ROADMAP CE-458). The body region is
 * therefore `opaque`.
 */
function operandRegions(
  node: Expression & { ops: ReadonlyArray<Expression>; nops: number }
): Array<Region | undefined> {
  const result: Array<Region | undefined> = new Array(node.nops).fill(
    undefined
  );
  // The heads that the harvest walks in its own way (`walkOperands`,
  // `cse.ts`). Each statement of a `Block` is a region of its own, and
  // two statements share no node. The body of a `Function` literal and of
  // a `Loop` is a region of its own; the parameters and the clauses are
  // inert.
  const op = node.operator;
  if (op === 'Block') {
    const boundNames = boundVariableNames(node);
    for (let i = 0; i < node.nops; i++)
      result[i] = { inert: false, opaque: false, boundNames };
    return result;
  }
  if (op === 'Function' || op === 'Loop') {
    const boundNames = boundVariableNames(node);
    for (let i = 0; i < node.nops; i++)
      result[i] =
        i === 0
          ? { inert: false, opaque: true, boundNames }
          : { inert: true, opaque: false, boundNames };
    return result;
  }
  const def = node.operatorDefinition;
  if (def?.scoped === true) {
    let firstClause = Number.POSITIVE_INFINITY;
    try {
      for (const site of def.bindingSites?.(node.ops, 'post') ?? [])
        if (site.path.length > 0)
          firstClause = Math.min(firstClause, site.path[0]);
    } catch {
      firstClause = Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(firstClause)) firstClause = 0;
    const boundNames = boundVariableNames(node);
    for (let i = 0; i < node.nops; i++)
      result[i] =
        i < firstClause
          ? { inert: false, opaque: true, boundNames }
          : { inert: true, opaque: firstClause === 0, boundNames };
  }
  for (const site of lazyOperandRegions(node)) {
    const current = result[site.index];
    result[site.index] = {
      inert: site.inert || (current?.inert ?? false),
      opaque: current?.opaque ?? false,
      boundNames: current?.boundNames ?? [],
    };
  }
  return result;
}

/**
 * The operands of `node` that the shader targets write. `When(value,
 * True)` writes its value only, and `When(value, False)` writes a NaN
 * constant (the `When` handler of `GPU_FUNCTIONS`, `gpu-target.ts`). A
 * `When` that the caller replaces or compiles with its own handler
 * (`isCallerMapped`) receives all its operands.
 */
function writtenOperands(
  node: Expression,
  isCallerMapped: ((node: Expression) => boolean) | undefined
): readonly Expression[] {
  if (!isFunction(node)) return [];
  if (
    node.operator === 'When' &&
    node.nops === 2 &&
    isCallerMapped?.(node) !== true
  ) {
    if (isSymbol(node.ops[1], 'True')) return [node.ops[0]];
    if (isSymbol(node.ops[1], 'False')) return [];
  }
  return node.ops;
}
