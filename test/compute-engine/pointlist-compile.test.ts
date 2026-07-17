import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * `PointList` compile handler (Tycho item 25 follow-up).
 *
 * When no component of a `PointList` is provably non-scalar, it is a plain
 * point and compiles byte-identically to the equivalent `Tuple(...)` on each
 * target — including the load-bearing case of *free* plot variables (typed
 * `unknown`), which the compile model treats as numeric parameters exactly as
 * it does for `Tuple`. A provably non-scalar component (a subtype of
 * `collection`: list, set, tuple, or a union containing such a member) fails
 * closed exactly as before (throw by default, `success: false` with
 * `{ fallback: true }`). The evaluate path is unchanged.
 */

function freshEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.declare('y', 'number');
  ce.declare('z', 'number');
  ce.declare('w', 'number');
  ce.declare('L', 'list<number>');
  return ce;
}

describe('PointList compile — scalar parity with Tuple', () => {
  const ce = freshEngine();

  // Targets that lower a `Tuple` to a concrete value. `interval-javascript`
  // has no `Tuple` lowering, so it is covered separately (both `Tuple` and
  // `PointList` must fail closed there).
  const targets: Array<[string, { compile: (e: any, o?: any) => any }]> = [
    ['javascript', new JavaScriptTarget()],
    ['glsl', new GLSLTarget()],
    ['wgsl', new WGSLTarget()],
    ['python', new PythonTarget()],
  ];

  const componentSets = [
    ['x', 'y'],
    ['x', 'y', 'z'],
    ['x', 'y', 'z', 'w'],
  ];

  for (const [name, target] of targets) {
    for (const comps of componentSets) {
      it(`${name}: PointList(${comps.join(',')}) emits identically to Tuple`, () => {
        const tuple = target.compile(ce.box(['Tuple', ...comps]), {
          realOnly: true,
        });
        const pointList = target.compile(ce.box(['PointList', ...comps]), {
          realOnly: true,
        });
        expect(tuple.success).toBe(true);
        expect(pointList.success).toBe(true);
        expect(pointList.code).toBe(tuple.code);
      });
    }
  }

  it('javascript: PointList(x,y) emits the expected JS array', () => {
    const r = new JavaScriptTarget().compile(ce.box(['PointList', 'x', 'y']), {
      realOnly: true,
    });
    expect(r.code).toBe('[_.x, _.y]');
  });

  it('glsl: PointList(x,y) emits vec2(x, y)', () => {
    const r = new GLSLTarget().compile(ce.box(['PointList', 'x', 'y']), {
      realOnly: true,
    });
    expect(r.code).toBe('vec2(x, y)');
  });

  it('wgsl: PointList(x,y) emits vec2f(x, y)', () => {
    const r = new WGSLTarget().compile(ce.box(['PointList', 'x', 'y']), {
      realOnly: true,
    });
    expect(r.code).toBe('vec2f(x, y)');
  });

  it('python: PointList(x,y) emits the Python tuple', () => {
    const r = new PythonTarget().compile(ce.box(['PointList', 'x', 'y']));
    expect(r.code).toBe('(x, y)');
  });
});

describe('PointList compile — interval-js parity (both fail closed)', () => {
  const ce = freshEngine();
  const iv = new IntervalJavaScriptTarget();

  it('a scalar Tuple and PointList both fail closed on interval-js', () => {
    const tuple = iv.compile(ce.box(['Tuple', 'x', 'y']));
    const pointList = iv.compile(ce.box(['PointList', 'x', 'y']));
    expect(tuple.success).toBe(false);
    expect(pointList.success).toBe(false);
  });
});

