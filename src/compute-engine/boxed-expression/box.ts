import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  IComputeEngine,
  SemiBoxedExpression,
  BoxedExpression,
  Metadata,
  Rational,
} from '../public';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { BoxedDictionary } from './boxed-dictionary';
import { apply, BoxedFunction, makeCanonicalFunction } from './boxed-function';
import { BoxedNumber } from './boxed-number';
import { BoxedString } from './boxed-string';
import { Expression, MathJsonNumber } from '../../math-json/math-json-format';
import { missingIfEmpty } from '../../math-json/utils';
import { asFloat, asSmallInteger } from '../numerics/numeric';
import {
  isBigRational,
  isMachineRational,
  isRational,
  neg,
} from '../numerics/rationals';
import { asBigint, bigintValue } from './utils';
import { bigint } from '../numerics/numeric-bigint';

/**
 * **Theory of Operations**
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
 * 3/ When implementing an `evaluate()`:
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
  //
  // Do we have a machine number or bignum?
  //
  if (typeof num === 'number' || num instanceof Decimal)
    return new BoxedNumber(ce, num, options);

  options ??= {};
  if (!('canonical' in options)) options.canonical = true;

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
      if (n === d) return d === BigInt(0) ? ce._NAN : ce._ONE;
      if (d === BigInt(1)) return ce.number(n, options);
      if (d === BigInt(-1)) return ce.number(-n, options);
      if (n === BigInt(1) && d === BigInt(2)) return ce._HALF;
      return new BoxedNumber(ce, [n, d], options);
    }

    if (typeof n !== 'number' || typeof d !== 'number')
      throw new Error(
        'Array argument to `boxNumber()` should be two integers or two bignums'
      );

    if (!Number.isInteger(n) || !Number.isInteger(d))
      throw new Error('Array argument to `boxNumber()` should be two integers');
    if (d === n) return d === 0 ? ce._NAN : ce._ONE;
    if (d === 1) return ce.number(n, options);
    if (d === -1) return ce.number(-n, options);
    if (n === 1 && d === 2) return ce._HALF;
    return new BoxedNumber(ce, [n, d], options);
  }

  //
  // Do we have a complex number?
  //
  if (num instanceof Complex) {
    if (num.isNaN()) return ce._NAN;
    if (num.isZero()) return ce._ZERO;
    if (num.isInfinite()) return ce._COMPLEX_INFINITY;
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
    if (strNum === 'nan') return ce._NAN;
    if (strNum === 'infinity' || strNum === '+infinity')
      return ce._POSITIVE_INFINITY;
    if (strNum === '-infinity') return ce._NEGATIVE_INFINITY;
    if (strNum === '0') return ce._ZERO;
    if (strNum === '1') return ce._ONE;
    if (strNum === '-1') return ce._NEGATIVE_ONE;

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
  options: { canonical?: boolean }
): BoxedExpression {
  if (expr === null) return ce.error('missing');
  if (typeof expr === 'object' && expr instanceof AbstractBoxedExpression)
    return expr;

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
 * Note that `boxFunction()` should only be called from `ce.fn()` or `box()`
 */

