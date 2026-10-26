import {
  FiniteGroupTable,
  FiniteSubgroup,
  FiniteGroupSession,
  GroupWork,
  GroupInputError,
  GroupLimitError,
} from './finite-group.js';
import { integerGcd } from '../polynomial/exact-field.js';

/** A mapping is published only after checking every multiplication equation. */
export class FiniteGroupHomomorphism {
  readonly #source: FiniteGroupTable;
  readonly #target: FiniteGroupTable;
  readonly #images: readonly number[];
  constructor(
    source: FiniteGroupTable,
    target: FiniteGroupTable,
    images: readonly number[],
    work: GroupWork
  ) {
    if (
      !FiniteGroupTable.is(source) ||
      !FiniteGroupTable.is(target) ||
      !Array.isArray(images) ||
      images.length !== source.order
    )
      throw new GroupInputError('invalid-group-homomorphism');
    images.forEach((x) => {
      work.tick();
      target.element(x);
    });
    for (let a = 0; a < source.order; a++)
      for (let b = 0; b < source.order; b++)
        if (
          images[source.product(a, b, work)] !==
          target.product(images[a], images[b], work)
        )
          throw new GroupInputError('map-is-not-a-group-homomorphism');
    this.#source = source;
    this.#target = target;
    this.#images = Object.freeze([...images]);
    Object.freeze(this);
  }
  static is(x: unknown): x is FiniteGroupHomomorphism {
    return typeof x === 'object' && x !== null && #images in x;
  }
  get source(): FiniteGroupTable {
    return this.#source;
  }
  get target(): FiniteGroupTable {
    return this.#target;
  }
  get images(): readonly number[] {
    return this.#images;
  }
  apply(x: number): number {
    this.source.element(x);
    return this.images[x];
  }
  kernel(w: GroupWork): FiniteSubgroup {
    return this.source
      .session(w)
      .generated(this.images.flatMap((x, i) => (x === 0 ? [i] : [])));
  }
  image(w: GroupWork): FiniteSubgroup {
    return this.target.session(w).generated([...new Set(this.images)]);
  }
  inverse(w: GroupWork): FiniteGroupHomomorphism {
    if (
      this.source.order !== this.target.order ||
      new Set(this.images).size !== this.target.order
    )
      throw new GroupInputError('homomorphism-is-not-bijective');
    const images = Array<number>(this.target.order);
    this.images.forEach((x, i) => {
      w.tick();
      images[x] = i;
    });
    return new FiniteGroupHomomorphism(this.target, this.source, images, w);
  }
  then(next: FiniteGroupHomomorphism, w: GroupWork): FiniteGroupHomomorphism {
    if (!FiniteGroupHomomorphism.is(next) || this.target !== next.source)
      throw new GroupInputError('incompatible-homomorphism-domains');
    return new FiniteGroupHomomorphism(
      this.source,
      next.target,
      this.images.map((x) => next.apply(x)),
      w
    );
  }
}

