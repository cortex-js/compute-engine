import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

//
// CONDITIONAL CONFORMANCE — phase 5 of
// `docs/plans/2026-08-12-protocols-design.md`, surface spec
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A "Conditional Conformance".
//
//   type list<T> is Comparable where T is Comparable { … }
//
// The head names the target's variables; the trailing `where` clause BINDS them
// (the single-binding-site rule). The conformance applies to exactly those
// instantiations whose arguments satisfy the clause. v1 allows at most ONE
// conformance per (head, protocol) pair — a conditional one therefore excludes
// an unconditional one on the same head.
//
// Protocols are engine-global, so every block below uses a fresh engine.
//

const COMPARABLE = `protocol Comparable {
  function compare(self: Self, other: Self) -> string
}`;

/** `string` conforms by comparing its two operands. */
const STRING_IS_COMPARABLE = `type string is Comparable {
  function compare(self: Self, other: Self) -> string {
    if (self < other) { "<" } else { if (self == other) { "=" } else { ">" } }
  }
}`;

/** The Appendix A example: a list compares when its ELEMENTS compare. Kept to
 * the first element so the body stays a single expression — what matters here
 * is that the elements are actually used, i.e. that the nested `compare` call
 * dispatches. */
const LIST_IS_COMPARABLE = `type list<T> is Comparable where T is Comparable {
  function compare(self: list<T>, other: list<T>) -> string {
    compare(self[1], other[1])
  }
}`;

/** Run an Epsil program, returning the diagnostic codes. */
function run(ce: ComputeEngine, source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

/** The value of an Epsil program, as a string. */
function value(ce: ComputeEngine, source: string): string {
  return executeEpsil(ce, source).value.toString();
}

/** A fresh engine with each source run on it. An impl-LESS conformance leaves a
 * `protocol-implementation-pending` warning behind (P3), which every batch
 * re-reports; only genuine problems are asserted away. */
function engineFor(...sources: string[]): ComputeEngine {
  const ce = new ComputeEngine();
  for (const s of sources)
    expect(run(ce, s).filter((c) => c !== 'protocol-implementation-pending'))
      .toEqual([]);
  return ce;
}

/** The error CODE a single declaration statement evaluates to, or `null`. A
 * statement's error value is the program's value when it is the last one — only
 * a NON-final statement's error becomes a `runtime-error` diagnostic. */
function declarationError(ce: ComputeEngine, source: string): string | null {
  const text = executeEpsil(ce, source).value.toString();
  return /ErrorCode\("([^"]+)"/.exec(text)?.[1] ?? null;
}

/** The conditional edge of `protocol`, if any. */
function conditionalEdge(ce: ComputeEngine, protocol: string) {
  return ce._protocolRegistry[protocol].conformances.find(
    (c) => c.where !== undefined
  );
}

describe('the Appendix A lexicographic-list example, end to end', () => {
  const setup = (): ComputeEngine =>
    engineFor(COMPARABLE, STRING_IS_COMPARABLE, LIST_IS_COMPARABLE);

  test('registers a conditional edge with its clause', () => {
    const edge = conditionalEdge(setup(), 'Comparable')!;
    expect(edge.targetKey).toBe('list<T> where T is Comparable');
    expect(edge.where).toEqual([{ name: 'T', protocols: ['Comparable'] }]);
    expect(edge.pending).toBe(false);
  });

  test('dispatches on a `list<string>` and compares the ELEMENTS', () => {
    const ce = setup();
    expect(value(ce, 'compare(["a","b"], ["a","c"])')).toBe('"="'); // "a" vs "a"
    expect(value(ce, 'compare(["b","x"], ["a","c"])')).toBe('">"');
    expect(value(ce, 'compare(["a","x"], ["b","c"])')).toBe('"<"');
  });

  test('`integer` does not conform, so `list<integer>` does not either', () => {
    const ce = setup();
    // No applicable edge: the runtime error the diagnostics table promises.
    expect(value(ce, 'compare([1,2],[1,3])')).toContain(
      'protocol-implementation-missing'
    );
  });

  test('an EMPTY list conforms vacuously (P40: `never` conforms)', () => {
    const ce = setup();
    // `[]` synthesizes `list<never>`, so the clause is satisfied vacuously and
    // the implementation runs (and finds no element 1).
    expect(value(ce, 'compare([], [])')).not.toContain(
      'protocol-implementation-missing'
    );
  });
});

