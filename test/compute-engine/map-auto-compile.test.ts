import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

/**
 * Auto-compilation of lazy-`Map` element lambdas on numeric drains
 * (design: docs/plans/2026-07-19-map-auto-compile-design.md, ratified
 * 2026-07-19).
 *
 * Every test asserts **counter deltas** on `_mapAutoCompileStats` (reset
 * before each test), so an all-interpreter implementation cannot pass.
 *
 * `precision = 'machine'` mutates the GLOBAL `BigDecimal.precision` static,
 * so it is snapshotted and restored (see `arithmetic.test.ts` precedent).
 */

let savedPrecision: number;
let ce: ComputeEngine;

beforeAll(() => {
  savedPrecision = BigDecimal.precision;
  ce = new ComputeEngine();
  ce.precision = 'machine';
});

afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

beforeEach(() => {
  _resetMapAutoCompileStats();
  ce.jit = 'auto';
});

/** Broadcast a user function over `Range(1, n)` (n > 100 → lazy `Map`),
 * evaluate, and return the evaluated lazy Map. */
function broadcast(fnName: string, n: number) {
  return ce.box([fnName, ['Range', 1, n]]).evaluate();
}

/** Drain a collection's elements as machine floats. */
function drainRe(expr: any): number[] {
  return [...expr.each()].map((x: any) => x.re);
}