export function finiteGroupExponent(
  s: FiniteGroupSession,
  g = s.whole
): bigint {
  s.receive(g);
  let result = 1n;
  for (const x of g.members) {
    const order = BigInt(s.elementOrder(x));
    result = (result / integerGcd(result, order)) * order;
  }
  return result;
}
export function finiteGroupPrime(
  s: FiniteGroupSession,
  g = s.whole
): number | undefined {
  s.receive(g);
  if (g.order === 1) return undefined;
  let p = 2;
  while (g.order % p !== 0) {
    s.work.tick();
    p++;
  }
  let n = g.order;
  while (n % p === 0) n /= p;
  return n === 1 ? p : undefined;
}
export function finiteGroupIsElementaryAbelian(
  s: FiniteGroupSession,
  g = s.whole
): boolean {
  if (!s.isAbelian(g)) return false;
  if (g.order === 1) return true;
  const p = finiteGroupPrime(s, g);
  return p !== undefined && finiteGroupExponent(s, g) === BigInt(p);
}
export function finiteHallSubgroups(
  s: FiniteGroupSession,
  g: FiniteSubgroup,
  primes: readonly number[]
): readonly FiniteSubgroup[] {
  s.receive(g);
  if (!Array.isArray(primes) || primes.length > 256)
    throw new GroupInputError('invalid-hall-primes');
  primes.forEach((p) => s.prime(p));
  let remaining = g.order,
    target = 1;
  for (const p of new Set(primes))
    while (remaining % p === 0) {
      remaining /= p;
      target *= p;
    }
  return Object.freeze(s.subgroups(g).filter((h) => h.order === target));
}
export function finiteComplementRepresentatives(
  s: FiniteGroupSession,
  g: FiniteSubgroup,
  n: FiniteSubgroup
): readonly FiniteSubgroup[] {
  if (!s.isNormal(g, n))
    throw new GroupInputError('complement-requires-normal-subgroup');
  const result: FiniteSubgroup[] = [];
  for (const h of s.subgroups(g)) {
    if (h.order * n.order !== g.order || s.intersection(h, n).order !== 1)
      continue;
    if (
      result.some((k) =>
        g.members.some((x) => s.equal(h, s.conjugateSubgroup(k, x)))
      )
    )
      continue;
    result.push(h);
  }
  return Object.freeze(result);
}
export function finiteGroupSeries(
  s: FiniteGroupSession,
  kind: 'composition' | 'chief' | 'supersolvable',
  g = s.whole
): readonly FiniteSubgroup[] | undefined {
  s.receive(g);
  if (kind === 'composition') {
    const result = [g];
    while (g.order > 1) {
      const next = s
        .normalSubgroups(g)
        .filter((h) => h.order < g.order)
        .sort((a, b) => b.order - a.order)[0];
      result.push(next);
      g = next;
    }
    return Object.freeze(result);
  }
  if (kind !== 'chief' && kind !== 'supersolvable')
    throw new GroupInputError('invalid-normal-series-kind');
  const normals = [...s.normalSubgroups(g)].sort((a, b) => a.order - b.order),
    paths = new Map<FiniteSubgroup, FiniteSubgroup[]>();
  const start = normals.find((h) => h.order === 1)!;
  paths.set(start, [start]);
  for (const h of normals) {
    const path = paths.get(h);
    if (!path) continue;
    if (h.order === g.order) return Object.freeze([...path].reverse());
    const larger = normals.filter((k) => k.order > h.order && s.subset(k, h));
    for (const k of larger) {
      if (
        kind === 'chief' &&
        larger.some((j) => j.order < k.order && s.subset(k, j))
      )
        continue;
      if (kind === 'supersolvable') {
        const index = k.order / h.order;
        let prime = true;
        for (let d = 2; d * d <= index; d++) {
          s.work.tick();
          if (index % d === 0) {
            prime = false;
            break;
          }
        }
        if (!prime) continue;
      }
      if (!paths.has(k)) paths.set(k, [...path, k]);
    }
  }
  return undefined;
}
export function finitePowerSubgroup(
  s: FiniteGroupSession,
  g: FiniteSubgroup,
  p: number,
  k: number,
  kind: 'omega' | 'agemo'
): FiniteSubgroup {
  s.receive(g);
  s.prime(p);
  if (!Number.isSafeInteger(k) || k < 0 || k > 4096)
    throw new GroupInputError('invalid-prime-power-exponent');
  if (g.order > 1 && finiteGroupPrime(s, g) !== p)
    throw new GroupInputError('requires-p-group');
  if (kind !== 'omega' && kind !== 'agemo')
    throw new GroupInputError('invalid-power-subgroup-kind');
  // No element order exceeds |G|, so powers beyond this point have stabilized.
  let exponent = 1n;
  for (let i = 0; i < k && exponent < BigInt(g.order); i++) {
    s.work.tick();
    exponent *= BigInt(p);
  }
  return s.generated(
    kind === 'omega'
      ? g.members.filter((x) => s.pow(x, exponent) === 0)
      : [...new Set(g.members.map((x) => s.pow(x, exponent)))]
  );
}
export function finitePCentralSeries(
  s: FiniteGroupSession,
  g: FiniteSubgroup,
  p: number
): readonly FiniteSubgroup[] {
  s.prime(p);
  if (g.order > 1 && finiteGroupPrime(s, g) !== p)
    throw new GroupInputError('requires-p-group');
  s.receive(g);
  const result = [g];
  while (result.at(-1)!.order > 1) {
    const last = result.at(-1)!;
    const next = s.closure(
      s.commutatorSubgroup(last, g),
      s.generated([...new Set(last.members.map((x) => s.pow(x, BigInt(p))))])
    );
    if (next.order === last.order)
      throw new Error('p-central series did not descend');
    result.push(next);
  }
  return Object.freeze(result);
}
export function finiteRationalClasses(
  s: FiniteGroupSession,
  g = s.whole
): readonly (readonly number[])[] {
  s.receive(g);
  const result: (readonly number[])[] = [],
    seen = new Set<number>();
  for (const x of g.members) {
    s.work.tick();
    if (seen.has(x)) continue;
    const order = s.elementOrder(x),
      members = new Set<number>();
    for (let k = 1; k <= order; k++) {
      s.work.tick();
      if (integerGcd(BigInt(k), BigInt(order)) !== 1n) continue;
      const y = s.pow(x, BigInt(k));
      for (const a of g.members) members.add(s.conjugate(y, a));
    }
    const c = [...members].sort((a, b) => a - b);
    c.forEach((x) => seen.add(x));
    result.push(Object.freeze(c));
  }
  return Object.freeze(result);
}

