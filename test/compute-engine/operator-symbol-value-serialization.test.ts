import { ComputeEngine } from '../../src/compute-engine';
import {
  LatexSyntax,
  parse as parseStandalone,
  serialize as serializeStandalone,
} from '../../src/compute-engine/latex-syntax/latex-syntax';
import { LATEX_DICTIONARY } from '../../src/compute-engine/latex-syntax/dictionary/default-dictionary';
import { indexLatexDictionary } from '../../src/compute-engine/latex-syntax/dictionary/definitions';

/**
 * When a symbol that names an operator is used as a VALUE (unapplied — as a
 * tuple element, a callback, ...), the serializer used to reach for the
 * operator's LaTeX notation. That notation is written in terms of operands, so
 * with none it produced fragments that do not re-parse: `\vert\vert` for
 * `Abs`, `!` for `Factorial`, `\sum` for `Sum`.
 *
 * The notation is now used only for the entries that declare
 * `standaloneSymbol: true` — those whose notation parses back to the same
 * symbol (the `\sin` class, the set and constant notations). Every other name
 * is spelled out (`\mathrm{Abs}`), which always re-parses to the same symbol.
 */

const ce = new ComputeEngine();

const DICTIONARY = indexLatexDictionary(LATEX_DICTIONARY as any, () => {});

/** The symbol `name` used as a value, via the box route. */
function boxRoute(name: string): string {
  return ce.box(['Tuple', 'A', name]).toLatex();
}

