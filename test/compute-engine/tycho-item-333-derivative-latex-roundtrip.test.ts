import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 333 (2026-09-28): the LaTeX serializer dropped every variable of
// a derivative after the first. `["D", f, "s", "t"]` was written
// `\frac{\mathrm{d}f}{\mathrm{d}s}`, and `["D", x^3, "x", "x"]` (a second
// derivative) was written as a first derivative, so a round trip through
// LaTeX changed the value.
//
// A `D` with several variable operands is now written in the
// partial-derivative spelling (`\frac{\partial^{3}f}{\partial x^{2}\,\partial
// y}`), which the parser reads back to a flat `D` with the same variables in
// the same order. A `D` with one variable operand keeps the `\mathrm{d}`
// spelling; the parser reads `\frac{\mathrm{d}^{2}f}{\mathrm{d}x^{2}}` back
// to the nested form `["D", ["D", f, x], x]`, which is the form the
// serializer writes that way.

const ce = new ComputeEngine();

type Form = 'raw' | 'structural' | 'canonical';

function roundTrip(latex: string, form: Form) {
  const first = ce.parse(latex, { form });
  const second = ce.parse(first.latex, { form });
  return { first: first.json, latex: first.latex, second: second.json };
}

const CASES: [name: string, latex: string][] = [
  ['mixed partial', '\\frac{\\partial^2}{\\partial s \\partial t}(s^2t^2)'],
  ['mixed partial, symbol', '\\frac{\\partial^2 f}{\\partial s\\,\\partial t}'],
  ['repeated variable', '\\frac{\\partial^2 x^3}{\\partial x^2}'],
  [
    'three variables with a repeat',
    '\\frac{\\partial^3 f}{\\partial x^2\\,\\partial y}',
  ],
  [
    'three variables, non-consecutive repeat',
    '\\frac{\\partial^3 f}{\\partial x\\,\\partial y\\,\\partial x}',
  ],
  [
    'single variable, second order',
    '\\frac{\\mathrm{d}^2 x^3}{\\mathrm{d}x^2}',
  ],
  ['single variable, first order', '\\frac{\\mathrm{d} f}{\\mathrm{d}x}'],
];

describe('TYCHO 333: D with several variables round-trips through LaTeX', () => {
  for (const form of ['raw', 'structural', 'canonical'] as const) {
    for (const [name, latex] of CASES) {
      test(`${name} (${form})`, () => {
        const { first, second } = roundTrip(latex, form);
        expect(second).toEqual(first);
      });
    }
  }

  test('the serialized spellings', () => {
    const latexOf = (json: any) => ce.box(json, { form: 'raw' }).latex;
    expect(latexOf(['D', 'f', 's', 't'])).toBe(
      '\\frac{\\partial^{2}f}{\\partial s\\,\\partial t}'
    );
    expect(latexOf(['D', ['Power', 'x', 3], 'x', 'x'])).toBe(
      '\\frac{\\partial^{2}x^3}{\\partial x^{2}}'
    );
    expect(latexOf(['D', 'f', 'x', 'x', 'y'])).toBe(
      '\\frac{\\partial^{3}f}{\\partial x^{2}\\,\\partial y}'
    );
    // Equal variables that are not consecutive are not grouped: grouping
    // would change the order of the operands.
    expect(latexOf(['D', 'f', 'x', 'y', 'x'])).toBe(
      '\\frac{\\partial^{3}f}{\\partial x\\,\\partial y\\,\\partial x}'
    );
    expect(latexOf(['D', ['D', 'f', 'x'], 'x'])).toBe(
      '\\frac{\\mathrm{d}^{2}f}{\\mathrm{d}x^{2}}'
    );
    expect(latexOf(['D', 'f', 'x'])).toBe('\\frac{\\mathrm{d}f}{\\mathrm{d}x}');
  });

  test('boxed flat D keeps every variable and multiplicity', () => {
    for (const json of [
      ['D', ['Power', 'x', 3], 'x', 'x'],
      ['D', ['Multiply', ['Power', 's', 2], ['Power', 't', 2]], 's', 't'],
      ['D', ['Power', 'x', 3], 'x', 'y', 'x'],
    ] as any[]) {
      const expr = ce.box(json);
      expect(ce.parse(expr.latex).json).toEqual(expr.json);
    }
  });

  test('a term after the derivative stays outside it', () => {
    const expr = ce.box(['Add', ['D', ['Add', 'x', 'y'], 'x', 'y'], 1]);
    expect(expr.latex).toBe(
      '\\frac{\\partial^{2}(x+y)}{\\partial x\\,\\partial y}+1'
    );
    expect(ce.parse(expr.latex).json).toEqual(expr.json);
  });

  test('the re-parsed mixed partial of s^2 t^2 at s=2, t=3 is 24', () => {
    const original = ce.parse(
      '\\frac{\\partial^2}{\\partial s \\partial t}(s^2t^2)'
    );
    const reparsed = ce.parse(original.latex);
    const value = reparsed.evaluate().subs({ s: 2, t: 3 }).evaluate();
    expect(value.json).toBe(24);
  });

  test('the re-parsed second derivative of x^3 at x=2 is 12', () => {
    const expr = ce.box(['D', ['Power', 'x', 3], 'x', 'x']);
    const value = ce.parse(expr.latex).evaluate().subs({ x: 2 }).evaluate();
    expect(value.json).toBe(12);
  });
});

