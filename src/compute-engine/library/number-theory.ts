import type { Expression, SymbolDefinitions } from '../global-types';
import { toBigint } from '../boxed-expression/numerics';
import { gcd, lcm } from '../numerics/numeric-bigint';
import { bigPrimeFactors, isPrimeBigint, modPow } from '../numerics/primes';
import { checkDeadline } from '../../common/interruptible';

/**
 * Above this many digits (in the target base), materializing or iterating an
 * integer's digit representation (`IntegerDigits`, `DigitCount`, `DigitSum`)
 * is impractical — stay symbolic instead (mirrors `MAX_EXACT_POW_DIGITS` in
 * `boxed-expression/arithmetic-power.ts` and
 * `MAX_EXACT_COMBINATORICS_DIGITS` in `library/combinatorics.ts`). See
 * WP-2.18 / P0-19 residual: `DigitSum(2^1000000)` (a real 301,030-digit
 * bigint, itself under the exact-power guard) used to hang because the
 * naive repeated mod/divide loop is O(digits²) — quadratic enough to turn
 * that into a 30s+ hang.
 */
const MAX_DIGIT_ITERATION_DIGITS = 1_000_000;

/**
 * Cheap (O(digits), not O(digits²)) approximate bit length of a bigint's
 * magnitude, via its hex string: each hex digit is a fixed-width
 * reinterpretation of the underlying binary limbs (no arithmetic, unlike
 * base-10 conversion), so this stays linear even for huge inputs.
 */
function approximateBitLength(m: bigint): number {
  if (m === 0n) return 0;
  const h = (m < 0n ? -m : m).toString(16);
  return h.length * 4;
}

/**
 * Approximate digit count of `m`'s magnitude in the given `base`, derived
 * from the cheap bit-length estimate above. Used as a pre-check — before
 * materializing a digit array or summing digits — so a pathologically large
 * input stays symbolic rather than grinding through an O(digits) (or worse)
 * loop.
 */
function approximateDigitCount(m: bigint, base: bigint): number {
  const bits = approximateBitLength(m);
  if (bits === 0) return 1;
  return Math.ceil((bits * Math.LN2) / Math.log(Number(base))) + 1;
}

/** Decimal value of a base-36 digit character ('0'-'9', 'a'-'z'). */
function charToDigit(code: number): bigint {
  return BigInt(code <= 57 ? code - 48 : code - 87);
}

/**
 * Decompose `|m|` into digits in the given `base`, least-significant first.
 *
 * For base 2..36 this delegates to bigint's native `toString(base)` — a
 * linear-time, digit-by-digit reinterpretation of the binary representation
 * — instead of the naive repeated-mod-and-divide loop, which is O(digits²):
 * quadratic enough to turn a several-hundred-thousand-digit input into a
 * many-second hang (WP-2.18). For base > 36 (not supported by `toString`),
 * falls back to the mod/divide loop, guarded by `checkDeadline`.
 */
function bigintDigitsLSB(
  m: bigint,
  base: bigint,
  deadline: number | undefined
): bigint[] {
  if (m === 0n) return [0n];
  if (base <= 36n) {
    const s = m.toString(Number(base));
    const digits = new Array<bigint>(s.length);
    for (let i = 0; i < s.length; i++) {
      if ((i & 0xffff) === 0) checkDeadline(deadline);
      digits[s.length - 1 - i] = charToDigit(s.charCodeAt(i));
    }
    return digits;
  }
  const digits: bigint[] = [];
  let x = m;
  // Unlike the base<=36 loop above, each step here is a bigint mod/div
  // against an arbitrary (possibly itself huge) `base` — its cost is not a
  // fixed small constant, so check the deadline every iteration rather than
  // amortizing over a stride.
  while (x > 0n) {
    checkDeadline(deadline);
    digits.push(x % base);
    x /= base;
  }
  return digits;
}

/**
 * Sum of the digits of `|m|` in the given base, in a single O(digits) pass
 * (via native `toString(base)` for base 2..36, else a `checkDeadline`-
 * guarded mod/divide loop for larger bases) — see `bigintDigitsLSB` for the
 * same base-36 cutoff rationale. Avoids materializing an intermediate digit
 * array since `DigitSum` only needs the running total.
 */
function bigintDigitSum(
  m: bigint,
  base: bigint,
  deadline: number | undefined
): bigint {
  if (m === 0n) return 0n;
  if (base <= 36n) {
    const s = m.toString(Number(base));
    let sum = 0n;
    for (let i = 0; i < s.length; i++) {
      if ((i & 0xffff) === 0) checkDeadline(deadline);
      sum += charToDigit(s.charCodeAt(i));
    }
    return sum;
  }
  let sum = 0n;
  let x = m;
  // Same rationale as bigintDigitsLSB's fallback loop: check every
  // iteration since `base` (and thus the per-step cost) is unbounded here.
  while (x > 0n) {
    checkDeadline(deadline);
    sum += x % base;
    x /= base;
  }
  return sum;
}