describe('recursion', () => {
  test('`list<list<string>>` conforms, and terminates', () => {
    const ce = engineFor(COMPARABLE, STRING_IS_COMPARABLE, LIST_IS_COMPARABLE);
    const conformsTo = ce._typeResolver.conformsTo!;
    expect(conformsTo(ce.type('list<string>').type, 'Comparable')).toBe(true);
    expect(conformsTo(ce.type('list<list<string>>').type, 'Comparable')).toBe(
      true
    );
    expect(conformsTo(ce.type('list<list<integer>>').type, 'Comparable')).toBe(
      false
    );
    // …and it dispatches: the outer call compares two `list<string>` elements
    // through the very same conditional edge.
    expect(value(ce, 'compare([["a"],["b"]], [["a"],["c"]])')).toBe('"="');
  });

  test('a SELF-REFERENTIAL conditional conformance terminates on a recursive type', () => {
    const ce = engineFor(
      COMPARABLE,
      'type alias tree = list<tree>',
      `type list<T> is Comparable where T is Comparable {
         function compare(self: list<T>, other: list<T>) -> string { "=" }
       }`
    );
    const conformsTo = ce._typeResolver.conformsTo!;
    // `tree = list<tree>` asks the same question of itself; the in-flight guard
    // answers `false` on re-entry rather than recursing forever.
    expect(conformsTo(ce.type('tree').type, 'Comparable')).toBe(false);
    // The guard is not sticky: an ordinary question still answers afterwards.
    expect(conformsTo(ce.type('list<never>').type, 'Comparable')).toBe(true);
  });
});

describe('one conformance per (head, protocol)', () => {
  test('a SECOND conditional conformance on the same head is refused', () => {
    const ce = engineFor(COMPARABLE);
    expect(
      declarationError(ce, 'type list<T> is Comparable where T is Comparable')
    ).toBeNull();
    expect(
      declarationError(ce, 'type list<U> is Comparable where U')
    ).toBe('protocol-conformance-overlap');
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
  });

  test('conditional THEN unconditional on the same head is refused', () => {
    const ce = engineFor(COMPARABLE);
    expect(
      declarationError(ce, 'type list<T> is Comparable where T is Comparable')
    ).toBeNull();
    expect(declarationError(ce, 'type list<string> is Comparable')).toBe(
      'protocol-conformance-overlap'
    );
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
  });

  test('unconditional THEN conditional on the same head is refused', () => {
    const ce = engineFor(COMPARABLE);
    expect(declarationError(ce, 'type list<string> is Comparable')).toBeNull();
    expect(
      declarationError(ce, 'type list<T> is Comparable where T is Comparable')
    ).toBe('protocol-conformance-overlap');
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
  });

  test('the message is `protocol-conformance-overlap`', () => {
    const ce = engineFor(COMPARABLE, 'type list<string> is Comparable');
    const result = ce
      .box([
        'DeclareConformance',
        { str: 'list<T>' },
        ['List', 'Comparable'],
        { str: 'where T' },
      ] as any)
      .evaluate();
    expect(result.toString()).toContain('protocol-conformance-overlap');
  });

  test('a DIFFERENT head is fine', () => {
    const ce = engineFor(
      COMPARABLE,
      'type list<T> is Comparable where T is Comparable',
      'type set<T> is Comparable where T is Comparable',
      'type string is Comparable'
    );
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(3);
  });

  test('re-running the identical statement is a NO-OP', () => {
    const ce = engineFor(COMPARABLE);
    const stmt = 'type list<T> is Comparable where T is Comparable';
    expect(declarationError(ce, stmt)).toBeNull();
    expect(declarationError(ce, stmt)).toBeNull();
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
  });
});

