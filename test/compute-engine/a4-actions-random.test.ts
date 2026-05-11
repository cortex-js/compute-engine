import { ComputeEngine } from '../../src/compute-engine';

describe('A4.1 — Block is sequential (regression)', () => {
  test('Assign sees prior Assign\'s value within the same Block', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Block', ['Assign', 'a', 1], ['Assign', 'b', ['Add', 'a', 1]], 'b'])
      .evaluate();
    expect(r.re).toEqual(2);
  });

  test('Reassignment cascades sequentially (a=1; a=a+1; a=a+1 → 3)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        ['Assign', 'a', 1],
        ['Assign', 'a', ['Add', 'a', 1]],
        ['Assign', 'a', ['Add', 'a', 1]],
        'a',
      ])
      .evaluate();
    expect(r.re).toEqual(3);
  });

  test('Snapshot-then-commit rewrite preserves simultaneous semantics', () => {
    // Outer state: a=10, b=20. Want a swap (a, b) → (20, 10) with parallel
    // semantics, expressed via the snapshot-then-commit rewrite.
    const ce = new ComputeEngine();
    ce.assign('a', 10);
    ce.assign('b', 20);
    ce.box([
      'Block',
      ['Assign', '_t_a', 'b'],
      ['Assign', '_t_b', 'a'],
      ['Assign', 'a', '_t_a'],
      ['Assign', 'b', '_t_b'],
    ]).evaluate();
    expect(ce.box('a').evaluate().re).toEqual(20);
    expect(ce.box('b').evaluate().re).toEqual(10);
  });

  test('Naive sequential rewrite of a swap does NOT preserve simultaneous semantics', () => {
    // Documents the trap: pasting a Desmos action tuple as Block directly
    // is wrong. With sequential semantics, both end up equal to b.
    const ce = new ComputeEngine();
    ce.assign('a', 10);
    ce.assign('b', 20);
    ce.box([
      'Block',
      ['Assign', 'a', 'b'], // a := b → a=20
      ['Assign', 'b', 'a'], // b := a → b=20 (NOT 10)
    ]).evaluate();
    expect(ce.box('a').evaluate().re).toEqual(20);
    expect(ce.box('b').evaluate().re).toEqual(20);
  });
});

describe('A4.2 — Random(seed) polymorphic dispatch', () => {
  test('Random() returns a float in [0,1)', () => {
    const ce = new ComputeEngine();
    const v = ce.box(['Random']).evaluate().re!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  test('Random(seed) is deterministic — same seed → same value', () => {
    const ce = new ComputeEngine();
    const v1 = ce.box(['Random', 0.5]).evaluate().re!;
    const v2 = ce.box(['Random', 0.5]).evaluate().re!;
    expect(v1).toEqual(v2);
  });

  test('Random(seed) returns a float in [0,1)', () => {
    const ce = new ComputeEngine();
    for (const seed of [0.1, 1.5, 42.7, -3.2, 1e6]) {
      const v = ce.box(['Random', seed]).evaluate().re!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('Random(seed) varies with seed', () => {
    const ce = new ComputeEngine();
    const v1 = ce.box(['Random', 0.1]).evaluate().re!;
    const v2 = ce.box(['Random', 0.2]).evaluate().re!;
    expect(v1).not.toEqual(v2);
  });

  test('Random(n) — integer arg — still returns integer in [0, n)', () => {
    const ce = new ComputeEngine();
    for (let i = 0; i < 30; i++) {
      const v = ce.box(['Random', 5]).evaluate().re!;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  test('Random(m, n) — both integer — returns integer in [m, n)', () => {
    const ce = new ComputeEngine();
    for (let i = 0; i < 30; i++) {
      const v = ce.box(['Random', 10, 20]).evaluate().re!;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  test('Random(seed) matches the hash formula', () => {
    const ce = new ComputeEngine();
    const seed = 0.5;
    const expected = (() => {
      const v = Math.sin(seed * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    })();
    const got = ce.box(['Random', 0.5]).evaluate().re!;
    expect(got).toBeCloseTo(expected, 12);
  });

  test('Random compiles to JS with deterministic-seed support', () => {
    const ce = new ComputeEngine();
    const seeded = ce.parse('\\operatorname{Random}(0.7)');
    const fnSeeded = seeded.compile() as any;
    const a = fnSeeded();
    const b = fnSeeded();
    expect(a).toEqual(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);

    const unseeded = ce.parse('\\operatorname{Random}()');
    const fnUnseeded = unseeded.compile() as any;
    const c = fnUnseeded();
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(1);
  });

  test('Random(integer-typed-symbol) routes to integer-bound on GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.box(['Random', 'n']);
    const glsl = expr.compileToSource({ target: 'glsl' });
    // Integer-bound form should not call _gpu_random directly on n; it should
    // wrap the result in an int() cast or scale a seeded draw. The exact form
    // depends on the implementation choice, but the result must NOT be a bare
    // _gpu_random(float(n)) which would be a seeded float (the old A1 bug).
    expect(glsl).toMatch(/int\(.*_gpu_random|floor.*_gpu_random|%\s*n/);
  });

  test('Random(real-typed-arg) compiles to seeded float on GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{Random}(0.5)');
    const glsl = expr.compileToSource({ target: 'glsl' });
    expect(glsl).toMatch(/_gpu_random/);
  });
});
