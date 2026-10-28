/**
 * Coordinates on a finite section N/D inside a parent pc group.
 * The numerator and denominator retain their ambient domains; only quotient
 * arithmetic uses the quotient table. Lifts choose representatives and never
 * claim to preserve multiplication. Linear actions use row-vector convention.
 */
import { FinitePcgs } from './polycyclic.js';
import { FiniteSubgroup, GroupInputError, GroupWork } from './finite-group.js';
import {
  finiteGroupIsElementaryAbelian,
  finiteGroupPrime,
} from './finite-structure.js';
import { ExactMatrixField, ExactMatrixValue } from './matrix.js';

/**
 * Coordinates for N/D, where D is normal in N and N lies in the parent group.
 * Projection is a homomorphism on N. Lift chooses a coordinate representative
 * in N and is only a set section: project(lift(q)) = q.
 */
export class FiniteModuloPcgs {
  readonly #parent: FinitePcgs;
  readonly #numerator: FiniteSubgroup;
  readonly #denominator: FiniteSubgroup;
  readonly #quotient: ReturnType<FinitePcgs['quotient']>;
  readonly #pcgs: FinitePcgs;
  readonly #lifts: readonly number[];
  constructor(
    parent: FinitePcgs,
    numerator: FiniteSubgroup,
    denominator: FiniteSubgroup,
    work: GroupWork
  ) {
    const session = parent.group.session(work);
    if (
      !session.subset(parent.subgroup, numerator) ||
      !session.isNormal(numerator, denominator)
    )
      throw new GroupInputError('invalid-pc-quotient');
    const induced = parent.induced(numerator, work),
      quotient = induced.quotient(denominator, work);
    const lifts: number[] = [],
      images: number[] = [];
    let generated = quotient.group.session(work).trivial;
    // Remove trivial factors from the end so projected suffixes keep their meaning.
    for (let i = induced.sequence.length - 1; i >= 0; i--) {
      const x = induced.sequence[i],
        image = quotient.projection[x];
      if (generated.has(image)) continue;
      lifts.unshift(x);
      images.unshift(image);
      generated = quotient.group.session(work).generated(images);
    }
    const pcgs = FinitePcgs.fromSequence(quotient.group, images, work);
    this.#parent = parent;
    this.#numerator = numerator;
    this.#denominator = denominator;
    this.#quotient = quotient;
    this.#pcgs = pcgs;
    this.#lifts = lifts;
  }
  get parent(): FinitePcgs {
    return this.#parent;
  }
  get numerator(): FiniteSubgroup {
    return this.#numerator;
  }
  get denominator(): FiniteSubgroup {
    return this.#denominator;
  }
  get pcgs(): FinitePcgs {
    return this.#pcgs;
  }
  get lifts(): readonly number[] {
    return this.#lifts;
  }
  project(x: number, work: GroupWork): number {
    work.tick();
    this.parent.group.element(x);
    if (!this.numerator.has(x))
      throw new GroupInputError('element-outside-quotient-numerator');
    return this.#quotient.projection[x];
  }
  exponents(x: number, work: GroupWork): readonly number[] {
    return this.pcgs.exponents(this.project(x, work), work);
  }
  /** Choose the product of lifted generators; multiplication need not be preserved. */
  lift(x: number, work: GroupWork): number {
    const v = this.pcgs.exponents(x, work),
      session = this.parent.group.session(work);
    let result = 0;
    for (let i = 0; i < v.length; i++)
      result = session.mul(result, session.pow(this.lifts[i], BigInt(v[i])));
    return result;
  }
  element(exponents: readonly number[], work: GroupWork): number {
    return this.lift(this.pcgs.element(exponents, work), work);
  }
  projectSubgroup(h: FiniteSubgroup, work: GroupWork): FinitePcgs {
    const session = this.parent.group.session(work);
    if (!session.subset(this.numerator, h))
      throw new GroupInputError('subgroup-outside-quotient-numerator');
    const image = this.pcgs.group
      .session(work)
      .generated(h.generators.map((x) => this.project(x, work)));
    return this.pcgs.induced(image, work);
  }
  liftSubgroup(h: FiniteSubgroup, work: GroupWork): FinitePcgs {
    this.pcgs.group.session(work).receive(h);
    const session = this.parent.group.session(work);
    const preimage = session.generated([
      ...new Set([
        ...this.denominator.generators,
        ...h.generators.map((x) => this.lift(x, work)),
      ]),
    ]);
    return this.parent.induced(preimage, work);
  }
  /** Conjugation on an elementary abelian section, in row-vector convention. */
  linearAction(x: number, work: GroupWork): ExactMatrixValue {
    const session = this.parent.group.session(work);
    this.parent.exponents(x, work);
    // Conjugation is injective; preserving each generating set proves that
    // both finite subgroups are normalized without scanning every element.
    if (
      !this.numerator.generators.every((a) =>
        this.numerator.has(session.conjugate(a, x))
      ) ||
      !this.denominator.generators.every((a) =>
        this.denominator.has(session.conjugate(a, x))
      )
    )
      throw new GroupInputError('element-does-not-normalize-pc-section');
    const quotientSession = this.pcgs.group.session(work);
    if (
      !finiteGroupIsElementaryAbelian(quotientSession) ||
      quotientSession.whole.order === 1
    )
      throw new GroupInputError(
        'requires-nontrivial-elementary-abelian-section'
      );
    const p = finiteGroupPrime(quotientSession)!;
    if (this.pcgs.relativeOrders.some((r) => r !== p))
      throw new GroupInputError('section-coordinates-are-not-a-vector-basis');
    return ExactMatrixValue.fromRows(
      new ExactMatrixField(p),
      this.lifts.map((a) =>
        this.exponents(session.conjugate(a, x), work).map(BigInt)
      ),
      work
    );
  }
  /** v maps to v A + b; homogeneous row coordinates are (v,1). */
  affineAction(
    x: number,
    translation: number,
    work: GroupWork
  ): ExactMatrixValue {
    const a = this.linearAction(x, work),
      b = this.exponents(translation, work);
    return ExactMatrixValue.fromRows(
      a.field,
      [...a.rows.map((row) => [...row, 0n]), [...b.map(BigInt), 1n]],
      work
    );
  }
}
