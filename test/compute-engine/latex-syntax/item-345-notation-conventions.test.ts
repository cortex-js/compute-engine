import { ComputeEngine } from '../../../src/compute-engine';

/**
 * Remaining items from #345, after the power-base bracketing fix
 * (`item-345-power-base-brackets.test.ts`):
 *
 * 1. `Beta`, `Zeta` and `Lb` wrote commands that are not real LaTeX
 *    (`\Beta`, `\Zeta`, `\lb`) for an *applied* call. `\Beta`/`\Zeta` came
 *    from the fallback that spells an unrecognized function head as its
 *    symbol's notation, which for these two names is the capital-Greek-letter
 *    entry in `definitions-symbols.ts` (`Beta`/`Zeta` name both a letter and
 *    a function). `\lb` is a dictionary notation but not a standard LaTeX
 *    command. The conventional spellings — `\mathrm{B}(2, 3)`, `\zeta(3)`,
 *    `\log_2(x)` — are now written instead; all three old spellings still
 *    parse as input, and the bare (unapplied) `Zeta`/`Beta`/`Lb` symbols are
 *    unaffected.
 * 2. A fraction's sign was written inside the numerator or denominator
 *    (`\frac{-1}{2}`, `\frac{x}{-4}`), or, for `Negate` of a fraction, with a
 *    redundant parenthesis (`-(\frac{3}{4})`). `serializeFraction` now pulls
 *    the sign in front (`unsign()` on each operand), and `Negate`'s
 *    serializer no longer parenthesizes a `Divide`/`Rational` operand, since
 *    `\frac{}{}` is already self-delimiting.
 * 4. `\operatorname{rank}(A)` parsed to the free symbol `rank` applied to
 *    `A`, rather than to `MatrixRank`, the library function that already
 *    exists for it — the same gap `\operatorname{lcm}` (→ `LCM`) already
 *    covers for a different head.
 *
 * Item 3 (a dictionary literal's `.latex` is `""`) is not addressed here:
 * the LaTeX dictionary has no syntax for a dictionary/map literal to parse
 * back from, so there is no round-trippable spelling to give it without
 * inventing new notation.
 */

const ce = new ComputeEngine();

describe('345 Beta, Zeta and Lb write conventional notation when applied', () => {
  test('Beta(2, 3) writes \\mathrm{B}(2, 3)', () => {
    expect(ce.box(['Beta', 2, 3], { canonical: false }).latex).toBe(
      '\\mathrm{B}(2, 3)'
    );
  });

  test('Zeta(3) writes \\zeta(3)', () => {
    expect(ce.box(['Zeta', 3], { canonical: false }).latex).toBe('\\zeta(3)');
  });

  test('Lb(x) writes \\log_2(x)', () => {
    expect(ce.box(['Lb', 'x'], { canonical: false }).latex).toBe(
      '\\log_{2}(x)'
    );
  });

  test('the old \\Beta(...), \\Zeta(...) and \\lb(...) spellings still parse', () => {
    expect(ce.parse('\\Beta(2, 3)').evaluate().json).toEqual(
      ce.box(['Beta', 2, 3]).evaluate().json
    );
    expect(ce.parse('\\Zeta(3)').evaluate().json).toEqual(
      ce.box(['Zeta', 3]).evaluate().json
    );
    expect(ce.parse('\\lb(x)').json).toEqual(['Log', 'x', 2]);
  });

  test('each new spelling round-trips (parses back to the same value)', () => {
    const cases: [any, any][] = [
      [
        ['Beta', 2, 3],
        ['Rational', 1, 12],
      ],
      [
        ['Zeta', 3],
        ['Zeta', 3],
      ],
      [['Lb', 8], 3],
    ];
    for (const [json, expected] of cases) {
      const latex = ce.box(json, { canonical: false }).latex;
      expect(ce.parse(latex).evaluate().json).toEqual(
        ce.box(expected).evaluate().json
      );
    }
  });

  // Bare (unapplied) symbols are untouched: `Zeta`/`Beta` still spell the
  // capital Greek letter, and a bare `Lb` (no argument to subscript) still
  // spells `\lb`.
  test('the bare symbols are unaffected', () => {
    expect(ce.box('Zeta').latex).toBe('\\Zeta');
    expect(ce.box('Beta').latex).toBe('\\Beta');
    expect(ce.box('Lb', { canonical: false }).latex).toBe('\\lb');
    expect(ce.parse('\\Zeta').json).toBe('Zeta');
    expect(ce.parse('\\Beta').json).toBe('Beta');
  });

  // `\mathrm{B}` is otherwise the generic upright-roman spelling for a
  // single-letter symbol (`\mathrm{B}` alone reads as a variable `B`); only
  // the *applied* form is claimed for `Beta`.
  test('\\mathrm{B} without a call is still a plain symbol', () => {
    expect(ce.parse('\\mathrm{B}').operator).not.toBe('Beta');
  });
});

