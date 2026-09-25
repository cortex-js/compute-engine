/**
 * JavaScript interval arithmetic compilation target
 *
 * Compiles mathematical expressions to JavaScript code using interval arithmetic
 * for reliable function evaluation with singularity detection.
 *
 * The target's value model is "one interval per quantity": every kernel here
 * answers ONE interval (or one `IntervalResult`) and takes scalar operands —
 * a provably collection-valued operand to a kernel fails closed
 * (`assertScalarIntervalOperands`). A collection is that many quantities: a
 * collection-valued ROOT (a comprehension) returns a JavaScript array of
 * intervals (`IntervalValue`), and a collection may appear as the OPERAND of
 * an accessor — `At`, `Length`, `PointX`/`PointY`/`PointZ` — where it is the
 * same array at run time and the accessor projects it back down to a single
 * interval (see `interval/collections.ts`); a coordinate accessor over a LIST
 * of points broadcasts instead and answers the array of the coordinates
 * (`_IA.pointComponent`). A literal single point — a `Tuple`
 * of scalars, or an all-scalar `PointList` — is the third place an array
 * spelling exists: at the ROOT it compiles to the array of its coordinate
 * intervals (`literalRootPointOps`). A `PointList` with a list component is a
 * list of points, built at run time by `_IA.pointList` in the same positions
 * as any other collection value (`compileIntervalCollectionValue`). The array
 * spelling of a LITERAL
 * `List`/`Tuple` is emitted only in those positions, never as an ordinary
 * lowering: see `compileIntervalCollectionOperand` for why. Point ARITHMETIC
 * (point ± point, scalar × point, point / scalar) is the one kernel position
 * a point operand compiles in: it lowers through the element-wise broadcast,
 * which hands the kernel one coordinate at a time (`tryIntervalBroadcast`,
 * `_IA.bcastPoint`).
 *
 * @module compilation/interval-javascript-target
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { normalizeDeprecatedCompileOptions } from './deprecation-warnings.js';
import { entrySource } from './function-purity.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isString,
} from '../boxed-expression/type-guards.js';
import {
  collectionElementType,
  stripMissingFromType,
} from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';

import {
  BaseCompiler,
  compilationType,
  exactRationalDivisor,
  isProvablyNumericListOperand,
  isProvablyStringOperand,
  pointHasBroadcastComponent,
} from './base-compiler.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import type { LoopInvariantBinding } from './base-compiler.js';
import {
  couldBeIndexedCollectionOperand,
  couldBeStringOperand,
  elementTypeBroadcastsWhenEmpty,
  isCoordinateRowListOperand,
  isEmptyCollectionOperand,
  isIndexedCollectionOperand,
  isNumericIndexOperand,
  isPointListOperand,
  mayBePointList,
  tupleElementType,
} from './javascript-target.js';
import { rewriteAngularUnit } from './angular-unit.js';
import {
  overriddenCompilationHeads,
  readsCallerSource,
  unrollFixedWidthCollections,
} from './fixed-width-unroll.js';
import type {
  CompileDiagnostic,
  CompileMode,
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  CompiledRunner,
  CompiledFunction,
  IntervalInput,
  IntervalValue,
  OperandCompiler,
} from './types.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { resolveStorageHints } from './storage-hints.js';
import { IntervalArithmetic } from '../interval/index.js';
import type { Interval } from '../interval/types.js';
import { nextDown, nextUp } from '../numerics/numeric.js';
import { rangeCount } from '../numerics/range-count.js';
import { interval } from '../numerics/interval.js';
import { foldSeed, MAX_RANDOM_ELEMENT_COUNT } from '../numerics/random.js';
import { randomCount } from '../library/random-utils.js';
import {
  INTERVAL_QUADRATURE_BUDGET,
  INTERVAL_QUADRATURE_SUBDIVISIONS,
} from '../interval/integrate.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import {
  callerSpliceSources,
  preservesMappedSplices,
} from './constant-folding.js';

/**
 * Interval arithmetic operators mapped to _IA library calls.
 *
 * Unlike regular operators, these produce function calls instead of infix notation.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const INTERVAL_JAVASCRIPT_OPERATORS: CompiledOperators = {
  __proto__: null as never,
  // We use high precedence since these become function calls
  Add: ['_IA.add', 20],
  Negate: ['_IA.negate', 20],
  Subtract: ['_IA.sub', 20], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['_IA.mul', 20],
  Divide: ['_IA.div', 20],
  // Comparisons return BoolInterval
  Equal: ['_IA.equal', 20],
  NotEqual: ['_IA.notEqual', 20],
  LessEqual: ['_IA.lessEqual', 20],
  GreaterEqual: ['_IA.greaterEqual', 20],
  Less: ['_IA.less', 20],
  Greater: ['_IA.greater', 20],
  And: ['_IA.and', 20],
  Or: ['_IA.or', 20],
  Not: ['_IA.not', 20],
};

/**
 * Emit the Euclidean (L2) norm of a fixed-arity point from its compiled
 * components: `hypot` for the 2-D case (tighter enclosure than the
 * sqrt-of-squares composition), √(Σ xᵢ²) otherwise.
 */
function compileIntervalPointNorm(
  components: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const comps = components.map((c) => compile(c));
  if (comps.length === 0) return '_IA.point(0)';
  if (comps.length === 1) return `_IA.abs(${comps[0]})`;
  if (comps.length === 2) return `_IA.hypot(${comps[0]}, ${comps[1]})`;
  let sum = `_IA.add(_IA.square(${comps[0]}), _IA.square(${comps[1]}))`;
  for (let i = 2; i < comps.length; i++)
    sum = `_IA.add(${sum}, _IA.square(${comps[i]}))`;
  return `_IA.sqrt(${sum})`;
}

/**
 * The assigned value of a SYMBOL operand when that value is a literal
 * `List`/`Tuple`/`PointList`, or a `Map`/`Range` whose elements the collection
 * spelling can enumerate — at compile time when the range's bounds are
 * literal (`Range` never collapses to a `List` on evaluation: it is lazy by
 * definition, so `[0...100]` stays a `Range` node), at run time through
 * `_IA.range`/`_IA.map` when a bound is symbolic; `undefined` for any other
 * operand.
 *
 * Everywhere else an assigned symbol folds through
 * `BaseCompiler.tryFoldKnownSymbol`, which compiles the VALUE — and this target
 * has no `List`/`Tuple` lowering (see `compileIntervalCollectionOperand`), so
 * `At(L, 2)` with `L := [1, 2, 3]` declined with "List: no lowering" even
 * though the element is right there. Looking through the symbol here keeps
 * the fold local to the accessor's operand position. Three symbols are never
 * looked through: one BOUND in the current compilation context (a lambda
 * parameter or a binder index shadows the engine's symbol of the same name),
 * one the caller pinned as a runtime input (`varsKeys`, which must survive to
 * run time), and one with no assigned value. A looked-through symbol is
 * recorded in `symbolDeps`, since the generated code bakes its current value,
 * exactly as `tryFoldKnownSymbol` records it.
 */
function assignedLiteral(
  e: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  if (!isSymbol(e)) return undefined;
  const id = e.symbol;
  if (target.boundVars?.has(id) || target.varsKeys?.has(id)) return undefined;
  const value = e.engine._getSymbolValue(id);
  if (value === undefined || !isFunction(value)) return undefined;
  const h = value.operator;
  // `Map` and `Range` are the collection values a symbol holds after an
  // evaluation that does not write the list out — `R = mod(10⁴ sin(10⁴ ·
  // [0...100]), 1)` evaluates to a `Map` over the range. Every consumer of
  // this look-through knows both: `literalCollectionOps` enumerates a
  // literal-bounded range, and `compileIntervalCollectionValue` spells the
  // rest; without them here the symbol's value went through the ordinary
  // fold and declined with "Map: no lowering".
  if (
    h !== 'List' &&
    h !== 'Tuple' &&
    h !== 'PointList' &&
    h !== 'Map' &&
    h !== 'Range'
  )
    return undefined;
  // A head the caller overrode (the `functions` compilation option) keeps
  // its ordinary dispatch, which reaches the caller's implementation: the
  // accessor folds this look-through feeds (`Length(R)` to a count, `At(R,
  // 2)` to an element) would otherwise bypass that implementation.
  if (target.unrollSkipHeads?.has(h) === true) return undefined;
  target.symbolDeps?.add(id);
  return value;
}

/** The operands of a literal `List`/`Tuple` node — written inline or held as
 *  a symbol's assigned value (`assignedLiteral`) — or the elements of a
 *  `Range` with number-literal bounds and at most `INTERVAL_UNROLL_LIMIT`
 *  elements, or `undefined` for any other operand. A literal collection's
 *  length and elements are known at compile time, which lets `Length` and
 *  `At` fold instead of emitting a runtime array. */
function literalCollectionOps(
  e: Expression,
  target: CompileTarget<Expression>
): ReadonlyArray<Expression> | undefined {
  const literal = assignedLiteral(e, target) ?? e;
  if (isFunction(literal, 'List') || isFunction(literal, 'Tuple'))
    return literal.ops;
  if (isFunction(literal, 'Range'))
    return literalRangeElements(literal, INTERVAL_UNROLL_LIMIT);
  return undefined;
}

/**
 * The elements of a `Range` whose bounds (and step) are finite real number
 * literals, as number literals, or `undefined` for a range with a symbolic
 * bound or with more than `budget` elements.
 *
 * The interpreter's contract, mirrored from `literalRange` and the Range
 * collection handlers (`library/collections.ts`): `Range(hi)` counts from 1;
 * a two-operand range infers step ±1 from the bounds' order; real bounds and
 * steps are legal; the element count is `rangeCount(lo, hi, step)`, that is
 * `max(0, floor((hi - lo) / step) + 1)` with a small tolerance for the
 * floating-point rounding of the quotient (a zero step is empty). Iteration is COUNT-driven with `lo + i·step`
 * elements — an endpoint-driven `k += step` loop can fail to make progress
 * past 2^53 and hang the compilation.
 */
function literalRangeElements(
  node: Expression & { ops: ReadonlyArray<Expression> },
  budget: number
): ReadonlyArray<Expression> | undefined {
  const ce = node.engine;
  const nums = node.ops.map((op) =>
    isNumber(op) && op.im === 0 && Number.isFinite(op.re) ? op.re : undefined
  );
  if (nums.some((n) => n === undefined)) return undefined;
  let lo: number, hi: number, step: number;
  if (nums.length === 1) [lo, hi, step] = [1, nums[0]!, 1];
  else if (nums.length === 2)
    [lo, hi, step] = [nums[0]!, nums[1]!, nums[1]! >= nums[0]! ? 1 : -1];
  else if (nums.length === 3) [lo, hi, step] = [nums[0]!, nums[1]!, nums[2]!];
  else return undefined;
  if (step === 0) return [];
  const count = rangeCount(lo, hi, step);
  if (!Number.isFinite(count) || count > budget) return undefined;
  const elements: Expression[] = [];
  for (let i = 0; i < count; i++) elements.push(ce.number(lo + i * step));
  return elements;
}

/**
 * Compile the COLLECTION operand of `At`: a JavaScript array of intervals.
 *
 * A literal `List`/`Tuple` is lowered here rather than through a handler
 * registered in `INTERVAL_JAVASCRIPT_FUNCTIONS`, so the array spelling exists
 * ONLY in the operand position of an accessor that immediately projects it
 * back to a single interval. Registering it as an ordinary lowering would make
 * a literal list a legal value everywhere — and a contradicted `-> boolean`
 * declaration whose body is a list (`b(t) := [t < 1, t < 2]`) would then
 * compile in a scalar `Which` condition, where it is pinned to decline in
 * every scalar position. The kernels themselves are protected separately:
 * `assertScalarIntervalOperands` fails closed on any provably
 * collection-valued operand, since `_IA.add`, `_IA.piecewise`, … read
 * `.lo`/`.hi` off whatever they are handed and would answer NaN bounds behind
 * `success: true`.
 *
 * This is one of the three places an array spelling exists on this target. The
 * other two are the collection-valued ROOT of a comprehension, and a literal
 * single point at the ROOT (`literalRootPointOps`).
 */
function compileIntervalCollectionOperand(
  e: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  return compileIntervalCollectionValue(e, target) ?? compile(e);
}

/**
 * The heads whose node is spelled as a run-time collection value by
 * `compileIntervalCollectionValue`. `Tuple` and `PointList` are among them
 * for the positions that consume a point whole — the accessor operand
 * position (`At((1, 2), k)`) and the body root of a point-valued helper
 * (`U(x, y) := (x, y)`, read by `PointY(U(x, y))`); a point at the
 * compilation ROOT takes `literalRootPointOps` first.
 */
const COLLECTION_VALUE_HEADS: ReadonlySet<string> = new Set([
  'List',
  'Tuple',
  'PointList',
  'Range',
  'Map',
]);

/**
 * Spell `e` as this target's run-time collection value — a JavaScript array
 * of intervals — or answer `undefined` for an expression this target does not
 * spell that way (its callers then compile it through the ordinary lowering,
 * which yields the array of a comprehension, a user-function call whose body
 * returns one, or a list-typed input, and declines a `List` that reaches a
 * scalar kernel).
 *
 * This is the one place the array spelling of a collection-BUILDING head is
 * emitted, and it is reached only from the positions that consume a
 * collection value whole: the compilation root, the body root of an emitted
 * helper and a whole-bound call argument (both through
 * `CompileTarget.compileCollectionValue`), the operand of an accessor or a
 * reducer, a `Map` source, and an operand of the element-wise broadcast
 * (`tryIntervalBroadcast`). There is deliberately no `List`/`Range`/`Map`
 * entry in `INTERVAL_JAVASCRIPT_FUNCTIONS` — see
 * `compileIntervalCollectionOperand` for the reason.
 *
 * Five forms are spelled:
 *
 * - a literal `List`/`Tuple` (written inline or held as a symbol's assigned
 *   value, `assignedLiteral`) whose every element is provably a number or is
 *   itself spelled here (a list of lists nests);
 * - a `Range` with number-literal bounds and at most `INTERVAL_UNROLL_LIMIT`
 *   elements, written out as point intervals, or with symbolic bounds, built
 *   at run time by `_IA.range` — whose bounds must then be POINT intervals,
 *   since a wide bound gives a range of varying length, which no array holds
 *   (it answers `entire`);
 * - `Map(f, collection)` with `f` a one-parameter function literal, as
 *   `_IA.map` over the spelled (or ordinarily compiled) source;
 * - a `PointList` with a list component, as the list of points
 *   `_IA.pointList` builds at run time (`compileIntervalPointListZip`);
 * - a seeded list draw `WithRandomSeed(seed, RandomChoice(domain, k))`, as
 *   the list of point intervals of its fixed value that `_IA.seededChoice`
 *   computes (`seededRandomChoicePlan`).
 *
 * A `List` with an element that is not provably a number — a boolean, a
 * string — is NOT spelled (it answers `undefined`), so a helper such as
 * `b(t) := [t < 1, t < 2]` keeps declining as it always has: its elements
 * have no interval reading. A head the caller overrode
 * (`CompileTarget.unrollSkipHeads`) keeps its ordinary dispatch.
 */
/**
 * Does `x` have an interval reading — is it a number by its type, a provable
 * list of numbers (its own array), or a symbol with no type evidence at all
 * (the free plot variable in `[x + 1, x − 1]`, which every scalar position on
 * this target already reads as an interval)? An expression PROVABLY of
 * another sort — a boolean, a string, a point — has none.
 */
function hasIntervalReading(x: Expression): boolean {
  if (x.type.matches('number') || isProvablyNumericListOperand(x)) return true;
  const t = compilationType(x);
  return t === 'unknown' || t === 'any';
}

function compileIntervalCollectionValue(
  e: Expression,
  target: CompileTarget<Expression>
): string | undefined {
  const literal = assignedLiteral(e, target) ?? e;
  if (!isFunction(literal)) return undefined;
  // The canonical body of a function literal is a one-statement `Block`
  // around the value; the body ROOT is that value.
  if (literal.operator === 'Block' && literal.ops.length === 1)
    return compileIntervalCollectionValue(literal.ops[0], target);
  // `Typed(value, type)` is a transparent ascription: the call of a helper
  // DECLARED with a return type (`U: (any, any) -> tuple<number, number>`,
  // how a document host registers every function) inlines to its body under
  // one, and a point-valued body is then `Typed((p, q), …)`. It is read
  // through only when the ascribed type is itself a point or a collection: a
  // CONTRADICTED scalar declaration (`-> number` over a list body) keeps
  // declining, in this position as in every other.
  if (literal.operator === 'Typed' && literal.ops.length >= 1) {
    const ascribed = compilationType(literal);
    const collectionTyped =
      (typeof ascribed !== 'string' && ascribed.kind === 'tuple') ||
      literal.type.matches('collection<any>');
    return collectionTyped
      ? compileIntervalCollectionValue(literal.ops[0], target)
      : undefined;
  }
  // A `Which` in a consuming position is a SELECTION among values, and its
  // arms are spelled the way the position spells them: a helper whose body
  // answers a list in one case and a number in another (`H(x, y) := {B(x, y)
  // > 0: 0, h(⌊x⌋, ⌊y⌋)·2 − 1}`, the Tycho document `sgtdqnj2ox`) returns
  // one or the other, and its callers index the result whole. Each arm is
  // offered this spelling first and compiles the ordinary way otherwise (a
  // scalar arm is an interval), so a mixed selection is an array or an
  // interval at run time — the value model of every consuming position. The
  // run-time `_IA.hull` of an undecided condition over two arms of different
  // domains (an array against an interval) is the absence marker, which is
  // right: no one value encloses both. The conditions stay scalar, as the
  // `Which` handler requires of them. Nothing here changes the answer for a
  // `Which` in a SCALAR position: that goes through the handler, which
  // compiles a list arm the ordinary way and declines it there, as before.
  // A `Which` the caller overrode (the `functions` compilation option) keeps
  // its ordinary dispatch, which reaches the caller's implementation.
  if (
    literal.operator === 'Which' &&
    target.unrollSkipHeads?.has('Which') !== true
  )
    return compileIntervalSelectionValue(literal, target);
  // A seeded list draw has a fixed value, the list of point intervals
  // `_IA.seededChoice` computes (see `seededRandomChoicePlan`). A draw this
  // target does not compile answers `undefined`, and the ordinary lowering
  // then reports why. A `WithRandomSeed` or a `RandomChoice` the caller
  // overrode keeps its ordinary dispatch.
  if (
    literal.operator === 'WithRandomSeed' &&
    literal.ops.length === 2 &&
    target.unrollSkipHeads?.has('WithRandomSeed') !== true &&
    target.unrollSkipHeads?.has('RandomChoice') !== true
  ) {
    const plan = seededRandomChoicePlan(literal.ops[0], literal.ops[1]);
    if (plan === undefined || typeof plan === 'string') return undefined;
    const k = isNumber(plan.k)
      ? String(plan.k.re)
      : BaseCompiler.compileValueOperand(plan.k, target);
    return `_IA.seededChoice(${plan.seedLo}, ${plan.seedHi}, ${plan.domain}, ${k})`;
  }
  const head = literal.operator;
  if (!COLLECTION_VALUE_HEADS.has(head)) return undefined;
  if (target.unrollSkipHeads?.has(head) === true) return undefined;
  // An element has an interval reading when it is a number by its type, a
  // nested collection spelled here or a provable list of numbers (compiled
  // to its own array), or a symbol with no type evidence at all — the free
  // plot variable in `[x + 1, x − 1]`, which every scalar position on this
  // target already reads as an interval. An element PROVABLY of another
  // sort (a boolean, a string, a point) has none, and the list is not
  // spelled: `[t < 1, t < 2]` keeps declining.
  const element = (x: Expression): string | undefined => {
    const nested = compileIntervalCollectionValue(x, target);
    if (nested !== undefined) return nested;
    if (!hasIntervalReading(x)) return undefined;
    return BaseCompiler.compileValueOperand(x, target);
  };
  if (head === 'List' || head === 'Tuple' || head === 'PointList') {
    // A tuple is one point, and so is an all-scalar `PointList` (component
    // k is operand k, the equivalence `literalPointOps` relies on). A point
    // with a BROADCASTING component is not one point at all: `([1, 2], 3)`
    // zips into the list of points `[(1, 3), (2, 3)]` in the interpreter,
    // which a nested array `[[1, 2], 3]` does not spell. A list holds a
    // list as an element, so only the point spellings are held to scalar
    // coordinates. A `PointList` with a list component is built as that
    // list of points at run time (`compileIntervalPointListZip`); a `Tuple`
    // with one is not spelled.
    if (head !== 'List' && pointHasBroadcastComponent(literal))
      return head === 'PointList'
        ? compileIntervalPointListZip(literal.ops, target)
        : undefined;
    const elements: string[] = [];
    for (const op of literal.ops) {
      const code = element(op);
      if (code === undefined) return undefined;
      elements.push(code);
    }
    return `[${elements.join(', ')}]`;
  }
  if (head === 'Range') {
    const ops = literalRangeElements(literal, INTERVAL_UNROLL_LIMIT);
    if (ops !== undefined)
      return `[${ops
        .map((x) => BaseCompiler.compileValueOperand(x, target))
        .join(', ')}]`;
    if (literal.ops.length < 1 || literal.ops.length > 3) return undefined;
    if (!literal.ops.every((op) => op.type.matches('number'))) return undefined;
    return `_IA.range(${literal.ops
      .map((x) => BaseCompiler.compileValueOperand(x, target))
      .join(', ')})`;
  }
  // `Map(f, collection)`. The function literal compiles through the
  // ordinary `Function` lowering to an arrow over its parameter, the same
  // arrow `Apply` calls; `_IA.map` lifts a raw numeric element to a point
  // interval before handing it to that arrow.
  if (literal.ops.length !== 2) return undefined;
  const fn = literal.ops[0];
  if (!isFunction(fn, 'Function') || fn.ops.length !== 2) return undefined;
  // The mapped value must have an interval reading: a predicate body
  // (`k ↦ k < 0`) would map to a list of verdicts, which is not a value of
  // this target (`IntervalValue`).
  if (!hasIntervalReading(fn.ops[0])) return undefined;
  const source = literal.ops[1];
  if (
    !isProvablyNumericListOperand(source) &&
    literalCollectionOps(source, target) === undefined
  )
    return undefined;
  const coll =
    compileIntervalCollectionValue(source, target) ??
    BaseCompiler.compileValueOperand(source, target);
  return `_IA.map(${BaseCompiler.compileValueOperand(fn, target)}, ${coll})`;
}

/**
 * A `PointList` with one or more list SOURCES (see
 * `compileIntervalCollectionValue`): the list of points the interpreter and
 * the JavaScript target build by zipping the sources to the length of the
 * shortest one. The run-time `_IA.pointList` builds it, and is told the kind
 * of each component: `'l'`, a source, or `'s'`, a slot reused at every point.
 *
 * The classification is stricter than the JavaScript target's
 * (`isPointListSource` and `compileJSPointList` there), because every
 * coordinate must have an interval reading. A source must PROVABLY be a list
 * of numbers (`isProvablyNumericListOperand`), and a slot must be a number by
 * its type. A component that is neither — a `broadcastable<number>`, an
 * untyped or opaque value, a nested point, a list of lists — answers
 * `undefined`, and the node then declines in its ordinary lowering (fail
 * closed) instead of taking a role the value may not have. A statically
 * infinite source declines too: an infinite list of points has no array.
 *
 * Each component is compiled once, in operand order, as an argument of the
 * run-time call.
 */
