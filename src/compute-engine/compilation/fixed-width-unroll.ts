import type { Expression, FunctionInterface } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { collectBinderNames } from '../boxed-expression/utils.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import { isTupleShapedType } from '../collection-utils.js';
import {
  functionLiteralParameterName,
  isRestParameter,
} from '../boxed-expression/function-literal.js';

/**
 * Rewrite a collection whose WIDTH is known at compile time into straight-line
 * scalar code, before any target sees the expression.
 *
 * A WIDE literal `List` — written as such, produced by canonicalization, or
 * exposed when a user function is inlined at its call site — is otherwise
 * lowered as a runtime array: the JavaScript target emits `_SYS.bcast`
 * closures and `reduce` calls over it, and the shader and interval targets,
 * whose values are one vector and one interval, fail closed. The interpreter,
 * in contrast, evaluates the same expression to scalar arithmetic. This pass
 * reproduces that scalar shape structurally, so all targets compile it and the
 * JavaScript one emits flat expressions. Measured on the nine-point Voronoi
 * chain of the Desmos state `62urmx2dcm`: `glsl`, `wgsl` and `interval-js`
 * went from a decline to a compile, and the JavaScript kernel from 6.1 to 0.9
 * microseconds per sample.
 *
 * A rule that fans a list out into one node per element runs only on a WIDE
 * list, because a narrow one already has a native lowering on every target;
 * the reduction rule runs at every width. {@link MIN_UNROLLED_WIDTH} states
 * both, and why.
 *
 * The pass is TARGET INDEPENDENT: it only rewrites where the rewritten form
 * computes the same value as the original for every input, so it is applied
 * once at each compile entry rather than per target.
 *
 * Every node with no rewrite beneath it is returned AS IS, so structure the
 * pass does not act on is never re-canonicalized. A node that does change and
 * owns a SCOPE is rebuilt onto that same scope (`rebuild` below), which is
 * what lets the pass reach into a user-function body — canonicalization wraps
 * one in a `Block` that binds the parameters.
 */
export function unrollFixedWidthCollections(
  expr: Expression,
  options?: UnrollOptions
): Expression {
  return rewrite(expr, new WeakSet<Expression>(), options ?? {});
}

/** See {@link unrollFixedWidthCollections}. */
export interface UnrollOptions {
  /**
   * Fold a coordinate accessor over a SINGLE literal point — `PointX((x, y))`
   * to `x`. Off by default: at a compile entry the targets read such a point
   * themselves, the shader ones through a native `vec2`/`vec3`/`vec4` swizzle,
   * and folding it would replace their answer with a different one.
   *
   * The INLINER turns it on. There the accessor reads a point that was
   * substituted for a parameter at the call site, in a body the target could
   * not emit as a definition at all; folding the accessor is what makes that
   * body ordinary scalar code the target compiles.
   */
  readonly foldSingleLiteralPoint?: boolean;

  /**
   * Operator names the CALLER overrode with an implementation of its own (the
   * `functions` and `operators` compilation options). A node with such a head
   * is returned untouched, and the pass does not descend into it either.
   *
   * The caller's implementation replaces the emission of that head, so it
   * receives whatever operands the node carries: an override of `Add` is
   * handed the whole list operand of `Add(s, [a, …, e])` today, and after an
   * unroll it would instead be called once per element and asked to return a
   * list. Which operand an override reads is the caller's business, so the
   * skip is the WHOLE subtree rather than the node alone — that needs no case
   * analysis of what the caller's code looks at.
   *
   * Build it with {@link overriddenCompilationHeads}.
   */
  readonly skipHeads?: ReadonlySet<string>;
}

/**
 * The heads to withhold from the pass, given the caller's `operators` and
 * `functions` compilation options, or `undefined` when the caller overrode
 * nothing (see {@link UnrollOptions.skipHeads}).
 *
 * A RECORD-form `operators` and the `functions` map both name the heads they
 * cover, so the set is their keys. A FUNCTION-form `operators` is opaque — the
 * names it answers for cannot be enumerated — so the pass is withheld from
 * every head it could rewrite, which turns it into a no-op. That is the same
 * answer the constant folder gives an opaque override (`constantFold: false`
 * in `javascript-target.ts`).
 */
