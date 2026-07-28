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

  test('non-broadcast shapes are declined (deep body, annotated parameter)', () => {
    const deep = ce.box([
      'Map',
      ['Range', 1, 150],
      ['Function', ['Add', ['Power', '_1', 2], 1], '_1'],
    ]);
    expect(lowerMapSpine(deep)).toBeUndefined();

    const typed = ce.box([
      'Map',
      ['Range', 1, 5],
      ['Function', ['Add', '_1', 1], ['Typed', '_1', 'number']],
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
   * `makeLambda` step 2 does. */
  const invalid = () => ce.box(['Sqrt', 1, 2, 3]);

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
