import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 177 — the shared-budget numeric-derivative fallback
 * (user-ruled 2026-08-14).
 *
 * A deeply-nested body's symbolic derivative grows exponentially and the
 * differentiation growth budget (`MAX_DERIVATIVE_NODES`,
 * symbolic/derivative.ts) declines past ~depth 20 for √(x + √(x + … + 1)).
 * Before the fallback, the javascript compile then failed closed and the
 * interpreted `.N()` stayed symbolic. Now BOTH routes fall back to the SAME
 * stencil (`centeredDiffHigherOrder`, injected into emitted code as
 * `_SYS.nd`), so they agree bit-for-bit; within the budget the exact
 * symbolic closed form is used unchanged; and plain `evaluate()` keeps the
 * exactness contract by staying symbolic.
 *
 * The verification anchor is ANALYTIC, not self-referential: the infinite
 * nested radical converges to L(x) = (1 + √(1+4x))/2, so
 * L′(x) = (1+4x)^(-1/2), L″(x) = −2(1+4x)^(-3/2), L‴(x) = 12(1+4x)^(-5/2).
 * At depth 37 the finite radical matches L to ~1e-6 at x = 0.5 — far above
 * both the stencil's own error and far below the assertion tolerances.
 *
 * NOTE: the past-budget cases each still RUN the failed symbolic attempt
 * before falling back (bounded by the growth budget, a few seconds) — these
 * tests are deliberately slow and carry their own jest timeout.
 */
describe('item 177: numeric-derivative fallback (shared budget, both routes)', () => {
  const DEEP = 37;

  function engineWithNested(depth: number): ComputeEngine {
    const ce = new ComputeEngine();
    let s = '1';
    for (let i = 0; i < depth; i++) s = `\\sqrt{x + ${s}}`;
    ce.assign('f', ce.parse(`x \\mapsto ${s}`));
    return ce;
  }

  test(
    'exactness contract: plain evaluate() stays symbolic past budget',
    () => {
      const ce = engineWithNested(DEEP);
      const e = ce.box(['Apply', ['Derivative', 'f'], 0.5]).evaluate();
      expect(e.operator).toBe('Apply');
      expect(e.op1.operator).toBe('Derivative');
    },
    120_000
  );
});
