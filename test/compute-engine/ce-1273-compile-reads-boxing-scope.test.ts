import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-1273: an expression reads each name from the scope it was boxed in
// (`docs/plans/2026-11-11-bound-once-spec.md`, section 2), and so does its
// compilation: the compiler looks a name up from a scope that gives each
// name of the expression the definition its occurrence reads
// (`compilation/compile-scope.ts`). Before the fix, a compilation in a
// pushed scope that declared `a` again inlined that `a` (`1 + _.x`), where
// the evaluation read the `a` of the boxing scope (10).

/** `x`, `a` declared `real`, `a := 10`; `x + a` boxed; then a pushed scope
 * that declares `a` again with the value 1. The caller pops the scope. */
function shadowedWitness() {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('a', 'real');
  ce.assign('a', 10);
  const expr = ce.box(['Add', 'x', 'a']);
  ce.pushScope();
  ce.declare('a', 'real');
  ce.assign('a', 1);
  return { ce, expr };
}

describe('CE-1273 a compilation reads the scope the expression was boxed in', () => {
  test('the evaluation reads the a of the boxing scope', () => {
    const { ce, expr } = shadowedWitness();
    expect(ce.withValues({ x: 2 }, () => expr.evaluate()).re).toBe(12);
    ce.popScope();
  });

  test('javascript', () => {
    const { ce, expr } = shadowedWitness();
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('10 + _.x');
    expect(result.run!({ x: 2 })).toBe(12);
    ce.popScope();
  });

  test('javascript with the profile ir', () => {
    const { ce, expr } = shadowedWitness();
    const result = compile(expr, { fallback: false, profile: 'ir' });
    expect(result.code).toContain('10 + _.x');
    expect(result.run!({ x: 2 })).toBe(12);
    ce.popScope();
  });

  test('interval-js', () => {
    const { ce, expr } = shadowedWitness();
    const result = compile(expr, { to: 'interval-js', fallback: false });
    expect(result.run!({ x: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 12, hi: 12 },
    });
    ce.popScope();
  });

  test('glsl', () => {
    const { ce, expr } = shadowedWitness();
    const result = compile(expr, { to: 'glsl', fallback: false });
    expect(result.code).toBe('10.0 + x');
    ce.popScope();
  });

  test('python', () => {
    const { ce, expr } = shadowedWitness();
    const result = compile(expr, { to: 'python', fallback: false });
    expect(result.code).toBe('10 + x');
    ce.popScope();
  });

  test('a user function called by the expression is the one it was boxed with', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('t \\mapsto t + 1'));
    const expr = ce.box(['f', 'x']);
    ce.pushScope();
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('t \\mapsto 100 t'));
    expect(ce.withValues({ x: 2 }, () => expr.evaluate()).re).toBe(3);
    expect(compile(expr, { fallback: false }).run!({ x: 2 })).toBe(3);
    ce.popScope();
  });
});

describe('CE-1273 the compilations that read the current scope are unchanged', () => {
  test('an expression boxed in a pushed scope that declares its inputs', () => {
    const { ce } = shadowedWitness();
    ce.declare('t', 'real');
    const expr = ce.box(['Add', 't', 'a']);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('1 + _.t');
    expect(result.run!({ t: 2 })).toBe(3);
    ce.popScope();
  });

  test('an expression bound again with ce.rebind() in the pushed scope', () => {
    const { ce, expr } = shadowedWitness();
    const rebound = ce.rebind(expr);
    expect(ce.withValues({ x: 2 }, () => rebound.evaluate()).re).toBe(3);
    const result = compile(rebound, { fallback: false });
    expect(result.code).toBe('1 + _.x');
    expect(result.run!({ x: 2 })).toBe(3);
    ce.popScope();
  });

  test('an expression compiled in the scope it was boxed in', () => {
    const { ce, expr } = shadowedWitness();
    ce.popScope();
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('10 + _.x');
    expect(result.run!({ x: 2 })).toBe(12);
  });

  test('a name given a value by the vars option', () => {
    const { ce, expr } = shadowedWitness();
    const result = compile(expr, { fallback: false, vars: { a: '_.aa' } });
    expect(result.code).toBe('_.aa + _.x');
    expect(result.run!({ x: 2, aa: 7 } as Record<string, number>)).toBe(9);
    ce.popScope();
  });
});

