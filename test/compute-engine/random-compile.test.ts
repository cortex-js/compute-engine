import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

/**
 * Interpreted/compiled parity for the random family (Phase 3 of the
 * 2026-07-25 Random family redesign, `docs/plans/…-random-signature-redesign.md`
 * §7 and the compile half of §8).
 *
 * These tests do the job the DELETED auto-compile eligibility gate used to do
 * (§6). With no purity backstop, a compile handler whose semantics diverge
 * from the interpreter's reaches auto-compiled `Map` bodies silently — so
 * every random handler is covered here, and covered on TWO axes:
 *
 * - **values**, element by element against the interpreter under one seed; and
 * - **draw consumption**, by a trailing `Random()` inside the same frame. A
 *   handler can return correct output while leaving the frame's shared counter
 *   in the wrong place, which no result-only assertion can see.
 *
 * The unseeded arm is exempt by design: outside a frame both engines call
 * `Math.random()` and there is no determinism to preserve.
 */

/** The expected n-th draw of a frame seeded `seed`. */
function draw(seed: number | string, n: number): number {
  const [seedLo, seedHi] = foldSeed(seed);
  return frameDraw(seedLo, seedHi, n);
}

/** Compile, refusing the interpreter fallback so a missing handler is loud. */
function compiled(ce: ComputeEngine, json: any) {
  const r = compile(ce.box(json), { fallback: false })!;
  expect(r.success).toBe(true);
  return r;
}

/** The compiled and interpreted values of `json`, each under a fresh frame
 * seeded `seed`, flattened to plain numbers. */
function bothEngines(
  ce: ComputeEngine,
  json: any,
  seed: number | string
): { compiled: unknown; interpreted: unknown } {
  const r = compiled(ce, json);
  const c = withRandomSeedFrame(ce, seed, () => r.run!());
  const i = withRandomSeedFrame(ce, seed, () => {
    const v = ce.box(json).evaluate();
    return v.ops && v.operator === 'List' ? v.ops.map((x) => x.re) : v.re;
  });
  return { compiled: c, interpreted: i };
}

/** The index of the frame's next draw after running `fn` inside it. */
function trailingDraw(ce: ComputeEngine, seed: number, fn: () => void): number {
  return withRandomSeedFrame(ce, seed, () => {
    fn();
    return ce._random();
  });
}

describe('compiled Random — framed bit-parity', () => {
  it('the no-arg form matches the interpreter and consumes exactly 1 index', () => {
    const ce = new ComputeEngine();
    const { compiled: c, interpreted: i } = bothEngines(ce, ['Random'], 42);
    expect(c).toBe(i);
    expect(c).toBe(draw(42, 0));

    const r = compiled(ce, ['Random']);
    expect(trailingDraw(ce, 42, () => r.run!())).toBe(draw(42, 1));
  });

  it('repeated draws in one frame DIFFER and the frame replays', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, ['List', ['Random'], ['Random']]);
    const a = withRandomSeedFrame(ce, 42, () => r.run!()) as number[];
    expect(a[0]).not.toBe(a[1]);
    expect(a).toEqual([draw(42, 0), draw(42, 1)]);
    expect(withRandomSeedFrame(ce, 42, () => r.run!())).toEqual(a);
  });

  it('a literal Interval domain inlines the closed form and matches', () => {
    const ce = new ComputeEngine();
    const json = ['Random', ['Interval', -5, -1]];
    const r = compiled(ce, json);
    // Endpoints inlined: no descriptor object, no compiled collection.
    expect(r.code).not.toContain('_SYS.domain');
    expect(r.code).toContain('_SYS.drawNextRandomNumber()');
    const { compiled: c, interpreted: i } = bothEngines(ce, json, 3);
    expect(c).toBe(i);
    expect(c).toBe(-5 + draw(3, 0) * 4);
    expect(trailingDraw(ce, 3, () => r.run!())).toBe(draw(3, 1));
  });

  it('a symbolic Interval domain degenerates to a runtime descriptor and matches', () => {
    const ce = new ComputeEngine();
    ce.declare('lo', 'real');
    ce.declare('hi', 'real');
    const r = compiled(ce, ['Random', ['Interval', 'lo', 'hi']]);
    expect(r.code).toContain('_SYS.domainInterval');
    expect(withRandomSeedFrame(ce, 3, () => r.run!({ lo: -5, hi: -1 }))).toBe(
      -5 + draw(3, 0) * 4
    );
    // An unbounded or empty interval throws rather than drawing a NaN.
    expect(() => r.run!({ lo: 1, hi: 1 })).toThrow(/Random/);
    expect(() => r.run!({ lo: 0, hi: Infinity })).toThrow(/Random/);
  });

  it('a literal Range domain folds its normalized parameters and matches', () => {
    const ce = new ComputeEngine();
    for (const range of [
      ['Range', 1, 6],
      ['Range', 7, 2], // descending
      ['Range', 1, 10, 2], // odd values only
    ]) {
      const { compiled: c, interpreted: i } = bothEngines(
        ce,
        ['Random', range],
        11
      );
      expect([range, c]).toEqual([range, i]);
    }
    const r = compiled(ce, ['Random', ['Range', 1, 6]]);
    expect(r.code).not.toContain('Array.from');
    expect(trailingDraw(ce, 11, () => r.run!())).toBe(draw(11, 1));
  });

  it('a huge Range is never expanded (one draw, no materialization)', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, ['Random', ['Range', 1, 1000000]]);
    expect(r.code).not.toContain('Array.from');
    const { compiled: c, interpreted: i } = bothEngines(
      ce,
      ['Random', ['Range', 1, 1000000]],
      5
    );
    expect(c).toBe(i);
  });

  it('a literal list domain matches the interpreter', () => {
    const ce = new ComputeEngine();
    const { compiled: c, interpreted: i } = bothEngines(
      ce,
      ['Random', ['List', 10, 20, 30]],
      8
    );
    expect(c).toBe(i);
  });
});

