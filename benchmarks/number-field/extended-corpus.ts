import {
  RationalNumberField,
  type NumberFieldElement,
} from '../../src/compute-engine/polynomial/number-field.js';
import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field.js';
import { SmallPrimePolynomials } from '../../src/compute-engine/polynomial/small-prime.js';
import type { Case, Element } from './corpus.js';

const sage = 'https://doc.sagemath.org/html/en/constructions/polynomials.html';
const wester =
  'https://doc.sagemath.org/html/en/reference/calculus/sage/calculus/wester.html';
const judson =
  'https://math.libretexts.org/Bookshelves/Abstract_and_Geometric_Algebra/Abstract_Algebra:_Theory_and_Applications_(Judson)/21:_Fields/';

/** Benchmark construction only: expected factors never enter worker requests. */
class Builder {
  readonly K: RationalNumberField;
  readonly P: FieldPolynomials<ReturnType<RationalNumberField['element']>>;
  constructor(readonly modulus: number[]) {
    this.K = RationalNumberField.create(modulus.map((c) => q(BigInt(c))));
    this.P = new FieldPolynomials(this.K, new PolynomialWork(1_000_000_000));
  }
  integer(n: number) {
    return this.K.fromInteger(BigInt(n));
  }
  encode(a: typeof this.K.one): Element {
    return a.coefficients.map((c) => [
      String(c.numerator),
      String(c.denominator),
    ]);
  }
  linear(root: typeof this.K.one) {
    return [this.K.neg(root), this.K.one];
  }
  rational(cs: number[]) {
    return cs.map((c) => this.integer(c));
  }
  eisenstein(degree: number, prime: number, dense = false) {
    const F = new SmallPrimePolynomials(prime);
    const m = F.fromIntegers(this.modulus.map(BigInt));
    if (F.gcd(m, F.derivative(m)).length !== 1)
      throw new Error('Eisenstein certificate requires an unramified prime');
    // Square-free reduction of the monic integral defining polynomial makes p
    // unramified. At every prime above p the constant has valuation exactly one.
    const cs = Array.from({ length: degree + 1 }, () => this.K.zero);
    cs[0] = this.integer(prime);
    cs[degree] = this.K.one;
    for (let j = 1; j < degree; j++) {
      if (!dense && j !== 1) continue;
      const c = dense
        ? this.K.element(
            Array.from({ length: this.modulus.length - 1 }, (_, k) =>
              q(BigInt(((j * 17 + k * 13) % 11) - 5))
            )
          )
        : this.K.generator;
      cs[j] = this.K.mul(this.integer(prime), c);
    }
    return cs;
  }
  translate(cs: (typeof this.K.one)[], shift: typeof this.K.one) {
    let result: (typeof this.K.one)[] = [];
    for (const c of [...cs].reverse())
      result = this.P.add(this.P.mul(result, [shift, this.K.one]), [c]);
    return result;
  }
  make(
    id: string,
    family: string,
    factors: { coefficients: NumberFieldElement[]; multiplicity: number }[],
    provenance: NonNullable<Case['provenance']>,
    scalar = this.K.one
  ): Case {
    let input = [scalar];
    for (const f of factors)
      for (let j = 0; j < f.multiplicity; j++)
        input = this.P.mul(input, f.coefficients);
    return {
      id,
      family,
      modulus: this.modulus.map((c) => [String(c), '1']),
      coefficients: input.map((c) => this.encode(c)),
      expected: {
        coefficient: this.encode(scalar),
        factors: factors.map((f) => ({
          coefficients: f.coefficients.map((c) => this.encode(c)),
          multiplicity: f.multiplicity,
        })),
      },
      provenance,
    };
  }
}

const generated = (
  description: string,
  irreducibility: string
): NonNullable<Case['provenance']> => ({
  kind: 'generated',
  description,
  irreducibility,
});
const linearProof = 'All expected factors have degree one.';
const eisensteinProof =
  'Each nonlinear factor is Eisenstein at every prime above its stated unramified rational prime; translation preserves irreducibility.';

