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
  isPointElementType,
  resolveTypeAlias,
} from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';
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

  /**
   * The compilation's iteration budget (`CompileTarget.iterationBudget`),
   * when the target has one. The JavaScript `PointList` lowering caps the
   * zip of column sources at this many points, so a rewrite that reads a
   * column PAST the zip — the column projection of rule 1 — is withheld when
   * the column is wider than the budget: the projected column would hold
   * every element where the zipped point list holds the budget's worth.
   */
  readonly iterationBudget?: number;

  /**
   * Does the named symbol read LIVE SOURCE — a `vars` entry whose value is a
   * string, spliced verbatim into the emitted code? Such source can count
   * its own reads, log, or draw a number, so a rewrite that stops evaluating
   * a subexpression reading it changes behavior. The column projection of
   * rule 1 discards every other column of the point list and is withheld
   * when one of them reads such a symbol. Absent means no symbol does.
   */
  readonly readsLiveSource?: (name: string) => boolean;

  /**
   * The narrowest literal list the fan-out rules (the point accessor over a
   * list of points, `Map`, the element-wise heads) rewrite. Defaults to
   * {@link MIN_UNROLLED_WIDTH}, below which every target with a native
   * narrow-list lowering answers for itself. A target with NO list lowering
   * at all — the interval target, whose values are one interval each — sets
   * `1`: for it a list of any width is either fanned out here or a decline.
   */
  readonly minWidth?: number;

  /**
   * Also fan out a literal list of NUMBER LITERALS. Off by default: such a
   * list is a compile-time constant the constant folder answers whole, and a
   * caller who turned constant folding off asked for the target's own
   * fan-out over the constants. The interval target sets it: its constant
   * fold works on emitted code, and a list has none.
   */
  readonly unrollConstantLists?: boolean;

  /**
   * Write a `Comprehension` over LITERAL domains out as the literal list of
   * its substituted bodies (rule 6). Off by default: a target with a loop
   * lowering for a comprehension keeps it. The shader targets set it: they
   * have no dynamic arrays, and a comprehension of a small, statically known
   * size is a fixed-size array literal there.
   */
  readonly unrollComprehensions?: boolean;
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
 * A target with NO native list lowering — the interval target, whose values
 * are one interval each — lowers this floor through `UnrollOptions.minWidth`
 * (and `unrollConstantLists`): for it, a list of any width is either fanned
 * out here or a decline.
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
      tryUnrollMap(node, options) ??
      unrollReduction(node) ??
      distributeOverList(node, options) ??
      foldLiteralIndex(node, options) ??
      unrollComprehension(node, options) ??
      distributeSelection(node, options);
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
 * "Wide" is {@link MIN_UNROLLED_WIDTH}, or the narrower floor a target sets
 * through `UnrollOptions.minWidth`: a narrower list of points is a shape the
 * targets answer for themselves — a component swizzle over a native vector on
 * the shader targets, a documented decline elsewhere — and replacing that
 * answer would be a change for its own sake. The interval target, which has
 * no list lowering at all, sets the floor to one element.
 *
 * A third operand is a `PointList` built from COLUMNS — one list per
 * coordinate, zipped into points (`PointList([x₁, x₂, x₃], [y₁, y₂, y₃])`).
 * Its coordinate is the column itself, cut to the shortest column
 * (`projectPointListColumn`), so the accessor folds to that column when the
 * columns are provably the same width: the point list is then never built,
 * where the targets built every point only to read one coordinate back out
 * of each (the Tycho code-generation audit of 0.128.9 measured a three-point
 * list built once per row and projected three times, records 683–748).
 *
 * A fourth operand is POINT ARITHMETIC over a wide literal list of points —
 * a sum, a negation or a scalar multiple with such a list somewhere among its
 * point operands (`0.3·(t, t) + 4·[(x₁, y₁), …]`). Points add and scale
 * coordinate by coordinate, and a single point added to a list of points is
 * added to each of them, which is what a number added to a list of numbers
 * does too. So the coordinate of the arithmetic is the same arithmetic over
 * the coordinates (`0.3·t + 4·[x₁, …]`), and the points are never built. The
 * targets otherwise build every point, transform every coordinate, and read
 * one coordinate back: the Tycho code-generation audit of 0.131.3 measured a
 * list of 7,225 two-coordinate points transformed whole to read its x
 * coordinates (document `woeywky0kj`, a 295,869-character kernel). The width
 * floor is checked once, over the whole arithmetic: at least one list in it
 * must be wide. Arithmetic over single points, or over narrow lists only, is
 * left to the targets, for the reason given above.
 *
 * Returns `undefined` — leaving the node for the target's own lowering, or
 * its own decline — when the operand is none of those shapes, when the
 * coordinate is past the arity of a literal point, or when a coordinate the
 * rewrite would DISCARD is impure or reads code the caller supplied
 * (`readsCallerSource`): the interpreter evaluates the whole point once, so
 * dropping such a coordinate would change how many times its effect runs.
 */
