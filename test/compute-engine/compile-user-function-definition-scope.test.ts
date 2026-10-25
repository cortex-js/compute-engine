/**
 * A user function reads the free names of its body in the scope where it is
 * defined. The compiler resolves names in the scope where the compilation
 * runs, so when the two scopes bind a name of the body to different
 * definitions, the compilation declines (CE-217). Before the fix, with a
 * global `a := 2`, `G := x ↦ x + a` and an inner scope with its own
 * `a := 1000`, the compiled `G(x)` gave 1001 at x = 1 where the interpreter
 * gives 3.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

function both(
  setup: (ce: ComputeEngine) => void,
  latex: string,
  x = 1
): { interpreted: string; compiled: unknown; error?: string } {
  const ce = new ComputeEngine();
  setup(ce);
  const expr = ce.parse(latex);
  const interpreted = expr.subs({ x }).evaluate().toString();
  try {
    const result = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never)!;
    return { interpreted, compiled: result.run!({ x } as never) };
  } catch (e) {
    return { interpreted, compiled: undefined, error: (e as Error).message };
  }
}

describe('COMPILE a user function against the scope of its definition', () => {
  it('declines when the compile scope binds a free name of the body again', () => {
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('G', 'function');
      ce.assign('G', ce.parse('x \\mapsto x + a'));
      ce.pushScope();
      ce.declare('a', 'real');
      ce.assign('a', 1000);
    }, 'G(x)');
    expect(r.interpreted).toBe('3');
    expect(r.compiled).toBeUndefined();
    expect(r.error).toMatch(/body reads `a`.*different definition/);
  });

  it('declines for a user function named like a library function', () => {
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('Erf', 'function');
      ce.assign('Erf', ce.parse('x \\mapsto x + a'));
      ce.pushScope();
      ce.declare('a', 'real');
      ce.assign('a', 1000);
    }, '\\operatorname{Erf}(x)');
    expect(r.interpreted).toBe('3');
    expect(r.error).toMatch(/body reads `a`/);
  });

  it('declines when the compile scope shadows a library head of the body', () => {
    const r = both((ce) => {
      ce.declare('G', 'function');
      ce.assign('G', ce.parse('x \\mapsto \\sin(x)'));
      ce.pushScope();
      ce.declare('Sin', 'function');
      ce.assign('Sin', ce.parse('t \\mapsto 100'));
    }, 'G(x)');
    expect(r.interpreted).toBe('sin(1)');
    expect(r.error).toMatch(/body reads `Sin`/);
  });

  it('checks the body of a function that the body calls', () => {
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('H', 'function');
      ce.assign('H', ce.parse('x \\mapsto x + a'));
      ce.declare('G', 'function');
      ce.assign('G', ce.parse('x \\mapsto 2H(x)'));
      ce.pushScope();
      ce.declare('a', 'real');
      ce.assign('a', 1000);
    }, 'G(x)');
    expect(r.interpreted).toBe('6');
    expect(r.error).toMatch(/call of `H`: its body reads `a`/);
  });

  it('declines when the definition scope was popped', () => {
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('G', 'function');
      ce.pushScope();
      ce.declare('a', 'real');
      ce.assign('a', 1000);
      ce.assign('G', ce.parse('x \\mapsto x + a'));
      ce.popScope();
    }, 'G(x)');
    expect(r.interpreted).toBe('1001');
    expect(r.error).toMatch(/body reads `a`/);
  });

  it('compiles when the scopes agree', () => {
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('G', 'function');
      ce.assign('G', ce.parse('x \\mapsto x + a'));
      ce.pushScope();
    }, 'G(x)');
    expect(r.interpreted).toBe('3');
    expect(r.compiled).toBe(3);
  });

  it('does not read a name bound inside the body as free', () => {
    // `k` is the index of the sum; the inner scope's `k` is another symbol.
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('G', 'function');
      ce.assign('G', ce.parse('x \\mapsto \\sum_{k=1}^{3} (k + x + a)'));
      ce.pushScope();
      ce.declare('k', 'real');
      ce.assign('k', 1000);
    }, 'G(x)');
    expect(r.interpreted).toBe('15');
    expect(r.compiled).toBe(15);
  });

  it('does not read the body of a function that the caller replaces', () => {
    // The emitted code calls the caller's `G`, so the engine body of `G`,
    // which reads the outer `a`, is never read.
    const ce = new ComputeEngine();
    ce.assign('a', 2);
    ce.declare('G', 'function');
    ce.assign('G', ce.parse('x \\mapsto x + a'));
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1000);
    const result = compile(ce.parse('G(x)'), {
      to: 'javascript',
      fallback: false,
      functions: { G: (x: number) => 10 * x },
    } as never)!;
    expect(result.success).toBe(true);
    expect(result.run!({ x: 1 } as never)).toBe(10);
  });

  it('walks a subtree shared under several binders once', () => {
    // Each level holds the level below twice, under a `Sum` and under a
    // `Product` that both bind `k`. The body has 2·depth + 1 distinct nodes
    // but 2^depth paths to the innermost one. The check calls the private
    // assertion directly: the full compilation evaluates the nested sums,
    // which takes exponential time for its own reason.
    const ce = new ComputeEngine();
    let body = ce.box(['Multiply', 'x', 'k']);
    for (let i = 0; i < 20; i++)
      body = ce.function('Add', [
        ce.function('Sum', [body, ce.box(['Limits', 'k', 1, 2])]),
        ce.function('Product', [body, ce.box(['Limits', 'k', 1, 2])]),
      ]);
    ce.declare('H', 'function');
    ce.assign('H', ce.function('Function', [body, ce.symbol('x')]));
    const start = Date.now();
    (
      BaseCompiler as unknown as {
        assertUserFunctionFreeBindings: (e: unknown, t: unknown) => void;
      }
    ).assertUserFunctionFreeBindings(ce.box(['H', 'x']), {});
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
