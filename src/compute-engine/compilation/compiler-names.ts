// Name analysis: which symbols an expression mentions, reaches or rebinds, and
// which names a compilation binds.

import type { Expression } from '../global-types.js';
import {
  boundVariableNames,
  boundVariableNamesInOperand,
} from '../boxed-expression/binders.js';
import {
  declaredBinders,
  ownIndexClauseAt,
} from '../boxed-expression/binding-sites.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { multiClauseState } from '../multi-clause.js';
import type { CompileTarget } from './types.js';
import { possiblyCollectionTypedForCompile } from './compiler-type-facts.js';
import { core } from './compiler-core-hooks.js';
import { CompilerState } from './compiler-state.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';

/**
 * A `_tv`/`_cse`-prefixed identifier token, as it appears inside a
 * caller-supplied source string. The lookbehind keeps it from matching the
 * tail of a longer identifier (`a_tv1`).
 */
const GENERATED_NAME_RE = /(?<![\p{L}\p{N}_])_(?:tv|cse)[\p{L}\p{N}_]*/gu;

/** Accumulate every symbol name of `expr` into `names`. One walk by node
 * object (a shared subtree is visited once — the set is a union either way). */
function collectSymbolNames(
  expr: Expression,
  names: Set<string>,
  seen: Set<Expression>
): void {
  if (seen.has(expr)) return;
  seen.add(expr);
  if (isSymbol(expr)) {
    names.add(expr.symbol);
    return;
  }
  if (isDictionary(expr)) {
    for (const v of expr.values) collectSymbolNames(v, names, seen);
    return;
  }
  if (isFunction(expr)) {
    names.add(expr.operator);
    for (const op of expr.ops) collectSymbolNames(op, names, seen);
  }
}

/**
 * The collision inventory of a compilation (`NamingContext.usedNames`): every
 * symbol name reachable in `expr`, plus every `_tv`/`_cse` token appearing in
 * the caller-supplied source strings spliced into the emitted code.
 */
export function collectUsedNames(
  expr: Expression | ReadonlyArray<Expression | undefined> | undefined,
  sources?: ReadonlyArray<string | undefined>,
  extra?: ReadonlyArray<string>
): Set<string> {
  const names = new Set<string>();
  const seen = new Set<Expression>();
  if (Array.isArray(expr)) {
    for (const e of expr)
      if (e !== undefined) collectSymbolNames(e, names, seen);
  } else if (expr !== undefined)
    collectSymbolNames(expr as Expression, names, seen);
  if (extra) for (const n of extra) names.add(n);
  if (sources) {
    for (const src of sources) {
      if (typeof src !== 'string' || src.length === 0) continue;
      for (const m of src.matchAll(GENERATED_NAME_RE)) names.add(m[0]);
    }
  }
  return names;
}

/**
 * Whether an `At` index selects a sub-collection rather than a single scalar
 * — a gather (`At(L, [1, 3])`) or a boolean mask, both of which the
 * JavaScript `At` lowering supports. Such a read produces a list, not an
 * element, so neither the per-element answer nor the mixed-element decline
 * applies to it; the enclosing analysis keeps whatever it did before.
 *
 * Covers an index that is only possibly a collection as well as a definite
 * one, because the distinction it guards is about which lowering runs, and a
 * `broadcastable`/top-typed index could take either at run time.
 */
export function isGatherIndex(index: Expression): boolean {
  return (
    index.type.matches('collection<any>') ||
    index.isCollection === true ||
    possiblyCollectionTypedForCompile(index)
  );
}

/**
 * Whether the elements of `collection` are identifiable and disagree about
 * being complex-valued — the case {@link uniformElementComplexness} declines
 * for a reason other than not being able to see the elements at all.
 */
export function hasMixedElementComplexness(collection: Expression): boolean {
  const elements = core.elementComplexness(collection);
  if (elements === undefined || elements.length < 2) return false;
  return elements.some((e) => e !== elements[0]);
}

