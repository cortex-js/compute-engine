// Algebraic numbers as Wolfram has them: PolynomialRoot (Wolfram's Root), MinimalPolynomial,
// IsAlgebraicInteger, AlgebraicNumberNorm and AlgebraicNumberTrace, and the field an algebraic
// number generates: NumberFieldDiscriminant, NumberFieldIntegralBasis, NumberFieldSignature.
// An argument is read as a polynomial in one generator — a radical of a rational, i, the golden
// ratio or a PolynomialRoot — and anything else is left unevaluated. The arithmetic is the
// engine's `RationalNumberField`. The reading is checked against the numeric value of the
// argument, so a radical the engine takes on another branch (the real cube root of a negative
// number) is declined, not read as the principal one.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { checkDeadlineEvery } from '../../common/interruptible.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import {
  PolynomialBudgetExceeded,
  rationalCoefficient as q,
  rationalField as Q,
} from '../polynomial/exact-field.js';
import {
  certifiedField,
  validateAlgebraicGenerator,
} from '../polynomial/boxed-number-field.js';
import type {
  NumberFieldElement,
  RationalNumberField,
} from '../polynomial/number-field.js';
import { splittingField } from '../polynomial/splitting-field.js';
import {
  degree,
  hermiteBasis,
  isIntegral,
  maximalOrder,
  minimalPolynomial,
  orderDiscriminant,
  type Order,
  type Poly,
  realRootCount,
} from '../numerics/number-field.js';
import {
  type Complex,
  matchRoots,
  orderedRoots,
  refineRoot,
} from '../numerics/ordered-polynomial-roots.js';
import { gcd } from '../numerics/numeric-bigint.js';

type Json = unknown;

/** A rational, `num / den` with `den > 0`. */
interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

const rational = (num: bigint, den = 1n): Rational => {
  if (den < 0n) [num, den] = [-num, -den];
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g };
};

const rationalJson = (r: Rational): Json =>
  r.den === 1n
    ? numberJson(r.num)
    : ['Rational', numberJson(r.num), numberJson(r.den)];

/** An integer literal, as a string past the doubles' exact range. */
const numberJson = (n: bigint): Json =>
  n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= -BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(n)
    : { num: n.toString() };

const head = (j: Json): string | undefined =>
  Array.isArray(j) && typeof j[0] === 'string' ? j[0] : undefined;
const args = (j: Json): Json[] => (Array.isArray(j) ? j.slice(1) : []);

/** A rational literal, as MathJSON writes one. */
function rationalOf(j: Json): Rational | undefined {
  if (typeof j === 'number')
    return Number.isInteger(j) ? rational(BigInt(j)) : undefined;
  if (typeof j === 'object' && j !== null && !Array.isArray(j) && 'num' in j) {
    const text = String((j as { num: unknown }).num);
    return /^-?\d+$/.test(text) ? rational(BigInt(text)) : undefined;
  }
  const h = head(j);
  if (h === 'Rational') {
    const [a, b] = args(j).map(rationalOf);
    return a && b && a.den === 1n && b.den === 1n && b.num !== 0n
      ? rational(a.num, b.num)
      : undefined;
  }
  if (h === 'Negate') {
    const a = rationalOf(args(j)[0]);
    return a && rational(-a.num, a.den);
  }
  return undefined;
}

// --- the generator --------------------------------------------------------------------------

/** Fields past this degree aren't attempted. */
const MAX_DEGREE = 12;

/** Powers past this, of the generator or of a sum in it, aren't expanded; nested powers multiply. */
const MAX_POWER = 256n;

/** Work the splitting field of one polynomial may take: a degree 4 polynomial with group S₄ stops here, not after seconds. */
const SPLITTING_OPERATIONS = 500_000;

const POLYNOMIAL_ROOT = 'PolynomialRoot';

/**
 * What an argument is written in: one radical bᵐ/ᵏ of a rational, or one PolynomialRoot: the
 * `k`-th root of `polynomial`, a primitive integer polynomial with positive leading coefficient,
 * or an abstract root of it that no embedding picks (`k` is absent).
 */
type Atom = RadicalAtom | RootAtom;

interface RadicalAtom {
  readonly kind: 'radical';
  readonly base: Rational;
  readonly index: number;
  readonly power: number;
}

interface RootAtom {
  readonly kind: 'root';
  /** The expression the root is written as. */
  readonly written: Json;
  readonly polynomial: readonly bigint[];
  readonly k: number | undefined;
}

/** The deadline of the engine's current time limit, checked every so many calls (it throws to stop). */
const tickOf = (ce: ComputeEngine) => () =>
  checkDeadlineEvery(ce._deadlineFrame, 0x3f);

