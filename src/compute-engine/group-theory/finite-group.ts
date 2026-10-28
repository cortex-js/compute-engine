/**
 * Exact finite groups represented by complete multiplication tables.
 *
 * Representation. A table of order n has elements 0..n-1 and identity 0.
 * Its rows store the product of the row and column indices, in that order.
 * Subgroups store sorted members, a membership bitset and a generating subset.
 * Their ambient table is part of their domain: equally sized or isomorphic
 * tables do not make their element indices interchangeable.
 *
 * Validation. Arbitrary imported tables (n <= 256) pay an O(n³) associativity
 * check, in addition to closure, identity and inverse checks. Permutation and
 * exact-matrix bridges inherit associativity from their group operation and
 * use an O(n²) table check. Private constructors keep these facts invariant.
 * Maps are certified either against all products or by generator-image
 * propagation along the Cayley graph. Quotients retain the verified projection.
 *
 * Algorithms. Generated subgroups use finite Cayley-graph closure. Direct
 * scans handle cosets, normalizers, centralizers and conjugacy. Prime-power
 * and nilpotent formulas avoid subgroup lattices where possible. Other
 * structural queries enumerate subgroup extensions, with a fixed count bound.
 * These fallback searches can be exponential even for a table of modest order.
 *
 * Resources. A session shares one GroupWork ledger across nested algorithms;
 * table products cost one unit and permutation products cost their image-array
 * length. Closure retains at most one million permutation image entries.
 * Lattices stop at 4,096 subgroups and the session cache retains at most 8,192
 * subgroup values. Every charge checks cancellation. Exhaustion throws a named
 * GroupLimitError and never returns an incomplete mathematical answer.
 */
import {
  PermutationGroupValue,
  PermutationClosureLimitError,
  enumeratePermutationGroupWithLimits,
} from './permutation/groups.js';
import { PermutationValue, composePermutations } from './permutation/values.js';

export class GroupInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupInputError';
  }
}
export class GroupLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupLimitError';
  }
}

/** A shared, explicit ledger. Exhaustion never establishes a group property. */
export class GroupWork {
  #used = 0;
  constructor(
    readonly limit: number,
    readonly check?: () => void
  ) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50_000_000)
      throw new GroupInputError('invalid-group-work-limit');
  }
  get used(): number {
    return this.#used;
  }
  tick(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new GroupInputError('invalid-work-charge');
    this.#used += count;
    if (this.#used > this.limit) throw new GroupLimitError('group-work-limit');
    this.check?.();
  }
}

