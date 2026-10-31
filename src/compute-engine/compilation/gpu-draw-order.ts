// Draw ordering: which operands draw, and the check that binding an operand
// keeps the draw order.

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { gpuOperandShape } from './gpu-shapes.js';
import { gpuEvaluatedUnit, gpuVec2 } from './gpu-emit.js';

/**
 * Compile an operand the caller will splice MORE THAN ONCE into its emitted
 * source. A pure operand compiles directly (byte-identical to `compile(x)`
 * for the common case); an IMPURE one (the Random family — `_gpu_rnd_draw`
 * advances a runtime counter, so a repeated splice re-draws and shifts every
 * later value in the shader) is bound to a hoisted temporary, or the head
 * declines where no statement sink is available. `complex` selects a
 * `vec2`/`vec2f` temporary (a complex operand has no scalar shape, so the
 * scalar-shape gate is skipped there — `canHoist` is the applicable gate).
 */
export function gpuOperandOnce(
  head: string,
  x: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>,
  complex = false
): string {
  // Read through the value of a symbol, as the shader inlines it: a symbol
  // whose value draws (`r := Random()`) is pure to the engine.
  if (!BaseCompiler.foldValueImpure(x)) return compile(x);
  if (
    !BaseCompiler.canHoist(target) ||
    (!complex && gpuOperandShape(x) !== 'scalar')
  )
    throw new Error(
      `Could not compile \`${head}\`: an impure (Random) operand cannot be bound to a temporary ` +
        'at this position — a repeated draw would shift every later value ' +
        'in the shader.'
    );
  gpuAssertBindingKeepsDrawOrder(head, [x], target);
  const t = BaseCompiler.tempVar(target);
  const type = complex
    ? gpuVec2(target)
    : target.language === 'wgsl'
      ? 'f32'
      : 'float';
  const decl =
    target.language === 'wgsl' ? `var ${t}: ${type}` : `${type} ${t}`;
  BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
  gpuRecordBoundDraws([x], target);
  return t;
}

/**
 * The state of the compilation of a statement with every draw bound to a
 * temporary of its own (`gpuRecompileWithBoundDraws`), `undefined` outside
 * one. `inline`: a draw stayed in its expression (a conditional arm).
 * `reordered`: a draw was compiled after such a draw, so it may run before
 * it, or
 * a draw was compiled before a draw that comes earlier in the order of the
 * interpreter (`gpuDrawComesAfter`). `last`: the nodes that were being
 * compiled when the last draw was bound (`BaseCompiler.compileParents`).
 */
export let gpuBindEveryDraw:
  | {
      inline: boolean;
      reordered: boolean;
      last?: ReadonlyArray<Expression>;
    }
  | undefined;

/**
 * Does a draw compiled while the nodes `next` are being compiled come after
 * a draw compiled while the nodes `previous` were, in the order of the
 * interpreter (the operands of a node from first to last, depth first, the
 * draw of a node after its operands)? Each list starts at the root of the
 * statement and ends with the node that draws. A lowering can compile its
 * operands in another order than they are written (`Root` compiles its
 * degree first), so the order of compilation is checked, not assumed.
 *
 * Under the deepest node that both lists share, the operand that leads to
 * `next` must come after the one that leads to `previous`. When `next` is
 * that node, its draw comes after the draws of its operands; when it is the
 * same node as `previous`, the node is compiled again (a term of an
 * unrolled `Sum`) or draws twice. When `previous` is that node, it drew
 * before one of its operands: no. A node that is not an operand of the
 * node above it (built by a lowering) has no position to compare: no. A
 * symbol stands for its value, which the shader inlines. A node at several
 * operand positions takes the earliest for `previous` and the latest for
 * `next`.
 */
