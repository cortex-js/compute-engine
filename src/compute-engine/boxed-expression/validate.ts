import { each, isFiniteIndexableCollection } from '../collection-utils';
import { IComputeEngine, BoxedDomain, DomainLiteral, Hold } from '../public';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { canonical, shouldHold } from '../symbolic/utils';
import { BoxedExpression } from './public';

/**
 * Check that the number of arguments is as expected.
 *
 * Converts the arguments to canonical, and flattens the sequence.
 */
export function checkArity(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>,
  count: number
  // { flatten } = { flatten: true }
): ReadonlyArray<BoxedExpression> {
  ops = canonical(ops);
  // if (flatten) ops = flattenSequence(ops);
  ops = flattenSequence(ops);

  // @fastpath
  if (!ce.strict) return ops;

  if (ops.length === count) return ops;

  const xs: BoxedExpression[] = [...ops.slice(0, count)];
  let i = Math.min(count, ops.length);
  while (i < count) {
    xs.push(ce.error('missing'));
    i += 1;
  }
  while (i < ops.length) {
    xs.push(ce.error('unexpected-argument', ops[i]));
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
 * Converts the arguments to canonical, and flattens the sequence.
 */
export function checkNumericArgs(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>,
  options?: number | { count?: number; flatten?: boolean | string }
): ReadonlyArray<BoxedExpression> {
  let count = typeof options === 'number' ? options : options?.count;
  const flatten = typeof options === 'number' || (options?.flatten ?? true);
  ops = canonical(ops);
  if (flatten) ops = flattenSequence(ops);
  if (typeof flatten === 'string') flattenOps(ops, flatten);

  // @fastpath
  if (!ce.strict) {
    for (const x of ops)
      if (!isFiniteIndexableCollection(x)) x.infer(ce.Numbers);
    return ops;
  }

  let isValid = true;

  count ??= ops.length;

  const xs: BoxedExpression[] = [];
  for (let i = 0; i <= Math.max(count - 1, ops.length - 1); i++) {
    const op = ops[i];
    if (i > count - 1) {
      isValid = false;
      xs.push(ce.error('unexpected-argument', op));
    } else if (op === undefined) {
      isValid = false;
      xs.push(ce.error('missing'));
    } else if (
      op.symbol &&
      !ce.lookupSymbol(op.symbol) &&
      !ce.lookupFunction(op.symbol)
    ) {
      // We have an unknown symbol, we'll infer it's a number later
      xs.push(op);
    } else if (op.isNumber || op.domain?.isNumber) {
      // The argument is a number literal or a function whose result is a number
      xs.push(op);
    } else if (!op.isValid) {
      isValid = false;
      xs.push(op);
    } else if (!op.domain) {
      // No domain, set. Keep it that way, infer later
      xs.push(op);
    } else if (isFiniteIndexableCollection(op)) {
      // The argument is a list. Check that all elements are numbers
      // and infer the domain of the elements
      for (const x of each(op)) {
        if (!x.isNumber && !x.domain?.isNumber) {
          isValid = false;
          break;
        }
      }
      if (!isValid) xs.push(ce.domainError('Numbers', op.domain, op));
      else xs.push(op);
    } else if (
      op.symbolDefinition?.inferredDomain &&
      op.domain.isCompatible(ce.Numbers, 'contravariant')
    ) {
      // There was an inferred domain, and it is contravrariant with Numbers
      // e.g. "Anything". We'll narrow it down to Number when we infer later.
      xs.push(op);
    } else if (
      op.functionDefinition?.signature.inferredSignature &&
      op.domain.isCompatible(ce.Numbers, 'contravariant')
    ) {
      // There is an inferred signature, and its result is contravariant with Numbers
      // e.g. "Anything". We'll narrow it down to Number when we infer later.
      xs.push(op);
    } else {
      isValid = false;
      xs.push(ce.domainError('Numbers', op.domain, op));
    }
  }

  // Only if all arguments are valid, we infer the domain of the arguments
  if (isValid)
    for (const x of xs)
      if (isFiniteIndexableCollection(x))
        for (const y of each(x)) y.infer(ce.Numbers);
      else x.infer(ce.Numbers);

  return xs;
}

/**
 * Check that an argument is of the expected domain.
 *
 * Converts the arguments to canonical
 */
export function checkDomain(
  ce: IComputeEngine,
  arg: BoxedExpression | undefined | null,
  dom: BoxedDomain | DomainLiteral | undefined
): BoxedExpression {
  if (arg === undefined || arg === null) return ce.error('missing');
  if (dom === undefined) return ce.error('unexpected-argument', arg);
  arg = arg.canonical;
  if (arg.head === 'Sequence') arg = arg.op1;
  if (!arg.isValid) return arg;
  if (!arg.domain || arg.domain.isCompatible(dom)) return arg;
  return ce.domainError(dom, arg.domain, arg);
}

/**
 * Check that the argument is pure.
 */
export function checkPure(
  ce: IComputeEngine,
  arg: BoxedExpression | BoxedExpression | undefined | null
): BoxedExpression {
  if (arg === undefined || arg === null) return ce.error('missing');
  arg = arg.canonical;
  if (!arg.isValid) return arg;
  if (arg.isPure) return arg;
  return ce.error('expected-pure-expression', arg);
}

export function checkDomains(
  ce: IComputeEngine,
  args: ReadonlyArray<BoxedExpression>,
  doms: (BoxedDomain | DomainLiteral)[]
): ReadonlyArray<BoxedExpression> {
  // Do a quick check for the common case where everything is as expected.
  // Avoid allocating arrays and objects
  if (
    args.length === doms.length &&
    args.every((x, i) => !x.domain || x.domain.isCompatible(doms[i]))
  )
    return args;

  const xs: BoxedExpression[] = [];
  for (let i = 0; i <= doms.length - 1; i++)
    xs.push(checkDomain(ce, args[i], doms[i]));

  for (let i = doms.length; i <= args.length - 1; i++)
    xs.push(ce.error('unexpected-argument', args[i]));

  return xs;
}

/**
 *
 * If the arguments match the parameters, return null.
 *
 * Otherwise return a list of expressions indicating the mismatched
 * arguments.
 *
 */
export function adjustArguments(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>,
  hold: Hold,
  threadable: boolean,
  params: BoxedDomain[],
  optParams: BoxedDomain[],
  restParam: BoxedDomain | undefined
): ReadonlyArray<BoxedExpression> | null {
  // @fastpath
  if (!ce.strict) return null;

  const result: BoxedExpression[] = [];
  let isValid = true;

  // @todo: iterate over each ops:
  // if op is not valid, include it in the result
  // if op doesn't have a def, assume valid
  // if has a def, check if domains are compatible
  // After that, check the return value, if one is provided
  // If everything is OK, infer the domains of the ops
  let i = 0;

  // Iterate over any required parameters
  for (const param of params) {
    const op = ops[i++];
    if (!op) {
      result.push(ce.error('missing'));
      isValid = false;
      continue;
    }
    if (shouldHold(hold, params.length, i - 1)) {
      result.push(op);
      continue;
    }
    if (!op.isValid) {
      result.push(op);
      isValid = false;
      continue;
    }
    if (!op.domain) {
      // An expression without a domain is assumed to be valid,
      // we'll infer the domain later
      result.push(op);
      continue;
    }
    if (threadable && isFiniteIndexableCollection(op)) {
      result.push(op);
      continue;
    }
    if (
      op.symbolDefinition?.inferredDomain &&
      op.domain.isCompatible(param, 'contravariant')
    ) {
      result.push(op);
      continue;
    }

    if (
      op.functionDefinition?.signature.inferredSignature &&
      op.domain.isCompatible(param, 'contravariant')
    ) {
      result.push(op);
      continue;
    }

    if (!op.domain.isCompatible(param)) {
      result.push(ce.domainError(param, op.domain, op));
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
    if (shouldHold(hold, params.length, i)) {
      result.push(op);
      continue;
    }
    if (!op.isValid) {
      result.push(op);
      isValid = false;
      i += 1;
      continue;
    }
    if (!op.domain) {
      // An expression without a domain is assumed to be valid,
      // we'll infer the domain later
      result.push(op);
      i += 1;
      continue;
    }
    if (threadable && isFiniteIndexableCollection(op)) {
      result.push(op);
      continue;
    }
    if (
      op.symbolDefinition?.inferredDomain &&
      op.domain.isCompatible(param, 'contravariant')
    ) {
      // There was an inferred domain, and it is contravrariant with Numbers
      // e.g. "Anything". We'll narrow it down to Number when we infer later.
      result.push(op);
      continue;
    }
    if (!op.domain.isCompatible(param)) {
      result.push(ce.domainError(param, op.domain, op));
      isValid = false;
      i += 1;
      continue;
    }
    result.push(op);
    i += 1;
  }

  // Iterate over any remaining ops
  if (restParam) {
    for (const op of ops.slice(i)) {
      i += 1;
      if (shouldHold(hold, params.length, i - 1)) {
        result.push(op);
        continue;
      }
      if (!op.isValid) {
        result.push(op);
        isValid = false;
        continue;
      }
      if (!op.domain) {
        // An expression without a domain is assumed to be valid,
        // we'll infer the domain later
        result.push(op);
        continue;
      }
      if (threadable && isFiniteIndexableCollection(op)) {
        result.push(op);
        continue;
      }
      if (
        op.symbolDefinition?.inferredDomain &&
        op.domain.isCompatible(restParam, 'contravariant')
      ) {
        // There was an inferred domain, and it is contravrariant with Numbers
        // e.g. "Anything". We'll narrow it down to Number when we infer later.
        result.push(op);
        continue;
      }
      if (!op.domain.isCompatible(restParam)) {
        result.push(ce.domainError(restParam, op.domain, op));
        isValid = false;
        continue;
      }
      result.push(op);
    }
  }

  // Are there any remaining parameters?
  if (i < ops.length) {
    for (const op of ops.slice(i)) {
      result.push(ce.error('unexpected-argument', op));
      isValid = false;
    }
  }

  if (!isValid) return result;

  // All arguments are valid, we can infer the domain of the arguments
  i = 0;
  for (const param of params) {
    if (!shouldHold(hold, params.length, i))
      if (!threadable || !isFiniteIndexableCollection(ops[i]))
        ops[i].infer(param);
    i += 1;
  }
  for (const param of optParams) {
    if (!threadable || !isFiniteIndexableCollection(ops[i]))
      ops[i]?.infer(param);
    i += 1;
  }
  if (restParam) {
    for (const op of ops.slice(i)) {
      if (!shouldHold(hold, params.length, i))
        if (!threadable || !isFiniteIndexableCollection(op))
          op.infer(restParam);
      i += 1;
    }
  }
  return null;
}