export const NUMBER_THEORY_LIBRARY: SymbolDefinitions[] = [
  {
    FactorInteger: {
      description:
        'Return the prime factorization of an integer `n` as a list of `[prime, exponent]` tuples, ordered by ascending prime. For a negative `n`, a leading `[-1, 1]` tuple carries the sign.',
      signature: '(integer) -> list<tuple<integer, integer>>',
      examples: ['FactorInteger(360)  // [(2, 3), (3, 2), (5, 1)]'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;

        const tuple = (prime: bigint, exponent: number) =>
          ce._fn('Tuple', [ce.number(prime), ce.number(exponent)]);

        // Match Mathematica's conventions for the degenerate inputs:
        //   FactorInteger(0)  -> [(0, 1)]
        //   FactorInteger(1)  -> [(1, 1)]
        //   FactorInteger(-1) -> [(-1, 1)]
        if (k === 0n) return ce.function('List', [tuple(0n, 1)]);
        if (k === 1n) return ce.function('List', [tuple(1n, 1)]);

        const result: Expression[] = [];
        let m = k;
        if (m < 0n) {
          result.push(tuple(-1n, 1));
          m = -m;
        }

        // `m` is now >= 1; when it is 1 (i.e. k === -1) there are no prime
        // factors and only the leading `[-1, 1]` tuple remains.
        if (m > 1n) {
          const factors = bigPrimeFactors(m);
          // Sort by ascending prime so the result is canonical regardless of
          // the order in which the factors were discovered.
          const primes = [...factors.keys()].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0
          );
          for (const p of primes) result.push(tuple(p, factors.get(p)!));
        }

        return ce.function('List', result);
      },
    },

    Divides: {
      description:
        '`Divides(a, b)` returns `True` if `a` divides `b` (i.e. `b` is an integer multiple of `a`), corresponding to the notation `a ∣ b`. Stays symbolic for non-integer operands.',
      complexity: 1200,
      // Params are `number` (not `integer`) — like `IsPrime`/`IsOdd` — so a
      // symbolic operand (statically typed `number`/`finite_number`) is accepted
      // and the relation stays symbolic; the `evaluate` handler reduces only
      // when both operands are concrete integers (`toBigint`).
      signature: '(number, number) -> boolean',
      examples: ['Divides(3, 12)  // "True"'],
      evaluate: ([aOp, bOp], { engine: ce }) => {
        const a = toBigint(aOp);
        const b = toBigint(bOp);
        if (a === null || b === null) return undefined;
        // 0 divides only 0; every non-zero integer divides 0.
        if (a === 0n) return b === 0n ? ce.True : ce.False;
        return b % a === 0n ? ce.True : ce.False;
      },
    },

    NotDivides: {
      description:
        '`NotDivides(a, b)` returns `True` if `a` does not divide `b`, corresponding to the notation `a ∤ b`.',
      complexity: 1200,
      signature: '(integer, integer) -> boolean',
      canonical: (ops, { engine }) => engine.expr(['Not', ['Divides', ...ops]]),
    },

    Divisors: {
      description:
        'Return the sorted list of positive divisors of an integer `n`. The sign of `n` is ignored.',
      signature: '(integer) -> list<integer>',
      examples: ['Divisors(12)  // [1, 2, 3, 4, 6, 12]'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        // 0 has infinitely many divisors; leave it unevaluated.
        const m = k < 0n ? -k : k;
        if (m === 0n) return undefined;
        return ce.function(
          'List',
          divisorsAscending(m, ce._deadline).map((d) => ce.number(d))
        );
      },
    },

    NthPrime: {
      description:
        'Return the nth prime number (1-based): `NthPrime(1)` is 2, `NthPrime(2)` is 3, …',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['NthPrime(10)  // 29'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return undefined;
        if (k === 1n) return ce.number(2);
        // 2 is already counted; scan the odd candidates 3, 5, 7, … until the
        // kth prime is reached.
        let count = 1n;
        let candidate = 1n;
        let steps = 0;
        while (count < k) {
          candidate += 2n;
          if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);
          if (isPrimeBigint(candidate)) count += 1n;
        }
        return ce.number(candidate);
      },
    },

    NextPrime: {
      description:
        'Return the smallest prime greater than `n`. With a second argument `k`, return the kth prime after `n` (`k < 0` returns the |k|th prime before `n`).',
      signature: '(integer, integer?) -> integer',
      type: () => 'finite_integer',
      examples: ['NextPrime(10)  // 11', 'NextPrime(10, -1)  // 7'],
      evaluate: ([n, kArg], { engine: ce }) => {
        const start = toBigint(n);
        if (start === null) return undefined;
        const k = kArg === undefined ? 1n : toBigint(kArg);
        if (k === null || k === 0n) return undefined;

        let p = start;
        let steps = 0;
        if (k > 0n) {
          for (let i = 0n; i < k; i++) {
            do {
              p += 1n;
              if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);
            } while (!isPrimeBigint(p));
          }
        } else {
          for (let i = 0n; i > k; i--) {
            do {
              p -= 1n;
              if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);
              if (p < 2n) return undefined; // no prime below 2
            } while (!isPrimeBigint(p));
          }
        }
        return ce.number(p);
      },
    },

    PrimeFactors: {
      description:
        'Return the sorted list of distinct prime factors of an integer `n`. The sign of `n` is ignored; `PrimeFactors(1)` is the empty list.',
      signature: '(integer) -> list<integer>',
      examples: ['PrimeFactors(360)  // [2, 3, 5]'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const m = k < 0n ? -k : k;
        if (m === 0n) return undefined; // 0 has no well-defined factorization
        const primes = [...bigPrimeFactors(m).keys()]
          .filter((p) => p !== 1n)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        return ce.function(
          'List',
          primes.map((p) => ce.number(p))
        );
      },
    },

    PrimeNu: {
      description:
        'Return ω(n), the number of distinct prime factors of `n`. The sign of `n` is ignored; `PrimeNu(1)` is 0.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['PrimeNu(360)  // 3'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const m = k < 0n ? -k : k;
        if (m === 0n) return undefined;
        if (m === 1n) return ce.number(0);
        return ce.number(bigPrimeFactors(m).size);
      },
    },

    PrimeOmega: {
      description:
        'Return Ω(n), the number of prime factors of `n` counted with multiplicity. The sign of `n` is ignored; `PrimeOmega(1)` is 0.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['PrimeOmega(360)  // 6'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const m = k < 0n ? -k : k;
        if (m === 0n) return undefined;
        if (m === 1n) return ce.number(0);
        let total = 0;
        for (const e of bigPrimeFactors(m).values()) total += e;
        return ce.number(total);
      },
    },

    MoebiusMu: {
      description:
        'Return the Möbius function μ(n): 0 if `n` is divisible by a perfect square > 1, otherwise (-1) raised to the number of distinct prime factors. The sign of `n` is ignored.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['MoebiusMu(30)  // -1'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const m = k < 0n ? -k : k;
        if (m === 0n) return undefined;
        if (m === 1n) return ce.number(1);
        const factors = bigPrimeFactors(m);
        for (const e of factors.values()) if (e > 1) return ce.number(0);
        return ce.number(factors.size % 2 === 0 ? 1 : -1);
      },
    },

    IsSquareFree: {
      description:
        'Return `"True"` if `n` is square-free (not divisible by any perfect square > 1). The sign of `n` is ignored.',
      signature: '(integer) -> boolean',
      examples: ['IsSquareFree(30)  // "True"'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const m = k < 0n ? -k : k;
        if (m === 0n) return ce.False;
        if (m === 1n) return ce.True;
        const factors = bigPrimeFactors(m);
        for (const e of factors.values()) if (e > 1) return ce.False;
        return ce.True;
      },
    },

    Radical: {
      description:
        'Return the radical of `n` (its square-free kernel): the product of its distinct prime factors. The sign of `n` is ignored; `Radical(1)` is 1.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['Radical(360)  // 30'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const m = k < 0n ? -k : k;
        if (m === 0n) return undefined;
        if (m === 1n) return ce.number(1);
        let product = 1n;
        for (const p of bigPrimeFactors(m).keys()) product *= p;
        return ce.number(product);
      },
    },

    PowerMod: {
      description:
        'Return `a^b mod m` (modular exponentiation). A negative `b` uses the modular inverse of `a`; the result is undefined when that inverse does not exist (i.e. when `a` and `m` are not coprime). The result is in the range [0, m).',
      signature: '(integer, integer, integer) -> integer',
      type: () => 'finite_integer',
      examples: ['PowerMod(2, 10, 1000)  // 24'],
      evaluate: ([aOp, bOp, mOp], { engine: ce }) => {
        const a = toBigint(aOp);
        const b = toBigint(bOp);
        const m = toBigint(mOp);
        if (a === null || b === null || m === null) return undefined;
        if (m <= 0n) return undefined; // modulus must be positive
        if (m === 1n) return ce.number(0);
        if (b >= 0n) return ce.number(modPow(a, b, m));
        // Negative exponent: invert `a` modulo `m`, then raise to `-b`.
        const base = ((a % m) + m) % m;
        const [g, s] = extGcd(base, m);
        if (g !== 1n) return undefined; // inverse does not exist
        const inv = ((s % m) + m) % m;
        return ce.number(modPow(inv, -b, m));
      },
    },

    ExtendedGCD: {
      description:
        'Return the extended GCD of `a` and `b` as a tuple `(g, x, y)` where `g = gcd(a, b)` is non-negative and `a·x + b·y = g` (Bézout coefficients).',
      signature: '(integer, integer) -> tuple<integer, integer, integer>',
      examples: ['ExtendedGCD(12, 18)  // (6, -1, 1)'],
      evaluate: ([aOp, bOp], { engine: ce }) => {
        const a = toBigint(aOp);
        const b = toBigint(bOp);
        if (a === null || b === null) return undefined;
        let [g, x, y] = extGcd(a, b);
        if (g < 0n) {
          g = -g;
          x = -x;
          y = -y;
        }
        return ce._fn('Tuple', [ce.number(g), ce.number(x), ce.number(y)]);
      },
    },

    IntegerSqrt: {
      description:
        'Return the integer square root of `n`, i.e. the largest integer `m` such that `m² ≤ n`. Undefined for negative `n`.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['IntegerSqrt(17)  // 4'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 0n) return undefined;
        return ce.number(bigintSqrt(k));
      },
    },

    ChineseRemainder: {
      description:
        'Solve a system of simultaneous congruences: return the smallest non-negative integer `x` such that `x ≡ residues[i] (mod moduli[i])` for every `i`. Undefined if the system is inconsistent or the two lists differ in length.',
      signature: '(collection, collection) -> integer',
      examples: ['ChineseRemainder([2, 3, 2], [3, 5, 7])  // 23'],
      evaluate: ([residuesOp, moduliOp], { engine: ce }) => {
        const residues = Array.from(residuesOp?.each() ?? []).map(toBigint);
        const moduli = Array.from(moduliOp?.each() ?? []).map(toBigint);
        if (residues.length === 0 || residues.length !== moduli.length)
          return undefined;
        if (residues.includes(null) || moduli.includes(null)) return undefined;
        const x = chineseRemainder(residues as bigint[], moduli as bigint[]);
        if (x === null) return undefined;
        return ce.number(x);
      },
    },

    CarmichaelLambda: {
      description:
        'Return the Carmichael function λ(n) (the reduced totient): the smallest positive integer `m` such that `a^m ≡ 1 (mod n)` for every `a` coprime to `n`. Defined for `n ≥ 1`.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['CarmichaelLambda(15)  // 4'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return undefined;
        return ce.number(carmichaelLambda(k));
      },
    },

    LucasL: {
      description:
        'Return the nth Lucas number: `LucasL(0)` is 2, `LucasL(1)` is 1, and `LucasL(n) = LucasL(n-1) + LucasL(n-2)`. Negative indices follow `LucasL(-n) = (-1)^n · LucasL(n)`.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['LucasL(10)  // 123'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const neg = k < 0n;
        const kk = neg ? -k : k;
        let a = 2n;
        let b = 1n;
        let steps = 0;
        for (let i = 0n; i < kk; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          [a, b] = [b, a + b];
        }
        return ce.number(neg && kk % 2n === 1n ? -a : a);
      },
    },

    CatalanNumber: {
      description:
        'Return the nth Catalan number `C(n) = (2n)! / ((n+1)! · n!)`: 1, 1, 2, 5, 14, 42, … Defined for `n ≥ 0`.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['CatalanNumber(5)  // 42'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 0n) return undefined;
        let c = 1n;
        let steps = 0;
        for (let i = 0n; i < k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          c = (c * 2n * (2n * i + 1n)) / (i + 2n);
        }
        return ce.number(c);
      },
    },

    IsPerfectPower: {
      description:
        'Return `"True"` if `n` is a perfect power `a^b` for integers `a` and `b ≥ 2` (a negative `n` requires an odd exponent). The smallest perfect power is 4.',
      signature: '(integer) -> boolean',
      examples: ['IsPerfectPower(64)  // "True"'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        const m = k < 0n ? -k : k;
        if (m < 4n) return ce.False;
        return ce.symbol(
          isPerfectPowerBigint(m, k < 0n, ce._deadline) ? 'True' : 'False'
        );
      },
    },

    ContinuedFraction: {
      description:
        'Return the continued-fraction expansion of `x` as a list of integer terms `[a0, a1, …]`. An exact rational is expanded fully; for an inexact value the expansion is truncated to the optional `n` terms (default 20).',
      signature: '(number, integer?) -> list<integer>',
      examples: ['ContinuedFraction(43/19)  // [2, 3, 1, 4]'],
      evaluate: ([xOp, nOp], { engine: ce }) => {
        if (xOp === undefined) return undefined;
        const maxTerms =
          nOp === undefined ? undefined : Number(toBigint(nOp) ?? 0n);
        if (maxTerms !== undefined && maxTerms < 1) return undefined;

        const terms: bigint[] = [];
        if (xOp.isRational) {
          // Exact: Euclidean expansion of numerator/denominator.
          let a = toBigint(xOp.numerator);
          let b = toBigint(xOp.denominator);
          if (a === null || b === null || b === 0n) return undefined;
          if (b < 0n) {
            a = -a;
            b = -b;
          }
          while (b !== 0n) {
            // Floor division (bigint `/` truncates toward zero).
            let q: bigint = a / b;
            if (a % b !== 0n && a < 0n !== b < 0n) q -= 1n;
            terms.push(q);
            [a, b] = [b, a - q * b];
            if (maxTerms !== undefined && terms.length >= maxTerms) break;
          }
        } else {
          // Inexact: expand the float value to a bounded number of terms.
          let val = xOp.re;
          if (!Number.isFinite(val)) return undefined;
          const cap = maxTerms ?? 20;
          for (let i = 0; i < cap; i++) {
            const fl = Math.floor(val);
            terms.push(BigInt(fl));
            const frac = val - fl;
            if (frac < 1e-12) break;
            val = 1 / frac;
            if (!Number.isFinite(val)) break;
          }
        }
        return ce.function(
          'List',
          terms.map((t) => ce.number(t))
        );
      },
    },

    FromContinuedFraction: {
      description:
        'Reconstruct the (rational) value of a continued fraction given its list of integer terms `[a0, a1, …]`.',
      signature: '(collection) -> number',
      examples: ['FromContinuedFraction([2, 3, 1, 4])  // 43/19'],
      evaluate: ([listOp], { engine: ce }) => {
        const terms = Array.from(listOp?.each() ?? []).map(toBigint);
        if (terms.length === 0 || terms.includes(null)) return undefined;
        let p = 1n;
        let q = 0n;
        for (let i = terms.length - 1; i >= 0; i--)
          [p, q] = [terms[i]! * p + q, p];
        if (q === 0n) return undefined;
        return ce.number(p).div(ce.number(q));
      },
    },

    IntegerDigits: {
      description:
        'Return the digits of `n` in the given `base` (default 10), most-significant first. The sign of `n` is ignored. With a third argument `length`, the result is zero-padded on the left (or truncated to its least-significant digits) to that length.',
      signature: '(integer, integer?, integer?) -> list<integer>',
      examples: ['IntegerDigits(255, 16)  // [15, 15]'],
      evaluate: ([nOp, baseOp, lenOp], { engine: ce }) => {
        const k = toBigint(nOp);
        if (k === null) return undefined;
        const base = baseOp === undefined ? 10n : toBigint(baseOp);
        if (base === null || base < 2n) return undefined;

        const m = k < 0n ? -k : k;
        // Pre-check: stay symbolic rather than materialize a pathologically
        // large digit list (see MAX_DIGIT_ITERATION_DIGITS).
        if (approximateDigitCount(m, base) > MAX_DIGIT_ITERATION_DIGITS)
          return undefined;
        const digits = bigintDigitsLSB(m, base, ce._deadline).reverse();

        if (lenOp !== undefined) {
          const len = toBigint(lenOp);
          if (len === null || len < 0n) return undefined;
          const L = Number(len);
          while (digits.length < L) digits.unshift(0n);
          if (digits.length > L) digits.splice(0, digits.length - L);
        }
        return ce.function(
          'List',
          digits.map((d) => ce.number(d))
        );
      },
    },

    DigitCount: {
      description:
        'Count digits of `n` in the given `base` (default 10); the sign of `n` is ignored. With a third argument `digit`, return how many times that digit occurs. Otherwise return a list `[count of 1, count of 2, …, count of base-1, count of 0]`.',
      signature: '(integer, integer?, integer?) -> integer | list<integer>',
      type: ([, , digit]) => (digit !== undefined ? 'finite_integer' : 'list'),
      examples: ['DigitCount(122, 10, 2)  // 2'],
      evaluate: ([nOp, baseOp, digitOp], { engine: ce }) => {
        const k = toBigint(nOp);
        if (k === null) return undefined;
        const base = baseOp === undefined ? 10n : toBigint(baseOp);
        if (base === null || base < 2n) return undefined;

        const m = k < 0n ? -k : k;
        // Pre-check: stay symbolic rather than iterate a pathologically
        // large number of digits (see MAX_DIGIT_ITERATION_DIGITS).
        if (approximateDigitCount(m, base) > MAX_DIGIT_ITERATION_DIGITS)
          return undefined;
        const counts = new Map<bigint, number>();
        for (const d of bigintDigitsLSB(m, base, ce._deadline))
          counts.set(d, (counts.get(d) ?? 0) + 1);

        if (digitOp !== undefined) {
          const d = toBigint(digitOp);
          if (d === null || d < 0n || d >= base) return undefined;
          return ce.number(counts.get(d) ?? 0);
        }
        // List form: counts of 1..base-1, then the count of 0 last.
        const list: ReturnType<typeof ce.number>[] = [];
        for (let d = 1n; d < base; d++)
          list.push(ce.number(counts.get(d) ?? 0));
        list.push(ce.number(counts.get(0n) ?? 0));
        return ce.function('List', list);
      },
    },

    RandomPrime: {
      description:
        'Return a random prime. `RandomPrime(n)` draws a prime in [2, n]; `RandomPrime(m, n)` draws a prime in [m, n]. Undefined if the range contains no prime.',
      pure: false,
      signature: '(integer, integer?) -> integer',
      type: () => 'finite_integer',
      examples: ['RandomPrime(100)  // e.g. 47'],
      evaluate: ([aOp, bOp], { engine: ce }) => {
        let lo: bigint | null;
        let hi: bigint | null;
        if (bOp === undefined) {
          lo = 2n;
          hi = toBigint(aOp);
        } else {
          lo = toBigint(aOp);
          hi = toBigint(bOp);
        }
        if (lo === null || hi === null) return undefined;
        if (lo < 2n) lo = 2n;
        if (hi < lo) return undefined;

        const range = hi - lo + 1n;
        const attempts = 100 + 20 * hi.toString().length;
        for (let i = 0; i < attempts; i++) {
          const r = lo + randomBigintBelow(range);
          if (isPrimeBigint(r)) return ce.number(r);
        }
        // Safety net: a deterministic scan guarantees a result when the range
        // does contain a prime (only reached when sampling keeps missing).
        for (let p = lo; p <= hi; p++) {
          checkDeadline(ce._deadline);
          if (isPrimeBigint(p)) return ce.number(p);
        }
        return undefined;
      },
    },

    PrimePi: {
      description:
        'Return π(n), the prime-counting function: the number of primes less than or equal to `n`.',
      signature: '(real) -> integer',
      type: () => 'finite_integer',
      examples: ['PrimePi(10)  // 4'],
      evaluate: ([n], { engine: ce }) => {
        const x = n?.re;
        if (x === undefined || !Number.isFinite(x)) return undefined;
        const bound = BigInt(Math.floor(x));
        if (bound < 2n) return ce.number(0);
        let count = 1; // 2 is prime
        let steps = 0;
        for (let k = 3n; k <= bound; k += 2n) {
          if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);
          if (isPrimeBigint(k)) count++;
        }
        return ce.number(count);
      },
    },

    BernoulliB: {
      description:
        'Return the nth Bernoulli number Bₙ as an exact rational, using the convention B₁ = -1/2. Odd `n > 1` give 0.',
      signature: '(integer) -> finite_rational',
      type: () => 'finite_rational',
      examples: ['BernoulliB(2)  // 1/6'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 0n) return undefined;
        if (k === 0n) return ce.number(1);
        if (k === 1n) return ce.number(-1).div(ce.number(2));
        if (k % 2n === 1n) return ce.number(0);
        const [num, den] = bernoulliNumber(Number(k), ce._deadline);
        return den === 1n ? ce.number(num) : ce.number(num).div(ce.number(den));
      },
    },

    FromDigits: {
      description:
        'Reconstruct an integer from its list of digits (most-significant first) in the given `base` (default 10). The inverse of `IntegerDigits`. Digits outside `[0, base)` are combined positionally (Horner evaluation).',
      signature: '(collection, integer?) -> integer',
      type: () => 'finite_integer',
      examples: ['FromDigits([1, 2, 3, 4])  // 1234'],
      evaluate: ([digitsOp, baseOp], { engine: ce }) => {
        const digits = Array.from(digitsOp?.each() ?? []).map(toBigint);
        if (digits.length === 0 || digits.includes(null)) return undefined;
        const base = baseOp === undefined ? 10n : toBigint(baseOp);
        if (base === null || base < 2n) return undefined;
        let result = 0n;
        for (const d of digits) result = result * base + d!;
        return ce.number(result);
      },
    },

    DigitSum: {
      description:
        'Return the sum of the digits of `n` in the given `base` (default 10). The sign of `n` is ignored.',
      signature: '(integer, integer?) -> integer',
      type: () => 'finite_integer',
      examples: ['DigitSum(1234)  // 10'],
      evaluate: ([nOp, baseOp], { engine: ce }) => {
        const k = toBigint(nOp);
        if (k === null) return undefined;
        const base = baseOp === undefined ? 10n : toBigint(baseOp);
        if (base === null || base < 2n) return undefined;
        const m = k < 0n ? -k : k;
        // Pre-check: stay symbolic rather than iterate a pathologically
        // large number of digits (see MAX_DIGIT_ITERATION_DIGITS). Below
        // the threshold, `bigintDigitSum` is a single O(digits) pass (not
        // the O(digits²) naive mod/divide loop this used to be).
        if (approximateDigitCount(m, base) > MAX_DIGIT_ITERATION_DIGITS)
          return undefined;
        return ce.number(bigintDigitSum(m, base, ce._deadline));
      },
    },

    DivisorSigma: {
      description:
        'The divisor function σ_k(n) = Σ_{d | n} dᵏ over the positive divisors of `n`. σ₀ counts divisors, σ₁ sums them. Defined for `n ≥ 1`.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      examples: ['DivisorSigma(2, 6)  // 50'],
      evaluate: ([kOp, nOp], { engine: ce }) => {
        const k = toBigint(kOp);
        const n = toBigint(nOp);
        if (k === null || n === null || k < 0n || n < 1n) return undefined;
        if (n === 1n) return ce.number(1);
        let result = 1n;
        for (const [p, e] of bigPrimeFactors(n)) {
          if (k === 0n) result *= BigInt(e + 1);
          else {
            const pk = p ** k;
            result *= (pk ** BigInt(e + 1) - 1n) / (pk - 1n);
          }
        }
        return ce.number(result);
      },
    },

    JacobiSymbol: {
      description:
        'The Jacobi symbol (a/n) for an odd `n > 0`. Returns -1, 0, or 1. Undefined when `n` is even or non-positive.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      examples: ['JacobiSymbol(5, 21)  // 1'],
      evaluate: ([aOp, nOp], { engine: ce }) => {
        const a = toBigint(aOp);
        const n = toBigint(nOp);
        if (a === null || n === null) return undefined;
        if (n <= 0n || n % 2n === 0n) return undefined;
        return ce.number(jacobiSymbol(a, n));
      },
    },

    LegendreSymbol: {
      description:
        'The Legendre symbol (a/p) for an odd prime `p`. Returns -1, 0, or 1. Undefined when `p` is not an odd prime.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      examples: ['LegendreSymbol(3, 7)  // -1'],
      evaluate: ([aOp, pOp], { engine: ce }) => {
        const a = toBigint(aOp);
        const p = toBigint(pOp);
        if (a === null || p === null) return undefined;
        if (p <= 2n || p % 2n === 0n || !isPrimeBigint(p)) return undefined;
        return ce.number(jacobiSymbol(a, p));
      },
    },

    MultiplicativeOrder: {
      description:
        'The multiplicative order of `a` modulo `n`: the smallest `k > 0` such that `a^k ≡ 1 (mod n)`. Undefined unless `a` and `n` are coprime.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      examples: ['MultiplicativeOrder(2, 7)  // 3'],
      evaluate: ([aOp, nOp], { engine: ce }) => {
        const a0 = toBigint(aOp);
        const n = toBigint(nOp);
        if (a0 === null || n === null || n < 1n) return undefined;
        if (n === 1n) return ce.number(1);
        const a = ((a0 % n) + n) % n;
        if (gcd(a, n) !== 1n) return undefined;
        // The order divides λ(n); the smallest such divisor is the order.
        for (const d of divisorsAscending(carmichaelLambda(n), ce._deadline)) {
          checkDeadline(ce._deadline);
          if (modPow(a, d, n) === 1n) return ce.number(d);
        }
        return undefined;
      },
    },

    PrimitiveRoot: {
      description:
        'The smallest primitive root modulo `n` (a generator of the multiplicative group of integers mod `n`), or undefined if none exists (which happens unless `n` is 1, 2, 4, pᵏ, or 2pᵏ for an odd prime p).',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['PrimitiveRoot(7)  // 3'],
      evaluate: ([nOp], { engine: ce }) => {
        const n = toBigint(nOp);
        if (n === null || n < 1n) return undefined;
        if (n === 1n) return ce.number(0);
        if (n === 2n) return ce.number(1);
        if (n === 4n) return ce.number(3);
        if (!hasPrimitiveRoot(n)) return undefined;
        const phi = eulerPhi(n);
        const phiFactors = [...bigPrimeFactors(phi).keys()];
        for (let a = 2n; a < n; a++) {
          checkDeadline(ce._deadline);
          if (gcd(a, n) !== 1n) continue;
          if (phiFactors.every((q) => modPow(a, phi / q, n) !== 1n))
            return ce.number(a);
        }
        return undefined;
      },
    },

    PrimeNumber: {
      description:
        'The nth prime number. `PrimeNumber` is an alias for `NthPrime`, which is the preferred name.',
      signature: '(integer) -> integer',
      canonical: ([n], { engine }) => engine._fn('NthPrime', [n]),
    },

    Totient: {
      wikidata: 'Q190026',
      description:
        "Euler's totient function φ(n): count of positive integers ≤ n that are coprime to n.",
      // `(number)`, not `(integer)`: a strict integer parameter rejects
      // symbolic operands at rule-boxing time — `Totient(2^n)` soundly types
      // `finite_rational` since the WP-2.9 Power-type fix (n could be
      // negative), which broke 4 Fungrim rules. The evaluate handler below
      // validates integrality at runtime (`toBigint` → null keeps
      // non-integers symbolic), same pattern as `Binomial` (WP-2.15).
      signature: '(number) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        // Runtime integrality guard (the signature is deliberately loose, see
        // above; `toBigint` COERCES via rounding, so gate before it).
        if (n.isInteger !== true) return undefined;
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let result = 1n;
        let count = 0;
        for (let i = 2n; i < k; i++) {
          if ((++count & 0x3ff) === 0) checkDeadline(ce._deadline);
          if (gcd(i, k) === 1n) result++;
        }
        return ce.number(result);
      },
    },

    Sigma0: {
      description: 'Number of positive divisors of n.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let count = 0;
        let steps = 0;
        for (let i = 1n; i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) count++;
        }
        return ce.number(count);
      },
    },

    Sigma1: {
      description: 'Sum of positive divisors of n.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = ce.bignum(0);
        let steps = 0;
        for (let i = 1n; i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) sum = sum.add(ce.bignum(i));
        }
        return ce.number(sum);
      },
    },

    SigmaMinus1: {
      description: 'Sum of reciprocals of positive divisors of n.',
      signature: '(integer) -> number',
      type: () => 'finite_rational',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = ce.bignum(0);
        let steps = 0;
        for (let i = 1n; i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) sum = sum.add(ce.bignum(1).div(ce.bignum(i)));
        }
        return ce.number(sum);
      },
    },

    IsPerfect: {
      wikidata: 'Q170043',
      description:
        'Returns "True" if n is a perfect number, a positive integer which equals the sum of all its divisors.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = 0n;
        let steps = 0;
        for (let i = 1n; i < k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) sum += i;
        }
        return ce.symbol(sum === k ? 'True' : 'False');
      },
    },

    Eulerian: {
      description:
        'Eulerian number A(n, m): number of permutations of {1..n} with exactly m ascents.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n, m], { engine: ce }) => {
        const nn = toBigint(n);
        const mm = toBigint(m);
        if (nn === null || mm === null || nn < 0n || mm < 0n || mm >= nn)
          return undefined;
        let steps = 0;
        const A = (n: bigint, k: bigint): bigint => {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k === 0n) return 1n;
          if (k >= n) return 0n;
          return (k + 1n) * A(n - 1n, k) + (n - k) * A(n - 1n, k - 1n);
        };
        return ce.number(A(nn, mm));
      },
    },

    Stirling: {
      description:
        'Stirling number of the second kind S(n, m): ways to partition n elements into m non-empty subsets.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n, m], { engine: ce }) => {
        const nn = toBigint(n);
        const mm = toBigint(m);
        if (nn === null || mm === null || nn < 0n || mm < 0n || mm > nn)
          return undefined;
        let steps = 0;
        const S = (n: bigint, k: bigint): bigint => {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (n === 0n && k === 0n) return 1n;
          if (n === 0n || k === 0n) return 0n;
          return S(n - 1n, k - 1n) + k * S(n - 1n, k);
        };
        return ce.number(S(nn, mm));
      },
    },

    NPartition: {
      description: 'Number of integer partitions of n.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const nn = toBigint(n);
        if (nn === null || nn < 0n) return undefined;
        const memo = new Map<bigint, bigint>();
        let steps = 0;
        const P = (n: bigint): bigint => {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (n === 0n) return 1n;
          if (n < 0n) return 0n;
          if (memo.has(n)) return memo.get(n)!;
          let total = 0n;
          for (let k = 1n; ; k++) {
            const pent1 = (k * (3n * k - 1n)) / 2n;
            const pent2 = (k * (3n * k + 1n)) / 2n;
            if (pent1 > n && pent2 > n) break;
            const sign = k % 2n === 0n ? -1n : 1n;
            total += sign * (P(n - pent1) + P(n - pent2));
          }
          memo.set(n, total);
          return total;
        };
        return ce.number(P(nn));
      },
    },

    IsTriangular: {
      description: 'True if n is a triangular number.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        const D = 8n * k + 1n;
        const sqrt = BigInt(ce.bignum(D).sqrt().toFixed(0));
        return ce.symbol(
          sqrt * sqrt === D && (sqrt - 1n) % 2n === 0n ? 'True' : 'False'
        );
      },
    },

    IsSquare: {
      description: 'True if n is a perfect square.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 0n) return ce.False;
        const sqrt = BigInt(ce.bignum(k).sqrt().toFixed(0));
        return ce.symbol(sqrt * sqrt === k ? 'True' : 'False');
      },
    },

    IsOctahedral: {
      description: 'True if n is an octahedral number.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        // The m-th octahedral number is O(m) = m(2m² + 1)/3, i.e.
        // 2m³ + m = 3n. The previous code tested a perfect square of 3n+1,
        // which is unrelated. Estimate m via a cube root, then verify
        // exactly over a small neighborhood (guards against rounding).
        const target = 3n * k; // = 2m³ + m
        const est = BigInt(
          ce
            .bignum(target / 2n)
            .cbrt()
            .toFixed(0)
        );
        for (let m = est - 2n; m <= est + 2n; m++) {
          if (m < 1n) continue;
          if (2n * m * m * m + m === target) return ce.True;
        }
        return ce.False;
      },
    },

    IsCenteredSquare: {
      description: 'True if n is a centered square number.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        if ((k - 1n) % 4n !== 0n) return ce.False;
        const t = (k - 1n) / 4n;
        const sqrt = BigInt(ce.bignum(t).sqrt().toFixed(0));
        return ce.symbol(sqrt * sqrt * 4n + 1n === k ? 'True' : 'False');
      },
    },

    IsHappy: {
      wikidata: 'Q44535',
      description:
        'True if n is a happy number, a number which eventually reaches 1 when the number is replaced by the sum of the square of each digit',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const seen = new Set<bigint>();
        let k = toBigint(n);
        // Happy numbers are positive integers; a negative `k` would also make
        // `sumSquareDigits` throw on the "-" sign.
        if (k === null || k < 1n) return ce.False;
        while (!seen.has(k)) {
          if (k === 1n) return ce.True;
          seen.add(k);
          k = sumSquareDigits(k);
        }
        return ce.False;
      },
    },

    IsAbundant: {
      description: 'True if n is an abundant number (sum of divisors > 2n).',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        let sum = 1n;
        let steps = 0;
        for (let i = 2n; i * i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) {
            sum += i;
            const j = k / i;
            if (j !== i) sum += j;
          }
        }
        return ce.symbol(sum > k ? 'True' : 'False');
      },
    },
  },
];

