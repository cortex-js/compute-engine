/**
 * The rewrites that every compile target runs at its entry for a symbol
 * whose type admits a point and a list of points
 * (`BaseCompiler.pointOrPointListUnion()`), such as
 * `P: tuple<number, number> | list<tuple<number, number>>`.
 *
 * The declared type of such a symbol gives no width and no single shape: a
 * coordinate `At(P, 1)` has the type `missing | number | tuple<number,
 * number>`, and the checks of the compilation that read that type decline
 * `At(P, 1) + x` ("an operand may be a point"). When the compiled code holds
 * the value of the symbol anyway (an assigned value that no `vars` entry
 * maps), and that value is a point, the value is written in place of the
 * symbol before the compilation (`inlinePointValues`). A call of a user
 * function whose body reads such a symbol is replaced by its body when the
 * body is then a point or a number (`inlinePointCalls`). The compilation
 * then reads the types of an ordinary tuple, and the code is the code of the
 * value, which the interpreter also reads.
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { CompileTarget } from './types.js';
import type { Type } from '../../common/type/types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { BaseCompiler } from './base-compiler.js';
import type { EnclosingDefinition } from './base-compiler.js';
// The compiled lanes read the open form of a broadcast over an operand of
// type `unknown` as `broadcastable<R>` (`resolveTypeForCompiledLanes`).
import { resolveTypeForCompiledLanes as resolveTypeForCompilation } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  declaredBinders,
  scopeForRebuild,
} from '../boxed-expression/binding-sites.js';
import {
  boundVariableNames,
  rewriteWithBinders,
} from '../boxed-expression/binders.js';

/**
 * `expr` with the point values and the point calls written in place
 * (`inlinePointValues` and `inlinePointCalls`), for the root of a
 * compilation on a target that is not a shader target (`javascript`,
 * `interval-js`, `python`). `expr` itself when `expr` has no symbol whose
 * type admits a point and a list of points and no call whose type admits
 * an inlined point: the rewrites then change nothing, and the walks they
 * need (the reachable names, the binding checks) are not done.
 *
 * The rewrites replace a call by the body of its function, and the
 * binding checks of `compile()` then no longer see the call, so they run
 * first, on `expr` (`BaseCompiler.beginRootPreprocessing()`). A call that
 * the rewrite would need to substitute more than `MAX_POINT_CALL_INLINES`
 * times is left as written: these targets compile it as a call.
 *
 * The options:
 * - `vars`: the `vars` of the compilation. The value of a symbol that `vars`
 *   maps is not read for the names that the compiled code binds.
 * - `readsCallerSource`: whether the `vars` entry of a name is source code
 *   of the caller, which the compiled code runs where it reads the name
 *   (`'_.draw()'`), not a plain read of an input. When it is not given,
 *   every string entry of `vars` is such source. A call with an argument
 *   that reaches such a name, or a head that the caller overrides, is left
 *   as written (`callerCodeReached`).
 * - `rootPreprocessed`: the target already called
 *   `BaseCompiler.beginRootPreprocessing()` on `expr`, so it is not called
 *   again.
 */
export function inlinePointValuesAtRoot(
  expr: Expression,
  target: CompileTarget<Expression>,
  options: {
    vars?: Readonly<Record<string, unknown>>;
    readsCallerSource?: (name: string) => boolean;
    rootPreprocessed?: boolean;
  } = {}
): Expression {
  if (!mentionsInlinablePoint(expr, target)) return expr;
  const { vars } = options;
  if (options.rootPreprocessed !== true)
    BaseCompiler.beginRootPreprocessing(expr, target);
  const readsCallerSource =
    options.readsCallerSource ??
    ((name: string) =>
      vars !== undefined &&
      Object.hasOwn(vars, name) &&
      typeof vars[name] === 'string');
  return inlinePointValues(
    inlinePointCalls(expr, target, undefined, undefined, (arg) =>
      callerCodeReached(arg, target, readsCallerSource)
    ),
    target,
    reachableSymbolNames(expr, vars).written
  );
}

