import { Decimal } from 'decimal.js';

export const DECIMAL_ZERO = new Decimal(0);
export const DECIMAL_ONE = new Decimal(1);
export const DECIMAL_MINUS_ONE = new Decimal(-1);
export const DECIMAL_NAN = new Decimal(NaN);
export const DECIMAL_POS_INFINITY = new Decimal(+Infinity);
export const DECIMAL_NEG_INFINITY = new Decimal(-Infinity);

export function gcd(a: Decimal, b: Decimal): Decimal {
  //@todo: https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  if (!a.isInteger() || !b.isInteger()) return DECIMAL_NAN;
  while (!b.isZero()) [a, b] = [b, a.modulo(b)];
  return a.abs();
}

export function lcm(a: Decimal, b: Decimal): Decimal {
  return a.mul(b).div(gcd(a, b));
}

export function factorial(n: Decimal | number): Decimal {
  if (typeof n === 'number') n = new Decimal(n);
  if (!n.isInteger() || n.isNegative()) return DECIMAL_NAN;
  if (n.lessThan(10)) {
    return new Decimal(
      [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800][n.toNumber()]
    );
  }

  if (n.gt(Number.MAX_SAFE_INTEGER)) {
    let val = DECIMAL_ONE;
    let i = new Decimal(2);
    while (i.lessThan(n)) {
      val = val.mul(i);
      i = i.add(1);
    }
    return val;
  }

  if (n.modulo(2).eq(1)) {
    return n.times(factorial(n.minus(1)));
  }

  let loop = n.toNumber();
  let sum = n.toNumber();
  let val = n;

  while (loop > 2) {
    loop -= 2;
    sum += loop;
    val = val.mul(sum);
  }
  return val;
}

const gammaG = 7;
const p: Decimal[] = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
].map((x) => new Decimal(x));

const gammaGLn = new Decimal(607).div(128);
const gammaPLn: Decimal[] = [
  0.99999999999999709182, 57.156235665862923517, -59.597960355475491248,
  14.136097974741747174, -0.49191381609762019978, 0.33994649984811888699e-4,
  0.46523628927048575665e-4, -0.98374475304879564677e-4,
  0.15808870322491248884e-3, -0.21026444172410488319e-3,
  0.2174396181152126432e-3, -0.16431810653676389022e-3,
  0.84418223983852743293e-4, -0.2619083840158140867e-4,
  0.36899182659531622704e-5,
].map((x) => new Decimal(x));

// Spouge approximation (suitable for large arguments)
export function lngamma(z: Decimal | number): Decimal {
  if (typeof z === 'number') z = new Decimal(z);
  if (z.isNegative()) return DECIMAL_NAN;
  let x = gammaPLn[0];
  for (let i = gammaPLn.length - 1; i > 0; --i) {
    x = x.add(gammaPLn[i].div(z.add(i)));
  }
  const t = z.add(gammaGLn).add(0.5);
  return Decimal.acos(-1)
    .mul(2)
    .log()
    .mul(0.5)
    .add(t.log().mul(z.add(0.5)).minus(t).add(x.log()).minus(z.log()));
}

// From https://github.com/substack/gamma.js/blob/master/index.js
export function gamma(z: Decimal | number): Decimal {
  if (typeof z === 'number') z = new Decimal(z);
  if (z.lessThan(0.5)) {
    const pi = Decimal.acos(-1);
    return pi.div(
      pi
        .mul(z)
        .sin()
        .mul(gamma(Decimal.sub(1, z)))
    );
  } else if (z.greaterThan(100)) {
    return lngamma(z).exp();
  } else {
    z = z.sub(1);
    let x = p[0];
    for (let i = 1; i < gammaG + 2; i++) {
      x = x.add(p[i].div(z.add(i)));
    }
    const t = z.add(gammaG).add(0.5);
    return Decimal.acos(-1)
      .times(2)
      .sqrt()
      .mul(x.mul(t.neg().exp()).mul(Decimal.pow(t, z.add(0.5))));
  }
}
