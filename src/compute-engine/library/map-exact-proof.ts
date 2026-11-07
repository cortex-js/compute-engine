import type {
  BoxedDefinition,
  BoxedValueDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  hasAnnotatedParams,
  lowerLevel,
  sourceElementTypeKey,
} from './map-broadcast-shape.js';
import type { LoweredLevel, Slot } from './map-broadcast-shape.js';
import { rangeCount } from '../numerics/range-count.js';
import { functionLiteralParameterType } from '../boxed-expression/function-literal.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { callableBindingInContext } from '../boxed-expression/binders.js';
import { isValueDef } from '../boxed-expression/utils.js';
import { lookup } from '../function-utils.js';

/**
 * The static proof behind the **exact-mode** auto-compilation tier for lazy
 * `Map` `evaluate()` drains (design:
 * `docs/COMPILATION-MODEL.md`, ratified
 * 2026-07-31).
 *
 * §2 of that design: float64 arithmetic on integers is EXACT while every
 * operand and intermediate stays within ±2^53. So an unmarked
 * broadcast-shaped `Map` level whose element function is *integer-closed* and
 * whose every intermediate is *provably bounded* can run the existing
 * compiled code unchanged and still satisfy the exactness contract — no
 * runtime guards, no new codegen.
 *
 * Two independent obligations, both required:
 *
 * 1. **Integer-closedness (R2: derived, never listed).** The body is probed
 *    with `integer`-typed stand-in symbols substituted for the level's
 *    parameters, and the result must claim `integer` *through the
 *    operators' own type handlers*. There is no operator allowlist for this
 *    question: `Divide` declines because `Multiply(1/2, k)` types
 *    `real`, and `Mod(k, m)` over a possibly-zero modulus declines
 *    because the `Mod` handler keeps `number`.
 * 2. **Boundedness.** Source element bounds are read structurally (literal
 *    `Range`s, literal `List`s, a nested broadcast `Map`'s own proven output
 *    interval) and propagated through the body by a per-operator interval
 *    table, at each node of a body that is a tree of operations
 *    (`x ↦ x^2 + 1`, `proveNestedMap()`). The table is fail-closed — an
 *    operator with no rule declines —
 *    and every endpoint (plus each operator's own emitted intermediates) must
 *    be a safe integer.
 *
 * `Remainder` is deliberately absent from the table: its emission
 * (`a − b·round(a/b)`) contains a float division that is not provably exact.
 */

/** A closed integer interval; both endpoints are safe integers. */
export interface Interval {
  lo: number;
  hi: number;
}

/** The proven element bounds and static length of a `Map` source stream. */
interface SourceBounds {
  interval: Interval;
  count: number;
}

/** The proof outcome for an eligible instance. */
export interface ExactTierShape {
  /** The broadcast-shaped level (the compile target's layout), or
   * `undefined` when the body is a tree of operations that
   * `proveNestedMap()` proved node by node. */
  level?: LoweredLevel;
  /** The level's element `Function` literal — the compile unit. For a `Map`
   * of a named user function, the literal of that function. */
  fn: Expression;
  /** The name of the user function whose literal `fn` is, when the `Map`
   * names its element function (`Map(f, xs)`). The compiled code does not
   * read this name, so the caller records it as a dependency: a
   * redefinition of the function must compile again. */
  named?: string;
  /** The proven element interval of each source, in row order. The runner
   * re-checks every element against these at RUNTIME: the proof is taken at
   * drain start, and the values it read (a symbol source's list, R6) can in
   * principle move under a still-compiled function without passing through
   * `stillEligible()` — the compiled body does not reference the source
   * symbol, so `symbolDeps` is empty and `validCompiled` re-stamps. Today a
   * live iterator captures its source, so that route is not reachable; this
   * check makes the exactness contract independent of that fact instead of
   * resting on it. */
  sourceBounds: Interval[];
  /** Statically-proven element count of the level's source stream(s). */
  count: number;
}

/**
 * Minimum statically-proven element count for an exact-tier compile attempt.
 *
 * RATIFIED 2026-07-31 (user ruling: "use 64 for now"). R4 makes the
 * exact tier fire at the DEFAULT (bignum-preferred) engine precision, so the
 * exposure is *every* exact broadcast drain — including the many two- and
 * three-element ones a document performs. A compile costs ~1 ms; below this
 * floor the interpreter is simply faster, and the floor keeps the tier from
 * taxing small drains it cannot pay back.
 */
export const MIN_EXACT_COMPILE_COUNT = 64;

/** Guard against a pathological source nesting depth in the recursive walk. */
const MAX_SPINE_DEPTH = 32;

/**
 * Is `x` an EXACT integer literal small enough for float64 to hold it
 * exactly? Inexact (machine-float) literals are excluded: their arithmetic is
 * exact here too, but the interpreter's result would be an inexact literal
 * while the compiled path re-boxes an exact one — an `isSame` mismatch.
 * A rational that is not an integer is excluded although its float can be
 * one: the float of `1 − 10⁻³⁰` is `1`.
 */
function literalInteger(x: Expression | undefined): number | undefined {
  if (x === undefined || !isNumber(x)) return undefined;
  if (x.isComplex) return undefined;
  if (!x.isExact || x.isInteger !== true) return undefined;
  const v = x.re;
  return Number.isSafeInteger(v) ? v : undefined;
}

/**
 * The exponent of a `Power` whose bounds `applyOpInterval()` can propagate:
 * an exact integer LITERAL from 2 to 5. A symbol is not accepted, also when
 * its value is such an integer: the JavaScript target chooses the product
 * form of the power from a literal exponent.
 */
function literalPowerExponent(x: Slot | undefined): number | undefined {
  if (x === undefined || typeof x === 'number') return undefined;
  const n = literalInteger(x);
  return n !== undefined && n >= 2 && n <= 5 ? n : undefined;
}

/**
 * An interval, or `undefined` when either endpoint left the exactly
 * representable integer range.
 *
 * `Number.isSafeInteger` is the whole overflow test, on results rather than on
 * operands: a float64 sum or product of two safe integers whose TRUE value
 * exceeds 2^53−1 always rounds to a magnitude ≥ 2^53 (rounding is monotone
 * and 2^53 is representable), so it fails this check — and when the check
 * passes, the true value was representable and the computed value is exact.
 */