/** Identity has index zero. Imported tables are checked against every group axiom. */
export class FiniteGroupTable {
  readonly #rows: readonly (readonly number[])[];
  readonly #inverses: readonly number[];
  private constructor(rows: number[][], inverses: number[]) {
    this.#rows = rows;
    this.#inverses = inverses;
  }
  static fromTable(input: unknown, work: GroupWork): FiniteGroupTable {
    return this.#validateTable(input, work, true);
  }
  /** Internal representation bridge: the caller proves associativity from its
   * exact group operation. This still checks closure, identity and inverses in
   * O(n²); arbitrary user tables must use fromTable() and its O(n³) check. */
  static fromAssociativeTable(
    input: readonly (readonly number[])[],
    work: GroupWork
  ): FiniteGroupTable {
    return this.#validateTable(input, work, false);
  }
  static #validateTable(
    input: unknown,
    work: GroupWork,
    checkAssociativity: boolean
  ): FiniteGroupTable {
    work.tick();
    if (!Array.isArray(input) || !input.length || input.length > 256)
      throw new GroupInputError('group-table-order-must-be-1-to-256');
    const n = input.length;
    const rows: number[][] = [];
    for (const row of input) {
      work.tick(n);
      if (
        !Array.isArray(row) ||
        row.length !== n ||
        Array.from(row).some((x) => !Number.isSafeInteger(x) || x < 0 || x >= n)
      )
        throw new GroupInputError('invalid-group-table-entry');
      rows.push([...row]);
    }
    const inverses: number[] = [];
    for (let a = 0; a < n; a++) {
      work.tick(n);
      if (rows[0][a] !== a || rows[a][0] !== a)
        throw new GroupInputError('invalid-group-table-identity');
      const b = rows[a].indexOf(0);
      if (b < 0 || rows[b][a] !== 0)
        throw new GroupInputError('invalid-group-table-inverse');
      inverses.push(b);
      if (checkAssociativity)
        for (let b = 0; b < n; b++) {
          work.tick(n);
          for (let c = 0; c < n; c++)
            if (rows[rows[a][b]][c] !== rows[a][rows[b][c]])
              throw new GroupInputError('nonassociative-group-table');
        }
    }
    return new FiniteGroupTable(rows, inverses);
  }
  /** Associativity is inherited from validated permutations and their exact product.
   * Every product is mapped back into the complete closure; arbitrary tables
   * still enter exclusively through fromTable() and its cubic axiom check.
   */
  static fromPermutationGroup(
    group: PermutationGroupValue,
    maxElements: number,
    work: GroupWork
  ) {
    if (
      !Number.isSafeInteger(maxElements) ||
      maxElements < 1 ||
      maxElements > 256
    )
      throw new GroupInputError('invalid-finite-permutation-model');
    const values = { check: work.check };
    let elements: readonly PermutationValue[];
    try {
      // Reuse the reference traversal, retaining the finite model's ceilings.
      // Product widths are charged before allocation to the same ledger used
      // below for all n² table products; repeated closure edges still cost work.
      elements = enumeratePermutationGroupWithLimits(
        group,
        {
          maxElements,
          maxProducts: work.limit,
          maxImageWork: work.limit,
          maxStoredImages: 1_000_000,
        },
        {
          check: () => work.tick(0),
          chargeProduct: (width) => work.tick(width),
        }
      );
    } catch (error) {
      if (!(error instanceof PermutationClosureLimitError)) throw error;
      const code =
        error.code === 'permutation-closure-element-limit'
          ? 'finite-group-element-limit'
          : error.code === 'permutation-closure-storage-limit'
            ? 'finite-group-storage-limit'
            : 'group-work-limit';
      throw new GroupLimitError(code);
    }
    const index = new Map(
      elements.map((element, i) => [element.images.join(','), i])
    );
    const rows = elements.map((a) =>
      elements.map((b) => {
        work.tick(Math.max(1, a.supportDegree, b.supportDegree));
        const i = index.get(composePermutations(a, b, values).images.join(','));
        if (i === undefined)
          throw new Error('Permutation closure is incomplete');
        return i;
      })
    );
    return {
      table: this.fromAssociativeTable(rows, work),
      elements,
      indexOf: (permutation: PermutationValue) =>
        index.get(permutation.images.join(',')),
    };
  }
  get order(): number {
    return this.#rows.length;
  }
  get rows(): readonly (readonly number[])[] {
    return this.#rows;
  }
  element(x: number): void {
    if (!Number.isSafeInteger(x) || x < 0 || x >= this.order)
      throw new GroupInputError('invalid-group-element-index');
  }
  product(a: number, b: number, work: GroupWork): number {
    work.tick();
    this.element(a);
    this.element(b);
    return this.#rows[a][b];
  }
  inverse(a: number): number {
    this.element(a);
    return this.#inverses[a];
  }
  session(work: GroupWork): FiniteGroupSession {
    return new FiniteGroupSession(this, work);
  }
}

/** A generated subgroup owns its member list and refers to one ambient table.
 * Membership uses one bit per ambient element. The retained generator list is
 * irredundant in insertion order, so it has at most log2(order) entries. */
export class FiniteSubgroup {
  readonly #members: readonly number[];
  readonly #ambient: FiniteGroupTable;
  readonly #bits: Uint32Array;
  readonly #generators: readonly number[];
  private constructor(
    ambient: FiniteGroupTable,
    members: number[],
    generators: number[]
  ) {
    this.#ambient = ambient;
    this.#members = members;
    this.#generators = generators;
    this.#bits = new Uint32Array(Math.ceil(ambient.order / 32));
    for (const x of members) this.#bits[x >>> 5] |= 1 << (x & 31);
  }
  static generated(
    ambient: FiniteGroupTable,
    generators: readonly number[],
    work: GroupWork
  ): FiniteSubgroup {
    if (generators.length > 256)
      throw new GroupInputError('invalid-finite-subgroup-generators');
    generators.forEach((x) => {
      work.tick();
      ambient.element(x);
    });
    const queue = [0],
      seen = new Uint8Array(ambient.order),
      selected: number[] = [];
    seen[0] = 1;
    // Each retained generator strictly enlarges the subgroup, so at most log2(n)
    // generators survive even when callers supply every element of a subgroup.
    for (const g of generators) {
      work.tick();
      if (seen[g]) continue;
      selected.push(g);
      for (let i = 0; i < queue.length; i++)
        for (const h of selected) {
          const y = ambient.product(queue[i], h, work);
          if (!seen[y]) {
            seen[y] = 1;
            queue.push(y);
          }
        }
    }
    return new FiniteSubgroup(
      ambient,
      queue.sort((a, b) => a - b),
      selected
    );
  }

