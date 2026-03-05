# GPU Constant Folding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fold compile-time constants and optimize complex number construction in GPU compilation targets, turning `vec2(x, 0.0) + (y * vec2(0.0, 1.0))` into `vec2(x, y)`.

**Architecture:** Three helper utilities in a new `constant-folding.ts` file handle constant extraction, complex decomposition, and term folding. The existing `GPU_FUNCTIONS` handlers in `gpu-target.ts` call these helpers instead of naively compiling and joining operands.

**Tech Stack:** TypeScript, existing `Expression` / `BaseCompiler` / type-guard APIs.

**Design doc:** `docs/plans/2026-03-05-constant-folding-design.md`

---

### Task 1: Create `constant-folding.ts` with `tryGetConstant`

**Files:**
- Create: `src/compute-engine/compilation/constant-folding.ts`
- Test: `test/compute-engine/compile-constant-folding.test.ts`

**Step 1: Write the failing tests**

Create `test/compute-engine/compile-constant-folding.test.ts`:

```typescript
import { engine as ce } from '../utils';
import { tryGetConstant } from '../../src/compute-engine/compilation/constant-folding';

describe('CONSTANT FOLDING', () => {
  describe('tryGetConstant', () => {
    it('should return value for integer literal', () => {
      expect(tryGetConstant(ce.number(42))).toBe(42);
    });

    it('should return value for float literal', () => {
      expect(tryGetConstant(ce.number(3.14))).toBeCloseTo(3.14);
    });

    it('should return value for rational', () => {
      expect(tryGetConstant(ce.expr(['Rational', 1, 2]))).toBe(0.5);
    });

    it('should return value for negative number', () => {
      expect(tryGetConstant(ce.number(-7))).toBe(-7);
    });

    it('should return undefined for symbol', () => {
      expect(tryGetConstant(ce.expr('x'))).toBeUndefined();
    });

    it('should return undefined for function expression', () => {
      expect(tryGetConstant(ce.parse('x + 1'))).toBeUndefined();
    });

    it('should return undefined for complex number', () => {
      expect(tryGetConstant(ce.expr(['Complex', 3, 4]))).toBeUndefined();
    });

    it('should return 0 for zero', () => {
      expect(tryGetConstant(ce.number(0))).toBe(0);
    });

    it('should return undefined for NaN', () => {
      expect(tryGetConstant(ce.number(NaN))).toBeUndefined();
    });

    it('should return undefined for Infinity', () => {
      expect(tryGetConstant(ce.number(Infinity))).toBeUndefined();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/compute-engine/compilation/constant-folding.ts`:

```typescript
import type { Expression } from '../global-types';
import { isNumber } from '../boxed-expression/type-guards';

/**
 * Extract a compile-time numeric constant from an expression.
 *
 * Returns the numeric value if the expression is a finite real literal
 * (integer, rational, or float). Returns `undefined` for symbols,
 * function expressions, complex numbers, NaN, or Infinity.
 */
export function tryGetConstant(expr: Expression): number | undefined {
  if (!isNumber(expr)) return undefined;
  if (expr.im !== 0) return undefined;
  const v = expr.re;
  if (!isFinite(v)) return undefined;
  return v;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add tryGetConstant helper for compilation constant folding
```

---

### Task 2: Add `foldTerms` helper

**Files:**
- Modify: `src/compute-engine/compilation/constant-folding.ts`
- Modify: `test/compute-engine/compile-constant-folding.test.ts`

**Step 1: Write the failing tests**

Append to `test/compute-engine/compile-constant-folding.test.ts`:

