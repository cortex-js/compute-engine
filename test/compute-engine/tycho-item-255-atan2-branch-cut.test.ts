import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval';

/**
 * Tycho item 255 — `Arctan2(y, x)` over a box that straddles its branch cut
 * (`y = 0`, `x < 0`) answered a bounded `interval` of `[−π, π]`. The angle
 * jumps there from `+π` (the value at `y = 0`, reached from above) to `−π`
 * (the limit from below), so `atan2(y, x) − 3` has opposite signs at the two
 * ends of such a box and NO zero inside it; a consumer that reads a bounded
 * `interval` as "continuous on the cell" drew a false crossing.
 *
 * The item-239 contract applies: a finite jump answers `singular` WITH the
 * enclosure, located at the cut (`at` is in the first operand's coordinate,
 * `y = 0`), and the value at the cut belongs to the upper side
 * (`continuity: 'right'`). Every operation propagates it (`liftJump`).
 *
 * The same cut is crossed the other way when `y` is 0 and the `x` range
 * reaches both sides of zero: the angle is `π` for `x < 0` and `0` for
 * `x > 0`, so the jump is at `x = 0` — a location in the SECOND operand's
 * coordinate, which `atOperand: 1` reports. The second `describe` below pins
 * that half, the degenerate boxes on the line `x = 0`, and the reading of a
 * signed-zero endpoint.
 */

const ce = new ComputeEngine();
const box = (
  x: [number, number],
  y: [number, number]
): Record<string, { lo: number; hi: number }> => ({
  x: { lo: x[0], hi: x[1] },
  y: { lo: y[0], hi: y[1] },
});

describe('Tycho item 255: Arctan2 across its branch cut', () => {
  const fn = compile(ce.box(['Arctan2', 'y', 'x']), { to: 'interval-js' });
  const shifted = compile(ce.box(['Subtract', ['Arctan2', 'y', 'x'], 3]), {
    to: 'interval-js',
  });

  test('a box straddling the cut is a finite jump with the enclosure [−π, π]', () => {
    const r = fn.run!(box([-1.2, -0.8], [-0.1, 0.1]));
    expect(r.kind).toBe('singular');
    expect(r.at).toBe(0);
    expect(r.continuity).toBe('right');
    // No `atOperand`: the location is in the first operand's coordinate, `y`.
    expect(r.atOperand).toBeUndefined();
    // The hull is an ENCLOSURE of the real [−π, π]: `Math.PI` is below the
    // real π that the function attains on the cut, so the endpoints are the
    // doubles just outside ±Math.PI.
    expect(r.value.lo).toBeLessThan(-Math.PI);
    expect(r.value.hi).toBeGreaterThan(Math.PI);
    expect(r.value.lo).toBeCloseTo(-Math.PI, 14);
    expect(r.value.hi).toBeCloseTo(Math.PI, 14);
  });

  test('the jump propagates through the operations above it', () => {
    const r = shifted.run!(box([-1.2, -0.8], [-0.1, 0.1]));
    expect(r.kind).toBe('singular');
    expect(r.at).toBe(0);
    expect(r.value.lo).toBeCloseTo(-Math.PI - 3, 12);
    expect(r.value.hi).toBeCloseTo(Math.PI - 3, 12);
  });

  test('a box touching the cut from BELOW contains the jump', () => {
    // The value at y = 0 is +π; every y < 0 in the box is near −π.
    expect(fn.run!(box([-1.2, -0.8], [-0.1, 0])).kind).toBe('singular');
  });

  test('a box touching the cut from ABOVE is continuous', () => {
    const r = fn.run!(box([-1.2, -0.8], [0, 0.1]));
    expect(r.kind).toBe('interval');
    expect(r.value.hi).toBeCloseTo(Math.PI, 12);
    expect(r.value.lo).toBeCloseTo(Math.atan2(0.1, -0.8), 12);
  });

  test('a box containing the origin contains the cut', () => {
    expect(fn.run!(box([-1, 1], [-1, 1])).kind).toBe('singular');
  });

  test('a box on the right half-plane is continuous across y = 0', () => {
    const r = fn.run!(box([0.5, 1], [-1, 1]));
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeCloseTo(Math.atan2(-1, 0.5), 12);
    expect(r.value.hi).toBeCloseTo(Math.atan2(1, 0.5), 12);
  });

  test('a clear box away from the cut is unchanged', () => {
    const r = shifted.run!(box([0.5, 1], [0.5, 1]));
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeCloseTo(Math.atan2(0.5, 1) - 3, 12);
    expect(r.value.hi).toBeCloseTo(Math.atan2(1, 0.5) - 3, 12);
  });

  test('the kernel answers the same jump directly', () => {
    const r = IA.atan2({ lo: -0.1, hi: 0.1 }, { lo: -1.2, hi: -0.8 });
    expect(r.kind).toBe('singular');
    if (r.kind === 'singular') {
      // The same enclosure as above: the doubles just outside ±Math.PI.
      expect(r.value.lo).toBeLessThan(-Math.PI);
      expect(r.value.hi).toBeGreaterThan(Math.PI);
      expect(r.value.lo).toBeCloseTo(-Math.PI, 14);
      expect(r.value.hi).toBeCloseTo(Math.PI, 14);
    }
  });

  test('Argument of a complex expression inherits the same branch cut', () => {
    // The item asks for the same contract from `Arg`. The interval lane is
    // real-only, so `Arg(x + iy)` compiles only by splitting the value into
    // its two REAL parts and reading the phase off `atan2` of them — which
    // brings this kernel's branch-cut handling with it, rather than the
    // bounded `interval` the item refused.
    const r = compile(ce.parse('\\arg(x+iy)'), { to: 'interval-js' });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_IA.atan2(_.y, _.x)');
    const cut = r.run!(box([-1.2, -0.8], [-0.1, 0.1]));
    expect(cut.kind).toBe('singular');
    expect(cut.at).toBe(0);
    expect(cut.continuity).toBe('right');
    const clear = r.run!(box([0.5, 1], [0.5, 1]));
    expect(clear.kind).toBe('interval');
    expect(clear.value.lo).toBeCloseTo(Math.atan2(0.5, 1), 12);
    expect(clear.value.hi).toBeCloseTo(Math.atan2(1, 0.5), 12);
  });
});

