/**
 * The interpreter fallback of the `interval-js` target: the `success: false`
 * result of a compilation that declines, whose `run` evaluates the
 * expression with the interpreter and gives values of the interval result
 * contract (`IntervalValue`).
 *
 * `compile()` builds it for a decline of the interval mode
 * (`compile-expression.ts`).
 *
 * @module compilation/interval-fallback
 */

import type { Expression } from '../global-types.js';
import {
  isSymbol,
  isFunction,
  isString,
  isCharacter,
  isNumber,
} from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';
import { kindArmNames, resolveTypeAlias } from '../../common/type/utils.js';
import { kindTypeNames } from '../boxed-expression/value-kinds.js';
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isBooleanBindingType } from './type-facts.js';
import { fallbackInputsRead, interpreterFallback } from './interpreter-fallback.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { isRecord, hasIntervalBounds } from '../interval/run-support.js';
import type {
  CompileDiagnostic,
  CompilationResult,
  CompiledRunner,
  IntervalInput,
  IntervalValue,
} from './types.js';

/**
 * True when `expr` has a symbol whose type has an `enclosure` arm (an input
 * typed by the value kind, `list<enclosure>` included), or a result type
 * with an `enclosure` arm. A compilation of such an expression that
 * declines throws even with `fallback: true`: the interpreter fallback of
 * this target collapses each `{ lo, hi }` input to its midpoint
 * (`collapseIntervalInput()`), which would give a NUMBER to a symbol typed
 * `enclosure`, and reads a scalar result through `.N().re`, which is `NaN`
 * for an enclosure (`docs/plans/2026-10-26-value-kinds.md`, section 4.9.2,
 * "Compilation"). The other value kinds keep the fallback.
 */
export function holdsEnclosureInputOrResult(expr: Expression): boolean {
  if (
    kindArmNames(expr.type.type, kindTypeNames(expr.engine)).includes(
      'enclosure'
    )
  )
    return true;
  return hasEnclosureSymbol(expr);
}

/**
 * True when a symbol of `expr`, at any depth, has a type with an
 * `enclosure` arm at any level (`enclosure`, `real | enclosure`,
 * `list<enclosure>`).
 */
function hasEnclosureSymbol(expr: Expression): boolean {
  const kinds = kindTypeNames(expr.engine);
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e))
      return kindArmNames(e.type.type, kinds).includes('enclosure');
    return isFunction(e) && e.ops.some(visit);
  };
  return visit(expr);
}

/**
 * Wrap an interpreter fallback result as a value honoring the interval-js
 * `run` contract (`IntervalValue`). When every interval input is a point
 * (`wide` is false):
 * - a number whose exact value is that double (`exact`, from
 *   `exactnessOf()`) becomes the interval result of the degenerate
 *   interval, `{ kind: 'interval', value: { lo: v, hi: v } }`; any other
 *   number is `entire`, since no point is known to hold its value;
 * - a boolean becomes the answer string `'true'` or `'false'`;
 * - an absent value becomes `empty`;
 * - a collection (materialized to an array, possibly nested) becomes the
 *   array of its elements' wrappings, the same shape a compiled
 *   comprehension returns.
 *
 * When an input is wider than a point (`wide`), a number, an absent value
 * and a collection are `entire`, and a boolean is `'maybe'`. Any other value
 * (text) has no interval reading and is `entire`, the "cannot bound" signal
 * the runtime proxy uses.
 */
