import type { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** Parse `latex` and return its MathJSON. */
function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

/**
 * Serialize→reparse round-trip on the STRUCTURAL tier (`isSame`), the property
 * `docs/mathnet/scripts/check-roundtrip.ts` enforces.
 */
function roundTrips(expr: Expression): boolean {
  const boxed = ce.box(expr);
  return ce.parse(boxed.latex).isSame(boxed);
}

describe('QuotientRing — parsing', () => {
  test('subscript form `\\mathbb{Z}_n`', () => {
    expect(parse('\\mathbb{Z}_n')).toEqual(['QuotientRing', 'Integers', 'n']);
  });

  test('terse subscript form `\\Z_n`', () => {
    expect(parse('\\Z_n')).toEqual(['QuotientRing', 'Integers', 'n']);
  });

  test('numeric modulus', () => {
    expect(parse('\\mathbb{Z}_2')).toEqual(['QuotientRing', 'Integers', 2]);
    expect(parse('\\mathbb{Z}_{12}')).toEqual([
      'QuotientRing',
      'Integers',
      12,
    ]);
  });

  test('symbolic modulus', () => {
    expect(parse('\\mathbb{Z}_p')).toEqual(['QuotientRing', 'Integers', 'p']);
  });

  test('ideal (slash) form `\\mathbb{Z}/n\\mathbb{Z}`', () => {
    expect(parse('\\mathbb{Z}/n\\mathbb{Z}')).toEqual([
      'QuotientRing',
      'Integers',
      'n',
    ]);
    expect(parse('\\Z/2\\Z')).toEqual(['QuotientRing', 'Integers', 2]);
  });

  test('other blackboard ring bases', () => {
    expect(parse('\\mathbb{Q}_p')).toEqual([
      'QuotientRing',
      'RationalNumbers',
      'p',
    ]);
    expect(parse('\\mathbb{Q}/n\\mathbb{Q}')).toEqual([
      'QuotientRing',
      'RationalNumbers',
      'n',
    ]);
  });

  test('the slash form requires the SAME ring on both sides', () => {
    // No trailing ring: plain division (unchanged from before the operator
    // existed).
    expect(parse('\\Z/2')).toEqual(['Multiply', ['Rational', 1, 2], 'Integers']);
  });

  test('fraction form `\\frac{\\Z}{n\\Z}`', () => {
    expect(parse('\\frac{\\Z}{n\\Z}')).toEqual([
      'QuotientRing',
      'Integers',
      'n',
    ]);
    expect(parse('\\frac{\\mathbb{Z}}{n\\mathbb{Z}}')).toEqual([
      'QuotientRing',
      'Integers',
      'n',
    ]);
    // Numeric modulus, and the other ring constants.
    expect(parse('\\frac{\\Z}{2\\Z}')).toEqual(['QuotientRing', 'Integers', 2]);
    expect(parse('\\frac{\\R}{n\\R}')).toEqual([
      'QuotientRing',
      'RealNumbers',
      'n',
    ]);
    // The hook lives in `parseFraction`, so the `\frac` variants share it.
    expect(parse('\\dfrac{\\Z}{n\\Z}')).toEqual([
      'QuotientRing',
      'Integers',
      'n',
    ]);
  });

  test('the fraction form requires the SAME ring on both sides', () => {
    // No trailing ring: ordinary division.
    expect(parse('\\frac{\\Z}{n}')).toEqual(['Divide', 'Integers', 'n']);
    // A DIFFERENT ring in the denominator: ordinary division.
    expect(parse('\\frac{\\Z}{n\\R}')).toEqual([
      'Divide',
      'Integers',
      ['Tuple', 'n', 'RealNumbers'],
    ]);
    // More than two factors in the denominator: ordinary division.
    // Fresh engine: this parse infers a numeric type for `x` in the shared
    // engine, which would poison the `ℤ[x] : set<unknown>` pin below.
    const fresh = new ComputeEngine();
    expect(fresh.parse('\\frac{\\Z}{n\\Z x}').json).toEqual([
      'Divide',
      'Integers',
      ['Tuple', 'n', 'Integers', 'x'],
    ]);
  });
});

describe('Adjoin — parsing', () => {
  test('single radical adjunct', () => {
    expect(parse('\\mathbb{Z}[\\sqrt{2}]')).toEqual([
      'Adjoin',
      'Integers',
      ['Sqrt', 2],
    ]);
  });

  test('multiple adjuncts', () => {
    expect(parse('\\mathbb{Z}[\\sqrt{2},\\sqrt{3}]')).toEqual([
      'Adjoin',
      'Integers',
      ['Sqrt', 2],
      ['Sqrt', 3],
    ]);
  });

  test('indeterminate (polynomial ring)', () => {
    expect(parse('\\mathbb{Z}[x]')).toEqual(['Adjoin', 'Integers', 'x']);
  });

  test('Gaussian integers — `i` arrives via the normal parse of `i`', () => {
    expect(parse('\\mathbb{Z}[i]')).toEqual([
      'Adjoin',
      'Integers',
      ['Complex', 0, 1],
    ]);
  });

  test('other blackboard ring bases', () => {
    expect(parse('\\C[x]')).toEqual(['Adjoin', 'ComplexNumbers', 'x']);
    expect(parse('\\R[x]')).toEqual(['Adjoin', 'RealNumbers', 'x']);
  });

  test('field adjunction with PARENTHESES is not parsed (v1)', () => {
    // `\mathbb{Q}(\sqrt2)` stays the pre-existing juxtaposition reading.
    expect(parse('\\mathbb{Q}(\\sqrt{2})')).toEqual([
      'Multiply',
      ['Sqrt', 2],
      'RationalNumbers',
    ]);
  });
});

describe('Serialization round-trips', () => {
  test('QuotientRing serializes to the subscript form', () => {
    expect(ce.box(['QuotientRing', 'Integers', 'n']).latex).toBe('\\Z_{n}');
    expect(ce.box(['QuotientRing', 'Integers', 12]).latex).toBe('\\Z_{12}');
  });

  test('Adjoin serializes to the bracket form', () => {
    expect(ce.box(['Adjoin', 'Integers', ['Sqrt', 2]]).latex).toBe(
      '\\Z[\\sqrt{2}]'
    );
    expect(
      ce.box(['Adjoin', 'Integers', ['Sqrt', 2], ['Sqrt', 3]]).latex
    ).toBe('\\Z[\\sqrt{2}, \\sqrt{3}]');
  });

  test('box route: parse(serialize(x)).isSame(x)', () => {
    expect(roundTrips(['QuotientRing', 'Integers', 'n'])).toBe(true);
    expect(roundTrips(['QuotientRing', 'Integers', 12])).toBe(true);
    expect(roundTrips(['QuotientRing', 'RationalNumbers', 'p'])).toBe(true);
    expect(roundTrips(['Adjoin', 'Integers', ['Sqrt', 2]])).toBe(true);
    expect(roundTrips(['Adjoin', 'Integers', ['Sqrt', 2], ['Sqrt', 3]])).toBe(
      true
    );
    expect(roundTrips(['Adjoin', 'Integers', 'x'])).toBe(true);
    expect(roundTrips(['Adjoin', 'Integers', ['Complex', 0, 1]])).toBe(true);
  });

  test('a CONSTRUCTED base gets the functional spelling', () => {
    // The bracket/subscript notations are only read back as ring constructions
    // when the base is one of the ring constants, so a base that is itself a
    // constructed ring serializes as `\mathrm{Adjoin}(...)` /
    // `\mathrm{QuotientRing}(...)` instead (which does round-trip).
    expect(
      ce.box(['QuotientRing', ['Adjoin', 'Integers', ['Sqrt', 2]], 'p']).latex
    ).toBe('\\mathrm{QuotientRing}(\\Z[\\sqrt{2}], p)');
    expect(ce.box(['Adjoin', ['Adjoin', 'Integers', 'x'], 'y']).latex).toBe(
      '\\mathrm{Adjoin}(\\Z[x], y)'
    );
  });

  test('box route: constructed and constant bases both round-trip', () => {
    expect(
      roundTrips(['QuotientRing', ['Adjoin', 'Integers', ['Sqrt', 2]], 'p'])
    ).toBe(true);
    expect(roundTrips(['Adjoin', ['Adjoin', 'Integers', 'x'], 'y'])).toBe(true);
    expect(
      roundTrips(['Adjoin', ['QuotientRing', 'Integers', 'p'], 'x'])
    ).toBe(true);
    expect(
      roundTrips(['QuotientRing', ['QuotientRing', 'Integers', 'n'], 'm'])
    ).toBe(true);
    // A ring-constant base keeps the subscript notation.
    expect(roundTrips(['QuotientRing', 'RealNumbers', 'n'])).toBe(true);
    expect(ce.box(['QuotientRing', 'RealNumbers', 'n']).latex).toBe('\\R_{n}');
  });

  test('parse route: parse(serialize(parse(latex))) is stable', () => {
    for (const latex of [
      '\\mathbb{Z}_n',
      '\\mathbb{Z}_{12}',
      '\\mathbb{Z}/n\\mathbb{Z}',
      '\\mathbb{Z}[\\sqrt{2}]',
      '\\mathbb{Z}[\\sqrt{2},\\sqrt{3}]',
      '\\mathbb{Z}[x]',
      '\\mathbb{Z}[i]',
      '\\frac{\\Z}{n\\Z}',
      '\\frac{\\mathbb{Z}}{n\\mathbb{Z}}',
    ]) {
      const first = ce.parse(latex);
      expect(ce.parse(first.latex).isSame(first)).toBe(true);
    }
  });

  test('the fraction form serializes back as the SUBSCRIPT form', () => {
    // `\frac{\Z}{n\Z}` is parse-only: like the `\Z/n\Z` slash form it
    // reserializes to the canonical subscript spelling.
    expect(ce.parse('\\frac{\\Z}{n\\Z}').latex).toBe('\\Z_{n}');
    expect(ce.parse('\\frac{\\R}{n\\R}').latex).toBe('\\R_{n}');
  });

  test('the `at-over-declared-set-base` ledger row round-trips', () => {
    // Was `["At","Integers","n"]`, which reserialized to `\Z[n]` and reparsed
    // as an `incompatible-type` error (docs/mathnet/roundtrip-exceptions.json).
    const e = ce.parse('(\\mathbb{Z}_n, +, \\cdot)');
    expect(e.json).toEqual([
      'Tuple',
      ['QuotientRing', 'Integers', 'n'],
      'Add',
      'Multiply',
    ]);
    expect(e.ops![0].isValid).toBe(true);
  });
});

describe('Types', () => {
  test('Adjoin joins the base and adjunct element types', () => {
    expect(ce.parse('\\mathbb{Z}[\\sqrt{2}]').type.toString()).toBe(
      'set<finite_real>'
    );
    expect(ce.parse('\\mathbb{Z}[i]').type.toString()).toBe(
      'set<finite_complex>'
    );
    // An indeterminate carries no type information: the honest claim is
    // `unknown`, NOT the base's `finite_integer` (the elements are
    // polynomials, not integers).
    expect(ce.parse('\\mathbb{Z}[x]').type.toString()).toBe('set<unknown>');
  });

  test('QuotientRing keeps the base element type', () => {
    expect(ce.parse('\\mathbb{Z}_n').type.toString()).toBe(
      'set<finite_integer>'
    );
    expect(ce.parse('\\mathbb{Q}_p').type.toString()).toBe(
      'set<finite_rational>'
    );
  });
});

describe('Route parity: raw MathJSON reaches the same dispatch', () => {
  test('box route: `Subscript` over a ring constant is the quotient ring', () => {
    expect(ce.box(['Subscript', 'Integers', 'n']).json).toEqual([
      'QuotientRing',
      'Integers',
      'n',
    ]);
    expect(ce.box(['Subscript', 'RationalNumbers', 'p']).json).toEqual([
      'QuotientRing',
      'RationalNumbers',
      'p',
    ]);
  });

  test('box route: `At` over a ring constant is the adjunction', () => {
    expect(ce.box(['At', 'Integers', ['Sqrt', 2]]).json).toEqual([
      'Adjoin',
      'Integers',
      ['Sqrt', 2],
    ]);
    expect(ce.box(['At', 'ComplexNumbers', 'x']).json).toEqual([
      'Adjoin',
      'ComplexNumbers',
      'x',
    ]);
  });

  test('structural `Subscript` reports the QuotientRing type', () => {
    // Structural mode never reaches the `canonical` handler, so the `type`
    // handler has to know about ring constants on its own: without it, this
    // claimed `finite_integer` (the element type of ℤ) instead of the type of
    // the quotient RING.
    const e = ce.function('Subscript', [ce.symbol('Integers'), ce.symbol('n')], {
      structural: true,
    });
    expect(e.json).toEqual(['Subscript', 'Integers', 'n']);
    expect(e.type.toString()).toBe('set<finite_integer>');
    expect(e.type.toString()).toBe(
      ce.box(['QuotientRing', 'Integers', 'n']).type.toString()
    );
  });

  test('structural `At` reports the Adjoin type', () => {
    // Mirror of the `Subscript` pin above: without the ring-constant case in
    // `At`'s `type` handler, this fell through to the indexing analysis and
    // claimed `number` instead of the adjunction's set type.
    const e = ce.function('At', [ce.symbol('Integers'), ce.parse('\\sqrt{2}')], {
      structural: true,
    });
    expect(e.json).toEqual(['At', 'Integers', ['Sqrt', 2]]);
    expect(e.type.toString()).toBe('set<finite_real>');
    expect(e.type.toString()).toBe(
      ce.box(['Adjoin', 'Integers', ['Sqrt', 2]]).type.toString()
    );

    // An indeterminate adjunct widens to `unknown` here too.
    const p = ce.function('At', [ce.symbol('Integers'), ce.symbol('x')], {
      structural: true,
    });
    expect(p.type.toString()).toBe('set<unknown>');
  });
});

describe('Ring constants are matched by BINDING, not by spelling', () => {
  test('a shadowed `Integers` keeps the ordinary indexing reading', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.declare('Integers', 'list<integer>');
    engine.assign('Integers', engine.box(['List', 5, 6, 7]));

    expect(engine.box(['Subscript', 'Integers', 2]).evaluate().json).toBe(6);
    expect(engine.box(['At', 'Integers', 3]).evaluate().json).toBe(7);
    // The LaTeX gate is name-based, but the ambient environment no longer
    // reports `Integers` as a set, so the slash falls back to `Divide`.
    expect(engine.parse('\\mathbb{Z}/n\\mathbb{Z}').json).toEqual([
      'Divide',
      'Integers',
      ['Multiply', 'Integers', 'n'],
    ]);
  });

  test('a shadowed `RationalNumbers` (not an interned name) behaves the same', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.declare('RationalNumbers', 'list<integer>');
    engine.assign('RationalNumbers', engine.box(['List', 5, 6, 7]));

    expect(
      engine.box(['Subscript', 'RationalNumbers', 2]).evaluate().json
    ).toBe(6);
    expect(engine.box(['At', 'RationalNumbers', 3]).evaluate().json).toBe(7);
  });

  test('the standard-library binding is still recognized', () => {
    const engine = new ComputeEngine();
    expect(engine.box(['Subscript', 'Integers', 'n']).json).toEqual([
      'QuotientRing',
      'Integers',
      'n',
    ]);
  });
});

