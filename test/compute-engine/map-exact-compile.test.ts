import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';
import { MIN_EXACT_COMPILE_COUNT } from '../../src/compute-engine/library/map-exact-proof';

/**
 * The EXACT-mode auto-compilation tier for lazy-`Map` `evaluate()` drains
 * (design: `docs/plans/2026-07-31-exact-map-drain-compile-design.md`, ratified
 * 2026-07-31).
 *
 * An unmarked broadcast-shaped lambda that the static proof shows
 * integer-closed and overflow-free compiles, and its results are re-boxed as
 * EXACT integer literals. Every parity assertion here uses `isSame` (not
 * `isEqual`, not `toBeCloseTo`): the tier's contract is element-level
 * bit-identity with the interpreter, not numeric agreement.
 *
 * Assertions are counter DELTAS on `_mapAutoCompileStats` (reset before each
 * test), so an all-interpreter implementation cannot pass.
 *
 * `precision = 'machine'` (and any explicit precision) mutates the GLOBAL
 * `BigDecimal.precision` static, so it is snapshotted and restored.
 */

/** The item-103 witness: `1 + Mod(Range(0,899) + 29, 900)` — three stacked
 * lazy `Map`s over a 900-element `Range`. */
const WITNESS = [
  'Add',
  1,
  ['Mod', ['Add', ['Range', 0, 899], 29], 900],
] as const;

const WITNESS_LATEX =
  '1+\\operatorname{Mod}\\left(\\operatorname{Range}(0,899)+29,900\\right)';

let savedPrecision: number;

beforeAll(() => {
  savedPrecision = BigDecimal.precision;
});

afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

beforeEach(() => {
  _resetMapAutoCompileStats();
});

/** Drain `expr`'s elements. */
function drain(expr: any): any[] {
  return [...expr.each()];
}

/**
 * Drain the same MathJSON twice on ONE engine — once with `ce.jit = 'off'`
 * (pure interpreter), once with the exact tier live — and assert element-level
 * `isSame` identity. Returns the compiled-side elements and the compiled-side
 * counter snapshot.
 */
function parityDrain(ce: any, json: any) {
  ce.jit = 'off';
  const interpreted = drain(ce.box(json).evaluate());
  _resetMapAutoCompileStats();
  ce.jit = 'auto';
  const compiled = drain(ce.box(json).evaluate());
  const snapshot = { ...stats };

  expect(compiled).toHaveLength(interpreted.length);
  for (let i = 0; i < interpreted.length; i++)
    if (!compiled[i].isSame(interpreted[i]))
      throw new Error(
        `element ${i}: compiled ${compiled[i].toString()} (${compiled[
          i
        ].type.toString()}) is not the same as interpreted ${interpreted[
          i
        ].toString()} (${interpreted[i].type.toString()})`
      );
  return { compiled, interpreted, snapshot };
}

describe('exact Map compile — the item-103 witness', () => {
  test('the evaluate() drain compiles and is element-identical', () => {
    const ce = new ComputeEngine() as any;
    const { compiled, snapshot } = parityDrain(ce, WITNESS);

    // Three levels, each compiled once, every element of every level served
    // by compiled code.
    expect(snapshot.attempts).toBe(3);
    expect(snapshot.compiledHits).toBe(900 * 3);
    expect(snapshot.elementFallbacks).toBe(0);
    expect(snapshot.nanDoubleChecks).toBe(0);

    // The values themselves, against plain JS.
    const expected = Array.from(
      { length: 900 },
      (_, i) => 1 + ((i + 29) % 900)
    );
    expect(compiled.map((x) => x.re)).toEqual(expected);

    // R3: EXACT integer literals, not floats that print alike.
    expect(compiled[0].type.toString()).toBe('finite_integer');
    expect(compiled[0].isExact).toBe(true);
    expect(compiled[0].json).toBe(30);
  });

  test('this is the DEFAULT (bignum-preferred) precision — R4', () => {
    // The float tier bails out at bignum precision; the exact tier does not,
    // because a proven-safe integer has the same value in float64 and
    // Decimal. A fresh engine is bignum-preferred (precision 21).
    const ce = new ComputeEngine() as any;
    expect(ce.precision).toBeGreaterThan(15);
    drain(ce.box(WITNESS).evaluate());
    expect(stats.attempts).toBe(3);
    expect(stats.compiledHits).toBe(2700);
  });

  test('a high-precision engine produces the same exact integers', () => {
    const ce = new ComputeEngine() as any;
    ce.precision = 50;
    const { compiled, snapshot } = parityDrain(ce, WITNESS);
    expect(snapshot.compiledHits).toBe(2700);
    expect(compiled[0].isSame(30)).toBe(true);
    expect(compiled[899].isSame(29)).toBe(true);
  });
});

