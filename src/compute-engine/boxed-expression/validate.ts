import {
  IComputeEngine,
  BoxedExpression,
  BoxedDomain,
  DomainLiteral,
} from '../public';

export function validateArgumentCount(
  ce: IComputeEngine,
  ops: BoxedExpression[],
  count: number
): BoxedExpression[] {
  if (ops.length === count) return ops;
  const xs = [...ops.slice(0, count)];
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
 * the regular checks. This is its replacements. Since all those fastpath
 * functions are numeric (i.e. have numeric arguments and return a numeric
 * value), we do a simple numeric check of all arguments, and verify we have
 * the number of expected arguments.
 */
export function validateNumericArgs(
  ce: IComputeEngine,
  ops: BoxedExpression[],
  count?: number
): BoxedExpression[] {
  // @fastpath
  if (!ce.strict) return ops;

  let xs: BoxedExpression[];
  if (count === undefined) xs = ops;
  else {
    xs = [];
    for (let i = 0; i <= Math.max(count - 1, ops.length - 1); i++) {
      if (i > count - 1) xs.push(ce.error('unexpected-argument', ops[i]));
      else
        xs.push(
          ops[i] !== undefined
            ? ce.box(ops[i])
            : ce.error(['missing', 'Number'])
        );
    }
  }

  return xs.map((op) =>
    !op.isValid || op.isNumber
      ? op
      : ce.error(['incompatible-domain', 'Number', op.domain], op)
  );
}

/** Return `null` if the `ops` match the sig. Otherwise, return an array
 * of expressions indicating the mismatched arguments.
 *
 */
export function validateSignature(
  sig: BoxedDomain,
  ops: BoxedExpression[],
  codomain?: BoxedExpression
): BoxedExpression[] | null {
  const ce = sig.engine;

  // @fastpath
  if (!ce.strict) return ops;

  const opsDomain = ops.map((x) => x.domain);

  const targetSig = ce.domain([
    'Function',
    ...opsDomain,
    codomain ?? 'Anything',
  ]);

  if (sig.isCompatible(targetSig)) return null;

  //
  // There was a problem:
  // 1/ not enough arguments
  // 2/ too many arguments
  // 3/ incompatible argument domain
  //
  // Iterate over each arg, and replace with error expression when appropriate
  //

  const expectedArgs = sig.domainArgs!.slice(0, -1);
  const count = Math.max(expectedArgs.length, opsDomain.length);
  let newOps: BoxedExpression[] = [];
  let rest: BoxedExpression[] = [...ops];
  for (let i = 0; i <= count - 1; i++)
    [newOps, rest] = validateNextArgument(
      ce,
      expectedArgs[i] as BoxedDomain | DomainLiteral,
      newOps,
      rest
    );

  // Remove any 'Nothing' at the end
  while (newOps.length > 0 && newOps[newOps.length - 1].symbol === 'Nothing')
    newOps.pop();
  return newOps;
}

export function validateArgument(
  ce: IComputeEngine,
  arg: BoxedExpression | undefined,
  dom: BoxedDomain | DomainLiteral | undefined
): BoxedExpression {
  if (dom === undefined) return ce.error('unexpected-argument', arg);
  if (arg === undefined) return ce.error(['missing', dom]);
  if (!arg.isValid) return arg;
  if (arg?.domain.isCompatible(dom)) return arg;
  return ce.error(['incompatible-domain', dom, arg.domain], arg);
}

function validateNextArgument(
  ce: IComputeEngine,
  dom: BoxedDomain | DomainLiteral | undefined,
  matched: BoxedExpression[],
  ops: BoxedExpression[]
): [match: BoxedExpression[], rest: BoxedExpression[]] {
  let next = ops.shift();

  if (dom === undefined)
    return [[...matched, ce.error('unexpected-argument', next)], ops];

  if (!Array.isArray(dom)) {
    if (!next) return [[...matched, ce.error(['missing', dom])], ops];

    if (!next.domain.isCompatible(dom)) {
      return [
        [...matched, ce.error(['incompatible-domain', dom, next.domain], next)],
        ops,
      ];
    }

    return [[...matched, next], ops];
  }

  const ctor = dom[0];

  if (next === undefined) {
    //
    // An expected argument is missing. Is that OK?
    //
    let valid = false;
    if (ctor === 'Union') {
      //  If an `Union`, was `Nothing` an option?
      for (let k = 1; k <= dom.length - 1; k++) {
        if (dom[k] === 'Nothing') {
          valid = true;
          break;
        }
      }
    } else if (ctor === 'Maybe') valid = true;
    if (valid) return [[...matched, ce.symbol('Nothing')], ops];
    return [[...matched, ce.error(['missing', dom])], ops];
  }

  if (ctor === 'Union') {
    //
    // We expect one of several domains. Check if at least one matches
    //
    let found = false;
    for (let k = 1; k <= dom.length - 1; k++) {
      if (next.domain.isCompatible(dom[k])) {
        found = true;
        break;
      }
    }
    if (found) return [[...matched, next], ops];
    return [
      [...matched, ce.error(['incompatible-domain', dom, next.domain], next)],
      ops,
    ];
  }

  if (ctor === 'Sequence') {
    const seq = dom[1];
    if (!next || !next.domain.isCompatible(seq)) {
      return [
        [...matched, ce.error(['incompatible-domain', seq, next.domain], next)],
        ops,
      ];
    }
    let done = false;
    const result = [...matched, next];
    while (!done) {
      next = ops.shift();
      if (!next) done = false;
      else if (!next.domain.isCompatible(seq)) {
        ops.unshift(next);
        done = false;
      } else result.push(next);
    }

    return [result, ops];
  }

  if (ctor === 'Maybe') {
    if (next === undefined || next.symbol === 'Nothing')
      return [[...matched, ce.symbol('Nothing')], ops];
    return validateNextArgument(ce, dom[1], matched, [next, ...ops]);
  }

  console.error('Unhandled ctor', ctor);

  return [[...matched, next], ops];
}

export function validateArguments(
  ce: IComputeEngine,
  args: BoxedExpression[],
  doms: (BoxedDomain | DomainLiteral)[]
): BoxedExpression[] {
  // Do a quick check for the common case where everything is as expected.
  // Avoid allocating arrays and objects
  if (
    args.length === doms.length &&
    args.every((x, i) => x.domain.isCompatible(doms[i]))
  )
    return args;

  const xs: BoxedExpression[] = [];
  for (let i = 0; i <= doms.length - 1; i++)
    xs.push(validateArgument(ce, args[i], doms[i]));

  for (let i = doms.length; i <= args.length - 1; i++)
    xs.push(ce.error('unexpected-argument', args[i]));

  return xs;
}
