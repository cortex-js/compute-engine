import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseType } from '../../src/common/type/parse';

//
// The `is` slot of a `where` clause (`docs/TYPE-SYSTEM.md`), whose surface is
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A, "Protocol Constraints".
//
// `where T is Comparable` DECLARES freely (conformance is monotone — the
// protocol and its conformances may arrive in a later cell) and is checked
// where a §5 bound is checked: after S1–S3 have solved every variable, the
// solved binding is substituted and the conformance registry is consulted.
// A failure is `protocol-constraint-unsatisfied` at the CALL SITE.
//
// The type layer has no registry of its own, so the conformance oracle
// reaches it through the `TypeResolver` seam (`conformsTo`). A route with no
// oracle — a bare `parseType()` — keeps refusing the slot rather than
// silently dropping the constraint.
//

const COMPARABLE = `protocol Comparable {
  function compare(self: Self, other: Self) -> string
}`;

/** Run an Epsil program, returning its diagnostic codes. */
function run(ce: ComputeEngine, source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

/** The value of the last statement of an Epsil program, as a string. */
function value(ce: ComputeEngine, source: string): string {
  return String(executeEpsil(ce, source).value);
}

/** The `ErrorCode` of an error value, or `undefined`. */
function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

/** `type <target> is P₁ & P₂ …`, box route. */
function conform(ce: ComputeEngine, target: string, protocols: string[]): void {
  ce.box([
    'DeclareConformance',
    { str: target },
    ['List', ...protocols],
  ] as any).evaluate();
}

describe('P19: the `is` slot declares', () => {
  test('a bare `is` clause parses and round-trips through the engine', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    expect(ce.type('(T) -> T where T is Hashable').toString()).toBe(
      '(T) -> T where T is Hashable'
    );
  });

  test('an UNDECLARED protocol still declares (open world)', () => {
    // Conformance — and the protocol itself — may arrive in a later batch, so
    // the DECLARATION never refuses a name it has not seen.
    const ce = new ComputeEngine();
    expect(ce.type('(T) -> T where T is NotYetDeclared').toString()).toBe(
      '(T) -> T where T is NotYetDeclared'
    );
  });

  test('the bound and the conformance list attach to the VARIABLE', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    expect(ce.type('(T) -> T where T: collection is Hashable').toString()).toBe(
      '(T) -> T where T: collection is Hashable'
    );
  });

  test('a RESOLVER-LESS parse refuses the slot rather than dropping it', () => {
    expect(() => parseType('(T) -> T where T is Hashable')).toThrow(
      /protocol-conformance-unsupported/
    );
  });
});

describe('P19: the constraint is checked at the call site', () => {
  /** An engine with `Comparable` implemented for `string` and a generic
   * `sortOf` constrained by it. */
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    run(
      ce,
      `${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "=" }
}
function sortOf(xs: list<T>) -> list<T> where T is Comparable { xs }`
    );
    return ce;
  }

  test('a CONFORMING solved type passes', () => {
    const ce = engine();
    expect(run(ce, 'sortOf(["b", "a"])')).toEqual([]);
    expect(value(ce, 'sortOf(["b", "a"])')).toBe('["b","a"]');
  });

  test('a NON-conforming one is `protocol-constraint-unsatisfied`', () => {
    const ce = engine();
    const result = value(ce, 'sortOf([1, 2])');
    expect(errorCode(result)).toBe('protocol-constraint-unsatisfied');
    // The message names both the protocol and the type the variable solved to.
    expect(result).toContain('Comparable');
    expect(result).toContain('finite_integer');
  });

  test('conformance registered for a SUPERTYPE answers for its subtypes', () => {
    const ce = new ComputeEngine();
    run(
      ce,
      `${COMPARABLE}
type number is Comparable {
  function compare(self: Self, other: Self) -> string { "=" }
}
function sortOf(xs: list<T>) -> list<T> where T is Comparable { xs }`
    );
    expect(errorCode(value(ce, 'sortOf([1, 2])'))).toBeUndefined();
  });

  test('a constraint added LATER makes the same call succeed', () => {
    // Conformance is monotone: a call rejected in one batch must be accepted
    // in the next once the conforming type is declared.
    const ce = engine();
    expect(errorCode(value(ce, 'sortOf([true, false])'))).toBe(
      'protocol-constraint-unsatisfied'
    );
    conform(ce, 'boolean', ['Comparable']);
    expect(errorCode(value(ce, 'sortOf([true, false])'))).toBeUndefined();
  });
});

describe('P19: `&` is a conjunction of protocols', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    ce.declareProtocol('Countable', {});
    conform(ce, 'string', ['Hashable']);
    ce.declare('bothOf', {
      signature: '(T) -> T where T is Hashable & Countable',
    });
    return ce;
  }

  test('ONE of two protocols is not enough', () => {
    const ce = engine();
    const r = ce.box(['bothOf', { str: 'a' }]).toString();
    expect(r).toContain('protocol-constraint-unsatisfied');
    // The FIRST unmet protocol is the one named — `Hashable` is satisfied.
    expect(r).toContain('Countable');
  });

  test('both conformances admit the call', () => {
    const ce = engine();
    conform(ce, 'string', ['Countable']);
    expect(ce.box(['bothOf', { str: 'a' }]).isValid).toBe(true);
  });
});

