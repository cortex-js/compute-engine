# CE 0.58.0 — A2 Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close A2 (CE-P3 restrictions) from the CE 0.58.0 plan. Four sub-items: (1) interval extraction from `When(e, a < x < b)` for plot-domain derivation, (2) compact Desmos piecewise `\{cond:val, …, default\}` → `Which`, (3) verify multi-restriction → chained ternary in GLSL, (4) document `When(e, false)` masking rule.

**Architecture:** Most work is parser-side or evaluator-side, not compile-target.

- **Interval extraction**: extends the existing `inequality-bounds.ts` module with a function that operates on condition expressions (vs. the existing function that operates on the assumption DB). Exposed as a method on `BoxedExpression`.
- **Compact piecewise**: lower `Colon` precedence so `cond:val` parses as `Colon(cond, val)` (currently the comparison binds tighter, producing malformed ASTs). Then extend the `Set` matchfix parser to detect comma-separated Colon-pairs and lower them to `Which`.
- **Multi-restriction GLSL**: already canonicalized to `When(e, And(c1, c2))` which compiles to a single chained ternary. Add explicit regression tests.
- **`When(e, false)` rule**: source-side documentation pointing at the existing `→ Undefined` evaluator behavior.

**Tech Stack:** TypeScript, Jest, MathJSON, LaTeX parsing.

**Policy:** Per the user's CLAUDE.md, this plan omits `git commit` steps.

**Status check before work:** `When` evaluator handles the False case correctly today (`Undefined`); `When` compilation handles stacked restrictions via canonicalization to `And`; `Set` matchfix parser exists; `inequality-bounds.ts` has a precedent function operating on assumptions. None of this is from scratch.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/compute-engine/boxed-expression/inequality-bounds.ts` | New `extractIntervalBounds(condExpr, symbol)` function alongside the existing `getInequalityBoundsFromAssumptions`. Shares helpers. |
| `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` | New `getInterval(symbol)` method that wraps `extractIntervalBounds` for `When`, `Less`, `Greater`, etc. |
| `src/compute-engine/types-expression.ts` | `BoxedExpression` interface — declare `getInterval`. Add `IntervalBounds` type. |
| `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` | Lower `Colon` precedence below comparisons (245 → 240). Verify no regressions. |
| `src/compute-engine/latex-syntax/dictionary/definitions-sets.ts` | Extend `Set` matchfix parse handler to detect Colon-pair sequences and lower to `Which`. |
| `src/compute-engine/library/control-structures.ts` | Add documentation comment on `When` operator describing the masking rule. |
| `test/compute-engine/a2-restrictions.test.ts` | New test file covering all A2 items. |

---

## Task A2.1: Interval extraction from `When` expressions

GP's 2D plotting renderer needs to derive plot domains from `y = f(x)\{a < x < b\}` rows — extracting `[a, b]` (open) from the restriction so it can clip the curve. The general primitive: given a condition expression containing comparisons over a symbol, return the symbol's bounds.

**API design:**

```typescript
type IntervalBounds = {
  lower?: BoxedExpression;
  lowerStrict?: boolean;  // true for strict (<), false for non-strict (≤)
  upper?: BoxedExpression;
  upperStrict?: boolean;
};

interface BoxedExpression {
  /**
   * For an expression representing a domain restriction (a `When` whose
   * condition is a comparison or `And` of comparisons over `symbol`, or
   * a bare comparison expression), return the lower/upper bounds for
   * `symbol`. Returns `undefined` if no bounds can be extracted.
   *
   * Supported condition shapes:
   * - `a < x`, `x < b`, `a < x < b`
   * - `a <= x`, `x <= b`, `a <= x <= b`  (strict/non-strict carried in flags)
   * - `And(c1, c2)` where each `ci` is a supported shape
   * - `Greater`/`GreaterEqual` (rare post-canonicalization but supported)
   *
   * Returns `undefined` for unsupported shapes (e.g. equations, non-linear
   * constraints, comparisons over multiple symbols, disjunctions).
   */
  getInterval(symbol: string): IntervalBounds | undefined;
}
```

**Files:**
- Modify: `src/compute-engine/boxed-expression/inequality-bounds.ts` (add `extractIntervalBounds`)
- Modify: `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` (add `getInterval` method)
- Modify: `src/compute-engine/types-expression.ts` (declare `IntervalBounds` type + interface method)
- Test: `test/compute-engine/a2-restrictions.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `test/compute-engine/a2-restrictions.test.ts`:

```typescript
import { ComputeEngine } from '../../src/compute-engine';

describe('A2 — Interval extraction from When expressions', () => {
  test('extracts open bounds from When(f(x), a < x < b)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 < x < 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper?.re).toEqual(5);
    expect(interval?.lowerStrict).toBe(true);
    expect(interval?.upperStrict).toBe(true);
  });

  test('extracts closed bounds from When(f(x), a <= x <= b)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 \\le x \\le 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper?.re).toEqual(5);
    expect(interval?.lowerStrict).toBe(false);
    expect(interval?.upperStrict).toBe(false);
  });

  test('extracts mixed strictness from When(f(x), a < x <= b)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 < x \\le 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lowerStrict).toBe(true);
    expect(interval?.upperStrict).toBe(false);
  });

  test('extracts from When with And of comparisons', () => {
    const ce = new ComputeEngine();
    // Two stacked restrictions canonicalize to When(e, And(c1, c2))
    const expr = ce.parse('f(x)\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper?.re).toEqual(5);
  });

  test('handles one-sided bounds', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{x > 3\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(3);
    expect(interval?.upper).toBeUndefined();
  });

  test('returns undefined for non-restriction expressions', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x + 1').getInterval('x')).toBeUndefined();
    expect(ce.parse('\\sin(x)').getInterval('x')).toBeUndefined();
    expect(ce.parse('5').getInterval('x')).toBeUndefined();
  });

  test('returns undefined for unrelated symbol', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 < x < 5\\right\\}');
    expect(expr.getInterval('y')).toBeUndefined();
  });

  test('extracts from a bare comparison expression', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('0 < x');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/a2-restrictions`
Expected: TypeScript error — `getInterval` doesn't exist on `BoxedExpression`.

- [ ] **Step 3: Add `IntervalBounds` type and `getInterval` to the interface**

In `src/compute-engine/types-expression.ts`, near other expression-related types, add:

```typescript
export type IntervalBounds = {
  lower?: BoxedExpression;
  lowerStrict?: boolean;
  upper?: BoxedExpression;
  upperStrict?: boolean;
};
```

In the `BoxedExpression` interface (find existing methods like `subs`, `simplify`, `toSignedFunction`), add:

```typescript
  /**
   * For an expression representing a domain restriction (a `When` whose
   * condition is a comparison or `And` of comparisons over `symbol`, or
   * a bare comparison expression), return the lower/upper bounds for
   * `symbol`. Returns `undefined` if no bounds can be extracted.
   *
   * Supported condition shapes:
   * - Bare comparisons: `a < x`, `x < b`, etc.
   * - Chained comparisons: `a < x < b` (parsed as `Less(a, x, b)`)
   * - `And(c1, c2, ...)` where each `ci` is a supported shape
   *
   * `lowerStrict`/`upperStrict` are `true` for strict (`<`, `>`) bounds
   * and `false` for non-strict (`≤`, `≥`).
   *
   * Returns `undefined` for unsupported shapes (e.g. equations, non-linear
   * constraints, comparisons over multiple symbols, disjunctions).
   */
  getInterval(symbol: string): IntervalBounds | undefined;
```

Also export `IntervalBounds` from `global-types.ts` (or wherever `BoxedExpression`-related types are re-exported) so consumers can import the type.

- [ ] **Step 4: Implement `extractIntervalBounds` in `inequality-bounds.ts`**

In `src/compute-engine/boxed-expression/inequality-bounds.ts`, **before** the existing `getInequalityBoundsFromAssumptions` function, add:

