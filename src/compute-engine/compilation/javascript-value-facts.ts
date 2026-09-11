import type { Expression, FunctionInterface } from '../global-types.js';
import {
  isFunction,
  isDictionary,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import type { CompileTarget } from './types.js';
import { isCallerMapped } from './cse.js';
import { POINT_CONSTRUCTOR_HEADS } from './provable-kind.js';
import { isSubtype } from '../../common/type/subtype.js';
import { resolveTypeForCompilation } from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';

type IntegerRange = { min: number; max: number };

// Each binder creates a new bound-variable set, even when it shadows the same
// name. Facts apply only in that exact scope; nested binders must prove their
// own ranges instead of accidentally inheriting a shadowed counter's bounds.
const loopRanges = new WeakMap<
  ReadonlySet<string>,
  Map<string, IntegerRange>
>();

export function clearIntegerRanges(target: CompileTarget<Expression>): void {
  if (target.boundVars) loopRanges.delete(target.boundVars);
}

export function recordIntegerRange(
  target: CompileTarget<Expression>,
  name: string,
  min: number,
  max: number
): void {
  if (
    !target.boundVars ||
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min > max
  )
    return;
  let ranges = loopRanges.get(target.boundVars);
  if (!ranges) loopRanges.set(target.boundVars, (ranges = new Map()));
  ranges.set(name, { min, max });
}

// How one bound-variable set was derived from the one that encloses it: the
// enclosing set, and the names this binder ADDS. `BaseCompiler.withBoundNames`
// records the link for every binder it builds a set for. A fact keyed on an
// enclosing set stays readable from inside a nested binder, while a name the
// nested binder rebinds stops at that frame instead of inheriting the outer
// fact.
const scopeParents = new WeakMap<
  ReadonlySet<string>,
  { parent: ReadonlySet<string> | undefined; added: ReadonlyArray<string> }
>();

export function recordScopeParent(
  child: ReadonlySet<string>,
  parent: ReadonlySet<string> | undefined,
  added: ReadonlyArray<string>
): void {
  scopeParents.set(child, { parent, added });
}

/**
 * The names the binder that built `scope` binds itself, or an empty array for
 * a set no binder recorded a link for.
 *
 * A caller that must know whether a scope crossing REBINDS a name cannot use
 * the set difference against the enclosing scope: a nested binder that binds
 * the same name as the one that encloses it (`Sum` over `i` inside a `Sum`
 * over `i`) builds a set with the same CONTENT, and the difference is empty
 * although the name was rebound.
 */
export function boundNamesAddedBy(
  scope: ReadonlySet<string> | undefined
): ReadonlyArray<string> {
  if (scope === undefined) return [];
  return scopeParents.get(scope)?.added ?? [];
}

// Names an emitted loop binds to the successive values of a `Range` whose
// start and step are FINITE numeric literals. Such a name holds
// `start + step · counter` on every turn, with `counter` a whole number the
// emitted loop itself produces, so it is a finite number at every read: it is
// never NaN, and never the `undefined` an absent caller variable reads as.
// That is what `isDecidedLoopIndex` is asked, and it is why a comparison
// against such a name needs no run-time decidedness test.
const decidedLoopIndices = new WeakMap<ReadonlySet<string>, Set<string>>();

/**
 * Record that, inside the body compiling under `target`, `name` is bound to
 * the successive values of a range whose start and step are finite literals.
 */
export function recordDecidedLoopIndex(
  target: CompileTarget<Expression>,
  name: string
): void {
  if (!target.boundVars) return;
  let names = decidedLoopIndices.get(target.boundVars);
  if (!names) decidedLoopIndices.set(target.boundVars, (names = new Set()));
  names.add(name);
}

export function clearDecidedLoopIndices(
  target: CompileTarget<Expression>
): void {
  if (target.boundVars) decidedLoopIndices.delete(target.boundVars);
}

/**
 * True when `name`, read under `boundVars`, is a loop index recorded by
 * {@link recordDecidedLoopIndex} — in this scope or in one that encloses it,
 * up to the frame that rebinds the name.
 */
export function isDecidedLoopIndex(
  name: string,
  boundVars: ReadonlySet<string> | undefined
): boolean {
  let scope = boundVars;
  while (scope !== undefined) {
    if (decidedLoopIndices.get(scope)?.has(name) === true) return true;
    const link = scopeParents.get(scope);
    // A frame that BINDS the name without recording it has shadowed whatever
    // an enclosing frame knew, so the search stops rather than reading a fact
    // about a different variable of the same name.
    if (link === undefined || link.added.includes(name)) return false;
    scope = link.parent;
  }
  return false;
}

// Scalar bindings established by emission: scalar function parameters,
// numeric counters and block locals whose assignments remain scalar. A new
// bound-variable set masks enclosing facts for every name it rebinds.
const scalarParams = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();

/**
 * Record bindings that hold a runtime scalar throughout this scope. Callers
 * prove that through the function's argument contract or its local writes.
 * See `isConstructedScalar` for how emission uses the fact.
 */
export function recordScalarParams(
  target: CompileTarget<Expression>,
  names: ReadonlySet<string>
): void {
  if (!target.boundVars || names.size === 0) return;
  scalarParams.set(target.boundVars, names);
}

/**
 * Is `name` a parameter of the emitted body this scope belongs to that holds
 * a run-time scalar? The fact is recorded on the bound-variable set of the
 * body's own frame, so a binder INSIDE that body — the `Sum` of
 * `f(x, y) := Σ … x …` — must be crossed to read it: every binder spreads a
 * fresh set, and reading the fact off that set alone answered "not a scalar"
 * for the enclosing function's own parameters. The whole rotation of the
 * Tycho noise kernel then broadcast inside its `Sum` while the same
 * expression outside one compiled as scalar arithmetic.
 *
 * The walk stops at a frame that BINDS the name itself, which is a different
 * variable of the same name — the same rule {@link isDecidedLoopIndex}
 * applies for the same reason.
 */
function isScalarParam(
  name: string,
  boundVars: ReadonlySet<string> | undefined
): boolean {
  let scope = boundVars;
  while (scope !== undefined) {
    if (scalarParams.get(scope)?.has(name) === true) return true;
    const link = scopeParents.get(scope);
    if (link === undefined || link.added.includes(name)) return false;
    scope = link.parent;
  }
  return false;
}

function builtin(expr: Expression, target: CompileTarget<Expression>): boolean {
  const options = target.cse?.harvestOptions;
  return (
    options !== undefined &&
    isFunction(expr) &&
    !isCallerMapped(expr, { ...options, shadowedNames: target.boundVars })
  );
}

/** Bounds on the actual safe integers produced by a small arithmetic expression. */
function integerRange(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): IntegerRange | undefined {
  if (depth > 32) return undefined;
  if (isNumber(expr))
    return expr.im === 0 && Number.isSafeInteger(expr.re)
      ? { min: expr.re, max: expr.re }
      : undefined;
  if (isSymbol(expr))
    return target.boundVars
      ? loopRanges.get(target.boundVars)?.get(expr.symbol)
      : undefined;
  if (!isFunction(expr) || !builtin(expr, target)) return undefined;
  if (!['Add', 'Subtract', 'Negate', 'Multiply'].includes(expr.operator))
    return undefined;
  const args = expr.ops.map((x) => integerRange(x, target, depth + 1));
  if (args.some((x) => x === undefined)) return undefined;
  const ranges = args as IntegerRange[];
  let result: IntegerRange;
  if (expr.operator === 'Negate' && ranges.length === 1)
    result = { min: -ranges[0].max, max: -ranges[0].min };
  else if (expr.operator === 'Subtract' && ranges.length === 2)
    result = {
      min: ranges[0].min - ranges[1].max,
      max: ranges[0].max - ranges[1].min,
    };
  else if (expr.operator === 'Add' || expr.operator === 'Multiply') {
    const multiply = expr.operator === 'Multiply';
    result = { min: multiply ? 1 : 0, max: multiply ? 1 : 0 };
    for (const r of ranges) {
      if (multiply) {
        const products = [
          result.min * r.min,
          result.min * r.max,
          result.max * r.min,
          result.max * r.max,
        ];
        result = { min: Math.min(...products), max: Math.max(...products) };
      } else result = { min: result.min + r.min, max: result.max + r.max };
      if (
        !Number.isSafeInteger(result.min) ||
        !Number.isSafeInteger(result.max)
      )
        return undefined;
    }
  } else return undefined;
  return Number.isSafeInteger(result.min) && Number.isSafeInteger(result.max)
    ? result
    : undefined;
}

/** A compiler-owned array whose cells cannot be nullish or externally supplied. */
function numericArray(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): boolean {
  if (depth > 32) return false;
  if (isSymbol(expr)) {
    if (target.boundVars?.has(expr.symbol) || target.varsKeys?.has(expr.symbol))
      return false;
    const value = expr.engine._getSymbolValue(expr.symbol);
    return value !== undefined && numericArray(value, target, depth + 1);
  }
  return (
    isFunction(expr, 'List') &&
    builtin(expr, target) &&
    expr.ops.every((x) => isNumber(x) && x.im === 0)
  );
}

export function canIndexArrayDirectly(
  coll: Expression,
  index: Expression,
  target: CompileTarget<Expression>
): boolean {
  const range = integerRange(index, target);
  return range !== undefined && range.min > 0 && numericArray(coll, target);
}

/**
 * The cells of the compiler-owned array `coll` denotes, when `coll` is a list
 * of real number literals or a symbol whose engine value is one — the same
 * walk `numericArray` makes, which the caller must have already accepted.
 * `undefined` when the walk finds no such list.
 *
 * The generated code that reads a cell of this list BAKES the symbol's current
 * value, so every symbol the walk goes through is added to the capture set the
 * caller records (`CompileTarget.symbolDeps`, the implicit-compilation cache
 * key). Without that record a cached kernel would keep serving the baked cell
 * after the symbol was reassigned.
 */
export function numericArrayCells(
  coll: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): ReadonlyArray<Expression> | undefined {
  if (depth > 32) return undefined;
  if (isSymbol(coll)) {
    if (target.boundVars?.has(coll.symbol) || target.varsKeys?.has(coll.symbol))
      return undefined;
    const value = coll.engine._getSymbolValue(coll.symbol);
    if (value === undefined) return undefined;
    const cells = numericArrayCells(value, target, depth + 1);
    if (cells !== undefined) target.symbolDeps?.add(coll.symbol);
    return cells;
  }
  if (
    !isFunction(coll, 'List') ||
    !builtin(coll, target) ||
    !coll.ops.every((x) => isNumber(x) && x.im === 0)
  )
    return undefined;
  return coll.ops;
}

/** A scalar constructed from numeric literals, compiler-owned counters and
 * scalar arithmetic, from an explicitly declared scalar runtime input, or
 * from a parameter of the emitted body this expression belongs to whose
 * function binds no argument whole. An INPUT whose scalar type is merely
 * inferred remains eligible for runtime broadcasting; a body PARAMETER does
 * not, because its every call site is broadcast-aware. */
export function isConstructedScalar(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): boolean {
  if (depth > 32) return false;
  if (isNumber(expr)) return true;
  if (isSymbol(expr)) {
    if (integerRange(expr, target) !== undefined) return true;
    // A parameter of the emitted body this expression belongs to, when no
    // parameter of that function binds a collection, a tuple or a point whole
    // (user rulings 2026-09-08 and 2026-09-09). The parameter's own type does
    // not matter — `unknown` counts, which is what an unannotated parameter
    // gets. Every emitted call of such a function hands that parameter a
    // scalar: a call whose argument is not provably one is dispatched
    // element-wise (`_SYS.bcastFn`) or guarded by `Array.isArray`, so the
    // body sees one element; the only call form that passes an argument
    // straight through is the one an explicit caller declaration already
    // exempts. A function with a collection parameter records nothing,
    // because such a body may receive a list whole. Recorded by the emission
    // (`BaseCompiler.recordScalarParams`).
    if (isScalarParam(expr.symbol, target.boundVars)) return true;
    // A caller's explicit declaration is the input contract. A type inferred
    // from use in a scalar parameter is not such a promise. Local binders and
    // caller mappings have their own representations and do not inherit it.
    // A symbol that HOLDS a value compiles to that value, so it is the
    // value's shape that decides: a number (a library constant such as
    // `Pi`, or `t_0 := 2.855`) is a scalar; any other held value — a
    // collection, a symbolic expression — is not judged here.
    const held = expr.engine._getSymbolValue(expr.symbol);
    // Retained helper bodies may predate the caller's input declarations.
    // A free symbol emits the current runtime input accessor, so use that
    // input's current explicit contract rather than its old inferred type.
    const current = expr.engine.lookupDefinition(expr.symbol);
    const definition = isValueDef(current)
      ? current.value
      : expr.valueDefinition;
    return (
      !target.boundVars?.has(expr.symbol) &&
      !target.varsKeys?.has(expr.symbol) &&
      definition?.inferredType === false &&
      (held === undefined ? true : isNumber(held)) &&
      ['number', 'boolean', 'string'].some((t) =>
        isSubtype(definition.type.type, t as 'number' | 'boolean' | 'string')
      )
    );
  }
  if (!isFunction(expr) || !builtin(expr, target)) return false;
  // A scalar read off a constructed POINT — the inner product of two points,
  // a coordinate, a norm — is a constructed scalar too. Decided with an
  // empty walk, so every leaf is held to this function's own input contract.
  if (
    scalarOverPoints(expr, target, freshWalk(), depth) ||
    (SCALAR_ARITHMETIC_HEADS.includes(expr.operator) &&
      expr.ops.every((arg) => isConstructedScalar(arg, target, depth + 1)))
  )
    return true;
  return isScalarUserFunctionCall(expr, target, depth);
}

/** The scalar heads whose application to constructed scalars is itself a
 * constructed scalar. Every one of them maps scalars to a scalar. */
const SCALAR_ARITHMETIC_HEADS = [
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Power',
  'Square',
  'Sin',
  'Cos',
  'Tan',
  'Exp',
  'Ln',
  'Sqrt',
  'Abs',
  'Floor',
  'Ceil',
  'Round',
  'Sign',
  'Min',
  'Max',
];

/**
 * The `["Function", body, …params]` literal an engine-defined symbol holds,
 * through either storage route: an operator definition backed by a lambda
 * keeps it as `_lambdaLiteral`, a plain symbol holds it as its value.
 *
 * Mirrors `BaseCompiler.userFunctionLiteral`, which cannot be imported here:
 * `base-compiler.ts` imports this module, so the reverse edge would be a
 * module cycle, and the compilation tree has a zero-cycle budget.
 */
function userFunctionLiteral(
  expr: Expression,
  id: string
): (Expression & FunctionInterface) | undefined {
  const def = expr.engine.lookupDefinition(id);
  if (def && 'operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (literal !== undefined && isFunction(literal, 'Function'))
      return literal;
  }
  const value = expr.engine._getSymbolValue(id);
  if (value !== undefined && isFunction(value, 'Function')) return value;
  return undefined;
}

/** Is `t` a type whose values are single numbers, booleans or strings — never
 * an array at run time? A top type (`unknown`/`any`/`value`) says nothing at
 * all and is not evidence; `never` is a subtype of everything and is not
 * evidence either. */
function isScalarResultType(t: Type): boolean {
  const r = resolveTypeForCompilation(t);
  if (r === 'unknown' || r === 'any' || r === 'value' || r === 'never')
    return false;
  return (
    isSubtype(r, 'number') || isSubtype(r, 'boolean') || isSubtype(r, 'string')
  );
}

/**
 * Does `expr` yield a single scalar when every parameter in scope holds a
 * scalar? The question the user-function result oracle below asks of a
 * callee's BODY.
 *
 * The hypothesis covers the body's OWN parameters only. Every other leaf must
 * carry its own evidence:
 *
 *  - a number literal is a scalar;
 *  - a free symbol is a scalar only when `isConstructedScalar` says so — an
 *    explicitly declared scalar input, or a compiler-owned counter. A symbol
 *    whose numeric type was INFERRED is not evidence: the caller may still
 *    hand it a list at run time, and the emission broadcasts over it. The
 *    static type alone would accept it, which is why the type shortcut below
 *    is not applied to a symbol.
 *
 * A body whose type is TOP is not thereby a collection, so three shapes are
 * opened up instead of refused:
 *
 *  - a `Block`, whose value is its last statement;
 *  - an `If` or a `Which` (the canonical form of a `\begin{cases}`
 *    piecewise), whose value is one of its arms;
 *  - a call of another user-defined function, whose value is that callee's
 *    body under the same hypothesis — provided each argument is scalar under
 *    it too. That argument test is what refuses `f(t) := g([t, 2t])`: the
 *    emitted call broadcasts a list argument element-wise and answers a list,
 *    whatever `g` returns for one element.
 *
 * For a function head, whether the static type is evidence at all depends on
 * how the head treats an array operand — see `headShape`. A BROADCASTING head
 * answers an array whenever an operand holds one, whatever its declared
 * result type says, so each operand must be proved scalar; only a head that
 * cannot pass an array through — a reduction such as `Sum(L)`, `Length(L)` or
 * `Min(L)`, which answers one number for any operand — is described by its
 * result type.
 *
 * `walk.visiting` holds the callees whose body is being examined, so a
 * recursive (or mutually recursive) function answers `false` rather than
 * looping, and `walk.shadowed` holds their parameter names, so a call whose
 * head is one of those names is never read as the same-named engine global.
 */
function scalarShapedValue(
  expr: Expression,
  target: CompileTarget<Expression>,
  walk: BodyWalk,
  depth: number
): boolean {
  if (depth > 32) return false;
  if (isNumber(expr)) return true;
  if (isSymbol(expr)) {
    if (walk.locals.has(expr.symbol))
      return walk.locals.get(expr.symbol) === 'scalar';
    // A parameter hypothesised to hold a POINT is an array, never a scalar.
    if (walk.points.has(expr.symbol)) return false;
    return (
      walk.shadowed.has(expr.symbol) ||
      isConstructedScalar(expr, target, depth + 1)
    );
  }
  if (!isFunction(expr) || !builtin(expr, target)) return false;
  const scalarOperand = (a: Expression) =>
    scalarShapedValue(a, target, walk, depth + 1);
  if (expr.operator === 'Block')
    return blockValueKind(expr.ops, target, walk, depth) === 'scalar';
  const arms = valueArms(expr);
  if (arms !== undefined) return arms.every(scalarOperand);
  // A scalar read off a point (`scalarOverPoints`), and a sum or product over
  // an index whose body is a scalar: both answer one number whatever their
  // static type says, and neither is a broadcast over its operands.
  if (scalarOverPoints(expr, target, walk, depth)) return true;
  if (
    (expr.operator === 'Sum' || expr.operator === 'Product') &&
    indexedReductionIsScalar(expr, target, walk, depth)
  )
    return true;
  const shape = headShape(expr, target, walk);
  // A local binding, a caller `vars` entry or a callee already open on this
  // walk: none of them is a value this module can read.
  if (shape === 'opaque') return false;
  if (shape === 'broadcast') {
    // A USER-defined callee decides its own arguments: one of them may be a
    // POINT, which the body consumes whole and reduces to a number — the
    // lattice hash `p_rand((⌊x⌋, ⌊y⌋, s))` is one value, not three.
    // Demanding a scalar in every argument position refused such a call here,
    // before its body was ever read, and every arithmetic head above it then
    // lowered to a run-time broadcast.
    if (isUserFunctionHead(expr))
      return scalarShapedCall(expr, target, scalarOperand, walk, depth);
    // A BUILT-IN broadcastable head maps element-wise, so it answers an array
    // whenever an operand holds one: every operand must be a scalar for the
    // result to be one.
    return expr.ops.every(scalarOperand);
  }
  if (isScalarResultType(expr.type.type)) return true;
  if (SCALAR_ARITHMETIC_HEADS.includes(expr.operator))
    return expr.ops.every(scalarOperand);
  return false;
}

/** Is the head of `expr` an engine-defined function whose body this module can
 * read? The head may still be shadowed; `headShape` tests that first. */
function isUserFunctionHead(expr: Expression & FunctionInterface): boolean {
  return userFunctionLiteral(expr, expr.operator) !== undefined;
}

/**
 * How the emission of `expr`'s head passes an ARRAY operand through to its
 * result.
 *
 *  - `opaque`: the head names a local binder, a caller `vars` entry, a
 *    block-local function or a callee already open on this walk. Each of
 *    those is a different value with a different emission, and none of them
 *    is readable here.
 *  - `broadcast`: the head maps element-wise, so an array operand gives an
 *    array result whatever the static result type says. Both a built-in
 *    `broadcastable` head and a user-defined function are of this kind: the
 *    emitted call of a user function dispatches an array argument through
 *    `_SYS.bcastFn`.
 *  - `reduction`: every other head. Its result shape is what its static type
 *    says, because no operand shape reaches the result.
 */
function headShape(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  walk: BodyWalk
): 'opaque' | 'broadcast' | 'reduction' {
  const h = expr.operator;
  if (
    target.boundVars?.has(h) ||
    target.varsKeys?.has(h) ||
    target.localFunctions?.has(h) ||
    walk.locals.has(h) ||
    walk.shadowed.has(h) ||
    walk.visiting.has(h)
  )
    return 'opaque';
  if (isUserFunctionHead(expr)) return 'broadcast';
  const def = expr.engine.lookupDefinition(h);
  return isOperatorDef(def) && def.operator.broadcastable === true
    ? 'broadcast'
    : 'reduction';
}

/** A body walk tracks open callees to stop recursion, parameter hypotheses,
 * and the values assigned to block locals. An unknown local still masks an
 * enclosing parameter or runtime input of the same name. */
type ValueKind = 'scalar' | number | undefined;

type BodyWalk = {
  locals: Map<string, ValueKind>;
  visiting: Set<string>;
  shadowed: Set<string>;
  points: Map<string, number>;
  /** Whether a DECLARED point input (`P: tuple<number, number>` read from
   * the caller's `vars`) counts as a point of its declared width. The shape
   * questions trust the declaration; the run-time guard question
   * (`provenPointWidth`) does not, because a caller may put anything in
   * `vars`. */
  inputsProven: boolean;
};

/** A walk with nothing open: every leaf is judged by the input contract. */
function freshWalk(inputsProven = true): BodyWalk {
  return {
    locals: new Map(),
    visiting: new Set(),
    shadowed: new Set(),
    points: new Map(),
    inputsProven,
  };
}

/**
 * The width of `expr` when the code this compiler emits for it is an array
 * of that many scalars BY CONSTRUCTION — a point or list constructor with
 * that many operands, or a value the point analysis proves a point — and
 * `undefined` otherwise. A declared point INPUT does not qualify: its width
 * is a declaration the caller may violate through `vars`, so it keeps the
 * run-time shape test. The component fan-out and the static inner product
 * (`base-compiler.ts`) read a qualifying operand by index with no test.
 */
export function provenPointWidth(
  expr: Expression,
  target: CompileTarget<Expression>
): number | undefined {
  if (
    isFunction(expr) &&
    builtin(expr, target) &&
    ARRAY_LITERAL_HEADS.has(expr.operator) &&
    expr.ops.length > 0 &&
    !expr.ops.some((op) => emitsSequenceSpread(op, target))
  )
    return expr.ops.length;
  return pointShapedValue(expr, target, freshWalk(false), 0);
}

/**
 * The constructor heads whose emitted JavaScript is ONE array literal holding
 * exactly one element per operand, so the operand count is the run-time width.
 *
 * `PointList` builds points but is deliberately absent:
 * `PointList([1,2,3], [10,20])` is a LIST OF POINTS, and the array it emits
 * holds one array per point — the shortest zip of its source components,
 * whose length has nothing to do with the operand count. A `PointList` whose
 * every component is a scalar IS a single point, and the slow path
 * (`pointShapedValue`, which tests each component) proves that case.
 */
const ARRAY_LITERAL_HEADS = new Set(['List', 'Tuple', 'Pair', 'Triple']);

/**
 * Does the emitted code SPLICE `op` into the array literal that holds it, so
 * that it contributes an unknown number of elements instead of one? The list
 * and tuple emitters spread a name bound to a REST sequence
 * (`spreadIfSequence`, `javascript-target.ts`), so `List(a, rest)` can emit
 * `[a, ...t]`, whose run-time length is not 2.
 *
 * The condition mirrors that emitter exactly: the name must be one the target
 * records as a sequence AND must still resolve to the recorded accessor. A
 * nested binder that shadows the name resolves it elsewhere, and the value it
 * then holds is not a sequence.
 */
function emitsSequenceSpread(
  op: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isSymbol(op)) return false;
  const accessor = target.sequenceVars?.get(op.symbol);
  return accessor !== undefined && accessor === target.var(op.symbol);
}