export function overriddenCompilationHeads(
  operators:
    | Readonly<Record<string, unknown>>
    | ((op: string) => unknown)
    | undefined,
  functions: Readonly<Record<string, unknown>> | undefined
): ReadonlySet<string> | undefined {
  if (typeof operators === 'function') return REWRITTEN_HEADS;
  const names = [
    ...(functions ? Object.keys(functions) : []),
    ...(operators ? Object.keys(operators) : []),
  ];
  return names.length === 0 ? undefined : new Set(names);
}

/**
 * A rewritten node can expose a further rewrite at the same position — folding
 * `PointX` into a sum of points yields `PointX` applications the point rules
 * fold in turn. The result is re-visited until it settles, with a bound so a
 * rule pair that did not shrink the tree cannot loop. Every rule below either
 * removes an operator (`Map`, a reduction over a literal list) or moves a
 * point accessor strictly closer to a leaf, so the bound is never reached in
 * practice; it exists to fail safe rather than hang the compiler.
 */
const MAX_REWRITE_ROUNDS = 16;

/**
 * The narrowest literal collection whose ELEMENTS this pass fans out.
 *
 * The gate applies to the three rules that produce one node per element: the
 * point accessor over a list of points (rule 1), the `Map` substitution
 * (rule 2), and the arithmetic distribution (rule 4). For those, a collection
 * of four elements or fewer is a shape every target already has a lowering
 * for: `vec2`/`vec3`/`vec4` on the shader targets, the `_SYS.bcast` closure on
 * JavaScript, a list comprehension in Python. Unrolling one would replace a
 * native lowering with a longer one and buy nothing — and on the shader
 * targets it would replace one vector operation with four scalar ones. From
 * five elements up no target has a native fixed-width shape: the collection is
 * either a runtime array or a decline, which is where the fan-out pays.
 *
 * The REDUCTION rule (rule 3) has no width gate, because the claim above is
 * false for it. `Min([a, b, c])` is not a narrow-list lowering anywhere: the
 * interval target's `Min` handler takes the N-ARY shape only, so the `List`
 * operand is compiled on its own and that target has no lowering for a list at
 * all — a three-element `Min` declines today. The n-ary form the rule produces
 * (`Math.min(a, b, c)`, `min(a, b, c)`, a fold of `_IA.min`) is at least as
 * good as a reduce over an array at every width, so rule 3 applies from one
 * element up.
 *
 * Exported because the JavaScript target reads the SAME boundary from the
 * other side. Where this pass fans a literal collection out from five elements
 * up, that target writes out the components of a narrower one — the shapes
 * this pass leaves alone because every target has a native lowering for them.
 * The two must not overlap, so both read this one constant
 * (`staticBroadcastWidth` in `base-compiler.ts`, and the narrow-reduction fold
 * in `javascript-target.ts`).
 */
export const MIN_UNROLLED_WIDTH = 5;

/**
 * `settled` holds every node this pass has already brought to a fixed point.
 * The rewrite is context free — a node rewrites the same way wherever it
 * appears — so re-visiting a settled node can only repeat work. Without the
 * set, each re-visit of a rewritten node would walk its whole subtree again,
 * and a chain of rewrites would cost exponentially more than the tree.
 */
function rewrite(
  expr: Expression,
  settled: WeakSet<Expression>,
  options: UnrollOptions
): Expression {
  if (!isFunction(expr)) return expr;
  if (settled.has(expr)) return expr;

  // A head the caller overrode, and everything under it, is left exactly as
  // written — see {@link UnrollOptions.skipHeads}.
  if (options.skipHeads?.has(expr.operator)) {
    settled.add(expr);
    return expr;
  }

  // A `Function` LITERAL is opaque to this pass. Rebuilding one re-runs the
  // literal canonicalization, which declares the parameter names into a scope
  // of its own and lifts the body, so a rewrite under a lambda would be paid
  // for with a re-scoped literal. Nothing is lost by the skip: the `Map` rule
  // below reads the lambda whole, and rules 1, 3 and 4 need an operand whose
  // TYPE proves it a single number, which a lambda parameter is not.
  if (expr.operator === 'Function') {
    settled.add(expr);
    return expr;
  }

  const ops = expr.ops.map((op) => rewrite(op, settled, options));
  let node: Expression = ops.every((op, i) => op === expr.ops[i])
    ? expr
    : rebuild(expr, ops);

  for (let round = 0; round < MAX_REWRITE_ROUNDS; round++) {
    if (!isFunction(node)) break;
    const next =
      foldPointAccessor(node, options) ??
      tryUnrollMap(node) ??
      unrollReduction(node) ??
      distributeOverList(node);
    if (next === undefined) break;
    node = rewrite(next, settled, options);
  }
  settled.add(node);
  return node;
}

