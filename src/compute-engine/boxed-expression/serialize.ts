import Complex from 'complex.js';
import { Decimal } from 'decimal.js';

import {
  Expression,
  MathJsonFunction,
  MathJsonIdentifier,
} from '../../math-json/math-json-format';

import {
  BoxedExpression,
  IComputeEngine,
  JsonSerializationOptions,
  Metadata,
} from '../public';

import { asMachineInteger, asFloat } from './numerics';

import { isInMachineRange } from '../numerics/numeric-bignum';

import {
  Rational,
  isMachineRational,
  isRational,
  machineDenominator,
  machineNumerator,
  neg,
} from '../numerics/rationals';

import { Product } from '../symbolic/product';

import { BoxedString } from './boxed-string';
import { BoxedSymbol } from './boxed-symbol';
import { BoxedNumber } from './boxed-number';
import { BoxedFunction } from './boxed-function';
import { BoxedTensor } from './boxed-tensor';
import { BoxedDictionary } from './boxed-dictionary';
import { _BoxedDomain } from './boxed-domain';
import { order } from './order';

function _escapeJsonString(s: undefined): undefined;
function _escapeJsonString(s: string): string;
function _escapeJsonString(s: string | undefined): string | undefined {
  return s;
}

/** Attempt to expression a+b as a subtraction. Return null
 * if could not.
 */
function serializeSubtract(
  ce: IComputeEngine,
  a: BoxedExpression,
  b: BoxedExpression,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression | null {
  if (a.numericValue !== null) {
    if (isRational(a.numericValue)) {
      if (machineNumerator(a.numericValue) < 0) {
        return serializeJsonFunction(
          ce,
          'Subtract',
          [b, ce.number(neg(a.numericValue))],
          options,
          metadata
        );
      }
      return null;
    }
    const t0 = asMachineInteger(a);
    if (t0 !== null && t0 < 0)
      return serializeJsonFunction(
        ce,
        'Subtract',
        [b, ce.number(-t0)],
        options,
        metadata
      );
  }
  if (a.head === 'Negate' && b.head !== 'Negate')
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
  head: string | BoxedExpression,
  args: ReadonlyArray<BoxedExpression>,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression {
  const exclusions = options.exclude;

  if (head === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    const sub =
      serializeSubtract(ce, args[0], args[1], options, metadata) ??
      serializeSubtract(ce, args[1], args[0], options, metadata);
    if (sub) return sub;
  }

  if (head === 'Divide' && args.length === 2 && exclusions.includes('Divide')) {
    return serializeJsonFunction(
      ce,
      'Multiply',
      [args[0], ce._fn('Power', [args[1], ce.NegativeOne])],
      options,
      metadata
    );
  }

  if (head === 'Multiply' && !exclusions.includes('Negate')) {
    if (asFloat(args[0]) === -1) {
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

  if (head === 'Multiply' && !exclusions.includes('Divide')) {
    // Display a product with negative exponents as a division if
    // there are terms with a negative degree
    const result = new Product(ce, args, {
      canonical: false,
    }).asRationalExpression();
    if (result.head === 'Divide')
      return serializeJsonFunction(
        ce,
        result.head,
        result.ops!,
        options,
        metadata
      );
  }

  if (head === 'Power') {
    if (!exclusions.includes('Exp') && args[0]?.symbol === 'ExponentialE')
      return serializeJsonFunction(ce, 'Exp', [args[1]], options, metadata);

    if (args[1]?.numericValue !== null) {
      const exp = asMachineInteger(args[1]);
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
          [ce.One, exp === -1 ? args[0] : ce.pow(args[0], -exp)],
          options,
          metadata
        );
      }

      const r = args[1].numericValue;

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

  if (head === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    if (args[1]?.numericValue !== null) {
      const t1 = asMachineInteger(args[1]);
      if (t1 !== null && t1 < 0)
        return serializeJsonFunction(
          ce,
          'Subtract',
          [args[0], ce.number(-t1)],
          options,
          metadata
        );
    }
    if (args[1]?.head === 'Negate') {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [args[0], args[1].op1],
        options,
        metadata
      );
    }
  }

  if (head === 'Tuple') {
    if (args.length === 1 && !exclusions.includes('Single'))
      return serializeJsonFunction(ce, 'Single', args, options, metadata);
    if (args.length === 2 && !exclusions.includes('Pair'))
      return serializeJsonFunction(ce, 'Pair', args, options, metadata);
    if (args.length === 3 && !exclusions.includes('Triple'))
      return serializeJsonFunction(ce, 'Triple', args, options, metadata);
  }

  return serializeJsonFunction(ce, head, args, options, metadata);
}

function serializeJsonFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  args: ReadonlyArray<undefined | BoxedExpression>,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): Expression {
  const exclusions = options.exclude;

  //
  // Negate(number) is always prettyfied as a negative number, since `-2` gets
  // parsed as `['Negate', 2]` and not `-2`.
  //
  if (head === 'Negate' && args.length === 1) {
    const num0 = args[0]?.numericValue;
    if (num0 !== null) {
      if (typeof num0 === 'number')
        return serializeJsonNumber(ce, -num0, options);
      if (num0 instanceof Decimal)
        return serializeJsonNumber(ce, num0.neg(), options);
      if (num0 instanceof Complex)
        return serializeJsonNumber(ce, num0.neg(), options);
      if (isRational(num0)) return serializeJsonNumber(ce, neg(num0), options);
    }
  }

  //
  // If there are some exclusions, try to avoid them.
  // This is done both to canonical or non-canonical expressions.
  //
  if (typeof head === 'string' && exclusions.includes(head)) {
    if (head === 'Rational' && args.length === 2)
      return serializeJsonFunction(ce, 'Divide', args, options, metadata);

    if (head === 'Complex' && args.length === 2)
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

    if (head === 'Sqrt' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], exclusions.includes('Half') ? ce.number([1, 2]) : ce.Half],
        options,
        metadata
      );

    if (
      head === 'Root' &&
      args.length === 2 &&
      args[1]?.numericValue !== null
    ) {
      const n = asMachineInteger(args[1]);
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

    if (head === 'Square' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], ce.number(2)],
        options,
        metadata
      );

    if (head === 'Exp' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [ce.E, args[0]],
        options,
        metadata
      );

    if (head === 'Pair' || head == 'Single' || head === 'Triple')
      return serializeJsonFunction(ce, 'Tuple', args, options, metadata);

    // Note: even though 'Subtract' is boxed out, we still need to handle it here
    // because the function may be called with a non-canonical 'Subtract' head.
    if (head === 'Subtract' && args.length === 2)
      return serializeJsonFunction(
        ce,
        'Add',
        [args[0], ce._fn('Negate', [args[1] ?? ce.symbol('Undefined')])],
        options,
        metadata
      );
    if (head === 'Subtract' && args.length === 1)
      return serializeJsonFunction(ce, 'Negate', args, options, metadata);
  }

  const jsonHead =
    typeof head === 'string'
      ? _escapeJsonString(head)
      : (serializeJson(ce, head, options) as
          | MathJsonIdentifier
          | MathJsonFunction);

  const fn: Expression = [
    jsonHead,
    ...args.map((x) => (x ? serializeJson(ce, x, options) : 'Undefined')),
  ];

  const md: Metadata = { ...(metadata ?? {}) };

  // Determine if we need some LaTeX metadata
  if (options.metadata.includes('latex')) {
    md.latex = _escapeJsonString(md.latex ?? ce.box({ fn }).latex);
  } else md.latex = '';

  // Determine if we have some wikidata metadata
  if (!options.metadata.includes('wikidata')) md.wikidata = '';

  //  Is shorthand allowed, and no metadata to include
  if (!md.latex && !md.wikidata && options.shorthands.includes('function'))
    return fn;

  // No shorthand allowed, or some metadata to include
  if (md.latex && md.wikidata)
    return { fn, latex: md.latex, wikidata: md.wikidata };
  if (md.latex) return { fn, latex: md.latex };
  if (md.wikidata) return { fn, wikidata: md.wikidata };
  return { fn };
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

