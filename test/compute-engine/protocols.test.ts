import { ComputeEngine } from '../../src/compute-engine';
import { typesOverlap } from '../../src/common/type/reduce';
import { parseType } from '../../src/common/type/parse';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';

//
// `DeclareProtocol` / `DeclareConformance` — the engine forms behind the Epsil
// `protocol` and `type X is P` statements (phase 1 of the protocols design,
// `docs/plans/2026-08-12-protocols-design.md`).
//
// Both are LAZY operators registering from BOTH the canonical and the evaluate
// handler — the route-parity requirement for a lazy operator (a lazy operator
// with no canonical handler is inert on the box/parse routes).
//
// Protocols are engine-global, so every block below uses a fresh
// `ComputeEngine`.
//

const COMPARE_SIG = '(self: Self, other: Self) -> string';

/** `["DeclareProtocol", name, {compare: function COMPARE_SIG}]`. */
const protocolWithCompare = (name: string): any => [
  'DeclareProtocol',
  name,
  [
    'Dictionary',
    [
      'KeyValuePair',
      'compare',
      ['Pair', { str: 'function' }, { str: COMPARE_SIG }],
    ],
  ],
];

describe('typesOverlap (the P4/P9 predicate)', () => {
  const overlap = (a: string, b: string): boolean =>
    typesOverlap(parseType(a), parseType(b));

  test('overlapping bounded ranges have an inhabited meet', () => {
    // The case `narrow()` cannot decide — it short-circuits incomparable
    // pairs to `never` without consulting the numeric ranges (P9).
    expect(overlap('integer<1..10>', 'integer<5..20>')).toBe(true);
  });

  test('disjoint ranges do not overlap', () => {
    expect(overlap('integer<1..10>', 'integer<20..30>')).toBe(false);
  });

  test('unrelated primitives do not overlap', () => {
    expect(overlap('integer<1..10>', 'string')).toBe(false);
    expect(overlap('string', 'integer')).toBe(false);
  });

  test('comparable types overlap', () => {
    expect(overlap('number', 'integer')).toBe(true);
  });

  test('SAME-HEAD applications are decided argument-wise', () => {
    // `meet2` calls an incomparable non-primitive pair disjoint, so without
    // the same-head recursion these two would be reported as non-overlapping
    // and an ambiguous conformance would slip through P4.
    expect(overlap('list<integer<1..10>>', 'list<integer<5..20>>')).toBe(true);
    expect(overlap('list<integer<1..10>>', 'list<integer<20..30>>')).toBe(
      false
    );
  });

  test('different heads do not overlap', () => {
    expect(overlap('list<string>', 'set<string>')).toBe(false);
  });
});

describe('DeclareProtocol (box route)', () => {
  test('evaluates to Nothing and registers the protocol', () => {
    const ce = new ComputeEngine();
    const r = ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce._protocolRegistry.Comparable.members).toEqual({
      compare: { kind: 'function', signature: COMPARE_SIG },
    });
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });

  test('ROUTE PARITY: the canonical pass registers too', () => {
    // A lazy operator with no `canonical` handler is inert on the box/parse
    // routes; both handlers must register (the DeclareType template).
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')); // canonical only, never evaluated
    expect(ce._protocolRegistry.Comparable).toBeDefined();
  });

  test('`ce.function()` matches the box route', () => {
    const ce = new ComputeEngine();
    const r = ce
      .function('DeclareProtocol', [ce.symbol('Copyable')])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce._protocolRegistry.Copyable.members).toEqual({});
  });

  test('a SEMANTIC protocol (no members) is legal', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['DeclareProtocol', 'Copyable']).evaluate().json).toBe(
      'Nothing'
    );
    expect(ce._protocolRegistry.Copyable.members).toEqual({});
  });

  test('readonly / readwrite property members register', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareProtocol',
      'Named',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'hash',
          ['Pair', { str: 'readonly' }, { str: 'string' }],
        ],
        [
          'KeyValuePair',
          'name',
          ['Pair', { str: 'readwrite' }, { str: 'string' }],
        ],
      ],
    ]).evaluate();
    expect(ce._protocolRegistry.Named.members).toEqual({
      hash: { kind: 'readonly', type: 'string' },
      name: { kind: 'readwrite', type: 'string' },
    });
  });

  test('a signature whose first parameter is not `Self` is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareProtocol',
        'Bad',
        [
          'Dictionary',
          [
            'KeyValuePair',
            'compare',
            [
              'Pair',
              { str: 'function' },
              { str: '(self: list, other: Self) -> string' },
            ],
          ],
        ],
      ])
      .evaluate();
    expect(r.toString()).toContain('protocol-self-required');
    expect(ce._protocolRegistry.Bad).toBeUndefined();
  });

  test('a malformed signature registers nothing', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareProtocol',
        'Bad',
        [
          'Dictionary',
          ['KeyValuePair', 'f', ['Pair', { str: 'function' }, { str: '(((' }]],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(ce._protocolRegistry.Bad).toBeUndefined();
  });

  test('a DUPLICATE member of the same kind is an error value', () => {
    // The raw dictionary preserves duplicate keys; the buckets do not, so
    // without the check the second `compare` would silently win.
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareProtocol',
        'Comparable',
        [
          'Dictionary',
          [
            'KeyValuePair',
            'compare',
            ['Pair', { str: 'function' }, { str: COMPARE_SIG }],
          ],
          [
            'KeyValuePair',
            'compare',
            ['Pair', { str: 'function' }, { str: '(self: Self) -> string' }],
          ],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('declares the member');
    expect(r.toString()).toContain('compare');
    expect(r.toString()).toContain('twice');
    expect(ce._protocolRegistry.Comparable).toBeUndefined();
  });

  test('`Self` is NOT a declarable type', () => {
    // The token is resolvable only inside the protocol-signature wrapper
    // (ruling P12): it never reaches the engine's type registry.
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(() => ce.type('Self')).toThrow();
    expect(() => ce.declareProtocol('Self', {})).toThrow();
    // …so it is a RESERVED type name too: a `type Self = …` would put the
    // token in the registry, where the substitution resolver never looks.
    expect(() => ce.declareType('Self', 'number')).toThrow(
      /reserved-type-name/
    );
    expect(ce._typeRegistry['Self']).toBeUndefined();
    // The statement route reports the same fault as an error VALUE.
    const r = ce.box(['DeclareType', 'Self', { str: 'number' }]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('reserved');
    expect(ce._typeRegistry['Self']).toBeUndefined();
    // A protocol signature still parses `Self`: it is resolved BEFORE the
    // registry is consulted.
    expect(() =>
      ce.declareProtocol('Ordered', { functions: { compare: COMPARE_SIG } })
    ).not.toThrow();
  });

  test('a FUNCTION member may not take an accessor-mangled name', () => {
    // `__get__x` / `__set__x` are the keys an implementation block uses for a
    // PROPERTY handler, so a function requirement spelled with one could never
    // be implemented.
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareProtocol',
        'Comparable',
        [
          'Dictionary',
          [
            'KeyValuePair',
            '__get__hash',
            ['Pair', { str: 'function' }, { str: '(self: Self) -> string' }],
          ],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('reserved');
    expect(ce._protocolRegistry.Comparable).toBeUndefined();

    // The HOST route throws on the same fault, for both prefixes.
    expect(() =>
      ce.declareProtocol('Hashable', {
        functions: { __get__hash: '(self: Self) -> string' },
      })
    ).toThrow(/reserved/);
    expect(() =>
      ce.declareProtocol('Hashable', {
        functions: { __set__hash: '(self: Self, value: string) -> string' },
      })
    ).toThrow(/reserved/);
    expect(ce._protocolRegistry.Hashable).toBeUndefined();
  });

  test('a protocol name is NOT a type name (P8)', () => {
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(ce._typeRegistry['Comparable']).toBeUndefined();
    expect(() => ce.type('Comparable')).toThrow();
  });

  test('TOP-LEVEL ONLY: a nested declaration is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Block', protocolWithCompare('Nested')]).evaluate();
    expect(r.toString()).toContain('protocol-scope-invalid');
    expect(ce._protocolRegistry.Nested).toBeUndefined();
  });

  test('a host-forged pre-pass frame name does not bypass the rule', () => {
    // The static pre-pass frame is a top-level surrogate, recognized by frame
    // name AND `_staticTypeCheckDepth` — a host pushing a scope with the same
    // public name must not smuggle a nested declaration past the rule.
    const ce = new ComputeEngine();
    ce.pushScope(undefined, 'epsil:static-check');
    const r = ce.box(['Block', protocolWithCompare('Forged')]).evaluate();
    ce.popScope();
    expect(r.toString()).toContain('protocol-scope-invalid');
    expect(ce._protocolRegistry.Forged).toBeUndefined();
  });
});

