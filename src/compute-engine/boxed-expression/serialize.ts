import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';

import { Expression } from '../../math-json/math-json-format';

import { BoxedExpression, IComputeEngine, Metadata, Rational } from '../public';
import { isInMachineRange } from '../numerics/numeric-bignum';

import { Product } from '../symbolic/product';
import {
  isMachineRational,
  isRational,
  machineDenominator,
  machineNumerator,
  neg,
} from '../numerics/rationals';
import { asFloat, asSmallInteger } from '../numerics/numeric';

function subtract(
  ce: IComputeEngine,
  a: BoxedExpression,
  b: BoxedExpression,
  metadata?: Metadata
): Expression | null {
  if (a.numericValue !== null) {
    if (isRational(a.numericValue)) {
      if (machineNumerator(a.numericValue) < 0) {
        return serializeJsonFunction(
          ce,
          'Subtract',
          [b, ce.number(neg(a.numericValue))],
          metadata
        );
      }
      return null;
    }
    const t0 = asSmallInteger(a);
    if (t0 !== null && t0 < 0)
      return serializeJsonFunction(
        ce,
        'Subtract',
        [b, ce.number(-t0)],
        metadata
      );
  }
  if (a.head === 'Negate')
    return serializeJsonFunction(ce, 'Subtract', [b, a.op1], metadata);

  return null;
}

/**
 * The canonical version of `serializeJsonFunction()` applies
 * additional transformations to "reverse" some of the effects
 * of canonicalization (or boxing), for example it uses `Divide`
 * instead of `Multiply`/`Power` when applicable.
 */