/** The heads that read one scalar off a single point: a coordinate, and the
 * norm (`Abs` of a tuple IS its norm in the interpreter). */
const POINT_TO_SCALAR_HEADS = new Set([
  'PointX',
  'PointY',
  'PointZ',
  'Norm',
  'Abs',
]);

/**
 * Is `expr` a scalar read off constructed POINTS — the inner product of two
 * points of one width, or a coordinate or the norm of one point? A point is a
 * JavaScript array at run time, so the scalar heads around it must not read
 * it as a number; but these heads consume the whole point and answer one
 * number, exactly as the interpreter does. Every other shape answers `false`
 * and leaves the decision to the caller's remaining rules.
 */
function scalarOverPoints(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  walk: BodyWalk,
  depth: number
): boolean {
  const h = expr.operator;
  const ops = expr.ops;
  const point = (a: Expression) => pointShapedValue(a, target, walk, depth + 1);
  if (h === 'Dot' && ops.length === 2) {
    const width = point(ops[0]);
    return width !== undefined && point(ops[1]) === width;
  }
  if (POINT_TO_SCALAR_HEADS.has(h) && ops.length === 1)
    return point(ops[0]) !== undefined;
  return false;
}

/**
 * Bind `names` into the walk as the parameters (or indices) of the body about
 * to be examined, and answer the function that puts the enclosing state back.
 *
 * A bound name is a DIFFERENT variable from anything an enclosing frame holds
 * under that name, so it must shadow BOTH hypothesis sets: a name left in
 * `walk.points` would answer the enclosing point's width for what is really a
 * scalar, and `Norm(i)` or `Dot(i, i)` would then be admitted as a scalar read
 * off a point.
 *
 * The enclosing state of each DISTINCT name is saved once, before any write.
 * Saving it as each name is bound would let a repeated name (`f(x, x)`, which
 * nothing here rejects) save the state its own first binding had just
 * installed, and the restore would then leave a hypothesis behind.
 */