describe('P17: v1 prohibits optional, variadic and generic members', () => {
  // The prohibition has to be enforced at DECLARATION: every downstream
  // consumer (the dispatcher's arity, `selfPositions`, the implementation
  // signature check) reads only `signature.args`, so a stored requirement
  // carrying `optArgs`/`variadicArg`/`typeParams` would be matched,
  // dispatched and typed at the wrong arity.
  const BAD: [string, string, RegExp][] = [
    [
      'optional',
      '(self: Self, other: integer?) -> string',
      /declares an optional argument/,
    ],
    [
      'variadic',
      '(self: Self, rest: integer*) -> string',
      /declares a variadic argument/,
    ],
    [
      'generic',
      '(self: Self, other: T) -> T where T',
      /declares a type parameter/,
    ],
  ];

  /** `["DeclareProtocol", "P", {f: function <sig>}]`. */
  const protocolWithSignature = (sig: string): any => [
    'DeclareProtocol',
    'P',
    [
      'Dictionary',
      ['KeyValuePair', 'f', ['Pair', { str: 'function' }, { str: sig }]],
    ],
  ];

  for (const [shape, sig, message] of BAD) {
    test(`HOST route: a ${shape} member throws and registers nothing`, () => {
      const ce = new ComputeEngine();
      expect(() => ce.declareProtocol('P', { functions: { f: sig } })).toThrow(
        message
      );
      expect(ce._protocolRegistry.P).toBeUndefined();
    });

    test(`STATEMENT route: a ${shape} member is an error value`, () => {
      const ce = new ComputeEngine();
      const r = ce.box(protocolWithSignature(sig)).evaluate();
      expect(r.toString()).toContain('invalid-protocol-declaration');
      expect(r.toString()).toMatch(message);
      expect(ce._protocolRegistry.P).toBeUndefined();
    });
  }

  test('a REPLACEMENT that introduces one leaves the previous members', () => {
    // Validation runs before the registry is touched (the atomic-replace
    // contract), so the prohibition inherits it.
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    const r = ce
      .box([
        'DeclareProtocol',
        'Comparable',
        [
          'Dictionary',
          [
            'KeyValuePair',
            'compare',
            [
              'Pair',
              { str: 'function' },
              { str: '(self: Self, rest: integer*) -> string' },
            ],
          ],
        ],
      ])
      .evaluate();
    expect(r.toString()).toContain('invalid-protocol-declaration');
    expect(ce._protocolRegistry.Comparable.members).toEqual({
      compare: { kind: 'function', signature: COMPARE_SIG },
    });
  });
});

describe('ce.declareProtocol (host route)', () => {
  test('declares, and the statement route sees it', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    expect(ce._protocolRegistry.Comparable.members).toEqual({
      compare: { kind: 'function', signature: COMPARE_SIG },
    });
    expect(
      ce
        .box(['DeclareConformance', { str: 'string' }, ['List', 'Comparable']])
        .evaluate().json
    ).toBe('Nothing');
  });

  test('the HOST route THROWS on re-declaration (P5)', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    expect(() =>
      ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } })
    ).toThrow();
  });

  test('a STATEMENT re-run REPLACES, and never throws (P5)', () => {
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    const r = ce
      .box([
        'DeclareProtocol',
        'Comparable',
        [
          'Dictionary',
          [
            'KeyValuePair',
            'key',
            ['Pair', { str: 'readonly' }, { str: 'string' }],
          ],
        ],
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(Object.keys(ce._protocolRegistry.Comparable.members)).toEqual([
      'key',
    ]);
  });

  test('a HOST-declared protocol is not replaced by a statement re-run', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    const r = ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(r.toString()).toContain('already declared');
  });

  test('the host route throws on a bad signature', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareProtocol('Bad', { functions: { f: '(x: integer) -> integer' } })
    ).toThrow(/protocol-self-required/);
  });
});

describe('P8: protocols and types share no names', () => {
  test('HOST route: a protocol may not take a type name', () => {
    const ce = new ComputeEngine();
    expect(() => ce.declareProtocol('string', {})).toThrow(
      /already a type; protocols and types share no names/
    );
    ce.declareType('Point', 'tuple<number, number>');
    expect(() => ce.declareProtocol('Point', {})).toThrow(
      /already a type; protocols and types share no names/
    );
  });

  test('STATEMENT route: a protocol over a type name is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['DeclareProtocol', 'collection']).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain(
      'already a type; protocols and types share no names'
    );
    expect(ce._protocolRegistry.collection).toBeUndefined();
  });

  test('HOST route: a type may not take a protocol name', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    expect(() => ce.declareType('Comparable', 'string')).toThrow(
      /already a protocol; protocols and types share no names/
    );
  });

  test('STATEMENT route: a type over a protocol name is an error value', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    const r = ce
      .box(['DeclareType', 'Comparable', { str: 'string' }])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain(
      'already a protocol; protocols and types share no names'
    );
    expect(ce._typeRegistry['Comparable']).toBeUndefined();
  });
});

