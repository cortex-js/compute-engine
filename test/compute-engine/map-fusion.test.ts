import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';
import {
  lowerMapSpine,
  makeSpineRunner,
} from '../../src/compute-engine/library/map-lowering';

/**
 * Drain-time lowering of stacked lazy broadcast `Map`s ("Map fusion").
 *
 * Design: `docs/plans/2026-07-27-map-fusion-design.md` (ratified 2026-07-27,
 * R1–R6). The lowering is an ITERATION DETAIL: canonical forms are untouched
 * and every element value must be byte-identical to the general path. These
 * tests are therefore all VALUE assertions (plus one canonical-shape pin and
 * one auto-compile stats pin); the perf acceptance lives in the design doc.
 */

/** The item-103 witness: `1 + Mod(Range(0,899) + 29, 900)` — a rotate-shape
 * broadcast that canonicalizes to THREE stacked lazy `Map`s. */
const WITNESS = [
  'Add',
  1,
  ['Mod', ['Add', ['Range', 0, 899], 29], 900],
] as const;

/** `1 + ((i + 29) mod 900)` for i = 0…899 — computed in plain JS. */
const EXPECTED = Array.from({ length: 900 }, (_, i) => 1 + ((i + 29) % 900));

/** The same three-level stack in a spelling the structural gate DECLINES: a
 * two-statement `Block` body (the leading `0` is inert). Same operators, same
 * operand order, same work — but every level goes through `makeLambda`. Used
 * as the general-path control in the parity and perf pins below. */
function generalWitness(ce: ComputeEngine): any {
  const level = (src: any, op: string, k: number) =>
    ce.box([
      'Map',
      src,
      ['Function', ['Block', 0, [op, '_1', k]], '_1'],
    ] as any);
  return level(
    level(level(ce.box(['Range', 0, 899] as any), 'Add', 29), 'Mod', 900),
    'Add',
    1
  );
}

function drainRe(xs: any): number[] {
  return [...xs.each()].map((x: any) => x.re);
}

describe('Map fusion — witness parity', () => {
  const ce = new ComputeEngine();

  test('the `evaluate()` drain matches the JS-computed rotate values', () => {
    const w = ce.box(WITNESS as any).evaluate();
    expect(drainRe(w)).toEqual(EXPECTED);
  });

  test('the `.N()` drain matches the same values', () => {
    const w = ce.box(WITNESS as any).N();
    expect(drainRe(w)).toEqual(EXPECTED);
  });

  test('the canonical form is UNCHANGED: three stacked `Map`s', () => {
    // R1: the lowering is a drain-time detail — no canonical churn.
    const w = ce.box(WITNESS as any).evaluate();
    expect(w.operator).toBe('Map');
    expect(w.op1.operator).toBe('Map');
    expect(w.op1.op1.operator).toBe('Map');
    expect(w.op1.op1.op1.operator).toBe('Range');
    expect(JSON.stringify(w.json)).toBe(
      JSON.stringify([
        'Map',
        [
          'Map',
          [
            'Map',
            ['Range', 0, 899],
            ['Function', ['Block', ['Add', '_1', 29]], '_1'],
          ],
          ['Function', ['Block', ['Mod', '_1', 900]], '_1'],
        ],
        ['Function', ['Block', ['Add', '_1', 1]], '_1'],
      ])
    );
  });
});

describe('Map fusion — the structural gate (R2)', () => {
  const ce = new ComputeEngine();

  test('the witness lowers to three levels over one `Range` base', () => {
    const spine = lowerMapSpine(ce.box(WITNESS as any).evaluate())!;
    expect(spine).toBeDefined();
    expect(spine.bases.map((b) => b.operator)).toEqual(['Range']);
    // Innermost FIRST, each level one application with the parameter in slot
    // 0 and the closed scalar spliced in.
    expect(spine.levels.map((l) => l.op)).toEqual(['Add', 'Mod', 'Add']);
    expect(spine.levels.map((l) => l.slots?.[0])).toEqual([0, 0, 0]);
    expect(spine.levels.map((l) => (l.slots?.[1] as any).re)).toEqual([
      29, 900, 1,
    ]);
    expect(spine.levels.every((l) => l.napprox === false)).toBe(true);
  });

  test('the `.N()` rewrap lowers with the marker honored per level', () => {
    const spine = lowerMapSpine(ce.box(WITNESS as any).N())!;
    expect(spine).toBeDefined();
    expect(spine.levels.every((l) => l.napprox === true)).toBe(true);
  });

  test('the `N`-wrapped mapping-function body is canonical at the source', () => {
    // Both `N`-wrapped constructions rebuild the mapping function from raw
    // material (`lazyMapNumericApproximation` re-boxes from MathJSON,
    // `lazyBroadcastMap` builds with `canonical: false`); `N`'s canonical
    // handler must bind the held body inside the literal's parameter scope,
    // so consumers reading the node structurally get bound operands — the
    // `o.isCanonical ? o : o.canonical` in `lowerMapSpine` is
    // belt-and-suspenders, not the binding mechanism.
    const innerBody = (map: any) => {
      expect(map.operator).toBe('Map');
      const fn = map.ops[map.nops - 1];
      let body = fn.op1;
      if (body.operator === 'Block' && body.nops === 1) body = body.op1;
      expect(body.operator).toBe('N');
      return body.op1;
    };

    // The `.N()`-rewrap route (an already-evaluated lazy Map).
    const rewrapped = innerBody(
      ce
        .box(['Add', ['Range', 1, 200], 29])
        .evaluate()
        .N()
    );
    expect(rewrapped.isCanonical).toBe(true);
    expect(rewrapped.operatorDefinition).toBeDefined();

    // The direct-construction route (broadcast built under `.N()`).
    const direct = innerBody(ce.box(['Sin', ['Range', 1, 200]]).N());
    expect(direct.isCanonical).toBe(true);
    expect(direct.operatorDefinition).toBeDefined();
  });

  test('a variadic bottom level terminates the walk with both sources', () => {
    const m = ce
      .box(['Mod', ['Add', ['Range', 1, 200], ['Range', 1, 200]], 7])
      .evaluate();
    const spine = lowerMapSpine(m)!;
    expect(spine.bases.map((b) => b.operator)).toEqual(['Range', 'Range']);
    expect(spine.levels.map((l) => l.op)).toEqual(['Add', 'Mod']);
    expect(spine.levels[0].arity).toBe(2);
    expect(spine.levels[0].slots).toEqual([0, 1]);
  });

  test('non-broadcast shapes are declined (deep body, unsatisfied annotation)', () => {
    const deep = ce.box([
      'Map',
      ['Range', 1, 150],
      ['Function', ['Add', ['Power', '_1', 2], 1], '_1'],
    ]);
    expect(lowerMapSpine(deep)).toBeUndefined();

    // An annotation the source's element type does NOT satisfy keeps the
    // original decline (the element type is `finite_real`, the annotation
    // `integer`). A SATISFIED annotation is admitted — see the
    // "annotated parameters" block below.
    const typed = ce.box([
      'Map',
      ['List', 1, 2.5, 3],
      ['Function', ['Add', '_1', 1], ['Typed', '_1', 'integer']],
    ]);
    expect(lowerMapSpine(typed)).toBeUndefined();
  });

  test('the lowering is memoized per instance (same object back)', () => {
    const w = ce.box(WITNESS as any).evaluate();
    expect(lowerMapSpine(w)).toBe(lowerMapSpine(w));
  });
});