/** The base and exponent of `j` when it is `Sqrt(b)`, `Root(b, k)` or `Power(b, m/k)` with b rational and 0 < m/k, k > 1. */
function radicalParts(
  j: Json
): { base: Rational; exponent: Rational } | undefined {
  const h = head(j);
  const [a, b] = args(j);
  let base: Rational | undefined;
  let exponent: Rational | undefined;
  if (h === 'Sqrt') [base, exponent] = [rationalOf(a), rational(1n, 2n)];
  else if (h === 'Root') {
    const k = rationalOf(b);
    [base, exponent] = [
      rationalOf(a),
      k && k.den === 1n && k.num > 1n ? rational(1n, k.num) : undefined,
    ];
  } else if (h === 'Power') [base, exponent] = [rationalOf(a), rationalOf(b)];
  if (
    base === undefined ||
    exponent === undefined ||
    exponent.den === 1n ||
    exponent.num < 0n
  )
    return undefined;
  return { base, exponent };
}

/**
 * `j` with i, the golden ratio and `Complex(a, b)` written as square roots, i·√c (c > 0) as √−c,
 * so a Gaussian or Eisenstein number is one radical, and the radical of a negative base with an
 * odd index as the engine takes it: (−1)ᵐ times the radical of the positive base (the real root).
 */
function normalize(j: Json): Json {
  if (j === 'ImaginaryUnit') return ['Sqrt', -1];
  if (j === 'GoldenRatio')
    return ['Multiply', ['Rational', 1, 2], ['Add', 1, ['Sqrt', 5]]];
  const h = head(j);
  if (h === undefined || h === POLYNOMIAL_ROOT) return j;
  if (h === 'Complex') {
    const [re, im] = args(j);
    return normalize(['Add', re, timesI(im)]);
  }
  const ops = args(j).map(normalize);
  const node = [h, ...ops];
  const parts = radicalParts(node);
  if (
    parts !== undefined &&
    parts.base.num < 0n &&
    parts.exponent.den % 2n === 1n
  ) {
    const positive = [
      'Power',
      rationalJson(rational(-parts.base.num, parts.base.den)),
      rationalJson(parts.exponent),
    ];
    return parts.exponent.num % 2n === 1n ? ['Negate', positive] : positive;
  }
  if (h === 'Multiply') {
    // i·√c = √−c for c > 0: then i and √c are one radical, not two. Only i itself, not Power(−1, 3/2).
    const i = ops.findIndex((o) => {
      const r = radicalOf(o);
      return (
        r?.base.num === -1n &&
        r.base.den === 1n &&
        r.index === 2 &&
        r.power === 1
      );
    });
    const root = ops.findIndex((o, k) => {
      const r = radicalOf(o);
      return (
        k !== i &&
        r !== undefined &&
        r.index === 2 &&
        r.power === 1 &&
        r.base.num > 0n
      );
    });
    if (i >= 0 && root >= 0) {
      const r = radicalOf(ops[root])!;
      const rest = ops.filter((_, k) => k !== i && k !== root);
      return [
        'Multiply',
        ...rest,
        ['Sqrt', rationalJson(rational(-r.base.num, r.base.den))],
      ];
    }
  }
  return node;
}

/**
 * i·y, with i placed among the factors of y: i·(−z) is −(i·z), i·(a/b) is (i·a)/b, and i·(a·b)
 * is a·b·i. A square root of y is then in one product with i, which `normalize` merges: the
 * root of x² + x + 2 is `Complex(0, Negate(Sqrt(7)))` in its sum, and that is i·(−√7) = −√−7.
 */
function timesI(y: Json): Json {
  const h = head(y);
  const ops = args(y);
  if (h === 'Negate') return ['Negate', timesI(ops[0])];
  if (h === 'Divide') return ['Divide', timesI(ops[0]), ops[1]];
  if (h === 'Multiply') return ['Multiply', ...ops, 'ImaginaryUnit'];
  return ['Multiply', y, 'ImaginaryUnit'];
}

/**
 * `j` as bᵐ/ᵏ, b rational, 0 < m < k in lowest terms, on the principal branch. A negative base
 * with an odd index is the real root in the engine, which `normalize` rewrites, so it isn't
 * read here; an index past `MAX_DEGREE` can never be one generator's, so it is declined at once.
 */
function radicalOf(j: Json): RadicalAtom | undefined {
  const parts = radicalParts(j);
  if (parts === undefined) return undefined;
  const { base, exponent } = parts;
  if (
    base.num === 0n ||
    exponent.num > MAX_POWER ||
    exponent.den > BigInt(MAX_DEGREE)
  )
    return undefined;
  if (base.num < 0n && exponent.den % 2n === 1n) return undefined;
  return {
    kind: 'radical',
    base,
    index: Number(exponent.den),
    power: Number(exponent.num),
  };
}

