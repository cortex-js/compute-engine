import { Expression } from '../../math-json/math-json-format';
import { NumberFormattingOptions } from './public';

// Some vocabulary:
// 123.456e78
// - 123.456 = significand
// - 123 = wholePart
// - 456 = fractionalPart
// - 78 = exponent
//
// Avoid using mantissa which has several definitions and is ambiguous.

/**
 * Return a formatted fractional part by detecting repeating patterns.
 * 1234567 -> 123 456 7...
 * 1233333 -> 12(3)
 */
function formatFractionalPart(
  m: string,
  options: NumberFormattingOptions
): string {
  const originalLength = m.length;
  const originalM = m;

  if (options.beginRepeatingDigits && options.endRepeatingDigits) {
    // The last digit may have been rounded off, if it exceeds the precision,
    // which could throw off the repeating pattern detection. Ignore it.
    m = m.slice(0, -1);
    for (let i = 0; i < m.length - 16; i++) {
      // Offset is the part of the fractional part that is not repeating
      const offset = m.substring(0, i);
      // Try to find a repeating pattern of length j
      for (let j = 0; j < 17; j++) {
        const cycle = m.substring(i, i + j + 1);
        const times = Math.floor((m.length - offset.length) / cycle.length);
        if (times <= 3) break;
        if ((offset + cycle.repeat(times + 1)).startsWith(m)) {
          // We've found a repeating pattern!
          if (cycle === '0') {
            // Psych! That pattern is '0'...
            return offset.replace(/(\d{3})/g, '$1' + options.groupSeparator);
          }
          // There is what looks like a true repeating pattern...
          return (
            offset.replace(/(\d{3})/g, '$1' + options.groupSeparator) +
            options.beginRepeatingDigits +
            cycle +
            options.endRepeatingDigits
          );
        }
      }
    }
  }
  // There was no repeating pattern we could find...

  // Are we displaying fewer digits than were provided?
  // Display a truncation marker.
  const extraDigits = originalLength > options.precision - 1;
  m = originalM;
  if (extraDigits) m = m.substring(0, options.precision - 1);

  // Insert group separators if necessary
  if (options.groupSeparator) {
    m = m.replace(/(\d{3})/g, '$1' + options.groupSeparator);
    if (m.endsWith(options.groupSeparator)) {
      m = m.slice(0, -options.groupSeparator.length);
    }
  }
  if (extraDigits) return m + options.truncationMarker;
  return m;
}

function formatExponent(exp: string, options: NumberFormattingOptions): string {
  if (!exp) return '';
  if (options.beginExponentMarker) {
    return (
      options.beginExponentMarker + exp + (options.endExponentMarker ?? '')
    );
  }
  return '10^{' + exp + '}';
}

/*
 * @param expr - A number, can be represented as a string
 *  particularly useful for arbitrary precision numbers) or a number (-12.45)
 * @return A textual representation of the number, formatted according to the
 * `options`
 */
export function serializeNumber(
  expr: Expression | null,
  options: NumberFormattingOptions
): string {
  if (expr === null) return '';
  let num: string | number;
  if (typeof expr === 'number' || typeof expr === 'string') {
    num = expr;
  } else if (typeof expr === 'object' && 'num' in expr) {
    num = expr.num;
  } else return '';

  if (typeof num === 'number') {
    if (num === Infinity) return options.positiveInfinity;
    else if (num === -Infinity) return options.negativeInfinity;
    else if (Number.isNaN(num)) return options.notANumber;

    let result: string | undefined = undefined;
    if (options.notation === 'engineering')
      result = serializeScientificNotationNumber(
        num.toExponential(),
        options,
        3
      );
    else if (options.notation === 'scientific')
      result = serializeScientificNotationNumber(num.toExponential(), options);

    return result ?? serializeAutoNotationNumber(num.toString(), options);
  }

  num = num.toLowerCase().replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  if (num === 'infinity' || num === '+infinity')
    return options.positiveInfinity;
  else if (num === '-infinity') return options.negativeInfinity;
  else if (num === 'nan') return options.notANumber;

  if (!/^[-+\.]?[0-9]/.test(num)) return '';

  num = num.replace(/[nd]$/, '');

  // Do we have repeating digits?
  // If so, "unrepeat" (expand) them
  if (/\([0-9]+\)/.test(num)) {
    const [_, body, repeat, trail] = num.match(/(.+)\(([0-9]+)\)(.*)$/) ?? [];
    num =
      body +
      repeat.repeat(Math.ceil(options.precision / repeat.length)) +
      trail;
  }

  let sign = '';
  if (num[0] === '-') {
    sign = '-';
    num = num.substring(1);
  } else if (num[0] === '+') {
    num = num.substring(1);
  }

  // Remove any leading zeros
  while (num[0] === '0') num = num.substring(1);

  if (num.length === 0) num = '0';
  else if (num[0] === '.') num = '0' + num;

  let result: string | undefined = undefined;
  if (options.notation === 'engineering')
    result = serializeScientificNotationNumber(num, options, 3);
  else if (options.notation === 'scientific')
    result = serializeScientificNotationNumber(num, options);

  return sign + (result ?? serializeAutoNotationNumber(num, options));
}

