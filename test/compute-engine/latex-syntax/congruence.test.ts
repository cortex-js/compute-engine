import { ComputeEngine } from '../../../src/compute-engine';

/**
 * Parser-hardening (MathNet corpus) Tier-3 vocabulary:
 *   - Task 4: Unicode operator glyphs (`≡ ∈ ∉ ∪ ∩ ≈`) parsing to the same
 *     heads as their LaTeX-command equivalents.
 *   - Task 5: congruence (`a \equiv b \pmod{n}`, and the parenthesized
 *     `(mod n)` / `(\bmod n)` annotation) reducing via `Mod`, plus a
 *     divisibility relation (`a \mid b`, `a \nmid b`).
 *
 * A fresh engine is used per suite so accumulated free-symbol type inference
 * (which is shared across `parse()` calls on one engine) can't cross-
 * contaminate the assertions.
 */

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

function json(ce: ComputeEngine, s: string): string {
  return JSON.stringify(ce.parse(s).json);
}

function isClean(ce: ComputeEngine, s: string): boolean {
  const expr = ce.parse(s);
  return expr.isValid && !JSON.stringify(expr.json).includes('"Error"');
}

function evalStr(ce: ComputeEngine, s: string): string {
  // Prefer `.symbol` so boolean results read as `True`/`False` (the boxed
  // boolean symbol's `toString()` is the quoted string `"True"`).
  const r = ce.parse(s).evaluate();
  return r.symbol ?? r.toString();
}

describe('MathNet Tier-3 Task 4: Unicode operator glyphs', () => {
  test('≡ (U+2261) parses as equivalence / congruence', () => {
    const ce = freshEngine();
    expect(ce.parse('p ≡ q').json).toEqual(['Equivalent', 'p', 'q']);
    expect(ce.parse('7 ≡ 1 (mod 3)').json).toEqual(['Congruent', 7, 1, 3]);
  });

  test('∈ (U+2208) parses as Element', () => {
    const ce = freshEngine();
    expect(ce.parse('x ∈ S').json).toEqual(['Element', 'x', 'S']);
  });

  test('∉ (U+2209) parses as NotElement', () => {
    const ce = freshEngine();
    expect(ce.parse('x ∉ S').json).toEqual(['NotElement', 'x', 'S']);
  });

  test('∪ (U+222A) parses as Union', () => {
    const ce = freshEngine();
    expect(ce.parse('A ∪ B').json).toEqual(['Union', 'A', 'B']);
  });

  test('∩ (U+2229) parses as Intersection', () => {
    const ce = freshEngine();
    expect(ce.parse('A ∩ B').json).toEqual(['Intersection', 'A', 'B']);
  });

  test('≈ (U+2248) parses as Approx', () => {
    const ce = freshEngine();
    expect(ce.parse('x ≈ y').json).toEqual(['Approx', 'x', 'y']);
  });

  test('Unicode glyphs agree with their LaTeX-command equivalents', () => {
    const ce = freshEngine();
    const pairs: [string, string][] = [
      ['x ∈ S', 'x \\in S'],
      ['A ∪ B', 'A \\cup B'],
      ['A ∩ B', 'A \\cap B'],
      ['x ≈ y', 'x \\approx y'],
    ];
    for (const [uni, cmd] of pairs)
      expect(json(ce, uni)).toEqual(json(ce, cmd));
  });
});