function interval(lo: number, hi: number): Interval | undefined {
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi)) return undefined;
  if (lo > hi) return undefined;
  return { lo, hi };
}

function maxAbs(x: Interval): number {
  return Math.max(Math.abs(x.lo), Math.abs(x.hi));
}

/**
 * Interval propagation through ONE operator application: the body of a
 * broadcast-shaped level (`proveLevel()`), or one node of a body that is a
 * tree of operations (`proveNestedMap()`). Fail-closed: an operator with no
 * rule returns `undefined` and the instance declines.
 *
 * Each rule bounds the operator's own EMITTED intermediates, not just its
 * result: n-ary `Add`/`Multiply` fold left-to-right exactly as the generated
 * code associates, and `Mod` additionally requires its `((a % b) + b)`
 * intermediate to stay safe.
 */
function applyOpInterval(op: string, args: Interval[]): Interval | undefined {
  if (args.length === 0) return undefined;

  switch (op) {
    case 'Add': {
      // The generated code can add the operands in an order other than the
      // canonical one (`x + 1 + Mod(…)` compiles to `x + floorMod(…) + 1`), so
      // every partial sum, in any order, must be safe: the sum of the
      // magnitudes bounds each of them.
      let magnitude = 0;
      for (const a of args) magnitude += maxAbs(a);
      if (!Number.isSafeInteger(magnitude)) return undefined;
      let acc = args[0];
      for (let i = 1; i < args.length; i++) {
        const next = interval(acc.lo + args[i].lo, acc.hi + args[i].hi);
        if (next === undefined) return undefined;
        acc = next;
      }
      return acc;
    }

    case 'Negate': {
      if (args.length !== 1) return undefined;
      return interval(-args[0].hi, -args[0].lo);
    }

    case 'Subtract': {
      if (args.length !== 2) return undefined;
      return interval(args[0].lo - args[1].hi, args[0].hi - args[1].lo);
    }

    case 'Multiply': {
      // As for `Add`, the factors can be multiplied in any order: the product
      // of the magnitudes (each counted as at least 1, so that a zero factor
      // does not hide a large partial product of the others) bounds every
      // partial product.
      let magnitude = 1;
      for (const a of args) {
        magnitude *= Math.max(1, maxAbs(a));
        if (!Number.isSafeInteger(magnitude)) return undefined;
      }
      let acc = args[0];
      for (let i = 1; i < args.length; i++) {
        const b = args[i];
        const corners = [
          acc.lo * b.lo,
          acc.lo * b.hi,
          acc.hi * b.lo,
          acc.hi * b.hi,
        ];
        if (!corners.every((c) => Number.isSafeInteger(c))) return undefined;
        const next = interval(Math.min(...corners), Math.max(...corners));
        if (next === undefined) return undefined;
        acc = next;
      }
      return acc;
    }

    case 'Mod': {
      if (args.length !== 2) return undefined;
      const b = args[1];
      // The zero-modulus pole (NaN) must be excluded structurally: both
      // endpoints strictly on the same side of 0.
      if (!(b.lo > 0 || b.hi < 0)) return undefined;
      // The floored-modulo emission is `(((a % b) + b) % b)`: the `%` result
      // has magnitude < |b| and the `+ b` intermediate < 2·|b|.
      if (!Number.isSafeInteger(2 * maxAbs(b))) return undefined;
      // Floored convention: the result's sign follows the divisor.
      return b.lo > 0 ? interval(0, b.hi - 1) : interval(b.lo + 1, 0);
    }

    case 'Min':
      return interval(
        Math.min(...args.map((a) => a.lo)),
        Math.min(...args.map((a) => a.hi))
      );

    case 'Max':
      return interval(
        Math.max(...args.map((a) => a.lo)),
        Math.max(...args.map((a) => a.hi))
      );

    case 'Floor':
    case 'Ceil':
    case 'Round':
    case 'Truncate':
      // Identity on an integer interval. NOTE: the ceiling operator is
      // `Ceil` — `Ceiling` is a deliberately INERT Mathematica alias with no
      // definition, so a `'Ceiling'` case here would be dead code that
      // silently declined every `Ceil` body. Every name in this switch is
      // pinned by an end-to-end compile test in
      // `test/compute-engine/map-exact-compile.test.ts` ("supported heads"),
      // which is what keeps the list from drifting.
      if (args.length !== 1) return undefined;
      return args[0];

    case 'Abs': {
      if (args.length !== 1) return undefined;
      const a = args[0];
      if (a.lo >= 0) return a;
      if (a.hi <= 0) return interval(-a.hi, -a.lo);
      return interval(0, Math.max(-a.lo, a.hi));
    }

    case 'Power': {
      // Only an exponent from 2 to 5, which the caller has read from an
      // integer LITERAL (`literalPowerExponent()`): the JavaScript target
      // compiles these powers to products (`x * x`, `_SYS.pow3` to
      // `_SYS.pow5`), which are exact while every partial product is a safe
      // integer. A larger exponent compiles to `Math.pow`, whose result the
      // language does not promise to be exact.
      if (args.length !== 2) return undefined;
      const [a, e] = args;
      const n = e.lo;
      if (e.hi !== n || !Number.isInteger(n) || n < 2 || n > 5)
        return undefined;
      // Every partial product is a power `|a|^k` with `k ≤ n`, so the bound
      // `max(1, |a|)^n` covers them all.
      const m = Math.max(1, maxAbs(a));
      let bound = 1;
      for (let i = 0; i < n; i++) {
        bound *= m;
        if (!Number.isSafeInteger(bound)) return undefined;
      }
      const pow = (v: number): number => {
        let r = 1;
        for (let i = 0; i < n; i++) r *= v;
        return r;
      };
      if (n % 2 === 1) return interval(pow(a.lo), pow(a.hi));
      if (a.lo >= 0) return interval(pow(a.lo), pow(a.hi));
      if (a.hi <= 0) return interval(pow(a.hi), pow(a.lo));
      return interval(0, pow(maxAbs(a)));
    }

    default:
      // No rule → no proof. `Divide` and `Remainder` land here.
      return undefined;
  }
}

