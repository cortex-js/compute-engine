# TODO - Compute Engine Improvements

## Medium Priority

### 1. Add More Integration Patterns

**Common integrals to add:**

```
∫ x·e^x dx = (x-1)·e^x
∫ x²·e^x dx = (x²-2x+2)·e^x
∫ x·sin(x) dx = sin(x) - x·cos(x)
∫ x·cos(x) dx = cos(x) + x·sin(x)
∫ ln(x) dx = x·ln(x) - x
∫ x·ln(x) dx = (x²/2)·ln(x) - x²/4
∫ sec(x) dx = ln|sec(x) + tan(x)|
∫ csc(x) dx = -ln|csc(x) + cot(x)|
∫ sec²(x) dx = tan(x)  (may already exist)
∫ csc²(x) dx = -cot(x) (may already exist)
∫ e^x·sin(x) dx = (e^x/2)·(sin(x) - cos(x))
∫ e^x·cos(x) dx = (e^x/2)·(sin(x) + cos(x))
```

**File:** `src/compute-engine/symbolic/antiderivative.ts`

**Implementation notes:**

- Each pattern needs proper wildcard handling for coefficients
- Consider adding integration by parts as a general technique
- Tabular integration could handle `∫ x^n·e^x dx` patterns

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

## Equation Solving Enhancements

### ~~14. Extraneous Root Filtering for Sqrt Equations~~ ✅ COMPLETED

See `requirements/DONE.md` for implementation details.

---

### 15. Extended Sqrt Equation Patterns

**Problem:** Current sqrt rules only handle `ax + b√x + c = 0`. More complex
patterns aren't supported.

**Patterns to add:**

1. **Sqrt of linear expression:** `√(ax + b) + c = 0`
   - Solution: `ax + b = c²` when `c ≤ 0`, so `x = (c² - b)/a`

   ```typescript
   {
     match: ['Add', ['Sqrt', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
     replace: ['Divide', ['Subtract', ['Square', '__c'], '__b'], '__a'],
     condition: (sub) => filter(sub) && (sub.__c.isNonPositive ?? false),
   }
   ```

2. **Sqrt equals linear:** `√(ax + b) = cx + d`
   - Square both sides: `ax + b = (cx + d)²`
   - Expand: `ax + b = c²x² + 2cdx + d²`
   - Rearrange: `c²x² + (2cd - a)x + (d² - b) = 0`
   - Use quadratic formula, then validate (may have extraneous roots)

3. **Sum of two sqrt terms:** `√(ax + b) + √(cx + d) = e`
   - Isolate one sqrt: `√(ax + b) = e - √(cx + d)`
   - Square: `ax + b = e² - 2e√(cx + d) + cx + d`
   - Isolate remaining sqrt and square again
   - Results in polynomial equation

4. **Nested sqrt:** `√(x + √x) = a`
   - Use substitution u = √x
   - Becomes `√(u² + u) = a`, then `u² + u = a²`
   - Solve quadratic for u, then x = u²

**Complexity note:** Patterns 2-4 can produce extraneous roots and require
careful validation.

**File:** `src/compute-engine/boxed-expression/solve.ts`

---

### 22. Equation Equivalence in isEqual

**Problem:** `isEqual` should recognize mathematically equivalent equations, but
currently returns `false` for equations with the same solution set.

**Current behavior:**

```typescript
ce.parse('2x+1=0').isEqual(ce.parse('x=-1/2'))  // Returns: false
// But both equations have the same solution: x = -1/2
```

**Expected behavior:**

```typescript
ce.parse('2x+1=0').isEqual(ce.parse('x=-1/2'))  // Should return: true
```

**Background:**

- `isSame` = structural equality (same expression tree)
- `isEqual` = mathematical equality (same mathematical meaning)

For regular expressions, `isEqual` works correctly:

```typescript
ce.parse('2x').isEqual(ce.parse('x+x'))  // Returns: true (correct)
```

**Solution:** When `isEqual` compares two `Equal` expressions (equations):

1. Compute `expr1 = LHS1 - RHS1` and `expr2 = LHS2 - RHS2`
2. Compute `ratio = expr1 / expr2`
3. Simplify the ratio
4. If ratio is a non-zero constant, the equations are equivalent (same solution
   set)

**Example:**

