// Algebraic numbers as Wolfram has them: PolynomialRoot (Wolfram's Root), MinimalPolynomial,
// AlgebraicIntegerQ, AlgebraicNumberNorm and AlgebraicNumberTrace, and the field an algebraic
// number generates: NumberFieldDiscriminant, NumberFieldIntegralBasis, NumberFieldSignature.
// An argument is read as a polynomial in one generator — a radical of a rational, i, the golden
// ratio, or a PolynomialRoot — and anything else is left unevaluated.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type { Type } from '../../common/type/types.js';
import { checkTypes } from '../boxed-expression/validate.js';
import {
  degree,
  element,
  type FieldElement,
  gcd,
  hermite,
  isIntegral,
  isIrreducible,
  maximalOrder,
  minimalPolynomial,
  multiply,
  orderDiscriminant,
  type Poly,
  realRootCount,
} from '../numerics/number-field.js';

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

/** What an argument is written in: one radical bᵐ/ᵏ of a rational, or one PolynomialRoot. */
type Atom =
  | {
      readonly kind: 'radical';
      readonly base: Rational;
      readonly index: number;
      readonly power: number;
    }
  | {
      readonly kind: 'root';
      readonly key: string;
      readonly polynomial: readonly Rational[];
    };

/**
 * `j` with i, the golden ratio and `Complex(a, b)` written as square roots, and i·√c (c > 0)
 * as √−c, so a Gaussian or Eisenstein number is one radical.
 */
function normalize(j: Json): Json {
  if (j === 'ImaginaryUnit') return ['Sqrt', -1];
  if (j === 'GoldenRatio')
    return ['Multiply', ['Rational', 1, 2], ['Add', 1, ['Sqrt', 5]]];
  const h = head(j);
  if (h === undefined) return j;
  if (h === 'Complex') {
    const [re, im] = args(j);
    return normalize(['Add', re, ['Multiply', im, 'ImaginaryUnit']]);
  }
  const ops = args(j).map(normalize);
  if (h === 'Multiply') {
    // i·√c = √−c for c > 0: then i and √c are one radical, not two.
    const i = ops.findIndex(
      (o) => radicalOf(o)?.base.num === -1n && radicalOf(o)?.index === 2
    );
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
  return [h, ...ops];
}

/** `j` as bᵐ/ᵏ, b rational, 0 < m < k in lowest terms. */
function radicalOf(j: Json): Extract<Atom, { kind: 'radical' }> | undefined {
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
  if (base.num === 0n || exponent.num > MAX_POWER) return undefined;
  return {
    kind: 'radical',
    base,
    index: Number(exponent.den),
    power: Number(exponent.num),
  };
}

const POLYNOMIAL_ROOT = 'PolynomialRoot';

/** The atoms of `j` and the radicals and roots in them, or `undefined` for what isn't read. */
function atomsOf(j: Json, ce: ComputeEngine, into: Atom[]): boolean {
  if (rationalOf(j) !== undefined) return true;
  const radical = radicalOf(j);
  if (radical !== undefined) {
    into.push(radical);
    return true;
  }
  const h = head(j);
  if (h === POLYNOMIAL_ROOT) {
    const polynomial = coefficientsOf(ce, args(j)[0]);
    if (polynomial === undefined) return false;
    into.push({ kind: 'root', key: JSON.stringify(args(j)[0]), polynomial });
    return true;
  }
  if (h === 'Add' || h === 'Multiply' || h === 'Negate' || h === 'Subtract')
    return args(j).every((o) => atomsOf(o, ce, into));
  if (h === 'Divide')
    return (
      atomsOf(args(j)[0], ce, into) && rationalOf(args(j)[1]) !== undefined
    );
  if (h === 'Power' || h === 'Square') {
    const e = h === 'Square' ? rational(2n) : rationalOf(args(j)[1]);
    return (
      e !== undefined &&
      e.den === 1n &&
      e.num >= 0n &&
      e.num <= MAX_POWER &&
      atomsOf(args(j)[0], ce, into)
    );
  }
  return false;
}

/** A polynomial's coefficients in its one unknown, constant first; `undefined` unless rational. */
function coefficientsOf(ce: ComputeEngine, p: Json): Rational[] | undefined {
  const boxed = ce.expr(p as MathJsonExpression);
  const unknowns = boxed.unknowns;
  if (unknowns.length !== 1) return undefined;
  const list = ce
    .expr(['CoefficientList', p, unknowns[0]] as MathJsonExpression)
    .evaluate().json;
  if (head(list) !== 'List') return undefined;
  // CoefficientList is highest first.
  const cs = [...args(list).map(rationalOf)].reverse();
  return cs.every((c) => c !== undefined) && cs.length > 1
    ? (cs as Rational[])
    : undefined;
}

/** The field an argument lives in: θ a root of monic `f`, and the generator the argument is written in. */
export interface GeneratedField {
  readonly f: Poly;
  /** The generator, as an element of ℚ(θ). */
  readonly generator: FieldElement;
  /** The generator as an expression, its power `k` given. */
  readonly power: (k: number) => Json;
}

const lcm = (a: number, b: number): number =>
  (a * b) / Number(gcd(BigInt(a), BigInt(b)));

/** ⌊n^(1/p)⌋ for n ≥ 0, by Newton's method on bigints. */
function integerRoot(n: bigint, p: number): bigint {
  if (n < 2n) return n;
  const k = BigInt(p);
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / p));
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) return x;
    x = y;
  }
}

