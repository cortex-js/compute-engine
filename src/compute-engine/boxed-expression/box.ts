import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';
import type {
  SemiBoxedExpression,
  BoxedExpression,
  CanonicalOptions,
  ComputeEngine,
  Metadata,
  Scope,
} from '../global-types';

import { Expression, MathJsonSymbol } from '../../math-json/types';
import {
  machineValue,
  matchesNumber,
  matchesString,
  matchesSymbol,
  missingIfEmpty,
  stringValue,
  symbol,
} from '../../math-json/utils';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols';

import { isOne } from '../numerics/rationals';
import { asBigint } from './numerics';
import { isInMachineRange } from '../numerics/numeric-bignum';

import { canonicalAdd } from './arithmetic-add';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div';

import { NumericValue } from '../numeric-value/types';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { canonicalPower, canonicalRoot } from './arithmetic-power';

import { _BoxedExpression } from './abstract-boxed-expression';
import { BoxedFunction } from './boxed-function';
import { BoxedString } from './boxed-string';
import { BoxedTensor, expressionTensorInfo } from './boxed-tensor';
import { BoxedDictionary } from './boxed-dictionary';
import { canonicalForm } from './canonical';
import { sortOperands } from './order';
import { validateArguments, checkNumericArgs } from './validate';
import { flatten } from './flatten';
import { isValueDef } from './utils';
import { canonicalNegate } from './negate';
import { canonical } from './canonical-utils';
// Dynamic import to avoid circular dependency

/**
 * ### THEORY OF OPERATIONS
 *
 *
 * 1/ The result of boxing is canonical by default.
 *
 *   This is the most common need (i.e. to evaluate an expression you need it
 *   in canonical form). Creating a boxed expression which is canonical from the
 *   start avoid going through an intermediary step with a non-canonical
 *   expression.
 *
 * 2/ When boxing (and canonicalizing), if the function is "scoped", a new
 *    scope is created before the canonicalization, so that any declaration
 *    are done within that scope. Example of scoped functions include `Block`
 *    and `Sum`.
 *
 * 3/ When implementing an `evaluate()`:
 * - if `bignumPreferred()` all operations should be done in bignum,
 *    otherwise, they should all be done in machine numbers.
 * - if a rational is encountered, preserve it
 * - if a `Sqrt` of a rational is encountered, preserve it
 * - if a `hold` constant is encountered, preserve it
 * - if `numericApproximation` is false and one of the arguments is not exact,
 *  return an approximation
 * - if `numericApproximation` is true, always return an approximation
 *
 * NUMERIC APPROXIMATION = FALSE
 * - 2 + 5 -> 7
 * - 2 + 5/7 -> 19/7
 * - 2 + √2 -> 2 + √2
 * - 2 + √(5/7) -> 2 + √(5/7)
 * - 5/7 + 9/11 -> 118/77
 * - 5/7 + √2 -> 5/7 + √2
 * - 10/14 + √(18/9) -> 5/7 + √2
 * - √2 + √5 -> √2 + √5
 * - √2 + √2 -> 2√2
 * - sin(2) -> sin(2)
 * - sin(pi/3) -> √3/2
 * - 2 + 2.1 -> 2 + 2.1
 *
 * NUMERIC APPROXIMATION = TRUE
 * - 2 + 2.1 -> 4.1
 * - 2 + √2.1 -> 3.44914
 * - 5/7 + √2.1 -> 2.16342
 * - sin(2) + √2.1 -> 2.35844
 */

function boxHold(
  ce: ComputeEngine,
  expr: SemiBoxedExpression | null,
  options: { canonical?: CanonicalOptions }
): BoxedExpression {
  if (expr instanceof _BoxedExpression) return expr;

  expr = missingIfEmpty(expr as Expression);

  if (typeof expr === 'string') return box(ce, expr, options);

  if (Array.isArray(expr)) {
    const [fnName, ...ops] = expr;
    return new BoxedFunction(
      ce,
      fnName,
      ops.map((x) => boxHold(ce, x, options)),
      { canonical: false }
    );
  }
  if (typeof expr === 'object') {
    if ('fn' in expr) return boxHold(ce, expr.fn, options);
    if ('str' in expr) return new BoxedString(ce, expr.str);
    if ('sym' in expr) return box(ce, expr.sym, options);
    if ('num' in expr) return box(ce, expr.num, options);
  }

  return box(ce, expr, options);
}

/**
 * Given a name and a set of arguments, return a boxed function expression.
 *
 * If available, preserve LaTeX and wikidata metadata in the boxed expression.
 *
 * Note that `boxFunction()` should only be called from `ce.function()`
 */

