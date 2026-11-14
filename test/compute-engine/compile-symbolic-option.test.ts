import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

// The `symbolic` compile option: a symbol named in it is an input of the
// compiled code wherever the compilation reads its name (the expression, the
// bodies of the user functions it calls, the values of the symbols it
// reads). Its stored value is not read, and it is emitted as a plain input
// (`docs/COMPILATION-MODEL.md`, "The scope a compilation reads";
// `docs/plans/2026-11-11-bound-once-spec.md`, section 10, C6).

const run = (r: { run?: unknown }, v: object): unknown =>
  (r.run as (v: object) => unknown)(v);

describe('COMPILE the symbolic option', () => {
  test('a name with a value is an input, in the expression and in a called body', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 4);
    ce.parse('f(x) := |a| x').evaluate();
    const expr = ce.parse('f(x) + a');

    const folded = compile(expr, { fallback: false });
    expect(folded.code).toBe('4 + _fn_f(_.x)');
    expect(run(folded, { x: 2 })).toBe(12);

    const result = compile(expr, { fallback: false, symbolic: ['a'] });
    expect(result.code).toBe('_.a + _fn_f(_.x)');
    expect(result.preamble).toContain('x * Math.abs(_.a)');
    expect(run(result, { x: 2, a: -3 })).toBe(3);
    // The value is back after the compilation.
    expect(ce.box('a').evaluate().re).toBe(4);
  });

  test.each(['glsl', 'interval-js'] as const)(
    'the name is a plain input on %s',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('a', 'real');
      ce.assign('a', 4);
      const expr = ce.parse('a x');
      const result = compile(expr, { to, fallback: false, symbolic: ['a'] });
      expect(result.code).toMatch(to === 'glsl' ? /\ba\b/ : /_\.a\b/);
      expect(result.code).not.toMatch(/\b4(\.0)?\b/);
    }
  );

  test('the ir profile reads the option', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 4);
    const result = compile(ce.parse('|a| x'), {
      fallback: false,
      profile: 'ir',
      symbolic: ['a'],
    } as never);
    expect(run(result, { x: 2, a: -3 })).toBe(6);
  });

  test('a list read by index is an input', () => {
    const ce = new ComputeEngine();
    ce.declare('i', 'integer');
    ce.declare('S', 'list<real>');
    ce.assign('S', ce.box(['List', 1.5, 2.5, 3.5]));
    const expr = ce.box(['At', 'S', 'i']);
    const result = compile(expr, { fallback: false, symbolic: ['S'] });
    expect(result.code).toContain('_.S');
    expect(run(result, { i: 2, S: [10, 20, 30] })).toBe(20);
  });

  test('a name declared in a scope pushed around the compilation is read by a function defined outside', () => {
    // The body of `N` reads a free `x`: the scope of the function never
    // declares it. The host declares the axis in the scope of the
    // compilation, and names it in `symbolic`.
    const ce = new ComputeEngine();
    ce.declare('N', 'function');
    ce.assign('N', ce.parse('a\\mapsto\\lfloor ax\\rfloor'));
    ce.pushScope();
    ce.declare('x', 'real');
    const expr = ce
      .parse('\\frac{d}{dx}\\sum_{i=1}^{N(1)}\\cos(ix)')
      .evaluate();
    expect(() => compile(expr, { fallback: false })).toThrow(
      /"x" is read from scopes that give it different definitions/
    );
    const result = compile(expr, { fallback: false, symbolic: ['x'] });
    expect(run(result, { x: 2.5 })).toBeCloseTo(1.3193764052223205, 12);
    ce.popScope();
  });

  test('a parameter of a kernel with the name of a library operator', () => {
    // The body of `rf` was boxed where `N` is the library operator. The host
    // declares `N` as a real parameter in the scope of the compilation.
    const ce = new ComputeEngine();
    ce.declare('rf', '(number) -> list<number>');
    ce.assign(
      'rf',
      ce.box([
        'Function',
        [
          'Which',
          ['Equal', 'u', ['Add', 'N', -1]],
          ['List', 'u'],
          'True',
          ['Join', ['List', 'u'], ['rf', ['Add', 'u', 1]]],
        ],
        'u',
      ])
    );
    const expr = ce.box(['rf', 0]);
    ce.pushScope();
    ce.declare('N', 'real');
    const result = compile(expr, { fallback: false, symbolic: ['N'] });
    expect(run(result, { N: 5 })).toEqual([0, 1, 2, 3, 4]);
    ce.popScope();
  });

  test('a name with only an inferred type declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('u', 4);
    const expr = ce.parse('u x');
    expect(() =>
      compile(expr, { fallback: false, symbolic: ['u'] })
    ).toThrow(/"u" of the `symbolic` option has no declared type/);
    const result = compile(expr, { symbolic: ['u'] });
    expect(result.success).toBe(false);
    expect(run(result, { x: 2 })).toBe(8);
  });

  test('the decline is kept on interval-js, whose fallback compiles again', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('u', 4);
    const expr = ce.parse('u x');
    const result = compile(expr, { to: 'interval-js', symbolic: ['u'] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"u" of the `symbolic` option/);
  });

  test.each(['javascript', 'glsl', 'interval-js'] as const)(
    'a name declared again in the scope of the compilation and read in a called body, on %s',
    (to) => {
      // The target that chooses the scope by itself (interval-js) gets the
      // option too.
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('a', 'real');
      ce.assign('a', 2);
      ce.parse('f(x) := a x').evaluate();
      const outer = ce.parse('f(x) + a');
      ce.pushScope();
      ce.declare('a', 'real');
      const result = compile(ce.rebind(outer), {
        to,
        fallback: false,
        symbolic: ['a', 'x'],
      });
      expect(result.success).toBe(true);
      expect(result.code).toMatch(to === 'glsl' ? /\ba \+ _fn_f\(x\)/ : /_\.a/);
      ce.popScope();
    }
  );

  test.each(['const', 'let'] as const)(
    'a block local of a called function with the name of the option is the local (%s)',
    (keyword) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('u', 'real');
      executeEpsil(
        ce,
        `function g(w: real) -> real { ${keyword} u = w / 2; u * u }`
      );
      const options = { fallback: false, symbolic: ['x', 'u'] };
      // The local `u` of `g` is not the input `u`.
      expect(run(compile(ce.parse('g(x)'), options), { x: 4, u: 100 })).toBe(
        4
      );
      const both = compile(ce.parse('g(x) + u'), options);
      expect(both.code).toBe('_.u + _fn_g(_.x)');
      expect(run(both, { x: 4, u: 100 })).toBe(104);
      for (const to of ['glsl', 'interval-js'] as const)
        expect(compile(ce.parse('g(x)'), { ...options, to }).success).toBe(
          true
        );
    }
  );

  test.each([
    ['symbolic', { symbolic: ['a'] }],
    ['vars', { vars: { a: '_.a' } }],
  ] as const)(
    'the value is hidden in a body that was boxed before the name was declared (%s)',
    (_, option) => {
      // The `a` of the body had no definition when the body was boxed: it
      // reads the declaration made later, which holds 4.
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.parse('f(x) := |a| x').evaluate();
      ce.declare('a', 'real');
      ce.assign('a', 4);
      const outer = ce.parse('f(x)');
      ce.pushScope();
      ce.declare('a', { type: 'real' });
      const result = compile(ce.rebind(outer), { fallback: false, ...option });
      expect(result.preamble).toContain('x * Math.abs(_.a)');
      expect(run(result, { x: 2, a: -3 })).toBe(6);
      ce.popScope();
      expect(ce.box('a').evaluate().re).toBe(4);
    }
  );

  test('a target called directly reads the option', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 4);
    const expr = ce.parse('|a| x');
    const folded = new JavaScriptTarget().compile(expr, {});
    expect(folded.code).not.toContain('_.a');
    const result = new JavaScriptTarget().compile(expr, { symbolic: ['a'] });
    expect(result.code).toContain('Math.abs(_.a)');
  });

  test('a name that is a function defined with a signature declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse('g(t) := 2t').evaluate();
    expect(() =>
      compile(ce.parse('g(x)'), { fallback: false, symbolic: ['g'] })
    ).toThrow(/"g" of the `symbolic` option is a function/);
  });

  test('a constant that an occurrence reads declines, also when a later declaration has its name', () => {
    // The occurrence keeps reading the library constant; the declaration
    // made after the boxing has the same name.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.pushScope();
    const expr = ce.box(['Multiply', 'GoldenRatio', 'x']);
    ce.declare('GoldenRatio', 'real');
    expect(() =>
      compile(expr, { fallback: false, symbolic: ['GoldenRatio'] })
    ).toThrow(/"GoldenRatio" of the `symbolic` option is a constant/);
    ce.popScope();
  });

  test('canCompile() of the shader target reads the option', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('u', 4);
    const expr = ce.parse('u x');
    const target = ce._getCompilationTarget('glsl') as unknown as {
      canCompile(e: unknown, o: object): { ok: boolean };
    };
    expect(target.canCompile(expr, {}).ok).toBe(true);
    expect(target.canCompile(expr, { symbolic: ['u'] }).ok).toBe(false);
  });

  test('a name that holds a function declines', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.parse('t \\mapsto 2t'));
    const expr = ce.box(['Map', 'g', 'L']);
    expect(() =>
      compile(expr, { fallback: false, symbolic: ['g'] })
    ).toThrow(/"g" of the `symbolic` option holds a function/);
  });
});
