import {
  couldBeCollectionOperand,
  isFiniteIndexedCollection,
  typeCouldBeNumericCollection,
  typeCouldBeNumericTuple,
  typeIsProvablyNonNumericCollection,
} from '../collection-utils.js';

import { flatten } from './flatten.js';
import { isSubtype } from '../../common/type/subtype.js';
import { admissionOf, hasValueComponent } from './value-membership.js';
import {
  broadcastableBaseMatches,
  couldBeNonRealNumber,
  narrowingPreservesEffects,
  overlapsForDeferredValidation,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import {
  diagnoseNoMatch,
  joinParamAt,
  overloadArms,
  resolveOverload,
} from './overload.js';
import { parseType } from '../../common/type/parse.js';
import { FunctionSignature, Type } from '../../common/type/types.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
  BoxedValueDefinition,
} from '../global-types.js';
import { fuzzyStringMatch } from '../../common/fuzzy-string-match.js';
import { isOperatorDef, isValueDef } from './utils.js';
import { isTensorValue } from './tensor-view.js';
import { isDevolvedShadow, markDevolvedShadow } from './devolved-shadows.js';
import { isSymbol, isFunction, isContinuationOperand } from './type-guards.js';

// Parsed once: the type of an indexed collection whose every element is a
// number. Used in `checkNumericArgs` to accept collections for broadcasting on
// the strength of their static element type.
const INDEXED_COLLECTION_OF_NUMBER = parseType('indexed_collection<number>');

// `typeCouldBeNumericCollection` / `typeCouldBeNumericTuple` — the COULD-
// semantics predicates `checkNumericArgs` uses to admit collection/tuple
// operands — are imported from `collection-utils.ts`, where the
// `Add`/`Multiply` type handlers and the invisible-operator gate share the
// SAME predicates. Keeping a private copy here let the two layers diverge:
// an operand admitted by validation but missed by the type handlers
// collapsed to `number` and baked `incompatible-type` (Tycho item 30).

// `couldBeCollectionOperand` moved to `collection-utils.ts` alongside the
// sibling COULD-semantics predicates, so validation, overload resolution and
// result typing share ONE definition — a private copy here would let the
// resolution used for validation admit different arms from the one used for
// result typing.

/**
 * Check that the number of arguments is as expected.
 *
 * Converts the arguments to canonical, and flattens the sequence.
 */
export function checkArity(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  count: number
): ReadonlyArray<Expression> {
  ops = flatten(ops);

  // @fastpath
  if (!ce.strict) {
    // Skip the "unexpected-argument" bookkeeping below, but still pad a
    // missing *required* argument with an `Error("missing")` marker.
    // Leaving it out entirely stores a raw JS `undefined` in the operand
    // array once `count` operands are assumed downstream (e.g. `Sin()`
    // canonicalizes to a zero-operand `Sin`, and `.evaluate()` then
    // destructures `ops[0]` as `undefined`, producing the garbage
    // expression `Sin([undefined])` instead of degrading gracefully).
    if (ops.length >= count) return ops;
    const xs = [...ops];
    while (xs.length < count) xs.push(ce.error('missing'));
    return xs;
  }

  if (ops.length === count) return ops;

  const xs: Expression[] = [...ops.slice(0, count)];
  let i = Math.min(count, ops.length);
  while (i < count) {
    xs.push(ce.error('missing'));
    i += 1;
  }
  while (i < ops.length) {
    xs.push(ce.error('unexpected-argument', ops[i].toString()));
    i += 1;
  }
  return xs;
}

/**
 * Prose-style fallback for un-applied builtin operators: a single
 * uppercase-letter symbol bound to a **standard-library** operator (`N`, `D`)
 * that appears as a bare operand of a numeric function (`N + 1`, `M = N + 1`,
 * `S/D`) almost always means a variable, not the builtin. Devolve it to an
 * unknown symbol by shadowing the builtin in the current scope; its type is
 * then inferred like any other free variable.
 *
 * Only *root-scope* (standard library) bindings devolve — a user-declared
 * function used as an operand is a genuine error and is preserved. Note the
 * shadow persists in the scope: a later `N(...)` in the same scope refers to
 * the variable, not the builtin (same convention as type inference, which is
 * also use-order dependent).
 *
 * The repair applies only to an operand that is itself bound to an OPERATOR
 * definition — an un-applied operator. A symbol bound to a value definition
 * has a type of its own, and re-boxing it here would silently launder the
 * parameter check it just failed.
 *
 * Returns the re-boxed symbol, or `null` if the fallback does not apply.
 */
function devolveUnappliedOperator(
  ce: ComputeEngine,
  op: Expression
): Expression | null {
  if (!isSymbol(op)) return null;
  const name = op.symbol;
  if (!/^[A-Z]$/.test(name)) return null;
  // An un-applied OPERATOR is what devolves. A symbol already bound to a
  // value (a user declaration such as `V: tuple<number,number,number>`) is
  // not repairable: its declared type is the answer, and the failed check
  // must surface as `incompatible-type` like it does for any other name.
  if (!op.operatorDefinition) return null;

  // Find the scope where the name is currently bound
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope && !scope.bindings.has(name)) scope = scope.parent;
  if (!scope) return null;

  const def = scope.bindings.get(name)!;
  if (!scope.parent) {
    // Bound to the standard library: shadow it in the current scope
    if (!isOperatorDef(def)) return null;
    ce.declare(name, 'unknown');
    // Remember the shadow we just created: a later operand of the same
    // expression still carries the stale operator binding and has to be
    // rebound to it (see below).
    let shadowScope: Scope | null = ce.context.lexicalScope;
    while (shadowScope && !shadowScope.bindings.has(name))
      shadowScope = shadowScope.parent;
    const shadow = shadowScope?.bindings.get(name);
    if (shadow && isValueDef(shadow)) markDevolvedShadow(shadow);
    return ce.box(name);
  }
  // The name was already shadowed with a value BY THIS REPAIR (e.g. by a
  // previous operand of the same expression): rebind this occurrence to the
  // shadow. Any other value definition — in particular a user declaration —
  // is not a repair target.
  if (isValueDef(def) && isDevolvedShadow(def)) return ce.box(name);
  return null;
}