/** Higher polynomial degrees and different field structures, not just larger fields. */
export function extendedCases(): Case[] {
  const cases: Case[] = [];
  const fields = [
    { name: 'sqrt2', m: [-2, 0, 1] },
    { name: 'cubic', m: [-2, 0, 0, 1] },
    { name: 'quintic', m: [-1, -1, 0, 0, 0, 1] },
    { name: 'biquadratic', m: [1, 0, -10, 0, 1] },
    { name: 'zeta8', m: [1, 0, 0, 0, 1] },
    { name: 'quartic', m: [-1, -1, 0, 0, 1] },
  ];
  for (const { name, m } of fields) {
    const b = new Builder(m),
      K = b.K;
    for (const degree of [12, 24, 48, 64]) {
      cases.push(
        b.make(
          `extended-${name}-linear-${degree}`,
          'higher-many-linear',
          Array.from({ length: degree }, (_, j) => ({
            coefficients: b.linear(K.add(K.generator, b.integer(j + 1))),
            multiplicity: 1,
          })),
          generated(
            `Degree ${degree} product with roots alpha+j in ${name}.`,
            linearProof
          )
        )
      );
      cases.push(
        b.make(
          `extended-${name}-mixed-${degree}`,
          'higher-nonlinear-products',
          [101, 103].map((p) => ({
            coefficients: b.eisenstein(degree / 2, p),
            multiplicity: 1,
          })),
          generated(
            `Degree ${degree}: two degree ${degree / 2} Eisenstein factors at 101 and 103 in ${name}.`,
            eisensteinProof
          )
        )
      );
    }
  }
  for (const { name, m } of fields.slice(0, 3)) {
    const b = new Builder(m);
    for (const degree of [12, 24, 48])
      cases.push(
        b.make(
          `extended-${name}-irreducible-${degree}`,
          'higher-irreducible',
          [{ coefficients: b.eisenstein(degree, 101), multiplicity: 1 }],
          generated(
            `Irreducible degree ${degree} over ${name}, Eisenstein at 101.`,
            eisensteinProof
          )
        )
      );
    for (const degree of [96, 128])
      cases.push(
        b.make(
          `extended-${name}-repeated-${degree}`,
          'higher-repeated',
          [{ coefficients: b.eisenstein(8, 101), multiplicity: degree / 8 }],
          generated(
            `Degree ${degree}, a repeated degree-eight factor over ${name}.`,
            eisensteinProof
          )
        )
      );
  }
  for (const i of [0, 1, 3]) {
    const { name, m } = fields[i],
      b = new Builder(m);
    for (const degree of [16, 32]) {
      const f = b.translate(b.eisenstein(degree, 101, true), b.K.generator);
      cases.push(
        b.make(
          `extended-${name}-dense-${degree}`,
          'dense-translated-irreducible',
          [{ coefficients: f, multiplicity: 1 }],
          generated(
            `Dense degree ${degree} Eisenstein factor translated by alpha in ${name}; full power-basis coefficients.`,
            eisensteinProof
          )
        )
      );
    }
  }
  // Alternate power bases exercise nonintegral generators without presuming
  // that their defining polynomials describe integral orders for Eisenstein.
  for (const m of [
    [-2, 0, 0, 8],
    [-2, 0, 0, 0, 0, 32],
  ]) {
    const b = new Builder(m),
      K = b.K;
    for (const degree of [12, 24, 48])
      cases.push(
        b.make(
          `extended-nonintegral-${m.length - 1}-${degree}`,
          'nonintegral-generator',
          Array.from({ length: degree }, (_, j) => ({
            coefficients: b.linear(
              K.add(K.generator, K.element([q(BigInt(j + 1), 7n)]))
            ),
            multiplicity: 1,
          })),
          generated(
            `Degree ${degree} over a generator with defining relation ${m.at(-1)} alpha^${m.length - 1}=2.`,
            linearProof
          ),
          K.element([q(-7n, 13n), q(2n, 17n)])
        )
      );
  }
  cases.push(...publishedCases());
  return cases;
}