/**
 * Whether the compiled code of `expr` runs code of the caller: a symbol
 * whose `vars` entry is caller source (`readsCallerSource`), or a head that
 * the caller overrides (`CompileTarget.overridesHead`). The assigned value of
 * a symbol that no `vars` entry maps and the body of a user function are
 * read too, because the compiled code holds them.
 *
 * The engine cannot tell if such code has effects (`'_.draw()'`), so the
 * substitution of a call does not write an argument that runs it at each
 * occurrence of a parameter, or drop it with a parameter that the body does
 * not read: the call is left as written, and its compiled code evaluates
 * each argument once.
 */
function callerCodeReached(
  expr: Expression,
  target: CompileTarget<Expression>,
  readsCallerSource: (name: string) => boolean
): boolean {
  const engine = expr.engine;
  const seen = new Set<Expression>();
  const names = new Set<string>();
  const viaName = (s: string): boolean => {
    if (names.has(s)) return false;
    names.add(s);
    const value = engine._getSymbolValue(s);
    if (value !== undefined && walk(value)) return true;
    const literal = BaseCompiler.userFunctionLiteral(engine, s);
    return literal !== undefined && literal !== value && walk(literal);
  };
  const walk = (e: Expression): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e)) {
      if (readsCallerSource(e.symbol)) return true;
      if (target.varsKeys?.has(e.symbol) === true) return false;
      return viaName(e.symbol);
    }
    if (!isFunction(e)) return false;
    if (target.overridesHead?.(e.operator) === true) return true;
    return e.ops.some(walk) || viaName(e.operator);
  };
  return walk(expr);
}

/**
 * Whether `expr` has a node that `inlinePointValues` or `inlinePointCalls`
 * can replace: a symbol whose type admits a point and a list of points, or,
 * when `target` compiles user functions, a call whose type admits an
 * inlined point (`callTypeAdmitsInlinedPoint`). The operands of a
 * `Function` literal are read too, because `inlinePointValues` replaces a
 * symbol inside a literal. The test can answer true for a node that the
 * rewrites then leave as written; it never answers false for a node that
 * they replace.
 */
function mentionsInlinablePoint(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  const calls = target.userFunctions !== undefined;
  const visited = new Set<Expression>();
  const walk = (e: Expression): boolean => {
    if (visited.has(e)) return false;
    visited.add(e);
    if (isSymbol(e))
      return BaseCompiler.pointOrPointListUnion(e.type.type) !== undefined;
    if (!isFunction(e)) return false;
    if (
      calls &&
      e.operator !== 'Function' &&
      callTypeAdmitsInlinedPoint(e.type.type)
    )
      return true;
    return e.ops.some(walk);
  };
  return walk(expr);
}

/**
 * The value that the compiled code computes in place of the symbol `e`, or
 * `undefined` when `e` is not a symbol or the compiled code reads it as an
 * input.
 *
 * A symbol with a value that no `vars` entry, binder (a parameter, an index,
 * a local) or target constant resolves is compiled as its value, written
 * into the code (`tryFoldKnownSymbol()` in `base-compiler.ts`). A later
 * assignment does not change the compiled code, so the value tells what the
 * code computes. The conditions are those of the base compiler: a `vars`
 * key is never folded, and a definition that a checkpoint restore marked
 * `_rewound` has no value.
 */
function inlinedSymbolValue(
  e: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  if (!isSymbol(e)) return undefined;
  const s = e.symbol;
  if (target.varsKeys?.has(s) === true || target.boundVars?.has(s) === true)
    return undefined;
  if ((e.valueDefinition as { _rewound?: true } | undefined)?._rewound)
    return undefined;
  // The value is read first: `target.var` has effects on some targets (it
  // records an input read from the vars object, or allocates a temporary),
  // and a symbol with no value is an input that this rewrite leaves alone.
  const value = e.engine._getSymbolValue(s);
  if (value === undefined) return undefined;
  if (target.var(s) !== undefined) return undefined;
  return value;
}

