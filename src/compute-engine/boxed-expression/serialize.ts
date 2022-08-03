import { Complex } from 'complex.js';
import Decimal from 'decimal.js';

import { Expression } from '../../math-json/math-json-format';

import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { isInMachineRange } from '../numerics/numeric-decimal';

import { Product } from '../symbolic/product';

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
    const t0 = args[0].asSmallInteger;
    if (t0 !== null && t0 < 0)
      return serializeJsonFunction(
        ce,
        'Subtract',
        [args[1], ce.number(-t0)],
        metadata
      );

    if (args[0].head === 'Negate') {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [args[1], args[0].op1],
        metadata
      );
    }
  }

  if (
    head === 'Divide' &&
    ce.jsonSerializationOptions.exclude.includes('Divide')
  ) {
    return serializeJsonFunction(
      ce,
      'Multiply',
      [args[0], ce._fn('Power', [args[1], ce._NEGATIVE_ONE])],
      metadata
    );
  }

  if (
    head === 'Multiply' &&
    !ce.jsonSerializationOptions.exclude.includes('Divide')
  ) {
    // Display a product with negative exponents as a division if
    // there are terms with a negative degree
    const result = new Product(ce, args).asRationalExpression();
    if (result.head === 'Divide')
      return serializeJsonFunction(ce, result.head, result.ops!, metadata);
  }

  if (head === 'Power') {
    if (!exclusions.includes('Exp')) {
      if (args[0]?.symbol === 'ExponentialE')
        return serializeJsonFunction(ce, 'Exp', [args[1]], metadata);
    }

    if (args[1]?.isLiteral) {
      const exp = args[1].asSmallInteger;
      if (!exclusions.includes('Square') && exp === 2)
        return serializeJsonFunction(ce, 'Square', [args[0]], metadata);

      if (!ce.jsonSerializationOptions.exclude.includes('Divide')) {
        if (exp === -1)
          return serializeJsonFunction(
            ce,
            'Divide',
            [ce._ONE, args[0]],
            metadata
          );

        if (exp !== null && exp < 0) {
          return serializeJsonFunction(
            ce,
            'Divide',
            [ce._ONE, ce.power(args[0], -exp)],
            metadata
          );
        }
      }
      const [n, d] = args[1].rationalValue;
      if (n === 1) {
        if (!exclusions.includes('Sqrt') && d === 2)
          return serializeJsonFunction(ce, 'Sqrt', [args[0]], metadata);
        if (!exclusions.includes('Root'))
          return serializeJsonFunction(
            ce,
            'Root',
            [args[0], ce.number(d!)],
            metadata
          );
      }
      if (n === -1) {
        if (!exclusions.includes('Sqrt') && d === 2)
          return serializeJsonFunction(
            ce,
            'Divide',
            [ce._ONE, ce._fn('Sqrt', [args[0]])],
            metadata
          );
        if (!exclusions.includes('Root'))
          return serializeJsonFunction(
            ce,
            'Divide',
            [ce._ONE, ce._fn('Root', [args[0], ce.number(d!)])],
            metadata
          );
      }
    }
  }

  return serializeJsonFunction(ce, head, args, metadata);
}