function bindWalkNames(
  walk: BodyWalk,
  names: ReadonlyArray<string>,
  kindOf: (index: number) => 'scalar' | number
): () => void {
  const saved = new Map<
    string,
    {
      scalar: boolean;
      point: number | undefined;
      local: boolean;
      kind: ValueKind;
    }
  >();
  for (const n of names)
    if (!saved.has(n))
      saved.set(n, {
        scalar: walk.shadowed.has(n),
        point: walk.points.get(n),
        local: walk.locals.has(n),
        kind: walk.locals.get(n),
      });
  names.forEach((n, i) => {
    walk.locals.delete(n);
    const kind = kindOf(i);
    if (kind === 'scalar') {
      walk.points.delete(n);
      walk.shadowed.add(n);
    } else {
      walk.shadowed.delete(n);
      walk.points.set(n, kind);
    }
  });
  return () => {
    for (const [n, state] of saved) {
      if (state.local) walk.locals.set(n, state.kind);
      else walk.locals.delete(n);
      if (state.scalar) walk.shadowed.add(n);
      else walk.shadowed.delete(n);
      if (state.point !== undefined) walk.points.set(n, state.point);
      else walk.points.delete(n);
    }
  };
}

/**
 * Is `expr` a `Sum` or `Product` over one or more `Limits(index, lo, hi)`
 * whose bounds are scalars and whose body is a scalar once each index is
 * bound as one? Such a reduction answers one number. A `Sum` over a
 * collection (no `Limits`), or a `Limits` with a non-symbol index, answers
 * `false`.
 */
