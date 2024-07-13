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
import { _BoxedExpression } from './abstract-boxed-expression';
import { BoxedDictionary } from './boxed-dictionary';
import { BoxedFunction, makeCanonicalFunction } from './boxed-function';
import { BoxedNumber } from './boxed-number';
import { BoxedString } from './boxed-string';
import { Expression, MathJsonNumber } from '../../math-json/math-json-format';
import { isValidIdentifier, missingIfEmpty } from '../../math-json/utils';
import {
  Rational,
  isBigRational,
  isMachineRational,
  isRational,
  neg,
} from '../numerics/rationals';
import { asBigint } from './utils';
import { bigint, bigintValue } from '../numerics/numeric-bigint';
import { isDomainLiteral } from '../library/domains';
import { BoxedTensor, expressionTensorInfo } from './boxed-tensor';
import { canonicalForm } from './canonical';
import { asFloat, asMachineInteger } from './numerics';

/**
 * ### THEORY OF OPERATIONS
 *
 * 1/ Boxing does not depend on the numeric mode. The numeric mode could be
 * changed later, but the previously boxed numbers could not be retroactively
 * upgraded.
 *
 * The `numericMode` is taken into account only during evaluation.
 *
 * Therefore, a boxed expression may contain a mix of number representations.
 *
 * 2/ The result of boxing is canonical by default.
 *
 * This is the most common need (i.e. as soon as you want to evaluate an
 * expression you need a canonical expression). Creating a boxed expression
 * which is canonical from the start avoid going through an intermediary step
 * with a non-canonical expression.
 *
 * 3/ When boxing (and canonicalizing), if the function is "scoped", a new
 *    scope is created before the canonicalization, so that any declaration
 *    are done within that scope. Example of scoped functions include `Block`
 *    and `Sum`.
 *
 * 4/ When implementing an `evaluate()`:
 * - if `bignumPreferred()` all operations should be done in bignum and complex,
 *    otherwise, they should all be done in machine numbers and complex.
 * - if not `complexAllowed()`, return `NaN` if a complex value is encountered
 * - if a `Sqrt` (of a rational) is encountered, preserve it
 * - if a `hold` constant is encountered, preserve it
 * - if a rational is encountered, preserve it
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

/**
 * Return a boxed number representing `num`.
 *
 * Note: `boxNumber()` should only be called from `ce.number()` in order to
 * benefit from number expression caching.
 */
