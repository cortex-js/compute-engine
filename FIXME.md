# FIXME Tracking Document

This document tracks known issues, bugs, and technical debt in the Compute
Engine codebase, organized by impact level.

**Last Updated**: 2026-02-08 **Total Issues**: 3 open critical @fixme items (13
resolved), 166+ @todo items

---

## Priority 1: Correctness Issues (May Produce Wrong Results)

### 1. ~~Power Simplification Rule May Be Incorrect~~ RESOLVED

**File**: `src/compute-engine/symbolic/simplify-rules-potential.ts:198`
**Status**: FIXED — Guards added to all three locations where
`(a^n)^m -> a^{nm}` is applied.

**Fix**: The rule now only applies when one of these conditions holds:

- `a >= 0` (non-negative base: no sign info to lose)
- `m` is integer (repeated multiplication is always safe)
- `n` is odd integer (sign-preserving bijection on R)

**Files changed**:

- `src/compute-engine/boxed-expression/arithmetic-power.ts` — `canonicalPower()`
  and `pow()` guarded
- `src/compute-engine/symbolic/simplify-power.ts` — `simplifyPower()` guarded
- `src/compute-engine/symbolic/simplify-rules-potential.ts` — inactive rule
  fixed

**Tests**: `(x^2)^{1/2}` now correctly simplifies to `|x|` instead of `x`.

---

### 1b. ~~Power Distribution Rules Unguarded for Non-Integer Exponents~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/arithmetic-power.ts` **Status**:
FIXED — Guards added to all four distribution rules in `pow()` and
`canonicalPower()`.

**Issue**: Three distribution rules in `pow()` and one in `canonicalPower()`
were applied unconditionally, producing wrong results when the exponent is
non-integer and operands are negative:

1. `(a/b)^c -> a^c / b^c` — wrong when `c` is non-integer and operands are
   negative (sign changes).
2. `(a*b)^c -> a^c * b^c` — same class of bug.
3. `(-x)^n` used `n % 2 === 0` to test parity, but `0.5 % 2 = 0.5`, so
   `(-x)^{0.5}` was incorrectly simplified to `-(x^{0.5})`.
4. `canonicalPower()` Divide rule `(a/b)^{-n}` — same issue for negative
   non-integer exponents.

**Fix**: All four rules now require integer exponents (or non-negative operands)
before distributing.

**Tests**: `(-x)^{0.5}` now stays as `Sqrt(Negate(x))` instead of incorrectly
distributing. `(n/e)^n` stays undistributed (Ramanujan formula).

---

### 1c. ~~Sqrt/Root Exponent Rearrangement Unguarded~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/arithmetic-power.ts` **Status**:
FIXED — Guards added to Sqrt fallthrough and Root rule in `pow()`.

**Issue**: Two rules in `pow()` rearranged exponents unconditionally:

1. `(√a)^b -> √(a^b)` — rearranges `(a^{1/2})^b` to `(a^b)^{1/2}`, wrong for
   negative `a`. E.g. `(√(-4))^3 = (2i)^3 = -8i` but `√((-4)^3) = √(-64) = 8i`.
2. `Root(a,b)^c -> a^{c/b}` — combines exponents unconditionally. Same class of
   issue.

**Fix**:

- Sqrt fallthrough: only fires when `a >= 0`. Even-integer branches
  (`(√a)^2 -> a`, `(√a)^{2k} -> a^k`) remain unconditional (integer outer
  exponent is always safe).
- Root rule: guarded with `a >= 0` or `c` is integer.

**Audit**: `simplify-power.ts` was fully audited and confirmed to have proper
guards on all rules (integer checks, `|x|` for even roots, non-negative checks).

---

### ~~2. Arithmetic Canonicalization Prematurely Collapses Exact Values~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/arithmetic-mul-div.ts:695-701`
**Status**: OBSOLETE — The behavior described in the original FIXME comment is
actually the **correct, documented policy**.

**Investigation Summary**:

The original FIXME comment claimed that folding `2*x*5` into `10*x` during
canonicalization was "not desirable." However, this is actually the **intended
behavior** as documented in CHANGELOG.md under "Exact numeric folding during
canonicalization."

**Current Policy (CORRECT)**:

Canonicalization **intentionally** folds exact numeric operands:

- Integers: `Add(2, x, 5)` → `Add(x, 7)`
- Rationals: `Add(1/3, x, 2/3)` → `Add(x, 1)`
- Radicals: `Add(√2, x, √2)` → `Add(x, 2√2)`
- Mixed exact: `Multiply(2, x, 5)` → `Multiply(10, x)`
- Identity elimination: `Multiply(1/2, x, 2)` → `x`