export function serializeJsonCanonicalFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  args: BoxedExpression[],
  metadata?: Metadata
): Expression {
  const exclusions = ce.jsonSerializationOptions.exclude;

  if (head === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    const sub =
      subtract(ce, args[0], args[1], metadata) ??
      subtract(ce, args[1], args[0], metadata);
    if (sub) return sub;
  }

  if (head === 'Divide' && args.length === 2 && exclusions.includes('Divide')) {
    return serializeJsonFunction(
      ce,
      'Multiply',
      [args[0], ce._fn('Power', [args[1], ce.NegativeOne])],
      metadata
    );
  }

  if (head === 'Multiply' && !exclusions.includes('Negate')) {
    if (asFloat(args[0]) === -1) {
      if (args.length === 2)
        return serializeJsonFunction(ce, 'Negate', [args[1]]);
      return serializeJsonFunction(
        ce,
        'Negate',
        [ce._fn('Multiply', args.slice(1))],
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
      return serializeJsonFunction(ce, result.head, result.ops!, metadata);
  }

  if (head === 'Power') {
    if (!exclusions.includes('Exp') && args[0]?.symbol === 'ExponentialE')
      return serializeJsonFunction(ce, 'Exp', [args[1]], metadata);

    if (args[1]?.numericValue !== null) {
      const exp = asSmallInteger(args[1]);
      if (exp === 2 && !exclusions.includes('Square'))
        return serializeJsonFunction(ce, 'Square', [args[0]], metadata);

      if (exp !== null && exp < 0 && !exclusions.includes('Divide')) {
        return serializeJsonFunction(
          ce,
          'Divide',
          [ce.One, exp === -1 ? args[0] : ce.pow(args[0], -exp)],
          metadata
        );
      }

      const r = args[1].numericValue;

      if (!exclusions.includes('Sqrt') && r === 0.5)
        return serializeJsonFunction(ce, 'Sqrt', [args[0]], metadata);
      if (!exclusions.includes('Sqrt') && r === -0.5)
        return serializeJsonFunction(
          ce,
          'Divide',
          [ce.One, ce._fn('Sqrt', [args[0]])],
          metadata
        );

      if (isRational(r)) {
        const n = machineNumerator(r);
        const d = machineDenominator(r);
        if (n === 1) {
          if (!exclusions.includes('Sqrt') && d === 2)
            return serializeJsonFunction(ce, 'Sqrt', [args[0]], metadata);
          if (!exclusions.includes('Root'))
            return serializeJsonFunction(
              ce,
              'Root',
              [args[0], ce.number(r[1])],
              metadata
            );
        }
        if (n === -1) {
          if (!exclusions.includes('Sqrt') && d === 2)
            return serializeJsonFunction(
              ce,
              'Divide',
              [ce.One, ce._fn('Sqrt', [args[0]])],
              metadata
            );
          if (!exclusions.includes('Root'))
            return serializeJsonFunction(
              ce,
              'Divide',
              [ce.One, ce._fn('Root', [args[0], ce.number(r[1])])],
              metadata
            );
        }
      }
    }
  }

  return serializeJsonFunction(ce, head, args, metadata);
}

export function serializeJsonFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  args: (undefined | BoxedExpression)[],
  metadata?: Metadata
): Expression {
  // Special case some functions...

  const exclusions = ce.jsonSerializationOptions.exclude;

  if (
    (head === 'Rational' || head === 'Divide') &&
    args.length === 2 &&
    asSmallInteger(args[0]) === 1 &&
    asSmallInteger(args[1]) === 2 &&
    !exclusions.includes('Half')
  ) {
    return serializeJsonSymbol(ce, 'Half', {
      ...metadata,
      wikidata: 'Q39373172',
    });
  }

  if (args.length === 1) {
    const num0 = args[0]?.numericValue;
    if (head === 'Negate' && num0 !== null) {
      if (typeof num0 === 'number') return serializeJsonNumber(ce, -num0);
      if (num0 instanceof Decimal) return serializeJsonNumber(ce, num0.neg());
      if (num0 instanceof Complex) return serializeJsonNumber(ce, num0.neg());
      if (isRational(num0)) return serializeJsonNumber(ce, neg(num0));
    }
  }
  if (typeof head === 'string' && exclusions.includes(head)) {
    if (head === 'Rational' && args.length === 2)
      return serializeJsonFunction(ce, 'Divide', args, metadata);

    if (head === 'Complex' && args.length === 2)
      return serializeJsonFunction(
        ce,
        'Add',
        [
          args[0],
          ce._fn('Multiply', [args[1] ?? ce.symbol('Undefined'), ce.I]),
        ],
        metadata
      );

    if (head === 'Sqrt' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], exclusions.includes('Half') ? ce.number([1, 2]) : ce.Half],
        metadata
      );

    if (
      head === 'Root' &&
      args.length === 2 &&
      args[1]?.numericValue !== null
    ) {
      const n = asSmallInteger(args[1]);
      if (n === 2) return serializeJsonFunction(ce, 'Sqrt', [args[0]]);

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
            metadata
          );

        return serializeJsonFunction(
          ce,
          'Power',
          [args[0], ce.number([1, -n])],
          metadata
        );
      }
    }

    if (head === 'Square' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], ce.number(2)],
        metadata
      );

    if (head === 'Exp' && args.length === 1)
      return serializeJsonFunction(ce, 'Power', [ce.E, args[0]], metadata);

    // Note: even though 'Subtract' is boxed out, we still need to handle it here
    // because the function may be called with a 'Subtract' head.
    if (head === 'Subtract' && args.length === 2)
      return serializeJsonFunction(
        ce,
        'Add',
        [args[0], ce._fn('Negate', [args[1] ?? ce.symbol('Undefined')])],
        metadata
      );
    if (head === 'Subtract' && args.length === 1)
      return serializeJsonFunction(ce, 'Negate', args, metadata);
  }

  if (head === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    if (args[1]?.numericValue !== null) {
      const t1 = asSmallInteger(args[1]);
      if (t1 !== null && t1 < 0)
        return serializeJsonFunction(
          ce,
          'Subtract',
          [args[0], ce.number(-t1)],
          metadata
        );
    }
    if (args[1]?.head === 'Negate') {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [args[0], args[1].op1],
        metadata
      );
    }
  }

  if (head === 'Tuple') {
    if (args.length === 1 && !exclusions.includes('Single'))
      return serializeJsonFunction(ce, 'Single', args, metadata);
    if (args.length === 2 && !exclusions.includes('Pair'))
      return serializeJsonFunction(ce, 'Pair', args, metadata);
    if (args.length === 3 && !exclusions.includes('Triple'))
      return serializeJsonFunction(ce, 'Triple', args, metadata);
  }

  const jsonHead =
    typeof head === 'string' ? _escapeJsonString(head) : head.json;

  const fn: Expression = [jsonHead, ...args.map((x) => x?.json ?? 'Undefined')];

  const md: Metadata = { ...(metadata ?? {}) };

  // Determine if we need some LaTeX metadata
  if (ce.jsonSerializationOptions.metadata.includes('latex')) {
    md.latex = _escapeJsonString(md.latex ?? ce.serialize({ fn }));
  } else md.latex = '';

  // Determine if we have some wikidata metadata
  if (!ce.jsonSerializationOptions.metadata.includes('wikidata'))
    md.wikidata = '';

  //  Is shorthand allowed, and no metadata to include
  if (
    !md.latex &&
    !md.wikidata &&
    ce.jsonSerializationOptions.shorthands.includes('function')
  )
    return fn;

  // No shorthand allowed, or some metadata to include
  if (md.latex && md.wikidata)
    return { fn, latex: md.latex, wikidata: md.wikidata };
  if (md.latex) return { fn, latex: md.latex };
  if (md.wikidata) return { fn, wikidata: md.wikidata };
  return { fn };
}

export function serializeJsonString(ce: IComputeEngine, s: string): Expression {
  s = _escapeJsonString(s);
  if (ce.jsonSerializationOptions.shorthands.includes('string'))
    return `'${s}'`;
  return { str: s };
}