describe('PointList compile — render-shaped case s(PointList(x,y))', () => {
  // s(P) := PointX(P)^2 + PointY(P)^2 - 4, inlined as the importer's
  // `expandFunctionRefs` would produce it.
  const body = (ce: ComputeEngine, head: string) =>
    ce.box([
      'Subtract',
      [
        'Add',
        ['Power', ['PointX', [head, 'x', 'y']], 2],
        ['Power', ['PointY', [head, 'x', 'y']], 2],
      ],
      4,
    ]);

  it('javascript: PointList-spelled body compiles identically to the Tuple-spelled body', () => {
    const ce = freshEngine();
    const js = new JavaScriptTarget();
    const withPointList = js.compile(body(ce, 'PointList'), { realOnly: true });
    const withTuple = js.compile(body(ce, 'Tuple'), { realOnly: true });
    expect(withPointList.success).toBe(true);
    expect(withTuple.success).toBe(true);
    expect(withPointList.code).toBe(withTuple.code);
  });

  it('javascript: the compiled body agrees with the interpreter at sample points', () => {
    const js = new JavaScriptTarget();
    const compiled = js.compile(body(freshEngine(), 'PointList'), {
      realOnly: true,
    });
    expect(compiled.success).toBe(true);
    const run = compiled.run as (scope: Record<string, number>) => number;

    for (const [gx, gy] of [
      [3, 4],
      [1, 1],
      [0, 2],
      [-2, 5],
    ]) {
      // Interpreter reference (fresh engine so the assigned values stick).
      const ce = new ComputeEngine();
      ce.assign('x', gx);
      ce.assign('y', gy);
      const expected = body(ce, 'PointList').evaluate().re;
      expect(run({ x: gx, y: gy })).toBeCloseTo(expected as number, 10);
    }
  });

  it('javascript: the LaTeX-parsed body with FREE plot variables compiles identically to the Tuple spelling and runs the same', () => {
    // The load-bearing render case: a per-pixel body is parsed LaTeX whose
    // `x`/`y` are free (undeclared → `unknown`). The compile model treats free
    // unknown symbols as numeric parameters, so `PointList(x, y)` must compile
    // its components as scalar slots exactly as the `(x, y)` Tuple spelling.
    const ce = new ComputeEngine();
    const plBody =
      '\\operatorname{PointX}(\\operatorname{PointList}(x,y))^2 + \\operatorname{PointY}(\\operatorname{PointList}(x,y))^2 - 4';
    const tpBody =
      '\\operatorname{PointX}((x,y))^2 + \\operatorname{PointY}((x,y))^2 - 4';
    const pl = compile(ce.parse(plBody)) as unknown as {
      success: boolean;
      code: string;
      run: (s: Record<string, number>) => number;
    } & ((s: Record<string, number>) => number);
    const tp = compile(ce.parse(tpBody)) as typeof pl;
    expect(pl.success).toBe(true);
    expect(tp.success).toBe(true);
    // Byte-identical source. (A point accessor over an atomic tuple types
    // its component `number` — see `pointComponentType` — so the body stays
    // scalar-typed and compiles to plain scalar code, not `_SYS.bcast`.)
    expect(pl.code).toBe(tp.code);
    // Run parity + interpreter parity.
    for (const [gx, gy] of [
      [3, 4],
      [1, 1],
      [-2, 5],
    ]) {
      const ie = new ComputeEngine();
      ie.assign('x', gx);
      ie.assign('y', gy);
      const interp = ie.parse(plBody).evaluate().re as number;
      expect(pl.run({ x: gx, y: gy })).toBeCloseTo(interp, 10);
      expect(pl.run({ x: gx, y: gy })).toBe(tp.run({ x: gx, y: gy }));
    }
  });

  it('interval-js: PointList- and Tuple-spelled bodies fall back to the interpreter with equal results', () => {
    const ce = freshEngine();
    const iv = new IntervalJavaScriptTarget();
    const withPointList = iv.compile(body(ce, 'PointList'), { fallback: true });
    const withTuple = iv.compile(body(ce, 'Tuple'), { fallback: true });
    // Both fail closed (PointX/PointY have no interval kernel) and fall back.
    expect(withPointList.success).toBe(false);
    expect(withTuple.success).toBe(false);
    const plRun = withPointList.run as (s: Record<string, number>) => unknown;
    const tpRun = withTuple.run as (s: Record<string, number>) => unknown;
    expect(plRun({ x: 3, y: 4 })).toEqual(tpRun({ x: 3, y: 4 }));
    expect(plRun({ x: 3, y: 4 })).toEqual({ lo: 21, hi: 21 });
  });
});

describe('PointList compile — scalar-slot type coverage', () => {
  // The guard fails closed only for a *provably non-scalar* component (a
  // subtype of `collection`). `unknown` and `value` are scalar slots that
  // `Tuple` compiles, so `PointList` must too.
  it('javascript: an `unknown`-typed component compiles (parity with Tuple)', () => {
    const ce = new ComputeEngine(); // x, y undeclared → unknown
    const js = new JavaScriptTarget();
    const pl = js.compile(ce.box(['PointList', 'x', 'y']), { realOnly: true });
    const tp = js.compile(ce.box(['Tuple', 'x', 'y']), { realOnly: true });
    expect(pl.success).toBe(true);
    expect(pl.code).toBe(tp.code);
  });

  it('javascript: a `value`-typed component compiles (parity with Tuple)', () => {
    const ce = new ComputeEngine();
    ce.declare('vv', 'value');
    ce.declare('x', 'number');
    const js = new JavaScriptTarget();
    const pl = js.compile(ce.box(['PointList', 'x', 'vv']), { realOnly: true });
    const tp = js.compile(ce.box(['Tuple', 'x', 'vv']), { realOnly: true });
    expect(pl.success).toBe(true);
    expect(pl.code).toBe(tp.code);
  });
});

describe('PointList compile — non-scalar component fails closed', () => {
  const ce = freshEngine();
  ce.declare('U', 'number | list<number>');

  it('javascript: a list-typed component throws by default', () => {
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(ce.box(['PointList', 'x', 'L']), { realOnly: true })
    ).toThrow();
  });

  it('javascript: a list-typed component yields success:false with { fallback: true }', () => {
    const js = new JavaScriptTarget();
    const r = js.compile(ce.box(['PointList', 'x', 'L']), { fallback: true });
    expect(r.success).toBe(false);
    expect(typeof r.run).toBe('function');
  });

  it('javascript: a `number | list<number>` union component fails closed', () => {
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(ce.box(['PointList', 'x', 'U']), { realOnly: true })
    ).toThrow();
    const r = js.compile(ce.box(['PointList', 'x', 'U']), { fallback: true });
    expect(r.success).toBe(false);
  });

  it('glsl: a list-typed component throws by default', () => {
    const glsl = new GLSLTarget();
    expect(() =>
      glsl.compile(ce.box(['PointList', 'x', 'L']), { realOnly: true })
    ).toThrow();
  });
});

describe('PointList evaluate path is unchanged', () => {
  it('a collection component still transposes to a List of point-tuples', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['PointList', -6, ['List', 1, 2, 3]]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.json).toEqual([
      'List',
      ['Tuple', -6, 1],
      ['Tuple', -6, 2],
      ['Tuple', -6, 3],
    ]);
  });

  it('all-scalar PointList still evaluates to a plain point (Tuple)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['PointList', 1, 2]).evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.json).toEqual(['Tuple', 1, 2]);
  });
});
