import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { BoxedExpression } from '../public';
import { extrapolate } from './richardson';

export const MACHINE_PRECISION_BITS = 53;
export const MACHINE_PRECISION = Math.log10(
  Math.pow(2, MACHINE_PRECISION_BITS)
); // ≈ 15.95 = number of digits of precision

// Numerical tolerance is in number of digits at the end of the number that
// are ignored for sameness evaluation, 7-bit ≈ 2.10721 digits.
export const MACHINE_TOLERANCE_BITS = 7;
export const MACHINE_TOLERANCE = Math.pow(
  2,
  -(MACHINE_PRECISION_BITS - MACHINE_TOLERANCE_BITS)
);

// Positive values smaller than NUMERIC_TOLERANCE are considered to be zero
export const NUMERIC_TOLERANCE = Math.pow(10, -10);

// When applying simplifications, only considers integers whose absolute value
// is less than SMALL_INTEGER. This avoid loss of precision by preventing
// simplification for `1e199 + 1`.
// Note: SMALL_INTEGER ≈ 10^(MACHINE_PRECISION / 2)
// so that the product of two small integers does not lose precision
export const SMALL_INTEGER = 1000000;

// When doing a calculation via iteration (e.g. to calculate a sum)
// do not iterate more than this value
export const MAX_ITERATION = 1000000;

// When doing a symbolic calculations using multiple terms, do
// not expand beyond these many terms
export const MAX_SYMBOLIC_TERMS = 200;

/**
 * Returns the smallest floating-point number greater than x.
 * Denormalized values may not be supported.
 */

export function nextUp(x: number): number {
  if (x !== x) return x;
  if (x === -1 / 0) return -Number.MAX_VALUE;
  if (x === 1 / 0) return +1 / 0;
  if (x === Number.MAX_VALUE) return +1 / 0;
  let y = x * (x < 0 ? 1 - Number.EPSILON / 2 : 1 + Number.EPSILON);
  if (y === x)
    y =
      Number.MIN_VALUE * Number.EPSILON > 0
        ? x + Number.MIN_VALUE * Number.EPSILON
        : x + Number.MIN_VALUE;
  if (y === +1 / 0) y = +Number.MAX_VALUE;
  const b = x + (y - x) / 2;
  if (x < b && b < y) y = b;
  const c = (y + x) / 2;
  if (x < c && c < y) y = c;
  return y === 0 ? -0 : y;
}

export function nextDown(x: number): number {
  return -nextUp(-x);
}

