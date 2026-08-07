import { ComputeEngine } from '../../src/compute-engine';
import { couldMatch, isSubtype } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';
import { resolveTypeForCompilation } from '../../src/common/type/utils';
import { typeToString } from '../../src/common/type/serialize';
import { clauseListing } from '../../src/compute-engine/multi-clause';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// RULE U — a type variable may occur in a UNION arm.
//
// The rank-1 generics fragment originally forbade every union position
// (`docs/plans/2026-08-01-type-variables-design.md` §3, "bespoke inference
// rules… future work"). The restriction was a fence, not a soundness result:
// every consumer of a type already handles unions, and the only gap was the
// solver's pattern walk. Rule U closes it:
//
//   - a union PATTERN may have at most ONE open arm (`T | U` is unsolvable by
//     construction and is rejected at declaration);
//   - when a GROUND arm accepts the actual, the value took that branch and the
//     operand says nothing about the variable: it contributes `never`, the
//     neutral element of the bound join (so `opt(Missing)` is an `opt<never>`,
//     the bottom of the family);
//   - otherwise the value took the open arm, and that arm's refutation is the
//     union's (`list<T> | string` really does refute a `set<integer>`).
//
// Intersections and negations stay rejected — an intersection because what an
// author means by `T & number` is a BOUND, and the diagnostic says so.
//

/** The type-variable error code carried by the thrown error's message. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const m = message.match(
      /(unresolved-type-variable|unsolvable-type-variable|unsupported-variable-position)/
    );
    return m ? m[1] : `(no code) ${message.replace(/\s+/g, ' ').trim()}`;
  }
  return '(did not throw)';
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e instanceof Error ? e.message : String(e))
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '(did not throw)';
}

/** Run `f`, counting FAILED `console.assert` calls (the ground-type invariant
 * is enforced by exactly those asserts). */
function countAssertFailures(f: () => void): number {
  let n = 0;
  const saved = console.assert;
  console.assert = ((condition: unknown) => {
    if (!condition) n += 1;
  }) as typeof console.assert;
  try {
    f();
  } finally {
    console.assert = saved;
  }
  return n;
}

/** `type opt<T> = T | missing` — the flagship union body. */
function optEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('opt', 'T | missing', { typeParams: ['T'] });
  return ce;
}

function signatureOf(ce: ComputeEngine, name: string): string {
  const def = ce.lookupDefinition(name) as any;
  return def?.operator?.signature?.toString() ?? 'NONE';
}

describe('RULE U — `type opt<T> = T | missing`', () => {
  test('the minted constructor is quantified over the union body', () => {
    expect(signatureOf(optEngine(), 'opt')).toBe(
      'forall T. (T | missing) -> opt<T>'
    );
  });

  test('a value operand solves T through the open arm', () => {
    const ce = optEngine();
    const t = ce.box(['opt', 1]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('opt<finite_integer>');
  });

  test('the MISSING value takes the ground arm and solves T = never', () => {
    // The ruled bottom-of-the-family answer: nothing about `T` was observed,
    // and `never` is the neutral element of the bound join.
    const ce = optEngine();
    expect(ce.box(['opt', 'Missing']).type.toString()).toBe('opt<never>');
  });

  test('the subtype triple under the verified-out default', () => {
    const ce = optEngine();
    const t = (s: string) => ce.type(s).type;
    expect(isSubtype(t('opt<finite_integer>'), t('opt<number>'))).toBe(true);
    expect(isSubtype(t('opt<number>'), t('opt<finite_integer>'))).toBe(false);
    expect(isSubtype(t('opt<never>'), t('opt<integer>'))).toBe(true);
  });

  test('a UNION actual distributes and joins with the ground arm´s `never`', () => {
    // `integer` matches the open arm (T ≥ integer); `missing` matches the
    // ground arm (T ≥ never). `never` is neutral, so the join is `integer`.
    const ce = optEngine();
    ce.declare('m', 'integer | missing');
    expect(ce.box(['opt', 'm']).type.toString()).toBe('opt<integer>');
  });

  test('a top-typed operand still absorbs (the D8 waiver survives the arm descent)', () => {
    const ce = optEngine();
    ce.declare('u', 'unknown');
    expect(ce.box(['opt', 'u']).type.toString()).toBe('opt<unknown>');
  });
});

describe('RULE U — a union nested in a body', () => {
  test('`type bag<T> = tuple<d: T | string>` constructs and reads back', () => {
    const ce = new ComputeEngine();
    ce.declareType('bag', 'tuple<d: T | string>', { typeParams: ['T'] });
    expect(signatureOf(ce, 'bag')).toBe('forall T. (d: T | string) -> bag<T>');
    const b = ce.box(['bag', 1]);
    expect(b.isValid).toBe(true);
    expect(b.type.toString()).toBe('bag<finite_integer>');
    expect(ce.box(['Field', b, { str: 'd' }]).type.toString()).toBe(
      'finite_integer | string'
    );
  });
});

describe('RULE U — refutation propagates out of the open arm', () => {
  test('`list<T> | string` refutes a `set<integer>`', () => {
    const ce = new ComputeEngine();
    ce.declareType('lu', 'list<T> | string', { typeParams: ['T'] });
    ce.declare('s', 'set<integer>');
    expect(ce.box(['lu', 's']).isValid).toBe(false);
    // …while both arms' own inhabitants are accepted.
    expect(ce.box(['lu', ['List', 1, 2]]).type.toString()).toBe(
      'lu<finite_integer>'
    );
    expect(ce.box(['lu', { str: 'abc' }]).type.toString()).toBe('lu<never>');
  });
});

describe('RULE U — a declared BOUND still binds through the arm', () => {
  test('a `string` operand of `forall T: number. (T | missing) -> …` fails', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'forall T: number. (T | missing) -> list<T>');
    const bad = ce.box(['f', { str: 'abc' }]);
    expect(bad.isValid).toBe(false);
    // The instantiated parameter names the whole union, not just the arm.
    expect(JSON.stringify(bad.json)).toContain('missing | number');
    // …and an in-bound operand solves normally.
    expect(ce.box(['f', 2]).type.toString()).toBe('list<finite_integer>');
  });
});