/**
 * `expr` rebuilt with new operands, ONTO ITS OWN SCOPE when it owns one.
 *
 * A scoped node — a `Block`, a `Sum`, a comprehension — must never be rebuilt
 * onto a fresh scope. A fresh scope is parented at the rebuilding site, so a
 * binder nested inside goes on pointing at the ORIGINAL outer scope while the
 * rebuilt node advertises a different one, and the chain from the inner body
 * no longer reaches the outer binder's index. `scopeForRebuild`
 * (`boxed-expression/binding-sites.ts`) reuses the node's own scope and
 * withholds the reuse when the new operands would declare a name the scope
 * does not already bind; `docs/SCOPING-MODEL.md` states the rule.
 *
 * This is what lets the pass descend into the body of a user-function
 * definition, which canonicalization wraps in a `Block` that binds the
 * parameters.
 */
function rebuild(
  expr: Expression & FunctionInterface,
  ops: ReadonlyArray<Expression>
): Expression {
  const ce = expr.engine;
  const scope = expr.localScope;
  if (scope === undefined) return ce.function(expr.operator, ops);
  return ce.function(expr.operator, ops, {
    scope: scopeForRebuild(scope, ce, expr.operator, ops),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 1 — point accessors over a point the compiler can see into
// ─────────────────────────────────────────────────────────────────────────

/** The 1-based coordinate each point accessor reads. */
const POINT_ACCESSOR_POSITION: Readonly<Record<string, number>> = {
  __proto__: null as never,
  PointX: 1,
  PointY: 2,
  PointZ: 3,
};

/**
 * `PointX`/`PointY`/`PointZ` applied to a point the compiler can see into,
 * rewritten to the coordinate itself — `PointX((x, y))` is `x`.
 *
 * Two operands are rewritten. A LITERAL POINT — a `Tuple`, or an all-scalar
 * `PointList` — folds to its coordinate; this is what lets a target with no
 * `PointX` lowering at all compile an inlined body whose point parameter was
 * bound to a literal point. A WIDE literal `List` of points folds to the list
 * of the elements' coordinates — the same value the interpreter broadcasts —
 * and each element may itself be an arithmetic combination of points, since
 * points add and negate componentwise and a scalar multiple scales each
 * coordinate.
 *
 * "Wide" is {@link MIN_UNROLLED_WIDTH}: a narrower list of points is a shape
 * the targets answer for themselves — a component swizzle over a native
 * vector on the shader targets, a documented decline elsewhere — and
 * replacing that answer would be a change for its own sake.
 *
 * Returns `undefined` — leaving the node for the target's own lowering, or
 * its own decline — when the operand is neither of those shapes, when the
 * coordinate is past the arity of a literal point, or when a coordinate the
 * rewrite would DISCARD is impure: the interpreter evaluates the whole point
 * once, so dropping an impure coordinate would change how many times its
 * effect runs.
 */
function foldPointAccessor(
  expr: Expression & FunctionInterface,
  options: UnrollOptions
): Expression | undefined {
  const position = POINT_ACCESSOR_POSITION[expr.operator];
  if (position === undefined || expr.nops !== 1) return undefined;
  const point = expr.op1;
  if (!isFunction(point)) return undefined;
  if (literalPointOperands(point) !== undefined)
    return options.foldSingleLiteralPoint === true
      ? coordinateOf(point, expr.operator, position)
      : undefined;
  if (isUnrollableList(point))
    return coordinateOf(point, expr.operator, position);
  return undefined;
}

/**
 * Is this operand a non-empty literal `List` with at least one element that is
 * not a NUMBER LITERAL?
 *
 * A list of number literals is a compile-time constant: the constant folder
 * answers it whole, and a caller who turned constant folding off asked for the
 * target's own fan-out over the constants, which a rewrite here would replace.
 * This pass exists for a collection whose elements are computed at run time.
 *
 * A list that mixes number literals with symbols is still rewritten, and the
 * node the rewrite builds is STRUCTURAL rather than canonical for that reason:
 * canonicalizing `Add(2, b, 3, d, s)` folds the `2` and the `3` into a `5`
 * before the target's `constantFold: false` option can see either, which is a
 * fold the caller asked this compilation not to make. A structural node keeps
 * the operand list as the rewrite wrote it.
 */
function isNonConstantLiteralList(
  e: Expression
): e is Expression & FunctionInterface {
  return (
    isFunction(e, 'List') && e.nops > 0 && !e.ops.every((op) => isNumber(op))
  );
}

/**
 * Is this operand a literal `List` whose ELEMENTS the fan-out rules may
 * expand? {@link isNonConstantLiteralList}, and WIDE — see
 * {@link MIN_UNROLLED_WIDTH}, which also says why rule 3 does not ask this.
 */
function isUnrollableList(e: Expression): e is Expression & FunctionInterface {
  return isNonConstantLiteralList(e) && e.nops >= MIN_UNROLLED_WIDTH;
}

/**
 * Coordinate `position` (1-based) of `point`, or `undefined` when the pass
 * cannot prove what that coordinate is.
 *
 * `accessor` is the accessor head being folded; it is re-applied at the base
 * case, where the operand is an opaque value whose TYPE is a tuple — an
 * accessor over such an operand already has a lowering on every target, so
 * distributing the accessor down to it is progress.
 */
function coordinateOf(
  point: Expression,
  accessor: string,
  position: number
): Expression | undefined {
  const ce = point.engine;

  const literal = literalPointOperands(point);
  if (literal !== undefined) {
    // A coordinate past the arity of a literal point selects nothing. The
    // targets already have a documented answer for that (absence, or a
    // decline); leave the node to them.
    if (position > literal.length) return undefined;
    // Every OTHER coordinate is discarded by the rewrite. See the purity
    // constraint in `foldPointAccessor`.
    if (literal.some((op, i) => i !== position - 1 && op.isPure !== true))
      return undefined;
    return literal[position - 1];
  }

  if (isFunction(point, 'Add') || isFunction(point, 'List')) {
    // Points add componentwise, and the coordinate of a list of points is the
    // list of the elements' coordinates.
    const parts: Expression[] = [];
    for (const op of point.ops) {
      const part = coordinateOf(op, accessor, position);
      if (part === undefined) return undefined;
      parts.push(part);
    }
    return ce.function(point.operator, parts);
  }

  if (isFunction(point, 'Negate') && point.nops === 1) {
    const part = coordinateOf(point.op1, accessor, position);
    return part === undefined ? undefined : ce.function('Negate', [part]);
  }

  if (isFunction(point, 'Multiply')) {
    // A scalar multiple of a point scales each coordinate. Exactly one factor
    // may be the point; every other factor must be provably a number, so that
    // the product is a scaling and not, say, a second point.
    const factors = point.ops;
    const pointIndexes = factors
      .map((f, i) => (isProvablyScalar(f) ? -1 : i))
      .filter((i) => i >= 0);
    if (pointIndexes.length !== 1) return undefined;
    const part = coordinateOf(factors[pointIndexes[0]], accessor, position);
    if (part === undefined) return undefined;
    return ce.function(
      'Multiply',
      factors.map((f, i) => (i === pointIndexes[0] ? part : f))
    );
  }

  // Base case: an operand whose static type is a tuple is a single point the
  // targets can already read a coordinate from.
  if (isTupleShapedType(point.type.type)) return ce.function(accessor, [point]);

  return undefined;
}

/**
 * The coordinates of a LITERAL single point, or `undefined` for any other
 * operand.
 *
 * A `Tuple` is always one point. An ALL-SCALAR `PointList` is one too —
 * component k is operand k — the same equivalence the interval target relies
 * on (`literalPointOps` in `interval-javascript-target.ts`). Requiring every
 * operand to be provably numeric is what excludes the other `PointList`
 * shapes: a component that is (or may be) a collection is a SOURCE zipped
 * across several points, so operand k is then not component k.
 */
function literalPointOperands(
  point: Expression
): ReadonlyArray<Expression> | undefined {
  if (isFunction(point, 'Tuple')) return point.ops;
  if (
    isFunction(point, 'PointList') &&
    point.nops > 0 &&
    point.ops.every(isProvablyScalar)
  )
    return point.ops;
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 2 — `Map` over a literal list
// ─────────────────────────────────────────────────────────────────────────

/**
 * `Map(callback, [e1, …, eN])` rewritten to one node per element. Two
 * callbacks are rewritten: a `Function` LITERAL, whose body is substituted
 * (see below), and a SYMBOL that names a user-defined function, which is
 * applied to each element ({@link unrollMapOfNamedFunction}).
 *
 * For a `Function` literal, `Map(x ↦ body, [e1, …, eN])` becomes
 * `[body[x := e1], …, body[x := eN]]`.
 *
 * Sound only when:
 *  - the lambda has exactly one named parameter: `Map` hands its callback
 *    ONE argument, the element, and canonicalization rejects a callback of
 *    any other arity as a `callback-arity` error, so only that shape is a
 *    mapping the substitution can reproduce;
 *  - the body binds no name of its own: `subs` is not capture-avoiding, so an
 *    inner binder could rebind the parameter or capture a symbol of an
 *    element;
 *  - the body is pure: an effect in it runs once per element either way, but
 *    only an effect-free body may be duplicated by CSE and by the emitters;
 *  - every element is pure: the body may mention the parameter several times,
 *    and substitution repeats the element at each mention, while the
 *    interpreter evaluates the element once.
 *
 * A list narrower than {@link MIN_UNROLLED_WIDTH} is left to the target's own
 * `Map` lowering.
 */
function tryUnrollMap(expr: Expression): Expression | undefined {
  if (!isFunction(expr, 'Map') || expr.nops !== 2) return undefined;
  const callback = expr.op1;
  const list = expr.op2;
  if (!isUnrollableList(list)) return undefined;
  if (isSymbol(callback))
    return unrollMapOfNamedFunction(callback.symbol, list);
  const lambda = callback;
  if (!isFunction(lambda, 'Function') || lambda.nops !== 2) return undefined;

  // A REST parameter — `["Spread", name]`, spelled `...r` — binds its ONE
  // name to a TUPLE of the arguments from its position onwards, so a mapped
  // `(...r) ↦ …` sees the 1-tuple `(element)` rather than the element itself.
  // `functionLiteralParameterName` returns the bare name for such a parameter,
  // so substituting the element under it would compute something else.
  if (isRestParameter(lambda.ops[1])) return undefined;

  const parameter = functionLiteralParameterName(lambda.ops[1]);
  if (!parameter) return undefined;

  // A canonical `Function` literal wraps its body in a single-statement
  // `Block`; the unrolled elements must be the statement itself, not a block.
  const inner = lambda.op1;
  const body =
    isFunction(inner, 'Block') && inner.nops === 1 ? inner.op1 : inner;
  if (isFunction(body, 'Block')) return undefined;
  if (body.isPure !== true) return undefined;
  if (collectBinderNames(body).size > 0) return undefined;
  if (!list.ops.every((e) => e.isPure === true)) return undefined;

  return expr.engine.function(
    'List',
    list.ops.map((e) => body.subs({ [parameter]: e }))
  );
}

/**
 * `Map(h, [e1, …, eN])`, where `h` NAMES a user-defined function of one
 * parameter, rewritten to the literal list of the calls `[h(e1), …, h(eN)]`.
 *
 * A bare name is what a caller writes for a function defined once and mapped
 * in several places, and it is the one callback shape the JavaScript target
 * lowered as a runtime `.map` over an array: the interval target, which holds
 * one interval and cannot hold a collection, declined the whole expression.
 * The calls this rewrite writes are the same calls the interpreter makes, so
 * every target compiles them.
 *
 * Sound only when:
 *  - the name resolves to a `Function` LITERAL the user defined — a library
 *    operator name such as `Sin` is left alone, because a target may lower an
 *    operator applied to a collection differently from a list of separate
 *    applications;
 *  - that literal declares exactly one plain named parameter. `Map` calls its
 *    callback with ONE argument, so this is the shape whose call is `h(e)`. A
 *    variadic (rest) parameter binds a TUPLE of the arguments rather than the
 *    element, and a destructuring pattern binds the components of one, so
 *    both are left to the target's own `Map` lowering;
 *  - every element is pure, and so is every call the rewrite writes. The
 *    interpreter evaluates the elements first and applies `h` to them
 *    afterwards, while the unrolled list interleaves the two, and identical
 *    calls in the list are shared by common subexpression elimination and by
 *    the emitters. Both are invisible only when nothing has an effect.
 */
function unrollMapOfNamedFunction(
  name: string,
  list: Expression & FunctionInterface
): Expression | undefined {
  const literal = userFunctionLiteral(list.engine, name);
  // A `Function` literal is `["Function", body, …params]`, so one parameter
  // is two operands.
  if (literal === undefined || literal.nops !== 2) return undefined;
  const parameter = literal.ops[1];
  if (isRestParameter(parameter)) return undefined;
  // A destructuring pattern is a raw `Tuple` operand, for which
  // `functionLiteralParameterName` reports no name.
  if (!functionLiteralParameterName(parameter)) return undefined;
  if (!list.ops.every((e) => e.isPure === true)) return undefined;

  const ce = list.engine;
  const calls = list.ops.map((e) => ce.function(name, [e]));
  if (!calls.every((call) => call.isPure === true)) return undefined;
  return ce.function('List', calls);
}

/**
 * The `["Function", body, …params]` literal the engine holds for a symbol the
 * user defined as a function, or `undefined` for every other name — a library
 * operator, a plain value, an unknown name.
 *
 * Two definition fields carry such a literal, and both are read here. A
 * definition made with `f(x) := …`, `x ↦ …` or `ce.assign(name, lambda)` is an
 * OPERATOR definition that keeps the literal in `_lambdaLiteral`; a symbol
 * whose assigned VALUE is itself a `Function` literal keeps it in the value
 * definition's `value`.
 *
 * `BaseCompiler.userFunctionLiteral` reads the same two fields for the
 * emission side. It is reimplemented here rather than imported, because this
 * pass runs before any target is chosen and must not depend on the compiler
 * class.
 */
function userFunctionLiteral(
  engine: Expression['engine'],
  name: string
): (Expression & FunctionInterface) | undefined {
  // A definition is a tagged union of the two kinds, so each field is read
  // behind the tag test that proves it is there.
  const def = engine.lookupDefinition(name);
  if (def === undefined) return undefined;
  if ('operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (isFunction(literal, 'Function')) return literal;
  }
  if ('value' in def) {
    const value = def.value.value;
    if (isFunction(value, 'Function')) return value;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 3 — a reduction over a literal list of scalars
// ─────────────────────────────────────────────────────────────────────────

/**
 * The n-ary head each reduction over a literal list of scalars becomes:
 * `Min([a, …])` is `Min(a, …)`, `Sum([a, …])` is `a + …`. The n-ary forms keep
 * their head under canonicalization for symbolic operands, so the rewrite does
 * not collapse to something the emitters read differently.
 *
 * `Product` is here for a STRUCTURALLY built tree only: canonicalization
 * turns `Product([a, …])` into `Reduce([a, …], Multiply, 1)`, which the
 * `Reduce` arm of {@link reductionShape} recognizes instead.
 */
const REDUCTION_HEADS: Readonly<Record<string, string>> = {
  __proto__: null as never,
  Min: 'Min',
  Max: 'Max',
  Sum: 'Add',
  Product: 'Multiply',
};

/**
 * The combiners a `Reduce` may carry for this rule, as the bare SYMBOL naming
 * an n-ary head. Each one is ASSOCIATIVE and COMMUTATIVE, which is what makes
 * the left fold the interpreter runs — `F(F(F(init, e1), e2), e3)` — equal to
 * the flat n-ary form `F(init, e1, e2, e3)`. A combiner written as a lambda,
 * or naming anything else, is left to the target's own fold.
 */
const REDUCE_COMBINERS: ReadonlySet<string> = new Set([
  'Add',
  'Multiply',
  'Min',
  'Max',
]);

/**
 * The value that leaves an n-ary head unchanged when it is one of the
 * operands. A `Reduce` seeded with it computes what the seedless fold does, so
 * the rewrite drops the seed rather than emit `1 * a * b`.
 *
 * `Min` and `Max` are absent on purpose: their identity is an infinity, which
 * is not a value a caller writes as a seed, so any seed they carry is kept.
 */
const REDUCTION_IDENTITY: Readonly<Record<string, number>> = {
  __proto__: null as never,
  Add: 0,
  Multiply: 1,
};

/**
 * The n-ary head, the collection and the SEED of a reduction node, or
 * `undefined` when the node is not one this rule rewrites.
 *
 * Two spellings reach the pass. A dedicated head — `Min([a, …])`,
 * `Sum([a, …])` — carries the collection alone. A `Reduce` carries
 * `(collection, combiner, initial?)` in that order, which is the shape
 * canonicalization gives `Product` and `Fold`; its seed is optional, and a
 * seedless fold starts from the FIRST element, so an absent seed simply
 * contributes no operand to the n-ary form.
 */
function reductionShape(expr: Expression & FunctionInterface):
  | {
      head: string;
      list: Expression;
      seed: Expression | undefined;
    }
  | undefined {
  const head = REDUCTION_HEADS[expr.operator];
  if (head !== undefined) {
    if (expr.nops !== 1) return undefined;
    return { head, list: expr.op1, seed: undefined };
  }
  if (!isFunction(expr, 'Reduce') || expr.nops < 2 || expr.nops > 3)
    return undefined;
  const combiner = expr.op2;
  if (!isSymbol(combiner) || !REDUCE_COMBINERS.has(combiner.symbol))
    return undefined;
  return { head: combiner.symbol, list: expr.op1, seed: expr.ops[2] };
}

function unrollReduction(
  expr: Expression & FunctionInterface
): Expression | undefined {
  const reduction = reductionShape(expr);
  if (reduction === undefined) return undefined;
  const { head, list } = reduction;
  // An EMPTY list is left alone: each of these heads has its own identity
  // element for it, which the interpreter supplies and this rewrite would not.
  // Every other width is rewritten — the n-ary form is at least as good as a
  // reduce on every target, see {@link MIN_UNROLLED_WIDTH}.
  if (!isNonConstantLiteralList(list)) return undefined;
  // Only a list of provable numbers. A collection-valued element would make
  // the n-ary form broadcast where the reduction folds. The seed is held to
  // the same test, and for the same reason.
  if (!list.ops.every(isProvablyScalar)) return undefined;
  const seed = reduction.seed;
  if (seed !== undefined && !isProvablyScalar(seed)) return undefined;
  // An IMPURE seed is left alone, whichever way the rewrite would go. Dropping
  // an identity seed would remove its effect, and keeping one would move it
  // ahead of the first element: the fold reads the seed only once it has an
  // element to combine it with, while the n-ary form evaluates its operands
  // from the left.
  if (seed !== undefined && seed.isPure !== true) return undefined;
  const identity = REDUCTION_IDENTITY[head];
  const keepSeed =
    seed !== undefined &&
    !(identity !== undefined && isNumber(seed) && seed.isSame(identity));
  // STRUCTURAL, so the operand list reaches the target exactly as the list
  // held it — see the note on `isNonConstantLiteralList` about the numeric
  // fold a canonical rebuild would make behind `constantFold: false`.
  return expr.engine.function(head, keepSeed ? [seed, ...list.ops] : list.ops, {
    form: 'structural',
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 4 — scalar-versus-list arithmetic
// ─────────────────────────────────────────────────────────────────────────

/**
 * The heads whose lowering over a collection operand is ELEMENT-WISE — the
 * heads the JavaScript target broadcasts through `_SYS.bcast`. For these, and
 * only these, `op(s, [a, b])` and `[op(s, a), op(s, b)]` are the same value.
 *
 * `Equal`/`NotEqual` and the ordering relations are deliberately absent: over
 * two collections the interpreter compares them as WHOLE values rather than
 * element-wise, so an unrolled form would not agree with it.
 */
const ELEMENTWISE_HEADS = new Set([
  'Abs',
  'Add',
  'Arccos',
  'Arcsin',
  'Arctan',
  'Ceil',
  'Cos',
  'Cosh',
  'Divide',
  'Exp',
  'Floor',
  'Ln',
  'Log',
  'Log2',
  'Log10',
  'Multiply',
  'Negate',
  'Power',
  'Round',
  'Sign',
  'Sin',
  'Sinh',
  'Sqrt',
  'Square',
  'Subtract',
  'Tan',
  'Tanh',
]);

/**
 * Every head any rule of this pass can rewrite: the point accessors (rule 1),
 * `Map` (rule 2), the reductions (rule 3) and the element-wise heads (rule 4).
 *
 * Read by {@link overriddenCompilationHeads} for the one case where the
 * overridden heads cannot be enumerated: withholding all of these makes the
 * pass a no-op.
 */
const REWRITTEN_HEADS: ReadonlySet<string> = new Set([
  ...Object.keys(POINT_ACCESSOR_POSITION),
  'Map',
  ...Object.keys(REDUCTION_HEADS),
  'Reduce',
  ...ELEMENTWISE_HEADS,
]);

/**
 * An element-wise head with a WIDE literal list operand (at least
 * {@link MIN_UNROLLED_WIDTH} elements), rewritten to the literal list of the
 * per-element applications: `x - [a, b, c, d, e]` becomes
 * `[x - a, x - b, x - c, x - d, x - e]`.
 *
 * Two shapes are rewritten. With ONE list operand, every other operand must be
 * a provably scalar, PURE number: it is repeated once per element, and an
 * impure one would then run its effect N times where the interpreter runs it
 * once. (Repeating a pure operand is a code-size matter only — common
 * subexpression elimination binds a repeated pure subtree to a temporary.)
 * With TWO OR MORE list operands, they must all have the same literal width
 * and every element of every one of them must be PURE — the zip interleaves
 * the lists, so an impure element would run in a different order. Anything
 * else — a list whose width is not literal, or two literal lists of different
 * widths — is left to the target's own broadcast lowering.
 */
function distributeOverList(
  expr: Expression & FunctionInterface
): Expression | undefined {
  if (!ELEMENTWISE_HEADS.has(expr.operator)) return undefined;
  const ops = expr.ops;
  if (ops.length === 0) return undefined;

  const listOps = ops.map((op) =>
    isUnrollableList(op) && op.ops.every(isProvablyScalar) ? op.ops : undefined
  );
  const width = listOps.find((l) => l !== undefined)?.length;
  if (width === undefined) return undefined;
  if (listOps.some((l) => l !== undefined && l.length !== width))
    return undefined;
  // A remaining operand must be a scalar the rewrite may repeat. A list-shaped
  // operand whose width is not literal falls here too, and stops the rewrite.
  if (
    !ops.every(
      (op, i) =>
        listOps[i] !== undefined || (isProvablyScalar(op) && op.isPure === true)
    )
  )
    return undefined;
  // With TWO OR MORE list operands the rewrite ZIPS them, which INTERLEAVES
  // their elements: `op([e1, e2], [f1, f2])` evaluates e1, f1, e2, f2 where
  // the original evaluates e1 and e2, then f1 and f2. Two impure elements
  // would then draw in a different order — under a seeded engine that pairs
  // different `Random()` draws with each other
  // (`docs/RANDOMNESS-MODEL.md`) — so every element of every list must be
  // pure. With ONE list the rewrite keeps the elements in their original
  // order, and the other operands are already required to be pure above, so
  // that case needs no gate.
  if (
    listOps.filter((l) => l !== undefined).length > 1 &&
    !listOps.every((l) => l === undefined || l.every((e) => e.isPure === true))
  )
    return undefined;

  const ce = expr.engine;
  const elements: Expression[] = [];
  for (let k = 0; k < width; k++)
    elements.push(
      ce.function(
        expr.operator,
        ops.map((op, i) => listOps[i]?.[k] ?? op),
        // STRUCTURAL, for the reason given on `isNonConstantLiteralList`.
        { form: 'structural' }
      )
    );
  return ce.function('List', elements);
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * Is this operand provably a single number — never a collection?
 *
 * `type.matches('number')` is the same test the interval target uses to
 * recognize an all-scalar `PointList`. It is deliberately strict: a symbol of
 * type `unknown` may hold a list at run time, where a rewrite that assumed a
 * scalar would zip against the wrong shape.
 */
function isProvablyScalar(op: Expression): boolean {
  return op.type.matches('number');
}
