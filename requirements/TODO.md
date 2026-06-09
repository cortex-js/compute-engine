# TODO - Compute Engine Improvements

Pending and planned work for the Compute Engine. **Completed items have been
removed from this file and are recorded in [`DONE.md`](./done/DONE.md).**

This file also absorbs the former top-level `FIXME.md` (known issues, technical
debt, and test gaps) — see [Known Issues & Technical Debt](#known-issues--technical-debt)
below.

---

## Lower Priority

### 2. Simplification Performance

**Problem:** The rule application system in `rules.ts` catches stack overflow
errors and logs them, then continues. This is slow and produces noisy console
output.

**Current behavior (rules.ts:865-867):**

```typescript
} catch (e) {
  console.error(`\n${expr.toString()}\n${rule.id}\n${e.message}`);
  return steps;
}
```

**Potential improvements:**

1. Add recursion depth limits to prevent stack overflows
2. Track expression complexity and bail out early if it's growing
3. Detect cycles in simplification (expression A → B → A) before they cause
   issues
4. Remove or reduce console.error logging in production

**Files:**

- `src/compute-engine/boxed-expression/rules.ts`
- `src/compute-engine/boxed-expression/simplify.ts`

---

## Logic and First-Order Logic Enhancements

The following improvements build on the existing FOL support (quantifiers,
CNF/DNF conversion, satisfiability checking, truth tables).

### 4. Logical Equivalence Checking

**Problem:** Currently, checking if two formulas are logically equivalent
requires `IsTautology(['Equivalent', A, B])`, which converts to CNF and checks
all assignments. This is inefficient.

**Solution:** Add `IsEquivalent(expr1, expr2)` that:

1. First tries syntactic equivalence (faster)
2. Then tries canonical form comparison
3. Falls back to truth table comparison only if needed

```typescript
ce.box(['IsEquivalent',
  ['Implies', 'A', 'B'],
  ['Or', ['Not', 'A'], 'B']
]).evaluate()  // → True
```

**File:** `src/compute-engine/library/logic.ts`

---

### 7. Prenex Normal Form (PNF)

**Problem:** FOL theorem proving often requires all quantifiers at the front.

**Solution:** Add `ToPNF(expr)` that:

1. Renames bound variables to avoid capture
2. Moves all quantifiers to the front
3. Preserves logical equivalence

```typescript
ce.box(['ToPNF',
  ['And',
    ['ForAll', 'x', ['P', 'x']],
    ['Exists', 'y', ['Q', 'y']]
  ]
]).evaluate()
// → ∀x. ∃y. (P(x) ∧ Q(y))
```

**Transformations needed:**

- `¬∀x.P → ∃x.¬P`
- `¬∃x.P → ∀x.¬P`
- `(∀x.P) ∧ Q → ∀x.(P ∧ Q)` (when x not free in Q)
- `(∃x.P) ∨ Q → ∃x.(P ∨ Q)` (when x not free in Q)
- Variable renaming when needed to avoid capture

**File:** `src/compute-engine/library/logic.ts`

---

### 8. DPLL-Based SAT Solver

**Problem:** Current `IsSatisfiable` uses brute-force enumeration (O(2^n)).

**Solution:** Implement DPLL (Davis-Putnam-Logemann-Loveland) algorithm:

1. Unit propagation: If a clause has one literal, it must be true
2. Pure literal elimination: If a variable appears with only one polarity,
   assign it
3. Branching with backtracking

**Benefits:**

- Much faster for most practical formulas
- Can handle 100+ variables (vs current 20 limit)
- Foundation for more advanced SAT techniques (CDCL)

**API:** Same as current, but faster:

```typescript
ce.box(['IsSatisfiable', large_formula]).evaluate()
```

**Implementation notes:**

- Convert to CNF internally (already have ToCNF)
- Represent clauses as sets of literals for efficient manipulation
- Consider adding conflict-driven clause learning (CDCL) later

**File:** `src/compute-engine/library/logic.ts` (new internal functions)

---

### 9. Model/Counterexample Finding

**Problem:** `IsSatisfiable` and `IsTautology` only return True/False, not
witnesses.

**Solution:** Add functions that return satisfying assignments:

- `FindModel(expr)` - Returns an assignment making expr true, or `Nothing`
- `FindCounterexample(expr)` - Returns an assignment making expr false, or
  `Nothing`

```typescript
ce.box(['FindModel', ['And', 'A', ['Not', 'B']]]).evaluate()
// → [["A", True], ["B", False]]  (or a Dictionary)

ce.box(['FindCounterexample', ['Implies', 'A', 'B']]).evaluate()
// → [["A", True], ["B", False]]
```

**Return format options:**

1. List of pairs: `[["A", True], ["B", False]]`
2. Dictionary: `{"A": True, "B": False}`
3. Set of true variables: `["Set", "A"]` (false = not in set)

**File:** `src/compute-engine/library/logic.ts`

---

### 10. Logical Consequence (Entailment)

**Problem:** No direct way to check if a conclusion follows from premises.

**Solution:** Add `Entails(premises, conclusion)`:

```typescript
// Modus Ponens: from P→Q and P, conclude Q
ce.box(['Entails',
  ['List', ['Implies', 'P', 'Q'], 'P'],  // premises
  'Q'                                      // conclusion
]).evaluate()
// → True

// Invalid argument
ce.box(['Entails',
  ['List', ['Implies', 'P', 'Q'], 'Q'],  // premises (affirming consequent)
  'P'                                      // conclusion
]).evaluate()
// → False
```

**Implementation:** `Entails([p1, p2, ...], c)` ≡
`IsTautology(Implies(And(p1, p2, ...), c))`

**File:** `src/compute-engine/library/logic.ts`

---

### 11. Resolution Theorem Proving

**Problem:** No support for automated theorem proving via resolution.

**Solution:** Add resolution-based refutation:

- `Resolve(clause1, clause2)` - Resolve two clauses on a complementary literal
- `RefutationProof(premises, negated_conclusion)` - Try to derive empty clause

```typescript
// Resolve {A, B} and {¬A, C} on A to get {B, C}
ce.box(['Resolve',
  ['Set', 'A', 'B'],
  ['Set', ['Not', 'A'], 'C']
]).evaluate()
// → ["Set", "B", "C"]
```

**For full theorem proving:**

```typescript
// Prove Q from P→Q and P using resolution
ce.box(['IsTheorem',
  ['List', ['Implies', 'P', 'Q'], 'P'],  // premises
  'Q'                                      // goal
]).evaluate()
// → True (found refutation proof)
```

**Algorithm:**

1. Convert premises and ¬goal to CNF clauses
2. Repeatedly resolve clauses
3. If empty clause derived → theorem proved
4. If no new clauses can be derived → not a theorem

**File:** `src/compute-engine/library/logic.ts`

---

### 12. Skolemization

**Problem:** Resolution in FOL requires removing existential quantifiers via
Skolemization.

**Background:** Skolemization replaces existentially quantified variables with
Skolem functions (or constants). For example:

- `∃x. P(x)` → `P(sk₁)` where `sk₁` is a Skolem constant
- `∀x. ∃y. R(x, y)` → `∀x. R(x, f(x))` where `f` is a Skolem function

**API Design Considerations:**

**Option A: Simple conversion**

```typescript
ce.box(['ToSkolem', ['Exists', 'x', ['P', 'x']]]).evaluate()
// → ["P", "$sk1"]  (Skolem constant with generated name)

ce.box(['ToSkolem',
  ['ForAll', 'x', ['Exists', 'y', ['R', 'x', 'y']]]
]).evaluate()
// → ["ForAll", "x", ["R", "x", ["$f1", "x"]]]  (Skolem function)
```

**Option B: Return with metadata**

```typescript
ce.box(['ToSkolem', expr]).evaluate()
// Returns: ["Tuple",
//   skolemized_formula,
//   ["Dictionary", {
//     "$sk1": ["SkolemConstant", "x", original_scope],
//     "$f1": ["SkolemFunction", "y", ["x"], original_scope]
//   }]
// ]
```

**Option C: Skolem symbols as special expressions**

```typescript
// Instead of plain symbols, use typed Skolem expressions:
["SkolemConstant", "sk1", "x"]  // Skolem constant replacing ∃x
["SkolemFunction", "f1", ["x"], "y"]  // Skolem function f(x) replacing ∃y
```

**Recommended approach:** Option A with naming convention

- Simple API: `ToSkolem(expr)` returns formula with Skolem symbols
- Skolem constants: `$sk1`, `$sk2`, ... (prefix with $ to avoid collision)
- Skolem functions: `$f1`, `$f2`, ... applied to universally quantified
  variables
- Document that these are Skolem symbols in the output

**Combined operation for theorem proving:**

```typescript
// ToClausalForm does: PNF → Skolemization → CNF → clause set
ce.box(['ToClausalForm', fol_formula]).evaluate()
// → ["Set", clause1, clause2, ...]  (set of clauses for resolution)
```

**Files:**

- `src/compute-engine/library/logic.ts`

**Implementation steps:**

1. First implement `ToPNF` (prerequisite)
2. Implement Skolemization on PNF formulas
3. Combine with CNF for `ToClausalForm`

---

### 13. Parse Natural Logic Notation

**Problem:** Users must use LaTeX (`\land`, `\lor`) or MathJSON for logic
expressions.

**Solution:** Support ASCII logic notation in parsing:

```typescript
ce.parse('p -> q')        // → ["Implies", "p", "q"]
ce.parse('p <-> q')       // → ["Equivalent", "p", "q"]
ce.parse('p & q')         // → ["And", "p", "q"]
ce.parse('p | q')         // → ["Or", "p", "q"]
ce.parse('~p')            // → ["Not", "p"]
ce.parse('!p')            // → ["Not", "p"]
ce.parse('p ^ q')         // → ["Xor", "p", "q"] (or keep as Power?)
ce.parse('forall x. P(x)')  // → ["ForAll", "x", ["P", "x"]]
ce.parse('exists x. P(x)')  // → ["Exists", "x", ["P", "x"]]
```

**Challenges:**

- `^` conflicts with Power notation
- `|` might conflict with absolute value or set notation
- Need to handle precedence correctly

**Option:** Add a `logicNotation: true` parsing option to enable these
alternatives.

**File:** `src/compute-engine/latex-syntax/definitions-logic.ts`

---

## Systems of Equations Enhancements

The following improvements build on the linear system solver implemented for
issue #189.

### 26. Symbolic Coefficients in Linear Systems

**Problem:** The current linear system solver only works with numeric
coefficients. Systems like `ax + by = c, dx + ey = f` where coefficients are
symbols cannot be solved.

**Current behavior:**

```typescript
const e = ce.parse('\\begin{cases}ax+by=c\\\\dx+ey=f\\end{cases}');
e.solve(['x', 'y']);  // → null (fails because a, b, c, d, e, f are symbolic)
```

**Expected behavior:**

```typescript
e.solve(['x', 'y']);
// → { x: (ce - bf) / (ae - bd), y: (af - cd) / (ae - bd) }
```

**Implementation approach:**

1. Extend `gaussianElimination()` to handle symbolic pivots
2. Use symbolic division instead of numeric comparison for pivot selection
3. The result will contain expressions in terms of the symbolic coefficients
4. Handle the case where the determinant (ae - bd) might be zero symbolically

**Challenges:**

- Pivot selection can't use numeric comparison; may need to assume non-zero
- Results may need simplification to be useful
- Division by symbolic expressions requires care (domain restrictions)

**Files:**

- `src/compute-engine/boxed-expression/solve-linear-system.ts`

---

### 29. Diagnostic Error Returns

**Problem:** When `solve()` returns `null`, there's no indication of _why_ the
system couldn't be solved.

**Current behavior:**

```typescript
ce.parse('\\begin{cases}x+y=1\\\\x+y=2\\end{cases}').solve(['x', 'y']);
// → null (but why? inconsistent? non-linear? under-determined?)
```

**Expected behavior options:**

**Option A: Error expressions**

```typescript
// Returns a BoxedExpression with error info
// → ["Error", "inconsistent-system", { equations: [...] }]
```

**Option B: Result object with status**

```typescript
// Returns { status: 'inconsistent', reason: 'equations 1 and 2 are parallel' }
// Or: { status: 'under-determined', freeVariables: ['y'] }
// Or: { status: 'non-linear', nonLinearTerms: ['xy'] }
```

**Option C: Separate diagnostic function**

```typescript
ce.diagnoseSystem(equations, variables);
// → { solvable: false, reason: 'inconsistent', details: {...} }
```

**Diagnostic categories:**

- `'solved'` - Unique solution found
- `'inconsistent'` - No solution exists (parallel lines, contradictory equations)
- `'under-determined'` - Infinitely many solutions
- `'over-determined'` - More equations than needed (check consistency)
- `'non-linear'` - Contains non-linear terms
- `'symbolic-coefficients'` - Contains symbolic coefficients (not yet supported)

**Files:**

- `src/compute-engine/boxed-expression/solve-linear-system.ts`

---

## Subscript and Superscript Enhancements

### 16. Pre-Subscript and Pre-Superscript Parsing

**Problem:** LaTeX supports pre-scripts (subscripts and superscripts that appear
_before_ the base symbol), but the current parser doesn't handle them correctly.

**Examples that don't work:**

```latex
{}_p^q X      % Pre-subscript p, pre-superscript q, base X (e.g., isotope notation)
{}_2^4 He     % Helium-4 notation: mass number 4, atomic number 2
{}_{n}C_{r}   % Alternative binomial notation with pre-subscript
```

**Current behavior:**

```typescript
ce.parse('{}_2^4 He').json
// Likely parses incorrectly as sequence or tuple, not as a single entity
```

**Expected behavior:**

```typescript
ce.parse('{}_2^4 He').json
// → ["PreScripts", "He", 2, 4]  // or some similar representation
// Or: ["Element", "He", {"mass": 4, "atomic": 2}]  // for chemistry context
```

**Implementation considerations:**

1. **LaTeX syntax:** Pre-scripts in LaTeX are written as `{}_a^b X` where:
   - `{}` is an empty group that anchors the scripts
   - `_a` is the pre-subscript
   - `^b` is the pre-superscript
   - `X` is the base

2. **Parser changes needed:**
   - Detect when `_` or `^` follows an empty group `{}`
   - Capture these as "pre-scripts" and associate with the following symbol
   - Handle all combinations: pre-sub only, pre-sup only, both pre-sub and
     pre-sup

3. **MathJSON representation options:**
   - `["Prescripts", base, pre_sub, pre_sup]` - explicit function
   - `["Subscript", base, sub, pre_sub]` - extend existing Subscript
   - Keep as separate metadata in the expression structure

4. **Use cases:**
   - Nuclear/isotope notation: `{}^{14}_6 C` (Carbon-14)
   - Tensor notation: `{}^i_j T^k_l` (mixed indices)
   - Alternative binomial: `{}_{n}C_r`

**Files to modify:**

- `src/compute-engine/latex-syntax/parse.ts` - Main parsing logic
- `src/compute-engine/latex-syntax/parse-symbol.ts` - Symbol parsing
- `src/compute-engine/library/core.ts` - Add Prescripts function definition (if
  new function)

**Tests to add:**

```typescript
test('pre-subscript parsing', () => {
  expect(parse('{}_2 X')).toMatchInlineSnapshot(`["Prescripts", "X", 2, "Nothing"]`);
});

test('pre-superscript parsing', () => {
  expect(parse('{}^4 X')).toMatchInlineSnapshot(`["Prescripts", "X", "Nothing", 4]`);
});

test('pre-scripts parsing', () => {
  expect(parse('{}_2^4 X')).toMatchInlineSnapshot(`["Prescripts", "X", 2, 4]`);
});

test('isotope notation', () => {
  expect(parse('{}^{14}_6 C')).toMatchInlineSnapshot(`["Prescripts", "C", 6, 14]`);
});
```

**Priority:** Low - primarily affects physics/chemistry notation

---

## Future Improvements (Not Yet Detailed)

### Trigonometric Simplification

- Detect Pythagorean identity within larger sums: `sin²(x) + cos²(x) + 5` → `6`
- Handle rational multiples of π in periodicity: `sin(3π/2 + k)` → `-cos(k)`
- More product-to-sum identities from the Fu algorithm

### Trigonometric Equation Solving

- Return general solutions with period parameter: `arcsin(a) + 2πn`
- Support more complex trig equations: `sin(x) + cos(x) = 0`, `sin²(x) = 1/2`
- Handle sec/csc equations

### Element-based Indexing Enhancements

- Support colon/pipe notation: `\sum_{n \in \N : n < 100}`
- Support "such that" notation: `\sum_{n \in S \mid P(n)}`
- Support compound conditions with `And`/`Or`
- Add convergence analysis for known series (Basel problem, geometric series,
  etc.)
- Support `.N()` for faster numeric approximations of infinite series
- Consider adding early termination for quickly converging series

---

# Known Issues & Technical Debt

_Merged from the former top-level `FIXME.md`. Known issues, technical debt, and
test gaps in the codebase, organized by impact level. No open items are
currently tracked under **Correctness Issues (wrong results)** or
**Missing Functionality**._

## Code Quality & Maintainability

### Collection Type Validation Warning Disabled

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

**Recommended Action**:

1. Add generic type parameters to function signatures
2. Implement dependent typing or conditional types
3. Re-enable validation once type system supports it
4. Document this limitation in type system docs

**Impact**: LOW - Validation gap but no runtime issues

---

## Optimization & Future Enhancements

### Missing Step Range Syntax in Summations

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

### \max/\min with Subscripts

Expressions like `\max_{x \in S} f(x)` are common in math but involve subscript
handling that's a separate parsing concern (related to
[#16 Pre-Subscript and Pre-Superscript Parsing](#16-pre-subscript-and-pre-superscript-parsing)).

---

## Test Debt & Identified Gaps

_Inventory of gaps surfaced from `todo` comments in the test suite._

### Simplification & Arithmetic Rules
- **Rational Expressions**: Implement common denominator rules for additions like `1/(x+1) - 1/x = -1/(x^2+x)` (`simplify-noskip.test.ts`).
- **Logarithmic Rules**: Correct canonicalization order to allow log rules to fire before expansion (e.g., `ln((x+1)/e^{2x})`) (`simplify-noskip.test.ts`).
- **Inverse Hyperbolic/Trigonometric**: Add rules for converting logarithms to inverse hyperbolic functions and inverse trig conversions (e.g., `arctan(x/sqrt(1-x^2)) = arcsin(x)`).
- **Factor Extraction**: Improve `factor()` to extract common factors from `Add` expressions like `(2pi + 2pi*e)`.

### Equation Solving
- **Systems of Equations**: Enable solving systems with symbolic coefficients (e.g., `ax + by = c`) — see [#26](#26-symbolic-coefficients-in-linear-systems).
- **Inequalities**: Fully implement and test solving for linear inequalities (e.g., `2x + 1 < 5`).
- **Sqrt Patterns**: Complete remaining edge cases for the Sqrt-linear, Two-sqrt-terms, and Nested-sqrt patterns referenced in `solve.test.ts` (the core patterns are implemented — see `done/DONE.md`).

### Latex Syntax & Set Notation
- **Infinite Sets**: Support parsing and serializing set notation with ellipses (e.g., `\{1, 2, 3...\}`, `\{...-2, -1, 0\}`).
- **Serialization**: Address remaining edge cases in LaTeX serialization noted in `serialize.test.ts`.

### Cortex Language Features
- **Indexed Access & Sets**: Implement support for indexed access (e.g., `a[i]`) and set membership validation in Cortex tests.

### Pattern Matching
- **Wildcards**: Extend support for repeated wildcards in deeply nested contexts and repeated-match cases (base wildcard support is implemented — see `done/DONE.md` #3).
- **Auto-wildcarding**: Regression check that `.replace()` no longer incorrectly auto-wildcards single-char symbols (fix recorded in `done/DONE.md` #23).

### Performance & Benchmarking
- **Precision**: Extend Wester benchmarks to support precision 50.
- **Notation**: `toLatex({ notation: 'engineering' })` is silently ignored (output is plain decimal, not engineering); only `'scientific'` is implemented. Implement engineering notation or document it as unsupported.

### Calculus & Special Functions
- **Integration**: Implement additional integration patterns identified in `calculus.test.ts`.
- **Signatures**: Add tests for special functions type signatures (Issue #1).

### Ambiguous / Unclear (triaged — low value)
- **`patterns.test.ts:625`**: the `//@todo` marks an unimplemented `matchPermutations`/`Replace` matching feature, not a missing test. Track under Pattern Matching if pursued; otherwise remove the stray comment.
- **`cortex-parse.test.ts:234`, `test/playground.ts:66`**: an undecided Cortex-lexing quirk (experimental, non-published language) and a scratch file. Low value — close by decision.

---

## Notes

### Related files for reference:

- Derivatives: `src/compute-engine/symbolic/derivative.ts`
- Integration: `src/compute-engine/symbolic/antiderivative.ts`
- Simplification: `src/compute-engine/symbolic/simplify-rules.ts`
- Pattern matching: `src/compute-engine/boxed-expression/match.ts`
- Rule application: `src/compute-engine/boxed-expression/rules.ts`
- Univariate solving: `src/compute-engine/boxed-expression/solve.ts`
- Linear system solving: `src/compute-engine/boxed-expression/solve-linear-system.ts`
- Polynomials: `src/compute-engine/boxed-expression/polynomials.ts`
- Library definitions: `src/compute-engine/library/`
- Logic library: `src/compute-engine/library/logic.ts`
- Logic tests: `test/compute-engine/logic.test.ts`
- Logic guide: `doc/16-guide-logic.md`
- Logic reference: `doc/89-reference-logic.md`
- Linear algebra guide: `doc/17-guide-linear-algebra.md`

### Testing commands:

```bash
npm run test                    # Run all tests
npm run test derivatives        # Run derivative tests
npm run test integration        # Run integration tests
npm run typecheck              # TypeScript type checking
```