/**
 * `expr` with each symbol whose type admits a point and a list of points
 * (`BaseCompiler.pointOrPointListUnion()`) replaced by its value, when the
 * compiled code computes that value anyway (`inlinedSymbolValue`) and the
 * value is a point (a `Tuple`). `expr` itself when there is no such symbol.
 *
 * The declared type of such a symbol has no single shape: a point is a
 * vector and a list of points is an array (on a shader target, the two have
 * different shader types). Its value has one. With the value written in
 * place before the compilation, every type, shape and width that the
 * compilation reads comes from an ordinary tuple, and agrees with the code,
 * which is the code of the value.
 *
 * A name that the compiled code binds (`written`: a parameter, a local, an
 * index) is not replaced, and neither is a symbol whose value reads such a
 * name, which the binder would capture. The other symbols keep the
 * reading of their declared type. The value is recorded in
 * `target.symbolDeps`, as `tryFoldKnownSymbol()` records it, because the
 * compiled code holds it.
 */
export function inlinePointValues(
  expr: Expression,
  target: CompileTarget<Expression>,
  written: ReadonlySet<string>
): Expression {
  const values: Record<string, Expression> = {};
  let found = false;
  const visited = new Set<Expression>();
  const walk = (e: Expression): void => {
    if (visited.has(e)) return;
    visited.add(e);
    if (isSymbol(e)) {
      const s = e.symbol;
      if (Object.hasOwn(values, s) || written.has(s)) return;
      if (BaseCompiler.pointOrPointListUnion(e.type.type) === undefined) return;
      const value = inlinedSymbolValue(e, target);
      if (value === undefined || !isFunction(value, 'Tuple')) return;
      if (value.symbols.some((v) => written.has(v))) return;
      // A value of another type than the declared union (a host wrote a
      // 3-D point into the definition of a 2-D `P`) is refused, as
      // `compileSymbol` refuses it where the symbol is read.
      BaseCompiler.assertHeldValueType(e);
      // The expression was rewritten for the engine's angular unit at the
      // compile entry (`rewriteAngularUnit()`), and the stored value was
      // not: the value is rewritten here, alone, so that `Sin(x)` in it is
      // read in degrees in degree mode, and the rest of the expression is
      // not converted a second time.
      values[s] = BaseCompiler.foldedValueInRadians(value, target);
      found = true;
      return;
    }
    if (isFunction(e)) for (const op of e.ops) walk(op);
  };
  walk(expr);
  if (!found) return expr;
  for (const s of Object.keys(values)) target.symbolDeps?.add(s);
  // `rewriteWithBinders()` keeps a node that several parents share as one
  // node, and rewrites it once (`expr.subs()` rewrites it once for each
  // path, which takes a time exponential in the depth of a shared graph).
  // It also leaves an occurrence that a binder of the expression shadows.
  return rewriteWithBinders(expr, (sym, shadowed) =>
    Object.hasOwn(values, sym.symbol) && shadowed?.has(sym.symbol) !== true
      ? values[sym.symbol]
      : sym
  );
}

/**
 * How many function bodies one walk of `inlinePointCalls` may substitute.
 * The bodies of a chain of definitions that each call the one below twice
 * double with each level: 511 bodies for 8 levels took about 0.1 s, and 8191
 * bodies for 12 levels about 1.2 s.
 */
export const MAX_POINT_CALL_INLINES = 512;