describe('compiled Random — degenerate domains throw', () => {
  it('a symbolic Range that is empty at run time throws, never NaN', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const r = compiled(ce, ['Random', ['Range', 1, 'n', 1]]);
    for (const n of [0, -1, -5]) {
      expect(() => r.run!({ n })).toThrow(/Random/);
      // …and the interpreter refuses the same domains.
      const v = ce.box(['Random', ['Range', 1, n, 1]]).evaluate();
      expect(v.operator).toBe('Error');
    }
    expect(Number.isNaN(r.run!({ n: 6 }) as number)).toBe(false);
  });

  it('a two-operand `Range(1, n)` with n <= 0 DESCENDS in both engines', () => {
    // Not a degenerate case: `range()` infers a descending step, so
    // `Range(1, 0)` is the two-element range [1, 0] — interpreted AND
    // compiled. (The spec's §7 prose calls this the throwing case; the
    // normalization rule it cites in §4 says otherwise, and parity with the
    // interpreter is the governing contract.)
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const r = compiled(ce, ['Random', ['Range', 1, 'n']]);
    const c = withRandomSeedFrame(ce, 4, () => r.run!({ n: 0 }));
    const i = withRandomSeedFrame(
      ce,
      4,
      () => ce.box(['Random', ['Range', 1, 0]]).evaluate().re
    );
    expect(c).toBe(i);
    expect([0, 1]).toContain(c);
  });

  it('a literal empty/unbounded domain fails closed at compile time', () => {
    const ce = new ComputeEngine();
    const js = new JavaScriptTarget();
    for (const domain of [
      ['Interval', 1, 1],
      ['Interval', 1, 0],
      ['Range', 5, 1, 1],
    ])
      expect(() => js.compile(ce.box(['Random', domain]))).toThrow(
        /Fail closed/
      );
  });
});

describe('compiled RandomSample — framed bit-parity', () => {
  it('matches the interpreter element by element over a Range', () => {
    const ce = new ComputeEngine();
    const json = ['RandomSample', ['Range', 1, 1000], 6];
    const { compiled: c, interpreted: i } = bothEngines(ce, json, 42);
    expect(c).toEqual(i);
  });

  it('matches the interpreter over a literal list', () => {
    const ce = new ComputeEngine();
    const json = ['RandomSample', ['List', 5, 6, 7, 8, 9], 5];
    const { compiled: c, interpreted: i } = bothEngines(ce, json, 13);
    expect(c).toEqual(i);
    // k = n is a permutation: every position drawn exactly once.
    expect([...(c as number[])].sort()).toEqual([5, 6, 7, 8, 9]);
  });

  it('consumes exactly k draw indices', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, ['RandomSample', ['Range', 1, 1000], 6]);
    expect(trailingDraw(ce, 42, () => r.run!())).toBe(draw(42, 6));
  });

  it('never materializes a large domain (sparse Fisher-Yates)', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, ['RandomSample', ['Range', 1, 1000000], 3]);
    expect(r.code).not.toContain('Array.from');
    expect(r.code).toContain('_SYS.domainRange');
    const t = Date.now();
    const v = withRandomSeedFrame(ce, 1, () => r.run!() as number[]);
    expect(Date.now() - t).toBeLessThan(200);
    expect(v).toHaveLength(3);
  });

  it('rejects k > n, like the interpreter (the twin difference)', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'number');
    const r = compiled(ce, ['RandomSample', ['List', 1, 2, 3], 'k']);
    expect(() => r.run!({ k: 4 })).toThrow(/RandomSample/);
    expect(
      ce.box(['RandomSample', ['List', 1, 2, 3], 4]).evaluate().operator
    ).toBe('Error');
    // …while `RandomChoice` accepts it (replacement).
    const rc = compiled(ce, ['RandomChoice', ['List', 1, 2, 3], 'k']);
    expect(rc.run!({ k: 4 })).toHaveLength(4);
  });
});

