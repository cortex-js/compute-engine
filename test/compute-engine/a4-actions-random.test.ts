import { ComputeEngine, compile } from '../../src/compute-engine';

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
    for (const seed of [0.1, 1.5, 42.7, -3.2, 1e6 + 0.5]) {
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
    const compiledSeeded = compile(seeded);
    expect(compiledSeeded.success).toBe(true);
    const fnSeeded = compiledSeeded.run as () => number;
    const a = fnSeeded();
    const b = fnSeeded();
    expect(a).toEqual(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);

    const unseeded = ce.parse('\\operatorname{Random}()');
    const compiledUnseeded = compile(unseeded);
    expect(compiledUnseeded.success).toBe(true);
    const fnUnseeded = compiledUnseeded.run as () => number;
    const c = fnUnseeded();
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(1);
  });

  test('Random(integer-typed-symbol) routes to integer-bound on GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.box(['Random', 'n']);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    const glsl = compiled.code;
    // Integer-bound form must scale a seeded draw by n; result must be a
    // float-typed expression (so it composes with float arithmetic), not a
    // bare `_gpu_random(float(n))` (which would be a seeded float in [0,1),
    // the old A1 bug).
    expect(glsl).toMatch(/floor.*_gpu_random.*\*\s*float\(n\)/);
    // No `int(...)` cast — GLSL is strongly typed and `int + float` fails
    // to compile in strict mode.
    expect(glsl).not.toMatch(/\bint\(/);
  });

  test('Random(int) composes with float arithmetic on GLSL (no type errors)', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.parse('\\operatorname{Random}(n) + 1.5');
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    // The emitted code must not introduce an `int + float` pattern that
    // strict GLSL drivers reject.
    expect(compiled.code).not.toMatch(/\bint\(/);
  });

  test('Random(real-typed-arg) compiles to seeded float on GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{Random}(0.5)');
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toMatch(/_gpu_random/);
  });
});

describe('A4.3 — Seeded Shuffle / Sample', () => {
  test('Shuffle without seed still works (non-deterministic)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5]]).evaluate();
    expect(r.operator).toEqual('List');
    expect(r.nops).toEqual(5);
    const elements = r.ops!.map((x) => x.re).sort();
    expect(elements).toEqual([1, 2, 3, 4, 5]);
  });

  test('Shuffle(L, seed) is deterministic', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.7]).evaluate();
    const b = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.7]).evaluate();
    expect(a.ops!.map((x) => x.re)).toEqual(b.ops!.map((x) => x.re));
  });

  test('Shuffle(L, seed) varies with seed', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.1]).evaluate();
    const b = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.9]).evaluate();
    // Almost certainly different orderings (P(equal) ≈ 1/120).
    expect(a.ops!.map((x) => x.re)).not.toEqual(b.ops!.map((x) => x.re));
  });

  test('Shuffle(L, seed) preserves elements (permutation)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Shuffle', ['List', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5])
      .evaluate();
    const elements = r.ops!.map((x) => x.re).sort((a, b) => a! - b!);
    expect(elements).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('Sample(L, k) without seed still works (non-deterministic)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Sample', ['List', 1, 2, 3, 4, 5], 3]).evaluate();
    expect(r.operator).toEqual('List');
    expect(r.nops).toEqual(3);
  });

  test('Sample(L, k, seed) is deterministic', () => {
    const ce = new ComputeEngine();
    const a = ce
      .box(['Sample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3, 0.4])
      .evaluate();
    const b = ce
      .box(['Sample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3, 0.4])
      .evaluate();
    expect(a.ops!.map((x) => x.re)).toEqual(b.ops!.map((x) => x.re));
  });

  test('Sample(L, k, seed) returns k distinct elements from L', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Sample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3, 0.4])
      .evaluate();
    expect(r.nops).toEqual(3);
    const got = r.ops!.map((x) => x.re!);
    const all = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const v of got) expect(all).toContain(v);
    expect(new Set(got).size).toEqual(3);
  });
});

// Note: `\operatorname{with}` was prototyped during A4 but intentionally
// dropped from CE built-ins. Use `\operatorname{where}` (with `\coloneq` for
// bindings) for the math-notation local-binding form, or register `with` as
// a custom dictionary entry at the integration layer — see the
// "Desmos-Specific Syntax — Prefer Custom LaTeX Dictionary" section in
// COMPUTE_ENGINE.md for the worked example. Tests for `\operatorname{where}`
// live in test/compute-engine/latex-syntax/parse-where.test.ts.
