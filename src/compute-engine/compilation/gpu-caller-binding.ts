// Code that the caller of `compile()` supplies on the GLSL target, bound to
// temporaries so that it runs once per occurrence, in the order of the
// interpreter.
//
// Caller code is a `vars` entry whose source is not a plain read
// (`nextValue()`, `vec3(a, b, c)`), a `functions` entry that is not declared
// pure, an `operators` entry and an operator's own `compile` handler
// (`reachesCallerCodeOn()`, `compile-folding.ts`). Such code can count its
// calls or draw a number, and the compiler does not see inside it. The
// interpreter evaluates each occurrence once, the operands of a node from the
// first to the last. The emitter, though, can write an operand more than
// once (`Cot(x)` is `cos(x) / sin(x)`) and can compute a part of a statement
// in a statement ahead of it (a loop, the statement form of a selection, a
// block used as a value).
//
// So, before a statement is compiled, `gpuBindCallerCode()` computes each
// piece of caller code that the statement evaluates unconditionally into a
// temporary of its shader type, in the order of the interpreter, and the
// statement reads the temporary (`_codeAliases`). A position that is
// evaluated on a condition or once per iteration is not entered: the node
// that holds it (an `If`, a `Which`, a loop-form `Sum`, a block used as a
// value) is itself computed into a temporary at its place in the order, and
// that position is bound when the emitter compiles it as a statement of its
// own (a branch of the statement form of the selection, a loop body, an
// unrolled term). After this, the code that the emitter writes more than
// once, or ahead of the rest of its statement, is a read of a temporary.
//
// `gpuSeparateCallerCode()` prepares the tree for this, before the rewrites
// of the prepare stage that put one node at several places. A node object that the caller put at several
// places of the tree is evaluated at each place by the interpreter, so each
// place gets a node of its own, and the binding (keyed by node) gives each
// its own temporary. The rewrites of the prepare stage that put one node at
// several places (the argument of an inlined user function, the components
// of an unrolled vector) mean one evaluation, and run after this step. The
// right operand of `And` and `Or` is evaluated only when the left one does
// not decide the result; when it holds caller code, `And(a, b)` is written
// `If(a, b, False)` and `Or(a, b)` is written `If(a, True, b)`, so that the
// statement form of the selection can bind that code inside its branch. A
// chained comparison stops at the first pair that is false
// (`evaluateChainOperands()`, `library/relational-operator.ts`), so its
// operands from the third on are evaluated on a condition too:
// `Less(a, b, c)` is written `If(Less(a, b), Less(b, c), False)`, where `b`
// is one node, evaluated once.
//
// The plan of this design, with the choices it makes, is
// `docs/plans/2026-11-09-ce1176-caller-code-binding.md`.

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { _codeAliases } from './compiler-mode.js';
import { reachesCallerCode, reachesCallerCodeOn } from './compile-folding.js';
import { isCallerMapped, type CseHarvestOptions } from './cse.js';
import { gpuTypeOfValue } from './gpu-declared-types.js';
import { blockLocalFunction } from './compile-assignment-checks.js';
import { GPU_MAX_WRITTEN_NODES } from './gpu-written-size.js';

/**
 * The heads whose operands after the first are evaluated on a condition
 * (`If`, `Which`, `And`, `Or`). The first operand is evaluated
 * unconditionally.
 */
const CONDITIONAL_AFTER_FIRST = new Set(['If', 'Which', 'And', 'Or']);

/**
 * The chained comparisons: with more than two operands, the operands from
 * the third on are evaluated only when the pairs before them are true.
 */
const CHAINED = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
]);

/**
 * The heads whose first operand is a body that is evaluated once per
 * iteration when the node has bounds (`Sum(body, Limits(…))`); the bounds
 * are evaluated once, before the loop. A `Sum` with one operand reduces a
 * collection, which is evaluated once. `Loop` and `ParallelLoop` have a
 * case of their own in `gpuBindCallerCode()`: a guard is evaluated on each
 * pass.
 */
const BODY_FIRST = new Set(['Sum', 'Product']);

/** Run `f` with the alias of `node` that an enclosing binding set lifted. */
function unaliased<T>(node: Expression, f: () => T): T {
  const previous = _codeAliases.get(node);
  if (previous === undefined) return f();
  _codeAliases.delete(node);
  try {
    return f();
  } finally {
    _codeAliases.set(node, previous);
  }
}

/**
 * Run `f`, which compiles `unit` as a statement of its own (a branch of a
 * selection, an unrolled term of a `Sum`), with the caller code of `unit`
 * bound first (`gpuBindCallerCode`). The bindings end when `f` returns.
 */
export function gpuWithCallerCodeBound<T>(
  unit: Expression,
  target: CompileTarget<Expression>,
  f: () => T
): T {
  const release = gpuBindCallerCode(unit, target);
  try {
    return f();
  } finally {
    release();
  }
}

