function fromRoman(roman: string): [result: number, rest: string] {
  if (roman === 'N') return [0, ''];

  const romanMap = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };

  let total = 0;
  let prevValue = 0;

  roman = roman.toUpperCase();

  for (let i = roman.length - 1; i >= 0; i--) {
    const currentValue = romanMap[roman[i]];
    if (currentValue === undefined) return [total, roman.slice(i)];

    if (currentValue < prevValue) total -= currentValue;
    else total += currentValue;

    prevValue = currentValue;
  }

  return [total, ''];
}

export function fromDigits(
  s: string,
  baseInput?: string | number
): [result: number, rest: string] {
  s = s.trim();
  if (s.length === 0) return [NaN, ''];
  if (s.startsWith('+')) return fromDigits(s.slice(1), baseInput);
  if (s.startsWith('-')) {
    const [v, r] = fromDigits(s.slice(1), baseInput);
    return [-v, r];
  }
  let base = 10;
  if (typeof baseInput === 'string') baseInput = baseInput.toLowerCase();
  if (s.startsWith('0x')) {
    base = 16;
    s = s.slice(2);
  } else if (s.startsWith('0b')) {
    base = 2;
    s = s.slice(2);
  } else if (baseInput === 'roman') {
    return fromRoman(s);
  } else if (baseInput === 'base64' || baseInput === 'base-64') {
    try {
      return [parseInt(btoa(s)), ''];
    } catch (e) {
      return [NaN, ''];
    }
  } else if (typeof baseInput === 'number') {
    base = baseInput;
  } else if (typeof baseInput === 'string') {
    base = parseInt(baseInput);
  }

  let value = 0;
  for (let i = 0; i < s.length; i++) {
    const k = {
      ' ': -1,
      '\u00a0': -1, // NBS
      '\u2000': -1, // EN QUAD
      '\u2001': -1, // EM QUAD
      '\u2002': -1, // EN SPACE
      '\u2003': -1, // EM SPACE
      '\u2004': -1, // THREE-PER-EM SPACE
      '\u2005': -1, // FOUR-PER-EM SPACE
      '\u2006': -1, // SIX-PER-EM SPACE
      '\u2007': -1, // FIGURE SPACE
      '\u2008': -1, // PUNCTUATION SPACE
      '\u2009': -1, // THIN SPACE
      '\u200a': -1, // HAIR SPACE
      '\u200b': -1, // ZWS
      '\u202f': -1, // NARROW NBS
      '\u205f': -1, // MEDIUM MATHEMATICAL SPACE
      '_': -1,
      ',': -1,
      '0': 0,
      '1': 1,
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
      'a': 10,
      'b': 11,
      'c': 12,
      'd': 13,
      'e': 14,
      'f': 15,
      'g': 16,
      'h': 17,
      'i': 18,
      'j': 19,
      'k': 20,
      'l': 21,
      'm': 22,
      'n': 23,
      'o': 24,
      'p': 25,
      'q': 26,
      'r': 27,
      's': 28,
      't': 29,
      'u': 30,
      'v': 31,
      'w': 32,
      'x': 33,
      'y': 34,
      'z': 35,
    }[s[i]];
    if (k !== -1) {
      if (k === undefined) return [value, s.substring(i)];
      if (k >= base) return [value, s.substring(i)];
      value = value * base + k;
    }
  }

  return [value, ''];
}

export function numberToString(num: number | bigint): string {
  // Use scientific notation if the exponent is too large or too small
  // Convert the number to a string
  const numStr = num.toString();

  // Check if the number is in scientific notation
  if (
    typeof num === 'number' &&
    Number.isInteger(num) &&
    numStr.includes('e')
  ) {
    // Convert the number to a fixed notation string with no decimal places
    // (note that Number.toFixed() will use scientific notations for large numbers)
    const fixedStr = BigInt(num).toString();

    // Check the number of trailing zeros
    const trailingZeros = fixedStr.match(/0+$/);
    const trailingZerosCount = trailingZeros ? trailingZeros[0].length : 0;

    // If there are 5 or fewer trailing zeros, return the fixed notation string
    if (trailingZerosCount <= 5) return fixedStr;
  } else if (typeof num === 'bigint') {
    const trailingZeros = numStr.match(/0+$/);
    const trailingZerosCount = trailingZeros ? trailingZeros[0].length : 0;
    // Add an 'e' exponent
    if (trailingZerosCount > 5)
      return `${numStr.slice(0, -trailingZerosCount)}e+${trailingZerosCount}`;
  }

  // If the number is not in scientific notation or doesn't meet the criteria, return the original string
  return numStr;
}
