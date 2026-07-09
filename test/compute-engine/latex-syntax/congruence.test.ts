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
