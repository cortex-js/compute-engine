# TODO - Compute Engine Improvements

Next: (all sqrt patterns complete)

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

### ~~3. Pattern Matching Improvements~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

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

### ~~6. Prime Implicants/Implicates~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

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

### ~~27. Under-determined Systems (Parametric Solutions)~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### ~~28. Non-linear Polynomial Systems~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

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

### ~~30. Linear Inequality Systems~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### ~~31. Exact Rational Arithmetic Throughout~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

## Equation Solving Enhancements

### ~~14. Extraneous Root Filtering for Sqrt Equations~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### 15. Extended Sqrt Equation Patterns

**Problem:** Current sqrt rules only handle `ax + b√x + c = 0`. More complex
patterns aren't supported.

**Patterns to add:**

1. **Sqrt of linear expression:** `√(ax + b) + c = 0` ✅ IMPLEMENTED (in prior work)
   - Solution: `ax + b = c²` when `c ≤ 0`, so `x = (c² - b)/a`

2. **Sqrt equals linear:** `√(ax + b) = cx + d` ✅ IMPLEMENTED
   - Pre-processing in `transformSqrtLinearEquation()` squares both sides
   - Transforms to: `c²x² + (2cd - a)x + (d² - b) = 0`
   - Quadratic formula solves, `validateRoots()` filters extraneous roots
   - Examples: `√(x+1) = x` → `1.618`, `√(3x-2) = x` → `[1, 2]`

3. **Sum of two sqrt terms:** `√(ax + b) + √(cx + d) = e` ✅ IMPLEMENTED
   - Isolate one sqrt: `√(f(x)) = e - √(g(x))`
   - Square: `f(x) = e² - 2e√(g(x)) + g(x)`
   - Isolate remaining sqrt: `f(x) - e² - g(x) = -2e√(g(x))`
   - Square again: `(f(x) - e² - g(x))² = 4e²·g(x)`
   - Solve polynomial and validate against original equation
   - Implemented in `solveTwoSqrtEquation()` function
   - Examples: `√(x+1) + √(x+4) = 3` → `0`, `√(x+5) - √(x-3) = 2` → `4`

4. **Nested sqrt:** `√(x + √x) = a` ✅ IMPLEMENTED
   - Uses substitution u = √x, so x = u²
   - Becomes `√(u² + u) = a`, then `u² + u = a²`
   - Solves quadratic for u, filters u < 0 (since u = √x ≥ 0), then x = u²
   - Implemented in `solveNestedSqrtEquation()` function
   - Examples: `√(x + 2√x) = 3` → `11 - 2√10`, `√(x - √x) = 1` → `φ² ≈ 2.618`

**Also implemented:** Quadratic without constant term: `ax² + bx = 0`
- Factor: `x(ax + b) = 0` → `x = 0` or `x = -b/a`
- This enables Pattern 2 cases like `√x = x` → `x² - x = 0`

**File:** `src/compute-engine/boxed-expression/solve.ts`

---

### ~~23. Replace Method Auto-Wildcards Single-Char Symbols~~ ✅ FIXED

See `requirements/DONE.md` for implementation details

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

## Assumption System Enhancements

The following improvements extend the assumption system beyond sign-based
simplification (which is already implemented).

### ~~18. Value Resolution from Equality Assumptions~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### ~~19. Inequality Evaluation Using Assumptions~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### ~~20. Tautology and Contradiction Detection~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### ~~21. Type Inference from Assumptions~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### ~~24. BUG: forget() Doesn't Clear Assumed Values~~ ✅ FIXED

See `requirements/DONE.md` for implementation details.

---

### ~~25. BUG: Scoped Assumptions Don't Clean Up on popScope()~~ ✅ FIXED

See `requirements/DONE.md` for implementation details.

---

## Polynomial Operations

### ~~33. Polynomial Factoring~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

## Future Improvements (Not Yet Detailed)

### 32. Ambiguous Interval Notation Handling

**Problem:** Currently, `[a, b]` parses as `List` and `(a, b)` parses as `Tuple`
to maintain backward compatibility. However, in set theory contexts, these
notations represent closed and open intervals respectively.

**Current behavior:**

```typescript
ce.parse('[3, 4]').json; // → ["List", 3, 4]
ce.parse('(3, 4)').json; // → ["Tuple", 3, 4]

// Half-open intervals work (issue #254, implemented)
ce.parse('[3, 4)').json; // → ["Interval", 3, ["Open", 4]]
ce.parse('(3, 4]').json; // → ["Interval", ["Open", 3], 4]
```

**Potential solutions:**

1. **Context-aware parsing:** Detect set theory context (e.g., following `\in`,
   `\subset`, or within set operations) and parse as intervals:

   ```typescript
   ce.parse('x \\in [0, 1]'); // [0,1] interpreted as closed interval
   ce.parse('[0, 1] \\cup [2, 3]'); // Both as intervals
   ```

2. **Explicit LaTeX notation:** Support the CTAN `interval` package commands:

   ```typescript
   ce.parse('\\interval{a}{b}'); // Closed interval [a, b]
   ce.parse('\\interval[open]{a}{b}'); // Open interval (a, b)
   ce.parse('\\interval[open left]{a}{b}'); // Half-open (a, b]
   ce.parse('\\interval[open right]{a}{b}'); // Half-open [a, b)
   ```

3. **Parsing option:** Add a `parseIntervalsAsSets: true` option to the parser:
   ```typescript
   ce.parse('[0, 1]', { parseIntervalsAsSets: true });
   // → ["Interval", 0, 1]
   ```

**Design considerations:**

- Backward compatibility is important; changing default behavior could break
  existing code
- Context-aware parsing adds complexity and may have edge cases
- Explicit notation is unambiguous but requires users to learn new commands
- A parsing option gives users control but affects all parsing in that context

**Related:**

- Issue #254 (implemented half-open interval parsing)
- `\left`/`\right` delimiters with mismatched brackets currently don't work for
  intervals (e.g., `\left[a, b\right)` fails to parse correctly)

**Files:**

- `src/compute-engine/latex-syntax/dictionary/definitions-sets.ts`
- `src/compute-engine/latex-syntax/parse.ts`

---

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