describe('MathNet Tier-3 Task 5: congruence', () => {
  test('braced \\pmod{n} parses to Congruent(a, b, n)', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\equiv b \\pmod{n}').json).toEqual([
      'Congruent',
      'a',
      'b',
      'n',
    ]);
  });

  test('unbraced \\pmod n parses to Congruent(a, b, n)', () => {
    const ce = freshEngine();
    expect(ce.parse('7 \\equiv 2 \\pmod 3').json).toEqual([
      'Congruent',
      7,
      2,
      3,
    ]);
  });

  test('parenthesized (\\bmod n) annotation parses to Congruent', () => {
    const ce = freshEngine();
    expect(
      ce.parse('a^2 + b^2 \\equiv c^2 \\quad(\\bmod 12)').json
    ).toMatchObject(['Congruent', expect.anything(), expect.anything(), 12]);
  });

  test('ASCII (mod n) annotation parses to Congruent', () => {
    const ce = freshEngine();
    expect(ce.parse('n \\equiv 1 (mod 3)').json).toEqual([
      'Congruent',
      'n',
      1,
      3,
    ]);
    expect(ce.parse('n ≡ 1 (mod 32)').json).toEqual(['Congruent', 'n', 1, 32]);
  });

  test('symbolic modulus stays valid (no incompatible-type error)', () => {
    const ce = freshEngine();
    expect(isClean(ce, '2^n \\equiv 1 \\pmod{p^{k+1}}')).toBe(true);
  });

  test('congruence evaluates for concrete integers', () => {
    const ce = freshEngine();
    expect(evalStr(ce, '7 \\equiv 1 (mod 3)')).toBe('True');
    expect(evalStr(ce, '7 \\equiv 2 (mod 3)')).toBe('False');
    expect(evalStr(ce, '7 \\equiv 1 \\pmod{3}')).toBe('True');
  });

  test('congruence stays symbolic for non-integer operands', () => {
    const ce = freshEngine();
    expect(evalStr(ce, 'a \\equiv b \\pmod{n}')).toBe('Congruent(a, b, n)');
  });

  test('congruence round-trips to a \\equiv b \\pmod{n}', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\equiv b \\pmod{n}').latex).toBe('a\\equiv b\\pmod{n}');
  });

  test('bare \\equiv (no modulus) stays Equivalent', () => {
    const ce = freshEngine();
    expect(ce.parse('p \\equiv q').json).toEqual(['Equivalent', 'p', 'q']);
  });

  test('\\equiv followed by a real parenthesized rhs is not mistaken for a modulus', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\equiv (b + c)').json).toEqual([
      'Equivalent',
      'a',
      ['Add', 'b', 'c'],
    ]);
  });
});

describe('MathNet Tier-3 Task 5: bare \\pmod residue annotation', () => {
  test('bare \\pmod after an expression (no \\equiv) is Mod(x, n)', () => {
    const ce = freshEngine();
    expect(ce.parse('1 \\pmod 7').json).toEqual(['Mod', 1, 7]);
  });

  test('bare \\pmod with braces attaches to the preceding operand', () => {
    const ce = freshEngine();
    expect(ce.parse('-811\\pmod{24}').json).toEqual(['Mod', -811, 24]);
  });

  test('bare \\pmod binds tighter than a comma sequence', () => {
    const ce = freshEngine();
    // `0, 1 \pmod 4` → the residue attaches to `1` only, not the whole tuple.
    expect(ce.parse('0, 1 \\pmod 4.').json).toEqual([
      'Tuple',
      0,
      ['Mod', 1, 4],
    ]);
  });

  test('standalone \\pmod (no preceding expression) stays structural', () => {
    const ce = freshEngine();
    // No dividend to attach to: the Mod carries a missing operand rather than
    // deriving a spurious value.
    expect(isClean(ce, '\\pmod{7}')).toBe(false);
    expect(JSON.stringify(ce.parse('\\pmod{7}').json)).toContain('Mod');
  });
});

describe('MathNet Tier-3 Task 5: congruence in an implication chain', () => {
  test('\\implies between two congruences groups as Implies(Congruent, Congruent)', () => {
    const ce = freshEngine();
    // No space between `7` and `\implies` in the source (the reported case).
    expect(
      ce.parse('1+6n\\equiv 4\\pmod 7\\implies n\\equiv 4\\pmod 7').json
    ).toEqual([
      'Implies',
      ['Congruent', ['Add', ['Multiply', 6, 'n'], 1], 4, 7],
      ['Congruent', 'n', 4, 7],
    ]);
  });

  test('\\Rightarrow between two congruences groups as Implies(Congruent, Congruent)', () => {
    const ce = freshEngine();
    expect(
      ce.parse('1+6n\\equiv 4\\pmod 7\\Rightarrow n\\equiv 4\\pmod 7').json
    ).toEqual([
      'Implies',
      ['Congruent', ['Add', ['Multiply', 6, 'n'], 1], 4, 7],
      ['Congruent', 'n', 4, 7],
    ]);
  });

  test('a relation chain ending in a congruence parses without an error', () => {
    const ce = freshEngine();
    expect(isClean(ce, '1492 = 1500-8 \\equiv -8\\pmod{500}')).toBe(true);
    expect(
      isClean(ce, '10\\cdot 901 = 9010 = 9(1001)+1 \\equiv 1\\pmod{1001}')
    ).toBe(true);
  });
});