function indexedReductionIsScalar(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  walk: BodyWalk,
  depth: number
): boolean {
  const ops = expr.ops;
  if (ops.length < 2) return false;
  const indices: string[] = [];
  for (const limits of ops.slice(1)) {
    if (!isFunction(limits, 'Limits') || !isSymbol(limits.ops[0])) return false;
    if (
      !limits.ops
        .slice(1)
        .every((b) => scalarShapedValue(b, target, walk, depth + 1))
    )
      return false;
    indices.push(limits.ops[0].symbol);
  }
  // Each index is a scalar for the body walk, and it shadows whatever an
  // enclosing frame holds under that name (`bindWalkNames`).
  const restore = bindWalkNames(walk, indices, () => 'scalar');
  try {
    return scalarShapedValue(ops[0], target, walk, depth + 1);
  } finally {
    restore();
  }
}

/**
 * The width of `expr` when it is a POINT — a numeric tuple, a JavaScript array
 * of that many scalars at run time — and `undefined` when that is not proved.
 * The point twin of `scalarShapedValue`, under the same input contract:
 *
 *  - a parameter hypothesised to hold a point has that width;
 *  - a declared point input (`P: tuple<number, number>`) has the width its
 *    type lists, on the same terms as a declared scalar input
 *    (`constructedPointWidth`);
 *  - a point constructor over scalars has one coordinate per operand;
 *  - a block or piecewise whose arms are all points of one width has it;
 *  - the point arithmetic the interpreter computes coordinate by coordinate
 *    keeps the width: a sum of points, a negated point, a point scaled by a
 *    scalar, a point divided by or raised to a scalar. A point summed with a
 *    scalar is an `incompatible-type` error there and is not a point here;
 *  - a call of a user-defined function whose body is a point under the
 *    arguments' kinds.
 */
