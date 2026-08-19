import { ComputeEngine } from '../../src/compute-engine';
import { monteCarloEstimate } from '../../src/compute-engine/numerics/monte-carlo';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';

/**
 * Derived sub-streams — `docs/RANDOMNESS-MODEL.md`.
 *
 * The stochastic ESTIMATORS (Monte-Carlo integration, the sampled equality
 * probe) replay under a `WithRandomSeed` frame through a private stream
 * derived from that frame, while consuming ZERO of its indices.
 *
 * ── HOW TO WRITE TESTS HERE ────────────────────────────────────────────────
 *
 * 1. Every assertion is a PROPERTY — two evaluations agree, two tags differ,
 *    a sibling draw is undisturbed. NEVER hardcode what a seeded estimate
 *    evaluates to. The tag is derived from `expr.hash`, and the design ruling
 *    (§3.1) accepts that a future change to the engine's hash shifts every
 *    seeded estimate. A pinned numeric value would be correct today and a
 *    false alarm the next time anyone touches a hash. (`deriveSubstream`
 *    itself IS pinned, for fixed literal inputs, in `random-vectors.test.ts`.)
 *
 * 2. THIS FILE HAS A ~10s BUDGET, and a real Monte-Carlo integral costs
 *    SECONDS: once the integrand compiles the sample budget is 1e7, so
 *    `∫₀¹ sin(1/x) dx` alone is 2–4s, and an iterated (multi-limit) integral
 *    that falls back to Monte Carlo runs the inner estimator once per outer
 *    quadrature node — effectively unbounded. Never put one in a test here.
 *
 *    The cheap witness used instead is an integrand that is non-finite
 *    EVERYWHERE (`√(−1−x²)` in real machine arithmetic): quadrature fails, the
 *    estimator is reached and derives its sub-stream, then the 32-sample
 *    viability probe bails and returns NaN — ~150ms instead of ~4s. The
 *    sub-stream wiring is fully exercised; only the sampling loop is skipped.
 *    Its NaN result is the point, not a defect.
 *
 *    A SMOOTH integrand may now be completed for real: `∫₀¹ x² dx` samples
 *    1e7 points in ~0.5s (the deferred-estimator block at the end does this
 *    three times). It is only the pathological ones — no closed form, poor
 *    convergence — that stay out. The whole file is ~7s.
 *
 * 2b. If an estimator test suddenly costs TENS of seconds, suspect
 *    `Math.imul`, not the engine. V8 lowers `Math.imul(...)` to one machine
 *    instruction only when `Math` is the host realm's; through the secondary
 *    `vm` context jest gives each test file it becomes a property load plus a
 *    call, ~700ns instead of ~1ns, and `pcg3d` makes six per draw — which put
 *    a 1e7-sample estimate at 36s here versus 1.4s under `tsx`.
 *    `numerics/random.ts` binds it once as `const imul = Math.imul` to avoid
 *    that; check the alias is intact before blaming anything else.
 *
 *    The corollary for sizing any test here: NEVER take a timing from `npx
 *    tsx` — the two environments are not comparable on this path. Read the
 *    duration out of jest itself (`--json --outputFile`, then
 *    `assertionResults[].duration`). A `-t` filter placed after `--` is
 *    parsed as a PATH pattern, so timing "one test" that way silently times
 *    the whole file.
 *
 * 3. Do NOT wrap an integral in a short `withTimeLimit` to speed it up: the
 *    budget is enforced by THROWING, not by truncating the estimate. Deadline
 *    behavior is tested against `monteCarloEstimate` directly instead.
 */

const ce = new ComputeEngine();

/** Non-finite everywhere in real arithmetic: reaches the Monte-Carlo
 * estimator (so the sub-stream is derived) and bails at the viability probe.
 * See note 2 above. */
const CHEAP = '\\int_0^1 \\sqrt{-1-x^2} dx';
const CHEAP2 = '\\int_0^1 \\ln(-1-x^2) dx';

/**
 * Record the tags `_substream` is asked for while `fn` runs.
 *
 * The spy is installed on the PROTOTYPE, not on the engine instance. Assigning
 * an own `_substream` property to the engine changes its object shape and
 * costs it the fast paths it relies on everywhere — doing that took this file
 * from ~5s to ~26s, with the integral evaluations themselves ~50x slower.
 * Replacing the prototype method leaves every instance's shape untouched.
 */