const isPower = (n: bigint, p: number): boolean => {
  if (n < 0n) return p % 2 === 1 && isPower(-n, p);
  return integerRoot(n, p) ** BigInt(p) === n;
};

/** `x^k − c` is irreducible over ℚ iff c is no p-th power for a prime p | k, nor in −4ℚ⁴ when 4 | k (Capelli). */
function binomialIrreducible(k: number, c: bigint): boolean {
  for (let p = 2; p <= k; p++) {
    const prime = [...Array(p).keys()].slice(2).every((d) => p % d !== 0);
    if (prime && k % p === 0 && isPower(c, p)) return false;
  }
  return !(k % 4 === 0 && c < 0n && -c % 4n === 0n && isPower(-c / 4n, 4));
}

/** The field `atoms` generate, when it is one generator's. */
function fieldOf(atoms: readonly Atom[]): GeneratedField | undefined {
  if (atoms.length === 0) {
    return { f: [0n, 1n], generator: element([0n]), power: () => 1 };
  }
  const first = atoms[0]!;
  if (first.kind === 'root') {
    if (atoms.some((a) => a.kind !== 'root' || a.key !== first.key))
      return undefined;
    // θ' = aₙ·θ (cleared of denominators) is a root of a monic integer polynomial.
    const den = first.polynomial.reduce(
      (l, c) => (l * c.den) / gcd(l, c.den),
      1n
    );
    const a = first.polynomial.map((c) => (c.num * den) / c.den);
    const n = a.length - 1;
    const lead = a[n]!;
    if (lead === 0n) return undefined;
    const f = a.map((c, i) => (i === n ? 1n : c * lead ** BigInt(n - 1 - i)));
    if (isIrreducible(f) !== true) return undefined;
    const key = JSON.parse(first.key) as Json;
    return {
      f,
      generator: element(
        f.slice(0, n).map((_, i) => (i === 1 ? 1n : 0n)),
        lead
      ),
      power: (k) =>
        k === 1
          ? [POLYNOMIAL_ROOT, key, 1]
          : ['Power', [POLYNOMIAL_ROOT, key, 1], k],
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
  ) {
    return undefined;
  }
  const L = atoms.reduce((l, a) => lcm(l, (a as typeof first).index), 1);
  const { num: u, den: v } = first.base;
  // θ' = v·b^(1/L) is a root of x^L − u·v^(L−1).
  const c = u * v ** BigInt(L - 1);
  if (L > MAX_DEGREE || !binomialIrreducible(L, c)) return undefined;
  const f = [-c, ...Array.from({ length: L - 1 }, () => 0n), 1n];
  const b = rationalJson(first.base);
  return {
    f,
    generator: element(
      f.slice(0, L).map((_, i) => (i === 1 ? 1n : 0n)),
      v
    ),
    power: (k) =>
      L === 2 && k === 1 ? ['Sqrt', b] : ['Power', b, ['Rational', k, L]],
  };
}

/** Fields past this degree aren't attempted. */
const MAX_DEGREE = 12;

/** Powers past this, of the generator or of a sum in it, aren't expanded. */
const MAX_POWER = 256n;

/** An argument read as an element of the field it generates. */
export interface Read {
  readonly field: GeneratedField;
  readonly x: FieldElement;
}

function read(ce: ComputeEngine, arg: Expression): Read | undefined {
  const j = normalize(arg.json);
  const atoms: Atom[] = [];
  if (!atomsOf(j, ce, atoms)) return undefined;
  const field = fieldOf(atoms);
  if (field === undefined) return undefined;
  const x = elementOf(j, field);
  return x === undefined ? undefined : { field, x };
}

function elementOf(j: Json, field: GeneratedField): FieldElement | undefined {
  const n = field.f.length - 1;
  const constant = (r: Rational): FieldElement =>
    element([r.num, ...Array.from({ length: n - 1 }, () => 0n)], r.den);
  const one = constant(rational(1n));
  const pow = (x: FieldElement, k: number): FieldElement => {
    let out = one;
    for (let i = 0; i < k; i++) out = multiply(field.f, out, x);
    return out;
  };
  const go = (e: Json): FieldElement | undefined => {
    const r = rationalOf(e);
    if (r !== undefined) return constant(r);
    const radical = radicalOf(e);
    if (radical !== undefined) {
      const L = field.f.length - 1;
      return pow(field.generator, (radical.power * L) / radical.index);
    }
    const h = head(e);
    const ops = args(e);
    if (h === POLYNOMIAL_ROOT) return field.generator;
    if (h === 'Add' || h === 'Subtract') {
      const xs = ops.map(go);
      if (xs.some((x) => x === undefined)) return undefined;
      return xs.reduce((s, x, i) => {
        const t =
          h === 'Subtract' && i > 0
            ? element(
                x!.num.map((c) => -c),
                x!.den
              )
            : x!;
        return element(
          s!.num.map((c, k) => c * t.den + t.num[k]! * s!.den),
          s!.den * t.den
        );
      });
    }
    if (h === 'Negate') {
      const x = go(ops[0]);
      return (
        x &&
        element(
          x.num.map((c) => -c),
          x.den
        )
      );
    }
    if (h === 'Multiply') {
      const xs = ops.map(go);
      if (xs.some((x) => x === undefined)) return undefined;
      return xs.reduce((p, x) => multiply(field.f, p!, x!), one);
    }
    if (h === 'Divide') {
      const [x, d] = [go(ops[0]), rationalOf(ops[1])];
      return x && d && d.num !== 0n
        ? element(
            x.num.map((c) => c * d.den),
            x.den * d.num
          )
        : undefined;
    }
    if (h === 'Power' || h === 'Square') {
      const k = h === 'Square' ? 2 : Number(rationalOf(ops[1])!.num);
      const x = go(ops[0]);
      return x && pow(x, k);
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
const minimalOf = ({ field, x }: Read): bigint[] =>
  minimalPolynomial(field.f, x);

/**
 * O_K's basis as Wolfram writes it: lower triangular on the generator's powers, the i-th led by
 * gⁱ/dᵢ, each lower coefficient in [0, 1/dₖ) by the k-th.
 */
function integralBasis(field: GeneratedField): Json[] | undefined {
  const o = maximalOrder(field.f);
  if (o === undefined) return undefined;
  const n = field.f.length - 1;
  // θ' = v·g, so on g's powers coordinate i scales by vⁱ; the Hermite form on reversed columns
  // is lower triangular, each row reduced by the rows of lower degree.
  const v = field.generator.den / field.generator.num[1]!;
  const scaled = o.rows.map((r) => r.map((c, i) => c * v ** BigInt(i)));
  return hermite(
    scaled.map((r) => [...r].reverse()),
    n
  )
    .map((r) => [...r].reverse())
    .reverse()
    .map((row) => expressionOnPowers(field, element(row, o.den)));
}

/** Σ (cᵢ/den)·gⁱ for coordinates already on g's powers. */
function expressionOnPowers(field: GeneratedField, x: FieldElement): Json {
  const terms = x.num.flatMap((c, i): Json[] => {
    if (c === 0n) return [];
    const r = rational(c, x.den);
    const q = rationalJson(r);
    return [
      i === 0
        ? q
        : r.num === 1n && r.den === 1n
          ? field.power(i)
          : ['Multiply', q, field.power(i)],
    ];
  });
  return terms.length === 0
    ? 0
    : terms.length === 1
      ? terms[0]
      : ['Add', ...terms];
}

/** Box an answer. */
const boxed = (ce: ComputeEngine, j: Json): Expression =>
  ce.expr(j as MathJsonExpression);

/**
 * The heads are lazy so that `.N()` leaves an exact operand exact: a numeric `1 + √2`
 * is no longer an algebraic number to read. Each canonicalizes and type-checks its own
 * operands and evaluates (exactly) the ones it reads.
 */
const exactOperands = (name: string, types: Type[]) => ({
  lazy: true,
  canonical: (
    ops: readonly Expression[],
    { engine: ce }: { engine: ComputeEngine }
  ) =>
    ce._fn(
      name,
      checkTypes(
        ce,
        ops.map((x) => x.canonical),
        types
      )
    ),
});

export const ALGEBRAIC_NUMBERS_LIBRARY: SymbolDefinitions = {
  PolynomialRoot: {
    ...exactOperands('PolynomialRoot', ['any', 'integer']),
    description:
      "The k-th root of the polynomial p in its unknown: real roots first in increasing order, then complex roots by increasing real part and then imaginary part (Wolfram's Root).",
    signature: '(any, integer) -> number',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      // Degree 1 and 2 are rationals and radicals; past them the root is its own name.
      const cs = coefficientsOf(ce, ops[0]!.json);
      const k = ops[1]?.evaluate().re;
      if (cs === undefined || !Number.isInteger(k)) return undefined;
      const d = cs.length - 1;
      if (k! < 1 || k! > d) return undefined;
      if (d === 1)
        return boxed(
          ce,
          rationalJson(
            rational(-cs[0]!.num * cs[1]!.den, cs[0]!.den * cs[1]!.num)
          )
        );
      if (d !== 2) return undefined;
      // ax² + bx + c: (−b ∓ √(b² − 4ac)) / 2a, the smaller real root (or lower imaginary part) first.
      const [c, b, a] = cs.map(rationalJson);
      const disc = ['Subtract', ['Power', b, 2], ['Multiply', 4, a, c]];
      const aPositive = cs[2]!.num > 0n;
      const sign = (k === 1) === aPositive ? -1 : 1;
      return boxed(ce, [
        'Divide',
        ['Add', ['Negate', b], ['Multiply', sign, ['Sqrt', disc]]],
        ['Multiply', 2, a],
      ]).evaluate();
    },
  },

  MinimalPolynomial: {
    ...exactOperands('MinimalPolynomial', ['number', 'any']),
    description:
      'The minimal polynomial of the algebraic number a in x: primitive over ℤ, positive leading coefficient.',
    signature: '(number, any) -> expression',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      const r = read(ce, ops[0]!.evaluate());
      return r && boxed(ce, polynomialIn(minimalOf(r), ops[1]!.json));
    },
  },

  AlgebraicIntegerQ: {
    ...exactOperands('AlgebraicIntegerQ', ['number']),
    description:
      'Whether a is an algebraic integer: a root of a monic polynomial over ℤ.',
    signature: '(number) -> boolean',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      const r = read(ce, ops[0]!.evaluate());
      return r && ce.symbol(isIntegral(r.field.f, r.x) ? 'True' : 'False');
    },
  },

  AlgebraicNumberNorm: {
    ...exactOperands('AlgebraicNumberNorm', ['number']),
    description:
      "The norm of a over ℚ in the field ℚ(a): (−1)ᵈ times its minimal polynomial's constant term over its leading one.",
    signature: '(number) -> number',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      const r = read(ce, ops[0]!.evaluate());
      if (r === undefined) return undefined;
      const m = minimalOf(r);
      const d = degree(m);
      const n = rational(d % 2 === 0 ? m[0]! : -m[0]!, m[d]!);
      return boxed(ce, rationalJson(n));
    },
  },

  AlgebraicNumberTrace: {
    ...exactOperands('AlgebraicNumberTrace', ['number']),
    description:
      "The trace of a over ℚ in the field ℚ(a): minus its minimal polynomial's second coefficient over its leading one.",
    signature: '(number) -> number',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      const r = read(ce, ops[0]!.evaluate());
      if (r === undefined) return undefined;
      const m = minimalOf(r);
      const d = degree(m);
      const t = rational(-m[d - 1]!, m[d]!);
      return boxed(ce, rationalJson(t));
    },
  },

  NumberFieldDiscriminant: {
    ...exactOperands('NumberFieldDiscriminant', ['number']),
    description: 'The discriminant of the field ℚ(a): of its ring of integers.',
    signature: '(number) -> integer',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      const r = read(ce, ops[0]!.evaluate());
      const generated = r && generatedBy(r);
      const o = generated && maximalOrder(generated.f);
      return o && boxed(ce, numberJson(orderDiscriminant(o)));
    },
  },

  NumberFieldIntegralBasis: {
    ...exactOperands('NumberFieldIntegralBasis', ['number']),
    description:
      "A ℤ-basis of the ring of integers of ℚ(a), written on a's powers as Wolfram writes it.",
    signature: '(number) -> list',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      const r = read(ce, ops[0]!.evaluate());
      const generated = r && generatedBy(r);
      const basis = generated && integralBasis(generated);
      return basis && boxed(ce, ['List', ...basis]);
    },
  },

  NumberFieldSignature: {
    ...exactOperands('NumberFieldSignature', ['number']),
    description:
      'The signature (r₁, r₂) of ℚ(a): its real embeddings and its pairs of complex ones.',
    signature: '(number) -> list<integer>',
    evaluate: (
      ops: readonly Expression[],
      { engine: ce }: { engine: ComputeEngine }
    ) => {
      const r = read(ce, ops[0]!.evaluate());
      const generated = r && generatedBy(r);
      if (generated === undefined) return undefined;
      const n = generated.f.length - 1;
      const r1 = realRootCount(generated.f);
      return boxed(ce, ['List', r1, (n - r1) / 2]);
    },
  },
};

/**
 * The field a itself generates, with a as its generator, when that is the field it was read in
 * (ℚ(a) can be smaller than ℚ(θ): 1 + θ³ for θ = ∛2 is rational). Otherwise `undefined`.
 */
function generatedBy(r: Read): GeneratedField | undefined {
  const n = r.field.f.length - 1;
  return degree(minimalOf(r)) === n ? r.field : undefined;
}
