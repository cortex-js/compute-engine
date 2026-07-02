import { engine as ce } from '../utils';

// Regression tests for the CORRECTNESS_FINDINGS.md P2 "Round-trips" (#1-5) and
// "Parse / serialize" (#6-10) clusters. Each block references its finding
// number. Fixes live in src/compute-engine/latex-syntax/** and
// boxed-expression/serialize.ts.

describe('P2 round-trips: toMathJson exclude for number literals (#1)', () => {
  // `toMathJson({ exclude })` used to be a no-op for number literals: the
  // exact-value serialization hardcoded `Rational`/`Sqrt`. It now honors the
  // exclusion, mirroring the (already working) function-head behavior. The
  // default `.json` / `toMathJson()` output is unchanged.

  test('default output is unchanged (Rational)', () => {
    expect(ce.box(['Rational', 1, 2]).toMathJson()).toEqual(['Rational', 1, 2]);
    expect(ce.box(['Rational', 1, 2]).json).toEqual(['Rational', 1, 2]);
  });

  test('exclude Rational → Divide', () => {
    expect(ce.box(['Rational', 1, 2]).toMathJson({ exclude: ['Rational'] })).toEqual(
      ['Divide', 1, 2]
    );
    expect(ce.box(['Rational', 2, 3]).toMathJson({ exclude: ['Rational'] })).toEqual(
      ['Divide', 2, 3]
    );
  });

  test('exclude Sqrt → Power(r, 1/2)', () => {
    const sqrt2 = ce.parse('\\sqrt{2}').evaluate();
    expect(sqrt2.toMathJson()).toEqual(['Sqrt', 2]);
    expect(sqrt2.toMathJson({ exclude: ['Sqrt'] })).toEqual([
      'Power',
      2,
      ['Rational', 1, 2],
    ]);
  });

  test('exclude Sqrt inside a radical/rational combination', () => {
    const v = ce.parse('\\frac{\\sqrt{3}}{2}').evaluate();
    expect(v.toMathJson()).toEqual(['Divide', ['Sqrt', 3], 2]);
    expect(v.toMathJson({ exclude: ['Sqrt'] })).toEqual([
      'Divide',
      ['Power', 3, ['Rational', 1, 2]],
      2,
    ]);
  });

  test('exclude both Sqrt and Rational', () => {
    const v = ce.parse('\\frac{2\\sqrt{3}}{3}').evaluate();
    expect(v.toMathJson({ exclude: ['Sqrt', 'Rational'] })).toEqual([
      'Multiply',
      ['Divide', 2, 3],
      ['Power', 3, ['Divide', 1, 2]],
    ]);
  });
});

describe('P2 round-trips: exact large power LaTeX (#2)', () => {
  // `.latex` of `1e300` is the compact `10^{300}`, which re-parses as
  // `Power(10, 300)` rather than a single number literal. That is accepted
  // behavior: there is no compact LaTeX literal for such a magnitude, and the
  // *value* round-trips through evaluation.
  test('latex is compact 10^{300}', () => {
    expect(ce.box(1e300).latex).toBe('10^{300}');
  });
  test('value is preserved through parse + evaluate', () => {
    const roundtrip = ce.parse(ce.box(1e300).latex).N();
    expect(roundtrip.is(ce.box(1e300))).toBe(true);
    expect(roundtrip.re).toBe(1e300);
  });
});

describe('P2 round-trips: negative zero normalizes to +0 (#3)', () => {
  // DESIGN limitation (not a bug to fix): the engine has no distinct negative
  // zero. `box(-0)`, `{num:'-0'}` and `parse('-0.0')` all normalize to +0. The
  // normalization happens in the boxing layer (box.ts / boxed-number). These
  // tests lock the documented behavior so a future accidental change is caught.
  test('box(-0) is +0', () => {
    expect(ce.box(-0).json).toBe(0);
    expect(ce.box(-0).is(0)).toBe(true);
    expect(Object.is(ce.box(-0).re, 0)).toBe(true); // +0, not -0
  });
  test('{num:"-0"} is +0', () => {
    expect(ce.box({ num: '-0' }).json).toBe(0);
  });
  test('parse("-0.0") is +0', () => {
    expect(ce.parse('-0.0').json).toBe(0);
  });
});

describe('P2 parse/serialize: \\binom (#4)', () => {
  test('\\binom{n}{k} → Binomial(n, k)', () => {
    expect(ce.parse('\\binom{n}{k}').json).toEqual(['Binomial', 'n', 'k']);
  });
  test('\\dbinom / \\tbinom variants', () => {
    expect(ce.parse('\\dbinom{n}{k}').json).toEqual(['Binomial', 'n', 'k']);
    expect(ce.parse('\\tbinom{n}{k}').json).toEqual(['Binomial', 'n', 'k']);
  });
  test('Binomial serializes as \\binom and round-trips', () => {
    expect(ce.box(['Binomial', 'n', 'k']).latex).toBe('\\binom{n}{k}');
    expect(ce.parse(ce.box(['Binomial', 'n', 'k']).latex).json).toEqual([
      'Binomial',
      'n',
      'k',
    ]);
  });
  test('\\binom evaluates', () => {
    expect(ce.parse('\\binom{5}{2}').evaluate().json).toBe(10);
  });
});