describe('DeclareConformance', () => {
  const withComparable = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    return ce;
  };
  const conform = (ce: ComputeEngine, target: string, ...protocols: string[]) =>
    ce
      .box([
        'DeclareConformance',
        { str: target },
        ['List', ...protocols],
      ] as any)
      .evaluate();

  test('registers a pending edge on a built-in target', () => {
    const ce = withComparable();
    expect(conform(ce, 'string', 'Comparable').json).toBe('Nothing');
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([
      {
        target: 'string',
        targetKey: 'string',
        pending: true,
        declaredByStatement: true,
      },
    ]);
  });

  test('ROUTE PARITY: the canonical pass registers too', () => {
    const ce = withComparable();
    ce.box(['DeclareConformance', { str: 'string' }, ['List', 'Comparable']]);
    expect(
      ce._protocolRegistry.Comparable.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
  });

  test('a nominal target and a ground application are legal', () => {
    const ce = withComparable();
    ce.declareType('Point', 'tuple<number, number>');
    expect(conform(ce, 'Point', 'Comparable').json).toBe('Nothing');
    expect(conform(ce, 'list<integer>', 'Comparable').json).toBe('Nothing');
  });

  test('an unknown protocol is `protocol-unknown`', () => {
    const ce = withComparable();
    expect(conform(ce, 'string', 'Nope').toString()).toContain(
      'protocol-unknown'
    );
  });

  test('an unknown target type is `protocol-target-unknown`', () => {
    const ce = withComparable();
    expect(conform(ce, 'FooBar', 'Comparable').toString()).toContain(
      'protocol-target-unknown'
    );
  });

  test.each([
    ['a union', 'integer | string'],
    ['a negation', '!integer'],
    ['an anonymous tuple', 'tuple<number, number>'],
    ['a function signature', '(integer) -> integer'],
  ])('%s target is rejected', (_what, target) => {
    const ce = withComparable();
    expect(conform(ce, target, 'Comparable').toString()).toContain(
      'protocol-conformance-target-invalid'
    );
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });

  test('a `type alias` target is rejected with the steering message', () => {
    const ce = withComparable();
    ce.declareType('Pair', 'tuple<number, number>', { alias: true });
    const r = conform(ce, 'Pair', 'Comparable');
    expect(r.toString()).toContain('protocol-conformance-target-invalid');
    expect(r.toString()).toContain('type alias');
  });

  test('OVERLAP: comparable targets are allowed, disjoint ones too', () => {
    const ce = withComparable();
    expect(conform(ce, 'number', 'Comparable').json).toBe('Nothing');
    expect(conform(ce, 'integer', 'Comparable').json).toBe('Nothing');
    expect(conform(ce, 'string', 'Comparable').json).toBe('Nothing');
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(3);
  });

  test('OVERLAP: incomparable overlapping targets collide', () => {
    const ce = withComparable();
    conform(ce, 'integer<1..10>', 'Comparable');
    const r = conform(ce, 'integer<5..20>', 'Comparable');
    expect(r.toString()).toContain('protocol-conformance-overlap');
    expect(r.toString()).toContain('integer<1..10>');
    expect(r.toString()).toContain('integer<5..10>');
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
  });

  test('a duplicate conformance is a no-op', () => {
    const ce = withComparable();
    conform(ce, 'string', 'Comparable');
    expect(conform(ce, 'string', 'Comparable').json).toBe('Nothing');
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
  });

  test('a DUPLICATE implementation member is an error value', () => {
    // The raw dictionary preserves duplicate keys; the block does not, so
    // without the check the second `compare` would silently win.
    const ce = withComparable();
    const fn = (ret: string) => [
      'Function',
      ['Typed', { str: 'body' }, { str: ret }],
      ['Typed', 'self', { str: 'Self' }],
      ['Typed', 'other', { str: 'Self' }],
    ];
    const r = ce
      .box([
        'DeclareConformance',
        { str: 'string' },
        ['List', 'Comparable'],
        [
          'Dictionary',
          ['KeyValuePair', 'compare', fn('string')],
          ['KeyValuePair', 'compare', fn('number')],
        ],
      ] as any)
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('declares the member');
    expect(r.toString()).toContain('compare');
    expect(r.toString()).toContain('twice');
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });

  test('`&` registers one edge per protocol; a rejected one registers NOTHING', () => {
    const ce = withComparable();
    ce.box(['DeclareProtocol', 'Copyable']).evaluate();
    expect(conform(ce, 'string', 'Comparable', 'Copyable').json).toBe(
      'Nothing'
    );
    expect(ce._protocolRegistry.Copyable.conformances).toHaveLength(1);
    // `Nope` is unknown, so neither edge is added.
    expect(conform(ce, 'number', 'Copyable', 'Nope').operator).toBe('Error');
    expect(ce._protocolRegistry.Copyable.conformances).toHaveLength(1);
  });

  test('an implementation block with `&` is `protocol-implementation-split`', () => {
    const ce = withComparable();
    ce.box(['DeclareProtocol', 'Copyable']).evaluate();
    const r = ce
      .box([
        'DeclareConformance',
        { str: 'string' },
        ['List', 'Comparable', 'Copyable'],
        ['Dictionary', ['KeyValuePair', 'compare', ['Function', 1]]],
      ])
      .evaluate();
    expect(r.toString()).toContain('protocol-implementation-split');
  });

  test('a VALID implementation block is stored and clears `pending`', () => {
    const ce = withComparable();
    const r = ce
      .box([
        'DeclareConformance',
        { str: 'string' },
        ['List', 'Comparable'],
        [
          'Dictionary',
          ['KeyValuePair', 'compare', ['Function', 'x', 'a', 'b']],
        ],
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    const [edge] = ce._protocolRegistry.Comparable.conformances;
    expect(Object.keys(edge.impl!)).toEqual(['compare']);
    expect(edge.pending).toBe(false);
  });

  test('an EMPTY block on a protocol WITH requirements is rejected', () => {
    // Phase 2: an empty block implements nothing, so it is a HOLE, not a
    // pending edge (Appendix A "Protocol Implementation").
    const ce = withComparable();
    const r = ce
      .box([
        'DeclareConformance',
        { str: 'string' },
        ['List', 'Comparable'],
        ['Dictionary'],
      ])
      .evaluate();
    expect(r.toString()).toContain('protocol-implementation-missing');
    // ATOMIC: a rejected block registers no edge at all.
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });

  test('a PARTIAL block names every missing member, and registers nothing', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', {
      functions: { compare: COMPARE_SIG, equals: COMPARE_SIG },
    });
    const r = ce
      .box([
        'DeclareConformance',
        { str: 'string' },
        ['List', 'Comparable'],
        [
          'Dictionary',
          ['KeyValuePair', 'compare', ['Function', 'x', 'a', 'b']],
        ],
      ])
      .evaluate();
    expect(r.toString()).toContain('protocol-implementation-missing');
    expect(r.toString()).toContain('equals');
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });

  test('a FULL-COVERAGE block clears pending, including properties', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Named', {
      functions: { compare: COMPARE_SIG },
      readonly: { hash: 'string' },
      readwrite: { name: 'string' },
    });
    // An OBJECT target: `Named` has a `readwrite` property, and the B1
    // mutability gate admits only object types to such a protocol. Its stored
    // field is `v`, not `hash`/`name`, so no requirement is field-backed and
    // the block below is what clears `pending`.
    ce.declareType('Holder', 'object{v: string}');
    const conformWith = (...members: string[]) =>
      ce
        .box([
          'DeclareConformance',
          { str: 'Holder' },
          ['List', 'Named'],
          [
            'Dictionary',
            ...members.map((m) => [
              'KeyValuePair',
              m,
              // Two parameters for `compare` and the setter, one for a getter
              // — the arity the requirement fixes.
              m === '__get__hash' || m === '__get__name'
                ? ['Function', 'x', 'a']
                : ['Function', 'x', 'a', 'b'],
            ]),
          ],
        ] as any)
        .evaluate();

    // A `readwrite` property needs BOTH accessors.
    expect(
      conformWith('compare', '__get__hash', '__get__name').toString()
    ).toContain('protocol-implementation-missing');
    expect(ce._protocolRegistry.Named.conformances).toEqual([]);

    expect(
      conformWith('compare', '__get__hash', '__get__name', '__set__name').json
    ).toBe('Nothing');
    expect(ce._protocolRegistry.Named.conformances[0].pending).toBe(false);
  });

  test('a SEMANTIC protocol conformance is never pending', () => {
    const ce = new ComputeEngine();
    ce.box(['DeclareProtocol', 'Copyable']).evaluate();
    ce.box([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Copyable'],
    ]).evaluate();
    expect(ce._protocolRegistry.Copyable.conformances[0].pending).toBe(false);
  });

  test('TOP-LEVEL ONLY, and the surrogate frame is unforgeable', () => {
    const ce = withComparable();
    expect(
      ce
        .box([
          'Block',
          ['DeclareConformance', { str: 'string' }, ['List', 'Comparable']],
        ])
        .evaluate()
        .toString()
    ).toContain('protocol-scope-invalid');
    ce.pushScope(undefined, 'epsil:static-check');
    const forged = ce
      .box([
        'Block',
        ['DeclareConformance', { str: 'string' }, ['List', 'Comparable']],
      ])
      .evaluate();
    ce.popScope();
    expect(forged.toString()).toContain('protocol-scope-invalid');
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });
});

//
// ── Implementation validation (phase 2, ruling P17) ─────────────────────────
//

/** A `Function` literal in its authoring form: `["Function", ["Typed", body,
 * {str: ret}], ["Typed", p, {str: t}], …]`. A `null` return type is a literal
 * with no return marker (the result is left to inference, so it is not
 * checked); a bare-string parameter is an UNANNOTATED one. */
const fnLiteral = (
  ret: string | null,
  ...params: (string | [string, string])[]
): any => [
  'Function',
  ret === null ? { str: 'body' } : ['Typed', { str: 'body' }, { str: ret }],
  ...params.map((p) =>
    typeof p === 'string' ? p : ['Typed', p[0], { str: p[1] }]
  ),
];

