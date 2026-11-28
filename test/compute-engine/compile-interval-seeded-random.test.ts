/**
 * A SEEDED list draw on the interval-js compile target (Tycho item 316).
 *
 * `WithRandomSeed(s, RandomChoice(domain, k))` is how the Desmos importer
 * spells `random(k)`. What is pinned: the compilation fails closed for an
 * unseeded draw, a symbolic seed, a body that is not a bare `RandomChoice`, a
 * symbolic domain, a domain the interpreter refuses, a literal count out of
 * range, and a draw in a position that takes one interval.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

const ce = new ComputeEngine();
ce.declare('N', 'integer');

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

  test('in a position that takes one interval: the interpreter value', () => {
    // Written in place, the seeded list is its interpreter value, a
    // literal (CE-1943), and `Less` maps over it as over any list.
    const json = ['Less', draw(1, 3), 1];
    const r = compile(ce.box(json as any), { to: 'interval-js' });
    expect(r.success).toBe(true);
    expect(JSON.stringify(ce.box(json as any).evaluate().json)).toBe(
      '["List","True","True","True"]'
    );
    expect(r.run({})).toEqual(['true', 'true', 'true']);
  });
});
