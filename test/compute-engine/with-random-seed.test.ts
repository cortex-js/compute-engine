import { ComputeEngine } from '../../src/compute-engine';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';
import {
  withRandomSeedFrame,
  withDrawRollback,
} from '../../src/compute-engine/boxed-expression/utils';

/**
 * `WithRandomSeed` — block-scoped seeding (Phase 1 of the random family
 * redesign, `docs/plans/2026-07-25-random-signature-redesign.md`).
 *
 * The headline contract: the n-th draw of a frame is `hash(seed, n)`, a pure
 * function of the seed and the draw index. So repeated draws WITHIN a frame
 * differ, while the frame as a whole replays identically.
 *
 * Every form is probed on BOTH the box route and the parse route:
 * `WithRandomSeed` is `lazy: true`, so its held operands arrive UNBOUND on
 * those routes, and a `ce.function(...)`-only suite misses that entire failure
 * class (CLAUDE.md, "Common API Traps").
 *
 * These tests use fresh `new ComputeEngine()` instances so they never perturb
 * the shared test engine.
 */

/** The expected n-th draw of a frame seeded `seed`. */
function draw(seed: number | string, n: number): number {
  const [seedLo, seedHi] = foldSeed(seed);
  return frameDraw(seedLo, seedHi, n);
}

/** Evaluate a MathJSON expression on a fresh engine (box route). */
function boxed(json: any): any {
  return new ComputeEngine().box(json);
}

/** Parse LaTeX on a fresh engine (parse route). */
function parsed(latex: string): any {
  return new ComputeEngine().parse(latex);
}

const RANDOM = '\\operatorname{Random}()';
const WRS = '\\operatorname{WithRandomSeed}';

describe('WithRandomSeed — one frame', () => {
  it('two draws inside one frame DIFFER (box route)', () => {
    const expr = boxed([
      'WithRandomSeed',
      42,
      ['List', ['Random'], ['Random']],
    ]);
    const [a, b] = expr.evaluate().ops!.map((x) => x.re);
    expect(a).not.toBe(b);
    expect(a).toBe(draw(42, 0));
    expect(b).toBe(draw(42, 1));
  });

  it('two draws inside one frame DIFFER (parse route)', () => {
    const expr = parsed(`${WRS}(42, \\lbrack${RANDOM}, ${RANDOM}\\rbrack)`);
    const [a, b] = expr.evaluate().ops!.map((x) => x.re);
    expect(a).not.toBe(b);
    expect(a).toBe(draw(42, 0));
    expect(b).toBe(draw(42, 1));
  });

  it('the whole block replays identically on re-evaluation (box route)', () => {
    const expr = boxed([
      'WithRandomSeed',
      42,
      ['List', ['Random'], ['Random']],
    ]);
    expect(expr.evaluate().toString()).toBe(expr.evaluate().toString());
  });

  it('the whole block replays identically on re-evaluation (parse route)', () => {
    const expr = parsed(`${WRS}(42, \\lbrack${RANDOM}, ${RANDOM}\\rbrack)`);
    expect(expr.evaluate().toString()).toBe(expr.evaluate().toString());
  });

  it('two identical frames anywhere produce identical draws', () => {
    const a = boxed(['WithRandomSeed', 42, ['Random']]).evaluate().re;
    const b = boxed(['WithRandomSeed', 42, ['Random']]).evaluate().re;
    expect(a).toBe(b);
    expect(a).toBe(draw(42, 0));
  });
});

