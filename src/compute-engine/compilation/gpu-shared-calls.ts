/**
 * Root inlining of the user-function calls that several shader functions
 * repeat, for the GLSL and WGSL targets.
 *
 * The shader targets emit each user-defined function as a shader function of
 * its own (`_fn_F`), and the common-subexpression pass (`cse.ts`) works inside
 * one body. When two functions each call `F(x, y)` with the same arguments,
 * the shader computes `F(x, y)` once in each. A WebGL driver over ANGLE may
 * merge that work across the functions; the Metal compiler under WebGPU merges
 * identical calls inside one function body only. In the `voronoi-diagram`
 * document of Tycho (ROADMAP CE-525), `B`, `H`, `u`, `v` and `Z` each call
 * `F(x, y)` and the sixteen weight terms again, and WebGPU drew the row 2.17
 * times slower than WebGL.
 *
 * This pass substitutes the body of each pure, non-recursive user function at
 * its call sites in the ROOT expression, transitively, and writes out each
 * `Sum`/`Product` with literal bounds whose body calls a user function as the
 * sum or product of its terms. Calls with the same callee and the same
 * arguments give the same node object, so the result is a DAG in which each
 * distinct call is one node. The common-subexpression pass that runs next
 * binds such a node to one temporary, so it is evaluated once per pixel
 * wherever its value dominates the uses (the dominance rule of `cse.ts`: a
 * binding is never moved out of a branch that is evaluated only conditionally).
 *
 * The pass changes nothing when:
 * - the expression is not pure, or reads a value that is not pure (a symbol
 *   whose value is `Random()`, a function whose body draws): a random draw or
 *   a write must keep its count and its order, and the pass does not reason
 *   about either (`isTransitivelyPure()`);
 * - no call with the same callee and arguments occurs in two different
 *   bodies, so there is nothing that one shader body could share and the
 *   per-body common-subexpression pass does not already share;
 * - the expanded tree is above the size limits below. The expansion checks
 *   them while it runs, and stops as soon as a limit is passed, so that a
 *   chain of nested calls whose expansion grows exponentially costs time
 *   in proportion to the limits only.
 *
 * A call stays a call (by reference, as before) when its substitution is not
 * sound (`BaseCompiler.substitutedUserFunctionBody`: an impure or recursive
 * callee, an argument that is not provably a scalar, a binder that would
 * capture an argument), when the caller overrides its name (`functions`,
 * `vars`, `operators`), or when it is already on the substitution path
 * (mutual recursion). A node whose head the caller overrides (a `Sum` given
 * in `functions`) is left as written, with its operands: the caller's code
 * receives them as they were.
 */

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { CompileTarget } from './types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import { isTransitivelyPure } from '../boxed-expression/transitive-purity.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import { collectBinderNames } from '../boxed-expression/utils.js';
import { BaseCompiler, type EnclosingDefinition } from './base-compiler.js';
import { unrollFits, unrolledTermSize } from './unroll-budget.js';
import { CSE_MIN_SIZE, lazyOperandRegions } from './cse.js';

/**
 * Most distinct expression nodes the expanded root may hold. The emitted
 * shader holds about one copy of each distinct node, because the
 * common-subexpression pass binds a node that several paths reach.
 */
export const GPU_SHARED_CALLS_MAX_NODES = 10_000;

/**
 * Most paths (nodes counted once for each parent that reaches them) the
 * expanded root may hold. This bounds the code written for the nodes that
 * the common-subexpression pass does NOT bind (a node below its size
 * threshold, a node in two branches that are evaluated only conditionally),
 * which are written once per path. The count of a node is kept, so
 * computing it costs one visit of each distinct node, whatever the count.
 *
 * The expansion of the `voronoi-diagram` row as Tycho compiles it holds
 * 498,274 paths and 1,936 distinct nodes, and its shader is smaller than the
 * code by reference (10.8 KB of WGSL against 12.3 KB): most paths go through
 * nodes that the common-subexpression pass binds once. With the earlier
 * limit, 250,000, that row stayed by reference, and WebGPU drew it about 2.1
 * times slower than WebGL (ROADMAP CE-570).
 */
export const GPU_SHARED_CALLS_MAX_PATHS = 1_000_000;