function toIntervalValue(
  value: unknown,
  wide: boolean,
  exact: Exactness,
  decided = false
): IntervalValue {
  // The interpreter computed the value at the midpoint of each interval input
  // (`collapseIntervalInput`). When every input is a point, that is the value
  // over the whole input. When an input is wider than a point (`wide`), the
  // value at one sample does not bound the values over the input: a number
  // is `entire` and a boolean is `'maybe'`, the answers of this target that
  // mean "cannot bound". Without this, `Fibonacci(x)` over `[1, 10]` was
  // `empty` (the value at 5.5), although it takes the values 1 to 55 there.
  //
  // A boolean is the answer string of a comparison, as compiled code of this
  // target gives it (user decision of 2026-10-23, ROADMAP CE-210). Before,
  // `Fibonacci(x) > 0` at `x = 5` was `entire`. At a point it is decided
  // only when every number it is computed from is exact (`decided`, from
  // `booleanDecided()`): the interpreter compares inexact values with a
  // tolerance, so `Gamma(0.3) < 2.991568987687591` reads as `False`.
  if (value === true || value === false)
    return wide || !decided ? 'maybe' : value ? 'true' : 'false';
  // An ABSENT value is `empty`, the value the compiled code of this target
  // gives where there is no value at run time: a restriction whose condition
  // fails (`_IA.restrict`) and a real function outside its domain both answer
  // `empty`, for a number, a point and a list alike. The interpreter spells an
  // absent value as `NaN` in a numeric position and as `Missing` elsewhere, and
  // the generic fallback gives `NaN` for both on this target, since it has no
  // object null. Without this the fallback answered `{ lo: NaN, hi: NaN }`, so
  // a host could tell from the value which route ran.
  if (value === undefined || (typeof value === 'number' && Number.isNaN(value)))
    return wide ? { kind: 'entire' } : { kind: 'empty' };
  // A present number is the interval result of a point only when the
  // interpreter's value is exactly that double (an integer, `1/4`). The
  // double of any other value (`Gamma(0.3)`, a quadrature, a series) is
  // not the value, and the point would not hold it: such a number is
  // `entire`, the "cannot bound" answer.
  if (typeof value === 'number')
    return wide || exact !== true
      ? { kind: 'entire' }
      : { kind: 'interval', value: { lo: value, hi: value } };
  // Over a wide input the collection at the midpoint does not bound the
  // collections over the input: its length and its nesting can differ at
  // another point (`If(x > 0, [Fibonacci(x), 1], [2])` over `[-1, 1]`), so
  // the whole collection is `entire`.
  if (Array.isArray(value))
    return wide
      ? { kind: 'entire' }
      : value.map((x, i) =>
          toIntervalValue(
            x,
            false,
            Array.isArray(exact) ? exact[i] : false,
            decided
          )
        );
  return { kind: 'entire' };
}

/** Whether each number of an interpreted value is exactly a double: a
 * boolean for a scalar, an array for a collection (`exactnessOf()`). */
type Exactness = boolean | Exactness[];

/**
 * Whether the numbers of the evaluated value `e` are exactly doubles, in
 * the shape in which the interpreter fallback converts it: a collection is
 * the array of its elements. A number is exact when it is an exact integer
 * or rational whose value is a double (`5`, `1/4`, `2^60`); a decimal
 * (`0.5`), a value computed in floating point (`Gamma(0.3)`, `N()` of a
 * quadrature), `1/3` and a radical are not.
 */
function exactnessOf(e: Expression): Exactness {
  if (isString(e) || isCharacter(e)) return false;
  if (e.isCollection) return [...e.each()].map(exactnessOf);
  // An element of a lazy collection (`Map(f, L)`) is not evaluated yet: its
  // exact value is read with `evaluate()`, which does not numericize. An
  // element with an effect is not evaluated a second time.
  const v = isNumber(e) || !e.isPure ? e : e.evaluate();
  if (!isNumber(v) || !v.isExact) return false;
  const r = asRational(v);
  if (r === undefined) return false;
  const [p, q] = [BigInt(r[0]), BigInt(r[1])];
  // The double `p / q` is the value when `p` is a double and `q` a power
  // of two that does not underflow it.
  if ((q & (q - 1n)) !== 0n || q > 2n ** 1000n) return false;
  const d = Number(p);
  return Number.isFinite(d) && BigInt(d) === p;
}