export function boxNumber(
  ce: IComputeEngine,
  num:
    | MathJsonNumber
    | number
    | string
    | Complex
    | Decimal
    | Rational
    | [Decimal, Decimal],
  options?: { metadata?: Metadata; canonical?: boolean }
): BoxedExpression | null {
  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  //
  // Do we have a machine number or bignum?
  //
  if (typeof num === 'number' || num instanceof Decimal)
    return new BoxedNumber(ce, num, options);

  //
  // Do we have a rational or big rational?
  //

  if (
    Array.isArray(num) &&
    num.length === 2 &&
    num[0] instanceof Decimal &&
    num[1] instanceof Decimal
  ) {
    if (!num[0].isInteger() || !num[1].isInteger())
      throw new Error('Array argument to `boxNumber()` should be two integers');
    num = [bigint(num[0].toString()), bigint(num[1].toString())];
  }

  if (isRational(num)) {
    if (num.length !== 2)
      throw new Error(
        'Array argument to `boxNumber()` should be two integers or two bignums'
      );
    const [n, d] = num;
    if (typeof n === 'bigint' && typeof d === 'bigint') {
      if (n === d) return d === BigInt(0) ? ce.NaN : ce.One;
      if (n === BigInt(0)) return ce.Zero;
      if (d === BigInt(1)) return ce.number(n, options);
      if (d === BigInt(-1)) return ce.number(-n, options);
      if (n === BigInt(1) && d === BigInt(2)) return ce.Half;
      return new BoxedNumber(ce, [n, d], options);
    }

    if (typeof n !== 'number' || typeof d !== 'number')
      throw new Error(
        'Array argument to `boxNumber()` should be two integers or two bignums'
      );

    if (!isFinite(n) || !isFinite(d))
      return ce.div(ce.number(n, options), ce.number(d, options));

    if (!Number.isInteger(n) || !Number.isInteger(d))
      throw new Error('Array argument to `boxNumber()` should be two integers');
    if (d === n) return d === 0 ? ce.NaN : ce.One;
    if (n === 0) return ce.Zero;
    if (d === 1) return ce.number(n, options);
    if (d === -1) return ce.number(-n, options);
    if (n === 1 && d === 2) return ce.Half;
    return new BoxedNumber(ce, [n, d], options);
  }

  //
  // Do we have a complex number?
  //
  if (num instanceof Complex) {
    if (num.isNaN()) return ce.NaN;
    if (num.isZero()) return ce.Zero;
    if (num.isInfinite()) return ce.ComplexInfinity;
    if (ce.chop(num.im) === 0) return ce.number(num.re, options);
    return new BoxedNumber(ce, num, options);
  }

  //
  // Do we have a string of digits?
  //
  let strNum = '';
  if (typeof num === 'string') strNum = num;
  else if (typeof num === 'object' && 'num' in num) {
    // Technically, num.num as a number is not valid MathJSON: it should be a
    // string, but we'll allow it.
    if (typeof num.num === 'number') return ce.number(num.num, options);

    if (typeof num.num !== 'string')
      throw new Error('MathJSON `num` property should be a string of digits');
    strNum = num.num;
  }

  if (strNum) {
    strNum = strNum.toLowerCase();

    // Remove trailing "n" or "d" letter (from legacy version of MathJSON spec)
    if (/[0-9][nd]$/.test(strNum)) strNum = strNum.slice(0, -1);

    // Remove any whitespace:
    // Tab, New Line, Vertical Tab, Form Feed, Carriage Return, Space, Non-Breaking Space
    strNum = strNum.replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

    // Special case some common values to share boxed instances
    if (strNum === 'nan') return ce.NaN;
    if (strNum === 'infinity' || strNum === '+infinity')
      return ce.PositiveInfinity;
    if (strNum === '-infinity') return ce.NegativeInfinity;
    if (strNum === '0') return ce.Zero;
    if (strNum === '1') return ce.One;
    if (strNum === '-1') return ce.NegativeOne;

    // Do we have repeating digits?
    if (/\([0-9]+\)/.test(strNum)) {
      const [_, body, repeat, trail] =
        strNum.match(/(.+)\(([0-9]+)\)(.+)?$/) ?? [];
      // @todo we probably shouldn't be using the ce.precision since it may change later
      strNum =
        body +
        repeat.repeat(Math.ceil(ce.precision / repeat.length)) +
        (trail ?? '');
    }

    return boxNumber(ce, ce.bignum(strNum), options);
  }
  return null;
}

function boxHold(
  ce: IComputeEngine,
  expr: SemiBoxedExpression | null,
  options: { canonical?: CanonicalOptions }
): BoxedExpression {
  if (expr === null) return ce.error('missing');
  if (typeof expr === 'object' && expr instanceof _BoxedExpression) return expr;

  expr = missingIfEmpty(expr as Expression);

  if (typeof expr === 'string') return box(ce, expr, options);

  if (Array.isArray(expr)) {
    const boxed = expr.map((x) => boxHold(ce, x, options));
    return new BoxedFunction(ce, boxed[0], boxed.slice(1));
  }
  if (typeof expr === 'object') {
    if ('dict' in expr) return new BoxedDictionary(ce, expr.dict);
    if ('fn' in expr) return boxHold(ce, expr.fn, options);
    if ('str' in expr) return new BoxedString(ce, expr.str);
    if ('sym' in expr) return box(ce, expr.sym, options);
    if ('num' in expr) return box(ce, expr.num, options);
  }

  return box(ce, expr, options);
}

/**
 * Given a head and a set of arguments, return a boxed function expression.
 *
 * If available, preserve LaTeX and wikidata metadata in the boxed expression.
 *
 * Note that `boxFunction()` should only be called from `ce.function()`
 */