// prettier-ignore
export const SMALL_PRIMES = new Set<number>([
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
  73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151,
  157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233,
  239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317,
  331, 337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419,
  421, 431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503,
  509, 521, 523, 541, 547, 557, 563, 569, 571, 577, 587, 593, 599, 601, 607,
  613, 617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683, 691, 701,
  709, 719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809, 811,
  821, 823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911,
  919, 929, 937, 941, 947, 953, 967, 971, 977, 983, 991, 997, 1009, 1013, 1019,
  1021, 1031, 1033, 1039, 1049, 1051, 1061, 1063, 1069, 1087, 1091, 1093, 1097,
  1103, 1109, 1117, 1123, 1129, 1151, 1153, 1163, 1171, 1181, 1187, 1193, 1201,
  1213, 1217, 1223, 1229, 1231, 1237, 1249, 1259, 1277, 1279, 1283, 1289, 1291,
  1297, 1301, 1303, 1307, 1319, 1321, 1327, 1361, 1367, 1373, 1381, 1399, 1409,
  1423, 1427, 1429, 1433, 1439, 1447, 1451, 1453, 1459, 1471, 1481, 1483, 1487,
  1489, 1493, 1499, 1511, 1523, 1531, 1543, 1549, 1553, 1559, 1567, 1571, 1579,
  1583, 1597, 1601, 1607, 1609, 1613, 1619, 1621, 1627, 1637, 1657, 1663, 1667,
  1669, 1693, 1697, 1699, 1709, 1721, 1723, 1733, 1741, 1747, 1753, 1759, 1777,
  1783, 1787, 1789, 1801, 1811, 1823, 1831, 1847, 1861, 1867, 1871, 1873, 1877,
  1879, 1889, 1901, 1907, 1913, 1931, 1933, 1949, 1951, 1973, 1979, 1987, 1993,
  1997, 1999, 2003, 2011, 2017, 2027, 2029, 2039, 2053, 2063, 2069, 2081, 2083,
  2087, 2089, 2099, 2111, 2113, 2129, 2131, 2137, 2141, 2143, 2153, 2161, 2179,
  2203, 2207, 2213, 2221, 2237, 2239, 2243, 2251, 2267, 2269, 2273, 2281, 2287,
  2293, 2297, 2309, 2311, 2333, 2339, 2341, 2347, 2351, 2357, 2371, 2377, 2381,
  2383, 2389, 2393, 2399, 2411, 2417, 2423, 2437, 2441, 2447, 2459, 2467, 2473,
  2477, 2503, 2521, 2531, 2539, 2543, 2549, 2551, 2557, 2579, 2591, 2593, 2609,
  2617, 2621, 2633, 2647, 2657, 2659, 2663, 2671, 2677, 2683, 2687, 2689, 2693,
  2699, 2707, 2711, 2713, 2719, 2729, 2731, 2741, 2749, 2753, 2767, 2777, 2789,
  2791, 2797, 2801, 2803, 2819, 2833, 2837, 2843, 2851, 2857, 2861, 2879, 2887,
  2897, 2903, 2909, 2917, 2927, 2939, 2953, 2957, 2963, 2969, 2971, 2999, 3001,
  3011, 3019, 3023, 3037, 3041, 3049, 3061, 3067, 3079, 3083, 3089, 3109, 3119,
  3121, 3137, 3163, 3167, 3169, 3181, 3187, 3191, 3203, 3209, 3217, 3221, 3229,
  3251, 3253, 3257, 3259, 3271, 3299, 3301, 3307, 3313, 3319, 3323, 3329, 3331,
  3343, 3347, 3359, 3361, 3371, 3373, 3389, 3391, 3407, 3413, 3433, 3449, 3457,
  3461, 3463, 3467, 3469, 3491, 3499, 3511, 3517, 3527, 3529, 3533, 3539, 3541,
  3547, 3557, 3559, 3571, 3581, 3583, 3593, 3607, 3613, 3617, 3623, 3631, 3637,
  3643, 3659, 3671, 3673, 3677, 3691, 3697, 3701, 3709, 3719, 3727, 3733, 3739,
  3761, 3767, 3769, 3779, 3793, 3797, 3803, 3821, 3823, 3833, 3847, 3851, 3853,
  3863, 3877, 3881, 3889, 3907, 3911, 3917, 3919, 3923, 3929, 3931, 3943, 3947,
  3967, 3989, 4001, 4003, 4007, 4013, 4019, 4021, 4027, 4049, 4051, 4057, 4073,
  4079, 4091, 4093, 4099, 4111, 4127, 4129, 4133, 4139, 4153, 4157, 4159, 4177,
  4201, 4211, 4217, 4219, 4229, 4231, 4241, 4243, 4253, 4259, 4261, 4271, 4273,
  4283, 4289, 4297, 4327, 4337, 4339, 4349, 4357, 4363, 4373, 4391, 4397, 4409,
  4421, 4423, 4441, 4447, 4451, 4457, 4463, 4481, 4483, 4493, 4507, 4513, 4517,
  4519, 4523, 4547, 4549, 4561, 4567, 4583, 4591, 4597, 4603, 4621, 4637, 4639,
  4643, 4649, 4651, 4657, 4663, 4673, 4679, 4691, 4703, 4721, 4723, 4729, 4733,
  4751, 4759, 4783, 4787, 4789, 4793, 4799, 4801, 4813, 4817, 4831, 4861, 4871,
  4877, 4889, 4903, 4909, 4919, 4931, 4933, 4937, 4943, 4951, 4957, 4967, 4969,
  4973, 4987, 4993, 4999, 5003, 5009, 5011, 5021, 5023, 5039, 5051, 5059, 5077,
  5081, 5087, 5099, 5101, 5107, 5113, 5119, 5147, 5153, 5167, 5171, 5179, 5189,
  5197, 5209, 5227, 5231, 5233, 5237, 5261, 5273, 5279, 5281, 5297, 5303, 5309,
  5323, 5333, 5347, 5351, 5381, 5387, 5393, 5399, 5407, 5413, 5417, 5419, 5431,
  5437, 5441, 5443, 5449, 5471, 5477, 5479, 5483, 5501, 5503, 5507, 5519, 5521,
  5527, 5531, 5557, 5563, 5569, 5573, 5581, 5591, 5623, 5639, 5641, 5647, 5651,
  5653, 5657, 5659, 5669, 5683, 5689, 5693, 5701, 5711, 5717, 5737, 5741, 5743,
  5749, 5779, 5783, 5791, 5801, 5807, 5813, 5821, 5827, 5839, 5843, 5849, 5851,
  5857, 5861, 5867, 5869, 5879, 5881, 5897, 5903, 5923, 5927, 5939, 5953, 5981,
  5987, 6007, 6011, 6029, 6037, 6043, 6047, 6053, 6067, 6073, 6079, 6089, 6091,
  6101, 6113, 6121, 6131, 6133, 6143, 6151, 6163, 6173, 6197, 6199, 6203, 6211,
  6217, 6221, 6229, 6247, 6257, 6263, 6269, 6271, 6277, 6287, 6299, 6301, 6311,
  6317, 6323, 6329, 6337, 6343, 6353, 6359, 6361, 6367, 6373, 6379, 6389, 6397,
  6421, 6427, 6449, 6451, 6469, 6473, 6481, 6491, 6521, 6529, 6547, 6551, 6553,
  6563, 6569, 6571, 6577, 6581, 6599, 6607, 6619, 6637, 6653, 6659, 6661, 6673,
  6679, 6689, 6691, 6701, 6703, 6709, 6719, 6733, 6737, 6761, 6763, 6779, 6781,
  6791, 6793, 6803, 6823, 6827, 6829, 6833, 6841, 6857, 6863, 6869, 6871, 6883,
  6899, 6907, 6911, 6917, 6947, 6949, 6959, 6961, 6967, 6971, 6977, 6983, 6991,
  6997, 7001, 7013, 7019, 7027, 7039, 7043, 7057, 7069, 7079, 7103, 7109, 7121,
  7127, 7129, 7151, 7159, 7177, 7187, 7193, 7207, 7211, 7213, 7219, 7229, 7237,
  7243, 7247, 7253, 7283, 7297, 7307, 7309, 7321, 7331, 7333, 7349, 7351, 7369,
  7393, 7411, 7417, 7433, 7451, 7457, 7459, 7477, 7481, 7487, 7489, 7499, 7507,
  7517, 7523, 7529, 7537, 7541, 7547, 7549, 7559, 7561, 7573, 7577, 7583, 7589,
  7591, 7603, 7607, 7621, 7639, 7643, 7649, 7669, 7673, 7681, 7687, 7691, 7699,
  7703, 7717, 7723, 7727, 7741, 7753, 7757, 7759, 7789, 7793, 7817, 7823, 7829,
  7841, 7853, 7867, 7873, 7877, 7879, 7883, 7901, 7907, 7919,
]);