describe('P2 parse/serialize: set-builder with domain (#6)', () => {
  // `{x \in \R : x > 0}` used to nest the condition inside the domain, as
  // `Set(Element(x, Colon(\R, x>0)))`. `\in` now binds tighter than `:` so the
  // condition attaches to the whole comprehension.
  test('{x \\in \\R : x > 0} attaches the condition to the set', () => {
    expect(ce.parse('\\{x \\in \\R : x>0\\}').json).toEqual([
      'Set',
      ['Element', 'x', 'RealNumbers'],
      ['Condition', ['Greater', 'x', 0]],
    ]);
  });
  test('the \\mid spelling parses the same', () => {
    expect(ce.parse('\\{x \\in \\R \\mid x>0\\}').json).toEqual([
      'Set',
      ['Element', 'x', 'RealNumbers'],
      ['Condition', ['Greater', 'x', 0]],
    ]);
  });
  test('plain {x : x > 0} still works', () => {
    expect(ce.parse('\\{x : x>0\\}').json).toEqual([
      'Set',
      'x',
      ['Condition', ['Greater', 'x', 0]],
    ]);
  });
  test('type annotation and mapping colon are unaffected', () => {
    expect(ce.parse('x : \\R').json).toEqual(['Colon', 'x', 'RealNumbers']);
    expect(ce.parse('f : A \\to B').json).toEqual(['Colon', 'f', ['To', 'A', 'B']]);
  });
});

describe('P2 parse/serialize: double superscript is an error (#7)', () => {
  // `x^2^3` is a "Double superscript" error in LaTeX. It must NOT be gathered
  // into a `List`, which broadcasts to a 2-element list on evaluation.
  test('x^2^3 is a parse error, not a broadcasting List', () => {
    expect(ce.parse('x^2^3').isValid).toBe(false);
    expect(ce.parse('2^3^4').isValid).toBe(false);
  });
  test('the explicit nesting x^{2^3} still works', () => {
    expect(ce.parse('2^{3^4}').evaluate().json).toBe(2 ** 81);
  });
});

describe('P2 parse/serialize: Sequence separator (#8)', () => {
  // A `Sequence` of numbers must not serialize as `1 2` (which re-parses as the
  // number 12). A comma is inserted at digit/digit boundaries.
  test('numeric Sequence round-trips without value corruption', () => {
    const latex = ce.box(['Sequence', 1, 2]).latex;
    expect(latex).toBe('1, 2');
    // Re-parses to a Tuple (same elements), never the single number 12.
    expect(ce.parse(latex).json).toEqual(['Tuple', 1, 2]);
  });
  test('non-numeric Sequence still juxtaposes with a space', () => {
    expect(ce.box(['Sequence', 'x', 'y']).latex).toBe('x y');
  });
});

describe('P2 parse/serialize: Delimiter type stability (#9)', () => {
  // `Delimiter(Sequence(1,2), '[,]')` canonicalizes to a Tuple; it now
  // serializes and re-parses back to a Tuple (type-stable), not a List.
  test('bracket-delimited pair is Tuple-stable', () => {
    const d = ce.box(['Delimiter', ['Sequence', 1, 2], "'[,]'"]);
    expect(d.json).toEqual(['Tuple', 1, 2]);
    expect(ce.parse(d.latex).json).toEqual(['Tuple', 1, 2]);
  });
  test('Tuple round-trips to Tuple', () => {
    expect(ce.parse(ce.box(['Tuple', 1, 2]).latex).json).toEqual(['Tuple', 1, 2]);
  });
});

describe('P2 parse/serialize: ==, !=, unicode operators (#10)', () => {
  test('== parses as Equal and evaluates', () => {
    expect(ce.parse('3==2').json).toEqual(['Equal', 3, 2]);
    expect(ce.parse('3==2').evaluate().json).toBe('False');
    expect(ce.parse('x==y').json).toEqual(['Equal', 'x', 'y']);
  });

  test('!= parses as NotEqual and evaluates (adjacency vs factorial)', () => {
    expect(ce.parse('3!=2').json).toEqual(['NotEqual', 3, 2]);
    expect(ce.parse('3!=2').evaluate().json).toBe('True');
    expect(ce.parse('a!=b').json).toEqual(['NotEqual', 'a', 'b']);
    // A space before `=` keeps `!` as a factorial.
    expect(ce.parse('3! = 6').json).toEqual(['Equal', ['Factorial', 3], 6]);
    expect(ce.parse('n! = 5').json).toEqual(['Equal', ['Factorial', 'n'], 5]);
    // Plain factorial and double factorial are untouched.
    expect(ce.parse('5!').evaluate().json).toBe(120);
    expect(ce.parse('5!!').json).toEqual(['Factorial2', 5]);
  });

  test('Unequal still serializes back to !=', () => {
    expect(ce.box(['Unequal', 3, 2]).latex).toBe('3!=2');
  });

  test('unicode comparison operators parse', () => {
    expect(ce.parse('x ≤ 5').json).toEqual(['LessEqual', 'x', 5]);
    expect(ce.parse('a ≥ b').json).toEqual(['LessEqual', 'b', 'a']);
    expect(ce.parse('a ≠ b').json).toEqual(['NotEqual', 'a', 'b']);
  });

  test('unicode arithmetic operators parse', () => {
    expect(ce.parse('2 × 3').evaluate().json).toBe(6);
    expect(ce.parse('2 · 3').evaluate().json).toBe(6);
    expect(ce.parse('∞').json).toBe('PositiveInfinity');
    expect(ce.parse('√4').evaluate().json).toBe(2);
    expect(ce.parse('√{x+1}').json).toEqual(['Sqrt', ['Add', 'x', 1]]);
  });

  test('unicode vulgar fractions parse', () => {
    expect(ce.parse('½').json).toEqual(['Rational', 1, 2]);
    expect(ce.parse('¼').json).toEqual(['Rational', 1, 4]);
    expect(ce.parse('¾').json).toEqual(['Rational', 3, 4]);
    expect(ce.parse('⅓').json).toEqual(['Rational', 1, 3]);
    expect(ce.parse('⅔').json).toEqual(['Rational', 2, 3]);
  });
});
