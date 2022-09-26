import { Decimal } from 'decimal.js';
import { IComputeEngine } from '../public';

export function gcd(a: Decimal, b: Decimal): Decimal {
  //@todo: https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  console.assert(a.isInteger() && b.isInteger());
  while (!b.isZero()) [a, b] = [b, a.modulo(b)];
  return a.abs();
}

export function lcm(a: Decimal, b: Decimal): Decimal {
  return a.mul(b).div(gcd(a, b));
}

//  Return the "reduced form" of the rational, that is a rational
// such that gcd(numer, denom) = 1 and denom > 0
export function reducedRational([a, b]: [Decimal, Decimal]): [
  Decimal,
  Decimal
] {
  if (a.equals(1) || b.equals(1)) return [a, b];
  if (b.lessThan(0)) [a, b] = [a.neg(), b.neg()];
  const g = gcd(a, b);
  //  If the gcd is 0, return the rational unchanged
  if (g.lessThanOrEqualTo(1)) return [a, b];
  return [a.div(g), b.div(g)];
}

export function factorial(ce: IComputeEngine, n: Decimal): Decimal {
  if (!n.isInteger() || n.isNegative()) return ce._DECIMAL_NAN;
  if (n.lessThan(10))
    return ce.decimal(
      [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800][n.toNumber()]
    );

  if (n.gt(Number.MAX_SAFE_INTEGER)) {
    let val = ce._DECIMAL_ONE;
    let i = ce._DECIMAL_TWO;
    while (i.lessThan(n)) {
      val = val.mul(i);
      i = i.add(1);
    }
    return val;
  }

  if (n.modulo(2).eq(1)) {
    return n.times(factorial(ce, n.minus(1)));
  }

  let loop = n.toNumber();
  let sum = n;
  let val = n;

  while (loop > 2) {
    loop -= 2;
    sum = sum.add(loop);
    val = val.mul(sum);
  }
  return val;
}

const gammaG = 7;

// Spouge approximation (suitable for large arguments)
export function lngamma(ce: IComputeEngine, z: Decimal): Decimal {
  if (z.isNegative()) return ce._DECIMAL_NAN;

  const GAMMA_P_LN = ce.cache<Decimal[]>('gamma-p-ln', () => {
    return [
      '0.99999999999999709182',
      '57.156235665862923517',
      '-59.597960355475491248',
      '14.136097974741747174',
      '-0.49191381609762019978',
      '0.33994649984811888699e-4',
      '0.46523628927048575665e-4',
      '-0.98374475304879564677e-4',
      '0.15808870322491248884e-3',
      '-0.21026444172410488319e-3',
      '0.2174396181152126432e-3',
      '-0.16431810653676389022e-3',
      '0.84418223983852743293e-4',
      '-0.2619083840158140867e-4',
      '0.36899182659531622704e-5',
    ].map((x) => ce.decimal(x));
  });

  let x = GAMMA_P_LN[0];
  for (let i = GAMMA_P_LN.length - 1; i > 0; --i) {
    x = x.add(GAMMA_P_LN[i].div(z.add(i)));
  }

  const GAMMA_G_LN = ce.cache('gamma-g-ln', () => ce.decimal(607).div(128));

  const t = z.add(GAMMA_G_LN).add(ce._DECIMAL_HALF);
  return ce._DECIMAL_NEGATIVE_ONE
    .acos()
    .mul(ce._DECIMAL_TWO)
    .log()
    .mul(ce._DECIMAL_HALF)
    .add(
      t.log().mul(z.add(ce._DECIMAL_HALF)).minus(t).add(x.log()).minus(z.log())
    );
}

// From https://github.com/substack/gamma.js/blob/master/index.js
export function gamma(ce: IComputeEngine, z: Decimal): Decimal {
  if (z.lessThan(ce._DECIMAL_HALF)) {
    const pi = ce._DECIMAL_NEGATIVE_ONE.acos();
    return pi.div(
      pi
        .mul(z)
        .sin()
        .mul(gamma(ce, ce._DECIMAL_ONE.sub(z)))
    );
  }

  if (z.greaterThan(100)) return lngamma(ce, z).exp();

  z = z.sub(1);

  // coefficients for gamma=7, kmax=8  Lanczos method
  // Source: GSL/specfunc/gamma.c
  const LANCZOS_7_C = ce.cache<Decimal[]>('lanczos-7-c', () => {
    return [
      '0.99999999999980993227684700473478',
      '676.520368121885098567009190444019',
      '-1259.13921672240287047156078755283',
      '771.3234287776530788486528258894',
      '-176.61502916214059906584551354',
      '12.507343278686904814458936853',
      '-0.13857109526572011689554707',
      '9.984369578019570859563e-6',
      '1.50563273514931155834e-7',
    ].map(ce.decimal);
  });

  let x = LANCZOS_7_C[0];
  for (let i = 1; i < gammaG + 2; i++) x = x.add(LANCZOS_7_C[i].div(z.add(i)));

  const t = z.add(gammaG).add(ce._DECIMAL_HALF);
  return ce._DECIMAL_NEGATIVE_ONE
    .acos()
    .times(ce._DECIMAL_TWO)
    .sqrt()
    .mul(x.mul(t.neg().exp()).mul(t.pow(z.add(ce._DECIMAL_HALF))));
}

/**
 * If the exponent of the decimal number is in the range of the exponents
 * for machine numbers,return true.
 */
export function isInMachineRange(d: Decimal): boolean {
  // Are there too many significant digits?
  // Maximum Safe Integer is 9007199254740991
  // Digits in Decimal are stored by blocks of 7.
  // Three blocks, with the first block = 90 is close to the maximum
  if (d.d.length > 3 || (d.d.length === 3 && d.d[0] >= 90)) {
    return false;
  }

  // Is the exponent within range?
  // With a binary 64 IEEE 754 number:
  // significant bits: 53 -> 15 digits
  // exponent bits: 11. emax = 307, emin = -306)
  return d.e < 308 && d.e > -306;
}

// export function asMachineNumber(d: Decimal): number | null {
//   if (d.precision() < 15 && d.e < 308 && d.e > -306) return d.toNumber();
//   return null;
// }