export const LARGEST_SMALL_PRIME = 7919;

export function primeFactors(n: number): { [factor: number]: number } {
  console.assert(
    Number.isInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER,
    n
  );
  //https:rosettacode.org/wiki/Prime_decomposition#JavaScript
  if (n <= 3) return { [n]: 1 };
  const result = {};
  // Wheel factorization
  let count = 0;
  while (n % 2 === 0) {
    count += 1;
    n /= 2;
  }
  if (count > 0) result[2] = count;
  count = 0;
  while (n % 3 === 0) {
    count += 1;
    n /= 3;
  }
  if (count > 0) result[3] = count;
  // @todo: could add more special cases: 5, 7, 11, 13
  let done = false;
  while (!done) {
    if (n === 1) return result;
    const sr = Math.sqrt(n);
    done = true;
    for (let i = 6; i <= sr + 6; i += 6) {
      if (n % (i - 1) === 0) {
        // is n divisible by i-1?
        result[i - 1] = (result[i - 1] ?? 0) + 1;
        n /= i - 1;
        done = false;
        break;
      }
      if (n % (i + 1) === 0) {
        // is n divisible by i+1?
        result[i + 1] = (result[i + 1] ?? 0) + 1;
        n /= i + 1;
        done = false;
        break;
      }
    }
  }
  if (result[n] !== undefined) result[n] += 1;
  else result[n] = 1;
  return result;
}

/* @todo Consider https://cp-algorithms.com/algebra/factorization.html */