/** The atoms of `j` and the radicals and roots in them; `false` for what isn't read. */
function atomsOf(
  j: Json,
  ce: ComputeEngine,
  into: Atom[],
  scale = 1n
): boolean {
  if (rationalOf(j) !== undefined) return true;
  const radical = radicalOf(j);
  if (radical !== undefined) {
    into.push(radical);
    return true;
  }
  const h = head(j);
  if (h === POLYNOMIAL_ROOT) {
    const [source, x, k] = args(j);
    const root = rootAtom(ce.expr(source as MathJsonExpression), x, k);
    if (root === undefined) return false;
    into.push(root);
    return true;
  }
  if (h === 'Add' || h === 'Multiply' || h === 'Negate' || h === 'Subtract')
    return args(j).every((o) => atomsOf(o, ce, into, scale));
  if (h === 'Divide') return args(j).every((o) => atomsOf(o, ce, into, scale));
  if (h === 'Power' || h === 'Square') {
    const e = h === 'Square' ? rational(2n) : rationalOf(args(j)[1]);
    if (e === undefined || e.den !== 1n) return false;
    const size = e.num < 0n ? -e.num : e.num;
    const next = scale * (size < 1n ? 1n : size);
    return next <= MAX_POWER && atomsOf(args(j)[0], ce, into, next);
  }
  return false;
}

/** A rational polynomial cleared of denominators and content, leading coefficient positive: the same roots. */
function primitivePolynomial(cs: readonly Rational[]): bigint[] {
  const den = cs.reduce((l, c) => (l * c.den) / gcd(l, c.den), 1n);
  const cleared = cs.map((c) => (c.num * den) / c.den);
  const g = cleared.reduce((x, c) => gcd(x, c), 0n);
  const sign = cleared[cleared.length - 1]! < 0n ? -1n : 1n;
  return cleared.map((c) => (sign * c) / g);
}

/**
 * `PolynomialRoot(p, x, k)` as an atom: `p` rational in `x`, `k` an integer from 1 to its degree,
 * or absent for the abstract root. The key leaves the variable's name out, so `x³ − 2` in `x` is
 * `y³ − 2` in `y`.
 */
function rootAtom(p: Expression, x: Json, kj: Json): RootAtom | undefined {
  const cs = coefficientsOf(p, x);
  if (cs === undefined || cs.length > MAX_DEGREE + 1) return undefined;
  const polynomial = primitivePolynomial(cs);
  if (kj === undefined)
    return {
      kind: 'root',
      written: [POLYNOMIAL_ROOT, p.json, x],
      polynomial,
      k: undefined,
    };
  const k = rationalOf(kj);
  if (
    k === undefined ||
    k.den !== 1n ||
    k.num < 1n ||
    k.num > BigInt(cs.length - 1)
  )
    return undefined;
  return {
    kind: 'root',
    written: [POLYNOMIAL_ROOT, p.json, x, Number(k.num)],
    polynomial,
    k: Number(k.num),
  };
}

/** A polynomial's coefficients in the variable `x`, constant first; `undefined` unless rational and free of other unknowns. */
function coefficientsOf(p: Expression, x: Json): Rational[] | undefined {
  if (typeof x !== 'string' || p.unknowns.some((u) => u !== x))
    return undefined;
  const list = getPolynomialCoefficients(p, x);
  if (list === null || list.length < 2) return undefined;
  const cs = list.map((c) => rationalOf(c.json));
  return cs.every((c) => c !== undefined) ? (cs as Rational[]) : undefined;
}

/** The field an argument lives in: θ a root of monic `f`, and the generator the argument is written in. */
interface GeneratedField {
  readonly K: RationalNumberField;
  /** The generator g, as an element of K: θ = scale·g. */
  readonly generator: NumberFieldElement;
  readonly scale: bigint;
  /** The generator as an expression, its power `k` given; absent when no one expression generates the field. */
  readonly power: ((k: number) => Json) | undefined;
  /** The root `k` of a `PolynomialRoot`, as an element, when the field holds several of one polynomial's roots. */
  readonly rootAt?: (k: number) => NumberFieldElement | undefined;
  /** The complex number θ stands for: the embedding the argument's numeric value is read in. `null` for an abstract generator, which has none. */
  readonly theta: () => Complex | undefined | null;
}

const lcm = (a: number, b: number): number =>
  (a * b) / Number(gcd(BigInt(a), BigInt(b)));

/** θ' = aₙ·θ is a root of the monic integer polynomial a₀aₙⁿ⁻¹ + … + x, θ a root of `a`. */
const monicOf = (a: readonly bigint[]): bigint[] => {
  const n = a.length - 1;
  return a.map((c, i) => (i === n ? 1n : c * a[n]! ** BigInt(n - 1 - i)));
};

/** The field of monic `f`, when the engine's factorization proves it irreducible; a proof past its budget is no. */
function certify(
  ce: ComputeEngine,
  f: readonly bigint[]
): RationalNumberField | undefined {
  try {
    return certifiedField(
      f.map((c) => q(c)),
      { check: tickOf(ce) }
    );
  } catch (e) {
    if (e instanceof RangeError || e instanceof PolynomialBudgetExceeded)
      return undefined;
    throw e;
  }
}

/** The integer polynomial with the roots of the rational `m`, primitive. */
function integerMultiple(
  m: readonly { numerator: bigint; denominator: bigint }[]
): bigint[] {
  const den = m.reduce(
    (l, c) => (l * c.denominator) / gcd(l, c.denominator),
    1n
  );
  return m.map((c) => (c.numerator * den) / c.denominator);
}