describe('WithRandomSeed — string seeds', () => {
  it('a string seed is deterministic (box route)', () => {
    const expr = boxed(['WithRandomSeed', { str: 'cell-a7' }, ['Random']]);
    expect(expr.evaluate().re).toBe(draw('cell-a7', 0));
    expect(expr.evaluate().re).toBe(draw('cell-a7', 0));
  });

  it('a string seed is deterministic (parse route)', () => {
    const expr = parsed(`${WRS}(\\text{cell-a7}, ${RANDOM})`);
    expect(expr.evaluate().re).toBe(draw('cell-a7', 0));
  });

  it('a different string gives a different stream', () => {
    const a = boxed([
      'WithRandomSeed',
      { str: 'cell-a7' },
      ['Random'],
    ]).evaluate().re;
    const b = boxed([
      'WithRandomSeed',
      { str: 'cell-a8' },
      ['Random'],
    ]).evaluate().re;
    expect(a).not.toBe(b);
    expect(b).toBe(draw('cell-a8', 0));
  });

  it('a non-ASCII string seed folds over UTF-16 code units', () => {
    const expr = boxed(['WithRandomSeed', { str: 'café' }, ['Random']]);
    expect(expr.evaluate().re).toBe(draw('café', 0));
  });
});

describe('WithRandomSeed — nesting', () => {
  // The §2 example, asserted exactly: counters are PER FRAME, so an inner
  // frame cannot perturb the outer frame's subsequent draws. This is what
  // makes per-cell seeding safe in a document.
  const json = [
    'WithRandomSeed',
    1,
    ['List', ['Random'], ['WithRandomSeed', 2, ['Random']], ['Random']],
  ];

  it('an inner frame does not perturb the outer frame (box route)', () => {
    const values = boxed(json)
      .evaluate()
      .ops!.map((x) => x.re);
    expect(values).toEqual([draw(1, 0), draw(2, 0), draw(1, 1)]);
  });

  it('an inner frame does not perturb the outer frame (parse route)', () => {
    const latex = `${WRS}(1, \\lbrack${RANDOM}, ${WRS}(2, ${RANDOM}), ${RANDOM}\\rbrack)`;
    const values = parsed(latex)
      .evaluate()
      .ops!.map((x) => x.re);
    expect(values).toEqual([draw(1, 0), draw(2, 0), draw(1, 1)]);
  });

  it('the innermost frame wins', () => {
    const inner = boxed([
      'WithRandomSeed',
      1,
      ['WithRandomSeed', 2, ['Random']],
    ]).evaluate().re;
    expect(inner).toBe(draw(2, 0));
    expect(inner).not.toBe(draw(1, 0));
  });
});

describe('WithRandomSeed — dynamic scoping', () => {
  it('the frame is active through a user-defined function call (box route)', () => {
    const ce = new ComputeEngine();
    // `f(x) := Random()` — the draw is lexically OUTSIDE the frame; dynamic
    // scoping is what makes it framed anyway.
    ce.box(['Assign', 'f', ['Function', ['Random'], 'x']]).evaluate();
    const values = ce
      .box(['WithRandomSeed', 7, ['List', ['f', 0], ['Random']]])
      .evaluate()
      .ops!.map((x) => x.re);
    expect(values).toEqual([draw(7, 0), draw(7, 1)]);
  });

  it('the frame is active through a user-defined function call (parse route)', () => {
    const ce = new ComputeEngine();
    ce.parse(`f(x) \\coloneq ${RANDOM}`).evaluate();
    expect(ce.parse(`${WRS}(7, f(0))`).evaluate().re).toBe(draw(7, 0));
  });

  it('a compiled/interpreted draw outside any frame is unframed again', () => {
    const ce = new ComputeEngine();
    ce.box(['WithRandomSeed', 7, ['Random']]).evaluate();
    expect(ce._randomFrame).toBeUndefined();
  });
});

