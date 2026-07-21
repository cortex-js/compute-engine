/**
 * Regression tests for the 2026-07-21 Tycho filing round
 * (tycho/docs/COMPUTE_ENGINE.md):
 *
 * - Item 72: a `Comprehension` in operand position serializes with bracket
 *   delimiters so it survives its own round trip.
 * - Item 74: `Abs` of a fixed-arity point is the Euclidean norm (routed to
 *   `Norm`) across evaluate and every compile target; `Norm` has an
 *   interval-js leg; `Norm`/`Abs` of a point with a broadcasting component
 *   type `list<number>`.
 * - Item 75: `isValid` is memoized (O(1) on repeat queries).
 * - Item 76: `RandomList(n)` / `RandomList(n, seed)`.
 * - Item 64 (defect b): large *finite* big-operator bounds stream and honor
 *   the evaluation deadline instead of eagerly materializing (OOM class).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

describe('Item 72 — Comprehension operand-position round trip', () => {
  test('definition row round-trips (Equal)', () => {
    const src = 'H=[k^2\\operatorname{for}k=[1...4]]';
    const first = ce.parse(src, { canonical: false });
    expect(first.json).toEqual([
      'Equal',
      'H',
      ['Comprehension', ['Power', 'k', 2], ['Element', 'k', ['Range', 1, 4]]],
    ]);
    const reparsed = ce.parse(first.latex, { canonical: false });
    expect(reparsed.json).toEqual(first.json);
  });

  test('definition row round-trips (Assign / \\coloneq)', () => {
    const src = 'H\\coloneq[k^2\\operatorname{for}k=[1...4]]';
    const first = ce.parse(src, { canonical: false });
    const reparsed = ce.parse(first.latex, { canonical: false });
    expect(reparsed.json).toEqual(first.json);
  });

  test('operand-position serialization is bracket-fenced', () => {
    const expr = ce.parse('H=[k^2\\operatorname{for}k=[1...4]]', {
      canonical: false,
    });
    expect(expr.latex).toContain('\\left[');
    expect(expr.latex).toContain('\\right]');
  });

  test('a bare comprehension is fenced too, and round-trips', () => {
    // The fence is unconditional: `[body for k=…]` parses back to the same
    // `Comprehension`, so fencing is lossless in every position (and
    // `serializer.level` cannot distinguish operand position — Add/Multiply
    // serialize children at the parent's level).
    const bare = ce.parse('[k^2\\operatorname{for}k=[1...4]]', {
      canonical: false,
    });
    const reparsed = ce.parse(bare.latex, { canonical: false });
    expect(reparsed.json).toEqual(bare.json);
  });

  test('a comprehension under an arithmetic parent round-trips', () => {
    // Regression: with a level-gated fence, `Add(Comprehension, 1)`
    // serialized bare and the `+1` was absorbed into the range end on
    // re-parse (value corruption).
    const expr = ce.box(
      ['Add', ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 4]]], 1],
      { canonical: false }
    );
    expect(expr.latex).toContain('\\left[');
    const reparsed = ce.parse(expr.latex, { canonical: false });
    expect(reparsed.json).toEqual([
      'Add',
      ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 4]]],
      1,
    ]);
  });
});

describe('Item 74 — Abs of a fixed-arity point is the Euclidean norm', () => {
  test('Abs(Tuple) evaluates/numericizes to the norm', () => {
    expect(ce.box(['Abs', ['Tuple', 3, 4]]).N().re).toEqual(5);
    expect(ce.box(['Abs', ['Tuple', 1, 2, 2]]).N().re).toEqual(3);
  });

  test('Abs over a List still broadcasts elementwise', () => {
    expect(ce.box(['Abs', ['List', 3, -4]]).evaluate().json).toEqual([
      'List',
      3,
      4,
    ]);
  });

  test('|(x,y)| compiles to a number on the js target', () => {
    const target = ce.getCompilationTarget('javascript');
    const r = target.compile(ce.parse('\\left|(x,y)\\right|'));
    expect(r.success).toBe(true);
    const v = r.run?.({ x: 3, y: 4 });
    expect(typeof v).toBe('number');
    expect(v).toEqual(5);
  });

  test('Norm compiles on the interval-js target (2-D and 3-D)', () => {
    const target = ce.getCompilationTarget('interval-js');
    const r2 = target.compile(ce.parse('\\left\\Vert (x-1,y)\\right\\Vert'));
    expect(r2.success).toBe(true);
    const v2 = r2.run?.({ x: 4, y: 4 }) as any;
    expect(v2.value.lo).toBeCloseTo(5, 10);
    expect(v2.value.hi).toBeCloseTo(5, 10);

    const r3 = target.compile(ce.parse('\\left\\Vert (x,y,z)\\right\\Vert'));
    expect(r3.success).toBe(true);
    const v3 = r3.run?.({ x: 1, y: 2, z: 2 }) as any;
    expect(v3.value.lo).toBeCloseTo(3, 10);
    expect(v3.value.hi).toBeCloseTo(3, 10);
  });

  test('|(x,y)| compiles on the interval-js target', () => {
    const target = ce.getCompilationTarget('interval-js');
    const r = target.compile(ce.parse('\\left|(x-1,y)\\right|'));
    expect(r.success).toBe(true);
    const v = r.run?.({ x: 4, y: 4 }) as any;
    expect(v.value.lo).toBeCloseTo(5, 10);
  });

  test('|(x,y)| compiles to length() on the shader targets', () => {
    const glsl = ce
      .getCompilationTarget('glsl')
      .compile(ce.parse('\\left|(x-1,y)\\right|'));
    expect(glsl.success).toBe(true);
    expect(glsl.code).toContain('length(');
    expect(glsl.code).not.toContain('.map(');
  });

  test('Norm/Abs of a point with a broadcasting component types list<number>', () => {
    const norm = ce.parse('\\left\\Vert (x+[0.5,1],y,z+2)\\right\\Vert');
    expect(norm.type.toString()).toEqual('list<number>');
    expect(norm.evaluate().operator).toEqual('List');

    const abs = ce.parse('\\left|(x+[0.5,1],y)\\right|');
    expect(abs.type.toString()).toEqual('list<number>');
    expect(abs.evaluate().operator).toEqual('List');
  });

  test('Norm of a plain point still types number', () => {
    const norm = ce.box(['Norm', ['Tuple', 3, 4]]);
    expect(norm.type.toString()).toEqual('number');
    expect(norm.evaluate().re).toEqual(5);
  });

  test('Hypot of a point squares through its norm', () => {
    const r = ce.box(['Hypot', ['Tuple', 3, 4], 1]).evaluate();
    // √(‖(3,4)‖² + 1²) = √26 — and no inert Power-of-tuple residue
    expect(r.toString()).toEqual('sqrt(26)');
    expect(ce.box(['Hypot', ['Tuple', 3, 4], 1]).N().re).toBeCloseTo(
      Math.sqrt(26),
      10
    );
  });

  test('Hypot with a broadcasting point component types list<number>', () => {
    const h = ce.box(['Hypot', ['Tuple', ['List', 3, 6], 4], 1]);
    expect(h.type.toString()).toEqual('list<number>');
    expect(h.evaluate().operator).toEqual('List');
    // A plain point keeps the scalar type
    expect(ce.box(['Hypot', ['Tuple', 3, 4], 1]).type.toString()).toEqual(
      'finite_real'
    );
  });

  test('a nested-point component is atomic, not a broadcast: scalar type', () => {
    // |((3,4), 12)| = √(‖(3,4)‖² + 12²) = 13 — a scalar, and typed as one
    // (tuples are indexed collections in the type lattice but bind
    // atomically).
    const e = ce.box(['Abs', ['Tuple', ['Tuple', 3, 4], 12]]);
    expect(e.type.toString()).toEqual('number');
    expect(e.evaluate().re).toEqual(13);
  });

  test('a tuple-TYPED symbol routes as a point (type-based detection)', () => {
    const engine = new ComputeEngine();
    engine.declare('p', 'tuple<real, real>');
    const e = engine.box(['Abs', 'p']);
    // The norm of a point is a scalar — not `real`-via-absFunctionType
    // by accident, but through the point route.
    expect(e.type.matches('number')).toBe(true);
    // With a value bound, it evaluates through the norm
    engine.assign('p', engine.box(['Tuple', 3, 4]));
    expect(engine.box(['Abs', 'p']).N().re).toEqual(5);
  });

  test('a tuple-TYPED symbol compiles as a point too (js: norm, not broadcast abs)', () => {
    // The compile rewrite must use the same type-based detection as
    // evaluate/type: without it, |p| compiled to an elementwise
    // `Math.abs` broadcast over the point behind success:true.
    const engine = new ComputeEngine();
    engine.declare('p', 'tuple<real, real>');
    const r = engine
      .getCompilationTarget('javascript')
      .compile(engine.box(['Abs', 'p']));
    expect(r.success).toBe(true);
    expect(r.run?.({ p: [3, 4] })).toEqual(5);
  });

  test('a tuple-TYPED symbol whose element types broadcast reports list<number>', () => {
    const engine = new ComputeEngine();
    engine.declare('q', 'tuple<list<real>, real>');
    expect(engine.box(['Abs', 'q']).type.toString()).toEqual('list<number>');
  });

  test('a List with a broadcasting component fails closed; a matrix literal still compiles', () => {
    // `‖[x+[0.5,1], y, z]‖` nests at evaluation — the compiled flatten
    // (js `_SYS.norm`) or vec constructor (glsl) cannot follow. Fail closed.
    const bad = ce.box(['Norm', ['List', ce.parse('x+[0.5,1]'), 'y', 'z']]);
    expect(
      ce.getCompilationTarget('javascript').compile(bad, { fallback: true })
        .success
    ).toBe(false);
    expect(
      ce.getCompilationTarget('glsl').compile(bad, { fallback: true }).success
    ).toBe(false);
    // A matrix literal's List components are rows — the Frobenius norm is a
    // legitimate scalar and must keep compiling on the js target.
    const frob = ce.box(['Norm', ['List', ['List', 3, 0], ['List', 0, 4]]]);
    const r = ce.getCompilationTarget('javascript').compile(frob);
    expect(r.success).toBe(true);
    expect(r.run?.({})).toEqual(5);
  });

  test('L-infinity norm with a broadcasting component stays symbolic (no wrong scalar)', () => {
    // The scalar max loop cannot represent the per-element result; it used
    // to silently DROP the broadcasting component and return the max of the
    // rest.
    const e = ce.box([
      'Norm',
      ['Tuple', ['List', 3, 6], 4],
      { str: 'Infinity' },
    ]);
    expect(e.evaluate().operator).toEqual('Norm');
  });

  test('Abs/Norm of a point honor the N() exactness contract', () => {
    // evaluate() keeps the exact form; .N() numericizes.
    expect(ce.box(['Abs', ['Tuple', 1, 1]]).evaluate().toString()).toEqual(
      'sqrt(2)'
    );
    expect(ce.box(['Abs', ['Tuple', 1, 1]]).N().re).toBeCloseTo(
      Math.SQRT2,
      12
    );
    expect(ce.box(['Norm', ['Tuple', 1, 1]]).N().re).toBeCloseTo(
      Math.SQRT2,
      12
    );
  });

  test('a point with a broadcasting component fails closed on compile', () => {
    // Evaluation zips into one norm per element ([√10, √13]); a compiled
    // scalar norm would silently flatten to the single value √14. The
    // compile must fail closed (falling back to interpretation) instead.
    const expr = ce.parse('\\left|([1,2],3)\\right|');
    expect(expr.evaluate().operator).toEqual('List');
    const js = ce
      .getCompilationTarget('javascript')
      .compile(expr, { fallback: true });
    expect(js.success).toBe(false);
    const iv = ce.getCompilationTarget('interval-js').compile(expr);
    expect(iv.success).toBe(false);
    const glsl = ce
      .getCompilationTarget('glsl')
      .compile(expr, { fallback: true });
    expect(glsl.success).toBe(false);
  });

  test('shader norm arity limits: 3-vec uses length(), 5-tuple fails closed', () => {
    const glsl = ce.getCompilationTarget('glsl');
    const ok = glsl.compile(ce.box(['Abs', ['Tuple', 'x', 'y', 'z']]));
    expect(ok.success).toBe(true);
    expect(ok.code).toContain('length(');
    // `length(float[5](…))` is invalid shader source — must not report
    // success.
    const bad = glsl.compile(
      ce.box(['Abs', ['Tuple', 'x', 'y', 'z', 'w', 'v']]),
      { fallback: true }
    );
    expect(bad.success).toBe(false);
  });
});

describe('Item 75 — isValid is memoized', () => {
  test('repeat isValid queries on a large tree are O(1)', () => {
    // Build a ~12k-node tree; the first query walks it, later queries must
    // answer from the cached flag. Wall-clock bounds are inherently
    // load-sensitive, so the margins are wide on both sides: 10 000
    // un-memoized walks of this tree take several SECONDS (≈0.3 ms each),
    // while memoized queries finish in single-digit milliseconds — a
    // 1000 ms bound distinguishes the two regimes with ~10× headroom each
    // way even on a loaded CI machine.
    const build = (depth: number): any =>
      depth === 0
        ? 'x'
        : ['Add', ['Multiply', build(depth - 1), 2], build(depth - 1), 1];
    const expr = ce.box(build(11), { canonical: false });
    expect(expr.isValid).toBe(true);
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) void expr.isValid;
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test('memoized isValid stays correct for invalid trees', () => {
    const bad = ce.box(['Add', 1, ['Error', { str: 'unknown' }]], {
      canonical: false,
    });
    expect(bad.isValid).toBe(false);
    expect(bad.isValid).toBe(false);
  });
});

describe('Item 76 — RandomList', () => {
  test('returns an eager List of n uniforms in [0,1)', () => {
    const engine = new ComputeEngine();
    const v = engine.box(['RandomList', 5]).evaluate();
    expect(v.operator).toEqual('List');
    if (!('ops' in v)) throw new Error('expected a function expression');
    const ops = (v as any).ops;
    expect(ops).toHaveLength(5);
    for (const el of ops) {
      expect(el.re).toBeGreaterThanOrEqual(0);
      expect(el.re).toBeLessThan(1);
    }
    // Elements are independent draws, not one value repeated
    expect(new Set(ops.map((el: any) => el.re)).size).toBeGreaterThan(1);
  });

  test('literal count is part of the type', () => {
    const engine = new ComputeEngine();
    const t = engine.box(['RandomList', 5]).type;
    expect(t.matches('list<real>')).toBe(true);
    expect(t.toString()).toContain('5');
  });

  test('honors ce.randomSeed (reproducible engine stream)', () => {
    const engine = new ComputeEngine();
    engine.randomSeed = 42;
    const a = engine.box(['RandomList', 3]).evaluate().toString();
    engine.randomSeed = 42;
    const b = engine.box(['RandomList', 3]).evaluate().toString();
    expect(a).toEqual(b);
  });

  test('explicit seed is deterministic and independent of the engine stream', () => {
    const engine = new ComputeEngine();
    const a = engine.box(['RandomList', 3, 7]).evaluate().toString();
    const b = engine.box(['RandomList', 3, 7]).evaluate().toString();
    const c = engine.box(['RandomList', 3, 8]).evaluate().toString();
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test('a symbolic count stays symbolic', () => {
    const engine = new ComputeEngine();
    expect(engine.box(['RandomList', 'm']).evaluate().operator).toEqual(
      'RandomList'
    );
  });

  test('an over-cap count errors loudly instead of materializing', () => {
    const engine = new ComputeEngine();
    const r = engine.box(['RandomList', 10_000_000]).evaluate();
    expect(r.operator).toEqual('Error');
  });

  test('a negative literal count errors loudly (like over-cap), not silently inert', () => {
    const engine = new ComputeEngine();
    const r = engine.box(['RandomList', -3]).evaluate();
    expect(r.operator).toEqual('Error');
  });

  test('a beyond-safe-integer literal count errors loudly, not silently inert', () => {
    const engine = new ComputeEngine();
    const r = engine.box(['RandomList', 1e20]).evaluate();
    expect(r.operator).toEqual('Error');
  });

  test('materialization honors the evaluation deadline', () => {
    const engine = new ComputeEngine();
    // 10⁶ draws take long enough that a 1 ms deadline must fire inside the
    // materialization loop (the amortized checkDeadline poll).
    expect(() =>
      engine.withTimeLimit(1, () => engine.box(['RandomList', 1_000_000]).evaluate())
    ).toThrow();
  });

  test('a zero count yields the empty list with an unshaped list type', () => {
    const engine = new ComputeEngine();
    const e = engine.box(['RandomList', 0]);
    // A `^0` shape would reduce to the unit type — keep the plain list type
    expect(e.type.matches('list<real>')).toBe(true);
    expect(e.type.toString()).not.toContain('^0');
    expect(e.evaluate().json).toEqual(['List']);
  });
});

describe('Item 64b — large finite big-operator bounds stream and stay interruptible', () => {
  test('Σ over a 1e8 finite range honors the deadline (no eager materialization)', () => {
    const engine = new ComputeEngine();
    const expr = engine.parse('\\sum_{i=1}^{100000000} \\sin(i)');
    const t0 = Date.now();
    expect(() => engine.withTimeLimit(500, () => expr.evaluate())).toThrow();
    // An eager materialization would OOM/stall far past the deadline; the
    // streamed path cancels promptly. Generous bound (20× the 500 ms
    // deadline) so a loaded CI machine cannot flake it.
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  test('Π over a 1e8 finite range honors the deadline', () => {
    const engine = new ComputeEngine();
    const expr = engine.parse('\\prod_{i=1}^{100000000} \\sin(i)');
    expect(() => engine.withTimeLimit(500, () => expr.evaluate())).toThrow();
  });
});