```typescript
import { foldTerms } from '../../src/compute-engine/compilation/constant-folding';

describe('foldTerms', () => {
  describe('addition', () => {
    it('should return identity for empty array', () => {
      expect(foldTerms([], '0.0', '+')).toBe('0.0');
    });

    it('should return single term', () => {
      expect(foldTerms(['x'], '0.0', '+')).toBe('x');
    });

    it('should join multiple terms', () => {
      expect(foldTerms(['x', 'y'], '0.0', '+')).toBe('x + y');
    });

    it('should fold numeric literals', () => {
      expect(foldTerms(['2.0', '3.0'], '0.0', '+')).toBe('5.0');
    });

    it('should fold numeric literals mixed with variables', () => {
      expect(foldTerms(['2.0', 'x', '3.0'], '0.0', '+')).toBe('5.0 + x');
    });

    it('should eliminate zero terms', () => {
      expect(foldTerms(['x', '0.0', 'y'], '0.0', '+')).toBe('x + y');
    });

    it('should eliminate -0.0 terms', () => {
      expect(foldTerms(['x', '-0.0'], '0.0', '+')).toBe('x');
    });

    it('should handle all zeros', () => {
      expect(foldTerms(['0.0', '0.0'], '0.0', '+')).toBe('0.0');
    });
  });

  describe('multiplication', () => {
    it('should return identity for empty array', () => {
      expect(foldTerms([], '1.0', '*')).toBe('1.0');
    });

    it('should return single term', () => {
      expect(foldTerms(['x'], '1.0', '*')).toBe('x');
    });

    it('should fold numeric literals', () => {
      expect(foldTerms(['2.0', '3.0'], '1.0', '*')).toBe('6.0');
    });

    it('should fold numeric literals mixed with variables', () => {
      expect(foldTerms(['2.0', 'x', '3.0'], '1.0', '*')).toBe('6.0 * x');
    });

    it('should eliminate identity (1.0) terms', () => {
      expect(foldTerms(['x', '1.0', 'y'], '1.0', '*')).toBe('x * y');
    });

    it('should absorb zero', () => {
      expect(foldTerms(['x', '0.0', 'y'], '1.0', '*')).toBe('0.0');
    });

    it('should handle all ones', () => {
      expect(foldTerms(['1.0', '1.0'], '1.0', '*')).toBe('1.0');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts`
Expected: FAIL — foldTerms not exported

**Step 3: Write implementation**

Append to `src/compute-engine/compilation/constant-folding.ts`:

```typescript
/**
 * Format a number as a GPU float literal string.
 * Ensures a decimal point is present (e.g., `5` -> `"5.0"`).
 */
export function formatFloat(n: number): string {
  const str = n.toString();
  if (!str.includes('.') && !str.includes('e') && !str.includes('E'))
    return `${str}.0`;
  return str;
}

/**
 * Try to parse a compiled code string as a numeric literal.
 * Returns the number if the string is a valid float literal, undefined otherwise.
 */
function tryParseFloat(s: string): number | undefined {
  // Match GPU float literals: "3.0", "-2.5", "0.0", "-0.0"
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return undefined;
}

/**
 * Combine compiled string terms with an operator, folding constants.
 *
 * - Folds numeric literal pairs (e.g., `"2.0" + "3.0"` -> `"5.0"`)
 * - Eliminates identity values (`0.0` for `+`, `1.0` for `*`)
 * - Short-circuits on absorbing element (`0.0` for `*`)
 * - Returns the identity string for an empty array
 */
export function foldTerms(
  terms: string[],
  identity: string,
  op: '+' | '*'
): string {
  const isAdd = op === '+';
  const identityVal = isAdd ? 0 : 1;

  let numericAcc: number | null = null;
  const symbolic: string[] = [];

  for (const term of terms) {
    const n = tryParseFloat(term);
    if (n !== undefined) {
      // Absorbing element for multiplication
      if (!isAdd && n === 0) return '0.0';
      numericAcc = numericAcc === null ? n : (isAdd ? numericAcc + n : numericAcc * n);
    } else {
      symbolic.push(term);
    }
  }

  // Build result: numeric part (if non-identity) + symbolic parts
  const parts: string[] = [];
  if (numericAcc !== null && numericAcc !== identityVal)
    parts.push(formatFloat(numericAcc));
  parts.push(...symbolic);

  if (parts.length === 0) return identity;
  if (parts.length === 1) return parts[0];
  return parts.join(` ${op} `);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add foldTerms helper for constant folding in compiled output
```

---

### Task 3: Add `tryGetComplexParts` helper

**Files:**
- Modify: `src/compute-engine/compilation/constant-folding.ts`
- Modify: `test/compute-engine/compile-constant-folding.test.ts`

**Step 1: Write the failing tests**

Append to `test/compute-engine/compile-constant-folding.test.ts`:

```typescript
import { tryGetComplexParts } from '../../src/compute-engine/compilation/constant-folding';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

// We need a real compile function + target for tryGetComplexParts.
// Use the GLSL target's internal compile machinery.
const glsl = new GLSLTarget();

// Helper: compile an expression to GLSL code, then use the target
// to get a compile function. For unit testing we can use a simpler
// approach: call glsl.compile and inspect the parts.
// But tryGetComplexParts needs a compile callback. We'll test it
// indirectly through the GLSL output in Task 5+.

describe('tryGetComplexParts', () => {
  // These tests verify the decomposition logic using a mock compile fn
  const mockCompile = (expr: any) => {
    if (expr._kind === 'number') {
      if (expr.im !== 0) return `vec2(${expr.re}.0, ${expr.im}.0)`;
      return `${expr.re}.0`;
    }
    if (expr._kind === 'symbol') return expr.symbol;
    return '?';
  };

  it('should decompose ImaginaryUnit', () => {
    const parts = tryGetComplexParts(ce.expr('ImaginaryUnit'), mockCompile);
    expect(parts).toEqual({ re: null, im: '1.0' });
  });

  it('should decompose Complex(3, 4)', () => {
    const parts = tryGetComplexParts(ce.expr(['Complex', 3, 4]), mockCompile);
    expect(parts).toEqual({ re: '3.0', im: '4.0' });
  });

  it('should decompose Complex(0, 5)', () => {
    const parts = tryGetComplexParts(ce.expr(['Complex', 0, 5]), mockCompile);
    expect(parts).toEqual({ re: null, im: '5.0' });
  });

  it('should decompose Complex(3, 0)', () => {
    const parts = tryGetComplexParts(ce.expr(['Complex', 3, 0]), mockCompile);
    expect(parts).toEqual({ re: '3.0', im: null });
  });

  it('should return real part only for real expression', () => {
    const parts = tryGetComplexParts(ce.expr('x'), mockCompile);
    expect(parts).toEqual({ re: 'x', im: null });
  });

  it('should decompose Multiply(y, ImaginaryUnit)', () => {
    const e = ce.expr(['Multiply', 'y', 'ImaginaryUnit']);
    const parts = tryGetComplexParts(e, mockCompile);
    expect(parts).toEqual({ re: null, im: 'y' });
  });

  it('should decompose Multiply(3, ImaginaryUnit)', () => {
    const e = ce.expr(['Multiply', 3, 'ImaginaryUnit']);
    const parts = tryGetComplexParts(e, mockCompile);
    expect(parts).toEqual({ re: null, im: '3.0' });
  });

  it('should decompose Multiply(3, y, ImaginaryUnit)', () => {
    const e = ce.expr(['Multiply', 3, 'ImaginaryUnit', 'y']);
    const parts = tryGetComplexParts(e, mockCompile);
    // The imaginary part is the product of the non-i factors
    expect(parts.re).toBeNull();
    expect(parts.im).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts`
Expected: FAIL — tryGetComplexParts not exported

**Step 3: Write implementation**

Append to `src/compute-engine/compilation/constant-folding.ts`:

```typescript
import { isFunction, isSymbol } from '../boxed-expression/type-guards';
import { BaseCompiler } from './base-compiler';

/**
 * Decompose an expression into real and imaginary code-string parts.
 *
 * Returns `{ re, im }` where each is a compiled code string or `null`
 * (meaning zero — no contribution to that component).
 *
 * Handles:
 * - `Complex(a, b)` literals
 * - `ImaginaryUnit` symbol
 * - `Multiply(..., ImaginaryUnit, ...)` — factors out i, compiles the rest as im
 * - Plain real expressions — returns `{ re: compiled, im: null }`
 *
 * @param expr The expression to decompose
 * @param compile Callback to compile sub-expressions to code strings
 */
export function tryGetComplexParts(
  expr: Expression,
  compile: (e: Expression) => string
): { re: string | null; im: string | null } {
  // ImaginaryUnit → { re: null, im: "1.0" }
  if (isSymbol(expr, 'ImaginaryUnit')) return { re: null, im: '1.0' };

  // Complex(a, b) literal — number with im !== 0
  if (isNumber(expr) && expr.im !== 0) {
    const re = expr.re === 0 ? null : formatFloat(expr.re);
    const im = expr.im === 0 ? null : formatFloat(expr.im);
    return { re, im };
  }

  // Multiply(..., ImaginaryUnit, ...) → factor out i
  if (isFunction(expr, 'Multiply')) {
    const ops = expr.ops;
    const iIndex = ops.findIndex((op) => isSymbol(op, 'ImaginaryUnit'));
    if (iIndex >= 0) {
      const realFactors = ops.filter((_, i) => i !== iIndex);
      if (realFactors.length === 0) return { re: null, im: '1.0' };
      const imCode =
        realFactors.length === 1
          ? compile(realFactors[0])
          : foldTerms(realFactors.map((f) => compile(f)), '1.0', '*');
      return { re: null, im: imCode };
    }
  }

  // Not complex-valued → pure real
  if (!BaseCompiler.isComplexValued(expr)) return { re: compile(expr), im: null };

  // Fallback for other complex expressions (e.g., complex function results):
  // can't decompose, return the compiled code as-is tagged as complex
  return { re: compile(expr), im: compile(expr), _opaque: true } as any;
}
```