```typescript
/**
 * Extract interval bounds for `symbol` from a condition expression.
 *
 * Unlike `getInequalityBoundsFromAssumptions` (which reads the engine's
 * assumption DB), this function operates directly on an AST shape:
 * comparisons, `And` of comparisons, or `When(e, cond)`.
 *
 * Returns `undefined` if `expr` doesn't carry interval information for
 * `symbol`, or if the information is contradictory / not a simple
 * lower-upper pair.
 */
export function extractIntervalBounds(
  expr: BoxedExpression,
  symbol: string
): IntervalBounds | undefined {
  // Unwrap When(e, cond) → operate on cond.
  if (isFunction(expr, 'When')) {
    return extractIntervalBounds(expr.op2, symbol);
  }

  const result: IntervalBounds = {};

  // Recursively merge bounds from And(c1, c2, ...).
  if (isFunction(expr, 'And')) {
    for (const sub of expr.ops!) {
      const subBounds = extractIntervalBounds(sub, symbol);
      if (subBounds === undefined) continue;
      mergeBounds(result, subBounds);
    }
    return hasAnyBound(result) ? result : undefined;
  }

  // Comparison heads: Less, LessEqual, Greater, GreaterEqual.
  const op = expr.operator;
  if (op === 'Less' || op === 'LessEqual' ||
      op === 'Greater' || op === 'GreaterEqual') {
    const isStrict = op === 'Less' || op === 'Greater';
    const ops = expr.ops!;

    // Normalize Greater/GreaterEqual to Less/LessEqual form by flipping.
    // Less(a, b, c)         → a < b < c  → x = b: lower a, upper c
    // Less(a, b)            → a < b      → if b is x: lower a; if a is x: upper b
    // LessEqual same pattern; Greater is its flip.
    const flipped = (op === 'Greater' || op === 'GreaterEqual')
      ? [...ops].reverse()
      : ops;

    // Walk the (flipped) chain looking for `symbol` as an operand.
    // For chain length 2 (binary):
    //   [lower, symbol] → lower bound
    //   [symbol, upper] → upper bound
    // For chain length 3 (a < x < b):
    //   [lower, symbol, upper]
    for (let i = 0; i < flipped.length; i++) {
      if (isSymbol(flipped[i], symbol)) {
        if (i > 0) {
          // The operand before is a lower bound.
          const candidate = flipped[i - 1];
          if (result.lower === undefined ||
              candidate.isGreater(result.lower) === true) {
            result.lower = candidate;
            result.lowerStrict = isStrict;
          }
        }
        if (i < flipped.length - 1) {
          // The operand after is an upper bound.
          const candidate = flipped[i + 1];
          if (result.upper === undefined ||
              candidate.isLess(result.upper) === true) {
            result.upper = candidate;
            result.upperStrict = isStrict;
          }
        }
      }
    }
    return hasAnyBound(result) ? result : undefined;
  }

  return undefined;
}

function mergeBounds(into: IntervalBounds, from: IntervalBounds): void {
  if (from.lower !== undefined) {
    if (into.lower === undefined ||
        from.lower.isGreater(into.lower) === true) {
      into.lower = from.lower;
      into.lowerStrict = from.lowerStrict;
    } else if (from.lower.isSame(into.lower)) {
      // Same numeric bound: strict wins (more restrictive)
      into.lowerStrict = into.lowerStrict || from.lowerStrict;
    }
  }
  if (from.upper !== undefined) {
    if (into.upper === undefined ||
        from.upper.isLess(into.upper) === true) {
      into.upper = from.upper;
      into.upperStrict = from.upperStrict;
    } else if (from.upper.isSame(into.upper)) {
      into.upperStrict = into.upperStrict || from.upperStrict;
    }
  }
}

function hasAnyBound(b: IntervalBounds): boolean {
  return b.lower !== undefined || b.upper !== undefined;
}
```

**Verify before finalizing:**
- The `isFunction`/`isSymbol` imports may need to be added. Check the existing imports at the top of the file.
- `BoxedExpression` type may need to be imported — look at how `getInequalityBoundsFromAssumptions` uses types.
- `IntervalBounds` type — if it's declared in `types-expression.ts`, import it here.
- `.isGreater()`/`.isLess()`/`.isSame()` should be available on `BoxedExpression`. If they're not in scope, fall back to simpler structural comparison (only good for literal numbers).

- [ ] **Step 5: Implement the `getInterval` method on `BoxedExpression`**

In `src/compute-engine/boxed-expression/abstract-boxed-expression.ts`, add a method near `toSignedFunction`:

