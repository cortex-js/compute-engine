# CE 0.58.0 — A1 + C1 Compile Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close A1 (CE-P5a compile parity) and C1 (CE-P6 3D implicit relations) from the CE 0.58.0 plan. Address the 0.57.0 First/Second/Third compile-bug, plug GLSL gaps for `Range`/`Random`/`Variance`/`GCD`/`Median`, scope `Loop`/`Integrate` to "verify-only", and add the `toSignedFunction()` helper for C1's 3D implicit-relation rendering.

**Architecture:** All compile-target changes live in `src/compute-engine/compilation/`. Three layers:

1. `javascript-target.ts` — JS function compilation; needs `First`/`Second`/`Third` entries (the 0.57.0 parser-but-no-compile bug).
2. `gpu-target.ts` — Shared GPU compilation (used by both GLSL and WGSL targets via `language` flag on the target). Most A1 GLSL gaps fill in here so they cover both shading languages; only language-specific syntax differences go in `glsl-target.ts` / `wgsl-target.ts`.
3. `glsl-target.ts` — GLSL-specific overrides (function naming differences only).

C1's relation-to-signed-function transform is a new method on `BoxedExpression` (in `abstract-boxed-expression.ts` or similar), not a compile-target concern — the transform happens before compilation so the result flows through existing compile paths.

**Tech Stack:** TypeScript, Jest, MathJSON, GLSL/WGSL, JavaScript codegen.

**Policy note:** Per the user's CLAUDE.md and project memory, this plan deliberately omits `git commit` steps. Group changes naturally; the user decides when to commit.

**Decision deferred to implementation:** `Random` deterministic-seed semantics. The roadmap committed "Random GLSL entry with deterministic seed" to A1 but the actual seed API/protocol is shared with A4's broader work on deterministic random. This plan implements GLSL `Random(seed)` as a hash-based pseudorandom taking a float seed; the JS-side seeded form lands in A4. See Task A1.4 for the exact design choice and the design call to flag.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/compute-engine/compilation/javascript-target.ts` | JS compile entries for `First`/`Second`/`Third`; existing `Range`/`Random`/`Variance`/`GCD`/`Median` unchanged |
| `src/compute-engine/compilation/gpu-target.ts` | Shared GPU compile entries for `First`/`Second`/`Third`/`Range`/`Random` (seeded)/`Variance`/`GCD`/`Median`; documentation note on `Loop`/`Integrate` scope |
| `src/compute-engine/compilation/glsl-target.ts` | GLSL-specific overrides only (e.g. `inversesqrt` vs `1.0/sqrt(x)`) — most GLSL entries inherit from gpu-target |
| `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` | New `toSignedFunction()` method for C1 |
| `src/compute-engine/types-expression.ts` | `BoxedExpression` interface — declare `toSignedFunction()` |
| `test/compute-engine/a1-c1-compile-parity.test.ts` | New test file covering all A1/C1 items |

---

## Task A1.1: `First` / `Second` / `Third` JS + GLSL compile entries

This is the 0.57.0 parser/compile mismatch. The parser ships these heads (via component access — `p.x` → `First(p)`) but the compile targets reject them. ~16 + 13 corpus rows blocked.

Semantics: each accesses one positional element of a tuple/list (1-indexed in MathJSON but 0-indexed at compile time since the compiled output is plain JS array / GLSL vec):
- `First(p)` → `p[0]` (JS), `p.x` (GLSL vec2/3/4)
- `Second(p)` → `p[1]` (JS), `p.y` (GLSL vec2/3/4)
- `Third(p)` → `p[2]` (JS), `p.z` (GLSL vec3/4)

**Files:**
- Modify: `src/compute-engine/compilation/javascript-target.ts` (add three entries)
- Modify: `src/compute-engine/compilation/gpu-target.ts` (add three entries in `GPU_FUNCTIONS`)
- Test: `test/compute-engine/a1-c1-compile-parity.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `test/compute-engine/a1-c1-compile-parity.test.ts`:

```typescript
import { ComputeEngine } from '../../src/compute-engine';

