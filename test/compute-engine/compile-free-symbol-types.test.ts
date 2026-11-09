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
    // The GLSL fragment gives `color | string | tuple` no type.
    expect(() => run(ce, 'glsl', ['ColorMix', 'a', 'b', 0.5])).toThrow(
      /GLSL fragment/
    );
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
      // The GLSL fragment gives `color | string | tuple` no type.
      expect(() => run(ce, 'glsl', expr)).toThrow(/GLSL fragment/);
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
    // The fragment gives a matrix no type.
    expect(() => run(ce, 'glsl', ['Multiply', 'M', 2])).toThrow(
      /The symbol `M` has the type `matrix<2x2>`, which has no type in the GLSL fragment/
    );
    expect(run(ce, 'glsl', ['At', 'L', 2]).freeSymbolTypes.L.lowered).toBe(
      'float[5]'
    );
  });

  it('a tuple that no shader type holds is not a point on the shader targets', () => {
    // A pair of points, a mixed tuple, a tuple of complex numbers, a
    // one-element tuple and the bare `tuple` type have no shader type. A read
    // of such a symbol declines; it was emitted as a bare identifier with
    // `lowered: 'point'`, `First(T)` as `T.x` and a local copy as
    // `vec2 Q; Q = M;`.
    for (const to of ['glsl']) {
      const ce = new ComputeEngine();
      ce.declare('T', 'tuple<tuple<real, real>, tuple<real, real>>');
      ce.declare('M', 'tuple<real, tuple<real, real>>');
      ce.declare('C', 'tuple<complex, complex>');
      ce.declare('O', 'tuple<real>');
      ce.declare('X', 'tuple');
      for (const [input, name] of [
        ['T', 'T'],
        [['At', 'T', 1], 'T'],
        [['PointX', ['At', 'T', 1]], 'T'],
        [['First', 'T'], 'T'],
        ['M', 'M'],
        [['At', 'M', 2], 'M'],
        [['Block', ['Assign', 'Q', 'M'], 'Q'], 'M'],
        [['Block', ['Assign', 'Q', 'T'], 'Q'], 'T'],
        [['First', 'C'], 'C'],
        ['O', 'O'],
        ['X', 'X'],
      ] as const) {
        let error = '';
        let result: any;
        try {
          result = run(ce, to, input);
        } catch (e) {
          error = (e as Error).message;
        }
        expect(result?.success ?? false).toBe(false);
        expect(error).toMatch(/GLSL fragment/);
        // The `At` lowering declines first, with its own reason. `First`
        // compiles as `At` with the index 1, so it declines there too.
        const viaAt = /"(At|First)"/.test(JSON.stringify(input));
        // A block local whose type is a tuple of tuples declines with the
        // local's own reason before the symbol is read.
        if (!viaAt)
          expect(error).toMatch(
            new RegExp(
              `The symbol \`${name}\` has the type|The local \`Q\` is a list`
            )
          );
      }
    }
  });

  it('a tuple of 2 to 4 booleans is a boolean vector on the shader targets', () => {
    // A host can declare `b` as a `bvec2`,
    // so a read of it compiles, as it did before `First` compiled as `At`.
    // The interpreter gives 1 for `If(First((True, False)), 1, 0)`.
    const ce = new ComputeEngine();
    ce.declare('b', 'tuple<boolean, boolean>');
    expect(
      ce.box(['If', ['First', ['Tuple', 'True', 'False']], 1, 0]).evaluate().re
    ).toBe(1);
    for (const to of ['glsl']) {
      const conv = 'float';
      // The fragment gives a tuple of booleans no type.
      const refusal =
        /The symbol `b` has the type `tuple<boolean, boolean>`, which has no type in the GLSL fragment/;
      expect(() => run(ce, to, 'b')).toThrow(refusal);
      expect(() => run(ce, to, ['First', 'b'])).toThrow(refusal);
      expect(() => run(ce, to, ['If', ['First', 'b'], 1, 0])).toThrow(refusal);
      expect(() => run(ce, to, ['If', ['Last', 'b'], 1, 0])).toThrow(refusal);
      // With a name for the input in `vars`.
      expect(() =>
        run(ce, to, ['If', ['Second', 'b'], 1, 0], { vars: { b: 'u_b' } })
      ).toThrow(refusal);
      // A pair has no third element.
      expect(() => run(ce, to, ['Third', 'b'])).toThrow(refusal);
    }
  });

  it('a tuple of more than 4 real numbers is an array on the shader targets', () => {
    const ce = new ComputeEngine();
    ce.declare('F', 'tuple<real, real, real, real, real>');
    ce.declare('k', 'integer');
    // The fragment gives a tuple of more than 4 reals no type.
    expect(() => run(ce, 'glsl', ['At', 'F', 'k'])).toThrow(
      /The symbol `F` has the type `tuple<real, real, real, real, real>`, which has no type in the GLSL fragment/
    );
  });

  it('a list of points is an array of vectors on the shader targets', () => {
    // `At(P, k)` passes `P` to the `_gpu_atpM_N` helper, whose parameter is
    // an array of `vecM`, so the host must declare the input with that type,
    // not as an array of floats. (CE-685)
    for (const m of [2, 3, 4]) {
      const ce = new ComputeEngine();
      ce.declare('P', `list<tuple<${Array(m).fill('real').join(', ')}>^3>`);
      ce.declare('k', 'integer');
      const g = run(ce, 'glsl', ['At', 'P', 'k']);
      expect(g.success).toBe(true);
      expect(g.code).toBe(`_gpu_atp${m}_3(P, k)`);
      expect(g.preamble).toContain(`_gpu_atp${m}_3(vec${m} v[3], float i)`);
      expect(g.freeSymbolTypes.P.lowered).toBe(`vec${m}[3]`);
    }
    // Integer coordinates are read as floats, as for any other point.
    const ce = new ComputeEngine();
    ce.declare('P', 'list<tuple<integer, integer>^3>');
    expect(run(ce, 'glsl', ['At', 'P', 1]).freeSymbolTypes.P.lowered).toBe(
      'vec2[3]'
    );
  });

  it('an assignment of an input list of points declines', () => {
    // A write to a symbol declared in the engine declines.
    for (const to of ['glsl']) {
      const ce = new ComputeEngine();
      ce.declare('P', 'list<tuple<real, real>^3>');
      ce.declare('k', 'integer');
      const points = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4], ['Tuple', 5, 6]];
      expect(() =>
        run(ce, to, ['Block', ['Assign', 'P', points], ['At', 'P', 'k']])
      ).toThrow(/`Assign` writes `P`, which is not a local of the function/);
    }
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
    for (const to of ['glsl', 'javascript']) {
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

  it('a popped-scope symbol in a node shared with a folded value is declared', () => {
    // `[a, q + 1]` with `a := q + 1` holds ONE node `q + 1` twice: in the
    // value of `a` and as the second element. The walk meets it first in the
    // value of `a`, where an occurrence is not recorded. The second, direct,
    // visit must not be skipped, or the occurrence of `q` is missing and its
    // type is read from the current scope, where `q` is not declared.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('q', 'real');
    const e = ce.parse('q + 1');
    ce.popScope();
    ce.declare('a', 'unknown');
    ce.assign('a', e);
    for (const list of [
      ce.function('List', [ce.symbol('a'), e]),
      ce.function('List', [e, ce.symbol('a')]),
    ]) {
      const r = compile(list, {
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
      expect(r.run({ q: 2 })).toEqual([3, 3]);
    }
  });

  it('a matrix type is spelled as in the string refusal', () => {
    // The runner refuses a string for a binding that the compiled code reads
    // as an array, and its message spells the type of the binding as the
    // type report does.
    const ce = new ComputeEngine();
    ce.declare('N', 'matrix');
    const r = run(ce, 'javascript', '\\det(N)');
    expect(r.freeSymbolTypes.N.type).toBe('matrix<number>');
    expect(() => r.run({ N: 'abc' })).toThrow(/"N" \(type `matrix<number>`\)/);
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
    });
});

describe('a bound occurrence of a free name', () => {
  // The index `q` of the sum is a local of the sum, an integer. The free `q`
  // outside the sum is a different variable, and the report describes it.
  const SUM_AND_FREE = [
    'List',
    ['Sum', 'q', ['Limits', 'q', 1, 'n']],
    ['Real', 'q'],
  ];

  it('the report reads the free occurrence, not the index', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'complex');
    ce.declare('n', 'integer');
    const r = run(ce, 'glsl', SUM_AND_FREE);
    expect(r.success).toBe(true);
    expect(r.freeSymbolTypes.q).toEqual({
      type: 'complex',
      lowered: 'vec2',
      provenance: 'declared',
    });
  });

  it('strictTypes: the index does not declare the free name', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    expect(() =>
      run(ce, 'javascript', SUM_AND_FREE, { strictTypes: true })
    ).toThrow(/declare `q`/);
  });
});