function compileIntervalPointListZip(
  ops: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string | undefined {
  const kinds: string[] = [];
  for (const op of ops) {
    if (isProvablyNumericListOperand(op)) {
      if (op.isCollection && op.isFiniteCollection === false) return undefined;
      kinds.push('l');
    } else if (op.type.matches('number') && !op.isCollection) kinds.push('s');
    else return undefined;
  }
  if (!kinds.includes('l')) return undefined;
  const components = ops.map(
    (op, i) =>
      (kinds[i] === 'l'
        ? compileIntervalCollectionValue(op, target)
        : undefined) ?? BaseCompiler.compileValueOperand(op, target)
  );
  return `_IA.pointList('${kinds.join('')}', ${components.join(', ')})`;
}

/**
 * The parts of a SEEDED list draw `WithRandomSeed(seed, RandomChoice(domain,
 * k))` that `_IA.seededChoice` takes, or a string that says why this target
 * does not compile the draw. `seed` and `body` are the operands of the
 * `WithRandomSeed`. Answers `undefined` when `body` is not exactly a
 * `RandomChoice` application.
 *
 * Such a draw has a FIXED value: the frame starts at draw 0 at each entry,
 * and `RandomChoice` makes exactly `k` draws in output order, so element `i`
 * is the value of draw `i` of the frame. Each element is then a point
 * interval, and no run-time frame counter is necessary. A `Random()` draw is
 * different: it is enclosed by its support (see the `Random` handler), and
 * a body that is not a bare `RandomChoice` keeps that treatment.
 *
 * What is required, and why:
 *
 * - the seed is a finite real or a string LITERAL, which is folded here, at
 *   compile time, by `foldSeed` — the fold the interpreter applies to the
 *   evaluated seed when it enters the frame;
 * - the domain is an `Interval` whose endpoints (with the `Open`/`Closed`
 *   markers removed) are finite real literals with `lo < hi`, a `Range` whose
 *   bounds are finite real literals and whose element count is finite and
 *   not zero, or a literal non-empty `List` of finite real literals. A
 *   domain the interpreter refuses (an empty or unbounded interval, an empty
 *   range) is refused here too, so that `fallback` gives the interpreter's
 *   error. The `Range` count is the interpreter's own (`Expression.count`),
 *   and its first element and step are normalized as `range()` in
 *   `library/collections.ts` does it;
 * - `k` is a number. A number literal is validated here as `randomCount`
 *   (`library/random-utils.ts`) validates it; any other `k` is compiled and
 *   validated at run time by `_IA.seededChoice`.
 */
function seededRandomChoicePlan(
  seed: Expression,
  body: Expression
):
  | { seedLo: number; seedHi: number; domain: string; k: Expression }
  | string
  | undefined {
  if (!isFunction(body, 'RandomChoice')) return undefined;
  if (body.ops.length !== 2) return 'expected exactly two arguments.';
  let folded: [number, number];
  if (isString(seed)) folded = foldSeed(seed.string);
  else if (isNumber(seed) && seed.im === 0 && Number.isFinite(seed.re))
    folded = foldSeed(seed.re);
  else
    return (
      'only a literal finite real or string seed compiles on the interval ' +
      'target.'
    );
  const [domainOp, k] = body.ops;
  const domain = seededChoiceDomain(domainOp);
  if (domain === undefined)
    return (
      'on the interval target, the domain of a seeded draw must be an ' +
      '`Interval` or a `Range` with finite literal bounds, or a literal ' +
      '`List` of finite real numbers.'
    );
  if (!k.type.matches('number'))
    return 'the count of a seeded draw must be a number.';
  if (isNumber(k)) {
    const count = randomCount(k.engine, k);
    if (typeof count !== 'number')
      return (
        `the count of a seeded draw must be in ` +
        `0..${MAX_RANDOM_ELEMENT_COUNT}, got ${k.toString()}.`
      );
  }
  return { seedLo: folded[0], seedHi: folded[1], domain, k };
}

/**
 * The JavaScript spelling of the `SeededChoiceDomain` (`interval/
 * collections.ts`) of a `RandomChoice` domain operand, or `undefined` for a
 * domain `seededRandomChoicePlan` does not accept.
 */
function seededChoiceDomain(domain: Expression): string | undefined {
  const real = (x: Expression): number | undefined =>
    isNumber(x) && x.im === 0 && Number.isFinite(x.re) ? x.re : undefined;
  // `String(x)` spells every finite double exactly, except that it loses the
  // sign of `-0`.
  const num = (x: number): string => (Object.is(x, -0) ? '-0' : String(x));
  if (isFunction(domain, 'Interval')) {
    const endpoint = (x: Expression): Expression =>
      isFunction(x, 'Open') || isFunction(x, 'Closed') ? x.op1 : x;
    if (domain.ops.length !== 2) return undefined;
    if (!domain.ops.every((x) => real(endpoint(x)) !== undefined))
      return undefined;
    // The same reading of the endpoints as the interpreter's
    // `analyzeRandomDomain`, which calls `interval()`.
    const int = interval(domain);
    if (int === undefined) return undefined;
    if (!Number.isFinite(int.start) || !Number.isFinite(int.end))
      return undefined;
    if (!(int.start < int.end)) return undefined;
    return `{ lo: ${num(int.start)}, hi: ${num(int.end)} }`;
  }
  if (isFunction(domain, 'Range')) {
    const ops = domain.ops.map(real);
    if (ops.length < 1 || ops.length > 3) return undefined;
    if (ops.some((x) => x === undefined)) return undefined;
    const n = domain.count;
    if (n === undefined || !Number.isFinite(n) || n <= 0) return undefined;
    const [first, step] =
      ops.length === 1
        ? [1, 1]
        : [ops[0]!, ops[2] ?? (ops[1]! >= ops[0]! ? 1 : -1)];
    return `{ first: ${num(first)}, step: ${num(step)}, n: ${n} }`;
  }
  if (isFunction(domain, 'List')) {
    if (domain.ops.length === 0) return undefined;
    const xs = domain.ops.map(real);
    if (xs.some((x) => x === undefined)) return undefined;
    return `[${xs.map((x) => num(x!)).join(', ')}]`;
  }
  return undefined;
}

/**
 * A `Which` at a consuming position (see `compileIntervalCollectionValue`):
 * the same lowering as the `Which` handler — a ternary chain over the
 * tri-state conditions, `_IA.hull` where a condition is undecided — with
 * every arm offered the collection spelling first. Answers `undefined` when
 * no arm is spelled as a collection: the selection is then a scalar one and
 * the handler compiles it as it always has. A malformed `Which` (an odd
 * operand count) is left to the handler too, which reports it.
 *
 * The clauses after an unconditional one (a `True` condition) are never
 * reached and are not compiled, as the handler does not compile them: an
 * unsupported head in an unreachable arm must not fail the expression. Each
 * arm, and each condition after the first, is compiled AS the operand it is
 * (`BaseCompiler.compileOpValue`), so the common-subexpression pass opens the
 * conditionally-evaluated region the handler opens for the same operand and
 * a temporary is never hoisted out of an arm that may not run.
 */
function compileIntervalSelectionValue(
  which: Expression,
  target: CompileTarget<Expression>
): string | undefined {
  if (!isFunction(which)) return undefined;
  const args = which.ops;
  if (args.length < 2 || args.length % 2 !== 0) return undefined;
  // The clauses that can be reached: up to and including the first
  // unconditional one.
  let reach = args.length;
  for (let i = 0; i < args.length; i += 2)
    if (isSymbol(args[i], 'True')) {
      reach = i + 2;
      break;
    }
  const spelled = (i: number): boolean =>
    compileIntervalCollectionValue(args[i], target) !== undefined;
  let any = false;
  for (let i = 1; i < reach; i += 2) if (spelled(i)) any = true;
  if (!any) return undefined;
  const compileArm = (i: number): string =>
    BaseCompiler.compileOpValue(which, i, target, 0, args[i]);
  const spellArm = (i: number): string =>
    BaseCompiler.withCseOperand(
      which,
      i,
      target,
      () =>
        compileIntervalCollectionValue(args[i], target) ??
        BaseCompiler.compileValueOperand(args[i], target)
    );
  const build = (i: number): string => {
    if (i >= reach) return `({ kind: 'empty' })`;
    const cond = args[i];
    const arm = spelled(i + 1) ? spellArm(i + 1) : compileArm(i + 1);
    if (isSymbol(cond, 'True')) return arm;
    BaseCompiler.assertScalarCondition(cond);
    return compileIntervalConditional(
      i === 0 ? BaseCompiler.compileValueOperand(cond, target) : compileArm(i),
      arm,
      build(i + 2),
      target
    );
  };
  return build(0);
}

/**
 * The coordinates of a literal SINGLE point — written inline or held as a
 * symbol's assigned value (`assignedLiteral`) — or `undefined` for any other
 * operand.
 *
 * A `Tuple` is always one point. An ALL-SCALAR `PointList` is one too —
 * component k is operand k — which is the same equivalence the JavaScript
 * target relies on (see `pointComponentSource` in `base-compiler.ts`, and the
 * byte-identical `PointList`/`Tuple` lowerings there). Requiring every operand
 * to be provably numeric is what excludes the other `PointList` shapes: a
 * component that is (or may be) an indexed collection is a SOURCE zipped
 * across points, so operand k is then not component k.
 */
function literalPointOps(
  e: Expression,
  target: CompileTarget<Expression>
): ReadonlyArray<Expression> | undefined {
  const literal = assignedLiteral(e, target) ?? e;
  if (isFunction(literal, 'Tuple')) return literal.ops;
  if (
    isFunction(literal, 'PointList') &&
    literal.ops.length > 0 &&
    literal.ops.every((op) => op.type.matches('number'))
  )
    return literal.ops;
  return undefined;
}

/**
 * The coordinates of a literal SINGLE point that is the ROOT of the
 * compilation, or `undefined` when the root is anything else. The caller emits
 * the JavaScript array of the compiled coordinates for such a root, and
 * compiles every other root the ordinary way.
 *
 * A point is two (or three) quantities, and the value model of this target is
 * one interval per quantity, so a point is an array of that many intervals.
 * The `run` contract admits such a value (`IntervalValue`): a collection-valued
 * result is an array of the results of its elements.
 *
 * The lowering is applied at the ROOT only, and there is deliberately no
 * `Tuple`/`PointList` entry in `INTERVAL_JAVASCRIPT_FUNCTIONS` that would apply
 * it in an operand position. The scalar kernels read `.lo` and `.hi` off
 * whatever they are handed, so `_IA.add` given an array answers NaN bounds
 * behind `success: true`; and if a point were a legal value everywhere, a
 * contradicted `-> boolean` declaration whose body is a point would compile
 * inside a scalar `Which` condition, which is pinned to decline. At the root
 * there is no kernel above the value to misread it — the array goes straight to
 * the caller of `run`.
 *
 * Each coordinate is emitted by its ordinary scalar lowering, so the array
 * holds exactly what that lowering produces: a bare `Interval` for a constant
 * or an input, an `IntervalResult` wrapper (`{ kind, value }`) for a kernel
 * result. The wrapper is kept, not unwrapped, because that is what the elements
 * of a comprehension root hold as well, both spellings are members of
 * `IntervalValue`, and unwrapping would discard the `partial`/`jump` report a
 * coordinate carries.
 *
 * A point declines in two cases, and then compiles the ordinary way — which
 * refuses it, exactly as before this lowering existed. A coordinate that is not
 * provably a number has no interval reading (a text or a nested collection
 * component). A point with a BROADCASTING component is not one point at all: it
 * zips into one point per element of that component, so it is a LIST of points.
 * A `PointList` of that shape is then built by `compileIntervalCollectionValue`
 * instead; a `Tuple` of that shape has no lowering that builds it.
 */
function literalRootPointOps(
  e: Expression,
  target: CompileTarget<Expression>
): ReadonlyArray<Expression> | undefined {
  const ops = literalPointOps(e, target);
  if (ops === undefined || ops.length === 0) return undefined;
  const literal = assignedLiteral(e, target) ?? e;
  // A head the caller overrode (the `functions` compilation option) keeps
  // its ordinary dispatch, which reaches the caller's implementation; the
  // array spelling here would silently replace that implementation.
  if (target.unrollSkipHeads?.has(literal.operator) === true) return undefined;
  if (!ops.every((op) => op.type.matches('number'))) return undefined;
  if (pointHasBroadcastComponent(literal)) return undefined;
  return ops;
}

/**
 * The emitted spelling of this target's numeric absence marker: a whole-NaN
 * bare interval. Kept in step with the `absence` capability declared in
 * `createTarget`, whose `isAbsent` test reads `.lo` directly — so the marker
 * must be a bare `Interval`, never an `IntervalResult` wrapper.
 */
const INTERVAL_ABSENCE = '{ lo: NaN, hi: NaN }';

/**
 * The type of the coordinate `k` (0-based) that a point accessor reads out of
 * an operand of type `t`, collected across the readings the type admits: the
 * coordinate of a tuple, and the coordinate of a collection's tuple element
 * (a list of points). A union contributes each arm's answer; the absence
 * marker arm (`missing`) is not a point and contributes nothing. An arm whose
 * coordinate the type does not state (a bare `tuple`, a `list<any>`, an
 * unparameterized element) contributes nothing either.
 */
function pointCoordinateTypes(t: Type, k: number): Type[] {
  const stripped = stripMissingFromType(t);
  if (typeof stripped === 'string') return [];
  if (stripped.kind === 'union')
    return stripped.types.flatMap((arm) => pointCoordinateTypes(arm, k));
  if (stripped.kind === 'tuple') {
    const coord = tupleElementType(stripped, k);
    return coord === undefined ? [] : [coord];
  }
  const element = collectionElementType(stripped);
  if (element === undefined || typeof element === 'string') return [];
  return pointCoordinateTypes(element, k);
}

/**
 * Compile a point coordinate accessor (`PointX`/`PointY`/`PointZ`), where `k`
 * is the 0-based coordinate.
 *
 * The operand takes one of these lowerings, in this order:
 *
 * - a literal SINGLE point (a `Tuple`, an all-scalar `PointList`, or a symbol
 *   assigned one): the coordinate is selected at compile time;
 * - an operand whose static type is a tuple: `_IA.component` reads the
 *   coordinate off the run-time array;
 * - a LIST of points — a declared `list<tuple<…>>`, a list of numeric
 *   coordinate rows, a `PointList` with a list component (built at run time
 *   by `_IA.pointList`), or a provably empty collection: the interpreter and the
 *   JavaScript target broadcast the coordinate over the list, and so does this
 *   target, with `_IA.pointComponent` reading the coordinate of every point of
 *   the run-time array. The result is a collection value (an array of
 *   intervals, `IntervalValue`), consumed the way a comprehension root or a
 *   list-typed input is: by an accessor, a reducer, the element-wise broadcast
 *   of a kernel (`tryIntervalBroadcast`), or the caller of `run` at the root;
 * - an operand whose static type settles NEITHER reading — a
 *   `tuple | list<tuple>` union (the parameter a helper reads with `PointX(v)`
 *   and is called with one point or a list of them), an untyped operand:
 *   `_IA.pointComponent` decides at the value, as the interpreter's
 *   `pointComponentAt` does. An EMPTY array is the one value both readings
 *   spell alike, so the declared element type's answer is carried into the
 *   call (`elementTypeBroadcastsWhenEmpty`: broadcast, or element-index);
 * - any other indexed collection (a `list<number>`, one point spelled flat):
 *   `_IA.component` element-indexes it.
 *
 * A coordinate the static type proves is not a number (`PointX` over a
 * `tuple<string, number>`, or a list of such points) has no interval reading,
 * so the accessor declines rather than hand a text value to a kernel behind
 * `success: true`.
 *
 * A WIDE literal list of points never reaches this function: the fixed-width
 * unroll pass (`compilation/fixed-width-unroll.ts`) rewrites the accessor over
 * it into a literal list of scalar coordinates before any target runs.
 */
function compileIntervalPointComponent(
  name: string,
  arg: Expression | null | undefined,
  k: number,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (arg === null || arg === undefined)
    throw new Error(`Could not compile \`${name}\`: no argument`);
  const literal = literalPointOps(arg, target);
  if (literal !== undefined) {
    const coordinate = literal[k];
    // A coordinate past the end of the point selects nothing; the interpreter
    // yields no value there and this target projects "no value" to absence.
    if (coordinate === undefined) return INTERVAL_ABSENCE;
    return compile(coordinate);
  }
  const t = compilationType(arg);
  for (const coord of pointCoordinateTypes(t, k)) {
    if (!couldMatch(coord, 'number'))
      throw new Error(
        `Could not compile \`${name}\`: the coordinate is not a number (the ` +
          `operand's type is \`${arg.type.toString()}\`), and the interval ` +
          `target's value is a numeric interval.`
      );
  }
  // A literal point that `literalPointOps` does not fold — a `PointList`
  // whose coordinates are untyped symbols, substituted for a helper's
  // parameter — is spelled as the array of its coordinates
  // (`compileIntervalCollectionOperand`); there is no free-standing
  // `PointList` lowering to compile it through.
  if (typeof t !== 'string' && t.kind === 'tuple')
    return `_IA.component(${compileIntervalCollectionOperand(arg, compile, target)}, ${k})`;
  // The type PROVES a list of points, so the reading is stated to the helper
  // (its fourth argument): a point whose other coordinates are not numbers
  // (`list<tuple<string, number>>`) would otherwise fail the helper's own
  // row test, which requires every cell of the first point to be a number.
  if (
    isPointListOperand(arg) ||
    isCoordinateRowListOperand(arg) ||
    isEmptyCollectionOperand(arg)
  )
    return `_IA.pointComponent(${compileIntervalCollectionOperand(arg, compile, target)}, ${k}, true, true)`;
  if (mayBePointList(t)) {
    const emptyReading = elementTypeBroadcastsWhenEmpty(
      collectionElementType(stripMissingFromType(t))
    )
      ? ''
      : ', false';
    return `_IA.pointComponent(${compileIntervalCollectionOperand(arg, compile, target)}, ${k}${emptyReading})`;
  }
  return `_IA.component(${compile(arg)}, ${k})`;
}

/**
 * Compile an N-ary chained relation (`Less`, `Greater`, `Equal`, …) to the
 * conjunction of ALL pairwise comparisons, combined with the tri-state
 * `_IA.and`. The runtime `_IA.and` is strictly binary, so the conjunction is
 * nested. A 2-operand chain is a single comparison.
 */
function compileIntervalChain(
  op: string,
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>,
  target?: CompileTarget<Expression>
): string {
  if (args.length < 2)
    throw new Error(
      `Could not compile \`${op}\`: expected at least two arguments`
    );
  // A MIDDLE operand appears in two comparisons (`a < m < b` → `and(a<m,
  // m<b)`). Emitting it twice evaluates it twice, diverging from the
  // interpreter — which evaluates each operand once — and doubling the work of
  // a non-trivial operand. Bind each non-trivial middle operand to a temporary
  // (the same treatment the scalar infix path in `BaseCompiler` gives them; a
  // symbol or number literal is safe to duplicate and stays inline).
  const bindings: Array<[name: string, value: string]> = [];
  const codes = args.map((arg, i) => {
    // Operands from index 2 on are the chained-relation lazy positions of the
    // shared inventory (`LAZY_OPERANDS`): pass the index so the CSE pass pushes
    // the region harvest opened for them. (This lowering is eager today —
    // `_IA.and` is a strict call — but the region must be pushed regardless, or
    // a later short-circuiting lowering would hoist a temp out of a position
    // that may not run.) A non-region index simply compiles as before.
    const code = compile(arg, i);
    const isMiddle = i >= 1 && i <= args.length - 2;
    if (
      target?.bindExpr !== undefined &&
      isMiddle &&
      !isSymbol(arg) &&
      !isNumber(arg)
    ) {
      const name = BaseCompiler.tempVar(target);
      bindings.push([name, code]);
      return name;
    }
    return code;
  });
  let result = `${op}(${codes[0]}, ${codes[1]})`;
  for (let i = 1; i < codes.length - 1; i++)
    result = `_IA.and(${result}, ${op}(${codes[i]}, ${codes[i + 1]}))`;
  if (bindings.length > 0 && target?.bindExpr !== undefined)
    return target.bindExpr(bindings, result);
  return result;
}

/**
 * Fold an N-ary `And`/`Or` over ALL operands. The runtime `_IA.and`/`_IA.or`
 * are strictly binary, so this is a left-nested fold.
 */
function compileIntervalFold(
  op: string,
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>
): string {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${op}\`: expected at least one argument`
    );
  let result = compile(args[0], 0);
  // `And`/`Or` operands after the first are the inventory's short-circuit lazy
  // positions: pass the index so the harvested region is pushed. (`_IA.and` is
  // a strict call, so this lowering evaluates them eagerly today; the region
  // must still be pushed — see `compileIntervalChain`.)
  for (let i = 1; i < args.length; i++)
    result = `${op}(${result}, ${compile(args[i], i)})`;
  return result;
}

/**
 * Mathematical constants the interval target bakes into the emitted code,
 * keyed by MathJSON symbol. Each is a degenerate (point) interval — the
 * target's value model holds one interval per quantity.
 *
 * Consulted by the target's `var` resolver (both the fast path and the main
 * path) and, through `constant`, by the reference analysis that computes
 * `freeSymbols` — a symbol spelled here is inlined, so it is never an input
 * the caller has to supply.
 *
 * Null-prototype so a lookup answers only for a key the table actually
 * declares. A plain object literal inherits `Object.prototype`, so indexing it
 * with an ordinary symbol named `toString`, `constructor` or `valueOf` returns
 * an inherited function rather than `undefined` — which the reference analysis
 * would read as "the target inlines this" and drop a genuine input from
 * `freeSymbols`.
 */
/**
 * Fail closed when the free symbol `id` is complex-valued. The interval
 * domain is real: an input reads as one real interval `{lo, hi}`, and no
 * lowering of this target has complex arithmetic. A symbol declared
 * `complex` that compiled as a real interval gave a wrong value behind
 * `success: true` (`1 - (t + z)` emitted `_IA.sub(…, _.z)`).
 *
 * The test is `BaseCompiler.isComplexValued`, the one the other targets use
 * to choose their complex lowering, so a symbol is complex here exactly when
 * the JavaScript target would read it as `{re, im}`. The raw type is not
 * enough: a symbol with no declaration whose type was inferred from a use
 * (`|x|` infers `x: complex | infinity`) is not complex-valued there.
 */
function assertIntervalRealSymbol(ce: ComputeEngine, id: string): void {
  const symbol = ce.symbol(id);
  if (!BaseCompiler.isComplexValued(symbol)) return;
  throw new Error(
    `Could not compile \`${id}\`: the symbol has the complex type ` +
      `\`${symbol.type.toString()}\`. The interval target computes with ` +
      `real intervals only and has no complex arithmetic.`
  );
}

/** See `varsObjectAccess` in `javascript-target.ts` — the same own-property
 * guard, for the interval target's own vars-object emission. */
function intervalVarsAccess(id: string): string {
  if (!Object.hasOwn(Object.prototype, id)) return `_.${id}`;
  // `Object.prototype.hasOwnProperty.call`, not `Object.hasOwn`: this text
  // becomes part of the emitted `.code` artifact, which the caller may run on
  // a host far older than the Node that compiled it (`Object.hasOwn` is
  // ES2022). The compiler's OWN lookups use `Object.hasOwn` freely.
  return `(Object.prototype.hasOwnProperty.call(_, ${JSON.stringify(
    id
  )}) ? _.${id} : undefined)`;
}

/**
 * The heads of `INTERVAL_JAVASCRIPT_FUNCTIONS` whose handlers accept a
 * collection-valued operand, and so are NOT wrapped by the scalar-operand gate
 * (`guardedIntervalFunction`): the accessors, which project a collection
 * operand back to one interval; `Norm`, whose operand is a point; and the
 * binders `Sum`/`Product`/`Integrate`, whose handlers judge their own body and
 * limits with more specific diagnostics (`assertScalarBigOpBody`,
 * `compileIntervalIntegrate`); `Max`/`Min`, whose one-collection form is
 * a reduction and whose scalar fold runs the gate itself; and the selection
 * forms `Which`/`When`, whose ARMS may be collection values (a list handed
 * whole to whichever arm is selected — the run-time `piecewise`, `restrict`
 * and `hull` read an array arm in its own domain) while their conditions
 * are held scalar by `assertScalarCondition`.
 */
const COLLECTION_AWARE_HEADS: ReadonlySet<string> = new Set([
  'Which',
  'When',
  'At',
  'Length',
  'PointX',
  'PointY',
  'PointZ',
  'Norm',
  'Sum',
  'Product',
  'Max',
  'Min',
  'Integrate',
]);

/**
 * Fail closed when a scalar interval kernel is handed a provably
 * collection-valued operand.
 *
 * Every kernel in this target reads `.lo`/`.hi` off its operands: a
 * JavaScript array reaching `_IA.add` answers `{ lo: NaN, hi: NaN }` behind
 * `success: true`, and one reaching `_IA.less` answers `'maybe'` — a wrong
 * value where the interpreter broadcasts element-wise. The interval domain
 * has no element-wise convention (one interval per quantity), so such an
 * operand declines here with a message saying so; the interpreter evaluates
 * it. Only PROVABLE collection-ness is tested (`isCollection`, or a type that
 * matches the `collection<any>` shape top): a wide-declared operand
 * (`unknown`, a function's unannotated parameter) keeps compiling, since
 * scalar curve and implicit plotting ride this target on exactly such
 * operands.
 */
function assertScalarIntervalOperands(
  head: string,
  args: ReadonlyArray<Expression>
): void {
  for (const arg of args) {
    if (arg.isCollection || arg.type.matches('collection<any>'))
      throw new Error(
        `Could not compile \`${head}\`: the operand \`${arg.toString()}\` is a ` +
          `collection (type \`${arg.type.toString()}\`), and the interval ` +
          `target's kernels take one interval per operand; the interval domain ` +
          `has no element-wise convention. Evaluate the expression instead, or ` +
          `compile a scalar per-element function.`
      );
  }
  // An operand that is POSSIBLY a list of numbers — a `list<number> | number`
  // union (what a coordinate accessor over a point-or-point-list operand
  // answers), a `broadcastable<number>`, or a coordinate accessor whose
  // operand may be a list of points (`isPossiblyNumericListOperand`) — may
  // be an array at run time, which a kernel would read as NaN bounds (or a
  // relation as the verdict `'maybe'`) behind `success: true`. For a head
  // that BROADCASTS on this target the element-wise lowering
  // (`tryIntervalBroadcast`) takes such an operand when every other operand
  // has an interval reading, so one that reaches the kernel did not qualify,
  // and the kernel fails closed on it. A head that does not broadcast here —
  // a relation, a connective — fails closed on the union and accessor shapes
  // too (a list of verdicts is not a value of this target, see
  // `tryIntervalBroadcast`), with one exception: a `broadcastable<number>`
  // keeps the scalar lowering it always had there. `P(x, y) < 0` over a
  // helper whose body reads wide parameters is the ordinary implicit plot,
  // its value at run time is a scalar, and declining it would take every
  // such plot with it; an array there is the caller's.
  const broadcasts = intervalBroadcastHead(head, args[0]?.engine);
  for (const arg of args) {
    if (!broadcasts && isBroadcastableNumberOperand(arg)) continue;
    if (
      couldBeIndexedCollectionOperand(arg) ||
      isPossiblyNumericListOperand(arg)
    )
      throw new Error(
        `Could not compile \`${head}\`: the operand \`${arg.toString()}\` may be ` +
          `a collection at run time (type \`${arg.type.toString()}\`), and ` +
          `the interval target's kernels take one interval per operand.`
      );
  }
}

/** Is `e` typed `broadcastable<number>` (a number or a collection of numbers,
 *  the result type of a kernel over an operand of unsettled collection-ness
 *  and of a helper whose body reads wide parameters)? */
function isBroadcastableNumberOperand(e: Expression): boolean {
  const t = stripMissingFromType(compilationType(e));
  return (
    typeof t !== 'string' &&
    t.kind === 'broadcastable' &&
    isSubtype(t.elements, 'number')
  );
}

/**
 * Does `id` name a head the element-wise lowering (`tryIntervalBroadcast`)
 * applies to: a built-in `broadcastable` operator that returns a NUMBER —
 * not a relation, not a connective (their element-wise value would be a
 * list of verdicts, which this target's result contract does not admit)?
 */
function intervalBroadcastHead(
  id: string,
  engine: ComputeEngine | undefined
): boolean {
  if (engine === undefined) return false;
  const def = engine.lookupDefinition(id);
  if (!isOperatorDef(def) || def.operator.broadcastable !== true) return false;
  return !isRelationalOperator(id) && !INTERVAL_CONNECTIVE_HEADS.has(id);
}

/** Gate-wrapped handlers, built once per head (`guardedIntervalFunction`). */
const GUARDED_INTERVAL_FUNCTIONS = new Map<
  string,
  CompiledFunction<Expression>
>();

/**
 * The handler of `INTERVAL_JAVASCRIPT_FUNCTIONS` for `id`, wrapped so that
 * `assertScalarIntervalOperands` runs on its operands — unless the head is one
 * of `COLLECTION_AWARE_HEADS`, or there is no function-valued handler to wrap.
 * Both `functions` resolvers of this target (the bare `createTarget` one and
 * the `compileOrThrow` one that consults caller overrides first) go through
 * here, so a kernel is never reachable ungated.
 *
 * The gate runs AFTER the handler, not before: a handler that declines on its
 * own terms (`When`'s `assertScalarCondition` names the collection-valued
 * BRANCH CONDITION, `Round` its non-constant precision) reports the more
 * specific reason, and a decline discards the whole compilation anyway, so
 * the emission the handler produced first costs nothing.
 */
function guardedIntervalFunction(
  id: string
): CompiledFunction<Expression> | undefined {
  const handler = INTERVAL_JAVASCRIPT_FUNCTIONS[id];
  if (typeof handler !== 'function' || COLLECTION_AWARE_HEADS.has(id))
    return handler;
  let wrapped = GUARDED_INTERVAL_FUNCTIONS.get(id);
  if (wrapped === undefined) {
    wrapped = (args, compile, target) => {
      const broadcast = tryIntervalBroadcast(
        id,
        handler,
        args,
        compile,
        target
      );
      if (broadcast !== undefined) return broadcast;
      const code = handler(args, compile, target);
      assertScalarIntervalOperands(id, args);
      return code;
    };
    GUARDED_INTERVAL_FUNCTIONS.set(id, wrapped);
  }
  return wrapped;
}

/**
 * The element-wise lowering of a scalar kernel over list operands: `sin(L)`
 * with `L` a list of numbers is the list of the sines, and `L + M` zips the
 * two lists — the interpreter's rule for a `broadcastable` operator, which
 * the run-time `_IA.bcast` reproduces over arrays of intervals
 * (`interval/collections.ts`). Answers `undefined` when the head or the
 * operands do not qualify; the caller then runs the scalar handler and the
 * scalar-operand gate as before.
 *
 * The head must be a built-in `broadcastable` operator that returns a
 * NUMBER: the relations and the connectives broadcast in the interpreter
 * too, but their element-wise value is a list of tri-state verdicts, which
 * is not a value this target's result contract (`IntervalValue`) admits, so
 * they keep the gate. At least one operand must be a list of numbers by its
 * static type — PROVABLY (`isProvablyNumericListOperand`: `list<number>`,
 * `vector<2>`) or POSSIBLY (`isPossiblyNumericListOperand`: a union whose
 * every arm is a number or a list of numbers, such as the
 * `list<number> | number` a coordinate accessor over a point-or-point-list
 * operand answers, or a `broadcastable<number>`; the run-time `_IA.bcast`
 * applies the kernel once when no array is present, so the admission costs
 * nothing at run time for a scalar). A wide `unknown` or a
 * POINT-or-point-list union is not evidence and keeps the gate — a point has
 * no interval reading — so the 2026-08-22 decision stands for everything the
 * type does not spell out. Every other operand must be provably a number,
 * since it is reused at every position.
 *
 * A POINT-VALUED operand is admitted for the arithmetic heads
 * (`INTERVAL_POINT_ARITHMETIC_HEADS`): a point is the array of its coordinate
 * intervals, and the interpreter's point arithmetic is coordinate-wise —
 * point ± point, scalar × point, point / scalar, the negation of a point. The
 * shapes the interpreter refuses (point × point, point + scalar, a division
 * BY a point) are errors at canonicalization and never arrive here. Every
 * other head keeps the scalar gate over a point: `Abs` and `Hypot` read a
 * point WHOLE (its norm), and the 2026-09-15 decision "a point is consumed
 * whole, never mapped over" stands for the elementary functions.
 *
 * The run-time value cannot tell a point from a list of two numbers, and the
 * two do not broadcast alike: the interpreter answers one point per element
 * of a list beside a point (`[1, 2]·(10, 20)` is `[(10, 20), (20, 40)]`), so
 * a plain zip is wrong there. With a point-valued operand present the
 * lowering is therefore `_IA.bcastPoint`, which is told the kind of every
 * argument: `'p'`, exactly one point; `'q'`, a point or a list of points,
 * decided at the value (an array of arrays is a list of points); `'s'`,
 * number-valued (an array is a list of numbers).
 * "Point-valued" covers a list of points and a point-or-point-list union too
 * (`isIntervalPointValuedOperand`): a document host that declares a helper's
 * point parameter loosely types `V.y·(−sin a, cos a)` as
 * `list<tuple<number, number>>` although the value is one point, and the
 * run-time helper reads both.
 *
 * The closure body is the head's OWN scalar handler applied to the closure's
 * parameters — fresh symbols the inner target resolves to their names — so
 * every kernel convention (the rational-divisor rewrite of `Multiply`, the
 * subtraction form of `Add`, the constant fold) is the scalar lane's. A
 * NUMBER LITERAL operand is handed to the handler as itself, not as a
 * parameter: the handler reads a literal to pick a specialized kernel — the
 * exponent `2/3` selects `powRational`, which encloses a negative base, where
 * a symbolic exponent selects `powInterval`, which answers `empty` there; a
 * literal `Round` precision is required outright — and a literal has no
 * run-time cost to repeat inside the closure. Every other operand is
 * compiled ONCE, outside the closure, as an argument of the broadcast: a
 * list operand through `compileIntervalCollectionValue` (a literal list, a
 * range, a `Map`) or its ordinary lowering (a list-typed input, a helper
 * returning a list), a scalar operand through `compile`.
 */
