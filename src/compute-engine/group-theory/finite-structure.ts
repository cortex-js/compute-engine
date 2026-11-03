/**
 * Structural queries on the finite tables and subgroup values in finite-group.ts.
 * The kernel uses element indices, not symbolic expressions. All subgroups in a
 * computation belong to the same table; different enumerations are different
 * domains even when the abstract groups are isomorphic.
 *
 * Methods. Prime-power and nilpotent groups use the Frattini quotient, central
 * prime-factor refinements and primary powers. Other groups use complete
 * subgroup lattices or generator-image searches. Those searches are exponential
 * in general; the table-order bound alone does not make them inexpensive.
 *
 * Automorphisms are specified by generator images and certified by Cayley-graph
 * propagation. Characteristic tests first recompute subgroups fixed by every
 * automorphism, then use the exhaustive search if no structural answer applies.
 * No value carries trusted construction history.
 *
 * Resources. Every nested operation shares the session's GroupWork ledger.
 * Lattices contain at most 4,096 subgroups and automorphism lists at most 4,096
 * maps. A completed empty list or false answer is mathematical; a GroupLimitError
 * means the requested computation is incomplete and carries no partial answer.
 */
import {
  FiniteSubgroup,
  FiniteGroupHomomorphism,
  FiniteGroupSession,
  GroupInputError,
  GroupLimitError,
} from './finite-group.js';
import { integerGcd } from '../polynomial/exact-field.js';

export { FiniteGroupHomomorphism } from './finite-group.js';

/**
 * The exponent is the least common multiple of all element orders. The direct
 * scan uses at most |G|² table products; it makes no cyclicity assumption.
 */
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
  return s.primePower(g);
}
/**
 * An abelian group of prime-power order is elementary abelian exactly when its
 * exponent is that prime. The trivial group satisfies the predicate as well.
 */
export function finiteGroupIsElementaryAbelian(
  s: FiniteGroupSession,
  g = s.whole
): boolean {
  if (!s.isAbelian(g)) return false;
  if (g.order === 1) return true;
  const p = finiteGroupPrime(s, g);
  return p !== undefined && finiteGroupExponent(s, g) === BigInt(p);
}
/**
 * Return all Hall subgroups for the selected primes. Nilpotent groups have one
 * such subgroup, computed by primary projection; the general fallback filters
 * the complete subgroup lattice by its required order.
 */
export function finiteHallSubgroups(
  s: FiniteGroupSession,
  g: FiniteSubgroup,
  primes: readonly number[]
): readonly FiniteSubgroup[] {
  s.receive(g);
  if (primes.length > 256) throw new GroupInputError('invalid-hall-primes');
  primes.forEach((p) => s.prime(p));
  let remaining = g.order,
    target = 1;
  for (const p of new Set(primes))
    while (remaining % p === 0) {
      remaining /= p;
      target *= p;
    }
  if (target === g.order) return [g];
  if (target === 1) return [s.trivial];
  if (s.isNilpotent(g)) {
    // A finite nilpotent group is the direct product of its Sylow subgroups.
    // The selected factors form its unique Hall subgroup H. The complementary
    // order kills all other factors and is coprime to |H|, so these powers of
    // the original generators generate exactly H (no subgroup search).
    return [s.generated(g.generators.map((x) => s.pow(x, BigInt(remaining))))];
  }
  return s.subgroups(g).filter((h) => h.order === target);
}
/**
 * A subgroup complements N exactly when its order times |N| is |G| and its
 * intersection with N is trivial. Enumerate those subgroups and retain one per
 * conjugacy orbit; normality of N makes G = NH follow from the order test.
 */
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
  return result;
}
/**
 * Construct a descending series including G and the identity. Central
 * prime-order extensions handle nilpotent groups. Otherwise composition
 * factors come from maximal proper normal subgroups of each term; chief and
 * supersolvable series search the normal-subgroup lattice of G.
 */