/** Exhaustive generator-image search. A limit error must not be read as rigidity. */
export function finiteAutomorphisms(
  s: FiniteGroupSession,
  maxAutomorphisms = 4096
): readonly FiniteGroupHomomorphism[] {
  if (
    !Number.isSafeInteger(maxAutomorphisms) ||
    maxAutomorphisms < 1 ||
    maxAutomorphisms > 4096
  )
    throw new GroupInputError('invalid-automorphism-count-limit');
  const gens: number[] = [];
  let generated = s.trivial;
  for (let x = 1; x < s.group.order; x++) {
    s.work.tick();
    if (generated.has(x)) continue;
    gens.push(x);
    generated = s.generated(gens);
  }
  const words = Array.from({ length: s.group.order }, (_, x) =>
    s.factorization(gens, x)!
  );
  const orders = Array.from({ length: s.group.order }, (_, x) =>
    s.elementOrder(x)
  );
  const choices = gens.map((g) =>
      orders.flatMap((o, i) => (o === orders[g] ? [i] : []))
    ),
    result: FiniteGroupHomomorphism[] = [];
  const visit = (images: number[]): void => {
    s.work.tick();
    if (images.length < gens.length) {
      for (const x of choices[images.length]) visit([...images, x]);
      return;
    }
    const mapping = words.map((word) =>
      word.reduce((a, i) => s.mul(a, images[i - 1]), 0)
    );
    if (new Set(mapping).size !== s.group.order) return;
    // Generator-edge equations prove compatibility for every word, before the full certificate check.
    for (let a = 0; a < s.group.order; a++)
      for (let j = 0; j < gens.length; j++)
        if (mapping[s.mul(a, gens[j])] !== s.mul(mapping[a], images[j])) return;
    if (result.length >= maxAutomorphisms)
      throw new GroupLimitError('automorphism-count-limit');
    result.push(new FiniteGroupHomomorphism(s.group, s.group, mapping, s.work));
  };
  visit([]);
  return Object.freeze(result);
}
export function finiteIsCharacteristic(
  s: FiniteGroupSession,
  h: FiniteSubgroup
): boolean {
  s.receive(h);
  return finiteAutomorphisms(s).every((a) =>
    h.members.every((x) => {
      s.work.tick();
      return h.has(a.apply(x));
    })
  );
}

/** Primary cyclic orders of the abelianization, derived from exact p-power torsion counts. */
export function finiteAbelianInvariants(
  s: FiniteGroupSession,
  g = s.whole
): readonly number[] {
  const quotient = s.quotient(g, s.derived(g)),
    S = quotient.group.session(s.work),
    orders = S.whole.members.map((x) => S.elementOrder(x));
  let remaining = S.whole.order;
  const result: number[] = [];
  for (let p = 2; p <= remaining; p++) {
    s.work.tick();
    if (remaining % p !== 0) continue;
    let exponent = 0;
    while (remaining % p === 0) {
      remaining /= p;
      exponent++;
    }
    const ranks: number[] = [];
    let previous = 0,
      power = 1;
    for (let k = 1; k <= exponent; k++) {
      power *= p;
      let count = orders.filter((order) => {
          s.work.tick();
          return power % order === 0;
        }).length,
        log = 0;
      while (count > 1 && count % p === 0) {
        count /= p;
        log++;
      }
      if (count !== 1)
        throw new Error('Abelian p-torsion has non-prime-power size');
      ranks.push(log - previous);
      previous = log;
    }
    ranks.push(0);
    power = 1;
    for (let i = 0; i < ranks.length - 1; i++) {
      power *= p;
      for (let j = 0; j < ranks[i] - ranks[i + 1]; j++) result.push(power);
    }
  }
  return Object.freeze(result.sort((a, b) => a - b));
}

