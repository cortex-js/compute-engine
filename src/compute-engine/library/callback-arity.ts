import type { FunctionSignature, Type } from '../../common/type/types.js';
import {
  isWildcardFunctionType,
  signatureArms,
} from '../../common/type/utils.js';
import { contextualSlotCallback } from '../boxed-expression/generic-instantiation.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import type { Expression } from '../global-types.js';

/**
 * One admissible way an operator applies its callback: how many arguments it
 * passes, and what those arguments ARE, in the words the author would use.
 *
 * `describes` is read straight into the diagnostic, so it must complete the
 * sentence "`Map` calls its callback with 1 argument (…)" — e.g. "each element
 * of the collection", "the accumulator and the current element".
 *
 * `destructurable` marks a single argument that is an ELEMENT of the source,
 * and so may itself be a tuple the author meant to take apart. Only those get
 * the tuple-pattern hint: suggesting one for `Tabulate`, whose single argument
 * is an integer index, would be nonsense.
 */
export type CallbackSupply = {
  count: number;
  describes: string;
  destructurable?: boolean;
};

/**
 * The arity a callback OPERAND can be applied at: the fewest arguments it
 * accepts and the most. `max` is `Infinity` for a variadic tail.
 */
type CallbackArity = { required: number; max: number };

/**
 * The parameter-count range of a callback operand, or `undefined` when it
 * cannot be read statically — the deliberate DECLINE, never a guess.
 *
 * Two shapes are decidable:
 *
 * - a canonical function LITERAL `["Function", body, ...params]`. Every
 *   parameter of a literal is required (the grammar has no optional, default
 *   or variadic lambda parameters — a signature annotation carrying `?`/`*`
 *   is not accepted on a lambda parameter), so the count of parameters is
 *   both the minimum and the maximum. A destructuring TUPLE pattern is a
 *   single parameter operand and therefore counts as one, which is what the
 *   author wrote. The one exception is a NULLARY literal (`["Function", 42]`,
 *   `() => True`): applying it ignores every argument (the historical
 *   contract in `function-utils.ts` `invoke`, kept so a constant can stand in
 *   for a predicate or generator — `CountIf(xs, () => True)`), so it accepts
 *   any supply count and is never an arity error.
 * - a SYMBOL whose definition carries a concrete, non-generic signature. The
 *   range then comes from the signature exactly as `validateArguments` reads
 *   it: the required parameters, through the optional ones, unbounded with a
 *   variadic tail — and a `+` tail's mandatory occurrences count on top of the
 *   optional parameters, since those are filled first.
 *
 * Everything else declines: the bare `function` wildcard (which promises
 * nothing about arity), a `callback<S>` slot (whose whole purpose is to admit
 * broadly), a generic signature (its arity is a pattern until instantiated),
 * an overload/union of signatures (nothing says which arm the operand took),
 * an undeclared forward reference, and any non-literal non-symbol operand
 * (`InverseFunction(f)`, a protocol member) whose arity is only known once it
 * is applied.
 *
 * The symbol's type is read through `lookupDefinition` rather than `.type`:
 * a LAZY operator holds its callback operand RAW, where every symbol still
 * reports `unknown`, and `.canonical` would DECLARE an undeclared name as a
 * side effect of the read.
 */
function callbackArity(fn: Expression): CallbackArity | undefined {
  if (isFunction(fn, 'Function')) {
    const n = fn.nops - 1;
    if (n === 0) return { required: 0, max: Infinity };
    return { required: n, max: n };
  }
  if (!isSymbol(fn)) return undefined;
  const def = fn.engine.lookupDefinition(fn.symbol);
  if (def === undefined) return undefined;
  const declared =
    'operator' in def ? def.operator.signature.type : def.value.type?.type;
  return signatureArity(declared);
}

/** The parameter-count range of a callable TYPE — see {@link callbackArity}
 * for which types decline and why. */
function signatureArity(type: Type | undefined): CallbackArity | undefined {
  if (type === undefined) return undefined;
  if (isWildcardFunctionType(type)) return undefined;
  if (contextualSlotCallback(type) !== undefined) return undefined;
  const arms = signatureArms(type);
  if (arms === undefined || arms.length !== 1) return undefined;
  const sig: FunctionSignature = arms[0];
  if (sig.typeParams !== undefined && sig.typeParams.length > 0)
    return undefined;
  const required = sig.args?.length ?? 0;
  const optional = sig.optArgs?.length ?? 0;
  if (sig.variadicArg !== undefined) {
    // A variadic minimum stacks on top of the OPTIONAL parameters, not just the
    // required ones: `validateArguments` fills every optional slot before it
    // starts feeding the variadic parameter, so `(number, number?, number+)`
    // needs three arguments before the variadic slot is satisfied. A
    // `variadicMin` of 0 (the `T*` form) imposes nothing, so the optional
    // parameters stay optional and `required` alone is the minimum. This
    // mirrors `arityBounds()` in `boxed-expression/overload.ts`, which is the
    // same reading of `validateArguments` for overload resolution.
    const variadicMin = sig.variadicMin ?? 0;
    return {
      required: variadicMin > 0 ? required + optional + variadicMin : required,
      max: Infinity,
    };
  }
  return { required, max: required + optional };
}