describe('WithRandomSeed — seed evaluation', () => {
  it('evaluates the seed ONCE per frame entry, not per draw', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('SeedProbe', {
      signature: '() -> finite_real',
      evaluate: () => {
        calls++;
        return ce.number(3);
      },
    });
    const values = ce
      .box([
        'WithRandomSeed',
        ['SeedProbe'],
        ['List', ['Random'], ['Random'], ['Random']],
      ])
      .evaluate()
      .ops!.map((x) => x.re);
    expect(calls).toBe(1);
    expect(values).toEqual([draw(3, 0), draw(3, 1), draw(3, 2)]);
  });

  it('a symbolic seed leaves the whole expression unevaluated (box route)', () => {
    const expr = boxed(['WithRandomSeed', 's', ['Random']]);
    expect(expr.evaluate().toString()).toBe('WithRandomSeed(s, Random())');
  });

  it('a symbolic seed leaves the whole expression unevaluated (parse route)', () => {
    const expr = parsed(`${WRS}(s, ${RANDOM})`);
    expect(expr.evaluate().toString()).toBe('WithRandomSeed(s, Random())');
  });

  it('-0 and 0 give the SAME stream', () => {
    const a = boxed(['WithRandomSeed', -0, ['Random']]).evaluate().re;
    const b = boxed(['WithRandomSeed', 0, ['Random']]).evaluate().re;
    expect(a).toBe(b);
    expect(a).toBe(draw(0, 0));
  });

  it('a seed expression evaluating to NaN is a structured error', () => {
    const result = boxed([
      'WithRandomSeed',
      ['Divide', 0, 0],
      ['Random'],
    ]).evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('out-of-range');
  });

  it('a seed expression evaluating to an infinity is a structured error', () => {
    const result = boxed([
      'WithRandomSeed',
      ['Divide', 1, 0],
      ['Random'],
    ]).evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('out-of-range');
  });

  it('a seed expression evaluating to a non-real is a structured error', () => {
    const result = boxed([
      'WithRandomSeed',
      ['Sqrt', -1],
      ['Random'],
    ]).evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('out-of-range');
  });
});

describe('WithRandomSeed — partial evaluation keeps the frame (Tycho item 104)', () => {
  // A body that cannot finish its draws (an impure application survives
  // evaluation, e.g. a shuffle over a Range with an unbound endpoint) must NOT
  // come back as a partial result stripped of its seed frame: every later
  // draw from the stored partial would be live, silently converting seeded
  // randomness to unseeded. The whole expression stays unevaluated instead —
  // replay is deterministic from draw 0, so completing it later reproduces
  // the single-evaluation stream exactly.
  const WITNESS = ['WithRandomSeed', 123, ['RandomShuffle', ['Range', 1, 'n']]];

  it('an unfinishable body leaves the whole expression unevaluated (box route)', () => {
    expect(boxed(WITNESS).evaluate().toString()).toBe(
      'WithRandomSeed(123, RandomShuffle(Range(1, n)))'
    );
  });

  it('an unfinishable body leaves the whole expression unevaluated (parse route)', () => {
    expect(
      parsed(
        `${WRS}(123, \\operatorname{RandomShuffle}(\\operatorname{Range}(1, n)))`
      )
        .evaluate()
        .toString()
    ).toBe('WithRandomSeed(123, RandomShuffle(Range(1, n)))');
  });

  it('.N() likewise keeps the frame', () => {
    expect(boxed(WITNESS).N().operator).toBe('WithRandomSeed');
  });

  it('evaluate-then-subs replays the SAME stream as subs-then-evaluate', () => {
    const ce = new ComputeEngine();
    const e = ce.box(WITNESS);
    const direct = e.subs({ n: 5 }).N();
    const stored = e.evaluate().subs({ n: 5 }).N();
    expect(stored.isSame(direct)).toBe(true);
    // …and the stored form is deterministic across calls (the filed defect
    // was non-determinism here).
    expect(e.evaluate().subs({ n: 5 }).N().isSame(stored)).toBe(true);
  });

  it('a MIXED partial (a completed draw + a pending one) also stays whole, with exact replay', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'WithRandomSeed',
      7,
      ['List', ['Random'], ['RandomShuffle', ['Range', 1, 'n']]],
    ]);
    expect(e.evaluate().operator).toBe('WithRandomSeed');
    expect(e.subs({ n: 3 }).N().isSame(e.evaluate().subs({ n: 3 }).N())).toBe(
      true
    );
  });

  it('a body that COMPLETES its draws still strips the frame', () => {
    const result = boxed([
      'WithRandomSeed',
      1,
      ['RandomShuffle', ['Range', 1, 5]],
    ]).evaluate();
    expect(result.operator).toBe('List');
  });

  it('a symbolic but draw-free body still strips the frame', () => {
    expect(
      boxed(['WithRandomSeed', 1, ['Add', 'x', 1]])
        .evaluate()
        .toString()
    ).toBe('x + 1');
  });

  it('a body evaluating to a structured error passes the error through', () => {
    const result = boxed([
      'WithRandomSeed',
      1,
      ['RandomSample', ['Range', 1, 3], 5],
    ]).evaluate();
    expect(result.operator).toBe('Error');
  });

  it('a lazy view escaping the frame is a COMPLETED value, not a pending draw (§6 ruling)', () => {
    // `Map(xs, x |-> Random())` evaluates to a lazy view; its lambda draws at
    // materialization, from whatever frame is active THEN. The frame is
    // stripped — the ruled live-draw escape — not preserved.
    const result = parsed(
      `${WRS}(1, \\operatorname{Map}(\\operatorname{Range}(1,3), x \\mapsto ${RANDOM}))`
    ).evaluate();
    expect(result.operator).toBe('Map');
  });

  it('Hold content is inert data, not a pending draw', () => {
    expect(
      boxed(['WithRandomSeed', 1, ['Hold', ['Random']]])
        .evaluate()
        .operator
    ).toBe('Hold');
  });
});