export function serializeJsonFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  args: BoxedExpression[],
  metadata?: Metadata
): Expression {
  // Special case some functions...

  const exclusions = ce.jsonSerializationOptions.exclude;

  if (
    (head === 'Rational' || head === 'Divide') &&
    args[0]?.isLiteral &&
    args[1]?.isLiteral &&
    args[0]?.asSmallInteger === 1 &&
    args[1]?.asSmallInteger === 2 &&
    !exclusions.includes('Half')
  ) {
    return serializeJsonSymbol(ce, 'Half', {
      ...metadata,
      wikidata: 'Q39373172',
    });
  }

  if (head === 'Negate' && args[0]?.isLiteral) {
    if (args[0].machineValue !== null)
      return serializeJsonNumber(ce, -args[0].machineValue);
    if (args[0].decimalValue !== null)
      return serializeJsonNumber(ce, args[0].decimalValue.neg());
    if (args[0].complexValue !== null)
      return serializeJsonNumber(ce, args[0].complexValue.neg());
    const [n, d] = args[0].rationalValue;
    if (n !== null && d !== null) return serializeJsonNumber(ce, [-n, d]);
  }

  if (head === 'Rational' && exclusions.includes(head)) {
    if (args.length > 1)
      return serializeJsonFunction(ce, 'Divide', args, metadata);
  }

  if (head === 'Complex' && exclusions.includes(head)) {
    return serializeJsonFunction(
      ce,
      'Add',
      [
        args[0] ?? 'Missing',
        ce._fn('Multiply', [args[1], ce.symbol('ImaginaryUnit')]),
      ],
      metadata
    );
  }

  if (head === 'Sqrt' && exclusions.includes(head)) {
    return serializeJsonFunction(
      ce,
      'Power',
      [
        args[0] ?? 'Missing',
        exclusions.includes('Half') ? ce.number([1, 2]) : ce._HALF,
      ],
      metadata
    );
  }

  if (head === 'Root' && exclusions.includes(head) && args[1]?.isLiteral) {
    const n = args[1].asSmallInteger;
    if (n === 2) return serializeJsonFunction(ce, 'Sqrt', [args[0]]);

    if (n !== null) {
      if (n < 0)
        return serializeJsonFunction(
          ce,
          'Divide',
          [
            ce._ONE,
            ce._fn('Power', [args[0] ?? 'Missing', ce.number([1, -n])]),
          ],
          metadata
        );

      return serializeJsonFunction(
        ce,
        'Power',
        [args[0] ?? 'Missing', ce.number([1, -n])],
        metadata
      );
    }
  }

  if (head === 'Square' && exclusions.includes(head)) {
    return serializeJsonFunction(
      ce,
      'Power',
      [args[0] ?? 'Missing', ce._TWO],
      metadata
    );
  }

  if (head === 'Exp' && exclusions.includes(head)) {
    return serializeJsonFunction(
      ce,
      'Power',
      [ce.symbol('ExponentialE'), args[0] ?? 'Missing'],
      metadata
    );
  }

  // Note: even though 'Subtract' is boxed out, we still need to handle it here
  // because the function may be called with a 'Subtract' head.
  if (head === 'Subtract' && exclusions.includes(head)) {
    return serializeJsonFunction(
      ce,
      'Add',
      [args[0] ?? 'Missing', ce._fn('Negate', [args[1] ?? 'Missing'])],
      metadata
    );
  }

  if (head === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    if (args[1]?.isLiteral) {
      const t1 = args[1].asSmallInteger;
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
        [args[0] ?? 'Missing', args[1]?.op1 ?? 'Missing'],
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

  const fn: Expression = [jsonHead, ...args.map((x) => x.json)];

  const md: Metadata = { ...(metadata ?? {}) };

  // Determine if we need some LaTeX metadata
  if (ce.jsonSerializationOptions.metadata.includes('latex')) {
    md.latex = _escapeJsonString(md.latex ?? ce.serialize({ fn }));
  } else md.latex = '';

  // Determine if we have some wikidata metadata
  if (ce.jsonSerializationOptions.metadata.includes('wikidata')) {
    if (!metadata?.wikidata && typeof head === 'string')
      md.wikidata = _escapeJsonString(
        ce.getFunctionDefinition(head)?.wikidata ?? ''
      );
  } else md.wikidata = '';

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
      const wikidata = ce.getSymbolDefinition(sym)?.wikidata;
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
  value: number | Decimal | Complex | [number, number],
  metadata?: Metadata
): Expression {
  metadata = { ...metadata };

  if (!ce.jsonSerializationOptions.metadata.includes('latex'))
    metadata.latex = undefined;

  const shorthandAllowed =
    metadata.latex === undefined &&
    !ce.jsonSerializationOptions.metadata.includes('latex') &&
    ce.jsonSerializationOptions.shorthands.includes('number');

  //
  // Decimal
  //
  let num = '';
  if (value instanceof Decimal) {
    if (value.isNaN()) num = 'NaN';
    else if (!value.isFinite()) {
      if (value.isPositive()) num = '+Infinity';
      else num = '-Infinity';
    }

    // Use the number shorthand if:
    // - it is allowed
    // - there is no metadata to include
    // - the number can be represented as a machine number
    if (!num) {
      if (shorthandAllowed && isInMachineRange(value) && value.precision() < 15)
        return value.toNumber();

      // Use the scientific notation only if the resulting integer is not
      // too big...
      num =
        value.isInteger() && value.e < value.precision() + 4
          ? value.toFixed(0)
          : repeatingDecimal(ce, value.toJSON());
    }

    if (ce.jsonSerializationOptions.metadata.includes('latex'))
      metadata.latex = metadata.latex ?? ce.serialize({ num });

    return metadata.latex !== undefined
      ? { num, latex: metadata.latex }
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
  if (Array.isArray(value)) {
    if (
      metadata.latex === undefined &&
      metadata.wikidata === undefined &&
      !ce.jsonSerializationOptions.metadata.includes('latex') &&
      ce.jsonSerializationOptions.shorthands.includes('function') &&
      ce.jsonSerializationOptions.shorthands.includes('number')
    ) {
      //  Shorthand allowed, and no metadata to include
      return ['Rational', value[0], value[1]];
    }
    return serializeJsonFunction(
      ce,
      'Rational',
      [ce.number(value[0]), ce.number(value[1])],
      metadata
    );
  }
  //
  // Machine number
  //
  if (Number.isNaN(value)) num = 'NaN';
  if (!Number.isFinite(value) && value > 0) num = '+Infinity';
  if (!Number.isFinite(value) && value < 0) num = '-Infinity';

  if (!num) {
    if (shorthandAllowed) return value;
    num = repeatingDecimal(ce, value.toString());
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

function repeatingDecimal(ce: IComputeEngine, s: string): string {
  if (!ce.jsonSerializationOptions.repeatingDecimal) return s;

  // eslint-disable-next-line prefer-const
  let [_, wholepart, fractionalPart, exponent] =
    s.match(/^(.*)\.([0-9]+)([e|E][-+]?[0-9]+)?$/) ?? [];
  if (!fractionalPart) return s;

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
      if (times > 1) {
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
  }

  return s;
}