/**
 * Validation of arguments is normally done by checking the signature of the
 * function vs the arguments of the expression. However, we have a fastpath
 * for some common operations (add, multiply, power, neg, etc...) that bypasses
 * the regular checks. This is its replacements.
 *
 * Since all those fastpath functions are numeric (i.e. have numeric arguments
 * and a numeric result), we do a simple numeric check of all arguments, and
 * verify we have the number of expected arguments.
 *
 * We also assume that the function is threadable.
 *
 * The arguments are made canonical.
 *
 * Flattens sequence expressions.
 */
export function checkNumericArgs(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  options?: number | { count?: number; flatten?: string }
): ReadonlyArray<Expression> {
  let count = typeof options === 'number' ? options : options?.count;
  const flattenHead =
    typeof options === 'number' ? undefined : options?.flatten;

  // Ellipsis fold barrier: when a direct `ContinuationPlaceholder` operand is
  // present (a notational sum/product like `2 · 4 · … · 2n`), do not lift
  // nested associative operands — that would tear a coefficient out of its
  // anchor (the `2n` in `Multiply(2, n)`). Still lift `Sequence`/`Nothing`.
  if (flattenHead && ops.some((x) => isContinuationOperand(x)))
    ops = flatten(ops);
  else ops = flatten(ops, flattenHead);

  // @fastpath
  if (!ce.strict) {
    // Skip the full per-argument type checking below, but still pad a
    // missing *required* argument (when a `count` is specified, e.g.
    // `Negate`/`Power`/`Root`) with an `Error("missing")` marker. Leaving
    // it out entirely stores a raw JS `undefined` in the operand array,
    // which crashes the first time a `canonical`/`evaluate` handler
    // destructures that fixed-arity operand (e.g. `Negate()`, `Power(2)`)
    // instead of degrading gracefully like strict mode does.
    let xs: ReadonlyArray<Expression> = ops;
    if (count !== undefined && ops.length < count) {
      const padded = [...ops];
      while (padded.length < count) padded.push(ce.error('missing'));
      xs = padded;
    }
    let inferredType: Type = 'real';
    // If any of the arguments is a complex or imaginary number,
    // we'll infer the type as number
    for (const x of xs)
      if (couldBeNonRealNumber(x.type.type)) {
        inferredType = 'number';
        break;
      }
    // Numeric operators are threadable: an operand that could be a collection
    // at runtime (a `vector<n>`-returning application, `number | list`, a
    // tuple) is consumed by BROADCAST, so the scalar numeric context must not
    // be inferred onto it — `x.infer('real')` on a call whose inferred result
    // signature is already `vector<2>` WIDENS the shared definition to
    // `real | vector<2>`, and every later use of that function then types as
    // `number` (Tycho item 121: the compiled Sum then emits scalar `+` over
    // arrays). Mirrors the `couldBeCollectionOperand` guard on the
    // signature-validation route (`validateSignature`).
    for (const x of xs) if (!couldBeCollectionOperand(x)) x.infer(inferredType);
    return xs;
  }

  let isValid = true;

  count ??= ops.length;

  const xs: Expression[] = [];
  const last = Math.max(count - 1, ops.length - 1);
  for (let i = 0; i <= last; i++) {
    const op = ops[i];
    if (i > count - 1) {
      isValid = false;
      xs.push(ce.error('unexpected-argument', op.toString()));
    } else if (op === undefined) {
      isValid = false;
      xs.push(ce.error('missing'));
    } else if (!op.isValid) {
      isValid = false;
      xs.push(op);
    } else if (op.isNumber) {
      // The argument is a number literal or a function whose result is a number
      xs.push(op);
    } else if (op.operator === 'Quantity') {
      // Quantity expressions are accepted in arithmetic contexts;
      // the evaluate handler will handle unit arithmetic.
      xs.push(op);
    } else if (isSymbol(op) && !ce.lookupDefinition(op.symbol)) {
      // We have an unknown symbol, we'll infer it's a number later
      xs.push(op);
    } else if (op.type.isUnknown || op.type.type === 'any') {
      // Unknown or any type. Keep it that way, infer later
      xs.push(op);
    } else if (typeContainsMissing(op.type.type)) {
      // An absent (`Missing`) or possibly-absent (`T | missing`) operand in a
      // numeric position. Every numeric operator resolves to `propagate`
      // (§3.A), so admit it here — the runtime gate produces `NaN` in the
      // result cell (strip-before-validate, §3.B). Keeps the short path in
      // lockstep with the definition route for `Add`/`Multiply`/`Negate`/…
      xs.push(op);
    } else if (typeCouldBeNumericCollection(op.type.type)) {
      // The argument's type could be a numeric collection at runtime
      // (e.g. `list`, `number | list`). Since numeric functions are
      // threadable, accept it.
      xs.push(op);
    } else if (typeCouldBeNumericTuple(op.type.type)) {
      // The argument is a numeric tuple (point/vector in ℝⁿ). Accept it for
      // vector arithmetic (Add/Multiply/Negate/Subtract/Divide). Pass through
      // without inferring its elements to `real` (like the tensor branch).
      xs.push(op);
    } else if (isTensorValue(op)) {
      // The argument is a tensor (matrix or vector). Accept it for tensor
      // operations like element-wise addition. Tensor-specific validation
      // (shape compatibility, etc.) happens in the evaluate function.
      xs.push(op);
    } else if (isFiniteIndexedCollection(op)) {
      if (op.type.matches(INDEXED_COLLECTION_OF_NUMBER)) {
        // (1) The static type already proves every element is a number (mirror
        // the indeterminate-size branch below). Accept without walking.
        xs.push(op);
      } else if (typeIsProvablyNonNumericCollection(op.type.type)) {
        // (2) The static element type is concrete and provably non-numeric
        // (e.g. `indexed_collection<string>`). The element type already
        // disproves numericity, so reject WITHOUT walking. Derived from the
        // shared `typeIsProvablyNonNumericCollection` predicate so this stays
        // in lockstep with the `Add`/`Multiply` type handlers (item 30).
        isValid = false;
        xs.push(ce.typeError('number', op.type, op));
      } else if (op.isLazyCollection) {
        // (3) The static element type is indeterminate (`any`/`unknown`), and
        // this is a lazy collection: `.each()` would materialize every element
        // just to type-check it. For a large lazy source (item 16:
        // `\frac{[1...1e8]}{2}` hung `ce.parse`) that is O(size) at
        // canonicalization time — and the cost does not depend on free
        // variables. Accept on the strength of laziness REGARDLESS of
        // `unknowns` and defer element validation to evaluate time — fail-open:
        // a lazy weak-typed collection of non-numbers now fails at evaluate
        // rather than erroring at canonicalization.
        xs.push(op);
      } else {
        // (3, eager) An eager, operand-backed collection (e.g. a literal
        // `List`) with an indeterminate element type: its elements are already
        // stored, so walking is cheap. Check that all elements are numbers and
        // infer the type of the elements. Use a local flag: `isValid` may
        // already be false from an earlier operand, which must not brand this
        // one with a type error.
        let allNumbers = true;
        for (const x of op.each()) {
          // A function-valued symbol element is accepted without inference,
          // mirroring the scalar gate's treatment of a bare function symbol
          // in numeric position (`2·N` stays symbolic and valid). An
          // `unknown`-typed element is infer-later, mirroring the
          // unknown-operand branch above. Both keep pathological values like
          // `[N, 2N]` (a list capturing an operator symbol) OUT of the
          // element-inference path — the operator-definition corruption
          // guard (type-inference.test.ts) pins this.
          const xt = x.type.type;
          if (isSymbol(x) && typeof xt !== 'string' && xt.kind === 'signature')
            continue;
          if (x.type.isUnknown) continue;
          if (!x.isNumber) {
            allNumbers = false;
            break;
          }
        }
        if (!allNumbers) {
          isValid = false;
          xs.push(ce.typeError('number', op.type, op));
        } else xs.push(op);
      }
    } else if (
      op.isIndexedCollection &&
      op.isFiniteCollection === undefined &&
      op.type.matches(INDEXED_COLLECTION_OF_NUMBER)
    ) {
      // An indexed collection of numbers whose size is indeterminate (e.g.
      // `Range(1, n)` with symbolic `n`). Accept it for broadcasting on the
      // strength of the element type: iterating to validate the elements —
      // what the finite branch above does — is not possible here.
      xs.push(op);
    } else if (
      op.valueDefinition?.inferredType &&
      isSubtype('number', op.type.type)
    ) {
      // There was an inferred type, and it is a supertype of "number"
      // e.g. "any". We'll narrow it down to "number" when we infer later.
      xs.push(op);
    } else if (
      op.operatorDefinition?.inferredSignature &&
      isSubtype('number', op.type.type)
    ) {
      // There is an inferred signature, and it is a supertype of 'number
      // e.g. "any". We'll narrow it down to "number" when we infer later.
      xs.push(op);
    } else if (
      op.operator === 'Hold' ||
      op.valueDefinition?.value?.operator === 'Hold'
    ) {
      // We keep 'Hold' expressions as is
      xs.push(op);
    } else {
      // Last chance: an un-applied single-letter builtin operator (`N + 1`)
      // devolves to an unknown symbol (see devolveUnappliedOperator)
      const devolved = op.operatorDefinition
        ? devolveUnappliedOperator(ce, op)
        : null;
      if (devolved) xs.push(devolved);
      else {
        isValid = false;
        xs.push(ce.typeError('number', op.type, op));
      }
    }
  }

  // Only if all arguments are valid, we infer the type of the arguments
  if (isValid) {
    let inferredType: Type = 'real';
    // If any of the arguments is a complex number, we'll infer the type as `number`
    for (const x of xs)
      if (couldBeNonRealNumber(x.type.type)) {
        inferredType = 'number';
        break;
      }
    for (const x of xs)
      if (isFiniteIndexedCollection(x)) {
        // `.each()` on a *lazy* collection (e.g. a large `Range`) materializes
        // every element, so walking it just to run no-op inferences enumerates
        // the whole collection at parse time (item 16: `\frac{[1...1e8]}{2}`
        // hung `ce.parse`). Skip the walk for ANY lazy collection: the
        // materialization cost is O(size) and does NOT depend on free variables,
        // so a lazy source with a free variable (`Map(Range(1,2e5), x ↦ x+k)`)
        // must be skipped just like a variable-free `Range` — walking it just to
        // run element inferences that narrow nothing (`k` stays `unknown`) is
        // pure overhead. Element validation/inference is deferred to evaluate
        // time (fail-open), mirroring the admission-branch guard above. Eager
        // collections (e.g. a literal `List`) already store their elements as
        // operands, so walking them is cheap regardless of `unknowns`:
        // `BoxedFunction.infer()` also narrows an inferred *result signature*
        // (not just free symbols), so a concrete literal list containing an
        // inferred function call still needs the walk.
        if (x.isLazyCollection) continue;
        for (const y of x.each()) y.infer(inferredType);
      } else if (!couldBeCollectionOperand(x)) x.infer(inferredType);
    // A possibly-collection operand (a `vector<n>`-returning application,
    // `number | list`, a tuple) is consumed by broadcast: inferring the
    // scalar numeric context onto it would WIDEN a shared inferred result
    // signature to `real | vector<…>` (Tycho item 121) — same guard as the
    // signature-validation route above.
  }

  return xs;
}

