# OEIS Formula Parser Implementation Plan

[!] Need to think more about MathJSON API. What does "ClosedForm" return? Is it
a function? Or is there such a think as a "Series" type?

**✅ UPDATE (2026)**: The LaTeX parser now has a `strict: false` option that accepts Math-ASCII/Typst-like syntax (e.g., `sin(x)`, `x^(n+1)`, `a_(k+m)`). This **may eliminate the need for a separate ASCII Math parser** for OEIS formulas. See [LaTeX Parser Non-Strict Mode](#latex-parser-non-strict-mode) section for details.

## Summary

Add the ability to parse OEIS formula notation and reconstruct usable sequence
definitions. This can be achieved through two approaches:

**Option A (Original Plan)**: Create an **ASCII Math parser** (inverse of
the existing `toAsciiMath()` serializer), with OEIS support as a thin wrapper.

**Option B (Simplified)**: Leverage the LaTeX parser's `strict: false` mode which already handles most ASCII Math/OEIS notation, reducing implementation complexity.

## Approach

**Strategy**: Build an ASCII Math parser, use it for OEIS formulas

The codebase already has `ascii-math.ts` which serializes BoxedExpression →
ASCII Math string. We create the inverse: ASCII Math string → BoxedExpression.

**Why this approach:**

1. ASCII Math notation is very close to OEIS notation
2. Gives us two features: general ASCII Math input + OEIS formula parsing
3. The serializer already defines the grammar (symbols, operators, functions)
4. Bidirectional conversion enables round-trip testing

**OEIS-specific handling:**

- Pre-process `a(n-1)` → `a_(n-1)` (function notation → subscript notation)
- Detect formula types (recurrence, closed-form, generating function)
- Extract base cases from formula text

## ASCII Math vs OEIS Notation

| Feature     | ASCII Math (serializer) | OEIS             |
| ----------- | ----------------------- | ---------------- |
| Subscript   | `a_n`, `a_(n-1)`        | `a(n)`, `a(n-1)` |
| Square root | `sqrt(x)`               | `sqrt(x)`        |
| Floor/ceil  | `floor(x)`, `ceil(x)`   | `floor(x)`       |
| Trig        | `sin(x)`, `cos(x)`      | `sin(x)`         |
| Exponent    | `x^2`, `x^(n+1)`        | `x^2`, `x^(n+1)` |
| Sum         | `sum_(n=1)^(10)(n)`     | `Sum_{n=1..10}`  |
| Constants   | `pi`, `phi`             | `Pi`, `phi`      |
| Binomial    | (not in serializer)     | `binomial(n,k)`  |

The main transformation needed for OEIS: `a(n-1)` → `a_(n-1)`

## LaTeX Parser Non-Strict Mode

**UPDATE**: The LaTeX parser now supports a `strict: false` option that accepts
Math-ASCII/Typst-like syntax, which overlaps significantly with OEIS notation:

```typescript
ce.parse('sin(x)^(n+1)', { strict: false })
// Accepts:
// - Parentheses for superscripts/subscripts: x^(n+1), a_(k+m)
// - Bare function names: sin(x), cos(x), log(x), sqrt(x), etc.
// - Division with slash: (n+1)/b

// Supported bare functions:
// Trig: sin, cos, tan, cot, sec, csc
// Hyperbolic: sinh, cosh, tanh, coth, sech, csch
// Inverse: arcsin, arccos, arctan, asin, acos, atan
// Logarithmic: log, ln, exp, lg, lb
// Other: sqrt, abs, floor, ceil, round, max, min, gcd, lcm
```

This means we can potentially **leverage the LaTeX parser in non-strict mode**
for OEIS formula parsing instead of building a separate ASCII Math parser,
reducing implementation complexity.

**Benefits:**

- Reuses existing, well-tested parser infrastructure
- Handles operator precedence, function calls, parentheses automatically
- Already integrated with MathJSON conversion
- Reduces maintenance burden (one parser instead of two)

**Considerations:**

- Still need OEIS-specific pre-processing for `a(n)` → `a_n` notation
- May need minor extensions for OEIS-specific patterns (e.g., `Sum_{k=0..n}`)
- Non-strict mode is permissive but doesn't validate against ASCII Math spec

## New API

### ASCII Math Parser (general use)

**Option A: Dedicated ASCII Math parser**

```typescript
// New method on ComputeEngine
ce.parseAsciiMath('sqrt(x^2 + 1)')  // → BoxedExpression

// Round-trip test
expr.toAsciiMath() → string → ce.parseAsciiMath() → same expr
```

**Option B: Use LaTeX parser in non-strict mode** _(recommended for simplicity)_

```typescript
// Use existing LaTeX parser with strict: false
ce.parse('sqrt(x^2 + 1)', { strict: false })  // → BoxedExpression

// Advantages:
// - Reuses existing parser infrastructure
// - No need for new parser implementation
// - Handles most OEIS notation already
// - Maintains single source of truth for parsing logic
```

### MathJSON Functions for Sequence Analysis

These functions take sequence terms and evaluate to formulas by looking up OEIS:

```typescript
// Find closed-form formula
ce.box(["ClosedForm", ["List", 0, 1, 1, 2, 3, 5, 8, 13]]).evaluate()
// → (GoldenRatio^n - (-GoldenRatio)^(-n)) / Sqrt(5)

// Find recurrence relation
ce.box(["Recurrence", ["List", 0, 1, 1, 2, 3, 5, 8]]).evaluate()
// → a_{n-1} + a_{n-2}

// Find generating function
ce.box(["GeneratingFunction", ["List", 0, 1, 1, 2, 3, 5]]).evaluate()
// → x / (1 - x - x^2)

// Get OEIS ID
ce.box(["OEISId", ["List", 0, 1, 1, 2, 3, 5, 8]]).evaluate()
// → "A000045"
```

LaTeX syntax:

```typescript
ce.parse("\\operatorname{ClosedForm}(0, 1, 1, 2, 3, 5, 8)").evaluate()
```

### Sequence Declaration

```typescript
// Declare sequence from OEIS (async)
await ce.declareOEISSequence("F", "A000045")
ce.parse('F_{10}').evaluate()  // → 55

// The declared sequence has metadata
ce.getSequence("F").oeis        // "A000045"
ce.getSequence("F").closedForm  // BoxedExpression
ce.getSequence("F").recurrence  // BoxedExpression
```

### OEIS Formula Parsing (internal)

```typescript
interface ParsedOEISFormula {
  type: 'recurrence' | 'closed-form' | 'generating-function' | 'unknown';
  expression?: BoxedExpression;
  variable?: string;  // e.g., 'n'
  baseCases?: Record<number, number>;
  original: string;
  error?: string;
}
```

## Files to Modify

**If using dedicated ASCII Math parser (Option A):**

| File                                                       | Change                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/compute-engine/boxed-expression/ascii-math-parser.ts` | **NEW** - ASCII Math parser                                                          |
| `src/compute-engine/boxed-expression/ascii-math.ts`        | Keep as serializer                                                                   |
| `src/compute-engine/oeis.ts`                               | Add OEIS pre-processing, `declareOEISSequence()`                                     |
| `src/compute-engine/library/sequences.ts`                  | **NEW** or extend - Add ClosedForm, Recurrence, GeneratingFunction, OEISId functions |
| `src/compute-engine/index.ts`                              | Expose `parseAsciiMath()`, `declareOEISSequence()`                                   |
| `src/compute-engine/global-types.ts`                       | Add new type definitions                                                             |
| `test/compute-engine/ascii-math-parser.test.ts`            | **NEW** - Parser tests + round-trip                                                  |
| `test/compute-engine/oeis.test.ts`                         | Add formula parsing tests                                                            |

**If using LaTeX parser with strict: false (Option B - recommended):**

| File                                            | Change                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| ~~`ascii-math-parser.ts`~~                      | **NOT NEEDED** - Use LaTeX parser with `strict: false`                               |
| `src/compute-engine/latex-syntax/types.ts`      | ✅ **DONE** - Added `strict?: boolean` to `ParseLatexOptions`                        |
| `src/compute-engine/oeis.ts`                    | Add OEIS pre-processing (`a(n)` → `a_n`), `declareOEISSequence()`                   |
| `src/compute-engine/library/sequences.ts`       | **NEW** or extend - Add ClosedForm, Recurrence, GeneratingFunction, OEISId functions |
| `src/compute-engine/index.ts`                   | Expose `declareOEISSequence()`                                                       |
| `src/compute-engine/global-types.ts`            | Add new type definitions                                                             |
| `test/compute-engine/oeis.test.ts`              | Add formula parsing tests using `parse(formula, {strict: false})`                    |

## Implementation Phases

### Phase 1: ASCII Math Parser Core

**Option A: Build dedicated ASCII Math parser** Create `ascii-math-parser.ts`:

- Tokenizer for ASCII Math notation
- Precedence-climbing parser (similar to LaTeX parser but simpler)
- Handle operators: `+`, `-`, `*`, `/`, `^`
- Handle functions: `sqrt`, `sin`, `cos`, `floor`, `ceil`, `log`, etc.
- Handle symbols: `pi`, `phi`, Greek letters, single-letter variables
- Handle subscripts: `a_n`, `a_(n-1)`

**Option B: Use LaTeX parser with `strict: false`** _(✅ IMPLEMENTED)_

- **Already handles**: `sqrt(x)`, `sin(x)`, `x^(n+1)`, `a_(k+m)`, `(n+1)/b`
- **Still needed**: OEIS-specific pre-processing for `a(n)` → `a_n` notation
- **Benefit**: No new parser needed, leverages existing tested infrastructure

### Phase 2: Round-trip Testing

**If using dedicated parser:**

- Test: `toAsciiMath(parseAsciiMath(str)) ≈ str`
- Test: `parseAsciiMath(toAsciiMath(expr)).isSame(expr)`
- Use existing serializer output as test cases

**If using LaTeX parser with strict: false:**

- Test: `parse(str, {strict: false}).toAsciiMath() ≈ str`
- Verify OEIS notation compatibility with non-strict mode

### Phase 3: OEIS Pre-processing

Add to `oeis.ts`:

- `oeisToAsciiMath(formula)`: Transform `a(n)` → `a_n` notation
- `detectFormulaType()`: Classify formulas
- `extractBaseCases()`: Parse `a(0) = 0, a(1) = 1`

### Phase 4: MathJSON Functions

Add to library (new file or extend sequences):

- `ClosedForm(terms)` - looks up OEIS, returns closed-form expression
- `Recurrence(terms)` - returns recurrence relation
- `GeneratingFunction(terms)` - returns G.f. expression
- `OEISId(terms)` - returns OEIS ID string

These are async-evaluating functions (return promise or use internal caching).

### Phase 5: Integration

- Add `declareOEISSequence()` method
- Enhance `getSequence()` to include OEIS metadata
- Fallback to terms-lookup when formula parsing fails

## ASCII Math Parser Grammar

```
expr        → term (('+' | '-') term)*
term        → factor (('*' | '/') factor)*
factor      → base ('^' exponent)?
base        → NUMBER | SYMBOL | function | '(' expr ')' | '|' expr '|'
exponent    → base | '(' expr ')'
function    → FUNCNAME '(' args ')'
args        → expr (',' expr)*
subscript   → SYMBOL '_' (SYMBOL | NUMBER | '(' expr ')')

FUNCNAME    → 'sqrt' | 'sin' | 'cos' | 'tan' | 'floor' | 'ceil' | 'log' | ...
SYMBOL      → [a-zA-Z] | 'pi' | 'phi' | 'alpha' | ...
NUMBER      → [0-9]+ ('.' [0-9]+)?
```

## OEIS Pre-processing Rules

| OEIS Pattern    | ASCII Math      | Notes                   |
| --------------- | --------------- | ----------------------- |
| `a(n)`          | `a_n`           | Simple subscript        |
| `a(n-1)`        | `a_(n-1)`       | Complex subscript       |
| `F(n+k)`        | `F_(n+k)`       | Any sequence name       |
| `Sum_{k=0..n}`  | `sum_(k=0)^(n)` | Range notation          |
| `binomial(n,k)` | `binom(n,k)`    | May need function alias |
| `Pi`            | `pi`            | Case normalization      |

## Graceful Degradation

When formula parsing fails:

1. Try formula parsing first
2. Fall back to terms-based lookup table (use OEIS `terms` array)
3. Return informative error in `ParsedOEISFormula.error`

## Known Limitations

- **Generating functions**: Stored but not directly usable for evaluation
- **Conditional formulas**: `"a(n) = n if n even"` not parseable
- **Multiple formulas**: Only first OEIS formula is used
- **Prose descriptions**: Natural language formulas ignored

## Verification

1. Run ASCII Math parser tests: `npm run test compute-engine/ascii-math-parser`
2. Run OEIS tests: `npm run test compute-engine/oeis`
3. Round-trip test with existing `toAsciiMath()` output
4. Manual test:

   ```typescript
   const ce = new ComputeEngine();

   // ASCII Math parsing
   ce.parseAsciiMath('x^2 + 2x + 1');

   // MathJSON functions
   ce.box(["ClosedForm", ["List", 0, 1, 1, 2, 3, 5, 8]]).evaluate();
   ce.box(["OEISId", ["List", 0, 1, 1, 2, 3, 5, 8]]).evaluate();  // → "A000045"

   // Sequence declaration
   await ce.declareOEISSequence('F', 'A000045');
   console.log(ce.parse('F_{10}').evaluate().re);  // → 55
   console.log(ce.getSequence('F').closedForm);    // → BoxedExpression
   ```
