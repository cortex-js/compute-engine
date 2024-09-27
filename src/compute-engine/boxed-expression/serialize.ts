import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import type { Expression } from '../../math-json/types.ts';

import type {
  BoxedExpression,
  IComputeEngine,
  JsonSerializationOptions,
  Metadata,
} from '../public.ts';

import { isInMachineRange } from '../numerics/numeric-bignum.ts';
import {
  Rational,
  isInteger,
  isMachineRational,
  isNegativeOne,
  isOne,
  isRational,
  machineDenominator,
  machineNumerator,
  neg,
} from '../numerics/rationals.ts';
import { numberToString } from '../numerics/strings.ts';
import { numberToExpression } from '../numerics/expression.ts';

import { NumericValue } from '../numeric-value/public.ts';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.ts';

// eslint-disable-next-line import/no-cycle
import { Product } from './product.ts';

import { order } from './order.ts';
import { asSmallInteger } from './numerics.ts';
import { isSubtype } from '../../common/type/subtype.ts';

function _escapeJsonString(s: undefined): undefined;
function _escapeJsonString(s: string): string;
function _escapeJsonString(s: string | undefined): string | undefined {
  return s;
}

/** Attempt to transform an expression a+b as a subtraction b-a. Return null
 * if could not.
 *
 * The caller should have checked that 'Subtract' is not in the exclusions.
 *
 */
function serializeSubtract(
  ce: IComputeEngine,
  a: BoxedExpression,
  b: BoxedExpression,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression | null {
  if (a.numericValue !== null && a.isNegative) {
    const v = a.numericValue;
    if (typeof v === 'number') {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [b, ce.number(-v)],
        options,
        metadata
      );
    }

    if (isSubtype(a.type, 'rational')) {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [b, ce.number(v.neg())],
        options,
        metadata
      );
    }
  }

  if (a.operator === 'Negate' && b.operator !== 'Negate')
    return serializeJsonFunction(ce, 'Subtract', [b, a.op1], options, metadata);

  return null;
}

/**
 * The pretty version of `serializeJsonFunction()` applies
 * additional transformations to make the MathJSON more readable, for example
 *  it uses `Divide`  instead of `Multiply`/`Power` when applicable.
 */
