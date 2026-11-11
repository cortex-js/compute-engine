// The complex roots of a squarefree polynomial over ℤ in Wolfram's order (the real roots
// increasing, then the complex ones by real part and imaginary part), found in doubles and
// refined to any number of digits by Newton's method in bigint fixed point. The count of real
// roots is exact (a Sturm sequence); a root set that doubles can't order or separate with
// certainty is declined (`undefined`).

import { isSquarefree, realRootCount, type Poly } from './number-field.js';

export interface Complex {
  readonly re: number;
  readonly im: number;
}

/** Roots whose real parts differ by less than this, relative to the root, are one real part. */
const TIE = 1e-9;

/** A real part gap between `TIE` and this is neither a tie nor an order we can vouch for. */
const AMBIGUOUS = 1e-6;

/** A root with |im| below this, relative to the root, is real; the complex ones are above `AMBIGUOUS`. */
const REAL_IM = 1e-9;

/** Past this degree the roots aren't attempted. */
export const MAX_ROOT_DEGREE = 32;

const cmul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const csub = (a: Complex, b: Complex): Complex => ({
  re: a.re - b.re,
  im: a.im - b.im,
});
const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / d,
    im: (a.im * b.re - a.re * b.im) / d,
  };
};
const cabs = (a: Complex): number => Math.hypot(a.re, a.im);

/** p(z) and p′(z) by Horner's rule, `c` constant first. */
function horner(c: readonly number[], z: Complex): [Complex, Complex] {
  let p: Complex = { re: 0, im: 0 };
  let d: Complex = { re: 0, im: 0 };
  for (let i = c.length - 1; i >= 0; i--) {
    const dz = cmul(d, z);
    d = { re: dz.re + p.re, im: dz.im + p.im };
    const pz = cmul(p, z);
    p = { re: pz.re + c[i]!, im: pz.im };
  }
  return [p, d];
}

/** All roots by the Aberth–Ehrlich iteration, or `undefined` when it doesn't settle. */
function aberth(f: Poly): Complex[] | undefined {
  const c = f.map(Number);
  if (c.some((x) => !Number.isFinite(x))) return undefined;
  const n = c.length - 1;
  const lead = Math.abs(c[n]!);
  // Cauchy's bound.
  const radius = 1 + Math.max(...c.slice(0, n).map((x) => Math.abs(x) / lead));
  const z: Complex[] = Array.from({ length: n }, (_, k) => {
    const angle = (2 * Math.PI * k) / n + 0.4;
    return {
      re: radius * 0.5 * Math.cos(angle),
      im: radius * 0.5 * Math.sin(angle),
    };
  });
  for (let iteration = 0; iteration < 1000; iteration++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const [p, d] = horner(c, z[i]!);
      if (p.re === 0 && p.im === 0) continue;
      const ratio = cdiv(p, d);
      let sum: Complex = { re: 0, im: 0 };
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const e = cdiv({ re: 1, im: 0 }, csub(z[i]!, z[j]!));
        sum = { re: sum.re + e.re, im: sum.im + e.im };
      }
      const step = cdiv(ratio, csub({ re: 1, im: 0 }, cmul(ratio, sum)));
      if (!Number.isFinite(step.re) || !Number.isFinite(step.im))
        return undefined;
      z[i] = csub(z[i]!, step);
      worst = Math.max(worst, cabs(step) / Math.max(cabs(z[i]!), 1e-300));
    }
    if (worst < 1e-15) return z;
  }
  return undefined;
}

/**
 * The roots of `f` (squarefree, degree 1 to `MAX_ROOT_DEGREE`) in Wolfram's order, or
 * `undefined` when `f` isn't squarefree or the roots can't be told apart or ordered with certainty.
 */