function tryIntervalBroadcast(
  id: string,
  handler: (
    args: ReadonlyArray<Expression>,
    compile: (expr: Expression) => string,
    target: CompileTarget<Expression>
  ) => string,
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (args.length === 0) return undefined;
  const points = args.map(
    (a) =>
      INTERVAL_POINT_ARITHMETIC_HEADS.has(id) &&
      isIntervalPointValuedOperand(a, target)
  );
  const lists = args.map(
    (a, i) =>
      !points[i] &&
      (isProvablyNumericListOperand(a) || isPossiblyNumericListOperand(a))
  );
  const hasPoint = points.some((x) => x);
  if (!hasPoint && !lists.some((x) => x)) return undefined;
  // The operand shapes the interpreter defines over points. A precise type
  // makes every other shape an error at canonicalization, but a union operand
  // (a point-or-point-list parameter beside the literal `1`) type-checks
  // through its list arm, and lowering it would answer a value where the
  // interpreter answers `incompatible-type`.
  if (hasPoint) {
    const count = points.filter((x) => x).length;
    const shapeOk =
      id === 'Add' || id === 'Subtract'
        ? count === args.length
        : id === 'Multiply'
          ? count === 1
          : id === 'Divide'
            ? count === 1 && points[0]
            : id === 'Negate';
    if (!shapeOk) return undefined;
    // ONE point divided by a list: the interpreter leaves `(2, 1) / [1, 2]`
    // unevaluated. It does not scale the point by every element as it does
    // for `(2, 1)·[1, 2]`, so the point broadcast would answer a list of
    // points where the interpreter has no value. A list of points divided by
    // a list is a zip in the interpreter and stays admitted.
    if (
      id === 'Divide' &&
      isIntervalPointOperand(args[0], target) &&
      lists.some((x) => x)
    )
      return undefined;
  }
  const engine = args[0].engine;
  if (!intervalBroadcastHead(id, engine)) return undefined;
  if (!args.every((a, i) => points[i] || lists[i] || a.type.matches('number')))
    return undefined;
  // A number literal stays in the closure body (see above); every other
  // operand becomes a closure parameter and a broadcast argument.
  const literal = args.map((a, i) => !points[i] && !lists[i] && isNumber(a));
  const params = args.map((a, i) =>
    literal[i] ? undefined : BaseCompiler.tempVar(target)
  );
  const names = params.filter((p): p is string => p !== undefined);
  // Common-subexpression elimination is OFF for the closure body: the
  // parameter symbols share no node with the enclosing expression's harvest,
  // and a temporary hoisted outside the closure could not read a parameter.
  // (Today's handlers only compile the bare parameter symbols, so no
  // candidate would be registered either way; the rule is kept explicit, as
  // in `compileIntervalDynamicRangeReduce`.)
  const inner: CompileTarget<Expression> = {
    ...target,
    cse: undefined,
    var: (name) => (names.includes(name) ? name : target.var(name)),
    boundVars: BaseCompiler.withBoundNames(target, names),
  };
  const body = handler(
    args.map((a, i) => (literal[i] ? a : engine.expr(params[i]!))),
    (expr) => BaseCompiler.compileValueOperand(expr, inner),
    inner
  );
  const source = (a: Expression, i: number): string =>
    lists[i] || points[i]
      ? (compileIntervalCollectionValue(a, target) ?? compile(a))
      : compile(a);
  const kept = args.flatMap((_, i) => (literal[i] ? [] : [i]));
  const sources = kept.map((i) => source(args[i], i)).join(', ');
  if (!hasPoint)
    return `_IA.bcast((${names.join(', ')}) => ${body}, ${sources})`;
  // `'p'`: the type or the literal proves exactly one point. `'q'`: a list
  // of points or a point-or-point-list union, which the helper decides at
  // the value. `'s'`: a number or a list of numbers.
  const kinds = kept
    .map((i) =>
      !points[i] ? 's' : isIntervalPointOperand(args[i], target) ? 'p' : 'q'
    )
    .join('');
  return `_IA.bcastPoint((${names.join(', ')}) => ${body}, '${kinds}', ${sources})`;
}

/**
 * The heads whose element-wise lowering admits a POINT operand
 * (`tryIntervalBroadcast` says why only these): the arithmetic the
 * interpreter defines coordinate-wise over points. `Subtract` is listed for
 * completeness; the canonical form is `Add` of a `Negate`.
 */
const INTERVAL_POINT_ARITHMETIC_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
]);

/**
 * Is `e` a single POINT whose coordinates have an interval reading — so that
 * its run-time value is the array of its coordinate intervals?
 *
 * Two shapes qualify. A LITERAL point — a `Tuple`, an all-scalar `PointList`,
 * or a symbol assigned one — with no broadcasting component (a list
 * coordinate makes it a list of points) and coordinates that each have an
 * interval reading (`hasIntervalReading`). And an operand whose STATIC TYPE
 * is a parameterized tuple whose components are each a number, a
 * `broadcastable<number>` (the component type of a point a helper builds
 * from the coordinates of a wide parameter,
 * `C_mul(a, b) := (a.x·b.x − a.y·b.y, …)`), or `unknown` (the component type
 * of `U(x, y) := (x, y)` over untyped parameters, which every scalar position
 * of this target already reads as an interval). A component proved to be
 * anything else — text, a boolean, a nested point — has no interval reading,
 * and the operand keeps the scalar gate.
 */
function isIntervalPointOperand(
  e: Expression,
  target: CompileTarget<Expression>
): boolean {
  const ops = literalPointOps(e, target);
  if (ops !== undefined) {
    const literal = assignedLiteral(e, target) ?? e;
    return (
      ops.length > 0 &&
      !pointHasBroadcastComponent(literal) &&
      ops.every((op) => hasIntervalReading(op) && !op.isCollection)
    );
  }
  return isIntervalPointType(compilationType(e));
}

/** Is `t` a parameterized tuple whose components each have an interval
 *  reading: a number, a `broadcastable<number>`, or `unknown`? See
 *  `isIntervalPointOperand` for why those three. */
function isIntervalPointType(t: Type): boolean {
  if (typeof t === 'string' || t.kind !== 'tuple' || t.elements.length === 0)
    return false;
  return t.elements.every(({ type }) => {
    if (type === 'unknown') return true;
    if (typeof type !== 'string' && type.kind === 'broadcastable')
      return isSubtype(type.elements, 'number');
    return isSubtype(type, 'number');
  });
}

/**
 * Is `e` POINT-VALUED: a single point (`isIntervalPointOperand`), a list of
 * points, or a union of the two — by its static type, an indexed collection
 * whose elements are points with an interval reading
 * (`list<tuple<number, number>>`), or a union whose every arm is such a point
 * or such a list? The run-time `_IA.bcastPoint` tells one point from a list of
 * points by the value, so the three are one class for the arithmetic heads.
 * An arm that states no coordinates (a bare `tuple`, a `collection<any>`)
 * proves nothing and keeps the scalar gate.
 */
function isIntervalPointValuedOperand(
  e: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (isIntervalPointOperand(e, target)) return true;
  if (isProvablyStringOperand(e)) return false;
  const pointValued = (t: Type): boolean => {
    if (typeof t === 'string') return false;
    if (t.kind === 'union')
      return t.types.length > 0 && t.types.every((arm) => pointValued(arm));
    if (t.kind === 'tuple') return isIntervalPointType(t);
    if (!isSubtype(t, 'indexed_collection<any>')) return false;
    const element = collectionElementType(t);
    return element !== undefined && pointValued(element);
  };
  return pointValued(compilationType(e));
}

/**
 * Is `e` POSSIBLY a list of numbers, every alternative having an interval
 * reading? Three shapes qualify:
 *
 * - by static type, a union (the absence marker arm set aside) whose arms
 *   are each a number or an indexed collection of numbers, with at least one
 *   collection arm: `list<number> | number` and
 *   `list<number> | missing | number` — what a coordinate accessor answers
 *   over a point-or-point-list operand, or a restricted value over a
 *   broadcastable helper. A union with a POINT arm (a parameterized tuple)
 *   does not: a point has no interval reading, so the operand keeps the
 *   scalar gate, as does a union with a string, boolean or nested-collection
 *   arm. A type that PROVES a list is not a union and answers false here; it
 *   is `isProvablyNumericListOperand`'s;
 * - by static type, a `broadcastable<number>`: a number or a collection of
 *   numbers, the result type of a kernel over an operand whose
 *   collection-ness the type does not settle, and the return type of a
 *   helper whose body reads a coordinate of a wide parameter
 *   (`f(P) := a·P.x² + b·P.y²` types `(collection<any> | tuple) ->
 *   broadcastable<number>`). Every value it stands for has an interval
 *   reading, and on this target such a value is an interval or an array —
 *   no lowering builds a collection that is not an array. Before the
 *   coordinate accessor broadcast over a list of points, nothing produced an
 *   array under this type, so it kept the scalar gate as "not evidence";
 *   now `f(L)` over a list of points returns one, and the kernel above it
 *   (`_IA.mul(a, f(L))`) read the array as NaN bounds behind
 *   `success: true`;
 * - by structure, a coordinate accessor (`PointX`/`PointY`/`PointZ`) whose
 *   operand may be a list of points while the accessor's own type says
 *   nothing (`unknown`): the parameter a helper reads with `PointX(v)` types
 *   `collection<any> | tuple`, which the accessor's type handler cannot
 *   distribute, yet its lowering decides at the value
 *   (`compileIntervalPointComponent`, `_IA.pointComponent`) and answers an
 *   array for a list. Read from the type alone, `PointX(v) + 1` reached the
 *   scalar kernel and answered NaN bounds for a list behind `success: true`.
 *
 * Such an operand is an interval or an array at run time, and the consumers
 * that admit it — the element-wise broadcast (`tryIntervalBroadcast`,
 * `_IA.bcast`) and the collection reductions
 * (`compileIntervalCollectionReduce`) — both dispatch on the value; the
 * scalar-operand gate (`assertScalarIntervalOperands`) refuses it.
 */
function isPossiblyNumericListOperand(e: Expression): boolean {
  if (isProvablyStringOperand(e)) return false;
  if (
    (isFunction(e, 'PointX') ||
      isFunction(e, 'PointY') ||
      isFunction(e, 'PointZ')) &&
    e.type.isUnknown &&
    e.op1 !== undefined
  ) {
    const operandType = compilationType(e.op1);
    if (
      (typeof operandType === 'string' || operandType.kind !== 'tuple') &&
      mayBePointList(operandType)
    )
      return true;
  }
  const t = stripMissingFromType(compilationType(e));
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return isSubtype(t.elements, 'number');
  if (t.kind !== 'union') return false;
  let list = false;
  for (const arm of t.types) {
    if (isSubtype(arm, 'number')) continue;
    if (typeof arm !== 'string' && arm.kind === 'tuple') return false;
    if (!isSubtype(arm, 'indexed_collection<any>')) return false;
    const element = collectionElementType(arm);
    if (element === undefined || !isSubtype(element, 'number')) return false;
    list = true;
  }
  return list;
}

/** The logical connectives of the interval table, which `tryIntervalBroadcast`
 *  leaves to the scalar-operand gate (see there). */
const INTERVAL_CONNECTIVE_HEADS: ReadonlySet<string> = new Set([
  'And',
  'Or',
  'Not',
]);

/**
 * The inlined spelling of a mathematical constant this target emits.
 *
 * An IRRATIONAL constant has no double, so it is spelled as the two-ulp
 * enclosure of its value (`intervalEnclosureLiteral`) rather than as a
 * point: a degenerate `{ lo: 3.141592653589793, hi: 3.141592653589793 }`
 * for `π` does NOT contain `π`, and this target exists to answer with
 * intervals a caller can trust — a plotter uses one to PROVE that a curve
 * misses a cell. The two constants a double holds exactly (`Half`,
 * `MachineEpsilon`) stay points, as does every number literal a double
 * holds (`number` below).
 *
 * The enclosure is computed here, once per process, from the same double
 * the point spelling used. `GoldenRatio` keeps its arithmetic spelling
 * `(1 + √5) / 2` as the value to enclose; each of the five enclosures is
 * pinned against a 40-digit value of its constant in
 * `test/compute-engine/compile-interval-constant-enclosure.test.ts`.
 */
const INTERVAL_JAVASCRIPT_CONSTANTS: Record<string, string> = {
  __proto__: null as never,
  Pi: intervalEnclosureLiteral(Math.PI),
  ExponentialE: intervalEnclosureLiteral(Math.E),
  // The boolean literals are constants, not free symbols: without them a bare
  // `True` compiled to a dangling `_.True` vars-object lookup that throws at
  // run time. This target's boolean domain is `BoolInterval`
  // (`'true' | 'false' | 'maybe'` — see `interval/types.ts`), so the inlined
  // spelling is the STRING, not a JavaScript boolean.
  True: "'true'",
  False: "'false'",
  NaN: '{ lo: NaN, hi: NaN }',
  ImaginaryUnit: '{ lo: NaN, hi: NaN }',
  Half: '_IA.point(0.5)',
  MachineEpsilon: '_IA.point(Number.EPSILON)',
  GoldenRatio: intervalEnclosureLiteral((1 + Math.sqrt(5)) / 2),
  CatalanConstant: intervalEnclosureLiteral(0.91596559417721901),
  EulerGamma: intervalEnclosureLiteral(0.57721566490153286),
};

/**
 * The operand of a `Negate` node; `undefined` for anything else.
 *
 * `Subtract` canonicalizes to `Add(a, Negate(b))` before compilation, so an
 * `Add` chain that compiled each operand on its own would emit
 * `_IA.add(a, _IA.negate(b))` — an extra call and an extra interval object
 * for every subtraction in the program. The library `sub` kernel answers the
 * same endpoints as that composition (`lo = a.lo − b.hi`,
 * `hi = a.hi − b.lo`), so the chain calls it directly instead.
 *
 * The one behaviour the two spellings do not share: `negate` of a POINT
 * result drops the jump tag that a singular result carries, while `sub`
 * keeps it, so a subtrahend that is a point-valued singular result stays
 * tagged now. No kernel of the interval library produces such a value.
 */
function negatedIntervalOperand(expr: Expression): Expression | undefined {
  if (!isFunction(expr, 'Negate') || expr.nops !== 1) return undefined;
  return expr.op1;
}

/** The compiled spelling of the interval `[0, 0]`, which is also how this
 *  split reports "this side of the value contributes no term". */
const INTERVAL_ZERO = '_IA.point(0)';

/**
 * The real and imaginary parts of a complex-valued expression as two pieces
 * of interval code, or `undefined` when the expression cannot be taken apart
 * structurally.
 *
 * The interval domain is real: one interval per quantity, and a complex value
 * has no spelling in it. `Argument` is nonetheless computable whenever the
 * complex value is BUILT in the expression — the shape `a + i·b` that
 * `Complex(a, b)` and an authored `x + iy` both canonicalize to — because the
 * argument of that value is `atan2(b, a)` over the two REAL parts, and both
 * parts do have an interval spelling. This is the same split the JavaScript
 * target takes (`tryGetJSComplexParts` there), in this target's dialect.
 *
 * Recognized: a real sub-expression (imaginary part zero), a number literal,
 * the imaginary unit, a product with exactly one purely-imaginary factor and
 * real remaining factors, and a sum of those. Anything else — an opaque
 * complex call such as `Sin(z)`, a complex-typed symbol, a product of two
 * complex factors — returns `undefined`, and the caller fails closed.
 *
 * Every operand is compiled exactly once, and each contributes its code to
 * only one of the two parts, so no sub-expression is duplicated. An operand
 * with observable effects declines the split: the parts are emitted
 * imaginary-first in `_IA.atan2`, which would run the effects in an order the
 * interpreter does not.
 */
function tryGetIntervalComplexParts(
  expr: Expression,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression> | undefined
): { re: string; im: string } | undefined {
  if (expr.isPure === false) return undefined;
  if (!BaseCompiler.isComplexValued(expr))
    return { re: compile(expr), im: INTERVAL_ZERO };
  // A complex NUMBER literal holds a machine double for each part, which is
  // the value the interpreter computes with, so each part is a point.
  if (isNumber(expr))
    return { re: `_IA.point(${expr.re})`, im: `_IA.point(${expr.im})` };
  if (isSymbol(expr, 'ImaginaryUnit'))
    return { re: INTERVAL_ZERO, im: '_IA.point(1)' };
  if (isFunction(expr, 'Multiply')) {
    // The one purely-imaginary factor: the `ImaginaryUnit` symbol, or the
    // number literal `Complex(0, k)` that canonicalization puts in its place.
    const ops = expr.ops;
    const scaleOf = (op: Expression): number | undefined =>
      isSymbol(op, 'ImaginaryUnit')
        ? 1
        : isNumber(op) && op.re === 0 && op.im !== 0
          ? op.im
          : undefined;
    const i = ops.findIndex((op) => scaleOf(op) !== undefined);
    if (i < 0) return undefined;
    const rest = ops.filter((_op, k) => k !== i);
    if (rest.some((op) => BaseCompiler.isComplexValued(op))) return undefined;
    const scale = scaleOf(ops[i])!;
    const factors = rest.map((op) => compile(op));
    if (scale !== 1) factors.unshift(`_IA.point(${scale})`);
    let im = factors.length === 0 ? '_IA.point(1)' : factors[0];
    for (let k = 1; k < factors.length; k++)
      im = intervalMulStep(im, factors[k], target);
    return { re: INTERVAL_ZERO, im };
  }
  if (isFunction(expr, 'Add')) {
    const parts: string[][] = [[], []];
    for (const op of expr.ops) {
      const p = tryGetIntervalComplexParts(op, compile, target);
      if (p === undefined) return undefined;
      if (p.re !== INTERVAL_ZERO) parts[0].push(p.re);
      if (p.im !== INTERVAL_ZERO) parts[1].push(p.im);
    }
    const sum = (terms: string[]): string => {
      if (terms.length === 0) return INTERVAL_ZERO;
      let code = terms[0];
      for (let k = 1; k < terms.length; k++)
        code = foldChainStep(`_IA.add(${code}, ${terms[k]})`, target);
      return code;
    };
    return { re: sum(parts[0]), im: sum(parts[1]) };
  }
  return undefined;
}

/**
 * The condition temporaries the closure-free conditional lowering introduced,
 * per compilation.
 *
 * Keyed by the naming context, which every target derived from a root shares
 * with it — a user-function body compiles against a spread copy of the root
 * target — so one list collects the names of the root expression and of every
 * definition body. `compileToIntervalTarget` declares them.
 */
const INTERVAL_CONDITION_VARS = new WeakMap<object, string[]>();

/** A fresh temporary for a compiled conditional's tri-state result, recorded
 *  so the emitted code can declare it. */
function intervalConditionVar(target: CompileTarget<Expression>): string {
  const name = BaseCompiler.tempVar(target);
  const naming = BaseCompiler.namingContext(target);
  const names = INTERVAL_CONDITION_VARS.get(naming);
  if (names === undefined) INTERVAL_CONDITION_VARS.set(naming, [name]);
  else names.push(name);
  return name;
}

/**
 * The emitted spellings that already answer an `IntervalResult` — the
 * conditionals `compileIntervalConditional` wrote — per compilation.
 *
 * Keyed by the naming context, like the condition temporaries above. An arm
 * of a conditional is recognized by the WHOLE string it was recorded under.
 * A test on the first characters of the arm would not prove that the call
 * spans all of it, and it would also stop recognizing a chain if the
 * temporaries were ever spelled differently.
 */
const INTERVAL_RESULT_CODES = new WeakMap<object, Set<string>>();

/**
 * Record `code` as a spelling that answers an `IntervalResult`, and return it.
 */
function markIntervalResultCode(
  target: CompileTarget<Expression>,
  code: string
): string {
  const naming = BaseCompiler.namingContext(target);
  const codes = INTERVAL_RESULT_CODES.get(naming);
  if (codes === undefined) INTERVAL_RESULT_CODES.set(naming, new Set([code]));
  else codes.add(code);
  return code;
}

/**
 * Whether `code` is one of the spellings the conditional lowering itself
 * writes, all of which answer an `IntervalResult` already, so wrapping them in
 * `_IA.res` would only add a call. Every other arm — a kernel call, a symbol,
 * a constant — may answer a bare `{ lo, hi }` and is wrapped.
 */
function isIntervalResultCode(
  code: string,
  target: CompileTarget<Expression>
): boolean {
  // The exhausted tail of a `Which` with no default arm, written by the
  // `Which` entry of the function table.
  if (code === `({ kind: 'empty' })`) return true;
  const codes = INTERVAL_RESULT_CODES.get(BaseCompiler.namingContext(target));
  return codes !== undefined && codes.has(code);
}

/**
 * Drop what a compilation of `target` collected about its conditionals, so a
 * second compilation against the same naming context starts empty.
 *
 * `BaseCompiler.resetNaming` restarts the numbering of the generated
 * temporaries for a caller that compiles twice with one target. Without this
 * reset the second compilation would declare the first compilation's condition
 * temporaries as well as its own re-issued names (`let _tv1, _tv2, _tv1,
 * _tv2;`), which is a syntax error: the runner would then answer `entire` for
 * every input.
 */
function resetIntervalConditionals(target: CompileTarget<Expression>): void {
  const naming = BaseCompiler.namingContext(target);
  INTERVAL_CONDITION_VARS.delete(naming);
  INTERVAL_RESULT_CODES.delete(naming);
}

/**
 * The size, in characters of emitted code, above which a conditional keeps
 * the two closures instead of the ternary chain.
 *
 * The ternary writes each arm TWICE — once in the branch that selects it,
 * once in the hull the undecided condition takes — so a chain of `n` nested
 * conditionals writes its innermost arm 2ⁿ times. Neither copy costs anything
 * to EVALUATE (a decided condition runs one arm, an undecided one runs each
 * arm once, exactly as the closure form does); the cost is the length of the
 * emitted source, which the limit bounds. Above it the closure form is kept,
 * so a deep `cases` chain does not grow its own source exponentially.
 */
const INTERVAL_CONDITIONAL_CODE_LIMIT = 2000;

/**
 * A conditional over a tri-state interval condition: `whenTrue` where the
 * condition certainly holds, `whenFalse` where it certainly fails, and the
 * hull of both where the input straddles the boundary.
 *
 * The lowering is a ternary chain, which is what `_IA.piecewise` does with
 * its two arms — but `_IA.piecewise` has to receive them as functions, and
 * those two closures are allocated on every evaluation of the expression, not
 * only where the branch is taken. The consumer of this target evaluates the
 * kernel once per quadtree node, so a conditional inside a plotted expression
 * paid two closure allocations per node. The chain binds the condition to a
 * temporary and reads it before it evaluates any arm, so an arm that
 * re-enters the same code (a user function whose body carries a conditional)
 * cannot disturb the branch that is already being taken.
 *
 * The arms stay lazily evaluated, which the `Which` lowering depends on: a
 * later arm may divide by zero exactly where an earlier condition holds. The
 * selected arm goes through `_IA.res`, which is the normalization
 * `_IA.piecewise` applied on the way out (`asResult` in
 * `interval/comparison.ts`): without it a conditional would answer a bare
 * `{ lo, hi }` where it used to answer an `{ kind: 'interval', value }`.
 * `_IA.hull` normalizes both of its operands itself.
 */
function compileIntervalConditional(
  condition: string,
  whenTrue: string,
  whenFalse: string,
  target: CompileTarget<Expression> | undefined
): string {
  const lazy = `_IA.piecewise(
      ${condition},
      () => ${whenTrue},
      () => ${whenFalse}
    )`;
  if (target === undefined) return lazy;
  // The chain writes the condition once and each arm twice, plus about eighty
  // characters of punctuation, the two tri-state comparisons and the calls.
  const size = condition.length + 2 * (whenTrue.length + whenFalse.length) + 80;
  if (size > INTERVAL_CONDITIONAL_CODE_LIMIT)
    return markIntervalResultCode(target, lazy);
  const asResult = (code: string): string =>
    isIntervalResultCode(code, target) ? code : `_IA.res(${code})`;
  const c = intervalConditionVar(target);
  return markIntervalResultCode(
    target,
    `((${c} = ${condition}) === 'true' ? ${asResult(whenTrue)} : ` +
      `${c} === 'false' ? ${asResult(whenFalse)} : ` +
      `_IA.hull(${whenTrue}, ${whenFalse}))`
  );
}