/**
 * Check that an argument is of the expected type.
 *
 * Converts the arguments to canonical
 */
export function checkType(
  ce: ComputeEngine,
  arg: Expression | undefined | null,
  type: Type | undefined
): Expression {
  if (arg === undefined || arg === null) return ce.error('missing');
  if (type === undefined)
    return ce.error('unexpected-argument', arg.toString());

  arg = arg.canonical;

  if (!arg.isValid) return arg;

  if (arg.type.matches(type)) return arg;

  // Value-component type (`0`, `integer<0..10>`): tri-state admission —
  // membership or undecidability admits; only proven refutation errors.
  // See `value-membership.ts`.
  if (hasValueComponent(type) && admissionOf(arg, type) !== 'refute')
    return arg;

  // Broadcastable operand: could be a plain scalar at runtime, admit it.
  if (broadcastableBaseMatches(arg.type.type, type)) return arg;

  // Overlap-deferred validation (§D6.2) — see validateArguments.
  if (overlapsForDeferredValidation(arg.type.type, type)) return arg;

  return ce.typeError(type, arg.type, arg);
}

export function checkTypes(
  ce: ComputeEngine,
  args: ReadonlyArray<Expression>,
  types: Type[]
): ReadonlyArray<Expression> {
  // Do a quick check for the common case where everything is as expected.
  // Avoid allocating arrays and objects
  if (
    args.length === types.length &&
    args.every((x, i) => x.type.matches(types[i]))
  )
    return args;

  const xs: Expression[] = [];
  for (let i = 0; i <= types.length - 1; i++)
    xs.push(checkType(ce, args[i], types[i]));

  for (let i = types.length; i <= args.length - 1; i++)
    xs.push(ce.error('unexpected-argument', args[i].toString()));

  return xs;
}