export function boxFunction(
  ce: IComputeEngine,
  head: string,
  ops: readonly SemiBoxedExpression[],
  options?: { metadata?: Metadata; canonical?: CanonicalOptions }
): BoxedExpression {
  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  //
  // Hold
  //

  if (head === 'Hold') {
    return new BoxedFunction(ce, 'Hold', [boxHold(ce, ops[0], options)], {
      ...options,
      canonical: true,
    });
  }

  //
  // Error
  //
  if (head === 'Error' || head === 'ErrorCode') {
    return ce._fn(
      head,
      ops.map((x) => ce.box(x, { canonical: false })),
      options.metadata
    );
  }

  //
  // String
  //
  if (head === 'String') {
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
  if (head === 'Symbol' && ops.length > 0) {
    return ce.symbol(ops.map((x) => asString(x) ?? '').join(''), options);
  }

  //
  // Domain
  //
  if (head === 'Domain')
    return ce.domain(ops[0] as DomainExpression, options.metadata);

  //
  // Number
  //
  if (head === 'Number' && ops.length === 1) return box(ce, ops[0], options);

  const canonicalNumber =
    options.canonical === true ||
    options.canonical === 'Number' ||
    (Array.isArray(options.canonical) && options.canonical.includes('Number'));

  if (canonicalNumber) {
    // If we have a full canonical form or a canonical form for numbers
    // do some additional simplifications

    //
    // Rational (as Divide)
    //
    if ((head === 'Divide' || head === 'Rational') && ops.length === 2) {
      if (
        ops[0] instanceof _BoxedExpression &&
        ops[1] instanceof _BoxedExpression
      ) {
        if (ce.numericMode === 'machine') {
          const [fn, fd] = [asFloat(ops[0]), asFloat(ops[1])];
          if (
            fn !== null &&
            Number.isInteger(fn) &&
            fd !== null &&
            Number.isInteger(fd)
          )
            return ce.number([fn, fd], options);
        }
        const [n, d] = [asBigint(ops[0]), asBigint(ops[1])];
        if (n !== null && d !== null) return ce.number([n, d], options);
      } else {
        const [n, d] = [
          bigintValue(ops[0] as Expression),
          bigintValue(ops[1] as Expression),
        ];
        if (n !== null && d !== null) return ce.number([n, d], options);
      }

      head = 'Divide';
    }

    //
    // Complex
    //
    if (head === 'Complex') {
      if (ops.length === 1) {
        // If single argument, assume it's imaginary
        // @todo: use machineValue() & symbol() instead of box()
        const op1 = box(ce, ops[0], options);
        const im = asFloat(op1);
        if (im !== null && im !== 0)
          return ce.number(ce.complex(0, im), options);
        return ce.evalMul(op1, ce.I);
      }
      if (ops.length === 2) {
        const op1 = box(ce, ops[0], options);
        const op2 = box(ce, ops[1], options);
        const re = asFloat(op1);
        const im = asFloat(op2);
        if (im !== null && re !== null) {
          if (im === 0 && re === 0) return ce.Zero;
          if (im !== null && im !== 0)
            return ce.number(ce.complex(re, im), options);
          return op1;
        }
        return ce.add(op1, ce.evalMul(op2, ce.I));
      }
      throw new Error('Expected one or two arguments with Complex expression');
    }

    //
    // Negate
    //
    // Distribute over literals
    //
    if (head === 'Negate' && ops.length === 1) {
      const op1 = ops[0];
      if (typeof op1 === 'number') return ce.number(-op1, options);
      if (op1 instanceof Decimal) return ce.number(op1.neg(), options);
      const num = ce.box(op1, options).numericValue;
      if (num !== null) {
        if (typeof num === 'number') return ce.number(-num, options);
        if (num instanceof Decimal) return ce.number(num.neg(), options);
        if (num instanceof Complex) return ce.number(num.neg());
        if (isRational(num)) return ce.number(neg(num));
      }
    }
  }

  //
  // Dictionary
  //
  if (head === 'Dictionary') {
    const dict = {};
    for (const op of ops) {
      const arg = ce.box(op, { canonical: options.canonical });
      const head = arg.head;
      if (
        head === 'KeyValuePair' ||
        head === 'Pair' ||
        (head === 'Tuple' && arg.nops === 2)
      ) {
        const key = arg.op1;
        if (key.isValid && key.symbol !== 'Nothing') {
          const value = arg.op2;
          let k = key.symbol ?? key.string;
          if (!k && (key.numericValue !== null || key.string)) {
            const n =
              typeof key.numericValue === 'number'
                ? key.numericValue
                : asMachineInteger(key);
            if (n && Number.isFinite(n) && Number.isInteger(n))
              k = n.toString();
          }
          if (k) dict[k] = value;
        }
      }
    }
    return new BoxedDictionary(ce, dict, options);
  }

  //
  // Do we have a vector/matrix/tensor?
  // It has to have a compatible shape: i.e. all elements on an axis have
  // the same shape.
  //
  if (head === 'List' && options.canonical === true) {
    // @todo: note: we could have a special canonical form for tensors
    const boxedOps = ops.map((x) => box(ce, x));
    const { shape, dtype } = expressionTensorInfo('List', boxedOps) ?? {};

    if (dtype && shape) return new BoxedTensor(ce, { head, ops: boxedOps });

    return ce._fn(head, boxedOps);
  }

  if (options.canonical === true)
    return makeCanonicalFunction(ce, head, ops, options.metadata);

  return canonicalForm(
    new BoxedFunction(
      ce,
      head,
      ops.map((x) => box(ce, x, { canonical: options?.canonical ?? true })),
      { metadata: options.metadata, canonical: false }
    ),
    options.canonical ?? false
  );
}

/**
 * Notes about the boxed form:
 *
 * [1] Expression with a head of `Number`, `String`, `Symbol` and `Dictionary`
 *      are converted to the corresponding atomic expression.
 *
 * [2] Expressions with a head of `Complex` are converted to a (complex) number
 *     or a `Add`/`Multiply` expression.
 *
 *     The precedence of `Complex` (for serialization) is sometimes the
 *     precedence of `Add` (when re and im != 0), sometimes the precedence of
 *    `Multiply` (when im or re === 0). Using a number or an explicit
 *    `Add`/`Multiply` expression avoids this ambiguity.
 *
 * [3] An expression with a `Rational` head is converted to a rational number.
 *    if possible, to a `Divide` otherwise.
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
  expr: null | undefined | Decimal | Complex | Rational | SemiBoxedExpression,
  options?: { canonical?: CanonicalOptions }
): BoxedExpression {
  if (expr === null || expr === undefined) return ce._fn('Sequence', []);

  if (expr instanceof _BoxedExpression)
    return canonicalForm(expr, options?.canonical ?? true);

  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  // If canonical is true, we want to canonicalize the arguments
  // If it's false or a CanonicalForm, we don't want to canonicalize the
  // arguments during create, we'll call canonicalForm to take care of it
  const canonical = options.canonical === true;

  //
  //  Box a function or a rational
  //
  if (Array.isArray(expr)) {
    // If the first element is a number, it's not a function, it's a rational
    // `[number, number]`
    if (isMachineRational(expr)) {
      if (Number.isInteger(expr[0]) && Number.isInteger(expr[1]))
        return ce.number(expr);
      // This wasn't a valid rational, turn it into a `Divide`
      return canonicalForm(
        ce.function('Divide', expr, { canonical }),
        options.canonical!
      );
    }
    if (isBigRational(expr)) return ce.number(expr);

    if (typeof expr[0] === 'string')
      return canonicalForm(
        ce.function(expr[0], expr.slice(1), { canonical }),
        options.canonical!
      );

    console.assert(Array.isArray(expr[0]));

    // It's a function with a head expression
    // Try to evaluate to something simpler
    const ops = expr.slice(1).map((x) => box(ce, x, options));
    // The head could include some unknowns, i.e. `_` which we do *not*
    // want to get declated in the current scope, so use canonical: false
    // to avoid that.
    const head = box(ce, expr[0], { canonical: false });
    return canonicalForm(new BoxedFunction(ce, head, ops), options.canonical!);
  }

  //
  // Box a number (other than a rational)
  //
  if (
    typeof expr === 'number' ||
    expr instanceof Complex ||
    expr instanceof Decimal
  )
    return ce.number(expr);

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
  if (typeof expr === 'object') {
    const metadata = {
      latex: expr.latex,
      wikidata: expr.wikidata,
    };
    if ('dict' in expr)
      return canonicalForm(
        new BoxedDictionary(ce, expr.dict, { canonical: true, metadata }),
        options.canonical!
      );
    if ('fn' in expr) {
      if (typeof expr.fn[0] === 'string')
        return canonicalForm(
          ce.function(expr.fn[0], expr.fn.slice(1), { canonical }),
          options.canonical!
        );
      return canonicalForm(
        new BoxedFunction(
          ce,
          box(ce, expr.fn[0], options),
          expr.fn.slice(1).map((x) => box(ce, x, options)),
          { metadata }
        ),
        options.canonical!
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str, metadata);
    if ('sym' in expr) return ce.symbol(expr.sym, { canonical });
    if ('num' in expr) return ce.number(expr, { canonical });
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
