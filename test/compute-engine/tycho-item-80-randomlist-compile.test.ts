import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';

/**
 * Tycho item 80 — the compiled eager-draw list, on the JavaScript target.
 *
 * The 2026-07-25 Random family redesign
 * (`docs/RANDOMNESS-MODEL.md`) removed `RandomList`
 * and every per-operator seed argument, and with them the compile-time bake
 * machinery this suite used to pin (`ce.randomSeed`, `target.randomSeed`,
 * `randomState.counter`, `makeRandomList`'s three modes). `RandomList(n)`
 * migrates to `RandomChoice(Interval(0, 1), n)` and `RandomList(n, seed)` to
 * `WithRandomSeed(seed, RandomChoice(Interval(0, 1), n))`, so the suite is
 * REWRITTEN to the new semantics rather than re-pointed (§4 "replaced, not
 * ported").
 *
 * What carries over from item 80 / item 76: the draw-once EAGERNESS contract
 * (the result is a materialized list of `k` values, drawn at call time), and
 * the loud range check on `k` before any draw. What replaces the three baked
 * modes: exactly two, framed and unframed, decided per CALL inside
 * `_SYS.drawNextRandomNumber()`.
 *
 * The general compiled random-family parity plan (§8) lives in
 * `random-compile.test.ts`; this file stays focused on `RandomChoice`.
 */

/** The expected n-th draw of a frame seeded `seed`. */
function draw(seed: number | string, n: number): number {
  const [seedLo, seedHi] = foldSeed(seed);
  return frameDraw(seedLo, seedHi, n);
}

function mkEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('xs', 'list<number>');
  return ce;
}

/** Compile, refusing the interpreter fallback so a missing handler is loud. */
function compiled(ce: ComputeEngine, json: any) {
  const r = compile(ce.box(json), { fallback: false })!;
  expect(r.success).toBe(true);
  return r;
}