/**
 * Check that the argument is pure.
 */
export function checkPure(
  ce: ComputeEngine,
  arg: Expression | Expression | undefined | null
): Expression {
  if (arg === undefined || arg === null) return ce.error('missing');
  arg = arg.canonical;
  if (!arg.isValid) return arg;
  if (arg.isPure) return arg;
  return ce.error('expected-pure-expression', arg.toString());
}

/**
 *
 * If the arguments match the parameters, return null.
 *
 * Otherwise return a list of expressions indicating the mismatched
 * arguments.
 *
 * <!--
 * @todo?:
 * - Some permutations of operands should perhaps always be treated as invalid. Consider:
 *   - A sequence wildcard (non-optional, i.e. '__') followed by either a universal wildcard ('_'),
 *   or another non-optional sequence wildcard. (note that an optional sequence wildcard is
 *   unproblematic here.)
 *
 * -->
 *
 */
/**
 * Strip-before-validate decision (§3.B): at a stripped position, an operand
 * carrying a `missing` arm is admitted iff its stripped type still matches the
 * parameter. A Missing-free operand (`typeContainsMissing` false) is never
 * touched, so the lift is invisible to Missing-free programs.
 */
function strippedMatchesParam(
  op: Expression,
  param: Type,
  idx: number,
  stripMissing?: (index: number) => boolean
): boolean {
  if (!stripMissing?.(idx)) return false;
  if (!typeContainsMissing(op.type.type)) return false;
  const stripped = stripMissingFromType(op.type.type);
  return stripped === 'never' || isSubtype(stripped, param);
}

