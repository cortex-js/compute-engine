import { isFiniteIndexedCollection } from '../collection-utils.js';

import { flatten } from './flatten.js';
import { isSubtype } from '../../common/type/subtype.js';
import { parseType } from '../../common/type/parse.js';
import { Type } from '../../common/type/types.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import { fuzzyStringMatch } from '../../common/fuzzy-string-match.js';
import { isOperatorDef, isValueDef } from './utils.js';
import { isTensor } from './boxed-tensor.js';
import { isSymbol, isFunction, isContinuationOperand } from './type-guards.js';

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

/**
 * Return true if a type could be a numeric collection at runtime.
 * Used in `checkNumericArgs` (the fastpath for threadable numeric functions)
 * to accept types like `list`, `number | list`, but not tuples
 * with non-numeric elements.
 */
function typeCouldBeNumericCollection(type: Type): boolean {
  if (typeof type === 'string') {
    return (
      type === 'list' ||
      type === 'set' ||
      type === 'collection' ||
      type === 'indexed_collection'
    );
  }
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set'
  )
    return true;
  // A `broadcastable<S>` operand COULD be a numeric indexed collection at
  // runtime. Mirroring the COULD-semantics above (which admit `list`/
  // `collection` without inspecting elements), `broadcastable<any>` /
  // `broadcastable<unknown>` qualify too; a numeric-ish element type is
  // admitted, a plainly non-numeric one (e.g. `broadcastable<string>`) is not.
  if (type.kind === 'broadcastable') {
    const el = type.elements;
    return (
      el === 'any' ||
      el === 'unknown' ||
      isSubtype(el, 'number') ||
      isSubtype('number', el)
    );
  }
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericCollection(t));
  return false;
}

/**
 * Return true if a type *could* be a numeric tuple (point/vector in ℝⁿ) at
 * runtime — a `tuple` whose every element type could be numeric. Such tuples
 * participate in vector arithmetic (`z + (1,2)`, `2·z`), so `checkNumericArgs`
 * admits them as a pass-through (without inferring their elements to `real`).
 *
 * This mirrors the COULD-semantics of `typeCouldBeNumericCollection`: an
 * `any`/`unknown` element (e.g. `(w.x, w.y)` on an undeclared `w`, typed
 * `tuple<any, any>`) qualifies, so the expression stays symbolic instead of
 * erroring during validation. (The provable numeric-tuple guards at
 * canonicalization use the stricter `isNumericTuple`.)
 */