describe('implementation validation (P17)', () => {
  /** An engine with `Comparable.compare(self: Self, other: Self) -> string`. */
  const withComparable = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    return ce;
  };

  /** `type <target> is <protocol> { <members> }` on the box route. */
  const implement = (
    ce: ComputeEngine,
    target: string,
    protocol: string,
    members: Record<string, any>
  ) =>
    ce
      .box([
        'DeclareConformance',
        { str: target },
        ['List', protocol],
        [
          'Dictionary',
          ...Object.entries(members).map(([k, v]) => ['KeyValuePair', k, v]),
        ],
      ] as any)
      .evaluate();

  test('an exact match registers', () => {
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', {
        compare: fnLiteral('string', ['self', 'Self'], ['other', 'Self']),
      }).json
    ).toBe('Nothing');
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(false);
  });

  test('`Self` and the target’s own name are SYNONYMS', () => {
    // Appendix A "Protocol Implementation": in an implementation the two
    // spellings mean the same type, in either position.
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', {
        compare: fnLiteral('string', ['self', 'string'], ['other', 'Self']),
      }).json
    ).toBe('Nothing');
  });

  test('an unknown member is `protocol-member-unknown`, with a did-you-mean', () => {
    const ce = withComparable();
    const r = implement(ce, 'string', 'Comparable', {
      cmpare: fnLiteral('string', ['self', 'Self'], ['other', 'Self']),
    });
    expect(r.toString()).toContain('protocol-member-unknown');
    expect(r.toString()).toContain('Did you mean `compare`?');
    // ATOMIC: nothing at all is registered by a rejected block.
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });

  test('the did-you-mean pool spans BOTH kinds', () => {
    // A typo does not know which kind the requirement has: `function hsah` is
    // a misspelling of the `readonly hash` PROPERTY, and the suggestion has to
    // cross the kinds to find it.
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', { readonly: { hash: 'string' } });
    const r = implement(ce, 'string', 'Hashable', {
      hsah: fnLiteral('string', ['self', 'Self']),
    });
    expect(r.toString()).toContain('protocol-member-unknown');
    expect(r.toString()).toContain('Did you mean `hash`?');

    // …and the reverse: a `get` key naming a near-miss FUNCTION member.
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    const r2 = implement(ce, 'string', 'Comparable', {
      __get__cmpare: fnLiteral('string', ['self', 'Self']),
    });
    expect(r2.toString()).toContain('Did you mean `compare`?');
  });

  test('a member too far from any requirement gets no suggestion', () => {
    const ce = withComparable();
    const r = implement(ce, 'string', 'Comparable', {
      serialize: fnLiteral('string', ['self', 'Self'], ['other', 'Self']),
    });
    expect(r.toString()).toContain('protocol-member-unknown');
    expect(r.toString()).not.toContain('Did you mean');
  });

  test('ARITY must match exactly', () => {
    const ce = withComparable();
    const r = implement(ce, 'string', 'Comparable', {
      compare: fnLiteral('string', ['self', 'Self']),
    });
    expect(r.toString()).toContain('protocol-signature-mismatch');
    expect(r.toString()).toContain('the requirement takes 2');
  });

  test('a NARROWED parameter is rejected (the Appendix A example)', () => {
    const ce = withComparable();
    const r = implement(ce, 'string', 'Comparable', {
      compare: fnLiteral('string', ['self', 'Self'], ['other', 'number']),
    });
    expect(r.toString()).toContain('protocol-signature-mismatch');
    expect(r.toString()).toContain('at `Self = string`');
    expect(r.toString()).toContain(
      'expected `(self: string, other: string) -> string`'
    );
    expect(r.toString()).toContain('argument 2 is `number`');
  });

  test('a WIDENED parameter is accepted (contravariance)', () => {
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', {
        compare: fnLiteral('string', ['self', 'Self'], ['other', 'any']),
      }).json
    ).toBe('Nothing');
  });

  test('a NARROWED result is accepted (covariance)', () => {
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', {
        compare: fnLiteral(
          '"<" | "=" | ">"',
          ['self', 'Self'],
          ['other', 'Self']
        ),
      }).json
    ).toBe('Nothing');
  });

  test('a WIDENED result is rejected', () => {
    const ce = withComparable();
    const r = implement(ce, 'string', 'Comparable', {
      compare: fnLiteral('any', ['self', 'Self'], ['other', 'Self']),
    });
    expect(r.toString()).toContain('protocol-signature-mismatch');
    expect(r.toString()).toContain('the result is `any`');
  });

  test('an UNANNOTATED parameter types as `any` and passes (v1)', () => {
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', {
        compare: fnLiteral(null, 'self', 'other'),
      }).json
    ).toBe('Nothing');
  });

  /** A `compare` implementation whose own marker declares `console`. */
  const consoleCompare: any = [
    'Function',
    [
      'Typed',
      { str: 'body' },
      { str: '(self: Self, other: Self) console -> string' },
    ],
    ['Typed', 'self', { str: 'Self' }],
    ['Typed', 'other', { str: 'Self' }],
  ];

  /** A `compare` implementation with a BARE marker whose BODY draws. */
  const drawingCompare: any = [
    'Function',
    [
      'Typed',
      ['Block', ['Random'], { str: '=' }],
      { str: '(self: Self, other: Self) -> string' },
    ],
    ['Typed', 'self', { str: 'Self' }],
    ['Typed', 'other', { str: 'Self' }],
  ];

  /** An engine whose `Comparable.compare` requirement spells a `pure`
   * ceiling, as opposed to `withComparable`'s BARE one. */
  const withPureComparable = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', {
      functions: { compare: '(self: Self, other: Self) pure -> string' },
    });
    return ce;
  };

  test('EFFECTS: a BARE requirement is no ceiling — an effectful implementation is accepted', () => {
    // A requirement with a bare specifier imposes no effect bound at all: a
    // protocol function is a dispatcher over an open set of conforming bodies,
    // and its effect set is DERIVED from them. Requiring the author to
    // anticipate every capability a future conformer might need is rejected by
    // name in `docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is
    // an effect" ("Rejected: bare-means-pure ceilings on requirements").
    // `withComparable`'s requirement is bare.
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', { compare: consoleCompare }).json
    ).toBe('Nothing');
  });

  test('EFFECTS: a bare requirement does not constrain the BODY either', () => {
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', { compare: drawingCompare }).json
    ).toBe('Nothing');
  });

  test('EFFECTS: an explicit `pure` ceiling rejects a DECLARED effect', () => {
    // `pure` parses to the STATED empty set, which is distinct from a bare
    // (absent) specifier and is the strongest ceiling.
    const ce = withPureComparable();
    const message = implement(ce, 'string', 'Comparable', {
      compare: consoleCompare,
    }).toString();
    expect(message).toContain('protocol-signature-mismatch');
    // Appendix B: the diagnostic names the exceeded label and points at the
    // ceiling as a possible fix site.
    expect(message).toContain('it declares the effects `console`');
    expect(message).toContain('exceeded by `console`');
    expect(message).toContain(
      "the requirement's ceiling on `Comparable.compare`"
    );
    expect(message).toContain('widen the ceiling');
  });

  test('EFFECTS: an explicit `pure` ceiling rejects a BODY that exceeds it', () => {
    // The implementation's own marker is bare, so nothing it DECLARES exceeds
    // the ceiling — only what its body infers does.
    const ce = withPureComparable();
    const message = implement(ce, 'string', 'Comparable', {
      compare: drawingCompare,
    }).toString();
    expect(message).toContain('protocol-signature-mismatch');
    expect(message).toContain(
      'the body of `compare` infers the effects `random`'
    );
    expect(message).toContain('exceeded by `random`');
    expect(message).toContain(
      "the requirement's ceiling on `Comparable.compare`"
    );
  });

  test('EFFECTS: a PURER implementation of an effectful requirement is accepted', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Loud', {
      functions: { shout: '(self: Self) console -> string' },
    });
    expect(
      implement(ce, 'string', 'Loud', {
        shout: fnLiteral('string', ['self', 'Self']),
      }).json
    ).toBe('Nothing');
  });

  test('an implementation that is not a function literal is rejected', () => {
    const ce = withComparable();
    expect(
      implement(ce, 'string', 'Comparable', { compare: 42 }).toString()
    ).toContain('protocol-signature-mismatch');
  });

  test('a NOMINAL target substitutes for `Self`', () => {
    const ce = withComparable();
    ce.declareType('Point', 'tuple<number, number>');
    expect(
      implement(ce, 'Point', 'Comparable', {
        compare: fnLiteral('string', ['self', 'Self'], ['other', 'Point']),
      }).json
    ).toBe('Nothing');
    const r = implement(ce, 'Point', 'Comparable', {
      compare: fnLiteral('string', ['self', 'Self'], ['other', 'string']),
    });
    expect(r.toString()).toContain('at `Self = Point`');
  });

  test('ATOMIC REPLACE: an invalid re-declaration leaves the previous impl', () => {
    const ce = withComparable();
    const good = fnLiteral('string', ['self', 'Self'], ['other', 'Self']);
    expect(implement(ce, 'string', 'Comparable', { compare: good }).json).toBe(
      'Nothing'
    );
    const [edge] = ce._protocolRegistry.Comparable.conformances;
    const stored = edge.impl;

    const r = implement(ce, 'string', 'Comparable', {
      compare: fnLiteral('string', ['self', 'Self'], ['other', 'number']),
    });
    expect(r.toString()).toContain('protocol-signature-mismatch');
    // The previous implementation — and `pending` — are untouched (P5).
    expect(ce._protocolRegistry.Comparable.conformances[0].impl).toBe(stored);
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(false);

    // …and a VALID re-declaration does replace it.
    expect(
      implement(ce, 'string', 'Comparable', {
        compare: fnLiteral('string', ['self', 'Self'], ['other', 'any']),
      }).json
    ).toBe('Nothing');
    expect(ce._protocolRegistry.Comparable.conformances[0].impl).not.toBe(
      stored
    );
  });

  test('P47: the BOX ROUTE outside a batch replaces, unstamped', () => {
    // The same-batch duplicate rule is a property of an Epsil BATCH: an
    // install outside any batch (a bare `ce.box(…).evaluate()`) carries no
    // stamp and replaces without error, exactly as before P47.
    const ce = withComparable();
    const member = (resultType: string) =>
      fnLiteral(resultType, ['self', 'Self'], ['other', 'Self']);
    expect(
      implement(ce, 'string', 'Comparable', { compare: member('string') }).json
    ).toBe('Nothing');
    const [edge] = ce._protocolRegistry.Comparable.conformances;
    expect(edge._implOrigin).toBeUndefined();

    const stored = edge.impl;
    expect(
      implement(ce, 'string', 'Comparable', { compare: member('"="') }).json
    ).toBe('Nothing');
    expect(edge.impl).not.toBe(stored);
    expect(edge._implOrigin).toBeUndefined();
  });

  test('P47: INSIDE a batch, a second block for the same pair is a duplicate', () => {
    // The engine-level half of the Epsil-surface pins: what makes the second
    // block a duplicate is the batch stamp, not anything Epsil-specific.
    const ce = withComparable();
    const member = (resultType: string) =>
      fnLiteral(resultType, ['self', 'Self'], ['other', 'Self']);
    ce._epsilBatchId = 42;
    try {
      expect(
        implement(ce, 'string', 'Comparable', { compare: member('string') })
          .json
      ).toBe('Nothing');
      const [edge] = ce._protocolRegistry.Comparable.conformances;
      expect(edge._implOrigin!.batch).toBe(42);
      const stored = edge.impl;

      const r = implement(ce, 'string', 'Comparable', {
        compare: member('"="'),
      });
      expect(r.toString()).toContain('protocol-implementation-duplicate');
      expect(edge.impl).toBe(stored);

      // A LATER batch replaces.
      ce._epsilBatchId = 43;
      expect(
        implement(ce, 'string', 'Comparable', { compare: member('"="') }).json
      ).toBe('Nothing');
      expect(edge.impl).not.toBe(stored);
      expect(edge._implOrigin!.batch).toBe(43);
    } finally {
      ce._epsilBatchId = undefined;
    }
  });

  test('REPLACING the protocol revalidates every implementation', () => {
    // Appendix A "Scope and lifecycle": a re-declaration with a changed
    // requirement set revalidates what is registered against it. The edge
    // survives (conformance is monotone) but goes back to PENDING.
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(
      implement(ce, 'string', 'Comparable', {
        compare: fnLiteral('string', ['self', 'Self'], ['other', 'Self']),
      }).json
    ).toBe('Nothing');
    const [edge] = ce._protocolRegistry.Comparable.conformances;
    expect(edge.pending).toBe(false);

    // The result type changes: the stored implementation no longer matches.
    ce.box([
      'DeclareProtocol',
      'Comparable',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'compare',
          [
            'Pair',
            { str: 'function' },
            { str: '(self: Self, other: Self) -> integer' },
          ],
        ],
      ],
    ]).evaluate();
    expect(ce._protocolRegistry.Comparable.conformances[0]).toBe(edge);
    expect(edge.pending).toBe(true);
  });

  describe('property handlers', () => {
    // `Named` has a `readwrite` property, so the B1 mutability gate
    // (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Which types can conform")
    // admits only OBJECT types as conformers — a writable property is
    // meaningful only on a mutable object. `Holder`'s stored field is `v`,
    // deliberately not `hash` or `name`: a stored field of the property's own
    // name would satisfy the requirement by itself (Appendix B's field
    // backing), and these tests are about the hand-written accessors.
    const HOLDER = 'Holder';
    const withNamed = (): ComputeEngine => {
      const ce = new ComputeEngine();
      ce.declareProtocol('Named', {
        readonly: { hash: 'string' },
        readwrite: { name: 'string' },
      });
      ce.declareType(HOLDER, 'object{v: string}');
      return ce;
    };
    const full = (over: Record<string, any> = {}) => ({
      __get__hash: fnLiteral('string', ['self', 'Self']),
      __get__name: fnLiteral('string', ['self', 'Self']),
      __set__name: fnLiteral('Self', ['self', 'Self'], ['v', 'string']),
      ...over,
    });

    test('the canonical shapes register', () => {
      const ce = withNamed();
      expect(implement(ce, HOLDER, 'Named', full()).json).toBe('Nothing');
      expect(Object.keys(ce._protocolRegistry.Named.conformances[0].impl!)) //
        .toEqual(['__get__hash', '__get__name', '__set__name']);
    });

    test('a `get` handler must be UNARY', () => {
      const ce = withNamed();
      const r = implement(
        ce,
        HOLDER,
        'Named',
        full({
          __get__hash: fnLiteral('string', ['self', 'Self'], ['x', 'string']),
        })
      );
      expect(r.toString()).toContain('protocol-signature-mismatch');
      expect(r.toString()).toContain('`get hash`');
      expect(r.toString()).toContain('the requirement takes 1');
    });

    test('a `get` handler’s result is covariant with the property type', () => {
      const ce = withNamed();
      const r = implement(
        ce,
        HOLDER,
        'Named',
        full({ __get__hash: fnLiteral('integer', ['self', 'Self']) })
      );
      expect(r.toString()).toContain('protocol-signature-mismatch');
      expect(r.toString()).toContain('the result is `integer`');
    });

    test('a `set` handler’s second parameter is contravariant', () => {
      const ce = withNamed();
      const r = implement(
        ce,
        HOLDER,
        'Named',
        full({
          __set__name: fnLiteral('Self', ['self', 'Self'], ['v', 'integer']),
        })
      );
      expect(r.toString()).toContain('protocol-signature-mismatch');
      expect(r.toString()).toContain('argument 2 is `integer`');
      // …and a widened one is fine.
      expect(
        implement(
          ce,
          HOLDER,
          'Named',
          full({
            __set__name: fnLiteral('Self', ['self', 'Self'], ['v', 'any']),
          })
        ).json
      ).toBe('Nothing');
    });

    test('a `set` handler on a READONLY property is rejected', () => {
      const ce = withNamed();
      const r = implement(
        ce,
        HOLDER,
        'Named',
        full({
          __set__hash: fnLiteral('Self', ['self', 'Self'], ['v', 'string']),
        })
      );
      expect(r.toString()).toContain('protocol-property-readonly-set');
    });

    test('a READWRITE property with a `set` but no `get` misses the getter', () => {
      const ce = withNamed();
      const r = implement(ce, HOLDER, 'Named', {
        __get__hash: fnLiteral('string', ['self', 'Self']),
        __set__name: fnLiteral('Self', ['self', 'Self'], ['v', 'string']),
      });
      expect(r.toString()).toContain('protocol-implementation-missing');
      expect(r.toString()).toContain('get name');
    });

    test('a property handler naming a FUNCTION member steers to `function`', () => {
      const ce = withComparable();
      const r = implement(ce, 'string', 'Comparable', {
        __get__compare: fnLiteral('string', ['self', 'Self']),
      });
      expect(r.toString()).toContain('protocol-member-unknown');
      expect(r.toString()).toContain('FUNCTION member');
    });

    test('a `function` member naming a PROPERTY steers to `get`', () => {
      const ce = withNamed();
      const r = implement(ce, HOLDER, 'Named', {
        hash: fnLiteral('string', ['self', 'Self']),
      });
      expect(r.toString()).toContain('protocol-member-unknown');
      expect(r.toString()).toContain('get hash');
    });
  });
});