/** Whether every number of `exact` (`exactnessOf()`) is exact. */
function allExact(exact: Exactness): boolean {
  return Array.isArray(exact) ? exact.every(allExact) : exact;
}

/**
 * Whether the booleans of the value of `expr`, evaluated while the inputs
 * of the run are bound, are computed from exact numbers only, so that the
 * interpreter's verdict is the verdict over the point box: each operand
 * that is a boolean is decided by the same rule (`And`, `Or`, `Not`, a
 * nested relation), and each other operand (the operands of a relation, of
 * a predicate) has a value whose numbers are exact (`exactnessOf()`). An
 * input is read as the double it was given, which is its value. A boolean
 * with no numeric operand (`True`, a boolean input) is decided.
 */
function booleanDecided(expr: Expression): boolean {
  if (isSymbol(expr)) {
    if (expr.type.matches('boolean')) return true;
    const v = expr.evaluate();
    // A run input is boxed from a double, whose value it is.
    if (isNumber(v) && typeof v.numericValue === 'number')
      return Number.isFinite(v.numericValue);
    return allExact(exactnessOf(v));
  }
  if (isNumber(expr)) return allExact(exactnessOf(expr));
  if (!isFunction(expr)) return expr.type.matches('boolean');
  if (!expr.isPure) return false;
  return expr.ops.every((op) =>
    op.type.matches('boolean')
      ? booleanDecided(op)
      : isSymbol(op)
        ? booleanDecided(op)
        : allExact(exactnessOf(op.evaluate()))
  );
}

/** Whether a run of `expr` can draw a random number (an effect `random`, or
 * an unknown effect): its value then differs from call to call, and no
 * point holds it. For a `Function` literal, the effects of its body. */
function drawsRandom(expr: Expression): boolean {
  const effects = isFunction(expr, 'Function')
    ? expr.ops[0].effects
    : expr.effects;
  return effects === 'any' || (effects?.includes('random') ?? false);
}

/** Whether an interval-shaped input, or one nested in a collection or a
 * variables object, has bounds that differ: the interpreter fallback then
 * samples it at its midpoint, which does not bound the values over it. */
function hasWideIntervalInput(value: unknown): boolean {
  if (hasIntervalBounds(value)) return Number(value.lo) !== Number(value.hi);
  if (Array.isArray(value)) return value.some(hasWideIntervalInput);
  if (isRecord(value)) return Object.values(value).some(hasWideIntervalInput);
  return false;
}


/**
 * The arguments of the interpreter fallback with the boolean variables
 * (`names`, declared `boolean`) of a vars object read as the interpreter
 * reads them: `'true'` is `true` and `'false'` is `false`, the strings the
 * compiled code of this target tests (`IntervalInput`). `'maybe'` says the
 * value can be either one: the variable's value is cleared for the run, so
 * a condition on it has no value, and `maybe` is true, which makes the call wide (a boolean
 * result is then `'maybe'`, as over an interval wider than a point). A
 * JavaScript boolean passes as it is. The caller's object is not changed.
 */
function booleanFallbackInputs(
  args: unknown[],
  names: ReadonlySet<string>
): { args: unknown[]; maybe: boolean } {
  const vars = args[0];
  if (names.size === 0 || !isRecord(vars) || Array.isArray(vars))
    return { args, maybe: false };
  let copy: Record<string, unknown> | undefined;
  let maybe = false;
  for (const name of names) {
    if (!Object.hasOwn(vars, name)) continue;
    const v = vars[name];
    if (v !== 'true' && v !== 'false' && v !== 'maybe') continue;
    copy ??= Object.assign(Object.create(null), vars) as Record<
      string,
      unknown
    >;
    if (v === 'maybe') {
      copy[name] = undefined;
      maybe = true;
    } else copy[name] = v === 'true';
  }
  return copy === undefined
    ? { args, maybe }
    : { args: [copy, ...args.slice(1)], maybe };
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
  if (isRecord(value)) return collapseEntries(value);
  return value;
}

