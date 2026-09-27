import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 166 (2026-08-11): `D`'s Leibniz serialization emitted the
// differentiand undelimited and trailing the fraction, so any `D` with a right
// neighbour re-parsed as a different expression:
//
//   ["Add", ["D", ["Subtract","x","d_t"], "y"], 1]
//     -> \frac{\mathrm{d}}{\mathrm{d}y}x-d_{t}+1
//     -> ["D", ["Add", ["Negate","d_t"], "x", 1], "y"]     <- the +1 absorbed
//
// The isolated case round-tripped only because the parser's greed happened to
// re-absorb exactly what was emitted.
//
// Delimiting the body is NOT sufficient: the differentiand is parsed at
// `ADDITION_PRECEDENCE`, so the parser keeps consuming past a closing
// delimiter (`\frac{d}{dy}(x-d_t)+1` still re-read as `D((x-d_t)+1, y)`).
// A COMPOUND differentiand therefore folds into the NUMERATOR
// (`\frac{\mathrm{d}(x-d_t)}{\mathrm{d}y}`), which the parser already accepts
// (the `numerFn` route) and which is self-delimiting by construction.
//
// The parser's greed is deliberately NOT narrowed — Tycho asked us not to,
// since documents rely on the current trailing binding.
//
// A TIGHT differentiand (`x`, `x^2`, `\sin(x)`) folds into the numerator too
// (2026-09-27). The trailing spelling `\frac{\mathrm{d}}{\mathrm{d}x}x+1`
// re-read as `D(x + 1, x)` for the same reason as above, and the `D`
// serializer cannot see whether a term follows the derivative, so it always
// uses the folded spelling.

describe('Tycho item 166: D delimits a compound differentiand', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  const roundTrips = (json: any) => {
    const e = ce.box(json);
    return ce.parse(e.latex).canonical.isSame(e.canonical);
  };

  describe('round-trip integrity', () => {
    test('an isolated D with a compound body', () => {
      expect(roundTrips(['D', ['Subtract', 'x', 'd_t'], 'y'])).toBe(true);
    });

    test('a D with a right neighbour — the filed break', () => {
      expect(roundTrips(['Add', ['D', ['Subtract', 'x', 'd_t'], 'y'], 1])).toBe(
        true
      );
    });

    test('the corpus row (neyret/oeupgr064p row 10)', () => {
      expect(
        roundTrips([
          'Add',
          ['Multiply', 'F_s', ['D', 'x', 'y']],
          ['Multiply', 'F_t', ['D', ['Subtract', 'x', 'd_t'], 'y']],
          ['Multiply', 'F_c', ['D', ['Subtract', 'x', 'd_g'], 'y']],
        ])
      ).toBe(true);
    });

    test('a second-order derivative of a compound body', () => {
      expect(
        roundTrips(['D', ['D', ['Subtract', 'x', 'd_t'], 'y'], 'y'])
      ).toBe(true);
    });

    test('a Multiply body (also loose infix)', () => {
      expect(roundTrips(['D', ['Multiply', 2, 'x'], 'y'])).toBe(true);
      expect(roundTrips(['Add', ['D', ['Multiply', 2, 'x'], 'y'], 1])).toBe(true);
    });
  });

  describe('the compound spelling folds into the numerator', () => {
    test('first order', () => {
      expect(ce.box(['D', ['Subtract', 'x', 'd_t'], 'y']).latex).toBe(
        '\\frac{\\mathrm{d}(x-d_{t})}{\\mathrm{d}y}'
      );
    });

    test('second order', () => {
      expect(
        ce.box(['D', ['D', ['Subtract', 'x', 'd_t'], 'y'], 'y']).latex
      ).toBe('\\frac{\\mathrm{d}^{2}(x-d_{t})}{\\mathrm{d}y^{2}}');
    });
  });

  describe('a TIGHT differentiand also folds into the numerator', () => {
    // A trailing tight differentiand absorbed the next term on re-parse
    // (`\frac{\mathrm{d}}{\mathrm{d}x}x+1` -> `D(x + 1, x)`), so the
    // serializer no longer emits the trailing spelling.
    test('a bare symbol', () => {
      expect(ce.box(['D', 'x', 'y']).latex).toBe(
        '\\frac{\\mathrm{d}x}{\\mathrm{d}y}'
      );
    });

    test('a function application', () => {
      expect(ce.box(['D', ['Sin', 'x'], 'y']).latex).toBe(
        '\\frac{\\mathrm{d}\\sin(x)}{\\mathrm{d}y}'
      );
    });

    test('a power', () => {
      expect(ce.box(['D', ['Power', 'x', 2], 'x']).latex).toBe(
        '\\frac{\\mathrm{d}x^2}{\\mathrm{d}x}'
      );
    });

    test('second order, tight', () => {
      expect(ce.box(['D', ['D', ['Power', 'x', 2], 'x'], 'x']).latex).toBe(
        '\\frac{\\mathrm{d}^{2}x^2}{\\mathrm{d}x^{2}}'
      );
    });

    test('tight bodies still round-trip', () => {
      expect(roundTrips(['D', 'x', 'y'])).toBe(true);
      expect(roundTrips(['D', ['Sin', 'x'], 'y'])).toBe(true);
      expect(roundTrips(['D', ['Power', 'x', 2], 'x'])).toBe(true);
    });
  });

  describe('a tight differentiand with a neighbour round-trips', () => {
    // Each of these re-parsed with the neighbour absorbed into the
    // differentiand while the tight body trailed the fraction.
    test('D(x, x) + 1', () => {
      expect(roundTrips(['Add', ['D', 'x', 'x'], 1])).toBe(true);
    });

    test('D(x^2, x) + 1', () => {
      expect(roundTrips(['Add', ['D', ['Power', 'x', 2], 'x'], 1])).toBe(true);
    });

    test('D(sin(x), x) + 1', () => {
      expect(roundTrips(['Add', ['D', ['Sin', 'x'], 'x'], 1])).toBe(true);
    });

    test('second order: D(D(x^3, x), x) + 1', () => {
      expect(
        roundTrips(['Add', ['D', ['D', ['Power', 'x', 3], 'x'], 'x'], 1])
      ).toBe(true);
    });

    test('2 * D(x, x) * 3, structural', () => {
      // Structural form keeps the three factors, so the derivative is not
      // the last factor of the product.
      const e = ce.function(
        'Multiply',
        [ce.number(2), ce.box(['D', 'x', 'x']), ce.number(3)],
        { form: 'structural' }
      );
      expect(e.latex).toBe('2\\frac{\\mathrm{d}x}{\\mathrm{d}x}\\times3');
      expect(ce.parse(e.latex).isSame(e.canonical)).toBe(true);
    });

    test('2 * D(x, x) * 3, canonical', () => {
      expect(roundTrips(['Multiply', 2, ['D', 'x', 'x'], 3])).toBe(true);
    });

    test('D(x, x) = 1', () => {
      expect(roundTrips(['Equal', ['D', 'x', 'x'], 1])).toBe(true);
    });

    test('the serialized sum keeps the neighbour outside the fraction', () => {
      expect(ce.box(['Add', ['D', 'x', 'x'], 1]).latex).toBe(
        '\\frac{\\mathrm{d}x}{\\mathrm{d}x}+1'
      );
    });
  });

  describe('the control that showed the machinery existed', () => {
    test('Sin in a sum still round-trips', () => {
      expect(
        roundTrips([
          'Add',
          ['Sin', ['Subtract', 'x', 'd_t']],
          1,
        ])
      ).toBe(true);
    });
  });
});