describe('ce.declareProtocolImplementation (host route)', () => {
  const withComparable = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    return ce;
  };

  test('declares the conformance edge and stores the host callbacks', () => {
    const ce = withComparable();
    const compare = (): string => '=';
    ce.declareProtocolImplementation('string', 'Comparable', {
      functions: { compare },
    });
    const [edge] = ce._protocolRegistry.Comparable.conformances;
    expect(edge.targetKey).toBe('string');
    expect(edge.pending).toBe(false);
    // A HOST conformance, not a statement one — a statement re-run of the
    // protocol must not treat it as its own.
    expect(edge.declaredByStatement).toBe(false);
    // Stored DISTINGUISHABLY from an Epsil function literal (P10).
    expect(edge.impl!.compare).toEqual({ host: compare });
  });

  test('getters and setters ride under the mangled keys', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Named', {
      readonly: { hash: 'string' },
      readwrite: { name: 'string' },
    });
    // An OBJECT target — the B1 mutability gate applies to the host channel
    // too, since a host implementation IS a conformance declaration.
    ce.declareType('Holder', 'object{v: string}');
    ce.declareProtocolImplementation('Holder', 'Named', {
      getters: { hash: () => 'h', name: () => 'n' },
      setters: { name: (self: any) => self },
    });
    expect(
      Object.keys(ce._protocolRegistry.Named.conformances[0].impl!)
    ).toEqual(['__get__hash', '__get__name', '__set__name']);
  });

  test('a JS callback is TRUSTED: its arity is not checked', () => {
    // A host callback carries no signature the engine can read, so only
    // member-name coverage is validated — the operator-handler contract.
    const ce = withComparable();
    expect(() =>
      ce.declareProtocolImplementation('string', 'Comparable', {
        functions: { compare: () => '=' },
      })
    ).not.toThrow();
  });

  test('THROWS on a duplicate implementation (P5: no host replace)', () => {
    const ce = withComparable();
    ce.declareProtocolImplementation('string', 'Comparable', {
      functions: { compare: () => '=' },
    });
    expect(() =>
      ce.declareProtocolImplementation('string', 'Comparable', {
        functions: { compare: () => '<' },
      })
    ).toThrow(/protocol-implementation-duplicate/);
  });

  test('THROWS on an unknown member, a missing member and a readonly setter', () => {
    const ce = withComparable();
    expect(() =>
      ce.declareProtocolImplementation('string', 'Comparable', {
        functions: { cmpare: () => '=' },
      })
    ).toThrow(/protocol-member-unknown[\s\S]*Did you mean `compare`/);
    expect(() =>
      ce.declareProtocolImplementation('string', 'Comparable', {})
    ).toThrow(/protocol-implementation-missing/);

    ce.declareProtocol('Hashable', { readonly: { hash: 'string' } });
    expect(() =>
      ce.declareProtocolImplementation('string', 'Hashable', {
        getters: { hash: () => 'h' },
        setters: { hash: () => 'h' },
      })
    ).toThrow(/protocol-property-readonly-set/);
    // Nothing was registered by any of the rejected calls.
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
    expect(ce._protocolRegistry.Hashable.conformances).toEqual([]);
  });

  test('THROWS on an unknown protocol and an unknown target', () => {
    const ce = withComparable();
    expect(() =>
      ce.declareProtocolImplementation('string', 'Nope', {})
    ).toThrow(/protocol-unknown/);
    expect(() =>
      ce.declareProtocolImplementation('FooBar', 'Comparable', {
        functions: { compare: () => '=' },
      })
    ).toThrow(/protocol-target-unknown/);
  });

  test('THROWS on an invalid conformance target', () => {
    const ce = withComparable();
    expect(() =>
      ce.declareProtocolImplementation('integer | string', 'Comparable', {
        functions: { compare: () => '=' },
      })
    ).toThrow(/protocol-conformance-target-invalid/);
  });

  test('THROWS on an incomparable overlapping target', () => {
    const ce = withComparable();
    ce.declareProtocolImplementation('integer<1..10>', 'Comparable', {
      functions: { compare: () => '=' },
    });
    expect(() =>
      ce.declareProtocolImplementation('integer<5..20>', 'Comparable', {
        functions: { compare: () => '=' },
      })
    ).toThrow(/protocol-conformance-overlap/);
  });

  test('registers a CONDITIONAL conformance from `options.where`', () => {
    const ce = withComparable();
    ce.declareProtocolImplementation('string', 'Comparable', {
      functions: { compare: () => '=' },
    });
    ce.declareProtocolImplementation(
      'list<T>',
      'Comparable',
      { functions: { compare: () => '<' } },
      { where: 'T is Comparable' }
    );
    const edge = ce._protocolRegistry.Comparable.conformances.find(
      (c) => c.where !== undefined
    )!;
    expect(edge.targetKey).toBe('list<T> where T is Comparable');
    expect(edge.where).toEqual([{ name: 'T', protocols: ['Comparable'] }]);
    expect(edge.pending).toBe(false);
    // Applies to `list<string>` (string conforms) and not to `list<integer>`.
    const conformsTo = ce._typeResolver.conformsTo!;
    expect(conformsTo(ce.type('list<string>').type, 'Comparable')).toBe(true);
    expect(conformsTo(ce.type('list<integer>').type, 'Comparable')).toBe(false);
  });

  test('THROWS on a malformed `options.where` clause', () => {
    const ce = withComparable();
    expect(() =>
      ce.declareProtocolImplementation(
        'list<T>',
        'Comparable',
        { functions: { compare: () => '=' } },
        { where: 'T: ,' }
      )
    ).toThrow(/protocol-conformance-target-invalid/);
  });

  test('THROWS when the head names a variable the clause does not bind', () => {
    const ce = withComparable();
    expect(() =>
      ce.declareProtocolImplementation(
        'list<U>',
        'Comparable',
        { functions: { compare: () => '=' } },
        { where: 'T' }
      )
    ).toThrow(/protocol-conformance-target-invalid/);
  });

  test('fulfils a conformance that the STATEMENT route left pending', () => {
    const ce = withComparable();
    ce.box(['DeclareConformance', { str: 'string' }, ['List', 'Comparable']]) //
      .evaluate();
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(true);
    ce.declareProtocolImplementation('string', 'Comparable', {
      functions: { compare: () => '=' },
    });
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(false);
  });

  test('THROWS on a duplicate MANGLED key', () => {
    // The three buckets share one key space once mangled:
    // `functions['__get__hash']` and `getters['hash']` are the same key, and
    // the collision must not silently keep the last.
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', { readonly: { hash: 'string' } });
    expect(() =>
      ce.declareProtocolImplementation('string', 'Hashable', {
        functions: { __get__hash: () => 'h' },
        getters: { hash: () => 'h' },
      })
    ).toThrow(/provides `__get__hash` more than once/);
    expect(ce._protocolRegistry.Hashable.conformances).toEqual([]);
  });

  test('REPLACING the protocol revalidates a HOST implementation', () => {
    // The statement-route counterpart is in the P17 block. A host callback is
    // TRUSTED, so only its member COVERAGE is revalidated: a replacement that
    // retypes a requirement leaves it fulfilled, one that ADDS a requirement
    // does not.
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    ce.declareProtocolImplementation('string', 'Comparable', {
      functions: { compare: () => '=' },
    });
    const [edge] = ce._protocolRegistry.Comparable.conformances;
    expect(edge.pending).toBe(false);

    // COMPATIBLE: the signature changes, the member set does not.
    ce.box([
      'DeclareProtocol',
      'Comparable',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'compare',
          [
            'Pair',
            { str: 'function' },
            { str: '(self: Self, other: Self) -> integer' },
          ],
        ],
      ],
    ]).evaluate();
    expect(ce._protocolRegistry.Comparable.conformances[0]).toBe(edge);
    expect(edge.pending).toBe(false);

    // INCOMPATIBLE: a new requirement the implementation does not cover.
    ce.box([
      'DeclareProtocol',
      'Comparable',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'compare',
          ['Pair', { str: 'function' }, { str: COMPARE_SIG }],
        ],
        [
          'KeyValuePair',
          'hash',
          ['Pair', { str: 'readonly' }, { str: 'string' }],
        ],
      ],
    ]).evaluate();
    expect(edge.pending).toBe(true);

    // …and going back to the original requirement set clears it again.
    ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(edge.pending).toBe(false);
  });

  test('BOTH CHANNELS: the same fault throws on the host route and is a VALUE on the statement route', () => {
    const host = new ComputeEngine();
    host.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    expect(() =>
      host.declareProtocolImplementation('string', 'Comparable', {
        functions: { cmpare: () => '=' },
      })
    ).toThrow(/protocol-member-unknown/);

    const statement = new ComputeEngine();
    statement.declareProtocol('Comparable', {
      functions: { compare: COMPARE_SIG },
    });
    const r = statement
      .box([
        'DeclareConformance',
        { str: 'string' },
        ['List', 'Comparable'],
        [
          'Dictionary',
          [
            'KeyValuePair',
            'cmpare',
            ['Function', ['Typed', { str: 'b' }, { str: 'string' }], 'a', 'b'],
          ],
        ],
      ] as any)
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('protocol-member-unknown');
  });
});

