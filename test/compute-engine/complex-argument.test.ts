import { engine } from '../utils';

// Regression test for P0-8 (CORRECTNESS_FINDINGS.md / WP-1.1): the
// `Argument` evaluate handler built the operator name `'ArcTan2'`
// (capital "T") instead of the real operator `'Arctan2'`, so
// `Argument(1+i).evaluate()` returned the inert, unevaluated symbol
// `ArcTan2(1,1)` forever. `.N()` was equally broken, and `AbsArg`
// (which delegates to `Argument`) inherited the bug.
describe('Argument', () => {
  it('evaluates Argument(1+i) to the exact value pi/4', () => {
    const result = engine
      .expr(['Argument', ['Complex', 1, 1]])
      .evaluate();
    expect(result.isSame(engine.Pi.div(4))).toBe(true);
    expect(result.toString()).not.toMatch(/ArcTan2/i);
  });

  it('numerically approximates Argument(1+i) to pi/4', () => {
    const result = engine.expr(['Argument', ['Complex', 1, 1]]).N();
    const value = result.re;
    expect(value).not.toBeNaN();
    expect(value).toBeCloseTo(Math.PI / 4, 10);
  });

  it('evaluates Argument(-1) to pi', () => {
    const result = engine.expr(['Argument', -1]).evaluate();
    expect(result.isSame(engine.Pi)).toBe(true);
  });

  it('numerically approximates Argument(-1) to pi', () => {
    const value = engine.expr(['Argument', -1]).N().re;
    expect(value).toBeCloseTo(Math.PI, 10);
  });

  it('evaluates Argument(1) to 0', () => {
    const result = engine.expr(['Argument', 1]).evaluate();
    expect(result.isSame(0)).toBe(true);
  });

  it('evaluates Argument in other quadrants correctly', () => {
    expect(
      engine.expr(['Argument', ['Complex', -1, 1]]).N().re
    ).toBeCloseTo((3 * Math.PI) / 4, 10);
    expect(
      engine.expr(['Argument', ['Complex', 1, -1]]).N().re
    ).toBeCloseTo(-Math.PI / 4, 10);
    expect(
      engine.expr(['Argument', ['Complex', -1, -1]]).N().re
    ).toBeCloseTo((-3 * Math.PI) / 4, 10);
  });
});

describe('AbsArg', () => {
  it('produces a sane (magnitude, argument) tuple for 1+i', () => {
    const result = engine.expr(['AbsArg', ['Complex', 1, 1]]).evaluate();
    expect(result.toString()).not.toMatch(/ArcTan2/i);
    const [abs, arg] = result.ops!;
    expect(abs.isSame(engine.expr(2).sqrt())).toBe(true);
    expect(arg.isSame(engine.Pi.div(4))).toBe(true);
  });

  it('numerically approximates both magnitude and argument', () => {
    const result = engine.expr(['AbsArg', ['Complex', 1, 1]]).N();
    const [abs, arg] = result.ops!;
    expect(abs.re).toBeCloseTo(Math.SQRT2, 10);
    expect(arg.re).toBeCloseTo(Math.PI / 4, 10);
  });
});