describe('exact Map compile — Euclidean-mod parity on negative dividends', () => {
  // The compiled emission is `(((a % b) + b) % b)`: JS `%` is a REMAINDER, so
  // a negative dividend is where a torn template would diverge from the
  // interpreter's floored convention.
  test('a wholly-negative Range crosses the boundary identically', () => {
    const ce = new ComputeEngine() as any;
    const json = ['Mod', ['Add', ['Range', -2000, -1000], 29], 900];
    const { compiled, snapshot } = parityDrain(ce, json);
    expect(snapshot.compiledHits).toBe(1001 * 2);

    const expected = Array.from({ length: 1001 }, (_, i) => {
      const a = -2000 + i + 29;
      return ((a % 900) + 900) % 900;
    });
    expect(compiled.map((x) => x.re)).toEqual(expected);
    // Every result is a non-negative floored residue, never JS's signed one.
    expect(compiled.every((x) => x.re >= 0)).toBe(true);
  });

  test('a Range straddling 0 is identical too', () => {
    const ce = new ComputeEngine() as any;
    const { compiled } = parityDrain(ce, [
      'Mod',
      ['Add', ['Range', -300, 300], 7],
      13,
    ]);
    const expected = Array.from(
      { length: 601 },
      (_, i) => (((-300 + i + 7) % 13) + 13) % 13
    );
    expect(compiled.map((x) => x.re)).toEqual(expected);
  });

  test('a NEGATIVE modulus follows the divisor sign', () => {
    const ce = new ComputeEngine() as any;
    const { compiled, snapshot } = parityDrain(ce, [
      'Mod',
      ['Range', 1, 200],
      -7,
    ]);
    expect(snapshot.compiledHits).toBe(200);
    expect(compiled.every((x) => x.re <= 0)).toBe(true);
    expect(compiled.map((x) => x.re)).toEqual(
      // `+ 0` normalizes JS's `-0` (the engine's exact 0 is signless).
      Array.from({ length: 200 }, (_, i) => ((((i + 1) % -7) + -7) % -7) + 0)
    );
  });
});