/**
 * `expr` with each call of a user function whose type is a union that has a
 * point option and an option that is not a point
 * (`callTypeAdmitsInlinedPoint`) replaced by the body of the function, when
 * that body, with its point values written in place (`inlinePointValues`),
 * is a point or a number. `expr` itself when there is no such call.
 *
 * The signature of such a function was derived from its stored body, which
 * reads the union symbol, so the type of the call is the union (or, for
 * `f(t) := At(P, 1)`, `missing | number | tuple<number, number>`), and the
 * shape and type readings at the call site have no width for it
 * (`f(t) := t·P` and `f(x).x`). The body with the point in place is an
 * ordinary point expression, `x·(1, 2)`. The stored definition and its
 * signature do not change. The body is the one that
 * `BaseCompiler.substitutedUserFunctionBody()` gives, under its soundness
 * conditions (a pure single-statement literal, arguments that are scalars
 * or literal points, no capture). A node that binds names (a `Block`, a
 * `Sum`) and a `Function` literal are left as written, as the root
 * inlining of list-valued calls leaves a node whose scope it cannot reuse.
 * The name of each substituted function is recorded in `target.symbolDeps`,
 * as that inlining records it, because the compiled code holds its body.
 *
 * The results for a node are not kept while a callee body is walked, so a
 * chain of definitions that each call the one below twice (`f₀(t) := t·P`,
 * `fₙ(t) := fₙ₋₁(t) + fₙ₋₁(t + 1)`) substitutes a number of bodies that
 * doubles with each level. One walk substitutes at most
 * `MAX_POINT_CALL_INLINES` bodies. When a walk needs more, the error that
 * `overBudget` gives is thrown (a shader target, which has no type for a
 * call left as written, so the compilation would fail on it anyway). With no
 * `overBudget`, the remaining calls are left as written, and they compile
 * as they do without this rewrite.
 *
 * A call with an argument for which `keepsCall` answers true is left as
 * written too (`inlinePointValuesAtRoot` gives an argument that runs code of
 * the caller).
 */
