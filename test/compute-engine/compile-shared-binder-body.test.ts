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
 * The time limits are generous for a loaded machine: the fixed compile takes
 * about 2 s and 5 ms.
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
    const start = Date.now();
    const result = compileJs(ce.box(['H', 'x']));
    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(20_000);
    expect(Number.isFinite(result.run!({ x: 0.5 } as never) as number)).toBe(
      true
    );
  }, 60_000);

  it('gives the value of evaluate() for a shared body', () => {
    const ce = new ComputeEngine();
    defineH(ce, 6);
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
    const start = Date.now();
    const result = compileJs(expr);
    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
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
    const start = Date.now();
    const result = compileJs(expr);
    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
    expect(result.code.length + (result.preamble ?? '').length).toBeLessThan(
      100_000
    );
    expect(result.run!({} as never)).toBe(19_764_000);
  });
});

describe('COMPILE a big operator as a GPU loop near the 32-bit limits', () => {
  // A body of about 300 nodes: 48 terms of it are more than the size limit,
  // so the clause is a loop even though it has fewer than 100 terms.
  function largeBody(ce: ComputeEngine): Expression {
    const terms: unknown[] = [];
    for (let i = 1; i <= 60; i++)
      terms.push(['Sin', ['Add', ['Multiply', 'k', 'x'], i]]);
    return ce.box(['Add', ...terms] as never);
  }

  function gpu(
    ce: ComputeEngine,
    lower: number,
    upper: number,
    to: 'glsl' | 'wgsl'
  ): string {
    const expr = ce.function('Sum', [
      largeBody(ce),
      ce.box(['Limits', 'k', lower, upper]),
    ]);
    try {
      const r = compile(expr, { to, fallback: false } as never)!;
      return r.success ? (r.code ?? '') : `DECLINED: ${r.error ?? ''}`;
    } catch (e) {
      return `DECLINED: ${(e as Error).message}`;
    }
  }

  // The loop counter is a signed 32-bit integer. At an upper bound of
  // 2147483647, `k++` overflows after the last term and `k <= 2147483647`
  // stays true, so the loop does not end. A bound outside the range of the
  // counter gave shader source that does not compile.
  for (const to of ['glsl', 'wgsl'] as const) {
    it(`declines an upper bound whose last increment overflows (${to})`, () => {
      const ce = new ComputeEngine();
      expect(gpu(ce, 2147483600, 2147483647, to)).toMatch(
        /^DECLINED: .*the upper bound 2147483647 is outside the range of the 32-bit loop counter/
      );
    });

    it(`declines a lower bound outside the counter range (${to})`, () => {
      const ce = new ComputeEngine();
      expect(gpu(ce, -3_000_000_000, -2_999_999_953, to)).toMatch(
        /^DECLINED: .*the lower bound -3000000000 is outside the range of the 32-bit loop counter/
      );
    });

    it(`compiles a loop whose bounds fit the counter (${to})`, () => {
      const ce = new ComputeEngine();
      const code = gpu(ce, 2147483600, 2147483646, to);
      expect(code).not.toMatch(/^DECLINED/);
      expect(code).toMatch(/for \(.*k <= 2147483646; k\+\+\)/);
    });
  }
});