describe('exact Map compile — closed operands', () => {
  test('an unassigned symbol declines; elements stay symbolic', () => {
    const ce = new ComputeEngine() as any;
    ce.declare('qsym', 'number');
    const m = ce.box(['Add', ['Range', 1, 200], 'qsym']).evaluate();
    expect(m.operator).toBe('Map');
    const els = drain(m);
    // The proof is the GATE: it runs before any attempt is recorded, so a
    // declining instance never shows up as a compile attempt.
    expect(stats.attempts).toBe(0);
    expect(stats.compiledHits).toBe(0);
    expect(els[0].toString()).toContain('qsym');

    // Interpreter parity.
    ce.jit = 'off';
    const interpreted = drain(
      ce.box(['Add', ['Range', 1, 200], 'qsym']).evaluate()
    );
    ce.jit = 'auto';
    for (let i = 0; i < els.length; i++)
      expect(els[i].isSame(interpreted[i])).toBe(true);
  });

  test('an assigned integer symbol compiles and stays reactive mid-drain', () => {
    const ce = new ComputeEngine() as any;
    // Declare BEFORE boxing and assign AFTER: an already-valued symbol is
    // folded into the canonical body at broadcast-lambda construction, so the
    // reactive shape needs the value to arrive later.
    ce.declare('yr', 'number');
    const m = ce.box(['Add', ['Range', 1, 200], 'yr']).evaluate();
    ce.assign('yr', 7);
    _resetMapAutoCompileStats();

    const it = m.each();
    expect(it.next().value.isSame(8)).toBe(true); // 1 + 7
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(1);

    // Mid-drain reassignment: honored on the very next element (the
    // interpreter's per-element re-read semantics).
    ce.assign('yr', 100);
    expect(it.next().value.isSame(102)).toBe(true); // 2 + 100
    expect(stats.recompiles).toBe(1);

    // A NON-INTEGER value revokes the proof: the instance falls back to the
    // interpreter rather than compiling against a stale proof.
    ce.assign('yr', 1.5);
    const inexact = it.next().value;
    expect(inexact.re).toBe(4.5); // 3 + 1.5, from the interpreter
    expect(stats.compiledHits).toBe(2); // …not a compiled hit

    // Assigning an integer again re-enables the tier.
    ce.assign('yr', 3);
    expect(it.next().value.isSame(7)).toBe(true); // 4 + 3
    expect(stats.compiledHits).toBe(3);
    expect(stats.attempts).toBe(3);
  });

  // ── The proof must be re-asked at COMPILE time, not just at drain start ──
  //
  // The eligibility proof runs when the drain starts; `attemptCompile` bakes
  // symbol values (`tryFoldKnownSymbol`) when it actually compiles. Those are
  // two different moments, and a mutation in between would compile against
  // bounds the proof never established. That is not a benign staleness: the
  // FINAL result can still be a safe integer while an intermediate partial sum
  // overflowed 2^53, so no runtime guard fires and `ce.number(r)` re-boxes a
  // wrong EXACT integer. (Adversarial review 2026-07-31, finding 1.)
  const BIG = 9000000000000000; // 9·10^15; 2·BIG overflows 2^53 − 1

  /** `Map(Range(1,200), _1 ↦ _1 + s1 + s2 + s3)` with all three at 1, plus a
   * `revoke()` that swaps in ±BIG — bounds under which the left-to-right
   * partial sum `_1 + BIG + BIG` is no longer exact even though the total is. */
  function overflowRig(jit: 'auto' | 'off') {
    const ce = new ComputeEngine() as any;
    ce.jit = jit;
    for (const s of ['os1', 'os2', 'os3']) ce.declare(s, 'number');
    ce.assign('os1', 1);
    ce.assign('os2', 1);
    ce.assign('os3', 1);
    const m = ce.box([
      'Map',
      ['Range', 1, 200],
      ['Function', ['Add', '_1', 'os1', 'os2', 'os3'], '_1'],
    ]);
    const revoke = () => {
      ce.assign('os1', BIG);
      ce.assign('os2', BIG);
      ce.assign('os3', -BIG);
    };
    return { ce, m, revoke };
  }

  test('a mutation between iterator creation and the first element is honored', () => {
    // The gate ran with the tiny values; the compile would have used ±BIG.
    const take = (jit: 'auto' | 'off') => {
      const { m, revoke } = overflowRig(jit);
      const it = m.each();
      revoke(); // AFTER the drain started, BEFORE any element
      return [it.next().value, it.next().value, it.next().value];
    };
    _resetMapAutoCompileStats();
    const compiled = take('auto');
    const snapshot = { ...stats };
    const interpreted = take('off');

    for (let i = 0; i < compiled.length; i++)
      expect([i, compiled[i].toString()]).toEqual([
        i,
        interpreted[i].toString(),
      ]);
    // …and specifically NOT the float64-rounded value the un-gated compile
    // produced (9000000000000004 for the third element).
    expect(compiled[2].isSame(9000000000000003)).toBe(true);
    // Every element came from the interpreter: the revoked proof declined.
    expect(snapshot.compiledHits).toBe(0);
  });

  test('a mid-drain revocation stays declined for every later element', () => {
    // Regression for the second trigger: the compiled branch DELETES its cache
    // when the proof is revoked, so the next element arrives at the "no cache"
    // path — which must decline too, or the just-revoked shape is recompiled
    // and wrong values resume after exactly one correct element.
    const take = (jit: 'auto' | 'off') => {
      const { m, revoke } = overflowRig(jit);
      const it = m.each();
      const out: any[] = [];
      for (let i = 0; i < 3; i++) out.push(it.next().value); // compiled, safe
      revoke();
      for (let i = 0; i < 10; i++) out.push(it.next().value);
      return out;
    };
    _resetMapAutoCompileStats();
    const compiled = take('auto');
    const snapshot = { ...stats };
    const interpreted = take('off');

    for (let i = 0; i < compiled.length; i++)
      expect([i, compiled[i].toString()]).toEqual([
        i,
        interpreted[i].toString(),
      ]);
    // The three pre-revocation elements were compiled; nothing after.
    expect(snapshot.compiledHits).toBe(3);
    expect(compiled.slice(0, 3).map((x) => x.re)).toEqual([4, 5, 6]);
    expect(compiled[3].isSame(9000000000000004)).toBe(true); // 4 + BIG
  });

  test('the symbol is dependency-tracked (a reassignment is never stale)', () => {
    const ce = new ComputeEngine() as any;
    ce.declare('yd', 'number');
    const m = ce.box(['Multiply', ['Range', 1, 200], 'yd']).evaluate();
    ce.assign('yd', 3);
    _resetMapAutoCompileStats();
    expect(
      drain(m)
        .slice(0, 3)
        .map((x) => x.re)
    ).toEqual([3, 6, 9]);
    expect(stats.compiledHits).toBe(200);

    ce.assign('yd', 5);
    _resetMapAutoCompileStats();
    expect(
      drain(m)
        .slice(0, 3)
        .map((x) => x.re)
    ).toEqual([5, 10, 15]);
    expect(stats.recompiles).toBe(1);
  });
});