describe('MathNet Tier-3 Task 5: divisibility', () => {
  test('a \\bmod n parses to Mod(a, n)', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\bmod n').json).toEqual(['Mod', 'a', 'n']);
    expect(evalStr(ce, '26 \\bmod 5')).toBe('1');
  });

  // Tycho item 12: infix `\bmod` binds tighter than `+`/`-` on re-parse, so a
  // `Mod` with a compound (addition-precedence) operand must serialize with
  // that operand parenthesized, or the LaTeX round trip silently changes the
  // expression. Also covers right-associative nesting (`Mod(Mod(a,b),c)`) and
  // confirms juxtaposition/self-delimiting operands stay unparenthesized.
  test('Mod serializes with compound operands parenthesized (round-trips)', () => {
    const ce = freshEngine();
    const roundTrips = (mathjson: any) => {
      const boxed = ce.box(mathjson);
      return JSON.stringify(ce.parse(boxed.latex).json) === JSON.stringify(boxed.json);
    };
    // Compound operands MUST be parenthesized to round-trip.
    expect(ce.box(['Mod', ['Add', 'x', 5], ['Multiply', 2, 'Pi']]).latex).toBe(
      '(x+5)\\bmod2\\pi'
    );
    expect(ce.box(['Mod', 5, ['Add', 'x', 5]]).latex).toBe('5\\bmod(x+5)');
    expect(ce.box(['Mod', ['Subtract', 'x', 5], 2]).latex).toBe('(x-5)\\bmod2');
    // Left-nested Mod is parenthesized (parser is right-associative).
    expect(ce.box(['Mod', ['Mod', 'a', 'b'], 'c']).latex).toBe(
      '(a\\bmod b)\\bmod c'
    );
    // Juxtaposition products, fractions, powers, and negation already re-parse
    // as tight units — they stay unwrapped.
    expect(ce.box(['Mod', ['Multiply', 3, 'k'], ['Multiply', 2, 'Pi']]).latex).toBe(
      '3k\\bmod2\\pi'
    );
    expect(ce.box(['Mod', 'x', 2]).latex).toBe('x\\bmod2');
    for (const c of [
      ['Mod', ['Add', 'x', 5], ['Multiply', 2, 'Pi']],
      ['Mod', 5, ['Add', 'x', 5]],
      ['Mod', ['Subtract', 'x', 5], 2],
      ['Mod', ['Mod', 'a', 'b'], 'c'],
      ['Mod', 'a', ['Mod', 'b', 'c']],
      ['Mod', ['Multiply', 3, 'k'], ['Multiply', 2, 'Pi']],
      ['Mod', ['Negate', 'x'], 2],
      ['Mod', ['Divide', 'a', 'b'], 'c'],
    ]) {
      expect(roundTrips(c)).toBe(true);
    }
  });

  // Tycho item 37: a `Mod` factor in a product (or a power base) must be
  // parenthesized — juxtaposition and superscripts re-parse *tighter* than
  // `\bmod`, so an unparenthesized `Mod` absorbs the adjacent notation into
  // its trailing operand (`Mod(A,2)·Mod(B,2)` → `A\bmod2B\bmod2` re-parsed
  // as `Mod(A, Mod(2B, 2))` = `A mod 0` = NaN).
  test('Mod in a product or power base is parenthesized (round-trips)', () => {
    const ce = freshEngine();
    const roundTrips = (mathjson: any) => {
      const boxed = ce.box(mathjson);
      return JSON.stringify(ce.parse(boxed.latex).json) === JSON.stringify(boxed.json);
    };
    expect(ce.box(['Multiply', ['Mod', 'A', 2], ['Mod', 'B', 2]]).latex).toBe(
      '(A\\bmod2)(B\\bmod2)'
    );
    expect(ce.box(['Multiply', 'x', ['Mod', 'A', 2]]).latex).toBe(
      'x(A\\bmod2)'
    );
    expect(ce.box(['Power', ['Mod', 'A', 2], 'x']).latex).toBe(
      '(A\\bmod2)^{x}'
    );
    for (const c of [
      ['Multiply', ['Mod', 'A', 2], ['Mod', 'B', 2]],
      ['Multiply', 'x', ['Mod', 'A', 2]],
      ['Multiply', 2, ['Mod', 'A', 2]],
      ['Multiply', ['Mod', 'A', 2], ['Mod', 'B', 2], ['Mod', 'C', 2]],
      ['Power', ['Mod', 'A', 2], 2],
      ['Power', ['Mod', 'A', 2], 'x'],
      ['Factorial', ['Mod', 'A', 2]],
    ]) {
      expect(roundTrips(c)).toBe(true);
    }
    // The value survives the round trip (the item-37 repro evaluated to 1
    // before serialization and NaN after).
    const repro = ce.box(['Multiply', ['Mod', 12, 5], ['Mod', 7, 3]]);
    expect(ce.parse(repro.latex).evaluate().json).toEqual(
      repro.evaluate().json
    );
  });

  test('a \\mid b parses to Divides(a, b)', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\mid b').json).toEqual(['Divides', 'a', 'b']);
  });

  test('Divides evaluates for concrete integers', () => {
    const ce = freshEngine();
    // Divides(a, b) is true iff a divides b.
    expect(evalStr(ce, '3 \\mid 6')).toBe('True');
    expect(evalStr(ce, '6 \\mid 3')).toBe('False');
  });

  test('Divides stays symbolic for symbolic operands', () => {
    const ce = freshEngine();
    expect(evalStr(ce, 'a \\mid b')).toBe('Divides(a, b)');
  });

  test('a \\nmid b parses to a non-divisibility relation', () => {
    const ce = freshEngine();
    expect(isClean(ce, 'p \\nmid ab')).toBe(true);
    // Canonicalizes to Not(Divides(...)).
    expect(ce.parse('p \\nmid ab').json).toEqual([
      'Not',
      ['Divides', 'p', ['Multiply', 'a', 'b']],
    ]);
  });

  test('\\nmid evaluates for concrete integers', () => {
    const ce = freshEngine();
    expect(evalStr(ce, '3 \\nmid 6')).toBe('False');
    expect(evalStr(ce, '6 \\nmid 3')).toBe('True');
  });
});