describe('the clause', () => {
  test('an ELIDED bound (`where T`) is legal — every instantiation conforms', () => {
    const ce = engineFor(
      COMPARABLE,
      `type list<T> is Comparable where T {
         function compare(self: list<T>, other: list<T>) -> string { "=" }
       }`
    );
    const edge = conditionalEdge(ce, 'Comparable')!;
    expect(edge.targetKey).toBe('list<T> where T');
    expect(edge.where).toEqual([{ name: 'T' }]);
    // Unconstrained: a list of anything conforms.
    expect(value(ce, 'compare([1,2],[3,4])')).toBe('"="');
    expect(value(ce, 'compare(["a"],["b"])')).toBe('"="');
  });

  test('a BOUND (`where T: number`) restricts the instantiations', () => {
    const ce = engineFor(
      COMPARABLE,
      `type list<T> is Comparable where T: number {
         function compare(self: list<T>, other: list<T>) -> string { "=" }
       }`
    );
    expect(conditionalEdge(ce, 'Comparable')!.targetKey).toBe(
      'list<T> where T: number'
    );
    expect(value(ce, 'compare([1,2],[3,4])')).toBe('"="');
    expect(value(ce, 'compare(["a"],["b"])')).toContain(
      'protocol-implementation-missing'
    );
  });

  test('a head variable the clause does not bind is an error', () => {
    const ce = engineFor(COMPARABLE);
    expect(declarationError(ce, 'type list<U> is Comparable where T')).toBe(
      'protocol-conformance-target-invalid'
    );
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(0);
  });

  test('a clause variable the head never mentions is an error', () => {
    const ce = engineFor(COMPARABLE);
    expect(
      declarationError(ce, 'type list<string> is Comparable where T')
    ).toBe('protocol-conformance-target-invalid');
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(0);
  });

  test('a bound written in the HEAD is steered to the clause', () => {
    const [, diagnostics] = parseEpsil(
      'type list<T: number> is Comparable',
      undefined,
      { protocolNames: ['Comparable'] }
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[0]).toBe('type-annotation-error');
    expect(String(diagnostics[0].message[1])).toContain('where T: <bound>');
  });

  test('a BARE variable head is refused (no constructor to dispatch on)', () => {
    const ce = engineFor(COMPARABLE);
    expect(declarationError(ce, 'type T is Comparable where T')).toBe(
      'protocol-conformance-target-invalid'
    );
  });
});

describe('implementation validation (P17) with the head variables in scope', () => {
  const conform = (impl: string): string | null => {
    const ce = engineFor(COMPARABLE);
    return declarationError(
      ce,
      `type list<T> is Comparable where T {\n  ${impl}\n}`
    );
  };

  test('a member signature MAY mention the head variables', () => {
    expect(
      conform('function compare(self: list<T>, other: list<T>) -> string { "=" }')
    ).toBeNull();
  });

  test('…and `Self` is the head pattern, so a wrong one is a mismatch', () => {
    // The quantified parameters are ERASED at lowering, so the declared types
    // are recovered from the marker signature — otherwise they would read as
    // `any` and every annotation would be accepted.
    expect(
      conform('function compare(self: list<T>, other: set<T>) -> string { "=" }')
    ).toBe('protocol-signature-mismatch');
    expect(
      conform('function compare(self: list<T>, other: integer) -> string { "=" }')
    ).toBe('protocol-signature-mismatch');
    expect(
      conform(
        'function compare(self: list<T>, other: list<T>) -> integer { 1 }'
      )
    ).toBe('protocol-signature-mismatch');
    expect(conform('function compare(self: list<T>) -> string { "=" }')).toBe(
      'protocol-signature-mismatch'
    );
  });

  test('the diagnostic spells `Self` as the HEAD pattern, not the target key', () => {
    const ce = engineFor(COMPARABLE);
    const text = executeEpsil(
      ce,
      'type list<T> is Comparable where T {\n  function compare(self: list<T>, other: integer) -> string { "=" }\n}'
    ).value.toString();
    expect(text).toContain('Self = list<T>');
    expect(text).not.toContain('Self = list<T> where');
  });

  test('an unknown member is still refused', () => {
    expect(
      conform('function compaer(self: list<T>, other: list<T>) -> string { "=" }')
    ).toBe('protocol-member-unknown');
  });
});

describe('a COVARIANT position is checked at the head PATTERN', () => {
  // The widest instantiation is sound for the contravariant positions only. A
  // `clone(self: Self) -> Self` requirement on `list<T> where T: number` was
  // validated at `Self = list<number>`, so an implementation declaring
  // `-> list<number>` passed — while dispatch at a `list<integer>` receiver
  // types the call `list<integer>`. Against the pattern (`T` opaque), a result
  // must match the head up to the clause binding.
  const COPYABLE = `protocol Copyable {
  function clone(self: Self) -> Self
}`;
  const clone = (result: string): string | null => {
    const ce = engineFor(COPYABLE);
    return declarationError(
      ce,
      `type list<T> is Copyable where T: number {
         function clone(self: list<T>) -> ${result} { self }
       }`
    );
  };

  test('the widened GROUND type is refused', () => {
    expect(clone('list<number>')).toBe('protocol-signature-mismatch');
    expect(clone('list<integer>')).toBe('protocol-signature-mismatch');
    expect(clone('string')).toBe('protocol-signature-mismatch');
  });

  test('the head pattern — and `Self`, its synonym — is accepted', () => {
    expect(clone('list<T>')).toBeNull();
    expect(clone('Self')).toBeNull();
  });

  test('a GROUND requirement result is unaffected', () => {
    // Nothing to preserve: `-> string` mentions neither `Self` nor a clause
    // variable, so the pattern reading is the ordinary one.
    const ce = engineFor(COMPARABLE);
    expect(
      declarationError(
        ce,
        `type list<T> is Comparable where T {
           function compare(self: list<T>, other: list<T>) -> string { "=" }
         }`
      )
    ).toBeNull();
  });

  test('a PARAMETER may still widen to the bound (contravariance)', () => {
    // The pattern applies to the covariant positions only: an implementation
    // accepting `list<number>` accepts every instantiation of the clause.
    const ce = engineFor(COPYABLE);
    expect(
      declarationError(
        ce,
        `type list<T> is Copyable where T: number {
           function clone(self: list<number>) -> Self { self }
         }`
      )
    ).toBeNull();
  });
});