export function gpuDrawComesAfter(
  previous: ReadonlyArray<Expression>,
  next: ReadonlyArray<Expression>
): boolean {
  let k = 0;
  while (k < previous.length && k < next.length && previous[k] === next[k])
    k += 1;
  if (k === next.length) return true;
  if (k === previous.length || k === 0) return false;
  const parent = previous[k - 1];
  if (!isFunction(parent)) return false;
  const holds = (op: Expression, node: Expression): boolean =>
    op === node ||
    (isSymbol(op) && op.engine._getSymbolValue(op.symbol) === node);
  const ops = parent.ops;
  const from = ops.findIndex((op) => holds(op, previous[k]));
  let to = -1;
  for (let i = ops.length - 1; i >= 0 && to < 0; i--)
    if (holds(ops[i], next[k])) to = i;
  return from >= 0 && to >= 0 && from < to;
}

/** The marker of a decline that compiling the statement with every draw
 * bound in order can lift (`gpuRecompileWithBoundDraws`). */
const GPU_DRAW_ORDER = Symbol('gpuDrawOrder');

export function gpuDrawOrderError(message: string): Error {
  const error = new Error(message);
  (error as unknown as Record<symbol, boolean>)[GPU_DRAW_ORDER] = true;
  return error;
}

/**
 * Does evaluating `unit` call a function whose body may draw? A node that
 * draws by itself (`gpuNodeDrawsItself`) and is not an operator of the
 * Random family: a call of a user function or of a function-valued
 * symbol. The value of a symbol is read as the shader inlines it. A node
 * reached by several parents is visited once.
 */
function gpuCallsAFunctionThatDraws(unit: Expression): boolean {
  const seen = new Set<Expression>();
  const walk = (x: Expression): boolean => {
    if (seen.has(x)) return false;
    seen.add(x);
    if (isSymbol(x)) {
      if (!BaseCompiler.foldValueImpure(x)) return false;
      const value = x.engine._getSymbolValue(x.symbol);
      return value !== undefined && walk(value);
    }
    if (!isFunction(x)) return false;
    if (gpuNodeDrawsItself(x)) {
      const def = x.engine.lookupDefinition(x.operator);
      if (
        !isOperatorDef(def) ||
        def.operator.isUserFunctionDefinition ||
        def.operator.drawsRandom !== true
      )
        return true;
    }
    return x.ops.some(walk);
  };
  return walk(unit);
}

/**
 * Does the arm `e` of a selection draw while every draw of the statement is
 * bound in order (`gpuBindEveryDraw`)? A draw in a ternary arm cannot be
 * bound and runs after the bound draws, so such an arm takes the statement
 * form of the selection, whose branches bind their own draws.
 */
export function gpuArmDrawsWhileBinding(e: Expression): boolean {
  return gpuBindEveryDraw !== undefined && BaseCompiler.foldValueImpure(e);
}

/**
 * The `recompileStatement` hook of the shader targets. A statement that
 * declined because the order of its random draws would change (a draw
 * bound to a temporary ahead of the statement while a draw written before
 * it stays in the statement, or a WGSL selection with a branch that draws)
 * is compiled again with every draw bound to a temporary at the point it is
 * compiled (`gpuRandomDraw`). The operands of a node are compiled from the
 * first to the last, depth first, and the draw of a node after its
 * operands, which is the order of the interpreter, so the hoisted draws run
 * in that order. A draw that cannot be bound (in a conditionally evaluated
 * arm) stays in its expression and runs after the bound draws: when any
 * draw is compiled after such a draw, or a lowering compiles a draw before
 * one that comes earlier in the expression (`gpuDrawComesAfter`), the
 * statement declines with the first error.
 * A decline of another kind in the second compilation propagates.
 *
 * A call of a function whose body draws is not compiled again: the body is
 * a shader function of its own, whose draws run where the call stands, and
 * this check does not see them (`gpuCallsAFunctionThatDraws`).
 */
