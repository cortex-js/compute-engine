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

/** Compile, refusing the interpreter fallback so a missing handler is loud.
 * Compile-time constant folding is off: a seeded `WithRandomSeed` frame has no
 * free variables, so folding would replace the whole frame with the value it
 * produces — correct, but it erases the emitted draws these tests inspect. */
function compiled(ce: ComputeEngine, json: any) {
  const r = compile(ce.box(json), { fallback: false, constantFold: false })!;
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
      .box(['Map', ['Function', ['N', ['Random']], 'i'], ['Range', 1, 150]])
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
      .box(['Map', ['Function', ['N', ['Random']], 'i'], ['Range', 1, 150]])
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

describe('an impure operand spliced by a multi-use template draws exactly once', () => {
  // Regression (2026-07-31): the `Mod`/`Remainder` templates splice their
  // compiled operands two or three times, and the GPU `Cot` splices its
  // operand into `cos(…)/sin(…)` — so a Random-family operand was re-drawn
  // at run time (`Remainder(Random(), 2)` consumed TWO draws, and on GPU
  // shifted every later `_gpu_rnd_draw` in the shader). Impure operands are
  // now bound to a temporary (IIFE on JS, hoisted statement on GPU); pure
  // operands keep the direct emission byte-identical.
  const ce = new ComputeEngine();

  test('JS: Remainder(Random(), 2) emits a single draw', () => {
    const r = compile(ce.box(['Remainder', ['Random'], 2]), {
      fallback: false,
    });
    expect((r.code!.match(/drawNextRandomNumber/g) ?? []).length).toBe(1);
    expect(typeof r.run!({})).toBe('number');
  });

  test('JS: Mod(10·Random(), 3) emits a single draw and stays in range', () => {
    const r = compile(ce.box(['Mod', ['Multiply', 10, ['Random']], 3]), {
      fallback: false,
    });
    expect((r.code!.match(/drawNextRandomNumber/g) ?? []).length).toBe(1);
    for (let i = 0; i < 20; i++) {
      const v = r.run!({}) as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
  });

  test('JS: pure operands keep the direct emission (byte-identical pins)', () => {
    expect(
      compile(ce.box(['Mod', ['Add', 'x', 29], 900]), { fallback: false })
        .code
    ).toBe('((((_.x + 29) % (900)) + (900)) % (900))');
    expect(
      compile(ce.box(['Remainder', 'x', 2]), { fallback: false }).code
    ).toBe('((_.x) - (2) * Math.round((_.x) / (2)))');
  });

  test('GLSL: Remainder(Random(), 2) hoists the draw to a single temporary', () => {
    const g = ce.getCompilationTarget('glsl')!;
    const r = g.compile(ce.box(['Remainder', ['Random'], 2]) as any);
    expect((r.code!.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
    expect(r.code).toContain('float _tv1 =');
  });

  test('GLSL: Cot(Random()) hoists the draw to a single temporary', () => {
    const g = ce.getCompilationTarget('glsl')!;
    const r = g.compile(ce.box(['Cot', ['Random']]) as any);
    expect((r.code!.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
  });

  test('GLSL: Cot of a COMPLEX impure operand hoists the draw too', () => {
    const g = ce.getCompilationTarget('glsl')!;
    const r = g.compile(
      ce.box(['Cot', ['Add', 'ImaginaryUnit', ['Random']]]) as any
    );
    expect((r.code!.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
  });

  test('GLSL: Coth and Beta hoist an impure operand too (same template class)', () => {
    const g = ce.getCompilationTarget('glsl')!;
    const coth = g.compile(ce.box(['Coth', ['Random']]) as any);
    expect((coth.code!.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
    const beta = g.compile(ce.box(['Beta', ['Random'], 2]) as any);
    expect((beta.code!.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
  });

  test('GLSL: pure operands keep the direct emission (byte-identical pins)', () => {
    const g = ce.getCompilationTarget('glsl')!;
    expect(g.compile(ce.box(['Cot', 'x']) as any).code).toBe(
      '(cos(x) / sin(x))'
    );
    expect(g.compile(ce.box(['Remainder', 'x', 2]) as any).code).toBe(
      '((x) - (2.0) * round((x) / (2.0)))'
    );
    expect(g.compile(ce.box(['Coth', 'x']) as any).code).toBe(
      '(cosh(x) / sinh(x))'
    );
    expect(g.compile(ce.box(['Beta', 'x', 2]) as any).code).toBe(
      '(_gpu_gamma(x) * _gpu_gamma(2.0) / _gpu_gamma(x + 2.0))'
    );
  });
});

describe('multi-splice × impure operand — the 2026-08-02 audit round', () => {
  // A second sweep of the same class as the `Mod`/`Remainder`/`Cot` round
  // above: a lowering that splices a compiled operand MORE than once (or
  // compiles it twice) re-evaluates an impure (Random-family) operand at run
  // time. Every site below drew more than once before the fix; each is now
  // purity-gated, so a PURE operand keeps its emission byte-identical (pinned
  // in the `…pure…` tests).
  const ce = new ComputeEngine();
  const glsl = () => ce.getCompilationTarget('glsl')!;
  const wgsl = () => ce.getCompilationTarget('wgsl')!;
  /** GLSL/WGSL source for `json`, unframed (fragment-stage spatial noise). */
  const gpuCode = (json: any, lang: 'glsl' | 'wgsl' = 'glsl'): string =>
    (lang === 'glsl' ? glsl() : wgsl()).compile(ce.box(json) as any, {
      // These tests pin emitted GPU source byte for byte (and count the draws
      // in it), so the constant operands and the seeded frames must survive
      // to code generation instead of being folded to a literal.
      constantFold: false,
    }).code ?? '';
  const gpuDraws = (json: any, lang: 'glsl' | 'wgsl' = 'glsl'): number =>
    (gpuCode(json, lang).match(/_gpu_rnd_draw/g) ?? []).length;
  const jsCode = (json: any): string =>
    compile(ce.box(json), {
      fallback: false,
      // These tests pin emitted JS source byte for byte (and count the draws
      // in it), so the constant operands and the seeded frames must survive
      // to code generation instead of being folded to a literal.
      constantFold: false,
    }).code ?? '';
  const jsDraws = (json: any): number =>
    (jsCode(json).match(/drawNextRandomNumber/g) ?? []).length;
  /** WGSL has no unframed draw — a seed frame is required there. */
  const framed = (body: any) => ['WithRandomSeed', 7, body];

  // --- JS: Equal (complex `part()` and the n-ary chain) --------------------

  test('JS: Equal over a COMPLEX impure operand draws once', () => {
    // `part()` splices the operand twice (`.re` and `.im`) — two draws before.
    const json = [
      'Equal',
      ['Multiply', ['Random'], 'ImaginaryUnit'],
      ['Complex', 0, 0.5],
    ];
    expect(jsDraws(json)).toBe(1);
    expect(typeof compile(ce.box(json), { fallback: false }).run!({})).toBe(
      'boolean'
    );
  });

  test('JS: Equal(0.1, Random(), 0.9) draws once (chained middle operand)', () => {
    const json = ['Equal', 0.1, ['Random'], 0.9];
    expect(jsDraws(json)).toBe(1);
    expect(typeof compile(ce.box(json), { fallback: false }).run!({})).toBe(
      'boolean'
    );
  });

  test('JS: Equal keeps the pure emission (byte-identical pins)', () => {
    expect(jsCode(['Equal', 0.1, 'x', 0.9])).toBe(
      '((Math.abs((0.1) - (_.x)) <= 1e-10) && (Math.abs((_.x) - (0.9)) <= 1e-10))'
    );
    expect(
      jsCode(['Equal', ['Multiply', 'x', 'ImaginaryUnit'], ['Complex', 0, 0.5]])
    ).toBe(
      '(_SYS.cabs({ re: ((() => { const _a = ({ re: 0, im: 1 }), _r = _.x; ' +
        'return { re: _a.re * _r, im: _a.im * _r }; })()).re - ' +
        '(({ re: 0, im: 0.5 })).re, im: ((() => { const _a = ({ re: 0, im: 1 }), ' +
        '_r = _.x; return { re: _a.re * _r, im: _a.im * _r }; })()).im - ' +
        '(({ re: 0, im: 0.5 })).im }) <= 1e-10)'
    );
  });

  // --- JS: Repeat ---------------------------------------------------------

  test('JS: Repeat(Random(), 3) draws ONCE and repeats the same value', () => {
    // The interpreter evaluates the value operand once and repeats the
    // resulting VALUE: `Repeat(Random(), 3)` is three copies of one draw. A
    // lowering that spliced the compiled value into a per-element callback
    // would draw three DIFFERENT numbers.
    const json = ['Repeat', ['Random'], 3];
    expect(jsDraws(json)).toBe(1);
    const v = compile(ce.box(json), { fallback: false }).run!({}) as number[];
    expect(v).toHaveLength(3);
    expect(v[1]).toBe(v[0]);
    expect(v[2]).toBe(v[0]);
    // Framed, element-for-element against the interpreter.
    const { compiled: c, interpreted: i } = bothEngines(ce, json, 42);
    expect(c).toEqual(i);
  });

  test('JS: Repeat draws its value even when the count is ≤ 0', () => {
    // Probed: the interpreter consumes exactly one draw for
    // `Repeat(Random(), 0)` and `Repeat(Random(), -1)` — the value is
    // evaluated before the count is consulted. Hoisting it into an IIFE
    // parameter (rather than the `Array.from` callback) preserves that.
    for (const n of [0, -1]) {
      const r = compiled(ce, ['Repeat', ['Random'], n]);
      expect(r.run!({})).toEqual([]);
      expect(trailingDraw(ce, 42, () => r.run!({}))).toBe(draw(42, 1));
    }
  });

  test('JS: Repeat keeps the pure emission (byte-identical pin)', () => {
    expect(jsCode(['Repeat', 7, 3])).toBe(
      '((_v, _n) => { _n = Math.round(_n); if (!(Number.isFinite(_n) && ' +
        '_n > 0)) return []; return Array.from({ length: _n }, () => _v); })(7, 3)'
    );
  });

  // --- GPU: Binomial ------------------------------------------------------

  test('GLSL/WGSL: Binomial(Random(), k) draws once (k splices)', () => {
    // The falling-factorial unroll splices the first operand k times.
    expect(gpuDraws(['Binomial', ['Random'], 2])).toBe(1);
    expect(gpuCode(['Binomial', ['Random'], 2])).toContain('float _tv1 =');
    expect(gpuDraws(['Binomial', ['Random'], 5])).toBe(1);
    expect(gpuDraws(framed(['Choose', ['Random'], 4]), 'wgsl')).toBe(1);
    expect(gpuCode(framed(['Choose', ['Random'], 4]), 'wgsl')).toContain(
      'var _tv1: f32 ='
    );
    // k = 1 splices the operand exactly once — no temporary needed.
    expect(gpuDraws(['Binomial', ['Random'], 1])).toBe(1);
    // k = 0 discards the operand, but the interpreter still draws — there is
    // no sink for a discarded draw in an expression, so it declines.
    expect(() => gpuCode(['Binomial', ['Random'], 0])).toThrow(
      /impure \(Random\) first operand/
    );
  });

  // --- JS: Range ----------------------------------------------------------

  test('JS: Range(Random(), 10, 2) draws once — not once per element', () => {
    // `start` and `step` were spliced twice, the second time INSIDE the
    // `Array.from` callback: the length came from one draw and every element
    // from another, so the elements were not even an arithmetic sequence.
    const json = ['Range', ['Random'], 10, 2];
    expect(jsDraws(json)).toBe(1);
    const v = compile(ce.box(json), { fallback: false }).run!({}) as number[];
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toBeGreaterThanOrEqual(0);
    expect(v[0]).toBeLessThan(1);
    for (let i = 1; i < v.length; i++)
      expect(v[i] - v[i - 1]).toBeCloseTo(2, 12);
  });

  test('JS: Range keeps the pure emission (byte-identical pins)', () => {
    expect(jsCode(['Range', 'a', 'b', 'c'])).toBe(
      'Array.from({length: Math.floor((_.b - _.a) / _.c) + 1}, (_e, i) => _.a + i * _.c)'
    );
    expect(jsCode(['Range', 1, 10, 2])).toBe(
      'Array.from({length: Math.floor((10 - 1) / 2) + 1}, (_e, i) => 1 + i * 2)'
    );
  });

  // --- GPU: Round, Root, Variance, Argument, Conjugate --------------------

  test('GLSL: Round hoists an impure operand (both forms)', () => {
    expect(gpuDraws(['Round', ['Random']])).toBe(1);
    expect(gpuDraws(['Round', ['Random'], 2])).toBe(1);
  });

  test('GLSL: Root of an impure operand at an odd degree draws once', () => {
    expect(gpuDraws(['Root', ['Random'], 3])).toBe(1);
  });

  test('GLSL: Variance draws exactly once PER ELEMENT (interpreter parity)', () => {
    // Each element was spliced 2 + 2·N times: twelve draws for two elements.
    expect(gpuDraws(['Variance', ['Random'], ['Random']])).toBe(2);
    expect(
      gpuDraws(['Variance', ['List', ['Random'], ['Random'], ['Random']]])
    ).toBe(3);
    // `Median` splices each element ONCE (sibling reduction, probed clean).
    expect(gpuDraws(['Median', ['Random'], ['Random'], ['Random']])).toBe(3);
  });

  test('GLSL: Argument/Conjugate of an impure COMPLEX operand draw once', () => {
    const z = ['Multiply', ['Random'], 'ImaginaryUnit'];
    expect(gpuDraws(['Argument', z])).toBe(1);
    expect(gpuCode(['Argument', z])).toContain('vec2 _tv1 =');
    expect(gpuDraws(['Conjugate', z])).toBe(1);
  });

  test('GLSL: an impure ContrastingColor operand fails closed (D6)', () => {
    // The three operands are `vec3`-shaped and each spliced twice — there is
    // no temporary to bind a color to, so this declines rather than re-draw.
    expect(() =>
      gpuCode([
        'ContrastingColor',
        ['Tuple', ['Random'], 1, 1],
        ['Tuple', 0, 0, 0],
        ['Tuple', 0.5, 0.1, 30],
      ])
    ).toThrow(/impure \(Random\) operand/);
  });

  test('GLSL: the element-wise selection mask draws a middle operand once', () => {
    expect(
      gpuDraws([
        'Which',
        ['Less', ['List', 0.1, 0.2], ['Random'], ['List', 0.9, 0.8]],
        ['List', 1, 2],
        'True',
        ['List', 3, 4],
      ])
    ).toBe(1);
  });

  test('GLSL: the complex Add fallback compiles each operand ONCE', () => {
    // `tryGetComplexParts` compiled every operand, then the whole
    // decomposition was discarded for the opaque-complex operand and the rest
    // were compiled again — leaving an ORPHANED hoisted draw feeding nothing.
    const code = gpuCode(framed(['Add', ['Cot', ['Random']], ['Sqrt', -2]]));
    expect((code.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
    // Every temporary declared is also USED (no orphan).
    for (const t of new Set(code.match(/_tv\d+/g) ?? []))
      expect((code.match(new RegExp(t, 'g')) ?? []).length).toBeGreaterThan(1);
  });

  test('GPU: pure operands keep the direct emission (byte-identical pins)', () => {
    expect(gpuCode(['Round', 'x'])).toBe('(sign(x) * floor(abs(x) + 0.5))');
    expect(gpuCode(['Round', 'x', 2])).toBe(
      '((sign((x * 100.0)) * floor(abs((x * 100.0)) + 0.5)) / 100.0)'
    );
    expect(gpuCode(['Root', 'x', 3])).toBe(
      '(sign(x) * pow(abs(x), 0.3333333333333333))'
    );
    expect(gpuCode(['Variance', 'x', 'y'])).toBe(
      '(((x - ((x + y) / 2.0)) * (x - ((x + y) / 2.0)) + ' +
        '(y - ((x + y) / 2.0)) * (y - ((x + y) / 2.0))) / 1.0)'
    );
    expect(gpuCode(['Argument', ['Complex', 'x', 'y']])).toBe(
      'atan(vec2(x, y).y, vec2(x, y).x)'
    );
    expect(gpuCode(['Conjugate', ['Complex', 'x', 'y']])).toBe(
      'vec2(vec2(x, y).x, -vec2(x, y).y)'
    );
    expect(
      gpuCode([
        'ContrastingColor',
        ['Tuple', 1, 1, 1],
        ['Tuple', 0, 0, 0],
        ['Tuple', 0.5, 0.1, 30],
      ])
    ).toBe(
      '(abs(_gpu_apca(vec3(1.0, 1.0, 1.0), vec3(0.0, 0.0, 0.0))) >= ' +
        'abs(_gpu_apca(vec3(1.0, 1.0, 1.0), vec3(0.5, 0.1, 30.0))) ? ' +
        'vec3(0.0, 0.0, 0.0) : vec3(0.5, 0.1, 30.0))'
    );
    expect(
      gpuCode([
        'Which',
        ['Less', ['List', 0.1, 0.2], 'x', ['List', 0.9, 0.8]],
        ['List', 1, 2],
        'True',
        ['List', 3, 4],
      ])
    ).toBe(
      'mix(vec2(3.0, 4.0), vec2(1.0, 2.0), bvec2(vec2(lessThan(vec2(0.1, 0.2), ' +
        'vec2(x))) * vec2(lessThan(vec2(x), vec2(0.9, 0.8)))))'
    );
    expect(gpuCode(['Add', 1, ['Sqrt', -2]])).toBe(
      'vec2(1.0, 0.0) + vec2(0.0, 1.4142135623730951)'
    );
    expect(gpuCode(['Add', 'x', 'ImaginaryUnit'])).toBe('vec2(x, 1.0)');
  });

  // --- shared templates: the relational chain and `Match` ------------------

  const matchJSON = (subject: any) => [
    'Match',
    subject,
    ['MatchCase', ['Alternatives', 1, 2], 10],
    ['MatchCase', 3, 30],
    ['MatchCase', '_', -1],
  ];

  test('GLSL: a chained relation draws its middle operand once', () => {
    // Two draws before: the two comparisons compared DIFFERENT values.
    expect(gpuDraws(['Less', 0.1, ['Random'], 0.9])).toBe(1);
    expect(gpuCode(['Less', 0.1, ['Random'], 0.9])).toContain('float _tv1 =');
  });

  test('WGSL: a chained relation draws its middle operand once', () => {
    expect(gpuDraws(framed(['Less', 0.1, ['Random'], 0.9]), 'wgsl')).toBe(1);
    expect(gpuCode(framed(['Less', 0.1, ['Random'], 0.9]), 'wgsl')).toContain(
      'var _tv1: f32 ='
    );
  });

  test('GLSL: a chained relation draws its operands in ARGUMENT order', () => {
    // Binding only the MIDDLE ran the middle's draw BEFORE the first operand's
    // (the hoisted temporary precedes the mask/comparison expression), so the
    // compiled chain compared the two draws in the wrong order. Both impure
    // operands are now hoisted, in argument order.
    const json = ['Less', ['Random'], ['Random'], 0.9];
    expect(gpuDraws(json)).toBe(2);
    const code = gpuCode(json);
    expect(code).toMatch(/_tv1 = _gpu_rnd_draw[\s\S]*_tv2 = _gpu_rnd_draw/);
    // The FIRST hoisted draw is the FIRST operand: it is the left side of the
    // first comparison.
    expect(code).toContain('(_tv1 < _tv2) && (_tv2 < 0.9)');
  });

  test('JS: a chained relation matches the interpreter (argument order)', () => {
    // Seed 7 separates the two orders: draw 0 < draw 1, so the interpreter's
    // `Less(d0, d1, 0.9)` is True while the swapped `Less(d1, d0, 0.9)` is
    // False.
    const json = ['Less', ['Random'], ['Random'], 0.9];
    expect(jsDraws(json)).toBe(2);
    expect(jsCode(json)).toBe(
      '((_tv1, _tv2) => (_tv1 < _tv2) && (_tv2 < 0.9))' +
        '(_SYS.drawNextRandomNumber(), _SYS.drawNextRandomNumber())'
    );
    const r = compiled(ce, json);
    const c = withRandomSeedFrame(ce, 7, () => r.run!({}));
    const i = withRandomSeedFrame(
      ce,
      7,
      () => ce.box(json).evaluate().symbol === 'True'
    );
    expect(draw(7, 0)).toBeLessThan(draw(7, 1));
    expect(c).toBe(i);
    expect(c).toBe(true);
  });

  test('GLSL: the selection mask draws its operands in ARGUMENT order', () => {
    // Same defect on the element-wise (`Which`) path: only an impure MIDDLE
    // went through `gpuOperandOnce`, so an impure ENDPOINT stayed inline in
    // the mask and drew AFTER the hoisted middle.
    const json = [
      'Which',
      ['Less', ['Random'], ['Random'], ['List', 0.9, 0.8]],
      ['List', 1, 2],
      'True',
      ['List', 3, 4],
    ];
    expect(gpuDraws(json)).toBe(2);
    const code = gpuCode(json);
    expect(code).toMatch(/_tv1 = _gpu_rnd_draw[\s\S]*_tv2 = _gpu_rnd_draw/);
    expect(code).toContain('lessThan(vec2(_tv1), vec2(_tv2))');
  });

  test('GLSL/WGSL: an impure Match subject draws once', () => {
    // The subject is spliced once per leaf comparison — three draws before.
    expect(gpuDraws(matchJSON(['Random']))).toBe(1);
    expect(gpuCode(matchJSON(['Random']))).toContain('float _tv1 =');
    expect(gpuDraws(framed(matchJSON(['Random'])), 'wgsl')).toBe(1);
    expect(gpuCode(framed(matchJSON(['Random'])), 'wgsl')).toContain(
      'var _tv1: f32 ='
    );
    // A RANGE pattern splices the subject twice in one comparison.
    expect(
      gpuDraws([
        'Match',
        ['Random'],
        ['MatchCase', ['Range', 1, 5], 10],
        ['MatchCase', '_', -1],
      ])
    ).toBe(1);
  });

  test('chain/Match keep the pure emission (byte-identical pins)', () => {
    expect(gpuCode(['Less', 0.1, 'x', 0.9])).toBe('(0.1 < x) && (x < 0.9)');
    expect(gpuCode(['Less', 0.1, ['Add', 'x', 1], 0.9], 'wgsl')).toBe(
      '(0.1 < x + 1.0) && (x + 1.0 < 0.9)'
    );
    expect(gpuCode(matchJSON('x'))).toBe(
      '(((x == 1.0 || x == 2.0)) ? (10.0) : (((x == 3.0) ? (30.0) : (-1.0))))'
    );
    expect(gpuCode(matchJSON('x'), 'wgsl')).toBe(
      'select(select(-1.0, 30.0, x == 3.0), 10.0, (x == 1.0 || x == 2.0))'
    );
    // The JS chain (a `bindExpr` target) is untouched by the GPU arm.
    expect(jsCode(['Less', 0.1, ['Add', 'x', 1], 0.9])).toBe(
      '((_tv1) => (0.1 < _tv1) && (_tv1 < 0.9))(_.x + 1)'
    );
  });
});