/**
 * Interval arithmetic function implementations.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const INTERVAL_JAVASCRIPT_FUNCTIONS: CompiledFunctions<Expression> = {
  __proto__: null as never,
  // Basic arithmetic - using function call syntax
  // The n-ary chains fold each intermediate pair (`foldChainStep`): an
  // intermediate such as the `0.1·π` of `Multiply(0.1, Pi, x + 5)` is not a
  // node of the tree, so the per-node fold (`foldEmittedConstant`) never
  // sees it, and the run-time code would multiply the two points on every
  // call.
  Add: (args, compile, target) => {
    if (args.length === 0) return '_IA.point(0)';
    if (args.length === 1) return compile(args[0]);
    // Chain additions: (a + b) + c. A negated operand subtracts instead of
    // adding its negation (`_IA.sub` answers the same endpoints as
    // `_IA.add` of the `_IA.negate`, with one call and one object fewer).
    //
    // Canonical ordering places a negated product BEFORE a bare symbol, so
    // `x - y·z` arrives as `Add(Negate(y·z), x)` with the negation first.
    // Interval addition is commutative endpoint for endpoint, so when the
    // first operand is negated and the second is not, the chain starts from
    // the second operand and subtracts the first: `_IA.sub(x, y·z)`. This
    // reorders the evaluation of the two operands, which is unobservable
    // only when both are pure, so an impure operand (a `Random` draw) keeps
    // the original order and the `_IA.negate`.
    const firstNegated = negatedIntervalOperand(args[0]);
    const swapFirst =
      firstNegated !== undefined &&
      negatedIntervalOperand(args[1]) === undefined &&
      args[0].isPure === true &&
      args[1].isPure === true;
    let result: string;
    let start: number;
    if (swapFirst) {
      result = foldChainStep(
        `_IA.sub(${compile(args[1])}, ${compile(firstNegated)})`,
        target
      );
      start = 2;
    } else {
      result = compile(args[0]);
      start = 1;
    }
    for (let i = start; i < args.length; i++) {
      const subtrahend = negatedIntervalOperand(args[i]);
      const step =
        subtrahend !== undefined
          ? `_IA.sub(${result}, ${compile(subtrahend)})`
          : `_IA.add(${result}, ${compile(args[i])})`;
      result = foldChainStep(step, target);
    }
    return result;
  },
  // No Subtract handler — canonicalizes to Add+Negate before compilation.
  Multiply: (args, compile, target) => {
    if (args.length === 0) return '_IA.point(1)';
    if (args.length === 1) return compile(args[0]);
    // A product with an exact rational factor `p/q` becomes a DIVISION by
    // the integer `q` — see `exactRationalDivisor` for why multiplying by
    // the rounded reciprocal misses at exact multiples of `q`. The division
    // comes FIRST and the numerator `p` multiplies the quotient afterwards:
    // the product `p * x` overflows to infinity for a large `x` where the
    // quotient does not. At `x = k·q` the quotient is still exactly `k`, and
    // `k * p` is exact for safe integers, so the reason for the rewrite
    // survives the reordering.
    const ratIndex = args.findIndex(
      (arg) => exactRationalDivisor(arg) !== undefined
    );
    const rat = ratIndex < 0 ? undefined : exactRationalDivisor(args[ratIndex]);
    if (rat !== undefined) {
      const codes = args
        .filter((_, i) => i !== ratIndex)
        .map((arg) => compile(arg));
      // A factor of exactly one is the multiplicative identity for every
      // IEEE value, so it is dropped rather than compiled into a run-time
      // `_IA.mul` call. It appears when a `Sum` unroll substitutes the index
      // value 1 into the body. Keep it when it is the only factor left.
      const unitFree = codes.filter((code) => code !== '_IA.point(1)');
      const rest = unitFree.length > 0 ? unitFree : codes;
      // An inexact constant factor absorbs the whole rational — the division
      // disappears from the emitted code (`foldRationalConstantFactors`).
      const absorbed = foldRationalConstantFactors(rest, rat, target);
      if (absorbed !== undefined) {
        let product = absorbed.constant;
        for (const factor of absorbed.factors)
          product = intervalMulStep(product, factor, target);
        return product;
      }
      // The seed, the quotient and the numerator factor all go through the
      // fold as well as each chain step: without the rational factor in front
      // of it, a leading constant such as the enclosure literal that `Pi`
      // emits in `pi (x + 5) / 10` has no pair to fold with, and a product of
      // constants alone folds only once the division closes over it.
      let numerator = foldChainStep(rest[0], target, true);
      for (let i = 1; i < rest.length; i++) {
        numerator = intervalMulStep(numerator, rest[i], target);
      }
      // A numerator of −1 puts the sign on the DIVISOR rather than negating
      // the quotient: `x/(−q)` and `−(x/q)` have the same correctly rounded
      // endpoints (IEEE division takes its sign from the operand signs), and
      // the negative divisor keeps the two-corner `scaleDiv` kernel where a
      // separate `_IA.negate` call would allocate an interval per evaluation.
      const quotient = intervalDivStep(
        numerator,
        `_IA.point(${rat.p === -1 ? -rat.q : rat.q})`,
        target
      );
      if (rat.p === 1 || rat.p === -1) return quotient;
      return intervalMulStep(quotient, `_IA.point(${rat.p})`, target);
    }
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = intervalMulStep(result, compile(args[i]), target);
    }
    return result;
  },
  Divide: (args, compile, target) => {
    if (args.length === 0) return '_IA.point(1)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = intervalDivStep(result, compile(args[i]), target);
    }
    return result;
  },
  // Each `_IA.negate` call allocates an interval its consumer reads once, so
  // the sign is folded into the operand wherever that is exact:
  //
  // - a negation of a negation cancels (flipping the sign of each endpoint
  //   twice restores the operand, and the kernel takes no outward step);
  // - a negated CONSTANT point becomes the constant with the opposite sign,
  //   which the constant table then binds once;
  // - a point SCALING or point DIVISION takes the sign on its constant, since
  //   IEEE multiplication and division take their sign from the operand signs
  //   and their magnitude from the magnitudes, and the outward step and its
  //   exactness proof read the magnitudes.
  //
  // A general `_IA.div` is NOT folded into `_IA.negDiv`: the division reports
  // which END of a domain-clipped answer the clip is on, and negating the
  // NUMERATOR mirrors that end while negating the ANSWER cannot recover it —
  // `(-x)/[a, 0]` is clipped below where `-(x/[a, 0])` reports "clipped on
  // both ends" (measured over the operand shapes in
  // `interval-277-278-constant-table-sign-conditional.test.ts`).
  Negate: (args, compile) => {
    const operand = compile(args[0]);
    const doubled = strippedIntervalNegate(operand);
    if (doubled !== undefined) return doubled;
    const constant = negatedConstantPointCode(operand);
    if (constant !== undefined) return constant;
    const quotient = splitIntervalCall(operand, 'scaleDiv');
    if (quotient !== undefined) {
      const divisor = negatedConstantPointCode(quotient[1]);
      if (divisor !== undefined)
        return `_IA.scaleDiv(${quotient[0]}, ${divisor})`;
    }
    const product = splitIntervalCall(operand, 'scale');
    if (product !== undefined) {
      const factor = negatedConstantPointCode(product[0]);
      if (factor !== undefined) return `_IA.scale(${factor}, ${product[1]})`;
    }
    return `_IA.negate(${operand})`;
  },

  // Elementary functions
  // Note: `Abs` of a fixed-arity point never reaches this handler — the
  // shared compiler rewrites `Abs(Tuple)` → `Norm` (base-compiler.ts) so
  // the point compiles through the `Norm` codegen below (Tycho item 74).
  Abs: (args, compile) => `_IA.abs(${compile(args[0])})`,
  // Euclidean (L2) norm of a fixed-arity point. Only the default L2 norm of
  // a structural `Tuple` is representable here; any other operand, an
  // explicit norm-type argument, or a broadcasting component throws to fail
  // closed to scalar JS.
  Norm: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        'Could not compile `Norm`: only the default L2 norm compiles on the interval target'
      );
    const arg = args[0];
    if (!isFunction(arg, 'Tuple'))
      throw new Error(
        'Could not compile `Norm`: the interval target requires a fixed-arity point operand'
      );
    // A broadcasting component means one norm per zipped element — not
    // representable as a scalar interval. Fail closed.
    if (pointHasBroadcastComponent(arg))
      throw new Error(
        'Could not compile `Norm`: a point with a broadcasting component.'
      );
    return compileIntervalPointNorm(arg.ops, compile);
  },

  // Collection ACCESSORS — the heads of this table that take a collection
  // OPERAND (every other kernel fails closed on one, see
  // `assertScalarIntervalOperands`). The operand is a JavaScript array of
  // intervals at run time, and `_IA.at` / `_IA.length` / `_IA.component`
  // project it back down to a single interval (`interval/collections.ts`).
  // There is deliberately no `List` or `Tuple` lowering in this table — see
  // `compileIntervalCollectionOperand`.

  // Element count of a collection, as a point interval.
  Length: (args, compile, target) => {
    const arg = args[0];
    if (arg === null || arg === undefined)
      throw new Error('Could not compile `Length`: no argument');
    // A string's length is its GRAPHEME-CLUSTER count, and this target has no
    // text model at all — its domain is numeric, one interval per quantity —
    // so there is nothing to count clusters with here. The union case
    // (`string | list<number>`) is refused for the same reason: it may hold a
    // string at run time.
    if (isProvablyStringOperand(arg) || couldBeStringOperand(arg))
      throw new Error(
        `Could not compile \`Length\`: the operand may be text at run time, and ` +
          `the interval target's domain is numeric (one interval per ` +
          `quantity) with no text model.`
      );
    // A value that is POSSIBLY a list of numbers (`isPossiblyNumericListOperand`:
    // a `list<number> | number` union, a `broadcastable<number>` helper
    // result) is admitted: `_IA.length` answers the absence marker for a
    // scalar at run time, the interpreter's "no value" for a non-collection.
    if (!isIndexedCollectionOperand(arg) && !isPossiblyNumericListOperand(arg))
      throw new Error(
        `Could not compile \`Length\`: operand is not an indexed collection ` +
          `(list/vector/range).`
      );
    // A literal collection's length is a compile-time constant.
    const ops = literalCollectionOps(arg, target);
    if (ops !== undefined) return `_IA.point(${ops.length})`;
    return `_IA.length(${compileIntervalCollectionOperand(arg, compile, target)})`;
  },

  // Positional access. CE `At` is 1-based and a negative index counts from the
  // end; an index of 0, an out-of-range index or a non-integer index selects
  // nothing, which this target reports as the numeric absence marker. The
  // index is an INTERVAL here, so it stands for a set of indices and `_IA.at`
  // answers the hull of the elements they select (see
  // `interval/collections.ts`).
  At: (args, compile, target) => {
    const coll = args[0];
    const index = args[1];
    if (
      coll === null ||
      coll === undefined ||
      index === null ||
      index === undefined
    )
      throw new Error('Could not compile `At`: missing argument');
    if (args.length !== 2)
      throw new Error(
        `Could not compile \`At\`: only the single-index form compiles; multi-index (nested) ` +
          `access is not supported.`
      );
    // A string base is indexed by grapheme cluster, and this target has no
    // text model — see the `Length` handler above.
    if (isProvablyStringOperand(coll) || couldBeStringOperand(coll))
      throw new Error(
        `Could not compile \`At\`: the base may be text at run time, and the ` +
          `interval target's domain is numeric (one interval per quantity) ` +
          `with no text model.`
      );
    const provablyIndexed = isIndexedCollectionOperand(coll);
    // A base that is POSSIBLY a list of numbers (a `list<number> | number`
    // union, a `broadcastable<number>` helper result) is admitted with the
    // "could be" bases: `_IA.at` answers the absence marker for a scalar base
    // at run time, and the numeric-index requirement below applies.
    if (
      !provablyIndexed &&
      !couldBeIndexedCollectionOperand(coll) &&
      !isPossiblyNumericListOperand(coll)
    )
      throw new Error(
        `Could not compile \`At\`: first operand is not an indexed collection ` +
          `(list/vector/range).`
      );
    // A base admitted only by the "could be" path may be a DICTIONARY at run
    // time, and a keyed lookup has no interval lowering: `_IA.at` answers the
    // absence marker for every non-array base, where the interpreter returns
    // the stored value. Require a provably numeric index there rather than
    // emit a silent absence behind `success: true`.
    if (!provablyIndexed && !isNumericIndexOperand(index))
      throw new Error(
        `Could not compile \`At\`: the first operand is not provably an indexed ` +
          `collection (type \`${coll.type.toString()}\`) and the index is not ` +
          `provably numeric, so a keyed (dictionary) access cannot be ruled ` +
          `out.`
      );
    // A TUPLE base with a component that is not a number (a `tuple<number,
    // string>` pair) matches the indexed-collection shape, but the selected
    // component has no interval reading: `_IA.at` would answer `entire` for
    // it at run time behind `success: true`. Decline statically instead.
    const baseType = compilationType(coll);
    if (
      typeof baseType !== 'string' &&
      baseType.kind === 'tuple' &&
      baseType.elements.some((el) => !isSubtype(el.type, 'number'))
    )
      throw new Error(
        `Could not compile \`At\`: the tuple base has a component that is not a ` +
          `number (its type is \`${coll.type.toString()}\`), and the interval ` +
          `target's value is a numeric interval.`
      );
    // A COLLECTION index is a gather or a boolean mask, whose result is itself
    // a collection — one element per index entry. This target has no lowering
    // that builds such a per-entry selection at run time (a collection-valued
    // result exists only where a lowering builds it, such as a comprehension
    // root).
    if (
      isIndexedCollectionOperand(index) ||
      index.type.matches('collection<any>')
    )
      throw new Error(
        `Could not compile \`At\`: a collection-valued index (a gather or a ` +
          `boolean mask) selects several elements, and the interval target has ` +
          `no lowering that builds that selection at run time.`
      );
    // A literal collection indexed by a literal integer folds to the selected
    // element (or to the absence marker when the index selects nothing),
    // applying the interpreter's 1-based / negative-from-the-end convention at
    // compile time.
    const ops = literalCollectionOps(coll, target);
    // The element the interpreter's 1-based, negative-from-the-end
    // convention selects, or the absence marker when the index selects
    // nothing. Every DISCARDED element must be pure and free of code the
    // caller supplied (a symbol mapped to live source, a head the caller
    // overrode): the interpreter evaluates the whole list, so dropping an
    // element with an effect would change how many times that effect runs.
    // The same rule guards the JavaScript unroll of a literal-index read
    // (`fixed-width-unroll.ts`). When it refuses, the read stays a run-time
    // `_IA.at` over the whole list.
    const select = (
      elements: ReadonlyArray<Expression>,
      i: number
    ): string | undefined => {
      const k = i > 0 ? i - 1 : elements.length + i;
      const selected = i === 0 || k < 0 || k >= elements.length ? -1 : k;
      const callerOptions = {
        skipHeads: target.unrollSkipHeads,
        readsLiveSource: target.cse?.harvestOptions?.isStringVar,
      };
      if (
        elements.some(
          (el, j) =>
            j !== selected &&
            (el.isPure !== true || readsCallerSource(el, callerOptions))
        )
      )
        return undefined;
      return selected < 0 ? INTERVAL_ABSENCE : compile(elements[selected]);
    };
    if (ops !== undefined && isNumber(index) && index.im === 0) {
      const i = index.re;
      if (Number.isInteger(i)) {
        const selected = select(ops, i);
        if (selected !== undefined) return selected;
      }
    }
    const indexCode = compile(index);
    // The index is not a literal but its CODE is a constant integer point —
    // the unrolled term of a sum reads `h[i+1]` with `i` substituted, and
    // `i+1` reaches here as an unfolded sum that the constant fold answers.
    // Selecting the element here is what keeps the whole list out of the
    // emitted term: an unrolled 11-term sum over a 400-element assigned list
    // spelled the list eleven times (Tycho corpus document `vwbagbcerj`).
    if (ops !== undefined) {
      const constant =
        foldConstantIntervalCode(
          indexCode,
          false,
          intervalSpliceSources(target)
        ) ?? indexCode;
      const endpoints = constantIntervalEndpoints(constant);
      if (endpoints !== undefined && endpoints[0] === endpoints[1]) {
        const i = Number(endpoints[0]);
        if (Number.isInteger(i)) {
          const selected = select(ops, i);
          if (selected !== undefined) return selected;
        }
      }
    }
    return `_IA.at(${compileIntervalCollectionOperand(
      coll,
      compile,
      target
    )}, ${indexCode})`;
  },

  // Point coordinates. The operand must be a SINGLE point — see
  // `compileIntervalPointComponent`.
  PointX: (args, compile, target) =>
    compileIntervalPointComponent('PointX', args[0], 0, compile, target),
  PointY: (args, compile, target) =>
    compileIntervalPointComponent('PointY', args[0], 1, compile, target),
  PointZ: (args, compile, target) =>
    compileIntervalPointComponent('PointZ', args[0], 2, compile, target),

  Ceil: (args, compile) => `_IA.ceil(${compile(args[0])})`,
  Exp: (args, compile) => `_IA.exp(${compile(args[0])})`,
  Floor: (args, compile) => `_IA.floor(${compile(args[0])})`,
  Ln: (args, compile) => `_IA.ln(${compile(args[0])})`,
  Log: (args, compile) => {
    // Base 10 (the one-argument form) and base 2 take the dedicated
    // enclosure, matching the point kernels of the `javascript` target
    // (Tycho item 240); any other base is `ln(x) / ln(b)`.
    const base = BaseCompiler.fixedLogBase(args);
    if (base !== undefined) return `_IA.log${base}(${compile(args[0])})`;
    return `_IA.div(_IA.ln(${compile(args[0])}), _IA.ln(${compile(args[1])}))`;
  },
  Lb: (args, compile) => `_IA.log2(${compile(args[0])})`,
  // `Max`/`Min` over a collection operand is the interpreter's reduction
  // over its elements (`Max([1, 2, 3])` is `3`, `Max(0, [1, 2, 3])` is `3`
  // too; it flattens, it does not broadcast) — see `compileIntervalExtremum`.
  // The two heads are in `COLLECTION_AWARE_HEADS` for the reduce form, so
  // the scalar fold gates its own operands (`assertScalarIntervalOperands`).
  Max: (args, compile, target) =>
    compileIntervalExtremum('Max', args, compile, target),
  Min: (args, compile, target) =>
    compileIntervalExtremum('Min', args, compile, target),
  // Element-wise max/min and clamp. These lowerings are SCALAR: they fold the
  // operands with the interval max/min, and `Clamp(x, lo, hi)` becomes
  // `min(max(x, lo), hi)`. A collection operand has no element-wise treatment
  // here — this target's value is one interval.
  // Interval max/min/clamp are monotonic, so they map endpoint-wise — enabling
  // break detection for the common `Clamp(x, 0, 1)` line-series idiom.
  ElementMax: (args, compile) => {
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      result = `_IA.max(${result}, ${compile(args[i])})`;
    return result;
  },
  ElementMin: (args, compile) => {
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      result = `_IA.min(${result}, ${compile(args[i])})`;
    return result;
  },
  Clamp: (args, compile) =>
    `_IA.min(_IA.max(${compile(args[0])}, ${compile(args[1])}), ${compile(
      args[2]
    )})`,
  Power: (args, compile) => {
    const base = args[0];
    const exp = args[1];
    if (base === null)
      throw new Error('Could not compile `Power`: no argument');
    // Check if this is e^x (base is ExponentialE)
    if (isSymbol(base, 'ExponentialE')) {
      return `_IA.exp(${compile(exp)})`;
    }
    // Check if exponent is a constant number
    if (isNumber(exp) && exp.im === 0) {
      const expVal = exp.re;
      if (expVal === 0.5) return `_IA.sqrt(${compile(base)})`;
      if (expVal === 2) return `_IA.square(${compile(base)})`;
      // Rational exponent p/q (in lowest terms) with an ODD denominator is real
      // for a negative base too (e.g. (-8)^(2/3) = 4). Route through
      // `powRational`, which applies the interpreter's real-root convention;
      // plain `_IA.pow` would return `empty` for the negative part.
      const p = exp.numerator?.re;
      const q = exp.denominator?.re;
      if (
        !Number.isInteger(expVal) &&
        Number.isInteger(p) &&
        Number.isInteger(q) &&
        q > 1 &&
        q % 2 !== 0
      ) {
        return `_IA.powRational(${compile(base)}, ${p}, ${q})`;
      }
      return `_IA.pow(${compile(base)}, ${expVal})`;
    }
    // Variable exponent - use powInterval
    return `_IA.powInterval(${compile(base)}, ${compile(exp)})`;
  },
  Root: (args, compile) => {
    const [arg, exp] = args;
    if (arg === null) throw new Error('Could not compile `Root`: no argument');
    if (exp === null) return `_IA.sqrt(${compile(arg)})`;
    if (exp?.re === 2) return `_IA.sqrt(${compile(arg)})`;
    if (isNumber(exp) && exp.im === 0) {
      // Integer degree: `nthRoot` gives the real root for an odd degree over a
      // negative base (the interpreter's convention, e.g. Root(-8, 3) = -2);
      // an even degree reduces to x^(1/n) (no real value for a negative base).
      if (Number.isInteger(exp.re))
        return `_IA.nthRoot(${compile(arg)}, ${exp.re})`;
      // Non-integer degree: nth root = x^(1/n).
      return `_IA.pow(${compile(arg)}, ${1 / exp.re})`;
    }
    return `_IA.powInterval(${compile(arg)}, _IA.div(_IA.point(1), ${compile(
      exp
    )}))`;
  },
  Round: (args, compile) => {
    if (args.length < 2) return `_IA.round(${compile(args[0])})`;
    // Round(x, n) = Round(x·10ⁿ)/10ⁿ — round to `n` decimal places. Only the
    // constant-`n` form is representable here (the factor must be a point);
    // a non-constant precision throws to fail closed to scalar JS.
    const n = args[1];
    if (!isNumber(n) || n.im !== 0 || !Number.isInteger(n.re))
      throw new Error(
        'Could not compile `Round`: interval target requires a constant precision'
      );
    // The scale is always spelled as the EXACT integer power `10^|n|`, so the
    // constant is a true point: for `n < 0` the operand is divided by `10^-n`
    // before rounding and multiplied back afterwards (`Round(x, -2)` rounds to
    // hundreds through `100`, not through the double nearest `0.01`, which
    // would need an enclosure of its own inside a step function).
    const scale = `_IA.point(${Math.pow(10, Math.abs(n.re))})`;
    const x = compile(args[0]);
    if (n.re >= 0)
      return `_IA.div(_IA.round(_IA.mul(${x}, ${scale})), ${scale})`;
    return `_IA.mul(_IA.round(_IA.div(${x}, ${scale})), ${scale})`;
  },
  Heaviside: (args, compile) => `_IA.heaviside(${compile(args[0])})`,
  Sign: (args, compile) => `_IA.sign(${compile(args[0])})`,
  Sqrt: (args, compile) => `_IA.sqrt(${compile(args[0])})`,
  Square: (args, compile) => `_IA.square(${compile(args[0])})`,

  // Trigonometric functions
  Sin: (args, compile) => `_IA.sin(${compile(args[0])})`,
  Cos: (args, compile) => `_IA.cos(${compile(args[0])})`,
  Tan: (args, compile) => `_IA.tan(${compile(args[0])})`,
  Cot: (args, compile) => `_IA.cot(${compile(args[0])})`,
  Sec: (args, compile) => `_IA.sec(${compile(args[0])})`,
  Csc: (args, compile) => `_IA.csc(${compile(args[0])})`,
  Arcsin: (args, compile) => `_IA.asin(${compile(args[0])})`,
  Arccos: (args, compile) => `_IA.acos(${compile(args[0])})`,
  Arctan: (args, compile) => `_IA.atan(${compile(args[0])})`,
  Arccot: (args, compile) => `_IA.acot(${compile(args[0])})`,
  Arccsc: (args, compile) => `_IA.acsc(${compile(args[0])})`,
  Arcsec: (args, compile) => `_IA.asec(${compile(args[0])})`,

  // Hyperbolic functions
  Sinh: (args, compile) => `_IA.sinh(${compile(args[0])})`,
  Cosh: (args, compile) => `_IA.cosh(${compile(args[0])})`,
  Tanh: (args, compile) => `_IA.tanh(${compile(args[0])})`,
  Coth: (args, compile) => `_IA.coth(${compile(args[0])})`,
  Csch: (args, compile) => `_IA.csch(${compile(args[0])})`,
  Sech: (args, compile) => `_IA.sech(${compile(args[0])})`,
  Arsinh: (args, compile) => `_IA.asinh(${compile(args[0])})`,
  Arcosh: (args, compile) => `_IA.acosh(${compile(args[0])})`,
  Artanh: (args, compile) => `_IA.atanh(${compile(args[0])})`,
  Arcoth: (args, compile) => `_IA.acoth(${compile(args[0])})`,
  Arcsch: (args, compile) => `_IA.acsch(${compile(args[0])})`,
  Arsech: (args, compile) => `_IA.asech(${compile(args[0])})`,

  // Cardinal sine
  Sinc: (args, compile) => `_IA.sinc(${compile(args[0])})`,

  // Fresnel integrals
  FresnelS: (args, compile) => `_IA.fresnelS(${compile(args[0])})`,
  FresnelC: (args, compile) => `_IA.fresnelC(${compile(args[0])})`,

  // Special functions
  Factorial: (args, compile) => `_IA.factorial(${compile(args[0])})`,
  Factorial2: (args, compile) => `_IA.factorial2(${compile(args[0])})`,
  Gamma: (args, compile) => `_IA.gamma(${compile(args[0])})`,
  GammaLn: (args, compile) => `_IA.gammaln(${compile(args[0])})`,
  Binomial: (args, compile) =>
    `_IA.binomial(${compile(args[0])}, ${compile(args[1])})`,
  // `Choose(n, k)` is the binomial coefficient — the same runtime helper,
  // exactly as on the JavaScript target (Tycho item 237).
  Choose: (args, compile) =>
    `_IA.binomial(${compile(args[0])}, ${compile(args[1])})`,
  GCD: (args, compile) => `_IA.gcd(${compile(args[0])}, ${compile(args[1])})`,
  LCM: (args, compile) => `_IA.lcm(${compile(args[0])}, ${compile(args[1])})`,
  // Tolerance baked at compile time from the engine, matching the
  // interpreter's `Chop` and the JS target (see `javascript-target.ts`).
  Chop: (args, compile) =>
    `_IA.chop(${compile(args[0])}, ${args[0]?.engine?.tolerance ?? 1e-10})`,
  Erf: (args, compile) => `_IA.erf(${compile(args[0])})`,
  Erfc: (args, compile) => `_IA.erfc(${compile(args[0])})`,
  Exp2: (args, compile) => `_IA.exp2(${compile(args[0])})`,
  Arctan2: (args, compile) =>
    `_IA.atan2(${compile(args[0])}, ${compile(args[1])})`,
  // The argument (phase) of a complex value. The interval domain is real, so
  // this compiles only when the operand splits into a real part `a` and an
  // imaginary part `b` (`tryGetIntervalComplexParts`); the phase is then
  // `atan2(b, a)` over two real intervals, which `_IA.atan2` encloses —
  // including across the branch cut on the negative real axis, where it
  // answers the hull [−π, π] as a jump (`interval/trigonometric.ts`).
  //
  // A REAL operand is the same call with an imaginary part of zero: the
  // phase is 0 where the operand is positive and π where it is negative, and
  // `atan2([0, 0], x)` is exactly that.
  Argument: (args, compile, target) => {
    const parts = tryGetIntervalComplexParts(args[0], compile, target);
    if (parts === undefined)
      throw new Error(
        'Could not compile `Argument`: the interval target compiles the phase of a complex value ' +
          'only when the value is built in the expression (the form ' +
          '`a + i·b` with real `a` and `b`), since the interval domain is ' +
          'real and has no complex value of its own.'
      );
    return `_IA.atan2(${parts.im}, ${parts.re})`;
  },
  Hypot: (args, compile) =>
    `_IA.hypot(${compile(args[0])}, ${compile(args[1])})`,
  // Degrees → radians. This lowering runs only in radian mode: in the other
  // angular units `rewriteAngularUnit` replaces the `Degrees` node before
  // codegen. The factor is an ENCLOSURE of π/180, not the rounded double
  // `Math.PI / 180` (which carries up to two rounding errors and does not
  // contain π/180): two ulps each side cover both roundings.
  Degrees: (args, compile) =>
    `_IA.mul(${compile(args[0])}, ${intervalEnclosureLiteral(Math.PI / 180, 2)})`,

  // Elementary
  Fract: (args, compile) => `_IA.fract(${compile(args[0])})`,
  Truncate: (args, compile) => `_IA.trunc(${compile(args[0])})`,

  // Mod / Remainder
  Mod: (args, compile) => `_IA.mod(${compile(args[0])}, ${compile(args[1])})`,
  Remainder: (args, compile) =>
    `_IA.remainder(${compile(args[0])}, ${compile(args[1])})`,

  // Sum / Product
  Sum: (args, compile, target) =>
    compileIntervalSumProduct('Sum', args, compile, target),
  Product: (args, compile, target) =>
    compileIntervalSumProduct('Product', args, compile, target),

  // Integration
  Integrate: (args, compile, target) =>
    compileIntervalIntegrate(args, compile, target),

  // Conditionals
  If: (args, compile, target) => {
    if (args.length !== 3)
      throw new Error('Could not compile `If`: wrong number of arguments');
    // For interval arithmetic, we need to handle indeterminate conditions.
    // Both arms are conditionally evaluated, so their operand indices are
    // passed to the compile callback (`OperandCompiler`), which opens the
    // matching CSE region.
    return compileIntervalConditional(
      compile(args[0]),
      compile(args[1], 1),
      compile(args[2], 2),
      target
    );
  },
  // Domain restriction: When(body, cond) → body where cond holds, empty
  // where it doesn't. Must NOT fall through to the generic JS ternary: the
  // interval comparisons return the tri-state string 'true'|'false'|'maybe',
  // which is always truthy, so a ternary guard would never mask.
  When: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `When`: expected 2 arguments (value, condition)'
      );
    // `When` is not a selection form: its condition must be a scalar boolean.
    BaseCompiler.assertScalarCondition(args[1]);
    // A restricted RELATION (`y ≤ K(x) {K(x) > 0}` as one row) is a verdict:
    // where the restriction fails the relation holds nowhere, where it is
    // undecided the relation holds at most where it held — the conjunction.
    // The JavaScript target reads the same way: its absent condition is
    // falsy. The relation is evaluated only when the condition is not
    // already `'false'`; evaluating it there would be sound — every
    // primitive of this target computes a value with no side effect,
    // `Random()` included, which lowers to its constant support — but the
    // relation may be the expensive half of the row.
    if (args[0].type.matches('boolean')) {
      const c = intervalConditionVar(target);
      return (
        `((${c} = ${compile(args[1])}) === 'false' ? 'false' : ` +
        `_IA.and(${c}, ${compile(args[0], 0)}))`
      );
    }
    // The VALUE is the conditional position (operand 0); the condition is
    // eager — matching the `When` entry of the lazy-operand inventory.
    return `_IA.restrict(${compile(args[1])}, () => ${compile(args[0], 0)})`;
  },
  Which: (args, compile, target) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Could not compile `Which`: expected even number of arguments (condition/value pairs)'
      );
    // Build nested conditionals for each condition/value pair. Every value
    // arm, and every condition after the first, is conditionally evaluated —
    // pass its operand index so the CSE pass opens the matching region.
    const buildPiecewise = (i: number): string => {
      if (i >= args.length) return `({ kind: 'empty' })`;
      const cond = args[i];
      const val = args[i + 1];
      // If condition is the symbol True, it's the default branch
      if (isSymbol(cond, 'True')) {
        return compile(val, i + 1);
      }
      // The arms may be collection values; the conditions may not (the
      // head is exempt from the scalar-operand gate for its arms' sake).
      BaseCompiler.assertScalarCondition(cond);
      return compileIntervalConditional(
        i === 0 ? compile(cond) : compile(cond, i),
        compile(val, i + 1),
        buildPiecewise(i + 2),
        target
      );
    };
    return buildPiecewise(0);
  },
  // Epsil `Match`: structural pattern matching. An interval subject spanning
  // two cases' constants has the same discontinuity hazard as compiled `Which`,
  // but a faithful interval treatment (per-branch `singular` semantics for
  // structural equality dispatch) is an explicit v1 out (design §5). Fail closed
  // (D6) rather than invent it.
  Match: () => {
    throw new Error(
      'Could not compile `Match`: pattern matching is not supported by the interval-js compile target in v1.'
    );
  },
  // Comparisons. Chained (N-ary) relations conjoin ALL pairwise comparisons
  // with the tri-state `_IA.and` (e.g. `1 < x < 4` → less(1,x) ∧ less(x,4)).
  Equal: (args, compile, target) =>
    compileIntervalChain('_IA.equal', args, compile, target),
  NotEqual: (args, compile, target) =>
    compileIntervalChain('_IA.notEqual', args, compile, target),
  LessEqual: (args, compile, target) =>
    compileIntervalChain('_IA.lessEqual', args, compile, target),
  GreaterEqual: (args, compile, target) =>
    compileIntervalChain('_IA.greaterEqual', args, compile, target),
  Less: (args, compile, target) =>
    compileIntervalChain('_IA.less', args, compile, target),
  Greater: (args, compile, target) =>
    compileIntervalChain('_IA.greater', args, compile, target),
  And: (args, compile) => compileIntervalFold('_IA.and', args, compile),
  Or: (args, compile) => compileIntervalFold('_IA.or', args, compile),
  Not: (args, compile) => `_IA.not(${compile(args[0])})`,
  // Apply a function literal to arguments — the `f'` prime-derivative
  // spelling lowers to `Apply(Function(…), x)`. As on the JavaScript target,
  // `Apply` with a *symbol* head canonicalizes to a direct call, so only the
  // function-literal form reaches this handler; the literal compiles to an
  // arrow over intervals through the shared `Function` lowering.
  // (Tycho item 237.)
  Apply: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Apply`: missing function');
    // Only an exact-arity application of a FUNCTION LITERAL compiles. The
    // interpreter THROWS on an over-applied call and CURRIES an
    // under-applied one (`function-utils.ts`, `makeLambda`); a plain
    // JavaScript call would instead silently truncate the extras or bind
    // the missing parameters to `undefined`. A non-literal callee (a
    // valueless function symbol) has no parameter list to check against.
    // Fail closed on all of those.
    const fn = isFunction(args[0], 'Derivative')
      ? BaseCompiler.intervalDerivativeLiteral(args)
      : args[0];
    if (!isFunction(fn, 'Function'))
      throw new Error(
        `Could not compile \`Apply\`: only a function-literal callee compiles on the interval ` +
          `target.`
      );
    const paramCount = fn.ops.length - 1;
    if (args.length - 1 !== paramCount)
      throw new Error(
        `Could not compile \`Apply\`: the function takes ${paramCount} parameter(s) but ` +
          `${args.length - 1} argument(s) are supplied — the interpreter ` +
          `curries or throws there, which this target cannot express.`
      );
    return `(${compile(fn)})(${args
      .slice(1)
      .map((a) => compile(a))
      .join(', ')})`;
  },
  // A random draw, enclosed by its distribution's SUPPORT: every value
  // `Random()` can produce lies in [0, 1], so the constant interval is a
  // sound band for any draw, on any evaluation. Threading the actual seeded
  // sequence through this lane would be UNSOUND instead: the interval lane
  // samples at different points and in a different order than the scalar
  // lane, so its draw sequence would diverge from the values the scalar
  // lane actually plots, and the band would no longer enclose them. Only
  // the nullary form is claimed: `Random(source)` draws from an interval, a
  // range, or a collection, whose support this handler does not compute —
  // fail closed rather than emit a wrong enclosure.
  // (Tycho item 237.)
  Random: (args) => {
    if (args.length !== 0)
      throw new Error(
        `Could not compile \`Random\`: only the nullary form compiles on the interval target — ` +
          `the support of \`Random(source)\` is not derived here.`
      );
    return '({ lo: 0, hi: 1 })';
  },
  // The body's random draws are enclosed by their support (see `Random`
  // above), which no seed can narrow or shift — so the frame contributes
  // nothing on this target and only the body is emitted. The seed operand is
  // a plain value (a number or a string) and is not emitted.
  // (Tycho item 237.)
  WithRandomSeed: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `Could not compile \`WithRandomSeed\`: expected exactly two arguments.`
      );
    // Only a LITERAL seed is accepted — a finite real or a string, the
    // values the interpreter's own validation admits. A compound seed
    // expression would have to be evaluated once per frame entry (the
    // interpreter's contract), and this target has no emission for that
    // evaluation — silently discarding it would also discard the
    // out-of-range error an invalid seed raises. Fail closed instead.
    const seed = args[0];
    const literalSeed =
      (isNumber(seed) && seed.im === 0 && Number.isFinite(seed.re)) ||
      isString(seed);
    if (!literalSeed)
      throw new Error(
        `Could not compile \`WithRandomSeed\`: only a literal finite real or string seed compiles ` +
          `on the interval target.`
      );
    // A seeded `RandomChoice` body is a list, spelled by
    // `compileIntervalCollectionValue` in the positions that consume a list
    // whole. This handler is reached for it only when that spelling declined
    // (say why) or in a position that takes one interval, where a list has
    // no reading.
    const plan = seededRandomChoicePlan(args[0], args[1]);
    if (typeof plan === 'string')
      throw new Error(`Could not compile \`RandomChoice\`: ${plan}`);
    if (plan !== undefined)
      throw new Error(
        `Could not compile \`WithRandomSeed\`: a seeded \`RandomChoice\` is a list, which the ` +
          `interval target compiles only where a list is used whole (a reducer, an accessor, ` +
          `an element-wise operation, the result).`
      );
    return compile(args[1]);
  },
  // `RandomChoice` compiles on this target only as the whole body of a
  // `WithRandomSeed` with a literal seed, where its value is fixed (see
  // `seededRandomChoicePlan`). That form is handled before this handler is
  // reached.
  RandomChoice: () => {
    throw new Error(
      `Could not compile \`RandomChoice\`: the interval target compiles a draw only when it ` +
        `is the whole body of a \`WithRandomSeed\` with a literal seed.`
    );
  },
};

/**
 * Maximum number of terms to unroll in an interval Sum/Product.
 */
