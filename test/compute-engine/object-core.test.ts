/**
 * The `BoxedObject` expression kind — the engine's one MUTABLE value.
 *
 * An object is a reference to a record whose stored fields can change in
 * place: the class instance IS the heap record, so host reference identity of
 * the instance is object identity. These tests pin the representation's
 * contract (`docs/plans/2026-08-14-object-representation-decision.md`,
 * "Invariants") and the semantics of `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B
 * ("Equality", "Cycles", "Lifetime", "Serialization").
 *
 * Objects are constructed here through `ce._object()`, the engine-internal
 * factory: the user-facing named-argument constructor and the `type P =
 * object{…}` declaration are later work packages, and the kind must be real
 * and testable before they exist.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression, ObjectInterface } from '../../src/compute-engine';
import { _setNextObjectSerial } from '../../src/compute-engine/boxed-expression/boxed-object';
import { snapshotMemoDeps } from '../../src/compute-engine/boxed-expression/collection-element-memo';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';

let ce: ComputeEngine;

/** An object, with its narrowing interface in hand (the internal members —
 * `_store`, `_field`, `_version` — are how a test reaches the mutable core
 * before the property-access operators exist). */
function obj(
  engine: ComputeEngine,
  typeName: string,
  slots: Record<string, Expression>
): Expression & ObjectInterface {
  const o = engine._object(typeName, slots);
  if (!isObject(o)) throw new Error('expected an object');
  return o;
}

beforeEach(() => {
  ce = new ComputeEngine();
  ce.declareType('Person', {
    kind: 'record',
    elements: { name: 'string', age: 'integer' },
  });
  ce.declareType('Buddy', { kind: 'record', elements: { name: 'string' } });
  ce.declareType('Box', { kind: 'record', elements: {} });
});

describe('BoxedObject — kind basics', () => {
  test('is an object, is canonical, is pure, is not a collection', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect(isObject(p)).toBe(true);
    expect(p.operator).toBe('Object');
    expect(p.isCanonical).toBe(true);
    expect(p.isStructural).toBe(true);
    expect(p.isPure).toBe(true);
    expect(p.effects).toBeUndefined();
    expect(p.isCollection).toBe(false);
    expect(p.isIndexedCollection).toBe(false);
    expect(p.isLazyCollection).toBe(false);
    expect(p.value).toBeUndefined();
  });

  test('the nominal type is pinned at construction', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const pinned = p.type;
    expect(pinned.toString()).toBe('Person');
    // Same BoxedType object every time: the getter returns what was resolved
    // once, never a fresh resolution by name.
    expect(p.type).toBe(pinned);
  });

  test('an undeclared type name still constructs (declaration is a later work package)', () => {
    const p = obj(ce, 'NotDeclaredYet', { a: ce.number(1) });
    expect(p.typeName).toBe('NotDeclaredYet');
    expect(p.type.toString()).toBe('NotDeclaredYet');
  });

  test('a name bound to a NON-object type is not pinned', () => {
    // Pinning whatever the name resolves to would put a type that is provably
    // not an object onto an object — a stale alias, or an unrelated type that
    // happens to share the name. The instance then reported its OWN type as
    // not-an-object. The fail-closed answer is the same one an unknown name
    // gets: an unresolved nominal reference to the name, which still prints
    // and diagnoses as that name but resolves to no definition.
    ce.declareType('Tally', 'record{a: integer}', { alias: true });
    expect(ce.type('Tally').matches('record')).toBe(true);

    const t = obj(ce, 'Tally', { a: ce.number(1) });
    expect(t.type.toString()).toBe('Tally');
    expect(t.type.matches('record')).toBe(false);
    expect((t.type.type as { def?: unknown }).def).toBeUndefined();
  });

  test('fields keep declaration (insertion) order', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect([...p._slots.keys()]).toEqual(['name', 'age']);
  });
});

