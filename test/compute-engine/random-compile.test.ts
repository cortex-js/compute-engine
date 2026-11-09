import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { reachesCallerCode } from '../../src/compute-engine/compilation/compile-folding';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

/**
 * Interpreted/compiled parity for the random family
 * (`docs/RANDOMNESS-MODEL.md`).
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
        /Could not compile/
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
    // The generated source is the whole proof, and it is deterministic: an
    // `Array.from` over the domain is what a million-element materialization
    // would look like, and `_SYS.domainRange` is the sparse descriptor that
    // replaces it. Timing the run added nothing the source inspection does not
    // already establish, while making the verdict depend on machine load.
    expect(r.code).not.toContain('Array.from');
    expect(r.code).toContain('_SYS.domainRange');
    const v = withRandomSeedFrame(ce, 1, () => r.run!() as number[]);
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

  it('a STRING domain compiles to the same string as the interpreter', () => {
    // Ruled 2026-09-22: choosing from a string yields a string (the
    // string-preservation rule, `docs/STRING_ROADMAP.md`). The compiled
    // artifact segments the source into characters, draws from them and
    // re-joins, so it must answer the same string as the interpreter and
    // leave the frame's counter in the same place.
    const ce = new ComputeEngine();
    const json = ['RandomChoice', { str: 'abcdef' }, 7];
    const r = compiled(ce, json);
    const c = withRandomSeedFrame(ce, 11, () => r.run!());
    const i = withRandomSeedFrame(ce, 11, () => ce.box(json).evaluate().string);
    expect(typeof c).toBe('string');
    expect(c).toBe(i);
    // Exactly 7 draws, as over a list of the same characters.
    expect(trailingDraw(ce, 11, () => r.run!())).toBe(draw(11, 7));
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
    // The frame reads no per-call value, so it is emitted as a preamble
    // local computed once per artifact (see the describe block below).
    expect(r.preambleOnce).toContain('_SYS.withRandomSeed(42');
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

describe('a seeded draw that reads no per-call value is computed once per artifact', () => {
  // A `WithRandomSeed` frame whose seed and body read no input is a pure
  // function of its seed: every draw inside it is the hash of the seed and
  // the draw's position. It was drawn again on every call of the compiled
  // function: indexing one cell of `RandomChoice([0, 1], 6561)` per sample
  // cost over 100 times a `sin` call. It is now a preamble local the runner
  // builds once, computed on first use (`BaseCompiler.hoistSeededDraw`).
  // Provenance: Tycho ledger row 399.

  /** Count the engine draws (framed or live) made while `fn` runs. */
  function countDraws(ce: ComputeEngine, fn: () => void): number {
    const original = ce._random;
    let count = 0;
    ce._random = function (this: ComputeEngine) {
      count += 1;
      return original.call(this);
    };
    try {
      fn();
    } finally {
      ce._random = original;
    }
    return count;
  }

  const BIG_DRAW = [
    'WithRandomSeed',
    191268,
    ['RandomChoice', ['List', 0, 1], 6561],
  ];

  it('the draw indexed by `At` lands in `preambleOnce` and matches the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('theta', 'real');
    ce.declare('phi', 'real');
    const r = compiled(ce, [
      'At',
      BIG_DRAW,
      ['Add', ['Multiply', 9, 'theta'], ['Multiply', 8, 'phi']],
    ]);
    expect(r.code).toBe('_SYS.at(_rnd_1(), 8 * _.phi + 9 * _.theta)');
    expect(r.preambleOnce).toContain('const _rnd_1 = ');
    expect(r.preambleOnce).toContain('_SYS.withRandomSeed(191268, ');
    expect(r.preamblePerCall).toBeUndefined();
    const interpreted = ce.box(BIG_DRAW).evaluate();
    for (const [theta, phi] of [
      [1, 2],
      [3, 0],
      [100, 400],
    ]) {
      const k = 9 * theta + 8 * phi;
      const expected = interpreted.ops![k - 1].re;
      expect(r.run!({ theta, phi })).toBe(expected);
      expect(r.run!({ theta, phi })).toBe(expected);
    }
  });

  it('draws on the first call only', () => {
    const ce = new ComputeEngine();
    ce.declare('i', 'integer');
    const r = compiled(ce, [
      'At',
      ['WithRandomSeed', 5, ['List', ['Random'], ['Random'], ['Random']]],
      'i',
    ]);
    expect(countDraws(ce, () => r.run!({ i: 1 }))).toBe(3);
    expect(
      countDraws(ce, () => {
        for (let i = 1; i <= 30; i++) r.run!({ i: 1 + (i % 3) });
      })
    ).toBe(0);
    expect(r.run!({ i: 2 })).toBe(draw(5, 1));
  });

  it('the lambda route builds the draw once too', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, [
      'Function',
      [
        'At',
        ['WithRandomSeed', 5, ['List', ['Random'], ['Random'], ['Random']]],
        'n',
      ],
      'n',
    ]);
    expect(r.preambleOnce).toContain('_SYS.withRandomSeed(5, ');
    const f = r.run as unknown as (n: number) => number;
    expect(countDraws(ce, () => f(3))).toBe(3);
    expect(countDraws(ce, () => f(1) + f(2))).toBe(0);
    expect(f(3)).toBe(draw(5, 2));
  });

  it('a seed that reads an input keeps the draw per call', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    const r = compiled(ce, [
      'WithRandomSeed',
      's',
      ['List', ['Random'], ['Random'], ['Random']],
    ]);
    expect(r.code).toContain('_SYS.withRandomSeed(_.s, ');
    expect(r.code).not.toContain('_rnd_');
    expect(r.preambleOnce).toBeUndefined();
    expect(countDraws(ce, () => r.run!({ s: 1 }))).toBe(3);
    expect(countDraws(ce, () => r.run!({ s: 1 }))).toBe(3);
    expect(r.run!({ s: 2 })).toEqual([0, 1, 2].map((n) => draw(2, n)));
  });

  it('a body that reads an input keeps the draw per call', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    const r = compiled(ce, [
      'WithRandomSeed',
      4,
      ['Multiply', 's', ['Random']],
    ]);
    expect(r.code).toContain('_SYS.withRandomSeed(4, ');
    expect(r.code).not.toContain('_rnd_');
    expect(r.preambleOnce).toBeUndefined();
    expect(countDraws(ce, () => r.run!({ s: 2 }))).toBe(1);
    expect(r.run!({ s: 3 })).toBe(3 * draw(4, 0));
  });

  it('a seed that draws keeps the frame per call', () => {
    // The seed `Random()` takes a fresh ambient draw on each call, so the
    // frame it seeds gives a different value on each call.
    const ce = new ComputeEngine();
    const r = compiled(ce, [
      'WithRandomSeed',
      ['Random'],
      ['RandomChoice', ['List', 0, 1], 3],
    ]);
    expect(r.code).toContain('_SYS.withRandomSeed(');
    expect(r.code).not.toContain('_rnd_');
    expect(r.preambleOnce).toBeUndefined();
    const values = new Set<string>();
    for (let i = 0; i < 20; i++) values.add(JSON.stringify(r.run!()));
    expect(values.size).toBeGreaterThan(1);
  });

  it('a refused hoist leaves no dead seeded-draw local', () => {
    // The outer frame calls a user function, so it stays per call. The
    // inner frame is hoisted. The trial compilation of the outer frame
    // hoisted the inner one too; that definition is removed when the trial
    // is refused, so the preamble holds one `_rnd_` local, the one the code
    // reads.
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x+1'));
    const r = compiled(ce, [
      'WithRandomSeed',
      1,
      ['List', ['f', 1], ['WithRandomSeed', 2, ['Random']]],
    ]);
    expect(r.code).toBe('_SYS.withRandomSeed(1, () => [_fn_f(1), _rnd_1()])');
    expect(r.preamble!.match(/const _rnd_\d+ =/g)).toEqual(['const _rnd_1 =']);
    expect(r.run!()).toEqual([2, draw(2, 0)]);
  });

  it('a body that reads a binder index keeps the draw per iteration', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, [
      'Sum',
      ['WithRandomSeed', 'k', ['Random']],
      ['Limits', 'k', 1, 3],
    ]);
    expect(r.code).not.toContain('_rnd_');
    expect(r.run!()).toBeCloseTo(draw(1, 0) + draw(2, 0) + draw(3, 0), 12);
  });

  it('an unseeded draw stays per call', () => {
    const ce = new ComputeEngine();
    const r = compiled(ce, ['RandomChoice', ['List', 0, 1], 3]);
    expect(r.code).not.toContain('_rnd_');
    expect(r.preambleOnce).toBeUndefined();
    expect(countDraws(ce, () => r.run!())).toBe(3);
    expect(countDraws(ce, () => r.run!())).toBe(3);
    const values = new Set<string>();
    for (let i = 0; i < 20; i++) values.add(JSON.stringify(r.run!()));
    expect(values.size).toBeGreaterThan(1);
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
  // at run time (`Remainder(Random(), 2)` consumed TWO draws). Impure
  // operands are now bound to a temporary (an IIFE on JS); pure operands
  // keep the direct emission byte-identical. The GLSL fragment has no
  // `Random`, so GLSL declines these.
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
      compile(ce.box(['Mod', ['Add', 'x', 29], 900]), { fallback: false }).code
    ).toBe('_SYS.floorMod(_.x + 29, 900)');
    // `Remainder` is a call of the runtime helper, which refuses an operand
    // beyond the safe integer range (`integerOperand`).
    expect(
      compile(ce.box(['Remainder', 'x', 2]), { fallback: false }).code
    ).toBe('_SYS.remainder(_.x, 2)');
  });

  test('GLSL: Remainder(Random(), 2) hoists the draw to a single temporary', () => {
    const g = ce._getCompilationTarget('glsl')!;
    // The GLSL fragment refuses `Random`, so the compilation declines.
    expect(() => g.compile(ce.box(['Remainder', ['Random'], 2]) as any)).toThrow(
      /The head `Random` is outside the GLSL fragment/
    );
  });

  test('GLSL: Cot(Random()) hoists the draw to a single temporary', () => {
    const g = ce._getCompilationTarget('glsl')!;
    // The GLSL fragment refuses `Random`, so the compilation declines.
    expect(() => g.compile(ce.box(['Cot', ['Random']]) as any)).toThrow(
      /The head `Random` is outside the GLSL fragment/
    );
  });

  test('GLSL: Cot of a COMPLEX impure operand hoists the draw too', () => {
    const g = ce._getCompilationTarget('glsl')!;
    // The GLSL fragment refuses `Random`, so the compilation declines.
    expect(() =>
      g.compile(ce.box(['Cot', ['Add', 'ImaginaryUnit', ['Random']]]) as any)
    ).toThrow(/The head `Random` is outside the GLSL fragment/);
  });

  test('GLSL: Coth and Beta hoist an impure operand too (same template class)', () => {
    const g = ce._getCompilationTarget('glsl')!;
    // The GLSL fragment refuses `Random`, so the compilation declines.
    expect(() => g.compile(ce.box(['Coth', ['Random']]) as any)).toThrow(
      /The head `Random` is outside the GLSL fragment/
    );
    expect(() => g.compile(ce.box(['Beta', ['Random'], 2]) as any)).toThrow(
      /The head `Random` is outside the GLSL fragment/
    );
  });

  test('GLSL: pure operands keep the direct emission (byte-identical pins)', () => {
    const g = ce._getCompilationTarget('glsl')!;
    expect(g.compile(ce.box(['Cot', 'x']) as any).code).toBe(
      '(_gpu_cos(x) / _gpu_sin(x))'
    );
    expect(g.compile(ce.box(['Remainder', 'x', 2]) as any).code).toBe(
      '((x) - (2.0) * _gpu_round_up((x) / (2.0)))'
    );
    expect(g.compile(ce.box(['Coth', 'x']) as any).code).toBe(
      '(1.0 / tanh(x))'
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
  ce.declare('x', 'real');
  const glsl = () => ce._getCompilationTarget('glsl')!;
  /** GLSL source for `json`, unframed (fragment-stage spatial noise). */
  const gpuCode = (json: any): string =>
    glsl().compile(ce.box(json) as any, {
      // These tests pin emitted GPU source byte for byte (and count the draws
      // in it), so the constant operands and the seeded frames must survive
      // to code generation instead of being folded to a literal.
      constantFold: false,
    }).code ?? '';
  const gpuDraws = (json: any): number =>
    (gpuCode(json).match(/_gpu_rnd_draw/g) ?? []).length;
  /** The GLSL fragment refuses `json`, so the compilation declines. */
  const gpuRefuses = (
    json: any,
    pattern: RegExp = /outside the GLSL fragment/
  ): void => {
    expect(() => gpuCode(json)).toThrow(pattern);
  };
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
  /** `body` inside a seed frame. */
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
      '(((0.1) === (_.x)) && ((_.x) === (0.9)))'
    );
    // A PURE complex operand is spliced twice, once per component. `x·i` is
    // a real operand scaled by the two constants of the imaginary unit, so
    // what is spliced is an object literal rather than the arrow function
    // that used to compute `{ re: 0 * x, im: 1 * x }` on each side.
    expect(
      jsCode(['Equal', ['Multiply', 'x', 'ImaginaryUnit'], ['Complex', 0, 0.5]])
    ).toBe(
      '((({ re: 0, im: _.x })).re === (({ re: 0, im: 0.5 })).re && ' +
        '(({ re: 0, im: _.x })).im === (({ re: 0, im: 0.5 })).im)'
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

  test('GLSL: Binomial(Random(), k) draws once (k splices)', () => {
    // The GLSL fragment refuses `Random`, for every k.
    for (const k of [2, 5, 1, 0]) gpuRefuses(['Binomial', ['Random'], k]);
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

  test('JS: a pure Range uses the same argument-passing shape (pins)', () => {
    // The operands are the arguments of the run-time helper `_SYS.range`,
    // so an impure operand is drawn once and no callback name can capture a
    // user variable (issue #367).
    expect(jsCode(['Range', 'a', 'b', 'c'])).toBe('_SYS.range(_.a, _.b, _.c)');
    expect(jsCode(['Range', 1, 10, 2])).toBe('_SYS.range(1, 10, 2)');
  });

  // --- GPU: Round, Root, Variance, Argument, Conjugate --------------------

  // `Round` writes its operand ONCE, inside the `_gpu_round` helper call, so
  // an impure operand needs no hoisted temporary to be drawn a single time.
  // The step form writes the operand twice (in the quotient and in the
  // overflow fix), so an impure operand is bound to a hoisted temporary.
  test('GLSL: Round draws an impure operand once (both forms)', () => {
    gpuRefuses(['Round', ['Random']]);
    gpuRefuses(['Round', ['Random'], 2]);
  });

  test('GLSL: Root of an impure operand at an odd degree draws once', () => {
    gpuRefuses(['Root', ['Random'], 3]);
  });

  test('GLSL: Variance draws exactly once PER ELEMENT (interpreter parity)', () => {
    // The GLSL fragment refuses `Variance`, and `Random` inside `Median`.
    gpuRefuses(['Variance', ['Random'], ['Random']]);
    gpuRefuses(['Variance', ['List', ['Random'], ['Random'], ['Random']]]);
    gpuRefuses(['Median', ['Random'], ['Random'], ['Random']], /GLSL fragment/);
  });

  test('GLSL: Argument/Conjugate of an impure COMPLEX operand draw once', () => {
    const z = ['Multiply', ['Random'], 'ImaginaryUnit'];
    gpuRefuses(['Argument', z]);
    gpuRefuses(['Conjugate', z]);
  });

  test('GLSL: an impure ContrastingColor operand fails closed', () => {
    // The GLSL fragment refuses `Random`.
    gpuRefuses([
      'ContrastingColor',
      ['Tuple', ['Random'], 1, 1],
      ['Tuple', 0, 0, 0],
      ['Tuple', 0.5, 0.1, 30],
    ]);
  });

  test('GLSL: the element-wise selection mask draws a middle operand once', () => {
    gpuRefuses([
      'Which',
      ['Less', ['List', 0.1, 0.2], ['Random'], ['List', 0.9, 0.8]],
      ['List', 1, 2],
      'True',
      ['List', 3, 4],
    ]);
  });

  test('GLSL: the complex Add fallback compiles each operand ONCE', () => {
    // The GLSL fragment refuses `WithRandomSeed`.
    gpuRefuses(
      framed(['Add', ['Cot', ['Random']], ['Sqrt', -2]]),
      /The head `WithRandomSeed` is outside the GLSL fragment/
    );
  });

  test('GPU: pure operands keep the direct emission (byte-identical pins)', () => {
    expect(gpuCode(['Round', 'x'])).toBe('_gpu_round(x)');
    expect(gpuCode(['Round', 'x', 2])).toBe(
      '_gpu_step_fix(_gpu_round(_gpu_half_step_quotient(x, 2.0)) * 2.0, x, 2.0)'
    );
    expect(gpuCode(['Root', 'x', 3])).toBe(
      '(sign(x) * pow(abs(x), 0.33333334))'
    );
    // Pin scalar emission with scalar contracts; unconstrained aggregate
    // inputs may contain Nothing and are deliberately refused.
    ce.declare('varianceX', 'real');
    ce.declare('varianceY', 'real');
    // The GLSL fragment refuses `Variance`.
    gpuRefuses(['Variance', 'varianceX', 'varianceY']);
    expect(gpuCode(['Argument', ['Complex', 'x', 'y']])).toBe('atan(y, x)');
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
      // Every operand is a tuple, which is 0-1 sRGB on every route, so each
      // reaches the contrast through `_gpu_srgb_to_oklch`.
      '(abs(_gpu_apca(_gpu_srgb_to_oklch(vec3(0.0, 0.0, 0.0)), ' +
        '_gpu_srgb_to_oklch(vec3(1.0, 1.0, 1.0)))) >= ' +
        'abs(_gpu_apca(_gpu_srgb_to_oklch(vec3(0.5, 0.1, 30.0)), ' +
        '_gpu_srgb_to_oklch(vec3(1.0, 1.0, 1.0)))) ? ' +
        '_gpu_srgb_to_oklch(vec3(0.0, 0.0, 0.0)) : ' +
        '_gpu_srgb_to_oklch(vec3(0.5, 0.1, 30.0)))'
    );
    // The GLSL fragment has no `Less` signature over lists.
    gpuRefuses(
      [
        'Which',
        ['Less', ['List', 0.1, 0.2], 'x', ['List', 0.9, 0.8]],
        ['List', 1, 2],
        'True',
        ['List', 3, 4],
      ],
      /No signature of `Less` in the GLSL fragment/
    );
    expect(gpuCode(['Add', 1, ['Sqrt', -2]])).toBe(
      'vec2(1.0, 0.0) + vec2(0.0, 1.4142135)'
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
    gpuRefuses(['Less', 0.1, ['Random'], 0.9]);
  });

  test('GLSL: a chained relation draws its operands in ARGUMENT order', () => {
    gpuRefuses(['Less', ['Random'], ['Random'], 0.9]);
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

  test('JS: a chain that short-circuits past a bound draw does not draw it', () => {
    // Since 2026-08-15 the interpreter short-circuits a chain at the first
    // `False` pair (`evaluateChainOperands`), so `Less(5, 1, Random(), c)`
    // never draws. The bound temporary for the index-2 operand must therefore
    // sit BEHIND the first pair, not around the whole chain: an outer binding
    // (`((_tv1) => (5 < 1) && …)(draw())`) would draw unconditionally.
    const json = ['Less', 5, 1, ['Random'], 0.9];
    expect(jsCode(json)).toBe(
      '(5 < 1) && ((_tv1) => (1 < _tv1) && (_tv1 < 0.9))' +
        '(_SYS.drawNextRandomNumber())'
    );
    // Draw-count parity, observed through the seeded stream: a following
    // draw sees index 0 in both engines when nothing was consumed before it.
    const probe = ['Add', ['Boole', json], ['Random']];
    const r = compiled(ce, probe);
    const c = withRandomSeedFrame(ce, 7, () => r.run!({}));
    const i = withRandomSeedFrame(ce, 7, () => ce.box(probe).evaluate().re);
    expect(c).toBe(i);
    expect(c).toBe(draw(7, 0));
    // A chain of PURE operands binds each computed operand behind the pairs
    // before it, as for an impure operand.
    const pure = ['Less', 'a', ['Add', 'b', 1], 'c', ['Add', 'd', 1], 'x'];
    expect(jsCode(pure)).toBe(
      '((_tv1) => (_.a < _tv1) && (_tv1 < _.c) && ' +
        '((_tv2) => (_.c < _tv2) && (_tv2 < _.x))(_.d + 1))(_.b + 1)'
    );
    const chain = compiled(ce, pure);
    expect(chain.run!({ a: 5, b: 1, c: 0, d: 0, x: 0 })).toBe(false);
    expect(chain.run!({ a: 0, b: 1, c: 3, d: 3, x: 4 })).toBe(false);
    expect(chain.run!({ a: 0, b: 1, c: 3, d: 3, x: 5 })).toBe(true);
  });

  test('JS: a chain that reads a variable does not draw an impure operand at index ≥ 2 up front', () => {
    // `Less(x, 1, Random(), 0.9)` at `x = 5`: the first pair is `false`, so
    // the interpreter never draws. A lowering that bound the index-2 draw
    // around the whole chain (to test the chain as the `And` of its links)
    // would draw once too often. Observed through the seeded stream: the
    // following `Random()` must read draw 0 in both engines.
    const probe = [
      'Add',
      ['Boole', ['Less', 'x', 1, ['Random'], 0.9]],
      ['Random'],
    ];
    const r = compiled(ce, probe);
    const c = withRandomSeedFrame(ce, 7, () => r.run!({ x: 5 }));
    const i = withRandomSeedFrame(
      ce,
      7,
      () => ce.box(probe).subs({ x: 5 }).evaluate().re
    );
    expect(c).toBe(i);
    expect(c).toBe(draw(7, 0));
  });

  test('JS: a repeated impure operand of a comparison draws at each occurrence', () => {
    // `q = x + Random()` appears twice in `Less(q, q)`: each occurrence is
    // its own draw, as in the interpreter. Binding the node once (to test
    // the comparison for an unsupplied `x`) would draw once.
    const q = ce.box(['Add', 'x', ['Random']]);
    const expr = ce.function('Less', [q, q]);
    const code =
      compile(expr, { fallback: false, constantFold: false }).code ?? '';
    expect((code.match(/drawNextRandomNumber/g) ?? []).length).toBe(2);
    const probe = ce.function('Add', [
      ce.function('Boole', [expr]),
      ce.box(['Random']),
    ]);
    const r = compile(probe, { fallback: false });
    const c = withRandomSeedFrame(ce, 7, () => r.run!({ x: 0 }) as number);
    // Draws 0 and 1 are the two occurrences of `q`, draw 2 the last term.
    expect(c).toBe((draw(7, 0) < draw(7, 1) ? 1 : 0) + draw(7, 2));
  });

  test('GLSL: an impure operand at index ≥ 2 that must be hoisted DECLINES', () => {
    // The GLSL fragment refuses `Random`, at any index.
    gpuRefuses(['Less', 5, 1, ['Random'], 0.9]);
    gpuRefuses(['Less', 0.1, ['Random'], 0.9]);
  });

  test('GLSL: the selection mask draws its operands in ARGUMENT order', () => {
    gpuRefuses([
      'Which',
      ['Less', ['Random'], ['Random'], ['List', 0.9, 0.8]],
      ['List', 1, 2],
      'True',
      ['List', 3, 4],
    ]);
  });

  test('GLSL: an impure Match subject draws once', () => {
    // The GLSL fragment refuses `Match`.
    gpuRefuses(matchJSON(['Random']), /The head `Match` is outside the GLSL fragment/);
    gpuRefuses(
      [
        'Match',
        ['Random'],
        ['MatchCase', ['Range', 1, 5], 10],
        ['MatchCase', '_', -1],
      ],
      /The head `Match` is outside the GLSL fragment/
    );
  });

  test('chain/Match keep the pure emission (byte-identical pins)', () => {
    expect(gpuCode(['Less', 0.1, 'x', 0.9])).toBe('(0.1 < x) && (x < 0.9)');
    // The GLSL fragment refuses `Match`.
    gpuRefuses(matchJSON('x'), /The head `Match` is outside the GLSL fragment/);
    // The JS chain (a `bindExpr` target) is untouched by the GPU arm.
    expect(jsCode(['Less', 0.1, ['Add', 'x', 1], 0.9])).toBe(
      '((_tv1) => (0.1 < _tv1) && (_tv1 < 0.9))(_.x + 1)'
    );
  });
});

describe('a real-operand guard evaluates every impure operand in source order', () => {
  // In the `auto` mode, a real-only head (`Max`) over an operand that may be
  // complex at run time (`√x` with `x: real`) is emitted under a guard that
  // the operand is real, and is NaN otherwise. The draws of the OTHER
  // operands must happen before that guard, in argument order: the
  // interpreter evaluates every operand of `Max`, so a draw placed inside
  // the guarded branch was skipped at `x = -4`, and the next draw of the
  // frame differed (CE-686).
  function parity(json: any, x: number, seed: number) {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compiled(ce, json);
    const c = withRandomSeedFrame(ce, seed, () => [
      r.run!({ x }),
      ce._random(),
    ]);
    const i = withRandomSeedFrame(ce, seed, () => [
      ce.box(json).subs({ x }).evaluate().re,
      ce._random(),
    ]);
    return { compiled: c, interpreted: i };
  }

  test('Max(√x, Random()) draws once when √x is not real', () => {
    const json = ['Max', ['Sqrt', 'x'], ['Random']];
    const { compiled: c, interpreted: i } = parity(json, -4, 7);
    expect(i).toEqual([NaN, draw(7, 1)]);
    expect(c).toEqual(i);
    // The real case is unchanged: `max(2, draw0)` is 2.
    expect(parity(json, 4, 7).compiled).toEqual([2, draw(7, 1)]);
  });

  test('Max(Random(), √x) draws once when √x is not real', () => {
    const json = ['Max', ['Random'], ['Sqrt', 'x']];
    const { compiled: c, interpreted: i } = parity(json, -4, 7);
    expect(i).toEqual([NaN, draw(7, 1)]);
    expect(c).toEqual(i);
  });

  test('a draw written before a maybe-complex draw runs first', () => {
    // `√(Random() − 0.5)` is the maybe-complex operand. It is bound to a
    // temporary, and before the fix it was evaluated before the draw
    // written to its left, which was inlined in the guarded branch.
    const json = [
      'Max',
      ['Random'],
      ['Sqrt', ['Subtract', ['Random'], 0.5]],
      ['Random'],
    ];
    let realCases = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { compiled: c, interpreted: i } = parity(json, 0, seed);
      expect(i[1]).toBe(draw(seed, 3));
      expect(c).toEqual(i);
      if (draw(seed, 1) >= 0.5) {
        realCases += 1;
        expect(c[0]).toBe(
          Math.max(draw(seed, 0), Math.sqrt(draw(seed, 1) - 0.5), draw(seed, 2))
        );
      }
    }
    // Some seeds give a real root, so the values (not only the draw
    // count) are compared.
    expect(realCases).toBeGreaterThan(0);
  });

  // A compiled input is a value that the variable HOLDS at run time, so the
  // interpreter reference is an evaluation with `x` assigned. That
  // evaluation evaluates both operands (one draw) and then refuses the
  // imaginary divisor cell by cell. `subs({x: -4})` is a different
  // expression: it boxes `Mod([Random(), 2], 2i)`, whose literal imaginary
  // divisor is refused at boxing, so the whole expression is an error that
  // takes no draw. The compiled code cannot see that literal at compile
  // time, and it follows the assigned evaluation.
  test.each(['Mod', 'Remainder'])(
    '%s([Random(), 2], √x) draws once when √x is not real',
    (head) => {
      const json = [head, ['List', ['Random'], 2], ['Sqrt', 'x']];
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const r = compiled(ce, json);
      const c = withRandomSeedFrame(ce, 7, () => [
        r.run!({ x: -4 }),
        ce._random(),
      ]);
      expect(c).toEqual([[NaN, NaN], draw(7, 1)]);

      const ce2 = new ComputeEngine();
      ce2.declare('x', 'real');
      ce2.assign('x', -4);
      const i = withRandomSeedFrame(ce2, 7, () => {
        const v = ce2.box(json).evaluate();
        return [v.ops!.map((cell) => cell.N().re), ce2._random()];
      });
      expect(i).toEqual(c);
      if (head === 'Mod') {
        // Each cell is the `incompatible-type` error, which compiled code
        // gives as NaN.
        const v = withRandomSeedFrame(ce2, 7, () => ce2.box(json).evaluate());
        expect(v.ops!.every((cell) => cell.operator === 'Error')).toBe(true);
        // The `subs` route boxes the imaginary literal and takes no draw.
        const s = withRandomSeedFrame(ce, 7, () => [
          ce.box(json).subs({ x: -4 }).evaluate().operator,
          ce._random(),
        ]);
        expect(s).toEqual(['Error', draw(7, 0)]);
      }
      // The real case agrees with the interpreter too.
      expect(
        withRandomSeedFrame(ce, 7, () => [r.run!({ x: 4 }), ce._random()])
      ).toEqual([[draw(7, 0), 0], draw(7, 1)]);
    }
  );
});

describe('a comparison chain evaluates the operands the interpreter evaluates', () => {
  // The interpreter evaluates the operands of a chain (three or more
  // operands) from left to right. It evaluates operand i, and then stops if
  // the pair (i−1, i) is `False`, also when operand i−1 is not real. So in
  // `Less(√(r₀−½), √(r₁−½), 0)` with a complex first root, both roots are
  // drawn. The compiled chain tested the realness of the first root before
  // it drew the second root, and drew once too few. An `Equal` chain with an
  // impure middle operand bound every impure operand before the first pair,
  // and drew too often when that pair was false.

  /** The value and the index of the next draw, in both engines. */
  function parity(json: any, seed: number) {
    const ce = new ComputeEngine();
    const r = compiled(ce, json);
    const index = (v: number): number => {
      for (let n = 0; n < 8; n++) if (draw(seed, n) === v) return n;
      return -1;
    };
    const c = withRandomSeedFrame(ce, seed, () => [
      r.run!(),
      index(ce._random()),
    ]);
    const i = withRandomSeedFrame(ce, seed, () => {
      const v = ce.box(json).evaluate().symbol;
      return [
        v === 'True' ? true : v === 'False' ? false : v,
        index(ce._random()),
      ];
    });
    return { compiled: c, interpreted: i };
  }

  const root = ['Sqrt', ['Subtract', ['Random'], 0.5]];

  test('Less(√(r₀−½), √(r₁−½), 0) draws both roots when the first is complex', () => {
    const json = ['Less', root, root, 0];
    // Seed 2: the first draw is less than ½, so the first root is complex.
    expect(draw(2, 0)).toBeLessThan(0.5);
    expect(parity(json, 2).interpreted).toEqual([false, 2]);
    for (let seed = 1; seed <= 12; seed++) {
      const { compiled: c, interpreted: i } = parity(json, seed);
      expect(c).toEqual(i);
    }
  });

  test.each([
    'Less',
    'LessEqual',
    'Greater',
    'GreaterEqual',
    'Equal',
    'NotEqual',
  ])(
    '%s chains with maybe-complex and real draws agree with the interpreter',
    (h) => {
      const shapes = [
        [h, root, root, 0],
        [h, root, ['Random'], root],
        [h, ['Random'], root, root, ['Random']],
        [h, 0, root, ['Random']],
        [h, root, root],
      ];
      for (const json of shapes)
        for (let seed = 1; seed <= 12; seed++) {
          const { compiled: c, interpreted: i } = parity(json, seed);
          expect([json, seed, c]).toEqual([json, seed, i]);
        }
    }
  );

  test.each(['Equal', 'NotEqual'])(
    '%s chain with an impure middle operand stops at the first false pair',
    (h) => {
      for (const json of [
        [h, 0.1, ['Random'], 0.9, ['Random']],
        [h, ['Random'], ['Random'], ['Random']],
      ])
        for (let seed = 1; seed <= 12; seed++) {
          const { compiled: c, interpreted: i } = parity(json, seed);
          expect([json, seed, c]).toEqual([json, seed, i]);
        }
      // The first pair of `Equal(0.1, r₀, 0.9, r₁)` is false, so only one
      // draw is made.
      if (h === 'Equal')
        expect(
          parity([h, 0.1, ['Random'], 0.9, ['Random']], 7).compiled
        ).toEqual([false, 1]);
    }
  );

  test('NotEqual with an impure middle operand draws it once', () => {
    // The canonical form of a `NotEqual` chain was an `And` of its adjacent
    // pairs, which holds a middle operand twice: `NotEqual(1, Random(), 2)`
    // drew twice and compared `1 ≠ r₀` and `r₁ ≠ 2`. The chain stays n-ary
    // when a middle operand is impure.
    const ce = new ComputeEngine();
    expect(ce.box(['NotEqual', 1, ['Random'], 2]).json).toEqual([
      'NotEqual',
      1,
      ['Random'],
      2,
    ]);
    for (let seed = 1; seed <= 6; seed++) {
      expect(parity(['NotEqual', 1, ['Random'], 2], seed)).toEqual({
        compiled: [true, 1],
        interpreted: [true, 1],
      });
      expect(
        parity(['NotEqual', ['Random'], ['Random'], ['Random']], seed)
      ).toEqual({ compiled: [true, 3], interpreted: [true, 3] });
      // `⌊r₀⌋ = 0`, so the first pair is false and the last operand is not
      // drawn.
      expect(
        parity(['NotEqual', 0, ['Floor', ['Random']], ['Random']], seed)
      ).toEqual({ compiled: [false, 1], interpreted: [false, 1] });
    }
  });

  test('an Equal chain with an absent operand before a draw does not draw', () => {
    // The interpreter reads a pair with an absent operand as `False` (user
    // decision of 2026-11-02, two-valued comparisons), so it does not draw.
    // Before, it read the pair as `Missing` and drew. A declared type cannot
    // name `missing` (`docs/ERROR-MODEL.md`, "`Missing` is a result only"),
    // so the absent operand is the symbol `Missing`.
    const json = ['Equal', 'Missing', 'True', ['Random']];
    const ce = new ComputeEngine();
    expect(() => ce.declare('a', 'boolean | missing')).toThrow();
    const next = withRandomSeedFrame(ce, 7, () => {
      // The first pair, `Missing = True`, is `False`.
      expect(ce.box(json).evaluate().json).toBe('False');
      return ce._random();
    });
    expect(next).toBe(draw(7, 0));
    // With both operands present the chain compiles. The first pair is
    // `false` in both engines, and neither draws.
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'boolean');
    ce2.declare('b', 'boolean');
    const r = compiled(ce2, ['Equal', 'a', 'b', ['Random']]);
    expect(
      withRandomSeedFrame(ce2, 7, () => [
        r.run!({ a: false, b: true }),
        ce2._random(),
      ])
    ).toEqual([false, draw(7, 0)]);
  });

  test('a chain with pairs before the last draw compiles', () => {
    // Operands whose value is present compile.
    const r = compiled(new ComputeEngine(), [
      'Equal',
      'True',
      'True',
      ['Less', ['Random'], 0.5],
    ]);
    expect(r.success).toBe(true);
  });

  test('a symbol whose value draws is bound once in a NotEqual chain', () => {
    // `isPure` is true for `r`, but its compiled code is the draw, spliced
    // at each place that reads `r`. The middle operand of a chain is in two
    // pairs, so `NotEqual(1, r, 2)` drew twice; the interpreter draws once.
    const ce = new ComputeEngine();
    ce.assign('r', ce.box(['Random'], { form: 'raw' }));
    const expr = ce.box(['NotEqual', 1, 'r', 2]);
    const r = compile(expr, { fallback: false, constantFold: false })!;
    expect(r.success).toBe(true);
    for (let seed = 1; seed <= 6; seed++) {
      const c = withRandomSeedFrame(ce, seed, () => [r.run!(), ce._random()]);
      const i = withRandomSeedFrame(ce, seed, () => [
        expr.evaluate().json,
        ce._random(),
      ]);
      expect(c).toEqual([true, draw(seed, 1)]);
      expect(i).toEqual(['True', draw(seed, 1)]);
    }
  });
});

describe('a real-operand guard over an impure node shared by two positions', () => {
  // A boxed node can be passed at two positions (`Max(e, e)`). The
  // interpreter evaluates each position, so an impure node draws once per
  // position. The guard replaces an operand by its temporary through an
  // override keyed on the node, which cannot give the two positions two
  // evaluations, so such a head keeps its decline and the interpreter
  // fallback gives the value (CE-687). The guard is emitted in the
  // `complex` mode only: in the default `strict` mode `√x` with `x: real`
  // is on the real lane (`NaN` at `x < 0`), no guard is emitted, and each
  // position of the shared node is compiled again, so it draws once per
  // position, as the interpreter does.
  function bothRuns(
    ce: ComputeEngine,
    expr: any,
    seed: number,
    x = 0,
    mode?: 'complex'
  ) {
    const r = compile(expr, { constantFold: false, mode })!;
    const c = withRandomSeedFrame(ce, seed, () => [
      r.run!({ x }),
      ce._random(),
    ]);
    const i = withRandomSeedFrame(ce, seed, () => [
      expr.subs({ x }).evaluate().re,
      ce._random(),
    ]);
    return { result: r, compiled: c, interpreted: i };
  }

  /** The diagnostic code of the decline under `fallback: false`. */
  function declineCode(expr: any, mode?: 'complex'): string | undefined {
    try {
      compile(expr, { fallback: false, constantFold: false, mode });
    } catch (err) {
      return (err as { diagnostic?: { code: string } }).diagnostic?.code;
    }
    return undefined;
  }

  test('Max(e, e) with e = √(Random() − 0.5) declines in complex mode and draws twice', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Sqrt', ['Subtract', ['Random'], 0.5]]);
    const expr = ce.function('Max', [e, e]);
    expect(declineCode(expr, 'complex')).toBe('shared-impure-operand');
    for (let seed = 1; seed <= 6; seed++) {
      const { result, compiled: c, interpreted: i } = bothRuns(
        ce,
        expr,
        seed,
        0,
        'complex'
      );
      expect(result.success).toBe(false);
      expect(i[1]).toBe(draw(seed, 2));
      expect(c).toEqual(i);
    }
    // The default mode compiles, and draws once per position.
    expect(declineCode(expr)).toBeUndefined();
    for (let seed = 1; seed <= 6; seed++) {
      const { result, compiled: c, interpreted: i } = bothRuns(ce, expr, seed);
      expect(result.success).toBe(true);
      expect(c[1]).toBe(draw(seed, 2));
      expect(i[1]).toBe(draw(seed, 2));
      if (Number.isFinite(i[0])) expect(c).toEqual(i);
    }
  });

  test('Max(r, √x, r) with one Random node declines in complex mode and draws twice', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = ce.box(['Random']);
    const expr = ce.function('Max', [r, ce.box(['Sqrt', 'x']), r]);
    for (const x of [4, -4]) {
      const { result, compiled: c, interpreted: i } = bothRuns(
        ce,
        expr,
        7,
        x,
        'complex'
      );
      expect(result.success).toBe(false);
      expect(i[1]).toBe(draw(7, 2));
      expect(c).toEqual(i);
    }
    // The default mode compiles: `√x` is `NaN` at `x = -4`.
    for (const x of [4, -4]) {
      const { result, compiled: c, interpreted: i } = bothRuns(ce, expr, 7, x);
      expect(result.success).toBe(true);
      expect(c[1]).toBe(draw(7, 2));
      expect(i[1]).toBe(draw(7, 2));
      if (x === 4) expect(c).toEqual(i);
      else expect(c[0]).toBeNaN();
    }
  });

  test('Less(e, e) declines with its own diagnostic in complex mode', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Sqrt', ['Subtract', ['Random'], 0.5]]);
    const expr = ce.function('Less', [e, e]);
    expect(() =>
      compile(expr, { mode: 'complex', fallback: false, constantFold: false })
    ).toThrow(/occurs at more than one position/);
    expect(declineCode(expr, 'complex')).toBe('shared-impure-operand');
    // The default mode compiles `Less` on the real lane, one draw per
    // position.
    expect(declineCode(expr)).toBeUndefined();
    for (let seed = 1; seed <= 6; seed++) {
      const r = compile(expr, { constantFold: false, mode: 'complex' })!;
      expect(r.success).toBe(false);
      const c = withRandomSeedFrame(ce, seed, () => [r.run!({}), ce._random()]);
      const i = withRandomSeedFrame(ce, seed, () => [
        expr.evaluate().symbol === 'True',
        ce._random(),
      ]);
      expect(i[1]).toBe(draw(seed, 2));
      expect(c).toEqual(i);
    }
  });

  test('Max(e, e, Random()) with one PURE shared node e = √x compiles', () => {
    // Both positions of the pure `e` read the same value, and the draw
    // writes no symbol, so one binding of `e` is correct.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.box(['Sqrt', 'x']);
    const expr = ce.function('Max', [e, e, ce.box(['Random'])]);
    for (const x of [4, 0.25, -4]) {
      const { result, compiled: c, interpreted: i } = bothRuns(ce, expr, 7, x);
      expect(result.success).toBe(true);
      expect(c[1]).toBe(draw(7, 1));
      expect(i[1]).toBe(draw(7, 1));
      if (x >= 0) expect(c).toEqual(i);
      else expect(c[0]).toBeNaN();
    }
  });

  test('a pure shared node beside an assignment to the symbol it reads declines', () => {
    // `Max(y, Assign(y, 1), y, √x)`: an assignment as an operand is the
    // static error `assignment-in-operand`, so the expression is invalid and
    // the compilation declines.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.assign('y', 5);
    const y = ce.box('y');
    const expr = ce.function('Max', [
      y,
      ce.box(['Assign', 'y', 1]),
      y,
      ce.box(['Sqrt', 'x']),
    ]);
    expect(() =>
      compile(expr, { fallback: false, constantFold: false, mode: 'complex' })
    ).toThrow(/invalid expression/);
  });

  test('a symbol whose value draws is impure to the guard', () => {
    // `r := Random()` (held unevaluated) is pure to `isPure`, but the
    // interpreter draws again at each read of `r`, and the compiled code
    // inlines the draw at each reference.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('r', ce.box(['Random'], { form: 'raw' }));
    const r = ce.box('r');
    const sx = ce.box(['Sqrt', 'x']);
    // One `r` node at two positions beside a draw declines.
    const shared = ce.function('Max', [r, r, ce.box(['Random']), sx]);
    expect(declineCode(shared, 'complex')).toBe('shared-impure-operand');
    for (const x of [4, -4]) {
      const { compiled: c, interpreted: i } = bothRuns(
        ce,
        shared,
        7,
        x,
        'complex'
      );
      expect(i[1]).toBe(draw(7, 3));
      expect(c).toEqual(i);
    }
    // `Max(√x, r)`: the read of `r` draws whatever the guard decides.
    const single = ce.function('Max', [sx, r]);
    for (const x of [4, -4]) {
      const { compiled: c, interpreted: i } = bothRuns(ce, single, 7, x);
      expect(i[1]).toBe(draw(7, 1));
      expect(c[1]).toBe(i[1]);
      if (x >= 0) expect(c).toEqual(i);
    }
  });

  test('a symbol mapped through `vars` is read from its input', () => {
    // The stored value of `r` draws, but with `vars: { r: '_.r' }` the code
    // reads the input `r` and never draws, so one shared `r` node compiles.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('r', ce.box(['Random'], { form: 'raw' }));
    const r = ce.box('r');
    const expr = ce.function('Max', [r, r, ce.box(['Sqrt', 'x'])]);
    const result = compile(expr, {
      fallback: false,
      constantFold: false,
      vars: { r: '_.r' },
    })!;
    expect(result.success).toBe(true);
    expect(result.run!({ x: 4, r: 3 })).toBe(3);
  });

  test('a `vars` entry that runs code is evaluated whatever the guard decides', () => {
    // `_.draw()` is caller code that counts its calls. In `Max(√x, r)` it
    // must run once also when √x is not real, as the interpreter reads `r`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('r', 'real');
    const expr = ce.box(['Max', ['Sqrt', 'x'], 'r']);
    const result = compile(expr, {
      fallback: false,
      constantFold: false,
      vars: { r: '_.draw()' },
    })!;
    expect(result.success).toBe(true);
    for (const x of [4, -4]) {
      let calls = 0;
      result.run!({ x, draw: () => (++calls, 1) } as any);
      expect(calls).toBe(1);
    }
  });

  test('caller code reached through a symbol value runs whatever the guard decides', () => {
    // `r := 2·w` with `w` mapped to `_.draw()`: the compiled code inlines
    // the value of `r`, so the caller's call must run once also when √x is
    // not real.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('w', 'real');
    ce.assign('r', ce.box(['Multiply', 2, 'w'], { form: 'raw' }));
    const expr = ce.box(['Max', ['Sqrt', 'x'], 'r']);
    const result = compile(expr, {
      fallback: false,
      constantFold: false,
      vars: { w: '_.draw()' },
    })!;
    expect(result.success).toBe(true);
    for (const x of [4, -4]) {
      let calls = 0;
      const value = result.run!({ x, draw: () => (++calls, 1) } as any);
      expect(calls).toBe(1);
      if (x === 4) expect(value).toBe(2);
    }
  });

  test('caller code in the body of a block-local function runs whatever the guard decides', () => {
    // `f` is defined by the compiled block, so its body is read from the
    // block, not from the engine.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('w', 'real');
    const expr = ce.box([
      'Block',
      ['Assign', 'f', ['Function', ['Multiply', 2, 'w']]],
      ['Add', ['Sqrt', 'x'], ['f']],
    ]);
    const result = compile(expr, {
      fallback: false,
      constantFold: false,
      vars: { w: '_.draw()' },
    })!;
    expect(result.success).toBe(true);
    for (const x of [4, -4]) {
      let calls = 0;
      const value = result.run!({ x, draw: () => (++calls, 1) } as any);
      expect(calls).toBe(1);
      if (x === 4) expect(value).toBe(4);
    }
  });

  test('caller code in a block-local function passed by name runs whatever the guard decides', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('w', 'real');
    const expr = ce.box([
      'Block',
      ['Assign', 'f', ['Function', ['Multiply', 2, 'w']]],
      ['Add', ['Sqrt', 'x'], ['Apply', 'f']],
    ]);
    const result = compile(expr, {
      fallback: false,
      constantFold: false,
      vars: { w: '_.draw()' },
    })!;
    expect(result.success).toBe(true);
    for (const x of [4, -4]) {
      let calls = 0;
      const value = result.run!({ x, draw: () => (++calls, 1) } as any);
      expect(calls).toBe(1);
      if (x === 4) expect(value).toBe(4);
    }
  });

  test('Max of a call of a block-local function declines, and the interpreter gives the value', () => {
    // The call of a block-local function has the static type `unknown`, so
    // `Max` of it has no settled shape and declines (ROADMAP CE-806). The
    // fallback evaluates the block with the interpreter.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('w', 'real');
    const expr = ce.box([
      'Block',
      ['Assign', 'f', ['Function', ['Multiply', 2, 'w']]],
      ['Max', ['Sqrt', 'x'], ['f']],
    ]);
    expect(() =>
      compile(expr, { fallback: false, constantFold: false })
    ).toThrow(/it can be a number or a list/);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(expr, { constantFold: false })!;
      expect(result.success).toBe(false);
      expect(result.run!({ x: 4, w: 1 } as any)).toBe(2);
      expect(result.run!({ x: 4, w: 3 } as any)).toBe(6);
    } finally {
      warn.mockRestore();
    }
  });

  test('a block-local function name that is also a bound variable is looked through', () => {
    // A block binds each of its locals, so `f` reads an input of the
    // compiled code AND names the block's function. Its literal is read
    // first.
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['Multiply', 2, 'w']]) as any;
    const options = {
      isStringVar: (n: string) => n === 'w',
      isCallerMapped: () => false,
      readsInput: (n: string) => n === 'f',
      localFunction: (n: string) => (n === 'f' ? literal : undefined),
    };
    expect(reachesCallerCode(ce.box('f'), options)).toBe(true);
    expect(
      reachesCallerCode(ce.box('f'), { ...options, localFunction: undefined })
    ).toBe(false);
  });

  test('a symbol whose value assigns counts as a write', () => {
    // `r := Assign(y, 1)` held unevaluated: the read of `r` in
    // `Max(y, r, y, √x)` sets `y` to 1, so the second `y` reads 1 in the
    // interpreter. One binding of the shared `y` would read 5 twice.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.assign('r', ce.box(['Assign', 'y', 1], { form: 'raw' }));
    const y = ce.box('y');
    const expr = ce.function('Max', [y, ce.box('r'), y, ce.box(['Sqrt', 'x'])]);
    expect(declineCode(expr, 'complex')).toBe('shared-impure-operand');
    // The same write inside an operand that also draws: the labels of
    // `Random() + r` show only the draw.
    const mixed = ce.function('Max', [
      y,
      ce.box(['Add', ['Random'], 'r']),
      y,
      ce.box(['Sqrt', 'x']),
    ]);
    expect(declineCode(mixed, 'complex')).toBe('shared-impure-operand');
  });

  test('Max(r, r) with no maybe-complex operand compiles and draws twice', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Random']);
    const expr = ce.function('Max', [r, r]);
    const { result, compiled: c, interpreted: i } = bothRuns(ce, expr, 7);
    expect(result.success).toBe(true);
    expect(c).toEqual([Math.max(draw(7, 0), draw(7, 1)), draw(7, 2)]);
    expect(c).toEqual(i);
  });

  test('a Random node that is an operand and also inside another operand', () => {
    // `Max(r, √(r − 0.5))` with one `r` node. Before the fix, the binding
    // of `√(r − 0.5)` was compiled after `r` was replaced by its
    // temporary, and read that temporary where it is not in scope (a
    // `ReferenceError` at run time).
    const ce = new ComputeEngine();
    const r = ce.box(['Random']);
    const expr = ce.function('Max', [
      r,
      ce.box(['Sqrt', ['Subtract', r, 0.5]]),
    ]);
    let realCases = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { result, compiled: c, interpreted: i } = bothRuns(ce, expr, seed);
      expect(result.success).toBe(true);
      expect(i[1]).toBe(draw(seed, 2));
      expect(c).toEqual(i);
      if (draw(seed, 1) >= 0.5) {
        realCases += 1;
        expect(c[0]).toBe(
          Math.max(draw(seed, 0), Math.sqrt(draw(seed, 1) - 0.5))
        );
      }
    }
    expect(realCases).toBeGreaterThan(0);
  });

  test('an impure list literal beside a maybe-complex scalar draws once', () => {
    // `Mod([Random(), 2], √x)`: the list is bound whole, and the
    // element-wise lowering reads its temporary, so its draw is compiled
    // once. (At `x = −4` the interpreter rejects the imaginary divisor
    // before it evaluates the list, so only real divisors are compared.)
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const json = ['Mod', ['List', ['Random'], 2], ['Sqrt', 'x']];
    const r = compiled(ce, json);
    expect(r.code.split('drawNextRandomNumber').length - 1).toBe(1);
    for (let seed = 1; seed <= 6; seed++) {
      // A divisor of 2 keeps `floorMod` exact; the interpreter's `Mod` by
      // 0.5 can round the last bit differently.
      for (const x of [4, 16]) {
        const c = withRandomSeedFrame(ce, seed, () => [
          r.run!({ x }),
          ce._random(),
        ]);
        const i = withRandomSeedFrame(ce, seed, () => {
          const v = ce.box(json).subs({ x }).evaluate();
          return [v.ops!.map((op) => op.re), ce._random()];
        });
        expect(i[1]).toBe(draw(seed, 1));
        expect(c).toEqual(i);
      }
    }
  });

  test('a Random node shared by two different operands draws in each', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Random']);
    const expr = ce.function('Max', [
      ce.box(['Sqrt', ['Subtract', r, 0.5]]),
      ce.function('Add', [r, 1]),
    ]);
    for (let seed = 1; seed <= 6; seed++) {
      const { result, compiled: c, interpreted: i } = bothRuns(ce, expr, seed);
      expect(result.success).toBe(true);
      expect(i[1]).toBe(draw(seed, 2));
      expect(c).toEqual(i);
    }
  });
});

