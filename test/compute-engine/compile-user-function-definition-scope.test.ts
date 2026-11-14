/**
 * A user function reads the free names of its body in the scope where it is
 * defined. A compilation of a call reads them there too: it runs in a scope
 * in which each name of the expression and of the bodies it calls is the
 * definition that the interpreter reads (CE-1273, `compilationScope()`), and
 * it declines when there is no such scope, or when the compile scope hides
 * a library head of the body (CE-217). With a global `a := 2`,
 * `G := x ↦ x + a` and an inner scope with its own `a := 1000`, the compiled
 * `G(x)` gives 3 at x = 1, as the interpreter does.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { opsReads } from '../utils';

function both(
  setup: (ce: ComputeEngine) => void,
  latex: string,
  x = 1
): { interpreted: string; compiled: unknown; error?: string } {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
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
  it('reads the definition scope when the compile scope binds a free name of the body again', () => {
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('G', 'function');
      ce.assign('G', ce.parse('x \\mapsto x + a'));
      ce.pushScope();
      ce.declare('a', 'real');
      ce.assign('a', 1000);
    }, 'G(x)');
    expect(r.interpreted).toBe('3');
    expect(r.compiled).toBe(3);
  });

  it('reads the definition scope for a user function named like a library function', () => {
    const r = both((ce) => {
      ce.assign('a', 2);
      ce.declare('Erf', 'function');
      ce.assign('Erf', ce.parse('x \\mapsto x + a'));
      ce.pushScope();
      ce.declare('a', 'real');
      ce.assign('a', 1000);
    }, '\\operatorname{Erf}(x)');
    expect(r.interpreted).toBe('3');
    expect(r.compiled).toBe(3);
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

  it('reads the definition scope for a function that the body calls', () => {
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
    expect(r.compiled).toBe(6);
  });

  it('reads the definition scope after it was popped', () => {
    const r = both((ce) => {
      // `G` is defined in a scope that is popped before `G(x)` is evaluated,
      // so its body reads a binding of the popped scope. The debug check of
      // dead bindings (`CE_DEBUG_BINDINGS`) reports every such use, so it
      // would throw here by design. A popped scope keeps its definitions,
      // for a compilation as for an evaluation.
      ce._debugBindings = false;
      ce.assign('a', 2);
      ce.declare('G', 'function');
      ce.pushScope();
      ce.declare('a', 'real');
      ce.assign('a', 1000);
      ce.assign('G', ce.parse('x \\mapsto x + a'));
      ce.popScope();
    }, 'G(x)');
    expect(r.interpreted).toBe('1001');
    expect(r.compiled).toBe(1001);
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
    ce.declare('x', 'real');
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
    // assertion directly, and counts the reads of the operands of a node
    // (`ops`) at depths 12 and 16: a walk of each node reads about 1.6
    // times more at depth 16, a walk of each path about 16 times more. A
    // count does not depend on the speed of the machine, as a time would.
    // The full compilation is tested in `compile-shared-binder-body.test.ts`.
    const reads = (depth: number): number => {
      const ce = new ComputeEngine();
      let body = ce.box(['Multiply', 'x', 'k']);
      for (let i = 0; i < depth; i++)
        body = ce.function('Add', [
          ce.function('Sum', [body, ce.box(['Limits', 'k', 1, 2])]),
          ce.function('Product', [body, ce.box(['Limits', 'k', 1, 2])]),
        ]);
      ce.declare('H', 'function');
      ce.assign('H', ce.function('Function', [body, ce.symbol('x')]));
      const call = ce.box(['H', 'x']);
      return opsReads(() =>
        (
          BaseCompiler as unknown as {
            assertUserFunctionFreeBindings: (e: unknown, t: unknown) => void;
          }
        ).assertUserFunctionFreeBindings(call, {})
      );
    };
    expect(reads(16)).toBeLessThan(4 * reads(12));
  });
});