function foldPointAccessor(
  expr: Expression & FunctionInterface,
  options: UnrollOptions
): Expression | undefined {
  const position = POINT_ACCESSOR_POSITION[expr.operator];
  if (position === undefined || expr.nops !== 1) return undefined;
  const point = expr.op1;
  if (!isFunction(point)) return undefined;
  // A point whose head the caller overrode is emitted by the caller's own
  // implementation, which receives the node's operands; folding the accessor
  // would drop that implementation. The walk skips such a node itself, but
  // this rule reads it from the accessor above it.
  if (options.skipHeads?.has(point.operator)) return undefined;
  if (literalPointOperands(point) !== undefined)
    return options.foldSingleLiteralPoint === true
      ? coordinateOf(point, expr.operator, position, options)
      : undefined;
  if (isUnrollableList(point, options))
    return coordinateOf(point, expr.operator, position, options);
  if (isFunction(point, 'PointList'))
    return projectPointListColumn(point, position, options);
  if (isPointArithmeticOverWideList(point, position, options))
    return coordinateOf(point, expr.operator, position, options);
  return undefined;
}

/**
 * Is `point` a sum, a negation or a scalar multiple with a WIDE literal list
 * (`isUnrollableList`) among its point operands, at any depth of such
 * arithmetic? The walk follows exactly the operands `coordinateOf` reads a
 * coordinate from, so a list in a position that is not a point operand — a
 * provably scalar factor — does not count.
 *
 * The rule is withheld on a target that writes constant lists out element by
 * element (`UnrollOptions.unrollConstantLists`, the interval target) when a
 * list the walk reaches has a NUMBER LITERAL at `position` in every point.
 * The projected list would be a constant list of numbers, which the
 * element-wise rule then fans out with no upper width: the 7,225-point
 * witness named on `foldPointAccessor` became a 202,510-character interval
 * kernel, where the unprojected arithmetic compiles to a 413-character one
 * that reads the point table through the run-time broadcast. On a target that
 * keeps a constant list whole, the projection has no such cost.
 */
function isPointArithmeticOverWideList(
  point: Expression & FunctionInterface,
  position: number,
  options: UnrollOptions
): boolean {
  const projectsToConstants = (list: Expression & FunctionInterface) =>
    list.ops.every((element) => {
      const coordinates = literalPointOperands(element);
      return (
        coordinates !== undefined &&
        position <= coordinates.length &&
        isNumber(coordinates[position - 1])
      );
    });
  let wide = false;
  let constant = false;
  const walk = (e: Expression, depth: number): void => {
    if (!isFunction(e)) return;
    if (depth > 0 && e.operator === 'List') {
      if (isUnrollableList(e, options)) wide = true;
      if (e.nops > 0 && projectsToConstants(e)) constant = true;
      return;
    }
    if (e.operator === 'Add' || e.operator === 'Negate')
      for (const op of e.ops) walk(op, depth + 1);
    else if (e.operator === 'Multiply')
      for (const op of e.ops) if (!isProvablyScalar(op)) walk(op, depth + 1);
  };
  walk(point, 0);
  return wide && !(options.unrollConstantLists === true && constant);
}

/**
 * Coordinate `position` (1-based) of a `PointList` built from columns: the
 * column at that position, when reading it whole is what zipping the columns
 * and reading the coordinate back would answer. `undefined` otherwise.
 *
 * The zip pairs the columns element by element and stops at the shortest
 * column (the pairing contract of `docs/BROADCAST-MODEL.md`), and a scalar
 * component is repeated for every point. So the column IS the coordinate when
 * every other column has the same width — proven from the structure of each
 * column (`staticListWidth`) rather than read from a declared type, which a
 * value handed to the compiled code through `vars` can contradict — and no
 * other component shortens the zip. A scalar slot at the read position is
 * left alone: its coordinate is that scalar repeated, which the targets
 * already emit. Every discarded column must be pure, for the reason
 * `foldPointAccessor` gives, and must neither read live caller source
 * (`UnrollOptions.readsLiveSource`) nor contain a head the caller overrode
 * (`UnrollOptions.skipHeads`) — either would stop running code the caller
 * supplied. The column must fit the iteration budget
 * (`UnrollOptions.iterationBudget`), where the target has one; a target
 * without one compiles the column as it compiles that list anywhere else.
 */
function projectPointListColumn(
  point: Expression & FunctionInterface,
  position: number,
  options: UnrollOptions
): Expression | undefined {
  if (point.nops < position) return undefined;
  const column = point.ops[position - 1];
  const width = staticListWidth(column);
  if (width === undefined) return undefined;
  for (let i = 0; i < point.nops; i++) {
    if (i === position - 1) continue;
    const other = point.ops[i];
    if (other.isPure !== true || readsCallerSource(other, options))
      return undefined;
    if (isProvablyScalar(other)) continue;
    if (staticListWidth(other) !== width) return undefined;
  }
  const budget = options.iterationBudget;
  if (budget !== undefined && Math.floor(budget) < width) return undefined;
  return column;
}

/**
 * Does `e` emit code the CALLER supplied — a symbol mapped to live source
 * (`UnrollOptions.readsLiveSource`) or an application of a head the caller
 * overrode (`UnrollOptions.skipHeads`), anywhere in its subtree? A rewrite
 * that stops evaluating such a subtree stops running the caller's code, which
 * may count its own calls or draw a number, so the rules that DISCARD a
 * subexpression refuse one that answers `true`.
 */