/** Bounds and length of a literal `Range` source. */
function rangeBounds(x: Expression): SourceBounds | undefined {
  if (!isFunction(x, 'Range')) return undefined;
  const ops = x.ops;
  let lo: number | undefined;
  let hi: number | undefined;
  let step = 1;
  if (ops.length === 1) {
    lo = 1;
    hi = literalInteger(ops[0]);
  } else if (ops.length === 2 || ops.length === 3) {
    lo = literalInteger(ops[0]);
    hi = literalInteger(ops[1]);
    if (ops.length === 3) {
      const s = literalInteger(ops[2]);
      if (s === undefined || s === 0) return undefined;
      step = s;
    }
  } else return undefined;
  if (lo === undefined || hi === undefined) return undefined;

  const span = hi - lo;
  if (!Number.isSafeInteger(span)) return undefined;
  const count = rangeCount(lo, hi, step);
  if (count === 0) return { interval: { lo: 0, hi: 0 }, count: 0 };
  const last = lo + (count - 1) * step;
  if (!Number.isSafeInteger(last)) return undefined;
  const iv = interval(Math.min(lo, last), Math.max(lo, last));
  return iv === undefined ? undefined : { interval: iv, count };
}

/** Bounds and length of an explicit `List` of exact integer literals. */
function listBounds(x: Expression): SourceBounds | undefined {
  if (!isFunction(x, 'List')) return undefined;
  if (x.nops === 0) return { interval: { lo: 0, hi: 0 }, count: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const o of x.ops) {
    const v = literalInteger(o);
    if (v === undefined) return undefined;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const iv = interval(lo, hi);
  return iv === undefined ? undefined : { interval: iv, count: x.nops };
}

/** A symbol that a compiled element function or its proof read: the resolution
 * of the name when it was read (mirrors `ElementMemoDep` in
 * `boxed-expression/collection-element-memo.ts`). */
export interface MapCompileDep {
  name: string;
  /** Binding wrapper resolved by name in the ambient engine scope at compile
   * time. An identity change means the name now resolves elsewhere
   * (shadowing declaration, redeclaration, the parameter of another call). */
  binding: BoxedDefinition | undefined;
  /** The inner value definition at compile time — `updateDef` swaps this on
   * the same wrapper. `undefined` for operator definitions (user functions). */
  valueDef: BoxedValueDefinition | undefined;
  /** `valueDef._writeVersion` at compile time. It moves on each value write,
   * also on the write of a loop index, which does not move
   * `ce._semanticVersion`. */
  version: number;
  /** The inner OPERATOR definition at compile time — a user-function
   * redefinition (`ce.assign('f', newLambda)`) keeps the binding wrapper but
   * swaps this object, and the identity comparison catches it. The
   * `_writeVersion` of an operator definition, which counts its changes in
   * place, is not read here. */
  operatorDef: unknown;
}

/** Snapshot the ambient-scope resolution of a symbol. */
export function resolveDep(ce: ComputeEngine, name: string): MapCompileDep {
  const binding = lookup(name, ce.context.lexicalScope);
  const valueDef =
    binding !== undefined && isValueDef(binding) ? binding.value : undefined;
  return {
    name,
    binding,
    valueDef,
    version: valueDef?._writeVersion ?? 0,
    operatorDef:
      binding !== undefined && 'operator' in binding
        ? binding.operator
        : undefined,
  };
}

/** Has `dep`'s resolution changed since it was snapshotted? */
export function depChanged(ce: ComputeEngine, dep: MapCompileDep): boolean {
  const binding = lookup(dep.name, ce.context.lexicalScope);
  if (binding !== dep.binding) return true;
  const valueDef =
    binding !== undefined && isValueDef(binding) ? binding.value : undefined;
  if (valueDef !== dep.valueDef) return true;
  if (valueDef && valueDef._writeVersion !== dep.version) return true;
  const operatorDef =
    binding !== undefined && 'operator' in binding
      ? binding.operator
      : undefined;
  if (operatorDef !== dep.operatorDef) return true;
  return false;
}

/** Mutable state threaded through the recursive proof. */
interface ProofContext {
  ce: ComputeEngine;
  /** The symbols whose VALUE or definition the proof read. When there is one,
   * the outcome is not purely structural (see {@link ExactProofMemo}). */
  reads: Set<string>;
  /** The `Map` instances the proof walked whose mapping function carries an
   * ANNOTATED parameter. Their source element TYPES are the only other
   * non-structural input, and — unlike a value — a type can be REVALIDATED
   * cheaply, so these are recorded separately from `reads` (see
   * {@link ExactProofMemo}). */
  typeExprs: Expression[];
  depth: number;
  /** True when a level whose mapping function carries the numeric marker
   * (`NumericApproximation`) is proved too (`exactTierShape()`,
   * `numericMarker`). */
  numericMarker: boolean;
}

function proveSource(
  ctx: ProofContext,
  x: Expression
): SourceBounds | undefined {
  if (isFunction(x, 'Range')) return rangeBounds(x);
  if (isFunction(x, 'List')) return listBounds(x);
  if (isFunction(x, 'Map')) {
    if (ctx.depth >= MAX_SPINE_DEPTH) return undefined;
    // Recorded BEFORE the lowering is asked, so a nested annotated level that
    // DECLINES arms the type revalidation too — its decline is no more
    // permanent than an admission (the source's type can improve).
    if (hasAnnotatedParams(x)) ctx.typeExprs.push(x);
    const level = lowerLevel(x);
    ctx.depth++;
    const r =
      level !== undefined ? proveLevel(ctx, level) : proveNestedMap(ctx, x);
    ctx.depth--;
    return r;
  }
  if (isSymbol(x)) {
    // Amendment R6 (ruled 2026-07-31): a SYMBOL source — the motivating
    // consumer's dominant firing shape, `L ↦ f(L)` over a document variable,
    // which produces a `Map` whose source operand is the bare symbol. Resolve
    // it through its current value and recurse: the value may be a literal
    // `Range`, a `List` of integer literals, a nested broadcast `Map`, or a
    // further symbol (a chain, bounded by the depth guard — a cycle simply
    // runs out of depth and declines).
    //
    // REACTIVITY, and why `reads` is necessary here: the compiled body never
    // references this symbol (it names the SOURCE, not an operand), so it
    // never lands in the compiler's `symbolDeps` and the compiled-cache
    // dependency validation cannot see it change. The check of `reads` in the
    // proof memo, plus the `stillEligible()` re-ask on every `attemptCompile`
    // path, are the ONLY guard against a new value that widens the source
    // bounds. That value can come from an `assign`, which moves
    // `ce._semanticVersion`, or from the parameter of another call or a loop
    // index, which do not: `depChanged()` sees all of them.
    ctx.reads.add(x.symbol);
    if (ctx.depth >= MAX_SPINE_DEPTH) return undefined;
    const value = ctx.ce._getSymbolValue(x.symbol);
    // No value: decline — but the symbol stays in `reads`, so assigning a
    // value re-proves.
    if (value === undefined) return undefined;
    ctx.depth++;
    const r = proveSource(ctx, value);
    ctx.depth--;
    return r;
  }
  // Unknown-length streams, non-literal `Range` bounds: no bounds, no proof.
  return undefined;
}

/** A body slot resolved for the type probe: a parameter position, or the
 * exact integer value a closed operand currently holds. */
type ProbeSlot = { param: number } | { value: number };

/** The exact integer a closed (parameter-free) operand denotes, or
 * `undefined`. A symbol is resolved through its current value — which the
 * compiler folds into the generated code (`tryFoldKnownSymbol`), so the same
 * symbol lands in the compile's `symbolDeps` and a reassignment invalidates
 * the compiled function through the runner's existing dependency machinery. */
function closedInteger(ctx: ProofContext, x: Expression): number | undefined {
  const lit = literalInteger(x);
  if (lit !== undefined) return lit;
  if (isSymbol(x)) {
    ctx.reads.add(x.symbol);
    const v = ctx.ce._getSymbolValue(x.symbol);
    if (v === undefined) return undefined;
    return literalInteger(v);
  }
  return undefined;
}

/** Stand-in symbol names for the type probe. Deliberately obscure: a
 * single-letter or Greek name could collide with a library constant. */
const PROBE_SYMBOL_PREFIX = '_mapExactCompileProbe_';

/**
 * R2's integer-closedness question, asked of the operators' own type
 * handlers: substitute `integer`-typed stand-ins for the level's
 * parameters (and the resolved literal value for each closed operand, which
 * is what the compiler bakes) and require the application to claim
 * `integer`.
 *
 * The stand-ins are declared in a throwaway scope so nothing leaks into the
 * ambient one. Literal stand-ins would NOT do: the handlers would fold the
 * application to a value and e.g. `Divide(4, 2)` would claim
 * `integer`.
 */
function probesIntegerClosed(
  ce: ComputeEngine,
  op: string,
  slots: ProbeSlot[],
  arity: number
): boolean {
  ce.pushScope();
  try {
    const standIns: Expression[] = [];
    for (let i = 0; i < arity; i++) {
      const name = `${PROBE_SYMBOL_PREFIX}${i}`;
      ce.declare(name, 'integer');
      standIns.push(ce.symbol(name));
    }
    const args = slots.map((s) =>
      'param' in s ? standIns[s.param] : ce.number(s.value)
    );
    if (args.some((a) => a === undefined)) return false;
    const applied = ce.function(op, args);
    if (!applied.isValid) return false;
    return applied.type.matches('integer');
  } catch {
    return false;
  } finally {
    ce.popScope();
  }
}

/** Prove one broadcast-shaped level integer-closed and bounded, returning the
 * bounds of the elements it PRODUCES (so an enclosing level can propagate
 * through them). */
function proveLevel(
  ctx: ProofContext,
  level: LoweredLevel,
  /** Out-parameter: the top-level caller collects the per-source bounds it
   * needs for the runtime element check. */
  sourcesOut?: SourceBounds[]
): SourceBounds | undefined {
  // The numeric marker belongs to the float tier, unless the caller asks
  // for a proof over marked levels (`numericMarker`); an identity level is
  // a pass-through the compiler cannot improve on.
  if ((level.napprox && !ctx.numericMarker) || level.identity) return undefined;
  const op = level.op;
  const slots: Slot[] | undefined = level.slots;
  if (op === undefined || slots === undefined) return undefined;
  if (op === 'Power' && literalPowerExponent(slots[1]) === undefined)
    return undefined;

  const sources: SourceBounds[] = [];
  for (const s of level.sources) {
    const b = proveSource(ctx, s);
    if (b === undefined) return undefined;
    sources.push(b);
  }
  if (sources.length !== level.arity) return undefined;
  if (sourcesOut !== undefined) sourcesOut.push(...sources);

  const args: Interval[] = [];
  const probeSlots: ProbeSlot[] = [];
  for (const s of slots) {
    if (typeof s === 'number') {
      const b = sources[s];
      if (b === undefined) return undefined;
      args.push(b.interval);
      probeSlots.push({ param: s });
    } else {
      const v = closedInteger(ctx, s);
      if (v === undefined) return undefined;
      args.push({ lo: v, hi: v });
      probeSlots.push({ value: v });
    }
  }

  const out = applyOpInterval(op, args);
  if (out === undefined) return undefined;
  if (!probesIntegerClosed(ctx.ce, op, probeSlots, level.arity))
    return undefined;

  return {
    interval: out,
    count: Math.min(...sources.map((s) => s.count)),
  };
}

/**
 * The `Function` literal behind a user-defined function symbol: the
 * `_lambdaLiteral` of its operator definition, or the value of a symbol whose
 * assigned value is a `Function` literal. These are the two storage routes
 * that the compiler's `userFunctionLiteral` covers.
 */
export function userFnLiteral(
  ce: ComputeEngine,
  id: string
): Expression | undefined {
  const def = ce.lookupDefinition(id);
  if (def && 'operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (literal !== undefined && isFunction(literal, 'Function'))
      return literal;
  }
  const value = ce._getSymbolValue(id);
  if (value !== undefined && isFunction(value, 'Function')) return value;
  return undefined;
}

/**
 * The `Function` literal of the user function that the callback symbol
 * `callee` of a `Map` denotes (`Map(f, xs)`), or `undefined` to decline the
 * compilation.
 *
 * The interpreter applies the callback through its lexical binding
 * (`callableBindingInContext()`): the definition of `f` where the `Map` was
 * bound, not the definition that the name has in the scope of the drain. The
 * literal is read by the name (`userFnLiteral()`), and the dependencies of
 * the compiled code are also recorded by the name. Thus, when the lexical
 * binding is not the binding that the name gives in the current scope (an
 * inner `f(x) = x + 2` shadows the outer `f(x) = x + 1` of the `Map`), the
 * function declines, and the interpreter computes the elements.
 */
export function namedCallbackLiteral(
  ce: ComputeEngine,
  callee: Expression
): Expression | undefined {
  if (!isSymbol(callee)) return undefined;
  const name = callee.symbol;
  const own =
    callee.valueDefinition !== undefined
      ? { value: callee.valueDefinition }
      : callee.operatorDefinition !== undefined
        ? { operator: callee.operatorDefinition }
        : undefined;
  if (callableBindingInContext(ce, name, own) !== ce.lookupDefinition(name))
    return undefined;
  const literal = userFnLiteral(ce, name);
  if (
    literal !== undefined &&
    !calleesResolveLexically(ce, literal, new Set([name]))
  )
    return undefined;
  return literal;
}

/**
 * True if each user function that the body of the `Function` literal
 * `literal` calls or names, and each user function that those call in turn,
 * has the same definition in the current scope as its lexical binding.
 *
 * The interpreter evaluates a call in the body of a user function through
 * the definition that the call was bound to when the function was defined.
 * The compiler reads the functions that a body calls by name in the current
 * scope (the scope of the drain). So when the drain runs in a scope that
 * defines another function with the same name (an outer `h(x) = x + 1`
 * called by `f(x) = h(x)`, drained in a block that defines
 * `h(x) = x + 2`), the compiled code would call the inner `h` while the
 * interpreter calls the outer one. This function returns false in that case,
 * and the interpreter computes the elements (CE-446).
 *
 * A name is checked when its lexical binding is a user function, or when the
 * name gives a user function in the current scope. Thus a drain scope that
 * defines the name as something that is not a user function (a constant
 * `h = 3`) also makes the function return false.
 *
 * `seen` holds the names already checked; it starts with the name of the
 * callback, so that a recursive function is not visited again. The
 * expression nodes already visited are also kept, so that a body that uses
 * the same subexpression more than once (`Beta(t, t)`, nested) is visited
 * once per node, not once per path to it.
 */
export function calleesResolveLexically(
  ce: ComputeEngine,
  literal: Expression,
  seen: Set<string>
): boolean {
  type Own = Parameters<typeof callableBindingInContext>[2];
  const visited = new Set<Expression>();
  const isUserFn = (own: Own): boolean => {
    if (own === undefined) return false;
    if ('operator' in own)
      return isFunction(
        (own.operator as { _lambdaLiteral?: Expression })._lambdaLiteral,
        'Function'
      );
    return isFunction(own.value.value, 'Function');
  };
  const check = (name: string, own: Own): boolean => {
    if (seen.has(name)) return true;
    if (!isUserFn(own) && userFnLiteral(ce, name) === undefined) return true;
    if (callableBindingInContext(ce, name, own) !== ce.lookupDefinition(name))
      return false;
    seen.add(name);
    const called = userFnLiteral(ce, name);
    return !isFunction(called, 'Function') || visit(called.op1);
  };
  const visit = (e: Expression): boolean => {
    if (visited.has(e)) return true;
    visited.add(e);
    if (isSymbol(e))
      return check(
        e.symbol,
        e.valueDefinition !== undefined
          ? { value: e.valueDefinition }
          : e.operatorDefinition !== undefined
            ? { operator: e.operatorDefinition }
            : undefined
      );
    if (!isFunction(e)) return true;
    const def = e.operatorDefinition;
    if (!check(e.operator, def !== undefined ? { operator: def } : undefined))
      return false;
    return e.ops.every(visit);
  };
  return isFunction(literal, 'Function') && visit(literal.op1);
}

/**
 * True if the declared signature of the user function `name` accepts an
 * argument of type `argTypes[i]` at each parameter `i`.
 *
 * The interpreter checks each argument against the signature of the
 * function, and returns an error element for an argument that the signature
 * refuses (`f` of type `(integer<0..10>) -> integer`, applied to `11`). The
 * compiled code does not check the arguments. So a compiled `Map` of a named
 * function is correct only when every argument that it can receive is
 * accepted by the signature. A signature with a different number of
 * parameters declines. A definition whose type is not a signature (the bare
 * type `function`) states no parameter type, and accepts every argument.
 */
export function declaredParametersAdmit(
  ce: ComputeEngine,
  name: string,
  argTypes: ReadonlyArray<Type>
): boolean {
  const def = ce.lookupDefinition(name);
  if (def === undefined) return false;
  const type =
    'operator' in def ? def.operator.signature.type : def.value.type.type;
  if (typeof type !== 'object' || type.kind !== 'signature') return true;
  const required = type.args ?? [];
  const optional = type.optArgs ?? [];
  if (argTypes.length < required.length) return false;
  for (let i = 0; i < argTypes.length; i++) {
    const param =
      required[i] ?? optional[i - required.length] ?? type.variadicArg;
    if (param === undefined) return false;
    if (!isSubtype(argTypes[i], param.type)) return false;
  }
  return true;
}

/**
 * The element function of a `Map`: its `Function` literal, or the literal of
 * the user function that its first operand names (`Map(f, xs)` with
 * `f(x) = x^2 + 1`), with the names of its parameters. `undefined` when the
 * first operand is neither, or when a parameter is not a symbol.
 *
 * The interpreter enforces the annotation of a parameter
 * (`Typed(x, "integer")`, also one that the canonical form of a lambda over
 * a `Range` adds) at each application, and the compiled code does not. So
 * an annotation is accepted only when every integer satisfies it: the
 * runner gives the compiled code only exact integers (`sourceBounds`).
 */
export function mapElementFunction(
  ce: ComputeEngine,
  expr: Expression
): { fn: Expression; params: string[]; named?: string } | undefined {
  if (!isFunction(expr, 'Map') || expr.nops < 2) return undefined;
  return callbackElementFunction(ce, expr.op1);
}

/**
 * The `Function` literal of the callback `callee` (a `Function` literal, or
 * a symbol that names a user function), with the names of its parameters,
 * read as `mapElementFunction()` reads the element function of a `Map`.
 * `undefined` when the callback is neither, when a parameter is not a
 * symbol, or when a parameter does not accept every integer.
 */
function callbackElementFunction(
  ce: ComputeEngine,
  callee: Expression
): { fn: Expression; params: string[]; named?: string } | undefined {
  let fn = callee;
  let named: string | undefined;
  if (isSymbol(fn)) {
    named = fn.symbol;
    const literal = namedCallbackLiteral(ce, fn);
    if (literal === undefined) return undefined;
    fn = literal;
  }
  if (!isFunction(fn, 'Function') || fn.nops < 1) return undefined;
  // The runner gives the compiled code only exact integers, so the
  // signature of a named function must accept every integer.
  if (
    named !== undefined &&
    !declaredParametersAdmit(
      ce,
      named,
      fn.ops.slice(1).map(() => 'integer')
    )
  )
    return undefined;
  const params: string[] = [];
  for (let p of fn.ops.slice(1)) {
    if (isFunction(p, 'Typed')) {
      const declared = functionLiteralParameterType(p);
      if (declared === undefined || !isSubtype('integer', declared))
        return undefined;
      p = p.op1;
    }
    if (!isSymbol(p)) return undefined;
    params.push(p.symbol);
  }
  return { fn, params, named };
}

/** Guard against a pathological nesting depth of an element function body. */
const MAX_BODY_DEPTH = 64;

/**
 * Prove a `Map` whose element function body is a TREE of integer
 * operations (`x ↦ x^2 + 1`), which `lowerLevel()` does not lower because an
 * operand of the outer operation is itself an application. The element
 * function can be a `Function` literal or a named user function
 * (`mapElementFunction()`).
 *
 * The proof is the one of `proveLevel()`, applied at each node of the body,
 * from the leaves up: a parameter has the bounds of its source, a closed
 * operand is an exact integer literal or a symbol with such a value
 * (`closedInteger()`), and each application propagates the bounds of its
 * operands with `applyOpInterval()`, which also bounds the values that the
 * generated code computes on the way. Each application must also be
 * integer-closed: it is rebuilt over `integer` stand-in symbols, from the
 * rebuilt operands, and its type must be `integer`. Any other node (a call
 * of a user function, an operation with no bounds rule, a body with more
 * than one statement) declines.
 *
 * Returns the bounds of the elements that the `Map` produces, and pushes the
 * bounds of its sources into `sourcesOut` when given.
 */
function proveNestedMap(
  ctx: ProofContext,
  expr: Expression,
  sourcesOut?: SourceBounds[]
): SourceBounds | undefined {
  const ce = ctx.ce;
  const element = mapElementFunction(ce, expr);
  if (element === undefined) return undefined;
  // The definition of a named function is read here, so the proof is
  // re-taken when the engine changes (a redefinition of the function).
  if (element.named !== undefined) ctx.reads.add(element.named);
  const { fn, params } = element;
  if (!isFunction(fn) || !isFunction(expr)) return undefined;
  const sourceOps = expr.ops.slice(1);
  if (params.length !== sourceOps.length) return undefined;

  let body: Expression = fn.op1;
  if (isFunction(body, 'Block')) {
    if (body.nops !== 1) return undefined;
    body = body.op1;
  }
  // The numeric marker belongs to the float tier, unless the caller asks
  // for a proof over marked levels (`numericMarker`).
  if (
    (isFunction(body, 'NumericApproximation') || isFunction(body, 'N')) &&
    body.nops === 1
  ) {
    if (!ctx.numericMarker) return undefined;
    body = body.op1;
  }
  // A bare parameter or a constant body is not an operation the compiled
  // code can improve on.
  if (!isFunction(body)) return undefined;

  const sources: SourceBounds[] = [];
  for (const s of sourceOps) {
    const b = proveSource(ctx, s);
    if (b === undefined) return undefined;
    sources.push(b);
  }

  const out = proveIntegerOperands(ctx, params, sources, [body]);
  if (out === undefined) return undefined;
  if (sourcesOut !== undefined) sourcesOut.push(...sources);
  return {
    interval: out[0],
    count: Math.min(...sources.map((s) => s.count)),
  };
}

/**
 * The proof of `proveNestedMap()` for each expression of `operands`: each one
 * is a parameter of the element function, a closed integer operand
 * (`closedInteger()`), or a tree of integer operations, and it must be
 * integer-closed and bounded over the bounds `sources` of the parameters
 * `params`. Returns the bounds of each operand, in the order of `operands`, or
 * `undefined` when one of them is not proved.
 *
 * Each application in a tree propagates the bounds of its operands with
 * `applyOpInterval()`, which also bounds the values that the generated code
 * computes on the way. Each application must also be integer-closed: it is
 * rebuilt over `integer` stand-in symbols, from the rebuilt operands, and its
 * type must be `integer`. Any other node (a call of a user function, an
 * operation with no bounds rule) declines.
 */
function proveIntegerOperands(
  ctx: ProofContext,
  params: ReadonlyArray<string>,
  sources: ReadonlyArray<SourceBounds>,
  operands: ReadonlyArray<Expression>
): Interval[] | undefined {
  const ce = ctx.ce;
  // The exponent of a `Power` must be a literal (`literalPowerExponent()`):
  // only its base is an operand to prove.
  const operandsOf = (
    x: Expression
  ): { operands: ReadonlyArray<Expression>; exponent?: number } | undefined => {
    if (!isFunction(x)) return undefined;
    if (x.operator !== 'Power') return { operands: x.ops };
    const exponent = x.nops === 2 ? literalPowerExponent(x.op2) : undefined;
    if (exponent === undefined) return undefined;
    return { operands: [x.op1], exponent };
  };

  // First pass: the bounds of each node. It reads no type and declares
  // nothing, so a body that the table cannot bound declines at little cost.
  const boundsOf = (x: Expression, depth: number): Interval | undefined => {
    if (depth > MAX_BODY_DEPTH) return undefined;
    if (isSymbol(x)) {
      const i = params.indexOf(x.symbol);
      if (i >= 0) return sources[i].interval;
    }
    if (!isFunction(x)) {
      const v = closedInteger(ctx, x);
      return v === undefined ? undefined : { lo: v, hi: v };
    }
    if (params.includes(x.operator)) return undefined;
    const shape = operandsOf(x);
    if (shape === undefined) return undefined;
    const bounds: Interval[] = [];
    for (const o of shape.operands) {
      const b = boundsOf(o, depth + 1);
      if (b === undefined) return undefined;
      bounds.push(b);
    }
    if (shape.exponent !== undefined)
      bounds.push({ lo: shape.exponent, hi: shape.exponent });
    return applyOpInterval(x.operator, bounds);
  };

  const out: Interval[] = [];
  for (const x of operands) {
    const b = boundsOf(x, 0);
    if (b === undefined) return undefined;
    out.push(b);
  }

  // Second pass: each application, rebuilt over the stand-ins, must be
  // integer-closed (see `probesIntegerClosed()`).
  ce.pushScope();
  try {
    const standIns: Expression[] = [];
    for (let i = 0; i < params.length; i++) {
      const name = `${PROBE_SYMBOL_PREFIX}${i}`;
      ce.declare(name, 'integer');
      standIns.push(ce.symbol(name));
    }

    const probeOf = (x: Expression): Expression | undefined => {
      if (isSymbol(x)) {
        const i = params.indexOf(x.symbol);
        if (i >= 0) return standIns[i];
      }
      if (!isFunction(x)) {
        const v = closedInteger(ctx, x);
        return v === undefined ? undefined : ce.number(v);
      }
      const shape = operandsOf(x);
      if (shape === undefined) return undefined;
      const probes: Expression[] = [];
      for (const o of shape.operands) {
        const p = probeOf(o);
        if (p === undefined) return undefined;
        probes.push(p);
      }
      if (shape.exponent !== undefined) probes.push(ce.number(shape.exponent));
      const probe = ce.function(x.operator, probes);
      if (!probe.isValid || !probe.type.matches('integer')) return undefined;
      return probe;
    };

    for (const x of operands) if (probeOf(x) === undefined) return undefined;
    return out;
  } catch {
    return undefined;
  } finally {
    ce.popScope();
  }
}

interface ExactProofMemo {
  /** Absent when the instance is not exact-tier eligible. */
  shape?: ExactTierShape;
  /** The symbols whose value or definition the proof read, each with its
   * resolution when it was read. RE-PROVE when one of them changes, or when
   * the engine mutates. */
  reads: MapCompileDep[];
  /** The annotated `Map` instances the proof walked, and the concatenated
   * source element-type keys they had at proof time. A mutation generation
   * that leaves the keys unchanged reuses the memo — only a source type that
   * actually MOVED re-proves. Empty when no annotation took part. */
  typeExprs: Expression[];
  typeKey: string;
  /** `ce._semanticVersion` at proof time (only consulted when `reads` or
   * `typeExprs` is non-empty). */
  generation: number;
  /** Whether the assumptions were hidden (`ce._factsHidden()`) when
   * the proof was taken. The proof reads source VALUES and, for an annotated
   * parameter, source TYPES; an assumed value or an assumption-narrowed type
   * changes both, so a proof taken inside a fact-blind bracket must not be
   * served to a read that can see the facts, or the other way round
   * (`docs/plans/2026-08-30-assumptions-memo-inventory.md`). Separate from
   * `generation` because opening or closing such a bracket moves no version
   * axis. */
  factsHidden: boolean;
}

/** The recorded keys of `typeExprs`, recomputed. */
function typeKeyOf(typeExprs: ReadonlyArray<Expression>): string {
  let key = '';
  for (const x of typeExprs) key += sourceElementTypeKey(x) + ';';
  return key;
}

/** Keyed on the drained `Map` instance — canonical expressions are
 * structurally immutable, so a purely structural outcome never needs
 * invalidating (the same argument as the `lowerMapSpine` memo). The two
 * non-structural axes are handled separately: a VALUE the proof read (`reads`)
 * re-proves when its resolution changes or on any mutation generation, a source
 * element TYPE an annotation was discharged against (`typeExprs`/`typeKey`) is
 * revalidated. */
const exactProofMemo = new WeakMap<Expression, ExactProofMemo>();

/** The memo of the proofs over marked levels (`numericMarker`), kept apart
 * from `exactProofMemo` because the same instance has a different answer. */
const markedProofMemo = new WeakMap<Expression, ExactProofMemo>();

/**
 * The exact tier's eligibility gate: `expr` is an unmarked broadcast-shaped
 * `Map` whose element function is provably integer-closed and overflow-free,
 * or `undefined`.
 *
 * Called once per drain (an iterator creation, or each `at()` micro-drain),
 * BEFORE any compile attempt is recorded — a declining instance costs one
 * memoized structural walk and never shows up as a compile attempt.
 *
 * With `numericMarker`, a level whose mapping function carries the numeric
 * marker of `.N()` is proved as if it had none. The float tier asks this for
 * a body that applies a function whose result jumps at a point (`Mod`,
 * `Floor`, …): over exact integer inputs inside the proved bounds, the
 * compiled code then computes the same integers as the interpreter, which
 * reads exact operands exactly (`mapAutoCompileRunner()`).
 */
export function exactTierShape(
  ce: ComputeEngine,
  expr: Expression,
  options?: { numericMarker?: boolean }
): ExactTierShape | undefined {
  const numericMarker = options?.numericMarker === true;
  return memoizedShape(
    numericMarker ? markedProofMemo : exactProofMemo,
    ce,
    expr,
    // A parameter ANNOTATION makes the lowering read a source's TYPE, which
    // an inferred collection type can retract (or acquire): the proof memo
    // records the types it read so the next mutation generation revalidates
    // them. Collected syntactically, before the lowering is asked, so a
    // DECLINED annotation — at this level or at any nested one
    // (`proveSource`) — arms the revalidation too.
    hasAnnotatedParams(expr) ? [expr] : [],
    numericMarker,
    (ctx) => {
      const level = isFunction(expr, 'Map') ? lowerLevel(expr) : undefined;
      const sources: SourceBounds[] = [];
      // A body that is not one application (`x ↦ x^2 + 1`), or a named
      // element function, is proved node by node (`proveNestedMap()`).
      const element =
        level === undefined ? mapElementFunction(ce, expr) : undefined;
      const proof =
        level !== undefined
          ? proveLevel(ctx, level, sources)
          : element !== undefined
            ? proveNestedMap(ctx, expr, sources)
            : undefined;
      return proof === undefined || !isFunction(expr, 'Map')
        ? undefined
        : {
            level,
            fn: element?.fn ?? expr.op1,
            named: element?.named,
            sourceBounds: sources.map((s) => s.interval),
            count: proof.count,
          };
    }
  );
}

/** The comparisons that a condition proved by `exactPredicateShape()` can
 * apply to integer operands. */
const INTEGER_COMPARISONS = new Set([
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
]);

/**
 * True if `x` is a comparison of two operands (`INTEGER_COMPARISONS`), or an
 * `And`, `Or` or `Not` of such expressions. The operands of the comparisons
 * are pushed into `operands`, for the integer proof of the caller.
 */
function comparisonOperands(
  x: Expression,
  depth: number,
  operands: Expression[]
): boolean {
  if (depth > MAX_BODY_DEPTH || !isFunction(x)) return false;
  const op = x.operator;
  if (op === 'Not')
    return x.nops === 1 && comparisonOperands(x.op1, depth + 1, operands);
  if (op === 'And' || op === 'Or')
    return (
      x.nops > 0 &&
      x.ops.every((o) => comparisonOperands(o, depth + 1, operands))
    );
  if (!INTEGER_COMPARISONS.has(op) || x.nops !== 2) return false;
  operands.push(x.op1, x.op2);
  return true;
}

/** The memo of `exactPredicateShape()`, keyed on the `Filter`, `Any` or `All`
 * instance. */
const predicateProofMemo = new WeakMap<Expression, ExactProofMemo>();

/**
 * The proof of the exact tier for the condition of a selection:
 * `Filter(xs, p)`, `Any(xs, p)` or `All(xs, p)`, where the condition `p` is a
 * `Function` literal of one parameter, or a named user function of one
 * parameter (`isEven(n) = n % 2 == 0`), and the source `xs` has proved
 * integer bounds (`proveSource()`: a literal `Range`, a `List` of integer
 * literals, a proved `Map`, or a symbol whose value is one of those).
 * `undefined` when the instance is not of that kind.
 *
 * The body of the condition must be a comparison of two operands
 * (`Equal`, `NotEqual`, `Less`, `LessEqual`, `Greater`, `GreaterEqual`), or
 * an `And`, `Or` or `Not` of such comparisons. Each operand of a comparison
 * must be integer-closed and bounded over the bounds of the source, as the
 * body of a `Map` of the exact tier (`proveIntegerOperands()`). Then the
 * compiled code compares the same integers as the interpreter, and its
 * boolean is the interpreter's `True` or `False`.
 *
 * The proof is memoized as the proof of `exactTierShape()` is
 * (`memoizedShape()`), in a memo of its own: it is taken again when a symbol
 * that it read changes (a value of the source or of a closed operand, the
 * definition of the named condition).
 */
export function exactPredicateShape(
  ce: ComputeEngine,
  expr: Expression
): ExactTierShape | undefined {
  return memoizedShape(predicateProofMemo, ce, expr, [], false, (ctx) => {
    if (
      !(
        isFunction(expr, 'Filter') ||
        isFunction(expr, 'Any') ||
        isFunction(expr, 'All')
      ) ||
      expr.nops !== 2
    )
      return undefined;
    // The definition of a named condition is read here, so the proof is
    // taken again when the function is defined or redefined. The name is
    // recorded before the definition is read: a decline because the function
    // has no definition yet is taken again when it gets one.
    if (isSymbol(expr.op2)) ctx.reads.add(expr.op2.symbol);
    const element = callbackElementFunction(ce, expr.op2);
    if (element === undefined || element.params.length !== 1) return undefined;
    if (!isFunction(element.fn)) return undefined;
    let body: Expression = element.fn.op1;
    if (isFunction(body, 'Block')) {
      if (body.nops !== 1) return undefined;
      body = body.op1;
    }
    const operands: Expression[] = [];
    if (!comparisonOperands(body, 0, operands)) return undefined;
    const source = proveSource(ctx, expr.op1);
    if (source === undefined) return undefined;
    if (
      proveIntegerOperands(ctx, element.params, [source], operands) ===
      undefined
    )
      return undefined;
    return {
      fn: element.fn,
      named: element.named,
      sourceBounds: [source.interval],
      count: source.count,
    };
  });
}

/**
 * The memoized proof of `expr`: the shape that `prove` gives, kept in `memos`
 * until a symbol that the proof read changes, or, for a proof that read the
 * types of annotated `Map` instances (`typeExprs`), until one of these types
 * changes. `prove` adds the symbols it reads to `ctx.reads`.
 */
function memoizedShape(
  memos: WeakMap<Expression, ExactProofMemo>,
  ce: ComputeEngine,
  expr: Expression,
  typeExprs: Expression[],
  numericMarker: boolean,
  prove: (ctx: ProofContext) => ExactTierShape | undefined
): ExactTierShape | undefined {
  const factsHidden = ce._factsHidden();
  const recorded = memos.get(expr);
  const memo = recorded?.factsHidden === factsHidden ? recorded : undefined;
  if (memo !== undefined) {
    if (memo.reads.length === 0 && memo.typeExprs.length === 0)
      return memo.shape;
    // The generation does not show every new value of a symbol the proof
    // read. The parameter of a new call and a loop index have a new value and
    // the same generation, so each symbol is checked (`depChanged()`).
    if (
      memo.generation === ce._semanticVersion &&
      !memo.reads.some((read) => depChanged(ce, read))
    )
      return memo.shape;
    // A new generation or a new value. A VALUE-dependent proof has to be
    // re-taken (the bounds it propagated came from the values). A purely
    // TYPE-dependent one only has to have its types revalidated: recomputing
    // the keys is a type read per source, against a full walk + type probe,
    // and every unrelated `ce.assign` lands here (any assignment bumps the
    // generation).
    if (memo.reads.length === 0 && typeKeyOf(memo.typeExprs) === memo.typeKey) {
      memo.generation = ce._semanticVersion;
      return memo.shape;
    }
  }

  const ctx: ProofContext = {
    ce,
    reads: new Set(),
    typeExprs,
    depth: 0,
    numericMarker,
  };
  const shape = prove(ctx);
  memos.set(expr, {
    shape,
    reads: [...ctx.reads].map((name) => resolveDep(ce, name)),
    typeExprs: ctx.typeExprs,
    typeKey: typeKeyOf(ctx.typeExprs),
    generation: ce._semanticVersion,
    factsHidden,
  });
  return shape;
}
