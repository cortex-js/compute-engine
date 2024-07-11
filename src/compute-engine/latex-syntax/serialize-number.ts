import { Expression } from '../../math-json/math-json-format';
import { NumberFormat, NumberSerializationFormat } from './public';

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
 *
 * digitsCount is the number of digits in the whole part and fractional part
 *
 */
function formatFractionalPart(
  digits: string,
  wholeDigitsCount: number,
  options: NumberSerializationFormat
): string {
  if (options.repeatingDecimal && options.repeatingDecimal !== 'none') {
    // The last digit may have been rounded off, if it exceeds the precision,
    // which could throw off the repeating pattern detection. Ignore it.
    const truncatedDigits = digits.slice(0, -1);
    for (let i = 0; i < digits.length - 16; i++) {
      // Offset is the part of the fractional part that is not repeating
      const offset = truncatedDigits.substring(0, i);
      // Try to find a repeating pattern of length j
      for (let j = 0; j < 17; j++) {
        const cycle = truncatedDigits.substring(i, i + j + 1);
        const times = Math.floor(
          (truncatedDigits.length - offset.length) / cycle.length
        );
        if (times <= 3) break;
        if ((offset + cycle.repeat(times + 1)).startsWith(truncatedDigits)) {
          // We've found a repeating pattern!
          if (cycle === '0') {
            // Psych! That pattern is '0'...
            return insertFractionalGroupSeparator(offset, options);
          }
          // There is what looks like a true repeating pattern...
          let pattern =
            {
              vinculum: '\\overline{#}',
              parentheses: '(#)',
              dots: '\\overset{\\cdots}{#1}#2\\overset{\\cdots}{#3}',
              arc: '\\wideparen{#}',
            }[options.repeatingDecimal] ?? '\\overline{#}';
          pattern = pattern
            .replace(/#1/g, cycle[0])
            .replace(/#2/g, cycle.slice(1))
            .replace(/#3/g, cycle.slice(-1))
            .replace(/#/, cycle);
          return insertFractionalGroupSeparator(offset, options) + pattern;
        }
      }
    }
  }

  //
  // There was no repeating pattern we could find...
  //

  // Are we displaying fewer digits than were provided?
  // Display a truncation marker.
  let maxFractionalDigits =
    typeof options.fractionalDigits === 'number'
      ? options.fractionalDigits
      : Infinity;
  if (maxFractionalDigits < 0)
    maxFractionalDigits = maxFractionalDigits - wholeDigitsCount;
  if (maxFractionalDigits < 0) maxFractionalDigits = 0;
  const extraDigits = digits.length > maxFractionalDigits;
  if (extraDigits) digits = digits.substring(0, maxFractionalDigits);

  // Insert group separators if necessary
  digits = insertFractionalGroupSeparator(digits, options);

  if (extraDigits) digits += options.truncationMarker;

  return digits;
}

function formatExponent(exp: string, options: NumberFormat): string {
  if (!exp || exp === '0') return '';
  if (options.beginExponentMarker) {
    return (
      options.beginExponentMarker + exp + (options.endExponentMarker ?? '')
    );
  }
  return `10^{${exp}}`;
}

/**
 * @param expr - A number, can be represented as a string
 *  particularly useful for arbitrary precision numbers) or a number (-12.45)
 * @return A textual representation of the number, formatted according to the
 * `options`
 */
export function serializeNumber(
  expr: Expression | null,
  options: NumberSerializationFormat
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
    num = body + repeat.repeat(6) + trail;
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
  options: NumberSerializationFormat,
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

  const expString = formatExponent(Number(exponent).toString(), options);

  fractionalPart = formatFractionalPart(
    fractionalPart,
    wholePart.length,
    options
  );
  wholePart = insertWholeGroupSeparator(wholePart, options);

  if (fractionalPart)
    fractionalPart = options.decimalSeparator + fractionalPart;

  // @todo: does not respect the options.precision option

  if (!expString) return wholePart + fractionalPart;
  if (!fractionalPart) {
    if (wholePart === '1') return expString;
    if (wholePart === '-1') return '-' + expString;
  }
  return wholePart + fractionalPart + options.exponentProduct + expString;
}

function serializeAutoNotationNumber(
  valString: string,
  options: NumberSerializationFormat
): string {
  let m = valString.match(/^(.*)[e|E]([-+]?[0-9]+)$/i);
  // if valString === '-1234567.89e-123'
  // m[1] = '-1234567.89'
  // m[2] = -123

  // Is there is an exponent...
  let exp = 0;
  if (m?.[1] && m[2]) {
    exp = parseInt(m[2]);
    valString = m[1];
  }

  let wholePart = m?.[1] ?? valString;

  let fractionalPart = '';
  m = valString.match(/^(.*)\.(.*)$/);
  if (m?.[1] && m[2]) {
    wholePart = m[1];
    fractionalPart = m[2];
  }

  // If we have some fractional digits *and* an exponent, we need to
  // adjust the whole part to include the fractional part.
  // 1.23e4 -> 123e2
  if (exp !== 0 && fractionalPart) {
    wholePart += fractionalPart;
    exp -= fractionalPart.length;
    fractionalPart = '';
  }

  // Check if the exponent is in a range to be avoided
  const avoid = options.avoidExponentsInRange;
  if (exp !== 0 && avoid) {
    if (exp >= avoid[0] && exp <= avoid[1]) {
      [wholePart, fractionalPart] = toDecimalNumber(
        wholePart,
        fractionalPart,
        exp
      );
    }
  }

  const exponent = formatExponent(exp.toString(), options);

  if (fractionalPart)
    fractionalPart =
      options.decimalSeparator +
      formatFractionalPart(fractionalPart, wholePart.length, options);

  wholePart = insertWholeGroupSeparator(wholePart, options);

  if (!exponent) return wholePart + fractionalPart;
  if (!fractionalPart) {
    if (wholePart === '1') return exponent;
    if (wholePart === '-1') return '-' + exponent;
  }
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

function insertSeparatorEveryNDigitsFromLeft(
  numberString: string,
  n: number,
  separator: string
): string {
  const regex = new RegExp(`(\\d{${n}})(?=\\d)`, 'g');
  return numberString.replace(regex, `$1${separator}`);
}

function insertSeparatorEveryNDigitsFromRight(
  numberString: string,
  n: number,
  separator: string
): string {
  const regex = new RegExp(`(\\d{${n}})(?=\\d)`, 'g');
  const reversedSeparator = separator.split('').reverse().join('');
  return numberString
    .split('')
    .reverse()
    .join('')
    .replace(regex, `$1${reversedSeparator}`)
    .split('')
    .reverse()
    .join('');
}

function insertIndianNumberingSystem(numberString: string, separator: string) {
  const reverseString = numberString.split('').reverse().join('');
  const reversedSeparator = separator.split('').reverse().join('');
  let formattedString = reverseString.replace(
    /(\d{3})(?=\d)/,
    `$1${reversedSeparator}`
  );
  formattedString = formattedString.replace(
    /(\d{2})(?=(\d{2})+,)/g,
    `$1${reversedSeparator}`
  );
  return formattedString.split('').reverse().join('');
}

function insertGroupSeparator(
  numberString: string,
  options: NumberSerializationFormat,
  part: 0 | 1
): string {
  let group = options.digitGroup;
  if (typeof group !== 'string' && Array.isArray(group)) group = group[part];

  const separator =
    typeof options.digitGroupSeparator === 'string'
      ? options.digitGroupSeparator
      : options.digitGroupSeparator[part];
  if (!separator) return numberString;

  if (group === 'lakh') {
    if (part === 0) return insertIndianNumberingSystem(numberString, separator);
    return insertSeparatorEveryNDigitsFromLeft(numberString, 3, separator);
  }

  if ((group as any as boolean) === false || group <= 0) return numberString;
  if (part === 1)
    return insertSeparatorEveryNDigitsFromLeft(numberString, group, separator);
  return insertSeparatorEveryNDigitsFromRight(numberString, group, separator);
}

function insertFractionalGroupSeparator(
  numberString: string,
  options: NumberSerializationFormat
): string {
  return insertGroupSeparator(numberString, options, 1);
}

function insertWholeGroupSeparator(
  numberString: string,
  options: NumberSerializationFormat
): string {
  return insertGroupSeparator(numberString, options, 0);
}

interface Result {
  newWholePart: string;
  newFractionalPart: string;
}

// Given a whole part, fractional part and exponent, return a new whole part
// and fractional part that represents the number in decimal form
// For example, toDecimalNumber(123, 456, 2) -> 12345.6
function toDecimalNumber(
  wholePart: string,
  fractionalPart: string,
  exp: number
): [string, string] {
  // Combine the whole part and fractional part into a single string
  let combinedNumber = wholePart + fractionalPart;

  // Find the length of the whole part
  const wholeLength = wholePart.length;

  // Calculate the new position of the decimal point
  const newDecimalPosition = wholeLength + exp;

  let newWholePart: string;
  let newFractionalPart: string;

  // Handle cases where the new decimal position is within the number, or outside
  if (newDecimalPosition > 0) {
    if (newDecimalPosition >= combinedNumber.length) {
      // If the new decimal position is beyond the number length, pad with zeros
      combinedNumber =
        combinedNumber + '0'.repeat(newDecimalPosition - combinedNumber.length);
      newWholePart = combinedNumber;
      newFractionalPart = '';
    } else {
      // If the new decimal position is within the number length, split at the decimal point
      newWholePart = combinedNumber.slice(0, newDecimalPosition);
      newFractionalPart = combinedNumber.slice(newDecimalPosition);
    }
  } else {
    // If the new decimal position is negative or zero, pad with zeros in front
    newWholePart = '0';
    newFractionalPart = '0'.repeat(-newDecimalPosition) + combinedNumber;
  }

  return [newWholePart, newFractionalPart];
}
