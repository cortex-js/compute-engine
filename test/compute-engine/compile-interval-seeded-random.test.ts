/**
 * A SEEDED list draw on the interval-js compile target (Tycho item 316).
 *
 * `WithRandomSeed(s, RandomChoice(domain, k))` is how the Desmos importer
 * spells `random(k)`. The frame starts at draw 0 at each entry and
 * `RandomChoice` makes exactly `k` draws in output order, so the value is a
 * fixed list of numbers: element `i` is draw `i` of the frame. The interval
 * target compiles it to that list of point intervals (`_IA.seededChoice`),
 * with the seed folded at compile time.
 *
 * What is pinned:
 *
 * - the values are bit-identical to `evaluate()` and to the `javascript`
 *   target, for an `Interval`, a `Range` and a literal `List` domain, with `k`
 *   a literal and with `k` a declared integer symbol supplied at call time;
 * - the draw compiles where a list is used whole: a reducer (`Min`), an
 *   element-wise kernel, a `PointList` source, and the Desmos field that
 *   nests all of these;
 * - what is not supported still fails closed: an unseeded draw, a symbolic
 *   seed, a body that is not a bare `RandomChoice`, a symbolic domain;
 * - a count that is not a point, or out of range, at run time throws from
 *   the run-time helper, which the compiled `run` reports as `entire`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';
import { IntervalArithmetic } from '../../src/compute-engine/interval/index';

const ce = new ComputeEngine();
ce.declare('N', 'integer');

const pt = (v: number) => ({ lo: v, hi: v });

const draw = (
  seed: unknown,
  n: unknown,
  domain: unknown = ['Interval', 0, ['Open', 1]]
) => ['WithRandomSeed', seed, ['RandomChoice', domain, n]];

/** The compilation of `json` throws a decline with the code `code`, and
 *  the operator `operator` when it is given. */
function declines(json: unknown, code: string, operator?: string): void {
  let diagnostic: unknown;
  try {
    compile(ce.box(json as any), { to: 'interval-js', fallback: false });
  } catch (e) {
    diagnostic = compileDiagnosticOf(e);
  }
  expect(diagnostic).toMatchObject(operator ? { code, operator } : { code });
}

describe('Seeded RandomChoice — what still fails closed', () => {
  test('an unseeded RandomChoice', () => {
    declines(
      ['Min', ['RandomChoice', ['Interval', 0, 1], 3]],
      'outside-profile'
    );
  });

  test('a symbolic seed', () => {
    declines(['Min', draw('s', 3)], 'untyped-input');
  });

  test('a body that is not a bare RandomChoice', () => {
    declines(
      [
        'WithRandomSeed',
        1,
        ['Add', ['RandomChoice', ['Interval', 0, 1], 3], 1],
      ],
      'outside-profile'
    );
  });

  test('a symbolic domain', () => {
    ce.declare('L', 'list<real>');
    declines(['Min', draw(1, 3, 'L')], 'outside-profile', 'RandomChoice');
    declines(
      ['Min', draw(1, 3, ['Range', 1, 'N'])],
      'outside-profile',
      'RandomChoice'
    );
  });

  test('a domain the interpreter refuses', () => {
    declines(
      ['Min', draw(1, 3, ['Interval', 1, 1])],
      'outside-profile',
      'RandomChoice'
    );
    declines(['Min', draw(1, 3, ['List'])], 'outside-profile', 'RandomChoice');
  });

  test('a literal count out of range', () => {
    declines(['Min', draw(1, -3)], 'outside-profile');
  });

  test('in a position that takes one interval', () => {
    declines(['Less', draw(1, 3), 1], 'outside-profile');
  });
});

describe('Seeded RandomChoice — the count at run time', () => {
  const domain = { lo: 0, hi: 1 };

  test('the run-time helper rounds a point count as the interpreter does', () => {
    expect(IntervalArithmetic.seededChoice(1, 2, domain, 2.5).length).toBe(3);
    expect(IntervalArithmetic.seededChoice(1, 2, domain, pt(4)).length).toBe(4);
  });

  test('the run-time helper throws on a wide, non-finite or out-of-range count', () => {
    for (const k of [{ lo: 2, hi: 3 }, -1, 1_000_001, NaN, Infinity, 'x'])
      expect(() => IntervalArithmetic.seededChoice(1, 2, domain, k)).toThrow(
        /RandomChoice: expected a count in 0\.\.1000000/
      );
  });
});