/** Return `[factor, root]` such that
 * pow(n, 1/exponent) = factor * pow(root, 1/exponent)
 *
 * factorPower(75, 2) -> [5, 3] = 5^2 * 3
 *
 */
export function factorPower(
  n: number,
  exponent: number
): [factor: number, root: number] {
  if (n >= Number.MAX_SAFE_INTEGER) return [1, n];
  // @todo: handle negative n
  console.assert(Number.isInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER);
  const factors = primeFactors(n);
  let f = 1;
  let r = 1;
  for (const k of Object.keys(factors)) {
    const v = parseInt(k);
    f = f * Math.pow(v, Math.floor(factors[k] / exponent));
    r = r * Math.pow(v, factors[k] % exponent);
  }
  return [f, r];
}

export function gcd(a: number, b: number): number {
  if (a === 0) return b;
  if (b === 0) return a;
  if (a === b) return a;
  //https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  if (!Number.isInteger(a) || !Number.isInteger(b)) return NaN;
  while (b !== 0) [a, b] = [b, a % b];
  return a < 0 ? -a : a;
}
/* 
  Consider implementing a Binary GCD algorithm.
  Performance is not necessarily better, so benchmark before adopting.

var gcd = function (a, b) {
    if (a === 0) return b;
    if (b === 0) return a;
    if (a === b) return a;
    // remove even divisors
    var sa = 0;
    while (!(a & 1)) sa++, a >>= 1;
    var sb = 0;
    while (!(b & 1)) sb++, b >>= 1;
    var p = sa < sb ? sa : sb; // Power part of 2^p Common Divisor
    // euclidean algorithm: limited only odd numbers
    while (a !== b) {// both a and b should be odd
        if (b > a) [a,  b] = [b, a]
        a -= b; // a is even because of odd - odd
        do a >>= 1; while (!(a & 1)); // a become odd
    }
    return a << p; // Odd-Common-Divisor * 2^p
};
*/

export function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  let val = 1;
  for (let i = 2; i <= n; i++) val = val * i;
  return val;
}

export function factorial2(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n < 0) return NaN;
  if (n <= 1) return 1;

  let result = n;
  while (n > 2) {
    n -= 2;
    result *= n;
  }

  return result;
}

const gammaG = 7;
const lanczos_7_c = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

// const gammaGLn = 607 / 128;
// const gammaPLn = [
//   0.999999999999997, 57.156235665862923, -59.59796035547549, 14.13609797474174,
//   -0.4919138160976202, 0.3399464998481188e-4, 0.4652362892704857e-4,
//   -0.9837447530487956e-4, 0.1580887032249125e-3, -0.21026444172410488e-3,
//   0.2174396181152126e-3, -0.16431810653676389e-3, 0.8441822398385274e-4,
//   -0.261908384015814e-4, 0.3689918265953162e-5,
// ];

export function gammaln(z: number): number {
  // From WikiPedia:
  // \ln \Gamma (z)=z\ln z-z-{\tfrac {1}{2}}\ln z+{\tfrac {1}{2}}\ln 2\pi +{\frac {1}{12z}}-{\frac {1}{360z^{3}}}+{\frac {1}{1260z^{5}}}+o\left({\frac {1}{z^{5}}}\right)

  if (z < 0) return NaN;
  const pi = Math.PI;
  const z3 = z * z * z;
  return (
    z * Math.log(z) -
    z -
    0.5 * Math.log(z) +
    0.5 * Math.log(2 * pi) +
    1 / (12 * z) -
    1 / (360 * z3) +
    1 / (1260 * z3 * z * z)
  );

  // Spouge approximation (suitable for large arguments)
  // if (z < 0) return NaN;
  // let x = gammaPLn[0];
  // for (let i = gammaPLn.length - 1; i > 0; --i) x += gammaPLn[i] / (z + i);
  // const t = z + gammaGLn + 0.5;
  // return (
  //   0.5 * Math.log(2 * Math.PI) +
  //   (z + 0.5) * Math.log(t) -
  //   t +
  //   Math.log(x) -
  //   Math.log(z)
  // );
}