```typescript
  getInterval(symbol: string): IntervalBounds | undefined {
    return extractIntervalBounds(this, symbol);
  }
```

Add the import for `extractIntervalBounds` at the top of the file. The `IntervalBounds` type comes from `types-expression.ts` via the abstract-boxed-expression's existing imports.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test compute-engine/a2-restrictions`
Expected: all 8 interval extraction tests pass.

- [ ] **Step 7: Run broader regression**

Run: `npm run test compute-engine`
Expected: 8181 baseline preserved, +8 new tests = 8189.

---

## Task A2.2: Compact Desmos piecewise → `Which`

Desmos uses `\{cond_1 : val_1, cond_2 : val_2, ..., default\}` as a compact piecewise notation. Today this parses as `Set(Less(Colon(0, val_1), x), Less(x, Colon(0, val_2)), default)` because (a) `Colon` precedence (250) is higher than comparison precedence (245), and (b) the `Set` matchfix parser only recognizes the set-builder shape `{expr | cond}`, not the compact piecewise shape.

**Fix in two steps:**
1. Lower `Colon` precedence from 250 to **240** so `cond : val` parses as `Colon(cond, val)` (Colon binds looser than comparisons).
2. Extend the `Set` matchfix parser to recognize a sequence of `Colon` elements optionally followed by a default, and rewrite to `Which(c_1, v_1, c_2, v_2, True, default)`.

The roadmap mentions a `Piecewise` head, but CE's `\begin{cases}` already lowers to `Which` — same target avoids introducing a new head.

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` (Colon precedence)
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-sets.ts` (Set parse handler)
- Test: `test/compute-engine/a2-restrictions.test.ts` (append)

- [ ] **Step 1: Verify current behavior**

```bash
npx tsx -e "
import { ComputeEngine } from './src/compute-engine';
const ce = new ComputeEngine();
console.log(JSON.stringify(ce.parse('\\\\{x > 0 : 1, x < 0 : -1, 0\\\\}').json));
"
```
Expected output (today): `["Set",["Less",["Colon",0,1],"x"],["Less","x",["Colon",0,-1]],0]` — the malformed AST.

- [ ] **Step 2: Write the failing tests**

Append to `test/compute-engine/a2-restrictions.test.ts`:

```typescript
describe('A2 — Compact piecewise parsing', () => {
  test('{cond:val, cond:val, default} parses to Which', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}');
    // Should produce Which(cond1, val1, cond2, val2, True, default)
    expect(expr.operator).toEqual('Which');
    const ops = expr.ops!;
    expect(ops.length).toEqual(6);
    expect(ops[0].operator).toEqual('Less');  // x > 0 canonicalizes to 0 < x → Less(0, x)
    expect(ops[1].re).toEqual(1);
    expect(ops[2].operator).toEqual('Less');
    expect(ops[3].re).toEqual(-1);
    expect(ops[4].symbol).toEqual('True');
    expect(ops[5].re).toEqual(0);
  });

  test('{cond:val, default} parses to Which', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left\\{x > 0 : 1, 0\\right\\}');
    expect(expr.operator).toEqual('Which');
    expect(expr.ops!.length).toEqual(4);  // cond1, val1, True, default
  });

  test('{cond:val} (no default) parses to Which with implicit default', () => {
    // Desmos behavior: missing default = Undefined.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left\\{x > 0 : 1\\right\\}');
    expect(expr.operator).toEqual('Which');
    expect(expr.ops!.length).toEqual(2);  // cond1, val1
  });

  test('compact piecewise evaluates correctly', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 3);
    expect(ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}').evaluate().re).toEqual(1);
    ce.assign('x', -3);
    expect(ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}').evaluate().re).toEqual(-1);
    ce.assign('x', 0);
    expect(ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}').evaluate().re).toEqual(0);
  });

  test('non-piecewise set literals still parse as Set', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\{1, 2, 3\\}');
    expect(expr.operator).toEqual('Set');
    expect(expr.ops!.length).toEqual(3);
  });

  test('set-builder notation still parses correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\{x \\mid x > 0\\}');
    expect(expr.operator).toEqual('Set');
    // Set-builder form: Set(x, Condition(x > 0))
    expect(expr.ops!.length).toEqual(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test compute-engine/a2-restrictions`
