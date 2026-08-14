import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 181: canonical boxing and type derivation of an expression
 * referencing a comprehension-bound name must be proportionate to the
 * expression, not unbounded.
 *
 * The failure mechanism: lazy-collection facet probes (`Comprehension`
 * count/finiteness scans, `Filter` emptiness walks) bracket every read with
 * `_pushEvalContext`/`_popEvalContext`, and the pop unconditionally advanced
 * the `any` axis — the axis every `_type`/`_sgn` cache keys on. Each probe
 * therefore invalidated the caches the enclosing type derivation was
 * filling, and the recomputation re-ran the probes: one canonical box of the
 * row below emitted 872K scope-pop bumps and 1.85M wasted (identical-result)
 * type recomputes, costing ~7–17 s for the box and ~60–170 s for the first
 * `.type` read. The fix: a pop whose bracket provably advanced no axis (the
 * frame's `_anyVersionAtPush` stamp) is emitted as `scope-pop {clean: true}`,
 * which is zero-mask (see `axisMaskOf` and `discardEvalContext`).
 *
 * The pin is an `_anyVersion`-advance BUDGET, not wall-clock (wall-clock
 * pins flake under load; the version counter is deterministic). Before the
 * fix the box advanced the counter ~872,932 times; after, single digits.
 */
describe('Tycho item 181: boxing over a comprehension-bound name is bounded', () => {
  const ce = new ComputeEngine();

  beforeAll(() => {
    const N = 2;
    const zeros = Array.from({ length: N }, () => '0').join(',');
    ce.box([
      'Assign',
      'P_iecepos',
      ce.parse(`\\left[${zeros}\\right]`).json as any,
    ]).evaluate();
    ce.box([
      'Assign',
      'C_licklist',
      ce.parse(`\\left[0...${N - 1}\\right]`).json as any,
    ]).evaluate();
    // A lazy Comprehension whose body reads an earlier assign through the
    // bound index: `[case { n if P_iecepos[n] = 1 } for n = C_licklist + 1]`.
    ce.box([
      'Assign',
      'B_lackpos',
      ce.parse(
        `\\left[\\begin{cases}n&P_{iecepos}[n]=1\\end{cases} \\operatorname{for} n = C_{licklist}+1\\right]`
      ).json as any,
    ]).evaluate();
  });

  test('canonical box + .type read stay within a version-advance budget', () => {
    const implicitLatex = `(x-\\lfloor\\frac{\\mathrm{Filter}(B_{lackpos}, Z\\mapsto Z=Z)-1}{15}\\rfloor+7)^2+(y-(\\mathrm{Filter}(B_{lackpos}, W\\mapsto W=W)-1)\\bmod15+7)^2+2(z-2.25)^2=0.25`;
    const raw = ce.parse(implicitLatex, { strict: false, form: 'structural' });

    const v0 = ce._anyVersion;
    const canonical = ce.expr(raw.json as any);
    const type = canonical.type.toString();
    const advances = ce._anyVersion - v0;

    // Non-vacuity: the box really produced the canonical relation and a
    // derived type (the same ones the slow path produced before the fix).
    expect(canonical.operator).toBe('Equal');
    expect(type).toBe('list<boolean>');

    // The budget. Measured 5 advances after the fix (the residual declares/
    // inference of first-touch binding); 872,932 before it. The headroom
    // covers incidental new declares, not a regression of the blowup —
    // anything within orders of magnitude of the old behavior must fail.
    expect(advances).toBeLessThan(200);
  });
});
