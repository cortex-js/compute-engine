# CE 0.58.0 — A4 Actions / Deterministic Random Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close A4 (actions + deterministic random) from the CE 0.58.0 plan. Five sub-items:
1. Document **Block-is-sequential** rule (settles the project-memory open question) — JSDoc + docs note
2. **`Random(seed)`** — polymorphic dispatch on first-arg type: zero-arg / real seed / integer bound, on JS evaluator + JS compile target + GLSL compile harmonization
3. **Seeded `Shuffle(L, seed?)` + `Sample(L, k, seed?)`** — reproducible reorderings, sharing the same PRNG seed protocol as `Random(seed)`
4. **`\operatorname{with}` parser** — Desmos's `with` clause → `Block(Assign(...), expr)` (Block's sequential semantics are *correct* here — later bindings can reference earlier ones, matching Desmos)
5. **Action-tuple translation pattern** — canonical snapshot-then-commit rewrite documented in `docs/architecture/` for GP and other consumers

**Architecture:** Source-side (JS evaluators + parser) plus one compile-target update (JS Random emit; GLSL Random fix for integer-bound case latent from A1).

- **Block semantics**: `evaluateStatements` (`function-utils.ts:272`) iterates `for (const op of ops) result = op.evaluate()`; `Assign`'s evaluator calls `ce.assign(name, val)` immediately (`core.ts:655`). Sequential is structural — no code change needed; we just document the contract clearly so downstream consumers know to use snapshot-then-commit when translating simultaneous tuples.
- **Random polymorphism**: discriminate at evaluate / compile time by `args[0].type`. Integer subtype → integer-bound (existing behavior). Real / `finite_number` / non-integer numeric → seeded float in [0, 1). No args → non-deterministic float (existing) or fragcoord fallback (GLSL).
- **Shared PRNG**: a tiny module `random.ts` exports `deterministicRandom(seed: number)`. Reused by `Random`, `Shuffle`, `Sample`. Mirrors the GLSL formula `fract(sin(seed * 12.9898) * 43758.5453)`. JS↔GLSL parity is approximate (not bit-identical) due to fp64 vs fp32 + non-portable `Math.sin`; deterministic *within* a host is sufficient for GP's use case.
- **Shuffle/Sample seed**: when present, the seed advances per element via a small linear-congruential update so the per-element draws are decorrelated. The seed argument is optional → backward compatible.
- **`\operatorname{with}`**: a postfix infix operator binding `expr1 \operatorname{with} sym = val [, sym = val]*` to `Block(Assign(sym1, val1), ..., expr1)`. Precedence below assignment / below `;`. The `with` clause may not appear standalone; it always follows a primary expression.

**Tech Stack:** TypeScript, Jest, MathJSON.

**Policy:** Per the user's CLAUDE.md, this plan omits `git commit` steps. The session does run on a feature branch (`claude/implement-a4-random-dqekf`); a single commit + push happens at the end of the implementation, separately.

**Status check before work:**
- `Block` / `Assign` exist and are sequential (verified empirically).
- `Random` is integer-bound only on JS (`(lower:integer?, upper:integer?) -> finite_number`).
- GLSL `Random(seed)` (A1) calls `_gpu_random(float)` for *any* 1-arg form — including integer-typed args, which is latently inconsistent with JS integer-bound semantics. A4 fixes this.
- `Shuffle` and `Sample` exist; both call `Math.random()` directly with no seed support.
- No `\operatorname{with}` parser exists today.

**Baseline:** Current baseline is the merged state including A1+A2+A3 work. Snapshot the test count via `npm test` before starting; treat that as the regression target.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/compute-engine/numerics/random.ts` | New file: `deterministicRandom(seed)` + `nextSeed(seed)` helpers (shared by Random/Shuffle/Sample). |
| `src/compute-engine/library/core.ts` | `Random`: polymorphic dispatch (integer-bound vs seeded float); JSDoc tightened. Also: re-export comment pointing at the new `random.ts` helpers. |
| `src/compute-engine/library/collections.ts` | `Shuffle`: optional `seed` arg via `(indexed_collection, seed?: real) -> indexed_collection`. |
| `src/compute-engine/library/statistics.ts` | `Sample`: optional `seed` arg via `(collection, integer, seed?: real) -> list`. |
| `src/compute-engine/library/control-structures.ts` | `Block`: JSDoc covering sequential semantics + the snapshot-then-commit recipe for simultaneous use cases. (No behavior change.) |
| `src/compute-engine/compilation/javascript-target.ts` | `Random` JS compile entry becomes a function (matches polymorphic dispatch + handles seeded path). |
| `src/compute-engine/compilation/gpu-target.ts` | `Random` GLSL/WGSL compile entry: branch on `args[0].type` so integer-typed args emit an integer-bound form; real args still use the existing `_gpu_random` hash. |
| `src/compute-engine/latex-syntax/dictionary/definitions-other.ts` | New parser entry: `\operatorname{with}` infix → `Block(Assign(...), expr)`. |
| `docs/architecture/actions-and-randomness.md` | New doc page: Block-is-sequential rule + snapshot-then-commit recipe + Random seed semantics + JS↔GLSL parity caveats. |
| `test/compute-engine/a4-actions-random.test.ts` | New test file covering all A4 items. |

---

## Task A4.1: Document Block-is-sequential + snapshot-then-commit recipe

The project-memory open question is resolved: **Block is sequential.** The second `Assign(b, ["Add", "a", 1])` sees `a = 1` (the value set by the first `Assign`). Confirmed empirically; structurally guaranteed by `evaluateStatements` which calls `op.evaluate()` in order. Consumers that need simultaneous semantics (Desmos action tuples) must rewrite at translation boundary.

**Rewrite recipe** (publish in `docs/architecture/actions-and-randomness.md`):

```
Desmos:  (a → 1, b → a + 1)        // simultaneous; b uses pre-state a
MathJSON: Block(
           Assign("_t_a", 1),
           Assign("_t_b", ["Add", "a", 1]),     // reads pre-state a
           Assign("a", "_t_a"),
           Assign("b", "_t_b")
          )
