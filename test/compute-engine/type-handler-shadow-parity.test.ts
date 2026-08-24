/**
 * Differential parity for converted `type` handlers: with the legacy
 * expressions-shape handlers installed in the shadow registry, every type
 * derivation for a converted operator runs BOTH shapes and throws on
 * divergence (`checkShadowTypeParity`,
 * `boxed-expression/operand-descriptor.ts`). This suite drives a broad
 * operand mix through the converted operators; any divergence surfaces as a
 * throw from the `.type` read itself, so the assertions here only need to
 * force the derivations — plus one guard that the mechanism actually ran,
 * so an empty corpus or a broken install fails loudly instead of passing
 * vacuously.
 *
 * A conversion batch is proven by (a) this suite and (b) a full-suite run
 * with the shadow installed; the corpus is then every type derivation the
 * whole test suite performs.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { _shadowParityStats } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import {
  LEGACY_TYPE_HANDLERS,
  installLegacyTypeHandlerShadow,
  uninstallLegacyTypeHandlerShadow,
} from './type-handler-shadow-legacy';

beforeAll(() => installLegacyTypeHandlerShadow());
afterAll(() => uninstallLegacyTypeHandlerShadow());

describe('shadow parity over the converted handlers', () => {
  test('a broad operand mix derives identically under both shapes', () => {
    const before = _shadowParityStats.checks;
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.declare('p', 'real<0..> & !0');
    ce.declare('L', 'list<integer>');
    ce.declare('m', 'integer | missing');
    ce.assign('v', ce.box(5));

    const corpus: unknown[] = [
      // Coalesce: literals, symbols, exact rationals, missing-typed mixes
      ['Coalesce', 1, 2.5],
      ['Coalesce', 'x', 2.5],
      ['Coalesce', 'x'],
      ['Coalesce', ['Rational', 1, 3], 2.5],
      ['Coalesce', 'p', 'x'],
      ['Coalesce', 'L', 'x'],
      ['Coalesce', 'v', 1],
      ['Coalesce', { str: 'a' }, { str: 'b' }],
      ['Coalesce', ['Sqrt', 2], 'x'],
      ['Coalesce', ['Divide', 'x', 0], NaN],
      // A `missing`-carrying type at the LAST position is the §3.D contract
      // case: the last arm keeps its FULL type, absence included. The call
      // site once pre-stripped it for the 'types' shape (a `handle`
      // operator's handler owns absence semantics — the strip fold is now
      // gated to `propagate` operators), and this row is what catches any
      // relapse.
      ['Coalesce', 1, 'm'],
      ['Coalesce', 'm', 1],
      ['Coalesce', 'm', 'm'],
      // Hold: every structural kind, raw through the box route
      ['Hold', 'q'],
      ['Hold', 'x'],
      ['Hold', { str: 'abc' }],
      ['Hold', 0],
      ['Hold', 1],
      ['Hold', 3.14],
      ['Hold', NaN],
      ['Hold', ['Add', 'x', 1]],
      ['Hold', ['List', 1, 2]],
      ['Hold', ['Tuple', 1, 2, 3]],
      ['Hold', ['Function', ['Add', 'n', 1], 'n']],
      // ReleaseHold: held literals, held applications, non-Hold operands
      ['ReleaseHold', ['Hold', 2]],
      ['ReleaseHold', ['Hold', ['Add', 1, 2]]],
      ['ReleaseHold', ['Hold', 'q']],
      ['ReleaseHold', 'q'],
      ['ReleaseHold', ['List', 1, 2]],
    ];

    // A divergence throws from the `.type` read; reaching the end with the
    // counter advanced is the pass condition.
    for (const json of corpus) expect(ce.box(json as any).type).toBeDefined();

    expect(_shadowParityStats.checks).toBeGreaterThan(before);
    // Anti-vacuity, per operator: every installed legacy handler must have
    // been exercised at least once — a corpus that silently misses one
    // converted operator is not a parity proof for it.
    for (const operator of Object.keys(LEGACY_TYPE_HANDLERS))
      expect(
        _shadowParityStats.checksByOperator.get(operator) ?? 0
      ).toBeGreaterThan(0);
  });

  test('the parse route derives identically too', () => {
    // Lazy operators without a canonical handler receive RAW operands on
    // parse as well as box; the shadow must agree there too.
    const before = _shadowParityStats.checks;
    const ce = new ComputeEngine();
    expect(ce.parse('\\operatorname{Hold}(z+1)').type).toBeDefined();
    expect(
      ce.parse('\\operatorname{ReleaseHold}(\\operatorname{Hold}(7))').type
    ).toBeDefined();
    expect(_shadowParityStats.checks).toBeGreaterThan(before);
  });
});