describe('lattice inheritance: an INHERITED implementation is not pending', () => {
  // Appendix A "Lattice inheritance and overlap": an implementation
  // registered for a supertype satisfies the completeness requirement of
  // every conforming subtype, so an implementation-LESS edge below a
  // fulfilled one is complete — the `pending` flag (and the end-of-batch
  // warning that reads it) must say so.
  const COMPARABLE =
    'protocol Comparable {\n  function compare(self: Self, other: Self) -> string\n}';
  const IMPL = (target: string) =>
    `type ${target} is Comparable {\n  function compare(self: Self, other: Self) -> string { "=" }\n}`;
  const codes = (ce: ComputeEngine, source: string): string[] =>
    executeEpsil(ce, source).diagnostics.map((d) => d.message[0] as string);
  const flags = (ce: ComputeEngine): [string, boolean][] =>
    ce._protocolRegistry.Comparable.conformances.map((c) => [
      c.targetKey,
      c.pending,
    ]);

  test('the supertype implementation comes FIRST', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    expect(codes(ce, IMPL('number'))).toEqual([]);
    // `integer <: number`, so the conformance is fulfilled on the spot: no
    // pending edge, and no warning in this batch or any later one.
    expect(codes(ce, 'type integer is Comparable')).toEqual([]);
    expect(codes(ce, '1 + 1')).toEqual([]);
    expect(flags(ce)).toEqual([
      ['number', false],
      ['integer', false],
    ]);
  });

  test('the subtype conformance comes first, and CLEARS when the implementation lands', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    expect(codes(ce, 'type integer is Comparable')).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(codes(ce, IMPL('number'))).toEqual([]);
    expect(codes(ce, '1 + 1')).toEqual([]);
    expect(flags(ce)).toEqual([
      ['integer', false],
      ['number', false],
    ]);
  });

  test('inheritance does NOT run upward', () => {
    // `number` is not covered by an `integer` implementation.
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    executeEpsil(ce, IMPL('integer'));
    expect(codes(ce, 'type number is Comparable')).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(flags(ce)).toEqual([
      ['integer', false],
      ['number', true],
    ]);
  });

  test('REPLACING the protocol re-runs the pass', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    executeEpsil(ce, IMPL('number'));
    executeEpsil(ce, 'type integer is Comparable');
    expect(flags(ce)).toEqual([
      ['number', false],
      ['integer', false],
    ]);

    // The `number` implementation no longer matches, so the `integer` edge
    // has nothing left to inherit.
    executeEpsil(
      ce,
      'protocol Comparable {\n  function compare(self: Self, other: Self) -> integer\n}'
    );
    expect(flags(ce)).toEqual([
      ['number', true],
      ['integer', true],
    ]);

    // …and it comes back when the implementation matches again.
    executeEpsil(ce, COMPARABLE);
    expect(flags(ce)).toEqual([
      ['number', false],
      ['integer', false],
    ]);
  });

  test('a HOST implementation is inherited too', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', { functions: { compare: COMPARE_SIG } });
    ce.box(['DeclareConformance', { str: 'integer' }, ['List', 'Comparable']]) //
      .evaluate();
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(true);
    ce.declareProtocolImplementation('number', 'Comparable', {
      functions: { compare: () => '=' },
    });
    expect(flags(ce)).toEqual([
      ['integer', false],
      ['number', false],
    ]);
  });
});