- `2x + 1 = 0` → `expr1 = 2x + 1`
- `x = -1/2` → `expr2 = x + 1/2`
- `ratio = (2x + 1) / (x + 1/2) = 2` (constant)
- Therefore, equations are equivalent → return `true`

**Edge cases:**

- Handle equations with no solutions (e.g., `0 = 1`)
- Handle equations that are identities (e.g., `x = x`)
- Ensure ratio check handles symbolic expressions correctly

**Files to modify:**

- `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` - `isEqual`
  method

**Tests:** See `test/playground.ts` and PLAYGROUND.md Solve section

---

### 23. Replace Method Auto-Wildcards Single-Char Symbols

**Problem:** `.replace({match: 'a', replace: 2})` unexpectedly converts `'a'` to a wildcard
`'_a'`, causing it to match ANY expression instead of just the literal symbol `a`.

**Current behavior:**
```typescript
const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
expr.replace({match: 'a', replace: 2}, {recursive: true})
// Returns: 2  (wrong!)
// Expected: 2*x + b
```

**Root cause:** In `parseRulePart` (rules.ts:350), all single-character symbols are
auto-converted to wildcards:
```typescript
if (x.symbol && x.symbol.length === 1) return ce.symbol('_' + x.symbol);
```

This makes sense when parsing rule strings like `"a*x -> 2*x"` where `a`, `x` should be
wildcards, but NOT when the user explicitly provides `{match: 'a', replace: 2}` where
they likely want literal matching.

**Solution options:**
1. Only auto-wildcard when parsing a rule string, not when rule is provided as an object
2. Add an option like `{literal: true}` to disable auto-wildcarding
3. Require explicit wildcard syntax `'_a'` and never auto-wildcard

**Workaround:** Use `.subs()` for simple variable substitution:
```typescript
expr.subs({a: 2})  // Returns: 2*x + b (correct)
```

**Files to modify:**
- `src/compute-engine/boxed-expression/rules.ts` - `parseRulePart` function

**Tests:** See `test/playground.ts` lines 61-72 and PLAYGROUND.md Evaluation section

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
   - `["PreScripts", base, pre_sub, pre_sup]` - explicit function
   - `["Subscript", base, sub, pre_sub]` - extend existing Subscript
   - Keep as separate metadata in the expression structure

4. **Use cases:**
   - Nuclear/isotope notation: `{}^{14}_6 C` (Carbon-14)
   - Tensor notation: `{}^i_j T^k_l` (mixed indices)
   - Alternative binomial: `{}_{n}C_r`

**Files to modify:**

- `src/compute-engine/latex-syntax/parse.ts` - Main parsing logic
- `src/compute-engine/latex-syntax/parse-symbol.ts` - Symbol parsing
- `src/compute-engine/library/core.ts` - Add PreScripts function definition (if
  new function)

**Tests to add:**

```typescript
test('pre-subscript parsing', () => {
  expect(parse('{}_2 X')).toMatchInlineSnapshot(`["PreScripts", "X", 2, "Nothing"]`);
});

test('pre-superscript parsing', () => {
  expect(parse('{}^4 X')).toMatchInlineSnapshot(`["PreScripts", "X", "Nothing", 4]`);
});

test('pre-scripts parsing', () => {
  expect(parse('{}_2^4 X')).toMatchInlineSnapshot(`["PreScripts", "X", 2, 4]`);
});

test('isotope notation', () => {
  expect(parse('{}^{14}_6 C')).toMatchInlineSnapshot(`["PreScripts", "C", 6, 14]`);
});
```

**Priority:** Low - primarily affects physics/chemistry notation

---

### 17. Subscript Evaluation Functions for Sequences

**Problem:** Users cannot define evaluation functions for subscripted symbols.
For example, defining a Fibonacci sequence `F_n` where `F_0 = 0`, `F_1 = 1`,
`F_n = F_{n-1} + F_{n-2}`.

**Current behavior:**

```typescript
// No way to define this:
ce.declare('F', { subscriptEvaluate: (n) => fibonacci(n) });

// Subscript expressions remain symbolic:
ce.parse('F_5').evaluate()
// → ['Subscript', 'F', 5]  // No evaluation possible
```

**Desired behavior:**

