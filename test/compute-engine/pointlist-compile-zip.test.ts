import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';

/**
 * `PointList` as a COMPILED VALUE
 * (`docs/plans/2026-07-31-pointlist-compile-design.md`).
 *
 * A `PointList` with one or more list SOURCES is a list of points — and on the
 * JavaScript target a list of points is an ordinary expression-level value
 * (nested arrays), exactly what an *evaluated* `PointList` compiles to when it
 * is reached the other way round. So JS lowers the construction to an IIFE zip
 * (D1) instead of failing closed, and `PointX`/`PointY`/`PointZ` compose over
 * it (D4).
 *
 * The shader targets deliberately diverge (ruling 3): GLSL/WGSL have no
 * runtime-length expression values, so CONSTRUCTION stays fail-closed there and
 * only the PROJECTION route is added (D3) — the point-list dimension remains
 * the consumer's instancing axis.
 */

const scalarList = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => i + 1);

/** A fresh engine with the declarations the zip tests share. */
function zipEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('k', 'number');
  ce.declare('n', 'list<number>');
  ce.declare('m', 'list<number>');
  ce.declare('u', 'unknown');
  ce.declare('U', 'number | list<number>');
  ce.declare('p', 'tuple<number, number>');
  // A BARE (unparameterized) tuple, and a union every member of which matches
  // `indexed_collection` — the two shapes the compile-route source predicate
  // narrows away from the type handler's `isListType`.
  ce.declare('bt', 'tuple');
  ce.declare('lt', 'list<number> | tuple<number, number>');
  return ce;
}

/** The interpreter's answer for `expr` with `bindings` assigned, as plain JSON
 * arrays — the route-parity reference. */
function interpret(expr: any, bindings: Record<string, any>): unknown {
  const ce = new ComputeEngine();
  for (const [name, value] of Object.entries(bindings))
    ce.assign(name, Array.isArray(value) ? ce.box(['List', ...value]) : value);
  const r = ce.box(expr).evaluate();
  // MATERIALIZED elements: past `MAX_SIZE_EAGER_COLLECTION` the interpreter's
  // transpose is the LAZY `Map` form, a representation difference only — so
  // parity is read through `each()`, not off the operator name.
  const toPlain = (e: any): unknown => {
    if (e.operator === 'Tuple') return e.ops.map(toPlain);
    if (e.isFiniteCollection) return [...e.each()].map(toPlain);
    return e.re;
  };
  return toPlain(r);
}

describe('PointList zip — JS construction (D1)', () => {
  const js = new JavaScriptTarget();

  it('a single source zips against the scalar slots, and matches the interpreter', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', -6, 'n']), { realOnly: true });
    expect(r.success).toBe(true);
    const run = r.run as (s: Record<string, unknown>) => unknown;
    expect(run({ n: [1, 2, 3] })).toEqual([
      [-6, 1],
      [-6, 2],
      [-6, 3],
    ]);
    expect(run({ n: [1, 2, 3] })).toEqual(
      interpret(['PointList', -6, 'n'], { n: [1, 2, 3] })
    );
  });

  it('two ragged sources zip to the SHORTEST (the pairing-family contract)', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', 'n', 'm']), { realOnly: true });
    expect(r.success).toBe(true);
    const run = r.run as (s: Record<string, unknown>) => unknown;
    expect(run({ n: [1, 2, 3], m: [10, 20] })).toEqual([
      [1, 10],
      [2, 20],
    ]);
    expect(run({ n: [1, 2, 3], m: [10, 20] })).toEqual(
      interpret(['PointList', 'n', 'm'], { n: [1, 2, 3], m: [10, 20] })
    );
  });

  it('an empty source yields an empty point list', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', -6, 'n']), { realOnly: true });
    expect((r.run as (s: any) => unknown)({ n: [] })).toEqual([]);
    expect(interpret(['PointList', -6, 'n'], { n: [] })).toEqual([]);
  });

  it('a single-component PointList(L) is a list of 1-tuples', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', 'n']), { realOnly: true });
    expect(r.success).toBe(true);
    expect((r.run as (s: any) => unknown)({ n: [1, 2] })).toEqual([[1], [2]]);
  });

  it('all components sources: a plain zip, no slots', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', 'n', 'm']), { realOnly: true });
    expect((r.run as (s: any) => unknown)({ n: [1, 2], m: [3, 4] })).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it('a `list<list<number>>` source zips VERBATIM (nested arrays), like the interpreter', () => {
    const ce = zipEngine();
    ce.declare('LL', 'list<list<number>>');
    const expr = ['PointList', -6, 'LL'];
    const r = js.compile(ce.box(expr as any), { realOnly: true });
    expect(r.success).toBe(true);
    const arg = {
      LL: [
        [1, 2],
        [3, 4],
      ],
    };
    expect((r.run as (s: any) => unknown)(arg)).toEqual([
      [-6, [1, 2]],
      [-6, [3, 4]],
    ]);
    // The interpreter reference, built directly (the `interpret` helper's
    // binding shorthand only knows flat numeric lists).
    const ce2 = new ComputeEngine();
    ce2.assign('LL', ce2.box(['List', ['List', 1, 2], ['List', 3, 4]]) as any);
    const interp = ce2.box(expr as any).evaluate();
    expect(interp.toString()).toBe('[(-6, [1,2]),(-6, [3,4])]');
  });

  it('a source past MAX_SIZE_EAGER_COLLECTION has element parity with the interpreter', () => {
    // Past 100 elements the interpreter's transpose is the LAZY `Map` form; the
    // representation differs, the materialized elements do not.
    const ce = zipEngine();
    const big = scalarList(150);
    const r = js.compile(ce.box(['PointList', -6, 'n']), { realOnly: true });
    const got = (r.run as (s: any) => unknown[])({ n: big });
    expect(got).toHaveLength(150);
    expect(got[0]).toEqual([-6, 1]);
    expect(got[149]).toEqual([-6, 150]);
    expect(got).toEqual(interpret(['PointList', -6, 'n'], { n: big }));
  });
});

