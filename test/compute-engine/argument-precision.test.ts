import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// `Argument` of a complex value carries the digits asked for under `.N()`:
// its angle is the bignum `atan2(im, re)` that `Arctan2` computes, not the
// double `Math.atan2` of the parts. `N(Argument(e + iπ), 25)` was
// 0.8575117863558462702910252, wrong from the 17th digit.
//
// The reference values are mpmath's `atan2(pi, e)` and `atan2(pi, 2)` at 60
// digits.
describe('Argument digits past a double', () => {
  const savedPrecision = BigDecimal.precision;
  const ce = new ComputeEngine();
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  const eIPi = ['Add', 'ExponentialE', ['Multiply', 'Pi', ['Complex', 0, 1]]];
  const twoIPi = ['Add', 2, ['Multiply', 'Pi', ['Complex', 0, 1]]];
  const atan2PiE =
    '0.8575117863558462650068677509328975318384703817777913140157';
  const atan2PiTwo =
    '1.00388482185388721414842394491713228829210446059487057472971';

  const cases: [string, any, number, string][] = [
    ['Argument', eIPi, 25, atan2PiE],
    ['Arg', eIPi, 25, atan2PiE],
    ['Argument', eIPi, 50, atan2PiE],
    ['Argument', twoIPi, 25, atan2PiTwo],
    ['Argument', twoIPi, 50, atan2PiTwo],
    ['Arctan2', ['Sequence', 'Pi', 'ExponentialE'], 25, atan2PiE],
  ];
  for (const [head, z, digits, truth] of cases) {
    const expected = truth.slice(0, digits + 1);
    test(`N(${head}(${JSON.stringify(z)}), ${digits}) = ${expected}`, () => {
      ce.precision = 50;
      const args = z[0] === 'Sequence' ? z.slice(1) : [z];
      const r = ce.expr(['N', [head, ...args], digits]).evaluate();
      expect(r.toString().startsWith(expected.slice(0, digits))).toBe(true);
      // `.N()` on the boxed call reads the engine precision
      ce.precision = digits + 5;
      const n = ce.expr([head, ...args]).N();
      expect(n.toString().startsWith(expected.slice(0, digits))).toBe(true);
    });
  }

  // On a default engine, `N(x, d)` with d around the engine precision runs a
  // second pass at d + 10; the argument must not fall back to doubles there.
  for (const digits of [16, 20, 25, 30, 40]) {
    test(`N(Argument(e + iπ), ${digits}) on a default engine`, () => {
      const fresh = new ComputeEngine();
      const r = fresh.expr(['N', ['Argument', eIPi], digits]).evaluate();
      expect(r.toString().startsWith(atan2PiE.slice(0, digits))).toBe(true);
    });
  }

  test('Argument of a bignum complex literal, evaluate and N agree', () => {
    ce.precision = 40;
    const z = ce.expr(eIPi).N();
    const viaN = ce.expr(['Argument', z.json]).N().toString();
    const viaEvaluate = ce.expr(['Argument', z.json]).evaluate().toString();
    expect(viaN).toBe(viaEvaluate);
    expect(viaN.startsWith(atan2PiE.slice(0, 35))).toBe(true);
  });

  test('exact input stays exact under evaluate()', () => {
    ce.precision = 50;
    expect(ce.expr(['Argument', ['Complex', 1, 1]]).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 4],
      'Pi',
    ]);
    expect(
      ce.expr(['Argument', ['Complex', 123, -456]]).evaluate().json
    ).toEqual(['Arctan', ['Rational', -152, 41]]);
    expect(ce.expr(['Argument', -3]).evaluate().json).toEqual('Pi');
  });

  test('Argument(∞·i) is unchanged', () => {
    ce.precision = 50;
    const z = ['Multiply', 'PositiveInfinity', ['Complex', 0, 1]];
    // Indeterminate when exact, NaN as a float
    expect(ce.expr(['Argument', z]).evaluate().toString()).toBe(
      'Indeterminate'
    );
    expect(
      ce
        .expr(['N', ['Argument', z], 25])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('double precision is unchanged', () => {
    ce.precision = 'machine';
    const v = ce.expr(['Argument', ['Complex', 3, 4]]).N().re;
    expect(v).toBe(Math.atan2(4, 3));
  });

  test('default N() of a float complex is as Arctan2 and as before', () => {
    // The engine's default precision (21 digits) is not widened by Argument
    const fresh = new ComputeEngine();
    const r = fresh
      .expr(['Argument', ['Complex', 0.1, 0.2]])
      .N()
      .toString();
    expect(r).toBe(fresh.expr(['Arctan2', 0.2, 0.1]).N().toString());
    expect(r).toBe('1.10714871779409050302');
    fresh.precision = 'machine';
    expect(fresh.expr(['Argument', ['Complex', 0.1, 0.2]]).N().re).toBe(
      Math.atan2(0.2, 0.1)
    );
  });
});