function serializePrettyJsonFunction(
  ce: IComputeEngine,
  name: string,
  args: ReadonlyArray<BoxedExpression>,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression {
  const exclusions = options.exclude;

  if (name === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    const sub =
      serializeSubtract(ce, args[0], args[1], options, metadata) ??
      serializeSubtract(ce, args[1], args[0], options, metadata);
    if (sub) return sub;
  }

  if (name === 'Divide' && args.length === 2 && exclusions.includes('Divide')) {
    return serializeJsonFunction(
      ce,
      'Multiply',
      [args[0], ce._fn('Power', [args[1], ce.NegativeOne])],
      options,
      metadata
    );
  }

  if (name === 'Multiply' && !exclusions.includes('Negate')) {
    if (args[0].im === 0 && args[0].re === -1) {
      if (args.length === 2)
        return serializeJsonFunction(ce, 'Negate', [args[1]], options);
      return serializeJsonFunction(
        ce,
        'Negate',
        [ce._fn('Multiply', [...args.slice(1)].sort(order))],
        options,
        metadata
      );
    }
  }

  if (name === 'Multiply' && !exclusions.includes('Divide')) {
    // Display a product with negative exponents as a division if
    // there are terms with a negative degree
    const result = new Product(ce, args, {
      canonical: false,
    }).asRationalExpression();
    if (result.operator === 'Divide')
      return serializeJsonFunction(
        ce,
        result.operator,
        result.ops!,
        options,
        metadata
      );
  }

  if (name === 'Power') {
    // e^x -> Exp(x)
    if (!exclusions.includes('Exp') && args[0]?.symbol === 'ExponentialE')
      return serializeJsonFunction(ce, 'Exp', [args[1]], options, metadata);

    if (args[1]?.numericValue !== null) {
      const exp = asSmallInteger(args[1]);
      // x^2 -> Square(x)
      if (exp === 2 && !exclusions.includes('Square'))
        return serializeJsonFunction(
          ce,
          'Square',
          [args[0]],
          options,
          metadata
        );

      if (exp !== null && exp < 0 && !exclusions.includes('Divide')) {
        return serializeJsonFunction(
          ce,
          'Divide',
          [ce.One, exp === -1 ? args[0] : args[0].pow(-exp)],
          options,
          metadata
        );
      }

      const r = args[1].re;

      if (!exclusions.includes('Sqrt') && r === 0.5)
        return serializeJsonFunction(ce, 'Sqrt', [args[0]], options, metadata);
      if (!exclusions.includes('Sqrt') && r === -0.5)
        return serializeJsonFunction(
          ce,
          'Divide',
          [ce.One, ce._fn('Sqrt', [args[0]])],
          options,
          metadata
        );

      if (isRational(r)) {
        const n = machineNumerator(r);
        const d = machineDenominator(r);
        if (n === 1) {
          if (!exclusions.includes('Sqrt') && d === 2)
            return serializeJsonFunction(
              ce,
              'Sqrt',
              [args[0]],
              options,
              metadata
            );
          if (!exclusions.includes('Root'))
            return serializeJsonFunction(
              ce,
              'Root',
              [args[0], ce.number(r[1])],
              options,
              metadata
            );
        }
        if (n === -1) {
          if (!exclusions.includes('Sqrt') && d === 2)
            return serializeJsonFunction(
              ce,
              'Divide',
              [ce.One, ce._fn('Sqrt', [args[0]])],
              options,
              metadata
            );
          if (!exclusions.includes('Root'))
            return serializeJsonFunction(
              ce,
              'Divide',
              [ce.One, ce._fn('Root', [args[0], ce.number(r[1])])],
              options,
              metadata
            );
        }
      }
    }
  }

  if (name === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    if (args[1]?.numericValue !== null) {
      const t1 = asSmallInteger(args[1]);
      if (t1 !== null && t1 < 0)
        return serializeJsonFunction(
          ce,
          'Subtract',
          [args[0], ce.number(-t1)],
          options,
          metadata
        );
    }
    if (args[1]?.operator === 'Negate') {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [args[0], args[1].op1],
        options,
        metadata
      );
    }
  }

  if (name === 'Tuple') {
    if (args.length === 1 && !exclusions.includes('Single'))
      return serializeJsonFunction(ce, 'Single', args, options, metadata);
    if (args.length === 2 && !exclusions.includes('Pair'))
      return serializeJsonFunction(ce, 'Pair', args, options, metadata);
    if (args.length === 3 && !exclusions.includes('Triple'))
      return serializeJsonFunction(ce, 'Triple', args, options, metadata);
  }

  return serializeJsonFunction(ce, name, args, options, metadata);
}