describe('Map fusion — route parity', () => {
  const ce = new ComputeEngine();

  test('box / parse / function construction agree', () => {
    const boxed = ce.box(WITNESS as any).evaluate();

    const parsed = ce
      .parse(
        '1+\\operatorname{Mod}\\left(\\operatorname{Range}(0,899)+29,900\\right)'
      )
      .evaluate();

    const built = ce
      .function('Add', [
        ce.box(1),
        ce.function('Mod', [
          ce.function('Add', [
            ce.function('Range', [ce.box(0), ce.box(899)]),
            ce.box(29),
          ]),
          ce.box(900),
        ]),
      ])
      .evaluate();

    expect(boxed.operator).toBe('Map');
    expect(parsed.operator).toBe('Map');
    expect(built.operator).toBe('Map');

    expect(drainRe(boxed)).toEqual(EXPECTED);
    expect(drainRe(parsed)).toEqual(EXPECTED);
    expect(drainRe(built)).toEqual(EXPECTED);
  });
});

describe('Map fusion — shape-gate negatives fall back correctly', () => {
  const ce = new ComputeEngine();

  test('deep parameter position (`x |-> x^2 + 1`) still evaluates', () => {
    // Body is `Add(Power(_1, 2), 1)`: the parameter is not a direct operand
    // of the body application, so the level is NOT lowerable.
    const m = ce.box([
      'Map',
      ['Range', 1, 150],
      ['Function', ['Add', ['Power', '_1', 2], 1], '_1'],
    ]);
    expect(drainRe(m)).toEqual(
      Array.from({ length: 150 }, (_, i) => (i + 1) ** 2 + 1)
    );
    expect(m.at(1)?.re).toBe(2);
    expect(m.at(150)?.re).toBe(150 ** 2 + 1);
  });

  test('an annotated (`Typed`) parameter still evaluates', () => {
    const m = ce.box([
      'Map',
      ['Range', 1, 5],
      ['Function', ['Add', '_1', 1], ['Typed', '_1', 'number']],
    ]);
    // The parameter operand is `["Typed", …]`, not a bare symbol.
    expect(m.ops[m.nops - 1].ops[1].operator).toBe('Typed');
    expect(drainRe(m)).toEqual([2, 3, 4, 5, 6]);
  });

  test('an eager small-list broadcast stays eager and unchanged', () => {
    const e = ce.box(['Add', ['List', 1, 2, 3], 1]).evaluate();
    expect(e.operator).toBe('List');
    expect(e.json).toEqual(['List', 2, 3, 4]);
  });
});

describe('Map fusion — reactivity', () => {
  test('a reassigned closed operand is honored per element', () => {
    // R3: closed operands are the ORIGINAL body nodes, so they carry their
    // bindings; nothing is baked at lowering time.
    const ce = new ComputeEngine();
    ce.declare('y', 'number');
    const m = ce.box(['Add', ['Range', 1, 200], 'y']).evaluate();
    expect(m.operator).toBe('Map');

    ce.assign('y', 7);
    expect(m.at(1)?.re).toBe(8);

    ce.assign('y', 100);
    expect(m.at(1)?.re).toBe(101);
    expect(drainRe(m).slice(0, 3)).toEqual([101, 102, 103]);
  });
});

describe('Map fusion — variadic mid-chain level', () => {
  const ce = new ComputeEngine();

  test('a two-source bottom level zips, then the outer level applies', () => {
    const v = ce.box(['Mod', ['Add', ['Range', 1, 200], ['Range', 1, 200]], 7]);
    const m = v.evaluate();
    expect(m.operator).toBe('Map');
    expect(m.op1.nops).toBe(3); // two sources + the mapping function

    const expected = Array.from({ length: 200 }, (_, i) => (2 * (i + 1)) % 7);
    expect(drainRe(m)).toEqual(expected);
    expect(m.at(1)?.re).toBe(2);
    expect(m.at(3)?.re).toBe(6);
    expect(m.at(-1)?.re).toBe(expected[199]);
  });
});