/**
 * Most nodes that the shader may write for the expanded root, for each node
 * that it writes for the code by reference (`SharedCallsPass.sourceSize`).
 * Two estimates of the nodes written for the expanded root must be under
 * it: `SharedCallsPass.writtenSize`, which counts the nodes that are not
 * shared once per parent, and {@link branchWrittenSize}, which counts a
 * shared node once per branch that writes it. For the `voronoi-diagram` row
 * as written in `compile-gpu-shared-calls.test.ts`, the code by reference is
 * 1,161 nodes and `writtenSize` is 1,846 nodes; for the row as Tycho stores
 * it, 2,249 and 3,353 nodes.
 */
export const GPU_SHARED_CALLS_GROWTH_LIMIT = 8;

/** Most user-function bodies the pass substitutes in one expression. */
const MAX_SUBSTITUTIONS = 2_000;

/** Most terms of one `Sum`/`Product` clause the pass writes out. It is the
 * term limit of the shader targets' own unrolling (`GPU_UNROLL_LIMIT`). */
const MAX_UNROLLED_TERMS = 100;

export interface SharedCallsOptions {
  /** Is this name supplied by the caller (`functions`, `operators` or `vars`
   * option)? Such a call is the caller's code and is never substituted. */
  readonly isOverridden: (name: string) => boolean;
}

/**
 * `expr` with the pure user-function calls of the root substituted, as
 * described in the header of this module, or `expr` itself when the pass
 * does not apply. The names of the substituted functions are added to
 * `target.symbolDeps`, since the generated code bakes their definitions.
 */
export function inlineSharedUserFunctionCalls(
  expr: Expression,
  target: CompileTarget<Expression>,
  options: SharedCallsOptions
): Expression {
  if (target.userFunctions === undefined) return expr;
  // `isPure` reads the expression only. A symbol whose value is `Random()`
  // is pure to it, and a substitution that repeats that symbol at each
  // occurrence of a parameter would repeat the draw. `isTransitivelyPure()`
  // also reads the value of each symbol and the body of each function that
  // the expression calls, so every node that the expansion builds (from the
  // root, the bodies and the arguments) is pure when it is true.
  if (!isTransitivelyPure(expr)) return expr;
  const engine = expr.engine as unknown as ComputeEngine;
  const pass = new SharedCallsPass(engine, target, options);
  if (!pass.mentionsUserCall(expr)) return expr;
  let result: Expression;
  try {
    result = pass.expand(expr, NO_NAMES, ROOT_BODY, new Set());
  } catch (e) {
    if (e === OVER_BUDGET) return expr;
    throw e;
  }
  if (result === expr || !pass.sharesACallAcrossBodies()) return expr;
  const limit = GPU_SHARED_CALLS_GROWTH_LIMIT * pass.sourceSize(expr);
  if (pass.writtenSize(result) > limit) return expr;
  if (branchWrittenSize(result, limit) > limit) return expr;
  if (result.isValid !== true) return expr;
  for (const name of pass.substituted) target.symbolDeps?.add(name);
  return result;
}

const NO_NAMES: ReadonlySet<string> = new Set<string>();

/** The body key of the root expression. */
const ROOT_BODY = '';

/** Thrown to abandon an expansion: it exceeds `MAX_SUBSTITUTIONS` or a size
 * limit, it would substitute a call inside a loop (`expandNode`), or it
 * meets a node that is not transitively pure (`checkPure`). */
/**
 * An estimate of the number of nodes that the shader writes for `expr`, an
 * expansion of this pass, that counts a shared node once in each BRANCH that
 * writes it. Returns a number above `limit` as soon as the count passes it.
 *
 * The common-subexpression pass binds a node to a temporary in a region, and
 * an arm that is evaluated only conditionally (`lazyOperandRegions`,
 * `cse.ts`: the arms of an `If`, the operands of a `Which` after the first
 * condition, the value of a `When`, the operands of `And`/`Or` after the
 * first) can read a temporary of a region that encloses
 * it, but not one of a sibling arm. A node that two sibling arms reach, and
 * that no enclosing region reaches, is written once in each arm.
 * `SharedCallsPass.writtenSize` counts it once, so a chain of functions
 * whose two arms both call the function of the level below
 * (`h_k(x) = {x > c_k: 2h_{k-1}(x), 3h_{k-1}(x)}`) passed that check with a
 * shader that doubled at each level: 2.5 MB and 388 s of compilation at
 * depth 14.
 *
 * Each node is given the set of arm instances that reach it: the root, and
 * for each arm of each instance of its parent, one new instance. A node is
 * counted once for each instance of its set. That can count a node that an
 * arm reads from a temporary of an enclosing region, which is the safe
 * direction: whether the arm can read it depends on whether the enclosing
 * occurrence is emitted before the arm (`cse.ts`), and an estimate that
 * ignored that order accepted `atan2(If(c, 2h(x), 3h(x)), h(x))` chains
 * (review of 2026-10-27). The arms are the regions of the
 * common-subexpression pass: for a `Which`, every operand after the first
 * condition, conditions included. The count stops at `limit`, and it is the
 * number of set entries, so the work is bounded by it too.
 */