describe('compiled RandomShuffle — framed bit-parity', () => {
  it('matches the interpreter permutation over a literal list', () => {
    const ce = new ComputeEngine();
    const json = ['RandomShuffle', ['List', 1, 2, 3, 4, 5, 6, 7]];
    const { compiled: c, interpreted: i } = bothEngines(ce, json, 42);
    expect(c).toEqual(i);
  });

  it('matches the interpreter permutation over a Range', () => {
    const ce = new ComputeEngine();
    const json = ['RandomShuffle', ['Range', 1, 8]];
    const { compiled: c, interpreted: i } = bothEngines(ce, json, 9);
    expect(c).toEqual(i);
  });

  it('consumes exactly n - 1 draw indices', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, ['RandomShuffle', ['List', 1, 2, 3, 4, 5, 6, 7]]);
    expect(trailingDraw(ce, 42, () => r.run!())).toBe(draw(42, 6));
  });
});

describe('compiled RandomChoice — framed bit-parity', () => {
  // The domain matrix and the `k` table live in
  // `tycho-item-80-randomlist-compile.test.ts`; this pins the parity row.
  it('matches the interpreter element by element', () => {
    const ce = new ComputeEngine();
    for (const domain of [
      ['Range', 1, 6],
      ['Interval', 0, 1],
      ['List', 10, 20, 30],
    ]) {
      const json = ['RandomChoice', domain, 7];
      const { compiled: c, interpreted: i } = bothEngines(ce, json, 42);
      expect([domain, c]).toEqual([domain, i]);
    }
  });
});

describe('compiled draws are decided at CALL time, never at compile time', () => {
  // A compiler that resolved the framed/unframed branch at compile time passes
  // every other test in this file and fails this one.
  it('one artifact compiled with NO frame active is live unframed and deterministic framed', () => {
    const ce = new ComputeEngine();
    expect(ce._randomFrame).toBeUndefined();
    const f = compiled(ce, ['Add', ['Random'], ['Random']]);
    expect(f.code).toContain('_SYS.drawNextRandomNumber()');
    expect(f.code).not.toContain('Math.random()');

    // (a) unframed → nondeterministic.
    const live = new Set<number>();
    for (let i = 0; i < 20; i++) live.add(f.run!() as number);
    expect(live.size).toBeGreaterThan(1);

    // (b) from inside an interpreted frame → deterministic, matching the
    // interpreter, and the frame's counter advances.
    const framed = withRandomSeedFrame(ce, 42, () => f.run!());
    expect(framed).toBe(draw(42, 0) + draw(42, 1));
    expect(withRandomSeedFrame(ce, 42, () => f.run!())).toBe(framed);
    expect(
      withRandomSeedFrame(ce, 42, () => {
        f.run!();
        return ce._random();
      })
    ).toBe(draw(42, 2));

    // (c) and unframed again afterwards.
    expect(ce._randomFrame).toBeUndefined();
    expect(f.run!()).not.toBe(framed);
  });

  it('the unseeded arm is exempt from parity (two unframed calls differ)', () => {
    const ce = new ComputeEngine();
    const f = compiled(ce, ['Random']);
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) values.add(f.run!() as number);
    expect(values.size).toBeGreaterThan(1);
    // The interpreter is equally nondeterministic — there is no claim to break.
    const iv = new Set<number>();
    for (let i = 0; i < 20; i++) iv.add(ce.box(['Random']).evaluate().re);
    expect(iv.size).toBeGreaterThan(1);
  });

  it('frames are per ENGINE: engine B evaluating cannot seed engine A artifact', () => {
    const a = new ComputeEngine();
    const b = new ComputeEngine();
    const f = compiled(a, ['Random']);
    const values = new Set<number>();
    withRandomSeedFrame(b, 42, () => {
      for (let i = 0; i < 20; i++) values.add(f.run!() as number);
    });
    // A's artifact reads A's (empty) stack: live draws, not B's frame.
    expect(values.size).toBeGreaterThan(1);
    expect(values.has(draw(42, 0))).toBe(false);
  });
});