describe('Map fusion — at() route', () => {
  const ce = new ComputeEngine();

  test('random access matches the drained values and keeps its gates', () => {
    const w = ce.box(WITNESS as any).evaluate();
    expect(w.at(1)?.re).toBe(30);
    expect(w.at(1)?.re).toBe(EXPECTED[0]);
    expect(w.at(900)?.re).toBe(EXPECTED[899]);
    expect(w.at(-1)?.re).toBe(EXPECTED[899]);
    expect(w.at(450)?.re).toBe(EXPECTED[449]);
    // Out-of-band accesses stay `undefined` (unchanged convention).
    expect(w.at(0)).toBeUndefined();
    expect(w.at(901)).toBeUndefined();
  });

  test('the composite index gate is the conjunction of every level (NaN)', () => {
    // The general path recurses level by level, so a non-finite index is
    // rejected by the OUTER single-source gate even when the innermost level
    // is a zip (whose own gate is `index < 1`, which NaN passes).
    const zip = ce
      .box(['Mod', ['Add', ['Range', 1, 200], ['Range', 1, 200]], 7])
      .evaluate();
    expect(zip.at(NaN)).toBeUndefined();
    expect(zip.at(0)).toBeUndefined();
    expect(zip.at(201)).toBeUndefined();
  });
});

describe('Map fusion — witness perf pin (§7)', () => {
  const ce = new ComputeEngine();

  test('the lowered witness drain beats the same work through `makeLambda`', () => {
    // Self-normalizing: the SAME work is drained both ways in the SAME
    // process, interleaved, and only the RATIO of the medians is asserted —
    // nothing depends on absolute machine speed.
    const lowered = ce.box(WITNESS as any).evaluate();
    const general = generalWitness(ce);

    expect(lowerMapSpine(lowered)).toBeDefined();
    expect(lowerMapSpine(general)).toBeUndefined();
    // Same values, so the two sides do the same arithmetic.
    expect(drainRe(lowered)).toEqual(EXPECTED);
    expect(drainRe(general)).toEqual(EXPECTED);

    const time = (x: any): number => {
      const t = performance.now();
      drainRe(x);
      return performance.now() - t;
    };
    // Warm both once, then interleave.
    time(lowered);
    time(general);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 5; i++) {
      a.push(time(lowered));
      b.push(time(general));
    }
    const median = (xs: number[]) => xs.slice().sort((x, y) => x - y)[2];
    // Measured headroom is ≥1.6×; the pin fires only on a genuine regression.
    expect(median(a) * 1.15).toBeLessThan(median(b));
  });
});

describe('Map fusion — auto-compile keeps precedence (R4)', () => {
  let savedPrecision: number;

  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
  });

  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  test('the machine-precision `.N()` drain is still served by compiled code', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    _resetMapAutoCompileStats();

    const w = ce.box(WITNESS as any).N();
    expect(drainRe(w)).toEqual(EXPECTED);

    // Three levels compiled once each, every element of every level served by
    // the compiled runner: the lowered loop consults each level's runner.
    expect(stats.attempts).toBe(3);
    expect(stats.compiledHits).toBe(2700);
    expect(stats.elementFallbacks).toBe(0);
  });
});

describe('Map fusion — the row is EVALUATED before a level applies', () => {
  test('an identity level over symbols yields their assigned VALUES', () => {
    // `makeLambda` step 4 evaluates every argument in the calling scope before
    // the body runs. The lowered runner must too: an identity level would
    // otherwise pass the raw symbols through.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.assign('u', 5);
    ce.declare('v', 'number');
    ce.assign('v', 6);

    const m = ce.box(['Map', ['List', 'u', 'v'], ['Function', '_1', '_1']]);
    expect(lowerMapSpine(m)?.levels[0].identity).toBe(true);
    // `.json`, not `.re`: a raw symbol REPORTS its value's `.re`, so only the
    // serialization distinguishes the pass-through of `u` from the value 5.
    expect([...m.each()].map((x) => x.json)).toEqual([5, 6]);
    expect(m.at(1)?.json).toEqual(5);
    expect(m.at(2)?.json).toEqual(6);

    // Same values through the general path (gate defeated by a two-statement
    // `Block` body).
    const gen = ce.box([
      'Map',
      ['List', 'u', 'v'],
      ['Function', ['Block', 0, '_1'], '_1'],
    ]);
    expect(lowerMapSpine(gen)).toBeUndefined();
    expect([...gen.each()].map((x) => x.json)).toEqual([5, 6]);
    expect(gen.at(1)?.json).toEqual(5);
  });

  test('an application level over symbols agrees with the general path', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.assign('u', 5);
    ce.declare('v', 'number');
    ce.assign('v', 6);

    const m = ce.box([
      'Map',
      ['List', 'u', 'v'],
      ['Function', ['Add', '_1', 1], '_1'],
    ]);
    expect(lowerMapSpine(m)).toBeDefined();
    expect([...m.each()].map((x) => x.json)).toEqual([6, 7]);
  });
});

