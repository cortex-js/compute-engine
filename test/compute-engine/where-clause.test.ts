/**
 * Acceptance tests for the trailing `where` type-constraint clause,
 * which replaced the prefix `forall` syntax
 * (`docs/plans/2026-08-11-where-clause-type-constraints.md`).
 *
 * This file covers the type-parser surface (`parseType`, `parseTypePrefix`,
 * the host API). The Epsil declaration surface (the five declaration
 * spellings, `<T>`-vs-`where`, parameter-annotation comma contexts) is
 * covered by `test/epsil/type-variables-epsil.test.ts`.
 */

import { parseType, parseTypePrefix } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { ComputeEngine } from '../../src/compute-engine';

function roundTrip(s: string): string {
  return typeToString(parseType(s));
}

function parseError(s: string): string {
  try {
    parseType(s);
    return '<no error>';
  } catch (e) {
    return (e as Error).message;
  }
}

describe('WHERE CLAUSE — positive forms', () => {
  test('unbounded variable', () => {
    expect(roundTrip('(T) -> T where T')).toBe('(T) -> T where T');
  });

  test('bounded variable', () => {
    expect(roundTrip('(T) -> T where T: number')).toBe(
      '(T) -> T where T: number'
    );
  });

  test('multiple variables, mixed bounds (per-entry binding)', () => {
    // `where T, U: number` binds T unbounded, U: number — as in Rust.
    expect(roundTrip('(T, U) -> T where T, U: number')).toBe(
      '(T, U) -> T where T, U: number'
    );
  });

  test('swap', () => {
    expect(roundTrip('(tuple<T,U>) -> tuple<U,T> where T, U')).toBe(
      '(tuple<T, U>) -> tuple<U, T> where T, U'
    );
  });

  test('collection bound', () => {
    expect(roundTrip('(T) -> T where T: indexed_collection')).toBe(
      '(T) -> T where T: indexed_collection'
    );
  });

  test('callback-carrying signature', () => {
    expect(
      roundTrip('(list<T>, (T) any -> U) -> list<U> where T, U')
    ).toBe('(list<T>, (T) any -> U) -> list<U> where T, U');
  });

  test('clause after the effects slot', () => {
    expect(roundTrip('(T) random -> T where T')).toBe(
      '(T) random -> T where T'
    );
  });

  test('lowercase and multi-letter variable names', () => {
    expect(roundTrip('(zz) -> zz where zz')).toBe('(zz) -> zz where zz');
  });

  test('signature-typed bound (unbounded right edge)', () => {
    expect(roundTrip('(g: T) -> boolean where T: (real) -> real')).toBe(
      '(g: T) -> boolean where T: (real) -> real'
    );
  });
});

describe('WHERE CLAUSE — `where T` is shorthand for `where T: any`', () => {
  test('explicit `: any` normalizes to the shorthand', () => {
    expect(roundTrip('(T) -> T where T: any')).toBe('(T) -> T where T');
  });

  test('the two spellings build the identical type', () => {
    const a = parseType('(T) -> T where T');
    const b = parseType('(T) -> T where T: any');
    expect(typeToString(a)).toBe(typeToString(b));
  });
});

describe('WHERE CLAUSE — overload sets (per-arm clauses)', () => {
  test('parenthesized per-arm clauses parse', () => {
    expect(
      roundTrip('((list<T>) -> T where T) & ((set<T>) -> boolean where T)')
    ).toBe('((list<T>) -> T where T) & ((set<T>) -> boolean where T)');
  });

  test('unparenthesized clause on an intersection is rejected with the parenthesize-the-arm fix', () => {
    expect(
      parseError('((list<T>) -> T) & ((set<T>) -> boolean) where T')
    ).toMatch(/can only quantify a function signature.*parenthesize/is);
  });
});

describe('WHERE CLAUSE — non-signature targets are rejected', () => {
  test('primitive', () => {
    expect(parseError('number where T')).toMatch(
      /can only quantify a function signature/
    );
  });

  test('union', () => {
    expect(parseError('integer | string where T')).toMatch(
      /can only quantify a function signature/
    );
  });
});

describe('WHERE CLAUSE — nested clauses', () => {
  test('parenthesized nested clause is rejected loudly (W1)', () => {
    expect(
      parseError('record<map: ((A) -> B where A, B), other: number>')
    ).toMatch(/not a nested one/);
  });

  test('unparenthesized nested clause is an error, never a reinterpretation', () => {
    expect(parseError('record<map: (A) -> B where A, B>')).not.toBe(
      '<no error>'
    );
  });
});