describe('a NAMED-tuple head matches its field names', () => {
  // `matchHead` compared tuple elements positionally, by type only, so a head
  // `tuple<a: T, b: T>` matched a `tuple<x: string, y: string>` receiver. Two
  // DIFFERENT defined names describe different values — the rule `subtype.ts`'s
  // `couldMatch` applies.
  const setup = (): ComputeEngine => {
    const ce = new ComputeEngine();
    expect(run(ce, COMPARABLE)).toEqual([]);
    expect(
      run(ce, 'type list<tuple<a: T, b: T>> is Comparable where T').filter(
        (c) => c !== 'protocol-implementation-pending'
      )
    ).toEqual([]);
    return ce;
  };

  test('the SAME names match, and different ones do not', () => {
    const ce = setup();
    const conforms = (t: string): boolean =>
      ce._typeResolver.conformsTo!(ce.type(t).type, 'Comparable');
    expect(conforms('list<tuple<a: string, b: string>>')).toBe(true);
    expect(conforms('list<tuple<x: string, y: string>>')).toBe(false);
    expect(conforms('list<tuple<a: string, x: string>>')).toBe(false);
  });

  test('an UNNAMED element still matches (a name is erasable)', () => {
    const ce = setup();
    expect(
      ce._typeResolver.conformsTo!(
        ce.type('list<tuple<string, string>>').type,
        'Comparable'
      )
    ).toBe(true);
  });
});

describe('a `where T is P` CALL-SITE constraint sees conditional conformance', () => {
  const setup = (): ComputeEngine =>
    engineFor(COMPARABLE, STRING_IS_COMPARABLE, LIST_IS_COMPARABLE);

  // The bound keeps `T` off the broadcast path, so it solves to the LIST rather
  // than to its elements — which is what puts the conditional edge on trial.
  const SORT =
    'function sorted(xs: T) -> integer where T: collection is Comparable { 1 }';

  test('is satisfied by a conditionally conforming argument', () => {
    const ce = setup();
    expect(run(ce, SORT)).toEqual([]);
    expect(value(ce, 'sorted(["a","b"])')).toBe('1');
  });

  test('and refused by a non-conforming instantiation', () => {
    const ce = setup();
    expect(run(ce, SORT)).toEqual([]);
    expect(value(ce, 'sorted([1,2])')).toContain(
      'protocol-constraint-unsatisfied'
    );
  });
});

describe('pending semantics', () => {
  test('an impl-LESS conditional edge is pending, and warns every batch', () => {
    const ce = engineFor(COMPARABLE);
    expect(run(ce, 'type list<T> is Comparable where T')).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(conditionalEdge(ce, 'Comparable')!.pending).toBe(true);
    // Re-reported EVERY batch until it is fulfilled (P3).
    expect(run(ce, '1 + 1')).toEqual(['protocol-implementation-pending']);
  });

  test('…and inherits from an UNCONDITIONAL supertype implementation', () => {
    // Every instantiation of `list<T>` (widest: `list<any>`) is a `collection`,
    // so a fulfilled `collection` edge completes the conditional one.
    const ce = engineFor(
      COMPARABLE,
      `type collection is Comparable {
         function compare(self: Self, other: Self) -> string { "=" }
       }`,
      'type list<T> is Comparable where T'
    );
    expect(conditionalEdge(ce, 'Comparable')!.pending).toBe(false);
  });

  test('a conditional edge with a block is not pending', () => {
    const ce = engineFor(
      COMPARABLE,
      `type list<T> is Comparable where T {
         function compare(self: list<T>, other: list<T>) -> string { "=" }
       }`
    );
    expect(conditionalEdge(ce, 'Comparable')!.pending).toBe(false);
  });
});