/**
 * Extended Euclidean algorithm: returns `[g, x, y]` with `a·x + b·y = g`,
 * where `g = gcd(a, b)` (its sign follows `a`/`b`; callers that need a
 * non-negative `g` normalize the triple).
 */
function extGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let [oldR, r] = [a, b];
  let [oldS, s] = [1n, 0n];
  let [oldT, t] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}

/** Integer (floor) square root of `n ≥ 0` via Newton's method on bigints. */
function bigintSqrt(n: bigint): bigint {
  if (n < 2n) return n;
  // Start from a value guaranteed to be ≥ √n (half the bit length, rounded up).
  let x = 1n << ((BigInt(n.toString(2).length) + 1n) / 2n);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x -= 1n;
  return x;
}

/**
 * General Chinese Remainder: merge the congruences `x ≡ residues[i]
 * (mod moduli[i])` pairwise. Moduli need not be coprime. Returns the least
 * non-negative solution modulo lcm(moduli), or `null` if inconsistent or a
 * modulus is not positive.
 */
function chineseRemainder(residues: bigint[], moduli: bigint[]): bigint | null {
  let x = 0n;
  let m = 1n; // current solution: x (mod m)
  for (let i = 0; i < residues.length; i++) {
    const ni = moduli[i];
    if (ni <= 0n) return null;
    const ri = ((residues[i] % ni) + ni) % ni;
    const [g, p] = extGcd(m, ni);
    if ((ri - x) % g !== 0n) return null; // inconsistent
    const lcmMN = (m / g) * ni;
    const mod2 = ni / g;
    const lambda = (((((ri - x) / g) * p) % mod2) + mod2) % mod2;
    x = (((x + m * lambda) % lcmMN) + lcmMN) % lcmMN;
    m = lcmMN;
  }
  return x;
}