describe('A1 — First/Second/Third compile', () => {
  test('First compiles to JS array index', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x');
    ce.declare('p', 'tuple<number, number>');
    const fn = ce.box(expr.json).compile() as any;
    // The compiled function should accept a tuple and return its first element.
    expect(fn([10, 20])).toEqual(10);
  });

  test('Second compiles to JS array index', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    const fn = ce.parse('p.y').compile() as any;
    expect(fn([10, 20])).toEqual(20);
  });

  test('Third compiles to JS array index', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number, number>');
    const fn = ce.parse('p.z').compile() as any;
    expect(fn([10, 20, 30])).toEqual(30);
  });

  test('First in a larger expression compiles cleanly', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    // Distance from origin to p: sqrt(p.x^2 + p.y^2)
    const fn = ce.parse('\\sqrt{p.x^2 + p.y^2}').compile() as any;
    expect(fn([3, 4])).toBeCloseTo(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: compile errors — `First`/`Second`/`Third` have no compile entry.

- [ ] **Step 3: Add JS compile entries**

In `src/compute-engine/compilation/javascript-target.ts`, near other simple operator entries (around line 240), add:

```typescript
  First: (args, compile) => `${compile(args[0])}[0]`,
  Second: (args, compile) => `${compile(args[0])}[1]`,
  Third: (args, compile) => `${compile(args[0])}[2]`,
```

Place them in alphabetical position within the existing block (between e.g. `Fract` and `Gamma`, or wherever fits the existing ordering).

- [ ] **Step 4: Add GPU compile entries**

In `src/compute-engine/compilation/gpu-target.ts`, in the `GPU_FUNCTIONS` object (starts around line 200), add:

```typescript
  // Component access — works for both GLSL and WGSL (vec swizzles are
  // identical across the two shader languages).
  First: (args, compile) => `${compile(args[0])}.x`,
  Second: (args, compile) => `${compile(args[0])}.y`,
  Third: (args, compile) => `${compile(args[0])}.z`,
```

Place them near other simple operators in the object. Look at how a similar single-arg operator is registered for placement.

**Note**: GLSL/WGSL `.x`/`.y`/`.z` swizzles only work on `vec2`/`vec3`/`vec4`. If the compile target expects array indexing instead (e.g. `float[3] arr; arr[0]`), check how existing list-element compilation works in this file. The plan assumes vec swizzles — verify before finalizing.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: 4 First/Second/Third tests pass.

- [ ] **Step 6: Run broader compilation tests**

Run: `npm run test compute-engine/compile`
Expected: no regressions.

---

## Task A1.2: `Range` GPU compile entry

`Range(lo, hi)` and `Range(lo, hi, step)` produce integer/float sequences. JS already has an entry (`javascript-target.ts:365`). GPU needs an entry — but GPU has no built-in sequence type, so the strategy is:
- Inline the range into a `float[]` array literal when bounds are constant and small
- Materialize as a `for`-loop-fillable array when bounds are runtime values

Note that GPU shaders rarely use raw `Range` — it usually appears inside `Loop` or `Sum`/`Product`. Those handlers already inline ranges. The standalone `Range` GPU compile is mostly for completeness and a few corpus rows that use `Range` directly.

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (add `Range` entry)
- Test: `test/compute-engine/a1-c1-compile-parity.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe('A1 — Range GPU compile', () => {
  test('Range(1, 5) compiles to a small constant array in GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{Range}(1, 5)');
    const code = expr.compileToSource({ target: 'glsl' });
    // Expect either a float[5](1.0, 2.0, 3.0, 4.0, 5.0) literal or
    // equivalent inline constant. Don't be too specific about format.
    expect(code).toMatch(/float\[5\]|1\.0,\s*2\.0,\s*3\.0,\s*4\.0,\s*5\.0/);
  });

  test('Range(1, n) with non-constant upper bound throws or returns descriptive error', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.parse('\\operatorname{Range}(1, n)');
    expect(() => expr.compileToSource({ target: 'glsl' })).toThrow();
  });
});
```

**Verify first**: `compileToSource` may not be the right API name. Check existing GLSL compile tests in `test/compute-engine/compile-glsl.test.ts` (or similar) to mirror their pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: `Range` either compiles to nothing useful or throws an unhelpful error.

- [ ] **Step 3: Add `Range` GPU compile entry**

In `src/compute-engine/compilation/gpu-target.ts` `GPU_FUNCTIONS`:

```typescript
  Range: (args, compile, target) => {
    if (args.length < 2 || args.length > 3) {
      throw new Error('Range: GPU compile expects 2 or 3 arguments (lo, hi, step?)');
    }
    const lo = args[0].re;
    const hi = args[1].re;
    const step = args.length === 3 ? args[2].re : 1;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(step)) {
      throw new Error('Range: GPU compile requires constant numeric bounds (non-constant ranges must be materialized at JS host then uploaded as a uniform)');
    }
    if (step === 0) throw new Error('Range: step cannot be zero');
    const count = Math.max(0, Math.floor((hi - lo) / step) + 1);
    if (count > 256) {
      throw new Error(`Range: GPU compile inlines ranges up to 256 elements (got ${count})`);
    }
    const values: number[] = [];
    for (let i = 0; i < count; i++) values.push(lo + i * step);
    const isWGSL = target.language === 'wgsl';
    const arrayType = isWGSL ? `array<f32, ${count}>` : `float[${count}]`;
    return `${arrayType}(${values.map((v) => v.toFixed(1)).join(', ')})`;
  },
```

**Verify**:
- `args[i].re` is the right accessor for a literal float — look at neighboring GPU operators that read constant numeric operands (e.g., `Loop`'s `rangeExpr.ops[0].re`) and mirror.
- The WGSL `array<f32, N>(...)` literal syntax matches what other GPU operators produce.
- The 256-element inlining cap is sensible — adjust if other operators have a different convention.

- [ ] **Step 4: Run tests + broader regression**

Run: `npm run test compute-engine/a1-c1-compile-parity compute-engine/compile`
Expected: both Range tests pass, no regressions.

---

## Task A1.3: `Variance` / `GCD` / `Median` GPU compile entries

These three already have JS compile entries (`javascript-target.ts`). Add GPU entries. All three require a `float[]` argument (a list of values).

**Strategy:** call out to a GPU preamble function. Mirror the pattern used by other stat operators in `gpu-target.ts` (look for `Sum`/`Product` preambles).

For the values list itself, the args could be: (a) a single list argument (e.g., `Variance(L)` where `L: list<number>`), or (b) multiple scalar arguments (`Variance(1, 2, 3)`). Both JS and GPU should handle both.

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (add three entries + preamble snippets)
- Test: `test/compute-engine/a1-c1-compile-parity.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
describe('A1 — Variance/GCD/Median GPU compile', () => {
  test('Variance compiles for a constant-size list in GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{var}([1, 2, 3, 4, 5])');
    const code = expr.compileToSource({ target: 'glsl' });
    // Should call some GPU variance helper. Don't be too specific.
    expect(code).toMatch(/variance|_var/i);
  });

  test('Median compiles for a constant-size list in GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{median}([1, 5, 3, 2, 4])');
    const code = expr.compileToSource({ target: 'glsl' });
    expect(code).toMatch(/median|_median/i);
  });

  test('GCD compiles for two integers in GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{gcd}(12, 18)');
    const code = expr.compileToSource({ target: 'glsl' });
    expect(code).toMatch(/gcd|_gcd/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: compile errors / missing handlers.

- [ ] **Step 3: Add GPU preamble snippets**

In `src/compute-engine/compilation/gpu-target.ts`, near the existing preamble constants (search for `GPU_GAMMA_PREAMBLE`):

```typescript
export const GPU_VARIANCE_PREAMBLE_GLSL = `
// Sample variance (n-1 denominator) of a float[] array. For n <= 1 returns 0.
float _variance(float[%N] xs) {
  float mean = 0.0;
  for (int i = 0; i < %N; i++) mean += xs[i];
  mean /= float(%N);
  float sumSq = 0.0;
  for (int i = 0; i < %N; i++) {
    float d = xs[i] - mean;
    sumSq += d * d;
  }
  return %N > 1 ? sumSq / float(%N - 1) : 0.0;
}
`;

export const GPU_MEDIAN_PREAMBLE_GLSL = `
// Median via selection sort on a fixed-size float[] copy. O(N^2) but simple.
float _median(float[%N] xs) {
  float a[%N] = xs;
  for (int i = 0; i < %N - 1; i++) {
    int minIdx = i;
    for (int j = i + 1; j < %N; j++) {
      if (a[j] < a[minIdx]) minIdx = j;
    }
    if (minIdx != i) { float t = a[i]; a[i] = a[minIdx]; a[minIdx] = t; }
  }
  return (%N % 2 == 1) ? a[%N / 2] : (a[%N / 2 - 1] + a[%N / 2]) * 0.5;
}
`;

export const GPU_GCD_PREAMBLE_GLSL = `
// Greatest common divisor via Euclidean algorithm. Returns |a| if b is 0.
float _gcd(float a, float b) {
  a = abs(a); b = abs(b);
  for (int i = 0; i < 32 && b > 0.0; i++) {
    float t = mod(a, b);
    a = b;
    b = t;
  }
  return a;
}
`;
```

Note: GLSL doesn't support runtime-sized arrays cleanly, so `%N` is a textual substitution at compile time (the preamble is parameterized by the constant size of the argument list). This pattern requires the preamble to be re-emitted per array size, which is awkward — verify how other GPU operators (e.g., `Sum` unrolled) handle variable-length lists before finalizing the strategy.

**If `%N` substitution isn't viable** (e.g., the existing preamble system doesn't support it), fall back to:
- For Variance: inline the calculation directly via fold over the operand list (no preamble needed)
- For Median: only support compile-time-known list sizes; inline the selection sort
- For GCD: still preamble-able since it's not list-shaped (two scalar args)

- [ ] **Step 4: Add GPU compile entries**

In `GPU_FUNCTIONS`:

```typescript
  Variance: (args, compile, target) => {
    // Args can be a single list operand or multiple scalar operands.
    const values =
      args.length === 1 && isFunction(args[0], 'List')
        ? args[0].ops.map((x) => compile(x))
        : args.map((x) => compile(x));
    if (values.length <= 1) return '0.0';
    const n = values.length;
    target.preambles.add('GPU_VARIANCE_PREAMBLE_GLSL', n);  // mechanism TBD
    return `_variance(float[${n}](${values.join(', ')}))`;
  },

  Median: (args, compile, target) => {
    const values =
      args.length === 1 && isFunction(args[0], 'List')
        ? args[0].ops.map((x) => compile(x))
        : args.map((x) => compile(x));
    if (values.length === 0) return '0.0 / 0.0';  // NaN
    if (values.length === 1) return values[0];
    const n = values.length;
    target.preambles.add('GPU_MEDIAN_PREAMBLE_GLSL', n);
    return `_median(float[${n}](${values.join(', ')}))`;
  },

  GCD: (args, compile, target) => {
    if (args.length !== 2) throw new Error('GCD: GPU compile expects exactly 2 arguments');
    target.preambles.add('GPU_GCD_PREAMBLE_GLSL');
    return `_gcd(${compile(args[0])}, ${compile(args[1])})`;
  },
```

**Verify before finalizing**:
- The `target.preambles.add(...)` API may not exist as named. Look at how `GPU_GAMMA_PREAMBLE` is added to the output — there's likely an existing preamble-management mechanism (e.g., emitting all preambles unconditionally, or a `target.usedFunctions` set).
- The argument-list shape: does `args[0].ops` give the list elements, or is it `args[0].args`? Mirror neighboring operators that handle list-shaped operands.
- WGSL has different array syntax — for now, throw an "WGSL Variance not yet supported" error if `target.language === 'wgsl'` for the cases that emit GLSL-specific array syntax.

- [ ] **Step 5: Run tests**

Run: `npm run test compute-engine/a1-c1-compile-parity compute-engine/compile`
Expected: all three operator tests pass, no regressions.

---

## Task A1.4: `Random` GPU compile entry — design call + implementation

`Random` is the trickiest A1 item. The roadmap committed to "deterministic Random with explicit seed input" in A1, but the actual API/protocol for seeded random is shared with A4 (deterministic random across re-renders). A1 covers GLSL compile only; the JS-side seeded form lands in A4.

**Design choice for A1**: implement GLSL `Random(seed)` as a hash-based pseudorandom taking a float seed.

For shaders, the conventional pattern is `fract(sin(dot(seed_vec, vec2(12.9898, 78.233))) * 43758.5453)`. We use a simpler 1D variant for `Random(seed: float)`:

```glsl
float _random(float seed) {
  return fract(sin(seed * 12.9898) * 43758.5453);
}
```

For `Random()` (no args) — falls back to a seed derived from `gl_FragCoord.xy` (fragment shader only). Document that GP must provide a seed for vertex/compute shaders.

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (add preamble + entry)
- Test: `test/compute-engine/a1-c1-compile-parity.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
describe('A1 — Random GPU compile (deterministic seed)', () => {
  test('Random(seed) compiles to a deterministic GLSL hash', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{Random}(0.5)');
    const code = expr.compileToSource({ target: 'glsl' });
    expect(code).toMatch(/_random|fract\(sin/);
  });

  test('Random() with no seed compiles to a fragment-coord-based fallback in GLSL', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{Random}()');
    const code = expr.compileToSource({ target: 'glsl' });
    // Should reference gl_FragCoord or a comparable fallback.
    expect(code).toMatch(/gl_FragCoord|_random/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: compile errors.

- [ ] **Step 3: Add preamble + entry**

```typescript
export const GPU_RANDOM_PREAMBLE_GLSL = `
// Deterministic pseudorandom in [0, 1) from a float seed.
float _random(float seed) {
  return fract(sin(seed * 12.9898) * 43758.5453);
}
`;
```

In `GPU_FUNCTIONS`:

```typescript
  Random: (args, compile, target) => {
    target.preambles.add('GPU_RANDOM_PREAMBLE_GLSL');
    if (args.length === 0) {
      // No seed — fall back to fragment-coord-derived seed.
      // Only meaningful in fragment shaders. Document the limitation.
      return '_random(gl_FragCoord.x + gl_FragCoord.y * 1024.0)';
    }
    if (args.length === 1) {
      return `_random(${compile(args[0])})`;
    }
    throw new Error('Random: GPU compile expects 0 or 1 argument (seed)');
  },
```

- [ ] **Step 4: Run tests**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: both Random tests pass.

- [ ] **Step 5: Document the JS-side asymmetry**

In a code comment near the GPU `Random` entry, note: "JS-side `Random` remains `Math.random` (non-seeded) for backward compatibility. The seeded `Random(seed)` API matching this GPU implementation will land in A4 of the CE 0.58.0 plan."

---

## Task A1.5: `Loop` and `Integrate` — verify-only

The roadmap scoped these down to "verify-only" since each has only 1 corpus row. Confirm the JS compile path is correct and that the GLSL gap surfaces via the standard unsupported-operator diagnostic.

**Files:**
- Test: `test/compute-engine/a1-c1-compile-parity.test.ts` (append verification tests)

- [ ] **Step 1: Confirm JS compile for Loop and Integrate**

Append:

```typescript
describe('A1 — Loop / Integrate verify-only', () => {
  test('Loop compiles in JS', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{Loop}(i^2, \\operatorname{Element}(i, \\operatorname{Range}(1, 5)))');
    const fn = expr.compile() as any;
    expect(fn()).toEqual([1, 4, 9, 16, 25]);
  });

  test('Integrate compiles in JS', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_{0}^{1} x^2 \\, dx');
    const fn = expr.compile() as any;
    expect(fn()).toBeCloseTo(1 / 3, 3);
  });
});
```

- [ ] **Step 2: Confirm GLSL surfaces a clear unsupported-operator diagnostic**

```typescript
  test('Loop in GLSL surfaces a clear unsupported diagnostic for runtime-bound ranges', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.parse('\\operatorname{Loop}(i, \\operatorname{Element}(i, \\operatorname{Range}(1, n)))');
    // Either: throws with a specific message, OR compileToSource returns a recognizable error.
    // The standard CE pattern is to throw with `unsupported-operator` or similar.
    expect(() => expr.compileToSource({ target: 'glsl' })).toThrow(/runtime|Range|bounds/i);
  });

  test('Integrate in GLSL surfaces a clear unsupported diagnostic', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_{0}^{1} x^2 \\, dx');
    expect(() => expr.compileToSource({ target: 'glsl' })).toThrow();
  });
```

- [ ] **Step 3: Run tests; do NOT add new compile entries**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: all verification tests pass. If JS Loop/Integrate compile is broken (it shouldn't be — they had passing tests before), file as a separate bug; **do not fix it as part of A1**.

If the GLSL diagnostics aren't clear today (e.g., they fail with an opaque internal error), file a follow-up task in the test failure report; **don't expand A1's scope**.

---

## Task C1: `toSignedFunction()` for 3D implicit relations

GP's 3D implicit renderer needs to take an equation/inequality and evaluate the signed function form: e.g., for `x^2 + y^2 + z^2 = 1`, it needs `f(x,y,z) = x^2 + y^2 + z^2 - 1` to find the surface (where f=0) and to know which side is "inside" (where f<0).

The API: `expr.toSignedFunction()` returns a new expression `lhs - rhs` for relation expressions; returns `undefined` for non-relations. The caller branches on `expr.operator` (`Equal`, `Less`, etc.) to determine direction and strictness.

For `Less(a, b)`: signed function is `a - b` (negative when relation holds — "inside").
For `Greater(a, b)`: signed function is `b - a` (consistent: negative when relation holds).
For `Equal(a, b)`: signed function is `a - b` (zero on the surface — direction is irrelevant).
For `LessEqual` / `GreaterEqual`: same as `Less` / `Greater` (strictness is the caller's concern via `expr.operator`).

For multi-operand relations (`Less(a, b, c)` chains): use the first two operands (`a - b`). Multi-arg chained relations aren't common in 3D implicit contexts; the simple two-operand case covers the corpus.

**Files:**
- Modify: `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` (add `toSignedFunction()` method)
- Modify: `src/compute-engine/types-expression.ts` (declare in `BoxedExpression` interface)
- Test: `test/compute-engine/a1-c1-compile-parity.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
describe('C1 — toSignedFunction()', () => {
  test('Equal(lhs, rhs) returns lhs - rhs', () => {
    const ce = new ComputeEngine();
    const eq = ce.parse('x^2 + y^2 + z^2 = 1');
    const sf = eq.toSignedFunction();
    expect(sf).toBeDefined();
    // Should be equivalent to x^2 + y^2 + z^2 - 1
    expect(sf!.simplify().isSame(ce.parse('x^2 + y^2 + z^2 - 1').simplify())).toBe(true);
  });

  test('Less(lhs, rhs) returns lhs - rhs (negative when relation holds)', () => {
    const ce = new ComputeEngine();
    const ineq = ce.parse('x + y < 10');
    const sf = ineq.toSignedFunction();
    expect(sf).toBeDefined();
    // Evaluate at (1, 1): x+y-10 = -8, negative → inside.
    ce.declare('x', 'real'); ce.declare('y', 'real');
    ce.assign('x', 1); ce.assign('y', 1);
    expect(sf!.evaluate().re).toEqual(-8);
  });

  test('Greater(lhs, rhs) returns rhs - lhs (negative when relation holds)', () => {
    const ce = new ComputeEngine();
    const ineq = ce.parse('x + y > 10');
    const sf = ineq.toSignedFunction();
    expect(sf).toBeDefined();
    // Evaluate at (5, 6): rhs - lhs = 10 - 11 = -1, negative → inside (relation holds).
    ce.declare('x', 'real'); ce.declare('y', 'real');
    ce.assign('x', 5); ce.assign('y', 6);
    expect(sf!.evaluate().re).toEqual(-1);
  });

  test('LessEqual and GreaterEqual return same as Less and Greater', () => {
    const ce = new ComputeEngine();
    const leq = ce.parse('x \\le 5');
    const geq = ce.parse('x \\ge 5');
    expect(leq.toSignedFunction()).toBeDefined();
    expect(geq.toSignedFunction()).toBeDefined();
    // Strictness info comes from expr.operator, not from the signed function.
    expect(leq.operator).toEqual('LessEqual');
    expect(geq.operator).toEqual('GreaterEqual');
  });

  test('Non-relation expressions return undefined', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x + 1').toSignedFunction()).toBeUndefined();
    expect(ce.parse('5').toSignedFunction()).toBeUndefined();
    expect(ce.parse('\\sin(x)').toSignedFunction()).toBeUndefined();
  });

  test('toSignedFunction result compiles for 3D implicit rendering', () => {
    const ce = new ComputeEngine();
    const eq = ce.parse('x^2 + y^2 + z^2 = 1');
    const sf = eq.toSignedFunction()!;
    // Should compile and evaluate to 0 on the unit sphere.
    ce.declare('x', 'real'); ce.declare('y', 'real'); ce.declare('z', 'real');
    const fn = sf.compile() as any;
    expect(fn({ x: 1, y: 0, z: 0 })).toBeCloseTo(0);
    expect(fn({ x: 0, y: 0, z: 0 })).toBeCloseTo(-1);  // inside
    expect(fn({ x: 2, y: 0, z: 0 })).toBeCloseTo(3);   // outside
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: `expr.toSignedFunction` is not a function (TypeScript compile error).

- [ ] **Step 3: Declare `toSignedFunction` in the interface**

In `src/compute-engine/types-expression.ts`, find the `BoxedExpression` interface and add (near other transformation methods like `.subs()`, `.simplify()`):

```typescript
  /**
   * For a relation expression (`Equal`, `Less`, `Greater`, `LessEqual`,
   * `GreaterEqual`, `NotEqual`), return the "signed function" form
   * useful for implicit-surface rendering and region classification:
   *
   * - `Equal(a, b)` → `a - b` (zero on the surface)
   * - `Less(a, b)` / `LessEqual(a, b)` → `a - b` (negative when relation holds)
   * - `Greater(a, b)` / `GreaterEqual(a, b)` → `b - a` (negative when relation holds)
   * - `NotEqual(a, b)` → `a - b` (caller checks ≠ 0)
   *
   * For non-relation expressions, returns `undefined`.
   *
   * Strictness (strict vs non-strict inequality) and direction (less vs
   * greater) are encoded in the original `expr.operator`, not in the
   * returned expression. Callers handling 3D implicit rendering use
   * `expr.operator` for the boundary policy and the signed function for
   * the interior/exterior classification.
   */
  toSignedFunction(): BoxedExpression | undefined;
```

- [ ] **Step 4: Implement `toSignedFunction()`**

In `src/compute-engine/boxed-expression/abstract-boxed-expression.ts`, add a method near other transformation methods (look for `subs`, `simplify`):

```typescript
  toSignedFunction(): BoxedExpression | undefined {
    const op = this.operator;
    if (op === undefined || this.ops === undefined || this.ops.length < 2) {
      return undefined;
    }
    const [lhs, rhs] = this.ops;
    const engine = this.engine;
    switch (op) {
      case 'Equal':
      case 'NotEqual':
      case 'Less':
      case 'LessEqual':
        return engine.function('Subtract', [lhs, rhs]);
      case 'Greater':
      case 'GreaterEqual':
        return engine.function('Subtract', [rhs, lhs]);
      default:
        return undefined;
    }
  }
```

**Verify**:
- `engine.function('Subtract', ...)` may not be the canonical builder. Look at how other transformation methods construct results — they may use `engine._fn('Subtract', ...)` or `engine.function('Add', [lhs, engine.neg(rhs)])` to avoid the non-canonical `Subtract` form. Mirror the prevailing pattern.
- If `Subtract` is normalized to `Add(a, Negate(b))` at construction, that's fine — the signed function semantics are preserved.

- [ ] **Step 5: Run tests + broader regression**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: all 6 C1 tests pass.

Run: `npm run test compute-engine`
Expected: no regressions.

---

## Final validation

After all tasks land:

- [ ] **Run the full A1+C1 suite**

Run: `npm run test compute-engine/a1-c1-compile-parity`
Expected: all tests pass.

- [ ] **Run the broader CE test suite**

Run: `npm run test compute-engine`
Expected: no regressions (8147 passing baseline from A6 completion).

- [ ] **Run the cycles check**

Run: `npx madge --circular --extensions ts src/compute-engine`
Expected: 0 cycles.

- [ ] **Run typecheck**

Run: `npm run typecheck`
Expected: 0 new errors (existing 11 unchanged).

- [ ] **Manual probe against GP's audit expectations**

```bash
npx tsx -e "
import { ComputeEngine } from './src/compute-engine';
const ce = new ComputeEngine();

ce.declare('p', 'tuple<number, number, number>');
const px = ce.parse('p.x').compile();
console.log('First compiles:', typeof px === 'function');

ce.declare('x', 'real'); ce.declare('y', 'real'); ce.declare('z', 'real');
const sphere = ce.parse('x^2 + y^2 + z^2 = 1').toSignedFunction();
console.log('toSignedFunction defined:', sphere !== undefined);
console.log('Sphere signed-function:', sphere?.simplify().toString());
"
```

Expected:
```
First compiles: true
toSignedFunction defined: true
Sphere signed-function: x^2 + y^2 + z^2 - 1  (or equivalent canonical form)
```

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| GPU compile preamble system may not support per-N parameterized preambles (Variance/Median) | Step 3 of A1.3 explicitly mandates checking the existing preamble mechanism before committing the strategy; fall back to inlining for compile-time-known sizes |
| `target.preambles.add(...)` API name is conjectural | Each GPU task's step explicitly says "verify the actual API name before finalizing"; mirror neighboring operators |
| GLSL/WGSL vec swizzles for `First`/`Second`/`Third` assume tuple operands are compiled as `vec2`/`vec3`/`vec4` | Verify against existing tuple compile paths (`Tuple: compileGLSLList`); if tuples sometimes compile to `float[]` arrays, also support that path |
| `Random` GPU/JS asymmetry (GPU is seeded, JS is `Math.random`) creates surprising behavior | Comment in the code; full harmonization is A4 work |
| `toSignedFunction` for chained relations (`a < b < c`) only uses first two operands | Document this in JSDoc; the corpus doesn't show chained 3D relations |

---

## Out of scope (other 0.58.0 buckets)

- A2 restrictions (interval extraction, compact piecewise)
- A3 lists (broadcasting, indexing, reducers, type rejection)
- A4 actions (`\operatorname{with}` parser, JS-side seeded Random — harmonizes with A1's GPU side)
- A5 for-comprehension filter clauses
- A6 polish (shipped)