describe('345 a fraction writes its sign in front, not inside', () => {
  const cases: [string, any, string][] = [
    ['a negative Rational', ['Rational', -1, 2], '-\\frac{1}{2}'],
    [
      'a Divide with a Negate numerator',
      ['Divide', ['Negate', ['Power', 'Pi', 2]], 12],
      '-\\frac{\\pi^2}{12}',
    ],
    ['a negative Divide denominator', ['Divide', 'x', -4], '-\\frac{x}{4}'],
  ];
  for (const [label, json, expected] of cases) {
    test(`${label}: ${expected}`, () => {
      expect(ce.box(json, { canonical: false }).latex).toBe(expected);
    });
  }

  test('Negate of a Rational writes -\\frac{3}{4}, not -(\\frac{3}{4})', () => {
    expect(
      ce.box(['Negate', ['Rational', 3, 4]], { canonical: false }).latex
    ).toBe('-\\frac{3}{4}');
  });

  test('each spelling round-trips to the same value', () => {
    const cases: [any, any][] = [
      [
        ['Rational', -1, 2],
        ['Rational', -1, 2],
      ],
      [
        ['Divide', ['Negate', ['Power', 'Pi', 2]], 12],
        ['Divide', ['Negate', ['Power', 'Pi', 2]], 12],
      ],
      [
        ['Negate', ['Rational', 3, 4]],
        ['Rational', -3, 4],
      ],
      [
        ['Divide', 'x', -4],
        ['Divide', 'x', -4],
      ],
    ];
    for (const [json, expected] of cases) {
      const latex = ce.box(json, { canonical: false }).latex;
      expect(ce.parse(latex).evaluate().json).toEqual(
        ce.box(expected).evaluate().json
      );
    }
  });

  // Structural round-trips: these need `Negate` to fold into a product's
  // numeric factor at canonicalization.
  test('three of the sign cases round-trip structurally, not just by value', () => {
    const cases: any[] = [
      ['Multiply', ['Rational', -1, 2], 'x'],
      ['Divide', 'x', -4],
      ['Divide', ['Negate', ['Power', 'Pi', 2]], 12],
    ];
    for (const json of cases) {
      const box = ce.box(json, { canonical: false });
      expect(ce.parse(box.latex).isSame(box.canonical)).toBe(true);
    }
  });

  // A positive fraction, or one that gained no sign, is unaffected: no
  // spurious `-` and no parenthesization for other Negate operands.
  test('unrelated fractions and negations are unaffected', () => {
    expect(ce.box(['Rational', 1, 2], { canonical: false }).latex).toBe(
      '\\frac{1}{2}'
    );
    expect(ce.box(['Divide', 'x', 4], { canonical: false }).latex).toBe(
      '\\frac{x}{4}'
    );
    expect(ce.box(['Negate', 'x'], { canonical: false }).latex).toBe('-x');
    expect(
      ce.box(['Negate', ['Add', 'x', 'y']], { canonical: false }).latex
    ).toBe('-(x+y)');
  });

  // The solidus fraction style has its own (already correct) sign handling
  // for a negative denominator; this only re-confirms the quotient style
  // above isn't the only path exercised.
  test('the inline-solidus style also writes the sign in front', () => {
    const ce2 = new ComputeEngine();
    ce2.latexOptions = { fractionStyle: () => 'inline-solidus' };
    expect(ce2.box(['Rational', -1, 2], { canonical: false }).latex).toBe(
      '-1/2'
    );
    expect(ce2.box(['Divide', 'x', -4], { canonical: false }).latex).toBe(
      '-x/4'
    );
  });
});

describe('345 \\operatorname{rank} parses to MatrixRank, like \\operatorname{lcm} to LCM', () => {
  test('\\operatorname{rank}(A) parses to MatrixRank(A)', () => {
    expect(ce.parse('\\operatorname{rank}(A)').json).toEqual([
      'MatrixRank',
      'A',
    ]);
  });

  test('round-trips through .latex', () => {
    const expr = ce.box(['MatrixRank', 'A']);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });
});