/**
 * The field several roots of one irreducible polynomial generate: its splitting field, which the
 * engine builds abstractly as ℚ(β). One embedding of ℚ(β) into ℂ is chosen, and each numbered
 * root is the root of the polynomial that sits at the number `orderedRoots` gives it there;
 * every embedding names the roots consistently, so any one serves.
 */
function splittingFieldOf(
  ce: ComputeEngine,
  atoms: readonly RootAtom[]
): GeneratedField | undefined {
  const a = atoms[0]!.polynomial;
  const n = a.length - 1;
  if (n > MAX_DEGREE) return undefined;
  if (certify(ce, monicOf(a)) === undefined) return undefined;
  let split;
  try {
    split = splittingField(
      a.map((c) => q(c)),
      {
        maxFieldDegree: MAX_DEGREE,
        maxOperations: SPLITTING_OPERATIONS,
        check: tickOf(ce),
      }
    );
  } catch (e) {
    if (e instanceof RangeError) return undefined;
    throw e;
  }
  if (
    split.status !== 'complete' ||
    split.roots.length !== n ||
    split.roots.some((r) => r.multiplicity !== 1) ||
    split.field.degree > MAX_DEGREE
  )
    return undefined;
  const K = split.field;
  const roots = split.roots.map((r) => r.value);
  const m = integerMultiple(K.definingPolynomial);
  const zs = orderedRoots(m, ce._deadlineFrame);
  // Which root of the polynomial each element is: proved in ball arithmetic at the embedding.
  const at = matchRoots(
    a,
    m,
    roots.map((r) => r.coefficients),
    ce._deadlineFrame
  );
  if (zs === undefined || at === undefined || at.length !== n) return undefined;
  const theta = zs[0]!;
  return {
    K,
    generator: K.generator,
    scale: 1n,
    power: undefined,
    rootAt: (k) => {
      const j = at.indexOf(k);
      return j >= 0 ? roots[j] : undefined;
    },
    theta: () => theta,
  };
}

/** The field `atoms` generate, when it is one generator's. */
function fieldOf(
  ce: ComputeEngine,
  atoms: readonly Atom[]
): GeneratedField | undefined {
  if (atoms.length === 0) {
    const K = certify(ce, [0n, 1n]);
    return (
      K && {
        K,
        generator: K.zero,
        scale: 1n,
        power: () => 1,
        theta: () => ({ re: 0, im: 0 }),
      }
    );
  }
  const first = atoms[0]!;
  if (first.kind === 'root') {
    if (
      atoms.some(
        (a) =>
          a.kind !== 'root' ||
          a.polynomial.join(',') !== first.polynomial.join(',') ||
          (a.k === undefined) !== (first.k === undefined)
      )
    )
      return undefined;
    if (atoms.some((a) => a.kind === 'root' && a.k !== first.k))
      return splittingFieldOf(ce, atoms as RootAtom[]);
    const a = first.polynomial;
    const n = a.length - 1;
    if (n > MAX_DEGREE) return undefined;
    const lead = a[n]!;
    const K = certify(ce, monicOf(a));
    if (K === undefined) return undefined;
    const k = first.k;
    const theta = (): Complex | undefined | null => {
      if (k === undefined) return null;
      const z = orderedRoots(a, ce._deadlineFrame)?.[k - 1];
      return z && { re: z.re * Number(lead), im: z.im * Number(lead) };
    };
    return {
      K,
      generator: K.element([Q.zero, q(1n, lead)]),
      scale: lead,
      power: (e) => (e === 1 ? first.written : ['Power', first.written, e]),
      theta,
    };
  }
  // Radicals of one base b: the generator is b^(1/L), L the indices' lcm.
  if (
    atoms.some(
      (a) =>
        a.kind !== 'radical' ||
        a.base.num !== first.base.num ||
        a.base.den !== first.base.den
    )
  )
    return undefined;
  const L = atoms.reduce((l, a) => lcm(l, (a as typeof first).index), 1);
  if (L > MAX_DEGREE) return undefined;
  const { num: u, den: v } = first.base;
  // θ' = v·b^(1/L) is a root of x^L − u·v^(L−1).
  const c = u * v ** BigInt(L - 1);
  const K = certify(ce, [-c, ...Array.from({ length: L - 1 }, () => 0n), 1n]);
  if (K === undefined) return undefined;
  const b = rationalJson(first.base);
  return {
    K,
    generator: K.element([Q.zero, q(1n, v)]),
    scale: v,
    power: (k) =>
      L === 2 && k === 1 ? ['Sqrt', b] : ['Power', b, ['Rational', k, L]],
    // The principal L-th root of c: a negative c has only even indices here.
    theta: () => {
      const modulus = Math.pow(Math.abs(Number(c)), 1 / L);
      const angle = c < 0n ? Math.PI / L : 0;
      return { re: modulus * Math.cos(angle), im: modulus * Math.sin(angle) };
    },
  };
}

/** An argument read as an element of the field it generates. */
interface Read {
  readonly field: GeneratedField;
  readonly x: NumberFieldElement;
}

