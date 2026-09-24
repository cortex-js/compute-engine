import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `CompilationResult.freeSymbolTypes` and the `strictTypes` compile option.
 *
 * `freeSymbolTypes` reports, for each free symbol, its engine type, the type
 * the compiled code reads it as on the target (`lowered`) and whether it was
 * declared (`provenance`). A host binds its inputs from `lowered`: on a
 * shader target it is the type of the uniform to declare.
 *
 * `strictTypes: true` makes a compile with an undeclared free symbol fail
 * closed, naming the symbol and its inferred type.
 *
 * Every test builds its OWN engine: a use of an undeclared symbol can narrow
 * its type for the lifetime of the engine.
 */

function run(ce: ComputeEngine, to: string, input: any, options = {}): any {
  const e = typeof input === 'string' ? ce.parse(input) : ce.box(input);
  return compile(e, { to, fallback: false, ...options } as any) as any;
}

function complexFunctionEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('f', { signature: '(complex) -> complex' });
  ce.assign('f', ce.parse('z \\mapsto z^2'));
  return ce;
}

describe('freeSymbolTypes', () => {
  it('a colour operand is a vec3 on the shader targets', () => {
    // The engine type of `a` does not say colour: `a` could also be a colour
    // string or a tuple. The shader reads a `vec3` of colour channels.
    const ce = new ComputeEngine();
    const colour = {
      type: 'color | string | tuple',
      lowered: 'vec3',
      provenance: 'inferred',
    };
    const g = run(ce, 'glsl', ['ColorMix', 'a', 'b', 0.5]);
    expect(g.success).toBe(true);
    expect(g.freeSymbolTypes).toEqual({ a: colour, b: colour });
    const w = run(ce, 'wgsl', ['ColorMix', 'a', 'b', 0.5]);
    expect(w.freeSymbolTypes.a).toEqual({ ...colour, lowered: 'vec3f' });
    const js = run(ce, 'javascript', ['ColorMix', 'a', 'b', 0.5]);
    expect(js.freeSymbolTypes.a).toEqual({ ...colour, lowered: 'color' });
  });

  it('the other colour operators read a vec3 too', () => {
    for (const expr of [
      ['ColorContrast', 'a', 'b'],
      ['ContrastingColor', 'a'],
      ['ColorToColorspace', 'a', "'oklab'"],
      ['AsOklch', 'a'],
      ['AsRgb', 'a'],
      ['AsHsl', 'a'],
      ['AsHsv', 'a'],
    ]) {
      const ce = new ComputeEngine();
      expect(run(ce, 'glsl', expr).freeSymbolTypes.a.lowered).toBe('vec3');
    }
  });

  it('an argument of a complex function is a vec2', () => {
    const ce = complexFunctionEngine();
    const complex = {
      type: 'complex',
      lowered: 'vec2',
      provenance: 'inferred',
    };
    expect(run(ce, 'glsl', 'f(x)').freeSymbolTypes).toEqual({ x: complex });
    expect(run(ce, 'wgsl', 'f(x)').freeSymbolTypes).toEqual({
      x: { ...complex, lowered: 'vec2f' },
    });
  });

  it('a declared real symbol is a float, declared', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(run(ce, 'glsl', '\\sin(x) + y').freeSymbolTypes).toEqual({
      x: { type: 'real', lowered: 'float', provenance: 'declared' },
      y: { type: 'number', lowered: 'float', provenance: 'inferred' },
    });
  });

  it('a point, a matrix and a fixed-length list on the shader targets', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<real, real>');
    ce.declare('q', 'tuple<real, real, real>');
    ce.declare('M', 'matrix<2x2>');
    ce.declare('L', 'list<real^5>');
    expect(run(ce, 'glsl', 'p + p').freeSymbolTypes.p).toEqual({
      type: 'tuple<real, real>',
      lowered: 'vec2',
      provenance: 'declared',
    });
    expect(run(ce, 'wgsl', 'q').freeSymbolTypes.q.lowered).toBe('vec3f');
    expect(
      run(ce, 'glsl', ['Multiply', 'M', 2]).freeSymbolTypes.M.lowered
    ).toBe('mat2');
    expect(run(ce, 'glsl', ['At', 'L', 2]).freeSymbolTypes.L.lowered).toBe(
      'float[5]'
    );
    expect(run(ce, 'wgsl', ['At', 'L', 2]).freeSymbolTypes.L.lowered).toBe(
      'array<f32, 5>'
    );
  });

  it('a boolean is a bool on the shader targets', () => {
    const ce = new ComputeEngine();
    const r = run(ce, 'glsl', ['If', ['And', 'A', 'B'], 1, 2]);
    expect(r.freeSymbolTypes.A).toEqual({
      type: 'boolean',
      lowered: 'bool',
      provenance: 'inferred',
    });
  });

  it('JavaScript: the runner value convention', () => {
    const ce = complexFunctionEngine();
    ce.declare('p', 'tuple<real, real>');
    ce.declare('B', 'boolean');
    const r = run(ce, 'javascript', [
      'Add',
      ['Arg', ['f', 'x']],
      't',
      ['At', 'p', 1],
      ['If', 'B', 1, 0],
    ]);
    expect(r.success).toBe(true);
    expect(r.freeSymbolTypes).toEqual({
      x: { type: 'complex', lowered: 'complex', provenance: 'inferred' },
      t: { type: 'number', lowered: 'number', provenance: 'inferred' },
      p: {
        type: 'tuple<real, real>',
        lowered: 'point',
        provenance: 'declared',
      },
      B: { type: 'boolean', lowered: 'boolean', provenance: 'declared' },
    });
    // The complex input is read as `{ re, im }`.
    expect(
      r.run({ x: { re: 0, im: 1 }, t: 0, p: [0, 0], B: false })
    ).toBeCloseTo(Math.PI, 12);
  });

  it('Python', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const r = run(ce, 'python', 'x^2 + \\sin(n)');
    expect(r.freeSymbolTypes).toEqual({
      x: { type: 'number', lowered: 'float', provenance: 'inferred' },
      n: { type: 'real', lowered: 'float', provenance: 'declared' },
    });
  });

  it('interval-js: a real number is an interval', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const r = run(ce, 'interval-js', '\\sin(t)');
    expect(r.freeSymbolTypes).toEqual({
      t: { type: 'real', lowered: 'interval', provenance: 'declared' },
    });
  });

  it('the interpreter fallback reports the types too', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Foo', 'x']);
    const r = compile(e, { to: 'glsl' } as any) as any;
    expect(r.success).toBe(false);
    expect(r.freeSymbolTypes.x.provenance).toBe('inferred');
  });
});