export function readsCallerSource(
  e: Expression,
  options: UnrollOptions
): boolean {
  if (isSymbol(e)) return options.readsLiveSource?.(e.symbol) === true;
  if (!isFunction(e)) return false;
  if (options.skipHeads?.has(e.operator) === true) return true;
  return e.ops.some((op) => readsCallerSource(op, options));
}

/**
 * The number of elements of a list the pass can see the width of: a literal
 * `List` of provably scalar elements, or a literal `Range` when `ranges` is
 * set, through every head that applies element-wise over such a list and
 * keeps its width — the arithmetic and function heads, the relations, a
 * `Which`/`If` in its element-wise mode, a `PointList` zipped from columns
 * ({@link indexedOperands} lists them and the operand mix each admits).
 * `undefined` for any other operand: a declared width is not read, because
 * a value handed to the compiled code through `vars` is never checked
 * against its declared type. Read by the column projection
 * (`projectPointListColumn`), by the literal index fold (`foldLiteralIndex`)
 * and by the selection fan-out (`distributeSelection`); `indexInto` walks
 * exactly the heads this function walks.
 *
 * A `Range` is a compile-time constant that no target builds as a list; the
 * rules that INDEX into the width read through it (`ranges`), while the
 * column projection, which hands the column on whole, does not.
 */