describe('WithRandomSeed — frame stack discipline', () => {
  it('pops the frame when the body throws (helper level)', () => {
    const ce = new ComputeEngine();
    expect(() =>
      withRandomSeedFrame(ce, 3, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(ce._randomFrame).toBeUndefined();
    // A draw evaluated afterwards is unframed (live), so two draws differ.
    const a = ce.box(['Random']).evaluate().re;
    const b = ce.box(['Random']).evaluate().re;
    expect(a).not.toBe(b);
  });

  it('pops the frame when the body throws (operator level)', () => {
    const ce = new ComputeEngine();
    ce.declare('BoomProbe', {
      signature: '() -> finite_real',
      evaluate: () => {
        throw new Error('boom');
      },
    });
    expect(() =>
      ce.box(['WithRandomSeed', 9, ['BoomProbe']]).evaluate()
    ).toThrow('boom');
    expect(ce._randomFrame).toBeUndefined();
    const a = ce.box(['Random']).evaluate().re;
    const b = ce.box(['Random']).evaluate().re;
    expect(a).not.toBe(b);
  });

  it('restores an enclosing frame after a nested frame returns', () => {
    // Covered by the nesting vectors above, but assert the stack itself is
    // empty once the outermost frame returns.
    const ce = new ComputeEngine();
    ce.box(['WithRandomSeed', 1, ['WithRandomSeed', 2, ['Random']]]).evaluate();
    expect(ce._randomFrame).toBeUndefined();
  });
});

describe('WithRandomSeed — draw-index assignment', () => {
  // §4: `n` increments in EVALUATION order, so control flow matters.
  it('If(false, Random(), 0) consumes NO index', () => {
    const values = boxed([
      'WithRandomSeed',
      5,
      ['List', ['If', ['Less', 1, 0], ['Random'], 0], ['Random']],
    ])
      .evaluate()
      .ops!.map((x) => x.re);
    // The untaken branch drew nothing: the trailing draw is index 0.
    expect(values).toEqual([0, draw(5, 0)]);
  });

  it('If(true, Random(), 0) consumes exactly one index', () => {
    const values = boxed([
      'WithRandomSeed',
      5,
      ['List', ['If', ['Less', 0, 1], ['Random'], 0], ['Random']],
    ])
      .evaluate()
      .ops!.map((x) => x.re);
    expect(values).toEqual([draw(5, 0), draw(5, 1)]);
  });

  it('Add(Random(), Random()) consumes exactly 2 indices under evaluate()', () => {
    const values = boxed([
      'WithRandomSeed',
      42,
      ['List', ['Add', ['Random'], ['Random']], ['Random']],
    ])
      .evaluate()
      .ops!.map((x) => x.re);
    // The trailing draw is index 2: the sum consumed exactly two.
    expect(values[1]).toBe(draw(42, 2));
  });

  // PRE-EXISTING DEFECT, not introduced by the frame stack. Under
  // Regression (fixed 2026-07-25): the `Add`/`Multiply` numeric paths passed
  // their RAW ops to `addN`/`mulN` after already evaluating them, so under
  // `numericApproximation` every operand was evaluated a second time and the
  // sum above consumed FOUR indices instead of two. `.N()` and `evaluate()`
  // must consume identically — this is invisible to result-only tests, which
  // is why the assertion is on the trailing draw's index.
  it('.N() does not double-consume draws in an impure operand', () => {
    const values = boxed([
      'WithRandomSeed',
      42,
      ['List', ['Add', ['Random'], ['Random']], ['Random']],
    ])
      .N()
      .ops!.map((x) => x.re);
    expect(values[1]).toBe(draw(42, 2));
  });

  // A `Map` body consumes indices in iteration order — WHEN it is
  // materialized inside the frame. Draws happen at materialization, and the
  // frame is whichever one is active then (that IS dynamic scoping), so this
  // is the arrangement the §4 ordering rule describes.
  it('a Map body consumes indices in iteration order (materialized in-frame)', () => {
    const ce = new ComputeEngine();
    const m = ce
      .box(['Map', ['List', 1, 2, 3], ['Function', ['Random'], 'x']])
      .evaluate();
    const values = withRandomSeedFrame(ce, 11, () =>
      [...m.each()].map((x) => x.re)
    );
    expect(values).toEqual([draw(11, 0), draw(11, 1), draw(11, 2)]);
  });

  // STILL OPEN after Phase 3, and no longer a compile-target gap: compiled
  // draws now reach the frame stack (`_SYS.drawNextRandomNumber()`, spec §7),
  // and an auto-compiled `Map` body drained inside a frame matches the
  // interpreter element for element (`random-compile.test.ts`). What remains
  // is purely a LAZY-COLLECTION question: `WithRandomSeed(s, Map(…))`
  // evaluates to a `Map`, whose elements are drawn when the collection is
  // materialized — here, after the frame has been popped — so the draws are
  // live. That is documented-but-unruled behavior (§4 says nothing about a
  // frame's result escaping the frame), not a defect of the frame stack.
  // RULED 2026-07-25 (spec §4 "Lazy collections draw at materialization
  // time"): a lazy view draws from whatever frame is active WHEN its elements
  // materialize — dynamic scoping applied consistently, not a defect. A
  // caller who wants framed values materializes inside the frame (the test
  // above); a view that escapes its frame and materializes later draws live.
  it('a Map materialized OUTSIDE its frame draws live', () => {
    // `evaluate()` returns the lazy `Map` view; the frame pops before any
    // element materializes. (`view.ops` would be the Map's OPERANDS — the
    // list and the lambda — not its elements; `each()` is materialization.)
    const view = boxed([
      'WithRandomSeed',
      11,
      ['Map', ['List', 1, 2, 3], ['Function', ['Random'], 'x']],
    ]).evaluate();
    const mk = () => Array.from(view.each()).map((x) => x.re);
    const first = mk();
    // Not the framed stream…
    expect(first).not.toEqual([draw(11, 0), draw(11, 1), draw(11, 2)]);
    // …and live: a second materialization draws different values.
    expect(mk()).not.toEqual(first);
  });
});

describe('WithRandomSeed — typing', () => {
  // The `type` handler is load-bearing (§4): a bare `expression` return would
  // make a framed draw opaque and drop comparisons over it off the compile
  // path. It reads the body's type, so the held body must be BOUND — which is
  // what the `canonical` handler's `op.canonical` does.
  //
  // NOTE: the spec states `finite_real`; that is the type of the REDESIGNED
  // `Random` (Phase 2). The legacy `Random` still types `finite_real`, and
  // what is asserted here is the pass-through, not the body's own type.
  it('carries the body type through, PRE-evaluation (box route)', () => {
    expect(boxed(['WithRandomSeed', 42, ['Random']]).type.toString()).toBe(
      'finite_real'
    );
  });

  it('carries the body type through, PRE-evaluation (parse route)', () => {
    expect(parsed(`${WRS}(42, ${RANDOM})`).type.toString()).toBe('finite_real');
  });

  it('carries a collection body type through (box route)', () => {
    expect(
      boxed([
        'WithRandomSeed',
        42,
        ['List', ['Random'], ['Random']],
      ]).type.toString()
    ).toBe('vector<finite_real^2>');
  });

  // `HoldValues` had the same latent gap: its held body arrived unbound, so
  // its `type` handler read `unknown` on the box/parse routes.
  it('HoldValues carries its body type through (box route)', () => {
    expect(boxed(['HoldValues', ['Random']]).type.toString()).toBe(
      'finite_real'
    );
  });

  it('HoldValues carries its body type through (parse route)', () => {
    expect(
      parsed(`\\operatorname{HoldValues}(${RANDOM})`).type.toString()
    ).toBe('finite_real');
  });
});

describe('WithRandomSeed — LaTeX', () => {
  it('parses `\\operatorname{WithRandomSeed}(seed, body)`', () => {
    expect(parsed(`${WRS}(42, ${RANDOM})`).json).toEqual([
      'WithRandomSeed',
      42,
      ['Random'],
    ]);
  });

  it('parse → serialize → parse is stable', () => {
    const ce = new ComputeEngine();
    const first = ce.parse(`${WRS}(42, ${RANDOM})`);
    const latex = first.latex;
    const second = ce.parse(latex);
    expect(second.latex).toBe(latex);
    expect(second.json).toEqual(first.json);
    expect(second.evaluate().re).toBe(draw(42, 0));
  });

  it('parse → serialize → parse is stable for a string seed', () => {
    const ce = new ComputeEngine();
    const first = ce.parse(`${WRS}(\\text{cell-a7}, ${RANDOM})`);
    const latex = first.latex;
    const second = ce.parse(latex);
    expect(second.latex).toBe(latex);
    expect(second.json).toEqual(first.json);
    expect(second.evaluate().re).toBe(draw('cell-a7', 0));
  });
});

describe('withDrawRollback — "errors and symbolic consume 0"', () => {
  // §5 promises a bailing operation consumes NO draw index. Most of the family
  // gets that for free (validation precedes the first draw), but a few paths
  // can only discover failure AFTER drawing — a lazy view that shrank between
  // the count and the `at()` makes the access return `undefined` with the
  // counter already advanced. `withDrawRollback` rewinds it.
  //
  // Unit-tested directly: a shrinking-view repro needs a collection that
  // reports a stable `count` and then fails an in-range `at()` mid-evaluation,
  // which no built-in collection does — the guard is defensive.

  /** Run `fn` inside a frame and report the frame's counter afterwards. */
  function counterAfter(fn: (ce: ComputeEngine) => void): number {
    const ce = new ComputeEngine();
    let n = -1;
    withRandomSeedFrame(ce, 3, () => {
      fn(ce);
      n = ce._randomFrame!.next;
    });
    return n;
  }

  it('rewinds the counter when the body returns undefined', () => {
    expect(
      counterAfter((ce) => {
        ce._random();
        withDrawRollback(ce, () => {
          ce._random();
          ce._random();
          return undefined;
        });
      })
    ).toBe(1);
  });

  it('rewinds the counter when the body returns an Error expression', () => {
    expect(
      counterAfter((ce) => {
        withDrawRollback(ce, () => {
          ce._random();
          return ce.error(['out-of-range', 'a finite collection', 'xs']);
        });
      })
    ).toBe(0);
  });

  it('rewinds the counter when the body throws, and rethrows', () => {
    expect(
      counterAfter((ce) => {
        expect(() =>
          withDrawRollback(ce, () => {
            ce._random();
            throw new Error('boom');
          })
        ).toThrow('boom');
      })
    ).toBe(0);
  });

  it('keeps the counter on success, and returns the value', () => {
    const ce = new ComputeEngine();
    const [n, v] = withRandomSeedFrame(ce, 3, () => {
      const value = withDrawRollback(ce, () => {
        ce._random();
        ce._random();
        return ce.number(1);
      });
      return [ce._randomFrame!.next, value.re] as const;
    });
    expect(n).toBe(2);
    expect(v).toBe(1);
  });

  it('is inert outside a frame (an unframed draw consumes no counter)', () => {
    const ce = new ComputeEngine();
    expect(withDrawRollback(ce, () => 42)).toBe(42);
    expect(withDrawRollback(ce, () => undefined)).toBeUndefined();
    expect(ce._randomFrame).toBeUndefined();
  });
});

describe('Random — unframed', () => {
  it('is non-deterministic across evaluations (box route)', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Random']);
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) values.add(expr.evaluate().re);
    // Live draws: 20 samples collapsing to one value would be a frame leak.
    expect(values.size).toBeGreaterThan(1);
  });

  it('is non-deterministic across evaluations (parse route)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(RANDOM);
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) values.add(expr.evaluate().re);
    expect(values.size).toBeGreaterThan(1);
  });

  it('a draw after a frame returns is live again', () => {
    const ce = new ComputeEngine();
    ce.box(['WithRandomSeed', 42, ['Random']]).evaluate();
    const a = ce.box(['Random']).evaluate().re;
    const b = ce.box(['Random']).evaluate().re;
    expect(a).not.toBe(b);
    expect(a).not.toBe(draw(42, 1));
  });
});