describe('strictTypes', () => {
  it('an undeclared free symbol fails closed (GLSL)', () => {
    const ce = complexFunctionEngine();
    expect(() => run(ce, 'glsl', 'f(x)', { strictTypes: true })).toThrow(
      'strictTypes: declare `x` (inferred `complex`, would lower to `vec2`)'
    );
    // With the fallback, the result is a decline with the same error, an
    // interpreter-backed `run` and the type report of the compilation.
    const r = compile(ce.parse('f(x)'), {
      to: 'glsl',
      strictTypes: true,
    } as any) as any;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^strictTypes: declare `x`/);
    expect(r.freeSymbolTypes.x.lowered).toBe('vec2');
  });

  it('an undeclared free symbol fails closed (JavaScript)', () => {
    const ce = complexFunctionEngine();
    let message = '';
    try {
      run(ce, 'javascript', 'f(x) + y', { strictTypes: true });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^strictTypes: /);
    expect(message).toContain(
      'declare `x` (inferred `complex`, would lower to `complex`)'
    );
    expect(message).toContain(
      'declare `y` (inferred `number`, would lower to `number`)'
    );
    const r = compile(ce.parse('f(x)'), {
      to: 'javascript',
      strictTypes: true,
    } as any) as any;
    expect(r.success).toBe(false);
    expect(r.run({ x: { re: 0, im: 1 } })).toBe(-1);
  });

  it('declared free symbols compile', () => {
    const ce = complexFunctionEngine();
    ce.declare('x', 'complex');
    for (const to of ['glsl', 'wgsl', 'javascript']) {
      const r = run(ce, to, '\\arg(f(x))', { strictTypes: true });
      expect(r.success).toBe(true);
      expect(r.freeSymbolTypes.x.provenance).toBe('declared');
    }
  });

  it('a symbol declared in a scope that was popped is declared', () => {
    // The provenance is read from the definition the occurrence of `q` is
    // bound to, not from the scope current at compile time.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('q', 'real');
    const e = ce.parse('q + 1');
    ce.popScope();
    const r = compile(e, {
      to: 'javascript',
      fallback: false,
      strictTypes: true,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.freeSymbolTypes.q).toEqual({
      type: 'real',
      lowered: 'number',
      provenance: 'declared',
    });
    expect(r.run({ q: 2 })).toBe(3);
  });

  it('a matrix type is spelled as in the entry diagnostic', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'matrix');
    const r = run(ce, 'javascript', '\\det(N)');
    expect(r.freeSymbolTypes.N.type).toBe('matrix<number>');
    expect(() =>
      r.run({
        N: [
          [1, { re: 2, im: 3 }],
          [3, 4],
        ],
      })
    ).toThrow(/"N" \(type `matrix<number>`\)/);
  });

  it('is off by default', () => {
    const ce = complexFunctionEngine();
    expect(run(ce, 'glsl', 'f(x)').success).toBe(true);
  });
});

describe('Tycho item 308: a complex argument of a user function on GLSL', () => {
  // The rows of the Tycho probe
  // `scripts/repros/2026-09-23-d263-glsl-complex-user-fn-probe.mts`.
  const ce = new ComputeEngine();
  ce.declare('f', { signature: '(unknown) -> unknown' });
  ce.assign('f', ce.parse('z \\mapsto z^2'));
  for (const latex of [
    '\\arg((x+iy)^2)',
    '|(x+iy)^2|',
    '\\arg(f(x+iy))',
    '|f(x+iy)|',
  ])
    it(latex, () => {
      expect(run(ce, 'glsl', latex).success).toBe(true);
      expect(run(ce, 'wgsl', latex).success).toBe(true);
    });
});