describe('CE-1273 a popped scope and operands of two scopes', () => {
  test('an expression boxed in a scope that was then popped reads its definitions', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.pushScope();
    ce.declare('b', 'real');
    ce.assign('b', 5);
    const expr = ce.box(['Add', 'x', 'b']);
    ce.popScope();
    expect(ce.withValues({ x: 2 }, () => expr.evaluate()).re).toBe(7);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('5 + _.x');
    expect(result.run!({ x: 2 })).toBe(7);
  });

  test('a name that the operands read from two definitions declines', () => {
    const { ce } = shadowedWitness();
    ce.popScope();
    const outer = ce.box('a');
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    const inner = ce.box('a');
    const expr = ce.function('Add', [outer, inner, ce.box('x')]);
    expect(ce.withValues({ x: 2 }, () => expr.evaluate()).re).toBe(13);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /the name "a" is read from scopes that give it different definitions/
    );
    // The decline falls back to the interpreter, which reads each operand
    // from its own scope.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(expr);
      expect(result.success).toBe(false);
      expect(result.diagnostic).toMatchObject({
        code: 'compile-error',
        kind: 'correctness',
        binding: 'a',
      });
      expect(result.run!({ x: 2 })).toBe(13);
      // The interval-js target builds its own fallback, which reads each
      // operand from its own scope too.
      const interval = compile(expr, { to: 'interval-js' });
      expect(interval.success).toBe(false);
      expect(interval.run!({ x: 2 })).toEqual({
        kind: 'interval',
        value: { lo: 13, hi: 13 },
      });
    } finally {
      warn.mockRestore();
    }
    ce.popScope();
  });
});

