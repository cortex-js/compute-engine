import {
  couldBeUnkeyedCollectionOperand,
  isFiniteIndexedCollection,
  typeCouldBeCollection,
  typeCouldBeNumericCollection,
  typeCouldBeNumericTuple,
  typeIsProvablyNonNumericCollection,
} from '../collection-utils.js';

import { flatten, flattenHoldingBarriers } from './flatten.js';
import { functionLiteralParameterType } from './function-literal.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import { callbackArityError } from './callback-arity.js';
import { callbackIncompatibility } from '../../common/type/compatibility.js';
import { admissionOf, hasValueComponent } from './value-membership.js';
import {
  broadcastableBaseMatches,
  collectionElementType,
  couldBeNonRealNumber,
  narrowingPreservesEffects,
  overlapsForDeferredValidation,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import {
  diagnoseNoMatch,
  arityBounds,
  armArityCapable,
  isRepairableOperatorSymbol,
  joinParamAt,
  overloadArms,
  resolveOverload,
  type ArmTrialFn,
  type OverloadResolution,
} from './overload.js';
import { parseType } from '../../common/type/parse.js';
import { typeToString } from '../../common/type/serialize.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  freeTypeVariables,
  parameterPositions,
  type TypeInferenceResult,
} from '../../common/type/instantiate.js';
import {
  instantiatedParam,
  isThreadableAt,
  polytypeArm,
  solveArm,
  type Threadable,
} from './generic-instantiation.js';
import { FunctionSignature, Type } from '../../common/type/types.js';
import { adoptTopPlaceholderSlots } from './effects-inference.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
  BoxedValueDefinition,
  TypeProvenanceEntry,
} from '../global-types.js';
import { recordTypeProvenance, currentBoxingEpoch } from './type-provenance.js';
import {
  activeRollbackFrame,
  repairsForbiddenByRollbackFrame,
} from '../inference-rollback.js';
import { fuzzyStringMatch } from '../../common/fuzzy-string-match.js';
import { isOperatorDef, isValueDef } from './utils.js';
import { isTensorValue } from './tensor-view.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import {
  isSymbol,
  isFunction,
  isString,
  isContinuationOperand,
  containsContinuationOperand,
} from './type-guards.js';
import { narrowStringLiteralToCharacter } from './boxed-character.js';

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

// `couldBeUnkeyedCollectionOperand` moved to `collection-utils.ts` alongside
// the sibling COULD-semantics predicates, so validation, overload resolution
// and result typing share ONE definition — a private copy here would let the
// resolution used for validation admit different arms from the one used for
// result typing.

/**
 * Exclusion gate for scalar numeric INFERENCE — deliberately WIDER than
 * broadcast admission (`couldBeUnkeyedCollectionOperand`). The hazard the
 * gate prevents is keyedness-independent: `x._infer('real')` on an operand
 * whose inferred result signature is collection-shaped WIDENS the shared
 * definition (Tycho item 121), and a `dictionary<…>`-shaped signature is
 * corrupted by that write exactly as a `vector<2>` one is. So ANY operand
 * that is, or could be, a collection of any kind is excluded from the
 * scalar inference — even though only the unkeyed ones are ever consumed
 * by broadcast.
 */
function excludedFromScalarInference(op: Expression): boolean {
  return op.isCollection || typeCouldBeCollection(op.type.type);
}

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
  // Must never execute inside a repair-FORBIDDING rollback frame — phase
  // 2c's trial validation, which admits a repairable operand by
  // `isRepairableOperatorSymbol` without running the repair. An ORDINARY
  // frame (the Epsil static checking pass) legitimately reaches this: the
  // shadow declaration below routes through `ce.declare`, which the
  // declaration journal family rolls back.
  console.assert(
    !repairsForbiddenByRollbackFrame(ce),
    'devolveUnappliedOperator must not run in trial (repair-free) validation'
  );
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
    // A top-level `ce.assign('F', x ↦ x²)` hoists its definition into the
    // same parentless scope as the standard library, so scope position alone
    // cannot tell a builtin from a user function. Discriminate on the
    // definition's ORIGIN: a definition backed by a user-defined function
    // literal is a genuine user function — using it as a numeric operand must
    // surface `incompatible-type`, not silently shadow the function (which
    // would also turn a later `F(2)` into the product `2F`).
    if (
      def.operator instanceof _BoxedOperatorDefinition &&
      def.operator._isLambda
    )
      return null;
    ce.declare(name, 'unknown');
    // Remember the shadow we just created: a later operand of the same
    // expression still carries the stale operator binding and has to be
    // rebound to it (see below).
    let shadowScope: Scope | null = ce.context.lexicalScope;
    while (shadowScope && !shadowScope.bindings.has(name))
      shadowScope = shadowScope.parent;
    const shadow = shadowScope?.bindings.get(name);
    if (shadowScope && shadow && isValueDef(shadow)) {
      shadow.value._isDevolvedShadow = true;
      ce._boxingState.noteDevolvedShadow(shadowScope);
    }
    return ce.box(name);
  }
  // The name was already shadowed with a value BY THIS REPAIR (e.g. by a
  // previous operand of the same expression): rebind this occurrence to the
  // shadow. Any other value definition — in particular a user declaration —
  // is not a repair target.
  if (isValueDef(def) && def.value._isDevolvedShadow) return ce.box(name);
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
  else if (flattenHead && ops.some((x) => containsContinuationOperand(x))) {
    // Depth-aware barrier (mirrors `canonicalMultiply`): a nested product may
    // carry its ellipsis at any depth — e.g. raw-boxed
    // `Multiply(Multiply(a, Multiply(b, ContinuationPlaceholder)), c)` — and,
    // since `flatten` descends `Sequence` too, it may also sit behind a
    // `Sequence` wrapper. Splicing either would smuggle the placeholder past
    // the direct-operand check above. Hold barrier-bearing products back
    // whole; everything else still flattens.
    ops = flattenHoldingBarriers(ops, flattenHead);
  } else ops = flatten(ops, flattenHead);

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
    // be inferred onto it — `x._infer('real')` on a call whose inferred result
    // signature is already `vector<2>` WIDENS the shared definition to
    // `real | vector<2>`, and every later use of that function then types as
    // `number` (Tycho item 121: the compiled Sum then emits scalar `+` over
    // arrays). The exclusion is wider than admission — see
    // `excludedFromScalarInference` — and mirrors the guard on the
    // signature-validation route (`validateSignature`).
    for (const x of xs)
      if (!excludedFromScalarInference(x)) x._infer(inferredType);
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
    } else if (op.type.couldMatch('number')) {
      // The declared type overlaps `number` — a wide value type (`value`,
      // `scalar`) or a union with a numeric arm (`integer | string`). The
      // operand COULD be a number, so admit it: arithmetic operators are
      // permissive at boxing time and reject a non-numeric value at
      // evaluation time. (Types with their own admission story — collections,
      // tuples, tensors, `any`/`unknown` — are handled by the branches
      // above; disjoint types like `string` or `boolean` still error here.)
      // Note the post-validation `_infer` pass below is a no-op for these:
      // an explicitly declared type is never rewritten by a use.
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
        // so a lazy source with a free variable (`Map(x ↦ x+k, Range(1,2e5))`)
        // must be skipped just like a variable-free `Range` — walking it just to
        // run element inferences that narrow nothing (`k` stays `unknown`) is
        // pure overhead. Element validation/inference is deferred to evaluate
        // time (fail-open), mirroring the admission-branch guard above. Eager
        // collections (e.g. a literal `List`) already store their elements as
        // operands, so walking them is cheap regardless of `unknowns`:
        // `BoxedFunction._infer()` also narrows an inferred *result signature*
        // (not just free symbols), so a concrete literal list containing an
        // inferred function call still needs the walk.
        if (x.isLazyCollection) continue;
        // An ELEMENT that is itself a collection is consumed by NESTED
        // broadcast, not as a scalar, so it gets the same exclusion the
        // top-level operand gets on the branch below. Without it,
        // `Multiply(2, [L, L])` with `L := [1, 2]` narrowed `L`'s value
        // definition from `vector<finite_integer^2>` to `real` while
        // evaluating to the matrix `[[2, 4], [2, 4]]` — an unsound declared
        // type for a value that is still a list, and one that made a second
        // broadcast over the same symbol claim `vector<real^2>` for a
        // `matrix<...^(2x2)>` result.
        for (const y of x.each())
          if (!excludedFromScalarInference(y)) y._infer(inferredType);
      } else if (!excludedFromScalarInference(x)) x._infer(inferredType);
    // A possibly-collection operand (a `vector<n>`-returning application,
    // `number | list`, a tuple, a `dictionary<…>`-shaped signature) is not a
    // scalar: inferring the scalar numeric context onto it would WIDEN a
    // shared inferred result signature to `real | vector<…>` (Tycho item
    // 121) — same guard as the signature-validation route above, and wider
    // than broadcast admission (see `excludedFromScalarInference`).
  }

  return xs;
}