describe('BoxedObject — identity', () => {
  test('every tier answers reference identity', () => {
    const a = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const b = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const c = a; // an alias, not a copy

    expect(a.isSame(b)).toBe(false);
    expect(a.isEqual(b)).toBe(false);
    expect(a.isIdenticallyEqual(b)).toBe(false);

    expect(a.isSame(c)).toBe(true);
    expect(a.isEqual(c)).toBe(true);
    expect(a.isIdenticallyEqual(c)).toBe(true);

    // Symmetry: `b == a` must answer exactly as `a == b`.
    expect(b.isEqual(a)).toBe(false);
    expect(a.isEqual(a)).toBe(true);
  });

  test('an object never compares equal to a value of another kind', () => {
    const a = obj(ce, 'Box', {});
    expect(a.isSame(ce.number(1))).toBe(false);
    expect(a.isEqual(ce.number(1))).toBe(false);
    expect(ce.number(1).isSame(a)).toBe(false);
    expect(ce.string('Box').isSame(a)).toBe(false);
  });

  test('a comparison with an object operand always DECIDES, never inert', () => {
    // The general expression path is three-valued — `x + 1 == 2` is
    // undecided — but a comparison with an object operand is a question
    // about references, so it answers `false` rather than staying inert.
    const a = obj(ce, 'Box', {});
    expect(a.isEqual(ce.box(['Add', 'x', 1]))).toBe(false);
    expect(ce.box(['Add', 'x', 1]).isEqual(a)).toBe(false);
    expect(a.isEqual(ce.box(['List', 1, 2]))).toBe(false);
  });

  test('objects are unordered', () => {
    const a = obj(ce, 'Box', {});
    const b = obj(ce, 'Box', {});
    expect(a.isLess(b)).toBeUndefined();
    expect(a.isGreater(b)).toBeUndefined();
    expect(a.isLessEqual(b)).toBeUndefined();
  });

  test('a contradictory assumption does not flip the verdict', () => {
    const a = obj(ce, 'Box', { n: ce.number(1) });
    const b = obj(ce, 'Box', { n: ce.number(1) });
    ce.assign('oa', a);
    ce.assign('ob', b);
    ce.assume(ce.box(['Equal', 'oa', 'ob']));

    // An object comparison is a fact about references; the assumptions
    // database must not answer first.
    expect(a.isEqual(b)).toBe(false);
    expect(ce.box(['Equal', 'oa', 'ob']).evaluate().symbol).toBe('False');
    expect(ce.function('Same', [a, b]).evaluate().symbol).toBe('False');
  });

  test('`Equal`/`Same` on aliases of one object answer True', () => {
    const a = obj(ce, 'Box', { n: ce.number(1) });
    const c = a;
    expect(ce.function('Equal', [a, c]).evaluate().symbol).toBe('True');
    expect(ce.function('Same', [a, c]).evaluate().symbol).toBe('True');
    // Through bindings, `Equal` dereferences (it evaluates its operands) —
    // `Same` deliberately does not (it is binding-blind, so two different
    // symbol NAMES are never the same expression, whatever they hold).
    ce.assign('oa', a);
    ce.assign('oc', a);
    expect(ce.box(['Equal', 'oa', 'oc']).evaluate().symbol).toBe('True');
  });

  test('an object matches nothing but itself (and a wildcard)', () => {
    const a = obj(ce, 'Box', { n: ce.number(1) });
    const b = obj(ce, 'Box', { n: ce.number(1) });
    expect(a.match(a)).toEqual({});
    expect(a.match(b)).toBeNull();
    expect(a.match('_x')).toEqual({ _x: a });
  });
});

describe('BoxedObject — hash', () => {
  test('is identity-based and survives a store', () => {
    const a = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const b = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });

    // Content-equal, but distinct objects: a content hash would collide.
    expect(a.hash).not.toBe(b.hash);

    const before = a.hash;
    a._store('age', ce.number(43));
    expect(a.hash).toBe(before);
  });
});

