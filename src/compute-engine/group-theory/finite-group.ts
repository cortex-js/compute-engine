import {
  PermutationGroupValue,
  enumeratePermutationGroup,
} from './permutation/groups.js';
import { PermutationValue, composePermutations } from './permutation/values.js';

export class GroupInputError extends Error {}
export class GroupLimitError extends Error {}

/** A shared, explicit ledger. Exhaustion never establishes a group property. */
export class GroupWork {
  #used = 0;
  constructor(
    readonly limit: number,
    readonly check?: () => void
  ) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50_000_000)
      throw new GroupInputError('invalid-group-work-limit');
    Object.freeze(this);
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
const frozen = (x: number[]) => Object.freeze(x);

/** Identity has index zero. Imported tables are checked against every group axiom. */
export class FiniteGroupTable {
  readonly #rows: readonly (readonly number[])[];
  readonly #inverses: readonly number[];
  private constructor(rows: number[][], inverses: number[]) {
    this.#rows = Object.freeze(rows.map(frozen));
    this.#inverses = frozen(inverses);
    Object.freeze(this);
  }
  static is(x: unknown): x is FiniteGroupTable {
    return typeof x === 'object' && x !== null && #rows in x;
  }
  static fromTable(input: unknown, work: GroupWork): FiniteGroupTable {
    return this.#validateTable(input, work, true);
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
      !PermutationGroupValue.is(group) ||
      !Number.isSafeInteger(maxElements) ||
      maxElements < 1 ||
      maxElements > 256
    )
      throw new GroupInputError('invalid-finite-permutation-model');
    const values = { check: () => work.tick() };
    const elements = enumeratePermutationGroup(
      group,
      { maxElements, maxProducts: 100000 },
      values
    );
    const index = new Map(elements.map((p, i) => [p.images.join(','), i]));
    const rows = elements.map((a) =>
      elements.map((b) => {
        work.tick(Math.max(a.supportDegree, b.supportDegree));
        const c = composePermutations(a, b, values),
          i = index.get(c.images.join(','));
        if (i === undefined)
          throw new Error('Permutation closure is incomplete');
        return i;
      })
    );
    const table = this.#validateTable(rows, work, false);
    return Object.freeze({
      table,
      elements,
      indexOf: (p: PermutationValue) => {
        if (!PermutationValue.is(p))
          throw new GroupInputError('invalid-permutation');
        return index.get(p.images.join(','));
      },
    });
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
    this.#members = frozen(members);
    this.#generators = frozen(generators);
    this.#bits = new Uint32Array(Math.ceil(ambient.order / 32));
    for (const x of members) this.#bits[x >>> 5] |= 1 << (x & 31);
    Object.freeze(this);
  }
  static generated(
    ambient: FiniteGroupTable,
    generators: readonly number[],
    work: GroupWork
  ): FiniteSubgroup {
    if (
      !FiniteGroupTable.is(ambient) ||
      !Array.isArray(generators) ||
      generators.length > 256
    )
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

  static is(x: unknown): x is FiniteSubgroup {
    return typeof x === 'object' && x !== null && #members in x;
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

/** Exact exhaustive algorithms for small finite groups, independent of representation. */
export class FiniteGroupSession {
  readonly whole: FiniteSubgroup;
  readonly trivial: FiniteSubgroup;
  readonly #lattices = new Map<string, readonly FiniteSubgroup[]>();
  #cachedSubgroups = 0;
  constructor(
    readonly group: FiniteGroupTable,
    readonly work: GroupWork
  ) {
    if (!FiniteGroupTable.is(group))
      throw new GroupInputError('invalid-finite-group');
    this.whole = this.generated(
      Array.from({ length: group.order }, (_, i) => i)
    );
    this.trivial = this.generated([]);
  }
  generated(gens: readonly number[]): FiniteSubgroup {
    return FiniteSubgroup.generated(this.group, gens, this.work);
  }
  receive(h: FiniteSubgroup): void {
    this.work.tick();
    if (!FiniteSubgroup.is(h) || h.ambient !== this.group)
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
    if (
      typeof exponent !== 'bigint' ||
      (exponent < 0n ? -exponent : exponent).toString(2).length > 16384
    )
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
  normalizer(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    this.receive(g);
    this.receive(h);
    return this.generated(
      g.members.filter((x) =>
        h.generators.every((a) => h.has(this.conjugate(a, x)))
      )
    );
  }
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
  normalClosure(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    if (!this.subset(g, h)) throw new GroupInputError('not-a-subgroup');
    const gens = new Set(h.members);
    for (const x of g.members)
      for (const a of h.members) gens.add(this.conjugate(a, x));
    return this.generated([...gens]);
  }
  core(g: FiniteSubgroup, h: FiniteSubgroup): FiniteSubgroup {
    if (!this.subset(g, h)) throw new GroupInputError('not-a-subgroup');
    return this.generated(
      h.members.filter((a) =>
        g.members.every((x) => h.has(this.conjugate(a, x)))
      )
    );
  }
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
  series(
    kind: 'derived' | 'lower-central' | 'upper-central',
    g = this.whole
  ): readonly FiniteSubgroup[] {
    this.receive(g);
    if (!['derived', 'lower-central', 'upper-central'].includes(kind))
      throw new GroupInputError('invalid-group-series');
    const result = [kind === 'upper-central' ? this.trivial : g];
    while (true) {
      const last = result[result.length - 1];
      const next =
        kind === 'upper-central'
          ? this.generated(
              g.members.filter((a) =>
                g.members.every((b) => last.has(this.commutator(a, b)))
              )
            )
          : kind === 'derived'
            ? this.derived(last)
            : this.commutatorSubgroup(last, g);
      if (this.equal(last, next)) return Object.freeze(result);
      result.push(next);
    }
  }
  isSolvable(g = this.whole): boolean {
    return this.series('derived', g).at(-1)!.order === 1;
  }
  isNilpotent(g = this.whole): boolean {
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
    return frozen(h.members.map((a) => this.mul(a, x)).sort((a, b) => a - b));
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
    return Object.freeze(result);
  }
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
      result.push(frozen(list));
    }
    return Object.freeze(result);
  }
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
      result.push(frozen(c));
    }
    return Object.freeze(result);
  }
  roots(g: FiniteSubgroup, x: number, n: bigint): readonly number[] {
    this.receive(g);
    this.group.element(x);
    return frozen(g.members.filter((a) => this.pow(a, n) === x));
  }
  /** Enumerates the complete subgroup lattice or throws before returning any part. */
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
    const complete = Object.freeze(result);
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
    return Object.freeze(this.subgroups(g).filter((h) => this.isNormal(g, h)));
  }
  maximalSubgroups(g = this.whole): readonly FiniteSubgroup[] {
    const proper = this.subgroups(g).filter((h) => h.order < g.order);
    return Object.freeze(
      proper.filter(
        (h) => !proper.some((k) => k.order > h.order && this.subset(k, h))
      )
    );
  }
  isSimple(g = this.whole): boolean {
    this.receive(g);
    return g.order > 1 && this.normalSubgroups(g).length === 2;
  }
  frattini(g = this.whole): FiniteSubgroup {
    return this.maximalSubgroups(g).reduce(
      (a, h) => this.intersection(a, h),
      g
    );
  }
  radical(
    g = this.whole,
    kind: 'solvable' | 'fitting' | 'socle' = 'solvable'
  ): FiniteSubgroup {
    if (!['solvable', 'fitting', 'socle'].includes(kind))
      throw new GroupInputError('invalid-group-radical');
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
    const h = this.subgroups(g).find((h) => h.order === target);
    if (!h) throw new Error('Certified finite group has no Sylow subgroup');
    return h;
  }
  prime(p: number): void {
    if (!Number.isSafeInteger(p) || p < 2 || p > 65521)
      throw new GroupInputError('invalid-small-prime');
    for (let d = 2; d * d <= p; d++) {
      this.work.tick();
      if (p % d === 0) throw new GroupInputError('invalid-small-prime');
    }
  }
  pCore(g: FiniteSubgroup, p: number): FiniteSubgroup {
    this.prime(p);
    const syl = this.sylow(g, p);
    return this.core(g, syl);
  }
  quotient(
    g: FiniteSubgroup,
    n: FiniteSubgroup
  ): {
    group: FiniteGroupTable;
    projection: readonly number[];
    representatives: readonly number[];
  } {
    if (!this.isNormal(g, n))
      throw new GroupInputError('quotient-requires-normal-subgroup');
    const cosets = this.rightCosets(g, n),
      projection = Array<number>(this.group.order).fill(-1);
    cosets.forEach((c, i) =>
      c.forEach((x) => {
        projection[x] = i;
      })
    );
    const reps = cosets.map((c) => c[0]);
    const table = reps.map((a) => reps.map((b) => projection[this.mul(a, b)]));
    return Object.freeze({
      group: FiniteGroupTable.fromTable(table, this.work),
      projection: frozen(projection),
      representatives: frozen(reps),
    });
  }
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
      if (a === x) return frozen(paths.get(a)!);
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