/**
 * Evaluate-time complement of `checkNumericArgs`: numeric operators are
 * permissive at boxing time — a `value`-typed symbol is admitted because it
 * COULD be a number, even though it may legally hold a string — so the
 * numeric evaluate handlers must surface the mismatch once operand
 * evaluation substitutes a value that PROVES non-numeric. Without this the
 * mistake either lingers as an inert expression (`2 · "hello"`, `sin("a")`)
 * or is silently absorbed into a numeric result (`Negate` and `Sqrt` turned
 * a string into `NaN`).
 *
 * An operator whose operand type is checked against its declared signature
 * at canonicalization does not need this guard for a statically non-numeric
 * operand — but it does for one whose static type is a UNION that could
 * still be numeric, such as the element type of a heterogeneous list
 * (`Sin(At(["a", 2], 1))` types `finite_integer | missing | number |
 * string`). Only evaluation can settle that operand, so only an
 * evaluate-time check can report it.
 *
 * Returns a type error for the first VALID operand whose type is disjoint
 * from every exempt reading: such an operand can neither be a number nor
 * broadcast over one. The exemptions, and why each stays silent:
 * - `broadcastable<number>`: could be a number, or a collection consumed by
 *   broadcast;
 * - `missing | nothing`: absence markers propagate as `NaN`, never error;
 * - `function`: a function-valued symbol in a numeric position stays a
 *   symbolic term throughout the engine, in EVERY operator, not only as a
 *   product factor: at boxing time `checkNumericArgs` devolves an unapplied
 *   operator symbol to a plain symbol (`N + 1` via
 *   `devolveUnappliedOperator`) and accepts function-valued elements
 *   without inference, and the pinned cached-expression contracts keep
 *   `2·g` as `2g` after `g := x ↦ …` (pipeline-contracts,
 *   definition-order). Whether a function in a numeric position should
 *   instead be an error is a separate ruling; this guard only polices
 *   VALUES that arithmetic can never consume;
 * - `error`: the operand already carries its own problem — wrapping it
 *   would bury the original report.
 * `Quantity`/`Measurement` operands pass because their types (`value`,
 * numeric) are not disjoint from the union. Invalid operands are skipped
 * for the same reason as `error`-typed ones. Returns `undefined` when every
 * operand could still be numeric.
 */
// Parsed once: the guard runs for every operand of every numeric
// evaluation, so it must not re-resolve the type string per call.
const NON_NUMERIC_EXEMPT_TYPE: Type = parseType(
  'broadcastable<number> | missing | nothing | function | error'
);
export function nonNumericOperandError(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const bad = ops.find(
    (x) => x.isValid && x.type.isDisjointFrom(NON_NUMERIC_EXEMPT_TYPE)
  );
  if (bad === undefined) return undefined;
  return ce.typeError('number', bad.type, bad);
}

/**
 * Check that an argument is of the expected type.
 *
 * Converts the arguments to canonical
 */

/**
 * PHASE 2 of `docs/INFERENCE_ROADMAP.md` (2026-08-18): distribute a
 * collection parameter's ELEMENT type onto the symbol elements of a
 * List/Tuple LITERAL operand, so `f([a, b])` against `(list<number>) -> …`
 * infers `a: number` and `b: number` — the same write `f(a)` would make,
 * which previously died at the literal's boundary. Conservative: only
 * literal List/Tuple operands, only SYMBOL elements (nested structure keeps
 * its own inference), and only a usable element type (`unknown`/`any`
 * distribute nothing).
 */
function distributeLiteralElementInference(op: Expression, param: Type): void {
  if (!isFunction(op, 'List') && !isFunction(op, 'Tuple')) return;
  if (typeof param === 'string') return;
  if (op.operator === 'Tuple' && param.kind === 'tuple') {
    // Per-slot for a tuple parameter of matching arity. NOTE: this fires
    // only when the tuple literal was GENUINELY admitted; a tuple of
    // unknown-typed symbols fails `matches` against a concrete tuple
    // parameter and is only provisionally re-admitted by the free-variable
    // un-rejection in `box.ts` — the final inference pass (this helper's
    // caller) deliberately does not run on that path, because writing slot
    // types from an unproven admission would be inference from a guess.
    if (param.elements.length !== op.nops) return;
    op.ops.forEach((el, i) => {
      const slot = param.elements[i].type;
      if (slot === 'unknown' || slot === 'any') return;
      if (isSymbol(el)) el._infer(slot, 'narrow');
    });
    return;
  }
  const element = collectionElementType(param);
  if (element === undefined || element === 'unknown' || element === 'any')
    return;
  for (const el of op.ops) if (isSymbol(el)) el._infer(element, 'narrow');
}

/**
 * The EVIDENCE-BEATS-REQUIREMENT decision at a narrow-eligible slot
 * (`docs/INFERENCE_ROADMAP.md`, Phase 0 guard, 2026-08-18). Called once the
 * caller has established the narrow preconditions (inferred type, `param`
 * strictly below the stored type, no value component, effects preserved):
 *
 * - `'narrowed'` — the symbol is VALUELESS (and carries no static
 *   assignment evidence): the CAS reading applies, the use declares, and
 *   the type was narrowed to `param`.
 * - `'admitted'` — the symbol has evidence (a held value, or the Epsil
 *   static pre-pass's assignment record) whose RAW type fits `param`:
 *   admit without an eager write (the post-validation pass may sharpen).
 * - `'fall-through'` — the evidence does not fit: the caller must fall
 *   through to its ordinary rejection path.
 *
 * Shared by the REQUIRED, OPTIONAL and VARIADIC parameter loops — the guard
 * lived only in the required loop at first, so an assigned symbol passed
 * through an optional or variadic slot could still be silently rewritten.
 */
function evidenceGuardedNarrow(
  ce: ComputeEngine,
  op: Expression,
  param: Type
): 'narrowed' | 'admitted' | 'fall-through' {
  const def = op.valueDefinition!;
  const held = def.value;
  const staticEvidence =
    held === undefined ? ce._staticAssignmentEvidence?.get(def) : undefined;
  if (held === undefined && staticEvidence === undefined) {
    op._infer(param, 'narrow');
    return 'narrowed';
  }
  const evidenceType = held !== undefined ? held.type.type : staticEvidence!;
  return isSubtype(evidenceType, param) ? 'admitted' : 'fall-through';
}

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

  // A one-cluster string literal at a `character` parameter narrows.
  const narrowed = narrowCharacterLiteral(ce, arg, type);
  if (narrowed !== undefined) return narrowed;

  // Value-component type (`0`, `integer<0..10>`): tri-state admission —
  // membership or undecidability admits; only proven refutation errors.
  // See `value-membership.ts`.
  if (hasValueComponent(type) && admissionOf(arg, type) !== 'refute')
    return arg;

  // Broadcastable operand: could be a plain scalar at runtime, admit it.
  if (broadcastableBaseMatches(arg.type.type, type)) return arg;

  // Function-typed operand with placeholder slots: see
  // `admitsPlaceholderSignature` below.
  if (admitsPlaceholderSignature(arg, type)) return arg;

  // Overlap-deferred validation (§D6.2) — see validateArguments.
  if (overlapsForDeferredValidation(arg.type.type, type)) return arg;

  return ce.typeError(type, arg.type, arg);
}

