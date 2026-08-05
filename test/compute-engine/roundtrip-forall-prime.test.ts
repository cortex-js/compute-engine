import { ComputeEngine } from '../../src/compute-engine';

/**
 * Serialize→parse round-trip regressions for the classes recorded in
 * `docs/mathnet/roundtrip-exceptions.json`:
 *
 * - `prime-serialization-not-delimited`: `Prime` serialized as an undelimited
 *   `A^\prime`, so a letter immediately after the prime was swallowed into the
 *   command name (`A^\primeC`) and the reparse errored.
 *
 * - `forall-body-not-delimited` / `forall-held-body-not-canonicalized`: the
 *   quantifier body was serialized with no delimiter, and (being a `lazy`
 *   operand) was never canonicalized on the reparse route. The body was
 *   therefore truncated at the first low-precedence connective, and a
 *   parenthesized body came back as `Delimiter(...)` parse sugar.
 *
 * The property under test is the one the corpus lane asserts:
 * `ce.parse(t.latex).isSame(t)` — the structural tier, on the SAME engine.
 */

function roundTrip(src: string): {
  same: boolean;
  serialized: string;
  original: string;
  reparsed: string;
} {
  // A fresh engine per case: the property is same-engine, but symbol type
  // inference leaking between unrelated cases is not what is under test.
  const ce = new ComputeEngine();
  const original = ce.parse(src);
  const serialized = original.latex;
  const reparsed = ce.parse(serialized);
  return {
    same: reparsed.isSame(original),
    serialized,
    original: JSON.stringify(original.json),
    reparsed: JSON.stringify(reparsed.json),
  };
}

describe('PRIME SERIALIZATION IS DELIMITED', () => {
  test('a prime followed by a letter round-trips', () => {
    const r = roundTrip("\\angle BA'C = \\angle BB'C");
    // Before the fix: `(\angle BA^\primeC)=(\angle BB^\primeC)`, whose reparse
    // errored with `unexpected-command '\primeC'`.
    expect(r.serialized).toBe(
      '(\\angle BA^{\\prime}C)=(\\angle BB^{\\prime}C)'
    );
    expect(r.same).toBe(true);
  });

  test('the prime command is braced', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Prime', 'A']).latex).toBe('A^{\\prime}');
    expect(ce.box(['Prime', 'A', 2]).latex).toBe('A^{\\doubleprime}');
    expect(ce.box(['Prime', 'A', 3]).latex).toBe('A^{\\tripleprime}');
  });

  test.each([
    ['prime in isolation', "A'"],
    ['prime followed by a letter', "\\angle BA'C"],
    ['double prime followed by a letter', "\\angle BA''C"],
  ])('round-trips: %s', (_label, src) => {
    expect(roundTrip(src).same).toBe(true);
  });
});

describe('QUANTIFIER BODY IS DELIMITED AND CANONICALIZED', () => {
  test('a conjunction body is not truncated on reparse', () => {
    const r = roundTrip('a_0=9 \\text{ and } a_1=3 \\text{ for all } k \\ge 0');
    expect(r.original).toBe(
      '["ForAll",["LessEqual",0,"k"],["And",["Equal","a_0",9],["Equal","a_1",3]]]'
    );
    // Before the fix: `\forall 0\le k, a_0=9\land a_1=3` (no delimiter).
    expect(r.serialized).toBe('\\forall 0\\le k, (a_0=9\\land a_1=3)');
    // ... which reparsed as `And(a_1=3, ForAll(k>=0, a_0=9))` — the connective
    // reassociated ABOVE the quantifier.
    expect(r.reparsed).toBe(r.original);
    expect(r.same).toBe(true);
  });

  test('a tuple body stays a Tuple on reparse', () => {
    const r = roundTrip('a_0=1, a_1=3 \\text{ for all } n \\ge 1');
    expect(r.original).toBe(
      '["ForAll",["LessEqual",1,"n"],["Tuple",["Equal","a_0",1],["Equal","a_1",3]]]'
    );
    // Before the fix, the reparse was
    // `ForAll(n>=1, Delimiter(Sequence(...)))` — the held body kept its parse
    // sugar because a `lazy` operator with no `canonical` handler never
    // canonicalizes its operands.
    expect(r.reparsed).toBe(r.original);
    expect(r.same).toBe(true);
  });

  test.each([
    ['comparison body (undelimited)', '\\forall x, x>0'],
    ['conjunction body', '\\forall x, a=1\\land b=2'],
    ['disjunction body', '\\forall x, a=1\\lor b=2'],
    ['implication body', '\\forall x, a=1\\implies b=2'],
    ['equivalence body', '\\forall x, a=1\\iff b=2'],
    ['nested quantifier body', '\\forall x, \\exists y, R(x, y)'],
    ['exists with a conjunction body', '\\exists x, a=1\\land b=2'],
    ['not-forall with a conjunction body', '\\lnot\\forall x, a=1\\land b=2'],
    ['not-exists with a conjunction body', '\\lnot\\exists x, a=1\\land b=2'],
    ['quantified condition', '\\forall x\\ge0, a=1\\land b=2'],
    ['element condition', '\\forall x \\in S, P(x)'],
    ['condition with a parenthesized body', '\\forall x>0 (x^2>0)'],
    ['exists, condition with a parenthesized body', '\\exists x>0 (x^2=2)'],
  ])('round-trips: %s', (_label, src) => {
    expect(roundTrip(src).same).toBe(true);
  });

  test('a condition with a parenthesized body is not an implicit product', () => {
    const r = roundTrip('\\forall x>0 (x^2>0)');
    // Before the fix, the group was absorbed into the condition as an
    // invisible operator: `ForAll(x > (0, x^2>0), True)`.
    expect(r.original).toBe(
      '["ForAll",["Less",0,"x"],["Less",0,["Power","x",2]]]'
    );
    // The serializer emits the comma form, which reparses identically.
    expect(r.serialized).toBe('\\forall 0\\lt x, 0\\lt x^2');
    expect(r.reparsed).toBe(r.original);
    expect(r.same).toBe(true);
  });

  test('a comparison body is still serialized without parentheses', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\forall x, x>0').latex).toBe('\\forall x, 0\\lt x');
  });

  test('a parenthesized body sheds its Delimiter parse sugar', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\forall x, (a=1\\land b=2)');
    expect(expr.operator).toBe('ForAll');
    expect(expr.op2.operator).toBe('And');
  });
});
