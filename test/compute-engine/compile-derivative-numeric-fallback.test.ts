import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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

  test('within budget: the exact symbolic closed form is still used', () => {
    const ce = engineWithNested(4);
    const r = compile(ce.box(['Apply', ['Derivative', 'f'], 0.5]) as never);
    expect(r.success).toBe(true);
    const v = r.run!() as number;
    // Exact derivative of the DEPTH-4 radical at 0.5, computed once with the
    // closed form; an 8th-order stencil differs from it at ~1e-10, so a
    // 1e-13 match proves the closed form (not the stencil) was compiled.
    expect(Math.abs(v - 0.5778190048613953)).toBeLessThan(1e-13);
  });

  test(
    'past budget, order 1: compiles, and both routes agree bit-for-bit',
    () => {
      const ce = engineWithNested(DEEP);
      const node = ce.box(['Apply', ['Derivative', 'f'], 0.5]);
      const r = compile(node as never);
      expect(r.success).toBe(true);
      const compiled = r.run!() as number;
      // Analytic anchor: L′(0.5) = 3^(-1/2); the depth-37 radical differs
      // from the infinite limit by ~1e-6.
      expect(Math.abs(compiled - 1 / Math.sqrt(3))).toBeLessThan(1e-4);
      // Route parity (Tycho's D-209 net): one shared stencil function, so
      // the interpreted N() is the IDENTICAL machine value.
      const interpreted = ce
        .box(['Apply', ['Derivative', 'f'], 0.5])
        .N().re;
      expect(Object.is(compiled, interpreted)).toBe(true);
    },
    120_000
  );
});

// CE-1292: an unannotated parameter whose uses infer the type `complex`
// (`t` at the order of `LerchPhi`) was read as a `{ re, im }` object by the
// body while the caller passed a number, so the literal answered
// `Φ(0.3, 0, 2)` at every point and its numeric derivative was about 0.
describe('CE-1292: a parameter inferred `complex` reads the number it receives', () => {
  const ce = new ComputeEngine();
  // Φ(0.3, s, 2) and its derivative in s at s = 2, by the interpreter: the
  // value, and a central difference with step 1e-5.
  const phi = (s: number) => ce.box(['LerchPhi', 0.3, s, 2]).N().re;
  const slope = (phi(2 + 1e-5) - phi(2 - 1e-5)) / 2e-5;

  test('the compiled literal follows its argument', () => {
    const r = compile(
      ce.box(['Function', ['LerchPhi', 0.3, 't', 2], 't']) as never
    );
    expect(r.success).toBe(true);
    const run = r.run as unknown as (t: number) => number;
    expect(run(2)).toBeCloseTo(phi(2), 12);
    expect(run(2.5)).toBeCloseTo(phi(2.5), 12);
  });

  test('the compiled numeric derivative of D', () => {
    const r = compile(ce.box(['D', ['LerchPhi', 0.3, 'x', 2], 'x']) as never);
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.nd(');
    expect(r.run!({ x: 2 }) as number).toBeCloseTo(slope, 8);
  });

  test('the interpreted and the compiled ND agree', () => {
    const fn = ['Function', ['LerchPhi', 0.3, 't', 2], 't'];
    const interpreted = ce.box(['ND', fn, 2]).N().re;
    expect(interpreted).toBeCloseTo(slope, 8);
    const ce2 = new ComputeEngine();
    ce2.declare('x', 'real');
    const r = compile(ce2.box(['ND', fn, 'x']) as never);
    expect(r.success).toBe(true);
    expect(Object.is(r.run!({ x: 2 }), interpreted)).toBe(true);
  });

  test('without entry checks, a number argument is lifted', () => {
    for (const param of ['t', ['Typed', 't', "'complex'"]]) {
      const r = compile(
        ce.box(['Function', ['LerchPhi', 0.3, 't', 2], param]) as never,
        { entryChecks: false }
      );
      expect(r.success).toBe(true);
      const run = r.run as unknown as (t: number) => number;
      expect(run(2.5)).toBeCloseTo(phi(2.5), 12);
    }
  });

  test('a complex argument in mode complex keeps its value', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('u', 'complex');
    const expected = ce2.box(['LerchPhi', 0.3, ce2.parse('2+0.5i'), 2]).N();
    for (const mode of ['complex', undefined] as const) {
      const r = compile(
        ce2.box([
          'Apply',
          ['Function', ['LerchPhi', 0.3, 't', 2], 't'],
          'u',
        ]) as never,
        mode === undefined ? undefined : { mode }
      );
      expect(r.success).toBe(true);
      const v = r.run!({ u: { re: 2, im: 0.5 } }) as {
        re: number;
        im: number;
      };
      expect(v.re).toBeCloseTo(expected.re, 12);
      expect(v.im).toBeCloseTo(expected.im, 12);
    }
  });

  test('a parameter inferred `real` is not lifted in mode complex', () => {
    for (const entryChecks of [true, false]) {
      const r = compile(ce.box(['Function', ['Mod', 't', 1], 't']) as never, {
        mode: 'complex',
        entryChecks,
      });
      expect(r.success).toBe(true);
      const run = r.run as unknown as (t: number) => number;
      expect(run(2.5)).toBe(0.5);
    }
  });

  test('a wide sibling parameter keeps the complex lane in mode complex', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('u', 'complex');
    ce2.declare('w', 'complex');
    const r = compile(
      ce2.box([
        'Apply',
        ['Function', ['Add', ['LerchPhi', 0.3, 't', 2], 'z'], 't', 'z'],
        'u',
        'w',
      ]) as never,
      { mode: 'complex' }
    );
    expect(r.success).toBe(true);
    const v = r.run!({ u: { re: 2, im: 0.5 }, w: { re: 1, im: 1 } }) as {
      re: number;
      im: number;
    };
    const phi = ce2.box(['LerchPhi', 0.3, ce2.parse('2+0.5i'), 2]).N();
    expect(v.re).toBeCloseTo(phi.re + 1, 12);
    expect(v.im).toBeCloseTo(phi.im + 1, 12);
  });
});