describe('TYCHO 333: nested and non-symbol variables', () => {
  const latexOf = (json: any) => ce.box(json, { form: 'raw' }).latex;
  const rawRoundTrip = (json: any) =>
    ce.parse(latexOf(json), { form: 'raw' }).json;

  // A nested `D` is folded into the order of the outer `D` only when it has
  // exactly one variable, the same symbol. Otherwise it is the differentiand,
  // written in its own spelling, so none of its variables is lost.
  test('a multi-variable inner D is not folded', () => {
    const cases: [json: any, latex: string][] = [
      [
        ['D', ['D', 'f', 'x', 'y'], 'x'],
        '\\frac{\\mathrm{d}\\frac{\\partial^{2}f}{\\partial x\\,\\partial y}}{\\mathrm{d}x}',
      ],
      [
        ['D', ['D', 'f', 'x', 'x'], 'x'],
        '\\frac{\\mathrm{d}\\frac{\\partial^{2}f}{\\partial x^{2}}}{\\mathrm{d}x}',
      ],
      [
        ['D', ['D', 'f', 'x'], 'y', 'z'],
        '\\frac{\\partial^{2}\\frac{\\mathrm{d}f}{\\mathrm{d}x}}{\\partial y\\,\\partial z}',
      ],
    ];
    for (const [json, latex] of cases) {
      expect(latexOf(json)).toBe(latex);
      expect(rawRoundTrip(json)).toEqual(json);
    }
    // A term after the derivative stays outside it.
    const sum = ['Add', ['D', ['D', 'f', 'x', 'y'], 'x'], 1];
    expect(rawRoundTrip(sum)).toEqual(sum);
  });

  // A `["Set", x, n]` order pair is expanded into `n` copies of `x`, as the
  // canonical form of `D` reads it. Any other non-symbol variable falls back
  // to the function-call spelling, which reads back unchanged.
  test('an order pair is expanded, other non-symbol variables use D(…)', () => {
    expect(latexOf(['D', 'f', ['Set', 'x', 2], 'y'])).toBe(
      '\\frac{\\partial^{3}f}{\\partial x^{2}\\,\\partial y}'
    );
    expect(rawRoundTrip(['D', 'f', ['Set', 'x', 2], 'y'])).toEqual([
      'D',
      'f',
      'x',
      'x',
      'y',
    ]);
    expect(latexOf(['D', 'f', ['Set', 'x', 3]])).toBe(
      '\\frac{\\partial^{3}f}{\\partial x^{3}}'
    );
    expect(ce.parse(latexOf(['D', 'f', ['Set', 'x', 2], 'y'])).json).toEqual(
      ce.box(['D', 'f', ['Set', 'x', 2], 'y']).json
    );

    expect(latexOf(['D', 'f', 2, 'y'])).toBe('\\operatorname{D}(f, 2, y)');
    expect(rawRoundTrip(['D', 'f', 2, 'y'])).toEqual(['D', 'f', 2, 'y']);
    // A pair past the order cap is not expanded by the canonical form, so
    // it is not expanded here either.
    expect(rawRoundTrip(['D', 'f', ['Set', 'x', 2000], 'z'])).toEqual([
      'D',
      'f',
      ['Set', 'x', 2000],
      'z',
    ]);
    expect(latexOf(['D', 'f', ['Tuple', 'x', 'y'], 'z'])).toMatch(
      /^\\operatorname\{D\}\(/
    );
  });

  test('subscripted and multi-letter symbols round-trip with a power', () => {
    for (const json of [
      ['D', 'f', 'x_1', 'x_1'],
      ['D', 'f', 'alpha', 'alpha', 'y'],
      ['D', 'f', 'speed', 'speed'],
      ['D', 'f', 'x_1', 'y', 'x_1'],
    ] as any[])
      expect(rawRoundTrip(json)).toEqual(json);
    expect(latexOf(['D', 'f', 'x_1', 'x_1'])).toBe(
      '\\frac{\\partial^{2}f}{\\partial x_1^{2}}'
    );
  });
});

describe('TYCHO 333: parsing of partial-derivative denominators', () => {
  const raw = (latex: string, options: object = {}) =>
    ce.parse(latex, { form: 'raw', ...options }).json;

  // `\partial^n x` in a denominator repeats `x` n times, whether it is the
  // first term or a later term of the chain.
  test('a degree on the partial repeats the variable', () => {
    expect(raw('\\frac{\\partial^2 f}{\\partial^2 x}')).toEqual([
      'D',
      'f',
      'x',
      'x',
    ]);
    expect(raw('\\frac{\\partial^3 f}{\\partial x\\,\\partial^2 y}')).toEqual([
      'D',
      'f',
      'x',
      'y',
      'y',
    ]);
    expect(raw('\\frac{\\partial^3 f}{\\partial^2 x\\,\\partial y}')).toEqual([
      'D',
      'f',
      'x',
      'x',
      'y',
    ]);
    expect(raw('\\frac{\\partial^3 f}{\\partial^2 x\\partial y}')).toEqual([
      'D',
      'f',
      'x',
      'x',
      'y',
    ]);
  });

  // With the `skipSpace` option off, `{}` between two terms of a chain is
  // still skipped.
  test('`{}` between chain terms with skipSpace off', () => {
    expect(
      raw('\\frac{\\partial^{2}f}{\\partial x{}\\partial y}', {
        skipSpace: false,
      })
    ).toEqual(['D', 'f', 'x', 'y']);
    expect(raw('\\frac{\\partial^{2}f}{\\partial x{}\\partial y}')).toEqual([
      'D',
      'f',
      'x',
      'y',
    ]);
  });

  // The denominator decides the variables: a numerator degree that does not
  // match their number is ignored.
  test('a numerator degree that disagrees with several variables', () => {
    expect(raw('\\frac{\\partial^{5} f}{\\partial x\\,\\partial y}')).toEqual([
      'D',
      'f',
      'x',
      'y',
    ]);
  });
});