export function gpuRecompileWithBoundDraws<R>(
  error: unknown,
  again: () => R,
  unit: Expression | undefined
): R | undefined {
  if (
    gpuBindEveryDraw !== undefined ||
    !(error instanceof Error) ||
    (error as unknown as Record<symbol, boolean>)[GPU_DRAW_ORDER] !== true ||
    unit === undefined ||
    gpuCallsAFunctionThatDraws(unit)
  )
    return undefined;
  const mode = { inline: false, reordered: false };
  gpuBindEveryDraw = mode;
  let result: R;
  try {
    result = again();
  } finally {
    gpuBindEveryDraw = undefined;
  }
  if (mode.reordered) throw error;
  return result;
}

/**
 * The operands bound to hoisted temporaries so far, for each statement sink:
 * their draws run ahead of the statement, in the order they were bound
 * (`gpuAssertBindingKeepsDrawOrder`).
 */
const gpuBoundDrawOperands = new WeakMap<object, Set<Expression>>();

/**
 * Fail closed when binding `operands` to hoisted temporaries would change
 * the order of the random draws of the statement. A hoisted statement runs
 * before the rest of its statement, so the draws of the bound operands come
 * before every draw that stays in the statement. That is the interpreter's
 * order when no draw evaluated BEFORE the first bound operand stays in the
 * statement: a later draw comes after either way, and an earlier draw that
 * was bound before (the elements of `Variance`, bound one by one) runs in
 * order. `(Random(), Cot(Random()))` bound the operand of `Cot` and drew it
 * before the first value of the tuple; it declines, and the statement is
 * then compiled again with every draw bound to a temporary of its own, in
 * order (`gpuRecompileWithBoundDraws`), during which this check is skipped.
 *
 * The order is the interpreter's: the operands of a node from first to last,
 * depth first, and the draw of a node itself (`Random(…)`) after its
 * operands. A draw in a lazily evaluated position (a branch, a loop body) is
 * counted where it stands, which can only refuse more. When the operand is
 * not found in the statement, or stands at more than one place, or no
 * statement position was recorded, the binding is accepted only if the
 * operands hold every draw of the statement. A binding made in a clause of
 * the statement form of a selection (`compileGPUStatementSelection`) is
 * checked against the whole statement, although the clause's statements run
 * at the head of its branch: a draw in the first condition then makes it
 * decline, where the `if` would keep the order (a limit, not a reorder).
 */
export function gpuAssertBindingKeepsDrawOrder(
  head: string,
  operands: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  // Every draw of the statement is bound in order: the check is made by
  // `gpuRecompileWithBoundDraws` at the end of the statement instead.
  if (gpuBindEveryDraw !== undefined) return;
  const decline = (): never => {
    throw gpuDrawOrderError(
      `Could not compile \`${head}\`: an operand that draws a random value would be ` +
        'bound to a temporary ahead of the rest of its statement, and a draw ' +
        'written before it would then come after it.'
    );
  };
  const sink = target.hoist;
  const evaluated = gpuEvaluatedUnit(target);
  const bound = sink === undefined ? undefined : gpuBoundDrawOperands.get(sink);
  // The walk stops at the first operand that draws: a pure operand ahead of
  // it has no draw to order.
  const first =
    operands.find((o) => BaseCompiler.foldValueImpure(o)) ?? operands[0];
  const FOUND = 1;
  const DRAW = 2;
  // The result of a node depends only on the node here, so it is computed
  // once: a tree with shared nodes is walked in linear time.
  const seen = new Map<Expression, number>();
  const walk = (n: Expression): number => {
    const known = seen.get(n);
    if (known !== undefined) return known;
    let r = 0;
    if (n === first) r = FOUND;
    else if (bound?.has(n)) r = 0;
    else if (isSymbol(n)) r = BaseCompiler.foldValueImpure(n) ? DRAW : 0;
    else if (isFunction(n)) {
      for (const op of n.ops) {
        r = walk(op);
        if (r !== 0) break;
      }
      if (r === 0 && gpuNodeDrawsItself(n)) r = DRAW;
    }
    seen.set(n, r);
    return r;
  };
  // The operands hold every draw of the statement: no order can change.
  const holdsEveryDraw = (): boolean => {
    if (evaluated === undefined) return false;
    const memo = new Map<Expression, number>();
    const own = operands.reduce((n, o) => n + gpuDrawCount(o, memo), 0);
    return gpuDrawCount(evaluated, memo) === own;
  };
  // The walk finds the operand by identity, so an operand object that stands
  // at more than one place may be found at the wrong one.
  const occurrences = (
    n: Expression,
    memo: Map<Expression, number>
  ): number => {
    const known = memo.get(n);
    if (known !== undefined) return known;
    let c = n === first ? 1 : 0;
    if (isFunction(n)) for (const op of n.ops) c += occurrences(op, memo);
    memo.set(n, c);
    return c;
  };
  const result = evaluated === undefined ? 0 : walk(evaluated);
  if (result === DRAW) decline();
  const ambiguous =
    evaluated !== undefined && occurrences(evaluated, new Map()) > 1;
  if ((result === 0 || ambiguous) && !holdsEveryDraw()) decline();
}