describe('PointList zip — every component is evaluated exactly once, in order (D1)', () => {
  it('a side-effecting source and slot each fire once per call, in operand order', () => {
    // Counted by EFFECT, not by substring: each `vars` splice pushes its name
    // onto a log the caller owns.
    const ce = zipEngine();
    const r = new JavaScriptTarget().compile(ce.box(['PointList', 'k', 'n']), {
      vars: {
        k: '(_.log.push("k"), _.k)',
        n: '(_.log.push("n"), _.n)',
      },
    } as any);
    expect(r.success).toBe(true);
    const log: string[] = [];
    const out = (r.run as (s: any) => unknown)({ k: -6, n: [1, 2, 3], log });
    expect(out).toEqual([
      [-6, 1],
      [-6, 2],
      [-6, 3],
    ]);
    // Once each — NOT once per point — and the slot before the source.
    expect(log).toEqual(['k', 'n']);

    // A second call re-runs each exactly once.
    const log2: string[] = [];
    (r.run as (s: any) => unknown)({ k: 0, n: [1, 2], log: log2 });
    expect(log2).toEqual(['k', 'n']);
  });
});

describe('PointList zip — the opaque-slot guard (D1)', () => {
  const js = new JavaScriptTarget();

  it('an `unknown` slot holding a number produces ordinary points', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', 'u', 'n']), { realOnly: true });
    expect(r.success).toBe(true);
    expect((r.run as (s: any) => unknown)({ u: 5, n: [1, 2] })).toEqual([
      [5, 1],
      [5, 2],
    ]);
  });

  it('an `unknown` slot holding an ARRAY produces NaN components, not nested arrays', () => {
    // Deliberate divergence: the interpreter would transpose that slot as a
    // source; the compiled form cannot know to, and a NaN is a self-describing
    // absence where a spliced array would be silently-wrong output.
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', 'u', 'n']), { realOnly: true });
    const out = (r.run as (s: any) => number[][])({ u: [9, 9], n: [1, 2] });
    expect(out).toHaveLength(2);
    for (const pt of out) {
      expect(pt).toHaveLength(2);
      expect(Number.isNaN(pt[0])).toBe(true);
    }
    expect(out.map((pt) => pt[1])).toEqual([1, 2]);
  });
});