/** The signature-kind arms a parameter type offers a function-typed operand:
 * the type itself when it is a signature, the signature members of a union.
 * Used by the placeholder-slot reconciliation below. */
function signatureArmsOf(param: Type): FunctionSignature[] {
  if (typeof param === 'object') {
    if (param.kind === 'signature') return [param];
    if (param.kind === 'union')
      return param.types.filter(
        (t): t is FunctionSignature =>
          typeof t === 'object' && t.kind === 'signature'
      );
  }
  return [];
}

/**
 * A function-typed operand whose INFERRED signature carries placeholder
 * `unknown` slots (inference put nothing there — e.g. `(x) => x` types as
 * `(unknown) -> unknown`) reconciles those slots at the argument boundary,
 * per the placeholder ruling (2026-08-15): each `unknown` slot adopts the
 * expected parameter signature's slot, and the operand is admitted on the
 * refined reading. This is what lets the identity lambda satisfy a parameter
 * declared `(any) -> any`. It cannot live in the raw subtype relation —
 * before the `any`/`unknown` lattice repair this admission rode on the
 * erroneous `any <: unknown` edge, which made `(unknown) -> unknown` a
 * mutual subtype of `(any) -> any`.
 */
function admitsPlaceholderSignature(op: Expression, param: Type): boolean {
  const opType = op.type.type;
  if (typeof opType !== 'object' || opType.kind !== 'signature') return false;
  for (const expected of signatureArmsOf(param)) {
    const refined = adoptTopPlaceholderSlots(opType, expected);
    if (refined !== opType && isSubtype(refined, expected)) return true;
  }
  return false;
}

/**
 * Does `param` expect a CHARACTER and refuse a string?
 *
 * True for the bare `character` type, and for a union that has a `character`
 * arm and no arm that already admits a string. An arm admitting the string
 * operand as-is means the call has a home for the literal as written, so
 * narrowing would silently resolve it to a DIFFERENT arm than the one the
 * author's value matched.
 *
 * "Admits a string" is tested with `isSubtype('string', arm)` rather than by
 * comparing the arm to the literal `'string'`: an identity test missed a
 * reference or alias arm that resolves to `string`, a nested union with a
 * `string` arm inside it, and a SUPERTYPE arm such as `value`, `expression`
 * or `any` — each of which accepts the string without help. `isSubtype`
 * resolves aliases and looks through nested unions itself, so no recursion is
 * needed here.
 *
 * Exported because literal narrowing happens in two places that must agree on
 * which declared types trigger it: argument validation (below) and a typed
 * declaration or assignment (`Declare`/`Assign` in `library/core.ts`).
 */
export function expectsCharacterNotString(param: Type): boolean {
  if (param === 'character') return true;
  if (typeof param === 'string') return false;
  if (param.kind !== 'union') return false;
  let hasCharacter = false;
  for (const arm of param.types) {
    if (isSubtype('string', arm)) return false;
    if (arm === 'character') hasCharacter = true;
  }
  return hasCharacter;
}

/**
 * LITERAL NARROWING: a string literal in a `character`-expecting position
 * becomes the character it denotes.
 *
 * Epsil has no character literal — `"a"` is a string — so without this the
 * `character` type would be unusable in practice: `f(c: character)` could
 * never be called with a written-out character. The criterion is the one
 * `CharacterFrom` applies (`isSingleGraphemeCluster`), so there is exactly one
 * definition of "one character" in the system; a multi-cluster or empty
 * literal returns `undefined` here and falls through to the ordinary
 * `incompatible-type` error.
 *
 * Confined to LITERALS on purpose: a `string`-TYPED expression does NOT
 * implicitly convert (`docs/STRING_ROADMAP.md`, design constraint 4) and must
 * be written `CharacterFrom(s)`.
 *
 * Returns `undefined` when no narrowing applies, so every call site is
 * `narrowCharacterLiteral(...) ?? <its existing behavior>`.
 */
function narrowCharacterLiteral(
  ce: ComputeEngine,
  op: Expression,
  param: Type
): Expression | undefined {
  if (!isString(op)) return undefined;
  if (!expectsCharacterNotString(param)) return undefined;
  return narrowStringLiteralToCharacter(ce, op);
}

/**
 * The operand type the compatibility gate JUDGES for an inline `Function`
 * literal: parameter types that were not AUTHORED are widened to `unknown`.
 *
 * A literal's unannotated parameter gets its type INFERRED from body uses
 * (`l => Length(l)` infers `l: collection`), and that inference is a guess
 * about intent, not a contract — the pinned pipe behavior maps such a stage
 * per element and lets the body go inert (`[1,2,3] |> (l => Length(l)) →
 * [Length(1), …]`), which rule 3 would refuse on the guessed type. An
 * authored `Typed` wrapper (the user's own annotation, or the contextual
 * stamp — which is the slot's own solved type and cannot conflict with the
 * supply by construction) keeps its full weight, and the literal's RESULT
 * type stays authoritative either way (§9 Q3: `k => k + 1` rejects on its
 * inferred `number` result). Non-literal operands are returned unchanged.
 */
export function widenUnannotatedLiteralParams(fn: Expression, t: Type): Type {
  if (!isFunction(fn, 'Function')) return t;
  if (typeof t !== 'object' || t.kind !== 'signature') return t;
  const args = t.args ?? [];
  if (args.length === 0) return t;
  const params = fn.ops.slice(1);
  let changed = false;
  const widened = args.map((el, i) => {
    const p = params[i];
    // Only a `Typed` wrapper is AUTHORED — the same bareness test as
    // `relaxBareParams` (`function-utils.ts`), via
    // `functionLiteralParameterType`. A destructuring PATTERN's tuple shape
    // is written by the author, but its element types are inferred guesses
    // like a bare symbol's, and rule 3 must not refuse on a guess (the
    // pattern's arity/shape mismatches are the arity machinery's business,
    // with its tuple hint).
    if (p === undefined || functionLiteralParameterType(p) !== undefined)
      return el;
    if (el.type === 'unknown') return el;
    changed = true;
    return { ...el, type: 'unknown' as Type };
  });
  return changed ? { ...t, args: widened } : t;
}

/**
 * The signature arms of an arrow-typed parameter slot, for compatibility
 * admission (Design E §3,
 * `docs/TYPE-SYSTEM.md`): the slot
 * itself when it is a signature, or the signature members of a union or
 * intersection (`Partition`'s `integer | ((T) any -> boolean)`; a user
 * overload set as a parameter). `undefined` when the slot has no arrow arm —
 * the compatibility gate then does not apply.
 */
function paramArrowArms(
  param: Type
): ReadonlyArray<FunctionSignature> | undefined {
  if (typeof param !== 'object') return undefined;
  // A transparent alias IS its definition (§6b closes the
  // reference-hidden-slot gap: an alias that expands to an arrow is an
  // arrow); a nominal reference stays opaque and the gate declines.
  if (param.kind === 'reference') {
    if (param.alias !== true || param.def === undefined) return undefined;
    return paramArrowArms(param.def);
  }
  if (param.kind === 'signature') return [param];
  // A UNION may mix an arrow arm with non-callable arms (`Partition`'s
  // `integer | ((T) any -> boolean)`): the arrow members are the candidates.
  if (param.kind === 'union') {
    const arms: FunctionSignature[] = [];
    for (const member of param.types)
      if (typeof member === 'object' && member.kind === 'signature')
        arms.push(member);
    return arms.length > 0 ? arms : undefined;
  }
  // An INTERSECTION is a candidate set only when it is a genuine OVERLOAD
  // SET — every member a signature (§3 notes: the runtime selects the
  // applicable arm per call, so one usable arm suffices). A MIXED
  // intersection (`((integer) -> integer) & list<boolean>`) is not reliably
  // callable and must not be compatibility-admitted through its arrow half.
  if (param.kind === 'intersection') {
    const arms: FunctionSignature[] = [];
    for (const member of param.types) {
      if (typeof member !== 'object' || member.kind !== 'signature')
        return undefined;
      arms.push(member);
    }
    return arms.length > 0 ? arms : undefined;
  }
  return undefined;
}
// NOTE: deliberately NOT merged with `signatureArmsOf` above — the two now
// differ in every dimension that matters: this one unfolds alias references,
// admits MIXED unions' arrow members, requires intersections to be pure
// overload sets, and answers `undefined` (gate does not apply) rather than
// `[]`. Forcing them together would perturb `admitsPlaceholderSignature`'s
// semantics for no shared code worth the risk.