/**
 * Record `operands` as bound to hoisted temporaries of the current
 * statement, once their bindings are emitted: their draws then run ahead of
 * the statement, in order, and a later check
 * (`gpuAssertBindingKeepsDrawOrder`) does not read them as draws that stay
 * in the statement. Recorded after the binding, not when it is checked: an
 * operand is compiled between the two, and a binding inside it (`Cot` of
 * `Cot(Random())`) must still see its own draws.
 */
export function gpuRecordBoundDraws(
  operands: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  const sink = target.hoist;
  if (sink === undefined) return;
  const set = gpuBoundDrawOperands.get(sink) ?? new Set<Expression>();
  for (const o of operands) set.add(o);
  gpuBoundDrawOperands.set(sink, set);
}

/**
 * Does `node` make a random draw of its own, beside the draws of its
 * operands? An operator that draws (`Random`, also with an operand that
 * draws), a node that is impure by itself while none of its operands is, and,
 * to be safe, a call of a user function with an impure operand, whose body
 * may draw too (reading the body is not attempted, so this may say yes for a
 * body that does not draw, which only refuses more). `WithRandomSeed` frames
 * the draws of its body and makes none of its own.
 */
function gpuNodeDrawsItself(node: Expression): boolean {
  if (!isFunction(node) || node.operator === 'WithRandomSeed') return false;
  if (!BaseCompiler.foldValueImpure(node)) return false;
  if (!node.ops.some((op) => BaseCompiler.foldValueImpure(op))) return true;
  const def = node.engine.lookupDefinition(node.operator);
  if (isOperatorDef(def))
    return def.operator.drawsRandom || def.operator.isUserFunctionDefinition;
  return isValueDef(def);
}

/**
 * The number of draw sites that evaluating `node` reaches, counting each
 * occurrence: an operator that draws (`Random`, with or without an operand
 * that draws too), a call or another node that is impure by itself while
 * none of its operands is, and a symbol whose inlined value is impure. A
 * call of a function counts once, however often its body draws: those
 * draws run in order inside the called function, so they cannot change
 * places with each other. `WithRandomSeed` is pure from the outside, but
 * the walk enters it: the unit may be the body of the frame the selection
 * draws from. A draw in another nested frame, which has its own counter,
 * is counted too, which only refuses more. A node object can stand at
 * several places of a tree, so each occurrence counts, and the count of a
 * node is computed once (`memo`), which keeps a tree with shared nodes
 * linear in its number of distinct nodes. Exported for tests.
 */
export function gpuDrawCount(
  node: Expression,
  memo: Map<Expression, number> = new Map()
): number {
  const known = memo.get(node);
  if (known !== undefined) return known;
  let count = 0;
  if (isSymbol(node)) count = BaseCompiler.foldValueImpure(node) ? 1 : 0;
  else if (isFunction(node)) {
    for (const op of node.ops) count += gpuDrawCount(op, memo);
    if (gpuNodeDrawsItself(node)) count += 1;
  }
  memo.set(node, count);
  return count;
}