describe('Map fusion — the identity level under the `N` marker', () => {
  const ce = new ComputeEngine();

  test('`Map(Range, x |-> x).N()` lowers as an `N` level and keeps its values', () => {
    const m = ce.box(['Map', ['Range', 1, 150], ['Function', '_1', '_1']]);
    // The bare identity level is a pass-through…
    const plain = lowerMapSpine(m)!;
    expect(plain.levels.map((l) => l.identity)).toEqual([true]);
    expect(drainRe(m)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));

    // …but under the `.N()` rewrap the marker must still be APPLIED, so the
    // level is modelled as an `N` application of the parameter, not a
    // pass-through.
    const n = m.N();
    const spine = lowerMapSpine(n)!;
    expect(spine.levels.map((l) => l.identity)).toEqual([false]);
    expect(spine.levels.map((l) => l.op)).toEqual(['N']);
    expect(spine.levels.map((l) => l.napprox)).toEqual([true]);
    expect(spine.levels[0].slots).toEqual([0]);
    expect(drainRe(n)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(n.at(1)?.re).toBe(1);
    expect(n.at(150)?.re).toBe(150);
  });

  test('a directly-boxed `N`-body identity lowers the same way', () => {
    const d = ce.box(['Map', ['Range', 1, 5], ['Function', ['N', '_1'], '_1']]);
    const spine = lowerMapSpine(d)!;
    expect(spine.levels.map((l) => l.op)).toEqual(['N']);
    expect(spine.levels.map((l) => l.napprox)).toEqual([true]);
    expect(drainRe(d)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('Map fusion — a scope-writing body is NOT lowered', () => {
  test('an `Assign` body leaves the ambient scope untouched', () => {
    // The general path runs the body in a FRESH function frame; the lowered
    // path would evaluate the application in the AMBIENT scope and leak the
    // mutation engine-wide. The gate is the head's definition purity.
    const ce = new ComputeEngine();
    const m = ce.box([
      'Map',
      ['Range', 1, 3],
      ['Function', ['Assign', 'leaked', '_1'], '_1'],
    ]);
    expect(lowerMapSpine(m)).toBeUndefined();
    expect(ce.lookupDefinition('leaked')).toBeUndefined();

    expect(drainRe(m)).toEqual([1, 2, 3]);

    // Nothing escaped the per-call frame.
    expect(ce.lookupDefinition('leaked')).toBeUndefined();
  });
});

describe('Map fusion — level-failure semantics per route (R3)', () => {
  // A level fails when the strict-mode input gate fires or the level's own
  // application produces an invalid value. No lowerable stack reachable from
  // the public surface fails this way (every broadcast operator absorbs a bad
  // operand symbolically), so the mechanism is pinned directly on the runner.
  const ce = new ComputeEngine();

  const spineOf = () => lowerMapSpine(ce.box(WITNESS as any).evaluate())!;
  /** An invalid element: the strict-mode input gate declines on it, exactly as
   * `makeLambda` step 2 does.
   *
   * It has to be invalid WITHOUT yielding an error to bubble — `errorValue`
   * does not descend into collection values, so a list with an invalid element
   * is exactly that case, and it is the one `invoke`'s strict gate exists for.
   * An element that DOES carry an error (`Sqrt(1, 2, 3)`) takes the
   * error-propagation route instead, on both the fused and the general path —
   * see the "Error elements" block below. */
  const invalid = () => ce.box(['List', 1, ['Sqrt', 1, 2, 3]]);

  test('marker mode substitutes the FAILING level marker and continues', () => {
    const spine = spineOf();
    const failed: any[] = [];
    const run = makeSpineRunner(ce, spine, (levelExpr) => {
      failed.push(levelExpr);
      return ce.NaN;
    });
    const v = run([invalid()]);
    // Only the innermost level failed; the marker then flowed through the two
    // remaining levels as an ordinary element value.
    expect(failed.length).toBe(1);
    expect(failed[0]).toBe(spine.levels[0].expr);
    expect(v).toBeDefined();
    expect(v!.toString()).toContain('NaN');
  });

  test('undefined mode short-circuits the whole access', () => {
    const run = makeSpineRunner(ce, spineOf(), () => undefined);
    expect(run([invalid()])).toBeUndefined();
    // A well-formed row is unaffected in either mode.
    expect(run([ce.box(0)])?.re).toBe(EXPECTED[0]);
  });

  test('the `at()` route returns `undefined`, never a marker', () => {
    const w = ce.box(WITNESS as any).evaluate();
    expect(w.at(0)).toBeUndefined();
    expect(w.at(901)).toBeUndefined();
  });
});

describe('Map fusion — laziness and impurity', () => {
  const ce = new ComputeEngine();

  test('an infinite-ish source is not materialized', () => {
    const inf = ce.box(['Add', ['Range', 1, 1e9], 1]).evaluate();
    expect(inf.operator).toBe('Map');
    const head = ce.box(['ListFrom', ['Take', inf, 3]]).evaluate();
    expect(head.json).toEqual(['List', 2, 3, 4]);
  });

  test('a seeded impure body is deterministic across evaluations', () => {
    const build = () =>
      ce.box([
        'WithRandomSeed',
        1234,
        [
          'ListFrom',
          ['Map', ['Range', 1, 5], ['Function', ['Add', 'k', ['Random']], 'k']],
        ],
      ]);
    const a = build().evaluate();
    const b = build().evaluate();
    expect(a.json).toEqual(b.json);
    expect((a as any).nops).toBe(5);
  });
});

//
// CLOSED-OVER VARIABLES (2026-08-06).
//
// The lowered path evaluates each level's application in the AMBIENT scope,
// bypassing `makeLambda` and therefore its scope push. The shape gate treated
// every parameter-free operand as a "closed" value, but a free SYMBOL is not
// closed — it resolves by binding lookup. A lazy `Map` returned from a
// function outlives the frame its lambda closed over, so draining it in the
// caller's scope resolved the captured variable to nothing and silently
// produced a symbolic element:
//
//   f(k) = Map([1,2], x ↦ x + k);  f(100)   ⇒  [k + 1, k + 2]   (was)
//                                            ⇒  [101, 102]      (now)
//
// The closure chain itself was always intact (`captureClosures` rebinds the
// literal to the fresh scope); it was the drain that did not evaluate inside
// it. A level whose operands are all LITERALS — the shape this fusion was
// built for — records no scope and keeps the original zero-scope-work path.
//
describe('Map fusion: closed-over variables', () => {
  const drain = (mj: any, arg: number): string => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', mj, 'k']) as any);
    return ce.box(['f', arg]).evaluate().toString();
  };

  test('an escaping lazy Map resolves its captured variable', () => {
    expect(
      drain(['Map', ['List', 1, 2], ['Function', ['Add', 'x', 'k'], 'x']], 100)
    ).toBe('[101,102]');
  });

  test('the same for a multiplicative body', () => {
    expect(
      drain(
        ['Map', ['List', 1, 2], ['Function', ['Multiply', 'x', 'k'], 'x']],
        100
      )
    ).toBe('[100,200]');
  });

  // `List` is a lowerable head too, and here the captured symbol is a bare
  // operand rather than part of an evaluated arithmetic subexpression.
  test('a captured variable held as a bare operand', () => {
    expect(
      drain(['Map', ['List', 1, 2], ['Function', ['List', 'x', 'k'], 'x']], 100)
    ).toBe('[[1,100],[2,100]]');
  });

  test('a stacked spine resolves the capture at every level', () => {
    expect(
      drain(
        [
          'Map',
          ['Map', ['List', 1, 2], ['Function', ['Add', 'x', 'k'], 'x']],
          ['Function', ['Multiply', 'y', 'k'], 'y'],
        ],
        10
      )
    ).toBe('[110,120]');
  });

  // The motivating shape stays on the untouched path: no operand carries a
  // symbol, so no scope is recorded and the drain does no scope work.
  test('a literal-only level records no closure scope', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Map',
      ['List', 1, 2, 3],
      ['Function', ['Add', 'x', 100], 'x'],
    ]);
    const spine = lowerMapSpine(expr);
    expect(spine).toBeDefined();
    expect(spine!.levels.every((l) => l.closureScope === undefined)).toBe(true);
    expect(expr.evaluate().toString()).toBe('[101,102,103]');
  });

  test('a level with a symbol operand records one', () => {
    const ce = new ComputeEngine();
    ce.assign('scale', 10);
    const expr = ce.box([
      'Map',
      ['List', 1, 2],
      ['Function', ['Multiply', 'x', 'scale'], 'x'],
    ]);
    const spine = lowerMapSpine(expr);
    expect(spine).toBeDefined();
    expect(spine!.levels.some((l) => l.closureScope !== undefined)).toBe(true);
    // A top-level binding resolved on both paths; it must keep doing so.
    expect(expr.evaluate().toString()).toBe('[10,20]');
  });

  // Tycho item 160. The recorded scope is the mapping function's BODY scope,
  // and the drain must push its PARENT. Canonicalizing a nested literal
  // auto-declares the free names of its body — including one the ENCLOSING
  // lambda binds — into that body scope, valueless. Pushing the body scope
  // therefore let the valueless shadow win over the binding that holds the
  // value, and the element came back symbolic; the outer application's
  // binding-keyed substitution then correctly refused to touch it, because it
  // genuinely is a different binding.
  //
  // The general route never had the bug: `makeLambda` pushes the call's fresh
  // scope and reaches the closure chain through its parent, so a body scope is
  // not in its lookup path for a non-parameter name either.
  describe('a nested Map that closes over the outer binder (item 160)', () => {
    const nested = [
      'Map',
      ['List', 1, 2],
      [
        'Function',
        [
          'Max',
          ['Map', ['List', 1, 3], ['Function', ['Multiply', 'j', 'k'], 'j']],
        ],
        'k',
      ],
    ];

    test('the reducing drain substitutes the outer element', () => {
      const ce = new ComputeEngine();
      // min over k of (max over j of j·k) = min(3, 6) = 3
      expect(ce.box(['Min', nested]).evaluate().toString()).toBe('3');
    });

    test('the materializing drain does too', () => {
      const ce = new ComputeEngine();
      expect(ce.box(['ListFrom', nested]).evaluate().toString()).toBe('[3,6]');
    });

    test('a partially-symbolic result keeps the substituted value', () => {
      const ce = new ComputeEngine();
      // The residue must be `x + 3`, never `x + Min(Max(k, 3k), …)`.
      expect(
        ce.box(['Add', 'x', ['Min', nested]]).evaluate().toString()
      ).toBe('x + 3');
    });

    test('the capture resolves at three levels of nesting', () => {
      const ce = new ComputeEngine();
      // max over j of (max over i of i·j·k) at k = 2 → i=2, j=3 → 12
      const inner3 = [
        'Map',
        ['List', 1, 2],
        [
          'Function',
          ['Multiply', 'i', ['Multiply', 'j', 'k']],
          'i',
        ],
      ];
      const mid = [
        'Map',
        ['List', 1, 3],
        ['Function', ['Max', inner3], 'j'],
      ];
      expect(
        ce
          .box(['ListFrom', ['Map', ['List', 2], ['Function', ['Max', mid], 'k']]])
          .evaluate()
          .toString()
      ).toBe('[12]');
    });

    test('the LaTeX surface the item was filed from', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse(
        String.raw`\min(\operatorname{Map}([1,2],k\mapsto \max(\operatorname{Map}([1,3],j\mapsto jk))))`,
        { strict: false } as any
      );
      expect(expr.evaluate().toString()).toBe('3');
    });
  });
});

