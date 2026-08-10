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
 * it does for `Tuple`. A component that is a list SOURCE lowers on JavaScript
 * to the zipped list of points (see `pointlist-compile-zip.test.ts`); on every
 * other target, and for a component that is neither a scalar slot nor a source
 * (a tuple, set, map, or a union with a collection member), it fails closed
 * (throw by default, `success: false` with `{ fallback: true }`). The evaluate
 * path is unchanged.
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

describe('PointList compile — non-scalar component', () => {
  const ce = freshEngine();
  ce.declare('U', 'number | list<number>');

  // A list-typed component is a zip SOURCE on JavaScript: a list of points is
  // an expression-level value there (nested arrays), so it compiles to the
  // zip rather than failing closed. (It stays a decline on the shader targets
  // — ruling 3: no runtime-length expression values.)
  it('javascript: a list-typed component compiles to the zipped point list', () => {
    const js = new JavaScriptTarget();
    const r = js.compile(ce.box(['PointList', 'x', 'L']), { realOnly: true });
    expect(r.success).toBe(true);
    const run = r.run as (s: Record<string, unknown>) => unknown;
    expect(run({ x: -6, L: [1, 2, 3] })).toEqual([
      [-6, 1],
      [-6, 2],
      [-6, 3],
    ]);
  });

  it('javascript: a list-typed component runs without a fallback', () => {
    const js = new JavaScriptTarget();
    const r = js.compile(ce.box(['PointList', 'x', 'L']), { fallback: true });
    expect(r.success).toBe(true);
    expect(typeof r.run).toBe('function');
  });

  it('javascript: a `number | list<number>` union component fails closed', () => {
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(ce.box(['PointList', 'x', 'U']), { realOnly: true })
    ).toThrow(
      /PointList: cannot compile — component 2 \(type `[^`]+`\) is neither a scalar slot nor a list source; its per-point value cannot be determined at compile time\. Fail closed \(D6\)\./
    );
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

// Tycho item 158: `Dot` accepts fixed numeric `Tuple`/`PointList` operands
// (the sanctioned spelling of the Desmos point inner product), and the GPU
// targets lower it to the native `dot()` builtin. The lowering itself
// predates the item — the `Dot: 'dot'` GPU table entry and the generic
// operand-shape gate (`gpuCheckOperandShapes`) — but was unreachable for
// tuples while validation rejected them; these tests pin the now-reachable
// route on every target.
describe('Dot over points — compile targets (Tycho item 158)', () => {
  const ce = freshEngine();

  it('glsl: Dot(Tuple, Tuple) emits the native dot() over vecN', () => {
    const r = new GLSLTarget().compile(
      ce.box(['Dot', ['Tuple', 'x', 'y'], ['Tuple', 3, 4]]),
      { realOnly: true }
    );
    expect(r.success).toBe(true);
    expect(r.code).toBe('dot(vec2(x, y), vec2(3.0, 4.0))');
  });

  it('glsl: PointList operands emit identically to Tuple operands', () => {
    const glsl = new GLSLTarget();
    const viaPointList = glsl.compile(
      ce.box(['Dot', ['PointList', 'x', 'y'], ['PointList', 3, 4]]),
      { realOnly: true }
    );
    const viaTuple = glsl.compile(
      ce.box(['Dot', ['Tuple', 'x', 'y'], ['Tuple', 3, 4]]),
      { realOnly: true }
    );
    expect(viaPointList.success).toBe(true);
    expect(viaPointList.code).toBe(viaTuple.code);
  });

  it('glsl: point-typed symbol operands emit dot(p, q)', () => {
    const eng = new ComputeEngine();
    eng.declare('p', 'tuple<number, number>');
    eng.declare('q', 'tuple<number, number>');
    const r = new GLSLTarget().compile(eng.box(['Dot', 'p', 'q']), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('dot(p, q)');
  });

  it('glsl: mismatched vector widths fail closed', () => {
    expect(() =>
      new GLSLTarget().compile(
        ce.box(['Dot', ['Tuple', 'x', 'y'], ['Tuple', 1, 2, 3]]),
        { realOnly: true }
      )
    ).toThrow(/different widths/);
  });

  it('glsl: a 5-component point fails closed (no vec5)', () => {
    expect(() =>
      new GLSLTarget().compile(
        ce.box(['Dot', ['Tuple', 1, 2, 3, 4, 5], ['Tuple', 1, 2, 3, 4, 5]]),
        { realOnly: true }
      )
    ).toThrow();
  });

  it('wgsl: Dot(Tuple, Tuple) emits dot() over vecNf', () => {
    const r = new WGSLTarget().compile(
      ce.box(['Dot', ['Tuple', 'x', 'y'], ['Tuple', 3, 4]]),
      { realOnly: true }
    );
    expect(r.success).toBe(true);
    expect(r.code).toBe('dot(vec2f(x, y), vec2f(3.0, 4.0))');
  });

  it('javascript: compiled Dot matches the interpreter', () => {
    const expr = ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    const r = new JavaScriptTarget().compile(expr, { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(11);
    expect(expr.evaluate().toString()).toBe('11');
  });

  it('python: Dot(Tuple, Tuple) emits np.dot', () => {
    const r = new PythonTarget().compile(
      ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 3, 4]]),
      { realOnly: true }
    );
    expect(r.success).toBe(true);
    expect(r.code).toBe('np.dot((1, 2), (3, 4))');
  });
});