Wait — the opaque fallback is messy. For complex expressions we can't decompose (like `Sin(z)`), the `Add` handler should fall back to the current behavior (promote + add). Let me revise: `tryGetComplexParts` returns `null` (not decomposable) in that case, and the caller handles it.

Revised return type: `{ re: string | null; im: string | null } | null` where `null` means "could not decompose, use opaque complex compilation."

```typescript
export function tryGetComplexParts(
  expr: Expression,
  compile: (e: Expression) => string
): { re: string | null; im: string | null } | null {
  // ImaginaryUnit → { re: null, im: "1.0" }
  if (isSymbol(expr, 'ImaginaryUnit')) return { re: null, im: '1.0' };

  // Complex(a, b) literal — number with im !== 0
  if (isNumber(expr) && expr.im !== 0) {
    const re = expr.re === 0 ? null : formatFloat(expr.re);
    const im = formatFloat(expr.im);
    return { re, im };
  }

  // Multiply(..., ImaginaryUnit, ...) → factor out i
  if (isFunction(expr, 'Multiply')) {
    const ops = expr.ops;
    const iIndex = ops.findIndex((op) => isSymbol(op, 'ImaginaryUnit'));
    if (iIndex >= 0) {
      const realFactors = ops.filter((_, i) => i !== iIndex);
      if (realFactors.length === 0) return { re: null, im: '1.0' };
      const imCode =
        realFactors.length === 1
          ? compile(realFactors[0])
          : foldTerms(realFactors.map((f) => compile(f)), '1.0', '*');
      return { re: null, im: imCode };
    }
  }

  // Pure real expression
  if (!BaseCompiler.isComplexValued(expr)) return { re: compile(expr), im: null };

  // Complex expression we can't decompose (e.g., csin(z))
  return null;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add tryGetComplexParts helper for complex number decomposition
```

---

### Task 4: Update GPU `Add` handler

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts:161-173`
- Modify: `test/compute-engine/compile-constant-folding.test.ts`

**Step 1: Write the failing tests**

Append to test file:

```typescript
describe('GPU Add — complex folding', () => {
  it('should fold x + yi to vec2(x, y)', () => {
    expect(glsl.compile(ce.parse('x+yi')).code).toBe('vec2(x, y)');
  });

  it('should fold x + 3i to vec2(x, 3.0)', () => {
    expect(glsl.compile(ce.parse('x+3i')).code).toBe('vec2(x, 3.0)');
  });

  it('should fold 2x + 3yi', () => {
    const code = glsl.compile(ce.parse('2x+3yi')).code;
    expect(code).toBe('vec2(2.0 * x, 3.0 * y)');
  });

  it('should keep 3 + 4i as vec2(3.0, 4.0)', () => {
    expect(glsl.compile(ce.expr(['Complex', 3, 4])).code).toBe(
      'vec2(3.0, 4.0)'
    );
  });

  it('should fold 0 + yi to vec2(0.0, y)', () => {
    expect(glsl.compile(ce.parse('0+yi')).code).toBe('vec2(0.0, y)');
  });
});

describe('GPU Add — real folding', () => {
  it('should fold 2 + 3 to 5.0', () => {
    expect(glsl.compile(ce.expr(['Add', 2, 3])).code).toBe('5.0');
  });

  it('should fold x + 0 to x', () => {
    expect(glsl.compile(ce.expr(['Add', 'x', 0])).code).toBe('x');
  });

  it('should fold 0 + x to x', () => {
    expect(glsl.compile(ce.expr(['Add', 0, 'x'])).code).toBe('x');
  });

  it('should fold 2 + x + 3 to 5.0 + x', () => {
    expect(glsl.compile(ce.expr(['Add', 2, 'x', 3])).code).toBe('5.0 + x');
  });
});
```

**Step 2: Run tests to verify they fail**

Expected: FAIL — old output like `vec2(x, 0.0) + (y * vec2(0.0, 1.0))`

**Step 3: Update the `Add` handler**

In `src/compute-engine/compilation/gpu-target.ts`, replace the `Add` handler (lines 161-173):

```typescript
  Add: (args, compile, target) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(args.map((x) => compile(x)), '0.0', '+');
    }
    // Try to decompose all operands into re/im parts
    const parts = args.map((a) => tryGetComplexParts(a, compile));
    if (parts.some((p) => p === null)) {
      // At least one opaque complex operand — fall back to promote-and-add
      const v2 = gpuVec2(target);
      return args
        .map((a) => {
          const code = compile(a);
          return BaseCompiler.isComplexValued(a) ? code : `${v2}(${code}, 0.0)`;
        })
        .join(' + ');
    }
    // All operands decomposed — collect re and im parts
    const reParts: string[] = [];
    const imParts: string[] = [];
    for (const p of parts) {
      if (p!.re !== null) reParts.push(p!.re);
      if (p!.im !== null) imParts.push(p!.im);
    }
    const reSum = foldTerms(reParts, '0.0', '+');
    const imSum = foldTerms(imParts, '0.0', '+');
    return `${gpuVec2(target)}(${reSum}, ${imSum})`;
  },