describe('compiled WithRandomSeed', () => {
  it('seeds a compiled body, matching the interpreter', () => {
    const ce = new ComputeEngine();
    const json = [
      'WithRandomSeed',
      42,
      ['List', ['Random'], ['Random'], ['Random']],
    ];
    const r = compiled(ce, json);
    expect(r.code).toContain('_SYS.withRandomSeed(42');
    const c = r.run!() as number[];
    expect(c).toEqual([0, 1, 2].map((n) => draw(42, n)));
    expect(c).toEqual(
      ce
        .box(json)
        .evaluate()
        .ops!.map((x) => x.re)
    );
    expect(r.run!()).toEqual(c); // replays
  });

  it('accepts a string seed', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, ['WithRandomSeed', { str: 'cell-a7' }, ['Random']]);
    expect(r.run!()).toBe(draw('cell-a7', 0));
  });

  it('evaluates the seed expression ONCE per frame entry', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    const r = compiled(ce, [
      'WithRandomSeed',
      ['Add', 's', 1],
      ['List', ['Random'], ['Random']],
    ]);
    expect(r.run!({ s: 41 })).toEqual([draw(42, 0), draw(42, 1)]);
  });

  it('nests, innermost winning, without perturbing the outer counter', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, [
      'WithRandomSeed',
      1,
      ['List', ['Random'], ['WithRandomSeed', 2, ['Random']], ['Random']],
    ]);
    expect(r.run!()).toEqual([draw(1, 0), draw(2, 0), draw(1, 1)]);
  });

  it('a compiled frame reaches draws inside compiled user-function calls', () => {
    // §4 case 3: a fully compiled frame whose draws happen across compiled
    // call boundaries. Nothing is threaded through the call signature — the
    // callee reads the frame off the engine, which is what dynamic scoping
    // requires and what keeps compiled arity unchanged.
    const ce = new ComputeEngine();
    ce.box(['Assign', 'gDraw', ['Function', ['Random'], 'x']]).evaluate();
    const r = compiled(ce, [
      'WithRandomSeed',
      7,
      ['Add', ['gDraw', 0], ['gDraw', 0]],
    ]);
    expect(r.code).toContain('_SYS.withRandomSeed(7');
    expect(r.run!()).toBe(draw(7, 0) + draw(7, 1));
    expect(r.run!()).toBe(draw(7, 0) + draw(7, 1)); // replays
  });

  it('a throwing body does NOT leak the frame (prologue/finally)', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'number');
    const r = compiled(ce, [
      'WithRandomSeed',
      5,
      ['RandomSample', ['List', 1, 2, 3], 'k'],
    ]);
    expect(() => r.run!({ k: 99 })).toThrow(/RandomSample/);
    expect(ce._randomFrame).toBeUndefined();
    // A draw afterwards is live again.
    const f = compiled(ce, ['Random']);
    expect(f.run!()).not.toBe(f.run!());
  });

  it('rejects a runtime seed that is not a finite real or a string', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    const r = compiled(ce, ['WithRandomSeed', 's', ['Random']]);
    expect(() => r.run!({ s: Number.NaN })).toThrow(/WithRandomSeed/);
    expect(() => r.run!({ s: Infinity })).toThrow(/WithRandomSeed/);
  });
});

describe('auto-compiled Map bodies draw from the interpreter frame (§6)', () => {
  it('a Map body containing a framed draw COMPILES and matches the interpreter', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.jit = 'auto';
    const m = ce
      .box(['Map', ['Range', 1, 150], ['Function', ['N', ['Random']], 'i']])
      .evaluate();
    expect(m.operator).toBe('Map');

    // The drain happens INSIDE the frame, so the compiled elements read it.
    _resetMapAutoCompileStats();
    const c = withRandomSeedFrame(ce, 11, () =>
      [...m.N().each()].map((x) => x.re)
    );
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(150); // the §6 requirement
    expect(c.slice(0, 3)).toEqual([0, 1, 2].map((n) => draw(11, n)));

    // Element by element against the interpreter, and the same number of
    // indices consumed.
    ce.jit = 'off';
    const m2 = ce
      .box(['Map', ['Range', 1, 150], ['Function', ['N', ['Random']], 'i']])
      .evaluate();
    _resetMapAutoCompileStats();
    const probe = withRandomSeedFrame(ce, 11, () => {
      const v = [...m2.N().each()].map((x) => x.re);
      return { v, trailing: ce._random() };
    });
    ce.jit = 'auto';
    expect(stats.compiledHits).toBe(0);
    expect(probe.v).toEqual(c);
    expect(probe.trailing).toBe(draw(11, 150));
  });
});