/** Floor of the integer `b`-th root of `n ≥ 0`. */
function iroot(n: bigint, b: number): bigint {
  if (n < 2n) return n;
  const bb = BigInt(b);
  // Initial estimate; fall back to a bit-length bound when `n` overflows a float.
  const approx = Math.pow(Number(n), 1 / b);
  let x = Number.isFinite(approx)
    ? BigInt(Math.round(approx))
    : 1n << (BigInt(n.toString(2).length) / bb + 1n);
  if (x < 1n) x = 1n;
  while (x ** bb > n) x -= 1n;
  while ((x + 1n) ** bb <= n) x += 1n;
  return x;
}

/**
 * Is `m ≥ 4` a perfect power `a^b` with `b ≥ 2`? When `oddOnly` is set (the
 * argument was negative) only odd exponents are admissible. Testing every
 * exponent up to `log2(m)` is sufficient (and the redundant composite
 * exponents are cheap).
 */
function isPerfectPowerBigint(
  m: bigint,
  oddOnly: boolean,
  deadline: number | undefined
): boolean {
  const bits = m.toString(2).length;
  for (let b = oddOnly ? 3 : 2; b <= bits; b++) {
    if (oddOnly && b % 2 === 0) continue;
    checkDeadline(deadline);
    const r = iroot(m, b);
    if (r >= 2n && r ** BigInt(b) === m) return true;
  }
  return false;
}