**What is NOT folded** (non-exact values):

- Machine floats: `Add(1.5, x, 0.5)` remains `Add(x, 0.5, 1.5)`
- Infinity/NaN: Handled specially
- Single numeric: `Multiply(5, Pi)` is unchanged (nothing to fold)

**Code Updates**:

The code has been updated with correct comments explaining the policy:

```typescript
// Exact numeric values in operands are now pre-folded by canonicalMultiply,
// so toNumericValue here just extracts the remaining coefficient+term.
const [c1, t1] = op1.toNumericValue();
console.assert(!c1.isZero); // zeros already filtered above

const [c2, t2] = op2.toNumericValue();
console.assert(!c2.isZero); // zeros already filtered above
```

The old `@fixme` comments have been removed and replaced with appropriate
`console.assert()` statements, as zeros are correctly filtered earlier in the
pipeline.

**Verification**: Both `canonicalAdd` and `canonicalMultiply` have explicit code
sections that fold exact numeric operands, with clear comments documenting the
intended behavior. Test results confirm all folding works as documented.

---

### ~~3. LaTeX Subscript Parsing Lacks Collection Check~~ RESOLVED

**File**: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`
**Status**: FIXED — The postfix `_` handler now checks if the LHS is a
collection-typed symbol (`indexed_collection`) or a list literal, and produces
`At()` directly at parse time. Multi-index subscripts are unpacked into separate
`At` arguments, consistent with bracket indexing (`x[i,j]`). Non-collection
symbols continue to produce `Subscript` expressions handled by the canonical
handler (compound symbols, subscriptEvaluate, etc.).

---

## Priority 2: Missing Functionality

### 4. ~~Simplification Doesn't Try Commutative Permutations~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/simplify.ts` **Status**:
INVESTIGATED AND RESOLVED - Permutations are not needed

**Investigation Summary**:

After thorough analysis with benchmarking, this feature is **not needed** and
would be harmful:

1. **Pattern rules already handle permutations**: The `matchPermutations: true`
   option (enabled by default) tries permutations of pattern operands during
   matching
2. **Most rules are functional**: 90%+ of simplification rules are functional
   (not pattern-based) and can directly check operands in any order they need
3. **Canonicalization provides consistency**: Commutative operators are sorted
   during canonicalization, giving predictable ordering
4. **Performance cost is prohibitive**: Trying all permutations would add 6× to
   720× overhead (factorial complexity) with no demonstrated benefit
5. **No real test cases found**: Benchmarking 21 expressions found zero cases
   that would benefit from permutations

**The example case is misleading**: The rule `a + b*a -> a*(1+b)` doesn't exist
in the system. Even `a + b*a` (correct order) doesn't factor because factoring
out common terms is not implemented in simplify(), not because of ordering
issues.

**Benchmark Results** (baseline, no permutations):

- Average: 1.758ms per expression
- Median: 0.956ms
- Performance is already excellent

**Resolution**: Removed commented-out code and added explanation in simplify.ts.
Rules that need custom permutation logic (like `factorPerfectSquare`) implement
it internally with controlled complexity.

**See**: `FIXME-ITEM4-ANALYSIS.md` for complete analysis and benchmarks

---

### ~~5. System of Equations Not Implemented~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/boxed-function.ts:951-955`
**Status**: FULLY IMPLEMENTED — System of equations solving is complete and
tested.

**Implementation Summary**:

The outdated @todo comment in `univariateSolve()` at `solve.ts:1299` was
misleading. That function is **dead code** (exported but never imported/used).
The actual solve path uses `solveSystem()` in `boxed-function.ts`, which fully
supports systems of equations via `List` and `And` operators.

**Implemented Features**:

1. **Linear Systems** (`solve-linear-system.ts:109`) — Any NxM size supported
   - Gaussian elimination with partial pivoting
   - Exact rational arithmetic
   - Parametric solutions for under-determined systems
   - Example: `x+y+z=6, 2x+y-z=1, x-y+2z=5` → `{x:1, y:2, z:3}`

2. **Non-Linear Polynomial Systems** (`solve-linear-system.ts:672`) — 2x2 only
   - Product-sum pattern: `xy=6, x+y=5`
   - Substitution method: `x²+y=5, x+y=3`
   - Returns multiple solutions when appropriate

3. **Inequality Systems** (`boxed-function.ts:1290`) — Any NxM size
   - Linear inequalities: `<`, `≤`, `>`, `≥`