// The fixed-width pass writes a literal range out under its own, smaller cap
// (`MAX_UNROLLED_RANGE_WIDTH` in `fixed-width-unroll.ts`, 64 elements); a
// literal range between the two caps reaches this target still as a `Range`
// and is written out here.
const INTERVAL_UNROLL_LIMIT = 100;

/**
 * Extract index, lower, and upper from a Limits expression.
 * Returns the raw Expression nodes so they can be compiled.
 */
function extractIntervalLimits(limitsExpr: Expression): {
  index: string;
  lowerExpr: Expression;
  upperExpr: Expression;
  lowerNum: number | undefined;
  upperNum: number | undefined;
} {
  console.assert(limitsExpr.operator === 'Limits');
  const fn = limitsExpr as Expression & {
    op1: Expression;
    op2: Expression;
    op3: Expression;
  };
  const index = isSymbol(fn.op1) ? fn.op1.symbol : '_';
  const lowerExpr = fn.op2;
  const upperExpr = fn.op3;
  // A bound mentioning a compile-bound name (a user function's parameter, an
  // enclosing binder's index) is NOT a compile-time constant — see
  // `BaseCompiler.bigOpBoundConstant`.
  return {
    index,
    lowerExpr,
    upperExpr,
    lowerNum: BaseCompiler.bigOpBoundConstant(lowerExpr),
    upperNum: BaseCompiler.bigOpBoundConstant(upperExpr),
  };
}

/**
 * Fail closed on a Sum/Product bound that is statically non-finite (a
 * `±∞`/`NaN` literal, or an expression typed `infinity` or `nan`), so
 * `compile()` reports failure and the caller falls back to the interpreter.
 * `for (i = 1; i <= Infinity; i++)` never terminates and `-Infinity + 1` never
 * advances, so such a bound would lock the caller's thread. Mirrors
 * `assertFiniteBound` in the JavaScript target.
 */
function assertFiniteIntervalBound(
  kind: 'Sum' | 'Product',
  expr: Expression,
  which: 'lower' | 'upper'
): void {
  const nonFinite =
    (isNumber(expr) && !Number.isFinite(expr.re)) ||
    expr.type.matches('infinity') ||
    expr.type.matches('nan');
  if (!nonFinite) return;
  throw new Error(
    `Could not compile \`${kind}\`: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop.`
  );
}

/**
 * Compile a bound expression to a scalar JavaScript value for use as a loop
 * counter. For the interval target, bounds must be plain numbers (not intervals).
 *
 * At runtime, a compiled bound expression produces one of two shapes:
 * a bare `Interval` ({lo, hi}) — e.g. a plain input variable `_.n` — or an
 * `IntervalResult` wrapper ({kind, value: {lo, hi}}) returned by `_IA.*`
 * operators (e.g. a compound bound like `n + 2`). We extract the upper bound
 * from whichever shape is present (for point intervals lo === hi).
 */
function compileIntervalBound(
  expr: Expression,
  numVal: number | undefined,
  target: CompileTarget<Expression>
): string {
  if (numVal !== undefined) return String(numVal);
  // Compile the bound expression (produces an interval or an IntervalResult
  // wrapper at runtime), then extract the scalar loop bound. Reading `.hi`
  // directly off an IntervalResult is `undefined` (→ NaN → the loop never
  // runs), so unwrap `.value` when present.
  //
  // The bound is an INTERVAL at run time, and the loop needs one integer.
  // The interpreter floors a bound (`Σ_{k=1.5}^{3.7}` runs k = 1, 2, 3), so
  // a bound whose two endpoints floor to the same integer names that one
  // count. A bound whose endpoints floor to DIFFERENT integers — `Σ_{k=1}^{x}`
  // over the cell `x ∈ [2.5, 3.5]` — names several counts, and the sum is
  // then a SET of values (3 for x below 3, 6 above); reading the upper
  // endpoint alone answered the point `[6, 6]` there, which is not an
  // enclosure. Such a bound answers NaN, which the loop templates turn into
  // `entire` ("cannot bound this") at loop entry. A plotter's cells refine
  // until the bound is constant over the cell, where the loop runs.
  const compiled = BaseCompiler.compile(expr, target);
  return (
    `((_b) => { const _v = _b && _b.value ? _b.value : _b; ` +
    `const _f = Math.floor(_v.hi); ` +
    `return Math.floor(_v.lo) === _f ? _f : NaN; })(${compiled})`
  );
}

/**
 * Heads that broadcast ELEMENT-WISE over a collection operand in the
 * interpreter, used by `intervalCollectionElements` to decompose a
 * collection-valued big-op operand (`Sum([0.64, 0.77]²)`) into per-element
 * scalar expressions. Deliberately small: only heads whose one-collection
 * broadcast is a plain per-element map, with every OTHER operand scalar.
 * A head outside this set leaves the operand undecomposed, and the reduce
 * form then fails closed rather than guess.
 *
 * The rebuild re-emits the scalar SIBLING operand once per element
 * (`Add(L, s)` compiles `s` for every `L_k`). That is sound on this target
 * because every interval emission is effect-free and per-call stable —
 * `Random()` compiles to a constant support interval, and no lowering
 * writes state — so repeated emission cannot diverge from a once-evaluated
 * sibling. A future lowering that is NOT per-call stable must hoist the
 * sibling to a temporary first (the `compileIntervalChain` pattern).
 */
const ELEMENTWISE_INTERVAL_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Abs',
  'Exp',
  'Ln',
]);

/**
 * The per-element EXPRESSIONS of a collection-valued big-op operand, or
 * `undefined` when the operand cannot be decomposed statically (which makes
 * the reduce form fall back to the runtime-array path, or fail closed).
 * At most `budget` elements are produced — mirroring the indexed form's
 * `INTERVAL_UNROLL_LIMIT` cap on emitted terms.
 *
 * Shapes handled, recursively:
 * - a literal `List`/`Tuple`, written inline or held as a symbol's assigned
 *   value (`literalCollectionOps`);
 * - `Range` with literal integer bounds (ascending, unit or literal step);
 * - `Map(fn, collection)` — each element becomes `Apply(fn, element)`, which
 *   the `Apply` lowering compiles (and canonicalization may reduce);
 * - an element-wise head (`ELEMENTWISE_INTERVAL_HEADS`) with exactly ONE
 *   decomposable collection operand, every other operand provably scalar —
 *   rebuilt per element (`Power(L, 2)` → `Power(L_k, 2)`).
 */
function intervalCollectionElements(
  e: Expression,
  target: CompileTarget<Expression>,
  budget: number
): ReadonlyArray<Expression> | undefined {
  const literal = literalCollectionOps(e, target);
  if (literal !== undefined)
    return literal.length <= budget ? literal : undefined;

  const node = assignedLiteral(e, target) ?? e;
  if (!isFunction(node)) return undefined;
  const ce = node.engine;

  // A literal `Range` is handled by `literalCollectionOps` above; one with a
  // symbolic bound has no static decomposition.
  if (node.operator === 'Range') return undefined;

  if (node.operator === 'Map' && node.ops.length === 2) {
    const inner = intervalCollectionElements(node.ops[1], target, budget);
    if (inner === undefined) return undefined;
    const fn = node.ops[0];
    return inner.map((el) => ce.function('Apply', [fn, el]));
  }

  if (ELEMENTWISE_INTERVAL_HEADS.has(node.operator)) {
    let collectionAt = -1;
    let elements: ReadonlyArray<Expression> | undefined = undefined;
    for (let i = 0; i < node.ops.length; i++) {
      const op = node.ops[i];
      if (op.type.matches('number')) continue;
      // At most one non-scalar operand, and it must itself decompose.
      if (collectionAt !== -1) return undefined;
      const decomposed = intervalCollectionElements(op, target, budget);
      if (decomposed === undefined) return undefined;
      collectionAt = i;
      elements = decomposed;
    }
    if (collectionAt === -1 || elements === undefined) return undefined;
    return elements.map((el) =>
      ce.function(
        node.operator,
        node.ops.map((op, i) => (i === collectionAt ? el : op))
      )
    );
  }

  return undefined;
}

/**
 * Compile the collection (reduce) form of `Sum`/`Product` — no indexing set,
 * the operand IS the collection (`Sum([3, 4, 5])`, the Desmos sum-a-list
 * spelling; Tycho item 237). A statically decomposable operand
 * (`intervalCollectionElements`) folds its compiled elements with
 * `_IA.add`/`_IA.mul`; the empty collection is the identity, matching the
 * interpreter (`Sum([]) = 0`, `Product([]) = 1`). An operand that is
 * statically an indexed collection but not decomposable (a vars-supplied
 * list) folds at run time, `_IA.point`-lifting raw numeric elements; a
 * runtime scalar returns itself (the interpreter's `Sum(scalar) = scalar`).
 * Anything else fails closed.
 */
/**
 * Is `e` the single operand of a `Max`/`Min` that the interpreter REDUCES
 * over — a collection by value or by static type, a `Range`, or a value
 * that is POSSIBLY a list of numbers (`isPossiblyNumericListOperand`, whose
 * run-time fold hands a scalar back as it stands)? A scalar operand (the
 * common `Max(x)` after canonicalization) keeps the scalar fold; an operand
 * whose collection-ness is unprovable keeps it too, and the scalar-operand
 * gate then decides.
 */
function isCollectionReduceOperand(
  e: Expression,
  target: CompileTarget<Expression>
): boolean {
  const resolved = assignedLiteral(e, target) ?? e;
  return (
    resolved.isCollection ||
    isFunction(resolved, 'Range') ||
    resolved.type.matches('collection<any>') ||
    isPossiblyNumericListOperand(resolved)
  );
}

/** The interval kernel, the fold seed and the empty-collection answer of
 *  each reduction. `Max`/`Min` of an empty collection is `NaN` in the
 *  interpreter, which this target spells as the numeric absence marker. */
const INTERVAL_REDUCTIONS: Record<
  'Sum' | 'Product' | 'Max' | 'Min',
  { readonly op: string; readonly identity: string; readonly empty: string }
> = {
  Sum: { op: '_IA.add', identity: '_IA.point(0)', empty: '_IA.point(0)' },
  Product: { op: '_IA.mul', identity: '_IA.point(1)', empty: '_IA.point(1)' },
  Max: {
    op: '_IA.max',
    identity: '_IA.point(-Infinity)',
    empty: INTERVAL_ABSENCE,
  },
  Min: {
    op: '_IA.min',
    identity: '_IA.point(Infinity)',
    empty: INTERVAL_ABSENCE,
  },
};

/**
 * `Max`/`Min` on the interval target: the fold of its scalar operands, and of
 * the reduction of each collection operand, with the interval kernel.
 *
 * The interpreter flattens every collection operand into the operand list
 * (`Min(1, [x, 2, 3])` is `Min(1, x, 2, 3)`), so a collection beside a scalar
 * is a reduction like any other. Beside a scalar, an EMPTY collection
 * contributes nothing (`Min(1, [])` is `1`), so its reduction answers the
 * identity of the fold there, where the reduction of a lone collection
 * answers the absence marker (`Min([])` is `NaN`).
 *
 * With NO scalar operand the answer is the absence marker exactly when every
 * collection is empty at run time (`Min([], [])` is `NaN`, `Min([], [3])` is
 * `3`). Each reduction then answers `undefined` for an empty collection, and
 * the fold is made over the reductions that answered an interval.
 */
function compileIntervalExtremum(
  kind: 'Max' | 'Min',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const { op, identity } = INTERVAL_REDUCTIONS[kind];
  if (args.length === 0) return identity;
  const isCollection = args.map((a) => isCollectionReduceOperand(a, target));
  if (args.length === 1 && isCollection[0])
    return compileIntervalCollectionReduce(kind, args[0], target);
  const scalars = args.filter((_a, i) => !isCollection[i]);
  if (scalars.length > 0) {
    assertScalarIntervalOperands(kind, scalars);
    return args
      .map((a, i) =>
        isCollection[i]
          ? compileIntervalCollectionReduce(kind, a, target, identity)
          : compile(a)
      )
      .reduce((acc, cur) => `${op}(${acc}, ${cur})`);
  }
  // Every operand is a collection. The operands are evaluated once each, in
  // operand order, as the arguments of the call.
  const reductions = args.map((a) =>
    compileIntervalCollectionReduce(kind, a, target, 'undefined')
  );
  const empty = INTERVAL_REDUCTIONS[kind].empty;
  return (
    `((..._r) => { const _v = _r.filter((_x) => _x !== undefined); ` +
    `return _v.length === 0 ? ${empty} : ` +
    `_v.reduce((_a, _b) => ${op}(_a, _b)); })(${reductions.join(', ')})`
  );
}

function compileIntervalCollectionReduce(
  kind: 'Sum' | 'Product' | 'Max' | 'Min',
  operand: Expression,
  target: CompileTarget<Expression>,
  // The answer for an EMPTY collection, when it is not the reduction's own:
  // see `compileIntervalExtremum`.
  emptyAnswer?: string
): string {
  const { op: iaOp, identity } = INTERVAL_REDUCTIONS[kind];
  const empty = emptyAnswer ?? INTERVAL_REDUCTIONS[kind].empty;
  const elements = intervalCollectionElements(
    operand,
    target,
    INTERVAL_UNROLL_LIMIT
  );
  if (elements !== undefined) {
    // A provably NON-numeric element (a string, a boolean, a nested
    // collection) would reach `_IA.add`/`_IA.mul`, which read `.lo`/`.hi`
    // off whatever they are handed and answer NaN bounds behind
    // `success: true` — the same silent-wrong class the scalar-kernel gate
    // (`assertScalarIntervalOperands`) closes. The interpreter errors on
    // such an element; fail closed to match.
    for (const el of elements) {
      const t = el.type;
      if (
        t.matches('string') ||
        t.matches('boolean') ||
        t.matches('collection<any>')
      )
        throw new Error(
          `Could not compile \`${kind}\`: the collection form — an element is not ` +
            `numeric (type \`${t.toString()}\`).`
        );
    }
    if (elements.length === 0) return empty;
    return elements
      .map((el) => BaseCompiler.compile(el, target))
      .reduce((acc, cur) => `${iaOp}(${acc}, ${cur})`);
  }
  // A `Range` with a SYMBOLIC bound, alone or under element-wise heads or a
  // `Map`, is reduced by a run-time loop over the range's elements.
  const dynamic = compileIntervalDynamicRangeReduce(
    kind,
    operand,
    target,
    empty
  );
  if (dynamic !== undefined) return dynamic;
  // The runtime-array fold below hands each element to `_IA.add`/`_IA.mul`,
  // so it requires elements PROVABLY numeric — the bare shape test
  // (`isIndexedCollectionOperand`) admits `list<any>`, whose elements are
  // unconstrained, and a nested list or string element would fold to NaN
  // bounds behind `success: true` (this is the reduce-form counterpart of
  // `assertScalarBigOpBody` on the indexed form).
  // A `Range` that did not decompose (symbolic bounds, or a count past the
  // unroll budget) has no lowering of its own on this target — the indexed
  // Sum/Product form reads Range bounds directly and never compiles the
  // node — so letting it fall through to `BaseCompiler.compile` would
  // produce a generic "Range has no lowering" error blaming the wrong
  // node. Name the operation instead.
  const resolved = assignedLiteral(operand, target) ?? operand;
  if (isFunction(resolved, 'Range'))
    throw new Error(
      `Could not compile \`${kind}\`: the collection form — the Range operand has ` +
        `symbolic bounds or too many elements to expand statically.`
    );
  const elementType = collectionElementType(operand.type.type);
  const elementsProvablyNumeric =
    elementType !== undefined &&
    operand.engine.type(elementType).matches('number');
  // A union of a number and a list of numbers is admitted too: the fold
  // below dispatches on the run-time value and hands a scalar back as it
  // stands, which is the interpreter's `Sum(scalar) = scalar`.
  if (
    (!isIndexedCollectionOperand(operand) || !elementsProvablyNumeric) &&
    !isPossiblyNumericListOperand(operand)
  ) {
    // Name the OPERATION in the diagnostic, not the operand's head: a
    // `Range` that did not decompose (symbolic bounds, or past the unroll
    // budget) has no lowering of its own on this target, and the generic
    // "Range has no lowering" message would blame the wrong node.
    throw new Error(
      `Could not compile \`${kind}\`: the collection form — the operand is not a ` +
        `statically decomposable collection, and its type ` +
        `(\`${operand.type.toString()}\`) does not prove an indexed ` +
        `collection of numbers.`
    );
  }
  const code =
    compileIntervalCollectionValue(operand, target) ??
    BaseCompiler.compile(operand, target);
  // An empty run-time array answers the reduction's empty case (`Max([])`
  // is the absence marker, `Sum([])` the identity); a non-array is the
  // interpreter's `Sum(scalar) = scalar`.
  return (
    `((_c) => Array.isArray(_c) ? (_c.length === 0 ? ${empty} : ` +
    `_c.reduce((_a, _b) => ` +
    `${iaOp}(_a, typeof _b === 'number' ? _IA.point(_b) : _b), ${identity}))` +
    ` : _c)(${code})`
  );
}

/**
 * The shape `compileIntervalDynamicRangeReduce` loops over: a `Range` node
 * with a symbolic bound, and the function that rebuilds the reduced
 * expression over ONE element of that range — `Map(f, R)` becomes
 * `Apply(f, k)`, and an element-wise head with `R` as its one collection
 * operand (`2^(−R)`, `R · x`) is rebuilt with `k` in the range's place, the
 * decomposition `intervalCollectionElements` performs statically for a
 * literal range.
 */
function dynamicRangeTerm(
  e: Expression,
  target: CompileTarget<Expression>
): { range: Expression; term: (k: Expression) => Expression } | undefined {
  const node = assignedLiteral(e, target) ?? e;
  if (!isFunction(node)) return undefined;
  const ce = node.engine;
  if (node.operator === 'Range') {
    if (node.ops.length < 1 || node.ops.length > 3) return undefined;
    if (!node.ops.every((op) => op.type.matches('number'))) return undefined;
    return { range: node, term: (k) => k };
  }
  if (node.operator === 'Map' && node.ops.length === 2) {
    const inner = dynamicRangeTerm(node.ops[1], target);
    if (inner === undefined) return undefined;
    const fn = node.ops[0];
    if (!isFunction(fn, 'Function') || fn.ops.length !== 2) return undefined;
    // A predicate body has no interval reading; the reduction's kernel would
    // read `.lo`/`.hi` off a verdict.
    if (!hasIntervalReading(fn.ops[0])) return undefined;
    return {
      range: inner.range,
      term: (k) => ce.function('Apply', [fn, inner.term(k)]),
    };
  }
  if (ELEMENTWISE_INTERVAL_HEADS.has(node.operator)) {
    let collectionAt = -1;
    let inner: ReturnType<typeof dynamicRangeTerm> = undefined;
    for (let i = 0; i < node.ops.length; i++) {
      const op = node.ops[i];
      if (op.type.matches('number')) continue;
      if (collectionAt !== -1) return undefined;
      inner = dynamicRangeTerm(op, target);
      if (inner === undefined) return undefined;
      collectionAt = i;
    }
    if (collectionAt === -1 || inner === undefined) return undefined;
    const at = collectionAt;
    const innerTerm = inner.term;
    return {
      range: inner.range,
      term: (k) =>
        ce.function(
          node.operator,
          node.ops.map((op, i) => (i === at ? innerTerm(k) : op))
        ),
    };
  }
  return undefined;
}