describe('exact Map compile — the proof declines', () => {
  /** Build a lazy `Map` directly (below the broadcast laziness threshold the
   * engine would evaluate eagerly). */
  function lazyMap(ce: any, source: any, body: any) {
    return ce.box(['Map', source, ['Function', body, '_1']]);
  }

  test('an overflowing Multiply declines; the interpreter stays exact', () => {
    const ce = new ComputeEngine() as any;
    // 200 · 10^15 = 2·10^17 > 2^53 − 1: the propagated interval leaves the
    // exactly-representable integer range.
    const m = ce.box(['Multiply', ['Range', 1, 200], 1e15]).evaluate();
    expect(m.operator).toBe('Map');
    expect(m.at(200).isSame(200e15)).toBe(true);
    expect(stats.attempts).toBe(0);
    expect(stats.compiledHits).toBe(0);
    // The interpreter's EXACT integer, which float64 could not have held.
    expect(m.at(200).isExact).toBe(true);
    expect(m.at(200).json).toBe(200000000000000000);
  });

  test('a Divide body declines (not integer-closed)', () => {
    const ce = new ComputeEngine() as any;
    const m = ce.box(['Divide', ['Range', 1, 200], 2]).evaluate();
    expect(m.operator).toBe('Map');
    expect(m.at(1).toString()).toBe('1/2'); // exact rational, not 0.5
    expect(m.at(2).isSame(1)).toBe(true);
    expect(stats.attempts).toBe(0);
    expect(stats.compiledHits).toBe(0);
  });

  test('a Remainder body declines (its emission divides in float)', () => {
    const ce = new ComputeEngine() as any;
    const m = lazyMap(ce, ['Range', 1, 200], ['Remainder', '_1', 7]);
    expect(m.at(9).isSame(2)).toBe(true);
    expect(stats.attempts).toBe(0);
  });

  test('a ZERO-valued symbolic modulus declines (the interval excludes 0)', () => {
    const ce = new ComputeEngine() as any;
    ce.declare('mz', 'finite_integer');
    const m = lazyMap(ce, ['Range', 1, 200], ['Mod', '_1', 'mz']);
    ce.assign('mz', 0);
    expect(m.at(1).isNaN).toBe(true);
    expect(stats.attempts).toBe(0);
  });

  test('an UNASSIGNED symbolic modulus declines (no value to bound)', () => {
    const ce = new ComputeEngine() as any;
    ce.declare('mu', 'finite_integer');
    const m = lazyMap(ce, ['Range', 1, 200], ['Mod', '_1', 'mu']);
    expect(m.at(1).toString()).toContain('mu'); // symbolic element
    expect(stats.attempts).toBe(0);
    expect(stats.compiledHits).toBe(0);
  });

  test('a symbolic modulus with a NONZERO integer value compiles', () => {
    // The complement of the two declines above: once the symbol holds a
    // provably nonzero integer, the interval rule applies and the tier fires —
    // for a negative modulus too, where the floored convention makes the sign
    // follow the divisor.
    for (const modulus of [7, -7]) {
      const ce = new ComputeEngine() as any;
      ce.declare('mv', 'finite_integer');
      const m = lazyMap(ce, ['Range', 1, 200], ['Mod', '_1', 'mv']);
      ce.assign('mv', modulus);
      _resetMapAutoCompileStats();
      const compiled = drain(m);
      expect([modulus, stats.compiledHits]).toEqual([modulus, 200]);

      ce.jit = 'off';
      const m2 = lazyMap(ce, ['Range', 1, 200], ['Mod', '_1', 'mv']);
      const interpreted = drain(m2);
      ce.jit = 'auto';
      for (let i = 0; i < compiled.length; i++)
        expect([modulus, i, compiled[i].isSame(interpreted[i])]).toEqual([
          modulus,
          i,
          true,
        ]);
      expect(compiled.map((x) => x.re)).toEqual(
        Array.from(
          { length: 200 },
          (_, i) => ((((i + 1) % modulus) + modulus) % modulus) + 0
        )
      );
    }
  });

  test('non-literal Range bounds decline', () => {
    const ce = new ComputeEngine() as any;
    ce.declare('nn', 'integer');
    ce.assign('nn', 200);
    const m = ce.box([
      'Map',
      ['Range', 1, 'nn'],
      ['Function', ['Add', '_1', 1], '_1'],
    ]);
    expect(JSON.stringify(m.json)).toContain('"nn"');
    expect(m.at(1).isSame(2)).toBe(true);
    expect(m.at(5).isSame(6)).toBe(true);
    expect(stats.attempts).toBe(0);
  });

  test('an unknown-length source declines', () => {
    const ce = new ComputeEngine() as any;
    const m = lazyMap(ce, ['Repeat', 5, 200], ['Add', '_1', 1]);
    expect(m.at(1).isSame(6)).toBe(true);
    expect(drain(m)).toHaveLength(200);
    expect(stats.attempts).toBe(0);
  });

  test('a non-integer literal source declines', () => {
    const ce = new ComputeEngine() as any;
    const list = ['List', ...Array.from({ length: 100 }, (_, i) => i + 0.5)];
    const m = lazyMap(ce, list, ['Add', '_1', 1]);
    expect(m.at(1).re).toBe(1.5);
    expect(stats.attempts).toBe(0);
  });

  test('a non-integer-closed head (Sqrt) declines and stays symbolic', () => {
    const ce = new ComputeEngine() as any;
    const m = lazyMap(ce, ['Range', 1, 200], ['Sqrt', '_1']);
    expect(m.at(2).toString()).toBe('sqrt(2)'); // exact, not 1.414…
    expect(stats.attempts).toBe(0);
  });

  test('an identity level is not compiled (pass-through is optimal)', () => {
    const ce = new ComputeEngine() as any;
    const m = lazyMap(ce, ['Range', 1, 200], '_1');
    expect(m.at(7).isSame(7)).toBe(true);
    expect(stats.attempts).toBe(0);
  });
});