function tagsUsed(fn: (engine: ComputeEngine) => unknown): number[] {
  const tags: number[] = [];
  const proto = Object.getPrototypeOf(ce) as {
    _substream: (tag: number) => unknown;
  };
  const original = proto._substream;
  proto._substream = function (this: ComputeEngine, tag: number) {
    tags.push(tag);
    return original.call(this, tag);
  };
  try {
    fn(ce);
  } finally {
    proto._substream = original;
  }
  return tags;
}

/** The `.re` of each element of a boxed collection. */
const res = (x: any): (number | undefined)[] =>
  [...x.each()].map((v: any) => v.re);

//
// ─── The primitive, through the engine ──────────────────────────────────────
//

describe('ce._substream', () => {
  /** Three draws of sub-stream `tag`, taken inside a frame seeded `seed`
   * after `burn` draws have already been consumed from the frame itself. */
  const inFrame = (seed: number, tag: number, burn: number): number[] =>
    withRandomSeedFrame(ce, seed, () => {
      for (let i = 0; i < burn; i++) ce._random();
      const s = ce._substream(tag);
      return [s(), s(), s()];
    });

  it('is deterministic under a frame', () => {
    expect(inFrame(42, 7, 0)).toEqual(inFrame(42, 7, 0));
  });

  it('does not depend on how far the frame counter has advanced', () => {
    // The reordering-insensitivity the whole design is for: an estimator must
    // not care whether a `Random()` ran before it.
    expect(inFrame(42, 7, 5)).toEqual(inFrame(42, 7, 0));
  });

  it('does not consume frame indices', () => {
    // Draw from a sub-stream between two frame draws; the frame draws must be
    // the same as if the sub-stream had never existed.
    const withSub = withRandomSeedFrame(ce, 3, () => {
      const a = ce._random();
      const s = ce._substream(11);
      s();
      s();
      s();
      return [a, ce._random()];
    });
    const without = withRandomSeedFrame(ce, 3, () => [
      ce._random(),
      ce._random(),
    ]);
    expect(withSub).toEqual(without);
  });

  it('distinct tags and distinct seeds give distinct streams', () => {
    expect(inFrame(42, 8, 0)).not.toEqual(inFrame(42, 7, 0));
    expect(inFrame(43, 7, 0)).not.toEqual(inFrame(42, 7, 0));
  });

  it('is live outside a frame', () => {
    const s = ce._substream(7);
    const a = [s(), s(), s()];
    const t = ce._substream(7);
    expect([t(), t(), t()]).not.toEqual(a);
  });
});

//
// ─── monteCarloEstimate ─────────────────────────────────────────────────────
//

describe('monteCarloEstimate', () => {
  // Published through `src/numerics.ts`, so the sub-stream had to arrive as an
  // OPTIONAL trailing parameter. An external caller using the old signature
  // must be unaffected.
  it('the five-argument call still works and is stochastic', () => {
    const r = monteCarloEstimate((x: number) => x * x, 0, 1, 1e4);
    expect(r.estimate).toBeGreaterThan(0.25);
    expect(r.estimate).toBeLessThan(0.42);
  });

  /** A trivially reproducible draw source. */
  const mkDraw = (seed: number) => {
    let n = seed;
    return () => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return n / 2147483648;
    };
  };

  it('an explicit draw function makes it exactly reproducible', () => {
    const a = monteCarloEstimate((x) => x * x, 0, 1, 1e3, undefined, mkDraw(1));
    const b = monteCarloEstimate((x) => x * x, 0, 1, 1e3, undefined, mkDraw(1));
    expect(b).toEqual(a);
  });

  it('the 32-sample viability probe draws from the same source', () => {
    // The probe is part of the deterministic behavior: two runs over the same
    // sequence must consume it identically, probe included. Were the probe
    // still on `Math.random`, these two would diverge.
    const a = monteCarloEstimate((x) => x, 0, 1, 200, undefined, mkDraw(5));
    const b = monteCarloEstimate((x) => x, 0, 1, 200, undefined, mkDraw(5));
    expect(b).toEqual(a);
  });

  it('the sample count is deadline-dependent — which is why the frame is not charged', () => {
    // The decisive reason the estimator cannot draw from the frame directly:
    // the sampling loop consults the clock, so how many draws it makes is not
    // a property of the expression. Charging them to the frame would make a
    // seeded document stop replaying on a loaded machine.
    //
    // Counting the draws makes that concrete. With a generous budget the
    // estimator consumes thousands; with an already-expired deadline it gives
    // up before taking any sample at all (it throws rather than report an
    // estimate from nothing).
    let calls = 0;
    const counting = () => {
      calls++;
      return 0.5;
    };
    monteCarloEstimate((x) => x, 0, 1, 500, undefined, counting);
    expect(calls).toBeGreaterThan(500);

    calls = 0;
    expect(() =>
      monteCarloEstimate((x) => x, 0, 1, 1e9, Date.now() - 1, counting)
    ).toThrow();
    expect(calls).toBeLessThan(500);
  });
});