  get ambient(): FiniteGroupTable {
    return this.#ambient;
  }
  get members(): readonly number[] {
    return this.#members;
  }
  get order(): number {
    return this.#members.length;
  }
  get generators(): readonly number[] {
    return this.#generators;
  }
  has(x: number): boolean {
    this.#ambient.element(x);
    return (this.#bits[x >>> 5] & (1 << (x & 31))) !== 0;
  }
}

/** Exact small-group queries with algebraic shortcuts and bounded exhaustive fallbacks. */
export class FiniteGroupSession {
  #whole: FiniteSubgroup | undefined;
  #trivial: FiniteSubgroup | undefined;
  readonly #lattices = new Map<string, readonly FiniteSubgroup[]>();
  #cachedSubgroups = 0;
  constructor(
    readonly group: FiniteGroupTable,
    readonly work: GroupWork
  ) {
    work.tick(0);
  }
  // Arithmetic-only callers need no subgroup closure. Cache each distinguished
  // subgroup only when an algorithm actually asks for its generators or members.
  get whole(): FiniteSubgroup {
    return (this.#whole ??= this.generated(
      Array.from({ length: this.group.order }, (_, i) => i)
    ));
  }
  get trivial(): FiniteSubgroup {
    return (this.#trivial ??= this.generated([]));
  }
  generated(gens: readonly number[]): FiniteSubgroup {
    return FiniteSubgroup.generated(this.group, gens, this.work);
  }
  receive(h: FiniteSubgroup): void {
    this.work.tick();
    if (h.ambient !== this.group)
      throw new GroupInputError('incompatible-finite-group-domain');
  }
  mul(a: number, b: number): number {
    return this.group.product(a, b, this.work);
  }
  inv(a: number): number {
    this.work.tick();
    return this.group.inverse(a);
  }
  pow(a: number, exponent: bigint): number {
    this.group.element(a);
    if ((exponent < 0n ? -exponent : exponent).toString(2).length > 16384)
      throw new GroupInputError('invalid-group-exponent');
    if (exponent < 0n) {
      a = this.inv(a);
      exponent = -exponent;
    }
    let x = 0;
    while (exponent) {
      if (exponent & 1n) x = this.mul(x, a);
      exponent >>= 1n;
      if (exponent) a = this.mul(a, a);
    }
    return x;
  }
  conjugate(a: number, b: number): number {
    return this.mul(this.mul(this.inv(b), a), b);
  }
  commutator(a: number, b: number): number {
    return this.mul(this.inv(a), this.conjugate(a, b));
  }
  elementOrder(a: number): number {
    this.group.element(a);
    let x = 0;
    for (let n = 1; n <= this.group.order; n++) {
      x = this.mul(x, a);
      if (!x) return n;
    }
    throw new Error('Certified finite group has no element order');
  }
  subset(g: FiniteSubgroup, h: FiniteSubgroup): boolean {
    this.receive(g);
    this.receive(h);
    this.work.tick(h.order);
    return h.members.every((x) => g.has(x));
  }
  equal(g: FiniteSubgroup, h: FiniteSubgroup): boolean {
    return this.subset(g, h) && g.order === h.order;
  }
  index(g: FiniteSubgroup, h: FiniteSubgroup): number {
    if (!this.subset(g, h)) throw new GroupInputError('not-a-subgroup');
    return g.order / h.order;
  }
  intersection(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    this.receive(g);
    this.receive(h);
    this.work.tick(g.order);
    return this.generated(g.members.filter((x) => h.has(x)));
  }
  closure(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    this.receive(g);
    this.receive(h);
    return this.generated([...new Set([...g.generators, ...h.generators])]);
  }
  conjugateSubgroup(h: FiniteSubgroup, x: number): FiniteSubgroup {
    this.receive(h);
    this.group.element(x);
    return this.generated(h.generators.map((a) => this.conjugate(a, x)));
  }
  isNormal(g: FiniteSubgroup, h: FiniteSubgroup): boolean {
    if (!this.subset(g, h)) return false;
    // Containment under conjugation by generators is equality for finite H.
    for (const x of g.generators)
      for (const a of h.generators)
        if (!h.has(this.conjugate(a, x))) return false;
    return true;
  }
  /**
   * Conjugating every generator into H proves H^x is contained in H; equal
   * finite orders give equality. Test each x in G, then generate the resulting
   * subgroup. Cost before closure is O(|G| times the number of generators of
   * H).
   */
  normalizer(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    this.receive(g);
    this.receive(h);
    return this.generated(
      g.members.filter((x) =>
        h.generators.every((a) => h.has(this.conjugate(a, x)))
      )
    );
  }
  /**
   * Commuting with generators is equivalent to commuting with every element
   * they generate. Scan G against those generators and close the resulting
   * centralizer.
   */
  centralizer(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    this.receive(g);
    this.receive(h);
    return this.generated(
      g.members.filter((x) =>
        h.generators.every((a) => this.mul(x, a) === this.mul(a, x))
      )
    );
  }
  center(g = this.whole): FiniteSubgroup {
    return this.centralizer(g, g);
  }
  /**
   * The conjugates of a generating set of H generate every conjugate H^x.
   * Their join is normal in G and is contained in every normal subgroup
   * containing H.
   */
  normalClosure(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    if (!this.subset(g, h)) throw new GroupInputError('not-a-subgroup');
    const gens = new Set(h.generators);
    for (const x of g.members)
      for (const a of h.generators) gens.add(this.conjugate(a, x));
    return this.generated([...gens]);
  }
  /**
   * Intersect all conjugates of H by testing which elements of H remain in H
   * under every conjugation by G. This is the largest normal subgroup of G
   * contained in H.
   */
  core(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    if (!this.subset(g, h)) throw new GroupInputError('not-a-subgroup');
    return this.generated(
      h.members.filter((a) =>
        g.members.every((x) => h.has(this.conjugate(a, x)))
      )
    );
  }
  /**
   * Generate all pairwise commutators [a,b] with a in G and b in H. No
   * normalization assumptions on these subgroups are needed; the direct scan
   * costs O(|G||H|) products before closure.
   */
  commutatorSubgroup(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    this.receive(g);
    this.receive(h);
    const gens = new Set<number>();
    for (const a of g.members)
      for (const b of h.members) gens.add(this.commutator(a, b));
    return this.generated([...gens]);
  }
  derived(g = this.whole): FiniteSubgroup {
    return this.isAbelian(g) ? this.trivial : this.commutatorSubgroup(g, g);
  }
  /**
   * Derived and lower-central series descend by commutator closure. The
   * upper-central series lifts the center modulo the previous term. Equality
   * detects the stable term; only series ending at the identity (or G for the
   * upper series) certify solvability or nilpotence.
   */
  series(
    kind: 'derived' | 'lower-central' | 'upper-central',
    g = this.whole
  ): readonly FiniteSubgroup[] {
    this.receive(g);
    const result = [kind === 'upper-central' ? this.trivial : g];
    while (true) {
      const last = result[result.length - 1];
      if (kind === 'upper-central' ? last.order === g.order : last.order === 1)
        return result;
      const next =
        kind === 'upper-central'
          ? this.generated(
              g.members.filter((a) =>
                // The previous term is normal in G, so centrality in G/last
                // is determined by the images of G's generators.
                g.generators.every((b) => last.has(this.commutator(a, b)))
              )
            )
          : kind === 'derived'
            ? this.derived(last)
            : this.commutatorSubgroup(last, g);
      if (this.equal(last, next)) return result;
      result.push(next);
    }
  }
  isSolvable(g = this.whole): boolean {
    return this.series('derived', g).at(-1)!.order === 1;
  }
  isNilpotent(g = this.whole): boolean {
    this.receive(g);
    // Finite p-groups and abelian groups are nilpotent regardless of their
    // subgroup counts. Other groups are decided by the lower central series.
    if (this.primePower(g) !== undefined || this.isAbelian(g)) return true;
    return this.series('lower-central', g).at(-1)!.order === 1;
  }
  isAbelian(g = this.whole): boolean {
    this.receive(g);
    for (let i = 0; i < g.generators.length; i++)
      for (let j = i + 1; j < g.generators.length; j++) {
        const a = g.generators[i],
          b = g.generators[j];
        if (this.mul(a, b) !== this.mul(b, a)) return false;
      }
    return true;
  }
  isCyclic(g = this.whole): boolean {
    this.receive(g);
    return g.members.some((x) => this.elementOrder(x) === g.order);
  }
  isSubnormal(g: FiniteSubgroup, h: FiniteSubgroup): boolean {
    if (!this.subset(g, h)) return false;
    while (true) {
      if (this.equal(g, h)) return true;
      const n = this.normalClosure(g, h);
      if (this.equal(n, g)) return false;
      g = n;
    }
  }
  rightCoset(h: FiniteSubgroup, x: number): readonly number[] {
    this.receive(h);
    this.group.element(x);
    return h.members.map((a) => this.mul(a, x)).sort((a, b) => a - b);
  }
  rightCosets(
    g: FiniteSubgroup,
    h: FiniteSubgroup
  ): readonly (readonly number[])[] {
    if (!this.subset(g, h)) throw new GroupInputError('not-a-subgroup');
    const seen = new Set<number>(),
      result: (readonly number[])[] = [];
    for (const x of g.members) {
      this.work.tick();
      if (seen.has(x)) continue;
      const c = this.rightCoset(h, x);
      c.forEach((a) => seen.add(a));
      result.push(c);
    }
    return result;
  }
  /**
   * Each HxK is a complete orbit under left H and right K multiplication.
   * Marking every visited element partitions G; only the first unvisited
   * representative generates each orbit.
   */
  doubleCosets(
    g: FiniteSubgroup,
    h: FiniteSubgroup,
    k: FiniteSubgroup
  ): readonly (readonly number[])[] {
    if (!this.subset(g, h) || !this.subset(g, k))
      throw new GroupInputError('not-a-subgroup');
    const seen = new Set<number>(),
      result: (readonly number[])[] = [];
    for (const x of g.members) {
      this.work.tick();
      if (seen.has(x)) continue;
      const c = new Set<number>();
      for (const a of h.members)
        for (const b of k.members) c.add(this.mul(this.mul(a, x), b));
      const list = [...c].sort((a, b) => a - b);
      list.forEach((a) => seen.add(a));
      result.push(list);
    }
    return result;
  }
  /**
   * Conjugates x^a for all a in G form the entire orbit of x. Complete-orbit
   * marking partitions G and bounds the scan by O(|G|²) conjugations.
   */
  conjugacyClasses(g = this.whole): readonly (readonly number[])[] {
    this.receive(g);
    const seen = new Set<number>(),
      result: (readonly number[])[] = [];
    for (const x of g.members) {
      this.work.tick();
      if (seen.has(x)) continue;
      const c = [...new Set(g.members.map((a) => this.conjugate(x, a)))].sort(
        (a, b) => a - b
      );
      c.forEach((a) => seen.add(a));
      result.push(c);
    }
    return result;
  }
  roots(g: FiniteSubgroup, x: number, n: bigint): readonly number[] {
    this.receive(g);
    this.group.element(x);
    return g.members.filter((a) => this.pow(a, n) === x);
  }
  /**
   * Breadth-first extension H -> <H,x> reaches every subgroup, since a finite
   * generating set can be adjoined one element at a time. Sorted member lists
   * identify equal subgroups. Right-coset representatives eliminate equivalent
   * extensions without assuming H normal. Return only the complete lattice;
   * exponential growth is bounded by both the subgroup cap and the work ledger.
   */
  subgroups(g = this.whole, maxSubgroups = 4096): readonly FiniteSubgroup[] {
    this.receive(g);
    if (
      !Number.isSafeInteger(maxSubgroups) ||
      maxSubgroups < 1 ||
      maxSubgroups > 4096
    )
      throw new GroupInputError('invalid-subgroup-count-limit');
    const cacheKey = g.members.join(',');
    const cached = this.#lattices.get(cacheKey);
    if (cached) {
      if (cached.length > maxSubgroups)
        throw new GroupLimitError('subgroup-count-limit');
      this.work.tick(cached.length);
      return cached;
    }
    const result = [this.trivial],
      seen = new Set(['0']);
    for (let i = 0; i < result.length; i++) {
      const h = result[i],
        covered = new Uint8Array(this.group.order);
      for (const x of g.members) {
        this.work.tick();
        if (h.has(x) || covered[x]) continue;
        // Every y in Hx generates the same <H,y> as x. One representative
        // per right coset suffices, including when H is not normal in G.
        for (const a of h.members) covered[this.mul(a, x)] = 1;
        const next = this.generated([...h.generators, x]),
          key = next.members.join(',');
        if (seen.has(key)) continue;
        if (result.length >= maxSubgroups)
          throw new GroupLimitError('subgroup-count-limit');
        seen.add(key);
        result.push(next);
      }
    }
    const complete = result;
    // Only complete lattices enter the bounded, session-owned cache.
    while (this.#cachedSubgroups + complete.length > 8192) {
      const key = this.#lattices.keys().next().value!;
      this.#cachedSubgroups -= this.#lattices.get(key)!.length;
      this.#lattices.delete(key);
    }
    this.#lattices.set(cacheKey, complete);
    this.#cachedSubgroups += complete.length;
    return complete;
  }

  normalSubgroups(g = this.whole): readonly FiniteSubgroup[] {
    return this.subgroups(g).filter((h) => this.isNormal(g, h));
  }
  maximalSubgroups(g = this.whole): readonly FiniteSubgroup[] {
    const proper = this.subgroups(g).filter((h) => h.order < g.order);
    return proper.filter(
      (h) => !proper.some((k) => k.order > h.order && this.subset(k, h))
    );
  }
  isSimple(g = this.whole): boolean {
    this.receive(g);
    if (g.order === 1) return false;
    // Every nontrivial normal subgroup contains a nonidentity element.
    // Its normal closure therefore witnesses nonsimplicity without a lattice.
    for (const x of g.members) {
      if (x === 0) continue;
      if (this.normalClosure(g, this.generated([x])).order !== g.order)
        return false;
    }
    return true;
  }
  frattini(g = this.whole): FiniteSubgroup {
    this.receive(g);
    const p = this.primePower(g);
    if (p !== undefined) {
      // Burnside's basis theorem: Φ(G) = G' G^p for finite p-groups.
      const powers = g.members.map((x) => this.pow(x, BigInt(p)));
      return this.closure(this.derived(g), this.generated(powers));
    }
    if (this.isAbelian(g)) {
      // On each primary component, all other prime factors are units.
      // Raising to rad(|G|) therefore gives exactly the product of pG_p.
      let remaining = g.order,
        squareFreeOrder = 1;
      for (let prime = 2; prime <= remaining; prime++) {
        this.work.tick();
        if (remaining % prime !== 0) continue;
        squareFreeOrder *= prime;
        while (remaining % prime === 0) remaining /= prime;
      }
      return this.generated(
        g.members.map((x) => this.pow(x, BigInt(squareFreeOrder)))
      );
    }
    return this.maximalSubgroups(g).reduce(
      (a, h) => this.intersection(a, h),
      g
    );
  }
  /**
   * Join all normal solvable, normal nilpotent, or minimal normal subgroups
   * for the requested radical. Whole-group tests and the central socle formula
   * handle nilpotent cases first; the remaining fallback requires the complete
   * normal-subgroup lattice.
   */
  radical(
    g = this.whole,
    kind: 'solvable' | 'fitting' | 'socle' = 'solvable'
  ): FiniteSubgroup {
    this.receive(g);
    if (kind === 'solvable' && this.isSolvable(g)) return g;
    if (kind !== 'solvable' && this.isNilpotent(g)) {
      if (kind === 'fitting') return g;
      // Minimal normal subgroups of a finite nilpotent group lie in its center
      // and have prime order. Conversely, every central prime-order subgroup
      // is minimal normal. The socle is their join, found without a lattice.
      const generators: number[] = [];
      for (const x of this.center(g).members) {
        const order = this.elementOrder(x);
        let remaining = order;
        for (let prime = 2; prime <= remaining; prime++) {
          this.work.tick();
          if (remaining % prime !== 0) continue;
          generators.push(this.pow(x, BigInt(order / prime)));
          while (remaining % prime === 0) remaining /= prime;
        }
      }
      return this.generated([...new Set(generators)]);
    }
    const normals = this.normalSubgroups(g);
    const selected =
      kind === 'socle'
        ? normals.filter(
            (h) =>
              h.order > 1 &&
              !normals.some(
                (k) => k.order > 1 && k.order < h.order && this.subset(h, k)
              )
          )
        : normals.filter((h) =>
            kind === 'solvable' ? this.isSolvable(h) : this.isNilpotent(h)
          );
    return selected.reduce((a, h) => this.closure(a, h), this.trivial);
  }
  sylow(g: FiniteSubgroup, p: number): FiniteSubgroup {
    this.receive(g);
    this.prime(p);
    let target = 1,
      n = g.order;
    while (n % p === 0) {
      target *= p;
      n /= p;
    }
    if (target === g.order) return g;
    if (target === 1) return this.trivial;
    let h = this.trivial;
    while (h.order < target) {
      let enlarged = false;
      // A proper subgroup of a finite p-group is properly contained in its
      // normalizer. Inside a Sylow group containing H there is an x for which
      // <H,x> is a larger p-group; scanning the ambient elements finds one.
      for (const x of g.members) {
        this.work.tick();
        if (h.has(x)) continue;
        const next = this.generated([...h.generators, x]);
        let order = next.order;
        while (order % p === 0) order /= p;
        if (order !== 1) continue;
        h = next;
        enlarged = true;
        break;
      }
      if (!enlarged) throw new Error('Finite p-subgroup cannot be enlarged');
    }
    return h;
  }
  /** Prime underlying a nontrivial prime-power order; no element enumeration. */
  primePower(g = this.whole): number | undefined {
    this.receive(g);
    if (g.order === 1) return undefined;
    let p = 2;
    while (g.order % p !== 0) {
      this.work.tick();
      p++;
    }
    let n = g.order;
    while (n % p === 0) n /= p;
    return n === 1 ? p : undefined;
  }
  prime(p: number): void {
    if (!Number.isSafeInteger(p) || p < 2 || p > 65521)
      throw new GroupInputError('invalid-small-prime');
    for (let d = 2; d * d <= p; d++) {
      this.work.tick();
      if (p % d === 0) throw new GroupInputError('invalid-small-prime');
    }
  }
  /**
   * A normal p-subgroup lies in every Sylow p-subgroup. The core of any Sylow
   * subgroup is therefore exactly the largest normal p-subgroup.
   */
  pCore(g: FiniteSubgroup, p: number): FiniteSubgroup {
    this.prime(p);
    const syl = this.sylow(g, p);
    return this.core(g, syl);
  }
  quotient(g: FiniteSubgroup, n: FiniteSubgroup): FiniteGroupQuotient {
    return FiniteGroupQuotient.fromNormalSubgroup(this, g, n);
  }

  /**
   * Breadth-first traversal of the Cayley graph gives a shortest positive
   * word. Finite generators have inverses among their positive powers, so the
   * search reaches the generated subgroup. Labels in the returned word are
   * one-based generator indices.
   */
  factorization(
    generators: readonly number[],
    x: number
  ): readonly number[] | undefined {
    this.group.element(x);
    this.generated(generators);
    const paths = new Map<number, number[]>([[0, []]]),
      queue = [0];
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i];
      if (a === x) return paths.get(a)!;
      for (let j = 0; j < generators.length; j++) {
        const b = this.mul(a, generators[j]);
        if (paths.has(b)) continue;
        paths.set(b, [...paths.get(a)!, j + 1]);
        queue.push(b);
      }
    }
    return undefined;
  }
}