describe('exact Map compile — the size floor', () => {
  // PINS AN UNRATIFIED ITERATION DETAIL (`MIN_EXACT_COMPILE_COUNT`, 2026-07-31,
  // pending user review): below the floor the tier does not even attempt,
  // because a ~1 ms compile cannot pay itself back over a handful of elements.
  // If the floor is re-ruled, this whole block moves with it.
  test('the floor is exactly MIN_EXACT_COMPILE_COUNT elements', () => {
    expect(MIN_EXACT_COMPILE_COUNT).toBe(64);
    const ce = new ComputeEngine() as any;
    const map = (n: number) =>
      ce.box(['Map', ['Range', 1, n], ['Function', ['Add', '_1', 1], '_1']]);

    const below = drain(map(MIN_EXACT_COMPILE_COUNT - 1));
    expect(below).toHaveLength(MIN_EXACT_COMPILE_COUNT - 1);
    expect(stats.attempts).toBe(0); // no attempt at all — not even a decline
    expect(below[0].isSame(2)).toBe(true);

    _resetMapAutoCompileStats();
    const at = drain(map(MIN_EXACT_COMPILE_COUNT));
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(MIN_EXACT_COMPILE_COUNT);
    expect(at[0].isSame(2)).toBe(true);
  });
});

describe('exact Map compile — supported heads', () => {
  const ce = new ComputeEngine() as any;
  const map = (body: any, source: any = ['Range', -100, 100]) =>
    ce.box(['Map', source, ['Function', body, '_1']]);

  // EVERY head with a rule in the interval table appears here. The table is a
  // hand-written switch on operator NAMES, so a misspelling is silent — it
  // just declines (fail-closed). This test is what catches it: the ceiling
  // rule shipped as `'Ceiling'`, which is an inert Mathematica alias with no
  // definition, so no `Ceil` body ever compiled until the adversarial review
  // (2026-07-31, finding 10) surfaced it. Add a row here with every new rule.
  test('Abs / Negate / Min / Max / Floor / Ceil / Round / Truncate', () => {
    for (const [body, f] of [
      [['Abs', '_1'], (i: number) => Math.abs(i)],
      [['Negate', '_1'], (i: number) => -i],
      [['Min', '_1', 5], (i: number) => Math.min(i, 5)],
      [['Max', '_1', 5], (i: number) => Math.max(i, 5)],
      [['Floor', '_1'], (i: number) => i],
      [['Ceil', '_1'], (i: number) => i],
      [['Round', '_1'], (i: number) => i],
      [['Truncate', '_1'], (i: number) => i],
      [['Add', '_1', 7], (i: number) => i + 7],
      [['Multiply', '_1', 3], (i: number) => i * 3],
      [['Mod', '_1', 7], (i: number) => ((i % 7) + 7) % 7],
    ] as const) {
      _resetMapAutoCompileStats();
      const m = map(body);
      const els = drain(m);
      expect([body[0], stats.compiledHits]).toEqual([body[0], 201]);
      expect(els.map((x) => x.re)).toEqual(
        // `+ 0` normalizes JS's `-0` (the engine's exact 0 is signless).
        Array.from({ length: 201 }, (_, i) => f(-100 + i) + 0)
      );
      expect(els.every((x) => x.isExact)).toBe(true);
    }
  });

  test('a two-source (zip) level compiles', () => {
    _resetMapAutoCompileStats();
    const m = ce
      .box(['Mod', ['Add', ['Range', 1, 200], ['Range', 1, 200]], 7])
      .evaluate();
    const els = drain(m);
    expect(stats.attempts).toBe(2);
    expect(stats.compiledHits).toBe(400);
    expect(els.map((x) => x.re)).toEqual(
      Array.from({ length: 200 }, (_, i) => (2 * (i + 1)) % 7)
    );
  });

  test('an explicit integer List source compiles', () => {
    _resetMapAutoCompileStats();
    const items = Array.from({ length: 120 }, (_, i) => i - 60);
    const m = ce.box([
      'Map',
      ['List', ...items],
      ['Function', ['Mod', '_1', 7], '_1'],
    ]);
    const els = drain(m);
    expect(stats.compiledHits).toBe(120);
    expect(els.map((x) => x.re)).toEqual(items.map((i) => ((i % 7) + 7) % 7));
  });
});

