import { engine } from '../utils';

/**
 * English unit-word support in the LaTeX parser.
 *
 * `\text{...}`/`\mathrm{...}` content is normalized through an alias table
 * (English words → canonical unit symbols) at the parse boundary before
 * unit lookup.  The unit system itself stays canonical.
 */
describe('UNIT WORDS IN TEXT', () => {
  const parse = (s: string) => engine.parse(s).json;

  describe('simple word aliases', () => {
    test('singular word → canonical symbol', () => {
      expect(parse('18 \\text{ inch}')).toEqual(['Quantity', 18, 'in']);
    });

    test('plural word folds to Quantity with canonical symbol', () => {
      expect(parse('18 \\text{ inches}')).toEqual(['Quantity', 18, 'in']);
    });

    test('pounds → lb', () => {
      expect(parse('5\\text{ pounds}')).toEqual(['Quantity', 5, 'lb']);
    });

    test('gallons → gal', () => {
      expect(parse('8640 \\text{ gallons}')).toEqual([
        'Quantity',
        8640,
        'gal',
      ]);
    });

    test('meters → m', () => {
      expect(parse('5\\text{ meters}')).toEqual(['Quantity', 5, 'm']);
    });

    test('days → d (word is unambiguous, bare `d` stays differential)', () => {
      expect(parse('3\\text{ days}')).toEqual(['Quantity', 3, 'd']);
    });

    test('abbreviation with trailing period: `in.` → in', () => {
      expect(parse('\\frac{20\\text{ in.}}{10\\text{ in.}}')).toEqual([
        'Divide',
        ['Quantity', 20, 'in'],
        ['Quantity', 10, 'in'],
      ]);
    });
  });

  describe('compound unit words (leaf normalization)', () => {
    test('inches/foot → in/ft', () => {
      expect(parse('12 \\text{ inches/foot}')).toEqual([
        'Quantity',
        12,
        ['Divide', 'in', 'ft'],
      ]);
    });

    test('gallons/minute → gal/min', () => {
      expect(parse('24 \\text{ gallons/minute}')).toEqual([
        'Quantity',
        24,
        ['Divide', 'gal', 'min'],
      ]);
    });

    test('mph → mi/h', () => {
      expect(parse('80\\text{ mph}')).toEqual([
        'Quantity',
        80,
        ['Divide', 'mi', 'h'],
      ]);
    });

    test('spaced phrase `miles per hour` → mi/h', () => {
      expect(parse('60 \\text{ miles per hour}')).toEqual([
        'Quantity',
        60,
        ['Divide', 'mi', 'h'],
      ]);
    });

    test('non-unit multi-word text does not become a unit', () => {
      const json = JSON.stringify(parse('\\text{hello world}'));
      expect(json).not.toContain('Quantity');
    });
  });

  describe('exponent outside the braced text', () => {
    test('folds into the LAST factor: gallons/ft ^3 → gallons per cubic foot', () => {
      // Semantics: gal·ft^-3, NOT (gal/ft)^3.
      expect(parse('7.5 \\text { gallons/ft}^3')).toEqual([
        'Quantity',
        7.5,
        ['Divide', 'gal', ['Power', 'ft', 3]],
      ]);
    });

    test('simple unit with outside exponent: in.^2 → area', () => {
      expect(parse('25\\text{ in.}^2')).toEqual([
        'Quantity',
        25,
        ['Power', 'in', 2],
      ]);
    });

    test('canonical symbol with outside exponent still works: ft^3', () => {
      expect(parse('1152 \\text{ ft}^3')).toEqual([
        'Quantity',
        1152,
        ['Power', 'ft', 3],
      ]);
    });
  });

  describe('Quantity folding for simple case', () => {
    test('word folds like the canonical symbol does', () => {
      expect(parse('18 \\text{ inches}')).toEqual(parse('18\\ \\text{in}'));
    });
  });

  describe('prose negative guards (must NOT become units)', () => {
    test('`to` stays prose', () => {
      expect(parse('9\\text{ to }80')).toEqual(['Text', 9, "' to '", 80]);
    });

    test('a sentence stays prose', () => {
      expect(parse('\\text{none of these}')).toEqual("'none of these'");
    });

    test('non-unit word `unit` is not aliased', () => {
      const json = JSON.stringify(parse('\\frac{\\text{meters}}{\\text{unit}}'));
      // meters normalizes to m, but `unit` stays a string (not a unit).
      expect(json).toContain('Error');
    });
  });

  describe('existing behavior preserved', () => {
    test('canonical `\\text{in}` still folds', () => {
      expect(parse('18\\ \\text{in}')).toEqual(['Quantity', 18, 'in']);
    });

    test('siunitx `\\qty{5}{cm}` path unchanged', () => {
      expect(parse('\\qty{5}{cm}')).toEqual(['Quantity', 5, 'cm']);
    });

    test('bare `\\mathrm{d}x` stays a differential (blocklist)', () => {
      // `d` is blocklisted; must not become the day unit.
      const json = JSON.stringify(parse('\\mathrm{d}x'));
      expect(json).not.toContain('Quantity');
    });

    test('unitless `\\text{ ft}^3` stays a Power', () => {
      expect(parse('\\text{ ft}^3')).toEqual(['Power', 'ft', 3]);
    });
  });
});