describe('Map fusion: annotated parameters', () => {
  /**
   * Follow-up (1) of `docs/plans/2026-08-08-lambda-param-element-inference.md`
   * (ruling 4): the structural gate accepts an ANNOTATED mapping-function
   * parameter when the source's element type provably satisfies the
   * annotation.
   *
   * The admission is exactly as wide as the no-op argument allows. The lowered
   * path evaluates the level's application directly, bypassing the
   * per-application `Typed`-parameter enforcement; under annotation-as-contract
   * (ruling 2) an annotated literal must still error LOUDLY on a violating
   * element, so an annotation that is not provably satisfied keeps today's
   * decline and its loud error.
   */

  const annotated = (ce: ComputeEngine, src: any, type: string): any =>
    ce.box([
      'Map',
      src,
      ['Function', ['Add', 'x', 1], ['Typed', 'x', type]],
    ] as any);

  test('a matching annotation fuses, with value parity against the bare spelling', () => {
    const ce = new ComputeEngine();
    const typed = annotated(ce, ['Range', 1, 200], 'number');
    const bare = ce.box([
      'Map',
      ['Range', 1, 200],
      ['Function', ['Add', 'x', 1], 'x'],
    ] as any);

    const spine = lowerMapSpine(typed);
    expect(spine).toBeDefined();
    expect(spine!.levels.map((l) => l.op)).toEqual(['Add']);
    // Downstream the level is structurally identical to the bare-parameter
    // case: the parameter is recorded as its bare inner symbol (slot 0).
    expect(spine!.levels[0].slots?.[0]).toBe(0);
    expect(spine!.levels[0].arity).toBe(1);

    expect(drainRe(typed.evaluate())).toEqual(drainRe(bare.evaluate()));
    expect(typed.evaluate().toString()).toBe(bare.evaluate().toString());
  });

  test('a WIDENING annotation is accepted (element finite_integer, annotation number)', () => {
    const ce = new ComputeEngine();
    const m = annotated(ce, ['List', 1, 2, 3], 'number');
    expect(m.op1.type.toString()).toBe('vector<finite_integer^3>');
    expect(lowerMapSpine(m)).toBeDefined();
    expect(m.evaluate().toString()).toBe('[2,3,4]');
  });

  test('a NARROWING annotation declines, and the loud error is preserved', () => {
    const ce = new ComputeEngine();
    const m = annotated(ce, ['List', 1, 2.5, 3], 'integer');
    expect(lowerMapSpine(m)).toBeUndefined();
    // Exactly what the unfused route has always produced for a violating
    // element: an error value at the mismatching element, not a silent result.
    expect(m.evaluate().toString()).toBe(
      '[2,Error(ErrorCode("incompatible-type", "integer", "finite_real"), 2.5),4]'
    );
  });

  test('an unprovable source element type declines', () => {
    const ce = new ComputeEngine();
    const m = annotated(ce, 'unknownSource', 'number');
    expect(m.op1.type.toString()).toBe('unknown');
    expect(lowerMapSpine(m)).toBeUndefined();
  });

  test('the admission is re-asked when the source type moves', () => {
    // The admission stands in for the enforcement the lowered path bypasses,
    // so — unlike every other outcome of the gate — it is not purely
    // structural and must not be memoized: an INFERRED element type retracts
    // under a reassignment, and the very next drain must decline and error.
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2, 3]));
    const m = ce.box([
      'Map',
      'xs',
      ['Function', ['Add', 'y', 1], ['Typed', 'y', 'integer']],
    ] as any);
    expect(lowerMapSpine(m)).toBeDefined();
    expect([...m.each()].map((x: any) => x.toString())).toEqual([
      '2',
      '3',
      '4',
    ]);

    ce.assign('xs', ce.box(['List', 1, 2.5, 3]));
    expect(lowerMapSpine(m)).toBeUndefined();
    expect([...m.each()].map((x: any) => x.toString()).join(',')).toContain(
      'incompatible-type'
    );
  });

  test('an annotated literal with a closed-over variable resolves it', () => {
    // Mirrors the "closed-over variables" block: the escaping lazy `Map` must
    // resolve `k` through the recorded `closureScope`, annotation or not.
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'Map',
          ['List', 1, 2],
          ['Function', ['Add', 'x', 'k'], ['Typed', 'x', 'number']],
        ],
        'k',
      ]) as any
    );
    expect(ce.box(['f', 100]).evaluate().toString()).toBe('[101,102]');
  });

  test('a stacked spine of annotated levels resolves the capture at every level', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'Map',
          [
            'Map',
            ['List', 1, 2],
            ['Function', ['Add', 'x', 'k'], ['Typed', 'x', 'number']],
          ],
          ['Function', ['Multiply', 'y', 'k'], ['Typed', 'y', 'number']],
        ],
        'k',
      ]) as any
    );
    expect(ce.box(['f', 10]).evaluate().toString()).toBe('[110,120]');
  });

  test('Mod with a negative dividend is identical under an integer annotation', () => {
    // The exact-compile landmine: the JS `Mod` emission has a plain-`%` branch
    // (truncated, not floored) that a bare untyped parameter can never reach.
    // An `integer` annotation makes `isIntegerValued` true, so this pins that
    // the branch STILL does not fire — it also requires `isNonNegative`, which
    // no type annotation can supply.
    const ce = new ComputeEngine();
    const typed = ce.box([
      'Map',
      ['Range', -50, 50],
      ['Function', ['Mod', 'x', 7], ['Typed', 'x', 'integer']],
    ] as any);
    const bare = ce.box([
      'Map',
      ['Range', -50, 50],
      ['Function', ['Mod', 'x', 7], 'x'],
    ] as any);
    expect(lowerMapSpine(typed)).toBeDefined();
    // Floored convention: the sign follows the divisor, so every element is in
    // 0…6 even for the negative half of the range.
    const values = drainRe(typed.evaluate());
    expect(values).toEqual(
      Array.from({ length: 101 }, (_, i) => (((i - 50) % 7) + 7) % 7)
    );
    expect(values).toEqual(drainRe(bare.evaluate()));
  });
});

