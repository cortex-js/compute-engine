import type { Expression, FunctionInterface } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import type { CompileTarget } from './types.js';
import { isCallerMapped } from './cse.js';
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

// The parameters of an emitted user-function body that hold a run-time
// scalar: every parameter of a function none of whose parameters binds a
// collection, a tuple or a point whole. Keyed on the bound-variable set the
// body compiles under, the same way `loopRanges` above is: a nested binder
// installs a new set, so a name it shadows loses the fact instead of
// inheriting it.
const scalarParams = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();

/**
 * Record that, inside the body compiling under `target`, every name in
 * `names` holds a runtime scalar because the function it is a parameter of
 * binds no argument whole. See `isConstructedScalar` for what the fact is
 * used for.
 */
export function recordScalarParams(
  target: CompileTarget<Expression>,
  names: ReadonlySet<string>
): void {
  if (!target.boundVars || names.size === 0) return;
  scalarParams.set(target.boundVars, names);
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
    if (
      target.boundVars !== undefined &&
      scalarParams.get(target.boundVars)?.has(expr.symbol) === true
    )
      return true;
    // A caller's explicit declaration is the input contract. A type inferred
    // from use in a scalar parameter is not such a promise. Local binders and
    // caller mappings have their own representations and do not inherit it.
    return (
      !target.boundVars?.has(expr.symbol) &&
      !target.varsKeys?.has(expr.symbol) &&
      expr.valueDefinition?.inferredType === false &&
      expr.engine._getSymbolValue(expr.symbol) === undefined &&
      ['number', 'boolean', 'string'].some((t) =>
        isSubtype(expr.type.type, t as 'number' | 'boolean' | 'string')
      )
    );
  }
  if (!isFunction(expr) || !builtin(expr, target)) return false;
  if (SCALAR_ARITHMETIC_HEADS.includes(expr.operator))
    return expr.ops.every((arg) => isConstructedScalar(arg, target, depth + 1));
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
  if (isSymbol(expr))
    return (
      walk.shadowed.has(expr.symbol) ||
      isConstructedScalar(expr, target, depth + 1)
    );
  if (!isFunction(expr) || !builtin(expr, target)) return false;
  const scalarOperand = (a: Expression) =>
    scalarShapedValue(a, target, walk, depth + 1);
  const arms = valueArms(expr);
  if (arms !== undefined) return arms.every(scalarOperand);
  const shape = headShape(expr, target, walk);
  // A local binding, a caller `vars` entry or a callee already open on this
  // walk: none of them is a value this module can read.
  if (shape === 'opaque') return false;
  if (shape === 'broadcast') {
    if (!expr.ops.every(scalarOperand)) return false;
    // A built-in broadcastable head over scalars is a scalar by definition.
    // A user-defined callee still owes the body test.
    return (
      !isUserFunctionHead(expr) ||
      scalarShapedCall(expr, target, scalarOperand, walk, depth)
    );
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

/** The state a body walk carries: the callees whose body is open on the stack
 * (the cycle guard) and the parameter names those bodies bind. */
type BodyWalk = { visiting: Set<string>; shadowed: Set<string> };

/** The operands of `expr` that can become its VALUE — the last statement of a
 * `Block`, the arms of an `If`, the odd-indexed arms of a `Which`. `undefined`
 * for every other head, which has no such structure. */
function valueArms(
  expr: Expression & FunctionInterface
): ReadonlyArray<Expression> | undefined {
  const ops = expr.ops;
  if (expr.operator === 'Block')
    return ops.length === 0 ? undefined : [ops[ops.length - 1]];
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
  const h = expr.operator;
  if (
    target.boundVars?.has(h) ||
    target.varsKeys?.has(h) ||
    target.localFunctions?.has(h) ||
    walk.shadowed.has(h) ||
    walk.visiting.has(h)
  )
    return false;
  const literal = userFunctionLiteral(expr, h);
  if (literal === undefined || literal.ops.length < 1) return false;
  if (!expr.ops.every(scalarArgument)) return false;
  return userFunctionResultIsScalar(h, literal, target, walk, depth);
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
  // The body binds these names; a call of one of them inside it denotes that
  // binding, never the same-named engine definition.
  const bound = literal.ops
    .slice(1)
    .map((p) => parameterName(p))
    .filter((n): n is string => n !== undefined && !walk.shadowed.has(n));
  for (const n of bound) walk.shadowed.add(n);
  let answer: boolean;
  try {
    answer = scalarShapedValue(literal.ops[0], root ?? target, walk, depth + 1);
  } finally {
    walk.visiting.delete(h);
    for (const n of bound) walk.shadowed.delete(n);
  }
  // Only a verdict reached with no callee left open on the stack is a
  // property of `h` alone: an answer computed while a caller was being
  // examined may have been cut short by the cycle guard.
  if (registry !== undefined && root !== undefined && walk.visiting.size === 0)
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
    { visiting: new Set(), shadowed: new Set() },
    depth
  );
}