export function boxFunction(
  ce: IComputeEngine,
  head: string,
  ops: SemiBoxedExpression[],
  options: { metadata?: Metadata; canonical?: boolean }
): BoxedExpression {
  //
  // Hold
  //
  if (head === 'Hold') {
    return new BoxedFunction(ce, 'Hold', [boxHold(ce, ops[0], options)], {
      ...options,
      canonical: true,
    });
  }

  if (head === 'Error' || head === 'ErrorCode') {
    return ce._fn(
      head,
      ops.map((x) => ce.box(x, { canonical: false })),
      options.metadata
    );
  }

  if (head === 'Domain') return ce.domain(ops[0], options.metadata);
  if (head === 'Number' && ops.length === 1) return box(ce, ops[0], options);
  if (head === 'String') {
    if (ops.length === 0) return new BoxedString(ce, '', options.metadata);
    return new BoxedString(
      ce,
      ops.map((x) => asString(x) ?? '').join(''),
      options.metadata
    );
  }
  if (head === 'Symbol' && ops.length > 0) {
    return ce.symbol(ops.map((x) => asString(x) ?? '').join(''), options);
  }

  //
  // Rational (as Divide)
  //
  if ((head === 'Divide' || head === 'Rational') && ops.length === 2) {
    if (
      ops[0] instanceof AbstractBoxedExpression &&
      ops[1] instanceof AbstractBoxedExpression
    ) {
      const [n, d] = [asBigint(ops[0]), asBigint(ops[1])];
      if (n && d) return ce.number([n, d], options);
    } else {
      const [n, d] = [
        bigintValue(ce, ops[0] as Expression),
        bigintValue(ce, ops[1] as Expression),
      ];
      if (n && d) return ce.number([n, d], options);
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
      if (im !== null && im !== 0) return ce.number(ce.complex(0, im), options);
      return ce.mul([op1, ce._I]);
    }
    if (ops.length === 2) {
      const op1 = box(ce, ops[0], options);
      const op2 = box(ce, ops[1], options);
      const re = asFloat(op1);
      const im = asFloat(op2);
      if (im !== null && re !== null) {
        if (im === 0 && re === 0) return ce._ZERO;
        if (im !== null && im !== 0)
          return ce.number(ce.complex(re, im), options);
        return op1;
      }
      return ce.add([op1, ce.mul([op2, ce._I])], options.metadata);
    }
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

  //
  // Dictionary
  //
  if (head === 'Dictionary') {
    const dict = {};
    for (const op of ops) {
      const arg = ce.box(op);
      const head = arg.head;
      if (
        head === 'KeyValuePair' ||
        head === 'Pair' ||
        (head === 'Tuple' && arg.nops === 2)
      ) {
        const key = arg.op1;
        if (key.isValid && !key.isNothing) {
          const value = arg.op2;
          let k = key.symbol ?? key.string;
          if (!k && (key.numericValue !== null || key.string)) {
            const n =
              typeof key.numericValue === 'number'
                ? key.numericValue
                : asSmallInteger(key);
            if (n && Number.isFinite(n) && Number.isInteger(n))
              k = n.toString();
          }
          if (k) dict[k] = value;
        }
      }
    }
    return new BoxedDictionary(ce, dict, options);
  }

  if (options.canonical)
    return makeCanonicalFunction(ce, head, ops, options.metadata);

  return new BoxedFunction(
    ce,
    head,
    ops.map((x) => box(ce, x, { canonical: false })),
    options
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
 *
 * Note that `Negate` is only distributed over addition. In practice, having
 * `Negate` factored on multiply/divide is more useful to detect patterns.
 *
 * Note that the `box()` function should only be called from `ce.box()`
 *
 */

export function box(
  ce: IComputeEngine,
  expr: null | undefined | Decimal | Complex | Rational | SemiBoxedExpression,
  options?: { canonical?: boolean }
): BoxedExpression {
  if (expr === null || expr === undefined) return ce._fn('Sequence', []);

  options ??= {};
  if (!('canonical' in options)) options.canonical = true;

  if (expr instanceof AbstractBoxedExpression)
    return options.canonical ? expr.canonical : expr;

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
      return boxFunction(ce, 'Divide', expr, options);
    }
    if (isBigRational(expr)) return ce.number(expr);

    if (typeof expr[0] === 'string')
      return boxFunction(ce, expr[0], expr.slice(1), options);

    // It's a function with a head expression
    // Try to evaluate to something simpler
    const ops = expr.slice(1).map((x) => box(ce, x, options));
    const head = box(ce, expr[0], options);
    if (head.symbol) return new BoxedFunction(ce, head.symbol, ops);
    return apply(head, ops);
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

    return ce.symbol(expr, options);
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
      return new BoxedDictionary(ce, expr.dict, { canonical: true, metadata });
    if ('fn' in expr) {
      if (typeof expr.fn[0] === 'string') {
        return boxFunction(ce, expr.fn[0], expr.fn.slice(1), {
          metadata,
          ...options,
        });
      }
      return new BoxedFunction(
        ce,
        box(ce, expr.fn[0], options),
        expr.fn.slice(1).map((x) => box(ce, x, options)),
        { metadata }
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str, metadata);
    if ('sym' in expr) return ce.symbol(expr.sym, options);
    if ('num' in expr) return ce.number(expr, options);
  }

  return ce.symbol('Undefined');
}

function asString(expr: SemiBoxedExpression): string | null {
  if (typeof expr === 'string') return expr;
  if (expr instanceof AbstractBoxedExpression) {
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