describe('Map fusion: nominal annotations are not erased', () => {
  /**
   * Review follow-up (fix 1): the admission proof asks its subtype question on
   * the UNRESOLVED element and annotation types. Resolving them first unfolds
   * NOMINAL references, and nominal opacity is deliberately an `isSubtype`
   * property — so a resolved comparison admitted levels whose per-application
   * enforcement DOES fire, and the fused route then answered `False` where the
   * unfused route errors.
   */

  /** The unfused spelling of the same level: a two-statement `Block` body,
   * which the structural gate declines. */
  const unfused = (ce: ComputeEngine, src: any, body: any, param: any): any =>
    ce.box(['Map', src, ['Function', ['Block', 0, body], param]] as any);

  test('a NOMINAL annotation over structural elements declines and errors', () => {
    const ce = new ComputeEngine();
    ce.declareType('pointT', 'tuple<number, number>');
    const src = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
    const body = ['Equal', 'p', ['pointT', 1, 2]];
    const param = ['Typed', 'p', 'pointT'];
    const m = ce.box(['Map', src, ['Function', body, param]] as any);

    expect(lowerMapSpine(m)).toBeUndefined();
    // Byte-identical to the enforcing (unfused) route: a per-element
    // incompatible-type error, NOT a silent `["False","False"]`.
    expect(m.evaluate().toString()).toBe(
      unfused(ce, src, body, param).evaluate().toString()
    );
    expect(m.evaluate().toString()).toContain('incompatible-type');
  });

  test('a STRUCTURAL annotation over nominal elements declines and errors', () => {
    // The mirror direction: erasing the nominal identity on the SOURCE side is
    // just as unsound.
    const ce = new ComputeEngine();
    ce.declareType('pointT', 'tuple<number, number>');
    ce.assign(
      'ps',
      ce.box(['List', ['pointT', 1, 2], ['pointT', 3, 4]] as any)
    );
    expect(ce.box('ps').type.toString()).toBe('list<pointT^2>');

    const body = ['Equal', 'p', ['Tuple', 1, 2]];
    const param = ['Typed', 'p', 'tuple<number, number>'];
    const m = ce.box(['Map', 'ps', ['Function', body, param]] as any);

    expect(lowerMapSpine(m)).toBeUndefined();
    expect(m.evaluate().toString()).toBe(
      unfused(ce, 'ps', body, param).evaluate().toString()
    );
    expect(m.evaluate().toString()).toContain('incompatible-type');
  });

  test('a NOMINAL annotation matching nominal elements is admitted', () => {
    const ce = new ComputeEngine();
    ce.declareType('pointT', 'tuple<number, number>');
    ce.assign(
      'ps',
      ce.box(['List', ['pointT', 1, 2], ['pointT', 3, 4]] as any)
    );
    const m = ce.box([
      'Map',
      'ps',
      ['Function', ['Equal', 'p', ['pointT', 1, 2]], ['Typed', 'p', 'pointT']],
    ] as any);
    expect(lowerMapSpine(m)).toBeDefined();
    expect(m.evaluate().toString()).toBe('["True","False"]');
  });

  test('a STRUCTURAL ALIAS annotation is still admitted', () => {
    // `isSubtype` unfolds an `{alias: true}` reference itself, so dropping the
    // pre-resolution does not narrow the admission for alias types.
    const ce = new ComputeEngine();
    ce.declareType('idT', 'integer', { alias: true });
    const m = ce.box([
      'Map',
      ['List', 1, 2, 3],
      ['Function', ['Add', 'p', 1], ['Typed', 'p', 'idT']],
    ] as any);
    expect(lowerMapSpine(m)).toBeDefined();
    expect(m.evaluate().toString()).toBe('[2,3,4]');
  });
});