/**
 * Rule 2's arity verdict at an arrow-typed slot (Design E §12d): the error to
 * report when NO arm of the slot supplies an arity the operand can accept,
 * `undefined` when the slot admits the operand or the reader cannot word a
 * sentence about it.
 *
 * Deliberately independent of subtyping, and asked BEFORE it. Subtyping is
 * not the relation an arrow slot admits by — Design E admits a callback whose
 * arity range OVERLAPS the slot's — and it does not decide arity fully in any
 * case: a slot arm carrying an optional or variadic tail still admits a
 * callback wider than any call it can make (`(number, number, number) ->
 * number` is a subtype of `(number, number?) -> number`, since the surplus
 * parameter is matched against the optional one). A gate consulted only where
 * matching FAILED therefore never sees those callbacks at all.
 *
 * This asymmetry used to be far wider: until signature subtyping gained the
 * too-MANY-parameters direction for a fixed-arity rhs
 * (`isSubtype`, `common/type/subtype.ts`), an inline binary callback was a
 * strict subtype of a plain unary slot and reached application unreported.
 *
 * The library's own collection operators never reach this mint — their
 * canonical handlers produce the richer per-operator wording ("`CountIf` calls
 * its callback with 1 argument (each element of the collection)…", tuple
 * hint included) before validation runs. This serves user-declared operators,
 * whose supply count comes from the slot arms' own arities.
 *
 * Declines — returns `undefined`, admitting exactly as before — for an
 * anonymous operator (no name to word the sentence around), an operand type
 * carrying free type variables or no readable arity, and any operand that is
 * provably not function-valued (the ordinary `incompatible-type` report says
 * the right thing there).
 */