/**
 * Reduce an expression over a `Range` with a SYMBOLIC bound — the Desmos
 * `total(2^(−(⌊lb(max(x, 1))⌋..0)))`, whose element count depends on the
 * point — with a run-time loop, when the operand is a range or one
 * element-wise expression over a range (`dynamicRangeTerm`); `undefined`
 * otherwise.
 *
 * The range's elements come from `_IA.range` (`interval/collections.ts`),
 * which requires each bound to be a POINT interval at run time and answers
 * `entire` for a wide one: a wide bound names several element counts, and
 * a sum over them is a set of values no single loop computes. A plotter's
 * cells refine until the bound is constant over the cell. The reduction
 * folds the term over the elements in the range's own order, which is
 * immaterial for these commutative kernels, and the empty range answers
 * the reduction's empty case.
 *
 * The term is compiled inside the fold's closure with the range element
 * bound to a fresh name, and with common-subexpression elimination OFF for
 * that compile: the rebuilt term shares no node with the enclosing
 * expression's harvest, and a temporary hoisted outside the closure could
 * not read the element.
 */
function compileIntervalDynamicRangeReduce(
  kind: 'Sum' | 'Product' | 'Max' | 'Min',
  operand: Expression,
  target: CompileTarget<Expression>,
  // The answer for an EMPTY range, when it is not the reduction's own: see
  // `compileIntervalExtremum`.
  emptyAnswer?: string
): string | undefined {
  const shape = dynamicRangeTerm(operand, target);
  if (shape === undefined) return undefined;
  const { op: iaOp, identity } = INTERVAL_REDUCTIONS[kind];
  const empty = emptyAnswer ?? INTERVAL_REDUCTIONS[kind].empty;
  const ce = operand.engine;
  const index = BaseCompiler.tempVar(target);
  const acc = BaseCompiler.tempVar(target);
  const inner: CompileTarget<Expression> = {
    ...target,
    cse: undefined,
    var: (id) => (id === index ? index : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, [index]),
  };
  const term = shape.term(ce.expr(index));
  const termCode = BaseCompiler.compileValueOperand(term, inner);
  const range = compileIntervalCollectionValue(shape.range, target);
  if (range === undefined) return undefined;
  return (
    `((_r) => !Array.isArray(_r) ? _r : _r.length === 0 ? ${empty} : ` +
    `_r.reduce((${acc}, ${index}) => ${iaOp}(${acc}, ${termCode}), ` +
    `${identity}))(${range})`
  );
}

/**
 * Compile Sum or Product for the interval arithmetic target.
 *
 * The iteration variable is substituted with `_IA.point(k)` so the
 * body compiles correctly as interval expressions.  Accumulation uses
 * `_IA.add` / `_IA.mul`.
 *
 * When bounds are symbolic, emits a loop with compiled bound expressions.
 */
function compileIntervalSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`Could not compile \`${kind}\`: no body`);
  // No indexing set: the collection (reduce) form — the operand IS the
  // collection (`Sum([3, 4, 5])`). See `compileIntervalCollectionReduce`.
  if (!args[1] && args.length === 1)
    return compileIntervalCollectionReduce(kind, args[0], target);
  if (!args[1])
    throw new Error(`Could not compile \`${kind}\`: no indexing set`);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): interval scalar accumulation over
  // arrays would silently produce a wrong value. Reached only for the indexed
  // form (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  // Multi-index Sum/Product would drop the trailing indexing sets. Fail closed
  // (D6) rather than emit code with a dangling index.
  if (args.length > 2)
    throw new Error(
      `Could not compile \`${kind}\`: multi-index (${args.length - 1} indexing sets) is not supported in the interval target`
    );

  const { index, lowerExpr, upperExpr, lowerNum, upperNum } =
    extractIntervalLimits(args[1]);

  // Before ANY lowering decision — the unroll path included, which a
  // non-finite bound would otherwise skip on its way to the loop arm.
  assertFiniteIntervalBound(kind, lowerExpr, 'lower');
  assertFiniteIntervalBound(kind, upperExpr, 'upper');

  const isSum = kind === 'Sum';
  const iaOp = isSum ? '_IA.add' : '_IA.mul';
  const identity = isSum ? '_IA.point(0)' : '_IA.point(1)';

  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  // Empty range (only knowable when both bounds are constant)
  if (bothConstant && lowerNum > upperNum) return identity;

  const body = args[0];
  // The body is the binder's own CSE region (design §5.1(a)), hung off the
  // `Sum`/`Product` node being lowered — this handler is handed only the
  // operand list. Each term compiles through `compileOp` so the region opens
  // with a FRESH instance per index value: the same body node objects are
  // compiled once per term (only the index `var` mapping differs), and a
  // node-keyed reuse across terms would emit term 1's temporary for every
  // later term. Before this, the terms compiled outside the region and
  // shared nothing, not even a subexpression repeated inside one term.
  const sumNode = BaseCompiler.cseParentNode();
  const compileTerm = (innerTarget: CompileTarget<Expression>): string =>
    BaseCompiler.compileOp(sumNode, 0, innerTarget, 0, body);
  // A subexpression of the body that mentions no index — the `√(x²+c)` an
  // unrolled ring sum repeats in every term — has one value for the whole
  // sum. `hoistLoopInvariants` binds each such class to a temporary compiled
  // under the ENCLOSING target and emits the terms against the temporary;
  // the bindings are placed by the two arms below.
  const hoistedPrelude = (
    bindings: ReadonlyArray<LoopInvariantBinding>
  ): string =>
    bindings.map(([name, code]) => `const ${name} = ${code}; `).join('');

  // Unroll when both bounds are constant and range is small
  if (bothConstant) {
    const termCount = upperNum - lowerNum + 1;
    if (termCount <= INTERVAL_UNROLL_LIMIT) {
      const emitTerms = (): string[] => {
        const terms: string[] = [];
        for (let k = lowerNum; k <= upperNum; k++) {
          const innerTarget: CompileTarget<Expression> = {
            ...target,
            var: (id) => (id === index ? `_IA.point(${k})` : target.var(id)),
            boundVars: BaseCompiler.withBoundNames(target, [index]),
          };
          terms.push(compileTerm(innerTarget));
        }
        return terms;
      };
      // Every unrolled term runs, so a binding evaluated before the terms is
      // evaluated exactly when the body is (the range is non-empty here).
      const { bindings, result: terms } = BaseCompiler.hoistLoopInvariants(
        body,
        [index],
        target,
        emitTerms
      );

      let result = terms[terms.length - 1];
      for (let i = terms.length - 2; i >= 0; i--) {
        result = `${iaOp}(${terms[i]}, ${result})`;
      }
      if (bindings.length === 0) return result;
      return `(() => { ${hoistedPrelude(bindings)}return ${result}; })()`;
    }
  }

  // Emit a loop (either large constant range or symbolic bounds)
  const lowerCode = compileIntervalBound(lowerExpr, lowerNum, target);
  const upperCode = compileIntervalBound(upperExpr, upperNum, target);

  const acc = BaseCompiler.tempVar(target);
  const { bindings, result: bodyCode } = BaseCompiler.hoistLoopInvariants(
    body,
    [index],
    target,
    () =>
      compileTerm({
        ...target,
        var: (id) => (id === index ? `_IA.point(${index})` : target.var(id)),
        boundVars: BaseCompiler.withBoundNames(target, [index]),
      })
  );
  // With SYMBOLIC bounds the bindings follow an EMPTY-RANGE exit: a range
  // that runs zero iterations never evaluated the body, so it must not
  // evaluate the body's subexpressions either (an error they raise would be
  // new). Constant bounds are known non-empty here (the empty case returned
  // the identity above), so they need no exit. With no bindings the emission
  // is unchanged.
  const prelude = (lower: string | undefined): string =>
    bindings.length === 0
      ? ''
      : (lower === undefined
          ? ''
          : `if (!(${lower} <= _upper)) return ${identity}; `) +
        hoistedPrelude(bindings);

  // A SYMBOLIC bound can still be `±∞`/`NaN` at run time — the same
  // non-terminating loop. Guard once at loop entry (never per iteration);
  // `entire` is the interval target's "cannot bound this" answer. Constant
  // bounds are statically finite by `assertFiniteIntervalBound` above, so they
  // take the unguarded template and their code is unchanged.
  if (lowerNum === undefined || upperNum === undefined) {
    return `(() => { let ${acc} = ${identity}; const _upper = ${upperCode}; const _lower = ${lowerCode}; if (!Number.isFinite(_upper) || !Number.isFinite(_lower)) return { kind: 'entire' }; ${prelude('_lower')}for (let ${index} = _lower; ${index} <= _upper; ${index}++) { ${acc} = ${iaOp}(${acc}, ${bodyCode}); } return ${acc}; })()`;
  }

  return `(() => { let ${acc} = ${identity}; const _upper = ${upperCode}; ${prelude(undefined)}for (let ${index} = ${lowerCode}; ${index} <= _upper; ${index}++) { ${acc} = ${iaOp}(${acc}, ${bodyCode}); } return ${acc}; })()`;
}

/**
 * Compile `Integrate(f, (x, a, b))` for the interval arithmetic target.
 *
 * **Antiderivative-first, guarded.** The shared
 * `BaseCompiler.closedFormIntegral` resolves the integral symbolically under
 * its own wall-clock budget. When it closes, the straight-line expression is
 * compiled as interval code — an enclosure that is both tight (no partition
 * error at all) and cheap — but it is NOT returned bare: the symbolic step
 * differences an antiderivative at the bounds without checking that the
 * integrand is bounded between them (`∫₋₁¹ dt/t²` closes to `−2` although
 * the integral diverges at the interior pole), and a wrong closed form on
 * this target would be a zero-width "enclosure" of a divergent integral. So a
 * definite integral's closed form is emitted as a thunk handed to
 * `_IA.integrateClosed`, which scans the integrand over the range at run time
 * and returns the closed form only when the scan finds no pole, gap or
 * unbounded stretch — otherwise it falls back to the enclosure below (see
 * `interval/integrate.ts`). An INDEFINITE integral that closes (`∫ e^{−t²} dt`
 * → `½√π·erf(t)`) has no range to scan and compiles to the closed form
 * directly, as a function of its free bound. The closed form can name a head
 * this target has no lowering for, so it is compiled inside a `try` that
 * falls through to the enclosure emitter.
 *
 * **Enclosure.** Otherwise the integral lowers to
 * `_IA.integrate(f, lo, hi, n)`, which brackets the integral by a uniform
 * `n`-piece partition rather than estimating it. `n` is sized from
 * `INTERVAL_QUADRATURE_BUDGET` by nesting depth — 256 for a single or double
 * integral, fewer per level beyond that — so a d-fold integral never costs
 * more than the budget's worth of integrand evaluations. The bound
 * EXPRESSIONS are compiled, never the `bigOpBoundConstant` numbers
 * `extractIntervalLimits` also reports: those are floored, which is right for
 * the discrete `Sum`/`Product` counters that helper primarily serves and wrong
 * for a continuous integral (it would collapse `∫₀^0.5` to `∫₀^0`).
 *
 * The `quadrature: 'monte-carlo'` option is ignored here: it selects between
 * two STOCHASTIC/adaptive estimators on the scalar target, and this target has
 * no stochastic estimator — sampling produces no enclosure, which is the only
 * thing this target returns.
 */
/**
 * How much integration work a subtree can demand at run time, measured from
 * the tree: `paths` is the number of `Integrate` RUNS reachable per
 * evaluation of the subtree (an operand referenced twice runs twice, so
 * children's counts are SUMMED — path counting, which a per-distinct-node
 * memo computes in linear time), and `depth` is the deepest multiplicative
 * chain — integration levels (one per limit) accumulated through integrals
 * nested inside other integrals' integrands or bounds.
 *
 * `compileIntervalIntegrate` sizes every level's subdivision count from the
 * pair: an inner integral runs once per enclosing piece, so with a uniform
 * count n the subtree's total integrand evaluations are bounded by
 * ~paths·n^depth.
 *
 * The memo is sound unconditionally: both numbers are functions of the
 * expression tree alone (operator names and arity — no bindings, no
 * definitions), and boxed expressions are immutable. `paths` saturates at
 * a million — beyond that every sizing decision is already "decline", and
 * an unsaturated sum over a deeply shared tree would overflow.
 *
 * Composition through a FUNCTION CALL (`∫ g(x) dx` where `g`'s body
 * computes an integral) is invisible here — no `Integrate` node is in the
 * tree. That class is bounded at run time instead, by
 * `INTERVAL_NESTED_QUADRATURE_BUDGET` (`interval/integrate.ts`).
 */
type IntegrateStats = { paths: number; depth: number };

const INTEGRATE_STATS = new WeakMap<Expression, IntegrateStats>();

const INTEGRATE_PATHS_SATURATION = 1_000_000;

function integrateStats(expr: Expression): IntegrateStats {
  const cached = INTEGRATE_STATS.get(expr);
  if (cached !== undefined) return cached;
  let paths = 0;
  let depth = 0;
  if (isFunction(expr)) {
    for (const op of expr.ops) {
      const s = integrateStats(op);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + s.paths);
      depth = Math.max(depth, s.depth);
    }
    if (expr.operator === 'Integrate') {
      // One integration level per limit clause; a bare `Integrate(f)` (no
      // clause) is indefinite and never reaches the enclosure emitter, but
      // count it as one level so the estimate stays conservative.
      const levels = Math.max(1, expr.nops - 1);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + 1);
      depth += levels;
    }
  }
  const stats = { paths, depth };
  INTEGRATE_STATS.set(expr, stats);
  return stats;
}

function compileIntervalIntegrate(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const limits = args.slice(1).map(extractIntervalLimits);

  // An INDEFINITE integral (`\int f dx` — the `Limits` clause carries `Nothing`
  // for its bounds, or there is no clause at all) has no range to partition.
  // With a closed form it is that closed form — a function of its free bound.
  // Without one it has no value at a point: it denotes a function, not a
  // number, and compiling the `Nothing` bounds like any other free symbol
  // would hand `_IA.integrate` a `vars`-object lookup (`_.Nothing`) —
  // `undefined`, which the runtime reads as a non-finite endpoint and answers
  // `entire`, or with no clause at all would emit the bare integrand as if it
  // were the integral's value. Fail closed so the caller falls back to
  // the interpreter, which keeps the integral symbolic.
  const isUnbounded = (e: Expression | undefined) =>
    e === undefined || isSymbol(e, 'Nothing');
  const indefinite =
    limits.length === 0 ||
    limits.some((l) => isUnbounded(l.lowerExpr) || isUnbounded(l.upperExpr));

  // The integrand as a body in the limits' index variables: a `Function`
  // integrand is unwrapped, its parameters matched to the limits by name (a
  // mismatch fails closed — see `BaseCompiler.integrandLambda`). Judged
  // BEFORE the closed-form attempt: `Integrate` is exempt from the
  // scalar-operand gate (`COLLECTION_AWARE_HEADS`) so that its own
  // diagnostics win, and the closed form of a collection-valued body is the
  // collection itself (`∫₀¹ L dt` closes to `L`), which would compile as a
  // bare symbol and route around the gate.
  const { lambdaVars, bodyExpr } = indefinite
    ? { lambdaVars: [] as string[], bodyExpr: args[0] }
    : BaseCompiler.integrandLambda(
        args[0],
        limits.map((l) => l.index)
      );
  if (!indefinite) {
    // A collection-valued body would make the integrand lambda answer a JS
    // array, which `_IA.integrate` would read `.lo`/`.hi` off; a
    // collection-valued bound would be read as a non-finite endpoint and
    // answer `entire` — both behind `success: true`.
    BaseCompiler.assertScalarBigOpBody('Integrate', bodyExpr);
    for (const l of limits)
      assertScalarIntervalOperands('Integrate', [l.lowerExpr, l.upperExpr]);
  }

  // Antiderivative-first: a closed form when the integral resolves to one
  // (and does not reference a `vars`-mapped symbol, which must not fold).
  let closedCode: string | undefined;
  const closed = BaseCompiler.closedFormIntegral(args, target);
  if (closed !== undefined) {
    try {
      // Parenthesize: the closed form can be a low-precedence expression,
      // whereas it is spliced as an atomic operand.
      closedCode = `(${compile(closed)})`;
    } catch (e) {
      // Unlowerable head: the enclosure emitter below stands alone.
      // A cancellation that is not a timeout (an abort, an iteration or
      // recursion limit), or a timeout of an expired enclosing span, belongs
      // to the caller: it is thrown again, not changed into a fallback
      // (docs/TIMEOUT-MODEL.md §2).
      throwIfCallerCancellation(e, closed.engine._deadlineFrame);
    }
  }

  if (indefinite) {
    if (closedCode !== undefined) return closedCode;
    throw new Error(
      'Could not compile `Integrate`: an indefinite integral with no closed-form antiderivative is a function, not a number — it has no value to compute at a point, and quadrature needs bounds. Provide bounds for a definite integral, or evaluate symbolically instead.'
    );
  }

  // Per-level subdivision count from the total budget (see
  // `INTERVAL_QUADRATURE_BUDGET`): the inner enclosure of a nested integral
  // runs once per outer piece, so the counts multiply across levels — through
  // this node's own limits AND through every `Integrate` node visible in its
  // subtree (a distinct node inside the integrand or a bound runs once per
  // enclosing piece just the same). The OUTERMOST integral of a nest measures
  // the whole subtree (`integrateStats`) and picks one uniform count n with
  // paths·n^depth within the budget; every inner lowering inherits that n
  // through `target.intervalQuadraturePieces` rather than re-measuring its
  // own smaller subtree, which would pick a larger count and break the
  // product bound.
  //
  // The floor is a DECLINE, not a clamp: below 4 pieces per level the
  // "enclosure" is as uninformative as `entire` while still costing the whole
  // budget, so an integral whose subtree is too deep or too branchy to size
  // honestly fails closed instead (the caller falls back — in a two-lane
  // consumer, to its scalar estimate). Everything here is a function of the
  // expression tree alone: no clock, same answer on every run.
  let n: number;
  if (target.intervalQuadraturePieces !== undefined) {
    n = target.intervalQuadraturePieces;
  } else {
    let paths = 1;
    let depth = limits.length;
    for (const arg of args) {
      const s = integrateStats(arg);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + s.paths);
      depth = Math.max(depth, limits.length + s.depth);
    }
    n = Math.min(
      INTERVAL_QUADRATURE_SUBDIVISIONS,
      Math.floor((INTERVAL_QUADRATURE_BUDGET / paths) ** (1 / depth))
    );
    if (n < 4)
      throw new Error(
        `Could not compile \`Integrate\`: an honest interval enclosure — this ` +
          `integral's subtree reaches ${paths} integral runs nested ` +
          `${depth} levels deep, and the evaluation budget ` +
          `(${INTERVAL_QUADRATURE_BUDGET} integrand evaluations) admits ` +
          `fewer than 4 subdivisions per level at that size, which is as ` +
          `uninformative as no bound at all. Evaluate ` +
          `numerically on the scalar target, or reduce the nesting.`
      );
  }

  // Everything compiled within this integral — the integrand and every
  // bound — inherits the chosen count.
  const sized: CompileTarget<Expression> = {
    ...target,
    intervalQuadraturePieces: n,
  };

  // The lambda variable arrives as a bare `Interval` (`{lo, hi}`), which every
  // `_IA.*` operation accepts, so it compiles to its own name rather than to a
  // `vars`-object lookup or a `_IA.point(…)` wrapper.
  const scoped = (names: string[]): CompileTarget<Expression> => ({
    ...sized,
    var: (id) => (names.includes(id) ? id : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, names),
  });

  // A subexpression of the integrand that mentions no integration variable
  // is computed once, on the lambda's first call, not once per piece — the
  // JavaScript lowering's rule (`compileIntegrate`, `javascript-target.ts`),
  // which names the witness. The interval target hoists whole scalar
  // invariants (`hoistScalarInvariants`), so `Γ(k/2)·√2^k` is one binding.
  // A `Function` integrand's body is a one-statement `Block`, a scope the
  // candidate pass never descends into; the statement is what is scanned.
  const bodyTarget = scoped(lambdaVars);
  const scanned =
    isFunction(bodyExpr, 'Block') && bodyExpr.nops === 1
      ? bodyExpr.ops[0]
      : bodyExpr;
  const { bindings, result: bodyCode } = BaseCompiler.hoistLoopInvariants(
    scanned,
    lambdaVars,
    bodyTarget,
    () => BaseCompiler.compile(bodyExpr, bodyTarget)
  );
  let code = bodyCode;

  // Multiple limits nest, innermost last (Mathematica iterator convention:
  // the FIRST limit is the OUTERMOST integral). A bound of limit d may
  // reference the outer lambda variables 0..d−1 — at its nesting depth they
  // are in scope, so dependent bounds (∫₀¹dx ∫₀ˣdy) compile naturally. The
  // closed form, when there is one, guards the OUTERMOST call only: its scan
  // walks the outer range, and each scanned piece runs the inner enclosures.
  for (let d = limits.length - 1; d >= 0; d--) {
    const outer = lambdaVars.slice(0, d);
    const boundTarget = outer.length > 0 ? scoped(outer) : sized;
    const lo = BaseCompiler.compile(limits[d].lowerExpr, boundTarget);
    const hi = BaseCompiler.compile(limits[d].upperExpr, boundTarget);
    // The innermost lambda carries the invariant bindings, declared next to
    // it and assigned on its first call: an empty range asks for no piece,
    // and the unhoisted integrand then evaluated nothing.
    let f = `(${lambdaVars[d]}) => (${code})`;
    if (d === limits.length - 1 && bindings.length > 0) {
      const flag = BaseCompiler.tempVar(target);
      const held = BaseCompiler.tempVar(target);
      const arg = BaseCompiler.tempVar(target);
      // A right-hand side is one expression: this target has no statement
      // sink (`CompileTarget.hoist`), so no compiled code carries an embedded
      // statement. A target that gains one must sequence the assignment the
      // way the JavaScript lowering does (`firstCallBoundLambda`).
      const assignments = bindings
        .map(([name, rhs]) => `${name} = ${rhs};`)
        .join(' ');
      f =
        `(() => { let ${flag} = false; let ${bindings
          .map(([name]) => name)
          .join(', ')}; const ${held} = ${f}; ` +
        `return (${arg}) => { if (!${flag}) { ${flag} = true; ${assignments} } ` +
        `return ${held}(${arg}); }; })()`;
    }
    code =
      d === 0 && closedCode !== undefined
        ? `_IA.integrateClosed(() => ${closedCode}, ${f}, ${lo}, ${hi}, ${n})`
        : `_IA.integrate(${f}, ${lo}, ${hi}, ${n})`;
  }
  return code;
}

/**
 * The `_IA` routines a constant subtree may be evaluated through at compile
 * time (`foldConstantIntervalCode`). Each is a pure, deterministic function of
 * its interval arguments with bounded cost, so evaluating it once at compile
 * time and once per call at run time gives the same value. Left out on
 * purpose: the comparisons and connectives (they answer a `BoolInterval`, a
 * shape the fold does not re-emit), `piecewise`, the collection accessors
 * (`at`, `length`, `component`), and the quadrature entry points (a constant
 * definite integral may take milliseconds per evaluation and returns a thunk
 * scan, not a plain enclosure).
 */
const FOLDABLE_INTERVAL_ROUTINES: ReadonlySet<string> = new Set([
  'point',
  'add',
  'sub',
  'mul',
  'div',
  'negDiv',
  'scale',
  'scaleDiv',
  'negate',
  'sqrt',
  'square',
  'pow',
  'powInterval',
  'powRational',
  'nthRoot',
  'exp',
  'ln',
  'log10',
  'log2',
  'abs',
  'floor',
  'ceil',
  'round',
  'fract',
  'trunc',
  'min',
  'max',
  'mod',
  'remainder',
  'heaviside',
  'sign',
  'gamma',
  'gammaln',
  'factorial',
  'factorial2',
  'binomial',
  'gcd',
  'lcm',
  'chop',
  'erf',
  'erfc',
  'exp2',
  'hypot',
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'acot',
  'acsc',
  'asec',
  'coth',
  'csch',
  'sech',
  'acoth',
  'acsch',
  'asech',
  'sinc',
  'fresnelS',
  'fresnelC',
]);

/**
 * What may remain of a constant subtree's code once every `_IA.<routine>`
 * reference, every admitted `Math` member (`FOLDABLE_MATH_MEMBERS`),
 * `Number.EPSILON`, `Infinity`, `NaN` and the field names of an
 * already-folded literal (`kind`, `'interval'`, `value`, `lo`, `hi`) are
 * removed: digits, the exponent letters of a numeric literal, the arithmetic a
 * constant's own spelling uses (`GoldenRatio` is `(1 + Math.sqrt(5)) / 2`),
 * and punctuation. Any other letter is a variable, a temporary, a user
 * function or a caller-spliced source, and the subtree is not closed.
 */
const FOLDABLE_INTERVAL_RESIDUE = /^[\s\d.,(){}:+\-*/eE]*$/;

/**
 * The `Math` members a constant subtree may mention: the constants of
 * `INTERVAL_JAVASCRIPT_CONSTANTS` and the `Math.sqrt` of `GoldenRatio`'s
 * spelling. An allowlist, not `Math.*`: a caller's `vars` splice is emitted
 * verbatim and may read `Math.random()`, which must keep drawing at run time
 * (the `vars` contract says a mapped symbol is never folded), so an admitted
 * member has to be deterministic by name.
 */
const FOLDABLE_MATH_MEMBERS =
  /Math\.(?:PI|E|LN2|LN10|LOG2E|LOG10E|SQRT2|SQRT1_2|sqrt)\b/g;

/** A whole `_IA.point(…)` call over a plain numeric literal — the spelling
 * that a fold would only make longer. */
const NUMERIC_POINT_CODE =
  /^_IA\.point\(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\)$/;

/** Memo of `foldConstantIntervalCode` by code string: the same constant
 * subtree recurs across the unrolled terms of a sum (`0.1·π`), and a fold
 * costs one `Function` construction. `null` records a decline. */
const FOLDED_INTERVAL_CODE = new Map<string, string | null>();
const FOLDED_INTERVAL_CODE_LIMIT = 4096;

/** The JavaScript spelling of an interval endpoint. `String(-0)` is `"0"`,
 * which would drop the sign a division or `atan2` reads. */
function intervalEndpointLiteral(n: number): string {
  return Object.is(n, -0) ? '-0' : String(n);
}

/** The JavaScript spelling of the interval `[lo, hi]`. */
function intervalLiteral(lo: number, hi: number): string {
  return `{ lo: ${intervalEndpointLiteral(lo)}, hi: ${intervalEndpointLiteral(hi)} }`;
}

/**
 * The enclosure of the real value `v` stands for, as emitted code, stepping
 * `steps` ulps out on each side.
 *
 * With one step (the default) `v` must be the CORRECTLY ROUNDED double of
 * that real value: the value is then at most half an ulp away and
 * `[nextDown(v), nextUp(v)]` contains it — strictly, since the value is not
 * `v` itself in every case this is used for. That is the narrowest enclosure
 * an emitter can write from a double alone.
 *
 * A caller whose double was reached by MORE than one rounding asks for more
 * steps: half an ulp per rounding is then not a bound, and one step could
 * name an interval the value is outside of.
 *
 * Used for the irrational constants (`INTERVAL_JAVASCRIPT_CONSTANTS`) and
 * for a number literal whose exact value no double holds (`inexactNumber`).
 * A non-finite `v` has no neighbours to step to and is emitted as the
 * degenerate interval it already is.
 */
function intervalEnclosureLiteral(v: number, steps = 1): string {
  if (!Number.isFinite(v)) return intervalLiteral(v, v);
  let lo = v;
  let hi = v;
  for (let i = 0; i < steps; i++) {
    lo = nextDown(lo);
    hi = nextUp(hi);
  }
  return intervalLiteral(lo, hi);
}

