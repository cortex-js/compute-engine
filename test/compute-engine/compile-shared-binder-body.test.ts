/**
 * The compile time of a `Sum` or `Product` whose body is large, or holds a
 * subtree that several binders share (ROADMAP CE-458).
 *
 * Two causes made it exponential. Each unrolled term held a copy of the body,
 * and an unrolled big operator inside the body multiplied again, with no limit
 * on the total. And the complexness analysis started with an empty memo each
 * time it entered a binder, so a subtree shared by several binders was
 * analyzed once for each path to it. Before the fix, the shared body below
 * took 55 s to compile at a depth of 10, and the triple sum took 12.7 s.
 *
 * The compile time of the shared body (about 2 s; 55 s before the fix) is
 * asserted only in a `CE_PERF=1` run: a time limit depends on the speed and
 * the load of the machine. The nested sums are tested by the length of their
 * code, which does not.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** A body in which each level holds the level below twice, under a `Sum`
 * and under a `Product` that both bind `k`: 2·depth + 1 distinct nodes, but
 * 2^depth paths to the innermost one. */
function sharedBody(ce: ComputeEngine, depth: number): Expression {
  let body = ce.box(['Multiply', 'x', 'k']);
  for (let i = 0; i < depth; i++)
    body = ce.function('Add', [
      ce.function('Sum', [body, ce.box(['Limits', 'k', 1, 2])]),
      ce.function('Product', [body, ce.box(['Limits', 'k', 1, 2])]),
    ]);
  return body;
}

function defineH(ce: ComputeEngine, depth: number): void {
  ce.declare('H', 'function');
  ce.assign(
    'H',
    ce.function('Function', [sharedBody(ce, depth), ce.symbol('x')])
  );
}

function compileJs(expr: Expression) {
  return compile(expr, { to: 'javascript', fallback: false } as never)!;
}

describe('COMPILE a big operator over a shared or large body', () => {
  it('compiles a body shared under binders at depth 10 in time', () => {
    const ce = new ComputeEngine();
    defineH(ce, 10);
    // The argument of `H`, a `function`, has no requirement: declare it.
    ce.declare('x', 'real');
    const start = Date.now();
    const result = compileJs(ce.box(['H', 'x']));
    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(20_000);
    expect(Number.isFinite(result.run!({ x: 0.5 } as never) as number)).toBe(
      true
    );
  }, 60_000);

  it('gives the value of evaluate() for a shared body', () => {
    const ce = new ComputeEngine();
    defineH(ce, 6);
    ce.declare('x', 'real');
    const result = compileJs(ce.box(['H', 'x']));
    expect(result.success).toBe(true);
    for (const x of [0.5, 1, -0.75]) {
      const expected = ce.box(['H', x]).N().re;
      const actual = result.run!({ x } as never) as number;
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
        1e-12 * Math.abs(expected)
      );
    }
  }, 60_000);

  it('does not unroll nested sums past a total size', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\sum_{a=1}^{60}\\sum_{b=1}^{60}\\sum_{c=1}^{60} (a\\cdot b\\cdot c\\cdot x)'
    );
    const result = compileJs(expr);
    expect(result.success).toBe(true);
    // The terms of the unrolled clauses are at most `MAX_UNROLLED_NODES`
    // nodes in all, so the code is far below the 18 MB of the full unroll.
    expect(result.code.length + (result.preamble ?? '').length).toBeLessThan(
      100_000
    );
    expect(result.run!({ x: 1 } as never)).toBe(
      expr.subs({ x: 1 }).evaluate().re
    );
    expect(result.run!({ x: 1 } as never)).toBe(6_128_487_000);
  });

  it('still unrolls a small sum', () => {
    const ce = new ComputeEngine();
    const result = compileJs(ce.parse('\\sum_{k=1}^{3} k x'));
    expect(result.success).toBe(true);
    expect(result.code).not.toMatch(/while|for \(/);
    expect(result.run!({ x: 2 } as never)).toBe(12);
  });
});

describe('COMPILE nested sums whose bounds are constant symbols', () => {
  // The JavaScript target folds a bound that is a symbol with a value and
  // unrolls the clause. The size estimate does not read that value, so it
  // takes the largest size the clause can have. Before, it counted such a
  // clause as a loop: the outer clauses were unrolled too, and the code was
  // 4 MB long (6 s to compile).
  it('does not unroll nested sums past a total size', () => {
    const ce = new ComputeEngine();
    ce.assign('n', 60);
    const expr = ce.parse(
      '\\sum_{a=1}^{n}\\sum_{b=1}^{n}\\sum_{c=1}^{n} (a+b+c)'
    );
    const result = compileJs(expr);
    expect(result.success).toBe(true);
    expect(result.code.length + (result.preamble ?? '').length).toBeLessThan(
      100_000
    );
    expect(result.run!({} as never)).toBe(19_764_000);
  });
});