function serializeJsonFunction(
  ce: IComputeEngine,
  name: string,
  args: ReadonlyArray<undefined | BoxedExpression>,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression {
  const exclusions = options.exclude;

  //
  // Negate(number) is always prettyfied as a negative number, since `-2` gets
  // parsed as `['Negate', 2]` and not `-2`.
  //
  if (name === 'Negate' && args.length === 1) {
    const num0 = args[0]?.numericValue;
    if (num0) {
      if (typeof num0 === 'number')
        return serializeJsonNumber(ce, -num0, options);
      if (num0 instanceof Decimal)
        return serializeJsonNumber(ce, num0.neg(), options);
      if (num0 instanceof Complex)
        return serializeJsonNumber(ce, num0!.neg(), options);
      if (isRational(num0)) return serializeJsonNumber(ce, neg(num0), options);
    }
  }

  //
  // If there are some exclusions, try to avoid them.
  // This is done both to canonical or non-canonical expressions.
  //
  if (typeof name === 'string' && exclusions.includes(name)) {
    if (name === 'Rational' && args.length === 2)
      return serializeJsonFunction(ce, 'Divide', args, options, metadata);

    if (name === 'Complex' && args.length === 2)
      return serializeJsonFunction(
        ce,
        'Add',
        [
          args[0],
          ce._fn('Multiply', [args[1] ?? ce.symbol('Undefined'), ce.I]),
        ],
        options,
        metadata
      );

    if (name === 'Sqrt' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], exclusions.includes('Half') ? ce.number([1, 2]) : ce.Half],
        options,
        metadata
      );

    if (
      name === 'Root' &&
      args.length === 2 &&
      args[1]?.numericValue !== null
    ) {
      const n = asSmallInteger(args[1]);
      if (n === 2) return serializeJsonFunction(ce, 'Sqrt', [args[0]], options);

      if (n !== null) {
        if (n < 0)
          return serializeJsonFunction(
            ce,
            'Divide',
            [
              ce.One,
              ce._fn('Power', [
                args[0] ?? ce.symbol('Undefined'),
                ce.number([1, -n]),
              ]),
            ],
            options,
            metadata
          );

        return serializeJsonFunction(
          ce,
          'Power',
          [args[0], ce.number([1, -n])],
          options,
          metadata
        );
      }
    }

    if (name === 'Square' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], ce.number(2)],
        options,
        metadata
      );

    if (name === 'Exp' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [ce.E, args[0]],
        options,
        metadata
      );

    if (name === 'Pair' || name == 'Single' || name === 'Triple')
      return serializeJsonFunction(ce, 'Tuple', args, options, metadata);

    // Note: even though 'Subtract' is boxed out, we still need to handle it here
    // because the function may be called with a non-canonical 'Subtract' operator.
    if (name === 'Subtract' && args.length === 2)
      return serializeJsonFunction(
        ce,
        'Add',
        [args[0], ce._fn('Negate', [args[1] ?? ce.symbol('Undefined')])],
        options,
        metadata
      );
    if (name === 'Subtract' && args.length === 1)
      return serializeJsonFunction(ce, 'Negate', args, options, metadata);
  }

  const jsonHead = _escapeJsonString(name);

  const fn: Expression = [
    jsonHead,
    ...args.map((x) => (x ? serializeJson(ce, x, options) : 'Undefined')),
  ];

  const md: Metadata = { ...(metadata ?? {}) };

  // Determine if we need some LaTeX metadata
  if (options.metadata.includes('latex')) {
    md.latex = _escapeJsonString(
      md.latex ?? ce.box({ fn } as Expression).latex
    );
  } else md.latex = '';

  // Determine if we have some wikidata metadata
  if (!options.metadata.includes('wikidata')) md.wikidata = '';

  //  Is shorthand allowed, and no metadata to include
  if (!md.latex && !md.wikidata && options.shorthands.includes('function'))
    return fn;

  // No shorthand allowed, or some metadata to include
  if (md.latex && md.wikidata)
    return { fn, latex: md.latex, wikidata: md.wikidata } as Expression;
  if (md.latex) return { fn, latex: md.latex } as Expression;
  if (md.wikidata) return { fn, wikidata: md.wikidata } as Expression;
  return { fn } as Expression;
}

function serializeJsonString(
  s: string,
  options: Readonly<JsonSerializationOptions>
): Expression {
  s = _escapeJsonString(s);
  if (options.shorthands.includes('string')) return `'${s}'`;
  return { str: s };
}