export function inlinePointCalls(
  expr: Expression,
  target: CompileTarget<Expression>,
  enclosing?: EnclosingDefinition,
  overBudget?: (head: string, call: Expression) => Error,
  keepsCall?: (argument: Expression) => boolean
): Expression {
  if (target.userFunctions === undefined) return expr;
  const engine = expr.engine as unknown as ComputeEngine;
  const onPath = new Set<string>();
  let inlinesLeft = MAX_POINT_CALL_INLINES;
  // An expression is a graph that can share a node between many parents,
  // and a walk of every path takes a time exponential in its depth (ROADMAP
  // CE-584). The result for a node depends on the node, on the enclosing
  // names and on the callees being substituted above it (`onPath`, where a
  // call of one of them is left as written), so it is kept for each
  // combination. A callee body that holds a shared graph is then walked
  // once per node too.
  const memo = new Map<
    EnclosingDefinition | undefined,
    Map<string, Map<Expression, Expression>>
  >();
  const visit = (e: Expression, within?: EnclosingDefinition): Expression => {
    if (!isFunction(e) || e.operator === 'Function') return e;
    let byPath = memo.get(within);
    if (byPath === undefined) memo.set(within, (byPath = new Map()));
    const pathKey = [...onPath].sort().join('\u0000');
    let seen = byPath.get(pathKey);
    if (seen === undefined) byPath.set(pathKey, (seen = new Map()));
    const known = seen.get(e);
    if (known !== undefined) return known;
    const result = visitNode(e, within);
    seen.set(e, result);
    return result;
  };
  const visitNode = (
    e: Expression,
    within?: EnclosingDefinition
  ): Expression => {
    if (!isFunction(e)) return e;
    // A head that the caller overrides (the `functions` or `operators`
    // option) is left as written, and so is everything under it: the
    // caller's implementation replaces the emission and receives the node's
    // own operands (`CompileTarget.unrollSkipHeads`). For a function-form
    // `operators`, `unrollSkipHeads` holds only the heads that the unroll
    // rewrites, so the option itself is asked too
    // (`CompileTarget.overridesHead`): with `operators` mapping `f` to `+`,
    // `f(x, y)` is `x + y`, not the body of `f`.
    if (
      target.unrollSkipHeads?.has(e.operator) === true ||
      target.overridesHead?.(e.operator) === true
    )
      return e;
    const bound = boundVariableNames(e);
    if (bound.length > 0) {
      // A node that binds names is entered with those names as local
      // names, so that a callee body whose free symbol one of them would
      // capture is declined (`substitutedUserFunctionBody`). It is rebuilt
      // on its own scope, or left as written when that scope cannot be
      // reused (`scopeForRebuild`).
      if (e.localScope === undefined) return e;
      const inner: EnclosingDefinition = {
        scalarNames: within?.scalarNames ?? new Set<string>(),
        localNames: new Set([...(within?.localNames ?? []), ...bound]),
      };
      const ops = e.ops.map((op) => visit(op, inner));
      if (ops.every((op, i) => op === e.ops[i])) return e;
      const scope = scopeForRebuild(e.localScope, engine, e.operator, ops);
      if (scope === undefined) return e;
      return engine.function(e.operator, ops, { scope });
    }
    const ops = e.ops.map((op) => visit(op, within));
    const node = ops.every((op, i) => op === e.ops[i])
      ? e
      : engine.function(e.operator, ops);
    if (!isFunction(node)) return node;
    if (!callTypeAdmitsInlinedPoint(node.type.type)) return node;
    const h = node.operator;
    if (onPath.has(h)) return node;
    // A call of a name that the enclosing code binds is a call of that
    // bound value, not of the user function of the same name.
    if (within?.localNames.has(h) === true) return node;
    // The substitution writes an argument at each occurrence of its
    // parameter, so an argument whose value differs between two evaluations
    // would be evaluated more than once: with `r := Random()`, `f(r)` for
    // `f(t) := (t − t²)·P` would draw two numbers. `isPure` of a symbol does
    // not read its value, so the test is the transitive one.
    if (node.ops.some((a) => BaseCompiler.foldValueImpure(a))) return node;
    // An argument that runs code of the caller, which can have effects, is
    // not written at each occurrence of its parameter either (`keepsCall`).
    if (keepsCall !== undefined && node.ops.some(keepsCall)) return node;
    const body = BaseCompiler.substitutedUserFunctionBody(
      engine,
      h,
      node.ops,
      target,
      within
    );
    if (body === undefined) return node;
    if (inlinesLeft <= 0) {
      if (overBudget !== undefined) throw overBudget(h, node);
      return node;
    }
    inlinesLeft -= 1;
    onPath.add(h);
    try {
      const inner = visit(body, within);
      const point = inlinePointValues(
        inner,
        target,
        new Set([
          ...(within?.localNames ?? []),
          ...reachableSymbolNames(inner).written,
        ])
      );
      // The body is kept when it is a point, or a number
      // (`f(t) := P.x` gives `3` for `P := (3, 4)`): every target has a
      // type for these. A number type can be a name (`real`), a range
      // (`integer` from 0 up, for `Square(P.x)`) or a literal value, so it
      // is tested with `isSubtype`. A body that is still a union is no
      // better than the call, and the call is left as written.
      const t = resolveTypeForCompilation(point.type.type);
      const isPoint = typeof t !== 'string' && t.kind === 'tuple';
      if (!isPoint && !isSubtype(point.type.type, 'number')) return node;
      target.symbolDeps?.add(h);
      return point;
    } finally {
      onPath.delete(h);
    }
  };
  return visit(expr, enclosing);
}

/**
 * Whether `inlinePointCalls` tries to replace a call of type `type` by the
 * body of the function. This is the case for a union that admits a point
 * and a list of points (`BaseCompiler.pointOrPointListUnion()`), and for any
 * other union that has a `tuple` option and an option that is not a tuple.
 * The signature of a function whose body reads a coordinate of such a
 * symbol (`f(t) := At(P, 1)`) has the second kind of type,
 * `missing | number | tuple<number, number>`: the coordinate of a point or
 * the first point of a list of points. Neither union has a single shape. A
 * union of tuples only, or a type that is not a union, is left to the
 * ordinary compilation.
 */