describe('RULE U — declaration-time validation', () => {
  const ce = new ComputeEngine();

  test('TWO open arms are rejected — unsolvable by construction', () => {
    expect(codeOf(() => ce.type('forall T, U. (T | U) -> tuple<T, U>'))).toBe(
      'unsupported-variable-position'
    );
    expect(
      messageOf(() => ce.type('forall T, U. (T | U) -> tuple<T, U>'))
    ).toContain(
      'At most one arm of a union can refer to a type variable, but `T | U` has 2'
    );
    // Two arms that are OPEN in the same variable are just as unsolvable.
    expect(
      codeOf(() => ce.type('forall T. (list<T> | set<T>) -> T'))
    ).toBe('unsupported-variable-position');
  });

  test('an INTERSECTION stays rejected, steering to a bound', () => {
    expect(codeOf(() => ce.type('forall T. (T & number) -> T'))).toBe(
      'unsupported-variable-position'
    );
    expect(messageOf(() => ce.type('forall T. (T & number) -> T'))).toContain(
      'The type variable `T` cannot appear in an intersection. To constrain a ' +
        'type variable, declare a bound on it instead: `forall T: number.`'
    );
  });

  test('a NEGATION stays rejected', () => {
    expect(codeOf(() => ce.type('forall T. (!T) -> T'))).toBe(
      'unsupported-variable-position'
    );
    expect(messageOf(() => ce.type('forall T. (!T) -> T'))).toContain(
      'The type variable `T` cannot appear in a negation'
    );
  });

  test('a union arm no longer poisons what it contains', () => {
    // The pin this test replaces read the other way: a nested arrow reached
    // through a union arm used to be a forbidden position because v1 had no
    // inference rule for it. Rule U supplies one.
    expect(
      ce.type('forall T. (((T) -> T) | string) -> T').isPolymorphic
    ).toBe(true);
    expect(
      ce.type('forall T. ((integer) -> (T | string)) -> T').isPolymorphic
    ).toBe(true);
  });
});

describe('RULE U — variance analysis reaches through the union', () => {
  test('`((T) -> nothing) | missing` is a variance violation naming the occurrence', () => {
    const ce = new ComputeEngine();
    const message = messageOf(() =>
      ce.declareType('h', '((T) -> nothing) | missing', { typeParams: ['T'] })
    );
    expect(message).toContain('variance-violation');
    expect(message).toContain('parameter `T` of `h` is covariant');
    expect(message).toContain('(arg 1)');
  });

  test('the same body under an `in` marker verifies', () => {
    const ce = new ComputeEngine();
    ce.declareType('h', '((T) -> nothing) | missing', {
      typeParams: ['in T'],
    });
    expect(ce.type('h<integer>').toString()).toBe('h<integer>');
  });
});