/**
 * Scientific notation has:
 * - a whole part [1..9]
 * - an optional fractional part (many digits)
 * - an optional exponent
 * @param valString
 * @param options
 * @returns
 */
function serializeScientificNotationNumber(
  valString: string,
  options: NumberFormattingOptions,
  expMultiple = 1
): string | undefined {
  // For '7' returns '7e+0'
  let m = valString.match(/^(.*)[e|E]([-+]?[0-9]+)$/);
  if (!m) {
    // Valstring wasn't in exponential form, convert it.

    // Remove the sign
    let sign = '';
    if (valString[0] === '-') {
      sign = '-';
      valString = valString.substring(1);
    } else if (valString[0] === '+') {
      valString = valString.substring(1);
    }

    if (valString.indexOf('.') < 0) {
      if (valString.length === 1) {
        valString = sign + valString + 'e+0';
      } else {
        // A long integer, convert to exponential form
        valString =
          sign +
          valString[0] +
          '.' +
          valString.slice(1) +
          'e+' +
          (valString.length - 1).toString();
      }
    } else {
      // A decimal number, convert to exponential form
      // eslint-disable-next-line prefer-const
      let [_, whole, fraction] = valString.match(/^(.*)\.(.*)$/)!;
      if (!fraction) fraction = '';
      while (whole.startsWith('0')) whole = whole.substring(1);
      if (!whole) {
        // .123 -> 0.123e+0
        // .0123 -> 0.0123e+0
        valString = sign + '0.' + fraction + 'e+0';
      } else {
        // 1.234  -> 1.234e+0
        // 12.345 -> 1.2345e+1
        valString =
          sign +
          whole[0] +
          '.' +
          whole.slice(1) +
          fraction +
          'e+' +
          (whole.length - 1).toString();
      }
    }
    m = valString.match(/^(.*)[e|E]([-+]?[0-9]+)$/);
  }
  console.assert(m);
  if (!m) return serializeAutoNotationNumber(valString, options);

  let exponent = parseInt(m[2]);
  let mantissa = m[1];

  if (Math.abs(exponent) % expMultiple !== 0) {
    // Need to adjust the exponent and values, e.g. for engineering notation
    const adjust =
      exponent > 0
        ? exponent % expMultiple
        : -((expMultiple + exponent) % expMultiple);
    exponent = exponent >= 0 ? exponent - adjust : exponent + adjust;
    // Don't use numeric operations, which may introduce artifacting
    // eslint-disable-next-line prefer-const
    let [_, whole, fraction] = mantissa.match(/^(.*)\.(.*)$/) ?? [
      '',
      mantissa,
      '',
    ];
    mantissa =
      whole +
      (fraction + '00000000000000000').slice(0, Math.abs(adjust)) +
      '.' +
      fraction.slice(Math.abs(adjust));
  }

  // Is the exponent in a range to be avoided?
  const avoid = options.avoidExponentsInRange;
  if (avoid && exponent >= avoid[0] && exponent <= avoid[1]) return undefined;

  let fractionalPart = '';
  let wholePart = mantissa;
  m = wholePart.match(/^(.*)\.(.*)$/);
  if (m) {
    wholePart = m[1];
    fractionalPart = m[2];
  }

  const expString =
    exponent !== 0 ? formatExponent(Number(exponent).toString(), options) : '';

  if (options.groupSeparator) {
    wholePart = wholePart.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      options.groupSeparator
    );
    fractionalPart = formatFractionalPart(fractionalPart, options);
  }
  if (fractionalPart) fractionalPart = options.decimalMarker + fractionalPart;

  // @todo: does not respect the options.precision option

  if (!expString) return wholePart + fractionalPart;
  if (wholePart === '1' && !fractionalPart) return expString;
  return wholePart + fractionalPart + options.exponentProduct + expString;
}

function serializeAutoNotationNumber(
  valString: string,
  options: NumberFormattingOptions
): string {
  let m = valString.match(/^(.*)[e|E]([-+]?[0-9]+)$/i);
  let exponent: string | undefined = undefined;
  // if valString === '-1234567.89e-123'
  // m[1] = '-1234567.89'
  // m[2] = -123
  if (m?.[1] && m[2]) {
    // There is an exponent...
    exponent = formatExponent(m[2], options);
  }
  let wholePart = m?.[1] ?? valString;
  let fractionalPart = '';
  m = (exponent ? m![1] : valString).match(/^(.*)\.(.*)$/);
  if (m?.[1] && m[2]) {
    wholePart = m[1];
    fractionalPart = m[2];
  }
  if (options.groupSeparator) {
    wholePart = wholePart.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      options.groupSeparator
    );
    fractionalPart = formatFractionalPart(fractionalPart, options);
  }
  if (fractionalPart) fractionalPart = options.decimalMarker + fractionalPart;

  if (!exponent) return wholePart + fractionalPart;
  if (wholePart === '1' && !fractionalPart) return exponent;
  return wholePart + fractionalPart + options.exponentProduct + exponent;
}