describe('Arctan2 across its branch cut along x', () => {
  const fn = compile(ce.box(['Arctan2', 'y', 'x']), { to: 'interval-js' });
  const shifted = compile(ce.box(['Subtract', ['Arctan2', 'y', 'x'], 3]), {
    to: 'interval-js',
  });

  test('y = [0, 0] with an x range that reaches both sides of zero jumps', () => {
    // The box is the segment of the real axis from −1 to 1. The angle is π on
    // its left half and 0 on its right half: two values and nothing between
    // them, so a bounded `interval` of [0, π] would let a sign test read a
    // crossing at any level in between.
    const r = fn.run!(box([-1, 1], [0, 0]));
    expect(r.kind).toBe('singular');
    expect(r.at).toBe(0);
    // The location is an `x` value, which is the SECOND operand.
    expect(r.atOperand).toBe(1);
    // `Math.atan2(0, 0)` is 0, the limit from x > 0.
    expect(r.continuity).toBe('right');
    expect(r.value.lo).toBeCloseTo(0, 15);
    expect(r.value.hi).toBeGreaterThan(Math.PI);
    expect(r.value.hi).toBeCloseTo(Math.PI, 14);
  });

  test('the x jump propagates through the operations above it', () => {
    const r = shifted.run!(box([-1, 1], [0, 0]));
    expect(r.kind).toBe('singular');
    expect(r.at).toBe(0);
    expect(r.atOperand).toBe(1);
    expect(r.value.lo).toBeCloseTo(-3, 12);
    expect(r.value.hi).toBeCloseTo(Math.PI - 3, 12);
  });

  test('an x range that reaches zero only at its end still jumps', () => {
    for (const x of [
      [-1, 0],
      [-1, -0],
      [0, 0.0001],
    ] as [number, number][]) {
      const r = fn.run!(box(x, [0, 0]));
      // [0, 0.0001] holds no negative x, so it is the one box of the three
      // that carries no jump: the angle is 0 on all of it.
      expect(r.kind).toBe(x[0] < 0 ? 'singular' : 'interval');
    }
  });

  test('a signed-zero y endpoint reads as the real zero', () => {
    // −0 and +0 are the same real number, so a box with either as its y range
    // is the same set of points and answers the same jump. IEEE would give
    // `Math.atan2(-0, -1)` the value −π and `Math.atan2(0, -1)` the value +π;
    // the kernel takes the principal angle, +π.
    for (const y of [
      [-0, -0],
      [-0, 0],
      [0, -0],
    ] as [number, number][]) {
      const r = fn.run!(box([-1, 1], y));
      expect(r.kind).toBe('singular');
      expect(r.at).toBe(0);
      expect(r.atOperand).toBe(1);
      expect(r.value.lo).toBeCloseTo(0, 15);
      expect(r.value.hi).toBeCloseTo(Math.PI, 14);
    }
  });

  test('a strip just above y = 0 that straddles x = 0 holds the origin', () => {
    // The box contains the origin, where the angle has no limit: along y = 0
    // it is π to the left of the origin and 0 to the right of it.
    const r = fn.run!(box([-1, 1], [0, 0.25]));
    expect(r.kind).toBe('singular');
    expect(r.at).toBe(0);
    expect(r.atOperand).toBe(1);
    expect(r.value.lo).toBeCloseTo(0, 15);
    expect(r.value.hi).toBeCloseTo(Math.PI, 14);
  });

  test('an x range wholly on one side of zero at y = 0 is continuous', () => {
    for (const x of [
      [0.5, 1],
      [-1, -0.5],
    ] as [number, number][]) {
      const r = fn.run!(box(x, [0, 0]));
      expect(r.kind).toBe('interval');
      expect(r.value.lo).toBeCloseTo(x[0] < 0 ? Math.PI : 0, 14);
      expect(r.value.hi).toBeCloseTo(x[0] < 0 ? Math.PI : 0, 14);
    }
  });

  test('the degenerate box x = [0, 0] with y across zero jumps', () => {
    // On the line x = 0 the angle is π/2 above the origin, −π/2 below it and
    // 0 at the origin: three values and nothing in between.
    const r = fn.run!(box([0, 0], [-1, 1]));
    expect(r.kind).toBe('singular');
    expect(r.at).toBe(0);
    // The location is a `y` value, the first operand, so no `atOperand`.
    expect(r.atOperand).toBeUndefined();
    // The value at the origin is neither the limit from above (π/2) nor the
    // limit from below (−π/2), so no side is reported.
    expect(r.continuity).toBeUndefined();
    expect(r.value.lo).toBeLessThan(-Math.PI / 2);
    expect(r.value.hi).toBeGreaterThan(Math.PI / 2);
    expect(r.value.lo).toBeCloseTo(-Math.PI / 2, 14);
    expect(r.value.hi).toBeCloseTo(Math.PI / 2, 14);
  });

  test('the degenerate box x = [0, 0] with y on one side of zero jumps', () => {
    const above = fn.run!(box([0, 0], [0, 1]));
    expect(above.kind).toBe('singular');
    expect(above.at).toBe(0);
    expect(above.value.lo).toBeCloseTo(0, 15);
    expect(above.value.hi).toBeCloseTo(Math.PI / 2, 14);

    const below = fn.run!(box([0, 0], [-1, 0]));
    expect(below.kind).toBe('singular');
    expect(below.at).toBe(0);
    expect(below.value.lo).toBeCloseTo(-Math.PI / 2, 14);
    expect(below.value.hi).toBeCloseTo(0, 15);
  });

  test('the degenerate box x = [0, 0] away from zero is continuous', () => {
    const r = fn.run!(box([0, 0], [0.5, 1]));
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeCloseTo(Math.PI / 2, 14);
    expect(r.value.hi).toBeCloseTo(Math.PI / 2, 14);
  });

  test('the origin as a point box answers the principal angle 0', () => {
    // A point box cannot be subdivided, so it answers a value rather than a
    // jump. Either sign of zero names the origin, and the principal angle
    // there is 0 — the value `Math.atan2(0, 0)` gives.
    for (const x of [
      [0, 0],
      [-0, -0],
    ] as [number, number][]) {
      const r = IA.atan2({ lo: 0, hi: 0 }, { lo: x[0], hi: x[1] });
      expect(r.kind).toBe('interval');
      if (r.kind === 'interval') {
        expect(r.value.lo).toBeCloseTo(0, 15);
        expect(r.value.hi).toBeCloseTo(0, 15);
      }
    }
  });

  test('the kernel answers the same x jump directly', () => {
    const r = IA.atan2({ lo: 0, hi: 0 }, { lo: -1, hi: 1 });
    expect(r.kind).toBe('singular');
    if (r.kind === 'singular') {
      expect(r.at).toBe(0);
      expect(r.atOperand).toBe(1);
      expect(r.continuity).toBe('right');
      expect(r.value!.hi).toBeGreaterThan(Math.PI);
      expect(r.value!.hi).toBeCloseTo(Math.PI, 14);
    }
  });

  test('a jump in x combined with a jump in y locates nothing', () => {
    // `sign(y)` jumps at y = 0 and `atan2(y, x)` jumps at x = 0 over this
    // box. Both locations are the number 0, in different coordinates, so the
    // product reports the jump with its enclosure but with no location: a
    // consumer cannot be told which axis to subdivide along.
    const product = compile(
      ce.box(['Multiply', ['Sign', 'y'], ['Arctan2', 'y', 'x']]),
      { to: 'interval-js' }
    );
    const r = product.run!(box([-1, 1], [0, 0.5]));
    expect(r.kind).toBe('singular');
    expect(r.at).toBeUndefined();
    expect(r.atOperand).toBeUndefined();
    expect(r.value.hi).toBeCloseTo(Math.PI, 12);

    // A jump in one coordinate only keeps its location: `floor(y)` jumps at
    // y = 1, later than the angle's jump at x = 0, so the angle's location
    // wins and carries its operand with it.
    const withFloor = compile(
      ce.box(['Multiply', ['Floor', 'y'], ['Arctan2', 'y', 'x']]),
      { to: 'interval-js' }
    );
    const s = withFloor.run!(box([-1, 1], [0, 1.5]));
    expect(s.kind).toBe('singular');
    expect(s.at).toBe(0);
    expect(s.atOperand).toBe(1);
  });

  test('Argument of a real expression reports the jump across zero', () => {
    // `Arg(x + i·0)` is the phase of a real number: 0 for x > 0 and π for
    // x < 0. It lowers through this kernel with a point zero as its first
    // operand, so a box of x that reaches both sides of zero answers the
    // jump rather than the bounded `interval` a sign test would misread.
    const r = compile(ce.parse('\\arg(x+\\imaginaryI\\cdot 0)'), {
      to: 'interval-js',
    });
    expect(r.success).toBe(true);
    // The zero is bound in the constant table the preamble carries
    // (`hoistIntervalConstants`).
    expect(r.preamble).toContain('const _k1 = _IA.point(0);');
    expect(r.code).toBe('_IA.atan2(_k1, _.x)');
    const straddle = r.run!({ x: { lo: -1, hi: 1 } });
    expect(straddle.kind).toBe('singular');
    expect(straddle.at).toBe(0);
    expect(straddle.atOperand).toBe(1);
    expect(straddle.continuity).toBe('right');
    expect(straddle.value.hi).toBeCloseTo(Math.PI, 14);

    const positive = r.run!({ x: { lo: 0.5, hi: 2 } });
    expect(positive.kind).toBe('interval');
    expect(positive.value.hi).toBeCloseTo(0, 15);
  });
});