function branchWrittenSize(expr: Expression, limit: number): number {
  // The distinct nodes, parents before children.
  const order: Expression[] = [];
  const visited = new Set<Expression>();
  const visit = (node: Expression): void => {
    if (visited.has(node)) return;
    visited.add(node);
    if (isFunction(node)) for (const op of node.ops) visit(op);
    order.push(node);
  };
  visit(expr);
  order.reverse();

  // The arm instances: `parent[i]` is the instance that encloses instance i
  // (-1 for the root, instance 0).
  const parent: number[] = [-1];
  const armInstances = new Map<string, number>();
  const armInstance = (enclosing: number, node: number, arm: number) => {
    const key = `${enclosing}:${node}:${arm}`;
    let id = armInstances.get(key);
    if (id === undefined) {
      id = parent.length;
      parent.push(enclosing);
      armInstances.set(key, id);
    }
    return id;
  };
  const index = new Map<Expression, number>();
  order.forEach((node, i) => index.set(node, i));
  const instances = new Map<Expression, Set<number>>([[expr, new Set([0])]]);
  let total = 0;
  for (const node of order) {
    const own = instances.get(node)!;
    total += own.size;
    if (total > limit) return total;
    if (!isFunction(node)) continue;
    const arms = new Set(lazyOperandRegions(node).map((site) => site.index));
    node.ops.forEach((op, i) => {
      let set = instances.get(op);
      if (set === undefined) instances.set(op, (set = new Set()));
      if (arms.has(i))
        for (const id of own) set.add(armInstance(id, index.get(node)!, i));
      else for (const id of own) set.add(id);
    });
  }
  return total;
}

const OVER_BUDGET = Symbol('over budget');

class SharedCallsPass {
  /** The substituted body of each call, by call key (`callKey`). */
  private readonly calls = new Map<string, Expression>();
  /** The bodies (call keys, or `ROOT_BODY`) in which each call key occurs. */
  private readonly bodiesOf = new Map<string, Set<string>>();
  /** The result of each node expanded with no enclosing binder: such a node
   * expands the same way wherever it occurs. `keys` holds the call keys that
   * the expansion recorded in the body of the node (not in a nested body):
   * a node reached again through this memo records them again in the body
   * that reaches it (`sharesACallAcrossBodies`). */
  private readonly nodes = new WeakMap<
    Expression,
    { result: Expression; keys: ReadonlySet<string> }
  >();
  /** For each node being expanded with no enclosing binder, innermost last:
   * its body and the call keys recorded below it in that body. */
  private readonly frames: { body: string; keys: Set<string> }[] = [];
  /** The answers of `mentionsUserCall`, by node. */
  private readonly mentions = new WeakMap<Expression, boolean>();
  /** A small number for each node read by `idOf`: two nodes have the same
   * number when they have the same structure. */
  private readonly ids = new WeakMap<Expression, number>();
  private readonly idOfSpelling = new Map<string, number>();
  /** The number of paths of each node read by `pathCount`. */
  private readonly paths = new WeakMap<Expression, number>();
  /** The number of nodes in `paths`. */
  private distinctNodes = 0;
  /** The nodes that `checkPure` found transitively pure. */
  private readonly pureSeen = new Set<unknown>();
  /** The names of the functions whose body was substituted. */
  readonly substituted = new Set<string>();
  private substitutions = 0;

  constructor(
    private readonly engine: ComputeEngine,
    private readonly target: CompileTarget<Expression>,
    private readonly options: SharedCallsOptions
  ) {}