/** Uniform random bigint in `[0, n)` (for `n > 0`). */
function randomBigintBelow(n: bigint): bigint {
  if (n <= 1n) return 0n;
  if (n <= BigInt(Number.MAX_SAFE_INTEGER))
    return BigInt(Math.floor(Math.random() * Number(n)));
  // Rejection-sample enough random 30-bit chunks to cover `n`'s bit length.
  const bits = n.toString(2).length;
  let r: bigint;
  do {
    r = 0n;
    for (let i = 0; i < bits; i += 30)
      r = (r << 30n) | BigInt(Math.floor(Math.random() * (1 << 30)));
    r &= (1n << BigInt(bits)) - 1n;
  } while (r >= n);
  return r;
}

/**
 * The sorted ascending list of positive divisors of `m ≥ 1`. Divisor pairs
 * `(i, m/i)` are collected by trial division up to √m: the small divisors come
 * out ascending and the large ones descending, so reversing the latter yields
 * a single ascending list.
 */
function divisorsAscending(m: bigint, deadline: number | undefined): bigint[] {
  const small: bigint[] = [];
  const large: bigint[] = [];
  let steps = 0;
  for (let i = 1n; i * i <= m; i++) {
    if ((++steps & 0xfff) === 0) checkDeadline(deadline);
    if (m % i === 0n) {
      small.push(i);
      const j = m / i;
      if (j !== i) large.push(j);
    }
  }
  large.reverse();
  return [...small, ...large];
}