describe('Map fusion: Error elements bubble, they are not laundered', () => {
  /**
   * Review follow-up (fix 2): a fused level evaluated its application on an
   * element that WAS an error (an inner enforcing level's per-element
   * diagnostic), turning it into `NaN`. `invoke` step 2 returns such an
   * argument verbatim and never runs the body, so the fused route now mirrors
   * it — fused ≡ unfused is the fusion contract, and the drift was silent.
   */

  /** `Map(Map(cs, y ↦ y + 1), z ↦ z * 2)` — both levels lower. The parameters
   * are AUTO-STAMPED from `cs`'s element type at box time, so reassigning `cs`
   * to a list with a `finite_real` element makes the inner level error on it. */
  const stack = (ce: ComputeEngine, outerBody: any): any =>
    ce.box([
      'Map',
      ['Map', 'cs', ['Function', ['Add', 'y', 1], 'y']],
      ['Function', outerBody, 'z'],
    ] as any);

  test('the auto-stamped shape propagates the error on each() and at()', () => {
    const ce = new ComputeEngine();
    ce.assign('cs', ce.box(['List', 1, 2, 3] as any));
    const fused = stack(ce, ['Multiply', 'z', 2]);
    // The declining spelling of the same outer level (two-statement Block).
    const general = stack(ce, ['Block', 0, ['Multiply', 'z', 2]]);
    expect(lowerMapSpine(fused)).toBeDefined();
    expect(lowerMapSpine(general)).toBeUndefined();
    expect([...fused.each()].map((x: any) => x.toString())).toEqual([
      '4',
      '6',
      '8',
    ]);

    ce.assign('cs', ce.box(['List', 1, 2.5, 3] as any));
    const drained = [...fused.each()].map((x: any) => x.toString());
    expect(drained[1]).toContain('incompatible-type');
    expect(drained[1]).not.toContain('NaN');
    expect(drained).toEqual([...general.each()].map((x: any) => x.toString()));
    // The `at()` route returns the error too — it is the element's VALUE, not
    // a level failure, so it must not short-circuit the access.
    expect(fused.at(2)!.toString()).toBe(general.at(2)!.toString());
    expect(fused.at(2)!.toString()).toContain('incompatible-type');
    expect(fused.at(1)!.toString()).toBe('4');
  });

  test('the hand-annotated shape propagates the error too', () => {
    const ce = new ComputeEngine();
    ce.assign('cs', ce.box(['List', 1, 2, 3] as any));
    const fused = ce.box([
      'Map',
      ['Map', 'cs', ['Function', ['Add', 'y', 1], ['Typed', 'y', 'integer']]],
      ['Function', ['Multiply', 'z', 2], 'z'],
    ] as any);
    expect(lowerMapSpine(fused)).toBeDefined();
    expect(drainRe(fused)).toEqual([4, 6, 8]);

    ce.assign('cs', ce.box(['List', 1, 2.5, 3] as any));
    const drained = [...fused.each()].map((x: any) => x.toString());
    expect(drained[1]).toContain('incompatible-type');
    expect(drained[1]).not.toContain('NaN');
    expect(drained[0]).toBe('4');
    expect(drained[2]).toBe('8');
  });

  test('a BARE-parameter level passes an error element through unchanged', () => {
    // No annotation anywhere in this level: the pre-existing bare-param
    // behavior (NaN) changes too, deliberately — the unfused route has always
    // returned the error verbatim.
    const ce = new ComputeEngine();
    ce.assign('cs', ce.box(['List', 1, 2, 3] as any));
    const errors = ce
      .box([
        'Map',
        ['Map', 'cs', ['Function', ['Add', 'y', 1], 'y']],
        ['Function', ['Multiply', 'z', 2], 'z'],
      ] as any)
      .evaluate();
    ce.assign('cs', ce.box(['List', 1, 2.5, 3] as any));
    // A materialized list carrying an Error element.
    const src = errors.evaluate();
    expect(src.toString()).toContain('incompatible-type');

    // A source declared `unknown` leaves the mapping parameter BARE (there is
    // no element type to stamp it with).
    ce.declare('us', 'unknown');
    ce.assign('us', src);
    const fused = ce.box([
      'Map',
      'us',
      ['Function', ['Multiply', 'w', 3], 'w'],
    ] as any);
    const general = ce.box([
      'Map',
      'us',
      ['Function', ['Block', 0, ['Multiply', 'w', 3]], 'w'],
    ] as any);
    expect(fused.ops[1].json).toEqual([
      'Function',
      ['Block', ['Multiply', 3, 'w']],
      'w',
    ]);
    expect(lowerMapSpine(fused)).toBeDefined();

    const drained = [...fused.each()].map((x: any) => x.toString());
    expect(drained[1]).toContain('incompatible-type');
    expect(drained[1]).not.toContain('NaN');
    expect(drained).toEqual([...general.each()].map((x: any) => x.toString()));
    expect(fused.at(2)!.toString()).toBe(general.at(2)!.toString());
  });
});