/** "1 argument (each element of the collection)" */
function supplyPhrase(supply: CallbackSupply): string {
  return `${supply.count} argument${supply.count === 1 ? '' : 's'} (${
    supply.describes
  })`;
}

/** "declares 2 parameters" / "requires at least 2 parameters" / "takes 1 to 2
 * parameters" — the operand side of the diagnostic. */
function declaresPhrase(arity: CallbackArity): string {
  const plural = (n: number) => `${n} parameter${n === 1 ? '' : 's'}`;
  if (arity.required === arity.max) return `declares ${plural(arity.required)}`;
  if (arity.max === Infinity)
    return `requires at least ${plural(arity.required)}`;
  return `takes ${arity.required} to ${plural(arity.max)}`;
}

/**
 * The parameter names of a function literal, for the tuple-pattern hint.
 * `undefined` when any parameter is not a plain symbol (already a
 * destructuring pattern, or an annotated `["Typed", …]` form whose name is not
 * worth reconstructing for a hint).
 */
function literalParameterNames(fn: Expression): string[] | undefined {
  if (!isFunction(fn, 'Function')) return undefined;
  const names: string[] = [];
  for (const param of fn.ops.slice(1)) {
    if (!isSymbol(param)) return undefined;
    names.push(param.symbol);
  }
  return names.length > 0 ? names : undefined;
}

/**
 * The static callback-arity check every operator-owned callback slot runs.
 *
 * Returns an `Error` expression when the callback provably CANNOT be applied
 * the way `operator` will apply it, and `undefined` otherwise — both when the
 * arity fits and when it cannot be decided ({@link callbackArity}).
 *
 * Why a callback slot is checked where an ordinary call is not: partial
 * application is a designed feature of a positional call (`f(1)` on a 2-ary
 * `f` curries, see `src/epsil/docs/syntax.md`), but inside a collection
 * operator the OPERATOR dictates how many arguments the callback receives, so
 * a callback that needs more than the operator supplies can never be applied
 * — the curried closures it would produce are never what the author meant.
 * Before this check the family disagreed about it, several members silently:
 * `Map((p, q) => p + q, [1,2,3])` answered a list of three closures typed
 * `vector<3>`, `Sort(xs, (a, b, c) => a < b)` returned `xs` unsorted, and
 * `Filter`/`Any`/`All` simply stayed inert.
 *
 * `supply` may list SEVERAL admissible counts, for the operators that use the
 * callback's arity as a MODE SELECTOR by design (`Sort`/`Ordering`: a unary
 * key or a binary comparator; `Iterate`: `f(acc)` or `f(index, acc)`). Such an
 * operator errors only when the callback fits none of its modes.
 *
 * The result is returned as the SLOT's operand by the caller — the documented
 * way a canonical handler reports a rejected operand (returning `null` would
 * leave the application silently inert instead).
 */
export function callbackArityError(
  fn: Expression,
  operator: string,
  supply: CallbackSupply | ReadonlyArray<CallbackSupply>
): Expression | undefined {
  const arity = callbackArity(fn);
  if (arity === undefined) return undefined;

  const supplies: ReadonlyArray<CallbackSupply> = Array.isArray(supply)
    ? supply
    : [supply as CallbackSupply];
  if (supplies.length === 0) return undefined;
  if (supplies.some((s) => s.count >= arity.required && s.count <= arity.max))
    return undefined;

  const ce = fn.engine;
  const supplied = supplies.map(supplyPhrase).join(' or ');
  // A symbol is quoted by its NAME: `toString()` is the ASCII-math spelling,
  // which double-quotes any multi-character symbol (`"plusTail"`, so that
  // `xy` is not read as `x·y`) — inside a sentence that reads as a string.
  const spelled = isSymbol(fn) ? fn.symbol : fn.toString();
  let message = `${operator} calls its callback with ${supplied}; \`${spelled}\` ${declaresPhrase(
    arity
  )}`;

  // The commonest way to reach this error is writing a callback that expects
  // the element to arrive already taken apart — `Map((p, q) => p + q, pairs)`
  // over a collection of pairs. The language spells that with a tuple pattern
  // parameter, which is one parameter, so point at it.
  const names =
    supplies.length === 1 &&
    supplies[0].count === 1 &&
    supplies[0].destructurable === true &&
    arity.required === arity.max &&
    arity.required >= 2
      ? literalParameterNames(fn)
      : undefined;
  if (names !== undefined)
    message += `. To take a ${
      names.length === 2 ? 'pair' : 'tuple'
    } apart, use a tuple pattern parameter: ((${names.join(', ')})) => …`;

  // No `where` site: the message already quotes the callback, and the error
  // sits AT the callback slot, which is what the diagnostic tiers anchor on.
  return ce.error(['callback-arity', message]);
}