/** Euler's totient φ(n) computed from the prime factorization (`n ≥ 1`). */
function eulerPhi(n: bigint): bigint {
  if (n <= 1n) return 1n;
  let result = n;
  for (const p of bigPrimeFactors(n).keys()) result = (result / p) * (p - 1n);
  return result;
}

/** Carmichael's reduced totient λ(n) from the prime factorization (`n ≥ 1`). */
function carmichaelLambda(n: bigint): bigint {
  if (n <= 1n) return 1n;
  let result = 1n;
  for (const [p, e] of bigPrimeFactors(n)) {
    const lambda =
      p === 2n
        ? e === 1
          ? 1n
          : e === 2
            ? 2n
            : 1n << BigInt(e - 2)
        : p ** BigInt(e - 1) * (p - 1n);
    result = lcm(result, lambda);
  }
  return result;
}

/** The Jacobi symbol (a/n) for odd `n > 0`; returns -1, 0, or 1. */
function jacobiSymbol(a: bigint, n: bigint): number {
  a = ((a % n) + n) % n;
  let result = 1;
  while (a !== 0n) {
    while (a % 2n === 0n) {
      a /= 2n;
      const r = n % 8n;
      if (r === 3n || r === 5n) result = -result;
    }
    [a, n] = [n, a];
    if (a % 4n === 3n && n % 4n === 3n) result = -result;
    a %= n;
  }
  return n === 1n ? result : 0;
}