```typescript
// Define a sequence with subscript evaluation
ce.declare('F', {
  type: 'function',  // or 'sequence' if we add a new type
  subscriptEvaluate: (n, ce) => {
    const nVal = n.re;
    if (!Number.isInteger(nVal) || nVal < 0) return undefined;
    if (nVal === 0) return ce.Zero;
    if (nVal === 1) return ce.One;
    let a = 0, b = 1;
    for (let i = 2; i <= nVal; i++) {
      [a, b] = [b, a + b];
    }
    return ce.number(b);
  },
});

ce.parse('F_5').evaluate()
// → 5

ce.parse('F_{10}').evaluate()
// → 55
```

**Implementation considerations:**

1. **Extend symbol definition interface:**

   ```typescript
   interface SymbolDefinition {
     // ... existing properties ...

     // New: Function to evaluate subscripted forms of this symbol
     subscriptEvaluate?: (
       subscript: BoxedExpression,
       engine: IComputeEngine
     ) => BoxedExpression | undefined;
   }
   ```

2. **Modify Subscript evaluation:** In `src/compute-engine/library/core.ts`, the
   Subscript function's evaluate handler should check if the base symbol has a
   `subscriptEvaluate` function defined.

3. **Handle compound symbols:** Need to decide how this interacts with compound
   symbols like `F_n` being parsed as a single symbol. Options:
   - Parse `F_5` as `['Subscript', 'F', 5]` (not a symbol) when `F` has
     subscriptEvaluate
   - Always parse as compound symbol but resolve during evaluation
   - Add a declaration flag to control parsing behavior

4. **Recursive definitions:** For sequences like Fibonacci, users might want to
   define them recursively:

   ```typescript
   ce.declare('F', {
     subscriptEvaluate: (n, ce) => {
       const nVal = n.re;
       if (nVal === 0) return ce.Zero;
       if (nVal === 1) return ce.One;
       // Recursive call - need memoization to avoid exponential time
       return ce.parse(`F_{${nVal-1}} + F_{${nVal-2}}`).evaluate();
     },
   });
   ```

   Consider adding built-in memoization support.