function pointShapedValue(
  expr: Expression,
  target: CompileTarget<Expression>,
  walk: BodyWalk,
  depth: number
): number | undefined {
  if (depth > 32) return undefined;
  if (isSymbol(expr)) {
    if (walk.locals.has(expr.symbol)) {
      const kind = walk.locals.get(expr.symbol);
      return typeof kind === 'number' ? kind : undefined;
    }
    const hypothesis = walk.points.get(expr.symbol);
    if (hypothesis !== undefined) return hypothesis;
    if (walk.shadowed.has(expr.symbol) || !walk.inputsProven) return undefined;
    return constructedPointWidth(expr, target);
  }
  if (!isFunction(expr) || !builtin(expr, target)) return undefined;
  const h = expr.operator;
  const ops = expr.ops;
  const scalar = (a: Expression) =>
    scalarShapedValue(a, target, walk, depth + 1);
  const point = (a: Expression) => pointShapedValue(a, target, walk, depth + 1);
  if (POINT_CONSTRUCTOR_HEADS.has(h))
    return ops.length > 0 && ops.every(scalar) ? ops.length : undefined;
  if (h === 'Block') {
    const kind = blockValueKind(ops, target, walk, depth);
    return typeof kind === 'number' ? kind : undefined;
  }
  const arms = valueArms(expr);
  if (arms !== undefined) return commonWidth(arms.map(point));
  if (h === 'Add')
    return ops.length > 0 ? commonWidth(ops.map(point)) : undefined;
  if (h === 'Negate') return ops.length === 1 ? point(ops[0]) : undefined;
  if (h === 'Multiply') {
    let width: number | undefined;
    for (const op of ops) {
      if (scalar(op)) continue;
      const w = point(op);
      if (w === undefined || width !== undefined) return undefined;
      width = w;
    }
    return width;
  }
  if ((h === 'Divide' || h === 'Power') && ops.length === 2)
    return scalar(ops[1]) ? point(ops[0]) : undefined;
  if (isUserFunctionHead(expr)) {
    const kind = userCallKind(
      expr,
      target,
      (a) => (scalar(a) ? 'scalar' : point(a)),
      walk,
      depth
    );
    return typeof kind === 'number' ? kind : undefined;
  }
  return undefined;
}