/**
 * Does a primitive root modulo `n` exist? True iff `n` is 1, 2, 4, pᵏ, or 2pᵏ
 * for an odd prime p (callers handle the small cases 1, 2, 4 directly).
 */
function hasPrimitiveRoot(n: bigint): boolean {
  if (n === 1n || n === 2n || n === 4n) return true;
  let m = n;
  let twos = 0;
  while (m % 2n === 0n) {
    m /= 2n;
    twos++;
  }
  if (twos > 1) return false; // divisible by 4 (and > 4)
  if (m === 1n) return false; // a pure power of two > 4
  return bigPrimeFactors(m).size === 1; // odd part is a single prime power
}

/** Reduce a fraction to lowest terms with a positive denominator. */
function reduceRat(num: bigint, den: bigint): [bigint, bigint] {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num < 0n ? -num : num, den);
  return g > 1n ? [num / g, den / g] : [num, den];
}

/**
 * The nth Bernoulli number as a reduced rational `[num, den]` (den > 0), with
 * the convention B₁ = -1/2, via the recurrence
 * `Bₘ = -1/(m+1) · Σ_{k<m} C(m+1, k)·Bₖ`. Exact rational arithmetic throughout.
 */
function bernoulliNumber(
  n: number,
  deadline: number | undefined
): [bigint, bigint] {
  const B: [bigint, bigint][] = [[1n, 1n]]; // B₀ = 1
  for (let m = 1; m <= n; m++) {
    checkDeadline(deadline);
    let sNum = 0n;
    let sDen = 1n;
    let c = 1n; // binomial C(m+1, k), starting at k = 0
    for (let k = 0; k < m; k++) {
      const tNum = c * B[k][0];
      const tDen = B[k][1];
      const g = gcd(sDen, tDen);
      sNum = sNum * (tDen / g) + tNum * (sDen / g);
      sDen = (sDen / g) * tDen;
      [sNum, sDen] = reduceRat(sNum, sDen);
      // C(m+1, k+1) = C(m+1, k) · (m+1-k) / (k+1)
      c = (c * BigInt(m + 1 - k)) / BigInt(k + 1);
    }
    B.push(reduceRat(-sNum, sDen * BigInt(m + 1)));
  }
  return B[n];
}

function sumSquareDigits(k: bigint): bigint {
  return k
    .toString()
    .split('')
    .map((d) => BigInt(d))
    .reduce((sum, d) => sum + d * d, 0n);
}