/**
 * Whether the symbol `name` occurs FREE in `expr`: an occurrence that is
 * not shadowed by a binder inside `expr` (a `Function` literal's parameter,
 * a scoped form's bound variable — `boundVariableNames`). A plain
 * structural search (`has`) counts a shadowed occurrence too, so a source
 * such as `Filter(A, x ↦ x > 0)` under a loop binder `x` would be read as
 * mentioning the loop variable, which it does not.
 */
export function symbolOccursFree(expr: Expression, name: string): boolean {
  if (isSymbol(expr)) return expr.symbol === name;
  if (!isFunction(expr)) return false;
  // A bound name shadows the operands it is IN SCOPE in: an iterator
  // clause's index does not shadow an earlier clause's collection or guard
  // (`boundVariableNamesInOperand`).
  if (!boundVariableNames(expr).includes(name))
    return expr.ops.some((op) => symbolOccursFree(op, name));
  // The clause ordering is read once per node, not once per operand.
  const binders = declaredBinders(expr, 'post');
  return expr.ops.some((op, i) => {
    // The bounds of a `Limits` clause and the collection of an `Element`
    // clause are outside the scope of the clause's own index
    // (`ownIndexClause()`, `binding-sites.ts`).
    const own = ownIndexClauseAt(expr, i, binders);
    if (own !== undefined && own.name === name && isFunction(op))
      return op.ops.some(
        (child, j) => own.outside(j) && symbolOccursFree(child, name)
      );
    return (
      !boundVariableNamesInOperand(expr, i, binders).includes(name) &&
      symbolOccursFree(op, name)
    );
  });
}

/**
 * Fail closed on an indexed read whose element shape cannot be decided: the
 * collection mixes complex- and real-valued
 * elements, and the index is known only at run time.
 *
 * A list is emitted element by element and each element picks its own
 * real-vs-complex lowering, so `[i·t, 1]` lowers to the heterogeneous
 * `[{re, im}, 1]`. When the index is a literal, the element it selects is
 * known and {@link isComplexValuedElementAt} answers for that one. When every
 * element agrees, the shared verdict holds whichever the index selects
 * ({@link uniformElementComplexness}). Neither applies here, and there is no
 * third source of truth: the read is `{re, im}` for some indices and a plain
 * number for others, decided at run time.
 *
 * Emitting either representation would be wrong for some index. Declining
 * hands the expression to the interpreter, which indexes the value it
 * actually built.
 *
 * The narrowness is the point: an all-complex or all-real collection is
 * unaffected, a literal index is unaffected, and a collection whose elements
 * this analysis cannot see keeps whatever it did before.
 */
export function assertNoAmbiguousComplexElementRead(
  h: string,
  args: ReadonlyArray<Expression>
): void {
  if (h !== 'At' || args.length !== 2) return;
  const index = args[1];
  // A literal index names its element. A COMPLEX index names none, but that
  // is a different defect from this one — leave it to whatever handles it.
  if (isNumber(index) || core.isComplexValued(index)) return;
  // A GATHER selects a sub-collection rather than one scalar, so the
  // ambiguity this guard is about does not arise — its result is a list whose
  // own elements the enclosing analysis handles. `At([10, 20, 30], [2])`
  // compiles to `[20]` today, and declining it would be a pure regression.
  if (isGatherIndex(index)) return;
  if (!hasMixedElementComplexness(args[0])) return;
  throw new Error(
    `Could not compile \`At\`: an indexed read with a run-time index into a ` +
      `collection that mixes complex-valued and real-valued elements — the ` +
      `element is a complex object for some indices and a plain number for ` +
      `others, so no single lowering is correct. The interpreter evaluates it instead. Use a literal index, or make every element ` +
      `complex-valued.`
  );
}