describe('Leibniz-notation guard (blocklist gates the exponent fold)', () => {
  // `\mathrm{d}` is blocklisted as a unit (it is the differential), and the
  // outside-exponent fold must respect that on the BASE text: `\mathrm{d}^2`
  // is the Leibniz numerator d², NOT "square days" (`d` = day is a known
  // unit symbol, so the folded text `d^2` would otherwise resolve).
  test("f''(x) Leibniz serialization round-trips", () => {
    const d2 = engine.parse("f''(x)");
    expect(engine.parse(d2.latex).isSame(d2)).toBe(true);
    const d3 = engine.parse("f'''(x)");
    expect(engine.parse(d3.latex).isSame(d3)).toBe(true);
  });

  test('bare \\mathrm{d} and \\mathrm{d}^2 are not units', () => {
    expect(
      JSON.stringify(
        engine.parse('\\frac{\\mathrm{d}^2}{\\mathrm{d}x^2}f(x)').json
      )
    ).toContain('"D"');
  });
});

describe('A `\\text{...}` that names a unit, with no magnitude', () => {
  // CE-1644. A `\text{...}` is a unit only as an operand of a juxtaposition,
  // a product, a quotient or a power. Elsewhere it is a string, as a
  // `\text{...}` that names no unit is.
  const parse = (s: string) => engine.parse(s).json;

  test('a set of one-letter names is a set of strings', () => {
    const expr = engine.parse(String.raw`\{\text{A}, \text{B}, \text{C}\}`);
    const [op, ...elements] = expr.json as unknown as string[];
    expect(op).toBe('Set');
    expect(elements.sort()).toEqual(["'A'", "'B'", "'C'"]);
    expect(expr.type.toString()).toBe('set<string>');
  });

  test('a list of unit names is a list of strings', () => {
    expect(parse(String.raw`[\text{s}, \text{h}, \text{min}]`)).toEqual([
      'List',
      "'s'",
      "'h'",
      "'min'",
    ]);
  });

  test('a bare `\\text{A}` and a comparison with it read the string', () => {
    expect(parse(String.raw`\text{A}`)).toEqual("'A'");
    expect(parse(String.raw`m = \text{A}`)).toEqual(['Equal', 'm', "'A'"]);
  });

  test('a magnitude before it still gives a quantity', () => {
    expect(parse(String.raw`5\,\text{A}`)).toEqual(['Quantity', 5, 'A']);
    expect(parse(String.raw`5\text{ A}`)).toEqual(['Quantity', 5, 'A']);
  });

  test('a unit in a quotient stays a unit', () => {
    expect(
      engine
        .parse(String.raw`6\text{ USD} / (2\text{ USD}/\text{lb})`)
        .evaluate().json
    ).toEqual(['Multiply', 3, 'lb']);
  });

  test('a unit under a root or in parentheses stays a unit', () => {
    expect(
      engine.parse(String.raw`5\,\text{nV}/\sqrt{\text{Hz}}`).evaluate().operator
    ).toBe('Quantity');
    expect(parse(String.raw`(\text{s})^{-1}`)).toEqual(['Divide', 1, 's']);
    expect(parse(String.raw`x \large\text{ cm}`)).toEqual([
      'Multiply',
      'x',
      ['Annotated', 'cm', { dict: { size: 6 } }],
    ]);
  });

  test('the argument of a call is a string, whether it names a unit or not', () => {
    expect(parse(String.raw`f(\text{m})`)).toEqual(['f', "'m'"]);
    expect(parse(String.raw`f(\text{X})`)).toEqual(['f', "'X'"]);
  });

  test('a unit name as the target of UnitConvert still converts', () => {
    expect(
      engine
        .parse(String.raw`\operatorname{UnitConvert}(5\,\text{km}, \text{m})`)
        .evaluate().json
    ).toEqual(['Quantity', 5000, 'm']);
  });

  test('`\\mathrm{A}` is unchanged', () => {
    expect(parse(String.raw`\mathrm{A}`)).toEqual('A');
  });
});