function serializeJsonSymbol(
  ce: IComputeEngine,
  sym: string,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression {
  if (sym === 'Half' && options.exclude.includes('Half')) {
    return serializeJsonNumber(ce, [1, 2], options, metadata);
  }

  metadata = { ...metadata };
  if (options.metadata.includes('latex')) {
    metadata.latex = metadata.latex ?? ce.box({ sym }).latex;

    if (metadata.latex !== undefined)
      metadata.latex = _escapeJsonString(metadata.latex);
  } else metadata.latex = undefined;

  if (options.metadata.includes('wikidata')) {
    if (metadata.wikidata === undefined) {
      const wikidata = ce.lookupSymbol(sym)?.wikidata;
      if (wikidata !== undefined)
        metadata.wikidata = _escapeJsonString(wikidata);
    }
  } else metadata.wikidata = undefined;

  sym = _escapeJsonString(sym!);

  if (
    metadata.latex === undefined &&
    metadata.wikidata === undefined &&
    options.shorthands.includes('symbol')
  )
    return sym;

  if (metadata.latex !== undefined && metadata.wikidata !== undefined)
    return { sym, latex: metadata.latex, wikidata: metadata.wikidata };
  if (metadata.latex !== undefined) return { sym, latex: metadata.latex };
  if (metadata.wikidata !== undefined)
    return { sym, wikidata: metadata.wikidata };
  return { sym };
}

function serializeRepeatingDecimals(
  s: string,
  options: Readonly<JsonSerializationOptions>
): string {
  if (!options.repeatingDecimal) return s;

  // eslint-disable-next-line prefer-const
  let [_, wholepart, fractionalPart, exponent] =
    s.match(/^(.*)\.([0-9]+)([e|E][-+]?[0-9]+)?$/) ?? [];
  if (!fractionalPart) return s.toLowerCase();

  // The last digit may have been rounded off if it exceeds the precision,
  // which could throw off the repeating pattern detection. Ignore it.
  const lastDigit = fractionalPart[fractionalPart.length - 1];
  fractionalPart = fractionalPart.slice(0, -1);

  const MAX_REPEATING_PATTERN_LENGTH = 16;
  let prefix = '';

  for (
    let i = 0;
    i < fractionalPart.length - MAX_REPEATING_PATTERN_LENGTH;
    i++
  ) {
    prefix = fractionalPart.substring(0, i);
    // Try to find a repeating pattern of length j
    for (let j = 0; j <= MAX_REPEATING_PATTERN_LENGTH; j++) {
      const repetend = fractionalPart.substring(i, i + j + 1);
      const times = Math.floor(
        (fractionalPart.length - prefix.length) / repetend.length
      );
      if (times < 3) break;
      if ((prefix + repetend.repeat(times + 1)).startsWith(fractionalPart)) {
        // Found a repeating pattern

        // Aktually...
        if (repetend === '0') {
          if (lastDigit === '0')
            return wholepart + '.' + prefix + (exponent ?? '');
          return s;
        }
        return (
          wholepart + '.' + prefix + '(' + repetend + ')' + (exponent ?? '')
        );
      }
    }
  }

  fractionalPart += lastDigit;
  while (fractionalPart.endsWith('0'))
    fractionalPart = fractionalPart.slice(0, -1);
  if (exponent)
    return `${wholepart}.${fractionalPart}${exponent.toLowerCase()}`;
  return `${wholepart}.${fractionalPart}`;
}

function serializeJsonNumber(
  ce: IComputeEngine,
  value: number | bigint | NumericValue | Decimal | Complex | Rational,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression {
  metadata = { ...metadata };

  if (!options.metadata.includes('latex')) metadata.latex = undefined;

  const shorthandAllowed =
    metadata.latex === undefined &&
    metadata.wikidata === undefined &&
    !options.metadata.includes('latex') &&
    options.shorthands.includes('number');

  const exclusions = options.exclude;

  if (value instanceof NumericValue) {
    if (value.isNaN) return serializeJsonSymbol(ce, 'NaN', options, metadata);

    if (value.isPositiveInfinity)
      return serializeJsonSymbol(ce, 'PositiveInfinity', options, metadata);

    if (value.isNegativeInfinity)
      return serializeJsonSymbol(ce, 'NegativeInfinity', options, metadata);

    if (value.isComplexInfinity)
      return serializeJsonSymbol(ce, 'ComplexInfinity', options, metadata);

    if (shorthandAllowed) {
      if (value.isZero) return 0;
      if (value.isOne) return 1;
      if (value.isNegativeOne) return -1;
    }

    // We have an exact numeric value, possibly with an imaginary part
    if (value instanceof ExactNumericValue) {
      // Calculate the real part

      let rational: Expression;

      if (isInteger(value.rational)) {
        rational = serializeJsonNumber(ce, value.rational[0], options);
      } else {
        rational = [
          'Rational',
          serializeJsonNumber(ce, value.rational[0], options),
          serializeJsonNumber(ce, value.rational[1], options),
        ];
      }

      if (value.radical === 1) {
        // No radical
        if (value.im === 0) return rational;

        if (typeof rational === 'number')
          return ['Complex', rational, value.im];
        return ['Add', rational, ['Complex', 0, value.im]];
      }

      // If rational was 0, radical would be 1, and we would have returned
      // a number already
      console.assert(rational !== 0);

      if (isOne(value.rational)) {
        if (value.im === 0) return ['Sqrt', value.radical];

        return ['Add', ['Sqrt', value.radical], ['Complex', 0, value.im]];
      }

      if (isNegativeOne(value.rational)) {
        if (value.im === 0) return ['Negate', ['Sqrt', value.radical]];

        return [
          'Add',
          ['Negate', ['Sqrt', value.radical]],
          ['Complex', 0, value.im],
        ];
      }

      // There is a radical part
      if (value.im === 0)
        return ['Multiply', rational, ['Sqrt', value.radical]];

      return [
        'Add',
        ['Multiply', rational, ['Sqrt', value.radical]],
        ['Complex', 0, value.im],
      ];
    }

    // We have a real number (big or machine)
    if (value.im === 0) {
      const re = value.bignumRe ?? value.re;
      return serializeJsonNumber(ce, re, options, metadata);
    }

    // We have a complex number
    if (!Number.isFinite(value.im))
      return serializeJsonSymbol(ce, 'ComplexInfinity', options, metadata);

    return serializeJsonFunction(
      ce,
      'Complex',
      [ce.number(value.bignumRe ?? value.re), ce.number(value.im)],
      options,
      {
        ...metadata,
        wikidata: 'Q11567',
      }
    );
  }

  //
  // Bignum
  //
  let num = '';
  if (value instanceof Decimal) {
    let result: string | undefined;
    if (value.isNaN()) result = 'NaN';
    else if (!value.isFinite())
      result = value.isPositive() ? 'PositiveInfinity' : 'NegativeInfinity';
    else {
      // Use the number shorthand if the number can be represented as a machine number
      if (shorthandAllowed && isInMachineRange(value)) return value.toNumber();

      // Use the scientific notation only if the resulting integer is not
      // too big...
      if (value.isInteger() && value.e < value.precision() + 4)
        num = value.toFixed(0);
      else {
        const precision = options.fractionalDigits;
        let s: string;
        if (precision === 'max') s = value.toString();
        else if (precision === 'auto') s = value.toPrecision(ce.precision);
        else s = value.toDecimalPlaces(precision).toString();

        num = serializeRepeatingDecimals(s, options);

        if (shorthandAllowed) {
          // Can we shorthand to a JSON number after accounting for serialization precision?
          const val = value.toNumber();
          if (val.toString() === num) return val;
        }
      }
    }

    if (options.metadata.includes('latex'))
      metadata.latex = metadata.latex ?? ce.box(result ?? { num }).latex;

    if (result) {
      if (metadata.latex !== undefined)
        return { sym: result, latex: metadata.latex };
      if (shorthandAllowed) return result;
      return { sym: result };
    }

    if (metadata.latex !== undefined) return { num, latex: metadata.latex };
    return shorthandAllowed ? num : { num };
  }

  //
  // Complex
  //
  if (value instanceof Complex) {
    if (value.isInfinite())
      return serializeJsonSymbol(ce, 'ComplexInfinity', options, metadata);
    if (value.isNaN()) {
      num = 'NaN';
      if (options.metadata.includes('latex'))
        metadata.latex = metadata.latex ?? ce.box({ num }).latex;

      return metadata.latex !== undefined
        ? { num, latex: metadata.latex }
        : { num };
    }

    return serializeJsonFunction(
      ce,
      'Complex',
      [ce.number(value.re), ce.number(value.im)],
      options,
      {
        ...metadata,
        wikidata: 'Q11567',
      }
    );
  }

  //
  // Rational
  //
  if (isRational(value)) {
    const allowRational = !exclusions.includes('Rational');
    //  Shorthand allowed, and no metadata to include?
    if (
      shorthandAllowed &&
      options.shorthands.includes('function') &&
      isMachineRational(value)
    ) {
      if (value[0] === 1 && value[1] === 2 && !exclusions.includes('Half'))
        return serializeJsonSymbol(ce, 'Half', options, metadata);
      return [allowRational ? 'Rational' : 'Divide', value[0], value[1]];
    }
    return serializeJsonFunction(
      ce,
      allowRational ? 'Rational' : 'Divide',
      [ce.number(value[0]), ce.number(value[1])],
      options,
      { ...metadata }
    );
  }

  //
  // BigInt
  //
  if (typeof value === 'bigint') {
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
      value = Number(value);
    } else {
      if (options.metadata.includes('latex'))
        metadata.latex =
          metadata.latex ?? ce.box({ num: value.toString() }).latex;

      if (metadata.latex !== undefined)
        return { num: value.toString(), latex: metadata.latex };
      return shorthandAllowed
        ? numberToExpression(value)
        : { num: numberToString(value) };
    }
  }

  //
  // Machine number
  //
  let result: string | undefined;
  if (Number.isNaN(value)) result = 'NaN';
  else if (!Number.isFinite(value))
    result = value > 0 ? 'PositiveInfinity' : 'NegativeInfinity';
  else num = serializeRepeatingDecimals(value.toString(), options);

  if (options.metadata.includes('latex'))
    metadata.latex = metadata.latex ?? ce.box({ num }).latex;

  if (result) {
    if (metadata.latex !== undefined)
      return { sym: result, latex: metadata.latex };
    return shorthandAllowed ? result : { sym: result };
  }

  if (metadata.latex !== undefined) return { num, latex: metadata.latex };
  if (shorthandAllowed && num === value.toString()) return value;
  return { num };
}

export function serializeJson(
  ce: IComputeEngine,
  expr: BoxedExpression,
  options: Readonly<JsonSerializationOptions>
): Expression {
  // Accessing the wikidata could have a side effect of binding the symbol
  // We want to avoid that.
  const wikidata = expr.scope ? expr.wikidata : undefined;

  // Is it a number literal?
  if (expr.numericValue !== null)
    return serializeJsonNumber(ce, expr.numericValue, options, {
      latex: expr.verbatimLatex,
    });

  // Is it a tensor?
  if (expr.rank > 0) return expr.json;

  // Is it a string?
  if (expr.string !== null) return serializeJsonString(expr.string, options);

  // Is it a symbol?
  if (expr.symbol !== null) {
    return serializeJsonSymbol(ce, expr.symbol, options, {
      latex: expr.verbatimLatex,
      wikidata,
    });
  }

  // Is it a function?
  if (expr.ops) {
    if (
      expr.isValid &&
      (expr.isCanonical || expr.isStructural) &&
      options.prettify
    )
      return serializePrettyJsonFunction(
        ce,
        expr.operator,
        expr.structural.ops!,
        options,
        {
          latex: expr.verbatimLatex,
          wikidata,
        }
      );
    return serializeJsonFunction(
      ce,
      expr.operator,
      expr.structural.ops!,
      options,
      {
        latex: expr.verbatimLatex,
        wikidata,
      }
    );
  }

  return expr.json;
}