/** One width shared by every entry, or `undefined` when an entry is not a
 * point or the widths differ. */
function commonWidth(
  widths: ReadonlyArray<number | undefined>
): number | undefined {
  if (widths.length === 0 || widths.some((w) => w === undefined))
    return undefined;
  return widths.every((w) => w === widths[0]) ? widths[0] : undefined;
}

/** The width of a declared POINT runtime input — a symbol whose explicitly
 * declared type is a tuple of numbers — on the same terms as the declared
 * scalar input of `isConstructedScalar`: the declaration is the caller's
 * input contract, an inferred type is not. */
function constructedPointWidth(
  expr: Expression & { readonly symbol: string },
  target: CompileTarget<Expression>
): number | undefined {
  if (
    target.boundVars?.has(expr.symbol) ||
    target.varsKeys?.has(expr.symbol) ||
    expr.valueDefinition?.inferredType !== false ||
    expr.engine._getSymbolValue(expr.symbol) !== undefined
  )
    return undefined;
  const t = resolveTypeForCompilation(expr.type.type);
  if (typeof t === 'string' || t.kind !== 'tuple') return undefined;
  return t.elements.every((el) => isSubtype(el.type, 'number'))
    ? t.elements.length
    : undefined;
}

/** Read a straight-line block in statement order. Only assignments to its
 * own declared locals are admitted; control flow and escaping writes decline.
 * `stable` retains facts valid at every assignment, for whole-body emission. */
