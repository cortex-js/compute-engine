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
// since documents rely on the current trailing binding — so a TIGHT atom still
// serializes exactly as before.

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

  describe('a TIGHT differentiand keeps the previous spelling', () => {
    // The parser's greed is unchanged, so these must not move — otherwise
    // every document relying on the trailing binding re-baselines.
    test('a bare symbol', () => {
      expect(ce.box(['D', 'x', 'y']).latex).toBe(
        '\\frac{\\mathrm{d}}{\\mathrm{d}y}x'
      );
    });

    test('a function application', () => {
      expect(ce.box(['D', ['Sin', 'x'], 'y']).latex).toBe(
        '\\frac{\\mathrm{d}}{\\mathrm{d}y}\\sin(x)'
      );
    });

    test('a power', () => {
      expect(ce.box(['D', ['Power', 'x', 2], 'x']).latex).toBe(
        '\\frac{\\mathrm{d}}{\\mathrm{d}x}x^2'
      );
    });

    test('second order, tight', () => {
      expect(ce.box(['D', ['D', ['Power', 'x', 2], 'x'], 'x']).latex).toBe(
        '\\frac{\\mathrm{d}^{2}}{\\mathrm{d}x^{2}}x^2'
      );
    });

    test('tight bodies still round-trip', () => {
      expect(roundTrips(['D', 'x', 'y'])).toBe(true);
      expect(roundTrips(['D', ['Sin', 'x'], 'y'])).toBe(true);
      expect(roundTrips(['D', ['Power', 'x', 2], 'x'])).toBe(true);
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
