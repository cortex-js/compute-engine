/**
 * Finite polycyclic collection by consistent cyclic extensions.
 *
 * An extension adjoins g to a collected tail H, with g^m=t and
 * phi(h)=g^-1 h g. The checked conditions phi(t)=t and phi^m=inner(t)
 * make z^m t^-1 central in H semidirect Z. Its cyclic subgroup intersects
 * H trivially, so the quotient has unique forms g^e h, 0 <= e < m.
 * This proves consistency without enumerating the elements of H.
 */
import { GroupInputError, GroupLimitError, GroupWork } from './finite-group.js';

export type PcCoordinates = readonly bigint[];

export interface CyclicPcExtension {
  relativeOrder: bigint;
  power: PcCoordinates;
  conjugates: readonly PcCoordinates[];
  inverseConjugates: readonly PcCoordinates[];
}

const maximumRank = 64;
const maximumIntegerBits = 4096;
const maximumStoredCoefficients = 1_000_000;

function integerBits(value: bigint): number {
  return (value < 0n ? -value : value).toString(2).length;
}

function checkedInteger(value: unknown, work: GroupWork): bigint {
  work.tick();
  if (typeof value !== 'bigint')
    throw new GroupInputError('pc-presentation-requires-integer');
  const bits = integerBits(value);
  work.tick(bits);
  if (bits > maximumIntegerBits)
    throw new GroupLimitError('pc-presentation-integer-limit');
  return value;
}