//
// ─── Wiring: the estimators actually ask the engine for a sub-stream ────────
//

describe('Integrate / NIntegrate derive a sub-stream', () => {
  it('Integrate asks for exactly one sub-stream', () => {
    const tags = tagsUsed((e) =>
      e.box(['WithRandomSeed', 1, ce.parse(CHEAP)]).N()
    );
    expect(tags).toHaveLength(1);
  });

  it('the tag is stable across evaluations of the same integral', () => {
    const once = tagsUsed((e) =>
      e.box(['WithRandomSeed', 1, ce.parse(CHEAP)]).N()
    );
    const twice = tagsUsed((e) =>
      e.box(['WithRandomSeed', 1, ce.parse(CHEAP)]).N()
    );
    expect(twice).toEqual(once);
  });

  it('the tag does not depend on the surrounding frame contents (Option A)', () => {
    // Reordering-insensitivity: the property the declined allocation-counter
    // option (Option B) would NOT have.
    const alone = tagsUsed((e) =>
      e.box(['WithRandomSeed', 1, ce.parse(CHEAP)]).N()
    );
    const padded = tagsUsed((e) =>
      e
        .box([
          'WithRandomSeed',
          1,
          ['List', ['Random'], ['Random'], ce.parse(CHEAP)],
        ])
        .N()
    );
    expect(padded).toEqual(alone);
  });

  it('the same integral twice in one frame uses the SAME tag', () => {
    const I = ce.parse(CHEAP);
    const tags = tagsUsed((e) =>
      e.box(['WithRandomSeed', 1, ['List', I, ['Random'], I]]).N()
    );
    expect(tags).toHaveLength(2);
    expect(tags[1]).toBe(tags[0]);
  });

  it('a different integrand gets a different tag', () => {
    const a = tagsUsed((e) =>
      e.box(['WithRandomSeed', 1, ce.parse(CHEAP)]).N()
    );
    const b = tagsUsed((e) =>
      e.box(['WithRandomSeed', 1, ce.parse(CHEAP2)]).N()
    );
    expect(b[0]).not.toBe(a[0]);
  });

  it('NIntegrate derives one too', () => {
    const tags = tagsUsed((e) =>
      e
        .box([
          'WithRandomSeed',
          1,
          [
            'NIntegrate',
            ['Function', ['Sqrt', ['Subtract', -1, 'x']], 'x'],
            0,
            1,
          ],
        ])
        .N()
    );
    expect(tags).toHaveLength(1);
  });
});

describe('An estimator consumes ZERO frame indices', () => {
  // THE property that proves the design. Routing the estimator's samples
  // through `ce._random()` — the one-line fix that was correct for
  // `RandomPrime` — fails exactly here.
  it('an integral between two draws does not disturb them', () => {
    const bare = res(
      ce.box(['WithRandomSeed', 5, ['List', ['Random'], ['Random']]]).N()
    );
    const withIntegral = res(
      ce
        .box([
          'WithRandomSeed',
          5,
          ['List', ['Random'], ce.parse(CHEAP), ['Random']],
        ])
        .N()
    );
    expect([withIntegral[0], withIntegral[2]]).toEqual(bare);
  });

  it('a stochastic equality probe does not disturb sibling draws', () => {
    const bare = res(
      ce.box(['WithRandomSeed', 6, ['List', ['Random'], ['Random']]]).N()
    );
    const probed = res(
      ce
        .box([
          'WithRandomSeed',
          6,
          [
            'List',
            ['Random'],
            ['Equal', ['Sin', ['Multiply', 2, 'x']], ['Multiply', 2, 'x']],
            ['Random'],
          ],
        ])
        .N()
    );
    expect([probed[0], probed[2]]).toEqual(bare);
  });
});