export function finiteGroupSeries(
  s: FiniteGroupSession,
  kind: 'composition' | 'chief' | 'supersolvable',
  g = s.whole
): readonly FiniteSubgroup[] | undefined {
  s.receive(g);
  if (s.isNilpotent(g)) {
    // Every nontrivial quotient of a finite nilpotent group has a nontrivial
    // center. Extend N by a central element of prime order modulo N. Each
    // extension is normal in G and has prime index, hence the reversed chain
    // is simultaneously a composition, chief and supersolvable series.
    // Testing centrality against generators suffices; no quotient table or
    // subgroup lattice is constructed. There are at most log2(|G|) steps.
    const ascending = [s.trivial];
    while (ascending.at(-1)!.order < g.order) {
      const last = ascending.at(-1)!;
      const x = g.members.find((element) => {
        s.work.tick();
        return (
          !last.has(element) &&
          g.generators.every((generator) =>
            last.has(s.commutator(element, generator))
          )
        );
      });
      if (x === undefined)
        throw new Error('Nilpotent quotient has trivial center');
      let power = x,
        order = 1;
      while (!last.has(power)) {
        power = s.mul(power, x);
        order++;
      }
      let prime = 2;
      while (order % prime !== 0) {
        s.work.tick();
        prime++;
      }
      ascending.push(
        s.generated([...last.generators, s.pow(x, BigInt(order / prime))])
      );
    }
    return ascending.reverse();
  }
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
    return result;
  }
  // Ascending normal subgroups form a DAG under inclusion. A chief series
  // follows cover edges (no normal subgroup between them); a supersolvable
  // series follows prime-index edges. A path to G certifies the entire series.
  const normals = [...s.normalSubgroups(g)].sort((a, b) => a.order - b.order),
    paths = new Map<FiniteSubgroup, FiniteSubgroup[]>();
  const start = normals.find((h) => h.order === 1)!;
  paths.set(start, [start]);
  for (const h of normals) {
    const path = paths.get(h);
    if (!path) continue;
    if (h.order === g.order) return [...path].reverse();
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
/**
 * For a p-group, omega is generated by elements killed by p^k and agemo by
 * p^k-th powers. The torsion elements need not themselves form a subgroup, so
 * both answers take generated closure.
 */
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
/**
 * Iterate P_(i+1) = [P_i,G] P_i^p. Each term is characteristic in G, and the
 * sequence strictly descends to the identity for a finite p-group. Table scans
 * provide all commutators and powers before taking closure.
 */
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
  return result;
}
/**
 * Rational conjugacy joins the conjugacy classes of x^k for k coprime to |x|.
 * These are exactly the generators of conjugates of <x>. Marking complete
 * classes prevents repeated orbit construction.
 */
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
    result.push(c);
  }
  return result;
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
  // An automorphism preserves the order of every generated prefix subgroup.
  // Pruning dependent image prefixes avoids exploring n^d non-bijective tuples
  // in elementary abelian groups before reaching the first basis. These tests
  // are only necessary conditions; Cayley-graph propagation below proves all
  // relations before a candidate becomes a homomorphism.
  const prefixOrders = gens.map(
    (_, i) => s.generated(gens.slice(0, i + 1)).order
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
      for (const x of choices[images.length]) {
        const next = [...images, x];
        // Orders already certify the first prefix. The final map check proves
        // generation and bijectivity, so only intermediate prefixes need closure.
        if (
          next.length === 1 ||
          next.length === gens.length ||
          s.generated(next).order === prefixOrders[images.length]
        )
          visit(next);
      }
      return;
    }
    const mapping = FiniteGroupHomomorphism.fromGeneratorImages(
      s.group,
      s.group,
      gens,
      images,
      s.work
    );
    if (!mapping || new Set(mapping.images).size !== s.group.order) return;
    if (result.length >= maxAutomorphisms)
      throw new GroupLimitError('automorphism-count-limit');
    result.push(mapping);
  };
  visit([]);
  return result;
}
/**
 * Decide invariance under every automorphism of the session group. Canonical
 * subgroup constructions provide exact positive shortcuts; otherwise all
 * generator-image automorphisms are checked. Exhaustion is never evidence of
 * invariance.
 */
export function finiteIsCharacteristic(
  s: FiniteGroupSession,
  h: FiniteSubgroup
): boolean {
  s.receive(h);
  const whole = s.whole;
  if (h.order === 1 || h.order === whole.order) return true;
  if (!s.isNormal(whole, h)) return false;
  // GL(d,p) is transitive on nonzero vectors. No nonzero proper subspace of
  // an elementary abelian group is invariant under every automorphism.
  if (finiteGroupIsElementaryAbelian(s, whole)) return false;
  // These constructions commute with every automorphism. Recompute their
  // actual members and compare sets: an imported subgroup is accepted on its
  // mathematics, never on a claimed name or construction history.
  if (s.equal(h, s.center(whole))) return true;
  for (const kind of ['derived', 'lower-central', 'upper-central'] as const)
    if (s.series(kind, whole).some((term) => s.equal(h, term))) return true;
  if (s.equal(h, s.frattini(whole))) return true;
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
  return result.sort((a, b) => a - b);
}