export function boxFunction(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  ops: readonly SemiBoxedExpression[],
  options?: {
    metadata?: Metadata;
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): BoxedExpression {
  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  if (!isValidSymbol(name)) {
    throw new Error(
      `Unexpected operator: "${name}" is not a valid symbol: ${validateSymbol(name)}`
    );
  }

  const structural = options.structural ?? false;

  //
  // Hold
  //

  if (name === 'Hold') {
    return new BoxedFunction(ce, 'Hold', [boxHold(ce, ops[0], options)], {
      ...options,
      canonical: true,
      structural,
    });
  }

  //
  // Error
  //
  if (name === 'Error' || name === 'ErrorCode') {
    return new BoxedFunction(
      ce,
      name,
      ops.map((x) => ce.box(x, { canonical: false })),
      { metadata: options?.metadata, canonical: true }
    );
  }

  //
  // Number
  //
  if (name === 'Number' && ops.length === 1) return box(ce, ops[0], options);

  const canonicalNumber = structural === false && options.canonical === true;

  // If canonical, handle cases of various expression structures being able to
  // be cast as BoxedNumbers (some cases of Negate, Rational, Divide, Complex),
  // or 'de-number' some 'borderline invalid' boxed number-like expressions
  // (!@note: this procedure is similarly repeated within the 'number'
  //  CanonicalForm, but the numberForm variant more simply applies to fully
  // BoxedExprs., and during partial canonicalization only)
  if (canonicalNumber) {
    //
    // Rational (as Divide)
    //
    if ((name === 'Divide' || name === 'Rational') && ops.length === 2) {
      const n = asBigint(ops[0]);
      if (n !== null) {
        const d = asBigint(ops[1]);
        if (d !== null) return ce.number([n, d], options);
      }
      name = 'Divide';
    }

    //
    // Complex
    //
    if (name === 'Complex') {
      if (ops.length === 1) {
        // If single argument, assume it's imaginary
        const op1 = ops[0];
        if (op1 instanceof _BoxedExpression && op1.isNumberLiteral)
          return ce.number(ce.complex(0, op1.re), options);

        const im = machineValue(ops[0] as Expression);
        if (im !== null && im !== 0)
          return ce.number(ce.complex(0, im), options);

        return ce.box(op1).mul(ce.I);
      }
      if (ops.length === 2) {
        const re =
          ops[0] instanceof _BoxedExpression
            ? ops[0].re
            : machineValue(ops[0] as Expression);
        const im =
          ops[1] instanceof _BoxedExpression
            ? ops[1].re
            : machineValue(ops[1] as Expression);
        if (im !== null && re !== null && !isNaN(im) && !isNaN(re)) {
          if (im === 0 && re === 0) return ce.Zero;
          if (im !== 0) return ce.number(ce._numericValue({ re, im }), options);
          return box(ce, ops[0], options);
        }
        return box(ce, ops[0], options).add(box(ce, ops[1], options).mul(ce.I));
      }
      throw new Error('Expected one or two arguments with Complex expression');
    }

    //
    // Negate
    //
    // Distribute over literals
    //
    if (name === 'Negate' && ops.length === 1) {
      const op1 = ops[0];
      if (typeof op1 === 'number') return ce.number(-op1, options);
      if (op1 instanceof Decimal) return ce.number(op1.neg(), options);
      const boxedop1 = ce.box(op1, options);
      const num = boxedop1.numericValue;
      if (num !== null)
        return ce.number(typeof num === 'number' ? -num : num.neg(), options);
      ops = [boxedop1];
    }
  }

  if (options.canonical === true)
    return makeCanonicalFunction(
      ce,
      name,
      ops,
      options.metadata,
      options.scope
    );

  return canonicalForm(
    new BoxedFunction(
      ce,
      name,
      ops.map((x) =>
        box(ce, x, {
          canonical: options.canonical,
          structural,
          scope: options.scope,
        })
      ),
      {
        metadata: options.metadata,
        canonical: false,
        structural,
        scope: options.scope,
      }
    ),
    options.canonical ?? false,
    options.scope
  );
}

/**
 * Notes about the boxed form:
 *
 * [1] Expression with an operator of `Number`, `String`, `Symbol` and `Dictionary`
 *      are converted to the corresponding atomic expression.
 *
 * [2] Expressions with an operator of `Complex` are converted to a (complex) number
 *     or a `Add`/`Multiply` expression.
 *
 *     The precedence of `Complex` (for serialization) is sometimes the
 *     precedence of `Add` (when re and im != 0), sometimes the precedence of
 *    `Multiply` (when im or re === 0). Using a number or an explicit
 *    `Add`/`Multiply` expression avoids this ambiguity.
 *
 * [3] An expression with a `Rational` operator is converted to a rational
 *    number if possible, to a `Divide` otherwise.
 *
 * [4] A `Negate` function applied to a number literal is converted to a number.
 *
 *     Note that `Negate` is only distributed over addition. In practice, having
 * `Negate` factored on multiply/divide is more useful to detect patterns.
 *
 * Note that this function should only be called from `ce.box()`
 *
 */

export function box(
  ce: ComputeEngine,
  expr: null | undefined | NumericValue | SemiBoxedExpression,
  options?: {
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): BoxedExpression {
  if (expr === null || expr === undefined) return ce.error('missing');

  if (expr instanceof NumericValue) return fromNumericValue(ce, expr);

  if (expr instanceof _BoxedExpression)
    return canonicalForm(expr, options?.canonical ?? true, options?.scope);

  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  // If canonical is true, we want to canonicalize the arguments
  // If it's false or a CanonicalForm, we don't want to canonicalize the
  // arguments during create, we'll call canonicalForm to take care of it
  const canonical = options.canonical === true;

  const structural = options.structural ?? false;

  //
  //  Box a function
  //
  if (Array.isArray(expr)) {
    if (typeof expr[0] !== 'string')
      throw new Error(
        `The first element of an array should be a string (the function name): ${JSON.stringify(expr, undefined, 4)}`
      );

    return canonicalForm(
      boxFunction(ce, expr[0], expr.slice(1) as SemiBoxedExpression[], {
        canonical,
        structural,
        scope: options?.scope,
      }),
      options?.canonical ?? true,
      options?.scope
    );
  }

  //
  // Box a number
  //
  if (
    typeof expr === 'number' ||
    expr instanceof Decimal ||
    expr instanceof Complex
  )
    return ce.number(expr);

  //
  // Box a String, a Symbol or a number as a string shorthand
  //
  if (typeof expr === 'string') {
    // Is it a symbol?
    if (matchesSymbol(expr)) {
      const sym = symbol(expr);
      if (!sym || !isValidSymbol(sym)) return ce.error('invalid-symbol', expr);
      // Let 'partial' canonicalization fetch the canonical variant of symbols: in order that at
      // minimum, they may be substituted with associated definition values (when its def. 'holdUntil'
      // is 'never')
      // @note: alternatively, this could be signalled by a 'Symbol' CanonicalForm: but this way is
      // more predictable, & ensures substitution as per above
      const canonicalSymbol = canonical || options.canonical !== false;
      return ce.symbol(sym, { canonical: canonicalSymbol });
    }

    if (matchesNumber(expr)) return ce.number(expr);

    // Must be a string...
    console.assert(matchesString(expr));
    return new BoxedString(ce, stringValue(expr)!);
  }

  //
  // Box a MathJSON object literal
  //
  if (typeof expr === 'object') {
    if ('fn' in expr) {
      const [fnName, ...ops] = expr.fn;
      return canonicalForm(
        boxFunction(ce, fnName, ops, { canonical, structural }),
        options.canonical!,
        options.scope
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str);
    if ('sym' in expr) return ce.symbol(expr.sym, { canonical });
    if ('num' in expr) return ce.number(expr, { canonical });
    if ('dict' in expr)
      return new BoxedDictionary(ce, expr.dict, { canonical });

    throw new Error(
      `Unexpected MathJSON object: ${JSON.stringify(expr, undefined, 4)}`
    );
  }

  return ce.symbol('Undefined');
}

function makeCanonicalFunction(
  ce: ComputeEngine,
  name: string,
  ops: ReadonlyArray<SemiBoxedExpression>,
  metadata: Metadata | undefined,
  scope: Scope | undefined
): BoxedExpression {
  let result = makeNumericFunction(ce, name, ops, metadata, scope);
  if (result) return result;

  //
  // Do we have a vector/matrix/tensor?
  // It has to have a compatible shape: i.e. all elements on an axis have
  // the same shape, and all elements of the same type.
  //
  if (name === 'List') {
    // We don't canonicalize it, in case it's a List (we want to detect lists of lists)
    const boxedOps = ops.map((x) => ce.box(x, { canonical: false }));
    const tensorInfo = expressionTensorInfo('List', boxedOps);

    if (tensorInfo && tensorInfo.dtype) {
      return new BoxedTensor(
        ce,
        {
          ops: canonical(ce, boxedOps, scope),
          shape: tensorInfo.shape,
          dtype: tensorInfo.dtype,
        },
        { metadata }
      );
    }

    return new BoxedFunction(ce, 'List', canonical(ce, boxedOps, scope), {
      canonical: true,
    });
  }

  if (name === 'Dictionary') {
    const boxedOps = ops.map((x) => ce.box(x, { canonical: false }));
    return new BoxedDictionary(ce, ce._fn('Dictionary', boxedOps), {
      canonical: true,
    });
  }

  //
  // Didn't match a short path, look for a definition
  //
  const def = ce.lookupDefinition(name);
  if (!def) {
    // No def. This is for example `["f", 2]` where "f" is not declared.
    ce.declare(name, { type: 'function', inferred: true });
    return new BoxedFunction(ce, name, flatten(semiCanonical(ce, ops)), {
      metadata,
      canonical: true,
    });
  }

  if (isValueDef(def)) {
    // The symbol is declared, but as a value.
    // We construct the function expression and will check its value
    // is a function literal when evaluating it.
    return new BoxedFunction(ce, name, flatten(semiCanonical(ce, ops)), {
      metadata,
      canonical: true,
    });
  }

  const opDef = def.operator;

  // If the operator has a local scope, create it now (unless we were given one,
  // for example one might have been create to record the arguments of a
  // function, but not for a Block expression)
  scope ??= opDef.scoped
    ? {
        parent: ce.context.lexicalScope,
        bindings: new Map(),
      }
    : undefined;

  if (opDef.lazy) {
    // If we have a lazy function, we don't canonicalize the arguments
    const xs = ops.map((x) => ce.box(x, { canonical: false }));
    if (opDef.canonical) {
      try {
        result = opDef.canonical(xs, { engine: ce, scope });
        if (result) return result;
      } catch (e) {
        console.error(e.message);
      }
      // The canonical handler gave up, return a non-canonical expression
      result = new BoxedFunction(ce, name, xs, {
        metadata,
        canonical: false,
      });
      return result;
    }

    result = new BoxedFunction(
      ce,
      name,
      validateArguments(
        ce,
        xs,
        opDef.signature.type,
        opDef.lazy,
        opDef.broadcastable
      ) ?? xs,
      { metadata, canonical: true, scope }
    );
    return result;
  }

  const xs = ops.map((x) => ce.box(x));

  //
  // 3/ Apply `canonical` handler
  //
  // If present, the canonical handler is responsible for
  //  - validating the signature (domain and number of arguments)
  //  - sorting them
  //  - applying involution and idempotent to the expression
  //  - flatenning sequences
  //
  // The arguments have been put in canonical form
  //
  if (opDef.canonical) {
    try {
      const result = opDef.canonical(xs, { engine: ce, scope });
      if (result) return result;
    } catch (e) {
      console.error(e.message);
    }

    // The canonical handler gave up, return a non-canonical expression
    const result = new BoxedFunction(ce, name, xs, {
      metadata,
      canonical: false,
    });

    return result;
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), Sequence(), d) -> f(a, b, c, d)
  //
  const args: BoxedExpression[] = flatten(
    xs,
    opDef.associative ? name : undefined
  );

  const adjustedArgs = validateArguments(
    ce,
    args,
    opDef.signature.type,
    opDef.lazy,
    opDef.broadcastable
  );

  // If we have some adjusted arguments, the arguments did not
  // match the parameters of the signature. We're done.
  if (adjustedArgs) {
    return new BoxedFunction(ce, name, adjustedArgs, {
      metadata,
      canonical: true,
      scope,
    });
  }

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (args.length === 1 && args[0].operator === name) {
    // f(f(x)) -> x
    if (opDef.involution) return args[0].op1;

    // f(f(x)) -> f(x)
    if (opDef.idempotent)
      return new BoxedFunction(ce, name, xs[0].ops!, {
        metadata,
        canonical: true,
        scope,
      });
  }

  //
  // 5/ Sort the operands
  //

  return new BoxedFunction(ce, name, sortOperands(name, args), {
    metadata,
    canonical: true,
    scope,
  });
}

function makeNumericFunction(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  semiOps: ReadonlyArray<SemiBoxedExpression>,
  metadata?: Metadata,
  scope?: Scope
): BoxedExpression | null {
  let ops: ReadonlyArray<BoxedExpression> = [];
  if (name === 'Add' || name === 'Multiply')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), {
      flatten: name,
    });
  else if (
    name === 'Negate' ||
    name === 'Square' ||
    name === 'Sqrt' ||
    name === 'Exp'
  )
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), 1);
  else if (name === 'Ln' || name === 'Log') {
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope));
    if (ops.length === 0) ops = [ce.error('missing')];
  } else if (name === 'Power' || name === 'Root')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), 2);
  else if (name === 'Divide') {
    // Note: Divide can have more than one argument, i.e.
    // Divide(a, b, c) = a / b / c
    // But it needs at least two arguments
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope));
    if (ops.length === 0) ops = [ce.error('missing'), ce.error('missing')];
    if (ops.length === 1) ops = [ops[0], ce.error('missing')];
  } else return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid))
    return new BoxedFunction(ce, name, ops, { metadata, canonical: true });

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (name === 'Add') return canonicalAdd(ce, ops);
  if (name === 'Negate') return canonicalNegate(ops[0]);
  if (name === 'Multiply') return canonicalMultiply(ce, ops);
  if (name === 'Divide') {
    if (ops.length === 2)
      return canonicalDivide(...(ops as [BoxedExpression, BoxedExpression]));
    return ops.slice(1).reduce((a, b) => canonicalDivide(a, b), ops[0]);
  }
  if (name === 'Exp') return canonicalPower(ce.E, ops[0]);
  if (name === 'Square') return canonicalPower(ops[0], ce.number(2));
  if (name === 'Power') return canonicalPower(ops[0], ops[1]);
  if (name === 'Root') return canonicalRoot(ops[0], ops[1]);
  if (name === 'Sqrt') return canonicalRoot(ops[0], 2);

  if (name === 'Ln' || name === 'Log') {
    if (ops.length > 0) {
      // Ln(1) -> 0, Log(1) -> 0
      if (ops[0].is(1)) return ce.Zero;
      // Ln(a) -> Ln(a), Log(a) -> Log(a)
      if (ops.length === 1)
        return new BoxedFunction(ce, name, ops, { metadata, canonical: true });
    }
    // Ln(a,b) -> Log(a, b)
    return new BoxedFunction(ce, 'Log', ops, { metadata, canonical: true });
  }

  return null;
}