/**
 * Whether `expr` mentions any name that is BOUND in the current compilation
 * context — a user function's parameter, an enclosing binder's index, a
 * broadcast element (`_boundVarsCtx`, synced from `target.boundVars` by
 * `compile()`), or a name shielded by a binder being analyzed rather than
 * compiled (`_binderShield`).
 *
 * Such a name shadows any same-named engine symbol, so reading a VALUE
 * through it (`.re`, `_getSymbolValue`) dereferences the wrong definition.
 * This is the predicate half of the rule `isComplexValued` already applies
 * for complex-ness.
 */
export function mentionsCompileBoundName(
  expr: Expression,
  seen: Set<Expression> = new Set()
): boolean {
  if (isSymbol(expr)) return isCompileBoundName(expr.symbol);
  if (isFunction(expr)) {
    // A node object can be at several positions of the tree (`Add(e, e)`).
    // A node already seen in this walk answered `false`, since a `true`
    // ends the walk, so it is not walked again: the walk is linear in the
    // distinct nodes, where it was exponential in the depth of such a tree.
    if (seen.has(expr)) return false;
    seen.add(expr);
    // The application HEAD counts as a mention, exactly as it does in
    // `mentionsExcludedName` below: a call whose head is a bound name applies
    // that BINDING, so evaluating the call through the engine here would
    // apply a same-named engine definition instead and bake ITS result as a
    // constant. Inside the literal `(g) ↦ g(2)`, with an engine-level
    // `g = x ↦ x + 1` in scope, `g(2)` folded to 3 and the literal compiled
    // to `(g) => 3` — ignoring its argument, and disagreeing with the
    // interpreter, which applies the parameter.
    if (isCompileBoundName(expr.operator)) return true;
    return expr.ops.some((op) => mentionsCompileBoundName(op, seen));
  }
  return false;
}

/** Whether `name` is bound in the current compilation context — see
 * {@link mentionsCompileBoundName}, whose two mention sites (a value-position
 * symbol and an application head) share this test. */
export function isCompileBoundName(name: string): boolean {
  if (CompilerState._boundVarsCtx?.has(name)) return true;
  for (let i = CompilerState._binderShield.length - 1; i >= 0; i--)
    if (CompilerState._binderShield[i].has(name)) return true;
  // A function-valued local of an enclosing block (`gg := t ↦ t + 10` in
  // the block) is bound too, also when the engine assigns a function to
  // the same name: a call `gg(1)` applies the block's function. Evaluated
  // through the engine, the fold applied the engine's function and baked
  // ITS value (`2` for an engine `gg = t ↦ t + 1`, where the interpreter
  // gives 11). The call is compiled by `tryCompileLocalFunctionCall`,
  // which folds it with the block's literal when that is sound.
  const target = CompilerState._callSiteTarget;
  if (
    target?.localFunctions?.has(name) ||
    target?.lexicalFunctions?.has(name) ||
    target?.reboundFunctions?.has(name)
  )
    return true;
  return false;
}

/**
 * Whether `expr` mentions — as a value-position symbol OR as an application
 * head — any name in `vars` (the caller's `vars`-mapped runtime inputs) or
 * `ops` (`CompileTarget.foldExcludedOps`, operator names whose emission the
 * caller overrode). Either kind of mention makes a subtree unsafe to
 * constant-fold: a `vars`-mapped symbol stays a live input even when it has
 * an engine value, and a caller-overridden operator must run the caller's
 * implementation, which compile-time evaluation through the engine would
 * bypass.
 */
export function mentionsExcludedName(
  expr: Expression,
  vars: ReadonlySet<string> | undefined,
  ops: ReadonlySet<string> | undefined
): boolean {
  if (isSymbol(expr)) {
    const s = expr.symbol;
    return vars?.has(s) === true || ops?.has(s) === true;
  }
  if (isDictionary(expr))
    return expr.values.some((v) => mentionsExcludedName(v, vars, ops));
  if (isFunction(expr)) {
    if (ops?.has(expr.operator) === true) return true;
    return expr.ops.some((op) => mentionsExcludedName(op, vars, ops));
  }
  return false;
}