function typeCouldBeNumericTuple(type: Type): boolean {
  // A component may itself be a numeric collection (a Desmos-style point-list
  // like `(-6, n)` with `n` a list): the tuple then transposes to a `List` of
  // point-tuples at evaluation. Accept such a component here so the tuple is
  // not rejected during arithmetic operand validation (`2·(1, 0.3n)`).
  const elementCouldBeNumeric = (el: Type): boolean =>
    el === 'any' ||
    el === 'unknown' ||
    isSubtype(el, 'number') ||
    isSubtype('number', el) ||
    typeCouldBeNumericCollection(el);
  if (typeof type === 'string') return type === 'tuple';
  if (type.kind === 'tuple')
    return type.elements.every((el) => elementCouldBeNumeric(el.type));
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericTuple(t));
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
      if (isSubtype('complex', x.type.type)) {
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
  for (let i = 0; i <= Math.max(count - 1, ops.length - 1); i++) {
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
      // The argument is a list. Check that all elements are numbers
      // and infer the type of the elements
      for (const x of op.each()) {
        if (!x.isNumber) {
          isValid = false;
          break;
        }
      }
      if (!isValid) xs.push(ce.typeError('number', op.type, op));
      else xs.push(op);
    } else if (
      op.isIndexedCollection &&
      op.isFiniteCollection === undefined &&
      op.type.matches(parseType('indexed_collection<number>'))
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
      if (isSubtype('complex', x.type.type)) {
        inferredType = 'number';
        break;
      }
    for (const x of xs)
      if (isFiniteIndexedCollection(x)) {
        // `.each()` on a *lazy* collection (e.g. a large `Range`) materializes
        // every element, so walking it just to run no-op inferences enumerates
        // the whole range at parse time (item 16: `\frac{[1...1e8]}{2}` hung
        // `ce.parse`). Skip the walk for a lazy collection with no free
        // variables — `unknowns` reads the structural operands (the range's
        // bounds), never the materialized elements, so this guard is O(1) for
        // a Range. Eager collections (e.g. `List`) already store their
        // elements as operands, so walking them is cheap regardless of
        // `unknowns`: `BoxedFunction.infer()` also narrows an inferred
        // *result signature* (not just free symbols), so a concrete literal
        // list containing an inferred function call still needs the walk.
        if (x.isLazyCollection && x.unknowns.length === 0) continue;
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
  inferredBefore?: ReadonlySet<string>
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
    if (
      threadable &&
      (isFiniteIndexedCollection(op) || typeCouldBeCollection(op.type.type))
    ) {
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

    if (!op.type.matches(param)) {
      const repaired = repairFreshMatrixInference(
        ce,
        op,
        param,
        inferredBefore
      );
      if (repaired) {
        result.push(repaired);
        continue;
      }
      // A bare uppercase symbol bound to a standard-library operator (`N`,
      // `D`) used where a value is required almost always means a variable
      // (`N \equiv 1 \pmod k`): devolve it to an unknown symbol, mirroring
      // the checkNumericArgs fallback.
      const devolved = devolveUnappliedOperator(ce, op);
      if (devolved !== null) {
        result.push(devolved);
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
    if (
      threadable &&
      (isFiniteIndexedCollection(op) || typeCouldBeCollection(op.type.type))
    ) {
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
      if (
        threadable &&
        (isFiniteIndexedCollection(op) || typeCouldBeCollection(op.type.type))
      ) {
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
  i = 0;
  for (const param of params) {
    if (!lazy)
      if (
        !threadable ||
        (!isFiniteIndexedCollection(ops[i]) &&
          !typeCouldBeCollection(ops[i].type.type))
      )
        ops[i].infer(param);
    i += 1;
  }
  for (const param of optParams) {
    if (!ops[i]) break;
    if (
      !threadable ||
      (!isFiniteIndexedCollection(ops[i]) &&
        !typeCouldBeCollection(ops[i].type.type))
    )
      ops[i]?.infer(param);
    i += 1;
  }
  if (varParam) {
    for (const op of ops.slice(i)) {
      if (!lazy)
        if (
          !threadable ||
          (!isFiniteIndexedCollection(op) &&
            !typeCouldBeCollection(op.type.type))
        )
          op.infer(varParam);
      i += 1;
    }
  }
  return null;
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
  inferredBefore?: ReadonlySet<string>
): Expression | null {
  if (!inferredBefore || !ce.type(expected).matches(parseType('matrix')))
    return null;

  const eligible = new Set<string>();
  for (const name of op.freeVariables) {
    if (inferredBefore.has(name)) continue;
    const def = ce.lookupDefinition(name);
    if (def && isValueDef(def) && def.value.inferredType) eligible.add(name);
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
  let suggestions: Record<string, string> = {};
  const knownSymbols = getSymbolNames(expr.engine);
  const knownOperators = getOperatorNames(expr.engine);

  if (
    isSymbol(expr) &&
    !suggestions[expr.symbol] &&
    !expr.symbol.startsWith('_')
  ) {
    if (!knownSymbols.includes(expr.symbol)) {
      const match = fuzzyStringMatch(expr.symbol, knownSymbols);
      if (match) suggestions[expr.symbol] = match;
    }
  } else if (
    isFunction(expr) &&
    !suggestions[expr.operator] &&
    !expr.operator.startsWith('_')
  ) {
    const operator = expr.operator;
    if (!knownOperators.includes(operator)) {
      const match = fuzzyStringMatch(operator, knownOperators);
      if (match) suggestions[operator] = match;
    }
    for (const op of expr.ops)
      suggestions = { ...suggestions, ...spellcheckSymbols(op) };
  }

  return suggestions;
}

function getOperatorNames(ce: ComputeEngine): string[] {
  const names: string[] = [];
  let currentScope: Scope | null = ce.context.lexicalScope;
  while (currentScope) {
    for (const key of currentScope.bindings.keys()) {
      const def = currentScope.bindings.get(key);
      if (isOperatorDef(def)) names.push(key);
    }

    currentScope = currentScope.parent;
  }

  return names;
}

/** Get the list of all known symbols in the current scope */
function getSymbolNames(ce: ComputeEngine): string[] {
  const names: string[] = [];
  let currentScope: Scope | null = ce.context.lexicalScope;
  while (currentScope) {
    for (const key of currentScope.bindings.keys()) {
      const def = currentScope.bindings.get(key);
      if (isValueDef(def)) names.push(key);
    }

    currentScope = currentScope.parent;
  }

  return names;
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
