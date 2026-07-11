import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Seeded, deterministic randomness: `ce.randomSeed`, deterministic `Random`
 * evaluation under a seed, and deterministic (baked) compiled output.
 *
 * These tests use fresh `new ComputeEngine()` instances so they never perturb
 * the shared test engine's RNG state.
 */

function draw(ce: ComputeEngine): number {
  return ce.box(['Random']).evaluate().re;
}

describe('ce.randomSeed — evaluate()', () => {
  it('defaults to null (non-deterministic path works, values in [0, 1))', () => {
    const ce = new ComputeEngine();
    expect(ce.randomSeed).toBe(null);
    for (let i = 0; i < 20; i++) {
      const v = draw(ce);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed ⇒ identical sequence across two engines', () => {
    const a = new ComputeEngine();
    a.randomSeed = 12345;
    const b = new ComputeEngine();
    b.randomSeed = 12345;
    const seqA = [draw(a), draw(a), draw(a), draw(a)];
    const seqB = [draw(b), draw(b), draw(b), draw(b)];
    expect(seqA).toEqual(seqB);
  });

  it('re-assigning the same seed resets (rewinds) the stream', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 'hello';
    const first = [draw(ce), draw(ce), draw(ce)];
    ce.randomSeed = 'hello';
    const second = [draw(ce), draw(ce), draw(ce)];
    expect(first).toEqual(second);
  });

  it('successive draws in a seeded sequence differ', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 42;
    const v1 = draw(ce);
    const v2 = draw(ce);
    expect(v1).not.toEqual(v2);
  });

  it('different seeds ⇒ different first draws', () => {
    const a = new ComputeEngine();
    a.randomSeed = 1;
    const b = new ComputeEngine();
    b.randomSeed = 2;
    expect(draw(a)).not.toEqual(draw(b));
  });

  it('string seeds are supported and reproducible', () => {
    const a = new ComputeEngine();
    a.randomSeed = 'desmos-doc';
    const b = new ComputeEngine();
    b.randomSeed = 'desmos-doc';
    expect(draw(a)).toEqual(draw(b));
    expect(draw(a)).toBeGreaterThanOrEqual(0);
  });

  it('assigning null returns to the non-deterministic path', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 7;
    ce.randomSeed = null;
    expect(ce.randomSeed).toBe(null);
    const v = draw(ce);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('seeded Random(n) draws integers in [0, n) from the stream', () => {
    const a = new ComputeEngine();
    a.randomSeed = 99;
    const b = new ComputeEngine();
    b.randomSeed = 99;
    const seqA = [0, 0, 0].map(() => a.box(['Random', 6]).evaluate().re);
    const seqB = [0, 0, 0].map(() => b.box(['Random', 6]).evaluate().re);
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('the explicit Random(seed) overload is unaffected by ce.randomSeed', () => {
    const plain = new ComputeEngine();
    const seeded = new ComputeEngine();
    seeded.randomSeed = 500;
    const a = plain.box(['Random', 0.25]).evaluate().re;
    const b = seeded.box(['Random', 0.25]).evaluate().re;
    // Per-call deterministic hash of the argument — identical regardless of
    // the engine seed, and stable across repeated calls.
    expect(a).toEqual(b);
    expect(seeded.box(['Random', 0.25]).evaluate().re).toEqual(b);
  });
});

describe('RandomInteger — evaluate()', () => {
  it('RandomInteger(a, b) stays within the inclusive range [a, b]', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 7;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 500; i++) {
      const v = ce.box(['RandomInteger', 1, 6]).evaluate().re;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // Both endpoints are reachable (inclusive upper bound).
    expect(min).toBe(1);
    expect(max).toBe(6);
  });

  it('the one-argument form draws from the inclusive range [0, n]', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 11;
    let max = -Infinity;
    for (let i = 0; i < 500; i++) {
      const v = ce.box(['RandomInteger', 3]).evaluate().re;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
      if (v > max) max = v;
    }
    expect(max).toBe(3);
  });

  it('a single point [k, k] always yields k', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 1;
    expect(ce.box(['RandomInteger', 5, 5]).evaluate().re).toBe(5);
  });

  it('reversed bounds are normalized', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 3;
    for (let i = 0; i < 100; i++) {
      const v = ce.box(['RandomInteger', 6, 1]).evaluate().re;
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('same seed ⇒ identical sequence across two engines', () => {
    const a = new ComputeEngine();
    a.randomSeed = 12345;
    const b = new ComputeEngine();
    b.randomSeed = 12345;
    const drawInt = (ce: ComputeEngine) =>
      ce.box(['RandomInteger', 0, 1000]).evaluate().re;
    const seqA = [drawInt(a), drawInt(a), drawInt(a), drawInt(a)];
    const seqB = [drawInt(b), drawInt(b), drawInt(b), drawInt(b)];
    expect(seqA).toEqual(seqB);
  });

  it('a symbolic bound stays unevaluated', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['RandomInteger', 'n']).evaluate().operator).toBe(
      'RandomInteger'
    );
  });
});

describe('ce.randomSeed — compile() baking', () => {
  it('with no seed, Random emits Math.random()', () => {
    const ce = new ComputeEngine();
    expect(compile(ce.box(['Random'])).code).toBe('Math.random()');
  });

  it('with a seed, a compiled Random is baked and stable across calls', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 2024;
    const result = compile(ce.box(['Random']));
    const run = result.run!;
    expect(run()).toEqual(run());
    // The baked value is a constant (no Math.random() in the emitted code).
    expect(result.code).not.toContain('Math.random');
  });

  it('two Random nodes in one expression bake to different values', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 2024;
    // Compile the two nodes separately as [Random - Random]; a nonzero result
    // proves the two baked constants differ.
    const result = compile(ce.box(['Subtract', ['Random'], ['Random']]));
    expect(result.run!()).not.toEqual(0);
  });

  it('recompiling the same expression with the same seed reproduces values', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 314;
    const r1 = compile(ce.box(['Add', ['Random'], ['Random']]));
    const r2 = compile(ce.box(['Add', ['Random'], ['Random']]));
    expect(r1.run!()).toEqual(r2.run!());
  });

  it('different seeds bake different compiled values', () => {
    const a = new ComputeEngine();
    a.randomSeed = 1;
    const b = new ComputeEngine();
    b.randomSeed = 2;
    const ra = compile(a.box(['Random']));
    const rb = compile(b.box(['Random']));
    expect(ra.run!()).not.toEqual(rb.run!());
  });

  it('seeded Random(n) bakes a call-site-stable integer', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 77;
    const result = compile(ce.box(['Random', 10]));
    const run = result.run!;
    const v = run();
    expect(run()).toEqual(v);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(10);
  });
});