function publishedCases(): Case[] {
  const result: Case[] = [];
  const put = (
    b: Builder,
    id: string,
    source: string,
    description: string,
    roots: (typeof b.K.one)[],
    kind: 'published' | 'adapted' = 'adapted'
  ) =>
    result.push(
      b.make(
        id,
        'sourced-split',
        roots.map((r) => ({ coefficients: b.linear(r), multiplicity: 1 })),
        { kind, source, description, irreducibility: linearProof }
      )
    );
  {
    const b = new Builder([-1, -1, 1]),
      a = b.K.generator,
      c = b.K.add(a, b.integer(-1));
    put(
      b,
      'source-wester-quartic',
      wester,
      'Wester/Sage: x^4-3x^2+1 over Q(alpha), alpha^2-alpha-1=0.',
      [a, b.K.neg(a), c, b.K.neg(c)],
      'published'
    );
  }
  {
    const b = new Builder([-3, 0, 1]),
      r = b.K.add(b.K.generator, b.K.one);
    put(
      b,
      'source-wester-radical',
      wester,
      'Adapt the radical identity to factoring x^2-(4+2 alpha), alpha^2=3; not a test of radical simplification.',
      [r, b.K.neg(r)]
    );
  }
  {
    const b = new Builder([1, 0, 1]),
      K = b.K;
    result.push(
      b.make(
        'source-sage-difference-squares',
        'sourced-repeated',
        [
          { coefficients: b.linear(K.zero), multiplicity: 2 },
          { coefficients: b.linear(K.one), multiplicity: 2 },
          ...[
            K.add(b.integer(-1), K.generator),
            K.add(b.integer(-1), K.neg(K.generator)),
          ].map((r) => ({ coefficients: b.linear(r), multiplicity: 1 })),
        ],
        {
          kind: 'adapted',
          source: sage,
          description:
            'Sage (x^3-1)^2-(x^2-1)^2, changing coefficient field from Q to Q(i).',
          irreducibility: linearProof,
        }
      )
    );
    for (const k of [1, 2, 3]) {
      const roots = [1, -1].flatMap((s) =>
        [1, -1].map((t) =>
          K.add(b.integer(s * k), K.mul(b.integer(t * k), K.generator))
        )
      );
      put(
        b,
        `source-imo1969-sophie-${k}`,
        'https://www.imo-official.org/problems/1969/eng.pdf',
        `Specialize the n^4+a expression from IMO 1969 problem 1 to x^4+4*${k}^4 and factor over Q(i). This is not the original infinitude proof.`,
        roots
      );
    }
  }
  {
    const b = new Builder([1, 1, 1]),
      K = b.K;
    const roots = [K.one, K.generator, K.neg(K.add(K.generator, K.one))];
    put(
      b,
      'source-sage-cube-unity',
      sage,
      'Sage roots example x^3-1 over Q(zeta_3), tested as complete factorization.',
      roots
    );
    result.push(
      b.make(
        'source-sage-cube-unity-repeated',
        'sourced-repeated',
        roots.map((r) => ({ coefficients: b.linear(r), multiplicity: 2 })),
        {
          kind: 'adapted',
          source: sage,
          description: 'Repeated (x^3-1)^2 example, transported to Q(zeta_3).',
          irreducibility: linearProof,
        }
      )
    );
  }
  {
    const b = new Builder([1, 0, 0, 0, 1]),
      K = b.K,
      a = K.generator,
      a2 = K.mul(a, a),
      a3 = K.mul(a2, a);
    put(
      b,
      'source-judson-quartic-unity',
      judson + '21.05:_Exercises',
      'Judson exercise 21.5.3(b): x^4+1. Supply Q(zeta_8), rather than asking CE to discover its splitting field.',
      [a, a3, K.neg(a), K.neg(a3)]
    );
    const s = K.add(a, K.neg(a3)),
      t = K.mul(b.integer(2), a2);
    put(
      b,
      'source-judson-quartic-split',
      judson + '21.02:_Splitting_Fields',
      'Judson example 21.29: x^4+2x^2-8; supply its splitting field Q(zeta_8).',
      [s, K.neg(s), t, K.neg(t)]
    );
  }
  {
    const b = new Builder([-2, 0, 1]),
      K = b.K,
      a = K.generator;
    result.push(
      b.make(
        'source-judson-quartic-partial',
        'sourced-partial-split',
        [
          { coefficients: b.linear(a), multiplicity: 1 },
          { coefficients: b.linear(K.neg(a)), multiplicity: 1 },
          { coefficients: b.rational([4, 0, 1]), multiplicity: 1 },
        ],
        {
          kind: 'adapted',
          source: judson + '21.02:_Splitting_Fields',
          description: 'Judson example 21.29 in the smaller field Q(sqrt(2)).',
          irreducibility:
            'The quadratic x^2+4 has no root in this real field; the other factors are linear.',
        }
      )
    );
    result.push(
      b.make(
        'source-sage-tutorial-degree16',
        'sourced-mixed-degree',
        [
          { coefficients: b.linear(K.zero), multiplicity: 5 },
          { coefficients: b.rational([2, 10, 0, 0, 0, 1]), multiplicity: 1 },
          { coefficients: b.rational([1, 1, 1, 1, 1, 1, 1]), multiplicity: 1 },
        ],
        {
          kind: 'adapted',
          source:
            'https://doc.sagemath.org/html/en/tutorial/tour_polynomial.html',
          description:
            'Sage degree-16 tutorial polynomial, transported from Q to Q(sqrt(2)).',
          irreducibility:
            'The quintic is Eisenstein at 2 over Q and stays irreducible over a Galois quadratic extension by orbit sizes. Phi_7 stays irreducible because Q(zeta_7) has unique quadratic subfield Q(sqrt(-7)), not Q(sqrt(2)).',
        },
        b.integer(7)
      )
    );
  }
  {
    const b = new Builder([16, 0, -20, 0, 1]),
      K = b.K,
      a = K.generator,
      a3 = K.mul(K.mul(a, a), a);
    const u = K.add(K.mul(K.element([q(1n, 8n)]), a3), K.mul(b.integer(-2), a));
    const v = K.add(
      K.mul(b.integer(3), a),
      K.neg(K.mul(K.element([q(1n, 8n)]), a3))
    );
    put(
      b,
      'source-judson-biquadratic',
      judson + '21.05:_Exercises',
      'Judson exercise 21.5.3(a): x^4-10x^2+21, with supplied alpha=sqrt(3)+sqrt(7).',
      [u, K.neg(u), v, K.neg(v)]
    );
  }
  {
    const b = new Builder([-3, 0, 0, 1]),
      K = b.K,
      a = K.generator;
    result.push(
      b.make(
        'source-judson-cubic-partial',
        'sourced-partial-split',
        [
          { coefficients: b.linear(a), multiplicity: 1 },
          { coefficients: [K.mul(a, a), a, K.one], multiplicity: 1 },
        ],
        {
          kind: 'adapted',
          source: judson + '21.02:_Splitting_Fields',
          description:
            'Judson example 21.30: x^3-3 over its real cubic root field, not the full splitting field.',
          irreducibility:
            'The remaining quadratic has negative discriminant -3 alpha^2 in the real embedding, hence no root in this real field.',
        }
      )
    );
  }
  return result;
}
