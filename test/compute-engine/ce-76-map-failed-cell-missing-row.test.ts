import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-76. A `Map` whose callback is one broadcast-shaped operator
 * (`x ↦ x + 1`) is served by the lowered loop of `makeSpineRunner()`
 * (`library/map-lowering.ts`). When the callback applied to a row gives a
 * list whose only error is in a cell (`[(1, 2)] + 1` is `[<error>]`), that
 * list is the value of the element, as on the general route of `Map`. Before
 * the fix, the lowered loop read it as a failed level and put the absence
 * marker `NaN` in its place.
 *
 * The `Missing` row matters: without it, the type of `x` is `list<tuple>`, and
 * the body is already an error when the `Map` is made canonical.
 */

const ce = new ComputeEngine();

const SOURCE = ['List', ['List', ['Tuple', 1, 2]], 'Missing'] as const;

describe('CE-76: Map over a nested list with a Missing row', () => {
  test('the lowered route keeps the failed cell of the first row', () => {
    const e = ce.box(['Map', ['Function', ['Add', 'x', 1], 'x'], SOURCE]);
    expect(e.evaluate().toString()).toBe(
      `[[Error(ErrorCode("incompatible-type", "tuple", "number"))],NaN]`
    );
    // `at()` reads one element through the same runner.
    expect(e.at(1)?.toString()).toBe(
      `[Error(ErrorCode("incompatible-type", "tuple", "number"))]`
    );
  });

  test('the lowered route gives the same value as the general route', () => {
    // `2(x + 1)` is not one broadcast operator, so it takes the general
    // route of `Map`.
    const lowered = ce
      .box(['Map', ['Function', ['Add', 'x', 1], 'x'], SOURCE])
      .evaluate();
    const general = ce
      .box([
        'Map',
        ['Function', ['Multiply', 2, ['Add', 'x', 1]], 'x'],
        SOURCE,
      ])
      .evaluate();
    expect(lowered.toString()).toBe(general.toString());
  });

  test('the parse route gives the same value', () => {
    const e = ce.parse(
      '\\mathrm{Map}(x\\mapsto x+1, [[(1,2)], \\mathrm{Missing}])'
    );
    expect(e.evaluate().toString()).toBe(
      `[[Error(ErrorCode("incompatible-type", "tuple", "number"))],NaN]`
    );
  });
});