/** `x` at θ, and the sum of its terms' sizes (what a cancellation in it can cost). */
function approximate(
  x: NumberFieldElement,
  theta: Complex
): { value: Complex; size: number } | undefined {
  let value: Complex = { re: 0, im: 0 };
  let power: Complex = { re: 1, im: 0 };
  let size = 0;
  for (const c of x.coefficients) {
    const t = Number(c.numerator) / Number(c.denominator);
    value = { re: value.re + t * power.re, im: value.im + t * power.im };
    size += Math.abs(t) * Math.hypot(power.re, power.im);
    power = {
      re: power.re * theta.re - power.im * theta.im,
      im: power.re * theta.im + power.im * theta.re,
    };
  }
  return Number.isFinite(value.re) &&
    Number.isFinite(value.im) &&
    Number.isFinite(size)
    ? { value, size }
    : undefined;
}

/**
 * Whether `x` in `field` is the number the engine has for `arg`: the reading assumes one branch
 * for every radical, and a branch it didn't read (a root of a negative number, an index of a
 * PolynomialRoot) shows up here as a different value. An abstract generator has no value to check.
 */
function agreesWith(
  arg: Expression,
  field: GeneratedField,
  x: NumberFieldElement
): boolean {
  const theta = field.theta();
  if (theta === null) return true;
  const mine = theta && approximate(x, theta);
  const n = arg.N();
  if (mine === undefined || !Number.isFinite(n.re) || !Number.isFinite(n.im))
    return false;
  const gap = Math.hypot(n.re - mine.value.re, n.im - mine.value.im);
  return gap <= 1e-9 * (mine.size + Math.hypot(n.re, n.im));
}

/** Runs `f`, and declines (`undefined`) when an exact computation runs past its budget. */
function withinBudget<T>(f: () => T | undefined): T | undefined {
  try {
    return f();
  } catch (e) {
    if (e instanceof PolynomialBudgetExceeded) return undefined;
    throw e;
  }
}

function read(ce: ComputeEngine, arg: Expression): Read | undefined {
  // Exactly: a PolynomialRoot of degree 2 or less is written as the radicals it evaluates to.
  const exact = arg.evaluate();
  const j = normalize(exact.json);
  const atoms: Atom[] = [];
  if (!atomsOf(j, ce, atoms)) return undefined;
  return withinBudget(() => {
    const field = fieldOf(ce, atoms);
    if (field === undefined) return undefined;
    const x = elementOf(ce, j, field);
    return x !== undefined && agreesWith(exact, field, x)
      ? { field, x }
      : undefined;
  });
}

function elementOf(
  ce: ComputeEngine,
  j: Json,
  { K, generator, rootAt }: GeneratedField
): NumberFieldElement | undefined {
  const tick = tickOf(ce);
  const constant = (r: Rational): NumberFieldElement =>
    K.element([q(r.num, r.den)]);
  // Square and multiply: a power of a sum costs its exponent's bits, not the exponent.
  const pow = (x: NumberFieldElement, k: number): NumberFieldElement => {
    let out = K.one;
    let square = x;
    for (let e = k; e > 0; e >>= 1) {
      tick();
      if (e & 1) out = K.mul(out, square);
      if (e > 1) square = K.mul(square, square);
    }
    return out;
  };
  const go = (e: Json): NumberFieldElement | undefined => {
    const r = rationalOf(e);
    if (r !== undefined) return constant(r);
    const radical = radicalOf(e);
    if (radical !== undefined)
      return pow(generator, (radical.power * K.degree) / radical.index);
    const h = head(e);
    const ops = args(e);
    if (h === POLYNOMIAL_ROOT) {
      if (rootAt === undefined || ops.length < 3) return generator;
      const k = rationalOf(ops[2]);
      return k && rootAt(Number(k.num));
    }
    if (h === 'Add' || h === 'Subtract') {
      const xs = ops.map(go);
      if (xs.some((x) => x === undefined)) return undefined;
      return xs.reduce((s, x, i) =>
        K.add(s!, h === 'Subtract' && i > 0 ? K.neg(x!) : x!)
      );
    }
    if (h === 'Negate') {
      const x = go(ops[0]);
      return x && K.neg(x);
    }
    if (h === 'Multiply') {
      const xs = ops.map(go);
      if (xs.some((x) => x === undefined)) return undefined;
      return xs.reduce((p, x) => K.mul(p!, x!), K.one);
    }
    if (h === 'Divide') {
      const [x, d] = ops.map(go);
      return x && d && !K.isZero(d) ? K.mul(x, K.inv(d)) : undefined;
    }
    if (h === 'Power' || h === 'Square') {
      const k = h === 'Square' ? 2 : Number(rationalOf(ops[1])!.num);
      const x = go(ops[0]);
      if (x === undefined) return undefined;
      if (k >= 0) return pow(x, k);
      return K.isZero(x) ? undefined : pow(K.inv(x), -k);
    }
    return undefined;
  };
  return go(j);
}

// --- what the heads answer ------------------------------------------------------------------