/** Representation map retained alongside a certified abstract multiplication table. */
export function finitePermutationModel(
  group: PermutationGroupValue,
  maxElements: number,
  work: GroupWork
) {
  return FiniteGroupTable.fromPermutationGroup(group, maxElements, work);
}

/** A quotient retains its normal kernel and the actual homomorphism G → G/N.
 * For a subgroup G of an ambient table, sourceElements translates indices in
 * projectionMap.source back to that ambient table. Representatives are a
 * set-theoretic section and are not claimed to form a homomorphism. The
 * projection array uses ambient indices, with -1 outside the numerator. */
export class FiniteGroupQuotient {
  private constructor(
    readonly source: FiniteSubgroup,
    readonly kernel: FiniteSubgroup,
    readonly group: FiniteGroupTable,
    readonly projection: readonly number[],
    readonly representatives: readonly number[],
    readonly sourceElements: readonly number[],
    readonly projectionMap: FiniteGroupHomomorphism
  ) {}
  static fromNormalSubgroup(
    session: FiniteGroupSession,
    g: FiniteSubgroup,
    n: FiniteSubgroup
  ): FiniteGroupQuotient {
    if (!session.isNormal(g, n))
      throw new GroupInputError('quotient-requires-normal-subgroup');
    const cosets = session.rightCosets(g, n);
    const projection = Array<number>(session.group.order).fill(-1);
    cosets.forEach((coset, i) =>
      coset.forEach((x) => {
        projection[x] = i;
      })
    );
    const representatives = cosets.map((coset) => coset[0]);
    const table = representatives.map((a) =>
      representatives.map((b) => projection[session.mul(a, b)])
    );
    const group = FiniteGroupTable.fromAssociativeTable(table, session.work);
    const sourceElements = [...g.members];
    const indices = new Map(sourceElements.map((x, i) => [x, i]));
    const source =
      g.order === session.group.order
        ? session.group
        : FiniteGroupTable.fromAssociativeTable(
            sourceElements.map((a) =>
              sourceElements.map((b) => indices.get(session.mul(a, b))!)
            ),
            session.work
          );
    const projectionMap = FiniteGroupHomomorphism.fromImages(
      source,
      group,
      sourceElements.map((x) => projection[x]),
      session.work
    );
    return new FiniteGroupQuotient(
      g,
      n,
      group,
      projection,
      representatives,
      sourceElements,
      projectionMap
    );
  }
}