/**
 * Bind each piece of caller code that `unit`, a statement about to be
 * compiled with the statement sink of `target`, evaluates unconditionally:
 * compute it into a temporary of its shader type, in the order of the
 * interpreter, and alias the node to the temporary (`_codeAliases`). Return
 * the function that removes the aliases, which the caller runs when the
 * statement is compiled.
 *
 * The walk visits the operands of a node from the first to the last, then
 * binds the node when its own evaluation runs caller code beyond its
 * operands (a `functions` entry, a call of a user function whose body has
 * caller code, a symbol whose value has caller code). A node with a
 * conditional or repeated position that holds caller code (`If`, `Which`,
 * `And`, `Or`, a loop-form `Sum` or `Product`, a block used as a value) is
 * bound as a whole after its unconditional operands, so its code runs at its
 * place in the order; the emitter binds the inner positions when it compiles
 * them as statements. `unit` itself is not bound: it is the statement, so it
 * runs after every piece bound ahead of it, as in the interpreter.
 *
 * A read of a `vars` key that is not caller code (a plain read such as
 * `u_t` or `state.value`) stays in the statement, where it runs after the
 * bound pieces. Caller code can write the variable that such a read reads,
 * so a part of the statement with such a read that the interpreter evaluates
 * before a piece of caller code is computed into a temporary too, just
 * before that piece: with `vars: { U: 'state.value', W: 'nextValue()' }`,
 * `(U, W)` reads `state.value` before it calls `nextValue()`. A read with no
 * caller code after it stays in place.
 *
 * Nothing is bound when there is no statement sink (a GLSL target object
 * passed to `compile()` as the `target` option, which writes caller code in
 * place). A piece whose value has no shader type for a temporary (an array)
 * declines.
 */