describe('Inert (v1)', () => {
  test('both stay symbolic and EXACT under evaluate()', () => {
    const q = ce.box(['QuotientRing', 'Integers', 12]);
    expect(q.evaluate().json).toEqual(['QuotientRing', 'Integers', 12]);
    expect(q.N().json).toEqual(['QuotientRing', 'Integers', 12]);

    const a = ce.box(['Adjoin', 'Integers', ['Sqrt', 2]]);
    expect(a.evaluate().json).toEqual(['Adjoin', 'Integers', ['Sqrt', 2]]);
    // `.N()` numericizes the operands, as it does for any head without an
    // evaluate handler (`Set(√2).N()` behaves identically). Pinned so the
    // exact/inexact split stays visible.
    expect(a.N().json).toEqual([
      'Adjoin',
      'Integers',
      { num: expect.stringMatching(/^1\.41421/) },
    ]);
  });

  test('membership is not decided (v1)', () => {
    expect(ce.parse('3 \\in \\Z_5').evaluate().json).toEqual([
      'Element',
      3,
      ['QuotientRing', 'Integers', 5],
    ]);
  });

  test('a non-set base is rejected by signature validation', () => {
    expect(ce.box(['Adjoin', 5, 'x']).isValid).toBe(false);
  });

  test('QuotientRing accepts a general (non-symbol) first argument', () => {
    const e = ce.box([
      'QuotientRing',
      ['Adjoin', 'Integers', ['Sqrt', 2]],
      'p',
    ]);
    expect(e.isValid).toBe(true);
    expect(e.json).toEqual([
      'QuotientRing',
      ['Adjoin', 'Integers', ['Sqrt', 2]],
      'p',
    ]);
    expect(e.type.toString()).toBe('set<finite_real>');
  });
});