describe('OPERATOR NAME IN SYMBOL POSITION', () => {
  describe('box route', () => {
    test.each([
      ['Abs', '\\mathrm{Abs}'],
      ['Factorial', '\\mathrm{Factorial}'],
      ['Sum', '\\mathrm{Sum}'],
      ['Add', '\\mathrm{Add}'],
      ['Multiply', '\\mathrm{Multiply}'],
      ['Ceil', '\\mathrm{Ceil}'],
      ['Not', '\\mathrm{Not}'],
      ['Integrate', '\\mathrm{Integrate}'],
      // The `\sin` class: entries flagged `standaloneSymbol` keep their
      // notation
      ['Sin', '\\sin'],
      ['Ln', '\\ln'],
      ['Arctan', '\\arctan'],
    ])('%s serializes as %s', (name, expected) => {
      expect(boxRoute(name)).toBe(`(A,${expected})`);
    });

    test.each(['Abs', 'Factorial', 'Sum', 'Add', 'Multiply', 'Sin'])(
      '%s round-trips through the box route',
      (name) => {
        const roundTrip = ce.parse(boxRoute(name));
        expect(roundTrip.op2.isSame(ce.box(name))).toBe(true);
      }
    );
  });

  describe('parse route', () => {
    test.each(['Abs', 'Factorial', 'Sum', 'Add', 'Multiply', 'Sin'])(
      '%s parsed as a value round-trips',
      (name) => {
        const expr = ce.parse(boxRoute(name));
        expect(expr.op2.symbol).toBe(name);
        // ... and serializing what was parsed is stable
        expect(expr.toLatex()).toBe(boxRoute(name));
      }
    );

    test('an operator used as a callback keeps its standalone notation', () => {
      expect(ce.box(['Map', ['List', 1, 2], 'Sin']).toLatex()).toContain(
        '\\sin'
      );
      expect(
        ce.parse('\\mathrm{Map}(\\bigl\\lbrack1, 2\\bigr\\rbrack, \\sin)').op2
          .symbol
      ).toBe('Sin');
    });

    test('an operator whose notation needs operands is spelled out', () => {
      expect(ce.box(['Map', ['List', 1, 2], 'Abs']).toLatex()).toContain(
        '\\mathrm{Abs}'
      );
      expect(
        ce.parse(
          '\\mathrm{Map}(\\bigl\\lbrack1, 2\\bigr\\rbrack, \\mathrm{Abs})'
        ).op2.symbol
      ).toBe('Abs');
    });
  });

  describe('dictionary sweep', () => {
    // Every name in the LaTeX dictionary, serialized in symbol position and
    // re-parsed, must come back as the same symbol.
    //
    // `gamma` is the sole exception, and it is declaration-dependent BY
    // DESIGN rather than a defect — an artifact of this sweep reading the
    // LaTeX with a fresh engine. `\gamma` is `EulerGamma` only while `gamma`
    // is undeclared: the constant yields the bare command to a declaration
    // (see the `EulerGamma` entry), so in the engine where the symbol `gamma`
    // exists — the only engine that can produce it — `\gamma` reads back as
    // that symbol and the same-engine round-trip holds.
    //
    // Every other name whose generic spelling the dictionary gives to a
    // different symbol (`pi` → `\pi` → `Pi`) is spelled upright instead
    // (`\mathrm{pi}`), and a plain trailing digit run is no longer promoted
    // to a subscript (`Arctan2` → `\mathrm{Arctan2}`, not `\mathrm{Arctan_2}`
    // → `Arctan_2`).
    const EXCEPTIONS = ['gamma'];

    const names = [...DICTIONARY.ids.keys()];

    test('every dictionary name round-trips in symbol position', () => {
      expect(names.length).toBeGreaterThan(400);
      const failures: string[] = [];
      let pass = 0;
      for (const name of names) {
        // The LaTeX is read back by a fresh engine, and read back *before*
        // the name is boxed there: a declaration of the name shadows the
        // constant that owns its notation (`\gamma` yields to a declared
        // `gamma`), which would otherwise make the sweep depend on its own
        // iteration order.
        const latex = ce.box(name).toLatex();
        const probe = new ComputeEngine();
        const roundTrip = probe.parse(latex);
        if (roundTrip.isSame(probe.box(name))) pass++;
        else failures.push(name);
      }
      expect(failures.sort()).toEqual(EXCEPTIONS);
      expect(pass).toBe(names.length - EXCEPTIONS.length);
    });

    test('every flagged entry round-trips through its own notation', () => {
      // This is what keeps `standaloneSymbol` truthful: a flagged entry whose
      // notation stops parsing back to its symbol fails here. (The reverse —
      // a standalone-capable entry nobody flagged — fails safe: it is spelled
      // `\mathrm{Name}`, which always round-trips.)
      const flagged = [...DICTIONARY.ids].filter(
        ([_, def]) => def.standaloneSymbol === true
      );
      expect(flagged.length).toBeGreaterThan(50);

      const failures: string[] = [];
      for (const [name] of flagged) {
        const latex = serializeStandalone(name);
        if (parseStandalone(latex) !== name)
          failures.push(`${name} -> ${latex}`);
      }
      expect(failures).toEqual([]);
    });

    test('an unflagged name is spelled out, not given its notation', () => {
      // `Sum` has a `\sum` notation and `Abs` a `\vert\vert` one; neither is
      // flagged, so neither is used in symbol position.
      for (const name of ['Sum', 'Abs', 'Factorial', 'Add', 'Multiply']) {
        expect(DICTIONARY.ids.get(name)?.standaloneSymbol).toBeUndefined();
        expect(serializeStandalone(name)).toBe(`\\mathrm{${name}}`);
      }
    });

    test('the number spellings are kept', () => {
      // These denote a value, not an operator. They are recognized from the
      // serializer options rather than flagged: `-\infty` re-parses as
      // `["Negate", "PositiveInfinity"]`, the same value but not the same
      // symbol, so it could not satisfy the `standaloneSymbol` contract.
      for (const name of [
        'PositiveInfinity',
        'NegativeInfinity',
        'ImaginaryUnit',
      ])
        expect(DICTIONARY.ids.get(name)?.standaloneSymbol).toBeUndefined();

      expect(ce.box({ num: '-Infinity' }).toLatex()).toBe('-\\infty');
      expect(ce.box({ num: '+Infinity' }).toLatex()).toBe('\\infty');
      expect(ce.parse('-\\infty').isSame(ce.box('NegativeInfinity'))).toBe(
        true
      );

      // ...and in symbol position (the exemption's actual site)
      expect(ce.box(['Tuple', 'A', 'PositiveInfinity']).toLatex()).toBe(
        '(A,\\infty)'
      );
      expect(ce.box(['Tuple', 'A', 'NegativeInfinity']).toLatex()).toBe(
        '(A,-\\infty)'
      );
      expect(ce.box(['Tuple', 'A', 'ImaginaryUnit']).toLatex()).toBe(
        '(A,\\imaginaryI)'
      );
      expect(ce.box(['Tuple', 'A', 'NaN']).toLatex()).toBe(
        '(A,\\operatorname{NaN})'
      );
    });

    test('the exemption is keyed on the symbol, not on the LaTeX emitted', () => {
      // An unflagged entry whose serializer happens to emit one of the number
      // spellings must NOT be exempted: `\infty` re-parses as
      // `PositiveInfinity`, not as `Foo`. Leaving `standaloneSymbol` unset has
      // to stay safe for every entry.
      const syntax = new LatexSyntax({
        dictionary: [
          ...(LATEX_DICTIONARY as any),
          { name: 'Foo', serialize: () => '\\infty' },
        ] as any,
      });

      expect(syntax.serialize('Foo')).toBe('\\mathrm{Foo}');
      expect(syntax.parse(syntax.serialize('Foo'))).toBe('Foo');

      // The number symbols themselves are unaffected
      expect(syntax.serialize('PositiveInfinity')).toBe('\\infty');
      expect(syntax.serialize('NegativeInfinity')).toBe('-\\infty');
      expect(syntax.serialize('ImaginaryUnit')).toBe('\\imaginaryI');
    });
  });
});