/** Count ordered generating tuples by subtracting tuples generating proper subgroups. */
export function finiteEulerianFunction(
  s: FiniteGroupSession,
  length: number,
  g = s.whole
): bigint {
  if (!Number.isSafeInteger(length) || length < 0 || length > 4096)
    throw new GroupInputError('invalid-generating-tuple-length');
  s.receive(g);
  if (g.order === 1) return 1n;
  if (s.primePower(g) !== undefined || s.isAbelian(g)) {
    // A finite nilpotent group is generated exactly when its tuple spans each
    // primary component of G/Φ(G). A rank-d component contributes
    // product_i (p^k - p^i), and each entry has |Φ(G)| independent lifts.
    const frattini = s.frattini(g);
    let quotientOrder = g.order / frattini.order;
    s.work.tick(Math.max(1, length));
    let count = BigInt(frattini.order) ** BigInt(length);
    for (let prime = 2; prime <= quotientOrder; prime++) {
      s.work.tick();
      if (quotientOrder % prime !== 0) continue;
      let dimension = 0;
      while (quotientOrder % prime === 0) {
        quotientOrder /= prime;
        dimension++;
      }
      if (length < dimension) return 0n;
      s.work.tick(Math.max(1, length * dimension));
      const space = BigInt(prime) ** BigInt(length);
      let power = 1n;
      for (let i = 0; i < dimension; i++) {
        count *= space - power;
        power *= BigInt(prime);
      }
    }
    return count;
  }
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
/**
 * Return a generating tuple of minimum length. A Frattini basis handles
 * p-groups, primary factors handle abelian groups, and breadth-first subgroup
 * extension provides the bounded general fallback.
 */
export function finiteMinimalGenerators(
  s: FiniteGroupSession,
  g = s.whole
): readonly number[] {
  s.receive(g);
  if (g.order === 1) return [];
  if (s.primePower(g) !== undefined) {
    // Any basis of G/Φ(G) lifts to a minimum generating set of the p-group.
    // Greedy extension is linear algebra on this elementary abelian quotient,
    // implemented through subgroup membership without enumerating its lattice.
    let generated = s.frattini(g);
    const generators: number[] = [];
    for (const x of g.members) {
      s.work.tick();
      if (generated.has(x)) continue;
      generators.push(x);
      generated = s.generated([...generated.generators, x]);
      if (generated.order === g.order) return generators;
    }
  }
  const cyclicGenerator = g.members.find((x) => s.elementOrder(x) === g.order);
  if (cyclicGenerator !== undefined) return [cyclicGenerator];
  if (g.generators.length === 2) return g.generators;
  if (s.isAbelian(g)) {
    // Primary cyclic factors can share a generator exactly when their orders
    // are coprime. Combining one factor from each prime gives max_p rank(G_p),
    // the minimum number required by the elementary abelian quotients.
    const primary = new Map<number, number[]>();
    for (const x of finiteIndependentAbelianGenerators(s, g)) {
      const order = s.elementOrder(x);
      let prime = 2;
      while (order % prime !== 0) {
        s.work.tick();
        prime++;
      }
      const factors = primary.get(prime) ?? [];
      factors.push(x);
      primary.set(prime, factors);
    }
    const result: number[] = [];
    for (const factors of primary.values())
      factors.forEach((x, i) => {
        result[i] = s.mul(result[i] ?? 0, x);
      });
    return result;
  }
  // Every edge adds one generator, so the first whole group reached by BFS
  // has minimum generator count. Equal member sets have identical future
  // extensions; deduplicating them is safe. This fallback can be exponential,
  // and its 4096-state bound reports exhaustion instead of a nonminimal answer.
  const queue = [{ subgroup: s.trivial, generators: [] as number[] }],
    seen = new Set(['0']);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node.subgroup.order === g.order) return node.generators;
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
/**
 * Find primary cyclic direct factors of an abelian group. Their orders come
 * from torsion counts; backtracking chooses generators with trivial
 * intersection with earlier factors. The retained factors therefore multiply
 * directly to G.
 */
export function finiteIndependentAbelianGenerators(
  s: FiniteGroupSession,
  g = s.whole
): readonly number[] {
  if (!s.isAbelian(g))
    throw new GroupInputError('independent-generators-require-abelian-group');
  const orders = [...finiteAbelianInvariants(s, g)].sort((a, b) => b - a),
    elementOrders = new Map(g.members.map((x) => [x, s.elementOrder(x)]));
  // The current subgroup is the direct product of the chosen cyclic factors.
  // Trivial intersection admits the next primary cyclic factor; its prescribed
  // order prevents a smaller substitute. Backtracking is exact but potentially
  // exponential, so every attempted factor consumes the shared work ledger.
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
  return gens.sort((a, b) => elementOrders.get(a)! - elementOrders.get(b)!);
}
/**
 * The shortest word in the complete set of commutators has the least number of
 * commutator factors. Breadth-first factorization returns undefined exactly
 * when the element lies outside the derived subgroup.
 */
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
/**
 * Partition the complete subgroup lattice into conjugacy orbits. Conjugation
 * preserves subgroup order and membership in G, so every orbit member is
 * already represented in the lattice index.
 */
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
    result.push([...members.values()]);
  }
  return result;
}