/**
 * Fold the emitted code of a CLOSED constant interval subtree to a literal
 * (`foldEmittedConstant` on this target). `_IA.mul(_IA.point(0.1),
 * _IA.point(Math.PI))` becomes `{ kind: 'interval', value: { lo: …, hi: … } }`
 * — what the run-time evaluation of that code returns, computed once here
 * with the same `IntervalArithmetic` library instead of on every call (an
 * unrolled 40-term sum re-evaluated every constant factor of every term per
 * call: Tycho item 269). The fold is sound where the `.N()`-based
 * `constantFold` is not (see the `constantFold: false` note in
 * `IntervalJavaScriptTarget.compile`): it computes in the interval domain
 * rather than baking a `.N()` point.
 *
 * The evaluation goes through the run-time library itself, which rounds every
 * endpoint it cannot prove exact outward (`interval/rounding.ts`), so the
 * folded literal ENCLOSES the value and is the SAME enclosure the emitted
 * code would have computed on every call.
 *
 * Admissibility is read off the CODE: it must consist only of calls into
 * `FOLDABLE_INTERVAL_ROUTINES` over numeric literals, `Math` members and
 * already-folded literals (`FOLDABLE_INTERVAL_RESIDUE`), which rules out
 * every variable, CSE temporary, bound index, user function and
 * caller-spliced spelling by construction. The evaluation result must be a
 * plain enclosure — a bare `{ lo, hi }` (what `_IA.point` returns) or an
 * `{ kind: 'interval', value }` — and is re-emitted in the SAME shape, so a
 * root-level fold answers what the structural code answered. `empty`,
 * `entire` and `singular` results are left to the structural code.
 *
 * `splices` are the sources the caller's `vars` symbols are emitted as
 * (`callerSpliceSources`). A mapped symbol is the caller's LIVE binding and
 * the `vars` contract says it is never folded, so a fold that would consume
 * one is refused — a caller who maps `s` to `_IA.point(0.5)` keeps
 * `_IA.mul(_IA.point(2), _IA.point(0.5))` in the code, even though every
 * character of it is spelled in this target's own dialect. The residue
 * charset cannot tell a splice from the emitter's own text, so the test is
 * on the RESULT, exactly as on the JavaScript and shader targets.
 */
function foldConstantIntervalCode(
  code: string,
  admitBarePoint = false,
  splices: readonly string[] = []
): string | undefined {
  if (!code.startsWith('_IA.')) return undefined;
  // The two admissibility policies answer differently for the same code, so
  // they cannot share a memo entry — and neither can two compilations whose
  // caller splices differ, since a splice the fold must preserve is part of
  // the decision.
  const key = JSON.stringify([admitBarePoint, splices, code]);
  const memo = FOLDED_INTERVAL_CODE.get(key);
  if (memo !== undefined) return memo ?? undefined;
  let folded = evaluateConstantIntervalCode(code, admitBarePoint);
  if (folded !== undefined && !preservesMappedSplices(code, folded, splices))
    folded = undefined;
  if (FOLDED_INTERVAL_CODE.size >= FOLDED_INTERVAL_CODE_LIMIT)
    FOLDED_INTERVAL_CODE.clear();
  FOLDED_INTERVAL_CODE.set(key, folded ?? null);
  return folded;
}

/**
 * The sources this compilation's caller-mapped `vars` symbols are spliced
 * into the emitted code as, computed once per target.
 *
 * The chain-step fold (`foldChainStep`) reaches the fold with the target in
 * hand rather than through `CompileTarget.foldEmittedConstant`, so it resolves
 * the list here instead of closing over the caller's map. Reading the `var`
 * hook has no effect on the compilation: it answers a mapped key from the
 * caller's map before it records anything.
 */
const INTERVAL_SPLICE_SOURCES = new WeakMap<object, readonly string[]>();
function intervalSpliceSources(
  target: CompileTarget<Expression> | undefined
): readonly string[] {
  if (target === undefined) return [];
  const memo = INTERVAL_SPLICE_SOURCES.get(target);
  if (memo !== undefined) return memo;
  const sources = callerSpliceSources(target.varsKeys, target.var);
  INTERVAL_SPLICE_SOURCES.set(target, sources);
  return sources;
}

function evaluateConstantIntervalCode(
  code: string,
  admitBarePoint = false
): string | undefined {
  let admissible = true;
  // A bare `_IA.point(c)` is already the cheapest spelling of its value, and
  // it is what the accessor folds of this target pin (`At` over a literal
  // list emits `_IA.point(20)`); only code that APPLIES a routine is worth
  // replacing. The caller lifts this rule for a position with no
  // neighbouring routine to fold into, and then only for a point that wraps
  // a NAMED constant. `MachineEpsilon` is the one such constant left —
  // `_IA.point(Number.EPSILON)` costs a call on every evaluation, and the
  // literal that replaces it costs none — while the irrational constants
  // (`Pi`, `ExponentialE`, `GoldenRatio`, …) are emitted as enclosure
  // literals already and `_IA.point(2)` is as short as its replacement.
  let applies = admitBarePoint && !NUMERIC_POINT_CODE.test(code);
  const residue = code
    .replace(/_IA\.([A-Za-z0-9_]+)/g, (_m, name: string) => {
      if (!FOLDABLE_INTERVAL_ROUTINES.has(name)) admissible = false;
      if (name !== 'point') applies = true;
      return '';
    })
    .replace(FOLDABLE_MATH_MEMBERS, '')
    .replace(/Number\.EPSILON/g, '')
    .replace(
      /\bInfinity\b|\bNaN\b|'interval'|\bkind\b|\bvalue\b|\blo\b|\bhi\b/g,
      ''
    );
  if (!admissible || !applies || !FOLDABLE_INTERVAL_RESIDUE.test(residue))
    return undefined;

  let result: unknown;
  try {
    result = new Function('_IA', `return (${code});`)(IntervalArithmetic);
  } catch {
    return undefined;
  }
  if (isPlainInterval(result)) return intervalLiteral(result.lo, result.hi);
  if (
    isRecord(result) &&
    result.kind === 'interval' &&
    Object.keys(result).length === 2 &&
    isPlainInterval(result.value)
  )
    return `{ kind: 'interval', value: ${intervalLiteral(result.value.lo, result.value.hi)} }`;
  return undefined;
}

/** One step of an n-ary `Add`/`Multiply`/`Divide` chain, folded when the
 * target folds emitted constants (`foldEmittedConstant` is unset under the
 * caller's `constantFold: false`). */
function foldChainStep(
  code: string,
  target: CompileTarget<Expression> | undefined,
  admitBarePoint = false
): string {
  if (target?.foldEmittedConstant === undefined) return code;
  return (
    foldConstantIntervalCode(
      code,
      admitBarePoint,
      intervalSpliceSources(target)
    ) ?? code
  );
}

/**
 * The two endpoints of `code` as they are spelled, when `code` is a whole
 * CONSTANT interval; `undefined` for anything else.
 *
 * The three spellings this target emits a constant interval in are all
 * accepted: `_IA.point(c)` (whose endpoints are both `c`), the bare
 * `{ lo, hi }` an emitted or folded constant takes, and the wrapped
 * `{ kind: 'interval', value: { lo, hi } }` a root-level fold answers. Each
 * endpoint must be a numeric literal as the emitters spell one
 * (`INTERVAL_CONSTANT_ENDPOINT`), which is what tells a constant from
 * `_IA.point(k)` over a loop index or `_IA.point(ops.length)`.
 */
function constantIntervalEndpoints(
  code: string
): readonly [string, string] | undefined {
  const point = /^_IA\.point\(([^(),]*)\)$/.exec(code);
  if (point !== null) {
    const c = point[1].trim();
    return INTERVAL_CONSTANT_ENDPOINT.test(c) ? [c, c] : undefined;
  }
  const enclosure =
    /^(?:\{ kind: 'interval', value: )?\{ lo: ([^,{}]+), hi: ([^,{}]+) \}(?: \})?$/.exec(
      code
    );
  if (enclosure === null) return undefined;
  const lo = enclosure[1].trim();
  const hi = enclosure[2].trim();
  if (
    !INTERVAL_CONSTANT_ENDPOINT.test(lo) ||
    !INTERVAL_CONSTANT_ENDPOINT.test(hi)
  )
    return undefined;
  return [lo, hi];
}

/**
 * Whether `code` is a constant POINT interval — a degenerate enclosure whose
 * two endpoints are the same numeric literal.
 *
 * A NaN endpoint is refused: `NaN === NaN` is false in the emitted arithmetic
 * too, so such an interval is not a point at run time and must keep the
 * general product, whose NaN propagation the specialization does not
 * reproduce.
 */
function isConstantPointCode(code: string): boolean {
  const endpoints = constantIntervalEndpoints(code);
  if (endpoints === undefined) return false;
  return endpoints[0] === endpoints[1] && endpoints[0] !== 'NaN';
}

/**
 * One step of a `Multiply` chain: `a · b`, folded when both sides are
 * constant, and otherwise emitted as the point-scaling kernel when one side
 * is a constant point.
 *
 * `_IA.scale(p, x)` answers the same endpoints as `_IA.mul(p, x)` for a point
 * `p` (`interval/arithmetic.ts`) with two endpoint products instead of four,
 * which is the shape a coefficient times a variable takes. Interval
 * multiplication is commutative endpoint for endpoint, so a constant on the
 * right is emitted as the left operand of the scaling; that reorders the two
 * operands, which is unobservable because a constant runs no code.
 *
 * The fold is attempted FIRST and its answer is returned untouched: a step
 * whose two sides are both constant becomes one literal, and there is nothing
 * left to scale.
 */
function intervalMulStep(
  left: string,
  right: string,
  target: CompileTarget<Expression> | undefined
): string {
  const product = `_IA.mul(${left}, ${right})`;
  const folded = foldChainStep(product, target);
  if (folded !== product) return folded;
  if (isConstantPointCode(left)) return `_IA.scale(${left}, ${right})`;
  if (isConstantPointCode(right)) return `_IA.scale(${right}, ${left})`;
  return product;
}

/**
 * The operand of `code` when `code` is a WHOLE `_IA.negate(…)` call, and
 * `undefined` for anything else — a negation that is only part of a larger
 * expression included.
 *
 * The scan matches the parenthesis that opens the call against the one that
 * closes it, over the STRING-MASKED copy of the code, so a parenthesis inside
 * caller text (a `String` operand, a spliced `vars` entry) cannot make an
 * unbalanced pair look balanced.
 */
function strippedIntervalNegate(code: string): string | undefined {
  const head = '_IA.negate(';
  if (!code.startsWith(head) || !code.endsWith(')')) return undefined;
  const masked = maskStringLiterals(code);
  let depth = 0;
  for (let i = head.length - 1; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')' && --depth === 0)
      return i === masked.length - 1
        ? code.slice(head.length, masked.length - 1)
        : undefined;
  }
  return undefined;
}

/**
 * The two arguments of `code` when it is a WHOLE two-argument
 * `_IA.<name>(a, b)` call, and `undefined` for anything else — a call that is
 * only part of a larger expression, or one with any other number of
 * arguments.
 *
 * The scan runs over the STRING-MASKED copy of the code, so a bracket or a
 * comma inside caller text (a `String` operand, a spliced `vars` entry)
 * cannot be read as structure.
 */
function splitIntervalCall(
  code: string,
  name: string
): readonly [string, string] | undefined {
  const head = `_IA.${name}(`;
  if (!code.startsWith(head) || !code.endsWith(')')) return undefined;
  const masked = maskStringLiterals(code);
  let depth = 0;
  let comma = -1;
  for (let i = head.length - 1; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (--depth > 0) continue;
      if (i !== masked.length - 1 || comma < 0) return undefined;
      return [code.slice(head.length, comma), code.slice(comma + 1, i).trim()];
    } else if (c === ',' && depth === 1) {
      // A second top-level comma means a call this helper does not describe.
      if (comma >= 0) return undefined;
      comma = i;
    }
  }
  return undefined;
}

/**
 * The code for the NEGATION of a constant point interval, or `undefined` when
 * `code` is not one or its endpoint is not a plain numeric literal.
 *
 * Only a finite decimal literal is negated: a named constant (`Math.PI`) and
 * the non-finite endpoints have no negated spelling this function can write
 * without evaluating the text, and the hoist reads the result back
 * (`INTERVAL_CONSTANT_ENDPOINT`), so it has to stay in the same spelling.
 */
function negatedConstantPointCode(code: string): string | undefined {
  if (!isConstantPointCode(code)) return undefined;
  const endpoints = constantIntervalEndpoints(code)!;
  if (!PLAIN_NUMERIC_ENDPOINT.test(endpoints[0])) return undefined;
  const value = -Number(endpoints[0]);
  if (!Number.isFinite(value)) return undefined;
  const literal = intervalEndpointLiteral(value);
  return code.startsWith('_IA.point(')
    ? `_IA.point(${literal})`
    : intervalLiteral(value, value);
}

/** A finite decimal endpoint, the one spelling `negatedConstantPointCode` can
 *  negate by reading the text (`INTERVAL_CONSTANT_ENDPOINT` also admits the
 *  named constants, `Infinity` and `NaN`). */
const PLAIN_NUMERIC_ENDPOINT = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * One step of a `Divide` chain: `a / b`, folded when both sides are constant,
 * and otherwise emitted as the point-dividing kernel when the DIVISOR is a
 * constant point.
 *
 * `_IA.scaleDiv(x, p)` answers the same endpoints as `_IA.div(x, p)` for a
 * non-zero point `p` with two corner quotients instead of four. The divisor
 * position is fixed — division does not commute — so only the right operand
 * is tested.
 *
 * A NEGATED numerator is folded into the division rather than building an
 * interval the division consumes at once. With a general divisor that is the
 * `_IA.negDiv` kernel, which answers what `_IA.div` of the negation answers
 * (`interval/arithmetic.ts`). With a constant point divisor the sign moves
 * onto the CONSTANT instead — `(−x)/p` and `x/(−p)` have the same correctly
 * rounded endpoints, since IEEE division takes its sign from the operand signs
 * and its magnitude from their magnitudes — which keeps the two-corner
 * `scaleDiv` kernel.
 */
function intervalDivStep(
  left: string,
  right: string,
  target: CompileTarget<Expression> | undefined
): string {
  const quotient = `_IA.div(${left}, ${right})`;
  const folded = foldChainStep(quotient, target);
  if (folded !== quotient) return folded;
  const numerator = strippedIntervalNegate(left);
  if (numerator !== undefined) {
    const negatedDivisor = negatedConstantPointCode(right);
    if (negatedDivisor !== undefined)
      return `_IA.scaleDiv(${numerator}, ${negatedDivisor})`;
    return `_IA.negDiv(${numerator}, ${right})`;
  }
  if (isConstantPointCode(right)) return `_IA.scaleDiv(${left}, ${right})`;
  return quotient;
}

/**
 * The constant factors of a product that also has an exact rational factor
 * `p/q`, folded together with that rational into ONE enclosure — with the
 * remaining, non-constant factors.
 *
 * `2πs/100` reaches the rational lowering as the divisor 100/2 = 50 and the
 * factors `π` and `s`, and the structural emission multiplies by `π` and then
 * divides by 50 on every evaluation: `_IA.div(_IA.mul(<π>, _.s), _IA.point(50))`.
 * Both constants are known here, so `π/50` is computed ONCE, at compile time,
 * through the run-time library itself (`foldConstantIntervalCode`, which
 * rounds every endpoint it cannot prove exact outward). The emitted code
 * multiplies by that enclosure and does not divide at all.
 *
 * The fold is taken only when the product of the OTHER constant factors is
 * already INEXACT — an enclosure with two different endpoints. That is what
 * keeps the reason the rational lowering divides rather than multiplying by a
 * reciprocal: `2x/49` is exactly `2k` at `x = 49k` because the division `x/49`
 * is exact there, and a folded `2/49` — a rounded enclosure, since no double
 * holds that value — would answer an interval around `2k` instead, which a
 * surrounding `floor` reads as a discontinuity. The test is on the constant
 * factors, NOT on the folded answer: `2/49` is inexact and so would pass a
 * test on the answer, while the emission it replaces is exact at every
 * multiple of 49. A constant factor that is already an enclosure (`π`) makes
 * the product inexact for every operand, so no exact multiple is lost.
 *
 * Reordering the factors is unobservable: a constant runs no code, so moving
 * it in front of the remaining factors cannot change the order in which their
 * effects run relative to each other.
 */
function foldRationalConstantFactors(
  rest: readonly string[],
  rat: { p: number; q: number },
  target: CompileTarget<Expression> | undefined
): { constant: string; factors: string[] } | undefined {
  if (target?.foldEmittedConstant === undefined) return undefined;
  const constants = rest.filter(
    (code) => constantIntervalEndpoints(code) !== undefined
  );
  const factors = rest.filter(
    (code) => constantIntervalEndpoints(code) === undefined
  );
  // With no constant factor there is nothing to fold the rational into; with
  // no other factor the product is constant throughout and the ordinary chain
  // fold already collapses it.
  if (constants.length === 0 || factors.length === 0) return undefined;
  const splices = intervalSpliceSources(target);
  let product = constants[0];
  if (constants.length > 1) {
    for (let i = 1; i < constants.length; i++)
      product = `_IA.mul(${product}, ${constants[i]})`;
    const foldedProduct = foldConstantIntervalCode(product, false, splices);
    if (foldedProduct === undefined) return undefined;
    product = foldedProduct;
  }
  const endpoints = constantIntervalEndpoints(product);
  if (endpoints === undefined || endpoints[0] === endpoints[1])
    return undefined;
  let code = `_IA.div(${product}, _IA.point(${rat.q}))`;
  if (rat.p !== 1) code = `_IA.mul(${code}, _IA.point(${rat.p}))`;
  const folded = foldConstantIntervalCode(code, false, splices);
  if (folded === undefined) return undefined;
  return { constant: folded, factors };
}

// ---------------------------------------------------------------------------
// Hoisting repeated constant intervals out of the emitted expression.
// ---------------------------------------------------------------------------

/**
 * The constant interval spellings this target emits, longest form first.
 *
 * Three shapes: the wrapped result of a fold
 * (`{ kind: 'interval', value: { lo, hi } }`), a bare enclosure
 * (`{ lo, hi }` — a fold answer, an emitted constant, an inexact literal)
 * and a point (`_IA.point(0.5)`). The alternation is ordered so that the
 * wrapped form is consumed whole and its inner enclosure is not matched
 * separately.
 *
 * Every capture is checked against `INTERVAL_CONSTANT_ENDPOINT` before it is
 * used: `_IA.point(k)` over a loop index and `_IA.point(ops.length)` are
 * spelled the same way and must not be hoisted.
 */
const HOISTABLE_INTERVAL_CONSTANT =
  /\{ kind: 'interval', value: \{ lo: ([^,{}]+), hi: ([^,{}]+) \} \}|\{ lo: ([^,{}]+), hi: ([^,{}]+) \}|_IA\.point\(([^(),]*)\)/g;

/** An array literal whose every element is a name the constant table bound
 * (`hoistIntervalConstants`): the spelling of a constant list after the
 * scalar pass, with the emitter's own `, ` separator. */
const HOISTABLE_INTERVAL_ARRAY = /\[_k\d+(?:, _k\d+)*\]/g;

/** A numeric endpoint as the emitters spell one, plus the named constants
 * they inline. Anything else in the same syntactic position is a variable,
 * a bound index or a length read, and is not a constant. */
const INTERVAL_CONSTANT_ENDPOINT =
  /^(?:-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|Infinity)|NaN|Math\.PI|Math\.E|Number\.EPSILON)$/;

/**
 * The source with the CONTENT of every string literal replaced by `.`
 * fillers of the same length, so the copy addresses the same positions as
 * the original.
 *
 * The constant-table search itself runs over the ORIGINAL source — the fold's
 * own `{ kind: 'interval', … }` spelling contains a string literal, so a
 * search over the masked copy would not find it. There the mask is read only
 * to REJECT a match that starts inside caller text (a `String` operand, a
 * spliced `vars` entry): both spellings start with `{` or `_`, and masking
 * turns either into a `.`, so comparing the first character decides it.
 *
 * The bracket scans (`strippedIntervalNegate`, `splitIntervalCall`) read the
 * masked copy instead, since what they look for is STRUCTURE: a bracket or a
 * comma inside caller text must not be read as one of theirs.
 */
function maskStringLiterals(code: string): string {
  let out = '';
  let quote: string | undefined;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote === undefined) {
      out += c;
      if (c === "'" || c === '"' || c === '`') quote = c;
      continue;
    }
    if (c === '\\') {
      out += '..';
      i++;
      continue;
    }
    out += c === quote ? c : '.';
    if (c === quote) quote = undefined;
  }
  return out;
}

/**
 * Bind the constant intervals of `definitions` and `expression` to names, and
 * rewrite both to read those names.
 *
 * Every constant interval in the emitted code is an object LITERAL, so the
 * expression allocates one object per occurrence per call — 913 point
 * intervals across the corpus the Tycho code-generation audit of 2026-09-08
 * measured. The declarations this function returns are evaluated ONCE, when
 * the compiled runner is built (`ComputeEngineIntervalFunction`), so every
 * occurrence of every constant reads a name that was allocated once for the
 * lifetime of the artifact. That is why a constant is bound at its FIRST
 * occurrence, with no repetition threshold: the consumer of this target
 * evaluates the kernel once per quadtree node, so even a constant written
 * once in the root expression was paying one allocation per node.
 *
 * The pass runs AFTER the constant fold, deliberately. The fold decides
 * admissibility by reading the emitted code (`foldConstantIntervalCode`),
 * and a hoisted name is a bare identifier the fold cannot resolve — it
 * would refuse to fold `_IA.mul(_k1, _k2)` and every chain step above it,
 * losing more than the hoist gains. Running last also means the hoist sees
 * the FINAL spelling of every constant, including the ones the fold
 * produced.
 *
 * Sharing one object between occurrences is safe because no `_IA` routine
 * writes to its operands: every one of them builds a fresh result object
 * (`interval/arithmetic.ts`, `interval/util.ts`). That guarantee covers this
 * compiler's own emission only, which is why the pass turns itself off for a
 * compilation carrying a caller-supplied function (see below).
 */
function hoistIntervalConstants(
  definitions: string,
  expression: string,
  target: CompileTarget<Expression>
): { declarations: string; definitions: string; expression: string } {
  // A caller-supplied function (the `functions` compilation option) is code
  // this compiler never sees. It receives an interval object as an argument
  // and may keep or write to it, and the rewrite below is textual: it would
  // hand that function the SAME object at every occurrence of the constant,
  // so one mutation would be visible at all of them. The names the caller
  // overrode are `foldExcludedOps`; when there is any, no constant is
  // hoisted, because an occurrence's position in the emitted text does not
  // say whose argument it is.
  if ((target.foldExcludedOps?.size ?? 0) > 0)
    return { declarations: '', definitions, expression };
  // Index 0 is the user-function definitions, index 1 the root expression.
  const sources = [definitions, expression];
  type Match = { source: number; start: number; end: number; text: string };
  const matches: Match[] = [];
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s];
    const masked = maskStringLiterals(source);
    HOISTABLE_INTERVAL_CONSTANT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HOISTABLE_INTERVAL_CONSTANT.exec(source)) !== null) {
      // Inside caller text, not code.
      if (masked[m.index] !== source[m.index]) continue;
      const parts = [m[1], m[2], m[3], m[4], m[5]].filter(
        (p): p is string => p !== undefined
      );
      if (!parts.every((p) => INTERVAL_CONSTANT_ENDPOINT.test(p.trim())))
        continue;
      matches.push({
        source: s,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
      });
    }
  }

  const used = target.naming?.usedNames;
  const names = new Map<string, string>();
  const declarations: string[] = [];
  let counter = 0;
  const bind = (matched: readonly Match[]): void => {
    for (const { text } of matched) {
      if (names.has(text)) continue;
      let name: string;
      do {
        name = `_k${++counter}`;
      } while (used?.has(name) === true);
      used?.add(name);
      names.set(text, name);
      declarations.push(`const ${name} = ${text};`);
    }
  };
  const rewrite = (source: string, s: number, matched: readonly Match[]) => {
    let out = '';
    let at = 0;
    for (const match of matched) {
      if (match.source !== s) continue;
      const name = names.get(match.text);
      if (name === undefined) continue;
      out += source.slice(at, match.start) + name;
      at = match.end;
    }
    return out + source.slice(at);
  };
  bind(matches);
  if (names.size === 0) return { declarations: '', definitions, expression };
  let rewritten = sources.map((source, s) => rewrite(source, s, matches));

  // Arrays whose every element is a constant bound above are constants too,
  // and they are the expensive ones: a list value the emitter spells at each
  // read site — `_IA.at([_k3, …, _k402], _IA.point(i))` for `h[i]` over a
  // 400-element assigned list — built one array of 400 slots per read, per
  // call, and inside a loop-form sum once per iteration (Tycho corpus
  // document `vwbagbcerj`, 2026-09-16: 160,000 element placements per
  // evaluation). Each distinct array is bound once, after its elements. A
  // nested list becomes constant from the inside out, so the search repeats
  // until it finds nothing new: an inner `[_k1, _k2]` is bound to a name on
  // one round and the outer array reads that name on the next. An array
  // with any other element (a loop index, a variable, a call) is not a
  // constant and stays where it is.
  //
  // Sharing an array between reads is as safe as sharing an interval: no
  // `_IA` routine writes to an array operand (`interval/collections.ts`), and
  // an array a call answers at the root is copied elementwise on the way out
  // (`freshIntervalValue`).
  //
  // Only a name THIS pass bound counts as a constant element. A caller can
  // spell `_k99` too — a `vars` entry mapped to that text, declared in the
  // caller's own per-call preamble — and the table is evaluated outside that
  // preamble, so an array that read such a name from the table would throw
  // when the runner is built.
  const bound = new Set<string>();
  for (;;) {
    for (const name of names.values()) bound.add(name);
    const arrays: Match[] = [];
    for (let s = 0; s < rewritten.length; s++) {
      const source = rewritten[s];
      const masked = maskStringLiterals(source);
      HOISTABLE_INTERVAL_ARRAY.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HOISTABLE_INTERVAL_ARRAY.exec(source)) !== null) {
        if (masked[m.index] !== source[m.index]) continue;
        const elements = m[0].slice(1, -1).split(', ');
        if (!elements.every((name) => bound.has(name))) continue;
        arrays.push({
          source: s,
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
        });
      }
    }
    if (arrays.length === 0) break;
    bind(arrays);
    rewritten = rewritten.map((source, s) => rewrite(source, s, arrays));
  }
  return {
    declarations: declarations.join('\n'),
    definitions: rewritten[0],
    expression: rewritten[1],
  };
}

/** A bare `{ lo, hi }` with numeric endpoints and nothing else. */
function isPlainInterval(value: unknown): value is Interval {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value.lo === 'number' &&
    typeof value.hi === 'number'
  );
}

/**
 * A copy of a run result that shares no object with the constant table.
 *
 * The constant declarations are evaluated ONCE per artifact, so a constant
 * interval is the SAME object on every call, and several routines hand an
 * operand back rather than building a new answer — `piecewise` returns the
 * arm it selected, `restrict` returns its value. A caller who writes to the
 * `lo` of a returned interval would therefore change what every later call
 * answers. Copying the result on the way out keeps the returned value the
 * caller's own, at the cost of one small object per call.
 *
 * The copy is one level deep for a kinded result (the wrapper and the
 * enclosure it carries), and elementwise for an array — the value a
 * collection-valued root answers, whether it is the result itself or the
 * value a kinded wrapper carries. A number, a string and a nested plain value
 * copy through as they are.
 */
function freshIntervalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(freshIntervalValue);
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = { ...value };
  if (isPlainInterval(copy.value)) copy.value = { ...copy.value };
  else if (Array.isArray(copy.value))
    copy.value = copy.value.map(freshIntervalValue);
  return copy;
}

/**
 * JavaScript function that wraps compiled interval arithmetic code.
 *
 * Injects the _IA library and provides input conversion from various formats.
 *
 * `constants` is the declaration list of the constant table
 * (`hoistIntervalConstants`). It is evaluated ONCE, when the runner is built,
 * in a scope that sees `_IA` and nothing per call; the inner function it
 * returns runs the per-call `preamble` and the body on every call. A constant
 * interval is the same on every call, and the consumer of this target
 * evaluates the kernel once per quadtree node, so building the table per call
 * paid one allocation per constant per node. The per-call preamble keeps the
 * user-function definitions and the caller's own `preamble` option: a
 * definition closes over the vars object, and the caller's source is arbitrary
 * text that may hold per-call state.
 */
