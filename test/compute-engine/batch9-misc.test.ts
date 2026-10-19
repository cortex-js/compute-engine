import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import {
  parseUnitDSL,
  unitRegistrySymbols,
} from '../../src/compute-engine/numerics/unit-data';

const ce = new ComputeEngine();

/** The LaTeX of a quantity, and the canonical MathJSON of its parse. */
function roundTrip(json: MathJsonExpression): [string, unknown] {
  const latex = ce.box(json).latex;
  return [latex, ce.parse(latex).json];
}

describe('LaTeX of a quantity whose unit has a symbolic exponent', () => {
  // The unit parser reads only a numeric exponent inside `\mathrm{...}`, so
  // such a quantity is written as a function, which parses back to the same
  // expression.
  test.each<[string, MathJsonExpression]>([
    ['a sum exponent', ['Quantity', 1, ['Power', 'm', ['Add', 'n', 1]]]],
    ['a symbol exponent', ['Quantity', 1, ['Power', 'm', 'n']]],
    ['a multi-letter unit', ['Quantity', 2, ['Power', 'kg', 'n']]],
    [
      'an infinite exponent',
      ['Quantity', 1, ['Power', 'm', 'PositiveInfinity']],
    ],
    [
      'a product exponent',
      ['Quantity', 1, ['Power', 'm', ['Multiply', 1e200, 1e200]]],
    ],
    ['a quotient', ['Quantity', 3, ['Divide', 'm', ['Power', 's', 'n']]]],
    ['a sum magnitude', ['Quantity', ['Add', 1, 'Pi'], ['Power', 'm', 'n']]],
  ])('%s', (_, json) => {
    const [latex, parsed] = roundTrip(json);
    expect(latex).toMatch(/^\\mathrm\{Quantity\}\(/);
    expect(latex).not.toMatch(/Add|Multiply|Power/);
    expect(parsed).toEqual(ce.box(json).json);
  });

  test('the nested power of a unit', () => {
    const json: MathJsonExpression = [
      'Quantity',
      1,
      ['Power', ['Power', 'm', 1e200], 1e200],
    ];
    const [latex, parsed] = roundTrip(json);
    expect(latex).toMatch(/^\\mathrm\{Quantity\}\(/);
    expect(parsed).toEqual([
      'Quantity',
      1,
      ['Power', 'm', ['Multiply', 1e200, 1e200]],
    ]);
  });

  test('a unit with numeric exponents keeps the unit notation', () => {
    expect(
      roundTrip(['Quantity', 9.8, ['Divide', 'm', ['Power', 's', 2]]])
    ).toEqual([
      '9.8\\,\\mathrm{m/s^{2}}',
      ['Quantity', 9.8, ['Divide', 'm', ['Power', 's', 2]]],
    ]);
  });

  test('a symbol that is not a known unit is written as a function', () => {
    expect(roundTrip(['Quantity', 3, 'foo'])).toEqual([
      '\\mathrm{Quantity}(3, \\mathrm{foo})',
      ['Quantity', 3, 'foo'],
    ]);
  });

  test('the unit day is written `day`, not the differential `d`', () => {
    expect(roundTrip(['Quantity', 3, 'd'])).toEqual([
      '3\\,\\mathrm{day}',
      ['Quantity', 3, 'd'],
    ]);
    expect(roundTrip(['Quantity', 3, ['Divide', 'm', 'd']])).toEqual([
      '3\\,\\mathrm{m/day}',
      ['Quantity', 3, ['Divide', 'm', 'd']],
    ]);
    expect(roundTrip(['Quantity', 3, ['Power', 'd', 2]])).toEqual([
      '3\\,\\mathrm{day^{2}}',
      ['Quantity', 3, ['Power', 'd', 2]],
    ]);
  });

  test('the text form writes the exponent', () => {
    const text = (json: MathJsonExpression) => ce.box(json).toString();
    expect(text(['Quantity', 1, ['Power', 'm', ['Add', 'n', 1]]])).toBe(
      '1 m^(n + 1)'
    );
    expect(text(['Quantity', 1, ['Power', 'm', 'n']])).toBe('1 m^n');
    expect(text(['Quantity', 1, ['Power', 'm', 2]])).toBe('1 m^2');
    expect(text(['Quantity', 1, ['Sqrt', 'm']])).toBe('1 sqrt(m)');
  });

  test('the text form writes a unit root from its parts', () => {
    const text = (json: MathJsonExpression) => ce.box(json).toString();
    expect(text(['Quantity', 3, ['Sqrt', 'Hz']])).toBe('3 sqrt(Hz)');
    expect(text(['Quantity', 3, ['Root', 'Hz', 3]])).toBe('3 root(3)(Hz)');
    expect(text(['Quantity', 3, ['Divide', ['Sqrt', 'Hz'], 'm']])).toBe(
      '3 sqrt(Hz)/m'
    );
    expect(text(['Quantity', 9.8, ['Divide', 'm', ['Power', 's', 2]]])).toBe(
      '9.8 m/s^2'
    );
  });

  test('the text form groups a compound denominator or base', () => {
    const text = (json: MathJsonExpression) => ce.box(json).toString();
    expect(
      text(['Quantity', 3, ['Divide', 'm', ['Multiply', 's', 'kg']]])
    ).toBe('3 m/(kg\u22C5s)');
    // A unit with a numeric exponent takes its canonical form, a quotient of
    // powers of unit symbols. A unit with a symbolic exponent keeps its
    // tree.
    expect(text(['Quantity', 3, ['Power', ['Divide', 'mi', 'h'], 2]])).toBe(
      '3 mi^2/h^2'
    );
    expect(text(['Quantity', 3, ['Power', ['Divide', 'mi', 'h'], 'n']])).toBe(
      '3 (mi/h)^n'
    );
    expect(text(['Quantity', 3, ['Power', 'm', ['Rational', 3, 2]]])).toBe(
      '3 m^(3/2)'
    );
  });
});

describe('LaTeX round trip of every unit of the registry', () => {
  // A unit symbol that is not an ASCII name (`µm`, `Å`, `Ω`) parsed as a
  // MathJSON string, not as a symbol.
  const symbols = unitRegistrySymbols();

  test('the registry has the non-ASCII units', () => {
    for (const s of ['\u00C5', '\u03A9', 'k\u03A9', '\u00B5m', '\u03BCs'])
      expect(symbols).toContain(s);
  });

  test('Quantity(3, unit), a quotient and a power of each unit', () => {
    const failures: string[] = [];
    for (const sym of symbols) {
      const u = { sym };
      for (const unit of [
        u,
        ['Divide', u, 's'],
        ['Power', u, 2],
      ] as MathJsonExpression[]) {
        const q = ce.box(['Quantity', 3, unit]);
        if (!ce.parse(q.latex).isSame(q)) failures.push(q.latex);
      }
    }
    expect(failures).toEqual([]);
  });

  test('Quantity(√2, unit), a quotient and a power of each unit', () => {
    // A magnitude that is not a number literal is written with `\qty`, not
    // juxtaposed with `\mathrm{...}`. The quotient `s/s` is the number 1, a
    // unit with no unit form, so that quantity keeps the function form.
    const failures: string[] = [];
    for (const sym of symbols) {
      const u = { sym };
      for (const unit of [
        u,
        ['Divide', u, 's'],
        ['Power', u, 2],
      ] as MathJsonExpression[]) {
        for (const magnitude of [
          ['Sqrt', 2],
          ['Rational', 1, 64],
          'Pi',
        ] as MathJsonExpression[]) {
          const q = ce.box(['Quantity', magnitude, unit]);
          if (q.latex.includes('\\,\\mathrm{') || !ce.parse(q.latex).isSame(q))
            failures.push(q.latex);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('the ohm sign and the angstrom sign are the units Ω and Å', () => {
    expect(ce.parse('3\\,\\mathrm{\u2126}').json).toEqual([
      'Quantity',
      3,
      { sym: '\u03A9' },
    ]);
    expect(ce.parse('3\\,\\mathrm{\u212B}').json).toEqual([
      'Quantity',
      3,
      { sym: '\u00C5' },
    ]);
  });

  test('Ω is the ohm', () => {
    const ohms = ce.box([
      'Add',
      ['Quantity', 3, { sym: '\u03A9' }],
      ['Quantity', 1, 'ohm'],
    ]);
    expect(ohms.evaluate().toString()).toBe('4 ohm');
    expect(
      ce
        .box(['UnitConvert', ['Quantity', 3, { sym: 'k\u03A9' }], 'ohm'])
        .evaluate()
        .toString()
    ).toBe('3000 ohm');
  });

  test('an exponent applies to all of a compound alias', () => {
    expect(ce.parse('3\\,\\mathrm{mph}').json).toEqual([
      'Quantity',
      3,
      ['Divide', 'mi', 'h'],
    ]);
    expect(ce.parse('3\\,\\mathrm{mph}^2').json).toEqual([
      'Quantity',
      3,
      ['Divide', ['Power', 'mi', 2], ['Power', 'h', 2]],
    ]);
    expect(parseUnitDSL('(mi/h)^2')).toEqual([
      'Power',
      ['Divide', 'mi', 'h'],
      2,
    ]);
    expect(parseUnitDSL('mi/h^2')).toEqual(['Divide', 'mi', ['Power', 'h', 2]]);
  });
});

describe('Commutative matching of a sum with many terms', () => {
  // A root template such as `a·x^n + b` captures all the other terms of the
  // sum with the sequence wildcard `b`. The list of the combinations of
  // `n - 1` of the `n` terms was made by a search that visited every subset
  // of fewer terms, about `2^n` steps: this equation took 39 s.
  test('Solve of a sum of 24 terms that is not a polynomial', () => {
    const terms = Array.from({ length: 23 }, (_, k) => `x^{${k + 1}}`);
    const start = Date.now();
    const roots = ce.parse(`${terms.join('+')}+\\sin(x)=2`).solve('x');
    expect(Date.now() - start).toBeLessThan(4000);
    expect(roots).toBeNull();
  });

  test('a sequence wildcard still captures the other terms', () => {
    const terms: MathJsonExpression[] = Array.from({ length: 25 }, (_, k) => [
      'Power',
      'x',
      k + 2,
    ]);
    const sum = ce.box(['Add', ['Multiply', 3, 'x'], ...terms]);
    const sub = sum.match(['Add', ['Multiply', '_a', 'x'], '__b']);
    expect(sub).not.toBeNull();
    expect(sub!._a.json).toEqual(3);
    expect(sub!.__b.isSame(ce.box(['Add', ...terms]))).toBe(true);
  });
});

describe('Square root and logarithm of an infinity', () => {
  test.each<[MathJsonExpression, string]>([
    [['Sqrt', 'PositiveInfinity'], '+oo'],
    [['Sqrt', 'NegativeInfinity'], '~oo'],
    [['Sqrt', 'ComplexInfinity'], '~oo'],
    // A complex literal with an infinite real part and a finite imaginary
    // part is boxed as the real infinity.
    [['Sqrt', ['Complex', 'PositiveInfinity', 1]], '+oo'],
    [['Ln', 'NegativeInfinity'], '+oo'],
    [['Ln', 'ComplexInfinity'], '~oo'],
    [['Ln', ['Complex', 'NegativeInfinity', 1]], '+oo'],
  ])('%j', (json, expected) => {
    expect(ce.box(json).evaluate().toString()).toBe(expected);
    expect(ce.box(json).N().toString()).toBe(expected);
  });

  test('a complex literal with an infinite part is a named infinity', () => {
    expect(ce.box(['Complex', 'PositiveInfinity', 1]).isInfinity).toBe(true);
    expect(ce.number({ re: Infinity, im: 1 }).isInfinity).toBe(true);
    expect(ce.number({ re: 1, im: Infinity }).isInfinity).toBe(true);
    expect(ce.number({ re: Infinity, im: NaN }).isNaN).toBe(true);
  });
});
