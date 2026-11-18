import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `CompilationResult.freeSymbolTypes`.
 *
 * `freeSymbolTypes` reports, for each free symbol, its engine type, the type
 * the compiled code reads it as on the target (`lowered`) and whether it was
 * declared (`provenance`). A host binds its inputs from `lowered`: on a
 * shader target it is the type of the uniform to declare.
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
    // GLSL gives a matrix no type.
    expect(() => run(ce, 'glsl', ['Multiply', 'M', 2])).toThrow(
      /a list of rank 2 on glsl/
    );
    expect(run(ce, 'glsl', ['At', 'L', 2]).freeSymbolTypes.L.lowered).toBe(
      'float[5]'
    );
  });

  it('a tuple that no shader type holds is not a point on the shader targets', () => {
    // A pair of points, a mixed tuple, a tuple of complex numbers and the
    // bare `tuple` type have no shader type. A read
    // of such a symbol declines; it was emitted as a bare identifier with
    // `lowered: 'point'`, `First(T)` as `T.x` and a local copy as
    // `vec2 Q; Q = M;`.
    for (const to of ['glsl']) {
      const ce = new ComputeEngine();
      ce.declare('T', 'tuple<tuple<real, real>, tuple<real, real>>');
      ce.declare('M', 'tuple<real, tuple<real, real>>');
      ce.declare('C', 'tuple<complex, complex>');
      ce.declare('X', 'tuple');
      for (const [input, name] of [
        ['T', 'T'],
        [['At', 'T', 1], 'T'],
        [['PointX', ['At', 'T', 1]], 'T'],
        [['First', 'T'], 'T'],
        ['M', 'M'],
        [['At', 'M', 2], 'M'],
        [['Block', ['Declare', 'Q', "'unknown'", 'M'], 'Q'], 'M'],
        [['Block', ['Declare', 'Q', "'unknown'", 'T'], 'Q'], 'T'],
        [['First', 'C'], 'C'],
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
        expect(error).toMatch(/Could not compile/);
      }
    }
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
      ).toThrow(/a write to a name that is not a local/);
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

  it('interval-js: a real number is an interval', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const r = run(ce, 'interval-js', '\\sin(t)');
    expect(r.freeSymbolTypes).toEqual({
      t: { type: 'real', lowered: 'interval', provenance: 'declared' },
    });
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

});