/** A copy of the record `value` with each entry collapsed
 * (`collapseIntervalInput`). */
function collapseEntries(value: Record<string, unknown>): unknown {
  // Prototype-free: `out['__proto__'] = v` on an ordinary object invokes the
  // inherited setter instead of creating an own key, so a variable named
  // `__proto__` was dropped from the copy entirely and read as unsupplied.
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(value)) out[k] = collapseIntervalInput(v);
  return out;
}

/** The entries of a variables object, or the value itself if it is not
 * one. */
function varsEntries(value: unknown): unknown {
  return isRecord(value) && !Array.isArray(value)
    ? Object.values(value)
    : value;
}

/**
 * Build the documented `success: false` fallback for the interval-js target:
 * an interpreter-backed `run` whose results honor the interval contract.
 *
 * The generic fallback (`interpreterFallback()`) produces a runner that
 * returns plain numbers, booleans and nested arrays for collections.
 * Interval-shaped *inputs* (`{ lo, hi }`) are collapsed to their midpoint before
 * interpretation, and the output is wrapped by `toIntervalValue`: at a point
 * input, a number is the interval result of a degenerate interval, a boolean
 * is `'true'` or `'false'` and an absent value is `empty`; over an input
 * wider than a point, the value at the midpoint does not bound the values
 * over the input, so a boolean expression is `'maybe'` and anything else is
 * `entire`, the "cannot bound" signal the runtime proxy uses. Returning a
 * properly interval-typed `run` lets the result carry the target's real
 * value type without a force cast.
 */
export function buildIntervalFallback(
  expr: Expression,
  error: string,
  inputs: ReadonlyMap<string, Type | undefined>,
  diagnostic?: CompileDiagnostic
): CompilationResult<'interval-js', IntervalValue> {
  console.warn(
    `Compilation fallback for "${expr.operator}" (target: interval-js): ${error}`
  );
  // Whether the numbers of the value of the last run are exactly doubles,
  // read while the run's inputs are bound (a lazy collection reads them).
  let exact: Exactness | undefined;
  let wantExact = false;
  // Whether the booleans of the value of the last run are decided
  // (`booleanDecided()`), read while the run's inputs are bound.
  let decided = false;
  const fallbackOf = (
    e: Expression
  ): CompilationResult<'interval-js', IntervalValue> =>
    ({
      ...interpreterFallback(
        e,
        error,
        diagnostic ?? compileDiagnosticOf(undefined, error),
        inputs,
        (value) => {
          if (!wantExact) return;
          exact = exactnessOf(value);
          // A `Function` literal root: its body is not evaluated here.
          decided = !isFunction(expr, 'Function') && booleanDecided(expr);
        },
        false
      ),
      target: 'interval-js',
    }) as unknown as CompilationResult<'interval-js', IntervalValue>;
  // A function-valued root (a `Function` literal, a block, a symbol, an
  // `If`) has the `calling: 'lambda'` convention, as on the compiled route
  // (`functionValuedRoot`). Its arguments are read here
  // (`buildIntervalLambdaFallback`): a boolean parameter takes `'true'`,
  // `'false'` and `'maybe'`, and an interval argument is collapsed.
  if (functionValuedRoot(expr))
    return buildIntervalLambdaFallback(expr, fallbackOf(expr));
  const base = fallbackOf(expr);
  // `run` is guaranteed present for an executable target (interval-js).
  // Through `unknown`: the fallback's `run` is typed with the interval
  // target's own result union, which does not overlap the plain
  // number/array shape the interpreter actually hands back here before
  // `toIntervalValue` wraps it.
  const interpreterRun = base.run as unknown as (...args: unknown[]) => unknown;
  // A boolean expression over an input wider than a point is `'maybe'`,
  // whatever the sample at the midpoint gives: the sample can be absent
  // (`Fibonacci(5.5) > 0`) or decided, and neither bounds the answer over
  // the input. The interpreter still runs, so that the effects of the
  // expression (an `Assign`) happen once per call, as on every route.
  const isBoolean = expr.type.matches('boolean');
  // A function literal whose value is a function (`x ↦ (y ↦ x + y)`): the
  // value has no interval reading, and the answer is `entire`, as from
  // the runner of a compiled function (`runIntervalLambda`).
  const givesFunction = functionResultType(expr);
  // The free variables declared `boolean`. The compiled code of this
  // target reads such a variable as the string `'true'`, `'false'` or
  // `'maybe'`, and the interpreter reads a boolean: the strings are
  // converted for them, and for no other variable (a `string` variable
  // keeps its text).
  const booleanNames = new Set(
    fallbackInputsRead(expr, inputs)
      .filter(({ type }) => isBooleanBindingType(type))
      .map(({ name }) => name)
  );
  const draws = drawsRandom(expr);
  const run: CompiledRunner<IntervalValue, IntervalInput> = (
    ...args: unknown[]
  ): IntervalValue => {
    const { args: read, maybe } = booleanFallbackInputs(args, booleanNames);
    // The first argument is the variables object: its entries are read,
    // and the object itself is never an interval (`{ lo: 5, hi: 5 }` binds
    // the variables `lo` and `hi`).
    const wide =
      maybe ||
      read.some((a, i) => hasWideIntervalInput(i === 0 ? varsEntries(a) : a));
    exact = undefined;
    decided = false;
    wantExact = !wide && !draws && !givesFunction;
    const value = interpreterRun(
      ...read.map((a, i) =>
        i === 0 && isRecord(a) && !Array.isArray(a)
          ? collapseEntries(a)
          : collapseIntervalInput(a)
      )
    );
    if (givesFunction) return { kind: 'entire' };
    if (wide && isBoolean) return 'maybe';
    if (draws) return isBoolean ? 'maybe' : { kind: 'entire' };
    return toIntervalValue(value, wide, exact ?? false, decided);
  };
  return { ...base, run };
}