Expected: compact piecewise tests fail (current behavior is malformed Set with Colon inside Less).

- [ ] **Step 4: Lower `Colon` precedence**

In `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` around line 487:

Current:
```typescript
  // and below arrows (270) so `f: A \to B` parses as `Colon(f, To(A, B))`
  {
    name: 'Colon',
    latexTrigger: ':',
    kind: 'infix',
    associativity: 'right',
    precedence: 250,
```

Change to:
```typescript
  // Below comparisons (245) so `cond : val` (Desmos compact piecewise)
  // parses as `Colon(cond, val)`, and below arrows (270) so
  // `f: A \to B` parses as `Colon(f, To(A, B))`.
  {
    name: 'Colon',
    latexTrigger: ':',
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
```

**Verify**: run `npm run test compute-engine` AFTER this change but BEFORE the Set parser changes. Some tests may break — list them in your report. Common concerns:
- Function type annotations `f: A -> B` (still works because `->`/`To` precedence is 270, above Colon's new 240)
- Set-builder `{x : type | cond}` — Divides precedence 160 < Colon 240, so Divides binds looser → still works
- `\sum_{i:I}` and similar — Colon at 240 inside subscript should still bind correctly

If a substantial number of pre-existing tests break, **stop and report** — the precedence change isn't worth the regression cost. Fall back to detecting the malformed AST in the Set parser (uglier but localized).

- [ ] **Step 5: Verify the precedence change parses Colon correctly**

```bash
npx tsx -e "
import { ComputeEngine } from './src/compute-engine';
const ce = new ComputeEngine();
console.log(JSON.stringify(ce.parse('x > 0 : 1').json));
"
```
Expected: `["Colon",["Greater","x",0],1]` (or post-canonical `["Colon",["Less",0,"x"],1]`).

If it still produces `Greater(x, Colon(0, 1))` or similar, the precedence is still wrong — investigate before proceeding.

- [ ] **Step 6: Extend the `Set` matchfix parser**

In `src/compute-engine/latex-syntax/dictionary/definitions-sets.ts` around line 371, in the `Set` entry's `parse` handler, **before** the existing set-builder check, add a compact-piecewise detection block.

The body after parsing a `\{...\}` form arrives as either a single expression or a `Sequence(...)`. For compact piecewise, the sequence's elements should all be `Colon(cond, val)` except optionally a final non-Colon "default" element.

Modify the `parse` handler:

```typescript
    parse: (_parser: Parser, body: MathJsonExpression): MathJsonExpression => {
      if (isEmptySequence(body)) return 'EmptySet';

      // Check for set-builder notation: {expr | condition} or {expr \mid condition}
      const h = operator(body);
      if (h === 'Divides' || h === 'Colon') {
        // For Colon: only treat as set-builder if it's a SINGLE Colon at top
        // level (i.e. {expr : cond}). Multiple Colon elements with commas
        // would have come through as a Sequence below, not as a single Colon.
        // The Divides case ({x | cond}) is unambiguous.
        if (h === 'Divides') {
          const expr = operand(body, 1);
          const condition = operand(body, 2);
          if (expr !== null && condition !== null)
            return ['Set', expr, ['Condition', condition]];
        }
        // Single Colon at top level: ambiguous. Could be set-builder
        // {x : type | cond}, or a compact piecewise with one branch and
        // no default. Treat as set-builder for compatibility with the
        // existing convention.
        if (h === 'Colon') {
          const expr = operand(body, 1);
          const condition = operand(body, 2);
          if (expr !== null && condition !== null)
            return ['Set', expr, ['Condition', condition]];
        }
      }

      // Unwrap Delimiter wrapper.
      if (
        operator(body) == 'Delimiter' &&
        stringValue(operand(body, 2)) === ','
      ) {
        body = operand(body, 1)!;
      }

      // Sequence form: check for compact Desmos piecewise.
      // If the body is a Sequence and ANY element is a Colon, treat as
      // compact piecewise. Each Colon element is a cond:val pair; a final
      // non-Colon element (if present) is the default.
      if (operator(body) === 'Sequence') {
        const elements = operands(body);
        const hasColon = elements.some((el) => operator(el) === 'Colon');
        if (hasColon) {
          // Build the Which form: cond1, val1, cond2, val2, ..., True, default
          const whichOps: MathJsonExpression[] = [];
          let i = 0;
          for (; i < elements.length; i++) {
            const el = elements[i];
            if (operator(el) === 'Colon') {
              const cond = operand(el, 1);
              const val = operand(el, 2);
              if (cond === null || val === null) break;
              whichOps.push(cond, val);
            } else {
              // Non-Colon element — should be the last one (the default).
              if (i !== elements.length - 1) {
                // Non-Colon in the middle: malformed, fall through to Set.
                return ['Set', ...elements];
              }
              whichOps.push('True', el);
            }
          }
          return ['Which', ...whichOps];
        }
        return ['Set', ...elements];
      }

      return ['Set', body];
    },
```

**Verify before finalizing:**
- The actual MathJSON helper names (`operator`, `operand`, `operands`, `stringValue`, `isEmptySequence`) should match what the existing parser file uses. Mirror them exactly.
- `'True'` as a MathJSON expression — verify it's the correct literal form (vs. `{ sym: 'True' }` or similar).
- The order of the legacy set-builder block vs. the new piecewise block matters — put the piecewise detection AFTER the Delimiter unwrap but BEFORE the final `return ['Set', ...]`.

- [ ] **Step 7: Run tests + broader regression**

Run: `npm run test compute-engine/a2-restrictions`
Expected: all 6 compact-piecewise tests pass.

Run: `npm run test compute-engine`
Expected: no broader regressions. If anything broke, investigate before continuing.

---

## Task A2.3: Verify multi-restriction → chained ternary in GLSL

`When` canonicalization already handles stacked restrictions: `When(When(e, c1), c2) → When(e, And(c1, c2))`. The base compiler emits `((cond) ? (expr) : NaN)` for `When`. For `And(c1, c2)`, the default JS/GLSL `&&` compilation kicks in. So multi-restriction compilation should already produce a single chained ternary `((c1 && c2) ? expr : NaN)`.

This task adds explicit regression tests. **No source-side changes expected.**

**Files:**
- Test: `test/compute-engine/a2-restrictions.test.ts` (append)

- [ ] **Step 1: Add the verification tests**

Append:

```typescript
describe('A2 — Multi-restriction GLSL verification', () => {
  test('stacked restrictions canonicalize to When(e, And(c1, c2))', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    expect(expr.operator).toEqual('When');
    expect(expr.op2.operator).toEqual('And');
    expect(expr.op2.ops!.length).toEqual(2);
  });

  test('stacked restrictions compile to a single chained ternary in GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const { GLSLTarget } = require('../../src/compute-engine/compilation/glsl-target');
    const target = new GLSLTarget();
    const expr = ce.parse('x^2\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    // One ternary, not nested ternaries — verify by structure rather than
    // exact form (could be `(c1 && c2) ? x*x : NaN` or
    // `((0.0 < x) && (x < 5.0)) ? x*x : ...`).
    const ternaryCount = (result.code.match(/\?/g) ?? []).length;
    expect(ternaryCount).toEqual(1);
  });

  test('stacked restrictions evaluate correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x^2\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    ce.assign('x', 3);
    expect(expr.evaluate().re).toEqual(9);
    ce.assign('x', -1);
    expect(expr.evaluate().symbol).toEqual('Undefined');
    ce.assign('x', 10);
    expect(expr.evaluate().symbol).toEqual('Undefined');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test compute-engine/a2-restrictions`
Expected: all 3 verification tests pass with no source-side changes.

If a test fails: report what's actually happening (e.g., maybe canonicalization doesn't fully flatten `And` when there are multiple stacks, or the GLSL output uses nested ternaries). **Do not "fix" by adding more compile logic** — first verify what behavior is expected.