describe('WHERE CLAUSE — clause shapes (diagnostics)', () => {
  test('duplicate name', () => {
    expect(parseError('(T) -> T where T, T')).toMatch(
      /declared more than once/
    );
  });

  test('reserved name (`where` itself)', () => {
    expect(parseError('(T) -> T where where')).toMatch(/error|reserved/i);
  });

  test('missing name after where', () => {
    expect(parseError('integer where')).toMatch(
      /Expected a type variable name after `where`/
    );
  });

  test('malformed bound', () => {
    expect(parseError('(T) -> T where T:')).toMatch(
      /Expected a type after the bound/
    );
  });

  test('unused variable', () => {
    expect(parseError('(integer) -> integer where T')).toMatch(
      /quantified but never used/
    );
  });

  test('result-only variable', () => {
    expect(parseError('(integer) -> T where T')).toMatch(
      /occurs only in the result/
    );
  });

  test('unquantified variable is still an error', () => {
    expect(parseError('(T) -> T')).toMatch(/Unknown type "T"/);
  });

  test('variable-referencing bound fails validation (not parsing) with the ground-bound message (W2)', () => {
    expect(parseError('(T) -> U where T: list<U>, U')).toMatch(
      /must be a ground type/
    );
  });

  test('F-bounded self-reference fails the same way', () => {
    expect(parseError('(T, T) -> boolean where T: list<T>')).toMatch(
      /must be a ground type/
    );
  });
});

//
// The `is` protocol-conformance slot (protocols design P19, phase 4). These
// three cases were pinned as `protocol-conformance-unsupported` rejections
// while the slot was inert; they now DECLARE, and the constraint is checked at
// the call site against the engine's conformance registry.
//
// The type layer alone still has no registry to consult, so a RESOLVER-LESS
// parse keeps rejecting the slot rather than silently dropping the constraint.
//
describe('WHERE CLAUSE — the `is` protocol slot', () => {
  /** `type <target> is P₁ & P₂ …` — the conformance statement, box route. */
  function conform(
    ce: ComputeEngine,
    target: string,
    protocols: string[]
  ): void {
    ce.box([
      'DeclareConformance',
      { str: target },
      ['List', ...protocols],
    ] as any).evaluate();
  }

  /** An engine with `Hashable` and `Comparable` declared, `string` conforming
   * to both and `boolean` to neither. */
  function engineWithProtocols(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    ce.declareProtocol('Comparable', {});
    conform(ce, 'string', ['Hashable', 'Comparable']);
    return ce;
  }

  test('bounded form declares and round-trips', () => {
    const ce = engineWithProtocols();
    expect(ce.type('(T) -> T where T: collection is Hashable').toString()).toBe(
      '(T) -> T where T: collection is Hashable'
    );
  });

  test('bound-less `is` form declares and round-trips', () => {
    const ce = engineWithProtocols();
    expect(ce.type('(T) -> T where T is Hashable').toString()).toBe(
      '(T) -> T where T is Hashable'
    );
  });

  test('conjunction of protocols declares and round-trips', () => {
    const ce = engineWithProtocols();
    expect(
      ce
        .type('(xs: list<T>) -> list<T> where T is Comparable & Hashable')
        .toString()
    ).toBe('(xs: list<T>) -> list<T> where T is Comparable & Hashable');
  });

  test('a conforming solved type passes; a non-conforming one does not', () => {
    const ce = engineWithProtocols();
    ce.declare('idOf', { signature: '(T) -> T where T is Hashable' });
    expect(ce.box(['idOf', { str: 'a' }]).isValid).toBe(true);
    expect(ce.box(['idOf', true]).toString()).toContain(
      'protocol-constraint-unsatisfied'
    );
  });

  test('`&` requires EVERY protocol', () => {
    const ce = engineWithProtocols();
    ce.declareProtocol('Countable', {});
    ce.declare('bothOf', {
      signature: '(T) -> T where T is Hashable & Countable',
    });
    expect(ce.box(['bothOf', { str: 'a' }]).toString()).toContain(
      'protocol-constraint-unsatisfied'
    );
    conform(ce, 'string', ['Countable']);
    expect(ce.box(['bothOf', { str: 'a' }]).isValid).toBe(true);
  });

  test('a RESOLVER-LESS parse still refuses the slot', () => {
    expect(parseError('(T) -> T where T: collection is Hashable')).toMatch(
      /protocol-conformance-unsupported/
    );
  });
});

