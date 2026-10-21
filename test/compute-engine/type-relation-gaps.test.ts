import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  couldMatch,
  cyclePairKey,
  isSubtype,
} from '../../src/common/type/subtype';
import type { Type, TypeReference } from '../../src/common/type/types';
import { parseType } from '../../src/common/type/parse';

/**
 * Consistency of the subtype relation (`matches`) and of the overlap
 * predicate (`couldMatch`), and three typing gaps found with them: the
 * type-variable solver and an operand typed with an alias, the element
 * union of a broadcast over a list whose cells can be absent, and an
 * `Undefined` element of a list literal.
 *
 * For the typing cases, the static type of the expression must hold its
 * value: `value.type.matches(staticType)`, on the box route and on the parse
 * route.
 */

const ce = new ComputeEngine();

// A sample of types: scalars, the absence markers, the tops, unions, and the
// composite kinds (tuples, records, dictionaries, lists, matrices, sets,
// abstract collections, broadcastables).
const SAMPLE = [
  'any',
  'unknown',
  'nothing',
  'missing',
  'never',
  'error',
  'integer',
  'number',
  'string',
  'boolean',
  'character',
  'integer | missing',
  'number | nothing',
  'list',
  'list<any>',
  'list<integer>',
  'list<integer | missing>',
  'list<missing>',
  'list<number>',
  'list<character>',
  'list<list<integer>>',
  'list<list<list<integer>>>',
  'list<list<string>>',
  'list<list>',
  'list<list<integer> | list<string>>',
  'list<integer^3>',
  'vector<integer>',
  'vector<3>',
  'matrix<integer>',
  'matrix',
  'matrix<any>',
  'range',
  'tuple',
  'tuple<integer>',
  'tuple<x: integer>',
  'tuple<any>',
  'tuple<integer, integer>',
  'tuple<integer, any>',
  'tuple<integer, missing>',
  'tuple<missing>',
  'tuple<unknown>',
  'record',
  'record{a: integer}',
  'record{a: integer, b: any}',
  'record{a: integer, b: missing}',
  'record{a: integer, b: integer}',
  'record{a: integer, b: string}',
  'record{a: any}',
  'record{a: unknown}',
  'dictionary',
  'dictionary<any>',
  'dictionary<integer>',
  'dictionary<integer | missing>',
  'collection',
  'collection<any>',
  'collection<integer>',
  'collection<character>',
  'collection<tuple<string, integer>>',
  'collection<tuple<"a", integer>>',
  'collection<tuple<"b", integer>>',
  'indexed_collection',
  'indexed_collection<any>',
  'indexed_collection<integer>',
  'indexed_collection<integer | missing>',
  'indexed_collection<character>',
  'set',
  'set<any>',
  'set<integer>',
  'set<missing>',
  'broadcastable<any>',
  'broadcastable<unknown>',
  'broadcastable<integer>',
  'broadcastable<number>',
  'broadcastable<character>',
  'broadcastable<integer | missing>',
  'list<integer> | integer',
  'integer | list<any>',
  'tuple<integer> | missing',
  '!integer',
  'value',
  'scalar',
  'expression',
];

const TYPES = SAMPLE.map((s) => [s, ce.type(s)] as const);
const SUB = new Map<string, boolean>();
const key = (a: string, b: string) => `${a} <: ${b}`;
for (const [a, ta] of TYPES)
  for (const [b, tb] of TYPES) SUB.set(key(a, b), ta.matches(tb));
const sub = (a: string, b: string) => SUB.get(key(a, b)) === true;

/**
 * The transitivity violations that are still open, each for a reason that
 * needs a design decision. A violation `a <: b <: c` with `a ⊄ c` is skipped
 * when it is of one of these kinds:
 *
 * - The middle or the last type is `unknown` or a type that the blanket
 *   `T <: unknown` rule admits although `T` holds an absence marker
 *   (`broadcastable<any>`, `!integer`). The role of `unknown` is being
 *   redesigned (it becomes an inference marker), so these edges are not
 *   changed here.
 * - A tuple or a string below `broadcastable<T>` through
 *   `indexed_collection<T>`. `broadcastable<T>` is read as
 *   `T | indexed_collection<T>` everywhere but in the rule that excludes
 *   tuples and strings (a broadcast binds them atomically); which of the two
 *   readings is wrong is a design decision.
 * - A record with an extra field below a dictionary or a bare `record`
 *   through the record without that field. Records are open (width
 *   subtyping), so a record type says nothing about its other fields, and
 *   the record-to-dictionary rule should not claim them; changing that rule
 *   changes the typing of record operations.
 */
function isOpenViolation(a: string, b: string, c: string): boolean {
  const unknownLike = (t: string) =>
    t === 'unknown' ||
    t === 'broadcastable<unknown>' ||
    t === 'broadcastable<any>' ||
    t === 'broadcastable<integer | missing>' ||
    t === '!integer';
  if (unknownLike(b) || unknownLike(c)) return true;
  if (
    (a.startsWith('tuple<') || a === 'string') &&
    c.startsWith('broadcastable<')
  )
    return true;
  if (a.startsWith('record{a: integer, b:') && b.startsWith('record{'))
    return true;
  return false;
}

