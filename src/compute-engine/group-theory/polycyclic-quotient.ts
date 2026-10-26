import { FinitePcgs } from './polycyclic.js';
import { FiniteSubgroup, GroupInputError, GroupWork } from './finite-group.js';
import {
  finiteGroupIsElementaryAbelian,
  finiteGroupPrime,
} from './finite-structure.js';
import { ExactMatrixField, ExactMatrixValue } from './matrix.js';

/** Quotient coordinates retain both the parent domain and checked projection/lift maps. */
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
    w: GroupWork
  ) {
    if (!FinitePcgs.is(parent))
      throw new GroupInputError('invalid-parent-pcgs');
    const S = parent.group.session(w);
    if (
      !S.subset(parent.subgroup, numerator) ||
      !S.isNormal(numerator, denominator)
    )
      throw new GroupInputError('invalid-pc-quotient');
    const induced = parent.induced(numerator, w),
      quotient = induced.quotient(denominator, w);
    const lifts: number[] = [],
      images: number[] = [];
    let generated = quotient.group.session(w).trivial;
    // Remove trivial factors from the end so projected suffixes keep their meaning.
    for (let i = induced.sequence.length - 1; i >= 0; i--) {
      const x = induced.sequence[i],
        image = quotient.projection[x];
      if (generated.has(image)) continue;
      lifts.unshift(x);
      images.unshift(image);
      generated = quotient.group.session(w).generated(images);
    }
    const pcgs = FinitePcgs.fromSequence(quotient.group, images, w);
    this.#parent = parent;
    this.#numerator = numerator;
    this.#denominator = denominator;
    this.#quotient = quotient;
    this.#pcgs = pcgs;
    this.#lifts = Object.freeze(lifts);
    Object.freeze(this);
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
  project(x: number, w: GroupWork): number {
    w.tick();
    this.parent.group.element(x);
    if (!this.numerator.has(x))
      throw new GroupInputError('element-outside-quotient-numerator');
    return this.#quotient.projection[x];
  }
  exponents(x: number, w: GroupWork): readonly number[] {
    return this.pcgs.exponents(this.project(x, w), w);
  }
  lift(x: number, w: GroupWork): number {
    const v = this.pcgs.exponents(x, w),
      S = this.parent.group.session(w);
    let result = 0;
    for (let i = 0; i < v.length; i++)
      result = S.mul(result, S.pow(this.lifts[i], BigInt(v[i])));
    return result;
  }
  element(exponents: readonly number[], w: GroupWork): number {
    return this.lift(this.pcgs.element(exponents, w), w);
  }
  projectSubgroup(h: FiniteSubgroup, w: GroupWork): FinitePcgs {
    const S = this.parent.group.session(w);
    if (!S.subset(this.numerator, h))
      throw new GroupInputError('subgroup-outside-quotient-numerator');
    const image = this.pcgs.group
      .session(w)
      .generated([...new Set(h.members.map((x) => this.project(x, w)))]);
    return this.pcgs.induced(image, w);
  }
  liftSubgroup(h: FiniteSubgroup, w: GroupWork): FinitePcgs {
    this.pcgs.group.session(w).receive(h);
    const S = this.parent.group.session(w);
    const preimage = S.generated([
      ...new Set([
        ...this.denominator.members,
        ...h.members.map((x) => this.lift(x, w)),
      ]),
    ]);
    return this.parent.induced(preimage, w);
  }
  /** Conjugation on an elementary abelian section, in row-vector convention. */
  linearAction(x: number, w: GroupWork): ExactMatrixValue {
    const S = this.parent.group.session(w);
    this.parent.exponents(x, w);
    if (
      !this.numerator.members.every((a) =>
        this.numerator.has(S.conjugate(a, x))
      ) ||
      !this.denominator.members.every((a) =>
        this.denominator.has(S.conjugate(a, x))
      )
    )
      throw new GroupInputError('element-does-not-normalize-pc-section');
    const Q = this.pcgs.group.session(w);
    if (!finiteGroupIsElementaryAbelian(Q) || Q.whole.order === 1)
      throw new GroupInputError(
        'requires-nontrivial-elementary-abelian-section'
      );
    const p = finiteGroupPrime(Q)!;
    if (this.pcgs.relativeOrders.some((r) => r !== p))
      throw new GroupInputError('section-coordinates-are-not-a-vector-basis');
    return new ExactMatrixValue(
      new ExactMatrixField(p),
      this.lifts.map((a) => this.exponents(S.conjugate(a, x), w).map(BigInt)),
      w
    );
  }
  /** v maps to v A + b; homogeneous row coordinates are (v,1). */
  affineAction(x: number, translation: number, w: GroupWork): ExactMatrixValue {
    const a = this.linearAction(x, w),
      b = this.exponents(translation, w);
    return new ExactMatrixValue(
      a.field,
      [...a.rows.map((row) => [...row, 0n]), [...b.map(BigInt), 1n]],
      w
    );
  }
}