function fromNumericValue(
  ce: ComputeEngine,
  value: NumericValue
): BoxedExpression {
  if (value.isZero) return ce.Zero;
  if (value.isOne) return ce.One;
  if (value.isNegativeOne) return ce.NegativeOne;
  if (value.isNaN) return ce.NaN;
  if (value.isNegativeInfinity) return ce.NegativeInfinity;
  if (value.isPositiveInfinity) return ce.PositiveInfinity;

  value = value.asExact ?? value;

  if (!value.isExact) {
    const im = value.im;
    if (im === 0) return ce.number(value.bignumRe ?? value.re);
    if (value.re === 0) return ce.number(ce.complex(0, im));
    if (value.bignumRe !== undefined && !isInMachineRange(value.bignumRe)) {
      return canonicalAdd(ce, [
        ce.number(value.bignumRe),
        ce.number(ce.complex(0, im)),
      ]);
    }
    return ce.number(ce.complex(value.re, value.im));
  }

  const terms: BoxedExpression[] = [];

  //
  // Real Part
  //
  const exactValue = value as ExactNumericValue;
  if (exactValue.sign !== 0) {
    // The real part is the product of a rational and radical

    if (exactValue.radical === 1) {
      // No radical, just a rational part
      terms.push(ce.number(exactValue.rational));
    } else {
      const rational = exactValue.rational;
      // At least a radical, maybe a rational as well.
      const radical = ce.function('Sqrt', [ce.number(exactValue.radical)]);
      if (isOne(rational)) terms.push(radical);
      else {
        const [n, d] = rational;
        if (d === 1) {
          if (n === 1) terms.push(radical);
          else terms.push(ce.function('Multiply', [ce.number(n), radical]));
        } else {
          if (n === 1)
            terms.push(ce.function('Divide', [radical, ce.number(d)]));
          else
            terms.push(
              ce.function('Divide', [
                ce.function('Multiply', [ce.number(n), radical]),
                ce.number(d),
              ])
            );
        }
      }
    }
  }

  let result: BoxedExpression;

  if (value.im === 0) {
    if (terms.length === 0) return ce.Zero;
    result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
    return result;
  }

  //
  // Imaginary Part
  //
  if (terms.length === 0) return ce.number(ce.complex(0, value.im));

  result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
  return canonicalAdd(ce, [result, ce.number(ce.complex(0, value.im))]);
}

export function semiCanonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<SemiBoxedExpression>,
  scope?: Scope
): ReadonlyArray<BoxedExpression> {
  // Avoid memory allocation if possible
  if (xs.every((x) => x instanceof _BoxedExpression && x.isCanonical))
    return xs as ReadonlyArray<BoxedExpression>;

  return xs.map((x) => ce.box(x, { scope }));
}