/**
 * Whether evaluating `expr` at compile time would bake in something that
 * must stay live at run time: `expr` mentions a `vars`-mapped input or a
 * caller-overridden operator (see `mentionsExcludedName`) either directly,
 * or through the assigned value of a symbol it reads, or through the body
 * of a user-defined function it calls or passes as a value — at any depth.
 *
 * The compile-time folder evaluates a subtree through the engine, and the
 * engine reads every assigned value and applies every user function it
 * reaches. With `a := sin(y_0)` and `y_0` a `vars`-mapped input that also
 * holds a value, `cos(a)` mentions no mapped name itself, yet folding it
 * bakes `y_0`'s current value into the code, and a later write to the input
 * has no effect: a slider-dependent document definition drew outdated
 * geometry (Tycho item 328). The same holds for the body of `u := L ↦ 2L −
 * a` under the call `u(1)`, and for a caller-overridden function reached
 * through a value, which the fold would evaluate through the engine
 * instead of running the caller's implementation.
 *
 * The answer for a name depends only on the engine's definitions, which do
 * not change while one expression compiles, so it is memoized per name in
 * `target.foldReachMemo`, and a function node already walked in this call
 * is not walked again. A name whose walk is in progress (a value that
 * refers to itself) answers `false` at the re-entry, and that answer is
 * provisional: a walk that met such a re-entry may have been cut short by
 * the cycle, so its `false` is not memoized, while a walk that met none is
 * complete and is. A `true` is memoized from any depth. Definitions rarely
 * form a cycle (the engine cannot evaluate one), so in practice every name
 * is walked once and a tower of definitions sharing dependencies costs
 * linear work.
 *
 * A parameter or binder index that shadows a same-named engine symbol is
 * not tracked: its engine value is walked too, which can only report a
 * mention that is not there, and a spurious mention costs one fold, never
 * a wrong value.
 */
export function reachesExcludedName(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  const vars = target.varsKeys;
  const ops = target.foldExcludedOps;
  if (
    (vars === undefined || vars.size === 0) &&
    (ops === undefined || ops.size === 0)
  )
    return false;
  const memo = (target.foldReachMemo ??= new Map());
  const engine = expr.engine;
  const walking = new Set<string>();
  const seen = new Set<Expression>();
  // How many times a walk short-circuited on a name already in progress.
  // A name's walk compares the count before and after: unchanged means no
  // cycle cut it short and its `false` is final.
  let reentries = 0;
  const viaName = (s: string): boolean => {
    const known = memo.get(s);
    if (known !== undefined) return known;
    if (walking.has(s)) {
      reentries += 1;
      return false;
    }
    walking.add(s);
    const before = reentries;
    let hit = false;
    try {
      const value = engine._getSymbolValue(s);
      if (value !== undefined) hit = visit(value);
      if (!hit) {
        const literal = userFunctionLiteral(engine, s);
        if (literal !== undefined && literal !== value) hit = visit(literal);
      }
      // A multi-clause function has no single literal: each clause's body
      // is read, as `foldValueImpure` reads them.
      if (!hit) {
        const clauses = multiClauseState(engine.lookupDefinition(s))?.clauses;
        if (clauses !== undefined) hit = clauses.some((c) => visit(c.literal));
      }
    } finally {
      walking.delete(s);
    }
    if (hit || reentries === before) memo.set(s, hit);
    return hit;
  };
  const visit = (e: Expression): boolean => {
    if (isSymbol(e)) {
      const s = e.symbol;
      if (vars?.has(s) === true || ops?.has(s) === true) return true;
      return viaName(s);
    }
    if (isDictionary(e)) return e.values.some(visit);
    if (isFunction(e)) {
      if (seen.has(e)) return false;
      seen.add(e);
      const h = e.operator;
      if (ops?.has(h) === true) return true;
      if (e.ops.some(visit)) return true;
      return viaName(h);
    }
    return false;
  };
  return visit(expr);
}