describe('P19: an UNDECIDABLE solution passes (open world, P35)', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    conform(ce, 'string', ['Hashable']);
    ce.declare('idOf', { signature: '(T) -> T where T is Hashable' });
    return ce;
  }

  test('a top-typed operand is admitted', () => {
    const ce = engine();
    ce.declare('opaque', { type: 'unknown' });
    expect(ce.box(['idOf', 'opaque']).isValid).toBe(true);
  });

  test('a UNION solution is admitted — some arm may conform', () => {
    const ce = engine();
    ce.declare('mixed', { type: 'string | integer' });
    expect(ce.box(['idOf', 'mixed']).isValid).toBe(true);
  });

  test('…while a settled non-conforming one is refuted', () => {
    const ce = engine();
    ce.declare('n', { type: 'integer' });
    expect(ce.box(['idOf', 'n']).toString()).toContain(
      'protocol-constraint-unsatisfied'
    );
  });

  test('an unknown protocol can never be satisfied by a settled type', () => {
    const ce = new ComputeEngine();
    ce.declare('mystery', { signature: '(T) -> T where T is NotDeclared' });
    expect(ce.box(['mystery', { str: 'a' }]).toString()).toContain(
      'protocol-constraint-unsatisfied'
    );
  });
});

describe('P19: the oracle is PER-ENGINE', () => {
  test('one engine’s conformances do not answer for another’s', () => {
    const a = new ComputeEngine();
    a.declareProtocol('Hashable', {});
    conform(a, 'string', ['Hashable']);
    a.declare('idOf', { signature: '(T) -> T where T is Hashable' });

    const b = new ComputeEngine();
    b.declareProtocol('Hashable', {});
    b.declare('idOf', { signature: '(T) -> T where T is Hashable' });

    expect(a.box(['idOf', { str: 'x' }]).isValid).toBe(true);
    expect(b.box(['idOf', { str: 'x' }]).toString()).toContain(
      'protocol-constraint-unsatisfied'
    );
  });
});

describe('P19: the flipped pins, as working behavior', () => {
  // The three rejections `where-clause.test.ts`, `generic-function-sugar.
  // test.ts` and `type-variables-epsil.test.ts` pinned while the slot was
  // inert, now exercised end to end on the Epsil declaration surface.
  test('`function f(x: T) -> T where T is Hashable` declares and checks', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    conform(ce, 'string', ['Hashable']);
    expect(run(ce, 'function f(x: T) -> T where T is Hashable { x }')).toEqual(
      []
    );
    expect(value(ce, 'f("a")')).toBe('"a"');
    expect(errorCode(value(ce, 'f(1)'))).toBe(
      'protocol-constraint-unsatisfied'
    );
  });

  test('`let f: (T) -> T where T: collection is Hashable` declares', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    expect(run(ce, 'let f: (T) -> T where T: collection is Hashable')).toEqual(
      []
    );
  });

  test('the `is`-with-no-protocol-name parse diagnostic STAYS', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'function f(x: T) -> T where T is { x }')).toEqual([
      'symbol-expected',
    ]);
  });
});

describe('P19: the oracle is the CALLING engine’s', () => {
  // The conformance oracle used to be scavenged off the first operand
  // (`ops.find(…)?.engine`), so an expression boxed under a DIFFERENT engine
  // answered from ITS registry. Every call chain has the calling engine in
  // hand, so the resolver is threaded explicitly.
  test('an operand boxed by another engine is still checked against ours', () => {
    const a = new ComputeEngine();
    a.declareProtocol('Hashable', {});
    conform(a, 'string', ['Hashable']);
    a.declare('idOf', { signature: '(T) -> T where T is Hashable' });

    // `b` knows nothing of `Hashable` — but the call is made on `a`.
    const b = new ComputeEngine();
    const foreign = b.string('x');
    expect(foreign.engine).toBe(b);

    // `idOf` has no body, so the application stays symbolic — what matters is
    // that the constraint was checked against `a`'s registry, not `b`'s.
    const call = a.function('idOf', [foreign]);
    expect(call.toString()).toBe('idOf("x")');
    expect(call.isValid).toBe(true);
  });
});

describe('P40: bottom conforms VACUOUSLY', () => {
  // `never` is a subtype of every conformance target, so scanning the edges
  // made the verdict depend on whether the protocol happened to carry ANY
  // conformance — an order-dependent answer for a variable Rule U grounds at
  // `never` (`T | missing` applied to `missing`). It is now unconditionally
  // true, the vacuity subtyping already grants the bottom type.
  test('the oracle answers `true` with or without conformances', () => {
    const bare = new ComputeEngine();
    bare.declareProtocol('Comparable', {});
    expect(bare._typeResolver.conformsTo!('never', 'Comparable')).toBe(true);

    const conformed = new ComputeEngine();
    conformed.declareProtocol('Comparable', {});
    conform(conformed, 'string', ['Comparable']);
    expect(conformed._typeResolver.conformsTo!('never', 'Comparable')).toBe(
      true
    );
  });

  test('a ground-arm solve of `T | missing` at `missing` passes either way', () => {
    for (const withConformance of [false, true]) {
      const ce = new ComputeEngine();
      ce.declareProtocol('Comparable', {});
      if (withConformance) conform(ce, 'string', ['Comparable']);
      expect(
        run(ce, 'function f(x: T | missing) -> T where T is Comparable { 1 }')
      ).toEqual([]);
      expect(value(ce, 'f(Missing)')).toBe('1');
    }
  });

  test('an unrelated solution still fails the constraint', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', {});
    conform(ce, 'string', ['Comparable']);
    expect(
      run(ce, 'function g(x: T) -> T where T is Comparable { x }')
    ).toEqual([]);
    expect(errorCode(value(ce, 'g(1)'))).toBe(
      'protocol-constraint-unsatisfied'
    );
  });
});