describe('specificity', () => {
  test('the conditional edge wins over a wider unconditional one', () => {
    const ce = engineFor(
      COMPARABLE,
      `type collection is Comparable {
         function compare(self: Self, other: Self) -> string { "wide" }
       }`,
      `type list<T> is Comparable where T {
         function compare(self: list<T>, other: list<T>) -> string { "narrow" }
       }`
    );
    expect(value(ce, 'compare(["a"],["b"])')).toBe('"narrow"');
    expect(value(ce, 'compare({1,2},{3,4})')).toBe('"wide"');
  });
});

describe('the box route', () => {
  test('the `where` clause rides as a string operand, on BOTH routes', () => {
    for (const route of ['canonical', 'evaluate'] as const) {
      const ce = engineFor(COMPARABLE, STRING_IS_COMPARABLE);
      const expr = ce.box([
        'DeclareConformance',
        { str: 'list<T>' },
        ['List', 'Comparable'],
        { str: 'where T is Comparable' },
      ] as any);
      if (route === 'evaluate') expr.evaluate();
      const edge = conditionalEdge(ce, 'Comparable')!;
      expect(edge.targetKey).toBe('list<T> where T is Comparable');
    }
  });

  test('a malformed clause is an error VALUE, never a throw', () => {
    const ce = engineFor(COMPARABLE);
    expect(() => {
      const result = ce
        .box([
          'DeclareConformance',
          { str: 'list<T>' },
          ['List', 'Comparable'],
          { str: 'where T: ,' },
        ] as any)
        .evaluate();
      expect(result.toString()).toContain(
        'protocol-conformance-target-invalid'
      );
    }).not.toThrow();
  });

  test('a non-string third operand that is not a dictionary is refused', () => {
    const ce = engineFor(COMPARABLE);
    const result = ce
      .box([
        'DeclareConformance',
        { str: 'list<T>' },
        ['List', 'Comparable'],
        ['List', 1],
        ['Dictionary'],
      ] as any)
      .evaluate();
    expect(result.toString()).toContain('invalid-protocol-declaration');
  });
});

describe('serializer round trip', () => {
  test('a conditional conformance with an implementation block', () => {
    const source = `type list<T> is Comparable where T is Comparable {
  function compare(self: list<T>, other: list<T>) -> string {"="}
}`;
    const [ast, diagnostics] = parseEpsil(source, undefined, {
      protocolNames: ['Comparable'],
    });
    expect(diagnostics).toEqual([]);
    expect(serializeEpsil(ast)).toBe(source);
  });

  test('a bare conditional conformance', () => {
    const source = 'type list<T> is Comparable where T';
    const [ast, diagnostics] = parseEpsil(source, undefined, {
      protocolNames: ['Comparable'],
    });
    expect(diagnostics).toEqual([]);
    expect(serializeEpsil(ast)).toBe(source);
  });
});

describe('`protocol-in-type-position` on the Epsil route', () => {
  test('a protocol name in an annotation is reported as such', () => {
    const ce = engineFor(COMPARABLE);
    const diagnostics = executeEpsil(
      ce,
      'function f(x: Comparable) -> boolean { true }'
    ).diagnostics;
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['protocol-in-type-position', 'Comparable'],
    ]);
  });

  test('…including a protocol declared in the SAME batch', () => {
    const ce = new ComputeEngine();
    const diagnostics = executeEpsil(
      ce,
      `${COMPARABLE}\nfunction f(x: Comparable) -> boolean { true }`
    ).diagnostics;
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['protocol-in-type-position', 'Comparable'],
    ]);
  });

  test('a genuinely unknown name keeps its `type-annotation-error`', () => {
    const ce = engineFor(COMPARABLE);
    const diagnostics = executeEpsil(
      ce,
      'function f(x: Bogus) -> boolean { true }'
    ).diagnostics;
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['type-annotation-error', 'Unknown type "Bogus"'],
    ]);
  });

  test('a protocol name is NOT a type name', () => {
    const ce = engineFor(COMPARABLE);
    expect(ce._typeResolver.names).not.toContain('Comparable');
    const [, diagnostics] = parseEpsil('let x: Comparable = 1', undefined, {
      typeNames: [],
      protocolNames: ['Comparable'],
    });
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'protocol-in-type-position',
    ]);
  });
});
