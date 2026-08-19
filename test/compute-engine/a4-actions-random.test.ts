import { ComputeEngine, compile } from '../../src/compute-engine';

describe('A4.1 — Block is sequential (regression)', () => {
  test('Assign sees prior Assign\'s value within the same Block', () => {
    const ce = new ComputeEngine();
    const r = ce
      .expr(['Block', ['Assign', 'a', 1], ['Assign', 'b', ['Add', 'a', 1]], 'b'])
      .evaluate();
    expect(r.re).toEqual(2);
  });

  test('Reassignment cascades sequentially (a=1; a=a+1; a=a+1 → 3)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .expr([
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
    ce.expr([
      'Block',
      ['Assign', '_t_a', 'b'],
      ['Assign', '_t_b', 'a'],
      ['Assign', 'a', '_t_a'],
      ['Assign', 'b', '_t_b'],
    ]).evaluate();
    expect(ce.expr('a').evaluate().re).toEqual(20);
    expect(ce.expr('b').evaluate().re).toEqual(10);
  });

  test('Naive sequential rewrite of a swap does NOT preserve simultaneous semantics', () => {
    // Documents the trap: pasting a Desmos action tuple as Block directly
    // is wrong. With sequential semantics, both end up equal to b.
    const ce = new ComputeEngine();
    ce.assign('a', 10);
    ce.assign('b', 20);
    ce.expr([
      'Block',
      ['Assign', 'a', 'b'], // a := b → a=20
      ['Assign', 'b', 'a'], // b := a → b=20 (NOT 10)
    ]).evaluate();
    expect(ce.expr('a').evaluate().re).toEqual(20);
    expect(ce.expr('b').evaluate().re).toEqual(20);
  });
});

// A4.2/A4.3 originally pinned `Random`'s seed-or-bound dispatch and the
// per-operator `seed` arguments of `Shuffle`/`Sample`. The 2026-07-25 Random
// family redesign removed all of them: the first operand of `Random` is
// always a DOMAIN, and seeding is the block-scoped `WithRandomSeed` frame.
// See `docs/RANDOMNESS-MODEL.md` §1 (P1–P8).
//
// The exhaustive coverage lives in `random.test.ts`; what is kept here is the
// A4 action-context shape — a randomized draw used inside an action-style
// `Block`, which is what the A4 round was about.

describe('A4.2 — Random draws from a domain (no seed argument)', () => {
  test('Random() returns a float in [0,1)', () => {
    const ce = new ComputeEngine();
    const v = ce.expr(['Random']).evaluate().re!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  test('a numeric first operand is now signature-invalid (P1/P2 are gone)', () => {
    const ce = new ComputeEngine();
    // `Random(0.5)` used to mean "seed", `Random(5)` used to mean "bound",
    // and `5.0` canonicalized to `5` so an integral seed silently became a
    // bound. Both spellings are rejected outright now.
    expect(ce.expr(['Random', 0.5]).isValid).toBe(false);
    expect(ce.expr(['Random', 5]).isValid).toBe(false);
    expect(ce.expr(['Random', 10, 20]).isValid).toBe(false);
  });

  test('Random(Range(m, n)) replaces the old integer-bound forms — INCLUSIVE at both ends', () => {
    const ce = new ComputeEngine();
    for (let i = 0; i < 40; i++) {
      const v = ce.expr(['Random', ['Range', 10, 20]]).evaluate().re!;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  test('a frame makes a draw deterministic; two evaluations of the frame agree', () => {
    const ce = new ComputeEngine();
    const framed = (): number =>
      ce.expr(['WithRandomSeed', 0.7, ['Random']]).evaluate().re!;
    const a = framed();
    expect(framed()).toEqual(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  test('an unframed Random() compiles to JS and stays live', () => {
    const ce = new ComputeEngine();
    const compiled = compile(ce.parse('\\operatorname{Random}()'));
    expect(compiled.success).toBe(true);
    const fn = compiled.run as () => number;
    const v = fn();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
    // Live, not baked: repeated calls differ.
    expect(new Set([fn(), fn(), fn(), fn(), fn()]).size).toBe(5);
  });

  test('a draw inside an action-style Block advances the frame per statement', () => {
    const ce = new ComputeEngine();
    const r = ce
      .expr([
        'WithRandomSeed',
        11,
        [
          'Block',
          ['Assign', 'a', ['Random', ['Range', 1, 100]]],
          ['Assign', 'b', ['Random', ['Range', 1, 100]]],
          ['List', 'a', 'b'],
        ],
      ])
      .evaluate();
    const v = [...r.each()].map((x) => x.re);
    expect(v).toHaveLength(2);
    for (const x of v) {
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(100);
    }
  });
});

describe('A4.3 — RandomShuffle / RandomSample (seedless)', () => {
  test('RandomShuffle is a permutation of the source', () => {
    const ce = new ComputeEngine();
    const r = ce.expr(['RandomShuffle', ['List', 1, 2, 3, 4, 5]]).evaluate();
    expect(r.operator).toEqual('List');
    expect(r.nops).toEqual(5);
    expect(r.ops!.map((x) => x.re).sort((a, b) => a! - b!)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  test('a frame makes RandomShuffle deterministic, and different seeds differ', () => {
    const ce = new ComputeEngine();
    const framed = (seed: number): (number | undefined)[] =>
      [
        ...ce
          .expr([
            'WithRandomSeed',
            seed,
            ['RandomShuffle', ['List', 1, 2, 3, 4, 5]],
          ])
          .evaluate()
          .each(),
      ].map((x) => x.re);
    expect(framed(0.7)).toEqual(framed(0.7));
    // P(two seeds agreeing on a 5-element permutation) ≈ 1/120.
    expect(framed(0.1)).not.toEqual(framed(0.9));
  });

  test('RandomSample(L, k) returns k elements drawn from L', () => {
    const ce = new ComputeEngine();
    const r = ce
      .expr(['RandomSample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3])
      .evaluate();
    expect(r.operator).toEqual('List');
    expect(r.nops).toEqual(3);
    const got = r.ops!.map((x) => x.re!);
    for (const v of got) expect([1, 2, 3, 4, 5, 6, 7, 8]).toContain(v);
    // Distinct source values, and each POSITION is drawn at most once.
    expect(new Set(got).size).toEqual(3);
  });

  test('a frame makes RandomSample deterministic', () => {
    const ce = new ComputeEngine();
    const framed = (): (number | undefined)[] =>
      [
        ...ce
          .expr([
            'WithRandomSeed',
            0.4,
            ['RandomSample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3],
          ])
          .evaluate()
          .each(),
      ].map((x) => x.re);
    expect(framed()).toEqual(framed());
  });
});

// Note: `\operatorname{with}` was prototyped during A4 but intentionally
// dropped from CE built-ins. Use `\operatorname{where}` (with `\coloneq` for
// bindings) for the math-notation local-binding form, or register `with` as
// a custom dictionary entry at the integration layer — see the
// "Desmos-Specific Syntax — Prefer Custom LaTeX Dictionary" section in
// COMPUTE_ENGINE.md for the worked example. Tests for `\operatorname{where}`
// live in test/compute-engine/latex-syntax/parse-where.test.ts.