describe('MathNet Tier-3: non-regression guards', () => {
  test('absolute value |x| is unaffected', () => {
    const ce = freshEngine();
    expect(ce.parse('|x|').json).toEqual(['Abs', 'x']);
  });

  test('set-builder {x \\mid x > 0} is unaffected', () => {
    const ce = freshEngine();
    expect(ce.parse('\\{x \\mid x > 0\\}').json).toEqual([
      'Set',
      'x',
      ['Condition', ['Greater', 'x', 0]],
    ]);
  });

  test('logical equivalence \\iff is unaffected', () => {
    const ce = freshEngine();
    expect(ce.parse('p \\iff q').json).toEqual(['Equivalent', 'p', 'q']);
  });
});

describe('Congruence chains and recoveries (2026-07-09 pmod-chain round)', () => {
  test('symbolic modulus: bare `N` devolves to a variable', () => {
    const ce = freshEngine();
    expect(ce.parse('N \\equiv 1 \\pmod k').json).toEqual([
      'Congruent',
      'N',
      1,
      'k',
    ]);
    expect(ce.parse('N\\equiv n\\pmod{100}').json).toEqual([
      'Congruent',
      'N',
      'n',
      100,
    ]);
  });

  test('chained congruence folds to a conjunction over adjacent steps', () => {
    const ce = freshEngine();
    expect(ce.parse('a\\equiv b\\pmod{100}\\equiv c\\pmod{100}').json).toEqual([
      'And',
      ['Congruent', 'a', 'b', 100],
      ['Congruent', 'b', 'c', 100],
    ]);
  });

  test('leading \\equiv recovers with a missing-lhs placeholder', () => {
    const ce = freshEngine();
    expect(ce.parse('\\equiv 7 \\pmod{12}').json).toEqual([
      'Congruent',
      ['Error', "'missing'"],
      7,
      12,
    ]);
  });

  test('NEGATIVE: plain congruences and \\not\\equiv unchanged', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\equiv b \\pmod{7}').json).toEqual([
      'Congruent',
      'a',
      'b',
      7,
    ]);
    expect(ce.parse('p \\equiv q').json).toEqual(['Equivalent', 'p', 'q']);
    expect(ce.parse('2019^8 \\not\\equiv -1 \\pmod{17}').json).toEqual([
      'Not',
      ['Congruent', ['Power', 2019, 8], -1, 17],
    ]);
  });
});