export class ComputeEngineIntervalFunction extends Function {
  IA = IntervalArithmetic;

  constructor(body: string, preamble = '', constants = '') {
    const perCallCode = preamble
      ? `${preamble};return ${body}`
      : `return ${body}`;
    super('_IA', '_', perCallCode);
    const inner =
      constants === ''
        ? undefined
        : (
            new Function(
              '_IA',
              `${constants}\nreturn function (_) { ${perCallCode} };`
            ) as (ia: typeof IntervalArithmetic) => (v?: unknown) => unknown
          )(this.IA);
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) => {
        try {
          // Process input arguments - convert to interval format
          const processedArgs = argumentsList.map(processInput);
          if (inner === undefined)
            return super.apply(thisArg, [this.IA, ...processedArgs]);
          return freshIntervalValue(inner(...processedArgs));
        } catch {
          // Runtime error (e.g., missing _IA method) — return "entire"
          // to signal "cannot bound this" rather than crashing.
          return { kind: 'entire' };
        }
      },
      get: (target, prop) => {
        if (prop === 'toString') return (): string => body;
        if (prop === 'isCompiled') return true;
        return Reflect.get(target, prop);
      },
    });
  }
}

/**
 * Process an input value to interval format.
 *
 * Accepts:
 * - { lo: number, hi: number } - Direct interval
 * - { x: {...}, y: {...} } - Object with interval-valued properties
 * - number - Convert to point interval
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasIntervalBounds(
  value: unknown
): value is { lo: unknown; hi: unknown } {
  return isRecord(value) && 'lo' in value && 'hi' in value;
}

/**
 * Wrap an interpreter fallback result as a value honoring the interval-js
 * `run` contract (`IntervalValue`). A number becomes the degenerate interval
 * `{ lo: v, hi: v }`; a collection (materialized to an array, possibly
 * nested) becomes the array of its elements' wrappings — the same shape a
 * compiled comprehension returns; any other value (a boolean, text) has no
 * interval reading and is reported as `entire`, the same "cannot bound"
 * signal the runtime proxy uses.
 */
function toIntervalValue(value: unknown): IntervalValue {
  if (typeof value === 'number') return { lo: value, hi: value };
  if (Array.isArray(value)) return value.map(toIntervalValue);
  return { kind: 'entire' };
}

/**
 * Collapse an interval-shaped fallback input (`{ lo, hi }`) to a representative
 * scalar — its midpoint — so the number-based interpreter can consume it. A
 * variables object has each interval-valued entry collapsed recursively; other
 * values pass through unchanged.
 */
function collapseIntervalInput(value: unknown): unknown {
  if (hasIntervalBounds(value))
    return (Number(value.lo) + Number(value.hi)) / 2;
  // A collection input stays a collection for the interpreter — only its
  // ELEMENTS collapse. The record branch below would turn it into an object
  // keyed "0", "1", …, which the interpreter reads as a dictionary.
  if (Array.isArray(value)) return value.map(collapseIntervalInput);
  if (isRecord(value)) {
    // Prototype-free: `out['__proto__'] = v` on an ordinary object invokes the
    // inherited setter instead of creating an own key, so a variable named
    // `__proto__` was dropped from the copy entirely and read as unsupplied.
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value))
      out[k] = collapseIntervalInput(v);
    return out;
  }
  return value;
}

function processInput(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  // Already an interval
  if (hasIntervalBounds(input)) {
    return input;
  }

  // A COLLECTION input stays an array: the accessors (`_IA.at`, `_IA.length`,
  // `_IA.component`) dispatch on `Array.isArray` and read `.length`. The
  // generic record branch below would copy it into a null-prototype object
  // keyed "0", "1", … — silently losing both the length and the positional
  // access, so every collection access would answer absence.
  if (Array.isArray(input)) return input.map(processInput);

  // Object with properties - process recursively
  if (isRecord(input)) {
    // Prototype-free — see `collapseIntervalInput`: an ordinary object cannot
    // carry an own `__proto__` key, so the caller's value for a variable of
    // that name would be silently lost in this copy.
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(input)) {
      result[key] = processInput(value);
    }
    return result;
  }

  // Number - convert to point interval
  if (typeof input === 'number') {
    return { lo: input, hi: input };
  }

  return input;
}

/**
 * Interval arithmetic JavaScript target implementation.
 */
/**
 * The compile modes the interval target offers (`CompileMode`): `'strict'`
 * only — intervals are real.
 */
const INTERVAL_SUPPORTED_MODES: readonly CompileMode[] = ['strict'];

export class IntervalJavaScriptTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return INTERVAL_JAVASCRIPT_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return INTERVAL_JAVASCRIPT_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'interval-javascript',
      // Intervals are real: the strict discipline is the only mode this
      // target offers (`CompileMode`); a requested `'complex'`/`'auto'` is
      // the `unsupported-mode` decline.
      supportedModes: INTERVAL_SUPPORTED_MODES,
      // See `CompileTarget.varsObjectName`: free symbols read as `_.<id>`
      // (below), so a lambda parameter spelled `_` must not shadow the vars
      // object.
      varsObjectName: '_',
      // `_IA` is baked as a literal token by every interval lowering; `_SYS`
      // by the helpers it shares with the JavaScript target. See
      // `CompileTarget.reservedEmittedNames`.
      reservedEmittedNames: new Set(['_IA', '_SYS']),
      // Only a function-LITERAL callee compiles here (see the `Apply` entry
      // of the function table below, and `CompileTarget`): the reference
      // analysis must stop at such an application rather than walk into a
      // callee this target never compiles.
      appliesFunctionLiteralsOnly: true,
      // Don't use operators - all arithmetic goes through functions
      // because interval arithmetic returns IntervalResult, not numbers
      operators: () => undefined,
      // The interval domain is scalar — one interval per quantity — so there is
      // no element-wise selection convention here. Decline a provably
      // collection-valued `Which`/`If` condition with a message that says so,
      // instead of the generic ``Unknown operator `List` `` the clause list used
      // to produce. Only PROVABLE collection-ness is tested: a wide-declared
      // condition (`q(x) < y` with `q: (unknown) -> unknown`) must keep
      // compiling unchanged — scalar curve/implicit plotting rides this target.
      selection: (args) => {
        for (let i = 0; i < args.length; i += 2) {
          const c = args[i];
          if (c.isCollection || c.type.matches('collection<any>'))
            throw new Error(
              'Could not compile `Which`: a collection-valued condition has no interval-js lowering — ' +
                'the interval domain is scalar (one interval per quantity), so there ' +
                'is no elementwise selection convention. Evaluate the expression ' +
                'instead, or compile a scalar per-element function.'
            );
        }
        return null;
      },
      functions: (id) => guardedIntervalFunction(id),
      constant: (id) => INTERVAL_JAVASCRIPT_CONSTANTS[id],
      var: (id) => {
        return INTERVAL_JAVASCRIPT_CONSTANTS[id];
      },
      // The array spelling of a collection-building expression, for the
      // consuming positions the shared compiler owns (a helper's body root,
      // a whole-bound call argument). See `compileIntervalCollectionValue`.
      compileCollectionValue: (e, t) => compileIntervalCollectionValue(e, t),
      // A unary `broadcastable` head over a LITERAL collection
      // (`sin(3..5)`, `−[1, 2, 3]`) reaches this hook from the shared
      // compiler before the head's handler runs; it is the same element-wise
      // map `tryIntervalBroadcast` emits for a typed operand, over the
      // literal spelled as an array. A literal the spelling declines (a list
      // with a non-numeric element) declines here.
      broadcastUnary: (_head, operand, lowering, t) => {
        const coll = compileIntervalCollectionValue(operand, t);
        if (coll === undefined) return undefined;
        const param = BaseCompiler.tempVar(t);
        return `_IA.bcast((${param}) => ${lowering.element(param)}, ${coll})`;
      },
      string: (str) => JSON.stringify(str),
      number: (n) => `_IA.point(${n})`,
      // A literal the engine holds exactly but no double does — `1/49`,
      // `√2` — is emitted as an enclosure of its value, not as a point at the
      // nearest double. A point there excludes the very number the caller
      // wrote, which defeats the guarantee this target answers with. A
      // machine float the user typed (`0.329`) is NOT such a literal: the
      // interpreter computes with that same double, so it stays a point (see
      // `CompileTarget.inexactNumber`). `roundings` says how many roundings
      // stand between the exact value and that double, and the enclosure
      // steps out one ulp for each: a rational whose numerator or denominator
      // is past the reach of the significand is converted, converted and
      // divided, and its true value can sit more than two ulps from the
      // double — outside a one-ulp enclosure.
      inexactNumber: (n, roundings) => intervalEnclosureLiteral(n, roundings),
      // Evaluate a shared middle operand of a chained relation exactly once
      // (matching the interpreter) by binding it in an IIFE. Net-new here: the
      // interval target used to inline every operand, so `a < m < b` evaluated
      // `m` twice.
      bindExpr: (bindings, body) =>
        `((${bindings.map((b) => b[0]).join(', ')}) => ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      // Dependency-ordered CSE temporaries: a sequential-`const` IIFE (an
      // interval `{ lo, hi }` value is `const`-bindable like any other).
      cseBind: (bindings, body) =>
        `(() => { ${bindings
          .map(([name, code]) => `const ${name} = ${code};`)
          .join(' ')} return ${body}; })()`,
      // Absence capability (§3.F): numeric absence is a whole-NaN interval
      // (reusing the machinery already present for `NaN`). The runtime's
      // `isAbsent` answers a tri-state verdict — `'true'` for the marker and
      // for the `empty` result a failed restriction yields, `'maybe'` for a
      // value that exists over part of the cell — so `IsMissing` composes
      // with every other condition of this target; `coalesce` hands the
      // fallback back for an absent value and the hull for a partial one.
      // (A lower-endpoint test used to answer a JavaScript `false` for every
      // kinded result, `empty` included.) This target has no object domain:
      // an absent list is the marker too (every collection consumer
      // propagates a non-array operand), an absent condition is the verdict
      // `'false'` (`_IA.restrict` over a relation), so the object-domain
      // gate does not apply (`coversValueModel`). No object axis.
      absence: {
        numeric: {
          make: () => '{ lo: NaN, hi: NaN }',
          isAbsent: (x) => `_IA.isAbsent(${x})`,
          coalesce: (x, d) => `_IA.coalesce(${x}, () => ${d})`,
          coversValueModel: true,
        },
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      // Sound compile-time folding of closed constant subtrees, by evaluating
      // their emitted code with the interval library (see
      // `foldConstantIntervalCode`). Distinct from `constantFold`, which is
      // the `.N()` fold and stays off on this target.
      foldEmittedConstant: (_expr, code) => foldConstantIntervalCode(code),
      // Bind index-free scalar subexpressions of a `Sum`/`Product` body once
      // per call rather than once per term (see `CompileTarget`).
      hoistScalarInvariants: true,
      // Every operation on this target is a library call that allocates its
      // result, so a repeated subexpression of two or three nodes — `1/n`,
      // `sin(x)`, `n·x` — pays for a temporary where the JavaScript target's
      // syntax-size thresholds would not bind it (see
      // `CompileTarget.cseMinSize`): a node of size 2 or 3 is bound at three
      // occurrences.
      cseMinSize: 2,
      cseMinScore: 4,
      // Per-compilation naming state for generated temporaries (see the
      // JavaScript target).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-js', IntervalValue> {
    // See the note in `javascript-target.ts`: the target-level route bypasses
    // the standalone `compile()` export, where these deprecations were warned
    // about and where the `complexPromotion` alias is resolved, so each target
    // entry warns and normalizes for itself. This target declares `['strict']`
    // only, so the alias is NOT mapped onto `mode: 'complex'` (that would turn
    // a compile that used to succeed into an `unsupported-mode` decline); it
    // is merely cleared. Once-per-process per key.
    options = normalizeDeprecatedCompileOptions(
      options,
      INTERVAL_SUPPORTED_MODES.includes('complex')
    ).options;
    // The `storage` hints are shader-only and ignored by this target, but
    // validated on every target (see `javascript-target.ts`).
    if (options.storage !== undefined)
      resolveStorageHints(options.storage, [expr], this.createTarget(), {
        vars: options.vars,
        functions: options.functions,
      });
    let result: CompilationResult<'interval-js', IntervalValue>;
    try {
      result = this.compileOrThrow(expr, options);
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      // A cancellation that is not a timeout (an abort, an iteration or
      // recursion limit), or a timeout of an expired enclosing span, belongs
      // to the caller: it is thrown again, not changed into a fallback
      // (docs/TIMEOUT-MODEL.md §2).
      throwIfCallerCancellation(e, expr.engine._deadlineFrame);
      if (options.fallback !== true) throw e;
      return this.buildIntervalFallback(expr, (e as Error).message, options);
    }
    // The primary failure class never throws: `compileToIntervalTarget`
    // reports an operator with no interval kernel as `success: false` (see its
    // internal catch), so the `catch` above cannot build the fallback for it.
    // When the caller opted into the failure-shape contract, normalize that
    // `success: false` to the same interpreter-backed fallback, preserving the
    // captured error detail (synthesizing a message only if none survived).
    if (!result.success && options.fallback === true) {
      const error =
        result.error ??
        `Could not compile \`${expr.operator}\` to the interval-js target`;
      return this.buildIntervalFallback(
        expr,
        error,
        options,
        result.diagnostic
      );
    }
    return result;
  }

  /**
   * Build the documented `success: false` fallback for the interval-js target:
   * an interpreter-backed `run` whose results honor the interval contract.
   *
   * `BaseCompiler.buildInterpreterFallback` produces a runner that returns plain
   * numbers (and nested arrays for collections), so its scalar output is wrapped
   * as a degenerate interval `{ lo: v, hi: v }`, and interval-shaped *inputs*
   * (`{ lo, hi }`) are collapsed to their midpoint before interpretation. A
   * non-scalar result cannot be bounded as a single interval, so it is reported
   * as `{ kind: 'entire' }` — the same "cannot bound" signal the runtime proxy
   * uses. Returning a properly interval-typed `run` lets the result carry the
   * target's real value type without a force cast.
   */
  private buildIntervalFallback(
    expr: Expression,
    error: string,
    options: CompilationOptions<Expression>,
    diagnostic?: CompileDiagnostic
  ): CompilationResult<'interval-js', IntervalValue> {
    console.warn(
      `Compilation fallback for "${expr.operator}" (target: interval-js): ${error}`
    );
    const base = BaseCompiler.buildInterpreterFallback(
      expr,
      error,
      'interval-js',
      this.createTarget(),
      options.vars ? new Set(Object.keys(options.vars)) : undefined,
      diagnostic
    );
    // `run` is guaranteed present for an executable target (interval-js).
    // Through `unknown`: the fallback's `run` is typed with the interval
    // target's own result union, which does not overlap the plain
    // number/array shape the interpreter actually hands back here before
    // `toIntervalValue` wraps it.
    const interpreterRun = base.run as unknown as (
      ...args: unknown[]
    ) => unknown;
    const run: CompiledRunner<IntervalValue, IntervalInput> = (
      ...args: unknown[]
    ): IntervalValue =>
      toIntervalValue(interpreterRun(...args.map(collapseIntervalInput)));
    return { ...base, run };
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-js', IntervalValue> {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    // Turn a collection whose WIDTH is known at compile time into straight-line
    // scalar code, so this target sees the shape the interpreter computes
    // rather than a runtime array (`fixed-width-unroll.ts`). A head the caller
    // overrode is withheld from the pass: the caller's implementation replaces
    // the emission and receives the node's own operands, which an unroll would
    // change. This target reads no `operators` option.
    const unrollSkipHeads = overriddenCompilationHeads(
      undefined,
      options.functions
    );
    const unrollOptions = {
      skipHeads: unrollSkipHeads,
      iterationBudget: options.iterationBudget,
      readsLiveSource: (name: string) =>
        typeof options.vars?.[name] === 'string',
      // This target has no list lowering at all, so a list of ANY width is
      // written out (`CompileTarget.unrollMinWidth`).
      minWidth: 1,
      unrollConstantLists: true,
    };
    expr = unrollFixedWidthCollections(expr, unrollOptions);
    const { functions, vars, preamble } = options;
    // Refreshed below, after the helper inlining that can expose a global
    // the callee body reads.
    let unknowns = expr.unknowns;

    // Process custom functions
    // Null-prototype: this table collects CALLER-supplied function overrides
    // and is then indexed by an arbitrary operator name. A plain `{}` would
    // answer for every inherited `Object.prototype` member, so a head named
    // `toString` would read as a user override that the caller never wrote.
    // `Object.values` below is unaffected — it returns own properties only.
    const namedFunctions: { [k: string]: string } = Object.create(null);
    let preambleImports = '';

    if (functions) {
      for (const [k, entry] of Object.entries(functions)) {
        // `entrySource` unwraps the `{ source, pure? }` descriptor form as well
        // as the bare spellings. The `pure` half is not read here: purity buys
        // the NaN early exit in `BaseCompiler.isEmissionSkippable`, and this
        // target emits no such exit — its `Sum`/`Product` lowering has no
        // call site for it — so tracking it would be state nothing consults.
        const v = entrySource(entry);
        if (typeof v === 'function') {
          preambleImports += `const ${k} = ${v.toString()};\n`;
          namedFunctions[k] = k;
        } else if (typeof v === 'string') {
          namedFunctions[k] = v;
        }
      }
    }

    const target = this.createTarget({
      // The caller's requested compile mode; validated against
      // `supportedModes` (strict only here) by `BaseCompiler.compile`.
      mode: options.mode,
      // Constant folding is UNSOUND on this target, unconditionally: it bakes
      // a subtree's `.N()` value as a zero-width point, discarding the
      // outward-rounded enclosure the structural interval code computes. A
      // point for a value the doubles cannot represent exactly (`Ln(2)`) no
      // longer CONTAINS the true value — the guarantee this target exists to
      // provide. Number LITERALS in the source are exact by definition and
      // stay point intervals, as before.
      constantFold: false,
      // The names the caller pinned to runtime inputs. A symbol in this set is
      // a live input, not a value to bake: `BaseCompiler.closedFormIntegral`
      // declines to fold an `Integrate` that mentions one, and the
      // user-function resolution in `BaseCompiler` leaves such a name with the
      // caller's meaning rather than eta-expanding it. Populated on every other
      // executable target; its absence here left both behaviors silently
      // disabled for `interval-js` (`∫₀^k t dt` with `k` mapped still folded to
      // `k²/2`). The constant-fold consumer of this set is moot here — this
      // target sets `constantFold: false` unconditionally, just above.
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      // The names the caller re-mapped through the `functions` option. Such a
      // name emits code this compiler never sees, so a pass that rewrites,
      // binds or shares a subexpression must stop at it — here that is the
      // preamble constant hoist (`hoistIntervalConstants`), which would
      // otherwise hand the caller's function the same interval object at
      // every occurrence of a shared constant.
      foldExcludedOps:
        Object.keys(namedFunctions).length > 0
          ? new Set(Object.keys(namedFunctions))
          : undefined,
      // See `CompileTarget.unrollSkipHeads`: the same answer the entry above
      // used, for the definition bodies this entry never sees.
      unrollSkipHeads,
      unrollMinWidth: 1,
      unrollConstantLists: true,
      // The SOUND fold — evaluating a closed constant subtree's own interval
      // code at compile time (`foldConstantIntervalCode`) — is on by default
      // and honors the caller's `constantFold: false`, which promises the
      // structural lowering of every constant (codegen inspection).
      foldEmittedConstant:
        options.constantFold === false
          ? undefined
          : (_expr, code) =>
              foldConstantIntervalCode(
                code,
                false,
                intervalSpliceSources(target)
              ),
      constant: (id) => INTERVAL_JAVASCRIPT_CONSTANTS[id],
      functions: (id) =>
        namedFunctions?.[id] ? namedFunctions[id] : guardedIntervalFunction(id),
      var: (id) => {
        // Own-property test: a caller's `vars` map is a plain object, so
        // `in` finds `Object.prototype` members and a symbol named
        // `toString` would read the inherited FUNCTION as its spliced source.
        if (vars && Object.hasOwn(vars, id)) return vars[id] as string;
        const constant = INTERVAL_JAVASCRIPT_CONSTANTS[id];
        if (constant !== undefined) return constant;
        // See `varsObjectAccess` in `javascript-target.ts`: a name that
        // collides with an `Object.prototype` member needs an own-property
        // guard, or a missing symbol reads the inherited function.
        if (unknowns.includes(id)) {
          assertIntervalRealSymbol(expr.engine, id);
          return intervalVarsAccess(id);
        }
        // An assigned value / declared constant: returning `undefined` lets
        // BaseCompiler fold it (see the JavaScript target) rather than emitting
        // a bare, dangling reference for a symbol that `expr.unknowns` omits.
        if (expr.engine._getSymbolValue(id) !== undefined) return undefined;
        // No value: a genuinely free symbol, possibly reachable only through a
        // folded value (so absent from `unknowns`). Emit the vars-object lookup
        // rather than a bare, dangling reference.
        assertIntervalRealSymbol(expr.engine, id);
        return intervalVarsAccess(id);
      },
      preamble: (preamble ?? '') + preambleImports,
      // Opt in to compiling calls to user-defined function literals (`f(x) :=
      // …`) as named local functions collected into the preamble.
      userFunctions: { defs: new Map(), compiling: new Set() },
      // Root compilation boundary: fresh, deterministic numbering for the
      // generated temporaries (see the JavaScript target).
      naming: BaseCompiler.newNamingContext(expr, [
        preamble,
        preambleImports,
        ...Object.values(namedFunctions),
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // The compilation root: a user-function definition body compiles against
    // THIS target plus its own parameters, never against a nested requesting
    // one (see `CompileTarget.userFunctions.root`).
    target.userFunctions!.root = target;

    // A helper whose value is a LIST has no by-reference call on this target
    // (its definition would have to return a list). Substituting the body at
    // the call site exposes the list to the unroll, which writes it out:
    // `F(x, y)[1]` becomes an index into a written-out list, and
    // `Total(F(x, y) + G(x, y))` a sum of scalars. The registry the
    // substitution consults exists only now, so this second pass follows the
    // target's creation, and the unknowns are read again afterwards: a
    // callee body can read a global the root expression never named.
    expr = unrollFixedWidthCollections(
      BaseCompiler.inlineCollectionValuedCallsAtRoot(expr, target),
      unrollOptions
    );
    unknowns = expr.unknowns;

    // Common-subexpression elimination (design §4.2), on the same
    // post-`rewriteAngularUnit` tree the emitters walk. The G1b provenance
    // predicates come from the RAW options (this target has no `operators`
    // override channel — `operators` always resolves to `undefined` here).
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isOverriddenOperator: (name) =>
        Object.prototype.hasOwnProperty.call(namedFunctions, name),
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });

    const result = compileToIntervalTarget(expr, target);
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }
}

/**
 * Compile expression to interval JavaScript executable.
 */
function compileToIntervalTarget(
  expr: Expression,
  target: CompileTarget<Expression>
): CompilationResult<'interval-js', IntervalValue> {
  // One compilation begins here: start from an empty record of the
  // conditionals, whatever an earlier compilation against the same naming
  // context left behind (see `resetIntervalConditionals`).
  resetIntervalConditionals(target);
  let js: string;
  try {
    // A literal single point at the ROOT is the one collection-shaped value
    // this function builds itself: the JavaScript array of its compiled
    // coordinates. `literalRootPointOps` says which roots qualify and why the
    // spelling is confined to this position. Every other root, a point in an
    // operand position included, compiles through its ordinary lowering.
    const point = literalRootPointOps(expr, target);
    // A collection-BUILDING root (a list of numbers, a range, a `Map`) is the
    // other collection-shaped root this function spells itself, through the
    // same spelling every consuming position uses
    // (`compileIntervalCollectionValue`); a root that spelling declines — a
    // list of booleans — compiles the ordinary way, which refuses it.
    // A `Which` root is a collection root when one of its arms is spelled
    // as a collection (`compileIntervalSelectionValue`); a scalar selection
    // compiles through the `Which` handler as before.
    // A `WithRandomSeed` root is one when its body is a seeded list draw
    // (`seededRandomChoicePlan`); any other body compiles through the
    // `WithRandomSeed` handler as before.
    const rootLiteral = assignedLiteral(expr, target) ?? expr;
    const collectionRoot =
      point === undefined &&
      (COLLECTION_VALUE_HEADS.has(rootLiteral.operator) ||
        rootLiteral.operator === 'Which' ||
        (isFunction(rootLiteral, 'WithRandomSeed') &&
          isFunction(rootLiteral.ops[1], 'RandomChoice')));
    js =
      point !== undefined
        ? BaseCompiler.compileCseRoot(
            expr,
            target,
            0,
            () =>
              `[${point
                .map((c) => BaseCompiler.compileValueOperand(c, target))
                .join(', ')}]`
          )
        : collectionRoot
          ? BaseCompiler.compileCseRoot(
              expr,
              target,
              0,
              () =>
                compileIntervalCollectionValue(expr, target) ??
                BaseCompiler.compile(expr, target)
            )
          : BaseCompiler.compileCseRoot(expr, target);
  } catch (e) {
    // A cancellation that is not a timeout (an abort, an iteration or
    // recursion limit), or a timeout of an expired enclosing span, belongs
    // to the caller: it is thrown again, not reported as a failure
    // (docs/TIMEOUT-MODEL.md §2).
    throwIfCallerCancellation(e, expr.engine._deadlineFrame);
    // Expression contains operators/functions not supported by the interval
    // target. Report failure so the caller can fall back to another target,
    // preserving the reason so `compile()` can surface it (this path does not
    // throw, so the wrapper cannot recover the message otherwise).
    return {
      target: 'interval-js',
      success: false,
      code: '',
      error: (e as Error).message,
      diagnostic: compileDiagnosticOf(e),
      ...BaseCompiler.modeReport(),
    } as CompilationResult<'interval-js', IntervalValue>;
  }
  // Prepend any user-defined function definitions accumulated while compiling
  // `expr` (a symbol with a `Function`-literal definition used as an operator)
  // to the preamble so their named local functions are in scope.
  const userDefs = BaseCompiler.userFunctionsPreamble(target);
  // Bind every constant interval to a name, so the expression reads that name
  // instead of building the same object at each occurrence and on every call.
  // The declarations are evaluated once per artifact, in a scope that encloses
  // the per-call code, so the user-function definitions — which may read them —
  // still see them. In the reported text they go AFTER the caller's own
  // preamble (which this pass never rewrites) and BEFORE those definitions.
  const hoisted = hoistIntervalConstants(userDefs, js, target);
  const hoistedJs = hoisted.expression;
  // The condition temporaries of the closure-free conditional lowering
  // (`compileIntervalConditional`). Each is written and read back within one
  // ternary chain, before that chain evaluates any arm, so one binding per
  // name serves every call and every re-entry.
  const conditionVars = INTERVAL_CONDITION_VARS.get(
    BaseCompiler.namingContext(target)
  );
  const declarations = [
    conditionVars && conditionVars.length > 0
      ? `let ${conditionVars.join(', ')};`
      : '',
    hoisted.declarations,
  ]
    .filter((part) => part)
    .join('\n');
  const perCall = [target.preamble, hoisted.definitions]
    .filter((part) => part)
    .join('\n');
  const preamble = [target.preamble, declarations, hoisted.definitions]
    .filter((part) => part)
    .join('\n');
  const fn = new ComputeEngineIntervalFunction(
    hoistedJs,
    perCall,
    declarations
  );
  return {
    target: 'interval-js',
    success: true,
    code: hoistedJs,
    // `code` reads names the preamble binds — a hoisted constant, a
    // user-function definition — so the two halves are reported together
    // (`CompilationResult.preamble`). A reader that only takes `code` sees
    // undefined identifiers.
    ...(preamble ? { preamble } : {}),
    calling: 'expression',
    run: fn as unknown as CompiledRunner<IntervalValue, IntervalInput>,
  };
}
