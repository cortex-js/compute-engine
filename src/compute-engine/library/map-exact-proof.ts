import type {
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
 *    with `finite_integer`-typed stand-in symbols substituted for the level's
 *    parameters, and the result must claim `finite_integer` *through the
 *    operators' own type handlers*. There is no operator allowlist for this
 *    question: `Divide` declines because `Multiply(1/2, k)` types
 *    `finite_real`, and `Mod(k, m)` over a possibly-zero modulus declines
 *    because the `Mod` handler keeps `number`.
 * 2. **Boundedness.** Source element bounds are read structurally (literal
 *    `Range`s, literal `List`s, a nested broadcast `Map`'s own proven output
 *    interval) and propagated through the body by a per-operator interval
 *    table. The table is fail-closed — an operator with no rule declines —
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
  /** The broadcast-shaped level (the compile target's layout). */
  level: LoweredLevel;
  /** The level's element `Function` literal — the compile unit. */
  fn: Expression;
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
 */
function literalInteger(x: Expression | undefined): number | undefined {
  if (x === undefined || !isNumber(x)) return undefined;
  if (x.im !== 0) return undefined;
  if (!x.isExact) return undefined;
  const v = x.re;
  return Number.isSafeInteger(v) ? v : undefined;
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
 * Interval propagation through ONE operator application (a broadcast-shaped
 * body is exactly that). Fail-closed: an operator with no rule returns
 * `undefined` and the instance declines.
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

    default:
      // No rule → no proof. `Divide`, `Power` and `Remainder` land here.
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
  const count =
    step > 0
      ? span >= 0
        ? Math.floor(span / step) + 1
        : 0
      : span <= 0
        ? Math.floor(-span / -step) + 1
        : 0;
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

/** Mutable state threaded through the recursive proof. */
interface ProofContext {
  ce: ComputeEngine;
  /** The proof consulted a symbol's VALUE, so the outcome is not purely
   * structural and must be re-derived when the engine mutates. */
  dynamic: boolean;
  /** The `Map` instances the proof walked whose mapping function carries an
   * ANNOTATED parameter. Their source element TYPES are the only other
   * non-structural input, and — unlike a value — a type can be REVALIDATED
   * cheaply, so these are recorded separately from `dynamic` (see
   * {@link ExactProofMemo}). */
  typeExprs: Expression[];
  depth: number;
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
    if (level === undefined) return undefined;
    ctx.depth++;
    const r = proveLevel(ctx, level);
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
    // REACTIVITY, and why `dynamic` is load-bearing here: the compiled body
    // never references this symbol (it names the SOURCE, not an operand), so
    // it never lands in the compiler's `symbolDeps` and the compiled-cache
    // dependency validation cannot see it change. The proof memo's
    // generation revalidation — armed by `ctx.dynamic` — plus the
    // `stillEligible()` re-ask on every `attemptCompile` path are the ONLY
    // guard against a reassignment that widens the source bounds. Any
    // `assign` bumps `ce._semanticVersion`, so that guard is complete.
    ctx.dynamic = true;
    if (ctx.depth >= MAX_SPINE_DEPTH) return undefined;
    const value = ctx.ce._getSymbolValue(x.symbol);
    // No value: decline — but the outcome stays `dynamic`, so assigning one
    // re-proves on the next generation bump.
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
    ctx.dynamic = true;
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
 * handlers: substitute `finite_integer`-typed stand-ins for the level's
 * parameters (and the resolved literal value for each closed operand, which
 * is what the compiler bakes) and require the application to claim
 * `finite_integer`.
 *
 * The stand-ins are declared in a throwaway scope so nothing leaks into the
 * ambient one. Literal stand-ins would NOT do: the handlers would fold the
 * application to a value and e.g. `Divide(4, 2)` would claim
 * `finite_integer`.
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
      ce.declare(name, 'finite_integer');
      standIns.push(ce.symbol(name));
    }
    const args = slots.map((s) =>
      'param' in s ? standIns[s.param] : ce.number(s.value)
    );
    if (args.some((a) => a === undefined)) return false;
    const applied = ce.function(op, args);
    if (!applied.isValid) return false;
    return applied.type.matches('finite_integer');
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
  // The `Block(N(…))` marker belongs to the float tier; an identity level is
  // a pass-through the compiler cannot improve on.
  if (level.napprox || level.identity) return undefined;
  const op = level.op;
  const slots: Slot[] | undefined = level.slots;
  if (op === undefined || slots === undefined) return undefined;

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

interface ExactProofMemo {
  /** Absent when the instance is not exact-tier eligible. */
  shape?: ExactTierShape;
  /** The proof read a symbol's value: RE-PROVE when the engine mutates. */
  dynamic: boolean;
  /** The annotated `Map` instances the proof walked, and the concatenated
   * source element-type keys they had at proof time. A mutation generation
   * that leaves the keys unchanged reuses the memo — only a source type that
   * actually MOVED re-proves. Empty when no annotation took part. */
  typeExprs: Expression[];
  typeKey: string;
  /** `ce._semanticVersion` at proof time (only consulted when `dynamic` or
   * `typeExprs` is non-empty). */
  generation: number;
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
 * non-structural axes are handled separately: a VALUE the proof read
 * (`dynamic`) re-proves on any mutation generation, a source element TYPE an
 * annotation was discharged against (`typeExprs`/`typeKey`) is revalidated. */
const exactProofMemo = new WeakMap<Expression, ExactProofMemo>();

/**
 * The exact tier's eligibility gate: `expr` is an unmarked broadcast-shaped
 * `Map` whose element function is provably integer-closed and overflow-free,
 * or `undefined`.
 *
 * Called once per drain (an iterator creation, or each `at()` micro-drain),
 * BEFORE any compile attempt is recorded — a declining instance costs one
 * memoized structural walk and never shows up as a compile attempt.
 */
export function exactTierShape(
  ce: ComputeEngine,
  expr: Expression
): ExactTierShape | undefined {
  const memo = exactProofMemo.get(expr);
  if (memo !== undefined) {
    if (!memo.dynamic && memo.typeExprs.length === 0) return memo.shape;
    if (memo.generation === ce._semanticVersion) return memo.shape;
    // A new generation. A VALUE-dependent proof has to be re-taken (the bounds
    // it propagated came from the values). A purely TYPE-dependent one only
    // has to have its types revalidated: recomputing the keys is a type read
    // per source, against a full walk + type probe, and every unrelated
    // `ce.assign` lands here (any assignment bumps the generation).
    if (!memo.dynamic && typeKeyOf(memo.typeExprs) === memo.typeKey) {
      memo.generation = ce._semanticVersion;
      return memo.shape;
    }
  }

  // A parameter ANNOTATION makes the lowering read a source's TYPE, which an
  // inferred collection type can retract (or acquire): the proof memo records
  // the types it read so the next mutation generation revalidates them.
  // Collected syntactically, before the lowering is asked, so a DECLINED
  // annotation — at this level or at any nested one (`proveSource`) — arms the
  // revalidation too.
  const ctx: ProofContext = {
    ce,
    dynamic: false,
    typeExprs: hasAnnotatedParams(expr) ? [expr] : [],
    depth: 0,
  };
  const level = isFunction(expr, 'Map') ? lowerLevel(expr) : undefined;
  const sources: SourceBounds[] = [];
  const proof =
    level === undefined ? undefined : proveLevel(ctx, level, sources);
  const shape: ExactTierShape | undefined =
    proof === undefined || level === undefined || !isFunction(expr, 'Map')
      ? undefined
      : {
          level,
          fn: expr.op1,
          sourceBounds: sources.map((s) => s.interval),
          count: proof.count,
        };
  exactProofMemo.set(expr, {
    shape,
    dynamic: ctx.dynamic,
    typeExprs: ctx.typeExprs,
    typeKey: typeKeyOf(ctx.typeExprs),
    generation: ce._semanticVersion,
  });
  return shape;
}
