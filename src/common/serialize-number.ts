import { Expression } from '../math-json/math-json-format';
import { isNumberObject } from './utils';
import { NumberFormattingOptions } from '../math-json/public';

// Some vocabulary:
// 123.456e78
// - 123.456 = significand
// - 123 = wholePart
// - 456 = fractionalPart
// - 79 = exponent
//
// Avoid using mantissa which has several definitions and is ambiguous.

/**
 * Return a formatted fractional part by detecting repeating patterns.
 * 1234567 -> 123 456 7...
 * 1233333 -> 12(3)
 */
function formatFractionalPart(
  m: string,
  options: Required<NumberFormattingOptions>
): string {
  const originalLength = m.length;
  const originalM = m;

  // The last digit may have been rounded off, if it exceeds the precision,
  // which could throw off the repeating pattern detection. Ignore it.
  m = m.slice(0, -1);

  for (let i = 0; i < m.length - 16; i++) {
    // Offset is the part of the fractional part that is not repeating
    const offset = m.substr(0, i);
    // Try to find a repeating pattern of length j
    for (let j = 0; j < 17; j++) {
      const cycle = m.substr(i, j + 1);
      const times = Math.floor((m.length - offset.length) / cycle.length);
      if (times > 1) {
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
            // cycle.replace(/(\d{3})/g, '$1' + options.groupSeparator) +
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
  if (extraDigits) {
    m = m.substr(0, options.precision - 1);
  }
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
 * @return A textural representation of the number, formatted according to the
 * `options`
 */
export function serializeNumber(
  expr: Expression | null,
  options: Required<NumberFormattingOptions>
): string {
  let num: string | number;
  if (typeof expr === 'number') {
    num = expr;
  } else if (isNumberObject(expr)) {
    num = expr.num;
  } else {
    return '';
  }

  if (num === Infinity || num === 'Infinity' || num === '+Infinity') {
    return options.positiveInfinity;
  } else if (num === -Infinity || num === '-Infinity') {
    return options.negativeInfinity;
  } else if (num === 'NaN' || (typeof num === 'number' && Number.isNaN(num))) {
    return options.notANumber;
  }

  if (typeof num === 'number') {
    if (options.notation === 'engineering') {
      return serializeEngineeringNotationNumber(num, options);
    }
    return serializeAutoNotationNumber(num.toString(), options);
  }

  // If we end with a letter ('n' or 'd' for bigint or decimal)
  // remove it.
  if (/[a-zA-Z]$/.test(num)) num = num.slice(0, -1);

  let sign = '';
  if (num[0] === '-') {
    sign = '-';
    num = num.substr(1);
  } else if (num[0] === '+') {
    num = num.substr(1);
  }

  // Remove any leading zeros
  while (num[0] === '0') {
    num = num.substr(1);
  }
  if (num.length === 0) return sign + '0';
  if (num[0] === '.') num = '0' + num;

  let exponent = '';
  if (num.indexOf('.') >= 0) {
    const m = num.match(/(\d*)\.(\d*)([e|E]([-+]?[0-9]*))?/);
    if (!m) return '';
    const base = m[1];
    const fractionalPart = m[2];
    exponent = m[4] ?? '';

    if (base === '0') {
      let p = 0; // Index of the first non-zero digit after the decimal
      while (fractionalPart[p] === '0' && p < fractionalPart.length) {
        p += 1;
      }
      let r = '';
      if (p <= 4) {
        r = '0' + options.decimalMarker;
        r += fractionalPart.substr(0, p);
        r += formatFractionalPart(num.substr(r.length), options);
      } else if (p + 1 >= options.precision) {
        r = '0';
        sign = '';
      } else {
        r = num[p];
        const f = formatFractionalPart(num.substr(p + 1), options);
        if (f) {
          r += options.decimalMarker + f;
        }
      }
      if (r !== '0') {
        if (
          num.length - 1 > options.precision &&
          !(
            options.endRepeatingDigits && r.endsWith(options.endRepeatingDigits)
          ) &&
          options.truncationMarker &&
          !r.endsWith(options.truncationMarker)
        ) {
          r += options.truncationMarker;
        }
        if (p > 4) {
          r +=
            options.exponentProduct +
            formatExponent((1 - p).toString(), options);
        }
      }
      num = r;
    } else {
      num = base.replace(/\B(?=(\d{3})+(?!\d))/g, options.groupSeparator);
      const f = formatFractionalPart(fractionalPart, options);
      if (f) {
        num += options.decimalMarker + f;
        // if (num.length - 1 > config.precision && !num.endsWith('}') && !num.endsWith('\\ldots')) {
        //     num += '\\ldots';
        // }
      }
    }
  } else if (num.length > options.precision) {
    const len = num.length;
    let r = num[0];
    const f = formatFractionalPart(num.substr(1), options);
    if (f) {
      r += options.decimalMarker + f;
      if (options.truncationMarker && !r.endsWith(options.truncationMarker)) {
        if (
          options.endRepeatingDigits &&
          !r.endsWith(options.endRepeatingDigits)
        ) {
          r += options.truncationMarker;
        }
      }
    }
    if (r !== '1') {
      r += options.exponentProduct;
    } else {
      r = '';
    }
    num = r + formatExponent((len - 1).toString(), options);
  } else {
    const m = num.match(/([0-9]*)\.?([0-9]*)([e|E]([-+]?[0-9]+))?/);
    if (m) {
      num = m[1];
      if (m[2]) num += options.decimalMarker + m[2];
      exponent = m[4] ?? '';
    }

    num = num.replace(/\B(?=(\d{3})+(?!\d))/g, options.groupSeparator);
  }
  const exponentString = formatExponent(exponent, options);

  if (num === '1' && exponentString) return sign + exponentString;

  return (
    sign +
    num +
    (exponentString ? options.exponentProduct + exponentString : '')
  );
}

export function serializeEngineeringNotationNumber(
  value: number,
  options: Required<NumberFormattingOptions>
): string {
  if (value === 0) return '0';

  // Ensure the exponent is a multiple of 3
  const y = Math.abs(value);
  let exponent: number = Math.round(Math.log10(y));
  exponent = exponent - (exponent % 3);
  if (y < 1000) exponent = 0;
  const significand = y / Math.pow(10, exponent);
  let significandString = '';
  const m = significand.toString().match(/^(.*)\.(.*)$/);
  if (m?.[1] && m[2]) {
    significandString = m[1] + options.decimalMarker + m[2];
  }
  if (options.groupSeparator) {
    significandString = formatFractionalPart(
      significand.toExponential(),
      options
    );
  }
  let exponentString = '';
  if (exponent !== 0) {
    exponentString = formatExponent(exponent.toString(), options);
  }
  return (value < 0 ? '-' : '') + significandString + exponentString;
}

export function serializeAutoNotationNumber(
  valString: string,
  options: Required<NumberFormattingOptions>
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