function blockValueKind(
  statements: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  outer: BodyWalk,
  depth: number,
  stable?: Map<string, ValueKind>
): ValueKind {
  if (depth > 32) return undefined;
  const stmts = statements.filter((x) => !isSymbol(x, 'Nothing'));
  const names = new Set<string>();
  for (const stmt of stmts) {
    if (!isFunction(stmt, 'Declare')) continue;
    if (!isSymbol(stmt.ops[0])) return undefined;
    names.add(stmt.ops[0].symbol);
  }
  const walk = { ...outer, locals: new Map(outer.locals) };
  for (const name of names) walk.locals.set(name, undefined);
  const facts = new Map<string, ValueKind>();
  const kindOf = (value: Expression): ValueKind =>
    scalarShapedValue(value, target, walk, depth + 1)
      ? 'scalar'
      : pointShapedValue(value, target, walk, depth + 1);
  // Nested blocks may write their own locals, but may not mutate a fact
  // carried by this block. Function literals and control transfers need a
  // separate flow analysis and deliberately keep the generic emission.
  const safe = (value: Expression, locals = new Set<string>()): boolean => {
    if (isSymbol(value))
      return (
        !target.varsKeys?.has(value.symbol) &&
        !target.cse?.harvestOptions?.isStringVar?.(value.symbol)
      );
    if (!isFunction(value)) return true;
    // Caller-supplied code can mutate a local even from a condition whose
    // value does not contribute to the block's result.
    if (!builtin(value, target)) return false;
    const h = value.operator;
    if (['Function', 'Loop', 'Return', 'Break', 'Continue'].includes(h))
      return false;
    if (target.localFunctions?.has(h) || walk.locals.has(h)) return false;
    if (h === 'Block') {
      const own = new Set(locals);
      for (const stmt of value.ops)
        if (isFunction(stmt, 'Declare') && isSymbol(stmt.ops[0]))
          own.add(stmt.ops[0].symbol);
      return value.ops.every((op) => safe(op, own));
    }
    if (h === 'Assign' || h === 'Declare') {
      if (!isSymbol(value.ops[0]) || !locals.has(value.ops[0].symbol))
        return false;
    }
    return value.ops.every((op) => safe(op, locals));
  };
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (isFunction(stmt, 'Declare') || isFunction(stmt, 'Assign')) {
      if (!isSymbol(stmt.ops[0]) || !names.has(stmt.ops[0].symbol))
        return undefined;
      let value: Expression | undefined;
      if (stmt.operator === 'Assign') {
        if (stmt.ops.length !== 2) return undefined;
        value = stmt.ops[1];
      } else {
        let rest = stmt.ops.slice(1);
        const last = rest[rest.length - 1];
        let attrsValue: Expression | undefined;
        if (last !== undefined && isDictionary(last)) {
          attrsValue = last.get('value');
          rest = rest.slice(0, -1);
        }
        value = rest[1] ?? attrsValue;
      }
      if (value === undefined) continue;
      if (!safe(value)) return undefined;
      const name = stmt.ops[0].symbol;
      const kind = kindOf(value);
      walk.locals.set(name, kind);
      facts.set(
        name,
        !facts.has(name) || facts.get(name) === kind ? kind : undefined
      );
      // A final declaration/assignment is not a value expression.
      if (i === stmts.length - 1) return undefined;
    } else {
      if (i !== stmts.length - 1 || !safe(stmt)) return undefined;
      const result = kindOf(stmt);
      if (stable) for (const [name, kind] of facts) stable.set(name, kind);
      return result;
    }
  }
  return undefined;
}

/** Publish only scalar local facts that hold throughout this block. A fresh
 * bound-variable scope keeps them from escaping or surviving a rebinding. */
export function recordBlockScalarLocals(
  statements: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  const stable = new Map<string, ValueKind>();
  blockValueKind(statements, target, freshWalk(), 0, stable);
  recordScalarParams(
    target,
    new Set(
      [...stable].filter(([, kind]) => kind === 'scalar').map(([name]) => name)
    )
  );
}

/** The value arms of an `If` or `Which`. Blocks need statement-order
 * analysis through `blockValueKind` instead. */
function valueArms(
  expr: Expression & FunctionInterface
): ReadonlyArray<Expression> | undefined {
  const ops = expr.ops;
  if (expr.operator === 'If') return ops.slice(1);
  if (expr.operator === 'Which') return ops.filter((_op, i) => i % 2 === 1);
  return undefined;
}

/**
 * The shared body of the two user-function-call questions: is `expr` a call of
 * an engine-defined function whose result is a scalar? `scalarArgument`
 * decides what "a scalar argument" means at this level — the caller's input
 * contract at a top-level call site, the scalar-parameter hypothesis inside a
 * body.
 *
 * The callee must be resolvable to a single `Function` literal in the engine
 * and must not be shadowed by a local binder, a caller `vars` entry, a
 * block-local declaration or a parameter of a body this walk has entered:
 * each of those is a different value with a different emission, and none of
 * them is the literal read here.
 */
function scalarShapedCall(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  scalarArgument: (a: Expression) => boolean,
  walk: BodyWalk,
  depth: number
): boolean {
  return (
    userCallKind(
      expr,
      target,
      (a) =>
        scalarArgument(a)
          ? 'scalar'
          : pointShapedValue(a, target, walk, depth + 1),
      walk,
      depth
    ) === 'scalar'
  );
}

/**
 * The kind of value a call of user function `expr` yields — `'scalar'`, the
 * width of a point, or `undefined` when neither is proved — given each
 * argument's kind under `argumentKind` (`undefined` for an argument of no
 * proved kind, which refuses the call: the emitted call broadcasts a list
 * argument element-wise and answers a list, whatever the body returns for
 * one element).
 *
 * A call whose arguments are all scalars is the memoized question
 * `userFunctionResultIsScalar` answers; a call with a POINT argument binds
 * that parameter as a point of the argument's width for the body walk and is
 * decided afresh each time (the memo is keyed on the callee alone, so it
 * cannot hold an answer that depends on the arguments' kinds).
 */