describe('RULE U — the consumers', () => {
  test('`couldMatch` no longer refuses a union-carrying polytype', () => {
    expect(
      couldMatch(
        parseType('forall T. (T | missing) -> list<T>')!,
        parseType('(finite_integer) -> list<finite_integer>')!
      )
    ).toBe(true);
  });

  test('a union polytype round-trips through parse and serialize', () => {
    const ce = optEngine();
    expect(ce.type('forall T. (T | missing) -> opt<T>').toString()).toBe(
      'forall T. (T | missing) -> opt<T>'
    );
    expect(ce.type('forall T. (list<T | string>) -> T').toString()).toBe(
      'forall T. (list<T | string>) -> T'
    );
  });

  test('compilation erases `opt<integer>` to its instantiated union body', () => {
    const ce = optEngine();
    expect(
      typeToString(resolveTypeForCompilation(ce.type('opt<integer>').type))
    ).toBe('integer | missing');
  });

  test('the tag still erases at the value level', () => {
    const ce = optEngine();
    expect(ce.box(['opt', 1]).evaluate().json).toEqual(['opt', 1]);
  });
});

describe('RULE U — R2: the ground-inputs contract of the overlap check', () => {
  function clause(
    ce: ComputeEngine,
    name: string,
    fn: MathJsonExpression
  ): MathJsonExpression {
    return ce.box(['DefineFunction', name, fn]).evaluate().json;
  }

  test('a GENERIC clause never enters a clause set, so `tieOverlaps` never sees an open union', () => {
    // `tieOverlaps` reads RAW clause parameter types and hands them to
    // `provablyDisjoint`, whose ground-input requirement is guarded only by a
    // production-stripped `console.assert`. Rule U cannot leak an open union
    // there because the generic-clause gate refuses the combination outright,
    // in BOTH directions.
    const ce = new ComputeEngine();
    clause(ce, 'k', [
      'Function',
      { str: 'a' },
      ['Typed', 'x', { str: 'list<integer>' }],
    ]);
    expect(
      JSON.stringify(
        clause(ce, 'k', [
          'Function',
          { str: 'b' },
          { str: 'forall T. (x: T | missing) -> string' },
        ])
      )
    ).toContain('generic-clause-unsupported');

    const ce2 = new ComputeEngine();
    clause(ce2, 'g', [
      'Function',
      { str: 'a' },
      { str: 'forall T. (x: T | missing) -> string' },
    ]);
    expect(
      JSON.stringify(
        clause(ce2, 'g', [
          'Function',
          { str: 'b' },
          ['Typed', 'x', { str: 'list<integer>' }],
        ])
      )
    ).toContain('generic-clause-unsupported');
  });

  test('a clause set over the RESOLVED (ground) union lists with no assert', () => {
    const ce = optEngine();
    clause(ce, 'h', [
      'Function',
      { str: 'a' },
      ['Typed', 'x', { str: 'opt<integer>' }],
    ]);
    clause(ce, 'h', [
      'Function',
      { str: 'b' },
      ['Typed', 'x', { str: 'list<integer>' }],
    ]);
    let listing: string[] | undefined;
    expect(countAssertFailures(() => (listing = clauseListing(ce, 'h')))).toBe(
      0
    );
    expect(listing).toHaveLength(2);
  });

  test('an open union answers `provablyDisjoint` exactly as an open bare variable does', () => {
    // The one route that DOES hand `provablyDisjoint` a raw polytype parameter
    // is `candidateParamsAt` (box.ts), reached when a free-variable operand
    // fails validation. Rule U must not make that route any leakier — and must
    // keep its conservative answer (the operand is DEFERRED, not refuted).
    const ce = new ComputeEngine();
    ce.declare('f', 'forall T: number. (T | missing) -> list<T>');
    ce.declare('g', 'forall T: number. (T) -> list<T>');
    ce.declare('s', 'string');
    // Both probes run UNDER the spy: the leak is pre-existing (it is the raw
    // polytype parameter, not the union, that is open), and letting it print
    // would be noise in every run.
    let unionValid = false;
    let bareValid = false;
    const union = countAssertFailures(() => {
      unionValid = ce.box(['f', 's']).isValid;
    });
    const bare = countAssertFailures(() => {
      bareValid = ce.box(['g', 's']).isValid;
    });
    expect(union).toBe(bare);
    expect(unionValid).toBe(bareValid);
  });
});