/**
 * `value` is a base-10 number, possibly a floating point number with an
 * exponent, i.e. "0.31415e1"
 */
// export function serializeBaseNotation(value: string, base: number): string {
//   const alphabet = '01234567890abcdef'.substr(0, base);
//   const m = value.match(/^([+-]?[0-9_]*)(\.([0-9]*))?n?([e|E]([-+]?[0-9]+))$/);
//   if (!m) return '';
//   const [, wholePart, , fractionalPart, , exponent] = m;
//   let w = parseInt(wholePart);
//   if (w.toString() !== value) return ''; // Out of range
//   const sign = w < 0 ? '-' : '';
//   w = Math.abs(w);

//   let significand = '';
//   while (w > 0) {
//     significand = alphabet[w % base] + significand;
//     w = Math.floor(w / base);
//   }

//   if (fractionalPart) {
//     if (!significand) significand = '0';
//     significand += '.';

//     let f = parseInt(fractionalPart);
//     if (f.toString() !== fractionalPart) return ''; // Out of range
//     while (f > 0) {
//       significand =
//     }
//   }

//   return sign + (exponent ? 'p' + exponent : '');
// }

/**
 * Return a C99 hex-float formated representation of the floating-point `value`.
 *
 * Does not handle integer and non-finite values.
 */
export function serializeHexFloat(value: number): string {
  console.assert(Number.isFinite(value) && !Number.isInteger(value));
  const digits = '0123456789abcdef';

  const sign = value < 0 ? '-' : '';
  value = Math.abs(value);

  let significand = '';
  let exponent = 0;
  let wholePart = Math.trunc(value);
  let fractionalPart = value - wholePart;

  // Reduce the whole part to an odd number.
  // The C99 standard does not specify a normal exponent/wholepart, so
  // multiple representations are acceptable.
  // We choose to normalize by having the largest positive exponent possible
  // if the whole part is not 0, or the largest negative exponent possible
  // if the whole part is 0
  if (wholePart !== 0) {
    while (wholePart % 2 === 0 && wholePart > 0) {
      wholePart /= 2;
      fractionalPart /= 2;
      exponent += 1;
    }
  } else {
    let adjustedFractionalPart = fractionalPart;
    while (adjustedFractionalPart * 2 < 2) {
      adjustedFractionalPart *= 2;
      exponent -= 1;
    }
    wholePart = Math.trunc(adjustedFractionalPart);
    fractionalPart = adjustedFractionalPart - wholePart;
  }

  // Calculate the whole part as hex digits
  while (wholePart !== 0) {
    significand = digits[wholePart % 16] + significand;
    wholePart = Math.trunc(wholePart / 16);
  }

  if (!significand) {
    significand = '0.';
  } else {
    significand += '.';
  }

  // Calculate the fractional part as hex digits
  if (fractionalPart === 0) {
    significand += '0';
  } else {
    while (fractionalPart > 0) {
      const digit = Math.trunc(fractionalPart * 16);
      significand += digits[digit];
      fractionalPart = 16 * fractionalPart - digit;
    }
  }

  return (
    sign +
    '0x' +
    significand +
    'p' +
    (exponent < 0 ? '-' : '') +
    Number(Math.abs(exponent)).toString()
  );
}

/**
 * Given a correctly formatted float hex, return the corresponding number.
 *
 * - "0xc.3p0" -> 12.1875
 * - "0x3.0Cp2" -> 12.1875
 * - "0x1.91eb851eb851fp+1" -> 3.14
 * - "0x3.23d70a3d70a3ep0" -> 3.14
 *
 */
export function deserializeHexFloat(value: string): number {
  value = value.toLowerCase();

  let index = 0;
  let negative = false;
  if (value[index] === '-') {
    negative = true;
    index++;
  } else if (value[index] === '+') {
    index++;
  }
  if (value[index] !== '0' || value[index] !== 'x') return NaN;

  // The sign is supposed to be before the '0x', but we're lenient and support
  // it if it's after '0x' as well.
  if (value[index] === '+') {
    index++;
  } else if (value[index] === '-') {
    negative = true;
    index++;
  }

  const digits = '0123456789abcdef';
  let result = 0;
  // Whole part
  while (digits.includes(value[index])) {
    result *= 16;
    result += digits.indexOf(value[index]);
    index++;
  }
  if (value[index] === '.') {
    index++;
    // Fractional part
    let degree = -1;
    while (index < value.length && value[index] !== 'p') {
      result += digits.indexOf(value[index]) * Math.pow(16, degree);
      degree++;
      index++;
    }

    //Exponent
    index += 1; // Skip 'p'
    let exponent = 0;
    let negativeExponent = false;
    if (value[index] === '+') {
      index++;
    } else if (value[index] === '-') {
      negativeExponent = true;
      index++;
    }
    while (index < value.length) {
      exponent *= 10; // Yes, the exponent is a power of two... in base 10.
      exponent += digits.indexOf(value[index]);
      index++;
    }
    result = result * Math.pow(2, negativeExponent ? -exponent : exponent);
  }

  return negative ? -result : result;
}