  /**
   * Is `arg` lowered to a scalar float by this shader target? A free symbol
   * whose type is open (`unknown`) is not a scalar to
   * `BaseCompiler.provablyScalarArg`, but the shader targets read it as a
   * `float`/`f32` input, which is also what an emitted definition would
   * receive. Substituting it for a parameter therefore reads the same value.
   */
  private isShaderScalar(arg: Expression): boolean {
    const type = this.target.loweredSymbolType?.(arg);
    return type === 'f32' || type === 'float';
  }

  /** Does the caller supply the code of the head `name` (`functions`,
   * `vars` or `operators` option)? */
  private isHeadOverridden(name: string): boolean {
    return (
      this.options.isOverridden(name) ||
      this.target.unrollSkipHeads?.has(name) === true ||
      this.target.overridesHead?.(name) === true
    );
  }

  /** Is `name` a user function whose call this pass may substitute? */
  private isUserFunction(name: string): boolean {
    if (this.isHeadOverridden(name)) return false;
    return BaseCompiler.userFunctionLiteral(this.engine, name) !== undefined;
  }

  /**
   * The number of nodes that the shader writes for the code by reference of
   * `root`: `root` and the body of each user function that it reaches,
   * directly or through another body, each written once as a shader
   * function. A `Sum`/`Product` that the shader target unrolls counts once
   * for each term (`unrolledTermSize`).
   */
  sourceSize(root: Expression): number {
    let size = unrolledTermSize(root);
    const seenNames = new Set<string>();
    const seenNodes = new Set<Expression>();
    const stack: Expression[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seenNodes.has(node) || !isFunction(node)) continue;
      seenNodes.add(node);
      stack.push(...node.ops);
      const name = node.operator;
      if (seenNames.has(name) || !this.isUserFunction(name)) continue;
      seenNames.add(name);
      const literal = BaseCompiler.userFunctionLiteral(this.engine, name);
      if (literal === undefined) continue;
      size += unrolledTermSize(literal.ops[0]);
      stack.push(literal.ops[0]);
    }
    return size;
  }

  /**
   * An estimate of the number of nodes that the shader writes for `expr`, an
   * expansion of this pass, after the common-subexpression pass. That pass
   * binds a node of at least `CSE_MIN_SIZE` nodes that two parents reach to
   * a temporary: the node is written once, and each parent reads the
   * temporary, which is one node. Every other node is written once for each
   * parent that reaches it. The estimate does not apply the rule that keeps
   * a binding inside a branch that is evaluated only conditionally, so the
   * code written can be larger: {@link GPU_SHARED_CALLS_MAX_PATHS} bounds
   * that case.
   */
  writtenSize(expr: Expression): number {
    const parents = new Map<Expression, number>();
    const stack: Expression[] = [expr];
    const seen = new Set<Expression>();
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      if (!isFunction(node)) continue;
      for (const op of node.ops) {
        parents.set(op, (parents.get(op) ?? 0) + 1);
        stack.push(op);
      }
    }
    const isBound = (node: Expression): boolean =>
      (parents.get(node) ?? 0) >= 2 && this.pathCount(node) >= CSE_MIN_SIZE;
    const local = new Map<Expression, number>();
    const localSize = (node: Expression): number => {
      const known = local.get(node);
      if (known !== undefined) return known;
      let size = 1;
      if (isFunction(node))
        for (const op of node.ops) size += isBound(op) ? 1 : localSize(op);
      local.set(node, size);
      return size;
    };
    let total = localSize(expr);
    for (const node of seen) if (isBound(node)) total += localSize(node);
    return total;
  }

  /**
   * Count `node` in the size of the expansion: throw `OVER_BUDGET` when it
   * holds more than {@link GPU_SHARED_CALLS_MAX_PATHS} paths, or when the
   * nodes counted so far are more than {@link GPU_SHARED_CALLS_MAX_NODES}.
   * The expansion calls it on each node that it builds, so it stops as soon
   * as a limit is passed. The count of each node is kept, so the cost is one
   * visit of each distinct node.
   */
  private charge(node: Expression): void {
    this.pathCount(node);
  }

  private pathCount(node: Expression): number {
    const known = this.paths.get(node);
    if (known !== undefined) return known;
    let count = 1;
    if (isFunction(node))
      for (const op of node.ops) {
        count += this.pathCount(op);
        if (count > GPU_SHARED_CALLS_MAX_PATHS) throw OVER_BUDGET;
      }
    this.paths.set(node, count);
    this.distinctNodes += 1;
    if (this.distinctNodes > GPU_SHARED_CALLS_MAX_NODES) throw OVER_BUDGET;
    return count;
  }

  /**
   * Throw `OVER_BUDGET` when `node` is not transitively pure. The root is
   * transitively pure (`inlineSharedUserFunctionCalls`), and so is every
   * node built from it, so this check is a second guard. All the checks
   * share one set of the expressions read (`pureSeen`), so each expression
   * is read once in the whole pass. A false answer leaves the failing
   * expression in that set, which is why the whole expansion is abandoned
   * then, instead of keeping the one call by reference.
   */
  private checkPure(node: Expression): void {
    if (!isTransitivelyPure(node, this.pureSeen)) throw OVER_BUDGET;
  }

  /**
   * A small number that identifies the structure of `node`: two nodes with
   * the same number have the same operator and the same operands, to any
   * depth. The number of a node is computed once, from the numbers of its
   * operands, so the cost is one visit of each distinct node, also when the
   * expansion shares nodes (a node reached by several parents).
   */
  private idOf(node: Expression): number {
    const known = this.ids.get(node);
    if (known !== undefined) return known;
    const spelling = isFunction(node)
      ? `${node.operator}(${node.ops.map((op) => this.idOf(op)).join(',')})`
      : JSON.stringify(node.json);
    let id = this.idOfSpelling.get(spelling);
    if (id === undefined) {
      id = this.idOfSpelling.size;
      this.idOfSpelling.set(spelling, id);
    }
    this.ids.set(node, id);
    return id;
  }

  /** The key of the call `h(args)`: two calls with the same key compute the
   * same value. */
  private callKey(h: string, args: ReadonlyArray<Expression>): string {
    return `${h}(${args.map((a) => this.idOf(a)).join(',')})`;
  }

  /** Does `node` hold a call of a user function? */
  mentionsUserCall(node: Expression): boolean {
    if (!isFunction(node)) return false;
    const known = this.mentions.get(node);
    if (known !== undefined) return known;
    const result =
      this.isUserFunction(node.operator) ||
      node.ops.some((op) => this.mentionsUserCall(op));
    this.mentions.set(node, result);
    return result;
  }

  /** Does a call with the same callee and arguments occur in two different
   * bodies (the root, or the body of another call)? */
  sharesACallAcrossBodies(): boolean {
    for (const bodies of this.bodiesOf.values())
      if (bodies.size > 1) return true;
    return false;
  }

  /**
   * `node` expanded: each substitutable call replaced by its expanded body,
   * and each `Sum`/`Product` that `unrolledClause` accepts written out.
   * `bound` holds the names that the enclosing binders of `node` bind, `body`
   * the key of the body that `node` belongs to, and `onPath` the functions
   * whose body is being expanded above `node`.
   */
  expand(
    node: Expression,
    bound: ReadonlySet<string>,
    body: string,
    onPath: Set<string>
  ): Expression {
    if (!isFunction(node)) return node;
    if (!this.mentionsUserCall(node)) return node;
    // A `Function` literal is opaque: rebuilding one re-runs the literal
    // canonicalization, which declares its parameters into a new scope.
    if (node.operator === 'Function') return node;
    // The caller's code for this head receives the operands as written: a
    // `Sum` given in `functions` is not written out, and the calls in its
    // operands stay calls.
    if (this.isHeadOverridden(node.operator)) return node;
    if (bound.size > 0) {
      const result = this.expandNode(node, bound, body, onPath);
      this.charge(result);
      return result;
    }
    const known = this.nodes.get(node);
    if (known !== undefined) {
      // A node reached again through the memo still counts as an occurrence
      // of its calls in `body`, for the test of `sharesACallAcrossBodies`.
      // Only the calls of the node's own body are recorded again: those of a
      // nested body were recorded under that nested body the first time.
      for (const key of known.keys) this.record(key, body);
      return known.result;
    }
    const frame = { body, keys: new Set<string>() };
    this.frames.push(frame);
    let result: Expression;
    try {
      result = this.expandNode(node, bound, body, onPath);
    } finally {
      this.frames.pop();
    }
    this.charge(result);
    this.nodes.set(node, { result, keys: frame.keys });
    const parent = this.frames[this.frames.length - 1];
    if (parent !== undefined && parent.body === body)
      for (const key of frame.keys) parent.keys.add(key);
    return result;
  }

  /** Record that the call of key `key` occurs in the body `body`. */
  private record(key: string, body: string): void {
    let bodies = this.bodiesOf.get(key);
    if (bodies === undefined) {
      bodies = new Set();
      this.bodiesOf.set(key, bodies);
    }
    bodies.add(body);
    const frame = this.frames[this.frames.length - 1];
    if (frame !== undefined && frame.body === body) frame.keys.add(key);
  }

  private expandNode(
    node: Expression & FunctionInterface,
    bound: ReadonlySet<string>,
    body: string,
    onPath: Set<string>
  ): Expression {
    const unrolled = this.unrolledClause(node, bound, body, onPath);
    if (unrolled !== undefined) return unrolled;

    const binds = boundVariableNames(node);
    // A `Sum`/`Product` that calls a user function and is not written out
    // stays a loop. A loop body is a region of its own in the
    // common-subexpression pass, which does not read a binding of the
    // enclosing region there, so a call substituted in the body would be
    // computed again on every iteration: more work than the call by
    // reference. The whole expansion is abandoned instead.
    if (
      (node.operator === 'Sum' || node.operator === 'Product') &&
      binds.length > 0
    )
      throw OVER_BUDGET;
    if (binds.length > 0) {
      // A node that binds names (a comprehension, a loop-form `Sum`, a
      // `Block` with a local) is descended with those names added to
      // `bound`, and rebuilt onto ITS OWN scope (`scopeForRebuild`): a fresh
      // scope would be parented here while a binder nested inside goes on
      // pointing at the original one. When the scope cannot be reused, the
      // node is left as written.
      if (node.localScope === undefined) return node;
      const within = new Set([...bound, ...binds]);
      const ops = node.ops.map((op) => this.expand(op, within, body, onPath));
      if (ops.every((op, i) => op === node.ops[i])) return node;
      const scope = scopeForRebuild(
        node.localScope,
        this.engine,
        node.operator,
        ops
      );
      if (scope === undefined) return node;
      return this.engine.function(node.operator, ops, { scope });
    }

    const args = node.ops.map((op) => this.expand(op, bound, body, onPath));
    const h = node.operator;
    // A call of a name that an enclosing binder binds is a call of that
    // binding, which no engine definition describes.
    if (this.isUserFunction(h) && !bound.has(h) && !onPath.has(h)) {
      const key = this.callKey(h, args);
      this.record(key, body);
      // A memo entry is valid only where the arguments name no bound
      // variable: the same spelling under another binder is another value.
      const cacheable = bound.size === 0;
      const known = cacheable ? this.calls.get(key) : undefined;
      if (known !== undefined) return known;
      // The substitution writes an argument at each occurrence of its
      // parameter, so an argument with an effect would run it once for each
      // occurrence.
      for (const a of args) this.checkPure(a);
      const substituted = BaseCompiler.substitutedUserFunctionBody(
        this.engine,
        h,
        args,
        this.target,
        bound.size > 0 ? enclosingFor(bound) : undefined,
        (a) => this.isShaderScalar(a)
      );
      if (substituted !== undefined) {
        this.substitutions += 1;
        if (this.substitutions > MAX_SUBSTITUTIONS) throw OVER_BUDGET;
        onPath.add(h);
        let expanded: Expression;
        try {
          expanded = this.expand(substituted, bound, key, onPath);
        } finally {
          onPath.delete(h);
        }
        this.substituted.add(h);
        if (cacheable) this.calls.set(key, expanded);
        return expanded;
      }
    }
    if (args.every((op, i) => op === node.ops[i])) return node;
    if (h === 'Which') {
      const chain = this.nestedWhich(args);
      if (chain !== undefined) return chain;
    }
    return this.engine.function(h, args);
  }

  /**
   * `Which(c1, v1, c2, v2, …, True, vn)` written as the equivalent chain
   * `Which(c1, v1, True, Which(c2, v2, …, True, vn))`, or `undefined` when
   * `ops` is not such a list of clauses.
   *
   * The two forms compute the same value: each condition is evaluated only
   * when every condition before it is false, and the last clause, whose
   * condition is `True`, is taken when none of the others is. They differ in
   * the regions of the common-subexpression pass (`LAZY_OPERANDS` in
   * `cse.ts`). In the flat form, every operand after `c1` is a region of its
   * own, beside the others, so a call that `c2` and `vn` both make is
   * evaluated in each: a region binds a temporary only for its own
   * occurrences. In the chain, `c2` is the first operand of the inner
   * `Which`, evaluated whenever that `Which` is, and the arms after it are
   * regions INSIDE that `Which`'s region, so a binding made for `c2` is read
   * by `vn` (the dominance rule of `cse.ts`). The shader targets emit both
   * forms as the same nested `if`/`else`.
   */
  private nestedWhich(ops: ReadonlyArray<Expression>): Expression | undefined {
    if (ops.length < 6 || ops.length % 2 !== 0) return undefined;
    const last = ops[ops.length - 2];
    if (!isSymbol(last) || last.symbol !== 'True') return undefined;
    let chain = this.engine.function('Which', ops.slice(ops.length - 4), {
      form: 'structural',
    });
    for (let i = ops.length - 6; i >= 0; i -= 2)
      chain = this.engine.function(
        'Which',
        [ops[i], ops[i + 1], this.engine.True, chain],
        { form: 'structural' }
      );
    return chain;
  }

  /**
   * A `Sum`/`Product` of one `Limits` clause with integer literal bounds,
   * whose body is pure, real and calls a user function, written out as the
   * `Add`/`Multiply` of its expanded terms, in the order of the index. The
   * shader targets unroll such a clause anyway (`compileGPUSumProduct`), to
   * the same left-to-right sum or product; writing it out here is what makes
   * a call of term `k` the same node as the same call in another body.
   * `undefined` for any other node.
   */
  private unrolledClause(
    node: Expression & FunctionInterface,
    bound: ReadonlySet<string>,
    body: string,
    onPath: Set<string>
  ): Expression | undefined {
    const kind = node.operator;
    if (kind !== 'Sum' && kind !== 'Product') return undefined;
    if (node.nops !== 2) return undefined;
    const [termBody, clause] = node.ops;
    if (!isFunction(clause, 'Limits') || clause.nops !== 3) return undefined;
    const [index, lower, upper] = clause.ops;
    if (!this.mentionsUserCall(termBody)) return undefined;
    if (!isSymbol(index)) return undefined;
    const name = index.symbol;
    if (!isNumber(lower) || !isNumber(upper)) return undefined;
    const lo = lower.re;
    const hi = upper.re;
    // A safe integer, so that `k += 1` below reaches `hi`: above 2^53, two
    // consecutive integers can have the same double, and `k` would never
    // pass `hi`.
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo)
      return undefined;
    const count = hi - lo + 1;
    if (
      count > MAX_UNROLLED_TERMS ||
      !unrollFits(count, unrolledTermSize(termBody), MAX_UNROLLED_TERMS)
    )
      return undefined;
    if (termBody.isPure !== true) return undefined;
    this.checkPure(termBody);
    // The written-out terms are combined with the real `+`/`*`. A body that
    // the shader targets accumulate as a complex `vec2` is left to them.
    if (BaseCompiler.isComplexValuedUnderIndices(termBody, [name]))
      return undefined;
    // `subs` is not capture-avoiding: a binder inside the body that binds
    // the index again would have its own occurrences replaced.
    const binders = collectBinderNames(termBody);
    if (binders.has(name)) return undefined;
    const terms: Expression[] = [];
    for (let k = lo; k <= hi; k++) {
      const term = termBody.subs({ [name]: this.engine.number(k) });
      terms.push(this.expand(term, bound, body, onPath));
    }
    if (terms.length === 1) return terms[0];
    // STRUCTURAL, so the terms stay in the order of the index, as the
    // shader targets' own unrolling writes them.
    return this.engine.function(kind === 'Sum' ? 'Add' : 'Multiply', terms, {
      form: 'structural',
    });
  }
}

function enclosingFor(bound: ReadonlySet<string>): EnclosingDefinition {
  return { scalarNames: NO_NAMES, localNames: bound };
}