describe('Map auto-compile', () => {
  // ── 1. Repro-shaped drain: digit parity + counters ─────────────────────
  test('repro-shaped drain: compiled, digit parity vs interpreter', () => {
    ce.assign(
      'f1',
      ce.box(['Function', ['Add', ['Sin', 'x'], ['Power', 'x', 2]], 'x'])
    );
    const m = broadcast('f1', 500);
    expect(m.operator).toBe('Map');

    const compiled = drainRe(m.N());
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(500);
    expect(compiled).toHaveLength(500);

    // Digit parity vs the machine-precision interpreter (jit off).
    ce.jit = 'off';
    const interpreted = drainRe(m.N());
    ce.jit = 'auto';
    expect(compiled).toEqual(interpreted);
  });

  // ── 2. Cache identity ──────────────────────────────────────────────────
  test('memoized rewrap: second drain reuses the compiled function', () => {
    ce.assign('f2', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f2', 150);

    // The item-39 rewrap is memoized: one logical Map → one rewrapped
    // instance, so per-instance state survives repeated `.N()`.
    expect(m.N()).toBe(m.N());

    drainRe(m.N());
    expect(stats.attempts).toBe(1);

    _resetMapAutoCompileStats();
    drainRe(m.N());
    expect(stats.attempts).toBe(0); // cache hit — no fresh compile
    expect(stats.compiledHits).toBe(150);
  });

  test('re-boxed copy is a new original and runs cold (item-40 contract)', () => {
    ce.assign('f2b', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f2b', 120);
    drainRe(m.N());
    expect(stats.attempts).toBe(1);

    const copy = ce.box(m.json).evaluate();
    _resetMapAutoCompileStats();
    drainRe(copy.N());
    expect(stats.attempts).toBe(1); // fresh instance → fresh attempt
  });

  // ── 3. Exactness contract ──────────────────────────────────────────────
  test('plain evaluate() drain stays exact/symbolic, no attempt', () => {
    ce.assign('f3', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f3', 150);
    const first = [...m.each()][0];
    expect(first.toString()).toBe('sin(1)'); // exact, not 0.841…
    expect(stats.attempts).toBe(0);
  });

  // ── 4. Precision gate ──────────────────────────────────────────────────
  test('bignum precision (including the default 21) never attempts', () => {
    ce.precision = 21; // the DEFAULT engine precision — bignum-preferred
    ce.assign('f4', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f4', 150);
    const els = [...m.N().each()];
    expect(stats.attempts).toBe(0);
    // Bignum digits intact: sin(1) to 21 digits, beyond float64.
    expect(els[0].toString()).toMatch(/^0\.841470984807896506/);

    ce.precision = 50;
    const m2 = broadcast('f4', 150);
    drainRe(m2.N());
    expect(stats.attempts).toBe(0);

    ce.precision = 'machine';
    const m3 = broadcast('f4', 150);
    drainRe(m3.N());
    expect(stats.attempts).toBe(1); // machine → fires
  });

  // ── 5. Invalidation ────────────────────────────────────────────────────
  test('reassigning a captured symbol between drains recompiles', () => {
    ce.assign('k5', 3);
    ce.assign('f5', ce.box(['Function', ['Multiply', 'k5', 'x'], 'x']));
    const m = broadcast('f5', 120);
    const v1 = drainRe(m.N());
    expect(stats.attempts).toBe(1);
    expect(v1[1]).toBe(6); // 3·2

    ce.assign('k5', 4);
    _resetMapAutoCompileStats();
    const v2 = drainRe(m.N());
    expect(stats.recompiles).toBe(1); // dep changed → fresh compile
    expect(v2[1]).toBe(8); // 4·2
  });

  test('reassigning an unrelated symbol revalidates without recompiling', () => {
    ce.assign('k5b', 3);
    ce.assign('unrelated5', 1); // pre-declare: only a REASSIGNMENT of an
    //                             existing def bumps the mutation axis
    ce.assign('f5b', ce.box(['Function', ['Multiply', 'k5b', 'x'], 'x']));
    const m = broadcast('f5b', 120);
    drainRe(m.N());

    ce.assign('unrelated5', 42); // bumps the global mutation axis
    _resetMapAutoCompileStats();
    drainRe(m.N());
    expect(stats.revalidations).toBeGreaterThan(0); // cheap check missed…
    expect(stats.recompiles).toBe(0); // …but deps unchanged: kept
    expect(stats.compiledHits).toBe(120);
  });

  test('mid-drain reassignment is honored on the next element', () => {
    ce.assign('k5c', 10);
    ce.assign('f5c', ce.box(['Function', ['Multiply', 'k5c', 'x'], 'x']));
    const m = broadcast('f5c', 120);
    const it = m.N().each();
    expect(it.next().value!.re).toBe(10); // 10·1
    ce.assign('k5c', 100);
    expect(it.next().value!.re).toBe(200); // 100·2 — the interpreter's
    expect(stats.recompiles).toBe(1); //     per-element re-read semantics
  });

  // ── 6. Transitive captures ─────────────────────────────────────────────
  test('captures through a called user function invalidate correctly', () => {
    ce.assign('k6', 2);
    ce.assign('h6', ce.box(['Function', ['Multiply', 'k6', 'x'], 'x']));
    ce.assign('g6', ce.box(['Function', ['Add', ['h6', 'x'], 1], 'x']));
    const m = broadcast('g6', 120);
    const v1 = drainRe(m.N());
    expect(stats.attempts).toBe(1);
    expect(v1[0]).toBe(3); // 2·1+1

    ce.assign('k6', 5);
    _resetMapAutoCompileStats();
    const v2 = drainRe(m.N());
    expect(stats.recompiles).toBe(1);
    expect(v2[0]).toBe(6); // 5·1+1
  });

  test('an interleaved Sum (ephemeral index writes) does not invalidate', () => {
    ce.assign('f6b', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f6b', 120);
    drainRe(m.N());

    // Ephemeral loop-index writes must not bump the mutation axis
    // (item-38 semantics).
    expect(ce.box(['Sum', 'i6', ['Limits', 'i6', 1, 5]]).evaluate().re).toBe(
      15
    );

    _resetMapAutoCompileStats();
    drainRe(m.N());
    expect(stats.attempts).toBe(0);
    expect(stats.recompiles).toBe(0);
    expect(stats.compiledHits).toBe(120);
  });

  // ── 7. Purity gate ─────────────────────────────────────────────────────
  test('a Random-containing body is ineligible; interpreter serves', () => {
    ce.assign('f7', ce.box(['Function', ['Add', 'x', ['Random']], 'x']));
    const m = broadcast('f7', 120);
    const els = drainRe(m.N());
    expect(stats.attempts).toBe(1); // one attempt…
    expect(stats.compiledHits).toBe(0); // …no compiled elements
    // The interpreter advanced the stream per element.
    expect(els[0]).toBeGreaterThanOrEqual(1);
    expect(els[0]).toBeLessThanOrEqual(2);
    expect(new Set(els.map((v, i) => v - (i + 1))).size).toBeGreaterThan(1);

    // Structural ineligibility is permanent: zero attempts on later drains.
    _resetMapAutoCompileStats();
    drainRe(m.N());
    expect(stats.attempts).toBe(0);
  });

  // ── 8. Free symbols ────────────────────────────────────────────────────
  test('an unbound free symbol blocks compile; assigning re-enables', () => {
    ce.assign('f8', ce.box(['Function', ['Add', 'x', 'q8'], 'x']));
    const m = broadcast('f8', 120);
    const els = [...m.N().each()];
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(0);
    // The interpreter returns symbolic elements (q8 has no value).
    expect(els[0].toString()).toContain('q8');

    ce.assign('q8', 2);
    _resetMapAutoCompileStats();
    const els2 = drainRe(m.N());
    expect(stats.attempts).toBe(1); // the {symbol} mark cleared
    expect(stats.compiledHits).toBe(120);
    expect(els2[0]).toBe(3);
  });

  // ── 9. Runner ABI ──────────────────────────────────────────────────────
  test('a non-numeric source row falls back per-row', () => {
    // A 120-element list with one valueless symbol at position 3.
    const items: unknown[] = Array.from({ length: 120 }, (_, i) => i + 1);
    items[2] = 'w9'; // undeclared symbol
    const m = ce.box(['Sin', ['List', ...(items as number[])]]).evaluate();
    expect(m.operator).toBe('Map');
    const els = [...m.N().each()];
    expect(stats.compiledHits).toBe(119);
    expect(stats.elementFallbacks).toBe(1);
    expect(els[2].toString()).toContain('w9'); // symbolic element preserved
    expect(els[0].re).toBeCloseTo(Math.sin(1), 12);
  });

  test('a boolean-returning body is a permanent ABI failure', () => {
    ce.assign('f9', ce.box(['Function', ['Greater', 'x', 5], 'x']));
    const m = broadcast('f9', 120);
    const els = [...m.N().each()];
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(0);
    expect(stats.elementFallbacks).toBeGreaterThanOrEqual(1);
    expect(els[0].toString()).toMatch(/False/); // interpreter result

    _resetMapAutoCompileStats();
    drainRe(m.N());
    expect(stats.attempts).toBe(0); // 'abi' is permanent
  });

  // ── 10. NaN double-check ───────────────────────────────────────────────
  test('√x over [4, −4]: domain-crossing element gets the interpreter value', () => {
    // User-authored marked Map (shape-identical to the rewrap marker —
    // deliberately covered, D2 route table).
    const m = ce.box([
      'Map',
      ['List', 4, -4],
      ['Function', ['N', ['Sqrt', 'x10']], 'x10'],
    ]);
    const els = [...m.each()];
    expect(els[0].re).toBe(2);
    expect(els[1].re).toBe(0); // 2i: pure imaginary
    expect(els[1].im).toBe(2);
    expect(stats.compiledHits).toBe(1); // the real element
    expect(stats.nanDoubleChecks).toBe(1); // the −4 element
  });

  // ── 11. Failure semantics: deadline ────────────────────────────────────
  test('a deadline during a drain propagates; a later drain succeeds', () => {
    ce.assign('f11', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = ce.box(['f11', ['Range', 1, 2_000_000]]).evaluate();
    expect(() =>
      ce.withTimeLimit(1, () => {
        for (const _ of m.N().each()) {
          /* drain until the every-K deadline check trips */
        }
      })
    ).toThrow();

    // No mark was left: a drain with a fresh budget compiles and runs.
    _resetMapAutoCompileStats();
    const it = m.N().each();
    for (let i = 0; i < 300; i++) it.next();
    expect(stats.compiledHits).toBeGreaterThan(0);
  });

  // ── 12. Tolerance stamp ────────────────────────────────────────────────
  test('changing ce.tolerance between drains recompiles', () => {
    const savedTolerance = ce.tolerance;
    try {
      ce.assign(
        'f12',
        ce.box([
          'Function',
          ['If', ['Equal', 'x', 2], ['Add', 'x', 100], 'x'],
          'x',
        ])
      );
      const m = broadcast('f12', 120);
      drainRe(m.N());
      expect(stats.attempts).toBe(1);

      ce.tolerance = 1e-5; // baked by the equality codegen → stamp mismatch
      _resetMapAutoCompileStats();
      drainRe(m.N());
      expect(stats.recompiles).toBe(1);
    } finally {
      ce.tolerance = savedTolerance;
    }
  });

  // ── 13. Runtime throw ──────────────────────────────────────────────────
  test('runaway compiled recursion surfaces RangeError, not fallback', () => {
    ce.assign('r13', ce.box(['Function', ['Add', ['r13', 'x'], 1], 'x']));
    const m = broadcast('r13', 120);
    expect(() => [...m.N().each()]).toThrow(RangeError);
  });

  // ── 14. Routes ─────────────────────────────────────────────────────────
  test('at()-only access after .N() compiles', () => {
    ce.assign('f14', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f14', 150);
    const n = m.N();
    expect(n.at(3)!.re).toBeCloseTo(Math.sin(3), 12);
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(1);
  });

  test('addN broadcast drain compiles', () => {
    const m = ce.box(['Add', ['Range', 1, 200], 0.5]).N();
    expect(m.operator).toBe('Map');
    const els = drainRe(m);
    expect(els[0]).toBe(1.5);
    expect(stats.compiledHits).toBe(200);
  });

  test('explicit materialization stays interpreted (documented v1 gap)', () => {
    ce.assign('f14b', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f14b', 150);
    // The materialization drain walks the UNMARKED original (it runs before
    // the item-39 rewrap in `_computeValue`), so it does not attempt.
    const materialized = m.evaluate({ materialization: true });
    expect(materialized.operator).toBe('List');
    expect(stats.attempts).toBe(0);
  });

  // ── 15. Silence ────────────────────────────────────────────────────────
  test('no console output on any auto-compile path', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ce.assign('f15', ce.box(['Function', ['Sin', 'x'], 'x']));
      drainRe(broadcast('f15', 120).N()); // compiled path
      ce.assign('f15b', ce.box(['Function', ['Add', 'x', ['Random']], 'x']));
      drainRe(broadcast('f15b', 120).N()); // structural no-compile path
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // ── D7: the ce.jit flag ────────────────────────────────────────────────
  test("ce.jit = 'off' disables the Map path (interpreter parity)", () => {
    ce.assign('f16', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('f16', 120);
    ce.jit = 'off';
    const els = drainRe(m.N());
    expect(stats.attempts).toBe(0);
    expect(els[0]).toBeCloseTo(Math.sin(1), 12);
  });

  // ── Review-round regressions (2026-07-19 staged review) ────────────────
  test('redefining a called user FUNCTION recompiles (operator-def identity)', () => {
    // The binding wrapper survives `ce.assign('h', newLambda)` — only the
    // inner operator def is swapped, and operator defs have no
    // `_writeVersion` — so the dep snapshot must compare operator-def
    // identity or the stale compiled body gets re-stamped.
    ce.assign('hr1', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    ce.assign('gr1', ce.box(['Function', ['Add', ['hr1', 'x'], 1], 'x']));
    const m = broadcast('gr1', 120);
    expect(drainRe(m.N())[0]).toBe(3); // 2·1+1

    ce.assign('hr1', ce.box(['Function', ['Multiply', 10, 'x'], 'x']));
    _resetMapAutoCompileStats();
    expect(drainRe(m.N())[0]).toBe(11); // 10·1+1 — not the stale 3
    expect(stats.recompiles).toBe(1);
  });

  test('changing angularUnit recompiles (compiler-baked input)', () => {
    ce.assign('fr2', ce.box(['Function', ['Sin', 'x'], 'x']));
    const m = broadcast('fr2', 120);
    try {
      expect(drainRe(m.N())[0]).toBeCloseTo(Math.sin(1), 12); // radians

      ce.angularUnit = 'deg';
      _resetMapAutoCompileStats();
      const deg = drainRe(m.N());
      expect(stats.recompiles).toBe(1);
      expect(deg[0]).toBeCloseTo(Math.sin(Math.PI / 180), 12); // sin(1°)

      // Parity with the interpreter under the new unit. The unit-scaled
      // argument goes through different rounding orders on the two routes
      // (compiled `sin(k·x)` vs the interpreter's degree conversion), so
      // agreement is ~1 ulp, not digit-exact — same as the documented
      // complex-power parity contract.
      ce.jit = 'off';
      const interp = drainRe(m.N());
      for (let i = 0; i < deg.length; i++)
        expect(deg[i]).toBeCloseTo(interp[i], 12);
    } finally {
      ce.angularUnit = 'rad';
    }
  });

  test('Block Assign to an ambient symbol is ineligible (upward write)', () => {
    // The interpreter assigns UPWARD to the visible ambient binding (an
    // engine write); the compiled code would emit a bare JS assignment
    // against a constant-folded read — wrong values AND global pollution.
    ce.assign('kr3', 100);
    ce.assign(
      'fr3',
      ce.box([
        'Function',
        ['Block', ['Assign', 'kr3', 'x'], ['Multiply', 'kr3', 2]],
        'x',
      ])
    );
    const m = broadcast('fr3', 120);
    const els = drainRe(m.N());
    expect(stats.compiledHits).toBe(0); // ineligible — interpreter serves
    expect(els.slice(0, 3)).toEqual([2, 4, 6]); // interpreter semantics
  });

  test('literal loop bounds above the trip cap are ineligible', () => {
    // An over-cap Sum would compile into an unguarded loop that no deadline
    // check can interrupt; it must fall back to the (interruptible)
    // interpreter. In-cap big-ops still compile. The 150k-term interpreted sum
    // runs unbounded (no enclosing span); this test is about compile
    // eligibility, not evaluation speed.
    const over = ce.box([
      'Map',
      ['List', 1, 2],
      ['Function', ['N', ['Sum', 'j4', ['Limits', 'j4', 1, 150_000]]], 'x4'],
    ]);
    expect(over.at(1)!.re).toBe((150_000 * 150_001) / 2);
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(0);

    _resetMapAutoCompileStats();
    const inCap = ce.box([
      'Map',
      ['List', 1, 2],
      ['Function', ['N', ['Sum', 'j5', ['Limits', 'j5', 1, 50]]], 'x5'],
    ]);
    expect(inCap.at(1)!.re).toBe(1275);
    expect(stats.compiledHits).toBe(1);
  });

  test('at()-only access recovers after a free symbol is assigned', () => {
    ce.assign('fr5', ce.box(['Function', ['Add', 'x', 'qr5'], 'x']));
    const m = broadcast('fr5', 120);
    const n = m.N();
    expect(n.at(1)!.toString()).toContain('qr5'); // symbolic — no compile
    expect(stats.attempts).toBe(1);

    ce.assign('qr5', 7);
    _resetMapAutoCompileStats();
    // Each at() is its own micro-drain: the cleared {symbol} mark
    // re-attempts without an intervening iterator drain.
    expect(n.at(1)!.re).toBe(8);
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBe(1);
  });

  test("ce.jit = 'off' keeps the numeric quadrature path working", () => {
    ce.jit = 'off';
    const v = ce
      .box(['NIntegrate', ['Function', ['Power', 'x', 2], 'x'], 0, 1])
      .evaluate();
    // With jit off the interpreter-backed integrand goes through the
    // 10⁴-sample Monte-Carlo estimator (~0.3% standard error, stochastic):
    // assert the estimate is sane, not tight.
    expect(v.re).toBeCloseTo(1 / 3, 1);
  });
});