describe('BoxedObject — one instance, forever', () => {
  test('every evaluation and rewriting route returns the same instance', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect(p.evaluate()).toBe(p);
    expect(p.evaluate({ numericApproximation: true })).toBe(p);
    expect(p.N()).toBe(p);
    expect(p.simplify()).toBe(p);
    expect(p.canonical).toBe(p);
    expect(p.structural).toBe(p);
    expect(p.subs({ x: ce.number(1) })).toBe(p);
    expect(p.subs({ x: ce.number(1) }, { canonical: true })).toBe(p);
    expect(p.map((x) => x)).toBe(p);
  });

  test('an enclosing structure rebuilds around the object, not the object', () => {
    const p = obj(ce, 'Box', { n: ce.number(1) });
    const list = ce.function('List', [p, ce.number(2)]);
    const evaluated = list.evaluate();
    expect(evaluated.ops![0]).toBe(p);
  });
});

describe('BoxedObject — the store choke point', () => {
  test('a real store writes the slot and bumps the version', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect(p._version).toBe(0);

    p._store('age', ce.number(43));
    expect(p._version).toBe(1);
    expect(p._field('age')!.re).toBe(43);
  });

  test('storing the identical node is a total no-op', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    p._store('age', ce.number(43));
    expect(p._version).toBe(1);

    p._store('age', p._field('age')!);
    expect(p._version).toBe(1);
  });

  test('the version counter fails loud rather than going stale', () => {
    // The guard asserts before it throws; the assertion is the point, so
    // silence it rather than let it colour the test output.
    const assertSpy = jest.spyOn(console, 'assert').mockImplementation();
    const p = obj(ce, 'Box', { n: ce.number(1) });
    // A counter that stops advancing stops invalidating, so the bound throws
    // instead of silently serving stale cached values forever.
    (p as unknown as { _version: number })._version = Number.MAX_SAFE_INTEGER;
    expect(() => p._store('n', ce.number(2))).toThrow(
      /version counter exhausted/
    );
    // ... but an identical-node store, which writes nothing, is still fine.
    expect(() => p._store('n', p._field('n')!)).not.toThrow();
    assertSpy.mockRestore();
  });

  test('the construction serial counter fails loud too', () => {
    const assertSpy = jest.spyOn(console, 'assert').mockImplementation();
    _setNextObjectSerial(ce, Number.MAX_SAFE_INTEGER);
    expect(() => ce._object('Box', {})).toThrow(/serial counter exhausted/);
    assertSpy.mockRestore();
  });
});