4. **Mixed Equality/Inequality Systems** (`boxed-function.ts:1308`)
   - Solves equalities, filters by inequality constraints
   - Type-based solution filtering (integer, rational, real)

5. **Or Operator** (`boxed-function.ts:1362`)
   - Solves each branch independently
   - Merges and deduplicates results

**Tests**: All 30+ system solving tests pass in
`test/compute-engine/solve.test.ts`, including 2x2, 3x3 linear, polynomial,
inequality, and mixed systems.

**Known Limitations**:

- Non-linear polynomial systems limited to 2x2 (3x3+ requires Gröbner bases)
- Complex number solutions filtered out in polynomial systems

**Cleanup Done**: Removed unused `univariateSolve()` function.

---

### ~~6. Sequence Type Inference Incomplete~~ RESOLVED

**File**: `src/compute-engine/library/core.ts:170` **Status**: FIXED —
Multi-argument `Sequence` now returns a proper `tuple<...>` type computed from
each argument's individual type, matching the pattern used by the `Tuple`
operator.

**Fix**: The `type` handler now uses `parseType(\`tuple<\${args.map(a =>
a.type).join(', ')}>\`)`instead of returning`'any'`. This preserves
heterogeneous type information:

- `Sequence(1, 2, 3)` → `tuple<integer, integer, integer>`
- `Sequence(1, "a", x)` → `tuple<integer, string, any>`
- `Sequence()` → `nothing` (unchanged)
- `Sequence(x)` → type of `x` (unchanged)

---

### ~~7. Relational Operators Missing Evaluation Handlers~~ RESOLVED

**Files**: `src/compute-engine/library/relational-operator.ts` **Status**: FIXED
— All seven relational operators now have `evaluate` handlers.

**Implementation Summary**:

Approximate equality family (`TildeFullEqual`, `TildeEqual`, `Approx`,
`ApproxEqual`): Evaluate arguments numerically, check if `|a - b| <= tolerance`
using `ce.chop()`. Supports multi-argument chains (e.g., `a ≈ b ≈ c`).

- `ApproxNotEqual`: Negates approximate equality.
- `Precedes` / `Succeeds`: For numeric values, equivalent to `<` / `>`.

Negated variants (`NotTildeFullEqual`, `NotApprox`, `NotTildeEqual`,
`NotApproxEqual`, `NotPrecedes`, `NotSucceeds`) are canonicalized to `Not(...)`,
so they work automatically via the `Not` evaluate handler.

**Tests**: 45 tests in `test/compute-engine/relational-operators.test.ts`
covering all operators, chains, boundary cases, negations, and LaTeX
round-trips.

---

## Priority 3: Code Quality & Maintainability

### ~~8. BoxedNumber Should Return Specific Type~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/boxed-number.ts:122` **Status**:
FIXED — The `operator` property now returns specific numeric types instead of
the generic `'Number'`.

**Implementation**:

The `operator` getter now returns:

- `'Integer'` for integer values (both JavaScript integers and NumericValue
  integers)
- `'Rational'` for rational non-integer values
- `'Real'` for floating-point numbers
- `'Complex'` for complex numbers with non-zero imaginary part
- `'NaN'` for NaN values
- `'PositiveInfinity'` and `'NegativeInfinity'` for infinite values
- `'Number'` as a fallback for edge cases

**Fix Details**:

For plain JavaScript `number` values:

- NaN → `'NaN'`
- +Infinity → `'PositiveInfinity'`
- -Infinity → `'NegativeInfinity'`
- Integer → `'Integer'`
- Float → `'Real'`

For `NumericValue` objects:

- Checks special values first (NaN, infinities)
- Complex numbers (im !== 0) → `'Complex'`
- Maps internal type to operator string:
  - `'integer'` or `'finite_integer'` → `'Integer'`
  - `'rational'` or `'finite_rational'` → `'Rational'`
  - Other real types → `'Real'`

**Tests**: Added comprehensive test suite in
`test/compute-engine/numbers.test.ts` covering all numeric types (integers,
reals, rationals, complex, special values).

**Breaking Change**: Yes, but minimal impact - no existing code in the codebase
was found that checks for `.operator === 'Number'` on BoxedExpression objects.

---

### ~~9. Flatten Functions Need Refactoring~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/flatten.ts` **Status**: FIXED —
`flattenOps()` removed; `flatten()` now handles all use cases.

**Changes**:

- Added `canonicalize = true` third parameter to `flatten()`. When `false`,
  skips the `.canonical` mapping on operands, replacing `flattenOps()`'s
  behavior.