/**
 * The interpreter fallback of a function-valued root that is not a
 * `Function` literal (`buildIntervalFallback`), from the generic fallback
 * `base` of the root, whose report it keeps.
 *
 * `run` takes the arguments of the function and evaluates
 * `Apply(expr, …)`. Each argument is boxed with the type of its parameter
 * in the signature of `expr` (a fixed, optional or variadic parameter): an
 * `Interval` is collapsed to its midpoint, as a variable of a vars object
 * is; an array is a tuple for a `tuple` parameter, else a list. For a
 * parameter of a boolean type (`isBooleanBindingType`), the
 * strings `'true'` and `'false'` are booleans, and `'maybe'` is
 * `Missing` and makes the call wide, as for a boolean variable. The
 * value is wrapped by `toIntervalValue`, as on the other fallback; a
 * function value is `entire`.
 */
function buildIntervalLambdaFallback(
  expr: Expression,
  base: CompilationResult<'interval-js', IntervalValue>
): CompilationResult<'interval-js', IntervalValue> {
  const ce = expr.engine;
  const t = expr.type.type;
  const signature =
    typeof t !== 'string' && t.kind === 'signature' ? t : undefined;
  const fixed = signature?.args ?? [];
  const optional = signature?.optArgs ?? [];
  const paramType = (i: number): Type | undefined =>
    (i < fixed.length
      ? fixed[i]
      : (optional[i - fixed.length] ?? signature?.variadicArg)
    )?.type;
  const isBoolean =
    signature !== undefined &&
    signature.result !== 'never' &&
    isSubtype(signature.result, 'boolean');
  const givesFunction = functionResultType(expr);
  const box = (v: unknown, written: Type | undefined): Expression => {
    if (typeof v === 'boolean') return v ? ce.True : ce.False;
    if (typeof v === 'number') return ce.number(v);
    if (typeof v === 'string') return ce.string(v);
    if (Array.isArray(v)) {
      // A type alias is read as the type it names.
      const type =
        written === undefined ? undefined : resolveTypeAlias(written);
      if (typeof type !== 'string' && type?.kind === 'tuple')
        return ce.function(
          'Tuple',
          v.map((x, i) => box(x, type.elements[i]?.type))
        );
      const elements =
        typeof type !== 'string' &&
        (type?.kind === 'list' || type?.kind === 'indexed_collection')
          ? type.elements
          : undefined;
      return ce.function(
        'List',
        v.map((x) => box(x, elements))
      );
    }
    return ce.Missing;
  };
  const run: CompiledRunner<IntervalValue, IntervalInput> = (
    ...args: unknown[]
  ): IntervalValue => {
    let maybe = false;
    const boxed = args.map((a, i) => {
      const type = paramType(i);
      if (
        typeof a === 'string' &&
        type !== undefined &&
        isBooleanBindingType(type)
      ) {
        if (a === 'true') return ce.True;
        if (a === 'false') return ce.False;
        if (a === 'maybe') {
          maybe = true;
          return ce.Missing;
        }
      }
      return box(collapseIntervalInput(a), type);
    });
    const wide = maybe || args.some(hasWideIntervalInput);
    const applied = ce.function('Apply', [expr, ...boxed]);
    const value = applied.evaluate();
    if (givesFunction || isFunction(value, 'Function'))
      return { kind: 'entire' };
    if (wide && isBoolean) return 'maybe';
    if (drawsRandom(applied)) return isBoolean ? 'maybe' : { kind: 'entire' };
    return toIntervalValue(
      interpretedIntervalValue(value),
      wide,
      exactnessOf(value)
    );
  };
  return { ...base, calling: 'lambda', run };
}