describe('BoxedObject — .json (the full B5 form)', () => {
  test('a flat object', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect(p.json).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'name' }, "'Alan'"],
        ['KeyValuePair', { str: 'age' }, 42],
      ],
      "'Person'",
    ]);
  });

  test('the body is a Dictionary, so the snapshot re-boxes with a RECORD type', () => {
    // The head is provenance, not an ascription: `["Object", …]` reports the
    // type of the value it wraps. That contract only says something because
    // the body is the `Dictionary` OPERATOR form — re-boxing it builds a
    // dictionary whose type is derived from its keys. (There is no `Record`
    // operator in the engine, so a `["Record", …]` body re-boxed as an inert
    // application typed `unknown`, and the contract was vacuous.)
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const reboxed = ce.box(p.json);
    expect(reboxed.type.toString()).toBe(
      'record{name: string, age: finite_integer}'
    );
    expect(reboxed.evaluate().type.toString()).toBe(
      'record{name: string, age: finite_integer}'
    );
    // Nested objects are records all the way down.
    const outer = obj(ce, 'Box', { inner: p });
    expect(ce.box(outer.json).type.toString()).toBe(
      'record{inner: record{name: string, age: finite_integer}}'
    );
  });

  test('a nested object', () => {
    const inner = obj(ce, 'Box', { n: ce.number(1) });
    const outer = obj(ce, 'Box', { inner });
    expect(outer.json).toEqual([
      'Object',
      [
        'Dictionary',
        [
          'KeyValuePair',
          { str: 'inner' },
          [
            'Object',
            ['Dictionary', ['KeyValuePair', { str: 'n' }, 1]],
            "'Box'",
          ],
        ],
      ],
      "'Box'",
    ]);
  });

  test('a lazy, non-finite collection field passes through as its RECIPE', () => {
    const xs = ce
      .box([
        'Map',
        ['Function', ['Power', 'x', 2], 'x'],
        ['Range', 1, 'PositiveInfinity'],
      ])
      .evaluate();
    // Guard the premise of the test: enumerating this value would never end.
    expect(xs.isLazyCollection).toBe(true);
    expect(xs.isFiniteCollection).toBe(false);

    const b = obj(ce, 'Box', { xs });
    const json = b.json as unknown[];
    const record = json[1] as unknown[];
    const entry = record[1] as unknown[];
    // The recipe, verbatim — no element was ever produced.
    expect(entry[2]).toEqual(xs.json);
    expect((entry[2] as unknown[])[0]).toBe('Map');
  });

  test('a cycle becomes a depth-carrying CircularReference marker', () => {
    // Appendix B's own example: alice's friend is bob, bob's friend is alice.
    const alice = obj(ce, 'Buddy', { name: ce.string('Alice') });
    const bob = obj(ce, 'Buddy', { name: ce.string('Bob'), friend: alice });
    alice._store('friend', bob);

    expect(alice.json).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'name' }, "'Alice'"],
        [
          'KeyValuePair',
          { str: 'friend' },
          [
            'Object',
            [
              'Dictionary',
              ['KeyValuePair', { str: 'name' }, "'Bob'"],
              [
                'KeyValuePair',
                { str: 'friend' },
                ['CircularReference', 2, "'Buddy'"],
              ],
            ],
            "'Buddy'",
          ],
        ],
      ],
      "'Buddy'",
    ]);
  });

  test('a self-reference is a depth-1 marker', () => {
    const a = obj(ce, 'Box', {});
    a._store('self', a);
    expect(a.json).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'self' }, ['CircularReference', 1, "'Box'"]],
      ],
      "'Box'",
    ]);
  });

  test('a cycle running through a container still terminates', () => {
    const a = obj(ce, 'Box', {});
    a._store('xs', ce.function('List', [a]));
    expect(a.json).toEqual([
      'Object',
      [
        'Dictionary',
        [
          'KeyValuePair',
          { str: 'xs' },
          ['List', ['CircularReference', 1, "'Box'"]],
        ],
      ],
      "'Box'",
    ]);
  });

  test('a container is rebuilt only when it holds an object', () => {
    const inner = obj(ce, 'Box', { n: ce.number(1) });
    const b = obj(ce, 'Box', {
      plain: ce.box({ dict: { k: 1 } }),
      holder: ce.box(['Dictionary', ['KeyValuePair', { str: 'o' }, inner]]),
    });
    const record = (b.json as unknown[])[1] as unknown[];
    // Untouched: a dictionary with no object inside keeps its own (richer)
    // serialization, shorthand and all.
    expect((record[1] as unknown[])[2]).toEqual({ dict: { k: 1 } });
    // Rebuilt: the object inside is converted, with the walk's stack in hand.
    expect((record[2] as unknown[])[2]).toEqual([
      'Dictionary',
      [
        'KeyValuePair',
        { str: 'o' },
        ['Object', ['Dictionary', ['KeyValuePair', { str: 'n' }, 1]], "'Box'"],
      ],
    ]);
  });

  test('a cross-edge duplicates (a documented loss)', () => {
    const shared = obj(ce, 'Box', { n: ce.number(7) });
    const holder = obj(ce, 'Box', { a: shared, b: shared });
    const sharedJson = [
      'Object',
      ['Dictionary', ['KeyValuePair', { str: 'n' }, 7]],
      "'Box'",
    ];
    expect(holder.json).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'a' }, sharedJson],
        ['KeyValuePair', { str: 'b' }, sharedJson],
      ],
      "'Box'",
    ]);
  });

  test('a NESTED cross-edge duplicates at every level it is reached from', () => {
    // The small, fully spelled-out form of the case below: the memo that keeps
    // a DAG affordable must not change what comes out, so `leaf` appears four
    // times, in full, exactly as a memo-free walk would write it.
    const leaf = obj(ce, 'Box', { n: ce.number(7) });
    const mid = obj(ce, 'Box', { a: leaf, b: leaf });
    const top = obj(ce, 'Box', { a: mid, b: mid });
    const leafJson = [
      'Object',
      ['Dictionary', ['KeyValuePair', { str: 'n' }, 7]],
      "'Box'",
    ];
    const midJson = [
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'a' }, leafJson],
        ['KeyValuePair', { str: 'b' }, leafJson],
      ],
      "'Box'",
    ];
    expect(top.json).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'a' }, midJson],
        ['KeyValuePair', { str: 'b' }, midJson],
      ],
      "'Box'",
    ]);
  });

  test('sharing MIXED with a cycle is still cut where a fresh walk would cut it', () => {
    // `x` and `d` point at each other, and the root reaches both. Each branch
    // must be cut at the object that is an ancestor ON THAT BRANCH, so the two
    // branches nest in opposite orders. Reusing a subwalk of `x` for the `q`
    // branch would be wrong here — `d` is an ancestor there — and would unroll
    // one level further than a fresh walk; the memo is restricted to subwalks
    // that cut no cycle for exactly this reason.
    const x = obj(ce, 'X', {});
    const d = obj(ce, 'D', { x });
    x._store('d', d);
    const r = obj(ce, 'R', { p: x, q: d });

    expect(r.json).toEqual([
      'Object',
      [
        'Dictionary',
        [
          'KeyValuePair',
          { str: 'p' },
          [
            'Object',
            [
              'Dictionary',
              [
                'KeyValuePair',
                { str: 'd' },
                [
                  'Object',
                  [
                    'Dictionary',
                    [
                      'KeyValuePair',
                      { str: 'x' },
                      ['CircularReference', 2, "'X'"],
                    ],
                  ],
                  "'D'",
                ],
              ],
            ],
            "'X'",
          ],
        ],
        [
          'KeyValuePair',
          { str: 'q' },
          [
            'Object',
            [
              'Dictionary',
              [
                'KeyValuePair',
                { str: 'x' },
                [
                  'Object',
                  [
                    'Dictionary',
                    [
                      'KeyValuePair',
                      { str: 'd' },
                      ['CircularReference', 2, "'D'"],
                    ],
                  ],
                  "'X'",
                ],
              ],
            ],
            "'D'",
          ],
        ],
      ],
      "'R'",
    ]);
  });

  test('a DAG of shared references costs time linear in its OBJECTS', () => {
    // The cost regression behind the "cross-edges duplicate" contract. Each
    // link holds the SAME next link twice, so the tree form of a chain of n
    // links has 2^n records: a walk that re-walks a shared subgraph once per
    // path that reaches it does 2^26 ≈ 67 million records of work here and
    // never returns. Completing at all is the assertion; the walk memoizes a
    // completed subwalk by object identity for the duration of one top-level
    // walk, which makes the time linear in the 26 distinct objects while the
    // RESULT still spells the duplication out.
    let node = obj(ce, 'Box', { n: ce.number(0) });
    for (let i = 1; i <= 26; i++) node = obj(ce, 'Box', { a: node, b: node });

    // Completing at all is the assertion (see the paragraph above): the
    // un-memoized walk does 2²⁶ ≈ 67 million records of work and never
    // returns, so the jest per-test timeout is the backstop and an
    // elapsed-millisecond check would only measure the machine.
    const json = node.json as unknown[];

    // The shape is unchanged: every level still holds two full `Object`
    // records, never a marker or a back-reference, all the way down.
    let level = json;
    for (let i = 0; i < 26; i++) {
      expect(level[0]).toBe('Object');
      const record = level[1] as unknown[];
      const a = (record[1] as unknown[])[2] as unknown[];
      const b = (record[2] as unknown[])[2] as unknown[];
      expect((record[1] as unknown[])[1]).toEqual({ str: 'a' });
      expect((record[2] as unknown[])[1]).toEqual({ str: 'b' });
      expect(a[0]).toBe('Object');
      expect(b[0]).toBe('Object');
      level = a;
    }
    expect(level).toEqual([
      'Object',
      ['Dictionary', ['KeyValuePair', { str: 'n' }, 0]],
      "'Box'",
    ]);
  });

  test('.json is recomputed on every access, never memoized', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect(p.json).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'name' }, "'Alan'"],
        ['KeyValuePair', { str: 'age' }, 42],
      ],
      "'Person'",
    ]);
    p._store('age', ce.number(43));
    expect(p.json).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'name' }, "'Alan'"],
        ['KeyValuePair', { str: 'age' }, 43],
      ],
      "'Person'",
    ]);
  });

  test('the serialization is a ONE-WAY door: it re-boxes as data, never an object', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const reboxed = ce.box(p.json);
    expect(isObject(reboxed)).toBe(false);
    expect(isObject(reboxed.evaluate())).toBe(false);
    // Only `ce._object()` mints an object; no parse or box route does.
  });

  test('the serializer route produces the same form', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect(p.toMathJson()).toEqual(p.json);
  });
});

