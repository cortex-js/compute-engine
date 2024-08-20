import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  IComputeEngine,
  SemiBoxedExpression,
  BoxedExpression,
  Metadata,
  DomainExpression,
  CanonicalOptions,
} from './public';

import { Expression, MathJsonIdentifier } from '../../math-json/types';
import { machineValue, missingIfEmpty } from '../../math-json/utils';
import {
  isValidIdentifier,
  validateIdentifier,
} from '../../math-json/identifiers';

import { isOne } from '../numerics/rationals';
import { asBigint } from './numerics';
import { bigintValue } from '../numerics/expression';
import { isInMachineRange } from '../numerics/numeric-bignum';
import { bigint } from '../numerics/bigint';

import { isDomainLiteral } from '../library/domains';
import { canonicalAdd } from '../library/arithmetic-add';
import { canonicalMultiply } from '../library/arithmetic-multiply';
import { canonicalDivide } from '../library/arithmetic-divide';

import { NumericValue } from '../numeric-value/public';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { canonicalPower, canonicalRoot } from '../library/arithmetic-power';

import { _BoxedExpression } from './abstract-boxed-expression';
import { BoxedFunction } from './boxed-function';
import { BoxedString } from './boxed-string';
import { BoxedTensor, expressionTensorInfo } from './boxed-tensor';
import { canonicalForm } from './canonical';
import { sortOperands } from './order';
import { adjustArguments, checkNumericArgs } from './validate';
import { flatten } from './flatten';
import { shouldHold } from './hold';
import { canonical, semiCanonical } from './utils';

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
 * - if `bignumPreferred()` all operations should be done in bignum and complex,
 *    otherwise, they should all be done in machine numbers and complex.
 * - if a rational is encountered, preserve it
 * - if a `Sqrt` of a rational is encountered, preserve it
 * - if a `hold` constant is encountered, preserve it
 * - if one of the arguments is not exact, return an approximation
 *
 * EXACT
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
 *
 * APPROXIMATE
 * - 2 + 2.1 -> 4.1
 * - 2 + √2.1 -> 3.44914
 * - 5/7 + √2.1 -> 2.16342
 * - sin(2) + √2.1 -> 2.35844
 */