describe('CE-1273 what the choice of the scope reads', () => {
  /** A lazy operator with no lowering: its operand stays held, and an
   * evaluation reads it where it runs. A call of it falls back to the
   * interpreter. */
  function declareLazyDouble(ce: ComputeEngine) {
    ce.declare('L', {
      signature: '(any) -> real',
      lazy: true,
      evaluate: (ops: ReadonlyArray<{ evaluate(): { re: number } }>) =>
        ce.number(ops[0].evaluate().re * 2),
    } as never);
  }

  test('a free name declared after the boxing is read from its home scope', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Add', 'x', 'a']);
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 10);
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    expect(ce.withValues({ x: 2 }, () => expr.evaluate()).re).toBe(12);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('10 + _.x');
    expect(result.run!({ x: 2 })).toBe(12);
    ce.popScope();
  });

  test('the value of an entry of a dictionary', () => {
    const { ce } = shadowedWitness();
    ce.popScope();
    const dict = ce.box([
      'Dictionary',
      ['KeyValuePair', "'k'", ['Add', 'x', 'a']],
    ] as never);
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    expect(ce.withValues({ x: 2 }, () => dict.evaluate()).toString()).toBe(
      '{"k" -> 12}'
    );
    const result = compile(dict, { fallback: false });
    expect(result.run!({ x: 2 })).toEqual({ k: 12 });
    ce.popScope();
  });

  test('the body of a user function that the expression calls', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('b', 'real');
    ce.assign('b', 10);
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('t \\mapsto t + b'));
    const expr = ce.box(['f', 'x']);
    ce.pushScope();
    ce.declare('b', 'real');
    ce.assign('b', 1);
    expect(ce.withValues({ x: 2 }, () => expr.evaluate()).re).toBe(12);
    expect(compile(expr, { fallback: false }).run!({ x: 2 })).toBe(12);
    ce.popScope();
  });

  test('the fallback after a switch is built for the scope of the call', () => {
    // The compilation runs in the outer scope (`a` is 10 there), and `L`
    // has no lowering. The fallback evaluates in the scope of the call, as
    // `evaluate()` there does, and declares the held name `q` there, not in
    // the outer scope.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 10);
    declareLazyDouble(ce);
    const outer = ce.context.lexicalScope;
    const expr = ce.box(['Add', 'a', ['L', 'q']]);
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    const inner = ce.context.lexicalScope;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(expr);
      expect(result.success).toBe(false);
      expect(result.run!({ q: 3 } as never)).toBe(16);
      expect(outer.bindings.has('q')).toBe(false);
      expect(inner.bindings.has('q')).toBe(true);
      expect(ce.withValues({ q: 3 }, () => expr.evaluate()).re).toBe(16);
    } finally {
      warn.mockRestore();
      ce.popScope();
    }
  });

  test('a held operand is read from the scope of the call', () => {
    // The canonical `a` reads the outer scope (10), the held `a` of `L(a)`
    // is read where the evaluation runs (1): no scope reads both, and the
    // compilation declines.
    const { ce } = shadowedWitness();
    ce.popScope();
    declareLazyDouble(ce);
    const expr = ce.box(['Add', 'x', 'a', ['L', 'a']]);
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    expect(ce.withValues({ x: 2 }, () => expr.evaluate()).re).toBe(14);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /the name "a" is read from scopes that give it different definitions/
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(compile(expr).run!({ x: 2 })).toBe(14);
    } finally {
      warn.mockRestore();
      ce.popScope();
    }
  });

  test('the stored value of a vars input is not read', () => {
    // `v` is an input of the compiled code: its stored value `a + 0.5`
    // (the outer `a`) is hidden, so the compilation reads the `a` of the
    // scope that the expression was boxed in, and nothing else.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 10);
    ce.declare('v', 'real');
    ce.assign('v', ce.box(['Add', 'a', 0.5]));
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    const expr = ce.box(['Add', 'v', 'a']);
    const result = compile(expr, { fallback: false, vars: { v: '_.v' } });
    expect(result.code).toBe('1 + _.v');
    expect(result.run!({ v: 5 } as never)).toBe(6);
    ce.popScope();
  });

  test('a held name that a function literal of the expression binds', () => {
    // The held `a` of `L(a)` is the parameter of the literal; only the
    // canonical `a` reads a scope (the outer one, 10).
    const { ce } = shadowedWitness();
    ce.popScope();
    declareLazyDouble(ce);
    const expr = ce.box([
      'Add',
      'a',
      ['Apply', ['Function', ['L', 'a'], 'a'], 3],
    ]);
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    expect(expr.evaluate().re).toBe(16);
    expect(compile(expr, { fallback: false }).run!({})).toBe(16);
    ce.popScope();
  });

  // A host maps a name through `vars` to make it an input of the code. It
  // declares the name again, with no value, in the scope of the compilation
  // and binds the expression there (a slider that is dragged). The body of
  // a function that the expression calls reads the outer definition of the
  // name, which holds a value.
  function slider() {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('a', 2);
    ce.parse('f(x) := a x').evaluate();
    const outer = ce.parse('f(x) + a');
    ce.pushScope();
    ce.declare('a', { type: 'real' });
    return { ce, expr: ce.rebind(outer) };
  }

  test('a name mapped by vars is an input wherever it is read, and takes no part in the choice', () => {
    const { ce, expr } = slider();
    const result = compile(expr, {
      to: 'javascript',
      fallback: false,
      vars: { a: '_.a' },
    });
    expect(result.code).toBe('_.a + _fn_f(_.x)');
    expect(result.run!({ x: 3, a: 5 } as never)).toBe(20);
    ce.popScope();
  });

  test('without vars, the two definitions of the name make the compilation decline', () => {
    // The interpreter reads 2 in the body of `f` and the valueless `a` of
    // the pushed scope beside it: `a + 6` for x = 3.
    const { ce, expr } = slider();
    expect(() => compile(expr, { to: 'javascript', fallback: false })).toThrow(
      /"a" is read from scopes that give it different definitions/
    );
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.run!({ x: 3, a: 5 } as never)).toBe(11);
    ce.popScope();
  });

  // The value of a `vars` input is hidden from the analyses of the compiler
  // on every definition that an occurrence of the name reads, not only on the
  // one that the current scope gives: with the outer `a := 4` visible, `|a|`
  // was compiled to `_.a`, which is wrong for a negative input.
  test('the value of a vars input is hidden on the definition that the expression reads', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 4);
    const expr = ce.box(['Abs', 'a']);
    ce.pushScope();
    ce.declare('a', 'real');
    const result = compile(expr, { fallback: false, vars: { a: '_.a' } });
    expect(result.code).toBe('Math.abs(_.a)');
    expect(result.run!({ a: -3 } as never)).toBe(3);
    ce.popScope();
    expect(ce.box('a').evaluate().re).toBe(4);
  });

  test('the value of a vars input is hidden in the body of a function that the expression calls', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 4);
    ce.parse('f(x) := |a| x').evaluate();
    const outer = ce.parse('f(x)');
    ce.pushScope();
    ce.declare('a', { type: 'real' });
    const result = compile(ce.rebind(outer), {
      fallback: false,
      vars: { a: '_.a' },
    });
    expect(result.run!({ x: 2, a: -3 } as never)).toBe(6);
    ce.popScope();
    expect(ce.box('a').evaluate().re).toBe(4);
  });
});