- Deleted `flattenOps()` entirely, which also fixed a bug: the
  `console.assert(result.length !== ops.length)` length-check was wrong —
  flattening `[Add, [Add, a]]` produces `[a]` (same length 1 but different
  content), so the guard would incorrectly return the original ops.
- Updated callers in `hold.ts` (4 sites in `holdMap`/`holdMapAsync`) and
  `canonical.ts` (1 site in `flattenForm`) to use
  `flatten(ops, operator, false)`.
- `flattenSequence()` kept as-is — it has unique Delimiter→Tuple logic with only
  1 caller, not a consolidation target.
- `flattenSort()` not added — no callers do flatten+sort in a single step;
  intermediate processing always happens between.

**Impact**: LOW - Internal refactoring, no user-facing changes

---

### 10. Compilation Fallback Doesn't Handle Multiple Arguments

**File**: `src/compute-engine/compilation/compile-expression.ts:64` **Issue**:
Fallback compilation path incomplete for multi-argument functions

```typescript
} catch (e) {
  // @fixme: the fallback needs to handle multiple arguments
  if (options?.fallback ?? true) {
    console.warn(`Compilation fallback for "${expr.operator}": ${(e as Error).message}`);
    return {
      // ... fallback implementation
```

**Analysis**:

- When compilation fails, system falls back to JavaScript evaluation
- Fallback currently only handles single-argument case properly
- Multi-argument functions may fail or produce incorrect compiled code
- Affects performance for functions that fail to compile natively

**Example Issue**:

```javascript
// Function with 3 arguments fails to compile to GLSL/JavaScript
// Fallback should properly map all 3 arguments, currently may not
```

**Recommended Action**:

1. Implement proper argument mapping in fallback code generator
2. Add tests for compilation fallback with 0, 1, 2, 3+ arguments
3. Consider warning user when fallback is used (performance impact)
4. Document which operations can't be compiled natively

**Impact**: LOW - Only affects compilation fallback path

---

### ~~11. Type System Import Cycle~~ RESOLVED

**File**: `src/compute-engine/boxed-expression/trigonometry.ts:7` **Status**:
FIXED — Stale `@fixme` comment removed.

**Investigation**: Madge confirms no circular dependency involving `apply.ts`.
Three other files (`arithmetic-power.ts`, `library/arithmetic.ts`,
`library/trigonometry.ts`) import from `apply.ts` without issue. The `@fixme`
was a leftover from an earlier refactoring and is no longer relevant.

---

### 12. Collection Type Validation Warning Disabled

**File**: `src/compute-engine/boxed-expression/boxed-operator-definition.ts:300`
**Issue**: Useful validation check commented out due to type system limitations