function staticListWidth(e: Expression, ranges = false): number | undefined {
  if (!isFunction(e)) return undefined;
  if (e.operator === 'List')
    return e.ops.every(isProvablyScalar) ? e.nops : undefined;
  if (e.operator === 'Range') {
    if (!ranges) return undefined;
    return literalRangeCount(e);
  }
  const indexed = indexedOperands(e);
  if (indexed === undefined) return undefined;
  let width: number | undefined;
  for (const op of indexed) {
    const w = staticListWidth(op, ranges);
    if (w === undefined || (width !== undefined && w !== width))
      return undefined;
    width = w;
  }
  return width;
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
function isUnrollableList(
  e: Expression,
  options: UnrollOptions
): e is Expression & FunctionInterface {
  if (!isFunction(e, 'List') || e.nops === 0) return false;
  if (options.unrollConstantLists !== true && !isNonConstantLiteralList(e))
    return false;
  return e.nops >= (options.minWidth ?? MIN_UNROLLED_WIDTH);
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
  position: number,
  options: UnrollOptions
): Expression | undefined {
  return coordinateAndArity(point, accessor, position, options)?.coordinate;
}

/**
 * What the pass can prove about the points an operand holds.
 *
 * `arity` is how many coordinates each point has, or `undefined` when the
 * pass cannot name one count: a value typed as a bare `tuple`, or a list
 * whose points do not all have the same count (a valid list on its own, but
 * not one a point can be added to). `width` is how many points a written-out
 * list holds, or `undefined` for a single point.
 */
type PointShape = { arity: number | undefined; width: number | undefined };

/**
 * {@link coordinateOf}, together with the shape of the points the operand
 * holds ({@link PointShape}).
 *
 * The shape is what keeps the rewrite from answering where the interpreter
 * reports an error. Points of different arities do not add: `(a, b) +
 * (1, 2, 3)` is an `incompatible-type` error, and so is a point added to a
 * list that holds a point of another arity. Two lists of points of different
 * widths do not add either (`incompatible-dimensions`). The coordinates alone
 * would add without complaint (`a + 1`), and the check the target makes on
 * the points at run time would be gone with the points. So a sum is rewritten
 * only when every operand has a PROVEN arity and they all agree, and when no
 * two written-out lists among its operands differ in width. A sum with an
 * operand of unknown arity — a symbol typed as a bare `tuple` — is left to
 * the target.
 */
function coordinateAndArity(
  point: Expression,
  accessor: string,
  position: number,
  options: UnrollOptions
): ({ coordinate: Expression } & PointShape) | undefined {
  const ce = point.engine;

  // A head the caller overrode is emitted by the caller's implementation,
  // which receives the node's operands. The rewrite would hand it coordinates
  // where it is handed points today, so it stops at such a head, at any depth.
  if (isFunction(point) && options.skipHeads?.has(point.operator) === true)
    return undefined;

  const literal = literalPointOperands(point);
  if (literal !== undefined) {
    // A coordinate past the arity of a literal point selects nothing. The
    // targets already have a documented answer for that (absence, or a
    // decline); leave the node to them.
    if (position > literal.length) return undefined;
    // Every OTHER coordinate is discarded by the rewrite. See the purity
    // constraint in `foldPointAccessor`.
    if (
      literal.some(
        (op, i) =>
          i !== position - 1 &&
          (op.isPure !== true || readsCallerSource(op, options))
      )
    )
      return undefined;
    return {
      coordinate: literal[position - 1],
      arity: literal.length,
      width: undefined,
    };
  }

  if (isFunction(point, 'Add') || isFunction(point, 'List')) {
    // Points add componentwise, and the coordinate of a list of points is the
    // list of the elements' coordinates.
    const parts: Expression[] = [];
    const shapes: PointShape[] = [];
    for (const op of point.ops) {
      const part = coordinateAndArity(op, accessor, position, options);
      if (part === undefined) return undefined;
      parts.push(part.coordinate);
      shapes.push(part);
    }
    // One arity when every operand has a proven one and they all agree.
    const arities = new Set(shapes.map((shape) => shape.arity));
    const [firstArity] = arities;
    const arity = arities.size === 1 ? firstArity : undefined;
    const coordinate = ce.function(point.operator, parts);
    if (point.operator === 'List')
      return { coordinate, arity, width: point.nops };
    // The operands of a sum must agree: see the shape rule above.
    const widths = new Set(
      shapes.map((shape) => shape.width).filter((w) => w !== undefined)
    );
    if (point.nops > 1 && (arity === undefined || widths.size > 1))
      return undefined;
    const [width] = widths;
    return { coordinate, arity, width };
  }

  if (isFunction(point, 'Negate') && point.nops === 1) {
    const part = coordinateAndArity(point.op1, accessor, position, options);
    if (part === undefined) return undefined;
    return { ...part, coordinate: ce.function('Negate', [part.coordinate]) };
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
    const part = coordinateAndArity(
      factors[pointIndexes[0]],
      accessor,
      position,
      options
    );
    if (part === undefined) return undefined;
    return {
      ...part,
      coordinate: ce.function(
        'Multiply',
        factors.map((f, i) => (i === pointIndexes[0] ? part.coordinate : f))
      ),
    };
  }

  // Base case: an operand whose static type is a tuple is a single point the
  // targets can already read a coordinate from.
  if (isTupleShapedType(point.type.type))
    return {
      coordinate: ce.function(accessor, [point]),
      arity: tupleTypeArity(point.type.type),
      width: undefined,
    };

  return undefined;
}

/**
 * The number of elements of a tuple type, when the type states it: a
 * parameterized tuple. `undefined` for the bare `tuple`. A transparent alias
 * is unfolded first; a nominal reference stays opaque.
 */
function tupleTypeArity(t: Readonly<Type>): number | undefined {
  const resolved = resolveTypeAlias(t);
  return typeof resolved !== 'string' && resolved.kind === 'tuple'
    ? resolved.elements.length
    : undefined;
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
 * A list narrower than {@link MIN_UNROLLED_WIDTH} — or than the floor a target
 * sets through `UnrollOptions.minWidth` — is left to the target's own `Map`
 * lowering.
 */
function tryUnrollMap(
  expr: Expression,
  options: UnrollOptions
): Expression | undefined {
  if (!isFunction(expr, 'Map') || expr.nops !== 2) return undefined;
  const callback = expr.op1;
  const list = expr.op2;
  if (!isUnrollableList(list, options)) return undefined;
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
  // A singleton sum or product is its sole value. Keep it directly so the
  // target cannot interpret a one-operand Multiply as a prefix operator,
  // and so an identity addition does not change negative zero.
  if (!keepSeed && list.nops === 1 && (head === 'Add' || head === 'Multiply'))
    return list.op1;
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
 * The relations are deliberately absent: `Equal`/`NotEqual` over two
 * collections compare them as WHOLE values rather than element-wise, and the
 * compiled relations have their own element-wise lowering with its own
 * treatment of an absent cell, which a fan-out to scalar comparisons would
 * replace. A literal index is still pushed through a relation
 * ({@link indexedOperands}), which keeps one position and drops none.
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
  'Mod',
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
 * `Map` (rule 2), the reductions (rule 3), the element-wise heads (rule 4)
 * a literal index (rule 5), a comprehension over literal domains (rule 6)
 * and a selection over a list-shaped condition (rule 7).
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
  'At',
  'Comprehension',
  'Which',
  'If',
]);

/**
 * An element-wise head with a WIDE literal list operand (at least
 * {@link MIN_UNROLLED_WIDTH} elements, or the floor a target sets through
 * `UnrollOptions.minWidth`), rewritten to the literal list of the
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
  expr: Expression & FunctionInterface,
  options: UnrollOptions
): Expression | undefined {
  if (!ELEMENTWISE_HEADS.has(expr.operator)) return undefined;
  const ops = expr.ops;
  if (ops.length === 0) return undefined;

  const listOps = ops.map((op) =>
    isUnrollableList(op, options) && op.ops.every(isProvablyScalar)
      ? op.ops
      : unrollableRangeElements(op, options)
  );
  const width = listOps.find((l) => l !== undefined)?.length;
  if (width === undefined) return undefined;
  if (listOps.some((l) => l !== undefined && l.length !== width))
    return undefined;
  // A remaining operand must be a scalar the rewrite may repeat: pure, and
  // free of caller-supplied code (`readsCallerSource`), which runs once in
  // the original and would run once per element here. A list-shaped operand
  // whose width is not literal falls here too, and stops the rewrite.
  if (
    !ops.every(
      (op, i) =>
        listOps[i] !== undefined ||
        (isProvablyScalar(op) &&
          op.isPure === true &&
          !readsCallerSource(op, options))
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
// Rule 5 — a literal index into a literal list
// ─────────────────────────────────────────────────────────────────────────

/**
 * `At([e₁, …, eₙ], k)` with `k` a positive integer literal no greater than
 * `n`, rewritten to `eₖ`; `At(a..b, k)` over a literal `Range` likewise,
 * to the k-th number of the range. The list is written out and the index is
 * known, so the element is the value; every target then compiles the element
 * instead of building the list and indexing it (the interval target has no
 * list to build at all). Any other index — out of range, negative, non-literal — is
 * left to the target's `At` lowering and its own answer for it; so is a
 * complex index, whose real part is not the index. Every DISCARDED element
 * must be pure and free of caller-supplied code (`readsCallerSource`): the
 * interpreter evaluates the whole list, so dropping an element with an
 * effect would change how many times that effect runs. A `List` head the
 * caller overrode is left alone as well: the caller's implementation
 * receives the elements, and the index is then its business.
 *
 * The index is also PUSHED THROUGH a list that is not written out as one
 * `List` but built from one — or from a literal `Range` — by element-wise
 * arithmetic, a relation, a `Which`/`If` over a list-shaped condition, or
 * zipped from columns into points: `(0.1·[a, b, c] + 0.4)[2]` is
 * `0.1·b + 0.4`, `PointList([a₁, a₂], [b₁, b₂], 5)[2]` is the point
 * `PointList(a₂, b₂, 5)`, and `Which(|x + [3, 2, 1]/3| < 1, 0, True, 1)[2]`
 * is `Which(|x + 2/3| < 1, 0, True, 1)`. The interpreter computes the whole
 * list and reads one element back; the rewrite computes that element alone,
 * which is what the shader and interval targets need — they have no run-time
 * list to index, and the interval target has no element-wise selection at
 * all — and what every target prefers. The width of such a list must be
 * PROVABLE from its structure (`staticListWidth`): an operand the head
 * repeats at every position is kept as it is, and a list-shaped operand is
 * indexed in turn (`indexInto`; `indexedOperands` says which operands are
 * which for each head). A `PointList` whose every component is a scalar is
 * one POINT, not a list of them; an index into it reads a coordinate, which
 * is a different value and is left to the target.
 */
function foldLiteralIndex(
  expr: Expression & FunctionInterface,
  options: UnrollOptions
): Expression | undefined {
  if (expr.operator !== 'At' || expr.nops !== 2) return undefined;
  const [base, index] = expr.ops;
  if (!isFunction(base)) return undefined;
  if (options.skipHeads?.has(base.operator) === true) return undefined;
  if (!isNumber(index) || index.im !== 0) return undefined;
  const k = index.re;
  if (!Number.isInteger(k) || k < 1) return undefined;
  // A literal range is read through its own indexed access; an index past
  // the count is left alone.
  if (base.operator === 'Range') return indexInto(base, k, options);
  // A written-out `List` has its width in view whatever its elements are; a
  // list built by arithmetic or zipped from columns must prove it.
  if (base.operator === 'List') {
    if (base.nops === 0 || k > base.nops) return undefined;
    return indexInto(base, k, options);
  }
  const width = staticListWidth(base, true);
  if (width === undefined || k > width) return undefined;
  // A target with an iteration budget builds at most that many elements of a
  // list it computes (the zip of a `PointList` stops there), so an index past
  // the budget is out of range for it and is left to its own answer.
  const budget = options.iterationBudget;
  if (budget !== undefined && k > Math.floor(budget)) return undefined;
  return indexInto(base, k, options);
}

/**
 * Element `k` (1-based, within the width the caller proved) of a list built
 * from written-out `List`s: the element itself for a `List`; for the
 * element-wise arithmetic `staticListWidth` accepts, and for a `PointList`
 * zipped from columns, the same head applied to the k-th element of each
 * list-shaped operand while a scalar operand is kept whole. `undefined` when
 * a discarded element of a `List` has an effect or reads caller-supplied
 * code (`readsCallerSource`), or when a head the caller overrode is reached
 * (`UnrollOptions.skipHeads`): that head's implementation receives the
 * whole operands, and the rewrite would stop running it.
 *
 * The rebuilt nodes are STRUCTURAL, for the reason given on
 * `isNonConstantLiteralList`: canonicalizing `0.1·b + 0.4 + 0.4` would fold
 * the two literals before a `constantFold: false` compilation can see them.
 */
function indexInto(
  e: Expression,
  k: number,
  options: UnrollOptions
): Expression | undefined {
  if (!isFunction(e)) return undefined;
  if (options.skipHeads?.has(e.operator) === true) return undefined;
  if (e.operator === 'List') {
    if (k > e.nops) return undefined;
    if (
      e.ops.some(
        (el, i) =>
          i !== k - 1 && (el.isPure !== true || readsCallerSource(el, options))
      )
    )
      return undefined;
    return e.ops[k - 1];
  }
  if (e.operator === 'Range') {
    // Read through the range's own indexed access: nothing is enumerated.
    const count = literalRangeCount(e);
    if (count === undefined || k > count) return undefined;
    return typeof e.at === 'function' ? e.at(k) : undefined;
  }
  const indexed = indexedOperands(e);
  if (indexed === undefined) return undefined;
  // One position of a selection runs the arms that position reaches, where
  // the original runs every arm some position reaches; a clause that reads
  // caller-supplied code (`readsCallerSource`) could then run a different
  // number of times, so such a selection is left alone.
  if (
    SELECTION_HEADS.has(e.operator) &&
    e.ops.some((op) => readsCallerSource(op, options))
  )
    return undefined;
  const ops: Expression[] = [];
  for (const op of e.ops) {
    if (!indexed.has(op)) {
      ops.push(op);
      continue;
    }
    const element = indexInto(op, k, options);
    if (element === undefined) return undefined;
    ops.push(element);
  }
  return e.engine.function(e.operator, ops, { form: 'structural' });
}

/** The heads whose element-wise lowering a literal index is pushed through. */
const ORDERING_RELATION_HEADS: ReadonlySet<string> = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
]);
const EQUALITY_HEADS: ReadonlySet<string> = new Set(['Equal', 'NotEqual']);
const SELECTION_HEADS: ReadonlySet<string> = new Set(['Which', 'If']);