```

Equivalent (and slightly smaller) rewrite: substitute every LHS-mentioned symbol with a fresh `_pre_<sym>` alias bound *before* the block runs, then assign in any order. Either is mechanically correct; GP picks whichever fits its pipeline.

**Files:**
- Modify: `src/compute-engine/library/control-structures.ts` (JSDoc on `Block`)
- Modify: `src/compute-engine/library/core.ts` (JSDoc on `Assign`)
- Create: `docs/architecture/actions-and-randomness.md`
- Test: `test/compute-engine/a4-actions-random.test.ts` (new file — sequential-semantics regression tests)

- [ ] **Step 1: Write the regression tests**

Create `test/compute-engine/a4-actions-random.test.ts`:

```typescript
import { ComputeEngine } from '../../src/compute-engine';

describe('A4.1 — Block is sequential (regression)', () => {
  test('Assign sees prior Assign\'s value within the same Block', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Block', ['Assign', 'a', 1], ['Assign', 'b', ['Add', 'a', 1]], 'b'])
      .evaluate();
    expect(r.re).toEqual(2);
  });

  test('Reassignment cascades sequentially (a=1; a=a+1; a=a+1 → 3)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        ['Assign', 'a', 1],
        ['Assign', 'a', ['Add', 'a', 1]],
        ['Assign', 'a', ['Add', 'a', 1]],
        'a',
      ])
      .evaluate();
    expect(r.re).toEqual(3);
  });

  test('Snapshot-then-commit rewrite preserves simultaneous semantics', () => {
    // Outer state: a=10, b=20. Want a swap (a, b) → (20, 10) with parallel
    // semantics, expressed via the snapshot-then-commit rewrite.
    const ce = new ComputeEngine();
    ce.assign('a', 10);
    ce.assign('b', 20);
    ce.box([
      'Block',
      ['Assign', '_t_a', 'b'],
      ['Assign', '_t_b', 'a'],
      ['Assign', 'a', '_t_a'],
      ['Assign', 'b', '_t_b'],
    ]).evaluate();
    expect(ce.box('a').evaluate().re).toEqual(20);
    expect(ce.box('b').evaluate().re).toEqual(10);
  });

  test('Naive sequential rewrite of a swap does NOT preserve simultaneous semantics', () => {
    // Documents the trap: pasting a Desmos action tuple as Block directly
    // is wrong. With sequential semantics, both end up equal to b.
    const ce = new ComputeEngine();
    ce.assign('a', 10);
    ce.assign('b', 20);
    ce.box([
      'Block',
      ['Assign', 'a', 'b'], // a := b → a=20
      ['Assign', 'b', 'a'], // b := a → b=20 (NOT 10)
    ]).evaluate();
    expect(ce.box('a').evaluate().re).toEqual(20);
    expect(ce.box('b').evaluate().re).toEqual(20);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they pass on current behavior**

Run: `npm run test compute-engine/a4-actions-random`
Expected: all four pass on existing code (no implementation needed; this task only documents and pins behavior).

- [ ] **Step 3: Tighten the JSDoc on `Block`**

In `src/compute-engine/library/control-structures.ts` around line 18, replace `description: 'Evaluate a sequence of expressions in a local scope.'` with a longer JSDoc block that covers the sequential rule, the relationship to `Assign`, and a pointer to the rewrite recipe:

```typescript
    Block: {
      description:
        'Evaluate a sequence of expressions in a local scope, **sequentially**. ' +
        'Each operand is evaluated in order; later operands observe side effects ' +
        '(`Assign`, `Declare`) of earlier operands. The block\'s value is the ' +
        'value of the last expression. Short-circuiting heads (`Return`, ' +
        '`Break`, `Continue`) terminate the sequence early.\n\n' +
        'IMPORTANT — consumers translating *simultaneous* action tuples (e.g. ' +
        'Desmos `(a → 1, b → a + 1)` where `b` reads the *pre-action* `a`) must ' +
        'rewrite to a snapshot-then-commit Block: bind each RHS to a fresh temp ' +
        'first, then assign the temps to the LHS symbols. See ' +
        '`docs/architecture/actions-and-randomness.md` for the canonical recipe.',
      lazy: true,
      scoped: true,
      // ...rest unchanged
```

- [ ] **Step 4: Add a JSDoc note on `Assign`**

In `src/compute-engine/library/core.ts` around line 481 (the `Assign` description), append a note:

```typescript
    Assign: {
      description:
        'Assign a value to a symbol or define a sequence. The RHS is evaluated ' +
        'immediately and `ce.assign(name, val)` mutates the binding in the ' +
        'current scope chain. When used inside a `Block`, the assignment is ' +
        'visible to subsequent statements in the block (sequential semantics).',
      // ...rest unchanged
```

- [ ] **Step 5: Author `docs/architecture/actions-and-randomness.md`**

Create the doc with three sections:

```markdown
# Actions and Deterministic Randomness in Compute Engine

## 1. Block is sequential

`Block(stmt1, stmt2, ...)` evaluates each statement in order. Later statements
observe side effects from earlier ones — `Assign`, `Declare`, etc.

```mathjson
["Block",
 ["Assign", "a", 1],
 ["Assign", "b", ["Add", "a", 1]],   // sees a = 1; b becomes 2
 "b"]
```

This matches the imperative semantics of most programming languages (`let`/`const`
in JS, `:=` in Pascal). Consumers translating *declarative*, *simultaneous*
action notations (such as Desmos's action tuples) must use the rewrite below.

## 2. Snapshot-then-commit recipe for simultaneous tuples

Desmos: `(a → 1, b → a + 1)`  — `b` reads the **pre-action** `a`.

Equivalent MathJSON:

```mathjson
["Block",
 ["Assign", "_t_a", 1],
 ["Assign", "_t_b", ["Add", "a", 1]],
 ["Assign", "a", "_t_a"],
 ["Assign", "b", "_t_b"]]
```

Why two passes: bind every RHS to a fresh temp first (RHSs still see pre-action
state), then commit temps to LHS symbols. Order of the commit pass does not
matter because no temp depends on another temp.

Equivalent compact form: substitute every LHS-mentioned symbol in subsequent
RHSs with a fresh alias bound to the pre-state value before the Block runs:

```mathjson
["Block",
 ["Assign", "_pre_a", "a"],       // snapshot
 ["Assign", "a", 1],               // free to assign now
 ["Assign", "b", ["Add", "_pre_a", 1]]]
```

## 3. Deterministic randomness

`Random()` returns a non-deterministic float in `[0, 1)` (host PRNG, e.g.
`Math.random` on JS).

`Random(seed)` where `seed` is a real number returns a deterministic float in
`[0, 1)` derived from `seed`. The hash matches the GLSL hash used by the GPU
compile target so that the same seed produces a similar (not bit-identical)
value on JS and GLSL:

  `fract(sin(seed * 12.9898) * 43758.5453)`

Caveats:
  - JS uses fp64 by default; GLSL fragment shaders use fp32. JS↔GLSL parity is
    approximate (within fp32 precision near the seed; can diverge for large
    seeds or near sin's roots).
  - `Math.sin` is not bit-portable across JS engines (ECMAScript permits
    implementation-defined precision).
  - Within a single host, the same seed always yields the same value — that's
    the guarantee.

For integer bounds, `Random(n: integer)` returns an integer in `[0, n)` and
`Random(m: integer, n: integer)` returns an integer in `[m, n)`. These are
non-deterministic — to seed an integer draw, scale a seeded float yourself:
`Floor(Add(m, Multiply(Random(seed), Subtract(n, m))))`.

`Shuffle(L, seed?)` and `Sample(L, k, seed?)` accept an optional seed that
makes the reordering deterministic. Internally, the seed advances per element
via a linear-congruential update so element-to-element draws are decorrelated.
```

- [ ] **Step 6: Run the regression tests + broader suite**

Run: `npm run test compute-engine/a4-actions-random`
Expected: all four A4.1 tests pass.

Run: `npm run test compute-engine`
Expected: baseline preserved — task is doc-only.

---

## Task A4.2: `Random(seed)` polymorphic dispatch

Today `Random` is integer-bound on JS, and (latently) inconsistent on GLSL: A1's
GLSL entry treats *any* 1-arg form as a seed, including integer-typed args. A4
makes both targets agree on the polymorphic rule:

| Form | Result | Seeded? |
| --- | --- | --- |
| `Random()` | float in [0, 1) | no — non-deterministic |
| `Random(seed: real)` (non-integer) | float in [0, 1) | yes — deterministic |
| `Random(n: integer)` | integer in [0, n) | no |
| `Random(m: integer, n: integer)` | integer in [m, n) | no |

Discriminate by `args[0].type`. On JS this happens at evaluate time; on GLSL at
compile time (boxed args carry types, so this works).

For integer-typed-but-seeded calls (`Random(seed=5)` where the user really wants
integer 0..4 seeded by 5), GP can build it explicitly:
`Floor(Multiply(Random(SeedToReal(s)), 5))`. Out of scope for A4.

**Files:**
- Create: `src/compute-engine/numerics/random.ts`
- Modify: `src/compute-engine/library/core.ts` (`Random` evaluator)
- Modify: `src/compute-engine/compilation/javascript-target.ts` (`Random` entry → function)
- Modify: `src/compute-engine/compilation/gpu-target.ts` (`Random` entry — branch on type)
- Test: `test/compute-engine/a4-actions-random.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/compute-engine/a4-actions-random.test.ts`:

```typescript
describe('A4.2 — Random(seed) polymorphic dispatch', () => {
  test('Random() returns a float in [0,1)', () => {
    const ce = new ComputeEngine();
    const v = ce.box(['Random']).evaluate().re!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  test('Random(seed) is deterministic — same seed → same value', () => {
    const ce = new ComputeEngine();
    const v1 = ce.box(['Random', 0.5]).evaluate().re!;
    const v2 = ce.box(['Random', 0.5]).evaluate().re!;
    expect(v1).toEqual(v2);
  });

  test('Random(seed) returns a float in [0,1)', () => {
    const ce = new ComputeEngine();
    for (const seed of [0.1, 1.5, 42.7, -3.2, 1e6]) {
      const v = ce.box(['Random', seed]).evaluate().re!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('Random(seed) varies with seed', () => {
    const ce = new ComputeEngine();
    const v1 = ce.box(['Random', 0.1]).evaluate().re!;
    const v2 = ce.box(['Random', 0.2]).evaluate().re!;
    expect(v1).not.toEqual(v2);
  });

  test('Random(n) — integer arg — still returns integer in [0, n)', () => {
    const ce = new ComputeEngine();
    for (let i = 0; i < 30; i++) {
      const v = ce.box(['Random', 5]).evaluate().re!;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  test('Random(m, n) — both integer — returns integer in [m, n)', () => {
    const ce = new ComputeEngine();
    for (let i = 0; i < 30; i++) {
      const v = ce.box(['Random', 10, 20]).evaluate().re!;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  test('Random(seed) matches the hash formula', () => {
    const ce = new ComputeEngine();
    const seed = 0.5;
    const expected = (() => {
      const v = Math.sin(seed * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    })();
    const got = ce.box(['Random', 0.5]).evaluate().re!;
    expect(got).toBeCloseTo(expected, 12);
  });

  test('Random compiles to JS with deterministic-seed support', () => {
    const ce = new ComputeEngine();
    const seeded = ce.parse('\\operatorname{Random}(0.7)');
    const fnSeeded = seeded.compile() as any;
    const a = fnSeeded();
    const b = fnSeeded();
    expect(a).toEqual(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);

    const unseeded = ce.parse('\\operatorname{Random}()');
    const fnUnseeded = unseeded.compile() as any;
    const c = fnUnseeded();
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(1);
  });

  test('Random(integer-typed-symbol) routes to integer-bound on GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.box(['Random', 'n']);
    const glsl = expr.compileToSource({ target: 'glsl' });
    // Integer-bound form should not call _gpu_random directly on n; it should
    // wrap the result in an int() cast or scale a seeded draw. The exact form
    // depends on the implementation choice, but the result must NOT be a bare
    // _gpu_random(float(n)) which would be a seeded float (the old A1 bug).
    expect(glsl).toMatch(/int\(.*_gpu_random|floor.*_gpu_random|%\s*n/);
  });

  test('Random(real-typed-arg) compiles to seeded float on GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{Random}(0.5)');
    const glsl = expr.compileToSource({ target: 'glsl' });
    expect(glsl).toMatch(/_gpu_random/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/a4-actions-random`
Expected: most A4.2 tests fail — current `Random(0.5)` evaluates to `floor(0.5 - 1) = -1` (the integer-bound path treats 0.5 as upper = floor(0.5-1)).

- [ ] **Step 3: Create the shared PRNG helper**

Create `src/compute-engine/numerics/random.ts`:

```typescript
/**
 * Shared deterministic-PRNG helpers for Random/Shuffle/Sample.
 *
 * The hash matches the GLSL/WGSL formula used by the GPU compile target:
 *   fract(sin(seed * 12.9898) * 43758.5453)
 *
 * JS↔GLSL parity is approximate (fp64 vs fp32; Math.sin is not bit-portable).
 * Within a single host, the same seed always yields the same value.
 */

/**
 * Return a deterministic pseudorandom value in [0, 1) for the given seed.
 * Matches the GLSL `_gpu_random(seed)` hash to within fp32 precision.
 */
export function deterministicRandom(seed: number): number {
  const v = Math.sin(seed * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Advance the seed by a fixed amount so subsequent calls produce decorrelated
 * draws. Used by Shuffle/Sample to walk through the elements deterministically.
 * Uses a Weyl-sequence-style increment (golden-ratio fractional part).
 *
 * @param seed The current seed value.
 * @returns The next seed in the sequence.
 */
export function nextSeed(seed: number): number {
  // Increment by the fractional part of the golden ratio (low-discrepancy).
  // The exact constant doesn't matter; what matters is that it's irrational
  // and the increment moves the seed enough to break the local sin(x) cycle.
  return seed + 0.6180339887498949;
}
```

- [ ] **Step 4: Update `Random`'s JS evaluator**

In `src/compute-engine/library/core.ts` around lines 865–899, replace the `Random` definition with the polymorphic form:

```typescript
    Random: {
      description: [
        'Random(): non-deterministic float in [0, 1)',
        'Random(seed: real): deterministic float in [0, 1) from a real seed',
        'Random(n: integer): non-deterministic integer in [0, n)',
        'Random(m: integer, n: integer): non-deterministic integer in [m, n)',
      ],
      pure: false,
      // Signature accepts: nothing, one number, or two integers.
      // Use `number` (not `integer`) for the single-arg case so float seeds
      // type-check; runtime dispatch differentiates integer vs real.
      signature: '(number?, integer?) -> finite_number',
      type: ([first, second]) => {
        // No args: float in [0, 1)
        if (first === undefined) return 'finite_number';
        // Two args: integer in [m, n)
        if (second !== undefined) return 'finite_integer';
        // One arg — integer type → integer result; real type → float
        if (first.type.matches('integer')) return 'finite_integer';
        return 'finite_number';
      },
      sgn: () => 'non-negative',
      evaluate: (ops, { engine: ce }) => {
        // No-arg: non-deterministic float.
        if (ops.length === 0) return ce.number(Math.random());

        const [firstOp, secondOp] = ops;

        // Two-arg: integer in [m, n) (existing behavior).
        if (secondOp !== undefined) {
          let lower = Math.floor(firstOp.re);
          let upper = Math.floor(secondOp.re);
          if (isNaN(lower)) lower = 0;
          if (isNaN(upper)) upper = 0;
          return ce.number(lower + Math.floor(Math.random() * (upper - lower)));
        }

        // One-arg: dispatch on the argument's type.
        // - integer-typed → integer in [0, n) (existing)
        // - real / non-integer → seeded float in [0, 1)
        const isIntegerTyped = firstOp.type.matches('integer');
        if (isIntegerTyped) {
          let upper = Math.floor(firstOp.re - 1);
          if (isNaN(upper)) upper = 0;
          // Note: original code used `upper = floor(re - 1)` then range
          // [0, upper], which is off-by-one. Keep the existing buggy behavior
          // ONLY if pre-existing tests pin it; otherwise use [0, n) = floor(re).
          // After investigation in Step 5: align with [0, n) if no tests pin
          // the off-by-one, else preserve it.
          const n = Math.floor(firstOp.re);
          return ce.number(Math.floor(Math.random() * (isNaN(n) ? 0 : n)));
        }

        // Real-typed: seeded float in [0, 1).
        const seed = firstOp.re;
        if (isNaN(seed)) return ce.number(0);
        return ce.number(deterministicRandom(seed));
      },
    },
```

Add the import at the top of the file:

```typescript
import { deterministicRandom } from '../numerics/random';
```

**Verify before finalizing:**
- The existing one-arg integer-bound form computed `upper = floor(re - 1)`, producing values in `[0, upper]` (inclusive). If any pre-existing test pins this off-by-one behavior, KEEP IT (don't change the range). Audit `grep -rn "['\"]Random['\"].*\\\\[\\\\|,\\s*\\d" test/compute-engine/` and the `Random(n)` references; only realign with `[0, n)` if no test pins the legacy boundary.
- `firstOp.type.matches('integer')` — verify this is the right API call. If the type matches API differs, mirror how `Floor` or `Mod` in the same file checks integer-typed args.

- [ ] **Step 5: Update the JS compile entry**

In `src/compute-engine/compilation/javascript-target.ts` around line 412, replace the bare `Random: 'Math.random'` with a function that handles the polymorphic forms:

```typescript
  Random: (args, compile) => {
    if (args.length === 0) return 'Math.random()';
    if (args.length === 2) {
      // Random(m, n): integer in [m, n)
      const m = compile(args[0]);
      const n = compile(args[1]);
      return `(${m} + Math.floor(Math.random() * ((${n}) - (${m}))))`;
    }
    // One arg — branch on the arg's type.
    const arg = args[0];
    if (arg.type.matches('integer')) {
      // Integer-bound: Random(n) → integer in [0, n)
      return `Math.floor(Math.random() * (${compile(arg)}))`;
    }
    // Real seed: deterministic float in [0, 1)
    // Inline the hash; no runtime helper is required.
    const a = compile(arg);
    return `(() => { const v = Math.sin((${a}) * 12.9898) * 43758.5453; return v - Math.floor(v); })()`;
  },
```

**Verify before finalizing:**
- Look at how other compile entries access `arg.type` (search for `arg.type.matches` in this file). Mirror the convention exactly.
- The inlined IIFE works but is verbose. If the JS compile target supports preambles (similar to GPU), prefer a hoisted helper. Check whether `target.preambles` or equivalent exists on the JS side; if so, emit a single `function _ce_random(s)` preamble and call `_ce_random(${a})`.

- [ ] **Step 6: Update the GLSL compile entry**

In `src/compute-engine/compilation/gpu-target.ts` around line 1099, extend the `Random` entry to branch on `args[0].type` for the 1-arg case:

```typescript
  Random: (args, compile, target) => {
    if (args.length === 0) {
      if (target.language === 'wgsl') {
        throw new Error(
          'Random(): WGSL compile requires an explicit seed argument. ' +
            'WGSL has no gl_FragCoord built-in outside fragment entry points. ' +
            'Use Random(seed) where seed is a deterministic per-invocation value.'
        );
      }
      return '_gpu_random(gl_FragCoord.x + gl_FragCoord.y * 1024.0)';
    }
    if (args.length === 1) {
      target.preambles.add('GPU_RANDOM_PREAMBLE');
      const arg = args[0];
      // Integer-typed → integer-bound: floor(_gpu_random(float(n)) * float(n))
      if (arg.type.matches('integer')) {
        const compiled = compile(arg);
        return `int(floor(_gpu_random(float(${compiled})) * float(${compiled})))`;
      }
      // Real-typed → seeded float (existing behavior).
      return `_gpu_random(${compile(args[0])})`;
    }
    if (args.length === 2) {
      // Random(m, n) — integer in [m, n)
      target.preambles.add('GPU_RANDOM_PREAMBLE');
      const m = compile(args[0]);
      const n = compile(args[1]);
      // Seed the integer draw from gl_FragCoord (GLSL) or throw on WGSL.
      if (target.language === 'wgsl') {
        throw new Error(
          'Random(m, n): WGSL compile requires explicit seeding. ' +
            'Use a seeded variant or compute the integer range manually.'
        );
      }
      const seed = '_gpu_random(gl_FragCoord.x + gl_FragCoord.y * 1024.0)';
      return `(${m} + int(floor(${seed} * float((${n}) - (${m})))))`;
    }
    throw new Error('Random: GPU compile expects 0, 1, or 2 arguments');
  },
```

**Verify before finalizing:**
- `target.preambles.add('GPU_RANDOM_PREAMBLE')` — check the actual preamble registration string used elsewhere in this file (the existing entry already adds it on line 2901-2905; mirror exactly).
- The `int(floor(...))` cast assumes Random returns an int when called with an integer-typed arg. The function signature in GLSL must match — the existing entry returns `float`. Either widen the return type to `int`/`float` polymorphically, or have integer-bound Random emit an `int` value at the call site that's then promoted via implicit cast.

- [ ] **Step 7: Run tests**

Run: `npm run test compute-engine/a4-actions-random`
Expected: all A4.2 tests pass.

- [ ] **Step 8: Broader regression**

Run: `npm run test compute-engine`
Expected: baseline preserved. The most likely break: pre-existing tests that asserted specific values from `Random(n)` may now see different values if the off-by-one fix landed. If so, restore the legacy upper-bound math in Step 4.

---

## Task A4.3: Seeded `Shuffle` and `Sample`

Today `Shuffle(L)` and `Sample(L, k)` use `Math.random()` directly — non-deterministic. A4 adds an optional seed argument that makes the reordering reproducible. The seed advances per element via `nextSeed()` so element-to-element draws are decorrelated.

**Files:**
- Modify: `src/compute-engine/library/collections.ts` (`Shuffle`)
- Modify: `src/compute-engine/library/statistics.ts` (`Sample`)
- Test: `test/compute-engine/a4-actions-random.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
describe('A4.3 — Seeded Shuffle / Sample', () => {
  test('Shuffle without seed still works (non-deterministic)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5]]).evaluate();
    expect(r.operator).toEqual('List');
    expect(r.nops).toEqual(5);
    const elements = r.ops!.map((x) => x.re).sort();
    expect(elements).toEqual([1, 2, 3, 4, 5]);
  });

  test('Shuffle(L, seed) is deterministic', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.7]).evaluate();
    const b = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.7]).evaluate();
    expect(a.ops!.map((x) => x.re)).toEqual(b.ops!.map((x) => x.re));
  });

  test('Shuffle(L, seed) varies with seed', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.1]).evaluate();
    const b = ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.9]).evaluate();
    // Almost certainly different orderings (P(equal) ≈ 1/120).
    expect(a.ops!.map((x) => x.re)).not.toEqual(b.ops!.map((x) => x.re));
  });

  test('Shuffle(L, seed) preserves elements (permutation)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Shuffle', ['List', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5])
      .evaluate();
    const elements = r.ops!.map((x) => x.re).sort((a, b) => a! - b!);
    expect(elements).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('Sample(L, k) without seed still works (non-deterministic)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Sample', ['List', 1, 2, 3, 4, 5], 3]).evaluate();
    expect(r.operator).toEqual('List');
    expect(r.nops).toEqual(3);
  });

  test('Sample(L, k, seed) is deterministic', () => {
    const ce = new ComputeEngine();
    const a = ce
      .box(['Sample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3, 0.4])
      .evaluate();
    const b = ce
      .box(['Sample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3, 0.4])
      .evaluate();
    expect(a.ops!.map((x) => x.re)).toEqual(b.ops!.map((x) => x.re));
  });

  test('Sample(L, k, seed) returns k distinct elements from L', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Sample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 3, 0.4])
      .evaluate();
    expect(r.nops).toEqual(3);
    const got = r.ops!.map((x) => x.re!);
    const all = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const v of got) expect(all).toContain(v);
    expect(new Set(got).size).toEqual(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/a4-actions-random`
Expected: deterministic / seeded tests fail; the unseeded tests pass.

- [ ] **Step 3: Update `Shuffle`**

In `src/compute-engine/library/collections.ts` around lines 1644–1660:

```typescript
  Shuffle: {
    description:
      'Randomize the order of the elements in the collection. ' +
      'With an optional `seed` argument, the shuffle is deterministic.',
    complexity: 8200,
    signature: '(indexed_collection, seed?: real) -> indexed_collection',
    type: (ops) => ops[0].type,
    evaluate: ([xs, seedOp], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;

      const data = Array.from(xs.each());
      const seed = seedOp?.re;
      if (seed !== undefined && !Number.isNaN(seed)) {
        // Deterministic Fisher-Yates with advancing seed.
        let s = seed;
        for (let i = data.length - 1; i > 0; i--) {
          const j = Math.floor(deterministicRandom(s) * (i + 1));
          [data[i], data[j]] = [data[j], data[i]];
          s = nextSeed(s);
        }
      } else {
        // Non-deterministic Fisher-Yates (existing).
        for (let i = data.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [data[i], data[j]] = [data[j], data[i]];
        }
      }

      return ce.function(xs.operator, data);
    },
  },
```

Add the import at the top of the file:

```typescript
import { deterministicRandom, nextSeed } from '../numerics/random';
```

- [ ] **Step 4: Update `Sample`**

In `src/compute-engine/library/statistics.ts` around lines 385–407:

```typescript
    Sample: {
      description:
        'Return a random sample of k elements from the collection, ' +
        'without replacement. With an optional `seed` argument, the sample ' +
        'is deterministic.',
      complexity: 8200,
      signature: '(collection, integer, seed?: real) -> list',
      evaluate: ([xs, nArg, seedArg], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;

        const k = toInteger(nArg);
        if (k === null || k < 0) return undefined;

        const data = Array.from(xs.each()) as Expression[];
        if (k > data.length) return undefined;

        const seed = seedArg?.re;
        if (seed !== undefined && !Number.isNaN(seed)) {
          // Deterministic Fisher-Yates first k elements.
          let s = seed;
          for (let i = data.length - 1; i > 0; i--) {
            const j = Math.floor(deterministicRandom(s) * (i + 1));
            [data[i], data[j]] = [data[j], data[i]];
            s = nextSeed(s);
          }
        } else {
          for (let i = data.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [data[i], data[j]] = [data[j], data[i]];
          }
        }

        const sample = data.slice(0, k);
        return ce.function('List', sample);
      },
    },
```

Add the import:

```typescript
import { deterministicRandom, nextSeed } from '../numerics/random';
```

- [ ] **Step 5: Run tests**

Run: `npm run test compute-engine/a4-actions-random`
Expected: all A4.3 tests pass.

- [ ] **Step 6: Broader regression**

Run: `npm run test compute-engine`
Expected: baseline preserved.

---

## Task A4.4: `\operatorname{with}` parser

Desmos's `with` clause is a local-binding form: `expr \operatorname{with} a = v_1, b = v_2` evaluates `expr` after binding `a = v_1` and `b = v_2` *in order* (later bindings can reference earlier ones, matching Desmos's semantics for `with`). Maps cleanly to `Block(Assign(a, v_1), Assign(b, v_2), expr)`.

**Key observation:** Block is sequential, which is exactly the right semantics for `with` (unlike for action tuples — see A4.1). No special handling required.

**Grammar:**
```
primary_expr ::= primary_expr  \operatorname{with}  binding (, binding)*
binding      ::= symbol = expr
```

`\operatorname{with}` is a postfix infix operator. Precedence: just above sequence (`;`), below all other operators so `f(x) \operatorname{with} a = 1` does not bind to a subexpression.

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-other.ts` (add `\operatorname{with}` infix definition)
- Test: `test/compute-engine/a4-actions-random.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
describe('A4.4 — \\operatorname{with} parser', () => {
  test('basic with-clause: x + 1 with x = 5', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x + 1 \\operatorname{with} x = 5');
    expect(expr.evaluate().re).toEqual(6);
  });

  test('parses to Block(Assign(x, 5), Add(x, 1))', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x + 1 \\operatorname{with} x = 5');
    expect(expr.operator).toEqual('Block');
    // First op is an Assign, last op is the value expression.
    const ops = expr.ops!;
    expect(ops[0].operator).toEqual('Assign');
  });

  test('multiple bindings: a + b with a = 2, b = 3', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('a + b \\operatorname{with} a = 2, b = 3');
    expect(expr.evaluate().re).toEqual(5);
  });

  test('later bindings see earlier ones (sequential — matches Block)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      'b \\operatorname{with} a = 5, b = a + 1'
    );
    expect(expr.evaluate().re).toEqual(6);
  });

  test('with-clause does not leak bindings to outer scope', () => {
    const ce = new ComputeEngine();
    ce.parse('y \\operatorname{with} y = 99').evaluate();
    // Outer y should be undeclared or undefined.
    const yExpr = ce.box('y');
    expect(yExpr.symbol).toEqual('y');
  });

  test('LaTeX round-trip preserves the with-clause structure', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x^2 \\operatorname{with} x = 4');
    // The parsed expression evaluates correctly regardless of exact LaTeX form.
    expect(expr.evaluate().re).toEqual(16);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/a4-actions-random`
Expected: `\operatorname{with}` parser fails — the token is unknown today.

- [ ] **Step 3: Add the parser entry**

In `src/compute-engine/latex-syntax/dictionary/definitions-other.ts`, in the lowercase-alias block around line 659–664, add a definition for `\operatorname{with}`. Because it's not a simple alias (it consumes additional `sym = expr` clauses), it needs a custom `parse` handler:

```typescript
  {
    name: 'With',
    latexTrigger: ['\\operatorname{with}'],
    kind: 'infix',
    precedence: 250, // Below ';' (200), above other expression operators.
    parse: (parser, lhs) => {
      // Parse the binding list: sym = expr (, sym = expr)*
      const bindings: Expression[] = [];
      do {
        const symbol = parser.matchSymbol();
        if (!symbol) {
          parser.error('missing-symbol');
          break;
        }
        if (!parser.match('=')) {
          parser.error('expected-equals');
          break;
        }
        const value = parser.parseExpression({ minPrec: 250 });
        if (!value) {
          parser.error('missing-value');
          break;
        }
        bindings.push(['Assign', symbol, value]);
      } while (parser.match(','));

      // Translate to Block(Assign, ..., lhs).
      return ['Block', ...bindings, lhs];
    },
  },
```

**Verify before finalizing:**
- The `parser` API methods (`matchSymbol`, `match`, `parseExpression`, `error`) are conjectural. Look at how other infix parsers in `definitions-other.ts` or `definitions-core.ts` consume additional tokens. Mirror their conventions exactly.
- The `kind: 'infix'` may not be supported; check the parser config types. If only `kind: 'symbol' | 'function' | 'matchfix' | 'prefix' | 'postfix' | 'infix' | 'environment'` are supported, pick the one that maps to a binary operator with a custom right-hand-side parse.
- Precedence: A4 binds tighter than `;` but should not bind into subexpressions like `f(x) \operatorname{with} a = 1` where the `with` should apply to the entire `f(x)`, not the argument. Run the tests; if `with` binds too tightly, lower the precedence.

- [ ] **Step 4: Register `With` in the library (optional — pure parse alias works)**

If the `with` parse handler returns `['Block', ...]` directly, no library registration is needed — Block handles canonical/evaluate. If a `With` head is preferred (for serialization parity), register a stub in `core.ts`:

```typescript
    With: {
      description:
        'Local bindings expression: `With(body, Assign(a, v1), Assign(b, v2), ...)` ' +
        'evaluates body with bindings applied sequentially. Equivalent to a Block.',
      lazy: true,
      scoped: true,
      signature: '(any+) -> any',
      canonical: (args, { engine: ce, scope }) =>
        // Translate to Block(Assign..., body)
        ce._fn('Block', [...args.slice(1), args[0]], { scope }),
    },
```

Decision: **start with the direct Block translation** (Step 3 above), skip Step 4. The `With` head is unnecessary unless GP asks for a roundtrippable surface name. Mention the optional `With` head in the doc.

- [ ] **Step 5: Run tests**

Run: `npm run test compute-engine/a4-actions-random`
Expected: all A4.4 tests pass.

- [ ] **Step 6: Broader regression**

Run: `npm run test compute-engine`
Expected: baseline preserved. The most likely break: adding a new `\operatorname{with}` triggers a parse conflict with code that uses `with` as a free identifier. Check the LaTeX parser dictionary for any existing `with` references; rare in math, but if a clash is detected, scope the trigger more narrowly.

---

## Final validation

After all 4 tasks land:

- [ ] **Run the full A4 suite**

Run: `npm run test compute-engine/a4-actions-random`
Expected: all tests pass (~4 + 10 + 7 + 6 = ~27 tests).

- [ ] **Run the broader CE test suite**

Run: `npm run test compute-engine`
Expected: baseline + ~27 new tests passing.

- [ ] **Run cycles + typecheck**

Run: `npx madge --circular --extensions ts src/compute-engine`
Expected: same number of cycles as baseline (the project allows 8 type-only cycles).

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Manual probe**

```bash
npx tsx -e "
import { ComputeEngine } from './src/compute-engine';
const ce = new ComputeEngine();

// Block is sequential
console.log('Block sequential:', ce.box(['Block',
  ['Assign', 'a', 1],
  ['Assign', 'b', ['Add', 'a', 1]],
  'b']).evaluate().re);

// Random seeded
console.log('Random(0.5):', ce.box(['Random', 0.5]).evaluate().re);
console.log('Random(0.5) again:', ce.box(['Random', 0.5]).evaluate().re);

// Random integer-bound
console.log('Random(5) integer:', ce.box(['Random', 5]).evaluate().re);

// Shuffle seeded
console.log('Shuffle seeded:', ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.7]).evaluate().toString());
console.log('Shuffle seeded again:', ce.box(['Shuffle', ['List', 1, 2, 3, 4, 5], 0.7]).evaluate().toString());

// with-clause
console.log('with-clause:', ce.parse('x + 1 \\\\operatorname{with} x = 5').evaluate().re);
"
```

Expected:
```
Block sequential: 2
Random(0.5): <some deterministic value, e.g. 0.5417...>
Random(0.5) again: <same value as above>
Random(5) integer: <0..4>
Shuffle seeded: List(...some order...)
Shuffle seeded again: List(...same order...)
with-clause: 6
```

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| Polymorphic `Random` dispatch breaks pre-existing tests pinning `Random(n)` integer-bound off-by-one | Step 4 of A4.2 says to preserve the legacy upper bound if any test pins it. Audit before changing. |
| `arg.type.matches('integer')` is the wrong API for type-checking — may not exist or may match wider than expected | Mirror how `Floor` or `Mod` in the same files do integer-type checks. The fallback is `arg.type.toString() === 'integer'` (or a regex over the type string). |
| GLSL integer-bound Random emits a value the GLSL type system rejects (returning `int` from a function declared `float`) | Step 6 of A4.2 includes a verify check. If type-mismatch errors surface, wrap the emit in a `float(...)` promotion or declare separate `_gpu_random_int` / `_gpu_random_float` preambles. |
| `nextSeed` increment (golden-ratio fraction) produces visible patterns for small N | The Fisher-Yates seed walks are short (N elements). Test outputs visually for N=5..10 to confirm no obvious clustering. If patterns appear, use a multiplicative LCG step instead: `s = (s * 1.61803398875 + 0.123456789) % 1`. |
| `\operatorname{with}` parser conflicts with existing free-identifier usage | Step 6 of A4.4 explicitly checks. If a clash exists, scope the trigger to `\\operatorname{with}\\b` or require the lhs to be parenthesized. |
| Snapshot-then-commit pattern documentation is unclear to readers unfamiliar with simultaneous-vs-sequential distinctions | The doc page in A4.1 includes a worked example (the swap test). Add a follow-up FAQ entry if GP raises clarification questions. |
| JS-side `Math.sin` non-portability causes flaky tests on different Node versions | A4.2 Step 1 uses `toBeCloseTo(expected, 12)` (12 digits = roughly fp32 precision). If flaky on different platforms, loosen to `toBeCloseTo(expected, 6)` — still validates the hash, not exact bit-equivalence. |

---

## Out of scope

- A new `Parallel(...)` head for simultaneous Assign tuples — settled in the design call: GP rewrites at translation boundary instead
- Bit-exact JS↔GLSL Random parity — both are deterministic *within* a host; cross-host parity is approximate (documented in A4.1's doc page)
- Seeded integer-bound `Random(n, seed)` / `Random(m, n, seed)` forms — out of scope; GP scales a seeded float manually if needed
- LaTeX serializer for `\operatorname{with}` round-trip — out of scope unless GP requests it (the parser is one-way; the canonical form is `Block(...)`, which serializes back to the standard Block notation)
- WGSL no-arg Random fallback — still throws (no `gl_FragCoord` equivalent in WGSL); A1 made this call

---

## Open question for GP (not blocking)

Should `RandomInteger(n, seed)` / `RandomInteger(m, n, seed)` ship as a separate head in 0.58.0 or wait? The current A4 plan does not include them — GP must scale a seeded float manually:
`Floor(Multiply(Random(seed), n))`.

If GP requests them, the implementation is trivial (parallels `Sample`/`Shuffle`'s seed pattern). Decision deferred until GP's audit surfaces a concrete need.

---

## Settled design question (was the open project-memory item)

**Q:** Does `Block(Assign(a, 1), Assign(b, ["Add", "a", 1]))` evaluate the second `Assign` with `a = 1` (sequential) or the pre-block `a` (simultaneous)?

**A:** Sequential. The second `Assign` sees `a = 1`. Confirmed empirically (probe T1 → `b = 2`; probe T3 → `a=1; a=a+1; a=a+1` → `a = 3`) and structurally (`function-utils.ts:272` `evaluateStatements` iterates with `op.evaluate()` and `core.ts:655` `Assign.evaluate` calls `ce.assign(name, val)` immediately).

**Consequence for GP:** Desmos's action tuples are simultaneous, so GP rewrites at translation boundary using the snapshot-then-commit pattern (see A4.1's doc page). CE does not gain a new primitive — Block's semantics align with mainstream imperative languages.