const polynomialIn = (coefficients: readonly bigint[], x: Json): Json => [
  'Add',
  ...coefficients.flatMap((c, i) =>
    c === 0n
      ? []
      : [
          i === 0
            ? numberJson(c)
            : ['Multiply', numberJson(c), i === 1 ? x : ['Power', x, i]],
        ]
  ),
];

/** `x`'s minimal polynomial over ℚ, primitive, positive leading coefficient, constant first. */
const minimalOf = ({ field, x }: Read, ce: ComputeEngine): bigint[] =>
  minimalPolynomial(field.K, x, ce._deadlineFrame);

/**
 * The field ℚ(a) of the argument a read: the monic polynomial of y = lead·a (a's minimal
 * polynomial scaled).
 */
interface Subfield {
  readonly f: Poly;
  readonly lead: bigint;
}

function subfieldOf(r: Read, ce: ComputeEngine): Subfield {
  const m = minimalOf(r, ce);
  const d = degree(m);
  const lead = m[d]!;
  return {
    f: m.map((c, i) => (i === d ? 1n : c * lead ** BigInt(d - 1 - i))),
    lead,
  };
}

/**
 * O_K's basis as Wolfram writes it: lower triangular on the powers of a, where the order's
 * coordinates are on those of y = v·a; the i-th is led by aⁱ/dᵢ, each lower coefficient in
 * [0, 1/dₖ) by the k-th.
 */
function triangular(o: Order, v: bigint, ce: ComputeEngine): bigint[][] {
  // On a's powers coordinate i scales by vⁱ; the Hermite form on reversed columns is lower
  // triangular, each row reduced by the rows of lower degree.
  const scaled = o.rows.map((r) => r.map((c, i) => c * v ** BigInt(i)));
  return hermiteBasis(
    scaled.map((r) => [...r].reverse()),
    ce._deadlineFrame
  )
    .map((r) => [...r].reverse())
    .reverse();
}

/**
 * A ℤ-basis of the ring of integers of ℚ(a), as expressions on the powers of the generator read
 * (the basis is triangular on the powers of a, which are written on that generator's).
 */
function integralBasis(
  ce: ComputeEngine,
  r: Read,
  sub: Subfield
): Json[] | undefined {
  const { field } = r;
  if (sub.f.length === 2) return [1];
  // Written on the powers of an expression: a field of several roots has none.
  const power = field.power;
  if (power === undefined) return undefined;
  const K = certify(ce, sub.f);
  if (K === undefined) return undefined;
  const o = maximalOrder(K, ce._deadlineFrame);
  // Σ cᵢ·aⁱ in the field read, a's powers by multiplication.
  const powers: NumberFieldElement[] = [field.K.one];
  for (let i = 1; i < sub.f.length - 1; i++)
    powers.push(field.K.mul(powers[i - 1]!, r.x));
  return triangular(o, sub.lead, ce).map((row) =>
    expressionOnPowers(
      power,
      field,
      row.reduce(
        (s, c, i) =>
          field.K.add(
            s,
            field.K.mul(field.K.element([q(c, o.den)]), powers[i]!)
          ),
        field.K.zero
      )
    )
  );
}

/** Σ (cᵢ/den)·gⁱ for the element `x`, whose coordinates are on the powers of θ = scale·g, `power(i)` writing gⁱ. */
function expressionOnPowers(
  power: (k: number) => Json,
  { scale }: GeneratedField,
  x: NumberFieldElement
): Json {
  const terms = x.coefficients.flatMap((c, i): Json[] => {
    if (c.numerator === 0n) return [];
    const r = rational(c.numerator * scale ** BigInt(i), c.denominator);
    const qr = rationalJson(r);
    return [
      i === 0
        ? qr
        : r.num === 1n && r.den === 1n
          ? power(i)
          : ['Multiply', qr, power(i)],
    ];
  });
  return terms.length === 0
    ? 0
    : terms.length === 1
      ? terms[0]
      : ['Add', ...terms];
}

const boxed = (ce: ComputeEngine, j: Json): Expression =>
  ce.expr(j as MathJsonExpression);

interface Options {
  readonly engine: ComputeEngine;
  readonly expression?: Expression;
  readonly numericApproximation?: boolean;
  readonly precision?: number;
}

/**
 * The operands of a head of one number or two, read as written: held, in an operator that is
 * not lazy, so `N` doesn't turn an argument into a float, and a declined call is rebuilt by the
 * engine from the operands it was given.
 */
const held = (count: number) => () =>
  Array.from({ length: count }, () => ({ kind: 'held' as const }));

/**
 * An evaluate handler for a head of one number: `answer` gets it read, and `undefined` declines.
 * The answer is exact; under `N()` it is approximated (a rational norm is a float), and the
 * argument is still read exactly.
 */
const ofNumber =
  (answer: (r: Read, ce: ComputeEngine) => Json | undefined) =>
  (
    ops: readonly Expression[],
    { engine: ce, numericApproximation }: Options
  ) => {
    const result = withinBudget(() => {
      const r = read(ce, ops[0]!);
      return r && answer(r, ce);
    });
    if (result === undefined) return undefined;
    const exact = boxed(ce, result);
    return numericApproximation ? exact.N() : exact;
  };