function userCallKind(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  argumentKind: (a: Expression) => 'scalar' | number | undefined,
  walk: BodyWalk,
  depth: number
): 'scalar' | number | undefined {
  const h = expr.operator;
  if (
    target.boundVars?.has(h) ||
    target.varsKeys?.has(h) ||
    target.localFunctions?.has(h) ||
    walk.locals.has(h) ||
    walk.shadowed.has(h) ||
    walk.visiting.has(h)
  )
    return undefined;
  const literal = userFunctionLiteral(expr, h);
  if (literal === undefined || literal.ops.length < 1) return undefined;
  const kinds = expr.ops.map(argumentKind);
  if (kinds.some((k) => k === undefined)) return undefined;
  if (
    kinds.every((k) => k === 'scalar') &&
    userFunctionResultIsScalar(h, literal, target, walk, depth)
  )
    return 'scalar';
  // Not a scalar under these kinds: the body may still be a POINT, which the
  // walk below decides with the parameters bound to the arguments' kinds.
  const params = literal.ops.slice(1).map((p) => parameterName(p));
  if (params.length !== kinds.length || params.some((n) => n === undefined))
    return undefined;
  const root = target.userFunctions?.root;
  walk.visiting.add(h);
  // Each parameter takes the kind of the argument at its position, and
  // shadows whatever an enclosing frame holds under that name
  // (`bindWalkNames`).
  const restore = bindWalkNames(
    walk,
    params as ReadonlyArray<string>,
    (i) => kinds[i]!
  );
  try {
    const body = literal.ops[0];
    const t = root ?? target;
    const bodyWalk = { ...walk, locals: new Map<string, ValueKind>() };
    if (scalarShapedValue(body, t, bodyWalk, depth + 1)) return 'scalar';
    return pointShapedValue(body, t, bodyWalk, depth + 1);
  } finally {
    walk.visiting.delete(h);
    restore();
  }
}

/**
 * Does the body of user function `h` yield a scalar under scalar parameters?
 * Memoized for the whole compilation on the user-function registry, mirroring
 * the per-function shape fact `userFunctions.complexShaped` already records.
 *
 * The memo is keyed on the callee name alone, so the walk must read no fact
 * of the CALLING scope — a caller's bound names or block-local functions
 * would otherwise decide an answer that a later call site reuses under
 * different names. The body is therefore examined against the registry ROOT
 * target, which is the target the emitted definition itself compiles against
 * (`BaseCompiler.ensureUserFunctionEmitted`): it carries the compilation's
 * own `vars` and folding rules and none of the caller's bound names. The
 * body's own parameters are supplied separately, through `walk.shadowed`.
 * Without a root the walk falls back to the requesting target and the answer
 * is not memoized.
 */
function userFunctionResultIsScalar(
  h: string,
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  walk: BodyWalk,
  depth: number
): boolean {
  const registry = target.userFunctions;
  const cached = registry?.scalarShaped?.get(h);
  if (cached !== undefined) return cached;
  const root = registry?.root;
  walk.visiting.add(h);
  // The body binds these names as SCALARS — that is the question this
  // function asks — and a call of one of them inside the body denotes that
  // binding, never the same-named engine definition. The binding shadows
  // both hypothesis sets (`bindWalkNames`): a parameter whose name matches
  // one the caller hypothesised as a POINT would otherwise keep the outer
  // width for the whole body walk, and `Norm(p)` or `Dot(p, p)` over the
  // callee's own scalar parameter would be admitted as a scalar read off a
  // point.
  const bound = literal.ops
    .slice(1)
    .map((p) => parameterName(p))
    .filter((n): n is string => n !== undefined);
  const restore = bindWalkNames(walk, bound, () => 'scalar');
  let answer: boolean;
  try {
    answer = scalarShapedValue(
      literal.ops[0],
      root ?? target,
      { ...walk, locals: new Map<string, ValueKind>() },
      depth + 1
    );
  } finally {
    walk.visiting.delete(h);
    restore();
  }
  // Only a verdict reached with NOTHING left over from the calling context is
  // a property of `h` alone. A callee still open on the stack means the answer
  // may have been cut short by the cycle guard. A name the caller hypothesised
  // — as a scalar in `walk.shadowed`, or as a point in `walk.points` — can
  // decide the answer just as well: a body that reads a document symbol of
  // that same name is then judged against the hypothesis instead of against
  // the symbol, and every later call site would reuse that verdict under
  // names of its own.
  if (
    registry !== undefined &&
    root !== undefined &&
    walk.visiting.size === 0 &&
    walk.shadowed.size === 0 &&
    walk.points.size === 0
  )
    (registry.scalarShaped ??= new Map()).set(h, answer);
  return answer;
}

/** The name a function-literal parameter binds: the symbol itself, or the
 * symbol inside a `Typed(x, "…")` annotation. `undefined` for any other
 * parameter form (a destructuring pattern), which binds names this walk does
 * not read. */
function parameterName(p: Expression): string | undefined {
  if (isSymbol(p)) return p.symbol;
  if (isFunction(p, 'Typed') && isSymbol(p.ops[0])) return p.ops[0].symbol;
  return undefined;
}

/**
 * Is `expr` the application of an engine-defined function that yields a
 * scalar at run time — so the value it produces can never be an array, and
 * every arithmetic head around it can compile as ordinary scalar code?
 *
 * Two things must hold. Every ARGUMENT must be a constructed scalar, which is
 * also exactly the condition under which the call itself is emitted BARE (see
 * `BaseCompiler.emitUserFunctionCall`: a constructed-scalar argument is
 * exempt from the runtime `Array.isArray` guard, so no argument is left to
 * test and no broadcast dispatch is emitted). And the callee's BODY must be
 * scalar-shaped under scalar parameters.
 *
 * A body that CONSTRUCTS a collection — `m(t) := [t, 2t]` — is refused by the
 * body test, so `2·m(t)` keeps its runtime broadcast. A point-valued body
 * (`p(t) := (t, t²)`) is refused too: a tuple lowers to a JavaScript array,
 * which the scalar arithmetic around it must not read as one number.
 */
function isScalarUserFunctionCall(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  depth: number
): boolean {
  return scalarShapedCall(
    expr,
    target,
    (a) => isConstructedScalar(a, target, depth + 1),
    freshWalk(),
    depth
  );
}