export function orderedRoots(f: Poly): Complex[] | undefined {
  const n = f.length - 1;
  if (n < 1 || n > MAX_ROOT_DEGREE || f[n] === 0n || !isSquarefree(f))
    return undefined;
  const found = aberth(f);
  if (found === undefined) return undefined;
  const r1 = realRootCount(f);
  // The real roots are the r1 of least |im|: the gap to the next must be clear.
  const byImag = [...found].sort((a, b) => Math.abs(a.im) - Math.abs(b.im));
  const scale = (z: Complex): number => Math.max(cabs(z), 1e-300);
  if (r1 > 0 && Math.abs(byImag[r1 - 1]!.im) > REAL_IM * scale(byImag[r1 - 1]!))
    return undefined;
  if (r1 < n && Math.abs(byImag[r1]!.im) < AMBIGUOUS * scale(byImag[r1]!))
    return undefined;
  const real = byImag.slice(0, r1).map((z) => ({ re: z.re, im: 0 }));
  const complex = byImag.slice(r1);
  // Conjugates share a real part exactly: pair them off so a tie is a tie.
  const pairs: Complex[] = [];
  const left = [...complex];
  while (left.length > 0) {
    const z = left.shift()!;
    const at = left.findIndex(
      (w) =>
        Math.abs(w.re - z.re) < 1e-7 * scale(z) &&
        Math.abs(w.im + z.im) < 1e-7 * scale(z)
    );
    if (at < 0) return undefined;
    const [w] = left.splice(at, 1);
    const re = (z.re + w!.re) / 2;
    const im = (Math.abs(z.im) + Math.abs(w!.im)) / 2;
    pairs.push({ re, im: -im }, { re, im });
  }
  real.sort((a, b) => a.re - b.re);
  for (let i = 1; i < real.length; i++)
    if (real[i]!.re - real[i - 1]!.re < AMBIGUOUS * scale(real[i]!))
      return undefined;
  // By real part, then imaginary part; real parts within the tie tolerance are one.
  pairs.sort((a, b) => a.re - b.re);
  for (let i = 1; i < pairs.length; i++) {
    const gap = pairs[i]!.re - pairs[i - 1]!.re;
    if (gap > TIE * scale(pairs[i]!) && gap < AMBIGUOUS * scale(pairs[i]!))
      return undefined;
  }
  const out: Complex[] = [...real];
  for (let i = 0; i < pairs.length;) {
    let j = i + 1;
    while (
      j < pairs.length &&
      pairs[j]!.re - pairs[i]!.re <= TIE * scale(pairs[i]!)
    )
      j++;
    out.push(...pairs.slice(i, j).sort((a, b) => a.im - b.im));
    i = j;
  }
  return out;
}

// --- digits ---------------------------------------------------------------------------------

/** A complex number in fixed point: `re / 10^scale`, `im / 10^scale`. */
interface Fixed {
  re: bigint;
  im: bigint;
}

/** Newton steps tried before the refinement declines. */
const NEWTON_STEPS = 200;

/** Guard digits carried past the digits asked for. */
const GUARD = 12;

/**
 * The root of `f` near `z` to `digits` significant digits, as `{ re, im }` decimal strings, or
 * `undefined` when Newton's method doesn't converge to a root near `z`. A real `z` (`im` 0) is
 * refined on the real line.
 */
export function refineRoot(
  f: Poly,
  z: Complex,
  digits: number
): { re: string; im: string } | undefined {
  const magnitude = Math.max(cabs(z), 1e-300);
  const places = Math.max(
    0,
    digits + GUARD - Math.floor(Math.log10(magnitude))
  );
  const one = 10n ** BigInt(places);
  // A double as the 17 digits it prints with, scaled.
  const toFixed = (x: number): bigint => {
    if (x === 0) return 0n;
    const [mantissa, exponent] = x.toExponential(16).split('e');
    const m = BigInt(mantissa!.replace('.', ''));
    const shift = places + Number(exponent) - 16;
    return shift >= 0 ? m * 10n ** BigInt(shift) : m / 10n ** BigInt(-shift);
  };
  const mul = (a: Fixed, b: Fixed): Fixed => ({
    re: (a.re * b.re - a.im * b.im) / one,
    im: (a.re * b.im + a.im * b.re) / one,
  });
  const start: Fixed = { re: toFixed(z.re), im: toFixed(z.im) };
  let w = start;
  const real = z.im === 0;
  for (let step = 0; step < NEWTON_STEPS; step++) {
    let p: Fixed = { re: 0n, im: 0n };
    let d: Fixed = { re: 0n, im: 0n };
    for (let i = f.length - 1; i >= 0; i--) {
      const dz = mul(d, w);
      d = { re: dz.re + p.re, im: dz.im + p.im };
      const pz = mul(p, w);
      p = { re: pz.re + f[i]! * one, im: pz.im };
    }
    const norm = d.re * d.re + d.im * d.im;
    if (norm === 0n) return undefined;
    // step = p / d, in fixed point.
    const stepRe = ((p.re * d.re + p.im * d.im) * one) / norm;
    const stepIm = real ? 0n : ((p.im * d.re - p.re * d.im) * one) / norm;
    w = { re: w.re - stepRe, im: w.im - stepIm };
    const size =
      (stepRe < 0n ? -stepRe : stepRe) + (stepIm < 0n ? -stepIm : stepIm);
    if (size > 4n) continue;
    // It must still be the root the doubles named.
    const moved = Math.hypot(
      Number(((w.re - start.re) * 10n ** 6n) / one),
      Number(((w.im - start.im) * 10n ** 6n) / one)
    );
    if (moved / 1e6 > 1e-6 * magnitude) return undefined;
    return {
      re: decimal(w.re, places, digits),
      im: decimal(w.im, places, digits),
    };
  }
  return undefined;
}

/** `v / 10^places` rounded to `digits` significant digits, as a decimal string. */
function decimal(v: bigint, places: number, digits: number): string {
  if (v === 0n) return '0';
  const negative = v < 0n;
  let mag = negative ? -v : v;
  let exponent = -places;
  const length = mag.toString().length;
  if (length > digits) {
    const drop = length - digits;
    mag = (mag + 10n ** BigInt(drop) / 2n) / 10n ** BigInt(drop);
    exponent += drop;
  }
  return `${negative ? '-' : ''}${mag}e${exponent}`;
}