const fractionJson = (num: bigint, den: bigint): Json =>
  rationalJson(rational(num, den));

/** The `k`-th root of the integer polynomial `a` to `digits` digits, as a number expression. */
function numericRoot(
  ce: ComputeEngine,
  a: readonly bigint[],
  k: number,
  digits: number
): Expression | undefined {
  const refined = refineRoot(a, k, digits, ce._deadlineFrame);
  if (refined === undefined) return undefined;
  const re = { num: refined.re };
  return refined.im === '0'
    ? boxed(ce, re)
    : boxed(ce, ['Complex', re, { num: refined.im }]);
}

export const ALGEBRAIC_NUMBERS_LIBRARY: SymbolDefinitions = {
  PolynomialRoot: {
    description:
      "The root of the polynomial p in the variable x (bound, as in Wolfram's Root[Function[x, p], k]). " +
      'With an index, `PolynomialRoot(p, x, k)` is the k-th root: real roots first in increasing order, then complex roots by increasing real part, each conjugate pair together with the lower one first, and the pairs that share a real part by increasing |imaginary part|, as Mathematica does. ' +
      'It is a numbered embedding, a particular complex number, the one `N()` gives, and its other roots are other numbers; a root that cannot be numbered with certainty stays unevaluated. ' +
      'The root of a polynomial of degree 1 or 2 is a rational or a radical; past that it stays `PolynomialRoot` until `N()`. ' +
      'Without an index, `PolynomialRoot(p, x)` is the abstract root of the irreducible polynomial p, with no complex embedding selected: it has no numeric value, and its other roots are indistinguishable from it.',
    // The polynomial is kept as written, its variable is bound, the index is a value.
    operands: () => [{ kind: 'held' }, { kind: 'clause' }, { kind: 'value' }],
    signature: '(polynomial: any, variable: any, index: integer?) -> number',
    parameters: {
      polynomial: {
        description: 'The polynomial, with rational coefficients.',
        sample: 'x^3 - x - 1',
      },
      variable: {
        description: 'The variable of the polynomial, bound by the call.',
        sample: 'x',
      },
      index: {
        description:
          'Which root, from 1 to the degree; without it, the abstract root of an irreducible polynomial.',
        sample: '1',
      },
    },
    examples: [
      'PolynomialRoot(x^2 - 2, x, 2)  // sqrt(2)',
      'N(PolynomialRoot(x^3 - x - 1, x, 1))  // 1.324717957244746',
      'PolynomialRoot(x^2 + x + 1, x, 1)  // 1/2 * (-1 - sqrt(3) * i)',
    ],
    evaluate: (
      ops: readonly Expression[],
      { engine: ce, expression, numericApproximation, precision }: Options
    ) => {
      // The abstract root: valid when its polynomial is rational and irreducible.
      if (ops.length === 2) {
        const generator = expression ?? ce.function(POLYNOMIAL_ROOT, ops);
        return validateAlgebraicGenerator(generator) ?? generator;
      }
      const cs = coefficientsOf(ops[0]!, ops[1]!.json);
      const kj = rationalOf(ops[2]!.json);
      const d = (cs?.length ?? 1) - 1;
      if (
        cs === undefined ||
        kj === undefined ||
        kj.den !== 1n ||
        kj.num < 1n ||
        kj.num > BigInt(d)
      )
        return undefined;
      const k = Number(kj.num);
      // Degree 1 and 2 are rationals and radicals; past them the root is its own name, and a number under N.
      if (d === 1) {
        const root = boxed(
          ce,
          fractionJson(-cs[0]!.num * cs[1]!.den, cs[0]!.den * cs[1]!.num)
        );
        return numericApproximation ? root.N() : root;
      }
      if (d === 2) {
        // ax² + bx + c: (−b ∓ √(b² − 4ac)) / 2a, the smaller real root (or lower imaginary part) first.
        const [c, b, a] = cs.map(rationalJson);
        const disc = ['Subtract', ['Power', b, 2], ['Multiply', 4, a, c]];
        const aPositive = cs[2]!.num > 0n;
        const sign = (k === 1) === aPositive ? -1 : 1;
        const root = boxed(ce, [
          'Divide',
          ['Add', ['Negate', b], ['Multiply', sign, ['Sqrt', disc]]],
          ['Multiply', 2, a],
        ]).evaluate();
        return numericApproximation ? root.N() : root;
      }
      if (numericApproximation) {
        const digits = Math.max(
          precision ?? (typeof ce.precision === 'number' ? ce.precision : 15),
          15
        );
        return numericRoot(ce, primitivePolynomial(cs), k, digits);
      }
      return undefined;
    },
  },

  MinimalPolynomial: {
    description:
      'The minimal polynomial of the algebraic number a in x: primitive over ℤ, positive leading coefficient.',
    signature: '(a: number, variable: any) -> expression',
    parameters: {
      a: {
        description:
          'The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated.',
        sample: 'sqrt(2)',
      },
      variable: {
        description: 'The variable of the polynomial.',
        sample: 'x',
      },
    },
    examples: [
      'MinimalPolynomial(Sqrt(2), x)  // x^2 - 2',
      'MinimalPolynomial(1 + Root(2, 3), x)  // x^3 - 3x^2 + 3x - 3',
    ],
    operands: held(2),
    evaluate: (ops: readonly Expression[], { engine: ce }: Options) => {
      const result = withinBudget(() => {
        const r = read(ce, ops[0]!);
        return r && polynomialIn(minimalOf(r, ce), ops[1]!.json);
      });
      return result === undefined ? undefined : boxed(ce, result);
    },
  },

  IsAlgebraicInteger: {
    description:
      'Whether a is an algebraic integer: a root of a monic polynomial over ℤ.',
    examples: [
      'IsAlgebraicInteger((1 + Sqrt(5)) / 2)  // "True"',
      'IsAlgebraicInteger(Sqrt(2) / 2)  // "False"',
    ],
    signature: '(number) -> boolean',
    parameters: [
      {
        description:
          'The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated.',
        sample: '(1 + sqrt(5)) / 2',
      },
    ],
    operands: held(1),
    evaluate: ofNumber((r, ce) =>
      isIntegral(r.field.K, r.x, ce._deadlineFrame) ? 'True' : 'False'
    ),
  },

  AlgebraicNumberNorm: {
    description:
      'The norm of a over ℚ in the field ℚ(a): (−1)ᵈ times its minimal polynomial’s constant term over its leading one.',
    examples: [
      'AlgebraicNumberNorm(1 + Sqrt(2))  // -1',
      'AlgebraicNumberNorm(3 + Sqrt(2))  // 7',
    ],
    signature: '(number) -> number',
    parameters: [
      {
        description:
          'The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated.',
        sample: '1 + sqrt(2)',
      },
    ],
    operands: held(1),
    evaluate: ofNumber((r, ce) => {
      const m = minimalOf(r, ce);
      const d = degree(m);
      return fractionJson(d % 2 === 0 ? m[0]! : -m[0]!, m[d]!);
    }),
  },

  AlgebraicNumberTrace: {
    description:
      'The trace of a over ℚ in the field ℚ(a): minus its minimal polynomial’s second coefficient over its leading one.',
    examples: [
      'AlgebraicNumberTrace(1 + Sqrt(2))  // 2',
      'AlgebraicNumberTrace(1 + Sqrt(3) / 2)  // 2',
    ],
    signature: '(number) -> number',
    parameters: [
      {
        description:
          'The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated.',
        sample: '1 + sqrt(2)',
      },
    ],
    operands: held(1),
    evaluate: ofNumber((r, ce) => {
      const m = minimalOf(r, ce);
      const d = degree(m);
      return fractionJson(-m[d - 1]!, m[d]!);
    }),
  },

  NumberFieldDiscriminant: {
    description: 'The discriminant of the field ℚ(a): of its ring of integers.',
    signature: '(number) -> integer',
    parameters: [
      {
        description:
          'The algebraic number that generates the field, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated.',
        sample: 'sqrt(2)',
      },
    ],
    examples: [
      'NumberFieldDiscriminant(Sqrt(2))  // 8',
      'NumberFieldDiscriminant(Sqrt(5))  // 5',
    ],
    operands: held(1),
    evaluate: ofNumber((r, ce) => {
      const { f } = subfieldOf(r, ce);
      if (f.length === 2) return 1;
      const K = certify(ce, f);
      return (
        K &&
        numberJson(
          orderDiscriminant(
            maximalOrder(K, ce._deadlineFrame),
            ce._deadlineFrame
          )
        )
      );
    }),
  },

  NumberFieldIntegralBasis: {
    description:
      'A ℤ-basis of the ring of integers of ℚ(a), written on the powers of the generator read (the radical or root a is written in), as Wolfram writes it.',
    signature: '(number) -> list<number>',
    parameters: [
      {
        description:
          'The algebraic number that generates the field, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated.',
        sample: 'sqrt(2)',
      },
    ],
    examples: ['NumberFieldIntegralBasis(Sqrt(5))  // [1, 1/2 + sqrt(5)/2]'],
    operands: held(1),
    evaluate: ofNumber((r, ce) => {
      const basis = integralBasis(ce, r, subfieldOf(r, ce));
      return basis && ['List', ...basis];
    }),
  },

  NumberFieldSignature: {
    description:
      'The signature (r₁, r₂) of ℚ(a): its real embeddings and its pairs of complex ones.',
    signature: '(number) -> list<integer>',
    parameters: [
      {
        description:
          'The algebraic number that generates the field, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated.',
        sample: 'sqrt(2)',
      },
    ],
    examples: ['NumberFieldSignature(Root(2, 3))  // [1, 1]'],
    operands: held(1),
    evaluate: ofNumber((r, ce) => {
      const { f } = subfieldOf(r, ce);
      const n = f.length - 1;
      const r1 = n === 1 ? 1 : realRootCount(f);
      return ['List', r1, (n - r1) / 2];
    }),
  },
};