```

Add the import at the top of `gpu-target.ts`:

```typescript
import { foldTerms, tryGetComplexParts } from './constant-folding';
```

**Step 4: Run tests to verify they pass**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts`
Expected: PASS

**Step 5: Run existing GLSL tests for regressions**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-glsl.test.ts test/compute-engine/compile-complex.test.ts`
Expected: PASS (update inline snapshots if needed)

**Step 6: Commit**

```
feat: constant-fold GPU Add for vec2 construction and real arithmetic
```

---

### Task 5: Update GPU `Multiply` handler

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts:175-201`
- Modify: `test/compute-engine/compile-constant-folding.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('GPU Multiply — real folding', () => {
  it('should fold 2 * 3 to 6.0', () => {
    expect(glsl.compile(ce.expr(['Multiply', 2, 3])).code).toBe('6.0');
  });

  it('should fold x * 1 to x', () => {
    expect(glsl.compile(ce.expr(['Multiply', 'x', 1])).code).toBe('x');
  });

  it('should fold x * 0 to 0.0', () => {
    expect(glsl.compile(ce.expr(['Multiply', 'x', 0])).code).toBe('0.0');
  });

  it('should fold 2 * x * 3 to 6.0 * x', () => {
    expect(glsl.compile(ce.expr(['Multiply', 2, 'x', 3])).code).toBe(
      '6.0 * x'
    );
  });
});

describe('GPU Multiply — complex folding', () => {
  it('should fold y * i to vec2(0.0, y)', () => {
    const e = ce.expr(['Multiply', 'y', 'ImaginaryUnit']);
    expect(glsl.compile(e).code).toBe('vec2(0.0, y)');
  });

  it('should fold 3 * i to vec2(0.0, 3.0)', () => {
    const e = ce.expr(['Multiply', 3, 'ImaginaryUnit']);
    expect(glsl.compile(e).code).toBe('vec2(0.0, 3.0)');
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Update the `Multiply` handler**

Replace the Multiply handler in `gpu-target.ts` (lines 175-201):

```typescript
  Multiply: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(args.map((x) => compile(x)), '1.0', '*');
    }

    // Check if this is purely-imaginary: scalars * ImaginaryUnit
    const parts = tryGetComplexParts(
      // Wrap back into a Multiply for decomposition
      // But we already have the expr — we can check directly:
      // If exactly one operand is ImaginaryUnit, the rest are real scalars
      args[0].engine.expr(['Multiply', ...args.map((a) => a)]),
      compile
    );
    // tryGetComplexParts handles Multiply(reals..., i) directly.
    // But we already have the args, so let's check inline:
    const iIndex = args.findIndex((op) => isSymbol(op, 'ImaginaryUnit'));
    if (iIndex >= 0) {
      const realFactors = args.filter((_, i) => i !== iIndex);
      const v2 = gpuVec2(target);
      if (realFactors.length === 0) return `${v2}(0.0, 1.0)`;
      const imCode = foldTerms(
        realFactors.map((f) => compile(f)),
        '1.0',
        '*'
      );
      return `${v2}(0.0, ${imCode})`;
    }

    // General complex multiply: fold real scalars first, then pairwise reduction
    const realScalars: Expression[] = [];
    const complexOps: Expression[] = [];
    for (const a of args) {
      if (BaseCompiler.isComplexValued(a)) complexOps.push(a);
      else realScalars.push(a);
    }

    let scalarCode =
      realScalars.length > 0
        ? foldTerms(realScalars.map((x) => compile(x)), '1.0', '*')
        : null;

    // Pairwise reduce complex operands
    let result = compile(complexOps[0]);
    for (let i = 1; i < complexOps.length; i++) {
      result = `_gpu_cmul(${result}, ${compile(complexOps[i])})`;
    }

    // Apply scalar factor
    if (scalarCode !== null && scalarCode !== '1.0')
      result = `(${scalarCode} * ${result})`;

    return result;
  },