// From https://github.com/substack/gamma.js/blob/master/index.js
export function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  if (z > 100) return Math.exp(gammaln(z));

  z -= 1;
  let x = lanczos_7_c[0];
  for (let i = 1; i < gammaG + 2; i++) x += lanczos_7_c[i] / (z + i);

  const t = z + gammaG + 0.5;

  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function fromDigits(
  s: string,
  base = 10
): [value: number, rest: string] {
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

export function asFloat(expr: BoxedExpression): number | null {
  const num = expr.numericValue;
  if (num === null) return null;

  if (typeof num === 'number') return num;

  if (num instanceof Decimal) return num.toNumber();

  if (Array.isArray(num)) {
    const [n, d] = num;
    if (typeof n === 'number' && typeof d === 'number') return n / d;
    return Number(n as bigint) / Number(d as bigint);
  }

  console.assert(!(num instanceof Complex) || num.im !== 0);

  return null;
}

export function asBignum(expr: BoxedExpression): Decimal | null {
  const num = expr.numericValue;
  if (num === null) return null;

  if (num instanceof Decimal) return num;

  if (typeof num === 'number') return expr.engine.bignum(num);

  if (Array.isArray(num)) {
    const [n, d] = num;
    if (typeof n === 'number' && typeof d === 'number')
      return expr.engine.bignum(n / d);
    return expr.engine.bignum(n).div(d.toString());
  }

  console.assert(!(num instanceof Complex) || num.im !== 0);

  return null;
}

export function asSmallInteger(expr: BoxedExpression): number | null {
  const num = expr.numericValue;
  if (num === null) return null;

  if (typeof num === 'number') {
    if (Number.isInteger(num) && num >= -SMALL_INTEGER && num <= SMALL_INTEGER)
      return num;
    return null;
  }

  if (num instanceof Decimal) {
    if (num.isInteger()) {
      const n = num.toNumber();
      if (n >= -SMALL_INTEGER && n <= SMALL_INTEGER) return n;
    }
    return null;
  }

  // If we're canonical, a rational is never a small integer
  if (expr.isCanonical) return null;

  // We're not canonical, a rational could be a small integer, i.e. 4/2
  const r = num;
  if (Array.isArray(r)) {
    const [n, d] = r;
    let v: number;
    if (typeof n === 'number' && typeof d === 'number') v = n / d;
    else v = Number(n) / Number(d);

    if (Number.isInteger(v) && v >= -SMALL_INTEGER && v <= SMALL_INTEGER)
      return v;
    return null;
  }

  return null;
}

export function chop(n: number, tolerance: number): number;
export function chop(n: Decimal, tolerance: number): 0 | Decimal;
export function chop(n: Complex, tolerance: number): 0 | Complex;
export function chop(
  n: number | Decimal | Complex,
  tolerance: number
): 0 | number | Decimal | Complex {
  if (typeof n === 'number' && Math.abs(n) <= tolerance) return 0;

  if (n instanceof Decimal && n.abs().lte(tolerance)) return 0;

  if (
    n instanceof Complex &&
    Math.abs(n.re) <= tolerance &&
    Math.abs(n.im) <= tolerance
  )
    return 0;

  return n;
}

/**
 * An approximation of the gaussian error function, Erf(), using
 * Abramowitz and Stegun approximation.
 * 
 * Thoughts for future improvements:
 * - https://math.stackexchange.com/questions/321569/approximating-the-error-function-erf-by-analytical-functions
 * - https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions

 * 
 * References:
 * - NIST: https://dlmf.nist.gov/7.24#i
 */

export function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  // Save the sign of x
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  // Abramowitz and Stegun approximation
  // https://personal.math.ubc.ca/~cbm/aands/page_299.htm
  const t = 1.0 / (1.0 + p * x);
  const y = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;

  return sign * (1 - y * Math.exp(-x * x));
}

/**
 * Trivial function, used when compiling.
 */
export function erfc(x: number): number {
  return 1 - erf(x);
}

/**
 * Inverse Error Function.
 *
 */
