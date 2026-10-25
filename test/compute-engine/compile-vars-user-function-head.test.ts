/**
 * A string `vars` entry that names a user-defined function also replaces the
 * function at its calls (CE-260). Before the fix, `vars: { g: '…' }` changed
 * only the reads of `g` as a value, and the call `g(x)` still emitted the
 * engine's definition of `g` (`_fn_g`), so the compiled code ignored the
 * caller's mapping.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  ce.declare('g', 'function');
  ce.assign('g', ce.parse('x \\mapsto x + 1'));
});

function compiled(latex: string, options: Record<string, unknown>) {
  return compile(ce.parse(latex), { fallback: false, ...options } as never)!;
}

describe('COMPILE a call of a user function mapped by `vars`', () => {
  it('calls the source of the mapping on JavaScript', () => {
    const r = compiled('g(x)', {
      to: 'javascript',
      vars: { g: '((t) => 100 * t)' },
    });
    expect(r.code).not.toContain('_fn_g');
    expect(r.run!({ x: 1 } as never)).toBe(100);
    // The interpreter, with the same function assigned to `g`.
    ce.assign('g', ce.parse('t \\mapsto 100 t'));
    expect(ce.parse('g(1)').evaluate().toString()).toBe('100');
  });

  it('reads a function given at run time through the vars object', () => {
    const r = compiled('g(x) + 1', { to: 'javascript', vars: { g: '_.g' } });
    expect(r.code).toContain('_.g(_.x)');
    expect(r.run!({ x: 2, g: (t: number) => 10 * t } as never)).toBe(21);
  });

  it('does not fold the calls of a mapped function', () => {
    const r = compiled('\\sum_{k=1}^3 g(k)', {
      to: 'javascript',
      vars: { g: '((t) => 100 * t)' },
    });
    expect(r.run!({} as never)).toBe(600);
  });

  it('keeps an entry of `functions` over the `vars` entry', () => {
    const r = compiled('g(x)', {
      to: 'javascript',
      vars: { g: '((t) => 100 * t)' },
      functions: { g: '((t) => 7 * t)' },
    });
    expect(r.run!({ x: 1 } as never)).toBe(7);
  });

  // On a shader target a `vars` entry names a uniform or an input, which
  // cannot be called, so `myG(x)` would not be valid shader source. The
  // shader targets keep the engine definition of `g` for its calls, and a
  // caller that has a shader function to call names it in `functions`.
  it.each(['glsl', 'wgsl'])(
    'keeps the engine definition on %s',
    (to) => {
      const r = compiled('g(x)', { to, vars: { g: 'myG' } });
      expect(r.code).toBe('_fn_g(x)');
      expect(r.code).not.toContain('myG');
      expect(compiled('g(x)', { to, functions: { g: 'myG' } }).code).toBe(
        'myG(x)'
      );
    }
  );

  it('calls the mapped name on interval-js', () => {
    const interval = compiled('g(x)', {
      to: 'interval-js',
      vars: { g: 'myG' },
    });
    expect(interval.code).toContain('myG(_.x)');
    expect(interval.code).not.toContain('_fn_g');
  });

  it('compiles the engine definition when `vars` does not map the head', () => {
    const r = compiled('g(x)', { to: 'javascript', vars: { y: '_.y' } });
    expect(r.code).toContain('_fn_g');
    expect(r.run!({ x: 1 } as never)).toBe(2);
  });
});
