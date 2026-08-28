import { ComputeEngine } from '../../src/compute-engine';

/**
 * Ranged RESULT types — work item 4 of the ROADMAP entry "Ranged types
 * should carry sign (and a literal's value) through type derivation": the
 * positive half of a few `sgn` handlers is also claimed by the TYPE
 * handlers, as ranges, so type-channel consumers (`Sqrt`'s branch choice,
 * `Ln`'s domain, the GPU real-vs-complex lowering, the solver's root
 * filter) see the sign without consulting the sgn channel.
 *
 * The enumerated heads — and ONLY these; general interval arithmetic for
 * `Add`/`Multiply`/`Power` is scoped separately by the same ROADMAP entry:
 * - `Abs`      → `real<0..>` on every real tier (exact-string pins live in
 *                `type-handler-audit.test.ts`, "TYPE AUDIT: Abs");
 * - even powers → `real<0..>` (`x²`, and `x⁻²` on the rational tiers);
 * - `Exp`      → `(real<0..>) & !0` — `Exp(x)` canonicalizes to
 *                `Power(e, x)`, so the claim lives in `Power`'s
 *                positive-base arm and covers every provably positive base.
 */

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('k', 'integer');

describe('RANGED RESULTS — the enumerated heads', () => {
  it('Abs: |x| is a non-negative real, in the type', () => {
    expect(ce.parse('|x|').type.toString()).toBe('real<0..>');
    expect(ce.box(['Abs', 'k']).type.toString()).toBe('integer<0..>');
  });

  it('even powers: x² (and x⁻² on the rational tier) are non-negative', () => {
    expect(ce.parse('x^2').type.toString()).toBe('finite_real<0..>');
    expect(ce.parse('x^4').type.toString()).toBe('finite_real<0..>');
    expect(ce.box(['Power', 'k', 2]).type.toString()).toBe(
      'finite_integer<0..>'
    );
    expect(ce.box(['Power', 'k', -2]).type.toString()).toBe(
      'finite_rational<0..>'
    );
    // An ODD power claims no sign.
    expect(ce.parse('x^3').type.toString()).toBe('finite_real');
  });

  it('Exp (a positive base): e^x is positive, in the type', () => {
    expect(ce.parse('e^x').type.toString()).toBe('finite_real<0<..>');
    expect(ce.box(['Exp', 'x']).type.toString()).toBe(
      'finite_real<0<..>'
    );
    // Any provably positive base carries the same claim.
    expect(ce.parse('2^x').type.toString()).toBe('finite_real<0<..>');
  });
});

describe('RANGED RESULTS — type-channel consumers', () => {
  it('√(x²) and √|x| are real: the branch choice reads the range', () => {
    // Before item 4 both typed `finite_complex`: `x²`'s sgn handler cannot
    // answer for a valueless `x`, and nothing else carried the sign.
    expect(ce.parse('\\sqrt{x^2}').type.toString()).toBe('finite_real');
    expect(ce.parse('\\sqrt{|x|}').type.toString()).toBe('finite_real');
    expect(ce.parse('\\sqrt{e^x}').type.toString()).toBe('finite_real');
  });

  it('ln(2^x) is real: the log domain reads the positivity', () => {
    // `2^x`'s sgn handler declines (the exponent's sign is unknown), so
    // this is a TYPE-channel-only proof: the `& !0` range is the only
    // source of `2^x > 0`.
    expect(ce.box(['Ln', ['Power', 2, 'x']]).type.toString()).toBe(
      'finite_real'
    );
  });

  it('Add DOES interval arithmetic now; Divide stays the scope boundary', () => {
    // `|x| + |y|` typed bare `real` until the interval-arithmetic round
    // landed (2026-08-27,
    // `docs/plans/2026-08-27-interval-arithmetic-result-types.md`): the
    // sum of two non-negative ranges is non-negative, and the `Add` type
    // handler now computes it. The scope boundary moved to `Divide` (and
    // `Power` with exponent ≤ 0), which wait for the lattice flip's pole
    // story.
    ce.declare('y', 'real');
    expect(ce.parse('|x| + |y|').type.toString()).toBe('real<0..>');
    ce.declare('dd', 'real<1..2>');
    expect(ce.box(['Divide', 'dd', 'dd']).type.toString()).not.toContain(
      '..'
    );
  });
});