describe('exact Map compile — route parity', () => {
  test('box, parse, iterator and at() all agree', () => {
    const ce = new ComputeEngine() as any;
    const expected = Array.from(
      { length: 900 },
      (_, i) => 1 + ((i + 29) % 900)
    );

    _resetMapAutoCompileStats();
    const boxed = ce.box(WITNESS).evaluate();
    expect(drain(boxed).map((x) => x.re)).toEqual(expected);
    expect(stats.compiledHits).toBe(2700);

    _resetMapAutoCompileStats();
    const parsed = ce.parse(WITNESS_LATEX).evaluate();
    expect(drain(parsed).map((x) => x.re)).toEqual(expected);
    expect(stats.compiledHits).toBe(2700);

    // Each `at()` is its own micro-drain; three levels per access.
    _resetMapAutoCompileStats();
    const random = ce.box(WITNESS).evaluate();
    expect(random.at(1).isSame(expected[0])).toBe(true);
    expect(random.at(450).isSame(expected[449])).toBe(true);
    expect(random.at(-1).isSame(expected[899])).toBe(true);
    expect(stats.attempts).toBe(3);
    expect(stats.compiledHits).toBe(9);
    // Out-of-band accesses are unaffected.
    expect(random.at(0)).toBeUndefined();
    expect(random.at(901)).toBeUndefined();
  });

  test('`ListFrom` materialization of a lazy slice agrees', () => {
    const ce = new ComputeEngine() as any;
    const w = ce.box(WITNESS).evaluate();
    const head = ce.box(['ListFrom', ['Take', w, 4]]).evaluate();
    expect(head.json).toEqual(['List', 30, 31, 32, 33]);
  });
});

describe('exact Map compile — coexistence with the float tier', () => {
  test('at machine precision `.N()` takes the marked tier, evaluate() the exact one', () => {
    const ce = new ComputeEngine() as any;
    ce.precision = 'machine';
    const w = ce.box(WITNESS);

    _resetMapAutoCompileStats();
    const approx = drain(w.N());
    expect(stats.attempts).toBe(3);
    expect(stats.compiledHits).toBe(2700);
    expect(approx[0].re).toBe(30);

    _resetMapAutoCompileStats();
    const exact = drain(w.evaluate());
    expect(stats.attempts).toBe(3);
    expect(stats.compiledHits).toBe(2700);
    // Same values, but the exact drain yields EXACT integer literals.
    expect(exact[0].isSame(30)).toBe(true);
    expect(exact[0].type.toString()).toBe('finite_integer');
  });

  test("ce.jit = 'off' disables the exact tier too", () => {
    const ce = new ComputeEngine() as any;
    ce.jit = 'off';
    const els = drain(ce.box(WITNESS).evaluate());
    expect(stats.attempts).toBe(0);
    expect(els[0].isSame(30)).toBe(true);
  });
});