```

Actually, that's getting complex. Let me simplify — the handler should just handle the iIndex case cleanly, and fall through to existing pairwise reduction otherwise (with folded real scalars):

```typescript
  Multiply: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(args.map((x) => compile(x)), '1.0', '*');
    }

    // Special case: scalars * ImaginaryUnit → vec2(0.0, product)
    const iIndex = args.findIndex((op) => isSymbol(op, 'ImaginaryUnit'));
    if (iIndex >= 0) {
      const realFactors = args.filter((_, i) => i !== iIndex);
      const v2 = gpuVec2(target);
      if (realFactors.length === 0) return `${v2}(0.0, 1.0)`;
      const imCode = foldTerms(
        realFactors.map((f) => compile(f)),
        '1.0',
        '*'
      );
      return `${v2}(0.0, ${imCode})`;
    }

    // General complex multiply: separate real scalars, fold them,
    // then pairwise-reduce complex operands with _gpu_cmul
    const realScalars: string[] = [];
    const complexCodes: string[] = [];
    for (const a of args) {
      if (BaseCompiler.isComplexValued(a)) complexCodes.push(compile(a));
      else realScalars.push(compile(a));
    }

    // Fold real scalars
    const scalarCode = foldTerms(realScalars, '1.0', '*');

    // Pairwise reduce complex operands
    let result = complexCodes[0];
    for (let i = 1; i < complexCodes.length; i++) {
      result = `_gpu_cmul(${result}, ${complexCodes[i]})`;
    }

    // Apply scalar factor
    if (scalarCode !== '1.0') result = `(${scalarCode} * ${result})`;

    return result;
  },
```

**Step 4: Run tests**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts test/compute-engine/compile-glsl.test.ts test/compute-engine/compile-complex.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: constant-fold GPU Multiply with identity elimination and vec2 optimization
```

---

### Task 6: Update GPU `Subtract`, `Negate`, `Divide` handlers

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts:202-254`
- Modify: `test/compute-engine/compile-constant-folding.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('GPU Subtract — folding', () => {
  it('should fold 5 - 3 to 2.0', () => {
    expect(glsl.compile(ce.expr(['Subtract', 5, 3])).code).toBe('2.0');
  });

  it('should fold x - 0 to x', () => {
    expect(glsl.compile(ce.expr(['Subtract', 'x', 0])).code).toBe('x');
  });
});

describe('GPU Negate — folding', () => {
  it('should fold Negate(3) to -3.0', () => {
    expect(glsl.compile(ce.expr(['Negate', 3])).code).toBe('-3.0');
  });

  it('should fold Negate(Complex(3, 4)) to vec2(-3.0, -4.0)', () => {
    expect(glsl.compile(ce.expr(['Negate', ['Complex', 3, 4]])).code).toBe(
      'vec2(-3.0, -4.0)'
    );
  });

  it('should fold Negate(ImaginaryUnit) to vec2(0.0, -1.0)', () => {
    expect(
      glsl.compile(ce.expr(['Negate', 'ImaginaryUnit'])).code
    ).toBe('vec2(0.0, -1.0)');
  });
});