describe('Map fusion: an annotated spine is REVALIDATED, not re-derived', () => {
  /**
   * Review follow-up (fix 3a): a type-sensitive spine used to bypass the memo
   * entirely, so every `at()` — each of which is its own micro-drain —
   * re-walked the whole spine. The memo now records the source element-type
   * keys the admission read; a new mutation generation revalidates those keys
   * and only re-derives when one MOVED.
   */

  test('an unrelated assign keeps the memoized spine (same object back)', () => {
    const ce = new ComputeEngine();
    ce.assign('unrelated', ce.box(0));
    const m = ce.box([
      'Map',
      ['Range', 1, 1000],
      ['Function', ['Add', 'x', 1], ['Typed', 'x', 'number']],
    ] as any);
    const first = lowerMapSpine(m);
    expect(first).toBeDefined();

    ce.assign('unrelated', ce.box(42));
    // The admission's evidence — `Range(1, 1000)`'s element type — did not
    // move, so the walk is not repeated.
    expect(lowerMapSpine(m)).toBe(first);
  });

  test('a source type that MOVES still retracts the admission', () => {
    // The revalidation must not turn the memo permanent: this is the pin the
    // whole admission rests on.
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2, 3] as any));
    const m = ce.box([
      'Map',
      'xs',
      ['Function', ['Add', 'y', 1], ['Typed', 'y', 'integer']],
    ] as any);
    const first = lowerMapSpine(m);
    expect(first).toBeDefined();
    ce.assign('unrelated', ce.box(1));
    expect(lowerMapSpine(m)).toBe(first);

    ce.assign('xs', ce.box(['List', 1, 2.5, 3] as any));
    expect(lowerMapSpine(m)).toBeUndefined();
    expect(
      [...(m as any).each()].map((x: any) => x.toString()).join(',')
    ).toContain('incompatible-type');
  });

  test('a NESTED declined annotation re-asks like a single-level one', () => {
    // Review follow-up (fix 4a): the annotation-presence check is taken at
    // EVERY level the walk consults, not just the outermost, so a nested level
    // that declined on its source's type is not memoized permanently. Here the
    // OUTER level's own evidence never moves (the inner `Map`'s element type is
    // `integer` either way) — only the inner level's does.
    const ce = new ComputeEngine();
    const m = ce.box([
      'Map',
      ['Map', 'ws', ['Function', ['Add', 'y', 1], ['Typed', 'y', 'integer']]],
      ['Function', ['Multiply', 'z', 2], 'z'],
    ] as any);
    // `ws` has no value: its element type is unprovable, so the inner level
    // declines and the spine stops there.
    expect(lowerMapSpine(m)!.levels).toHaveLength(1);
    expect(lowerMapSpine(m)!.bases.map((b) => b.operator)).toEqual(['Map']);

    ce.assign('ws', ce.box(['List', 1, 2, 3] as any));
    // The inner annotation is now satisfied: the spine extends.
    expect(lowerMapSpine(m)!.levels).toHaveLength(2);
    expect(drainRe(m)).toEqual([4, 6, 8]);
  });
});