describe('THE SUBTYPE RELATION ON A SAMPLE OF TYPES', () => {
  it('is transitive, except for the open cases', () => {
    const violations: string[] = [];
    for (const [a] of TYPES)
      for (const [b] of TYPES) {
        if (!sub(a, b)) continue;
        for (const [c] of TYPES)
          if (sub(b, c) && !sub(a, c) && !isOpenViolation(a, b, c))
            violations.push(`${a} <: ${b} <: ${c}, but not ${a} <: ${c}`);
      }
    expect(violations).toEqual([]);
  });

  it('a matrix is a broadcastable of its cells, as a list of its cells is', () => {
    // `matrix<integer> <: list<integer> <: broadcastable<integer>`: the flat
    // reading of a matrix is a list of its cells.
    expect(ce.type('matrix<integer>').matches('list<integer>')).toBe(true);
    expect(ce.type('matrix<integer>').matches('broadcastable<integer>')).toBe(
      true
    );
    expect(ce.type('matrix').matches('broadcastable<number>')).toBe(true);
    // The row reading still holds.
    expect(
      ce.type('matrix<integer>').matches('broadcastable<list<integer>>')
    ).toBe(true);
    // An element-wise operator over a matrix reaches its cells.
    const v = ce.box(['Multiply', 2, ['List', ['List', 1, 2], ['List', 3, 4]]]);
    expect(v.evaluate().type.matches('broadcastable<integer>')).toBe(true);
  });

  it('a self-referential alias is a subtype of `any` at every depth', () => {
    const ce = new ComputeEngine();
    ce.declareType('R', 'list<R>', { alias: true });
    expect(ce.type('R').matches('list<any>')).toBe(true);
    expect(ce.type('R').matches('indexed_collection<any>')).toBe(true);
  });

  it('a self-referential alias of a list of values is a list of values', () => {
    // A value of `R = list<R>` is a list of lists of values, so it is a
    // `list<unknown>` under the values-only reading of `unknown`.
    const ce = new ComputeEngine();
    ce.declareType('R', 'list<R>', { alias: true });
    ce.declareType('J', 'list<J> | missing', { alias: true });
    ce.declareType('M', 'list<M | missing>', { alias: true });
    expect(ce.type('R').matches('list')).toBe(true);
    expect(ce.type('R').matches('list<unknown>')).toBe(true);
    expect(ce.type('R').matches('list<list<unknown>>')).toBe(true);
    expect(ce.type('R').matches('value')).toBe(true);
    expect(ce.type('R').matches('integer')).toBe(false);
    // An absence marker in the body, at the top level or in a cell, is seen.
    expect(ce.type('J').matches('unknown')).toBe(false);
    expect(ce.type('M').matches('list')).toBe(false);
    expect(ce.type('M').matches('list<any>')).toBe(true);
  });

  it('a mutually recursive alias is checked against each new target', () => {
    // `A = B`, `B = list<A> | missing`: `[Missing]` is an `A`, and it is not a
    // `list<unknown> | missing`. The check reaches `A <: unknown` while `A`
    // and `B` are being unfolded against another target; that is a new
    // question, which the `missing` arm of `B` answers.
    const ce = new ComputeEngine();
    ce.declareType('B', 'list<type A> | missing', { alias: true });
    ce.declareType('A', 'B', { alias: true });
    expect(ce.box(['List', 'Missing']).type.matches('A')).toBe(true);
    expect(ce.type('A').matches('list<unknown> | missing')).toBe(false);
    expect(ce.type('A').matches('list<any> | missing')).toBe(true);
    // Two aliases that each hold a list of the other are the same type.
    ce.declareType('ma', 'list<type mb>', { alias: true });
    ce.declareType('mb', 'list<ma>', { alias: true });
    expect(ce.type('ma').matches('mb')).toBe(true);
    expect(ce.type('mb').matches('ma')).toBe(true);
    expect(ce.type('ma').matches('list<list<unknown>>')).toBe(true);
  });

  it('a value type that holds an object is keyed by the identity of the object', () => {
    // The payload of a value type can be any run-time value. A circular
    // object must not make the key, or the subtype test, throw.
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const circularType = { kind: 'value', value: circular } as Type;
    const alias: TypeReference = {
      kind: 'reference',
      name: 'AL',
      alias: true,
      def: 'integer',
    };
    expect(() => cyclePairKey(circularType)).not.toThrow();
    expect(isSubtype(alias, circularType)).toBe(false);
    // Two distinct objects that look the same are two values, and the
    // value-subtype rule tells them apart, so their keys differ.
    const o1 = { x: 1 };
    const o2 = { x: 1 };
    const t1 = { kind: 'value', value: o1 } as Type;
    const t2 = { kind: 'value', value: o2 } as Type;
    expect(cyclePairKey(t1)).not.toBe(cyclePairKey(t2));
    expect(cyclePairKey(t1)).toBe(cyclePairKey({ kind: 'value', value: o1 }));
    // Literals of different JavaScript kinds are different keys too.
    expect(cyclePairKey({ kind: 'value', value: 1 })).not.toBe(
      cyclePairKey({ kind: 'value', value: '1' })
    );
    expect(
      cyclePairKey({ kind: 'value', value: Number.POSITIVE_INFINITY })
    ).not.toBe(cyclePairKey({ kind: 'value', value: Number.NaN }));
    // The answers of the subtype test follow identity.
    const self: TypeReference = {
      kind: 'reference',
      name: 'S',
      alias: true,
      def: undefined,
    };
    self.def = { kind: 'union', types: [self, t1] } as Type;
    expect(isSubtype(self, t1)).toBe(true);
    expect(isSubtype(self, t2)).toBe(false);
  });

  it('a record with a field named `kind` is keyed by its fields', () => {
    // The fields of a record type are a map from names to types, not a type
    // node: a field named `kind` with the type `value` must not make the
    // record read as a value type. If it did, every such record would share
    // one key, and the cycle rule would assume the inner question
    // `R <: record{kind: value, next: string}` because the outer one has the
    // same key. The value `{kind: v, next: {kind: v, next: 1}}` of `R` is
    // not a value of the target.
    const ce = new ComputeEngine();
    ce.declareType('R', 'record{kind: value, next: R | integer}', {
      alias: true,
    });
    expect(
      ce
        .type('R')
        .matches(
          'record{kind: value, next: record{kind: value, next: string} | integer}'
        )
    ).toBe(false);
    expect(ce.type('R').matches('record{kind: value}')).toBe(true);
    // Both types are parsed first: the keys of two calls are comparable only
    // while no question in between drops the interning table.
    const withInteger = ce.type('record{kind: value, next: integer}').type;
    const withString = ce.type('record{kind: value, next: string}').type;
    expect(cyclePairKey(withInteger)).not.toBe(cyclePairKey(withString));
  });

  it('two aliases with the same name are different questions in a cycle', () => {
    // Two aliases named `P`, as declared in nested scopes, built by hand so
    // that one type can name both. `Q = list<Q>`, `Pin = integer`,
    // `Pout = list<Pin>`. `Q <: Pout` reaches `Q <: Pin` while it answers
    // `Q <: Pout`; the two must not be taken as the same question, or
    // `Q <: Pout` is assumed instead of refused.
    const q: TypeReference = {
      kind: 'reference',
      name: 'Q',
      alias: true,
      def: undefined,
    };
    const pOut: TypeReference = {
      kind: 'reference',
      name: 'P',
      alias: true,
      def: undefined,
    };
    const pIn: TypeReference = {
      kind: 'reference',
      name: 'P',
      alias: true,
      def: undefined,
    };
    q.def = { kind: 'list', elements: q } as Type;
    pIn.def = 'integer';
    pOut.def = { kind: 'list', elements: pIn } as Type;
    expect(isSubtype(q, pIn)).toBe(false);
    expect(isSubtype(q, pOut)).toBe(false);
    expect(isSubtype({ kind: 'list', elements: 'integer' } as Type, pOut)).toBe(
      true
    );
  });

  it('a signature target with and without a stated purity', () => {
    // A bare arrow and a `pure` arrow state the same empty effect set, so
    // both answers hold, and a different result type is still refused.
    const ce = new ComputeEngine();
    ce.declareType('F', '(F) -> integer', { alias: true });
    expect(ce.type('F').matches('(F) pure -> integer')).toBe(true);
    expect(ce.type('F').matches('(F) -> integer')).toBe(true);
    expect(ce.type('F').matches('(F) -> string')).toBe(false);
  });

  it('an alias that names itself as a union arm has the values of its other arms', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    ce.declareType('cyp', 'cyp | tuple<number, number>', { alias: true });
    expect(ce.type('cyp').matches('pt')).toBe(true);
    expect(ce.type('cyp').matches('tuple')).toBe(true);
    expect(ce.type('cyp').matches('list')).toBe(false);
  });
});