describe('GPU Divide — folding', () => {
  it('should fold 6 / 3 to 2.0', () => {
    expect(glsl.compile(ce.expr(['Divide', 6, 3])).code).toBe('2.0');
  });

  it('should fold x / 1 to x', () => {
    expect(glsl.compile(ce.expr(['Divide', 'x', 1])).code).toBe('x');
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Update handlers**

**Subtract** — fold the real-only path by compiling, then subtracting constants:

```typescript
  Subtract: (args, compile, target) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      // Try constant folding for 2-arg case
      if (args.length === 2) {
        const a = tryGetConstant(args[0]);
        const b = tryGetConstant(args[1]);
        if (a !== undefined && b !== undefined) return formatFloat(a - b);
        const aCode = compile(args[0]);
        const bCode = compile(args[1]);
        // Eliminate x - 0
        if (tryParseFloat(bCode) === 0) return aCode;
        return `${aCode} - ${bCode}`;
      }
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++) result = `${result} - ${compile(args[i])}`;
      return result;
    }
    // Complex: promote real operands (existing logic, unchanged)
    const v2 = gpuVec2(target);
    const promote = (a: Expression) => {
      const code = compile(a);
      return BaseCompiler.isComplexValued(a) ? code : `${v2}(${code}, 0.0)`;
    };
    if (args.length === 2) return `${promote(args[0])} - ${promote(args[1])}`;
    let result = promote(args[0]);
    for (let i = 1; i < args.length; i++) result = `${result} - ${promote(args[i])}`;
    return result;
  },
```

Note: export `tryParseFloat` from `constant-folding.ts` (rename to `parseFloatLiteral` or just keep private — actually `Subtract` needs it in `gpu-target.ts`. Export it, or use `tryGetConstant` on the expression directly instead. Better: use `tryGetConstant` on the expression args, not the compiled strings.)

Revised approach — use `tryGetConstant` on expressions before compiling:

```typescript
  Subtract: (args, compile, target) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      if (args.length === 2) {
        const a = tryGetConstant(args[0]);
        const b = tryGetConstant(args[1]);
        if (a !== undefined && b !== undefined) return formatFloat(a - b);
        const bConst = tryGetConstant(args[1]);
        if (bConst === 0) return compile(args[0]);
        return `${compile(args[0])} - ${compile(args[1])}`;
      }
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++) result = `${result} - ${compile(args[i])}`;
      return result;
    }
    // Complex path — unchanged
    const v2 = gpuVec2(target);
    const promote = (a: Expression) => {
      const code = compile(a);
      return BaseCompiler.isComplexValued(a) ? code : `${v2}(${code}, 0.0)`;
    };
    if (args.length === 2) return `${promote(args[0])} - ${promote(args[1])}`;
    let result = promote(args[0]);
    for (let i = 1; i < args.length; i++) result = `${result} - ${promote(args[i])}`;
    return result;
  },
```

**Negate:**

```typescript
  Negate: ([x], compile, target) => {
    if (x === null) throw new Error('Negate: no argument');
    // Fold constant
    const c = tryGetConstant(x);
    if (c !== undefined) return formatFloat(-c);
    // Fold complex literal
    if (isNumber(x) && x.im !== 0) {
      const v2 = gpuVec2(target);
      return `${v2}(${formatFloat(-x.re)}, ${formatFloat(-x.im)})`;
    }
    // Fold ImaginaryUnit
    if (isSymbol(x, 'ImaginaryUnit')) return `${gpuVec2(target)}(0.0, -1.0)`;
    return `(-${compile(x)})`;
  },
```

**Divide:**

```typescript
  Divide: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const ac = BaseCompiler.isComplexValued(args[0]);
    const bc = args.length >= 2 && BaseCompiler.isComplexValued(args[1]);
    if (!ac && !bc) {
      if (args.length === 2) {
        const a = tryGetConstant(args[0]);
        const b = tryGetConstant(args[1]);
        if (a !== undefined && b !== undefined && b !== 0)
          return formatFloat(a / b);
        if (b === 1) return compile(args[0]);
        return `${compile(args[0])} / ${compile(args[1])}`;
      }
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `${result} / ${compile(args[i])}`;
      return result;
    }
    // Complex division — unchanged
    if (ac && bc) return `_gpu_cdiv(${compile(args[0])}, ${compile(args[1])})`;
    if (ac && !bc) return `(${compile(args[0])} / ${compile(args[1])})`;
    const v2 = gpuVec2(target);
    return `_gpu_cdiv(${v2}(${compile(args[0])}, 0.0), ${compile(args[1])})`;
  },
```

**Step 4: Run tests**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts test/compute-engine/compile-glsl.test.ts test/compute-engine/compile-complex.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: constant-fold GPU Subtract, Negate, and Divide handlers
```

---

### Task 7: Update GPU `Power`, `Sqrt`, `Root` handlers

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (Power at ~302, Sqrt at ~333, Root at ~583)
- Modify: `test/compute-engine/compile-constant-folding.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('GPU Power — folding', () => {
  it('should fold Power(x, 0) to 1.0', () => {
    expect(glsl.compile(ce.expr(['Power', 'x', 0])).code).toBe('1.0');
  });

  it('should fold Power(x, 1) to x', () => {
    expect(glsl.compile(ce.expr(['Power', 'x', 1])).code).toBe('x');
  });

  it('should fold Power(x, 2) to (x * x)', () => {
    expect(glsl.compile(ce.expr(['Power', 'x', 2])).code).toBe('(x * x)');
  });

  it('should fold Power(x, -1) to (1.0 / x)', () => {
    expect(glsl.compile(ce.expr(['Power', 'x', -1])).code).toBe('(1.0 / x)');
  });

  it('should fold Power(x, 0.5) to sqrt(x)', () => {
    expect(glsl.compile(ce.expr(['Power', 'x', 0.5])).code).toBe('sqrt(x)');
  });

  it('should fold Power(2, 3) to 8.0', () => {
    expect(glsl.compile(ce.expr(['Power', 2, 3])).code).toBe('8.0');
  });
});

describe('GPU Sqrt — folding', () => {
  it('should fold Sqrt(4) to 2.0', () => {
    expect(glsl.compile(ce.expr(['Sqrt', 4])).code).toBe('2.0');
  });

  it('should fold Sqrt(0) to 0.0', () => {
    expect(glsl.compile(ce.expr(['Sqrt', 0])).code).toBe('0.0');
  });

  it('should fold Sqrt(1) to 1.0', () => {
    expect(glsl.compile(ce.expr(['Sqrt', 1])).code).toBe('1.0');
  });

  it('should not fold Sqrt(x)', () => {
    expect(glsl.compile(ce.expr(['Sqrt', 'x'])).code).toBe('sqrt(x)');
  });
});

describe('GPU Root — folding', () => {
  it('should fold Root(x, 2) to sqrt(x)', () => {
    expect(glsl.compile(ce.expr(['Root', 'x', 2])).code).toBe('sqrt(x)');
  });

  it('should fold Root(27, 3) to 3.0', () => {
    expect(glsl.compile(ce.expr(['Root', 27, 3])).code).toBe('3.0');
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Update handlers**

**Power:**

```typescript
  Power: (args, compile, target) => {
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      if (isSymbol(base, 'ExponentialE')) return `_gpu_cexp(${compile(exp)})`;
      const v2 = gpuVec2(target);
      const bCode = BaseCompiler.isComplexValued(base)
        ? compile(base)
        : `${v2}(${compile(base)}, 0.0)`;
      const eCode = BaseCompiler.isComplexValued(exp)
        ? compile(exp)
        : `${v2}(${compile(exp)}, 0.0)`;
      return `_gpu_cpow(${bCode}, ${eCode})`;
    }
    // Constant fold
    const bConst = tryGetConstant(base);
    const eConst = tryGetConstant(exp);
    if (bConst !== undefined && eConst !== undefined)
      return formatFloat(Math.pow(bConst, eConst));
    // Identity cases
    if (eConst === 0) return '1.0';
    if (eConst === 1) return compile(base);
    if (eConst === 2) {
      const code = compile(base);
      return `(${code} * ${code})`;
    }
    if (eConst === -1) return `(1.0 / ${compile(base)})`;
    if (eConst === 0.5) return `sqrt(${compile(base)})`;
    return `pow(${compile(base)}, ${compile(exp)})`;
  },
```

**Sqrt:**

```typescript
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csqrt(${compile(args[0])})`;
    const c = tryGetConstant(args[0]);
    if (c !== undefined) return formatFloat(Math.sqrt(c));
    return `sqrt(${compile(args[0])})`;
  },
```

**Root:**

```typescript
  Root: ([x, n], compile) => {
    if (x === null) throw new Error('Root: no argument');
    if (n === null || n === undefined) return `sqrt(${compile(x)})`;
    const nConst = tryGetConstant(n);
    if (nConst === 2) return `sqrt(${compile(x)})`;
    const xConst = tryGetConstant(x);
    if (xConst !== undefined && nConst !== undefined)
      return formatFloat(Math.pow(xConst, 1 / nConst));
    return `pow(${compile(x)}, 1.0 / ${compile(n)})`;
  },
```

**Step 4: Run tests**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile-constant-folding.test.ts test/compute-engine/compile-glsl.test.ts test/compute-engine/compile-complex.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: constant-fold GPU Power, Sqrt, and Root handlers
```

---

### Task 8: Final integration test and snapshot updates

**Files:**
- Modify: `test/compute-engine/compile-glsl.test.ts` (snapshot updates)
- Modify: `test/compute-engine/compile-constant-folding.test.ts` (any additional edge cases)

**Step 1: Run the full compilation test suite**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile`
Check for any snapshot mismatches.

**Step 2: Update snapshots**

Run: `npm run test snapshot` if needed.

**Step 3: Run playground**

Run: `npx tsx test/playground.ts 2>&1 | head -5`
Verify: `1 + Mandelbrot(x+yi, 200)` outputs `_fractal_mandelbrot(vec2(x, y), int(200.0)) + 1.0`

**Step 4: Run full test suite**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/compile`
Expected: ALL PASS

**Step 5: Commit**

```
test: update snapshots for constant folding changes
```

---

Plan saved. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?