describe('BoxedObject — display', () => {
  test('shows contents in field order', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    expect(p.toString()).toBe('Person(name: "Alan", age: 42)');
  });

  test('terminates on a cyclic object', () => {
    const alice = obj(ce, 'Buddy', { name: ce.string('Alice') });
    const bob = obj(ce, 'Buddy', { name: ce.string('Bob'), friend: alice });
    alice._store('friend', bob);
    expect(alice.toString()).toBe(
      'Buddy(name: "Alice", friend: Buddy(name: "Bob", friend: Buddy(...)))'
    );
    // The guard is released as the walk unwinds: printing again is unchanged.
    expect(bob.toString()).toBe(
      'Buddy(name: "Bob", friend: Buddy(name: "Alice", friend: Buddy(...)))'
    );
  });
});

describe('BoxedObject — caches', () => {
  test('the element memo refuses an object', () => {
    const o = obj(ce, 'Box', { n: ce.number(1) });
    // `undefined` is the memo's "ineligible": nothing about this instance may
    // be frozen, because a store would leave the entry stale and the entry
    // would keep the object alive.
    expect(snapshotMemoDeps(o)).toBeUndefined();
    expect(snapshotMemoDeps(ce.function('List', [o]))).toBeUndefined();
  });
});

describe('BoxedObject — cross-engine ingress', () => {
  test('an expression route rejects a foreign object as an error value', () => {
    const other = new ComputeEngine();
    other.declareType('Box', { kind: 'record', elements: {} });
    const foreign = other._object('Box', {});

    expect(ce.box(foreign).operator).toBe('Error');
    expect(ce.function('List', [foreign]).operator).toBe('Error');
  });

  test('host APIs throw', () => {
    const other = new ComputeEngine();
    other.declareType('Box', { kind: 'record', elements: {} });
    const foreign = other._object('Box', {});

    expect(() => ce.assign('zz', foreign)).toThrow(/object-foreign-engine/);
    expect(() => ce._object('Box', { f: foreign })).toThrow(
      /object-foreign-engine/
    );

    const mine = obj(ce, 'Box', {});
    expect(() => mine._store('f', foreign)).toThrow(/object-foreign-engine/);
  });

  test('an object of the SAME engine is adopted normally', () => {
    const mine = obj(ce, 'Box', {});
    expect(ce.box(mine)).toBe(mine);
    expect(ce.function('List', [mine]).ops![0]).toBe(mine);
  });

  test('a CONTAINER holding a foreign object is rejected too', () => {
    // A `List` (or a dictionary) holding a foreign object is not itself an
    // object, so a check that only inspects the adopted expression lets the
    // whole container in — and with it the foreign object, whose pinned type
    // and invalidation stay wired to the other engine.
    const other = new ComputeEngine();
    other.declareType('Box', { kind: 'record', elements: {} });
    const foreign = other._object('Box', {});
    const foreignList = other.function('List', [foreign]);
    const foreignDict = other.box([
      'Dictionary',
      ['KeyValuePair', { str: 'o' }, foreign],
    ]);

    expect(ce.box(foreignList).operator).toBe('Error');
    expect(ce.box(foreignDict).operator).toBe('Error');
    // Nested one level deeper, and as an operand rather than the whole input.
    expect(ce.function('Reverse', [foreignList]).operator).toBe('Error');
    // Inside a RAW MathJSON container the refusal is subexpression-local (the
    // errors-as-values convention): the inner boxing rejects, so the foreign
    // object is still never adopted.
    const nested = ce.box([
      'List',
      ['List', foreignList],
    ] as unknown as Expression);
    expect(nested.ops![0].operator).toBe('Error');
  });

  test('`ce._fn` is an ingress point too', () => {
    // `_fn` constructs a `BoxedFunction` directly and never reaches the
    // boxing routes, so it needs its own check.
    const other = new ComputeEngine();
    other.declareType('Box', { kind: 'record', elements: {} });
    const foreign = other._object('Box', {});

    expect(ce._fn('List', [foreign]).operator).toBe('Error');
    expect(ce._fn('List', [other.function('List', [foreign])]).operator).toBe(
      'Error'
    );

    // A same-engine object still goes through untouched.
    const mine = obj(ce, 'Box', {});
    expect(ce._fn('List', [mine]).ops![0]).toBe(mine);
  });

  test('a `subs()` substitution VALUE cannot smuggle one in', () => {
    // `BoxedSymbol.subs` hands the substitution value to `ce.expr()`, so the
    // boxing route's check covers this ingress in every requested form —
    // there is no second, unchecked path for it. Locked down here because
    // "the value goes through boxing" is the whole argument.
    const other = new ComputeEngine();
    other.declareType('Box', { kind: 'record', elements: {} });
    const foreign = other._object('Box', {});
    const foreignList = other.function('List', [foreign]);

    for (const canonical of [true, false, undefined]) {
      const opts = { canonical } as { canonical?: boolean };
      expect(ce.box('x').subs({ x: foreign }, opts).operator).toBe('Error');
      // Transitively, through a container that is not itself an object.
      expect(ce.box('x').subs({ x: foreignList }, opts).operator).toBe('Error');
      // Substituted into a larger expression, the refusal is
      // subexpression-local (errors as values).
      const inSum = ce.box(['Add', 'x', 1]).subs({ x: foreign }, opts);
      expect(inSum.toString()).toContain('object-foreign-engine');
    }

    // A same-engine object substitutes normally.
    const mine = obj(ce, 'Box', {});
    expect(ce.box('x').subs({ x: mine })).toBe(mine);
  });

  test('`ce.assign` is an ingress point too, TRANSITIVELY', () => {
    // `ce.assign`/`Assign` install a value without going through the operand
    // boxing that guards `ce.function`, so they carry their own check. It has
    // to be transitive for the same reason as the boxing route's: a `List`
    // holding a foreign object is not itself an object, yet binding it retains
    // the object all the same.
    const other = new ComputeEngine();
    other.declareType('Box', { kind: 'record', elements: {} });
    const foreign = other._object('Box', {});

    expect(() => ce.assign('z1', foreign)).toThrow(/object-foreign-engine/);
    expect(() => ce.assign('z2', other.function('List', [foreign]))).toThrow(
      /object-foreign-engine/
    );
    expect(() =>
      ce.assign(
        'z3',
        other.box(['Dictionary', ['KeyValuePair', { str: 'o' }, foreign]])
      )
    ).toThrow(/object-foreign-engine/);

    // A same-engine object binds normally.
    const mine = obj(ce, 'Box', {});
    expect(() => ce.assign('z4', mine)).not.toThrow();
  });
});