function callTypeAdmitsInlinedPoint(type: Type): boolean {
  if (BaseCompiler.pointOrPointListUnion(type) !== undefined) return true;
  const t = resolveTypeForCompilation(type);
  if (typeof t === 'string' || t.kind !== 'union') return false;
  const isTupleArm = (arm: Type): boolean => {
    const a = resolveTypeForCompilation(arm);
    return typeof a !== 'string' && a.kind === 'tuple';
  };
  return t.types.some(isTupleArm) && !t.types.every(isTupleArm);
}

/**
 * Every symbol name in `expr` and in the definition of each user function it
 * reaches, transitively, parameters included. On the shader targets a symbol
 * is emitted with its own name (`gpuCheckIdentifier()` in `gpu-reserved.ts`),
 * so this set holds every identifier that a local, an assignment target, a
 * loop or binder variable or a parameter of the compiled code can have. It
 * also holds names that are only read; that makes the set larger than
 * needed, which is safe for its use in `gpuPlainUniformRead()`
 * (`gpu-random.ts`).
 *
 * `written` is the subset that the compiled code declares or writes: the
 * target of a `Declare` or an `Assign`, a variable bound by a binder (the
 * index of a `Sum`, a `Loop` element), and a parameter of a function literal,
 * the reachable user-function definitions included. A variable of that name
 * exists in the emitted code: on a shader target, it hides a uniform of the
 * same name (`gpuRefuseShadowedVarsSources()` in `gpu-random.ts`), and a
 * point value that reads the name is not written in place of its symbol
 * (`inlinePointValues`).
 *
 * A symbol with a value that no `vars` entry maps is compiled as its value,
 * written into the code (`tryFoldKnownSymbol()` in `base-compiler.ts`), so
 * the walk also reaches that value: a local or a binder inside it is emitted
 * with its own name.
 */
export function reachableSymbolNames(
  expr: Expression,
  vars?: Readonly<Record<string, unknown>>
): {
  all: ReadonlySet<string>;
  written: ReadonlySet<string>;
} {
  const out = new Set<string>();
  const written = new Set<string>();
  const expanded = new Set<string>();
  const expandedValues = new Set<string>();
  const walkValue = (e: Expression, name: string): void => {
    if (vars !== undefined && Object.hasOwn(vars, name)) return;
    if (expandedValues.has(name)) return;
    expandedValues.add(name);
    const value = e.engine?._getSymbolValue(name);
    if (value !== undefined) walk(value);
  };
  const walkUserFunction = (e: Expression, name: string): void => {
    if (expanded.has(name)) return;
    expanded.add(name);
    const engine = e.engine;
    if (engine === undefined) return;
    const literal = BaseCompiler.userFunctionLiteral(engine, name);
    if (literal !== undefined) walk(literal);
  };
  // An expression is a graph that can share a node between many parents. A
  // visit of a node only adds to the sets, and what it adds depends only on
  // the node, so a node is visited once: a walk of the tree that the graph
  // unfolds to can take an exponential time.
  const visited = new Set<Expression>();
  const walk = (e: Expression): void => {
    if (visited.has(e)) return;
    visited.add(e);
    if (isSymbol(e)) {
      out.add(e.symbol);
      walkUserFunction(e, e.symbol);
      walkValue(e, e.symbol);
      return;
    }
    if (isFunction(e)) {
      if (typeof e.operator === 'string' && e.operator !== '')
        walkUserFunction(e, e.operator);
      if (
        (e.operator === 'Declare' || e.operator === 'Assign') &&
        isSymbol(e.ops[0])
      )
        written.add(e.ops[0].symbol);
      const binders = declaredBinders(e, 'post');
      if (binders !== undefined)
        for (const name of binders.visibleFrom.keys()) written.add(name);
      for (const op of e.ops) walk(op);
    }
  };
  walk(expr);
  return { all: out, written };
}