```typescript
// @fixme: this warning cannot reliably be checked, because some functions
// (Map, Filter) return an indexed collection if the input is indexed.
// Would need support for type arguments in signatures.
// if (!isSubtype(resultType, 'indexed_collection') && this.collection.at) {
//   throw new Error(
//     `Operator Definition "${this.name}" returns a non-indexed collection,
//      but the 'at' handler is defined`
//   );
```

**Analysis**:

- Validation would catch mismatched collection handlers (e.g., `at` handler on
  non-indexed collection)
- Can't be enabled because type system doesn't support generic type parameters
- Functions like `Map` and `Filter` preserve collection type structure from
  input
- Need dependent typing: `Map(f, list<T>)` → `list<U>` vs. `Map(f, indexed<T>)`
  → `indexed<U>`

**Current Limitation**:

```typescript
// Can't express: "if input is indexed_collection, output is indexed_collection"
// Signature: (any, collection<T>) -> collection<U>
// Need: (any, indexed<T>) -> indexed<U> OR (any, list<T>) -> list<U>
```

**Recommended Action**:

1. Add generic type parameters to function signatures
2. Implement dependent typing or conditional types
3. Re-enable validation once type system supports it
4. Document this limitation in type system docs

**Impact**: LOW - Validation gap but no runtime issues

---

## Priority 4: Optimization & Future Enhancements

### 13. Missing Step Range Syntax in Summations

**File**:
`src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts:1480`
**Issue**: Step ranges like `i=1..3..10` (start..step..end) not supported

```typescript
// @todo: we currently do not support step range, i.e. `i=1..3..10`.
// The step is the third argument of Range. We should extend the indexing
// set to include step-range and collections, i.e. i={1,2,3,4}
```

**Analysis**:

- Summation and product indexing limited to unit step: `∑_{i=1}^{10}`
- Can't express: `∑_{i=1,3,5,7,9}` or `∑_{i=1..2..10}` (step by 2)
- Collection-based indexing also missing: `∑_{i ∈ {1,2,5,7}}`
- Common mathematical notation that users expect

**Use Cases**:

- Sum odd numbers: `∑_{i=1..2..99}`
- Sum over specific set: `∑_{i ∈ {2,3,5,7,11}}`
- Product of every 3rd term: `∏_{i=0..3..30}`

**Recommended Action**:

1. Extend Range syntax to accept step parameter
2. Support collection-based indexing sets
3. Update parser to handle `..` and collection syntax
4. Add tests for various step and collection combinations

**Impact**: LOW - Enhancement request, workarounds exist

---

### ~~14. Unicode Character Encoding Incomplete~~ RESOLVED

**File**: `src/compute-engine/latex-syntax/parse-symbol.ts:104` **Status**:
FIXED — Non-XIDC characters from `\unicode{...}`, `\char`, and `^^XX` escapes
are now encoded as `____XXXXXX` (4 underscores + 6 uppercase hex digits).

**Implementation Summary**:

When `parseSymbolToken()` encounters a character via `\unicode{...}`, `\char`,
or `^^XX` that is not in the SYMBOLS table and not a valid XIDC identifier
character, it encodes the character as `____XXXXXX` where `XXXXXX` is the
zero-padded 6-digit hex codepoint. This format is valid per `isValidSymbol()`
since underscores and hex digits are all in `[a-zA-Z0-9_]`.

The serializer (`specialName()` and `parseSymbolBody()`) recognizes `____XXXXXX`
patterns and converts them back to `\unicode{"XXXX"}` in LaTeX output, trimming
leading zeros but keeping at least 4 hex digits.

**Example**: `\operatorname{speed\unicode{"2012}of\unicode{"2012}sound}` parses
to symbol `speed____002012of____002012sound` and serializes back to
`\mathrm{speed\unicode{"2012}of\unicode{"2012}sound}`.

**Design Decisions**:

- 6 hex digits (not 4) to avoid ambiguity when followed by hex-valid characters
- Only characters from `\char`/`\unicode`/`^^XX` are encoded; raw tokens pass
  through so `isValidSymbol()` can reject truly invalid characters
- XIDC characters from escapes pass through as-is (only non-XIDC are encoded)

**Files changed**:

- `src/compute-engine/latex-syntax/parse-symbol.ts` — encoding in
  `parseSymbolToken()`
- `src/compute-engine/latex-syntax/serializer.ts` — decoding in `specialName()`,
  `parseSymbolBody()`, and `serializeSymbol()`
- `test/compute-engine/latex-syntax/symbols.test.ts` — 4 new test groups

### ~~15. `\tr` serialization parity with `\det`~~ RESOLVED

**File**:
`src/compute-engine/latex-syntax/dictionary/definitions-linear-algebra.ts`
**Status**: FIXED — `Trace` now serializes as `\tr A` for simple arguments and
`\tr\left(...\right)` for complex arguments, matching the style used by
`Determinant`.

**Tests**: Added `Trace` LaTeX serialization coverage in
`test/compute-engine/latex-syntax/linear-algebra.test.ts` for simple symbol,
simple numeric, and compound arguments.

### ~~16.~~ RESOLVED

- Missing standard LaTeX operators — \ker, \dim, \deg, \hom are standard LaTeX
  commands (amsmath) but don't have dictionary entries yet. They could be added
  as kind: 'function' with arguments:  
  'implicit' if/when the library adds the corresponding functions.

### 17

- \max/\min with subscripts — Expressions like \max\_{x \in S} f(x) are common
  in math but involve subscript handling that's a separate parsing concern.

---

## Statistics

- **Priority 1 (Correctness)**: 0 open issues (5 resolved)
- **Priority 2 (Missing Functionality)**: 0 open issues (4 resolved)
- **Priority 3 (Code Quality)**: 2 open issues (3 resolved)
- **Priority 4 (Enhancements)**: 1 open issue (1 resolved)

**Total @fixme**: 3 open critical issues (13 resolved) **Total @todo**: 166+
enhancement requests (not all listed above)

## Next Steps

1. **Immediate**: Address Priority 1 issues (correctness bugs)
2. **Short-term**: Implement Priority 2 missing functionality
3. **Medium-term**: Refactor Priority 3 code quality issues
4. **Long-term**: Consider Priority 4 enhancements

## Additional Notes

- Many @todo items are empty or lack context (e.g., `// @todo`)
- Consider adding issue numbers to track progress
- Some items may be obsolete and can be removed after verification
- Regular audits recommended to prevent FIXME accumulation