describe('The `Object` provenance head', () => {
  test('is a declared operator, not an unknown application', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const reboxed = ce.box(p.json);
    expect(reboxed.operator).toBe('Object');
    expect(reboxed.operatorDefinition).toBeDefined();
  });

  test('types as its record operand, NOT as the named nominal type', () => {
    // `Typed` would report `Person` — an object type — for a value that is a
    // record, admitting object-only dispatch and stores that fail at runtime.
    // The `Object` head is provenance: the static type is the wrapped
    // record's. (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Serialization".)
    const record = ce.box({ dict: { name: 'Alan', age: 42 } });
    const wrapped = ce.box(['Object', record, ce.string('Person')]);
    expect(wrapped.type.toString()).toBe(record.type.toString());
    expect(wrapped.type.toString()).not.toBe('Person');
  });

  test('evaluates transparently to the record, minting no object', () => {
    const record = ce.box({ dict: { name: 'Alan' } });
    const wrapped = ce.box(['Object', record, ce.string('Person')]);
    const evaluated = wrapped.evaluate();
    expect(isObject(evaluated)).toBe(false);
    expect(evaluated.isSame(record)).toBe(true);
  });

  test('the type-name operand is optional', () => {
    const record = ce.box({ dict: { name: 'Alan' } });
    const wrapped = ce.box(['Object', record]);
    expect(wrapped.operator).toBe('Object');
    expect(wrapped.type.toString()).toBe(record.type.toString());
    expect(wrapped.evaluate().isSame(record)).toBe(true);
  });

  test('a `.json` round trip yields DATA, at every stage', () => {
    const p = obj(ce, 'Person', { name: ce.string('Alan'), age: ce.number(42) });
    const json = p.json;
    const reboxed = ce.box(json);

    // The one-way door: nothing along the way is an object.
    expect(isObject(reboxed)).toBe(false);
    expect(reboxed.ops!.every((op) => !isObject(op))).toBe(true);

    // The re-boxed form re-serializes to a MathJSON EQUIVALENT of the
    // snapshot, not to the same bytes: a dictionary whose entries are all
    // plain data serializes through the `{ dict: … }` shorthand, which is the
    // same value written more compactly. (`BoxedDictionary.json` reserves the
    // operator form for entries that are unevaluated expressions, which must
    // re-box lazily and re-bind in their landing scope.) What must hold is
    // that serialization has reached a FIXED POINT — one more round trip
    // changes nothing.
    expect(reboxed.json).toEqual([
      'Object',
      { dict: { name: 'Alan', age: 42 } },
      "'Person'",
    ]);
    expect(ce.box(reboxed.json).json).toEqual(reboxed.json);

    const record = reboxed.evaluate();
    expect(isObject(record)).toBe(false);
    // Transparent evaluation: the record operand itself, with the stored
    // fields it carried.
    expect(record.operator).toBe('Dictionary');
    expect(record.json).toEqual({ dict: { name: 'Alan', age: 42 } });
    // And the head's static type is that record operand's type, verbatim —
    // a genuine record type, because the body is a real `Dictionary`.
    expect(reboxed.type.toString()).toBe(reboxed.op1.type.toString());
    expect(reboxed.type.toString()).toBe(
      'record{name: string, age: finite_integer}'
    );
  });
});

describe('BoxedObject — comparison tiers cannot be pre-empted', () => {
  test('an operator `eq` handler never answers for an object operand', () => {
    // `Hold`'s `eq` handler compares its held operand structurally, and it
    // runs on the RAW operands at the very top of the equality
    // implementation — ahead of operand evaluation. Without an object
    // pre-pass it answers first and reports `Hold(o) == o` as `True`: a
    // function expression equal to the object it holds.
    const o = obj(ce, 'Box', {});
    const held = ce.function('Hold', [o]);
    expect(held.operatorDefinition?.eq).toBeDefined();

    expect(held.isEqual(o)).toBe(false);
    expect(o.isEqual(held)).toBe(false);
  });

  test('objects stay unordered against a function expression', () => {
    // Without an object arm, `cmp()` falls into its function branch and
    // computes `a.sub(b)` / `.N()` on an operand with no numeric view.
    const o = obj(ce, 'Box', {});
    const held = ce.function('Hold', [o]);
    expect(o.isLess(held)).toBeUndefined();
    expect(held.isLess(o)).toBeUndefined();
    expect(o.isLess(ce.parse('x+1'))).toBeUndefined();
    expect(ce.parse('x+1').isLess(o)).toBeUndefined();
  });
});