---

## Task A2.4: Document `When(e, false)` masking rule

`When`'s existing evaluator already returns `Undefined` for `When(e, False)` (control-structures.ts:119). This is the masking rule GP needs. Add a JSDoc comment to make it discoverable.

**Files:**
- Modify: `src/compute-engine/library/control-structures.ts` (`When` operator definition — expand the `description` field)

- [ ] **Step 1: Update the `When` description**

In `src/compute-engine/library/control-structures.ts` around line 94-96, replace:

```typescript
    When: {
      description:
        'Conditional value: returns expr when cond holds, undefined otherwise.',
```

with:

```typescript
    When: {
      description:
        'Conditional/restriction value. `When(e, cond)` evaluates to:\n' +
        '  - `e` when `cond` evaluates to `True`\n' +
        '  - `Undefined` when `cond` evaluates to `False` (the "masking rule"; consumers like 2D plotters skip masked points)\n' +
        '  - `When(e, cond_simplified)` when `cond` is indeterminate (holds)\n' +
        'Stacked restrictions canonicalize: `When(When(e, c1), c2)` → `When(e, And(c1, c2))`.\n' +
        'Compiles to ternary `(cond) ? (e) : NaN` in JS and GLSL.',
```

- [ ] **Step 2: Add a regression test for the masking rule**