function boxHold(
  ce: IComputeEngine,
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
      ops.map((x) => boxHold(ce, x, options))
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
  ce: IComputeEngine,
  name: MathJsonIdentifier,
  ops: readonly SemiBoxedExpression[],
  options?: {
    metadata?: Metadata;
    canonical?: CanonicalOptions;
    structural?: boolean;
  }
): BoxedExpression {
  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  if (!isValidIdentifier(name)) {
    throw new Error(
      `Unexpected function name: "${name}" (not a valid identifier: ${validateIdentifier(name)})`
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
    return ce._fn(
      name,
      ops.map((x) => ce.box(x, { canonical: false })),
      options.metadata
    );
  }

  //
  // String
  //
  if (name === 'String') {
    if (ops.length === 0) return new BoxedString(ce, '', options.metadata);
    return new BoxedString(
      ce,
      ops.map((x) => asString(x) ?? '').join(''),
      options.metadata
    );
  }

  //
  // Symbol
  //
  if (name === 'Symbol' && ops.length > 0) {
    return ce.symbol(ops.map((x) => asString(x) ?? '').join(''), options);
  }

  //
  // Domain
  //
  if (name === 'Domain')
    return ce.domain(ops[0] as DomainExpression, options.metadata);

  //
  // Number
  //
  if (name === 'Number' && ops.length === 1) return box(ce, ops[0], options);

  const canonicalNumber =
    structural === false &&
    (options.canonical === true ||
      options.canonical === 'Number' ||
      (Array.isArray(options.canonical) &&
        options.canonical.includes('Number')));

  if (canonicalNumber) {
    // If we have a full canonical form or a canonical form for numbers
    // do some additional simplifications

    //
    // Rational (as Divide)
    //
    if ((name === 'Divide' || name === 'Rational') && ops.length === 2) {
      const n = toBigint(ops[0]);
      if (n !== null) {
        const d = toBigint(ops[1]);
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
        if (op1 instanceof _BoxedExpression)
          return ce.number(ce.complex(0, op1.re ?? 0), options);

        const im = machineValue(ops[0] as Expression);
        if (im !== null && im !== 0)
          return ce.number(ce.complex(0, im), options);

        return ce.box(op1).mul(ce.I);
      }
      if (ops.length === 2) {
        const re =
          ops[0] instanceof _BoxedExpression
            ? (ops[0].re ?? null)
            : machineValue(ops[0] as Expression);
        const im =
          ops[1] instanceof _BoxedExpression
            ? (ops[1].re ?? null)
            : machineValue(ops[1] as Expression);
        if (im !== null && re !== null) {
          if (im === 0 && re === 0) return ce.Zero;
          if (im !== 0)
            return ce.number(ce._numericValue({ decimal: re, im }), options);
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
      ops = [boxedop1];
      const num = boxedop1.numericValue;
      if (num !== null)
        return ce.number(typeof num === 'number' ? -num : num.neg(), options);
    }
  }

  if (options.canonical === true)
    return makeCanonicalFunction(ce, name, ops, options.metadata);

  return canonicalForm(
    new BoxedFunction(
      ce,
      name,
      ops.map((x) =>
        box(ce, x, {
          canonical: options.canonical,
          structural,
        })
      ),
      {
        metadata: options.metadata,
        canonical: false,
        structural,
      }
    ),
    options.canonical ?? false
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
  ce: IComputeEngine,
  expr: null | undefined | NumericValue | SemiBoxedExpression,
  options?: { canonical?: CanonicalOptions; structural?: boolean }
): BoxedExpression {
  if (expr === null || expr === undefined) return ce._fn('Sequence', []);

  if (expr instanceof NumericValue) return fromNumericValue(ce, expr);

  if (expr instanceof _BoxedExpression)
    return canonicalForm(expr, options?.canonical ?? true);

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
        `The first element of an array should be a string (the function name): ${JSON.stringify(expr)}`
      );

    return canonicalForm(
      boxFunction(ce, expr[0], expr.slice(1) as SemiBoxedExpression[], {
        canonical,
        structural,
      }),
      options.canonical!
    );
  }

  //
  // Box a number
  //
  if (typeof expr === 'number') return ce.number(expr);

  //
  // Box a String, a Symbol or a number as a string shorthand
  //
  if (typeof expr === 'string') {
    // It's a `String` if it bracketed with apostrophes (single quotes)
    if (expr.startsWith("'") && expr.endsWith("'"))
      return new BoxedString(ce, expr.slice(1, -1));

    if (/^[+-]?[0-9]/.test(expr)) return ce.number(expr);

    if (isDomainLiteral(expr)) return ce.domain(expr);

    if (!isValidIdentifier(expr))
      return ce.error('invalid-identifier', { str: expr });
    return ce.symbol(expr, { canonical });
  }

  //
  // Box a MathJSON object literal
  //
  if (!Array.isArray(expr) && typeof expr === 'object') {
    // @ts-expect-error TypeScript does not know that `expr` is an MathJSON object
    const metadata = { latex: expr.latex, wikidata: expr.wikidata };
    if ('fn' in expr) {
      const [fnName, ...ops] = expr.fn;
      return canonicalForm(
        boxFunction(ce, fnName, ops, { canonical, structural }),
        options.canonical!
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str, metadata);
    if ('sym' in expr) return ce.symbol(expr.sym, { canonical });
    if ('num' in expr) return ce.number(expr, { canonical });

    throw new Error(`Unexpected MathJSON object: ${JSON.stringify(expr)}`);
  }

  return ce.symbol('Undefined');
}

function asString(expr: SemiBoxedExpression): string | null {
  if (typeof expr === 'string') return expr;
  if (expr instanceof _BoxedExpression) {
    return expr.string ?? expr.symbol ?? expr.toString();
  }

  if (typeof expr === 'object') {
    if ('str' in expr) return expr.str;
    if (
      'fn' in expr &&
      expr.fn[0] === 'String' &&
      typeof expr.fn[1] === 'string'
    )
      // @todo: that's incorrect. That argument would be a string bracketed by quotes
      return expr.fn[1];
  }

  if (Array.isArray(expr)) {
    // @todo: that's incorrect. That argument would be a string bracketed by quotes
    if (expr[0] === 'String' && typeof expr[1] === 'string') return expr[1];
  }

  return null;
}

function makeCanonicalFunction(
  ce: IComputeEngine,
  name: string,
  ops: ReadonlyArray<SemiBoxedExpression>,
  metadata?: Metadata
): BoxedExpression {
  const result = makeNumericFunction(ce, name, ops, metadata);
  if (result) return result;

  //
  // Do we have a vector/matrix/tensor?
  // It has to have a compatible shape: i.e. all elements on an axis have
  // the same shape.
  //
  if (name === 'List') {
    // @todo: note: we could have a special canonical form for tensors
    // @fixme: don't box the arguments: they may be lists themselves...
    const boxedOps = ops.map((x) => ce.box(x));
    const { shape, dtype } = expressionTensorInfo('List', boxedOps) ?? {};

    if (dtype && shape)
      return new BoxedTensor(ce, { op: 'List', ops: boxedOps });

    return ce._fn('List', boxedOps);
  }

  //
  // Didn't match a short path, look for a definition
  //
  const def = ce.lookupFunction(name);
  if (!def) {
    // No def. This is for example `["f", 2]` where "f" is not declared.
    return new BoxedFunction(ce, name, flatten(canonical(ce, ops)), {
      metadata,
      canonical: true,
    });
  }

  const xs: BoxedExpression[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (!shouldHold(def.hold, ops.length - 1, i)) {
      xs.push(ce.box(ops[i]));
    } else {
      const y = ce.box(ops[i], { canonical: false });
      if (y.operator === 'ReleaseHold') xs.push(y.op1.canonical);
      else xs.push(y);
    }
  }

  const sig = def.signature;

  //
  // 3/ Apply `canonical` handler
  //
  // If present, the canonical handler is responsible for
  //  - validating the signature (domain and number of arguments)
  //  - sorting them
  //  - applying involution and idempotent to the expression
  //  - flatenning sequences
  //
  // The arguments have been put in canonical form, as per hold rules.
  //
  if (sig.canonical) {
    try {
      const result = sig.canonical(ce, xs);
      if (result) return result;
    } catch (e) {
      console.error(e.message);
    }
    // The canonical handler gave up, return a non-canonical expression
    return new BoxedFunction(ce, name, xs, { metadata, canonical: false });
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), Sequence(), d) -> f(a, b, c, d)
  //
  const args: BoxedExpression[] = flatten(
    xs,
    def.associative ? name : undefined
  );

  const adjustedArgs = adjustArguments(
    ce,
    args,
    def.hold,
    def.threadable,
    sig.params,
    sig.optParams,
    sig.restParam
  );

  // If we have some adjusted arguments, the arguments did not
  // match the parameters of the signature. We're done.
  if (adjustedArgs) return ce._fn(name, adjustedArgs, metadata);

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (args.length === 1 && args[0].operator === name) {
    // f(f(x)) -> x
    if (def.involution) return args[0].op1;

    // f(f(x)) -> f(x)
    if (def.idempotent) return ce._fn(name, xs[0].ops!, metadata);
  }

  //
  // 5/ Sort the operands
  //

  return ce._fn(name, sortOperands(name, args), metadata);
}

function makeNumericFunction(
  ce: IComputeEngine,
  name: MathJsonIdentifier,
  semiOps: ReadonlyArray<SemiBoxedExpression>,
  metadata?: Metadata
): BoxedExpression | null {
  // @todo: is it really necessary to accept semiboxed expressions?
  let ops: ReadonlyArray<BoxedExpression> = [];
  if (name === 'Add' || name === 'Multiply')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), { flatten: name });
  else if (
    name === 'Negate' ||
    name === 'Square' ||
    name === 'Sqrt' ||
    name === 'Exp'
  )
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), 1);
  else if (name === 'Ln' || name === 'Log')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps));
  else if (name === 'Power' || name === 'Root')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), 2);
  else if (name === 'Divide')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps));
  else return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid)) return ce._fn(name, ops, metadata);

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (name === 'Add') return canonicalAdd(ce, ops);
  if (name === 'Negate') return ops[0].neg();
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
      if (ops[0].isOne) return ce.Zero;
      if (ops.length === 1) return ce._fn(name, ops, metadata);
    }
    return ce._fn('Log', ops, metadata);
  }

  return null;
}

function fromNumericValue(
  ce: IComputeEngine,
  value: NumericValue
): BoxedExpression {
  if (value.isZero) return ce.Zero;
  if (value.isOne) return ce.One;
  if (value.isNegativeOne) return ce.NegativeOne;
  if (value.isNaN) return ce.NaN;
  if (value.isNegativeInfinity) return ce.NegativeInfinity;
  if (value.isPositiveInfinity) return ce.PositiveInfinity;

  if (!(value instanceof ExactNumericValue)) {
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
  if (value.sign !== 0) {
    // The real part is the product of a rational and radical

    if (value.radical === 1) {
      // No radical, just a rational part
      terms.push(ce.number(value.rational));
    } else {
      const rational = value.rational;
      // At least a radical, maybe a rational as well.
      const radical = ce.function('Sqrt', [ce.number(value.radical)]);
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

export function toBigint(x: SemiBoxedExpression): bigint | null {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number' && Number.isInteger(x)) return BigInt(x);

  if (x instanceof _BoxedExpression) return asBigint(x);

  if (x instanceof Decimal || typeof x === 'string') return bigint(x);

  if (x instanceof Complex) {
    if (x.im === 0) return bigint(x.re);
    return null;
  }

  return bigintValue(x as Expression);
}