/**
 * The generic symbol speller — the name-based spelling used when no dictionary
 * notation applies — has to produce LaTeX that reads back as the SAME symbol.
 * Two prettifications used to break that: a plain trailing digit run became a
 * subscript (`x2` → `x_2`, read back as the different symbol `x_2`), and a
 * name from the Greek/letterlike table was spelled with a command the
 * dictionary gives to a constant (`pi` → `\pi`, read back as `Pi`).
 */
describe('GENERIC SYMBOL SPELLING', () => {
  const CASES: [name: string, latex: string][] = [
    // A plain trailing digit run stays in the body...
    ['x2', '\\mathrm{x2}'],
    ['a12', '\\mathrm{a12}'],
    ['Arctan2', '\\mathrm{Arctan2}'],
    // ...but a name that already uses the `_` subscript convention keeps its
    // subscript (that spelling does round-trip)
    ['x_2', 'x_2'],
    // A letterlike spelling the dictionary gives to a constant is not used...
    ['pi', '\\mathrm{pi}'],
    ['zeta', '\\mathrm{zeta}'],
    ['phiLetter', '\\mathrm{phiLetter}'],
    // ...unless the constant yields the bare command to a declaration, in
    // which case the spelling is the symbol's wherever the symbol exists
    ['gamma', '\\gamma'],
  ];

  describe('box route', () => {
    test.each(CASES)('%s serializes as %s', (name, expected) => {
      expect(ce.box(name).toLatex()).toBe(expected);
      // ...and in symbol position (as a tuple element)
      expect(ce.box(['Tuple', 'A', name]).toLatex()).toBe(`(A,${expected})`);
    });

    test.each(CASES.filter(([name]) => name !== 'gamma'))(
      '%s round-trips through a fresh engine',
      (name) => {
        const probe = new ComputeEngine();
        expect(
          probe.parse(ce.box(name).toLatex()).isSame(probe.box(name))
        ).toBe(true);
      }
    );
  });

  describe('parse route', () => {
    test.each(CASES.filter(([name]) => name !== 'gamma'))(
      '%s parsed as a value round-trips',
      (name) => {
        const latex = ce.box(['Tuple', 'A', name]).toLatex();
        const probe = new ComputeEngine();
        const expr = probe.parse(latex);
        expect(expr.op2.symbol).toBe(name);
        // ...and serializing what was parsed is stable
        expect(expr.toLatex()).toBe(latex);
      }
    );

    test('`gamma` keeps the bare command, which the constant yields', () => {
      // On a FRESH engine the command belongs to the constant...
      expect(new ComputeEngine().parse('\\gamma').symbol).toBe('EulerGamma');

      // ...but an engine that has the symbol `gamma` — the only engine that
      // can produce that symbol — reads it back as the symbol.
      const probe = new ComputeEngine();
      probe.declare('gamma', 'real');
      const latex = probe.box(['Tuple', 'A', 'gamma']).toLatex();
      expect(latex).toBe('(A,\\gamma)');
      expect(probe.parse(latex).op2.symbol).toBe('gamma');
    });
  });
});