/**
 * Is this operand one VALUE a `Which`/`If` broadcast over a list-shaped
 * condition repeats at every position — a number, a boolean (a condition
 * that is scalar, the `True` of the default clause), or one point (a tuple
 * type, or a union of tuple types, `isPointElementType`)? The
 * interpreter lifts such an operand whole: `Which([T, F, F], (1, 2))` is
 * `[(1, 2), NaN, NaN]`, the point at the selected position and not its
 * coordinates spread over the positions.
 */
function isSelectionScalar(op: Expression): boolean {
  return (
    isProvablyScalar(op) ||
    op.type.matches('boolean') ||
    isPointElementType(op.type.type)
  );
}

/**
 * For a node whose head applies ELEMENT-WISE over a list-shaped operand, the
 * operands that are list-shaped — the ones an index is pushed into, the
 * other operands being kept whole — or `undefined` when the head is not one
 * the index fold walks, or when the mix of operands is not one the
 * interpreter applies element-wise. The heads, and the operand mix each
 * admits (verified against the interpreter):
 *
 * - the element-wise arithmetic and function heads ({@link ELEMENTWISE_HEADS})
 *   and a `PointList` zipped from columns: a provably scalar operand is kept
 *   whole, every other operand is a list of the common width. A `PointList`
 *   whose every component is a scalar is one POINT, not a list of them, and
 *   is not walked;
 * - the ordering relations, over two operands: `[1, 2] < 2` is `[True,
 *   False]` and `[1, 2] < [2, 2]` likewise zips the two lists;
 * - `Equal`/`NotEqual`, over two operands of which exactly ONE is a list:
 *   `[1, 2] = 2` is `[False, True]`, but two lists compare as WHOLE values
 *   (`[1, 2] = [1, 2]` is `True`) and are not walked;
 * - `Which`/`If` whose FIRST condition is a list: the interpreter is then in
 *   its element-wise mode, where a later scalar condition and a scalar or
 *   point arm ({@link isSelectionScalar}) lift to every position and a list
 *   condition or arm is read at each. A scalar FIRST condition is not walked:
 *   when it is true the interpreter answers that arm WHOLE, a scalar the
 *   index would then reject. Every clause must be pure: the rewrite keeps
 *   one position and the interpreter evaluates every condition and every
 *   reached arm. One input is answered differently by the two forms, and
 *   the difference is a defect of the element-wise form recorded in
 *   `ROADMAP.md` ("An element-wise ordering relation compares a NaN operand
 *   where the scalar branch treats it as undecided"): with `b` NaN,
 *   `Which([a, b, c] < 2, 1, True, 0)[2]` is `0` (the cell `NaN < 2` is
 *   `False`) where the scalar `Which(b < 2, 1, True, 0)` is `Missing`, the
 *   undecided-condition answer every scalar branch gives. The rewrite gives
 *   the scalar answer. A selection with NO default clause and a point arm
 *   is not walked: a position no clause selects is `NaN` in the element-wise
 *   mode, while a scalar selection with no default answers `Missing`, which
 *   is the same value only where the selection is numeric.
 */