describe('WithRandomSeed — pending-draw detection (review round, 2026-07-28)', () => {
  // The pending gate is keyed on the `drawsRandom` operator flag and on
  // VALUE position: a lazy view escaping as the result draws at
  // materialization (§6 — completed), while the same view beneath a
  // surviving EAGER consumer still owes its draws to the frame.

  it('a pending draw under an eager consumer keeps the frame', () => {
    // `ListFrom` asked for materialization INSIDE the frame; only the
    // unresolved length made it survive. Stripping here converted seeded
    // randomness to live draws.
    const e = boxed([
      'WithRandomSeed',
      1,
      ['ListFrom', ['Map', ['Range', 1, 'n'], ['Function', ['Random'], 'u']]],
    ]);
    const kept = e.evaluate();
    expect(kept.operator).toBe('WithRandomSeed');
    const a = kept.subs({ n: 3 }).N().toString();
    const b = kept.subs({ n: 3 }).N().toString();
    expect(a).toBe(b);
  });

  it('a naked lazy-view escape still strips the frame (§6 unchanged)', () => {
    const e = boxed([
      'WithRandomSeed',
      1,
      ['Map', ['Range', 1, 3], ['Function', ['Random'], 'u']],
    ]);
    expect(e.evaluate().operator).not.toBe('WithRandomSeed');
  });

  it('a surviving non-random impure application does not pin the frame', () => {
    // `Assign` is impure (`pure: false`) but owes nothing to the random
    // stream (`drawsRandom` is false). Under the old `pure`-keyed gate this
    // inert `If` kept the whole expression wrapped forever.
    const e = boxed([
      'WithRandomSeed',
      7,
      ['If', ['Less', 'zz', 1], ['Assign', 'x9', 1], 0],
    ]);
    expect(e.evaluate().operator).not.toBe('WithRandomSeed');
  });

  it('`Repeat(Random(), 3)` completes its draw in-frame and strips (probed against a review concern)', () => {
    // A reviewer conjectured `Repeat` stores permanently-raw `Random()`
    // cells that would pin the frame forever; in fact the cells evaluate
    // in-frame to one completed, seed-deterministic draw.
    const a = boxed(['WithRandomSeed', 5, ['Repeat', ['Random'], 3]])
      .evaluate()
      .toString();
    const b = boxed(['WithRandomSeed', 5, ['Repeat', ['Random'], 3]])
      .evaluate()
      .toString();
    expect(a).toBe(b);
    expect(a.startsWith('[')).toBe(true);
  });

  it('a kept-whole body re-runs on each evaluation — the documented semantics of any unreduced impure expression', () => {
    // Draws replay deterministically; a NON-random side effect in the body
    // executes once per evaluation, exactly like any other expression that
    // did not reduce (`docs/RANDOMNESS-MODEL.md`, "Partial evaluation keeps
    // the frame"). Pipelines must substitute-then-evaluate once, not
    // re-evaluate a stored kept expression.
    const ce = new ComputeEngine();
    ce.assign('ctr', 0);
    ce.declare('n', 'integer');
    const e = ce.box([
      'WithRandomSeed',
      7,
      [
        'Block',
        ['Assign', 'ctr', ['Add', 'ctr', 1]],
        ['RandomShuffle', ['Range', 1, 'n']],
      ],
    ]);
    expect(e.evaluate().operator).toBe('WithRandomSeed');
    expect(ce.box('ctr').evaluate().re).toBe(1);
    e.evaluate();
    expect(ce.box('ctr').evaluate().re).toBe(2);
  });
});

