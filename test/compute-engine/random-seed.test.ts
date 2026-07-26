import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Seeding after the 2026-07-25 Random family redesign
 * (`docs/plans/2026-07-25-random-signature-redesign.md`).
 *
 * There were three seeding mechanisms, none composable: `ce.randomSeed`
 * (global, host-only), the `RandomSeed(n)` operator (global,
 * expression-level), and per-operator seed arguments (local, per call). All
 * three are gone. There is exactly one mechanism — `WithRandomSeed(seed,
 * body)`, a dynamically-scoped, nesting frame — and this suite pins the two
 * things that fact implies:
 *
 * 1. `ce.randomSeed` is an ACCESSOR TOMBSTONE: both the getter and the setter
 *    throw, naming the replacement. Removing the property outright would be
 *    loud only for type-checked embedders; a plain-JS caller assigning to a
 *    removed property on an extensible object succeeds SILENTLY and
 *    randomness quietly stops being seeded (§9).
 * 2. Unframed draws are LIVE. There is no ambient seed to set, so an unseeded
 *    draw is non-deterministic by construction — which is what an
 *    animation/ticker needs, and what seeding a global stream used to break.
 *
 * The frame semantics themselves (nesting, dynamic scope, seed folding, the
 * cross-version stability vectors) live in `with-random-seed.test.ts` and
 * `random-vectors.test.ts`.
 */

describe('ce.randomSeed — fully removed (0.96.0)', () => {
  // The accessor tombstone (a throwing getter/setter) lived for the one
  // release promised by the redesign's §9 (0.95.0) and is now deleted along
  // with the operator tombstones. `randomSeed` is no longer a property of any
  // kind: reading it yields `undefined`, and a plain-JS assignment is an
  // ordinary silent expando with NO effect on draws.
  it('is not a property; assignment has no effect on draws', () => {
    const ce = new ComputeEngine();
    expect((ce as any).randomSeed).toBeUndefined();
    expect('randomSeed' in ComputeEngine.prototype).toBe(false);

    (ce as any).randomSeed = 42;
    // Draws stay live — repeated unframed draws differ.
    const a = ce.box(['Random']).evaluate().re;
    const b = ce.box(['Random']).evaluate().re;
    expect(a).not.toBe(b);
  });
});

describe('Seeding is WithRandomSeed', () => {
  const draw = (ce: ComputeEngine): number => ce.box(['Random']).evaluate().re;

  it('an unframed draw is live — two evaluations differ', () => {
    const ce = new ComputeEngine();
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const v = draw(ce);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(v);
    }
    // 20 live draws colliding is a ~1e-16 event, not a flake budget.
    expect(seen.size).toBe(20);
  });

  it('a frame replays exactly, across engines', () => {
    const a = new ComputeEngine();
    const b = new ComputeEngine();
    const framed = (ce: ComputeEngine): string =>
      ce
        .box([
          'WithRandomSeed',
          12345,
          ['List', ['Random'], ['Random'], ['Random']],
        ])
        .evaluate()
        .toString();
    expect(framed(a)).toEqual(framed(a));
    expect(framed(a)).toEqual(framed(b));
  });

  it('repeated draws WITHIN a frame differ — the headline behavior', () => {
    // The old `Random(0.5) + Random(0.5) = 2 × 0.2725…` did not do this.
    const ce = new ComputeEngine();
    const v = [
      ...ce
        .box(['WithRandomSeed', 42, ['List', ['Random'], ['Random']]])
        .evaluate()
        .each(),
    ].map((x) => x.re);
    expect(v).toHaveLength(2);
    expect(v[0]).not.toEqual(v[1]);
  });

  it('a different seed gives a different stream', () => {
    const ce = new ComputeEngine();
    const framed = (seed: number | string): number =>
      ce.box(['WithRandomSeed', seed, ['Random']]).evaluate().re;
    expect(framed(1)).not.toEqual(framed(2));
    expect(framed('cell-a7')).not.toEqual(framed('cell-a8'));
  });

  it('the frame is scoped: a draw after it is live again', () => {
    const ce = new ComputeEngine();
    ce.box(['WithRandomSeed', 42, ['Random']]).evaluate();
    const after = [draw(ce), draw(ce), draw(ce)];
    expect(new Set(after).size).toBe(3);
  });
});

describe('Compiled draws — no compile-time bake path', () => {
  // The bake path existed solely to give `ce.randomSeed` a compiled meaning:
  // each `Random` node became a constant derived from the compile-time seed.
  // With no compile-time seed there is nothing to bake. Phase 3 of the
  // redesign routes every compiled draw through `_SYS.drawNextRandomNumber()`,
  // which branches at CALL time on whether a frame is active.
  it('Random() emits the frame-aware helper, never a baked constant', () => {
    const ce = new ComputeEngine();
    // NOT a bare `Math.random()`: whether a frame is active is a CALL-time
    // property, so the branch lives inside the helper (spec §7).
    expect(compile(ce.box(['Random'])).code).toBe(
      '_SYS.drawNextRandomNumber()'
    );
  });

  it('a compiled draw is live: repeated calls differ', () => {
    const ce = new ComputeEngine();
    const run = compile(ce.box(['Random'])).run!;
    const seen = new Set<unknown>();
    for (let i = 0; i < 20; i++) seen.add(run());
    expect(seen.size).toBe(20);
  });

  it('the unseeded arm is exempt from parity — and there is no claim to break', () => {
    // Interpreted unframed `Random()` is also `Math.random()`: both engines
    // are non-deterministic, so compiled and interpreted are NOT required to
    // agree, and asserting they do would be asserting a coincidence.
    const ce = new ComputeEngine();
    const compiled = compile(ce.box(['Random'])).run!() as number;
    const interpreted = ce.box(['Random']).evaluate().re;
    expect(compiled).toBeGreaterThanOrEqual(0);
    expect(compiled).toBeLessThan(1);
    expect(interpreted).toBeGreaterThanOrEqual(0);
    expect(interpreted).toBeLessThan(1);
  });
});