function arrowSlotArityRejection(
  op: Expression,
  param: Type,
  operatorName: string | undefined
): Expression | undefined {
  if (operatorName === undefined) return undefined;
  const arms = paramArrowArms(param);
  if (arms === undefined) return undefined;
  const opType = widenUnannotatedLiteralParams(op, op.type.type);
  if (freeTypeVariables(opType).size > 0) return undefined;
  if (provablyDisjoint(opType, 'function')) return undefined;
  if (arms.some((arm) => armArityCapable(arm, opType))) return undefined;

  // Word the sentence around the counts the slot actually supplies. A
  // VARIADIC arm has no single count — its range is unbounded above — so it
  // contributes its MINIMUM, phrased as such: reaching here means the operand
  // cannot even accept that minimum (a nullary callback at a `(number+)`
  // slot), which is the only way an unbounded range proves incapability.
  const supplies: { count: number; describes: string }[] = [];
  const seen = new Set<string>();
  for (const arm of arms) {
    const { min, max } = arityBounds(arm);
    const entries: [number, string][] = Number.isFinite(max)
      ? Array.from({ length: max - min + 1 }, (_, k): [number, string] => [
          min + k,
          'per the declared parameter list',
        ])
      : [[min, 'at least, per the declared parameter list']];
    for (const [count, describes] of entries) {
      const key = `${count}:${describes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      supplies.push({ count, describes });
    }
  }
  return callbackArityError(op, operatorName, supplies);
}

/**
 * Compatibility admission at an arrow-typed parameter slot (Design E §3):
 * called from the `!op.type.matches(param)` failure branches — an operand the
 * strict subtype check ADMITS is a fortiori compatible, so this gate only
 * decides the ones strict matching refuses.
 *
 * Returns `'admit'` (compatible — push the operand), an error `Expression`
 * (provably unusable — push the error), or `undefined` when the gate does not
 * apply (no arrow arm in the slot, an operand that is not function-valued, an
 * open operand type) and the legacy repair/error paths should proceed.
 *
 * The rules, in order (rule 2 — arity — is the shipped `callbackArityError`
 * in the operators' own canonical route, not here):
 * - not-callable and open operands fall back to the legacy paths;
 * - rule 5: the operand's declared effects must fit the slot's effect bound
 *   (the EXISTING effect-subset check — `narrowingPreservesEffects` — kept
 *   mandatory; a mixed-union slot has no arm bound to read and passes, which
 *   is conservative-admit and moot for the library's effect-top slots);
 * - rules 1/3/4: `callbackIncompatibility`, admitting if ANY arm admits.
 */
function arrowSlotAdmission(
  ce: ComputeEngine,
  op: Expression,
  param: Type,
  displayParam: Type | undefined,
  operatorName?: string
): Expression | 'admit' | undefined {
  const arms = paramArrowArms(param);
  if (arms === undefined) return undefined;
  const opType = widenUnannotatedLiteralParams(op, op.type.type);
  if (freeTypeVariables(opType).size > 0) return undefined;
  // Provably not a function value: the ordinary `incompatible-type` error
  // (minted by the caller) says the right thing — this gate has nothing to add.
  if (provablyDisjoint(opType, 'function')) return undefined;
  // Rule 2 OWNS arity (Design E §3): an operand whose arity provably cannot
  // accept what a slot arm supplies is ADMITTED here so the shipped
  // `callback-arity` machinery downstream mints its richer diagnostic
  // ("`CountIf` calls its callback with 1 argument (each element of the
  // collection); … declares 2 parameters", tuple-destructuring hint
  // included). Rejecting on the type rules first — a wrong-arity callback is
  // usually result-disjoint too — replaced that message with a generic
  // `incompatible-type` (caught by `callback-arity.test.ts`).
  //
  // Rule 5 (effects) is checked PER CANDIDATE ARM, not against the whole
  // slot: `narrowingPreservesEffects` reads no bound off a mixed union
  // (`integer | pure-arrow`), so a whole-param check silently waved an
  // effectful callback through a pure arrow arm. Admission requires one arm
  // that is arity-capable AND effect-admitting AND type-compatible.
  // The slot arm's ADMISSIBLE arity range walks required → optional →
  // variadic, exactly as the operand side does — reading `args.length`
  // alone under-counted a slot whose own arrow carries an optional or
  // variadic tail (`((number, number?) -> number)`), and the E3 mint then
  // falsely rejected arity-capable callbacks (dual-review finding).
  let sawArityCapableArm = false;
  for (const arm of arms) {
    if (!armArityCapable(arm, opType)) continue;
    sawArityCapableArm = true;
    if (!narrowingPreservesEffects(opType, arm)) continue;
    if (callbackIncompatibility(arm, opType) === undefined) return 'admit';
  }
  // Arity is already settled: every caller asks `arrowSlotArityRejection` the
  // same question before reaching this gate, so an operand that arrives here
  // with no arity-capable arm is one the mint declined to word a sentence
  // about (an anonymous operator, an unreadable operand arity). Admitting it
  // is what that decline means — byte-identical to the pre-E3 behavior.
  if (!sawArityCapableArm) return 'admit';
  return ce.typeError(displayParam ?? param, op.type, op);
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

/** Engine-internal knobs of {@link validateArguments} (phase 2c of
 * `docs/TYPE-SYSTEM.md`). Not for library callers. */
export interface ValidateArgumentsInternals {
  /** Repair-free TRIAL mode: this call is an overload arm's trial, running
   * under a repair-forbidding rollback frame. The two construction-level
   * repairs are admitted by their write-free preconditions and NOT executed
   * (`devolveUnappliedOperator` would declare a shadow and request a
   * rebuild; `repairFreshMatrixInference` would retype symbols and re-box).
   * The winning arm's REAL validation — non-trial, no frame — performs any
   * repairs, exactly once. */
  trial?: boolean;
  /** The OPERATOR (or function-valued symbol) being applied, for diagnostics
   * that name it — the compatibility gate's generic `callback-arity` mint
   * (Design E §12d). Absent where no name is known; the mint then declines
   * rather than word a sentence about an anonymous operator. */
  operatorName?: string;
  /** The solve `resolveOverload` already ran on this (single-arm, polytype)
   * signature with the identical context — reused instead of re-solving. */
  armSolution?: TypeInferenceResult;
  /** Out-slot: the overload resolution computed by this call, when the
   * signature was an overload set. The caller attaches it to the call
   * expression it constructs, so result typing (`resolvedArm`) reads the
   * SAME resolution the call was validated against instead of re-deriving
   * one with the trial-less prefilter. */
  resolutionOut?: { resolution?: OverloadResolution };
}

export function validateArguments(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  signature: Type,
  lazy?: boolean,
  /** Global (`opDef.broadcastable`, `paramsAreScalar`) or PER-POSITION: a
   * declared `broadcastable<T>` signature threads only the slots it marks
   * elementwise, so a sibling slot that binds its argument whole is validated
   * as usual (`docs/plans/2026-08-08-broadcastable-param-semantics.md`). */
  threadable?: Threadable,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>,
  /** Strip-before-validate (§3.B of the missing-value typing design): for a
   * position where this predicate returns `true`, an operand carrying a
   * `missing` arm is admitted when its stripped type still matches the
   * parameter (a scalar `Missing` → `never`, admissible everywhere). The
   * missing arm is carried by the runtime gate, not the type. */
  stripMissing?: (index: number) => boolean,
  internals?: ValidateArgumentsInternals
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
  // arm and validate against that (`docs/TYPE-SYSTEM.md`). Resolution is
  // write-free, so no symbol is mutated on
  // account of an arm that is subsequently rejected.
  //
  // `viable` (not `selected`) drives the operand inference at the bottom of
  // this function: the result type comes from the most-specific arm, but the
  // constraint pushed back into an operand must be the JOIN over every arm
  // that survived (§4.3). Those pull in opposite directions.
  let sig: FunctionSignature;
  let viableArms: ReadonlyArray<FunctionSignature> | undefined;
  /** The selected arm's solve, when resolution already computed it — the
   * call-site instantiation below reuses it instead of solving the same arm
   * against the same operands with the same context a second time. */
  let armSolution: TypeInferenceResult | undefined;
  if (signature.kind === 'signature') {
    sig = signature;
  } else {
    const arms = overloadArms(signature);
    if (!arms) return null;
    // The policies reach both the cheap prefilter and the generic solver, so
    // resolution and validation see the same call.
    const policies = {
      lazy,
      threadable,
      couldBeUnkeyedCollection: couldBeUnkeyedCollectionOperand,
      stripMissing,
      freshMatrixRepair: (op: Expression, param: Type) =>
        couldRepairFreshMatrixInference(ce, op, param, freshlyInferred),
    };
    // Trial admission (phase 2c): an arm is viable iff running THIS function
    // on it, in trial mode, succeeds. The trial runs under a rollback frame,
    // so every inference write it performs — operand narrowing, signature
    // refinement, auto-declares — is undone whatever the outcome, and under a
    // boxing-pass window of its own (a frame must not straddle window
    // boundaries; opening a nested window inside an existing one is two
    // counter bumps). `forbidsRepairs` marks it as repair-free: the
    // construction-level repairs are admitted by precondition inside trial
    // mode and assert they never execute here. This replaced the write-free
    // mirror filter, whose gate conditions had to track this function's
    // admission logic by hand.
    const trial: ArmTrialFn = (declared, _instance, solution, armOps) =>
      ce._withBoxingPassWindow(() =>
        ce._withRolledBackInference(
          () => {
            const res = validateArguments(
              ce,
              armOps,
              declared,
              lazy,
              threadable,
              freshlyInferred,
              stripMissing,
              {
                trial: true,
                armSolution: solution,
                // The arity verdict at an arrow slot is worded around the
                // operator's name and DECLINES without one, so an unnamed
                // trial would judge an inapplicable callback admissible and
                // report the arm viable.
                operatorName: internals?.operatorName,
              }
            );
            // `null` = valid, operands unchanged. In trial mode no repair
            // executes, so `substituted` is never set and a non-null result
            // always carries at least one invalid operand — the refuted
            // positions.
            if (res === null) return null;
            const refuted: number[] = [];
            res.forEach((x, k) => {
              if (!x.isValid) refuted.push(k);
            });
            return refuted.length === 0 ? null : refuted;
          },
          { forbidsRepairs: true }
        )
      );
    const resolution = resolveOverload(
      ce,
      ops,
      arms,
      policies,
      undefined,
      trial
    );
    if (internals?.resolutionOut !== undefined)
      internals.resolutionOut.resolution = resolution;
    const { selected, viable, selectedSolution } = resolution;
    if (!selected) {
      // No arm fits. Blame the operands actually at fault: an operand every
      // near-miss arm accepts at its position stays untouched, so a bad seed
      // does not also indict a perfectly good domain argument.
      const { arityViable, arityTarget, refuted } = diagnoseNoMatch(
        ce,
        ops,
        arms,
        policies,
        trial
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
        if (expected === undefined) return op;
        // When the refuted position is an arrow slot no arm can apply the
        // callback at, say THAT rather than printing two signatures side by
        // side: `expected` is the union of the arms' slots, so the arity
        // verdict reads every arm at once and mints the same sentence a
        // single-arm call gets ("… calls its callback with 1 argument …;
        // `(a, b) => a + b` declares 2 parameters").
        return (
          arrowSlotArityRejection(op, expected, internals?.operatorName) ??
          ce.typeError(expected, op.type, op)
        );
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
    armSolution = selectedSolution;
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
  // excluded from the final `_infer(param)` narrowing below — narrowing an
  // inferred symbol to `matrix` on the strength of a guess would
  // over-constrain unrelated later uses.
  const deferredIdx = new Set<number>();

  //
  // Call-site instantiation (§4.3 of the type-variables design). Gated on the
  // O(1) polytype test: a ground signature reaches none of this.
  //
  // Every site below that consumes a parameter type — `matches`, `isSubtype`,
  // `infer` — must see the INSTANTIATED ground parameter, never an open one
  // (§4.2 rule 1). The cheapest way to guarantee that is to instantiate the
  // parameter arrays ONCE, here, so no gate can accidentally read the pattern.
  // `paramStillOpen` records a residue that stayed open (impossible with a
  // total solver, but a leak must SKIP every write rather than write an open
  // type).
  //
  // `armSolution` is that same solve, when overload resolution already ran it
  // on this arm with this context (the policies it passes to `solveArm` are
  // exactly the three below) — reused rather than recomputed.
  const polyArm = polytypeArm(sig);
  const solved = polyArm
    ? (armSolution ??
      // A TRIAL of a single polytype arm: `resolveOverload` already solved
      // it with this exact context — reuse rather than re-solve.
      internals?.armSolution ??
      solveArm(polyArm, ops, {
        threadable,
        stripMissing,
        lazy,
        resolver: ce._typeResolver,
      }))
    : undefined;
  let paramStillOpen = false;
  const groundParam = (param: Type): Type => {
    if (!solved) return param;
    const t = instantiatedParam(param, solved.bindings);
    if (t !== undefined) return t;
    paramStillOpen = true;
    // Still open: admit everything at this position and skip every write.
    return 'any';
  };

  // D8 — absorbed top type × upper bounds. When a variable solved to an
  // ABSORBED `unknown` or `any` (a non-inferable top-typed operand), every
  // constraint that mentions it is satisfied PROVISIONALLY: the position is
  // admitted exactly as the engine's other provisional admissions are, and the
  // runtime stays the honest party. Without this, a generic signature would be
  // statically STRICTER than its ground counterpart on unknown/`any` operands,
  // breaking the §4.5 parity requirement. Deferred like the other provisional
  // admissions, so the final inference pass does not narrow on a guess.
  const provisionalIdx = new Set<number>();
  if (solved && solved.absorbed.size > 0 && polyArm) {
    const patterns = parameterPositions(polyArm, ops.length);
    patterns.forEach((p, k) => {
      if (p === undefined) return;
      for (const v of freeTypeVariables(p))
        if (solved.absorbed.has(v)) {
          provisionalIdx.add(k);
          return;
        }
    });
  }

  const params = sig.args?.map((x) => groundParam(x.type)) ?? [];
  const optParams = sig.optArgs?.map((x) => groundParam(x.type)) ?? [];
  // One instantiation for the whole variadic tail: the solver folds every
  // matching actual into the same variable's bound set (§4.3), so the tail's
  // instantiated pattern is position-independent.
  const varParam =
    sig.variadicArg === undefined
      ? undefined
      : groundParam(sig.variadicArg.type);
  const varParamCount = sig.variadicMin ?? 0;

  // §8 DISPLAY ONLY. A variable that got no call-site bound and carries no
  // declared bound falls to S3's `unknown`, so the instantiated parameter
  // reads `indexed_collection<unknown>` in an `incompatible-type` message — an
  // impossible-looking requirement for what is really "any indexed
  // collection". The message shows such a variable at its GROUND SKELETON
  // (`any`, which `reduceType` normalizes back to the bare constructor,
  // restoring the ground signature's wording). Nothing that TYPES the call
  // uses these: `params`/`optParams`/`varParam` keep the solved bindings.
  const displayBindings =
    solved && solved.unbound.size > 0
      ? {
          ...solved.bindings,
          // An unbound variable DISPLAYS as `unknown`, the identity bound
          // (bare-synonym ruling 2026-08-17): `reduceType` below then
          // collapses `indexed_collection<unknown>` to the bare name, so an
          // error message says "expected indexed_collection" rather than
          // leaking the wider `indexed_collection<any>`.
          ...Object.fromEntries(
            [...solved.unbound].map((v) => [v, 'unknown' as Type])
          ),
        }
      : undefined;
  const displayParam = (param: Type, ground: Type): Type => {
    if (displayBindings === undefined) return ground;
    const t = instantiatedParam(param, displayBindings);
    return t === undefined ? ground : reduceType(t);
  };
  const displayParams =
    sig.args?.map((x, k) => displayParam(x.type, params[k])) ?? [];
  const displayOptParams =
    sig.optArgs?.map((x, k) => displayParam(x.type, optParams[k])) ?? [];
  const displayVarParam =
    sig.variadicArg === undefined || varParam === undefined
      ? undefined
      : displayParam(sig.variadicArg.type, varParam);

  /** The type to infer into the operand at `idx`. For a plain signature this
   * is the parameter itself; for an overload set it is the JOIN over every
   * viable arm (§4.3) — never the selected arm's parameter, which would
   * over-constrain the symbol (§4.5). */
  const inferenceTypeAt = (idx: number, param: Type): Type | undefined => {
    // §4.2 rule 1: never write while a parameter is still open.
    if (paramStillOpen) return undefined;
    if (!viableArms) return param;
    const joined = joinParamAt(viableArms, idx);
    // BACKSTOP (§4.2). `resolveOverload` instantiates every arm before the
    // join, so `viableArms` is ground and this join is too. A residue would
    // mean an unsolved variable leaked through the solver: skip the write
    // rather than narrow a symbol to a type variable.
    if (joined !== undefined && freeTypeVariables(joined).size > 0)
      return undefined;
    return joined;
  };

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
    if (
      isThreadableAt(threadable, idx) &&
      couldBeUnkeyedCollectionOperand(op)
    ) {
      result.push(op);
      continue;
    }
    // D8 provisional admission (see `provisionalIdx`).
    if (provisionalIdx.has(idx)) {
      result.push(op);
      deferredIdx.add(result.length - 1);
      continue;
    }
    // Rule 2 (arity) is asked ahead of EVERY admission that turns on
    // `matches(param)`, because subtyping answers arity in one direction
    // only: a callback with MORE required parameters than the slot supplies
    // is a strict subtype of the slot's arrow, so each of those admissions
    // would otherwise wave it through to fail at application. That is not
    // hypothetical for the fast paths just below — a symbol holding a binary
    // lambda reaches them with an INFERRED type that matches a unary arrow
    // slot. See `arrowSlotArityRejection`.
    const arityError = arrowSlotArityRejection(
      op,
      param,
      internals?.operatorName
    );
    if (arityError !== undefined) {
      result.push(arityError);
      isValid = false;
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
    // NOT while a parameter is still OPEN (§4.2 rule 1): `param` here is the
    // INSTANTIATED ground projection, and a site that could not be
    // instantiated skips the write rather than narrowing to a type variable.
    if (
      !paramStillOpen &&
      op.valueDefinition?.inferredType &&
      isSubtype(param, op.type.type) &&
      !hasValueComponent(param) &&
      // Design E §3: never narrow a symbol's type TO an arrow slot's arrow —
      // the slot is a per-call supply, not evidence of the symbol's own
      // signature, and the write would manufacture a contract that makes a
      // later, differently-instantiated call reject a symbol that both calls
      // admit. The compatibility gate below admits with no write instead.
      paramArrowArms(param) === undefined &&
      narrowingPreservesEffects(op.type.type, param)
    ) {
      // EVIDENCE BEATS REQUIREMENT (`docs/INFERENCE_ROADMAP.md`, Phase 0
      // verdict, ruled 2026-08-18): use-narrowing is the CAS reading — a
      // use of a VALUELESS symbol declares what it must be (`k(n)` makes
      // `n` an integer). A symbol that HOLDS a value has assignment
      // evidence, and a use is a requirement to CHECK against that
      // evidence, not evidence to merge: narrowing here let `x = g()` (a
      // `number`) pass a `(integer) -> …` parameter by rewriting `x`'s
      // type to `integer` — the conflict only surfaced at evaluation, and
      // the stored type was left contradicting the held value.
      //
      // The evidence checked is the HELD VALUE'S own type, not the symbol's
      // stored type: assignment WIDENS (a `Complex(1,-1)` value stores the
      // symbol as `number`), so the stored type can fail a parameter —
      // `number ⊄ complex` — that the actual evidence satisfies. A value
      // whose own type fits is admitted with no write; one that does not
      // falls through to the ordinary `incompatible-type` error, minted at
      // canonicalization.
      if (evidenceGuardedNarrow(ce, op, param) !== 'fall-through') {
        result.push(op);
        continue;
      }
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
      // Design E §3: an arrow-typed slot admits by COMPATIBILITY, not
      // subtyping. Admitted operands carry no evidence of the slot's arrow
      // (it is a per-call supply, not the operand's own contract), so they
      // are excluded from the final `_infer(param)` narrowing via
      // `deferredIdx`, exactly like the other provisional admissions.
      const compat = arrowSlotAdmission(
        ce,
        op,
        param,
        displayParams[idx],
        internals?.operatorName
      );
      if (compat === 'admit') {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      if (compat !== undefined) {
        result.push(compat);
        isValid = false;
        continue;
      }
      // A one-cluster string literal at a `character` parameter narrows to
      // the character it denotes; a multi-cluster one falls through to the
      // ordinary type error below.
      const asCharacter = narrowCharacterLiteral(ce, op, param);
      if (asCharacter !== undefined) {
        result.push(asCharacter);
        substituted = true;
        continue;
      }
      // Value-component parameter (`0`, `integer<0..10>`): tri-state
      // admission (§4.4). A concrete value passing membership ADMITS; a
      // symbolic operand that is not provably disjoint is UNDECIDABLE and
      // is provisionally admitted (the call could be fine — dispatch stays
      // open until the value is known); only proven refutation errors.
      // Mirrored in `paramMatches` (overload.ts). Deferred like the other
      // provisional admissions: the final `_infer(param)` pass must not
      // narrow a symbol's type to the VALUE type (`k := 0; g(k)` would
      // otherwise pin `k: 0`).
      if (hasValueComponent(param) && admissionOf(op, param) !== 'refute') {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      // Strip-before-validate (§3.B): admit an operand carrying a `missing`
      // arm whose stripped type still matches the parameter. Accepted
      // provisionally (added to `deferredIdx`) so the final `_infer(param)`
      // narrowing does not widen an unconstrained symbol (I4).
      if (strippedMatchesParam(op, param, idx, stripMissing)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      if (internals?.trial) {
        // TRIAL mode: the two construction-level repairs are admitted by
        // their write-free preconditions and NOT executed — a repair
        // entangles state the trial's rollback frame must not touch (the
        // devolve shadow participates in the boxing-state rebuild loop; the
        // matrix repair re-boxes). A precondition is not a proof: the
        // winning arm's REAL validation runs the repair and may fail where
        // the trial admitted — that failure surfaces as the call's error,
        // with no second chance, byte-identical to the filter-era behavior.
        if (couldRepairFreshMatrixInference(ce, op, param, freshlyInferred)) {
          result.push(op);
          continue;
        }
        if (isRepairableOperatorSymbol(ce, op)) {
          result.push(op);
          continue;
        }
      } else {
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
      // An inferred signature with placeholder `unknown` slots reconciles
      // against the declared parameter (see `admitsPlaceholderSignature`).
      if (admitsPlaceholderSignature(op, param)) {
        result.push(op);
        continue;
      }
      result.push(ce.typeError(displayParams[idx] ?? param, op.type, op));
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
    if (isThreadableAt(threadable, i) && couldBeUnkeyedCollectionOperand(op)) {
      result.push(op);
      i += 1;
      continue;
    }
    // D8 provisional admission (see `provisionalIdx`).
    if (provisionalIdx.has(i)) {
      result.push(op);
      deferredIdx.add(result.length - 1);
      i += 1;
      continue;
    }
    // Rule 2 (arity) ahead of every `matches(param)` admission — see the
    // required-param gate.
    const optArityError = arrowSlotArityRejection(
      op,
      param,
      internals?.operatorName
    );
    if (optArityError !== undefined) {
      result.push(optArityError);
      isValid = false;
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
    // type; NOT to an arrow slot's arrow (Design E — see the required-param
    // gate).
    if (
      !paramStillOpen &&
      op.valueDefinition?.inferredType &&
      isSubtype(param, op.type.type) &&
      !hasValueComponent(param) &&
      paramArrowArms(param) === undefined &&
      narrowingPreservesEffects(op.type.type, param)
    ) {
      // Evidence-beats-requirement — see `evidenceGuardedNarrow`.
      if (evidenceGuardedNarrow(ce, op, param) !== 'fall-through') {
        result.push(op);
        i += 1;
        continue;
      }
    }
    // Broadcastable operand: could be a plain scalar at runtime, admit it.
    if (broadcastableBaseMatches(op.type.type, param)) {
      result.push(op);
      i += 1;
      continue;
    }
    if (!op.type.matches(param)) {
      // Design E §3 compatibility admission — see the required-param gate.
      const compat = arrowSlotAdmission(
        ce,
        op,
        param,
        displayOptParams[i - params.length],
        internals?.operatorName
      );
      if (compat === 'admit') {
        result.push(op);
        deferredIdx.add(result.length - 1);
        i += 1;
        continue;
      }
      if (compat !== undefined) {
        result.push(compat);
        isValid = false;
        i += 1;
        continue;
      }
      // Literal narrowing at a `character` parameter — see the required-param
      // gate.
      const asCharacter = narrowCharacterLiteral(ce, op, param);
      if (asCharacter !== undefined) {
        result.push(asCharacter);
        substituted = true;
        i += 1;
        continue;
      }
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
      // Placeholder-signature reconciliation — see the required-param gate.
      if (admitsPlaceholderSignature(op, param)) {
        result.push(op);
        i += 1;
        continue;
      }
      result.push(
        ce.typeError(displayOptParams[i - params.length] ?? param, op.type, op)
      );
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
      // The operand index is `i - 1` (already incremented at the loop top).
      if (
        isThreadableAt(threadable, i - 1) &&
        couldBeUnkeyedCollectionOperand(op)
      ) {
        result.push(op);
        continue;
      }
      // D8 provisional admission (see `provisionalIdx`).
      if (provisionalIdx.has(i - 1)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      // Rule 2 (arity) ahead of every `matches(varParam)` admission — see the
      // required-param gate.
      const varArityError = arrowSlotArityRejection(
        op,
        varParam,
        internals?.operatorName
      );
      if (varArityError !== undefined) {
        result.push(varArityError);
        isValid = false;
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
        !paramStillOpen &&
        op.valueDefinition?.inferredType &&
        isSubtype(varParam, op.type.type) &&
        !hasValueComponent(varParam) &&
        paramArrowArms(varParam) === undefined &&
        narrowingPreservesEffects(op.type.type, varParam)
      ) {
        // Evidence-beats-requirement — see `evidenceGuardedNarrow`.
        if (evidenceGuardedNarrow(ce, op, varParam) !== 'fall-through') {
          result.push(op);
          continue;
        }
      }
      // Broadcastable operand: could be a plain scalar at runtime, admit it.
      if (broadcastableBaseMatches(op.type.type, varParam)) {
        result.push(op);
        continue;
      }
      if (!op.type.matches(varParam)) {
        // Design E §3 compatibility admission — see the required-param gate.
        const compat = arrowSlotAdmission(
          ce,
          op,
          varParam,
          displayVarParam,
          internals?.operatorName
        );
        if (compat === 'admit') {
          result.push(op);
          deferredIdx.add(result.length - 1);
          continue;
        }
        if (compat !== undefined) {
          result.push(compat);
          isValid = false;
          continue;
        }
        // Literal narrowing at a `character` parameter — see the
        // required-param gate.
        const asCharacter = narrowCharacterLiteral(ce, op, varParam);
        if (asCharacter !== undefined) {
          result.push(asCharacter);
          substituted = true;
          continue;
        }
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
        // Placeholder-signature reconciliation — see the required-param gate.
        if (admitsPlaceholderSignature(op, varParam)) {
          result.push(op);
          continue;
        }
        result.push(ce.typeError(displayVarParam ?? varParam, op.type, op));
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

  // A bound constraint the per-position gates cannot see (§8): the solved
  // value violates a declared bound, or two contravariant positions demand
  // incompatible instantiations. Every position matched its INSTANTIATED
  // parameter, so this is the only place the conflict can surface. The
  // displayed expected type is always ground (§8 rule 1).
  if (solved && solved.failures.length > 0 && polyArm) {
    const patterns = parameterPositions(polyArm, ops.length);
    for (const f of solved.failures) {
      const idx = f.index ?? 0;
      if (idx >= result.length) continue;
      if (!result[idx].isValid) continue;
      // A `where T is P` constraint (protocols design P19) is not a subtype
      // violation, so it does not report as one: the offending operand carries
      // `protocol-constraint-unsatisfied`, naming the protocol and the type
      // the variable solved to.
      if (f.kind === 'protocol') {
        result[idx] = ce.error(
          [
            'protocol-constraint-unsatisfied',
            `\`${typeToString(f.solution)}\` does not conform to the \`${f.protocol}\` protocol (\`${f.variable}\` is constrained by \`where ${f.variable} is ${f.protocol}\`)`,
          ],
          ops[idx]?.toString()
        );
        isValid = false;
        continue;
      }
      // For a contravariant (callback) conflict the expected type displayed is
      // the blamed position's parameter with the variable set to what the
      // OTHER constraints pin it to — §8's `(integer) -> boolean`, not the
      // bare constraining type. A violated DECLARED bound gets the same
      // treatment with the variable set to the bound itself: the blamed
      // position may be a CONSTRUCTOR pattern (`list<T>` at a `T: integer`
      // bound), where displaying the bare bound would read "expected
      // `integer`, got `vector<finite_real^2>`" — the instantiated pattern
      // (`list<integer>`) is the position's true expected type. For a
      // bare-variable position the instantiation IS the bound, so the message
      // is unchanged there.
      const pattern = patterns[idx];
      const pinTo =
        f.kind === 'upper' && f.pin !== undefined
          ? f.pin
          : f.kind === 'bound'
            ? f.expected
            : undefined;
      const expected =
        pinTo !== undefined && pattern !== undefined
          ? (instantiatedParam(pattern, {
              ...solved.bindings,
              [f.variable]: pinTo,
            }) ?? f.expected)
          : f.expected;
      result[idx] = ce.typeError(expected, ops[idx]?.type, ops[idx]);
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
      if (
        !isThreadableAt(threadable, i) ||
        !couldBeUnkeyedCollectionOperand(finalOps[i])
      ) {
        finalOps[i]._infer(t);
        distributeLiteralElementInference(finalOps[i], t);
      }
    i += 1;
  }
  for (const param of optParams) {
    if (!finalOps[i]) break;
    const t = inferenceTypeAt(i, param);
    if (t !== undefined && !lazy && !deferredIdx.has(i))
      if (
        !isThreadableAt(threadable, i) ||
        !couldBeUnkeyedCollectionOperand(finalOps[i])
      ) {
        finalOps[i]._infer(t);
        distributeLiteralElementInference(finalOps[i], t);
      }
    i += 1;
  }
  if (varParam) {
    for (const op of finalOps.slice(i)) {
      const t = inferenceTypeAt(i, varParam);
      if (t !== undefined && !lazy && !deferredIdx.has(i))
        if (
          !isThreadableAt(threadable, i) ||
          !couldBeUnkeyedCollectionOperand(op)
        ) {
          op._infer(t);
          distributeLiteralElementInference(op, t);
        }
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
    // `BoxedSymbol._infer()` — or is still unknown (never inferred; the
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

  // Per-name repair-local records for an EXACT failure-leg restore (phase 2a
  // of docs/TYPE-SYSTEM.md). Three families:
  // - `snapshots`: the coupled type/value slots, restored setter-bypassing
  //   via `_restoreTypeSlots` — the old restore wrote through the `type`
  //   setter, which allocates fresh `BoxedType`s (defeating identity-keyed
  //   caches) and, when the previous type was `unknown` (eligible above),
  //   WIPED the definition's assigned value.
  // - `histories`: the provenance array as it stood before the write — the
  //   write below records a provenance entry, and a failed repair must leave
  //   the history byte-identical (including a cap-displaced entry, which the
  //   slice preserves wholesale).
  // - `freshlyAdded`: definitions this repair itself added to
  //   `_freshlyInferred` (an `unknown` → `matrix` transition during a boxing
  //   pass), removed again on failure so a rolled-back repair leaves no
  //   phantom repair eligibility.
  // The narrowing sink is notified only on the SUCCESS path (below): sink
  // retraction machinery is a phase-2b journal family, so an entry recorded
  // at write time for a repair the failure leg then undoes would report a
  // narrowing that never took effect — but a SUCCESSFUL repair permanently
  // narrows an (possibly enclosing) definition, and a contained parse's
  // `scope.narrowings()` must see that.
  // The repair must never execute inside a repair-FORBIDDING rollback frame
  // — phase 2c's trial validation mode, which admits repairs by their
  // write-free precondition (`couldRepairFreshMatrixInference`) without
  // running them; the winning arm re-validates for real, outside any frame.
  // An ORDINARY rollback frame (the Epsil static checking pass wraps full
  // canonicalization in one) legitimately reaches this repair, and every
  // write below is journaled so the frame rolls it back.
  console.assert(
    !repairsForbiddenByRollbackFrame(ce),
    'repairFreshMatrixInference must not run in trial (repair-free) validation'
  );

  const snapshots = new Map<string, unknown>();
  const histories = new Map<string, TypeProvenanceEntry[] | undefined>();
  const beforeTypes = new Map<string, BoxedType>();
  const freshlyAdded: BoxedValueDefinition[] = [];
  const frame = activeRollbackFrame(ce);
  for (const name of names) {
    const def = ce.lookupDefinition(name);
    if (!def || !isValueDef(def) || !def.value.inferredType) return null;
    snapshots.set(name, def.value._typeSlotSnapshot());
    histories.set(name, def.value._typeProvenance?.slice());
    beforeTypes.set(name, def.value.type);
    const wasUnknown = def.value.type.isUnknown;
    // Rollback journal (family 1): the repair-local records above serve the
    // repair's own FAILURE leg; the journal entry is what reverses a
    // SUCCESSFUL repair when an enclosing rollback frame aborts. On a failed
    // repair the frame's entries replay over already-restored state, and
    // every family involved composes with that: `_restoreTypeSlots` writes
    // the same slots again (idempotent); the family-6 undo deletes a set
    // member the failure leg already removed (`Set.delete` no-op); and the
    // family-7 undo pops the array object `recordTypeProvenance` pushed to —
    // which the failure leg's `_typeProvenance = histories.get(name)` has
    // DETACHED from the definition, so the pop touches nothing live.
    // (Pinned by the "failure leg inside an open rollback frame" tests in
    // `test/compute-engine/inference-rollback.test.ts`.)
    if (frame !== undefined) {
      const target = def.value;
      const slots = target._typeSlotSnapshot();
      frame.record({ undo: () => target._restoreTypeSlots(slots) });
    }
    def.value.type = ce.type('matrix');
    // Freeze the contextual assignment during re-canonicalization so the
    // numeric fast path cannot immediately narrow it back to `real`.
    def.value.inferredType = false;
    // The write is now channel-visible where it matters: provenance (the
    // matrix inference is evidence, with the operand as its cause) and the
    // fresh-inference set (matching `_noteInferenceWrite`'s condition).
    recordTypeProvenance(ce, def.value, {
      type: def.value.type,
      kind: 'inferred',
      axis: 'type',
      cause: op,
      epoch: currentBoxingEpoch(ce),
    });
    if (
      wasUnknown &&
      ce._inferenceTxDepth > 0 &&
      !ce._freshlyInferred?.has(def.value)
    ) {
      const set = (ce._freshlyInferred ??= new Set());
      // Rollback journal (family 6): this add is guarded by the `!has`
      // check above, so the prior-presence bit is always "absent" here.
      if (frame !== undefined) {
        const added = def.value;
        frame.record({ undo: () => set.delete(added) });
      }
      set.add(def.value);
      freshlyAdded.push(def.value);
    }
  }
  ce._noteStateEvent({ kind: 'inference' });

  const repaired = ce.box(op.json);
  if (repaired.type.matches(expected)) {
    const sink = ce._narrowingSink;
    for (const name of names) {
      const def = ce.lookupDefinition(name);
      if (def && isValueDef(def)) {
        def.value.inferredType = true;
        // Report the COMMITTED net transition to a contained parse's
        // narrowing capture — only now, when the write is permanent.
        if (sink !== undefined)
          sink._recordNarrowing(
            name,
            def,
            beforeTypes.get(name)!,
            def.value.type
          );
      }
    }
    return repaired;
  }

  for (const name of names) {
    const def = ce.lookupDefinition(name);
    if (def && isValueDef(def)) {
      def.value._restoreTypeSlots(snapshots.get(name));
      def.value._typeProvenance = histories.get(name);
    }
  }
  for (const fresh of freshlyAdded) ce._freshlyInferred?.delete(fresh);
  ce._noteStateEvent({ kind: 'inference' });
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