describe('PointList zip — retained declines and their diagnostics (D1, D2)', () => {
  const js = new JavaScriptTarget();

  it('a union component declines with the revised per-component message', () => {
    const ce = zipEngine();
    expect(() =>
      js.compile(ce.box(['PointList', 'k', 'U']), { realOnly: true })
    ).toThrow(
      /PointList: cannot compile — component 2 \(type `[^`]+`\) is neither a scalar slot nor a list source; its per-point value cannot be determined at compile time\. Fail closed \(D6\)\./
    );
  });

  it('a tuple component declines too (a point, not a per-point value)', () => {
    const ce = zipEngine();
    expect(() =>
      js.compile(ce.box(['PointList', 'p', 'n']), { realOnly: true })
    ).toThrow(/component 1 .* is neither a scalar slot nor a list source/);
  });

  it('a BARE `tuple` component declines — both tuple spellings are a point', () => {
    // `'tuple'` is a plain string, not a `{ kind: 'tuple' }` node, so the
    // node-only test read it as an `indexed_collection` SOURCE and would have
    // zipped a single point across the list.
    const ce = zipEngine();
    expect(() =>
      js.compile(ce.box(['PointList', 'k', 'bt']), { realOnly: true })
    ).toThrow(
      /component 2 \(type `tuple`\) is neither a scalar slot nor a list source/
    );
  });

  it('a union whose members ALL match indexed_collection declines', () => {
    // `list<number> | tuple<number, number>` matches `indexed_collection` as a
    // whole, so the whole-type test read it as a source — but its per-point
    // role is statically ambiguous (list ⇒ zip, tuple ⇒ point).
    const ce = zipEngine();
    expect(() =>
      js.compile(ce.box(['PointList', 'k', 'lt']), { realOnly: true })
    ).toThrow(
      /component 2 \(type `list<number> \| tuple<number, number>`\) is neither a scalar slot nor a list source/
    );
  });

  it('a source that is not an array at run time throws a loud RangeError', () => {
    // A string (or any array-like) has a `.length`, so `Math.min` alone would
    // zip it into garbage: the contract breach must fail fast instead.
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', -6, 'n']), {
      vars: { n: '"abc"' },
    } as any);
    expect(r.success).toBe(true);
    expect(() => (r.run as (s: any) => unknown)({})).toThrow(RangeError);
    expect(() => (r.run as (s: any) => unknown)({})).toThrow(
      /PointList: source component 2 is not an array at run time/
    );
  });

  it('the union decline falls back to the interpreter with { fallback: true }', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', 'k', 'U']), { fallback: true });
    expect(r.success).toBe(false);
    // The fallback answers what the interpreter answers for the same binding.
    expect((r.run as (s: any) => unknown)({ k: -6, U: 2 })).toEqual(
      interpret(['PointList', 'k', 'U'], { k: -6, U: 2 })
    );
  });

  it('a statically infinite source declines at COMPILE time (D2)', () => {
    const ce = zipEngine();
    const expr = ce.box(['PointList', -6, ['Range', 1, { num: '+Infinity' }]]);
    expect(() => js.compile(expr, { realOnly: true })).toThrow(
      /PointList: source component 2 is an infinite collection — an infinite point list has no compiled value\. Fail closed \(D6\)\./
    );
    const r = js.compile(expr, { fallback: true });
    expect(r.success).toBe(false);
    // Parity here = both routes refuse to produce a value: the interpreter
    // stays inert on an infinite source.
    expect(ce.box(expr.json as any).evaluate().operator).toBe('PointList');
  });
});

describe('PointList zip — the iteration budget caps the zip length (D2)', () => {
  const js = new JavaScriptTarget();

  it('an integer budget truncates the point list', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', -6, 'n']), {
      realOnly: true,
      iterationBudget: 2,
    } as any);
    expect(r.success).toBe(true);
    expect((r.run as (s: any) => unknown)({ n: [1, 2, 3, 4] })).toEqual([
      [-6, 1],
      [-6, 2],
    ]);
  });

  it('a FRACTIONAL budget is floored (`new Array(2.5)` would throw)', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', -6, 'n']), {
      realOnly: true,
      iterationBudget: 2.5,
    } as any);
    expect(r.success).toBe(true);
    expect(r.code).toContain('Math.min(_tv3.length, 2)');
    expect((r.run as (s: any) => unknown)({ n: [1, 2, 3, 4] })).toEqual([
      [-6, 1],
      [-6, 2],
    ]);
  });

  it('a budget below 1 floors to 0 — an EMPTY point list (truncation, all the way down)', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', -6, 'n']), {
      realOnly: true,
      iterationBudget: 0.5,
    } as any);
    expect(r.success).toBe(true);
    expect((r.run as (s: any) => unknown)({ n: [1, 2, 3] })).toEqual([]);
  });

  it('no budget: no cap', () => {
    const ce = zipEngine();
    const r = js.compile(ce.box(['PointList', -6, 'n']), { realOnly: true });
    expect(
      (r.run as (s: any) => unknown[])({ n: scalarList(50) })
    ).toHaveLength(50);
  });
});

describe('PointList zip — JS projection composes over the construction (D4)', () => {
  const js = new JavaScriptTarget();

  it('PointX/PointY over a constructed point list match the interpreter', () => {
    const ce = zipEngine();
    for (const [head, expected] of [
      ['PointX', [-6, -6, -6]],
      ['PointY', [1, 2, 3]],
    ] as const) {
      const expr = [head, ['PointList', -6, 'n']];
      const r = js.compile(ce.box(expr as any), { realOnly: true });
      expect(r.success).toBe(true);
      expect((r.run as (s: any) => unknown)({ n: [1, 2, 3] })).toEqual(
        expected
      );
      expect((r.run as (s: any) => unknown)({ n: [1, 2, 3] })).toEqual(
        interpret(expr, { n: [1, 2, 3] })
      );
    }
  });

  it('a ragged projection projects to the shorter length', () => {
    const ce = zipEngine();
    const expr = ['PointY', ['PointList', 'n', 'm']];
    const r = js.compile(ce.box(expr as any), { realOnly: true });
    expect(
      (r.run as (s: any) => unknown)({ n: [1, 2, 3], m: [10, 20] })
    ).toEqual([10, 20]);
    expect(
      (r.run as (s: any) => unknown)({ n: [1, 2, 3], m: [10, 20] })
    ).toEqual(interpret(expr, { n: [1, 2, 3], m: [10, 20] }));
  });

  it('PointZ over 2-arity points: the interpreter ERRORS, the compiled kernel keeps the NaN marker', () => {
    // REVERSED in part (item 138 clarified ask, 2026-08-02): a statically-
    // absent component is a TYPE-level fact → a typed `incompatible-dimensions`
    // error. That reverses the 2026-07-22 NaN-over-Nothing ruling, which
    // weighed the position-preserving marker against `Nothing` and never
    // weighed a typed error.
    //
    // Here the operand type is `list<tuple>` — a BARE element tuple, whose
    // arity is not statically known — so the static gate stays inert and the
    // JS kernel is still emitted. Its numeric ABI keeps the `NaN` absence
    // marker for dynamically-shaped bases (the shader targets cannot throw;
    // see the DOMAIN-conditional pin below). The INTERPRETER sees the concrete
    // 2-tuples and errors — once, for the whole application, not per point.
    const ce = zipEngine();
    const expr = ['PointZ', ['PointList', -6, 'n']];
    expect(ce.box(['PointList', -6, 'n']).type.toString()).toBe('list<tuple>');
    const r = js.compile(ce.box(expr as any), { realOnly: true });
    const out = (r.run as (s: any) => number[])({ n: [1, 2, 3] });
    expect(out).toHaveLength(3);
    expect(out.every((v) => Number.isNaN(v))).toBe(true);
    // The interpreted route, with `n` bound: one error, not a list of markers.
    const ice = new ComputeEngine();
    ice.assign('n', ice.box(['List', 1, 2, 3]));
    expect(ice.box(expr as any).evaluate().toString()).toMatch(
      /incompatible-dimensions/
    );
  });

  it('PointZ over a single 2-arity point FAILS CLOSED at compile time', () => {
    // REVERSED (item 138 clarified ask, 2026-08-02): `tuple<integer, integer>`
    // statically proves the point is 2-D, so the expression is invalid before
    // a kernel is ever emitted — an honest decline rather than a `NaN` a
    // consumer would have to recognize.
    const ce = zipEngine();
    const boxed = ce.box(['PointZ', ['Tuple', 1, 2]]);
    expect(boxed.isValid).toBe(false);
    expect(() => js.compile(boxed, { realOnly: true })).toThrow(
      /incompatible-dimensions/
    );
  });

  it('the `NaN` absence marker is DOMAIN-conditional: an object-domain coordinate keeps `undefined`', () => {
    // `NaN` is the ABI's absence marker for a NUMERIC coordinate. On a
    // `tuple<string, string>` point it would be the very JS-ism-free-but-wrong
    // value the marker exists to avoid: the absence value in that domain is
    // `undefined`, i.e. the bare access.
    const ce = zipEngine();
    ce.declare('sp', 'tuple<string, string>');
    const r = js.compile(ce.box(['PointY', 'sp']), { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('?? NaN');
    // A numeric coordinate — and an out-of-range one, whose type is not
    // statically known (`bt` is a BARE `tuple`) — keep the marker.
    // (`PointZ('p')` was the second probe until 2026-08-02: `p` is
    // `tuple<number, number>`, which now PROVES the mismatch, so it errors at
    // type-check time instead of reaching the ABI. `bt` preserves this pin's
    // subject: an out-of-range access whose arity is not statically known.)
    expect(
      js.compile(ce.box(['PointY', 'p']), { realOnly: true }).code
    ).toContain('?? NaN');
    expect(
      js.compile(ce.box(['PointZ', 'bt']), { realOnly: true }).code
    ).toContain('?? NaN');
  });

  it('a symbol DECLARED `list<tuple>` broadcasts the accessor (widened operand test)', () => {
    // `list<tuple>` — what the `PointList` type handler answers — has the BARE
    // string `'tuple'` as its element type, not a `{ kind: 'tuple' }` node. The
    // node-only test element-indexed instead of broadcasting.
    const ce = zipEngine();
    ce.declare('L', 'list<tuple>');
    const r = js.compile(ce.box(['PointY', 'L']), { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.code).toContain('.map(');
    expect(
      (r.run as (s: any) => unknown)({
        L: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([2, 4]);
  });

  it('KNOWN PARITY EDGE: projecting an EMPTY point list — compiled `[]`, interpreter absence', () => {
    // The compiled construction is `[]` and `[].map(…)` is `[]`. The
    // interpreter's evaluated empty transpose is an UNTYPED empty `List`
    // (`list<never>` — an empty literal carries no element type), so
    // `pointComponentAt` cannot see that it was a point list and falls through
    // to First/Second/Third-style element indexing, which answers the absence
    // marker. Pinned as a divergence, not a fix: typing the empty transpose
    // `list<tuple>` is a type-handler change.
    const ce = zipEngine();
    const expr = ['PointY', ['PointList', -6, 'n']];
    const r = js.compile(ce.box(expr as any), { realOnly: true });
    expect((r.run as (s: any) => unknown)({ n: [] })).toEqual([]);

    const ce2 = new ComputeEngine();
    ce2.assign('n', ce2.box(['List']) as any);
    const interp = ce2.box(expr as any).evaluate();
    expect(interp.type.matches('collection')).toBe(false);
    expect(interp.toString()).toBe('"Missing"');
  });

  it('Length and At consume a compiled construction', () => {
    const ce = zipEngine();
    const len = js.compile(ce.box(['Length', ['PointList', -6, 'n']]), {
      realOnly: true,
    });
    expect((len.run as (s: any) => unknown)({ n: [1, 2, 3] })).toBe(3);
    const at = js.compile(ce.box(['At', ['PointList', -6, 'n'], 2]), {
      realOnly: true,
    });
    expect((at.run as (s: any) => unknown)({ n: [1, 2, 3] })).toEqual([-6, 2]);
  });
});

describe('PointList — GPU projection (D3)', () => {
  const glsl = new GLSLTarget();
  const wgsl = new WGSLTarget();

  /** A fresh engine with vec-shaped declarations. */
  function gpuEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('v', 'vector<3>');
    ce.declare('w2', 'vector<2>');
    ce.declare('n', 'list<number>');
    ce.declare('u', 'unknown');
    return ce;
  }

  it('projects the source component to the vector itself', () => {
    const ce = gpuEngine();
    const r = glsl.compile(ce.box(['PointY', ['PointList', -6, 'v']]), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('v');
  });

  it('broadcasts a scalar slot to the source width', () => {
    const ce = gpuEngine();
    const r = glsl.compile(ce.box(['PointX', ['PointList', -6, 'v']]), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('vec3(-6.0)');
  });

  it('wgsl spells the broadcast `vecNf`', () => {
    const ce = gpuEngine();
    const r = wgsl.compile(ce.box(['PointX', ['PointList', -6, 'v']]), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('vec3f(-6.0)');
  });

  it('mixed vector<2>/vector<3> sources truncate to the shortest (swizzle)', () => {
    const ce = gpuEngine();
    expect(
      glsl.compile(ce.box(['PointY', ['PointList', 'w2', 'v']]), {
        realOnly: true,
      }).code
    ).toBe('v.xy');
    expect(
      glsl.compile(ce.box(['PointX', ['PointList', 'w2', 'v']]), {
        realOnly: true,
      }).code
    ).toBe('w2');
    expect(
      wgsl.compile(ce.box(['PointY', ['PointList', 'w2', 'v']]), {
        realOnly: true,
      }).code
    ).toBe('v.xy');
  });

  it('a literal List source of 2–4 elements projects', () => {
    const ce = gpuEngine();
    const r = glsl.compile(
      ce.box(['PointY', ['PointList', -6, ['List', 1, 2, 3]]]),
      { realOnly: true }
    );
    expect(r.success).toBe(true);
    expect(r.code).toBe('vec3(1.0, 2.0, 3.0)');
  });

  // Each decline names its OWN cause (Tycho item 109a): the generic "a list of
  // points has no GPU lowering" is true of only one of these five.
  it('a source of UNKNOWN length declines — and says so', () => {
    const ce = gpuEngine();
    expect(() =>
      glsl.compile(ce.box(['PointY', ['PointList', -6, 'n']]), {
        realOnly: true,
      })
    ).toThrow(
      /source component 2 \(type `list<number>`\) has no statically known length, and a shader vector must have one/
    );
  });

  it('a source of MORE THAN 4 elements declines — and says so', () => {
    const ce = gpuEngine();
    expect(() =>
      glsl.compile(
        ce.box(['PointY', ['PointList', -6, ['List', 1, 2, 3, 4, 5]]]),
        // Opt out of constant folding: every operand here is a literal, so the
        // whole subtree would be evaluated at compile time and emitted as a
        // `float[5]` literal, short-circuiting the arity check under test.
        { realOnly: true, constantFold: false }
      )
    ).toThrow(
      /source component 2 has 5 elements, and a shader vector holds 2 to 4/
    );
  });

  it('an `unknown` slot declines (no `vecW(<aggregate>)`) — and says so', () => {
    const ce = gpuEngine();
    expect(() =>
      glsl.compile(ce.box(['PointY', ['PointList', 'u', 'v']]), {
        realOnly: true,
      })
    ).toThrow(
      /component 1 \(type `unknown`\) is neither a list source nor a provably scalar numeric slot/
    );
  });

  it('an IMPURE non-selected component declines (evaluate-once) — and says so', () => {
    const ce = gpuEngine();
    expect(() =>
      glsl.compile(ce.box(['PointY', ['PointList', ['Random'], 'v']]), {
        realOnly: true,
      })
    ).toThrow(
      /component 1 is impure, and the projection would discard it unevaluated/
    );
  });

  it('PointZ on a 2-arity PointList keeps the fail-closed throw — and says so', () => {
    const ce = gpuEngine();
    expect(() =>
      glsl.compile(ce.box(['PointZ', ['PointList', -6, 'v']]), {
        realOnly: true,
      })
    ).toThrow(/the points have arity 2, so there is no coordinate 3/);
  });

  it('PointZ on a SINGLE 2-arity point fails closed too (arity is symmetric)', () => {
    // The single-point branch has the same static information as the list
    // route: a parameterized tuple type states the arity, and `p.z` on a
    // `vec2` is invalid shader source — it must not be emitted behind
    // `success: true`.
    //
    // Since 2026-08-02 (item 138 clarified ask) the mismatch is caught even
    // EARLIER — at type-check time, by `PointZ`'s canonical handler — so the
    // diagnostic that reaches the caller is the engine's typed
    // `incompatible-dimensions` error rather than this target's own message.
    // Still fails closed, which is what this pin is about.
    const ce = gpuEngine();
    ce.declare('p2', 'tuple<number, number>');
    ce.declare('p3', 'tuple<number, number, number>');
    expect(ce.box(['PointZ', 'p2']).isValid).toBe(false);
    for (const target of [glsl, wgsl])
      expect(() =>
        target.compile(ce.box(['PointZ', 'p2']), { realOnly: true })
      ).toThrow(/incompatible-dimensions/);
    // An in-range coordinate, and a 3-arity point, still swizzle.
    expect(glsl.compile(ce.box(['PointX', 'p2']), { realOnly: true }).code).toBe(
      'p2.x'
    );
    expect(glsl.compile(ce.box(['PointZ', 'p3']), { realOnly: true }).code).toBe(
      'p3.z'
    );
  });

  it('PointZ on an all-scalar `PointList` (a single point) fails closed as well', () => {
    // `PointList(-6, -7)` has no source, so it IS a single point (it evaluates
    // to `Tuple(-6, -7)` and types `tuple<…, …>`) and reaches the single-point
    // branch, not the projection route. Since 2026-08-02 the typed
    // `incompatible-dimensions` error fires first (see the test above).
    const ce = gpuEngine();
    expect(() =>
      glsl.compile(ce.box(['PointZ', ['PointList', -6, -7]]), {
        realOnly: true,
      })
    ).toThrow(/incompatible-dimensions/);
  });

  it('a bare `tuple` and an all-collection union component decline as SLOTS, not sources', () => {
    const ce = gpuEngine();
    ce.declare('bt', 'tuple');
    ce.declare('lt', 'list<number> | tuple<number, number>');
    for (const s of ['bt', 'lt'])
      expect(() =>
        glsl.compile(ce.box(['PointY', ['PointList', -6, s]]), {
          realOnly: true,
        })
      ).toThrow(
        /component 2 .* is neither a list source nor a provably scalar numeric slot/
      );
  });

  it('a COMPOSED use still declines via the operand-shape gate (v1 residual)', () => {
    // `PointX(PointList(…))` types `list<number>` with no static dimension, so
    // the shape gates read it as an array even though the emission is a legal
    // `vec3`. Making the projection's TYPE carry its dimension is a follow-up.
    // The cause is the SHAPE gate, not the projection — which is why the
    // message is the operand-shape one, not a projection decline reason.
    const ce = gpuEngine();
    expect(() =>
      glsl.compile(
        ce.box(['Multiply', 2, ['PointX', ['PointList', -6, 'v']]]),
        { realOnly: true }
      )
    ).toThrow(
      /Multiply: an operand lowers to a shader ARRAY .* which has no arithmetic operators/
    );
  });
});

describe('PointList — GPU construction and the other targets are unchanged', () => {
  it('glsl construction with a source still declines with the shape diagnostic', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'vector<3>');
    expect(() =>
      new GLSLTarget().compile(ce.box(['PointList', -6, 'v']), {
        realOnly: true,
      })
    ).toThrow(
      /PointList: cannot compile — component 2 is collection-valued .* target 'glsl'/
    );
  });

  it('python still declines a collection-valued component', () => {
    const ce = zipEngine();
    expect(() =>
      new PythonTarget().compile(ce.box(['PointList', -6, 'n']))
    ).toThrow(
      /PointList: cannot compile — component 2 is collection-valued .* target 'python'/
    );
  });

  it('interval-js still reports the target gap (no `Tuple` lowering at all)', () => {
    const ce = zipEngine();
    const r = new IntervalJavaScriptTarget().compile(
      ce.box(['PointList', -6, 'n'])
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(
      /PointList: cannot compile — the operator's compile handler has no lowering/
    );
  });
});

describe('PointList — the source predicate agrees across the two compile routes', () => {
  // DRIFT PROTECTION. The source predicate now exists in THREE hand-copied
  // bodies: `isListType` (the type handler, `library/collections.ts`), and
  // `isPointListSource` in `javascript-target.ts` and in `gpu-target.ts`. The
  // two COMPILE copies must agree exactly; the type handler's copy deliberately
  // diverges on the last two rows (narrowing it is interpreter-visible), which
  // is why this table is read through compile outcomes only.
  const table: { type: string; source: boolean }[] = [
    { type: 'tuple', source: false }, // a single point, bare spelling
    { type: 'tuple<number, number>', source: false }, // …and node spelling
    { type: 'list<number>', source: true },
    { type: 'set<number>', source: false }, // not INDEXED
    { type: 'number | list<number>', source: false }, // union: ambiguous
    { type: 'list<number> | tuple<number, number>', source: false }, // ditto
    { type: 'vector<3>', source: true },
  ];

  /** A fresh engine with `v3` — a genuine, vec-emittable source — plus `c`,
   * the component under test. The extra source keeps the whole `PointList`
   * typed `list<tuple>` on every row, so BOTH routes reach their zip/projection
   * lowering and the classification of `c` is what is actually observed. */
  function tableEngine(type: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('v3', 'vector<3>');
    ce.declare('c', type as any);
    return ce;
  }

  it.each(table)(
    'JS: a `$type` component is source=$source',
    ({ type, source }) => {
      const ce = tableEngine(type);
      const build = () =>
        new JavaScriptTarget().compile(ce.box(['PointList', 'v3', 'c']), {
          realOnly: true,
        });
      // A source zips; a non-source has no per-point value and throws D1.
      if (source) expect(build().success).toBe(true);
      else expect(build).toThrow(/is neither a scalar slot nor a list source/);
    }
  );

  it.each(table)(
    'GPU: a `$type` component is source=$source',
    ({ type, source }) => {
      const ce = tableEngine(type);
      const build = () =>
        new GLSLTarget().compile(ce.box(['PointY', ['PointList', 'v3', 'c']]), {
          realOnly: true,
        });
      if (!source) {
        // Judged as a SLOT — the same classification the JS route reaches.
        expect(build).toThrow(
          /is neither a list source nor a provably scalar numeric slot/
        );
        return;
      }
      // Judged as a SOURCE. The GPU then applies its own extra gate (a shader
      // vector needs a statically known length of 2–4), which is a lowering
      // limit, not a disagreement about the class.
      if (type === 'vector<3>') expect(build().code).toBe('c');
      else expect(build).toThrow(/has no statically known length/);
    }
  );
});

describe('PointList — the scalar/non-scalar split agrees across the two compile routes', () => {
  // DRIFT PROTECTION, the companion of the source-predicate table above. The
  // SCALAR predicate also exists in two hand-copied bodies —
  // `isProvablyNonScalarType` (`compilation/javascript-target.ts`) and
  // `isProvablyNonScalar` (the `PointList` definition handler,
  // `library/collections.ts`) — and unlike the source predicate they must agree
  // EXACTLY: a component classified a slot by one and a non-scalar by the other
  // would make the same `PointList` compile or fail closed depending only on
  // which route it entered by. Read through compile outcomes only.
  //
  // The two entry points:
  // - WITH a source present, the definition handler defers on `javascript` and
  //   `compileJSPointList` classifies the component (throw vs per-point slot);
  // - with NO source, the definition handler classifies it itself, on a
  //   language it lowers (`glsl`): decline vs a `Tuple`-identical emission.
  const table: {
    type: string;
    scalar: boolean;
    slot: unknown;
    glslRejects?: RegExp;
  }[] = [
    { type: 'set<number>', scalar: false, slot: undefined }, // a collection
    { type: 'dictionary', scalar: false, slot: undefined }, // …so is a map
    { type: 'unknown', scalar: true, slot: 7 }, // the load-bearing plot case
    // On the JS route a string component is a SLOT (strings are broadcast-
    // atomic, so it is never a source). The GLSL route rejects it instead:
    // the shader targets have no text type, so a text-typed symbol fails
    // closed rather than being emitted as a numeric uniform.
    { type: 'string', scalar: true, slot: 'ab', glslRejects: /text-typed/ },
    { type: 'boolean', scalar: true, slot: true },
  ];

  function splitEngine(type: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('n', 'list<number>');
    ce.declare('x', 'number');
    ce.declare('c', type as any);
    return ce;
  }

  it.each(table)(
    'JS zip (a source is present): a `$type` component is scalar=$scalar',
    ({ type, scalar, slot }) => {
      const ce = splitEngine(type);
      const build = () =>
        new JavaScriptTarget().compile(ce.box(['PointList', 'n', 'c']), {
          realOnly: true,
        });
      if (!scalar) {
        expect(build).toThrow(/is neither a scalar slot nor a list source/);
        return;
      }
      const r = build();
      expect(r.success).toBe(true);
      // Observationally a SLOT: the same value in every point, not zipped.
      expect((r.run as (s: any) => unknown)({ n: [1, 2, 3], c: slot })).toEqual([
        [1, slot],
        [2, slot],
        [3, slot],
      ]);
    }
  );

  it.each(table)(
    'library route (no source): a `$type` component is scalar=$scalar',
    ({ type, scalar, glslRejects }) => {
      const ce = splitEngine(type);
      const glsl = new GLSLTarget();
      const build = () =>
        glsl.compile(ce.box(['PointList', 'x', 'c']), { realOnly: true });
      if (!scalar) {
        expect(build).toThrow(/is collection-valued/);
        return;
      }
      if (glslRejects) {
        expect(build).toThrow(glslRejects);
        return;
      }
      // A slot emits byte-identically to the equivalent `Tuple`.
      const tuple = glsl.compile(ce.box(['Tuple', 'x', 'c']), {
        realOnly: true,
      });
      expect(tuple.success).toBe(true);
      expect(build().code).toBe(tuple.code);
    }
  );
});

describe('PointList — CSE now reaches a point-list-bearing artifact', () => {
  /** `sin(6u)` — the CSE design's motivating atom. */
  const sin6 = (): any => ['Sin', ['Multiply', 6, 'u']];

  const artifact = (ce: ComputeEngine) =>
    ce.box([
      'List',
      ['PointList', sin6(), 'n'],
      ['PointList', sin6(), 'n'],
      ['PointList', sin6(), 'n'],
      ['Add', ['Square', sin6()], sin6(), sin6()],
    ] as any);

  it('the artifact compiles, and BOTH the repeated scalar subtree and the repeated PointList subtree are CSE-bound', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('n', 'list<number>');
    const on = compile(artifact(ce), { fallback: false }) as any;
    const off = compile(artifact(ce), { fallback: false, cse: false }) as any;
    expect(on.success).toBe(true);
    expect(off.success).toBe(true);

    // The repeated `sin(6u)` OUTSIDE the point lists gets a `_cse` binding…
    expect(on.code).toMatch(/const _cse\d+ = Math\.sin\(6 \* _\.u\)/);
    expect(off.code).not.toContain('_cse');

    // …and so does the repeated `PointList` subtree. This flips the residual
    // pinned when CSE landed: G1b's definition-`compile`-handler clause is
    // about CALLER-supplied handlers (`ce.declare(name, { compile })`, whose
    // emitted source is unknowable); a BUILT-IN handler such as `PointList`'s
    // is engine-authored emission — the same trust class as the built-in
    // TABLE mappings, which were never under-mapped. G1 (`isPure`) still
    // excludes impure heads. See the design doc §5.2 (2026-08-01).
    expect(on.code).toMatch(/const _cse\d+ = \(\(\) => \{[\s\S]*PointList:/);

    // One zip loop emitted instead of three.
    expect(on.code.split('new Array(').length - 1).toBe(1);
    expect(off.code.split('new Array(').length - 1).toBe(3);

    // Run parity, CSE on vs off.
    const a = (on.run as (s: any) => unknown)({ u: 0.25, n: [1, 2, 3] });
    const b = (off.run as (s: any) => unknown)({ u: 0.25, n: [1, 2, 3] });
    expect(a).toEqual(b);
    expect(a).toEqual([
      [
        [Math.sin(1.5), 1],
        [Math.sin(1.5), 2],
        [Math.sin(1.5), 3],
      ],
      [
        [Math.sin(1.5), 1],
        [Math.sin(1.5), 2],
        [Math.sin(1.5), 3],
      ],
      [
        [Math.sin(1.5), 1],
        [Math.sin(1.5), 2],
        [Math.sin(1.5), 3],
      ],
      Math.sin(1.5) + Math.sin(1.5) + Math.pow(Math.sin(1.5), 2),
    ]);
  });
});