export function erfInv(x: number): number {
  // From https://en.wikipedia.org/wiki/Error_function#Numerical_approximations
  // {\displaystyle \operatorname {erf} ^{-1}z={\frac {\sqrt {\pi }}{2}}\left(z+{\frac {\pi }{12}}z^{3}+{\frac {7\pi ^{2}}{480}}z^{5}+{\frac {127\pi ^{3}}{40320}}z^{7}+{\frac {4369\pi ^{4}}{5806080}}z^{9}+{\frac {34807\pi ^{5}}{182476800}}z^{11}+\cdots \right).}

  const pi = Math.PI;
  const pi2 = pi * pi;
  const pi3 = pi2 * pi;
  const x2 = x * x;
  const x3 = x * x2;
  const x5 = x3 * x2;
  const x7 = x5 * x2;

  return (
    (Math.sqrt(pi) / 2) *
    (x +
      (pi / 12) * x3 +
      ((7 * pi2) / 480) * x5 +
      ((127 * pi3) / 40320) * x7 +
      ((4369 * pi2 * pi2) / 5806080) * x7 * x2 +
      ((34807 * pi3 * pi2) / 182476800) * x7 * x2 * x2)
  );

  // const a = 0.147;
  // const b = 2 / (Math.PI * a) + Math.log(1 - x ** 2) / 2;
  // const sqrt1 = Math.sqrt(b ** 2 - Math.log(1 - x ** 2) / a);
  // const sqrt2 = Math.sqrt(sqrt1 - b);
  // return sqrt2 * Math.sign(x);
}

/**
 * An 8th-order centered difference approximation can be used to get a highly
 * accurate approximation of the first derivative of a function.
 * The formula for the 8th-order centered difference approximation for the
 * first derivative is given by:
 *
 * \[
 * f'(x) \approx \frac{1}{280h} \left[ -f(x-4h) + \frac{4}{3}f(x-3h) - \frac{1}{5}f(x-2h) + \frac{8}{5}f(x-h) - \frac{8}{5}f(x+h) + \frac{1}{5}f(x+2h) - \frac{4}{3}f(x+3h) + f(x+4h) \right]
 * \]
 *
 * Note: Mathematica uses an 8th order approximation for the first derivative
 *
 * f: the function
 * x: the point at which to approximate the derivative
 * h: the step size
 *
 * See https://en.wikipedia.org/wiki/Finite_difference_coefficient
 */
export function centeredDiff8thOrder(
  f: (number) => number,
  x: number,
  h = 0.1
) {
  return (
    (f(x - 4 * h) / 280 -
      (4 * f(x - 3 * h)) / 105 +
      f(x - 2 * h) / 5 -
      (4 * f(x - h)) / 5 +
      (4 * f(x + h)) / 5 -
      f(x + 2 * h) / 5 +
      (4 * f(x + 3 * h)) / 105 -
      f(x + 4 * h) / 280) /
    h
  );
}

/**
 * Return a numerical approximation of the integral
 * of the function `f` from `a` to `b` using Monte Carlo integration.
 *
 * Thoughts for future improvements:
 * - use a MISER algorithm to improve the accuracy
 * - use a stratified sampling to improve the accuracy
 * - use a quasi-Monte Carlo method to improve the accuracy
 * - use a Markov Chain Monte Carlo method to improve the accuracy
 * - use a Metropolis-Hastings algorithm to improve the accuracy
 * - use a Hamiltonian Monte Carlo algorithm to improve the accuracy
 * - use a Gibbs sampling algorithm to improve the accuracy
 *
 *
 * See:
 * - https://64.github.io/monte-carlo/
 *
 */
export function monteCarloEstimate(
  f: (x: number) => number,
  a: number,
  b: number,
  n = 100000
): number {
  let sum = 0;

  if (a === -Infinity && b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = Math.tan(Math.PI * (u - 0.5));
      const jacobian = Math.PI * (1 + x * x);
      sum += f(x) / jacobian;
    }
  } else if (a === -Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = b - Math.log(1 - u);
      const jacobian = 1 / (1 - u);
      sum += f(x) / jacobian;
    }
  } else if (b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = a + Math.log(u);
      const jacobian = 1 / u;
      sum += f(x) / jacobian;
    }
  } else {
    // Proper integral
    for (let i = 0; i < n; i++) sum += f(a + Math.random() * (b - a));
  }

  return (sum / n) * (b - a);
}

/**
 *
 * @param f
 * @param x
 * @param dir Direction of approach: > 0 for right, < 0 for left, 0 for both
 * @returns
 */
export function limit(f: (x: number) => number, x: number, dir = 1): number {
  if (dir === 0) {
    // Approach from both sides
    const left = limit(f, x, -1);
    const right = limit(f, x, 1);
    if (left === undefined || right === undefined) return NaN;
    if (Math.abs(left - right) > 1e-5) return NaN;
    return (left + right) / 2;
  }

  const [val, err] = extrapolate(f, x, { step: dir > 0 ? 1 : -1 });
  return val;
}