/** Validated maps carry both domains; equal-sized tables are not interchangeable. */
export class FiniteGroupHomomorphism {
  private constructor(
    readonly source: FiniteGroupTable,
    readonly target: FiniteGroupTable,
    readonly images: readonly number[]
  ) {}

  /** Validate arbitrary images against every product in O(|source|²). */
  static fromImages(
    source: FiniteGroupTable,
    target: FiniteGroupTable,
    images: readonly number[],
    work: GroupWork
  ): FiniteGroupHomomorphism {
    if (images.length !== source.order)
      throw new GroupInputError('invalid-group-homomorphism');
    const copy = [...images];
    for (const x of copy) {
      work.tick();
      target.element(x);
    }
    for (let a = 0; a < source.order; a++)
      for (let b = 0; b < source.order; b++)
        if (
          copy[source.product(a, b, work)] !==
          target.product(copy[a], copy[b], work)
        )
          throw new GroupInputError('map-is-not-a-group-homomorphism');
    return new FiniteGroupHomomorphism(source, target, copy);
  }

  /** Propagate generator images along the Cayley graph. Each edge is checked;
   * path independence then proves all product equations in O(|source|d).
   * An inconsistent assignment returns undefined, rather than a partial map. */
  static fromGeneratorImages(
    source: FiniteGroupTable,
    target: FiniteGroupTable,
    generators: readonly number[],
    generatorImages: readonly number[],
    work: GroupWork
  ): FiniteGroupHomomorphism | undefined {
    work.tick();
    if (generators.length !== generatorImages.length || generators.length > 256)
      throw new GroupInputError('invalid-group-homomorphism');
    generators.forEach((x) => source.element(x));
    generatorImages.forEach((x) => target.element(x));
    const images = Array<number>(source.order).fill(-1);
    images[0] = 0;
    const queue = [0];
    for (let i = 0; i < queue.length; i++)
      for (let j = 0; j < generators.length; j++) {
        const next = source.product(queue[i], generators[j], work);
        const image = target.product(
          images[queue[i]],
          generatorImages[j],
          work
        );
        if (images[next] < 0) {
          images[next] = image;
          queue.push(next);
        } else if (images[next] !== image) return undefined;
      }
    if (queue.length !== source.order)
      throw new GroupInputError(
        'homomorphism-generators-do-not-generate-source'
      );
    return new FiniteGroupHomomorphism(source, target, images);
  }
  apply(x: number): number {
    this.source.element(x);
    return this.images[x];
  }
  kernel(work: GroupWork): FiniteSubgroup {
    return FiniteSubgroup.generated(
      this.source,
      this.images.flatMap((x, i) => (x === 0 ? [i] : [])),
      work
    );
  }
  image(work: GroupWork): FiniteSubgroup {
    return FiniteSubgroup.generated(
      this.target,
      [...new Set(this.images)],
      work
    );
  }
  /** Image of a source subgroup; generator images suffice for its closure. */
  imageOf(subgroup: FiniteSubgroup, work: GroupWork): FiniteSubgroup {
    work.tick();
    if (subgroup.ambient !== this.source)
      throw new GroupInputError('incompatible-homomorphism-source');
    return FiniteSubgroup.generated(
      this.target,
      subgroup.generators.map((x) => this.images[x]),
      work
    );
  }
  /** Full inverse image includes the kernel and requires one scan of the source. */
  preimageOf(subgroup: FiniteSubgroup, work: GroupWork): FiniteSubgroup {
    work.tick();
    if (subgroup.ambient !== this.target)
      throw new GroupInputError('incompatible-homomorphism-target');
    const generators: number[] = [];
    this.images.forEach((x, i) => {
      work.tick();
      if (subgroup.has(x)) generators.push(i);
    });
    return FiniteSubgroup.generated(this.source, generators, work);
  }
  inverse(work: GroupWork): FiniteGroupHomomorphism {
    if (
      this.source.order !== this.target.order ||
      new Set(this.images).size !== this.target.order
    )
      throw new GroupInputError('homomorphism-is-not-bijective');
    const images = Array<number>(this.target.order);
    this.images.forEach((x, i) => {
      work.tick();
      images[x] = i;
    });
    return new FiniteGroupHomomorphism(this.target, this.source, images);
  }
  then(
    next: FiniteGroupHomomorphism,
    work: GroupWork
  ): FiniteGroupHomomorphism {
    if (this.target !== next.source)
      throw new GroupInputError('incompatible-homomorphism-domains');
    const images = this.images.map((x) => {
      work.tick();
      return next.images[x];
    });
    return new FiniteGroupHomomorphism(this.source, next.target, images);
  }
}
