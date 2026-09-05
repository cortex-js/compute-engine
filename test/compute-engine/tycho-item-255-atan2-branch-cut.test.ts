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
    expect(r).toEqual({
      kind: 'singular',
      at: 0,
      continuity: 'right',
      value: { lo: -Math.PI, hi: Math.PI },
    });
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
    if (r.kind === 'singular') expect(r.value).toEqual({ lo: -Math.PI, hi: Math.PI });
  });

  test('Argument of a complex expression still fails closed on the interval target', () => {
    // The item asks for the same contract from `Arg`. The interval lane is
    // real-only and `Arg(x + iy)` has no lowering there, so it is refused
    // rather than answered wrongly; this pins that a future lowering must
    // come with its own branch-cut handling, not a bounded `interval`.
    const r = compile(ce.parse('\\arg(x+iy)'), { to: 'interval-js' });
    expect(r.success).toBe(false);
  });
});