describe('stochasticEqual replays a seeded verdict', () => {
  const probe = (seed: number): string =>
    ce
      .box([
        'WithRandomSeed',
        seed,
        ['Equal', ['Sin', ['Multiply', 2, 'x']], ['Multiply', 2, 'x']],
      ])
      .evaluate()
      .toString();

  it('the same seed reproduces the verdict', () => {
    const a = probe(23);
    expect(probe(23)).toBe(a);
    expect(probe(23)).toBe(a);
  });
});

//
// ─── The full-cost witness, kept but not run ────────────────────────────────
//

describe('Real Monte-Carlo sampling replays (SLOW — skipped)', () => {
  // The end-to-end witness from §1 of the design doc, on a genuinely sampled
  // integral. Each evaluation is 2–4s (1e7 samples), so it is skipped to keep
  // this file inside its ~10s budget. Un-skip to verify by hand after touching
  // the estimator, the sub-stream primitive, or the tag derivation.
  it.skip('∫₀¹ sin(1/x) dx reproduces under one seed and differs under another', () => {
    const seeded = (seed: number): string =>
      ce
        .box(['WithRandomSeed', seed, ce.parse('\\int_0^1 \\sin(1/x) dx')])
        .N()
        .toString();
    const a = seeded(42);
    expect(seeded(42)).toBe(a);
    expect(seeded(7)).not.toBe(a);
  });
});

describe('A DEFERRED estimator keeps its seed frame', () => {
  // The mirror of §6's "an `Integrate` that completed owes nothing": one that
  // did NOT complete — a bound is still unbound — does owe the frame, because
  // its sub-stream is derived only when it finally runs. Stripping the frame
  // there converts a seeded estimate into a live one at exactly the moment the
  // caller cannot see it, the same failure `drawsRandom` prevents for `Random`
  // (Tycho item 104). Keyed on `readsRandomFrame`, NOT `drawsRandom`: the
  // estimator must keep consuming zero indices (pinned above).
  const deferred = () => {
    const e = new ComputeEngine();
    e.declare('n', 'number');
    return e.box([
      'WithRandomSeed',
      42,
      ['NIntegrate', ['Function', ['Multiply', 'x', 'x'], 'x'], 0, 'n'],
    ]);
  };

  // Two of these COMPLETE a Monte-Carlo estimate (1e7 samples), at ~0.5s and
  // ~1.1s. They were 22.7s and 49.6s until `numerics/random.ts` bound
  // `Math.imul` to a module-scope `imul` — see note 2b in the file header if
  // they ever regress to tens of seconds.

  it('stays whole rather than stripping the frame', () => {
    expect(deferred().evaluate().operator).toBe('WithRandomSeed');
  });

  it('completes to the same estimate on both routes', () => {
    // Route equality is THE property (§2's "same values" claim, applied to an
    // estimate rather than a draw): with the frame stripped, route A drifted
    // run to run while route B was stable, so one A-vs-B comparison catches it.
    const e = deferred();
    expect(e.evaluate().subs({ n: 1 }).N().toString()).toBe(
      e.subs({ n: 1 }).N().toString()
    );
  });

  it('a COMPLETED estimate still strips the frame (§6 unchanged)', () => {
    const e = new ComputeEngine();
    expect(
      e
        .box([
          'WithRandomSeed',
          42,
          ['NIntegrate', ['Function', ['Multiply', 'x', 'x'], 'x'], 0, 1],
        ])
        .evaluate().operator
    ).not.toBe('WithRandomSeed');
  });

  it('a user function reaching an estimator inherits the flag, and stays pure', () => {
    // `readsRandomFrame` does NOT imply impurity — a framed estimate is
    // reproducible, which is what `pure` claims.
    const e = new ComputeEngine();
    e.assign(
      'g',
      e.parse('u \\mapsto \\mathrm{NIntegrate}(x \\mapsto x^2, 0, u)')
    );
    const def = e.lookupDefinition('g')?.operator;
    expect(def?.readsRandomFrame).toBe(true);
    expect(def?.pure).toBe(true);
  });
});