describe('COULDMATCH ON A SAMPLE OF TYPES', () => {
  it('is true whenever the sample has a common inhabited subtype', () => {
    const misses: string[] = [];
    for (const [a, ta] of TYPES)
      for (const [b, tb] of TYPES) {
        if (ta.couldMatch(tb)) continue;
        const witness = TYPES.find(
          ([c]) => c !== 'never' && sub(c, a) && sub(c, b)
        );
        if (witness) misses.push(`${a} vs ${b} (common subtype ${witness[0]})`);
      }
    expect(misses).toEqual([]);
  });

  it('follows a long chain of aliases to an empty type', () => {
    // `E10 = E9`, …, `E1 = E0`, `E0 = never`: the chain is followed to its
    // end, with no depth limit on alias hops.
    const ce = new ComputeEngine();
    ce.declareType('E0', 'never', { alias: true });
    for (let i = 1; i <= 10; i++)
      ce.declareType(`E${i}`, `E${i - 1}`, { alias: true });
    expect(ce.type('record{a: E10}').couldMatch('record{b: integer}')).toBe(
      false
    );
    expect(ce.type('record{b: integer}').couldMatch('record{a: E10}')).toBe(
      false
    );
    expect(ce.type('E10').couldMatch('integer')).toBe(false);
  });

  it('keys a union node shared by its arms once', () => {
    // `U₀ = integer`, `Uₙ = Uₙ₋₁ | Uₙ₋₁` (n = 30, both arms the same node).
    // The key of the cycle rule is built from interned node numbers, so it
    // is short, and an alias of `integer` checked against `U₃₀` answers.
    let u: Type = 'integer';
    for (let n = 1; n <= 30; n++) u = { kind: 'union', types: [u, u] } as Type;
    const alias: TypeReference = {
      kind: 'reference',
      name: 'AI',
      alias: true,
      def: 'integer',
    };
    const start = performance.now();
    expect(isSubtype(alias, u)).toBe(true);
    expect(cyclePairKey(u).length).toBeLessThan(100);
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('bounds the emptiness check over a record graph with shared fields', () => {
    // 8 levels of records, each with 10 fields that all hold the record of
    // the level below: 10^8 paths. The emptiness check at the start of
    // `couldMatch` stops at its budget of visits and proves nothing.
    let g: Type = 'integer';
    for (let level = 0; level < 8; level++) {
      const elements: Record<string, Type> = {};
      for (let i = 0; i < 10; i++) elements[`f${i}`] = g;
      g = { kind: 'record', elements } as Type;
    }
    const start = performance.now();
    expect(couldMatch(g, 'unknown')).toBe(true);
    expect(couldMatch('unknown', g)).toBe(true);
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('bounds the disjointness probes of an intersection whose members share a node', () => {
    // `I₀ = integer`, `Iₙ = Iₙ₋₁ & Iₙ₋₁` (n = 30, both members the same
    // node). The emptiness check charges each pair of members, with their
    // size, to its budget before it tests them for disjointness, so it stops
    // and proves nothing.
    let t: Type = 'integer';
    for (let n = 1; n <= 30; n++)
      t = { kind: 'intersection', types: [t, t] } as Type;
    const start = performance.now();
    expect(couldMatch(t, 'unknown')).toBe(true);
    expect(couldMatch('unknown', t)).toBe(true);
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('a cycle of aliases with no constructor has no value', () => {
    // `R = R`, `R = S` with `S = R`, and the arm `R` of `R = R | S` with `S`
    // empty build no value: such a type is a subtype of every type, and it
    // overlaps none. A cycle through a constructor (`R = list<R>`) builds
    // values (`[]`, `[[]]`, …).
    const alias = (name: string): TypeReference => ({
      kind: 'reference',
      name,
      alias: true,
      def: undefined,
    });
    const self = alias('R1');
    self.def = self;
    const r2 = alias('R2');
    const s2 = alias('S2');
    r2.def = s2;
    s2.def = r2;
    const r3 = alias('R3');
    const s3 = alias('S3');
    s3.def = 'never';
    r3.def = { kind: 'union', types: [r3, s3] } as Type;
    for (const empty of [self, r2, r3]) {
      expect(isSubtype(empty, 'integer')).toBe(true);
      expect(couldMatch(empty, 'integer')).toBe(false);
      expect(couldMatch('integer', empty)).toBe(false);
    }
    const listOfAny = { kind: 'list', elements: 'any' } as Type;
    const productive = alias('R4');
    productive.def = { kind: 'list', elements: productive } as Type;
    expect(couldMatch(productive, listOfAny)).toBe(true);
    expect(couldMatch(listOfAny, productive)).toBe(true);
    // The other arms give the values of an alias that names itself as an
    // arm.
    const withInteger = alias('R5');
    withInteger.def = {
      kind: 'union',
      types: [withInteger, 'integer'],
    } as Type;
    expect(couldMatch(withInteger, 'integer')).toBe(true);
  });

  it('bounds the negation probe over an intersection whose members share a node', () => {
    // `I₀ = integer`, `Iₙ = Iₙ₋₁ & Iₙ₋₁` (n = 30, shared members). The probe
    // for a part of `I₃₀` outside `integer` measures both sides first and
    // does not run, so the answer is the one of the fallback.
    let t: Type = 'integer';
    for (let n = 1; n <= 30; n++)
      t = { kind: 'intersection', types: [t, t] } as Type;
    const notInteger = { kind: 'negation', type: 'integer' } as Type;
    const start = performance.now();
    expect(couldMatch(t, notInteger)).toBe(couldMatch(notInteger, t));
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('runs a union shared by its arms at the cost of its distribution', () => {
    // `U₂₀` (`Uₙ = Uₙ₋₁ | Uₙ₋₁`, shared arms) has 2^20 leaves, which the
    // distribution over union arms visits, as before. The emptiness test and
    // the search for a shared matrix add a constant cost per leaf: the
    // emptiness test runs after the distribution and is memoized per node,
    // and the matrix search ends at once for a scalar leaf.
    let u: Type = 'integer';
    for (let n = 1; n <= 20; n++) u = { kind: 'union', types: [u, u] } as Type;
    const listOfListOfString = {
      kind: 'list',
      elements: { kind: 'list', elements: 'string' },
    } as Type;
    const start = performance.now();
    expect(couldMatch(u, 'string')).toBe(false);
    const scalarElapsed = performance.now() - start;
    const listStart = performance.now();
    expect(
      couldMatch({ kind: 'list', elements: u } as Type, listOfListOfString)
    ).toBe(false);
    const listElapsed = performance.now() - listStart;
    // The wall-clock bounds depend on the machine, so they are asserted only
    // in a `CE_PERF=1` run. They are about three times the time measured on
    // 2026-10-20, which was close to the time of the code before this
    // change (about 100 ms and 360 ms, against 80 ms and 320 ms).
    if (process.env.CE_PERF === '1') {
      expect(scalarElapsed).toBeLessThan(300);
      expect(listElapsed).toBeLessThan(1000);
    }
  });

  it('keeps the reference keys of an emptiness check through a nested subtype test', () => {
    // `A = (tuple<I> & tuple<string>) | S`: the disjointness test of the
    // intersection runs `isSubtype` on aliases while the emptiness check of
    // `A` still holds its reference keys. The keys must stay valid, or `S`
    // could reuse the key of `A` and be taken for an unproductive cycle.
    const ce = new ComputeEngine();
    ce.declareType('I', 'integer', { alias: true });
    ce.declareType('S', 'string', { alias: true });
    ce.declareType('A', '(tuple<I> & tuple<string>) | S', { alias: true });
    expect(ce.type('A').couldMatch('string')).toBe(true);
    expect(ce.type('string').couldMatch('A')).toBe(true);
    expect(ce.type('A').couldMatch('integer')).toBe(false);
  });

  it('two applications of one generic type are not a cycle', () => {
    // `Wrap<Wrap<integer>>` holds `Wrap(Wrap(1))`. Its definition reaches
    // `Wrap<integer>`: the same declaration with other arguments, which is
    // another type, not an unproductive cycle.
    const ce = new ComputeEngine();
    ce.declareType('Wrap', 'T', { typeParams: ['T'] });
    const wrapped = ce.type('Wrap<Wrap<integer>>');
    expect(wrapped.couldMatch(wrapped)).toBe(true);
    // `Wrap` is nominal: a value of it is not an `integer`, as before.
    expect(wrapped.couldMatch('integer')).toBe(false);
    expect(ce.type('integer').couldMatch(wrapped)).toBe(false);
  });

  it('bounds the disjointness probe of an intersection with a nominal member', () => {
    // A nominal `N` defined as `U₃₀` (`Uₙ = Uₙ₋₁ | Uₙ₋₁`, shared nodes):
    // the disjointness test of `N & string` unfolds `N`, so the size bound
    // counts the nominal definition too, and the probe is not run.
    let u: Type = 'integer';
    for (let n = 1; n <= 30; n++) u = { kind: 'union', types: [u, u] } as Type;
    const nominal: TypeReference = {
      kind: 'reference',
      name: 'N',
      alias: false,
      def: u,
    };
    const both = { kind: 'intersection', types: [nominal, 'string'] } as Type;
    const start = performance.now();
    expect(couldMatch(both, 'unknown')).toBe(couldMatch('unknown', both));
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('keys a symbol payload of a value type by identity', () => {
    // Two `Symbol()`s are two values. `Y = (R) -> S2`, `R = (Y) -> S1`:
    // `R <: (R) -> S1` reaches `R <: Y` through the contravariant parameter,
    // and that needs `S1 <: S2`, which is false. If the two value types
    // shared a key, the cycle rule would assume a pending question instead.
    const s1 = { kind: 'value', value: Symbol('s1') } as Type;
    const s2 = { kind: 'value', value: Symbol('s2') } as Type;
    expect(cyclePairKey(s1)).not.toBe(cyclePairKey(s2));
    const r: TypeReference = {
      kind: 'reference',
      name: 'R',
      alias: true,
      def: undefined,
    };
    const y: TypeReference = {
      kind: 'reference',
      name: 'Y',
      alias: true,
      def: undefined,
    };
    y.def = { kind: 'signature', args: [{ type: r }], result: s2 } as Type;
    r.def = { kind: 'signature', args: [{ type: y }], result: s1 } as Type;
    expect(
      isSubtype(r, {
        kind: 'signature',
        args: [{ type: r }],
        result: s1,
      } as Type)
    ).toBe(false);
    expect(
      isSubtype(r, {
        kind: 'signature',
        args: [{ type: y }],
        result: s1,
      } as Type)
    ).toBe(true);
  });

  it('counts alias definitions in the size bound of the shared-matrix search', () => {
    // `G₀ = integer`, `Gₙ = record{a: Gₙ₋₁, b: Gₙ₋₁}` (n = 30, shared
    // record node), and two distinct aliases `A`, `B` of `G₃₀`. The search
    // measures the definitions of the aliases too, stops at its budget, and
    // does not reach the meet of `A` and `B`, which would follow every path.
    let g: Type = 'integer';
    for (let n = 1; n <= 30; n++)
      g = { kind: 'record', elements: { a: g, b: g } } as Type;
    const a: TypeReference = {
      kind: 'reference',
      name: 'A',
      alias: true,
      def: g,
    };
    const b: TypeReference = {
      kind: 'reference',
      name: 'B',
      alias: true,
      def: g,
    };
    const listOfA = { kind: 'list', elements: a } as Type;
    const listOfListOfB = {
      kind: 'list',
      elements: { kind: 'list', elements: b },
    } as Type;
    const start = performance.now();
    expect(couldMatch(listOfA, listOfListOfB)).toBe(
      couldMatch(listOfListOfB, listOfA)
    );
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('bounds the search for a shared matrix over a union node shared by its arms', () => {
    // `U₀ = integer`, `Uₙ = Uₙ₋₁ | Uₙ₋₁`, built by hand so that both arms are
    // the same node: small in memory, but 2^30 paths. The search for a shared
    // matrix counts every path against its budget and stops, so the answer
    // is the one of the step before it. With `string` cells, the subtype
    // tests of a candidate would also follow every path.
    const shared = (leaf: Type): Type => {
      let u: Type = leaf;
      for (let n = 1; n <= 30; n++)
        u = { kind: 'union', types: [u, u] } as Type;
      return { kind: 'list', elements: { kind: 'list', elements: u } } as Type;
    };
    const listOfIntegers = { kind: 'list', elements: 'integer' } as Type;
    const start = performance.now();
    for (const leaf of ['integer', 'string'] as Type[]) {
      const nested = shared(leaf);
      expect(couldMatch(listOfIntegers, nested)).toBe(
        couldMatch(nested, listOfIntegers)
      );
    }
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('bounds the search for a shared matrix over two unions of many ranges', () => {
    // Two unions of 60 crossing ranges: every pair of arms meets, so the
    // meets and the comparisons between them would grow with a high power
    // of 60. The search stops at its budget and the answer is the one of
    // the step before it.
    const ranges = (shift: number): Type =>
      ({
        kind: 'union',
        types: Array.from({ length: 60 }, (_, i) => ({
          kind: 'numeric',
          type: 'real',
          lower: i + shift,
          upper: i + shift + 1.5,
        })),
      }) as Type;
    const a = { kind: 'list', elements: ranges(0) } as Type;
    const b = {
      kind: 'list',
      elements: { kind: 'list', elements: ranges(0.25) },
    } as Type;
    const start = performance.now();
    expect(couldMatch(a, b)).toBe(couldMatch(b, a));
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('sees an empty field through an alias', () => {
    const ce = new ComputeEngine();
    ce.declareType('Empty', 'never', { alias: true });
    expect(ce.type('record{a: Empty}').couldMatch('record{b: integer}')).toBe(
      false
    );
    expect(ce.type('record{b: integer}').couldMatch('record{a: Empty}')).toBe(
      false
    );
    // A field that holds values keeps the overlap of two open records.
    expect(
      ce.type('record{a: tuple<integer>}').couldMatch('record{b: integer}')
    ).toBe(true);
  });

  it('does not search for a shared matrix when one side cannot hold a list', () => {
    // A union of 100 list types with fixed shapes: the search for a shared
    // matrix would build 101^4 candidate shapes. `boolean` holds no list, so
    // there is no search, and a search between two list types stops at a
    // bound on the number of candidates.
    const shapes: Type[] = [];
    for (let n = 1; n <= 100; n++)
      shapes.push({
        kind: 'list',
        elements: 'integer',
        dimensions: [n, n, n],
      } as Type);
    const arms = shapes.map((s) => ({ kind: 'list', elements: s }) as Type);
    const lists = { kind: 'union', types: arms } as Type;
    const listOfShapes = {
      kind: 'list',
      elements: { kind: 'union', types: shapes },
    } as Type;
    const start = performance.now();
    expect(couldMatch(lists, 'boolean')).toBe(false);
    expect(couldMatch('boolean', lists)).toBe(false);
    expect(
      couldMatch(listOfShapes, { kind: 'list', elements: 'string' } as Type)
    ).toBe(false);
    const elapsed = performance.now() - start;
    // The wall-clock bound depends on the machine, so it is asserted only in
    // a `CE_PERF=1` run. The answers above do not depend on time.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(100);
  });

  it('is symmetric', () => {
    const asymmetric: string[] = [];
    for (const [a, ta] of TYPES)
      for (const [b, tb] of TYPES)
        if (ta.couldMatch(tb) !== tb.couldMatch(ta))
          asymmetric.push(`${a} vs ${b}`);
    expect(asymmetric).toEqual([]);
  });

  it.each([
    ['tuple<integer, any>', 'indexed_collection<integer>'],
    ['tuple<any>', 'indexed_collection'],
    ['tuple<any>', 'collection<integer>'],
    ['tuple', 'tuple<any>'],
    ['tuple', 'indexed_collection<integer>'],
    ['record{a: any}', 'dictionary<integer>'],
    ['record{a: integer, b: any}', 'record'],
    ['record{a: any}', 'record{a: integer, b: string}'],
    ['dictionary', 'dictionary<integer | missing>'],
    ['record{a: integer}', 'collection<tuple<string, integer>>'],
    // The value `{a: 1}` is both: its one entry is `("a", 1)`.
    ['record{a: integer}', 'collection<tuple<"a", integer>>'],
    // Records are open: `{a: 1, b: 1}` is both.
    ['record{a: integer}', 'record{b: integer}'],
    // `list<never>` holds the empty list: `{a: [], b: 1}` is both.
    ['record{a: list<never>}', 'record{b: integer}'],
    // A closed range with equal endpoints holds that endpoint.
    ['record{a: real<0..0>}', 'record{b: integer}'],
    ['record{a: rational<1..1>}', 'record{b: integer}'],
    ['value', '!integer'],
    // A matrix is a list of its cells and a list of its rows:
    // `matrix<integer>` is below both types of each pair.
    ['list<integer>', 'list<list<integer>>'],
    ['list<integer | missing>', 'list<list<integer>>'],
    ['list<number>', 'list<list<integer>>'],
    ['indexed_collection<integer>', 'list<list<integer>>'],
    ['broadcastable<integer>', 'list<list<integer>>'],
    ['matrix<integer^(2x3)>', 'list<list<integer>>'],
    // A rank-3 list is below both.
    ['list<list<list<integer>>>', 'list<integer>'],
    ['list<list<list<integer>>>', 'list<list<integer>>'],
    // `boolean` is outside both `integer` and `string`.
    ['!integer', '!string'],
    // `matrix<integer>` is a list of integers, and a list of rows that are
    // bare lists (lists of values) or lists of integers.
    ['list<integer>', 'list<list>'],
    ['list<integer>', 'list<list<integer> | list<string>>'],
  ])('%s could match %s', (a, b) => {
    expect(ce.type(a).couldMatch(b)).toBe(true);
    expect(ce.type(b).couldMatch(a)).toBe(true);
  });

  it.each([
    ['tuple<string>', 'indexed_collection<integer>'],
    ['tuple', 'list<integer>'],
    ['record{a: string}', 'dictionary<integer>'],
    ['record{a: string}', 'record{a: integer}'],
    // No value has the field `a` of the empty type.
    ['record{a: never}', 'record{b: integer}'],
    // A nested required field of the empty type empties the record too.
    ['record{a: record{c: never}}', 'record{b: integer}'],
    ['record{a: tuple<never>}', 'record{b: integer}'],
    // A list with one cell of the empty type has no value.
    ['record{a: list<never^1>}', 'record{b: integer}'],
    // A type with no value overlaps nothing, through any route: the
    // subtype fallback (an empty type is a subtype of many others), a
    // negation, or a shared matrix.
    ['record{a: never}', 'record{}'],
    ['record{a: never}', 'record{a: integer}'],
    ['record{a: never}', 'dictionary<integer>'],
    ['tuple<never>', 'tuple<integer>'],
    ['tuple<never>', 'tuple'],
    ['record{a: never}', '!integer'],
    ['tuple<never>', '!integer'],
    ['list<never^2>', '!integer'],
    ['list<tuple<never>>', 'list<list<tuple<never>>>'],
    // An intersection of disjoint types, and `!any`, have no value.
    ['record{a: integer & string}', 'record{}'],
    // `integer` and `real` hold finite numbers only: a range that starts at
    // `+∞` or ends at `−∞` holds none.
    ['record{a: integer<oo..>}', 'record{b: integer}'],
    ['record{a: integer<..-oo>}', 'record{b: integer}'],
    ['record{a: real<oo..>}', 'record{b: integer}'],
    ['tuple<integer & string>', 'tuple'],
    ['record{a: !any}', 'record{}'],
    ['integer & string', 'integer'],
    ['any', '!any'],
    // Every value of `record{a: integer}` has the entry `("a", …)`, which is
    // not a `tuple<"b", integer>`.
    ['record{a: integer}', 'collection<tuple<"b", integer>>'],
    ['record{a: integer, b: integer}', 'collection<tuple<"a", integer>>'],
    ['integer', '!number'],
    // The cells cannot be both a string and an integer.
    ['list<string>', 'list<list<integer>>'],
    ['list<integer>', 'list<list<string>>'],
    // An absent cell is not a row.
    ['list<missing>', 'list<list<integer>>'],
    // A list with one fixed axis admits rank 1 only, and its cells are not
    // rows, so no matrix is below it.
    ['list<integer^3>', 'list<list<integer>>'],
    ['vector<integer^3>', 'list<list<integer>>'],
    // The rows of a 3×3 matrix have 3 cells, not 2.
    ['list<list<integer^2>>', 'matrix<integer^(3x3)>'],
    ['tuple<integer, integer>', 'list<list<integer>>'],
    // `complex | infinity | nan` covers `number`, so no number is outside
    // it. The subtype test cannot prove the cover (it tests the arms one by
    // one), so an overlap must come from a witness, not from `number ⊄ B`.
    ['number', '!(complex | infinity | nan)'],
    ['list<string>', 'list<list<integer> | list<boolean>>'],
  ])('%s cannot match %s', (a, b) => {
    expect(ce.type(a).couldMatch(b)).toBe(false);
    expect(ce.type(b).couldMatch(a)).toBe(false);
  });
});

/** The static type of `build()` holds its value. */
function expectSound(e: Expression): void {
  const value = e.evaluate();
  expect(value.type.matches(e.type)).toBe(true);
}

/** The type of the elements of a lazy collection, once materialized as a
 * list literal. */
function materializedType(e: Expression): string {
  const value = e.evaluate();
  const elements = [...(value.each?.() ?? [])].map((x) => x.json);
  return ce.box(['List', ...elements] as any).type.toString();
}

describe('THE TYPE-VARIABLE SOLVER AND AN ALIAS OPERAND', () => {
  const ce = new ComputeEngine();
  ce.declareType('L', 'list<integer | missing>', { alias: true });
  ce.declareType('Q', 'list<integer>', { alias: true });
  ce.declare('a', 'L');
  ce.assign('a', ce.box(['List', 3, 'Missing']));
  ce.declare('b', 'Q');
  ce.declare('c', 'list<integer | missing>');
  ce.assign('c', ce.box(['List', 3, 'Missing']));

  it('binds the element type of an alias of a list (box route)', () => {
    const e = ce.box(['Sort', 'a']);
    expect(e.type.toString()).toBe('list<integer | missing>');
    expectSound(e);
    expect(ce.box(['Sort', 'b']).type.toString()).toBe('list<integer>');
  });

  it('binds the element type of an alias of a list (parse route)', () => {
    const e = ce.parse('\\mathrm{Sort}(a)');
    expect(e.type.toString()).toBe('list<integer | missing>');
    expectSound(e);
    expect(ce.parse('\\mathrm{Sort}(b)').type.toString()).toBe('list<integer>');
  });

  it('gives the alias the type of its written-out definition', () => {
    expect(ce.box(['Sort', 'a']).type.toString()).toBe(
      ce.box(['Sort', 'c']).type.toString()
    );
  });

  it('keeps the alias name for an echoed result', () => {
    expect(ce.box(['Reverse', 'a']).type.toString()).toBe('L');
  });

  it('terminates on a self-referential and a mutually recursive alias', () => {
    const ce = new ComputeEngine();
    ce.declareType('R', 'list<R>', { alias: true });
    ce.declareType('J', 'list<J> | integer', { alias: true });
    ce.declare('r', 'R');
    ce.declare('j', 'list<J>');
    expect(ce.box(['Sort', 'r']).type.toString()).toBe('list<R>');
    expect(ce.box(['First', 'r']).type.toString()).toBe('R | missing');
    expect(ce.box(['Sort', 'j']).type.toString()).toBe('list<J>');
    ce.assign('j', ce.box(['List', 3, ['List', 1, 2]]));
    expectSound(ce.box(['Sort', 'j']));
  });

  it('terminates on an alias whose union names the alias itself', () => {
    // `cyc = cyc | list<integer>`: the `cyc` arm of the definition meets the
    // same parameter pattern again without descending into it.
    const ce = new ComputeEngine();
    ce.declareType('cyc', 'cyc | list<integer>', { alias: true });
    ce.declare('k', 'cyc');
    ce.assign('k', ce.box(['List', 1, 2]));
    const sorted = ce.box(['Sort', 'k']);
    expect(sorted.type.toString()).toBe('list<integer>');
    expectSound(sorted);
    const mapped = ce.box(['Map', ['Function', ['Add', 'x', 10], 'x'], 'k']);
    expect(() => mapped.type.toString()).not.toThrow();
    const items = ce.function('List', [...mapped.evaluate().each()]);
    expect(items.toString()).toBe('[11,12]');
    expect(items.type.matches(mapped.type)).toBe(true);
  });
});

describe('A BROADCAST OVER A LIST WHOSE CELLS CAN BE ABSENT', () => {
  const ce = new ComputeEngine();
  ce.declare('b', 'list<missing | unknown>');
  ce.declare('b2', 'list<missing | unknown>');
  ce.assign('b2', ce.box(['List', 1, 'Missing', 3]));
  ce.declare('t', 'tuple<integer, missing>');

  it('reduces the cell of an undeclared function to `any` (box route)', () => {
    expect(ce.box(['Total', 'b']).type.toString()).toBe('list<any>');
    expect(
      ce.box(['Total', ['Map', ['Function', 'x', 'x'], 't']]).type.toString()
    ).toBe('list<any>');
    expectSound(ce.box(['Total', 'b2']));
  });

  it('reduces the cell of an undeclared function to `any` (parse route)', () => {
    expect(ce.parse('\\mathrm{Total}(b)').type.toString()).toBe('list<any>');
    expectSound(ce.parse('\\mathrm{Total}(b2)'));
  });
});

describe('AN `Undefined` ELEMENT OF A LIST LITERAL', () => {
  // A row of `Zip` whose coordinates are all absent stays a tuple (it is not
  // one `Missing`), so the element type has no whole-element `missing` arm.
  it('is an absent element for `Zip` (box route)', () => {
    const e = ce.box([
      'Zip',
      ['List', 1, 'Undefined'],
      ['List', 2, 'Undefined'],
    ]);
    expect(e.type.toString()).toBe(
      'list<tuple<integer | missing, integer | missing>>'
    );
    expect(ce.type(materializedType(e)).matches(e.type)).toBe(true);
    const f = ce.box(['Zip', ['List', 1, 'Undefined'], ['List', 2, 3]]);
    expect(ce.type(materializedType(f)).matches(f.type)).toBe(true);
  });

  it('is an absent element for `Zip` (parse route)', () => {
    const e = ce.parse(
      '\\mathrm{Zip}([1, \\mathrm{Undefined}], [2, \\mathrm{Undefined}])'
    );
    expect(e.type.toString()).toBe(
      'list<tuple<integer | missing, integer | missing>>'
    );
    expect(ce.type(materializedType(e)).matches(e.type)).toBe(true);
  });

  it('has the same element type as a `Missing` element', () => {
    const u = ce.box(['Zip', ['List', 1, 'Undefined'], ['List', 2, 3]]);
    const m = ce.box(['Zip', ['List', 1, 'Missing'], ['List', 2, 3]]);
    expect(u.type.toString()).toBe(m.type.toString());
  });
});

describe('couldMatch of two numeric ranges', () => {
  // Two ranges share a value when their meet holds one, even when neither
  // contains the other.
  const both = (a: string, b: string) =>
    couldMatch(parseType(a)!, parseType(b)!) &&
    couldMatch(parseType(b)!, parseType(a)!);
  const either = (a: string, b: string) =>
    couldMatch(parseType(a)!, parseType(b)!) ||
    couldMatch(parseType(b)!, parseType(a)!);
  test.each([
    ['integer<1..10>', 'integer<5..20>'],
    ['real<0..1>', 'real<0.5..2>'],
    ['integer<1..10>', 'real<5..20>'],
    ['real<0..1>', 'real<1..2>'],
  ])('%s and %s can share a value', (a, b) => {
    expect(both(a, b)).toBe(true);
  });
  test.each([
    ['integer<1..10>', 'integer<20..30>'],
    ['integer', 'real<0.5..0.7>'],
    ['real<0..<1>', 'real<1..2>'],
  ])('%s and %s share no value', (a, b) => {
    expect(either(a, b)).toBe(false);
  });
});