export function gpuBindCallerCode(
  unit: Expression | undefined,
  target: CompileTarget<Expression>
): () => void {
  // Each node aliased here, with the alias it had before.
  const bound: [Expression, string | undefined][] = [];
  const release = () => {
    for (const [node, previous] of bound.reverse())
      if (previous === undefined) _codeAliases.delete(node);
      else _codeAliases.set(node, previous);
    bound.length = 0;
  };
  if (unit === undefined || !BaseCompiler.canHoist(target)) return release;
  if (!unaliased(unit, () => reachesCallerCodeOn(unit, target))) return release;
  // The nodes bound by this statement: a node that a rewrite of the prepare
  // stage put at several places is one evaluation, and is bound once.
  const mine = new Set<Expression>();
  // The parts of the statement visited so far that hold no caller code and
  // read a `vars` key, in the order of the interpreter: they are bound before
  // the next piece of caller code that is not inside them.
  const pending: Expression[] = [];
  const readsVars = new WeakMap<Expression, boolean>();
  const readsVarsKey = (node: Expression): boolean => {
    let known = readsVars.get(node);
    if (known === undefined) {
      known = reachesCallerCode(node, {
        isStringVar: (name) => target.varsKeys?.has(name) === true,
        isCallerMapped: () => false,
        readsInput: (name) => target.boundVars?.has(name) === true,
        localFunction: (name) => blockLocalFunction(name, target),
      });
      readsVars.set(node, known);
    }
    return known;
  };

  const hold = (node: Expression, callerCode: boolean): void => {
    const type = gpuTypeOfValue(node, target);
    if (type === undefined)
      throw new Error(
        `Could not compile \`${node.toString()}\`: ` +
          (callerCode
            ? 'it contains code that the caller supplies (a `vars` source, a ' +
              '`functions` or `operators` entry, or a `compile` handler), which ' +
              'must run once, in the order of the interpreter'
            : 'it reads a `vars` input before code that the caller supplies, ' +
              'which could write that input, so it must be read first') +
          ', and its value has no shader type for a temporary that would ' +
          'hold it.'
      );
    const code = unaliased(node, () => BaseCompiler.compile(node, target));
    // A node that the emitter computed into a temporary of this compilation
    // (`BaseCompiler.tempVar()`: the statement form of a selection, a loop)
    // is read from it directly. Any other code, a bare identifier included
    // (a `vars` source that a shader statement can write), is read into a
    // temporary here, at its place in the order.
    let name = code;
    if (!/^_tv\d+$/.test(code)) {
      name = BaseCompiler.tempVar(target);
      BaseCompiler.hoistStatement(target, `${type} ${name} = ${code};`);
    }
    bound.push([node, _codeAliases.get(node)]);
    _codeAliases.set(node, name);
    mine.add(node);
  };

  // Bind `node`, a piece of caller code. `mark` is the number of entries of
  // `pending` when the walk entered `node`: the entries before it are read
  // before `node` runs and are bound first; the entries after it are inside
  // `node`, which now computes them at its place.
  const bind = (node: Expression, mark: number): void => {
    for (const read of pending.slice(0, mark)) hold(read, false);
    pending.length = 0;
    hold(node, true);
  };

  // Does the evaluation of `node` run caller code other than in the operands
  // listed in `visited`?
  const runsMore = (node: Expression, visited: ReadonlyArray<Expression>) => {
    const skip = new Set(visited);
    return unaliased(node, () =>
      reachesCallerCodeOn(node, target, (m) => skip.has(m))
    );
  };

  const declineConditional = (node: Expression, operand: Expression) => {
    throw new Error(
      `Could not compile \`${node.toString()}\`: its operand ` +
        `\`${operand.toString()}\` is evaluated on a condition and contains ` +
        'code that the caller supplies (a `vars` source, a `functions` or ' +
        '`operators` entry, or a `compile` handler), and at this position ' +
        'that code cannot be computed once, at the start of its branch.'
    );
  };

  const visit = (node: Expression, root: boolean): void => {
    // A block of one statement is compiled as that statement.
    while (isFunction(node, 'Block') && node.nops === 1) node = node.ops[0];
    if (mine.has(node) || _codeAliases.has(node)) return;
    const mark = pending.length;
    if (!reachesCallerCodeOn(node, target)) {
      if (readsVarsKey(node)) pending.push(node);
      return;
    }
    if (isSymbol(node) || !isFunction(node)) {
      if (!root) bind(node, mark);
      return;
    }
    const head = node.operator;
    let eager: ReadonlyArray<Expression> = node.ops;
    // The statements of a block are statements of their own, which bind
    // their own caller code when they are compiled.
    if (head === 'Block') eager = [];
    else if (head === 'Loop' || head === 'ParallelLoop') {
      // The range of the first clause is evaluated once, before the loop.
      // A guard is evaluated on each pass, and the range of a later clause
      // each time the loop of the clause before it enters it: the `Loop`
      // lowering has no statement position for them, so their caller code
      // declines.
      const clauses = node.ops.slice(1);
      eager = [];
      clauses.forEach((clause, k) => {
        if (!isFunction(clause, 'Element')) return;
        const [, domain, ...guards] = clause.ops;
        if (k === 0 && domain !== undefined) eager = [domain];
        else if (domain !== undefined && reachesCallerCodeOn(domain, target))
          declineConditional(node, domain);
        for (const guard of guards)
          if (reachesCallerCodeOn(guard, target))
            declineConditional(node, guard);
      });
    } else if (
      CONDITIONAL_AFTER_FIRST.has(head) ||
      (CHAINED.has(head) && node.nops > 2)
    ) {
      eager = node.ops.slice(0, CHAINED.has(head) ? 2 : 1);
      // The prepare stage writes `And`, `Or` and a chained comparison with
      // caller code in a later operand as an `If` (`gpuSeparateCallerCode()`)
      // in the root tree, but not in the body of a user function, which the
      // fragment pass types as it is stored, and not for a head that the
      // caller maps. The statement form of `If` and `Which` binds the code
      // of a branch at its start, but a head that the caller maps is not
      // written by that lowering.
      if (
        (head !== 'If' && head !== 'Which') ||
        isCallerMapped(node, target.cse?.harvestOptions)
      ) {
        const later = node.ops
          .slice(eager.length)
          .find((op) => reachesCallerCodeOn(op, target));
        if (later !== undefined) declineConditional(node, later);
      }
    } else if (BODY_FIRST.has(head) && node.nops > 1) eager = node.ops.slice(1);
    for (const op of eager) visit(op, false);
    if (!root && runsMore(node, eager)) bind(node, mark);
  };

  try {
    visit(unit, true);
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

/**
 * Prepare the tree of a GLSL root compilation for `gpuBindCallerCode()`,
 * before the rewrites of the prepare stage that put one node at several
 * places (the unrolls and the inliners):
 *
 * - each node that holds caller code and that the tree reaches at more than
 *   one place is replaced, at its second and later places, by a copy, so that
 *   each place, which the interpreter evaluates, gets a temporary of its own.
 *   A graph whose copies would pass the size limit of the GLSL code
 *   (`GPU_MAX_WRITTEN_NODES`) is left as it is: the size check of the
 *   prepare stage refuses it.
 * - `And(a, b, …)` and `Or(a, b, …)` whose operands after the first hold
 *   caller code are written `If(a, And(b, …), False)` and
 *   `If(a, True, Or(b, …))`. A chained comparison whose operands from the
 *   third on hold caller code, `Less(a, b, c, …)`, is written
 *   `If(Less(a, b), Less(b, c, …), False)`.
 *
 * A tree with no caller code is returned unchanged. `caller` gives the
 * caller's `functions` and `vars` entries as the common-subexpression pass
 * reads them; `readsInput` names a `vars` key whose entry is a plain read.
 */
export function gpuSeparateCallerCode(
  expr: Expression,
  caller: CseHarvestOptions,
  readsInput: (name: string) => boolean
): Expression {
  // The predicates of `reachesCallerCodeOn()`: a `functions` entry declared
  // pure is not caller code, but a `compile` handler of the same head is.
  const handlerOnly: CseHarvestOptions = {
    ...caller,
    isOverriddenOperator: () => false,
  };
  const predicates: Parameters<typeof reachesCallerCode>[1] = {
    isStringVar: caller.isStringVar,
    isCallerMapped: (node) =>
      isCallerMapped(node, caller) &&
      (caller.isPureOverriddenOperator?.(node.operator) !== true ||
        isCallerMapped(node, handlerOnly)),
    readsInput,
  };
  const memo = new WeakMap<Expression, boolean>();
  const reaches = (node: Expression): boolean => {
    let known = memo.get(node);
    if (known === undefined) {
      known = reachesCallerCode(node, predicates);
      memo.set(node, known);
    }
    return known;
  };
  if (!reaches(expr)) return expr;
  const ce = expr.engine;
  const seen = new Set<Expression>();
  let copies = 0;
  const rebuild = (node: Expression, ops: Expression[]): Expression => {
    if (!isFunction(node)) return node;
    return ce._fn(node.operator, ops, {
      scope: scopeForRebuild(node.localScope, ce, node.operator, ops),
    });
  };
  // The `If` form of a node of head `head` whose operands, already walked,
  // are `ops`, when an operand that it evaluates on a condition holds caller
  // code; otherwise `undefined`.
  const conditionalForm = (
    head: string,
    ops: ReadonlyArray<Expression>
  ): Expression | undefined => {
    const node = (h: string, xs: ReadonlyArray<Expression>) =>
      conditionalForm(h, xs) ?? ce._fn(h, [...xs]);
    if ((head === 'And' || head === 'Or') && ops.length > 1) {
      const rest = ops.slice(1);
      if (!rest.some(reaches)) return undefined;
      const tail = rest.length === 1 ? rest[0] : node(head, rest);
      return head === 'And'
        ? ce._fn('If', [ops[0], tail, ce.False])
        : ce._fn('If', [ops[0], ce.True, tail]);
    }
    if (CHAINED.has(head) && ops.length > 2 && ops.slice(2).some(reaches))
      return ce._fn('If', [
        ce._fn(head, ops.slice(0, 2)),
        node(head, ops.slice(1)),
        ce.False,
      ]);
    return undefined;
  };
  const walk = (node: Expression): Expression => {
    if (!reaches(node)) return node;
    const again = seen.has(node);
    seen.add(node);
    if (again && ++copies > GPU_MAX_WRITTEN_NODES) return node;
    if (isSymbol(node)) return again ? ce.symbol(node.symbol) : node;
    if (!isFunction(node)) return node;
    const ops = node.ops.map(walk);
    const head = node.operator;
    // A head that the caller maps keeps its node: the binding declines it
    // when an operand that it evaluates on a condition holds caller code
    // (`gpuBindCallerCode()`).
    const lazy = isCallerMapped(node, caller)
      ? undefined
      : conditionalForm(head, ops);
    if (lazy !== undefined) return lazy;
    if (!again && ops.every((op, i) => op === node.ops[i])) return node;
    return rebuild(node, ops);
  };
  return walk(expr);
}

/**
 * Decline a selection (`head` is `If` or `Which`) that is about to take its
 * conditional-expression form while one of `clauses`, the positions that it
 * evaluates on a condition, holds caller code. In that form the clause is
 * written in place, inside an arm of `?:`, where its caller code cannot be
 * computed into a temporary at the start of a branch: a lowering that writes
 * an operand twice (`Cot`) would run the code twice. The statement form of
 * the selection binds it (`compileGPUStatementSelection()`); that form is
 * not available when the clauses have no one shader type, or when a part of
 * the statement writes a binding that the selection could read.
 *
 * A route with no statement sink (a GLSL target object passed to
 * `compile()` as the `target` option) binds no caller code, and writes it in
 * place: nothing is declined there.
 */
export function gpuAssertNoConditionalCallerCode(
  head: string,
  clauses: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  if (!BaseCompiler.canHoist(target)) return;
  const clause = clauses.find((x) => reachesCallerCodeOn(x, target));
  if (clause !== undefined)
    throw new Error(
      `Could not compile \`${head}\`: the clause \`${clause.toString()}\` ` +
        'contains code that the caller supplies (a `vars` source, a ' +
        '`functions` or `operators` entry, or a `compile` handler), and the ' +
        'selection cannot be written as an `if` statement, which would ' +
        'compute that code once, at the start of its branch.'
    );
}