function indexedOperands(
  e: Expression & FunctionInterface
): ReadonlySet<Expression> | undefined {
  const head = e.operator;
  if (ELEMENTWISE_HEADS.has(head) || head === 'PointList') {
    const lists = e.ops.filter((op) => !isProvablyScalar(op));
    return lists.length > 0 ? new Set(lists) : undefined;
  }
  if (ORDERING_RELATION_HEADS.has(head) || EQUALITY_HEADS.has(head)) {
    if (e.nops !== 2) return undefined;
    const lists = e.ops.filter((op) => !isProvablyScalar(op));
    if (lists.length === 0) return undefined;
    if (EQUALITY_HEADS.has(head) && lists.length !== 1) return undefined;
    return new Set(lists);
  }
  if (SELECTION_HEADS.has(head)) {
    if (e.nops < 2 || isSelectionScalar(e.op1)) return undefined;
    if (!e.ops.every((op) => op.isPure === true)) return undefined;
    const hasDefault =
      head === 'If'
        ? e.nops === 3
        : e.nops % 2 === 0 && isSymbol(e.ops[e.nops - 2], 'True');
    if (
      !hasDefault &&
      e.ops.some((op, i) => i % 2 === 1 && isPointElementType(op.type.type))
    )
      return undefined;
    return new Set(e.ops.filter((op) => !isSelectionScalar(op)));
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 6 — a comprehension over literal domains
// ─────────────────────────────────────────────────────────────────────────

/**
 * The most elements a written-out comprehension may have. A shader array
 * literal of this size is still a modest constant table; a larger
 * comprehension is left to the target, which declines it where it has no
 * loop lowering.
 */
const MAX_UNROLLED_COMPREHENSION_SIZE = 64;

/**
 * `Comprehension(body, Element(v₁, D₁), …, Element(vₙ, Dₙ))` with every
 * domain a LITERAL `Range` with number-literal bounds or a literal `List` of
 * pure elements, rewritten to the literal list of the bodies with the
 * clause variables substituted — in the interpreter's order, the first
 * clause outermost and the last varying fastest. Only when the target asks
 * for it (`UnrollOptions.unrollComprehensions`): the shader targets, which
 * have no loop lowering for a comprehension and lower the written-out list
 * as a fixed-size array.
 *
 * The body must be pure and bind no name of its own (the substitution is
 * not capture-avoiding), every clause must bind a plain symbol, no domain
 * may read an earlier clause's variable (a dependent domain has no literal
 * elements), and the element count is capped
 * (`MAX_UNROLLED_COMPREHENSION_SIZE`, and the target's iteration budget when
 * it has one). The counts are read before anything is enumerated, so an
 * infinite or enormous literal range is declined without being walked. An
 * empty domain writes the empty list, which is what the interpreter answers.
 */
function unrollComprehension(
  expr: Expression & FunctionInterface,
  options: UnrollOptions
): Expression | undefined {
  if (options.unrollComprehensions !== true) return undefined;
  if (expr.operator !== 'Comprehension' || expr.nops < 2) return undefined;
  const body = expr.op1;
  if (body.isPure !== true) return undefined;
  if (collectBinderNames(body).size > 0) return undefined;
  // A domain whose head the caller overrode is the caller's to enumerate,
  // and a domain element reading caller source must keep running it.
  if (
    expr.ops
      .slice(1)
      .some(
        (clause) =>
          isFunction(clause) &&
          clause.nops === 2 &&
          readsCallerSource(clause.ops[1], options)
      )
  )
    return undefined;
  const clauses: Array<[name: string, elements: ReadonlyArray<Expression>]> =
    [];
  // The target's iteration budget, when it has one, caps the count as it
  // caps every other repetition the pass writes out.
  const cap = Math.min(
    MAX_UNROLLED_COMPREHENSION_SIZE,
    options.iterationBudget === undefined
      ? Infinity
      : Math.floor(options.iterationBudget)
  );
  let total = 1;
  for (const clause of expr.ops.slice(1)) {
    if (!isFunction(clause, 'Element') || clause.nops !== 2) return undefined;
    const [pattern, domain] = clause.ops;
    if (!isSymbol(pattern)) return undefined;
    if (clauses.some(([name]) => domain.symbols.includes(name)))
      return undefined;
    // The count is read before anything is enumerated: a literal range can
    // be enormous, and one past the cap is declined without materializing.
    const count = literalDomainCount(domain);
    if (count === undefined) return undefined;
    total *= count;
    if (total > cap) return undefined;
    const elements = literalDomainElements(domain);
    if (elements === undefined) return undefined;
    clauses.push([pattern.symbol, elements]);
  }
  const ce = expr.engine;
  const rows: Expression[] = [];
  const visit = (k: number, substitution: Record<string, Expression>): void => {
    if (k === clauses.length) {
      rows.push(body.subs(substitution));
      return;
    }
    const [name, elements] = clauses[k];
    for (const element of elements)
      visit(k + 1, { ...substitution, [name]: element });
  };
  visit(0, {});
  return ce.function('List', rows);
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 7 — a selection over a list-shaped condition
// ─────────────────────────────────────────────────────────────────────────

/**
 * The most positions a `Which`/`If` over a list-shaped condition is written
 * out into (rule 7). A literal `List` condition is already that wide in the
 * source; the cap bounds a literal `Range` condition, whose count is not.
 */
const MAX_UNROLLED_SELECTION_WIDTH = 64;

/**
 * `Which`/`If` whose FIRST condition is list-shaped with a provable width
 * (`staticListWidth`), written out as the literal list of the per-position
 * selections: `Which(x + [a, b, c, d, e] < 2, 0, True, 1)` becomes
 * `[Which(x + a < 2, 0, True, 1), Which(x + b < 2, 0, True, 1), …]`. Each
 * position is `indexInto` applied to every list-shaped clause while a
 * scalar, boolean or point clause is repeated (`indexedOperands` gives the
 * element-wise mode of the interpreter that this reproduces).
 *
 * The fan-out gate is the one of the other rules: the width must reach
 * `UnrollOptions.minWidth` (below it the JavaScript target's run-time
 * selection and the shader targets' vector selection answer for
 * themselves), and a condition built only from number-literal lists and
 * ranges is a compile-time constant left to the constant folder unless
 * `UnrollOptions.unrollConstantLists` asks for it. The width is capped at
 * {@link MAX_UNROLLED_SELECTION_WIDTH}. The arithmetic UNDER the condition
 * is distributed by rule 4 at the same gate; this rule reads through it
 * either way.
 *
 * Measured need: the JavaScript target lowers this shape through the
 * run-time helper `_SYS.select` (one thunk per clause, an array per
 * condition), the shader targets only for a condition of vector width two
 * to four, and the interval target not at all. The written-out form is a
 * list of scalar selections every target compiles.
 */
function distributeSelection(
  expr: Expression & FunctionInterface,
  options: UnrollOptions
): Expression | undefined {
  if (!SELECTION_HEADS.has(expr.operator)) return undefined;
  if (options.skipHeads?.has(expr.operator) === true) return undefined;
  const indexed = indexedOperands(expr);
  if (indexed === undefined) return undefined;
  // The width is proven over EVERY list-shaped clause, not the first
  // condition alone: a list arm wider than the condition is a dimension
  // mismatch the interpreter reports and the run-time selection answers
  // with NaN, which a fan-out cut to the condition's width would hide.
  const width = staticListWidth(expr, true);
  if (width === undefined || width > MAX_UNROLLED_SELECTION_WIDTH)
    return undefined;
  // A clause that reads caller-supplied code (`readsCallerSource`) runs
  // once in the original selection; repeating a scalar clause at every
  // position, or reading a list clause at some positions only, would change
  // how many times that code runs.
  if (expr.ops.some((op) => readsCallerSource(op, options))) return undefined;

  if (width < (options.minWidth ?? MIN_UNROLLED_WIDTH)) return undefined;
  if (
    options.unrollConstantLists !== true &&
    !expr.ops.some((op) => indexed.has(op) && readsNonConstantList(op))
  )
    return undefined;

  const ce = expr.engine;
  const elements: Expression[] = [];
  for (let k = 1; k <= width; k++) {
    const element = indexInto(expr, k, options);
    if (element === undefined) return undefined;
    elements.push(element);
  }
  return ce.function('List', elements);
}

/**
 * The most elements a literal `Range` operand is written out into by
 * `distributeOverList` on a target that asks for constant lists
 * (`UnrollOptions.unrollConstantLists`). Smaller than the interval target's
 * own cap for writing a literal range out in an accessor or reducer position
 * (`INTERVAL_UNROLL_LIMIT`, 100): this pass repeats the element-wise head
 * once per element, and a range wider than this is left to the target, which
 * builds it at run time.
 */
const MAX_UNROLLED_RANGE_WIDTH = 64;

/**
 * The elements of a literal `Range` operand that `distributeOverList` fans
 * an element-wise head out over, or `undefined`.
 *
 * A range is a constant, so — like a list of number literals — it is only
 * written out for a target that asks for constant lists
 * (`UnrollOptions.unrollConstantLists`: the interval target, which has no
 * `Range` lowering of its own and whose values are one interval each). The
 * width must reach `UnrollOptions.minWidth` and stay within
 * `MAX_UNROLLED_RANGE_WIDTH`; a wider range is left to the target, which
 * builds it at run time. `x − (3..9)` on the interval target thus becomes
 * the list `[x − 3, …, x − 9]`, which that target spells as an array.
 */
function unrollableRangeElements(
  e: Expression,
  options: UnrollOptions
): ReadonlyArray<Expression> | undefined {
  if (options.unrollConstantLists !== true) return undefined;
  if (options.skipHeads?.has('Range') === true) return undefined;
  const count = literalRangeCount(e);
  if (count === undefined || count > MAX_UNROLLED_RANGE_WIDTH) return undefined;
  if (count < (options.minWidth ?? MIN_UNROLLED_WIDTH)) return undefined;
  return literalDomainElements(e);
}

/**
 * Does `e` hold a literal `List` with an element that is not a number
 * literal (`isNonConstantLiteralList`) anywhere below it? A literal `Range`
 * is a constant, and so is a `List` of number literals.
 */
function readsNonConstantList(e: Expression): boolean {
  if (!isFunction(e)) return false;
  if (e.operator === 'List') return isNonConstantLiteralList(e);
  return e.ops.some(readsNonConstantList);
}

/**
 * Is this a `Range` with number-literal bounds (and step)?
 */
function isLiteralRange(
  domain: Expression
): domain is Expression & FunctionInterface {
  return isFunction(domain, 'Range') && domain.ops.every((op) => isNumber(op));
}

/**
 * The element count of a literal `Range` (`count`, which the engine computes
 * from the bounds without enumerating), or `undefined` for a range whose
 * bounds are not number literals or whose count is not finite.
 */
function literalRangeCount(range: Expression): number | undefined {
  if (!isLiteralRange(range)) return undefined;
  const count = range.count;
  return count !== undefined && Number.isFinite(count) ? count : undefined;
}

/**
 * The element count of a LITERAL domain — a literal range (`count`, which
 * the engine computes from the bounds without enumerating) or a literal
 * `List` of pure elements — or `undefined` for any other domain, and for a
 * range whose count is not finite.
 */
function literalDomainCount(domain: Expression): number | undefined {
  if (isFunction(domain, 'Range')) return literalRangeCount(domain);
  if (isFunction(domain, 'List'))
    return domain.ops.every((e) => e.isPure === true) ? domain.nops : undefined;
  return undefined;
}

/**
 * The elements of a LITERAL domain (see `literalDomainCount`), a literal
 * range enumerated by the engine's own range iteration. Callers check the
 * count against their cap first, so a range is never enumerated past it.
 */
function literalDomainElements(
  domain: Expression
): ReadonlyArray<Expression> | undefined {
  if (isLiteralRange(domain)) {
    if (typeof domain.each !== 'function') return undefined;
    return [...domain.each()];
  }
  if (isFunction(domain, 'List'))
    return domain.ops.every((e) => e.isPure === true) ? domain.ops : undefined;
  return undefined;
}

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
