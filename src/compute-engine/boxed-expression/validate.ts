import {
  isFiniteIndexedCollection,
  typeCouldBeNumericCollection,
  typeCouldBeNumericTuple,
  typeIsProvablyNonNumericCollection,
} from '../collection-utils.js';

import { flatten } from './flatten.js';
import { isSubtype } from '../../common/type/subtype.js';
import { couldBeNonRealNumber } from '../../common/type/utils.js';
import { parseType } from '../../common/type/parse.js';
import { Type } from '../../common/type/types.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
  BoxedValueDefinition,
} from '../global-types.js';
import { fuzzyStringMatch } from '../../common/fuzzy-string-match.js';
import { isOperatorDef, isValueDef } from './utils.js';
import { isTensor } from './boxed-tensor.js';
import { isSymbol, isFunction, isContinuationOperand } from './type-guards.js';

// Parsed once: the type of an indexed collection whose every element is a
// number. Used in `checkNumericArgs` to accept collections for broadcasting on
// the strength of their static element type.
const INDEXED_COLLECTION_OF_NUMBER = parseType('indexed_collection<number>');

/**
 * Return true if a type could be a collection type at runtime.
 * This is used for threadable/broadcastable functions to accept arguments
 * whose type includes a collection possibility (e.g. `number | list`).
 */
function typeCouldBeCollection(type: Type): boolean {
  if (typeof type === 'string') {
    return (
      type === 'collection' ||
      type === 'indexed_collection' ||
      type === 'list' ||
      type === 'set' ||
      type === 'tuple' ||
      type === 'any'
    );
  }
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set' ||
    type.kind === 'tuple' ||
    // A `broadcastable<T>` operand COULD be an indexed collection at runtime.
    type.kind === 'broadcastable'
  )
    return true;
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeCollection(t));
  return false;
}

// `typeCouldBeNumericCollection` / `typeCouldBeNumericTuple` — the COULD-
// semantics predicates `checkNumericArgs` uses to admit collection/tuple
// operands — are imported from `collection-utils.ts`, where the
// `Add`/`Multiply` type handlers and the invisible-operator gate share the
// SAME predicates. Keeping a private copy here let the two layers diverge:
// an operand admitted by validation but missed by the type handlers
// collapsed to `number` and baked `incompatible-type` (Tycho item 30).

/**
 * A threadable operand that broadcasting may consume as a collection: either
 * the *value* is an actual finite indexed collection (regardless of how
 * precise its static type is), or the static *type* admits a collection at
 * runtime (`list`, `number | list`, `broadcastable<T>`, …) even though no
 * value is materialized. Neither check subsumes the other. Such an operand is
 * admitted as-is and excluded from scalar parameter-type inference.
 */
function couldBeCollectionOperand(op: Expression): boolean {
  return isFiniteIndexedCollection(op) || typeCouldBeCollection(op.type.type);
}

/**
 * A `broadcastable<S>` operand COULD be a plain scalar `S` at runtime — that
 * is the meaning of the lift (`S`, or an indexed collection of `S` that
 * broadcasts). When the scalar base matches the parameter type, admit the
 * operand instead of baking a type error: before the lift the same expression
 * typed plain `S` and was admitted by the `matches(param)` check, so this
 * exactly restores that admission (e.g. `Totient(p^e(k))` where `e(k)` is an
 * unknown application lifts `Power` to `broadcastable<number>`, which a
 * `number` parameter must still accept). Same COULD-semantics as
 * `typeCouldBeNumericCollection`.
 */
function broadcastableBaseMatches(type: Type, param: Type): boolean {
  if (typeof type === 'string') return false;
  if (type.kind === 'broadcastable') return isSubtype(type.elements, param);
  if (type.kind === 'union')
    return type.types.some((t) => broadcastableBaseMatches(t, param));
  return false;
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
 * Returns the re-boxed symbol, or `null` if the fallback does not apply.
 */
function devolveUnappliedOperator(
  ce: ComputeEngine,
  op: Expression
): Expression | null {
  if (!isSymbol(op)) return null;
  const name = op.symbol;
  if (!/^[A-Z]$/.test(name)) return null;

  // Find the scope where the name is currently bound
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope && !scope.bindings.has(name)) scope = scope.parent;
  if (!scope) return null;

  const def = scope.bindings.get(name)!;
  if (!scope.parent) {
    // Bound to the standard library: shadow it in the current scope
    if (!isOperatorDef(def)) return null;
    ce.declare(name, 'unknown');
    return ce.box(name);
  }
  // The name was already shadowed with a value (e.g. by a previous operand
  // of the same expression): rebind this occurrence to the shadow.
  if (isValueDef(def)) return ce.box(name);
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
    for (const x of xs)
      if (!isFiniteIndexedCollection(x)) x.infer(inferredType);
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
    } else if (isTensor(op)) {
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
      } else x.infer(inferredType);
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

  // Broadcastable operand: could be a plain scalar at runtime, admit it.
  if (broadcastableBaseMatches(arg.type.type, type)) return arg;

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
export function validateArguments(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  signature: Type,
  lazy?: boolean,
  threadable?: boolean,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
): ReadonlyArray<Expression> | null {
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
    }
    return null;
  }

  if (typeof signature === 'string') return null;
  if (signature.kind !== 'signature') return null;

  const result: Expression[] = [];
  let isValid = true;
  // Set when an operand was replaced (devolved to an unknown symbol, or
  // repaired by matrix inference). The substituted list must then be returned
  // even if validation succeeds: returning `null` tells the caller to use the
  // original operands, and the original boxed symbol keeps its stale operator
  // binding (`N \equiv 1 \pmod k` stayed bound to the builtin `N`, so a later
  // `N := 11` was invisible to the expression).
  let substituted = false;

  const params = signature.args?.map((x) => x.type) ?? [];
  const optParams = signature.optArgs?.map((x) => x.type) ?? [];
  const varParam = signature.variadicArg?.type;
  const varParamCount = signature.variadicMin ?? 0;

  let i = 0;

  // Iterate over any required parameters
  for (const param of params) {
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
    if (op.valueDefinition?.inferredType && isSubtype(param, op.type.type)) {
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
    // of the current inferred type: narrow rather than error.
    if (op.valueDefinition?.inferredType && isSubtype(param, op.type.type)) {
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
      // a subtype of the current inferred type: narrow rather than error.
      if (
        op.valueDefinition?.inferredType &&
        isSubtype(varParam, op.type.type)
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
    if (!lazy)
      if (!threadable || !couldBeCollectionOperand(finalOps[i]))
        finalOps[i].infer(param);
    i += 1;
  }
  for (const param of optParams) {
    if (!finalOps[i]) break;
    if (!lazy)
      if (!threadable || !couldBeCollectionOperand(finalOps[i]))
        finalOps[i].infer(param);
    i += 1;
  }
  if (varParam) {
    for (const op of finalOps.slice(i)) {
      if (!lazy)
        if (!threadable || !couldBeCollectionOperand(op)) op.infer(varParam);
      i += 1;
    }
  }
  return substituted ? result : null;
}

/**
 * Repair bottom-up numeric inference when a matrix-consuming operator gives
 * the enclosing context that was unavailable to Add/Multiply. Only symbols
 * first inferred while canonicalizing this argument are eligible. The repair
 * is deliberately structural and fail-closed: an ambiguous product such as
 * `a A` (both names fresh) is not guessed.
 */
function repairFreshMatrixInference(
  ce: ComputeEngine,
  op: Expression,
  expected: Type,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
): Expression | null {
  if (!freshlyInferred || !ce.type(expected).matches('matrix')) return null;

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
