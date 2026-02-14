import { isFiniteIndexedCollection } from '../collection-utils';

import { flatten } from './flatten';
import { isSubtype } from '../../common/type/subtype';
import { Type } from '../../common/type/types';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types';
import { fuzzyStringMatch } from '../../common/fuzzy-string-match';
import { isOperatorDef, isValueDef } from './utils';
import { isTensor } from './boxed-tensor';
import { isSymbol, isFunction } from './type-guards';

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
  if (type.kind === 'list' || type.kind === 'set' || type.kind === 'tuple')
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
  if (type.kind === 'list' || type.kind === 'set') return true;
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericCollection(t));
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
  if (!ce.strict) return ops;

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

  ops = flatten(ops, flattenHead);

  // @fastpath
  if (!ce.strict) {
    let inferredType: Type = 'real';
    // If any of the arguments is a complex or imaginary number,
    // we'll infer the type as number
    for (const x of ops)
      if (isSubtype('complex', x.type.type)) {
        inferredType = 'number';
        break;
      }
    for (const x of ops)
      if (!isFiniteIndexedCollection(x)) x.infer(inferredType);
    return ops;
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
      isValid = false;
      xs.push(ce.typeError('number', op.type, op));
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
      if (isFiniteIndexedCollection(x))
        for (const y of x.each()) y.infer(inferredType);
      else x.infer(inferredType);
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
  threadable?: boolean
): ReadonlyArray<Expression> | null {
  // @fastpath
  if (!ce.strict) return null;

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

    if (op.operatorDefinition?.inferredSignature && op.type.matches(param)) {
      result.push(op);
      continue;
    }

    if (!op.type.matches(param)) {
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