export function serializeJsonSymbol(
  ce: IComputeEngine,
  sym: string,
  metadata?: Metadata
): Expression {
  if (sym === 'Half' && ce.jsonSerializationOptions.exclude.includes('Half')) {
    return serializeJsonNumber(ce, [1, 2], metadata);
  }

  metadata = { ...metadata };
  if (ce.jsonSerializationOptions.metadata.includes('latex')) {
    metadata.latex = metadata.latex ?? ce.serialize({ sym });

    if (metadata.latex !== undefined)
      metadata.latex = _escapeJsonString(metadata.latex);
  } else metadata.latex = undefined;

  if (ce.jsonSerializationOptions.metadata.includes('wikidata')) {
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
    ce.jsonSerializationOptions.shorthands.includes('symbol')
  )
    return sym;

  if (metadata.latex !== undefined && metadata.wikidata !== undefined)
    return { sym, latex: metadata.latex, wikidata: metadata.wikidata };
  if (metadata.latex !== undefined) return { sym, latex: metadata.latex };
  if (metadata.wikidata !== undefined)
    return { sym, wikidata: metadata.wikidata };
  return { sym };
}

export function serializeJsonNumber(
  ce: IComputeEngine,
  value: number | Decimal | Complex | Rational,
  metadata?: Metadata
): Expression {
  metadata = { ...metadata };

  if (!ce.jsonSerializationOptions.metadata.includes('latex'))
    metadata.latex = undefined;

  const shorthandAllowed =
    metadata.latex === undefined &&
    metadata.wikidata === undefined &&
    !ce.jsonSerializationOptions.metadata.includes('latex') &&
    ce.jsonSerializationOptions.shorthands.includes('number');

  const exclusions = ce.jsonSerializationOptions.exclude;

  //
  // Bignum
  //
  let num = '';
  if (value instanceof Decimal) {
    if (value.isNaN()) num = 'NaN';
    else if (!value.isFinite())
      num = value.isPositive() ? '+Infinity' : '-Infinity';
    else {
      // Use the number shorthand if the number can be represented as a machine number
      if (shorthandAllowed && isInMachineRange(value)) return value.toNumber();

      // Use the scientific notation only if the resulting integer is not
      // too big...
      if (value.isInteger() && value.e < value.precision() + 4)
        num = value.toFixed(0);
      else {
        const precision = ce.jsonSerializationOptions.precision;
        const s =
          precision === 'max'
            ? value.toString()
            : value.toPrecision(
                precision === 'auto' ? ce.precision : precision
              );

        num = repeatingDecimals(ce, s);

        if (shorthandAllowed) {
          // Can we shorthand to a JSON number after accounting for serialization precision?
          const val = value.toNumber();
          if (val.toString() === num) return val;
        }
      }
    }

    if (ce.jsonSerializationOptions.metadata.includes('latex'))
      metadata.latex = metadata.latex ?? ce.serialize({ num });

    return metadata.latex !== undefined
      ? { num, latex: metadata.latex }
      : shorthandAllowed
      ? num
      : { num };
  }

  //
  // Complex
  //
  if (value instanceof Complex) {
    if (value.isInfinite())
      return serializeJsonSymbol(ce, 'ComplexInfinity', metadata);
    if (value.isNaN()) {
      num = 'NaN';
      if (ce.jsonSerializationOptions.metadata.includes('latex'))
        metadata.latex = metadata.latex ?? ce.serialize({ num });

      return metadata.latex !== undefined
        ? { num, latex: metadata.latex }
        : { num };
    }

    return serializeJsonFunction(
      ce,
      'Complex',
      [ce.number(value.re), ce.number(value.im)],
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
      ce.jsonSerializationOptions.shorthands.includes('function') &&
      isMachineRational(value)
    ) {
      if (value[0] === 1 && value[1] === 2 && !exclusions.includes('Half'))
        return serializeJsonSymbol(ce, 'Half', metadata);
      return [allowRational ? 'Rational' : 'Divide', value[0], value[1]];
    }
    return serializeJsonFunction(
      ce,
      allowRational ? 'Rational' : 'Divide',
      [ce.number(value[0]), ce.number(value[1])],
      { ...metadata }
    );
  }
  //
  // Machine number
  //
  if (Number.isNaN(value)) num = 'NaN';
  else if (!Number.isFinite(value)) num = value > 0 ? '+Infinity' : '-Infinity';
  else {
    if (shorthandAllowed) return value;
    num = repeatingDecimals(ce, value.toString());
  }
  if (ce.jsonSerializationOptions.metadata.includes('latex'))
    metadata.latex = metadata.latex ?? ce.serialize({ num });

  return metadata.latex !== undefined
    ? { num, latex: metadata.latex }
    : { num };
}

function _escapeJsonString(s: undefined): undefined;
function _escapeJsonString(s: string): string;
function _escapeJsonString(s: string | undefined): string | undefined {
  return s;
}

function repeatingDecimals(ce: IComputeEngine, s: string): string {
  if (!ce.jsonSerializationOptions.repeatingDecimals) return s;

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