function equalCoordinates(
  a: PcCoordinates,
  b: PcCoordinates,
  work: GroupWork
): boolean {
  work.tick(a.length);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * A finite consistent presentation; storage depends on rank, not group order.
 * Coordinates are g0^e0 ... gr^er with exponents in their relative ranges.
 *
 * coordinates() is the validation boundary. Arithmetic accepts canonical
 * vectors from this group, returned by that method or by earlier operations.
 * The adapter must retain the group domain alongside each coordinate vector.
 */
export class CollectedPcGroup {
  readonly relativeOrders: readonly bigint[];
  readonly order: bigint;
  readonly rank: number;
  readonly storedCoefficients: number;
  readonly #identityAction: boolean;
  readonly #directProduct: boolean;

  private constructor(
    readonly tail: CollectedPcGroup | undefined,
    readonly relativeOrder: bigint,
    readonly powerRelation: PcCoordinates,
    readonly conjugates: readonly PcCoordinates[],
    readonly inverseConjugates: readonly PcCoordinates[],
    identityAction: boolean,
    work: GroupWork
  ) {
    this.rank = tail ? tail.rank + 1 : 0;
    this.relativeOrders = tail ? [relativeOrder, ...tail.relativeOrders] : [];
    work.tick(tail ? integerBits(tail.order) + integerBits(relativeOrder) : 1);
    this.order = tail ? relativeOrder * tail.order : 1n;
    this.storedCoefficients =
      (tail?.storedCoefficients ?? 0) +
      this.relativeOrders.length +
      2 +
      powerRelation.length +
      conjugates.reduce((sum, row) => sum + row.length, 0) +
      inverseConjugates.reduce((sum, row) => sum + row.length, 0);
    this.#identityAction = identityAction;
    this.#directProduct =
      !tail ||
      (tail.#directProduct &&
        identityAction &&
        powerRelation.every((x) => x === 0n));
  }

  static trivial(
    work: GroupWork = new GroupWork(50_000_000)
  ): CollectedPcGroup {
    return new CollectedPcGroup(undefined, 1n, [], [], [], true, work);
  }

  static extend(
    tail: CollectedPcGroup,
    input: CyclicPcExtension,
    work: GroupWork
  ): CollectedPcGroup {
    work.tick();
    if (tail.rank >= maximumRank)
      throw new GroupLimitError('pc-presentation-rank-limit');
    const relativeOrder = checkedInteger(input.relativeOrder, work);
    if (relativeOrder < 2n)
      throw new GroupInputError('pc-relative-order-must-exceed-one');
    // Reserve relation vectors, six matrices and eight coordinate vectors at
    // every possible recursive tail depth. Binary composition keeps only
    // current factors, with no powers cached. This is a conservative logical
    // coefficient-slot estimate, not a bound on JavaScript allocator/GC memory.
    const rank = tail.rank;
    const temporary =
      rank * (rank + 1) * (2 * rank + 1) + 4 * rank * (rank + 1);
    const required =
      tail.storedCoefficients + 2 * rank + 3 + 2 * rank ** 2 + temporary;
    if (required > maximumStoredCoefficients)
      throw new GroupLimitError('pc-presentation-storage-limit');
    const power = tail.coordinates(input.power, work);
    const readImages = (images: readonly PcCoordinates[]): PcCoordinates[] => {
      if (!Array.isArray(images) || images.length !== tail.rank)
        throw new GroupInputError('invalid-pc-automorphism-image-count');
      return Array.from(images, (image) => tail.coordinates(image, work));
    };
    const conjugates = readImages(input.conjugates);
    const inverseConjugates = readImages(input.inverseConjugates);
    const identityAction = tail.#isIdentityImages(conjugates, work);
    const identityInverse = tail.#isIdentityImages(inverseConjugates, work);

    if (!identityAction) tail.#validateMap(conjugates, work);
    if (!identityInverse) tail.#validateMap(inverseConjugates, work);
    for (let i = 0; i < tail.rank; i++) {
      const generator = tail.generator(i, work);
      if (
        !equalCoordinates(
          tail.#applyMap(conjugates[i], inverseConjugates, work),
          generator,
          work
        ) ||
        !equalCoordinates(
          tail.#applyMap(inverseConjugates[i], conjugates, work),
          generator,
          work
        )
      )
        throw new GroupInputError('pc-automorphism-images-are-not-inverse');
    }
    if (!equalCoordinates(tail.#applyMap(power, conjugates, work), power, work))
      throw new GroupInputError('pc-power-relation-is-not-invariant');

    const iterated = identityAction
      ? conjugates
      : tail.#powerMap(conjugates, relativeOrder, work);
    const inversePower = tail.inverse(power, work);
    for (let i = 0; i < tail.rank; i++) {
      // inner(t)(h)=t^-1 h t, matching the right conjugation convention.
      const conjugated = tail.multiply(
        tail.multiply(inversePower, tail.generator(i, work), work),
        power,
        work
      );
      if (!equalCoordinates(iterated[i], conjugated, work))
        throw new GroupInputError('pc-cyclic-extension-is-inconsistent');
    }
    return new CollectedPcGroup(
      tail,
      relativeOrder,
      power,
      conjugates,
      inverseConjugates,
      identityAction,
      work
    );
  }

  identity(): PcCoordinates {
    return Array<bigint>(this.rank).fill(0n);
  }

  /** A zero-based generator position in the collected normal form. */
  generator(index: number, work: GroupWork): PcCoordinates {
    work.tick(this.rank + 1);
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.rank)
      throw new GroupInputError('invalid-pc-generator-position');
    const result = Array<bigint>(this.rank).fill(0n);
    result[index] = 1n;
    return result;
  }

  coordinates(input: unknown, work: GroupWork): PcCoordinates {
    work.tick();
    if (!Array.isArray(input) || input.length !== this.rank)
      throw new GroupInputError('invalid-pc-coordinate-count');
    return Array.from(input, (value, index) => {
      const exponent = checkedInteger(value, work);
      if (exponent < 0n || exponent >= this.relativeOrders[index])
        throw new GroupInputError('pc-coordinate-out-of-range');
      return exponent;
    });
  }

  multiply(
    left: PcCoordinates,
    right: PcCoordinates,
    work: GroupWork
  ): PcCoordinates {
    work.tick(this.rank + 1);
    if (this.#directProduct)
      return left.map((value, i) => {
        work.tick(integerBits(value) + integerBits(right[i]));
        return (value + right[i]) % this.relativeOrders[i];
      });
    const tail = this.tail!;
    const sum = left[0] + right[0];
    work.tick(integerBits(left[0]) + integerBits(right[0]));
    let suffix = this.#identityAction
      ? left.slice(1)
      : tail.#applyMapPower(left.slice(1), this.conjugates, right[0], work);
    suffix = tail.multiply(suffix, right.slice(1), work);
    // Canonical inputs imply 0 <= a+b < 2m, hence at most one carry t.
    if (sum >= this.relativeOrder)
      suffix = tail.multiply(this.powerRelation, suffix, work);
    return [sum % this.relativeOrder, ...suffix];
  }

  inverse(value: PcCoordinates, work: GroupWork): PcCoordinates {
    work.tick(this.rank + 1);
    if (this.#directProduct)
      return value.map((exponent, i) => {
        work.tick(integerBits(exponent));
        return exponent === 0n ? 0n : this.relativeOrders[i] - exponent;
      });
    const tail = this.tail!;
    if (value[0] === 0n) return [0n, ...tail.inverse(value.slice(1), work)];
    const exponent = this.relativeOrder - value[0];
    const suffix = this.#identityAction
      ? value.slice(1)
      : tail.#applyMapPower(value.slice(1), this.conjugates, exponent, work);
    return [
      exponent,
      ...tail.inverse(tail.multiply(this.powerRelation, suffix, work), work),
    ];
  }

  power(
    value: PcCoordinates,
    exponent: bigint,
    work: GroupWork
  ): PcCoordinates {
    exponent = checkedInteger(exponent, work);
    if (this.#directProduct) {
      work.tick(this.rank);
      return value.map((coordinate, i) => {
        work.tick(integerBits(coordinate) * integerBits(exponent));
        const order = this.relativeOrders[i];
        return (((coordinate * exponent) % order) + order) % order;
      });
    }
    let factor = exponent < 0n ? this.inverse(value, work) : value;
    if (exponent < 0n) exponent = -exponent;
    let result = this.identity();
    while (exponent !== 0n) {
      work.tick();
      if (exponent & 1n) result = this.multiply(result, factor, work);
      exponent >>= 1n;
      if (exponent !== 0n) factor = this.multiply(factor, factor, work);
    }
    return result;
  }

  #isIdentityImages(
    images: readonly PcCoordinates[],
    work: GroupWork
  ): boolean {
    work.tick(this.rank ** 2 + 1);
    return images.every((image, i) =>
      image.every((value, j) => value === (i === j ? 1n : 0n))
    );
  }

  #applyMap(
    value: PcCoordinates,
    images: readonly PcCoordinates[],
    work: GroupWork
  ): PcCoordinates {
    let result = this.identity();
    for (let i = 0; i < this.rank; i++) {
      work.tick();
      if (value[i] !== 0n)
        result = this.multiply(
          result,
          this.power(images[i], value[i], work),
          work
        );
    }
    return result;
  }

  #composeMaps(
    first: readonly PcCoordinates[],
    second: readonly PcCoordinates[],
    work: GroupWork
  ): readonly PcCoordinates[] {
    return first.map((image) => this.#applyMap(image, second, work));
  }

  #powerMap(
    images: readonly PcCoordinates[],
    exponent: bigint,
    work: GroupWork
  ): readonly PcCoordinates[] {
    let result: readonly PcCoordinates[] = Array.from(
      { length: this.rank },
      (_, i) => this.generator(i, work)
    );
    let factor = images;
    while (exponent !== 0n) {
      work.tick();
      if (exponent & 1n) result = this.#composeMaps(result, factor, work);
      exponent >>= 1n;
      if (exponent === 0n || this.#isIdentityImages(factor, work)) break;
      factor = this.#composeMaps(factor, factor, work);
    }
    return result;
  }

  #applyMapPower(
    value: PcCoordinates,
    images: readonly PcCoordinates[],
    exponent: bigint,
    work: GroupWork
  ): PcCoordinates {
    let result = value;
    let factor = images;
    while (exponent !== 0n) {
      work.tick();
      if (exponent & 1n) result = this.#applyMap(result, factor, work);
      exponent >>= 1n;
      if (exponent === 0n || this.#isIdentityImages(factor, work)) break;
      factor = this.#composeMaps(factor, factor, work);
    }
    return result;
  }

  /** Images must preserve every defining power and conjugation relation of H.
   * An endomorphism follows from these relations; mutual inverse images then
   * establish an automorphism without enumerating H. */
  #validateMap(images: readonly PcCoordinates[], work: GroupWork): void {
    // This cursor walks the tail chain; it does not capture a callback receiver.
    // oxlint-disable-next-line typescript/no-this-alias
    let node: CollectedPcGroup = this;
    for (let i = 0; i < this.rank; i++, node = node.tail!) {
      const prefix = Array<bigint>(i + 1).fill(0n);
      const imagePower = this.power(images[i], node.relativeOrder, work);
      const expectedPower = this.#applyMap(
        [...prefix, ...node.powerRelation],
        images,
        work
      );
      if (!equalCoordinates(imagePower, expectedPower, work))
        throw new GroupInputError('pc-map-does-not-preserve-power-relations');
      const inverse = this.inverse(images[i], work);
      for (let j = i + 1; j < this.rank; j++) {
        const actual = this.multiply(
          this.multiply(inverse, images[j], work),
          images[i],
          work
        );
        const expected = this.#applyMap(
          [...prefix, ...node.conjugates[j - i - 1]],
          images,
          work
        );
        if (!equalCoordinates(actual, expected, work))
          throw new GroupInputError(
            'pc-map-does-not-preserve-conjugation-relations'
          );
      }
    }
  }
}