/**
 * True when the value of the root `expr` is a function: a `Function` literal,
 * a block whose last statement is one, a symbol whose value is one. Its
 * static type is a function type.
 *
 * The compiled code of such a root is an expression whose value is a
 * JavaScript function over enclosures. A `run()` that gave that function
 * would give a function that a caller cannot call with numbers, and a value
 * that is not an `IntervalValue`. So the result is called with the arguments
 * of the function instead (`calling: 'lambda'`, `runIntervalLambda`).
 */
function functionValuedRoot(expr: Expression): boolean {
  if (isFunction(expr, 'Function')) return true;
  const t = expr.type.type;
  return t !== 'never' && isSubtype(t, 'function');
}

/**
 * True when `expr` is a function whose value is a function: the result type
 * of its signature, or the type of the body of a `Function` literal, is a
 * function type (`x ↦ (y ↦ x + y)`).
 */
function functionResultType(expr: Expression): boolean {
  const t = expr.type.type;
  const result =
    typeof t !== 'string' && t.kind === 'signature'
      ? t.result
      : isFunction(expr, 'Function')
        ? expr.ops[0].type.type
        : undefined;
  return (
    result !== undefined && result !== 'never' && isSubtype(result, 'function')
  );
}

/**
 * The plain value of an interpreted result, as `toIntervalValue` reads it: a
 * boolean, an array for a collection (not a string), a string for a string
 * or a character, `{ re, im }` for a complex value, and for any other value
 * its numeric value (`NaN` when it has none, which `toIntervalValue` reads as
 * absent).
 */
function interpretedIntervalValue(e: Expression): unknown {
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  // A character is text too (`isString` is false for it).
  if (isString(e) || isCharacter(e)) return e.string;
  if (e.isCollection) return [...e.each()].map(interpretedIntervalValue);
  const n = e.N();
  if (isSymbol(n, 'True')) return true;
  if (isSymbol(n, 'False')) return false;
  // A complex value is `{ re, im }`, as the generic fallback gives it
  // (`buildInterpreterFallback`); `toIntervalValue` reads it as `entire`.
  // `im` is NaN for a value with no numeric value, which stays `NaN`.
  const im = n.im;
  if (im !== 0 && !Number.isNaN(im)) return { re: n.re, im };
  return n.re;
}