describe('Pins: notations that are NOT ring constructions', () => {
  test('sign-restricted subscripts/superscripts keep their named sets', () => {
    expect(parse('\\mathbb{Z}_+')).toBe('PositiveIntegers');
    expect(parse('\\mathbb{Z}_{+}')).toBe('PositiveIntegers');
    expect(parse('\\mathbb{Z}^+')).toBe('PositiveIntegers');
    expect(parse('\\Z_+')).toBe('PositiveIntegers');
    expect(parse('\\mathbb{R}_+')).toBe('PositiveNumbers');
    expect(parse('\\R^-')).toBe('NegativeNumbers');
    expect(parse('\\mathbb{Z}_-')).toBe('NegativeIntegers');
    expect(parse('\\mathbb{Z}_{\\ge0}')).toBe('NonNegativeIntegers');
    expect(parse('\\mathbb{R}_{<0}')).toBe('NegativeNumbers');
    expect(parse('\\mathbb{N}_0')).toBe('NonNegativeIntegers');
  });

  test('`\\mathbb{R}^-` (no terse trigger) is unchanged', () => {
    expect(parse('\\mathbb{R}^-')).toEqual(['Superminus', 'RealNumbers']);
  });

  test('the terse `\\R`/`\\Z`/`\\N` sign restrictions are NOT QuotientRing', () => {
    // Comparison-command subscripts over a RING constant used to fall through
    // to the `\Z_n` quotient-ring reading, producing
    // `QuotientRing(RealNumbers, <error>)`. They are sign-restricted sets.
    //
    // The tokenizer swallows the space after a command name, so `\ge 0` and
    // `\ge0` are the SAME token stream; the gap was `\ge` vs `\geq`, which
    // are distinct commands and so distinct triggers.
    for (const latex of ['\\R_{\\ge 0}', '\\R_{\\ge0}', '\\R_{\\geq0}'])
      expect(parse(latex)).toBe('NonNegativeNumbers');
    for (const latex of ['\\R_{\\gt 0}', '\\R_{\\gt0}', '\\R_{>0}'])
      expect(parse(latex)).toBe('PositiveNumbers');
    for (const latex of ['\\R_{\\lt 0}', '\\R_{\\lt0}', '\\R_{<0}'])
      expect(parse(latex)).toBe('NegativeNumbers');
    for (const latex of ['\\R_{\\le 0}', '\\R_{\\leq0}', '\\R_{\\leqslant0}'])
      expect(parse(latex)).toBe('NonPositiveNumbers');

    for (const latex of [
      '\\Z_{\\ge 0}',
      '\\Z_{\\geq0}',
      '\\Z_{\\geqslant0}',
      '\\N_{\\ge 0}',
      '\\N_{\\geq0}',
    ])
      expect(parse(latex)).toBe('NonNegativeIntegers');
    for (const latex of ['\\N_{>0}', '\\N_{\\gt0}', '\\N_{\\ge 1}'])
      expect(parse(latex)).toBe('PositiveIntegers');

    // Superscript short-command spellings match their `\geq`/`\leq` forms.
    expect(parse('\\R^{\\ge}')).toBe('NonNegativeNumbers');
    expect(parse('\\R^{\\le}')).toBe('NonPositiveNumbers');
    expect(parse('\\Z^{\\ge0}')).toBe('NonNegativeIntegers');
  });

  test('`\\Z_{<0}` is NegativeIntegers on both spellings of `\\Z`', () => {
    // The terse and `\mathbb` spellings used to disagree: a stray
    // `\Z_{<0}` entry in the NonPositiveIntegers block shadowed the
    // NegativeIntegers trigger (later entries win at indexing), so
    // `\Z_{<0}` parsed as `NonPositiveIntegers` while `\mathbb{Z}_{<0}`
    // parsed as `NegativeIntegers`.
    expect(parse('\\Z_{<0}')).toBe('NegativeIntegers');
    expect(parse('\\mathbb{Z}_{<0}')).toBe('NegativeIntegers');
    expect(parse('\\Z_{\\lt0}')).toBe('NegativeIntegers');

    // The `\le0` family the stray entry sat in keeps its own spellings...
    for (const latex of ['\\Z_{\\le0}', '\\Z_{\\leq0}', '\\Z_{\\leqslant0}'])
      expect(parse(latex)).toBe('NonPositiveIntegers');

    // ...plus the superscript spellings it was missing, mirroring the
    // `\Z^{\ge…}`/`\R^{\le…}` families.
    for (const latex of [
      '\\Z^{\\le0}',
      '\\Z^{\\leq0}',
      '\\Z^{\\leqslant0}',
      '\\Z^{\\le}',
      '\\Z^{\\leq}',
      '\\Z^{\\leqslant}',
      '\\Z^{-0}',
      '\\Z^{0-}',
    ])
      expect(parse(latex)).toBe('NonPositiveIntegers');
  });

  test('`NegativeIntegers` serializes symbolically and round-trips', () => {
    expect(ce.box('NegativeIntegers').latex).toBe('\\Z_{<0}');
    expect(roundTrips('NegativeIntegers')).toBe(true);
    expect(ce.box('NonPositiveIntegers').latex).toBe('\\Z_{\\le0}');
    expect(roundTrips('NonPositiveIntegers')).toBe(true);
  });

  test('At over a genuine indexed collection is untouched', () => {
    expect(ce.parse('[1,2,3][2]').evaluate().json).toBe(2);
    expect(ce.box(['At', ['List', 1, 2, 3], 2]).evaluate().json).toBe(2);

    const engine = new ComputeEngine();
    engine.assign('L', engine.box(['List', 5, 6, 7]));
    expect(engine.parse('L_2').evaluate().json).toBe(6);
    expect(engine.parse('L[3]').evaluate().json).toBe(7);
  });

  test('the slash form is restricted to the four RING constants', () => {
    // `\mathbb{N}` is set-typed but is NOT a ring, so `\N/n\N` is plain
    // division — the same gate the canonical `At`/`Subscript` dispatch uses
    // (`RING_CONSTANTS` in `latex-syntax/utils.ts`).
    expect(parse('\\mathbb{N}/n\\mathbb{N}')).toEqual([
      'Divide',
      'NonNegativeIntegers',
      ['Tuple', 'n', 'NonNegativeIntegers'],
    ]);
  });

  test('the slash form does not fire over an arbitrary set-typed symbol', () => {
    const engine = new ComputeEngine();
    engine.declare('S', 'set<integer>');
    expect(engine.parse('S/nS').json).toEqual([
      'Divide',
      'S',
      ['Tuple', 'n', 'S'],
    ]);
  });

  test('the fraction form does not fire over an arbitrary set-typed symbol', () => {
    const engine = new ComputeEngine();
    engine.declare('S', 'set<integer>');
    expect(engine.parse('\\frac{S}{nS}').json).toEqual([
      'Divide',
      'S',
      ['Tuple', 'n', 'S'],
    ]);
    // `\mathbb{N}` is set-typed but is NOT a ring.
    expect(parse('\\frac{\\N}{n\\N}')).toEqual([
      'Divide',
      'NonNegativeIntegers',
      ['Tuple', 'n', 'NonNegativeIntegers'],
    ]);
  });

  test('ordinary fractions are untouched', () => {
    expect(parse('\\frac{x}{n x}')).toEqual([
      'Divide',
      'x',
      ['Multiply', 'n', 'x'],
    ]);
    expect(parse('\\frac{a}{b}')).toEqual(['Divide', 'a', 'b']);
    expect(parse('\\frac{1}{2}')).toEqual(['Rational', 1, 2]);
    // Leibniz notation still wins over the quotient-ring reading.
    expect(parse('\\frac{d}{dx}x^2')).toEqual(['D', ['Power', 'x', 2], 'x']);
  });

  test('ordinary division is untouched', () => {
    expect(parse('x/2')).toEqual(['Multiply', ['Rational', 1, 2], 'x']);
    expect(parse('a/bc')).toEqual(['Divide', 'a', ['Multiply', 'b', 'c']]);
    // Error recovery for a leading slash still yields a `Divide`.
    expect(parse('/2')).toEqual([
      'Divide',
      ['Error', "'missing'", ['LatexString', "'/'"]],
      2,
    ]);
  });
});
