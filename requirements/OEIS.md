# OEIS Formula Parser Implementation Plan

[!] Need to think more about MathJSON API. What does "ClosedForm" return? Is it
a function? Or is there such a think as a "Series" type?

## Summary

Add the ability to parse OEIS formula notation and reconstruct usable sequence
definitions. This is achieved by creating an **ASCII Math parser** (inverse of
the existing `toAsciiMath()` serializer), with OEIS support as a thin wrapper.

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

## New API

### ASCII Math Parser (general use)

```typescript
// New method on ComputeEngine
ce.parseAsciiMath('sqrt(x^2 + 1)')  // → BoxedExpression

// Round-trip test
expr.toAsciiMath() → string → ce.parseAsciiMath() → same expr
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

## Implementation Phases

### Phase 1: ASCII Math Parser Core

Create `ascii-math-parser.ts`:

- Tokenizer for ASCII Math notation
- Precedence-climbing parser (similar to LaTeX parser but simpler)
- Handle operators: `+`, `-`, `*`, `/`, `^`
- Handle functions: `sqrt`, `sin`, `cos`, `floor`, `ceil`, `log`, etc.
- Handle symbols: `pi`, `phi`, Greek letters, single-letter variables
- Handle subscripts: `a_n`, `a_(n-1)`

### Phase 2: Round-trip Testing

- Test: `toAsciiMath(parseAsciiMath(str)) ≈ str`
- Test: `parseAsciiMath(toAsciiMath(expr)).isSame(expr)`
- Use existing serializer output as test cases

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