describe('a real-operand guard reads each operand where the interpreter reads it', () => {
  // When an operand of a guarded head has an effect, every operand that is
  // not a literal or a constant is bound before the guard, in source
  // order. A pure read of a variable left inline in the guarded lowering
  // ran after the bound assignment.
  function run(json: any, x: number, seed = 7) {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compiled(ce, json);
    const c = withRandomSeedFrame(ce, seed, () => [
      r.run!({ x }),
      ce._random(),
    ]);
    const i = withRandomSeedFrame(ce, seed, () => {
      const v = ce.box(json).subs({ x }).evaluate();
      return [
        v.isNumberLiteral && v.im === 0 ? v.re : v.toString(),
        ce._random(),
      ];
    });
    return { compiled: c, interpreted: i };
  }

  test('an assignment as an operand of a guarded head declines', () => {
    // An assignment as an operand is the static error
    // `assignment-in-operand`: the expression is invalid and the compilation
    // declines.
    for (const json of [
      [
        'Block',
        ['Assign', 'y', 5],
        ['Max', ['Sqrt', 'x'], 'y', ['Assign', 'y', 1]],
      ],
      [
        'Block',
        ['Assign', 'y', -1],
        ['Max', 'y', ['Sqrt', ['Assign', 'y', 4]]],
      ],
      [
        'Block',
        ['Assign', 'y', 5],
        ['Max', 'y', ['Assign', 'y', 1], 'y', ['Sqrt', 'x']],
      ],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      expect(() =>
        compile(ce.box(json as any), { fallback: false, constantFold: false })
      ).toThrow(/invalid expression/);
    }
  });

  test('Max(r, √x, r) with two Random nodes draws twice before the guard', () => {
    const json = ['Max', ['Random'], ['Sqrt', 'x'], ['Random']];
    const pass = run(json, 4);
    expect(pass.interpreted).toEqual([
      Math.max(draw(7, 0), 2, draw(7, 1)),
      draw(7, 2),
    ]);
    expect(pass.compiled).toEqual(pass.interpreted);
    const fail = run(json, -4);
    expect(fail.interpreted[1]).toBe(draw(7, 2));
    expect(fail.compiled).toEqual([NaN, draw(7, 2)]);
  });
});

describe('a chained comparison evaluates caller code once, in operand order', () => {
  // A `vars` entry whose value is code (`_.w()`) or a head mapped through
  // `functions` can count its calls. The interpreter evaluates each operand
  // of a chain once, from left to right, and stops at the first pair that
  // is `False`, so the caller's code runs once, and not at all after a
  // false pair. A middle operand is read by two pairs, and the tests of an
  // absent input read an operand again, so the compiled code binds it.
  const V = { vars: { W: '_.w()', V: '_.v()' } };
  function calls(
    json: any,
    inputs: Record<string, number>,
    w: number,
    v = 0,
    options: any = V
  ) {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('W', 'real');
    ce.declare('V', 'real');
    ce.declare('y', 'real');
    ce.declare('g', '(real) -> real');
    const r = compile(ce.box(json), { fallback: false, ...options })!;
    expect(r.success).toBe(true);
    const log: string[] = [];
    const value = r.run!({
      ...inputs,
      w: () => (log.push('w'), w),
      v: () => (log.push('v'), v),
      f: (t: number) => (log.push('f'), t / 2),
    } as any);
    return { value, log: log.join(',') };
  }
  // The interpreter's value with `W` and `V` bound to numbers.
  function interpreted(
    json: any,
    inputs: Record<string, number>,
    w: number,
    v = 0
  ) {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const r = ce
      .box(json)
      .subs({ ...inputs, W: w, V: v })
      .evaluate();
    return r.symbol === 'True'
      ? true
      : r.symbol === 'False'
        ? false
        : r.toString();
  }

  test.each([
    [['Less', 1, 'W', 3], 2],
    [['Less', 1, 'W', 3], 5],
    [['Less', 'x', 'W', 3], 2],
    [['LessEqual', 'y', 'W', 3], 0],
    [['Equal', 1, 'W', 1], 1],
    [['Equal', 'x', 'W', 3], 3],
    [['Less', 'x', 'W'], 2],
  ])('%j with W = %d calls W once', (json, w) => {
    const run = calls(json, { x: 1, y: 1 }, w);
    expect(run.log).toBe('w');
    expect(run.value).toBe(interpreted(json, { x: 1, y: 1 }, w));
  });

  test('caller code after a false pair does not run', () => {
    const json = ['Less', 'x', 1, 'W'];
    expect(calls(json, { x: 5 }, 2)).toEqual({ value: false, log: '' });
    expect(calls(json, { x: 0 }, 2)).toEqual({ value: true, log: 'w' });
    expect(calls(['Less', 'x', 'W', 'V'], { x: 5 }, 1, 2)).toEqual({
      value: false,
      log: 'w',
    });
  });

  test('two operands with caller code run in operand order', () => {
    expect(calls(['Less', 'W', 'V', 3], {}, 1, 2)).toEqual({
      value: true,
      log: 'w,v',
    });
    expect(calls(['Equal', 'W', 'V'], {}, 1, 1)).toEqual({
      value: true,
      log: 'w,v',
    });
  });

  test('a branch condition calls the caller code once', () => {
    const If = (c: any) => ['If', c, 10, 20];
    expect(calls(If(['Less', 1, 'W', 3]), {}, 2)).toEqual({
      value: 10,
      log: 'w',
    });
    expect(calls(If(['Less', 'x', 'W', 3]), { x: 1 }, 2)).toEqual({
      value: 10,
      log: 'w',
    });
    expect(calls(If(['Less', 'x', 1, 'W']), { x: 5 }, 2)).toEqual({
      value: 20,
      log: '',
    });
  });

  test('a head mapped through `functions` runs once', () => {
    // `g` is declared `(real) -> real` by `calls`; `f` has no signature.
    const F = { functions: { f: '_.f', g: '_.f' } };
    for (const json of [
      ['Less', 0, ['g', 'y'], 1],
      ['Equal', 0, ['g', 'y'], 1],
      ['Less', 0, ['f', 'y'], 1],
    ])
      expect(calls(json, { y: 1 }, 0, 0, F).log).toBe('f');
    // After the false pair `1 < 0`, `g(y)` is not called.
    expect(calls(['Less', 'y', 0, ['g', 'y']], { y: 1 }, 0, 0, F)).toEqual({
      value: false,
      log: '',
    });
  });

  test('a run-time broadcast chain evaluates a later operand only after the pairs before it', () => {
    // `f` has no signature, so the chain goes through `_SYS.bcast`. The
    // interpreter stops at the first pair that is `False`.
    const F = { functions: { f: '_.f' } };
    const json = ['Less', 'y', 0, ['f', 'y']];
    expect(calls(json, { y: 1 }, 0, 0, F)).toEqual({ value: false, log: '' });
    // `f(-1)` is `-0.5` (`calls` maps `_.f` to `t / 2`).
    expect(calls(json, { y: -1 }, 0, 0, F)).toEqual({ value: false, log: 'f' });
    expect(calls(['Less', 'y', 5, ['f', 'y'], 3], { y: 7 }, 0, 0, F)).toEqual(
      { value: false, log: '' }
    );
    // A draw at index 2 is not consumed after a false pair.
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const r = compile(ce.box(['Less', ['f', 'y'], 0, ['Random']]), {
      fallback: false,
      ...F,
    })!;
    expect(r.code).toContain('_SYS.bcast');
    const after = (y: number) =>
      withRandomSeedFrame(ce, 7, () => {
        r.run!({ y, f: (t: number) => t } as any);
        return ce._random();
      });
    expect(after(1)).toBe(draw(7, 0));
    expect(after(-1)).toBe(draw(7, 1));
  });

  test('a head mapped through `functions` and declared pure keeps the eager broadcast', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    expect(
      compile(ce.box(['Less', 'y', 0, ['f', 'y']]), {
        fallback: false,
        functions: { f: { source: '_.f', pure: true } },
      } as any)!.code
    ).toBe(
      '_SYS.bcast((_tv1, _tv2, _tv3) => ((_tv1 < _tv2) && (_tv2 < _tv3)), (_.y), (0), (_.f(_.y)))'
    );
  });

  test('interval-js runs caller code only after the pairs before it', () => {
    const ce = new ComputeEngine();
    ce.declare('W', 'real');
    ce.declare('y', 'real');
    const r = compile(ce.box(['Less', 'y', 1, 'W']), {
      to: 'interval-js',
      fallback: false,
      vars: { W: '_.w()' },
    })!;
    const run = (y: number, w: number) => {
      const log: string[] = [];
      const value = r.run!({
        y,
        w: () => (log.push('w'), { lo: w, hi: w }),
      } as any);
      return { value, log: log.join(',') };
    };
    expect(run(5, 2)).toEqual({ value: 'false', log: '' });
    expect(run(0, 2)).toEqual({ value: 'true', log: 'w' });
    expect(run(0, 0)).toEqual({ value: 'false', log: 'w' });
  });

  test('Python keeps the caller provenance in the loop body of a Sum', () => {
    // The statement body of `Sum` is compiled with common-subexpression
    // sharing off; the `vars` entry is still caller code there.
    const ce = new ComputeEngine();
    ce.declare('W', 'real');
    const body = [
      'Block',
      ['Assign', 't', ['Multiply', 2, 'k']],
      ['Boole', ['Less', 't', 'W', 30]],
    ];
    const code = compile(ce.box(['Sum', body, ['Tuple', 'k', 1, 3]]), {
      to: 'python',
      fallback: false,
      vars: { W: 'next_value()' },
    })!.code;
    expect(code.split('next_value()').length - 1).toBe(1);
  });

  test('interval-js and Python bind the caller code of a chain', () => {
    const ce = new ComputeEngine();
    ce.declare('W', 'real');
    const count = (code: string) => code.split('nextValue()').length - 1;
    for (const to of ['interval-js', 'python'] as const)
      for (const h of ['Less', 'Equal'])
        expect(
          count(
            compile(ce.box([h, 1, 'W', 3]), {
              to,
              fallback: false,
              vars: { W: 'nextValue()' },
            })!.code
          )
        ).toBe(1);
    ce.declare('y', 'real');
    // A Python pair with the `None` guard reads its left operand twice.
    expect(
      count(
        compile(ce.box(['Equal', 'W', 'y']), {
          to: 'python',
          fallback: false,
          vars: { W: 'nextValue()' },
        })!.code
      )
    ).toBe(1);
  });

  test('an earlier operand keeps the value it had before later caller code runs', () => {
    // `_.w()` writes the input `y` and returns `w`. The interpreter has the
    // value of each operand from before the next one is evaluated.
    const run = (json: any, y: number, w: number) => {
      const ce = new ComputeEngine();
      ce.declare('W', 'real');
      ce.declare('y', 'real');
      const r = compile(ce.box(json), { fallback: false, ...V })!;
      const env: any = { y };
      env.w = () => ((env.y = -50), w);
      const interp = ce.box(json).subs({ y, W: w }).evaluate();
      return { compiled: r.run!(env), interpreted: interp.symbol === 'True' };
    };
    for (const [json, y, w] of [
      [['Equal', 0, ['Add', 'y', 1], 'W'], -1, 0],
      [['Less', ['Add', 'y', 1], 'W', 3], -1, 1],
      [['Less', 0, 'y', 'W'], 1, 2],
      [['Less', ['Add', 'y', 1], 'W'], -1, 1],
      [['If', ['Less', 0, 'y', 'W'], true, false], 1, 2],
    ] as const)
      expect(run(json, y, w)).toEqual({ compiled: true, interpreted: true });
    // Python and interval-js read the temporary of the earlier operand.
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.declare('W', 'real');
    const code = (to: 'python' | 'interval-js', json: any) =>
      compile(ce.box(json), { to, fallback: false, vars: { W: 'nv()' } })!
        .code;
    expect(code('python', ['Equal', 0, ['Add', 'y', 1], 'W'])).toBe(
      '((lambda _tv1: ((0) == (_tv1)) and (lambda _tv2: ((_tv1) == (_tv2)))(nv()))(y + 1))'
    );
    expect(code('interval-js', ['Less', 0, 'y', 'W'])).toContain(
      '_IA.less(_tv1, _tv2))(nv())'
    );
  });

  test('a `vars` entry that reads another input compiles to its value', () => {
    // `W: '_.z'` differs from the default spelling of `W`, so it counts as
    // caller code.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('W', 'real');
    const interp = (json: any, inputs: Record<string, number>) => {
      const subs: Record<string, number> = { ...inputs };
      if ('z' in subs) {
        subs.W = subs.z;
        delete subs.z;
      }
      const v = ce.box(json).subs(subs).evaluate();
      return v.symbol === 'True' ? true : v.symbol === 'False' ? false : undefined;
    };
    for (const json of [
      ['Less', 'x', 'W'],
      ['Equal', 'x', 'y', 'W'],
    ]) {
      const r = compile(ce.box(json), {
        fallback: false,
        vars: { W: '_.z' },
      })!;
      expect(r.success).toBe(true);
      for (const inputs of [
        { x: 1, y: 0, z: 2 },
        { x: 2, y: 2, z: 2 },
        { x: 1, y: 1, z: 1 },
        { x: 1, y: 1, z: NaN },
      ])
        expect(r.run!({ ...inputs } as any)).toBe(interp(json, inputs));
    }
  });

  test('a symbol with caller code whose stored value reads an input is still bound', () => {
    // `W := y` gives `W` a stored value that reads `y`, but the emitted
    // code of `W` is `_.nextValue()`, which runs once.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.assign('W', ce.box('y', { form: 'raw' }));
    for (const json of [
      ['Less', 'x', 'W'],
      ['Equal', 'x', 'y', 'W'],
    ]) {
      const r = compile(ce.box(json), {
        fallback: false,
        vars: { W: '_.nextValue()' },
      })!;
      for (const [inputs, w, expected, count] of [
        [{ x: 2, y: 2 }, 2, json[0] === 'Less' ? false : true, 1],
        [{ x: 0, y: 1 }, 2, json[0] === 'Less', json[0] === 'Less' ? 1 : 0],
      ] as const) {
        let calls = 0;
        const value = r.run!({
          ...inputs,
          nextValue: () => (calls++, w),
        } as any);
        expect({ value, calls }).toEqual({ value: expected, calls: count });
        if (expected !== undefined) {
          const v = ce.box(json).subs({ ...inputs, W: w }).evaluate();
          expect(v.symbol).toBe(expected ? 'True' : 'False');
        }
      }
    }
  });

  test('a chain with no caller code keeps its code', () => {
    const ce = new ComputeEngine();
    ce.declare('W', 'real');
    ce.declare('y', 'real');
    expect(
      compile(ce.box(['Less', 1, 'y', 3]), { fallback: false })!.code
    ).toMatchInlineSnapshot(
      `"(1 < _.y) && (_.y < 3)"`
    );
    expect(
      compile(ce.box(['Less', 1, 'W', 3]), {
        fallback: false,
        vars: { W: '_.W' },
      })!.code
    ).toMatchInlineSnapshot(
      `"(1 < _.W) && (_.W < 3)"`
    );
  });
});