describe('compiled RandomChoice — the RandomList migration', () => {
  it('`RandomChoice(Interval(0, 1), n)` replays inside a frame, matching the interpreter', () => {
    const ce = mkEngine();
    const json = ['RandomChoice', ['Interval', 0, 1], 4];
    const r = compiled(ce, json);
    const c = withRandomSeedFrame(ce, 0.5, () => r.run!() as number[]);
    const i = withRandomSeedFrame(ce, 0.5, () =>
      ce
        .box(json)
        .evaluate()
        .ops!.map((x) => x.re)
    );
    expect(c).toEqual(i);
    expect(c).toEqual([0, 1, 2, 3].map((n) => draw(0.5, n)));
    // The whole frame replays.
    expect(withRandomSeedFrame(ce, 0.5, () => r.run!())).toEqual(c);
  });

  it('is EAGER: the k draws happen at call time and differ per call', () => {
    // The item-76 draw-once contract: the result is a materialized list of
    // `k` values (not a lazy view), and an unframed call is live.
    const ce = mkEngine();
    const r = compiled(ce, ['RandomChoice', ['Interval', 0, 1], 3]);
    const a = r.run!() as number[];
    const b = r.run!() as number[];
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3); // k independent draws, not one repeated
    expect(a).not.toEqual(b); // live outside a frame
  });

  it('draws from a `Range` domain in closed form, matching the interpreter', () => {
    const ce = mkEngine();
    const json = ['RandomChoice', ['Range', 1, 6], 10];
    const r = compiled(ce, json);
    const c = withRandomSeedFrame(ce, 42, () => r.run!() as number[]);
    const i = withRandomSeedFrame(ce, 42, () =>
      ce
        .box(json)
        .evaluate()
        .ops!.map((x) => x.re)
    );
    expect(c).toEqual(i);
    expect(c.every((v) => v >= 1 && v <= 6 && Number.isInteger(v))).toBe(true);
  });

  it('draws from a literal list domain, matching the interpreter', () => {
    const ce = mkEngine();
    const json = ['RandomChoice', ['List', 10, 20, 30], 6];
    const r = compiled(ce, json);
    const c = withRandomSeedFrame(ce, 7, () => r.run!() as number[]);
    const i = withRandomSeedFrame(ce, 7, () =>
      ce
        .box(json)
        .evaluate()
        .ops!.map((x) => x.re)
    );
    expect(c).toEqual(i);
    // `k > n` is legal — that is what replacement means.
    expect(c).toHaveLength(6);
    expect(c.every((v) => [10, 20, 30].includes(v))).toBe(true);
  });

  it('never expands a `Range` domain: k draws cost O(k), not O(n)', () => {
    // The descriptor rule (§7): compiling the domain as a COLLECTION would
    // route it through the JS `Range` handler, which materializes via
    // `Array.from` — a million-element allocation to draw a thousand values.
    const ce = mkEngine();
    const r = compiled(ce, ['RandomChoice', ['Range', 1, 1000000], 1000]);
    // The generated source is the whole proof, and it is deterministic: an
    // `Array.from` over the domain is what a million-element materialization
    // would look like, and `_SYS.domainRange` is the O(k) descriptor that
    // replaces it. Timing the run added nothing the source inspection does not
    // already establish, while making the verdict depend on machine load.
    expect(r.code).not.toContain('Array.from');
    expect(r.code).toContain('_SYS.domainRange');
    const v = withRandomSeedFrame(ce, 1, () => r.run!() as number[]);
    expect(v).toHaveLength(1000);
  });

  it('consumes exactly k draw indices (trailing-draw probe)', () => {
    // A handler can return correct output while leaving the frame's counter in
    // the wrong place — invisible to result-only parity tests.
    const ce = mkEngine();
    const r = compiled(ce, ['RandomChoice', ['Range', 1, 6], 5]);
    const trailing = withRandomSeedFrame(ce, 3, () => {
      r.run!();
      return ce._random();
    });
    expect(trailing).toBe(draw(3, 5));
  });

  it('a zero count consumes no draws and returns an empty list', () => {
    const ce = mkEngine();
    const r = compiled(ce, ['RandomChoice', ['Range', 1, 6], 0]);
    const [v, trailing] = withRandomSeedFrame(ce, 3, () => [
      r.run!(),
      ce._random(),
    ]);
    expect(v).toEqual([]);
    expect(trailing).toBe(draw(3, 0));
  });

  it('rounds a non-integer count half toward +infinity, like the interpreter', () => {
    const ce = mkEngine();
    ce.declare('k', 'number');
    const r = compiled(ce, ['RandomChoice', ['Range', 1, 6], 'k']);
    for (const [k, n] of [
      [2.7, 3],
      [2.4, 2],
      [2.5, 3],
      [-0.4, 0],
    ] as const)
      expect((r.run!({ k }) as number[]).length).toBe(n);
  });

  it('throws loudly on a bad count, BEFORE any draw', () => {
    const ce = mkEngine();
    ce.declare('k', 'number');
    const r = compiled(ce, ['RandomChoice', ['Range', 1, 6], 'k']);
    expect(() => r.run!({ k: -3 })).toThrow(/RandomChoice/);
    expect(() => r.run!({ k: Number.NaN })).toThrow(/RandomChoice/);
    expect(() => r.run!({ k: 1e9 })).toThrow(/RandomChoice/);
    // A rejected count leaves the frame's counter untouched.
    const trailing = withRandomSeedFrame(ce, 3, () => {
      expect(() => r.run!({ k: -3 })).toThrow();
      return ce._random();
    });
    expect(trailing).toBe(draw(3, 0));
  });

  it('a degenerate domain throws rather than drawing from a reversed range', () => {
    const ce = mkEngine();
    ce.declare('n', 'integer');
    // An explicit step makes the emptiness runtime-visible: `Range(1, n, 1)`
    // with `n <= 0` is the empty range the interpreter reports `out-of-range`
    // for. Compiled code cannot raise a structured error, so it throws.
    const r = compiled(ce, ['RandomChoice', ['Range', 1, 'n', 1], 2]);
    expect(() => r.run!({ n: 0 })).toThrow(/RandomChoice/);
    expect(r.run!({ n: 5 })).toHaveLength(2);
  });

  it('fails closed on a domain with no descriptor (D6)', () => {
    const ce = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(ce.box(['RandomChoice', ['Set', 1, 2, 3], 2]))
    ).toThrow(/Fail closed/);
  });
});