export function validateArguments(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  signature: Type,
  lazy?: boolean,
  threadable?: boolean,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>,
  /** Strip-before-validate (§3.B of the missing-value typing design): for a
   * position where this predicate returns `true`, an operand carrying a
   * `missing` arm is admitted when its stripped type still matches the
   * parameter (a scalar `Missing` → `never`, admissible everywhere). The
   * missing arm is carried by the runtime gate, not the type. */
  stripMissing?: (index: number) => boolean
): ReadonlyArray<Expression> | null {
  // A `Spread` operand (`f(...p)`) makes the effective arity unknown until
  // the enclosing call's evaluation splices the tuple's elements in — defer
  // ALL validation (including the non-strict missing-argument padding below)
  // to that runtime re-validation. Must precede the non-strict fastpath: the
  // padding would otherwise treat `f(...p)` as an arity-1 call.
  if (ops.some((x) => x.operator === 'Spread')) return null;

  // @fastpath
  if (!ce.strict) {
    // Skip the full per-parameter type checking below, but still pad a
    // missing *required* argument with an `Error("missing")` marker.
    // Returning `null` unconditionally here (the previous behavior) tells
    // the caller "use the operands as-is", so a genuinely missing argument
    // (e.g. `Arctan()`) left a fixed-arity `evaluate` handler destructuring
    // past the end of the operand array — a raw JS `undefined` rather than
    // a boxed error, which crashes instead of degrading gracefully.
    if (typeof signature !== 'string' && signature.kind === 'signature') {
      const requiredCount = signature.args?.length ?? 0;
      if (ops.length < requiredCount) {
        const xs = [...ops];
        while (xs.length < requiredCount) xs.push(ce.error('missing'));
        return xs;
      }
    } else {
      // Overload set: pad only up to the SMALLEST required count across the
      // arms. An arm needing more is simply not the one being called; padding
      // to the largest would manufacture `Error("missing")` operands for a
      // perfectly well-formed call to a shorter arm.
      const arms = overloadArms(signature);
      if (arms) {
        const requiredCount = Math.min(...arms.map((a) => a.args?.length ?? 0));
        if (ops.length < requiredCount) {
          const xs = [...ops];
          while (xs.length < requiredCount) xs.push(ce.error('missing'));
          return xs;
        }
      }
    }
    return null;
  }

  if (typeof signature === 'string') return null;

  // An intersection of signatures is an overload set. Resolve it to a single
  // arm and validate against that (`docs/plans/2026-07-25-overload-resolution
  // -design.md`). Resolution is write-free (§4.2), so no symbol is mutated on
  // account of an arm that is subsequently rejected.
  //
  // `viable` (not `selected`) drives the operand inference at the bottom of
  // this function: the result type comes from the most-specific arm, but the
  // constraint pushed back into an operand must be the JOIN over every arm
  // that survived (§4.3). Those pull in opposite directions.
  let sig: FunctionSignature;
  let viableArms: ReadonlyArray<FunctionSignature> | undefined;
  if (signature.kind === 'signature') {
    sig = signature;
  } else {
    const arms = overloadArms(signature);
    if (!arms) return null;
    // Every admission policy this function applies must reach the filter, or
    // the filter and the validator disagree about which arms are viable — a
    // disagreement that mis-selects arms rather than merely widening the join.
    const policies = {
      lazy,
      threadable,
      couldBeCollection: couldBeCollectionOperand,
      stripMissing,
      freshMatrixRepair: (op: Expression, param: Type) =>
        couldRepairFreshMatrixInference(ce, op, param, freshlyInferred),
    };
    const { selected, viable } = resolveOverload(ce, ops, arms, policies);
    if (!selected) {
      // No arm fits. Blame the operands actually at fault: an operand every
      // near-miss arm accepts at its position stays untouched, so a bad seed
      // does not also indict a perfectly good domain argument.
      const { arityViable, arityTarget, refuted } = diagnoseNoMatch(
        ce,
        ops,
        arms,
        policies
      );
      if (arityViable.length === 0) {
        // Wrong number of arguments for every arm. `arityTarget` is the
        // NEAREST accepted count, which also covers a gap in the accepted set
        // (arms of arity 1 and 3 called with 2) — the previous global
        // min/max bracketing waved those through with no marker at all.
        const target = arityTarget ?? ops.length;
        const xs: Expression[] = ops.map((op, idx) =>
          idx < target ? op : ce.error('unexpected-argument', op.toString())
        );
        while (xs.length < target) xs.push(ce.error('missing'));
        return xs;
      }
      const blamed = ops.map((op, idx) => {
        const expected = refuted.get(idx);
        return expected === undefined
          ? op
          : ce.typeError(expected, op.type, op);
      });
      // Invariant: a call with no selected arm must never come back fully
      // valid. `diagnoseNoMatch` guarantees a non-empty `refuted` whenever an
      // arm was arity-viable, so this is a backstop against a future
      // regression rather than an expected path.
      if (blamed.every((x) => x.isValid))
        blamed[0] = ce.error('unexpected-argument', ops[0]?.toString() ?? '');
      return blamed;
    }
    sig = selected;
    viableArms = viable;
  }

  const result: Expression[] = [];
  let isValid = true;
  // Set when an operand was replaced (devolved to an unknown symbol, or
  // repaired by matrix inference). The substituted list must then be returned
  // even if validation succeeds: returning `null` tells the caller to use the
  // original operands, and the original boxed symbol keeps its stale operator
  // binding (`N \equiv 1 \pmod k` stayed bound to the builtin `N`, so a later
  // `N := 11` was invisible to the expression).
  let substituted = false;

  // Positions accepted via overlap-deferred validation (§D6.2): acceptance
  // is an unrefuted possibility, not a proof, so these positions are
  // excluded from the final `infer(param)` narrowing below — narrowing an
  // inferred symbol to `matrix` on the strength of a guess would
  // over-constrain unrelated later uses.
  const deferredIdx = new Set<number>();

  const params = sig.args?.map((x) => x.type) ?? [];
  const optParams = sig.optArgs?.map((x) => x.type) ?? [];
  const varParam = sig.variadicArg?.type;
  const varParamCount = sig.variadicMin ?? 0;

  /** The type to infer into the operand at `idx`. For a plain signature this
   * is the parameter itself; for an overload set it is the JOIN over every
   * viable arm (§4.3) — never the selected arm's parameter, which would
   * over-constrain the symbol (§4.5). */
  const inferenceTypeAt = (idx: number, param: Type): Type | undefined =>
    viableArms ? joinParamAt(viableArms, idx) : param;

  let i = 0;

  // Iterate over any required parameters
  for (const param of params) {
    const idx = i;
    const op = ops[i++];
    if (!op) {
      result.push(ce.error('missing'));
      isValid = false;
      continue;
    }
    if (lazy) {
      result.push(op);
      continue;
    }
    if (!op.isValid) {
      result.push(op);
      isValid = false;
      continue;
    }
    if (op.type.isUnknown || op.type.type === 'any') {
      // An expression with an unknown or any type is assumed to be valid,
      // we'll infer the type later
      result.push(op);
      continue;
    }
    if (threadable && couldBeCollectionOperand(op)) {
      result.push(op);
      continue;
    }
    if (op.valueDefinition?.inferredType && op.type.matches(param)) {
      result.push(op);
      continue;
    }

    // The symbol's type was inferred (not declared), and the required type is
    // a subtype of the current inferred type. Narrowing is sound, so narrow
    // the symbol's type rather than erroring (e.g. `B` inferred as `value`
    // from `SetMinus(A, B)`, later required as `set` in `SetMinus(B, A)`).
    // NOT on the effect axis: see `narrowingPreservesEffects`. NOT to a
    // value-component type (`0`, `integer<0..10>`): one call requiring the
    // value does not prove the symbol always holds it — pinning `k: 0` from
    // `g(k)` would over-constrain every later use. Membership (below)
    // admits the concrete-witness case instead, without the write.
    if (
      op.valueDefinition?.inferredType &&
      isSubtype(param, op.type.type) &&
      !hasValueComponent(param) &&
      narrowingPreservesEffects(op.type.type, param)
    ) {
      op.infer(param, 'narrow');
      result.push(op);
      continue;
    }

    if (op.operatorDefinition?.inferredSignature && op.type.matches(param)) {
      result.push(op);
      continue;
    }

    // A broadcastable operand whose scalar base matches the parameter could
    // be a plain scalar at runtime: admit it (see broadcastableBaseMatches).
    if (broadcastableBaseMatches(op.type.type, param)) {
      result.push(op);
      continue;
    }

    if (!op.type.matches(param)) {
      // Value-component parameter (`0`, `integer<0..10>`): tri-state
      // admission (§4.4). A concrete value passing membership ADMITS; a
      // symbolic operand that is not provably disjoint is UNDECIDABLE and
      // is provisionally admitted (the call could be fine — dispatch stays
      // open until the value is known); only proven refutation errors.
      // Mirrored in `paramMatches` (overload.ts). Deferred like the other
      // provisional admissions: the final `infer(param)` pass must not
      // narrow a symbol's type to the VALUE type (`k := 0; g(k)` would
      // otherwise pin `k: 0`).
      if (hasValueComponent(param) && admissionOf(op, param) !== 'refute') {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      // Strip-before-validate (§3.B): admit an operand carrying a `missing`
      // arm whose stripped type still matches the parameter. Accepted
      // provisionally (added to `deferredIdx`) so the final `infer(param)`
      // narrowing does not widen an unconstrained symbol (I4).
      if (strippedMatchesParam(op, param, idx, stripMissing)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      const repaired = repairFreshMatrixInference(
        ce,
        op,
        param,
        freshlyInferred
      );
      if (repaired) {
        result.push(repaired);
        substituted = true;
        continue;
      }
      // A bare uppercase symbol bound to a standard-library operator (`N`,
      // `D`) used where a value is required almost always means a variable
      // (`N \equiv 1 \pmod k`): devolve it to an unknown symbol, mirroring
      // the checkNumericArgs fallback.
      const devolved = devolveUnappliedOperator(ce, op);
      if (devolved !== null) {
        result.push(devolved);
        substituted = true;
        continue;
      }
      // Overlap-deferred validation (§D6.2): a collection-kind parameter and
      // an operand whose static type does not REFUTE conformance (bare
      // `list`, unknown elements, `broadcastable<R>`, rank-compatible
      // nested lists) is accepted provisionally; runtime conformance is the
      // operator's own evaluate-time gate (handler precedence — a
      // nonconforming or still-symbolic operand stays inert or gets the
      // handler's specific error, e.g. `expected-square-matrix`).
      if (overlapsForDeferredValidation(op.type.type, param)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      result.push(ce.typeError(param, op.type, op));
      isValid = false;
      continue;
    }
    result.push(op);
  }

  // Iterate over any optional parameters
  for (const param of optParams) {
    const op = ops[i];
    if (!op) {
      // No more ops, we're done
      break;
    }
    if (lazy) {
      result.push(op);
      i += 1;
      continue;
    }
    if (!op.isValid) {
      result.push(op);
      isValid = false;
      i += 1;
      continue;
    }
    if (op.type.isUnknown || op.type.type === 'any') {
      // An expression with an unknown or any type is assumed to be valid,
      // we'll infer the type later
      result.push(op);
      i += 1;
      continue;
    }
    if (threadable && couldBeCollectionOperand(op)) {
      result.push(op);
      i += 1;
      continue;
    }
    if (op.valueDefinition?.inferredType && op.type.matches(param)) {
      // There was an inferred type, and it is contravariant with `number`
      // e.g. "any". We'll narrow it down to `number` when we infer later.
      result.push(op);
      i += 1;
      continue;
    }
    // Inferred (not declared) symbol type, and the required type is a subtype
    // of the current inferred type: narrow rather than error. NOT on the
    // effect axis (`narrowingPreservesEffects`); NOT to a value-component
    // type (see the required-param gate).
    if (
      op.valueDefinition?.inferredType &&
      isSubtype(param, op.type.type) &&
      !hasValueComponent(param) &&
      narrowingPreservesEffects(op.type.type, param)
    ) {
      op.infer(param, 'narrow');
      result.push(op);
      i += 1;
      continue;
    }
    // Broadcastable operand: could be a plain scalar at runtime, admit it.
    if (broadcastableBaseMatches(op.type.type, param)) {
      result.push(op);
      i += 1;
      continue;
    }
    if (!op.type.matches(param)) {
      // Value-component tri-state admission — see the required-param gate
      // (deferred: the final inference pass must not narrow a symbol to the
      // value type).
      if (hasValueComponent(param) && admissionOf(op, param) !== 'refute') {
        result.push(op);
        deferredIdx.add(result.length - 1);
        i += 1;
        continue;
      }
      // Strip-before-validate (§3.B) — see the required-param gate.
      if (strippedMatchesParam(op, param, i, stripMissing)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        i += 1;
        continue;
      }
      // Overlap-deferred validation (§D6.2) — see the required-param gate.
      if (overlapsForDeferredValidation(op.type.type, param)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        i += 1;
        continue;
      }
      result.push(ce.typeError(param, op.type, op));
      isValid = false;
      i += 1;
      continue;
    }
    result.push(op);
    i += 1;
  }

  // Iterate over any remaining ops
  if (varParam) {
    let additionalParam = 0;
    for (const op of ops.slice(i)) {
      i += 1;
      additionalParam += 1;
      if (lazy) {
        result.push(op);
        continue;
      }
      if (!op.isValid) {
        result.push(op);
        isValid = false;
        continue;
      }
      if (op.type.isUnknown || op.type.type === 'any') {
        // An expression with an unknown or any type is assumed to be valid,
        // we'll infer the type later
        result.push(op);
        continue;
      }
      if (threadable && couldBeCollectionOperand(op)) {
        result.push(op);
        continue;
      }
      if (op.valueDefinition?.inferredType && op.type.matches(varParam)) {
        // There was an inferred type, and it is contravariant with `number`
        // e.g. "any". We'll narrow it down `number` to  when we infer later.
        result.push(op);
        continue;
      }
      // Inferred (not declared) symbol type, and the required variadic type is
      // a subtype of the current inferred type: narrow rather than error. NOT
      // on the effect axis (`narrowingPreservesEffects`); NOT to a
      // value-component type (see the required-param gate).
      if (
        op.valueDefinition?.inferredType &&
        isSubtype(varParam, op.type.type) &&
        !hasValueComponent(varParam) &&
        narrowingPreservesEffects(op.type.type, varParam)
      ) {
        op.infer(varParam, 'narrow');
        result.push(op);
        continue;
      }
      // Broadcastable operand: could be a plain scalar at runtime, admit it.
      if (broadcastableBaseMatches(op.type.type, varParam)) {
        result.push(op);
        continue;
      }
      if (!op.type.matches(varParam)) {
        // Value-component tri-state admission — see the required-param gate
        // (deferred: the final inference pass must not narrow a symbol to
        // the value type).
        if (
          hasValueComponent(varParam) &&
          admissionOf(op, varParam) !== 'refute'
        ) {
          result.push(op);
          deferredIdx.add(result.length - 1);
          continue;
        }
        // Strip-before-validate (§3.B) — see the required-param gate. The
        // operand index is `i - 1` (already incremented at the loop top).
        if (strippedMatchesParam(op, varParam, i - 1, stripMissing)) {
          result.push(op);
          deferredIdx.add(result.length - 1);
          continue;
        }
        // Overlap-deferred validation (§D6.2) — see the required-param gate.
        if (overlapsForDeferredValidation(op.type.type, varParam)) {
          result.push(op);
          deferredIdx.add(result.length - 1);
          continue;
        }
        result.push(ce.typeError(varParam, op.type, op));
        isValid = false;
        continue;
      }
      result.push(op);
    }
    if (additionalParam < varParamCount) {
      // We didn't get enough parameters for the variadic argument
      result.push(ce.error('missing'));
      isValid = false;
    }
  }

  // Are there any remaining parameters?
  if (i < ops.length) {
    for (const op of ops.slice(i)) {
      result.push(ce.error('unexpected-argument', op.toString()));
      isValid = false;
    }
  }

  if (!isValid) return result;

  //
  // All arguments are valid, we can infer the domain of the arguments
  //
  // When an operand was substituted, infer on (and return) the substituted
  // list: `result` and `ops` are index-aligned on the valid path (one entry
  // pushed per consumed operand).
  const finalOps = substituted ? result : ops;
  i = 0;
  for (const param of params) {
    const t = inferenceTypeAt(i, param);
    if (t !== undefined && !lazy && !deferredIdx.has(i))
      if (!threadable || !couldBeCollectionOperand(finalOps[i]))
        finalOps[i].infer(t);
    i += 1;
  }
  for (const param of optParams) {
    if (!finalOps[i]) break;
    const t = inferenceTypeAt(i, param);
    if (t !== undefined && !lazy && !deferredIdx.has(i))
      if (!threadable || !couldBeCollectionOperand(finalOps[i]))
        finalOps[i].infer(t);
    i += 1;
  }
  if (varParam) {
    for (const op of finalOps.slice(i)) {
      const t = inferenceTypeAt(i, varParam);
      if (t !== undefined && !lazy && !deferredIdx.has(i))
        if (!threadable || !couldBeCollectionOperand(op)) op.infer(t);
      i += 1;
    }
  }
  return substituted ? result : null;
}

/**
 * Would a `matrix` argument satisfy this parameter? The repair below rewrites
 * its operands to `matrix`, so this — not "is the parameter type itself a
 * matrix" — is its entry gate. The direction matters for a UNION parameter
 * (`LinearSolve`'s `matrix | vector`): a union is assignable to `R` only when
 * EVERY arm is, so `matrix | vector` does not match `matrix`, while `matrix`
 * *is* assignable to `matrix | vector`. The reversed spelling silently
 * declined the repair for every union-typed parameter.
 */
function acceptsMatrix(ce: ComputeEngine, expected: Type): boolean {
  return ce.type('matrix').matches(expected);
}

/**
 * The **write-free** precondition of {@link repairFreshMatrixInference}: true
 * when the repair could apply to this operand/parameter pair.
 *
 * The repair itself mutates definitions, re-boxes, and rolls back on failure,
 * so overload resolution — which must not write (§4.2 of the overload design)
 * — cannot run it to find out. It consults this instead. Deliberately
 * conservative in the ADMITTING direction: it checks the repair's own
 * entry gates (a `matrix`-ish parameter, at least one fresh eligible symbol,
 * and a non-empty structural plan) but not whether the re-box would actually
 * produce a conforming type. An arm kept on a repair that then fails is handed
 * to full validation, which produces the error — exactly what happens for a
 * plain signature. Refusing to model the repair at all would be worse: an
 * operand a plain signature repairs and accepts would silently match no arm.
 */
function couldRepairFreshMatrixInference(
  ce: ComputeEngine,
  op: Expression,
  expected: Type,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
): boolean {
  if (!freshlyInferred || !acceptsMatrix(ce, expected)) return false;

  const eligible = new Set<string>();
  for (const name of op.freeVariables) {
    const def = ce.lookupDefinition(name);
    if (!def || !isValueDef(def) || !def.value.inferredType) continue;
    if (freshlyInferred.has(def.value) || def.value.type.isUnknown)
      eligible.add(name);
  }
  if (eligible.size === 0) return false;

  const names = matrixInferencePlan(op, eligible);
  return names !== null && names.size > 0;
}

/**
 * Repair bottom-up numeric inference when a matrix-consuming operator gives
 * the enclosing context that was unavailable to Add/Multiply. Only symbols
 * first inferred while canonicalizing this argument are eligible. The repair
 * is deliberately structural and fail-closed: an ambiguous product such as
 * `a A` (both names fresh) is not guessed.
 *
 * Its write-free entry gates are factored into
 * {@link couldRepairFreshMatrixInference} so overload resolution can consult
 * them without mutating; keep the two in step.
 */
function repairFreshMatrixInference(
  ce: ComputeEngine,
  op: Expression,
  expected: Type,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
): Expression | null {
  if (!freshlyInferred || !acceptsMatrix(ce, expected)) return null;

  const eligible = new Set<string>();
  for (const name of op.freeVariables) {
    const def = ce.lookupDefinition(name);
    if (!def || !isValueDef(def) || !def.value.inferredType) continue;
    // "Fresh" = the definition's type was first inferred (unknown → concrete)
    // during this boxing operation — the forward log recorded by
    // `BoxedSymbol.infer()` — or is still unknown (never inferred; the
    // previous snapshot-based provenance excluded unknown-typed definitions
    // from "inferred before", making them always eligible). Keying on the
    // definition's identity rather than its name also means a symbol whose
    // fresh inner-scope definition has been popped, and which now resolves to
    // an outer definition inferred before this box, is correctly ineligible.
    if (freshlyInferred.has(def.value) || def.value.type.isUnknown)
      eligible.add(name);
  }
  if (eligible.size === 0) return null;

  const names = matrixInferencePlan(op, eligible);
  if (!names || names.size === 0) return null;

  const previous = new Map<string, Type>();
  for (const name of names) {
    const def = ce.lookupDefinition(name);
    if (!def || !isValueDef(def) || !def.value.inferredType) return null;
    previous.set(name, def.value.type.type);
    def.value.type = ce.type('matrix');
    // Freeze the contextual assignment during re-canonicalization so the
    // numeric fast path cannot immediately narrow it back to `real`.
    def.value.inferredType = false;
  }
  ce._generation += 1;
  ce._mutationGeneration += 1;
  ce._semanticEpoch += 1;

  const repaired = ce.box(op.json);
  if (repaired.type.matches(expected)) {
    for (const name of names) {
      const def = ce.lookupDefinition(name);
      if (def && isValueDef(def)) def.value.inferredType = true;
    }
    return repaired;
  }

  for (const [name, type] of previous) {
    const def = ce.lookupDefinition(name);
    if (def && isValueDef(def)) {
      def.value.type = ce.type(type);
      def.value.inferredType = true;
    }
  }
  ce._generation += 1;
  ce._mutationGeneration += 1;
  ce._semanticEpoch += 1;
  return null;
}

function matrixInferencePlan(
  expr: Expression,
  eligible: ReadonlySet<string>
): Set<string> | null {
  if (isSymbol(expr))
    return eligible.has(expr.symbol) ? new Set([expr.symbol]) : null;

  if (!isFunction(expr)) return null;

  if (expr.operator === 'Negate')
    return matrixInferencePlan(expr.op1, eligible);

  if (expr.operator === 'Add' || expr.operator === 'Subtract') {
    const result = new Set<string>();
    for (const term of expr.ops) {
      const plan = matrixInferencePlan(term, eligible);
      if (!plan) return null;
      for (const name of plan) result.add(name);
    }
    return result;
  }

  if (expr.operator === 'Multiply') {
    const candidates = expr.ops
      .map((factor) => matrixInferencePlan(factor, eligible))
      .filter((x): x is Set<string> => x !== null);
    // Numeric literals and already-declared scalar factors may scale the one
    // matrix factor. More than one candidate is underdetermined (`a A`).
    if (candidates.length !== 1) return null;
    return candidates[0];
  }

  if (expr.operator === 'Power' && expr.op2?.isInteger === true)
    return matrixInferencePlan(expr.op1, eligible);

  return null;
}

/** Recursively examine the symbols and operators and for any
 * that don't have a definition, suggest an alternative name.
 */
function spellcheckSymbols(expr: Expression): Record<string, string> {
  const { symbols, operators } = getKnownNames(expr.engine);
  const suggestions: Record<string, string> = {};

  const visit = (expr: Expression): void => {
    if (isSymbol(expr) && !expr.symbol.startsWith('_')) {
      if (!(expr.symbol in suggestions) && !symbols.includes(expr.symbol)) {
        const match = fuzzyStringMatch(expr.symbol, symbols);
        if (match) suggestions[expr.symbol] = match;
      }
    } else if (isFunction(expr) && !expr.operator.startsWith('_')) {
      const operator = expr.operator;
      if (!(operator in suggestions) && !operators.includes(operator)) {
        const match = fuzzyStringMatch(operator, operators);
        if (match) suggestions[operator] = match;
      }
      for (const op of expr.ops) visit(op);
    }
  };

  visit(expr);
  return suggestions;
}

/** Collect, in a single walk of the scope chain, the names of all known
 * symbols (value defs) and operators (operator defs) visible in the current
 * scope. A name bound to both appears in both lists. */
function getKnownNames(ce: ComputeEngine): {
  symbols: string[];
  operators: string[];
} {
  const symbols: string[] = [];
  const operators: string[] = [];
  let currentScope: Scope | null = ce.context.lexicalScope;
  while (currentScope) {
    for (const [key, def] of currentScope.bindings) {
      if (isValueDef(def)) symbols.push(key);
      if (isOperatorDef(def)) operators.push(key);
    }
    currentScope = currentScope.parent;
  }

  return { symbols, operators };
}

export function spellCheckMessage(expr: Expression): string {
  const suggestions = spellcheckSymbols(expr);
  if (Object.keys(suggestions).length === 0) return '';

  if (Object.keys(suggestions).length === 1) {
    const [symbol, suggestion] = Object.entries(suggestions)[0];
    return `Unknown symbol "${symbol}". Did you mean "${suggestion}"?`;
  }

  const lines: string[] = [];
  for (const [symbol, suggestion] of Object.entries(suggestions)) {
    lines.push(`- "${symbol}" -> "${suggestion}"?`);
  }
  return `Unknown symbols found:\n${lines.join('\n')}`;
}
