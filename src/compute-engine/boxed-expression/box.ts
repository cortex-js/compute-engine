import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  IComputeEngine,
  SemiBoxedExpression,
  BoxedExpression,
  Metadata,
  DomainExpression,
} from '../public';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { BoxedDictionary } from './boxed-dictionary';
import { BoxedFunction } from './boxed-function';
import { BoxedNumber } from './boxed-number';
import { BoxedString } from './boxed-string';
import { boxDomain, _BoxedDomain } from './boxed-domain';
import { complexAllowed, decimalValue, preferDecimal } from './utils';
import { Expression, MathJsonNumber } from '../../math-json/math-json-format';
import { isInMachineRange } from '../numerics/numeric-decimal';

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
 *
 * [4] A `Negate` function applied to a number literal is converted to a number.
 *
 *
 * Note that `Negate` is only distributed over addition. In practice, having
 * `Negate` factored on multiply/divide is more useful to detect patterns.
 *
 * Note that the `box()` function should only be called from `ComputeEngine`
 *
 */

export function box(
  ce: IComputeEngine,
  expr: Decimal | Complex | [num: number, denom: number] | SemiBoxedExpression
): BoxedExpression {
  if (expr === null || expr === undefined) return ce.symbol('Nothing');

  if (expr instanceof AbstractBoxedExpression) return expr;

  //
  //  Box a function or a rational
  //
  if (Array.isArray(expr)) {
    // If the first element is a number, it's not a function, it's a rational
    // `[number, number]`
    if (typeof expr[0] === 'number') {
      const [n, d] = expr;
      if (typeof d === 'number' && Number.isInteger(n) && Number.isInteger(d))
        return ce.number(expr as [number, number]);
      // This wasn't a valid rational, turn it into a `Divide`
      return boxFunction(ce, 'Divide', expr);
    }

    if (typeof expr[0] === 'string')
      return boxFunction(ce, expr[0], expr.slice(1));

    return new BoxedFunction(
      ce,
      box(ce, expr[0]),
      expr.slice(1).map((x) => box(ce, x))
    );
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
  // Box a string or a Symbol
  //
  if (typeof expr === 'string') {
    // It's a `String` if it bracketed with apostrophes (single quotes)
    if (expr.startsWith("'") && expr.endsWith("'"))
      return new BoxedString(ce, expr.slice(1, -1));

    return ce.symbol(expr);
  }

  //
  // Box a MathJSON object literal
  //
  if (typeof expr === 'object') {
    const metadata = {
      latex: expr.latex,
      wikidata: expr.wikidata,
    };
    if ('dict' in expr) return new BoxedDictionary(ce, expr.dict, metadata);
    if ('fn' in expr) {
      if (typeof expr.fn[0] === 'string')
        return boxFunction(ce, expr.fn[0], expr.fn.slice(1), metadata);
      return new BoxedFunction(
        ce,
        box(ce, expr.fn[0]),
        expr.fn.slice(1).map((x) => box(ce, x)),
        metadata
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str, metadata);
    if ('sym' in expr) return ce.symbol(expr.sym, metadata);
    if ('num' in expr) return ce.number(expr, metadata);
  }

  return ce.symbol('Undefined');
}

/**
 * Return a boxed number representing `num`.
 *
 * This function tries to avoid creating a boxed number if `num` corresponds
 * to a common value for which we have a shared instance (-1, 0, NaN, etc...)
 *
 *
 * Note that `boxNumber()` should only be called from `ComputeEngine`
 *
 * The result may not be canonical
 */
export function boxNumber(
  ce: IComputeEngine,
  num:
    | MathJsonNumber
    | BoxedExpression
    | number
    | Complex
    | Decimal
    | [numer: number, denom: number],
  metadata?: Metadata
): BoxedExpression | null {
  if (num instanceof BoxedNumber) return num;

  if (Array.isArray(num)) {
    if (num.length !== 2)
      throw new Error('Array argument to boxNumber() should be two integers');
    const [n, d] = num;
    if (typeof n !== 'number' || typeof d !== 'number')
      throw new Error('Array argument to boxNumber() should be two integers');
    if (!Number.isInteger(n) || !Number.isInteger(d))
      throw new Error('Array argument to boxNumber() should be two integers');
    if (d === n) return d === 0 ? ce._NAN : ce._ONE;
    if (d === 1) num = n;
    else if (d === -1) num = -n;
    else if (n === 1 && d === 2) return ce._HALF;
    else return new BoxedNumber(ce, [n, d], metadata);
  }

  if (num instanceof Complex) {
    if (num.isNaN()) return ce._NAN;
    if (num.isZero()) return ce._ZERO;
    if (num.isInfinite()) return ce._COMPLEX_INFINITY;
    if (num.im === 0) num = num.re;
    else {
      // Only create complex number if the numericMode is `auto` or `complex`
      return complexAllowed(ce) ? new BoxedNumber(ce, num, metadata) : ce._NAN;
    }
  }

  if (num instanceof Decimal) {
    if (num.isNaN()) return ce._NAN;
    if (num.equals(ce._DECIMAL_NEGATIVE_ONE)) return ce._NEGATIVE_ONE;
    if (num.isZero()) return ce._ZERO;
    if (num.equals(ce._DECIMAL_ONE)) return ce._ONE;
    if (num.equals(ce._DECIMAL_TWO)) return ce._TWO;
    if (!num.isFinite() && num.isPositive()) return ce._POSITIVE_INFINITY;
    if (!num.isFinite() && num.isNegative()) return ce._NEGATIVE_INFINITY;

    // Use a Decimal if in `decimal` mode, or `auto` with precision > 15
    return new BoxedNumber(
      ce,
      preferDecimal(ce) ? num : num.toNumber(),
      metadata
    );
  }

  if (typeof num === 'object' && 'num' in num) {
    if (typeof num.num === 'number') {
      // Technically, num.num as a number is not valid MathJSON.
      // It should be a string, but we'll allow it
      num = num.num;
    } else if (typeof num.num === 'string') {
      let strNum = num.num.toLowerCase();

      // Remove trailing letter (legacy version of MathJSON spec allowed 'n'
      // or 'd' to indicate BigInt and Decimal, respectively
      if (/[0-9][nd]$/.test(strNum)) strNum = strNum.slice(0, -1);

      // Remove any whitespace:
      // Tab, New Line, Vertical Tab, Form Feed, Carriage Return, Space, Non-Breaking Space
      strNum = strNum.replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

      // Do we have repeating digits?
      if (/\([0-9]+\)$/.test(strNum)) {
        const [_, body, repeat] = strNum.match(/(.+)\(([0-9]+)\)$/) ?? [];
        strNum = body + repeat.repeat(Math.ceil(ce.precision / repeat.length));
      }

      // Special case some common values to share boxed instances
      if (strNum === 'nan') return ce._NAN;
      if (strNum === 'infinity' || strNum === '+infinity')
        return ce._POSITIVE_INFINITY;
      if (strNum === '-infinity') return ce._NEGATIVE_INFINITY;
      if (strNum === '0') return ce._ZERO;
      if (strNum === '1') return ce._ONE;
      if (strNum === '-1') return ce._NEGATIVE_ONE;
      if (strNum === '2') return ce._TWO;

      return new BoxedNumber(ce, strNum, metadata);
    }
  }

  if (typeof num === 'number') {
    if (Number.isNaN(num)) return ce._NAN;
    if (!Number.isFinite(num) && num > 0) ce._POSITIVE_INFINITY;
    if (!Number.isFinite(num) && num < 0) ce._NEGATIVE_INFINITY;
    if (num === -1) return ce._NEGATIVE_ONE;
    if (num === 0) return ce._ZERO;
    if (num === 1) return ce._ONE;
    if (num === 2) return ce._TWO;
  }

  if (typeof num === 'number') {
    return new BoxedNumber(ce, num, metadata);
  }

  return null;
}

function boxHold(
  ce: IComputeEngine,
  expr: SemiBoxedExpression
): BoxedExpression {
  if (typeof expr === 'object' && expr instanceof AbstractBoxedExpression)
    return expr;

  if (typeof expr === 'string') return box(ce, expr);

  if (Array.isArray(expr)) {
    const boxed = expr.map((x) => boxHold(ce, x));
    return new BoxedFunction(ce, boxed[0], boxed.slice(1));
  }
  if (typeof expr === 'object') {
    if ('dict' in expr) return new BoxedDictionary(ce, expr.dict);
    if ('fn' in expr) return boxHold(ce, expr.fn);
    if ('str' in expr) return new BoxedString(ce, expr.str);
    if ('sym' in expr) return box(ce, expr.sym);
    if ('num' in expr) return box(ce, expr.num);
  }

  return box(ce, expr);
}

/**
 * Given a head (either as a string or a lambda expression)
 * and a set of arguments, return a boxed function expression.
 *
 * If available, preserve LaTeX and wikidata metadata in the boxed expression.
 *
 * The result is *not* a canonical expression.
 *
 * Note that `boxFunction()` should only be called from `box()`
 */
function boxFunction(
  ce: IComputeEngine,
  head: string,
  ops: SemiBoxedExpression[],
  metadata?: Metadata
): BoxedExpression {
  //
  // Hold
  //
  if (head === 'Hold') {
    const result = new BoxedFunction(
      ce,
      'Hold',
      [boxHold(ce, ops[0] ?? ['Error', "'missing'"])],
      metadata
    );
    // Hold is always canonical
    result.isCanonical = true;
    return result;
  }

  if (head === 'Domain') {
    return boxDomain(ce, ops[0] as DomainExpression, metadata);
  }

  //
  // String
  //
  if (head === 'String') {
    if (ops.length === 0) return new BoxedString(ce, '', metadata);
    return new BoxedString(
      ce,
      ops.map((x) => asString(x) ?? '').join(''),
      metadata
    );
  }

  //
  // Symbol
  //
  if (head === 'Symbol' && ops.length > 0)
    return ce.symbol(ops.map((x) => asString(x) ?? '').join(''), metadata);

  //
  // Rational (as Divide)
  //
  if ((head === 'Divide' || head === 'Rational') && ops.length === 2) {
    if (
      ops[0] instanceof AbstractBoxedExpression &&
      ops[1] instanceof AbstractBoxedExpression
    ) {
      if (
        ops[0].isLiteral &&
        ops[1].isLiteral &&
        ops[0].isInteger &&
        ops[1].isInteger
      ) {
        const [n, d] = [
          ops[0].machineValue ?? ops[0].asSmallInteger,
          ops[1].machineValue ?? ops[1].asSmallInteger,
        ];
        if (n !== null && d !== null) return ce.number([n, d], metadata);
        return new BoxedFunction(ce, 'Rational', [ops[0], ops[1]], metadata);
      }
    } else {
      const op1 = ops[0] as Expression;
      const op2 = ops[1] as Expression;
      const [n, d] = [decimalValue(ce, op1), decimalValue(ce, op2)];
      if (n?.isInteger() && d?.isInteger()) {
        if (isInMachineRange(n) && isInMachineRange(d))
          return ce.number([n.toNumber(), d.toNumber()], metadata);
        return new BoxedFunction(
          ce,
          'Rational',
          [ce.box(op1), ce.box(op2)],
          metadata
        );
      }
    }

    head = 'Divide';
  }

  //
  // Number
  //
  if (head === 'Number' && ops.length === 1) return box(ce, ops[0]);

  //
  // Complex
  //
  if (head === 'Complex') {
    if (ops.length === 1) {
      // @todo: use machineValue() & symbol() instead of box()
      const op1 = box(ce, ops[0]);
      const im = op1.asFloat;
      if (im !== null && im !== 0)
        return new BoxedNumber(ce, ce.complex(0, im), metadata);
      return ce.mul([op1, ce._I]);
    }
    if (ops.length === 2) {
      const op1 = box(ce, ops[0]);
      const op2 = box(ce, ops[1]);
      const re = op1.asFloat;
      const im = op2.asFloat;
      if (im !== null && re !== null) {
        if (im === 0 && re === 0) return ce._ZERO;
        if (im !== null && im !== 0)
          return new BoxedNumber(ce, ce.complex(re, im), metadata);
        return op1;
      }
      return ce.add([op1, ce.mul([op2, ce._I])], metadata);
    }
  }

  //
  // Negate
  //
  // Distribute over literals
  //
  if (head === 'Negate' && ops.length === 1) {
    if (typeof ops[0] === 'number') return ce.number(-ops[0], metadata);
    if (ops[0] instanceof AbstractBoxedExpression && ops[0].machineValue)
      return ce.number(-ops[0].machineValue, metadata);
  }

  //
  // Tuple
  //
  // Note: don't use `ce.tuple` since `boxExpression()` doesn't return a
  // canonical expression but `ce.tuple` does.

  if (head === 'Single') {
    if (ops.length < 1) return ce.error('expected-argument', "'Single");
    if (ops.length > 1) return ce.error('unexpected-argument', "'Single");
    return new BoxedFunction(ce, 'Tuple', [ce.box(ops[0])], metadata);
  }

  if (head === 'Pair') {
    if (ops.length < 2) return ce.error('expected-argument', "'Pair");
    if (ops.length > 2) return ce.error('unexpected-argument', "'Pair");
    return new BoxedFunction(
      ce,
      'Tuple',
      [ce.box(ops[0]), ce.box(ops[1])],
      metadata
    );
  }

  // KeyValuePair is not normalized to Tuple
  if (head === 'KeyValuePair') {
    if (ops.length < 2) return ce.error('expected-argument', "'KeyValuePair");
    if (ops.length > 2) return ce.error('unexpected-argument', "'KeyValuePair");
    return new BoxedFunction(
      ce,
      'KeyValuePair',
      [ce.box(ops[0]), ce.box(ops[1])],
      metadata
    );
  }

  if (head === 'Triple') {
    if (ops.length < 3) return ce.error('expected-argument', "'Triple");
    if (ops.length > 3) return ce.error('unexpected-argument', "'Triple");
    return new BoxedFunction(
      ce,
      'Tuple',
      ops.map((x) => ce.box(x)),
      metadata
    );
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
        if (key.isValid && key.symbol !== 'Nothing') {
          const value = arg.op2;
          let k = key.symbol ?? key.string;
          if (!k && key.isLiteral) {
            const n = key.machineValue ?? key.asSmallInteger;
            if (n && Number.isFinite(n) && Number.isInteger(n))
              k = n.toString();
          }
          if (k) dict[k] = value;
        }
      }
    }
    return new BoxedDictionary(ce, dict, metadata);
  }

  return new BoxedFunction(
    ce,
    head,
    ops.map((x) => box(ce, x)),
    metadata
  );
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