/** Count ordered generating tuples by subtracting tuples generating proper subgroups. */
export function finiteEulerianFunction(
  s: FiniteGroupSession,
  length: number,
  g = s.whole
): bigint {
  if (!Number.isSafeInteger(length) || length < 0 || length > 4096)
    throw new GroupInputError('invalid-generating-tuple-length');
  const lattice = [...s.subgroups(g)].sort((a, b) => a.order - b.order),
    counts = new Map<FiniteSubgroup, bigint>();
  for (const h of lattice) {
    s.work.tick(Math.max(1, length));
    let count = BigInt(h.order) ** BigInt(length);
    for (const [k, n] of counts)
      if (k.order < h.order && s.subset(h, k)) count -= n;
    counts.set(h, count);
  }
  return counts.get(lattice.at(-1)!)!;
}
export function finiteMinimalGenerators(
  s: FiniteGroupSession,
  g = s.whole
): readonly number[] {
  s.receive(g);
  const queue = [{ subgroup: s.trivial, generators: [] as number[] }],
    seen = new Set(['0']);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node.subgroup.order === g.order) return Object.freeze(node.generators);
    for (const x of g.members) {
      s.work.tick();
      if (node.subgroup.has(x)) continue;
      const gens = [...node.generators, x],
        h = s.generated(gens),
        key = h.members.join(',');
      if (seen.has(key)) continue;
      if (queue.length >= 4096)
        throw new GroupLimitError('subgroup-count-limit');
      seen.add(key);
      queue.push({ subgroup: h, generators: gens });
    }
  }
  throw new Error('Finite group cannot be generated by all of its elements');
}
export function finiteIndependentAbelianGenerators(
  s: FiniteGroupSession,
  g = s.whole
): readonly number[] {
  if (!s.isAbelian(g))
    throw new GroupInputError('independent-generators-require-abelian-group');
  const orders = [...finiteAbelianInvariants(s, g)].sort((a, b) => b - a),
    elementOrders = new Map(g.members.map((x) => [x, s.elementOrder(x)]));
  const search = (
    gens: number[],
    current: FiniteSubgroup
  ): number[] | undefined => {
    s.work.tick();
    if (gens.length === orders.length)
      return current.order === g.order ? gens : undefined;
    for (const x of g.members) {
      s.work.tick();
      if (elementOrders.get(x) !== orders[gens.length]) continue;
      const cyclic = s.generated([x]);
      if (s.intersection(current, cyclic).order !== 1) continue;
      const next = search([...gens, x], s.closure(current, cyclic));
      if (next) return next;
    }
    return undefined;
  };
  const gens = search([], s.trivial);
  if (!gens)
    throw new Error(
      'Abelian primary decomposition has no independent generators'
    );
  return Object.freeze(
    gens.sort((a, b) => elementOrders.get(a)! - elementOrders.get(b)!)
  );
}
export function finiteCommutatorLength(
  s: FiniteGroupSession,
  x: number,
  g = s.whole
): number | undefined {
  s.receive(g);
  s.group.element(x);
  const commutators = new Set<number>();
  for (const a of g.members)
    for (const b of g.members) commutators.add(s.commutator(a, b));
  return s.factorization([...commutators], x)?.length;
}
export function finiteSubgroupConjugacyClasses(
  s: FiniteGroupSession,
  g = s.whole
): readonly (readonly FiniteSubgroup[])[] {
  const lattice = s.subgroups(g),
    index = new Map(lattice.map((h) => [h.members.join(','), h])),
    seen = new Set<string>(),
    result: (readonly FiniteSubgroup[])[] = [];
  for (const h of lattice) {
    s.work.tick();
    if (seen.has(h.members.join(','))) continue;
    const members = new Map<string, FiniteSubgroup>();
    for (const x of g.members) {
      const conjugate = s.conjugateSubgroup(h, x),
        key = conjugate.members.join(',');
      members.set(key, index.get(key)!);
      seen.add(key);
    }
    result.push(Object.freeze([...members.values()]));
  }
  return Object.freeze(result);
}