/**
 * Whether `expr` is a `Tabulate` with a dimension that is a finite real
 * number literal that rounds to 0 or less (the test of the `Tabulate`
 * compile handlers of the JavaScript and Python targets, which read the
 * dimension with `tryGetConstant()`). Its value is the empty list `[]`, and
 * those handlers decline it, so it must not constant-fold: the fold would
 * emit the `[]` before the handler can decline.
 */
export function isTabulateWithNonPositiveDimension(expr: Expression): boolean {
  if (!isFunction(expr, 'Tabulate')) return false;
  return expr.ops
    .slice(1)
    .some(
      (op) =>
        isNumber(op) &&
        !op.isComplex &&
        Number.isFinite(op.re) &&
        Math.round(op.re) <= 0
    );
}

/**
 * Whether the subtree contains a `Sum`/`Product` with a non-finite bound in
 * an INDEXING-SET operand (everything after the body: `Limits`, `Element`,
 * and the raw spellings). Such a node must never constant-fold — see the
 * call site in `tryConstantFold`. The body/collection operand (`ops[0]`) is
 * deliberately not scanned at this node: an `∞` there belongs to a bounded
 * lazy pipeline (`Take(Map(f, 1..∞), n)`), which evaluates finitely — but
 * it IS recursed into, so a nested unbounded big op inside it still trips.
 */
export function containsUnboundedBigOp(
  expr: Expression,
  seen: Set<Expression> = new Set()
): boolean {
  // A node already seen in this walk answered `false` (see
  // `mentionsCompileBoundName`), so it is not walked again.
  if (seen.has(expr)) return false;
  if (isDictionary(expr)) {
    seen.add(expr);
    return expr.values.some((v) => containsUnboundedBigOp(v, seen));
  }
  if (!isFunction(expr)) return false;
  seen.add(expr);
  if (expr.operator === 'Sum' || expr.operator === 'Product') {
    const ops = expr.ops;
    for (let i = 1; i < ops.length; i++)
      if (containsNonFiniteLiteral(ops[i])) return true;
  }
  return expr.ops.some((op) => containsUnboundedBigOp(op, seen));
}

/** Whether the subtree contains a non-finite number literal, one of the
 * infinity symbols, or a symbol whose VALUE is non-finite (see
 * `containsUnboundedBigOp`). A node already seen in this walk answered
 * `false`, since a `true` ends the walk, so a node object at several
 * positions of a bound (`Add(e, e)`) is walked once. */
export function containsNonFiniteLiteral(
  expr: Expression,
  seen: Set<Expression> = new Set()
): boolean {
  if (seen.has(expr)) return false;
  seen.add(expr);
  if (isNumber(expr))
    return !Number.isFinite(expr.re) || !Number.isFinite(expr.im);
  if (isSymbol(expr)) {
    const s = expr.symbol;
    if (
      s === 'PositiveInfinity' ||
      s === 'NegativeInfinity' ||
      s === 'ComplexInfinity'
    )
      return true;
    // A symbol with an assigned non-finite value (`m := +∞` used as a
    // bound) is the same divergence hazard as a literal `∞`: it is not an
    // unknown, so no other gate declines it. `.re`/`.im` dereference the
    // assigned value; `NaN` (a valueless or non-numeric symbol) is not
    // "unbounded" — a NaN bound makes an empty walk, never a truncation.
    const re = expr.re;
    if (!Number.isNaN(re) && !Number.isFinite(re)) return true;
    const im = expr.im;
    if (!Number.isNaN(im) && !Number.isFinite(im)) return true;
    return false;
  }
  if (isDictionary(expr))
    return expr.values.some((v) => containsNonFiniteLiteral(v, seen));
  if (isFunction(expr))
    return expr.ops.some((op) => containsNonFiniteLiteral(op, seen));
  return false;
}