describe('_protocolRegistryRollbackPoint', () => {
  test('a fresh declaration is discarded and the axes are bumped', () => {
    const ce = new ComputeEngine();
    const rollback = ce._protocolRegistryRollbackPoint();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(ce._protocolRegistry.Comparable).toBeDefined();
    const a0 = ce._anyVersion;
    const w0 = ce._worldVersion;
    rollback();
    expect(ce._protocolRegistry.Comparable).toBeUndefined();
    // A rollback that restored something is a `config` event (all axes).
    expect(ce._anyVersion).toBeGreaterThan(a0);
    expect(ce._worldVersion).toBeGreaterThan(w0);
  });

  test('a NO-OP rollback bumps nothing', () => {
    // The pass runs on every `executeEpsil` call; the overwhelming majority
    // of programs declare no protocols at all.
    const ce = new ComputeEngine();
    const rollback = ce._protocolRegistryRollbackPoint();
    const a0 = ce._anyVersion;
    rollback();
    expect(ce._anyVersion).toBe(a0);
  });

  test('conformance edges and implementations are restored per FIELD', () => {
    // Records (and their edges) mutate IN PLACE, so the snapshot is per-field.
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    ce.box([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Comparable'],
    ]).evaluate();
    const record = ce._protocolRegistry.Comparable;
    const edge = record.conformances[0];

    const rollback = ce._protocolRegistryRollbackPoint();
    ce.box([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Comparable'],
      ['Dictionary', ['KeyValuePair', 'compare', ['Function', 'x', 'a', 'b']]],
    ]).evaluate();
    ce.box([
      'DeclareConformance',
      { str: 'number' },
      ['List', 'Comparable'],
    ]).evaluate();
    expect(record.conformances).toHaveLength(2);
    expect(edge.pending).toBe(false);

    rollback();
    expect(ce._protocolRegistry.Comparable).toBe(record);
    expect(record.conformances).toHaveLength(1);
    expect(edge.pending).toBe(true);
    expect(edge.impl).toBeUndefined();
  });

  test('the P47 batch STAMP is snapshotted with the implementation', () => {
    // The stamp is registry state: the pre-pass installs a block (stamped),
    // this thunk removes it, and the evaluation loop's own install must not
    // then read the pre-pass's stamp as a same-batch duplicate.
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    ce.box([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Comparable'],
    ]).evaluate();
    const edge = ce._protocolRegistry.Comparable.conformances[0];

    const rollback = ce._protocolRegistryRollbackPoint();
    ce._epsilBatchId = 7;
    try {
      ce.box([
        'DeclareConformance',
        { str: 'string' },
        ['List', 'Comparable'],
        [
          'Dictionary',
          ['KeyValuePair', 'compare', ['Function', 'x', 'a', 'b']],
        ],
      ]).evaluate();
      expect(edge._implOrigin!.batch).toBe(7);

      rollback();
      expect(edge.impl).toBeUndefined();
      expect(edge._implOrigin).toBeUndefined();
    } finally {
      ce._epsilBatchId = undefined;
    }
  });

  test('the Epsil static pre-pass leaves the registry untouched', () => {
    // `staticDiagnostics` runs the transaction; the program's REAL evaluation
    // then performs the declarations in statement order.
    const ce = new ComputeEngine();
    const source = 'protocol Copyable {}\ntype string is Copyable';
    const [ast] = parseEpsil(source);
    staticDiagnostics(ce, ast, source);
    expect(ce._protocolRegistry.Copyable).toBeUndefined();
  });
});

describe('protocol registry state events', () => {
  const advanced = (ce: ComputeEngine, f: () => void) => {
    const a0 = ce._anyVersion;
    const s0 = ce._semanticVersion;
    const w0 = ce._worldVersion;
    f();
    return {
      any: ce._anyVersion > a0,
      semantic: ce._semanticVersion > s0,
      world: ce._worldVersion > w0,
    };
  };

  test('a conformance ADDITION advances all three axes (the config mask, P16)', () => {
    // Conformance is monotonically ADDED, so a cached static-dispatch
    // resolution can be invalidated by a later, more specific conformance.
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    expect(
      advanced(ce, () => {
        ce.box([
          'DeclareConformance',
          { str: 'string' },
          ['List', 'Comparable'],
        ]).evaluate();
      })
    ).toEqual({ any: true, semantic: true, world: true });
  });

  test('a protocol declaration advances all three axes', () => {
    const ce = new ComputeEngine();
    expect(advanced(ce, () => ce.declareProtocol('Copyable', {}))).toEqual({
      any: true,
      semantic: true,
      world: true,
    });
  });
});