function serializeDictionary(
  expr: BoxedDictionary,
  options: Readonly<JsonSerializationOptions>
): Expression {
  const ce = expr.engine;
  // Is dictionary shorthand notation allowed?
  if (options.shorthands.includes('dictionary')) {
    const dict = {};
    for (const key of expr.keys)
      dict[key] = serializeJson(expr.engine, expr.getKey(key)!, options);
    return { dict };
  }

  // The dictionary shorthand is not allowed, output it as a "Dictionary"
  // function
  const kvs: BoxedExpression[] = [];
  for (const key of expr.keys)
    kvs.push(ce._fn('KeyValuePair', [ce.string(key), expr.getKey(key)!]));

  return serializeJsonFunction(ce, 'Dictionary', kvs, options, {
    latex: expr.verbatimLatex,
  });
}

function serializeJsonNumber(
  ce: IComputeEngine,
  value: number | Decimal | Complex | Rational,
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

  if (expr instanceof BoxedNumber)
    return serializeJsonNumber(ce, expr.numericValue, options, {
      latex: expr.verbatimLatex,
    });

  if (expr instanceof BoxedFunction) {
    if (expr.isValid && expr.isCanonical && options.prettify)
      return serializePrettyJsonFunction(ce, expr.head, expr.ops, options, {
        latex: expr.verbatimLatex,
        wikidata,
      });
    return serializeJsonFunction(ce, expr.head, expr.ops, options, {
      latex: expr.verbatimLatex,
      wikidata,
    });
  }

  if (expr instanceof BoxedDictionary)
    return serializeDictionary(expr, options);

  if (expr instanceof BoxedTensor) {
    // @todo tensor: could be optimized by avoiding creating
    // an expression and getting the JSON from the tensor directly
    return serializeJson(ce, expr.expression, options);
  }

  if (expr instanceof BoxedString)
    return serializeJsonString(expr.string, options);

  if (expr instanceof BoxedSymbol) {
    return serializeJsonSymbol(ce, expr.symbol, options, {
      latex: expr.verbatimLatex,
      wikidata,
    });
  }

  // if (expr instanceof _BoxedDomain) {
  // }

  return expr.json;
}