describe('WHERE CLAUSE — legacy `forall` migration diagnostic', () => {
  test('unbounded prefix form', () => {
    expect(parseError('forall T. (T) -> T')).toMatch(
      /replaced by a trailing `where` clause/
    );
  });

  test('bounded prefix form', () => {
    expect(parseError('forall T: number. (T) -> T')).toMatch(
      /replaced by a trailing `where` clause/
    );
  });

  test('multi-variable prefix form', () => {
    expect(parseError('forall T, U. (T, U) -> T')).toMatch(
      /replaced by a trailing `where` clause/
    );
  });

  test('parenthesized (overload-arm) prefix form', () => {
    expect(parseError('(forall T. (list<T>) -> T) & ((set) -> boolean)')).toMatch(
      /replaced by a trailing `where` clause/
    );
  });
});

describe('WHERE CLAUSE — prefix-mode extent', () => {
  test('the token following the clause survives (`= 5`)', () => {
    const source = '(T) -> T where T: number = 5';
    const { end } = parseTypePrefix(source, undefined, undefined, {
      allowWhere: true,
    });
    expect(source.slice(end).trim()).toBe('= 5');
  });

  test('a `{` ends the clause', () => {
    const source = '(T) -> T where T { x }';
    const { end } = parseTypePrefix(source, undefined, undefined, {
      allowWhere: true,
    });
    expect(source.slice(end).trim()).toBe('{ x }');
  });

  test('without allowWhere the parse stops BEFORE the clause', () => {
    const source = '(T) -> T where T, x: number';
    // In a comma-delimited context (allowWhere: false, the default) the
    // clause is not consumed — `T` is then an unknown type, which is the
    // correct failure: the clause belongs to an enclosing construct.
    expect(() => parseTypePrefix(source)).toThrow(/Unknown type "T"/);
  });

  test('allowWhere: false on a ground signature stops before `where`', () => {
    const source = '(integer) -> integer where x: number';
    const { end } = parseTypePrefix(source);
    expect(source.slice(end).trim()).toBe('where x: number');
  });
});

describe('WHERE CLAUSE — host API reserved names (inversion)', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
  });

  test('`where` cannot be declared as a type name', () => {
    expect(() => ce.declareType('where', 'number')).toThrow(
      /reserved/
    );
  });

  test('`forall` is now an ordinary declarable type name', () => {
    expect(() => ce.declareType('forall', 'number')).not.toThrow();
    expect(ce.type('(forall) -> forall').toString()).toBe(
      '(forall) -> forall'
    );
  });
});

describe('WHERE CLAUSE — delayed shadowing (D13, type level)', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.declareType('point', 'tuple<number, number>');
  });

  test('`(point) -> point` alone is the nominal (ground)', () => {
    const t = ce.type('(point) -> point');
    expect(t.isPolymorphic).toBe(false);
    expect(t.toString()).toBe('(point) -> point');
  });

  test('`… where point` makes it the variable (polytype)', () => {
    const t = ce.type('(point) -> point where point');
    expect(t.isPolymorphic).toBe(true);
    expect(t.toString()).toBe('(point) -> point where point');
  });

  test('the polytype matches a ground instance the nominal would reject', () => {
    // With `point` quantified, the signature admits any type at the
    // argument — the identity polytype — so a number instance matches.
    expect(
      ce.type('(number) -> number').matches('(T) -> T where T')
    ).toBe(true);
  });
});

describe('WHERE CLAUSE — serialize → parse → serialize stability', () => {
  const forms = [
    '(T) -> T where T',
    '(T) -> T where T: number',
    '(T, U) -> T where T, U: number',
    '(tuple<T, U>) -> tuple<U, T> where T, U',
    '(T) random -> T where T',
    '((list<T>) -> T where T) & ((set<T>) -> boolean where T)',
    '(collection<T>, predicate: callback<(T) -> boolean>) -> collection where T',
  ];
  for (const f of forms) {
    test(f, () => {
      const once = roundTrip(f);
      expect(roundTrip(once)).toBe(once);
    });
  }
});