describe('P8: a protocol name in TYPE position', () => {
  // A protocol is not a type and its name is deliberately absent from the type
  // registry, so the type layer — which has no registry of its own — could only
  // report a generic "unknown type". The ENGINE's resolver sees the protocol
  // registry, so its resolve-failure path names the confusion and points at the
  // constrained-variable spelling that was meant.
  const GUIDANCE =
    '`Comparable` is a protocol, not a type. Use a constrained variable: ' +
    '`(x: T) -> boolean where T is Comparable`';

  const engineWithComparable = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.box(protocolWithCompare('Comparable')).evaluate();
    return ce;
  };

  test('`ce.type()` fails with the code and the guidance', () => {
    const ce = engineWithComparable();
    let caught: any;
    try {
      ce.type('Comparable');
    } catch (e) {
      caught = e;
    }
    expect(caught?.code).toBe('protocol-in-type-position');
    expect(caught?.rawMessage).toBe(
      `protocol-in-type-position: ${GUIDANCE}`
    );
  });

  test('a host declaration naming one in a signature is refused', () => {
    const ce = engineWithComparable();
    let caught: any;
    try {
      ce.declare('f', { signature: '(Comparable) -> boolean' });
    } catch (e) {
      caught = e;
    }
    expect(caught?.code).toBe('protocol-in-type-position');
    expect(caught?.rawMessage).toContain(GUIDANCE);
  });

  test('the box route turns it into an error VALUE carrying the code', () => {
    // The E2 signature marker of a function literal: the type text reaches the
    // engine's resolver, and the structured code becomes the error's own.
    const ce = engineWithComparable();
    const f = ce.box([
      'Function',
      ['Typed', ['Block', 'True'], { str: '(x: Comparable) -> boolean' }],
      'x',
    ] as any);
    expect(f.toString()).toContain(
      'ErrorCode("protocol-in-type-position"'
    );
    // The code is the head of the thrown message; it is not repeated in the
    // detail.
    expect(f.toString()).toContain(GUIDANCE);
  });

  test('an ordinary unknown type keeps its ordinary failure', () => {
    const ce = engineWithComparable();
    let caught: any;
    try {
      ce.type('Zork');
    } catch (e) {
      caught = e;
    }
    expect(caught?.code).toBeUndefined();
    expect(caught?.rawMessage).toBe('Unknown type "Zork"');
  });

  test('the name is NOT registered as a type', () => {
    // The diagnosis is made on the resolve MISS; the registry is untouched, so
    // `Comparable` stays unavailable everywhere a type name is legal.
    const ce = engineWithComparable();
    expect(ce._typeResolver.names).not.toContain('Comparable');
    // …and a re-declaration still reads "already declared", not "already a
    // type": the P8 probe treats the throw as "not a type".
    expect(() => ce.declareProtocol('Comparable', {})).toThrow(
      'already declared'
    );
  });
});

//
// ── The declared-contract widening guard ────────────────────────────────────
//
// A protocol dispatcher's effect set is DERIVED from the conformers of a BARE
// requirement, so registering a conformance can widen it — and a function
// annotated `pure` that calls through that dispatcher then declares something
// untrue. Such a statement is BLOCKED, not merely flagged: the engine
// re-derives every declared-effect contract after the registration and rolls
// the registration back when one is exceeded
// (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
// effect").
//

describe('conformance-widens-declared-contract', () => {
  /** An engine with a BARE `Speaker.speak` requirement and one PURE conformer,
   * so a dependent's call through the dispatcher typechecks. */
  const withSpeaker = (): ComputeEngine => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Speaker {\n  function speak(self: Self) -> string\n}'
    );
    executeEpsil(
      ce,
      'type string is Speaker {\n  function speak(self: Self) -> string { "hi" }\n}'
    );
    return ce;
  };

  /** `type number is Speaker { … Random() … }` — the DRAWING conformer that
   * widens the derived union to `{random}`. */
  const DRAWING =
    'type number is Speaker {\n  function speak(self: Self) -> string { Random() }\n}';

  test('the drawing conformance is REJECTED, naming the dependent and the label', () => {
    const ce = withSpeaker();
    expect(
      executeEpsil(ce, 'function f() pure -> unknown { speak("x") }').value.json
    ).toBe('Nothing');

    const message = executeEpsil(ce, DRAWING).value.toString();
    expect(message).toContain('conformance-widens-declared-contract');
    expect(message).toContain('`f` declares `pure` but would infer `random`');
    expect(message).toContain('exceeding: `random`');
  });

  test('the rejected registration is ROLLED BACK', () => {
    const ce = withSpeaker();
    executeEpsil(ce, 'function f() pure -> unknown { speak("x") }');
    executeEpsil(ce, DRAWING);

    // The edge is gone…
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
    // …the dispatcher's derived union is pure again…
    expect(ce.lookupDefinition('speak')!['operator'].pure).toBe(true);
    // …the dependent still works…
    expect(executeEpsil(ce, 'f()').value.toString()).toBe('"hi"');
    // …and a later PURE conformance still registers.
    expect(
      executeEpsil(
        ce,
        'type boolean is Speaker {\n  function speak(self: Self) -> string { "b" }\n}'
      ).value.json
    ).toBe('Nothing');
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.targetKey)
    ).toEqual(['string', 'boolean']);
  });

  test('EVERY violated dependent is named, including a TRANSITIVE one', () => {
    // `g` reaches the dispatcher only through `mid`, whose own arrow is BARE —
    // so `mid` re-derives to `{random}` and carries the widening onward. (A
    // contract-holding intermediate would stop it: its declared set is what
    // its callers see, and the violation is reported at the intermediate.)
    const ce = withSpeaker();
    executeEpsil(ce, 'function f() pure -> unknown { speak("x") }');
    executeEpsil(ce, 'function mid() { speak("x") }');
    executeEpsil(ce, 'function g() pure -> unknown { mid() }');

    const message = executeEpsil(ce, DRAWING).value.toString();
    expect(message).toContain('`f` declares `pure`');
    expect(message).toContain('`g` declares `pure`');
  });

  test('a VALUE-half contract — a `let` holding a literal — is covered too', () => {
    // The index spans both halves of a binding: a `let` with an effect-bearing
    // arrow type holds its contract on the value definition, not on an
    // operator definition.
    const ce = withSpeaker();
    executeEpsil(ce, 'let cb: () pure -> unknown = () => speak("x")');
    expect(ce.lookupDefinition('cb')!['value']).toBeDefined();
    expect(ce.lookupDefinition('cb')!['operator']).toBeUndefined();

    const message = executeEpsil(ce, DRAWING).value.toString();
    expect(message).toContain('conformance-widens-declared-contract');
    expect(message).toContain('`cb` declares `pure` but would infer `random`');
  });

  test('REPLACING the protocol is guarded too, and is rolled back', () => {
    // The dispatcher's effect set also widens when the PROTOCOL changes: a
    // requirement that gains a `random` ceiling makes every call through the
    // dispatcher random, whatever the conformers do. The replacement runs the
    // same re-derivation as a conformance registration and is undone the same
    // way.
    const ce = withSpeaker();
    executeEpsil(ce, 'function f() pure -> unknown { speak("x") }');

    const message = executeEpsil(
      ce,
      'protocol Speaker {\n  function speak(self: Self) random -> string\n}'
    ).value.toString();
    expect(message).toContain('conformance-widens-declared-contract');
    expect(message).toContain('replacing this protocol');
    expect(message).toContain('`f` declares `pure` but would infer `random`');

    // The ORIGINAL requirement is still in force: the bare signature, a pure
    // dispatcher, and the pure conformer still dispatching.
    expect(ce._protocolRegistry.Speaker.members.speak).toEqual({
      kind: 'function',
      signature: '(self: Self) -> string',
    });
    expect(ce.lookupDefinition('speak')!['operator'].pure).toBe(true);
    expect(executeEpsil(ce, 'speak("y")').value.toString()).toBe('"hi"');
    expect(executeEpsil(ce, 'f()').value.toString()).toBe('"hi"');
  });

  test('a conformance that widens NOTHING declared is accepted', () => {
    // The control: the same drawing conformer, with no declared contract in
    // reach. The dispatcher's union widens, which is the designed behavior.
    const ce = withSpeaker();
    executeEpsil(ce, 'function loose() { speak("x") }');
    expect(executeEpsil(ce, DRAWING).value.json).toBe('Nothing');
    expect(ce.lookupDefinition('speak')!['operator'].effects).toEqual([
      'random',
    ]);
  });
});

//
// ── A STRANDED implementation is out of the derived union ───────────────────
//

describe('a PENDING edge does not widen the dispatcher', () => {
  test('a protocol re-declaration strands the drawing implementation', () => {
    // The dispatcher's derived effect set is the union over the conformers of
    // a BARE requirement — but only over the ones dispatch can actually reach.
    // A re-declaration that retypes a requirement leaves an implementation
    // that no longer matches PENDING, and a pending edge is not a dispatch
    // candidate, so its effects must leave the union with it.
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Speaker {\n  function speak(self: Self) -> string\n}'
    );
    executeEpsil(
      ce,
      'type number is Speaker {\n  function speak(self: Self) -> string { Random() }\n}'
    );
    expect(ce.lookupDefinition('speak')!['operator'].effects).toEqual([
      'random',
    ]);

    // The new requirement takes two arguments, so the stored one-argument
    // implementation no longer matches and its edge goes pending.
    expect(
      executeEpsil(
        ce,
        'protocol Speaker {\n  function speak(self: Self, other: Self) -> string\n}'
      ).value.json
    ).toBe('Nothing');
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.pending)
    ).toEqual([true]);

    // The empty set is spelled `undefined` by the definition getter.
    expect(ce.lookupDefinition('speak')!['operator'].effects).toBeUndefined();
    expect(ce.lookupDefinition('speak')!['operator'].pure).toBe(true);
  });
});