describe('WithRandomSeed — a binder LAZY view is a completed value (Tycho item 106)', () => {
  // `Comprehension(body, Element(k, xs))` — what `[… for k = …]` parses to —
  // is `Map(xs, k |-> body)` spelled without a syntactic `Function` node. The
  // pending-draw walk used to read its unevaluated `Random()` body as work the
  // frame still owed, so the whole expression evaluated to ITSELF and, unlike
  // the unbound-symbol case, nothing would ever complete it: the row drew
  // nothing at all. §6 applies to both spellings alike.

  const COMPREHENSION = [
    'WithRandomSeed',
    424242,
    ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 6]]],
  ];

  it('evaluates to the lazy view, not to itself (box route)', () => {
    const v = boxed(COMPREHENSION).evaluate();
    expect(v.operator).toBe('Comprehension');
    expect(v.isCollection).toBe(true);
    expect(v.count).toBe(6);
    expect([...v.each()].length).toBe(6);
  });

  it('evaluates to the lazy view, not to itself (parse route)', () => {
    const v = parsed(
      '\\mathrm{WithRandomSeed}(424242,[\\mathrm{Random}()\\operatorname{for}k=[1...6]])'
    ).evaluate();
    expect(v.operator).toBe('Comprehension');
    expect([...v.each()].length).toBe(6);
  });

  it('matches the `Map` spelling: the escaped view strips the frame', () => {
    const comprehension = boxed(COMPREHENSION).evaluate();
    const map = boxed([
      'WithRandomSeed',
      424242,
      ['Map', ['Range', 1, 6], ['Function', ['Random'], 'u']],
    ]).evaluate();
    expect(comprehension.operator).not.toBe('WithRandomSeed');
    expect(map.operator).not.toBe('WithRandomSeed');
  });

  it('materializing INSIDE the frame replays (the §6 remedy)', () => {
    const e = boxed([
      'WithRandomSeed',
      424242,
      [
        'ListFrom',
        ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 4]]],
      ],
    ]);
    const a = e.evaluate().toString();
    const b = e.evaluate().toString();
    expect(a).toBe(b);
    expect(a.startsWith('[')).toBe(true);
  });

  it('a comprehension beneath a surviving eager consumer still keeps the frame', () => {
    // `ListFrom` asked for materialization in-frame; only the unresolved
    // length made it survive — the draws are still owed (item 104).
    const e = boxed([
      'WithRandomSeed',
      1,
      [
        'ListFrom',
        ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 'n']]],
      ],
    ]);
    expect(e.evaluate().operator).toBe('WithRandomSeed');
  });

  it('a comprehension CLAUSE that owes draws still keeps the frame (only the body is skipped)', () => {
    // The clause collection is the comprehension's source, the counterpart of
    // a `Map`'s source operand — which the walk has always scanned.
    const e = boxed([
      'WithRandomSeed',
      1,
      [
        'Comprehension',
        'k',
        ['Element', 'k', ['RandomShuffle', ['Range', 1, 'n']]],
      ],
    ]);
    expect(e.evaluate().operator).toBe('WithRandomSeed');
  });
});