Append to `test/compute-engine/a2-restrictions.test.ts`:

```typescript
describe('A2 — When(e, False) masking rule', () => {
  test('When(e, False) evaluates to Undefined', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['When', 42, 'False']);
    expect(expr.evaluate().symbol).toEqual('Undefined');
  });

  test('When(e, True) evaluates to e', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['When', 42, 'True']);
    expect(expr.evaluate().re).toEqual(42);
  });

  test('When(e, indeterminate) holds the form', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(['When', 'x', ['Less', 0, 'x']]);
    const result = expr.evaluate();
    expect(result.operator).toEqual('When');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test compute-engine/a2-restrictions`
Expected: 3 new tests pass.

---

## Final validation

After all 4 tasks land:

- [ ] **Run the full A2 suite**

Run: `npm run test compute-engine/a2-restrictions`
Expected: all tests pass (8 interval + 6 compact piecewise + 3 multi-restriction + 3 masking = 20 tests).

- [ ] **Run the broader CE test suite**

Run: `npm run test compute-engine`
Expected: 8181 baseline + 20 new = 8201 passing (or close — minor variations OK if any pre-existing tests touch the same modules).

- [ ] **Run cycles + typecheck**

Run: `npx madge --circular --extensions ts src/compute-engine`
Expected: 0 cycles.

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Manual probe**

```bash
npx tsx -e "
import { ComputeEngine } from './src/compute-engine';
const ce = new ComputeEngine();

// Interval extraction
const restricted = ce.parse('f(x)\\\\{0 < x < 5\\\\}');
const i = restricted.getInterval('x');
console.log('Interval bounds:', i?.lower?.re, i?.upper?.re, 'strict:', i?.lowerStrict, i?.upperStrict);

// Compact piecewise
const cp = ce.parse('\\\\{x > 0 : 1, x < 0 : -1, 0\\\\}');
console.log('Compact piecewise:', cp.operator, JSON.stringify(cp.json));

// Masking rule
console.log('When(e, False):', ce.box(['When', 42, 'False']).evaluate().symbol);
"
```

Expected:
```
Interval bounds: 0 5 strict: true true
Compact piecewise: Which ["Which", ...]
When(e, False): Undefined
```

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| Lowering `Colon` precedence breaks existing parses (set-builder, type annotations, sum-index) | Step 4 of A2.2 explicitly says to run the full test suite AFTER the precedence change and report regressions before continuing; fallback is to detect malformed AST in the Set parser instead |
| Interval extraction misses corpus shapes we haven't anticipated | Add tests as GP's audit reveals gaps; the API gracefully returns `undefined` for unsupported shapes |
| `Which` doesn't match what GP expected (the roadmap mentioned `Piecewise`) | The roadmap said "→ Piecewise"; we're using `Which` because that's CE's existing piecewise head. Document this in the CE Response section of the roadmap |
| Multi-restriction GLSL tests fail (canonicalization doesn't fully flatten) | A2.3 says "report rather than fix" — investigate root cause and file a follow-up rather than expanding A2's scope |

---

## Out of scope

- A3 (lists/vectorization), A4 (actions), A5 (filter clauses) — separate buckets
- Renaming `Which` to `Piecewise` — cosmetic; both names refer to the same head
