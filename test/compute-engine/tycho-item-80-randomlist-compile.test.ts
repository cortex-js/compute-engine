/**
 * Tycho item 80 — `RandomList` on the JavaScript compilation target.
 *
 * `RandomList` previously failed closed on the JS target (unsupported
 * operator). Per "compiled = interpreted, or refuse" (D6), the engine-stream
 * form `RandomList(n)` (under a compile-time engine seed) is a random PROCESS:
 * fresh draws per invocation, matching the interpreter's engine stream, but
 * reproducible because recompiling under the same `ce.randomSeed` replays the
 * sequence from the start. The explicit-seed form `RandomList(n, seed)` is a
 * pure random VALUE that matches interpretation bit-for-bit and is the route
 * for call-site-stable draws. Out-of-range counts throw at runtime rather than
 * clamping or returning NaN.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('Item 80 — RandomList compiles (seeded engine, advancing stream)', () => {
  test('RandomList(3) compiles and returns 3 reals in [0, 1)', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 42;
    const r = compile(ce.box(['RandomList', 3]));
    expect(r?.success).toBe(true);
    const out = r?.run?.() as number[];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(3);
    for (const u of out) {
      expect(typeof u).toBe('number');
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  test('two invocations of the compiled fn draw fresh lists (process)', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 42;
    const r = compile(ce.box(['RandomList', 3]));
    const a = r?.run?.() as number[];
    const b = r?.run?.() as number[];
    // The engine-stream form advances across calls — at least one element must
    // differ (fresh per invocation, like the interpreter).
    expect(a.some((v, i) => v !== b[i])).toBe(true);
  });

  test('recompiling under the same seed replays the sequence', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 42;
    const a = compile(ce.box(['RandomList', 3]));
    const b = compile(ce.box(['RandomList', 3]));
    // Fresh compile ⇒ fresh stream from the same mixed seed ⇒ replay.
    const a1 = a?.run?.() as number[];
    const a2 = a?.run?.() as number[];
    const b1 = b?.run?.() as number[];
    const b2 = b?.run?.() as number[];
    // Same invocation index across two compilations is identical (deterministic
    // sequence), and the stream advances (invocation #2 ≠ invocation #1).
    expect(b1).toEqual(a1);
    expect(b2).toEqual(a2);
    expect(a1.some((v, i) => v !== a2[i])).toBe(true);
  });

  test('two distinct RandomList nodes in one expression differ', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 42;
    const r = compile(
      ce.box(['List', ['RandomList', 3], ['RandomList', 3]])
    );
    // Independent per-node streams (distinct compile-time ids).
    const out = r?.run?.() as number[][];
    expect(out[0]).not.toEqual(out[1]);
  });
});

describe('Item 80 — engine-stream state is owned by the compiled function', () => {
  // The advancing stream must live on the compiled function's own `_SYS`
  // bundle, NOT in a process-global map keyed by a monotonic compile id: a
  // global would retain one PRNG closure per compiled random node forever, so
  // a long-lived host that recompiles repeatedly would leak. Owning the store
  // per compiled function lets a discarded function release its streams.
  test('each compiled function gets its own stream store', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 42;
    const a = compile(ce.box(['RandomList', 3]))?.run as unknown as {
      SYS: Record<string, unknown>;
    };
    const b = compile(ce.box(['RandomList', 3]))?.run as unknown as {
      SYS: Record<string, unknown>;
    };
    // Distinct bundles, each owning its own `randomList` binding...
    expect(a.SYS).not.toBe(b.SYS);
    expect(Object.hasOwn(a.SYS, 'randomList')).toBe(true);
    expect(Object.hasOwn(b.SYS, 'randomList')).toBe(true);
    // ...while the stateless helpers stay shared (no per-compile copying).
    expect(a.SYS.at).toBe(b.SYS.at);
  });
});

describe('Item 80 — explicit-seed form matches the interpreter exactly', () => {
  test('RandomList(4, 7) compiled === evaluated (element-for-element)', () => {
    const ce = new ComputeEngine();
    const compiled = compile(ce.box(['RandomList', 4, 7]))?.run?.() as number[];
    const evaluated = (
      ce.box(['RandomList', 4, 7]).evaluate().json as [string, ...number[]]
    ).slice(1) as number[];
    expect(compiled).toEqual(evaluated);
  });
});

describe('Item 80 — a complex explicit seed seeds from its real part', () => {
  // The interpreter seeds from `seedOp.re`. Left alone, `hashSeed` would treat
  // the compiled `{ re, im }` object as a string — returning the empty-string
  // FNV hash and hence a DIFFERENT sequence — so `_SYS.randomList` takes the
  // real part at run time. Run time rather than a compile-time refusal because
  // a seed declared merely `number` cannot be classified statically.
  test('RandomList(n, 1+2i) matches interpretation', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['RandomList', 2, ['Complex', 7, 3]]);
    const r = compile(expr);
    expect(r?.success).toBe(true);
    const evaluated = (expr.evaluate().ops ?? []).map((x) => x.re as number);
    expect(r!.run!()).toEqual(evaluated);
  });

  test('a `number`-typed seed bound to a complex value matches too', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    const r = compile(ce.box(['RandomList', 2, 's'] as any));
    expect(r?.success).toBe(true);
    const evaluated = (
      ce.box(['RandomList', 2, ['Complex', 7, 3]]).evaluate().ops ?? []
    ).map((x) => x.re as number);
    expect(r!.run!({ s: { re: 7, im: 3 } })).toEqual(evaluated);
  });

  test('a real seed still compiles and matches interpretation', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['RandomList', 4, 7]);
    const r = compile(expr);
    expect(r?.success).toBe(true);
    const evaluated = (expr.evaluate().ops ?? []).map((x) => x.re as number);
    expect(r!.run!()).toEqual(evaluated);
  });
});

describe('Item 80 — Tycho witnesses (parse and ce.function routes)', () => {
  test('RandomList(1, 5)[1] compiled === evaluated (parse route)', () => {
    const ce = new ComputeEngine();
    const src = '\\mathrm{RandomList}(1,5)[1]';
    const compiled = compile(ce.parse(src))?.run?.() as number;
    const evaluated = ce.parse(src).evaluate().re;
    expect(compiled).toEqual(evaluated);
  });

  test('RandomList(1, 5)[1] compiled === evaluated (ce.function route)', () => {
    const ce = new ComputeEngine();
    const expr = ce.function('At', [ce.function('RandomList', [1, 5]), 1]);
    const compiled = compile(expr)?.run?.() as number;
    const evaluated = expr.evaluate().re;
    expect(compiled).toEqual(evaluated);
  });

  test('Sum(RandomList(1, n)[1], n=1..10) compiled === evaluated', () => {
    const ce = new ComputeEngine();
    const src = '\\sum_{n=1}^{10}\\mathrm{RandomList}(1,n)[1]';
    const compiled = compile(ce.parse(src))?.run?.() as number;
    const evaluated = ce.parse(src).evaluate().N().re;
    expect(compiled).toBeCloseTo(evaluated, 12);
  });
});

describe('Item 80 — unseeded engine draws fresh each invocation', () => {
  test('compiles; two invocations produce different lists', () => {
    const ce = new ComputeEngine();
    // No engine seed set.
    const r = compile(ce.box(['RandomList', 3]));
    expect(r?.success).toBe(true);
    const a = r?.run?.() as number[];
    const b = r?.run?.() as number[];
    expect(a).toHaveLength(3);
    expect(a).not.toEqual(b);
  });
});

describe('Item 80 — runtime range guard throws (never clamps)', () => {
  test('a negative count throws at runtime', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    // A symbolic count forces the RUNTIME guard inside `_SYS.randomList`.
    const r = compile(ce.box(['RandomList', 'n']));
    expect(r?.success).toBe(true);
    expect(() => r?.run?.({ n: -1 })).toThrow();
  });

  test('a count above the cap throws at runtime', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const r = compile(ce.box(['RandomList', 'n']));
    expect(() => r?.run?.({ n: 2_000_000 })).toThrow();
  });

  test('a within-range symbolic count still draws', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const r = compile(ce.box(['RandomList', 'n']));
    const out = r?.run?.({ n: 3 }) as number[];
    expect(out).toHaveLength(3);
  });

  test('a bad count throws WITHOUT advancing the stream', () => {
    const ce = new ComputeEngine();
    ce.randomSeed = 42;
    ce.declare('n', 'integer');
    const r = compile(ce.box(['RandomList', 'n']));
    // An out-of-range count throws before any draw…
    expect(() => r?.run?.({ n: -1 })).toThrow();
    // …so the first valid draw equals a fresh compilation's first valid draw.
    const afterThrow = r?.run?.({ n: 3 }) as number[];

    const ce2 = new ComputeEngine();
    ce2.randomSeed = 42;
    ce2.declare('n', 'integer');
    const fresh = compile(ce2.box(['RandomList', 'n']));
    const freshFirst = fresh?.run?.({ n: 3 }) as number[];
    expect(afterThrow).toEqual(freshFirst);
  });
});

describe('Item 80 — non-JS targets still fail closed', () => {
  test('a GLSL compile of RandomList(3) does not succeed', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['RandomList', 3]), { to: 'glsl' });
    expect(r?.success).toBe(false);
  });
});
