/**
 * `options.precision` in the options of an `evaluate` handler (GitHub issue
 * #393, item 3).
 *
 * - Under a numeric approximation, it is the number of digits requested by
 *   the enclosing `N(x, p)`, or else `ce.precision`.
 * - In an exact evaluation, it is `undefined`.
 * - `N(x, p)` with `p` above the engine precision still raises
 *   `ce.precision` and leaves it raised (issue #391); that is not changed.
 */
import { ComputeEngine } from '../../src/compute-engine';

type Seen = { numeric: boolean | undefined; precision: number | undefined };

function engineWithRecorder(): { ce: ComputeEngine; seen: Seen[] } {
  const ce = new ComputeEngine();
  const seen: Seen[] = [];
  ce.declare('Rec', {
    signature: '(number) -> number',
    evaluate: (_ops, options) => {
      seen.push({
        numeric: options.numericApproximation,
        precision: options.precision,
      });
      return undefined;
    },
  });
  return { ce, seen };
}

const numericPrecisions = (seen: Seen[]) =>
  seen.filter((s) => s.numeric === true).map((s) => s.precision);

describe('options.precision of an evaluate handler', () => {
  test('exact evaluation: undefined', () => {
    const { ce, seen } = engineWithRecorder();
    ce.box(['Rec', 1]).evaluate();
    expect(seen).toEqual([{ numeric: false, precision: undefined }]);
  });

  test('.N() and N(x): the engine precision', () => {
    const { ce, seen } = engineWithRecorder();
    ce.box(['Rec', 1]).N();
    ce.box(['N', ['Rec', 1]]).evaluate();
    expect(numericPrecisions(seen)).toEqual([ce.precision, ce.precision]);
  });

  test('N(x, p) below the engine precision: p, engine precision unchanged', () => {
    const { ce, seen } = engineWithRecorder();
    const before = ce.precision;
    ce.box(['N', ['Rec', 1], 10]).evaluate();
    expect(numericPrecisions(seen)).toEqual([10]);
    expect(ce.precision).toBe(before);
  });

  test('N(x, p) above the engine precision: p, and the precision stays raised', () => {
    const { ce, seen } = engineWithRecorder();
    ce.box(['N', ['Rec', 1], 40]).evaluate();
    expect(numericPrecisions(seen)).toEqual([40]);
    expect(ce.precision).toBe(40);
  });

  test('reaches nested handlers, and is restored after N(x, p)', () => {
    const { ce, seen } = engineWithRecorder();
    ce.box(['N', ['Add', ['Rec', 1], ['Sin', ['Rec', 2]]], 12]).evaluate();
    const inside = numericPrecisions(seen);
    expect(inside.length).toBeGreaterThanOrEqual(2);
    expect(inside.every((p) => p === 12)).toBe(true);

    seen.length = 0;
    ce.box(['Rec', 1]).N();
    expect(numericPrecisions(seen)).toEqual([ce.precision]);
  });

  test('a nested N(y, q) applies to y only', () => {
    const { ce, seen } = engineWithRecorder();
    const before = ce.precision;
    ce.box(['N', ['Add', ['Rec', 1], ['N', ['Rec', 2], 8]], 10]).evaluate();
    expect(numericPrecisions(seen)).toEqual([10, 8]);
    expect(ce.precision).toBe(before);
  });

  test('a handler that calls .N() itself passes the request along', () => {
    const { ce, seen } = engineWithRecorder();
    ce.declare('Outer', {
      signature: '(number) -> number',
      lazy: true,
      evaluate: ([x]) => x.canonical.N(),
    });
    ce.box(['N', ['Outer', ['Rec', 1]], 9]).evaluate();
    expect(numericPrecisions(seen)).toEqual([9]);
  });
});