5. **Multi-index sequences:** Support sequences with multiple indices (e.g.,
   Pascal's triangle `C_{n,k}`):
   ```typescript
   ce.declare('C', {
     subscriptEvaluate: ([n, k], ce) => {
       // Binomial coefficient C(n, k)
     },
   });
   ```

**Common sequences to support:**

- Fibonacci: `F_n = F_{n-1} + F_{n-2}`
- Lucas: `L_n = L_{n-1} + L_{n-2}` with `L_0 = 2, L_1 = 1`
- Triangular: `T_n = n(n+1)/2`
- Catalan: `C_n = \frac{1}{n+1}\binom{2n}{n}`
- Bell numbers: `B_n` (number of partitions of n-element set)
- Prime counting: `\pi_n` (number of primes ≤ n)

**Files to modify:**

- `src/compute-engine/global-types.ts` - Add subscriptEvaluate to
  SymbolDefinition interface
- `src/compute-engine/library/core.ts` - Modify Subscript evaluate handler
- `src/compute-engine/compute-engine.ts` - Handle subscriptEvaluate in declare()
- `src/compute-engine/latex-syntax/parse-symbol.ts` - Potentially modify
  compound symbol parsing

**Tests to add:**

```typescript
test('fibonacci sequence', () => {
  ce.declare('F', {
    subscriptEvaluate: (n, ce) => {
      // ... fibonacci implementation ...
    },
  });
  expect(ce.parse('F_0').evaluate().value).toBe(0);
  expect(ce.parse('F_1').evaluate().value).toBe(1);
  expect(ce.parse('F_{10}').evaluate().value).toBe(55);
});

test('custom sequence with symbolic subscript', () => {
  ce.declare('a', {
    subscriptEvaluate: (n, ce) => ce.number(n.re * 2),
  });
  expect(ce.parse('a_5').evaluate().value).toBe(10);
  expect(ce.parse('a_n').evaluate().json).toMatchInlineSnapshot(`["Subscript", "a", "n"]`);
});

test('multi-index sequence', () => {
  ce.declare('A', {
    subscriptEvaluate: ([i, j], ce) => ce.number(i.re + j.re),
  });
  expect(ce.parse('A_{2,3}').evaluate().value).toBe(5);
});
```

**Related:** This feature would complement the type-aware subscript handling
(implemented) where collection-typed symbols convert subscripts to `At()` calls.
For sequences defined via subscriptEvaluate, the subscript becomes an evaluated
function call rather than array indexing.

**Priority:** Medium - useful for mathematical sequences and recurrence
relations

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

### 20. Tautology and Contradiction Detection

**Problem:** `ce.assume()` should detect when an assumption is redundant
(tautology) or conflicts with existing assumptions (contradiction), but
currently it always returns `"ok"`.

**Current behavior:**

```typescript
ce.assume(ce.box(['Equal', 'one', 1]));
ce.assume(ce.box(['Equal', 'one', 1]));  // Returns: "ok" (should be "tautology")
ce.assume(ce.box(['Less', 'one', 0]));   // Returns: "ok" (should be "contradiction")
```

**Expected behavior:**

```typescript
ce.assume(ce.box(['Equal', 'one', 1]));
ce.assume(ce.box(['Equal', 'one', 1]));   // Should return: "tautology"
ce.assume(ce.box(['Less', 'one', 0]));    // Should return: "contradiction"
ce.assume(ce.box(['Greater', 'one', 0])); // Should return: "tautology" (one=1 > 0)

ce.assume(ce.box(['Greater', 'x', 4]));
ce.assume(ce.box(['Greater', 'x', 0]));   // Should return: "tautology" (implied by x > 4)
ce.assume(ce.box(['Less', 'x', 0]));      // Should return: "contradiction"
```

**Implementation notes:**

- Tautology detection: Check if the new assumption is already implied by
  existing assumptions
- Contradiction detection: Check if the new assumption conflicts with existing
  assumptions
- Requires transitive reasoning for inequalities
- The return type of `assume()` already includes `"tautology"` and
  `"contradiction"` as options

**Files to investigate:**

- `src/compute-engine/assume.ts` - `assume()` function and `AssumeResult` type

**Tests:** `test/compute-engine/assumptions.test.ts` - "TAUTOLOGY AND
CONTRADICTION DETECTION"

---

### 21. Type Inference from Assumptions

**Problem:** When assumptions are made, symbol types should be inferred. For
example, `x > 4` implies `x` is real, and `one = 1` implies `one` is an integer.

**Current behavior:**

```typescript
ce.assume(ce.box(['Greater', 'x', 4]));
ce.box('x').type.toString()  // Returns: "unknown"

ce.assume(ce.box(['Equal', 'one', 1]));
ce.box('one').type.toString()  // Returns: "unknown"
```

**Expected behavior:**

```typescript
ce.assume(ce.box(['Greater', 'x', 4]));
ce.box('x').type.toString()  // Should return: "real" (inequalities imply real numbers)

ce.assume(ce.box(['Equal', 'one', 1]));
ce.box('one').type.toString()  // Should return: "integer" (equal to integer literal)
```

**Implementation notes:**

- Inequality assumptions (`>`, `<`, `>=`, `<=`) imply the symbol is `real`
- Equality to an integer implies the symbol is `integer`
- Equality to a rational implies the symbol is `rational`
- This might be handled by updating the symbol's type when an assumption is made
- Alternatively, the type getter could query assumptions

**Files to investigate:**

- `src/compute-engine/assume.ts` - Assumption processing
- `src/compute-engine/boxed-expression/boxed-symbol.ts` - Symbol type resolution

**Tests:** `test/compute-engine/assumptions.test.ts` - "TYPE INFERENCE FROM
ASSUMPTIONS"

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

## Notes

### Related files for reference:

- Derivatives: `src/compute-engine/symbolic/derivative.ts`
- Integration: `src/compute-engine/symbolic/antiderivative.ts`
- Simplification: `src/compute-engine/symbolic/simplify-rules.ts`
- Pattern matching: `src/compute-engine/boxed-expression/match.ts`
- Rule application: `src/compute-engine/boxed-expression/rules.ts`
- Library definitions: `src/compute-engine/library/`
- Logic library: `src/compute-engine/library/logic.ts`
- Logic tests: `test/compute-engine/logic.test.ts`
- Logic guide: `doc/16-guide-logic.md`
- Logic reference: `doc/89-reference-logic.md`

### Testing commands:

```bash
npm run test                    # Run all tests
npm run test derivatives        # Run derivative tests
npm run test integration        # Run integration tests
npm run typecheck              # TypeScript type checking
```
