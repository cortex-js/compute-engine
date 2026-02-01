## [Unreleased]

### Improvements

- **Systems of Linear Equations**: The `solve()` method now handles systems of
  linear equations parsed from LaTeX `\begin{cases}...\end{cases}` environments.
  Returns an object mapping variable names to their solutions.

  ```javascript
  const e = ce.parse('\\begin{cases}x+y=70\\\\2x-4y=80\\end{cases}');
  const result = e.solve(['x', 'y']);
  console.log(result.x.json);  // 60
  console.log(result.y.json);  // 10

  // 3x3 systems work too
  const e2 = ce.parse('\\begin{cases}x+y+z=6\\\\2x+y-z=1\\\\x-y+2z=5\\end{cases}');
  const result2 = e2.solve(['x', 'y', 'z']);
  // → { x: 1, y: 2, z: 3 }
  ```

  Non-linear systems (containing `xy`, `x²`, etc.) and inconsistent systems
  return `null`.

- **Exact Rational Arithmetic in Linear Systems**: The linear system solver now
  uses exact rational arithmetic throughout the Gaussian elimination process.
  Systems with fractional coefficients produce exact fractional results rather
  than floating-point approximations.

  ```javascript
  const e = ce.parse('\\begin{cases}x+y=1\\\\x-y=1/2\\end{cases}');
  const result = e.solve(['x', 'y']);
  console.log(result.x.json);  // ["Rational", 3, 4]  (exact 3/4)
  console.log(result.y.json);  // ["Rational", 1, 4]  (exact 1/4)

  // Fractional coefficients
  const e2 = ce.parse('\\begin{cases}x/3+y/2=1\\\\x/4+y/5=1\\end{cases}');
  const result2 = e2.solve(['x', 'y']);
  // → { x: 36/7, y: -10/7 }
  ```

- **Extended Sqrt Equation Solving**: The equation solver now handles sqrt
  equations of the form `√(f(x)) = g(x)` by squaring both sides and solving
  the resulting polynomial. Extraneous roots are automatically filtered.

  ```javascript
  ce.parse('\\sqrt{x+1} = x').solve('x');      // → [1.618...] (golden ratio)
  ce.parse('\\sqrt{2x+3} = x - 1').solve('x'); // → [4.449...]
  ce.parse('\\sqrt{3x-2} = x').solve('x');     // → [1, 2]
  ce.parse('\\sqrt{x} = x').solve('x');        // → [0, 1]
  ```

- **Two Sqrt Equation Solving**: The equation solver now handles equations
  with two sqrt terms of the form `√(f(x)) + √(g(x)) = e` using double squaring.
  Both addition and subtraction forms are supported, and extraneous roots are
  automatically filtered.

  ```javascript
  ce.parse('\\sqrt{x+1} + \\sqrt{x+4} = 3').solve('x');  // → [0]
  ce.parse('\\sqrt{x} + \\sqrt{x+7} = 7').solve('x');    // → [9]
  ce.parse('\\sqrt{x+5} - \\sqrt{x-3} = 2').solve('x');  // → [4]
  ce.parse('\\sqrt{2x+1} + \\sqrt{x-1} = 4').solve('x'); // → [46 - 8√29] ≈ 2.919
  ```

- **Nested Sqrt Equation Solving**: The equation solver now handles nested
  sqrt equations of the form `√(x + √x) = a` using substitution. These patterns
  have √x inside the argument of an outer sqrt. The solver uses u = √x
  substitution, solves the resulting quadratic, and filters negative u values.

  ```javascript
  ce.parse('\\sqrt{x + 2\\sqrt{x}} = 3').solve('x');  // → [11 - 2√10] ≈ 4.675
  ce.parse('\\sqrt{x + \\sqrt{x}} = 2').solve('x');   // → [9/2 - √17/2] ≈ 2.438
  ce.parse('\\sqrt{x - \\sqrt{x}} = 1').solve('x');   // → [φ²] ≈ 2.618
  ```

- **Quadratic Equations Without Constant Term**: Added support for solving
  quadratic equations of the form `ax² + bx = 0` (missing constant term).
  These are solved by factoring: `x(ax + b) = 0` → `x = 0` or `x = -b/a`.

  ```javascript
  ce.parse('x^2 + 3x = 0').solve('x');  // → [0, -3]
  ce.parse('2x^2 - 4x = 0').solve('x'); // → [0, 2]
  ```

- **Value Resolution from Equality Assumptions**: When an equality assumption
  is made via `ce.assume(['Equal', symbol, value])`, the symbol now correctly
  evaluates to the assumed value. Previously, the symbol would remain unchanged
  even after the assumption.

  ```javascript
  ce.assume(ce.box(['Equal', 'one', 1]));
  ce.box('one').evaluate();               // → 1 (was: 'one')
  ce.box(['Equal', 'one', 1]).evaluate(); // → True (was: ['Equal', 'one', 1])
  ce.box(['Equal', 'one', 0]).evaluate(); // → False
  ce.box('one').type.matches('integer');  // → true
  ```

  This also fixes comparison evaluation: `Equal(symbol, assumed_value)` now
  correctly evaluates to `True` instead of staying symbolic.

- **Inequality Evaluation Using Assumptions**: When an inequality assumption
  is made (e.g., `ce.assume(['Greater', 'x', 4])`), inequality comparisons
  can now use transitive reasoning to determine results.

  ```javascript
  ce.assume(ce.box(['Greater', 'x', 4]));
  ce.box(['Greater', 'x', 0]).evaluate();  // → True (x > 4 > 0)
  ce.box(['Less', 'x', 0]).evaluate();     // → False
  ce.box('x').isGreater(0);                // → true
  ce.box('x').isPositive;                  // → true
  ```

  This works by extracting lower/upper bounds from inequality assumptions
  and using them during comparison operations.

- **Type Inference from Assumptions**: When assumptions are made, symbol types
  are now correctly inferred. Inequality assumptions (`>`, `<`, `>=`, `<=`) set
  the symbol's type to `real`, and equality assumptions infer the type from the
  value (e.g., equal to an integer means type `integer`).

  ```javascript
  ce.assume(ce.box(['Greater', 'x', 4]));
  ce.box('x').type.toString();  // → 'real' (was: 'unknown')

  ce.assume(ce.box(['Equal', 'one', 1]));
  ce.box('one').type.toString();  // → 'integer' (was: 'unknown')
  ```

- **Tautology and Contradiction Detection**: `ce.assume()` now returns
  `'tautology'` for redundant assumptions that are already implied by existing
  assumptions, and `'contradiction'` for assumptions that conflict with
  existing ones.

  ```javascript
  ce.assume(ce.box(['Greater', 'x', 4]));

  // Redundant assumption (x > 4 implies x > 0)
  ce.assume(ce.box(['Greater', 'x', 0]));  // → 'tautology' (was: 'ok')

  // Conflicting assumption (x > 4 contradicts x < 0)
  ce.assume(ce.box(['Less', 'x', 0]));     // → 'contradiction'

  // Same assumption repeated
  ce.assume(ce.box(['Equal', 'one', 1]));
  ce.assume(ce.box(['Equal', 'one', 1]));  // → 'tautology'

  // Conflicting equality
  ce.assume(ce.box(['Less', 'one', 0]));   // → 'contradiction'
  ```

### Bug Fixes

- **replace() No Longer Auto-Wildcards in Object Rules**: Fixed an issue where
  `.replace({match: 'a', replace: 2})` would incorrectly treat `'a'` as a
  wildcard, matching any expression instead of the literal symbol `a`. Now
  object rules use literal matching, while string rules (like `"a*x -> 2*x"`)
  continue to auto-wildcard as expected.

  ```javascript
  const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
  expr.replace({match: 'a', replace: 2}, {recursive: true});
  // → 2x + b (was: 2 - incorrectly matched entire expression)
  ```

- **forget() Now Clears Assumed Values**: Fixed an issue where `ce.forget()` did not
  clear values that were set by equality assumptions. After calling
  `ce.assume(['Equal', 'x', 5])` followed by `ce.forget('x')`, the symbol would
  incorrectly still evaluate to `5`. Now `forget()` properly clears values from
  all evaluation context frames.

  ```javascript
  ce.assume(ce.box(['Equal', 'x', 5]));
  ce.box('x').evaluate();  // → 5
  ce.forget('x');
  ce.box('x').evaluate();  // → 'x' (was: 5)
  ```

- **Scoped Assumptions Now Clean Up on popScope()**: Fixed an issue where
  assumptions made inside a nested scope would persist after `popScope()` was
  called. Values set by assumptions are now properly scoped to where the
  assumption was made, and are automatically removed when the scope exits.

  ```javascript
  ce.pushScope();
  ce.assume(ce.box(['Equal', 'y', 10]));
  ce.box('y').evaluate();  // → 10
  ce.popScope();
  ce.box('y').evaluate();  // → 'y' (was: 10)
  ```

- **Extraneous Root Filtering for Sqrt Equations**: Fixed an issue where solving
  square root equations could return extraneous roots. When solving equations
  like `√x = x - 2` or `√x - x + 2 = 0` using the quadratic substitution method
  (u = √x → solve for u → x = u²), the solver could return roots that satisfy
  the transformed equation but not the original. The `validateRoots()` function
  now correctly validates candidate solutions against the original expression
  before any algebraic transformations (clearing denominators, harmonization),
  properly filtering out extraneous roots.

  Examples of equations that now correctly filter extraneous roots:
  - `√x = x - 2` → returns `[4]` (filters out x=1)
  - `√x + x - 2 = 0` → returns `[1]` (filters out x=4)
  - `√x - x + 2 = 0` → returns `[4]` (filters out x=1)
  - `x - 2√x - 3 = 0` → returns `[9]` (filters out x=1)
  - `2x + 3√x - 2 = 0` → returns `[1/4]` (filters out x=4)

### Testing

- **Pattern Matching with Repeated Wildcards**: Added comprehensive tests
  verifying that the pattern matching system correctly handles wildcards that
  appear multiple times in a pattern. When a named wildcard like `_x` appears
  in multiple positions, the matcher correctly ensures all occurrences match
  the same expression. This works with:
  - Nested function arguments (e.g., `['Multiply', '_x', ['Ln', '_x']]`)
  - Multiple nesting levels (3+ levels deep)
  - Commutative operators (handles reordering)
  - Canonical expressions (from parsed LaTeX)
  - Complex sub-expressions (matching entire sub-trees)

### New Features

#### Subscripts and Indexing

- **Subscript Evaluation Handler**: Define custom evaluation functions for
  subscripted symbols like mathematical sequences using `subscriptEvaluate`:

  ```javascript
  // Define a Fibonacci sequence
  ce.declare('F', {
    subscriptEvaluate: (subscript, { engine }) => {
      const n = subscript.re;
      if (!Number.isInteger(n) || n < 0) return undefined;
      // Calculate Fibonacci number...
      return engine.number(fibValue);
    },
  });

  ce.parse('F_{10}').evaluate();  // → 55
  ce.parse('F_5').evaluate();     // → 5
  ce.parse('F_n').evaluate();     // → stays symbolic (handler returns undefined)
  ```

  Both simple subscripts (`F_5`) and complex subscripts (`F_{5}`) are supported.
  When the handler returns `undefined`, the expression stays symbolic. Subscripted
  expressions with `subscriptEvaluate` have type `number` and can be used in
  arithmetic operations: `ce.parse('F_{5} + F_{3}').evaluate()` works correctly.

- **Type-Aware Subscript Handling**: Subscripts on symbols declared as
  collection types (list, tuple, matrix, etc.) now automatically convert to
  `At()` indexing operations:

  ```javascript
  ce.declare('v', 'list<number>');
  ce.parse('v_n');      // → At(v, n)
  ce.parse('v_{n+1}');  // → At(v, n+1)
  ce.parse('v_{i,j}');  // → At(v, Tuple(i, j))
  ```

  This works for both simple subscripts (`v_n`) and complex subscripts
  (`v_{n+1}`). The type of the `At()` expression is correctly inferred from the
  collection's element type, allowing subscripted collection elements to be used
  in arithmetic.

- **Complex Subscripts in Arithmetic** (Issue #273): Subscript expressions like
  `a_{n+1}` can now be used in arithmetic operations without type errors:

  ```javascript
  ce.parse('a_{n+1} + 1');     // → Add(Subscript(a, n+1), 1)
  ce.parse('2 * a_{n+1}');     // → Multiply(2, Subscript(a, n+1))
  ce.parse('a_{n+1}^2');       // → Power(Subscript(a, n+1), 2)
  ```

  Previously, complex subscripts would fail with "incompatible-type" errors when
  used in arithmetic contexts.

- **Multi-Index `At()` Support**: The `At` function now supports multiple
  indices for accessing nested collections (e.g., matrices):

  ```javascript
  const matrix = ce.box(['List', ['List', 2, 3, 4], ['List', 6, 7, 9]]);
  ce.box(['At', matrix, 1, 2]).evaluate();  // → 3 (row 1, column 2)
  ```

  The signature was updated from single index to variadic:
  `(value: indexed_collection, index: (number|string)+) -> unknown`

- **Text Subscripts**: Added support for `\text{}` in subscripts, allowing
  descriptive subscript names:

  ```javascript
  ce.parse('x_{\\text{max}}');  // → symbol "x_max"
  ce.parse('v_{\\text{initial}}');  // → symbol "v_initial"
  ```

#### Sequences

- **Declarative Sequence Definitions**: Define mathematical sequences using
  recurrence relations with the new `declareSequence()` method:

  ```javascript
  // Fibonacci sequence
  ce.declareSequence('F', {
    base: { 0: 0, 1: 1 },
    recurrence: 'F_{n-1} + F_{n-2}',
  });
  ce.parse('F_{10}').evaluate();  // → 55
  ce.parse('F_{20}').evaluate();  // → 6765

  // Arithmetic sequence: a_n = a_{n-1} + 2, a_0 = 1
  ce.declareSequence('A', {
    base: { 0: 1 },
    recurrence: 'A_{n-1} + 2',
  });
  ce.parse('A_{5}').evaluate();  // → 11

  // Factorial via recurrence
  ce.declareSequence('H', {
    base: { 0: 1 },
    recurrence: 'n \\cdot H_{n-1}',
  });
  ce.parse('H_{5}').evaluate();  // → 120
  ```

  Features:
  - Base cases as index → value mapping
  - Recurrence relation as LaTeX string or BoxedExpression
  - Automatic memoization for efficient evaluation (configurable)
  - Custom index variable name (default: `n`)
  - Domain constraints (min/max valid indices)
  - Symbolic subscripts stay symbolic (e.g., `F_k` remains unevaluated)

  Alternatively, sequences can be defined using natural LaTeX assignment notation:

  ```javascript
  // Arithmetic sequence via LaTeX
  ce.parse('L_0 := 1').evaluate();
  ce.parse('L_n := L_{n-1} + 2').evaluate();
  ce.parse('L_{5}').evaluate();  // → 11

  // Fibonacci via LaTeX
  ce.parse('F_0 := 0').evaluate();
  ce.parse('F_1 := 1').evaluate();
  ce.parse('F_n := F_{n-1} + F_{n-2}').evaluate();
  ce.parse('F_{10}').evaluate();  // → 55
  ```

  Base cases and recurrence can be defined in any order. The sequence is
  finalized when both are present.

- **Sequence Status API**: Query the status of sequence definitions with
  `getSequenceStatus()`:

  ```javascript
  ce.parse('F_0 := 0').evaluate();
  ce.getSequenceStatus('F');
  // → { status: 'pending', hasBase: true, hasRecurrence: false, baseIndices: [0] }

  ce.parse('F_n := F_{n-1} + F_{n-2}').evaluate();
  ce.getSequenceStatus('F');
  // → { status: 'complete', hasBase: true, hasRecurrence: true, baseIndices: [0] }

  ce.getSequenceStatus('x');
  // → { status: 'not-a-sequence', hasBase: false, hasRecurrence: false }
  ```

- **Sequence Introspection API**: Inspect and manage defined sequences:

  ```javascript
  // Get sequence information
  ce.getSequence('F');
  // → { name: 'F', variable: 'n', baseIndices: [0, 1], memoize: true, cacheSize: 5 }

  // List all defined sequences
  ce.listSequences();  // → ['F', 'A', 'H']

  // Check if a symbol is a sequence
  ce.isSequence('F');  // → true
  ce.isSequence('x');  // → false

  // Manage memoization cache
  ce.getSequenceCache('F');  // → Map { 2 => 1, 3 => 2, ... }
  ce.clearSequenceCache('F');  // Clear cache for specific sequence
  ce.clearSequenceCache();     // Clear all sequence caches
  ```

- **Generate Sequence Terms**: Generate a list of sequence terms with
  `getSequenceTerms()`:

  ```javascript
  ce.declareSequence('F', {
    base: { 0: 0, 1: 1 },
    recurrence: 'F_{n-1} + F_{n-2}',
  });

  ce.getSequenceTerms('F', 0, 10);
  // → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]

  // With step parameter (every other term)
  ce.getSequenceTerms('F', 0, 10, 2);
  // → [0, 1, 3, 8, 21, 55]
  ```

- **Sum and Product over Sequences**: `Sum` and `Product` now work seamlessly
  with user-defined sequences:

  ```javascript
  ce.declareSequence('F', {
    base: { 0: 0, 1: 1 },
    recurrence: 'F_{n-1} + F_{n-2}',
  });

  ce.parse('\\sum_{k=0}^{10} F_k').evaluate();  // → 143
  ce.parse('\\prod_{k=1}^{5} A_k').evaluate();  // Works with any defined sequence
  ```

- **OEIS Integration**: Look up sequences in the Online Encyclopedia of Integer
  Sequences (OEIS) and verify your sequences against known mathematical sequences:

  ```javascript
  // Look up a sequence by its terms
  const results = await ce.lookupOEIS([0, 1, 1, 2, 3, 5, 8, 13]);
  // → [{ id: 'A000045', name: 'Fibonacci numbers', terms: [...], url: '...' }]

  // Check if your sequence matches a known OEIS sequence
  ce.declareSequence('F', {
    base: { 0: 0, 1: 1 },
    recurrence: 'F_{n-1} + F_{n-2}',
  });

  const result = await ce.checkSequenceOEIS('F', 10);
  // → { matches: [{ id: 'A000045', name: 'Fibonacci numbers', ... }], terms: [...] }
  ```

  Note: OEIS lookups require network access to oeis.org.

- **Multi-Index Sequences**: Define sequences with multiple indices like Pascal's
  triangle P_{n,k} or grid-based recurrences:

  ```javascript
  // Pascal's Triangle: P_{n,k} = P_{n-1,k-1} + P_{n-1,k}
  ce.declareSequence('P', {
    variables: ['n', 'k'],
    base: { 'n,0': 1, 'n,n': 1 },  // Pattern-based base cases
    recurrence: 'P_{n-1,k-1} + P_{n-1,k}',
    domain: { n: { min: 0 }, k: { min: 0 } },
    constraints: 'k <= n',  // k must not exceed n
  });

  ce.parse('P_{5,2}').evaluate();  // → 10
  ce.parse('P_{10,5}').evaluate(); // → 252
  ```

  Features:
  - Multiple index variables with `variables: ['n', 'k']`
  - Pattern-based base cases: `'n,0'` matches any (n, 0), `'n,n'` matches diagonal
  - Per-variable domain constraints
  - Constraint expressions (e.g., `'k <= n'`)
  - Composite key memoization (e.g., `'5,2'`)
  - Full introspection support with `isMultiIndex` flag

  Pattern matching for base cases:
  - Exact values: `'0,0'` matches only (0, 0)
  - Wildcards: `'n,0'` matches any value for n with k=0
  - Equality: `'n,n'` matches when both indices are equal
  - Priority: exact matches are checked before patterns

#### Special Functions

- **Special Function Definitions**: Added type signatures for special mathematical
  functions, enabling them to be used in expressions without type errors:
  - `Zeta` - Riemann zeta function ζ(s)
  - `Beta` - Euler beta function B(a,b) = Γ(a)Γ(b)/Γ(a+b)
  - `LambertW` - Lambert W function (product logarithm)
  - `BesselJ`, `BesselY`, `BesselI`, `BesselK` - Bessel functions of
    first/second kind
  - `AiryAi`, `AiryBi` - Airy functions

  These functions now have proper signatures and can be composed with other
  expressions: `ce.box(['Add', 1, ['LambertW', 'x']])` works correctly.

- **Special Function LaTeX Parsing**: Added LaTeX parsing support for special
  functions: `\zeta(s)`, `\Beta(a,b)`, `\operatorname{W}(x)`, Bessel functions
  via `\operatorname{J}`, `\operatorname{Y}`, etc., and Airy functions via
  `\operatorname{Ai}`, `\operatorname{Bi}`.

#### Calculus

- **LambertW Derivative**: Added derivative rule for the Lambert W function:
  `d/dx W(x) = W(x)/(x·(1+W(x)))`

- **Bessel Function Derivatives**: Added derivative support for all four Bessel
  function types using order-dependent recurrence relations:
  ```javascript
  ce.box(['D', ['BesselJ', 'n', 'x'], 'x']).evaluate();
  // → 1/2 * BesselJ(n-1, x) - 1/2 * BesselJ(n+1, x)

  ce.box(['D', ['BesselI', 'n', 'x'], 'x']).evaluate();
  // → 1/2 * BesselI(n-1, x) + 1/2 * BesselI(n+1, x)

  ce.box(['D', ['BesselK', 'n', 'x'], 'x']).evaluate();
  // → -1/2 * BesselK(n-1, x) - 1/2 * BesselK(n+1, x)
  ```
  Chain rule is automatically applied for composite arguments.

- **Multi-Argument Function Derivatives**: Added derivative support for:

  - **Log(x, base)** - Logarithm with custom base:
    ```javascript
    ce.box(['D', ['Log', 'x', 2], 'x']).evaluate();  // → 1/(x·ln(2))
    ce.box(['D', ['Log', 'x', 'a'], 'x']).evaluate(); // → 1/(x·ln(a))
    ```
    Also handles cases where both x and base depend on the variable by applying
    the quotient rule to ln(x)/ln(base).

  - **Discrete functions (Mod, GCD, LCM)** - Return 0 as these are step
    functions with derivative 0 almost everywhere:
    ```javascript
    ce.box(['D', ['Mod', 'x', 5], 'x']).evaluate();  // → 0
    ce.box(['D', ['GCD', 'x', 6], 'x']).evaluate();  // → 0
    ```

- **Integration of `1/(x·ln(x))` Pattern**: Added support for integrating
  expressions where the denominator is a product and one factor is the derivative
  of another:
  ```javascript
  ce.parse('\\int \\frac{1}{x\\ln x} dx').evaluate();  // → ln(|ln(x)|)
  ce.parse('\\int \\frac{3}{x\\ln x} dx').evaluate();  // → 3·ln(|ln(x)|)
  ```
  This uses u-substitution: since `1/x = d/dx(ln(x))`, the integral becomes
  `∫ h'(x)/h(x) dx = ln|h(x)|`.

- **Cyclic Integration for e^x with Trigonometric Functions**: Added support for
  integrating products of exponentials and trigonometric functions that require
  the "solve for the integral" technique:
  ```javascript
  ce.parse('\\int e^x \\sin x dx').evaluate();
  // → -1/2·cos(x)·e^x + 1/2·sin(x)·e^x

  ce.parse('\\int e^x \\cos x dx').evaluate();
  // → 1/2·sin(x)·e^x + 1/2·cos(x)·e^x

  // Also works with linear arguments:
  ce.parse('\\int e^x \\sin(2x) dx').evaluate();
  // → -2/5·cos(2x)·e^x + 1/5·sin(2x)·e^x

  ce.parse('\\int e^x \\cos(2x) dx').evaluate();
  // → 1/5·cos(2x)·e^x + 2/5·sin(2x)·e^x
  ```
  These patterns cannot be solved by standard integration by parts (which would
  lead to infinite recursion) and instead use direct formulas:
  - `∫ e^x·sin(ax+b) dx = (e^x/(a²+1))·(sin(ax+b) - a·cos(ax+b))`
  - `∫ e^x·cos(ax+b) dx = (e^x/(a²+1))·(a·sin(ax+b) + cos(ax+b))`

#### Logic

- **Boolean Simplification Rules**: Added absorption laws and improved boolean
  expression simplification:
  - **Absorption**: `A ∧ (A ∨ B) → A` and `A ∨ (A ∧ B) → A`
  - **Idempotence**: `A ∧ A → A` and `A ∨ A → A`
  - **Complementation**: `A ∧ ¬A → False` and `A ∨ ¬A → True`
  - **Identity**: `A ∧ True → A` and `A ∨ False → A`
  - **Domination**: `A ∧ False → False` and `A ∨ True → True`
  - **Double negation**: `¬¬A → A`

  These rules are applied automatically during simplification:
  ```javascript
  ce.box(['And', 'A', ['Or', 'A', 'B']]).simplify();  // → A
  ce.box(['Or', 'A', ['And', 'A', 'B']]).simplify();  // → A
  ```

- **Prime Implicants and Minimal Normal Forms**: Added Quine-McCluskey algorithm
  for finding prime implicants/implicates and computing minimal CNF/DNF:
  - `PrimeImplicants(expr)` - Find all prime implicants (minimal product terms)
  - `PrimeImplicates(expr)` - Find all prime implicates (minimal sum clauses)
  - `MinimalDNF(expr)` - Convert to minimal DNF using prime implicant cover
  - `MinimalCNF(expr)` - Convert to minimal CNF using prime implicate cover

  ```javascript
  // Find prime implicants (terms that can't be further simplified)
  ce.box(['PrimeImplicants', ['Or', ['And', 'A', 'B'], ['And', 'A', ['Not', 'B']]]]).evaluate();
  // → [A] (AB and A¬B combine to just A)

  // Compute minimal DNF
  ce.box(['MinimalDNF', ['Or',
    ['And', 'A', 'B'],
    ['And', 'A', ['Not', 'B']],
    ['And', ['Not', 'A'], 'B']
  ]]).evaluate();
  // → A ∨ B (simplified from 3 terms to 2)
  ```

  Limited to 12 variables to prevent exponential blowup; larger expressions
  return unevaluated.

#### Linear Algebra

- **Matrix Decompositions**: Added four matrix decomposition functions for
  numerical linear algebra:
  - `LUDecomposition(A)` → `[P, L, U]` - LU factorization with partial pivoting
  - `QRDecomposition(A)` → `[Q, R]` - QR factorization using Householder reflections
  - `CholeskyDecomposition(A)` → `L` - Cholesky factorization for positive definite matrices
  - `SVD(A)` → `[U, Σ, V]` - Singular Value Decomposition

  ```javascript
  ce.box(['LUDecomposition', [[4, 3], [6, 3]]]).evaluate();
  // → [P, L, U] where PA = LU

  ce.box(['QRDecomposition', [[1, 2], [3, 4]]]).evaluate();
  // → [Q, R] where A = QR, Q orthogonal, R upper triangular

  ce.box(['CholeskyDecomposition', [[4, 2], [2, 2]]]).evaluate();
  // → L where A = LL^T

  ce.box(['SVD', [[1, 2], [3, 4]]]).evaluate();
  // → [U, Σ, V] where A = UΣV^T
  ```

#### Simplification

- **Assumption-Based Simplification**: Simplification rules now correctly use
  assumptions about symbol signs. For example:

  ```javascript
  ce.assume(ce.parse('x > 0'));
  ce.parse('\\sqrt{x^2}').simplify().latex;  // → "x" (was "|x|")
  ce.parse('|x|').simplify().latex;          // → "x" (was "|x|")

  ce.assume(ce.parse('y < 0'));
  ce.parse('\\sqrt{y^2}').simplify().latex;  // → "-y"
  ce.parse('|y|').simplify().latex;          // → "-y"
  ```

  This enables important mathematical simplifications that depend on knowing
  whether a variable is positive, negative, or zero.

### Improvements

#### Simplification

- **Nested Root Simplification**: Nested roots now simplify to a single root:
  ```javascript
  ce.box(['Sqrt', ['Sqrt', 'x']]).simplify()     // → root(4)(x)
  ce.box(['Root', ['Root', 'x', 3], 2]).simplify() // → root(6)(x)
  ce.box(['Sqrt', ['Root', 'x', 3]]).simplify()  // → root(6)(x)
  ```
  This applies to all combinations: `sqrt(sqrt(x))`, `root(sqrt(x), n)`,
  `sqrt(root(x, n))`, and `root(root(x, m), n)`.

#### Calculus

- **Derivative Recursion Safety**: Added robust recursion protection to the
  `differentiate()` function with a depth limit (`MAX_DIFFERENTIATION_DEPTH`) to
  guard against pathological expressions. All recursive calls now track depth
  and gracefully return `undefined` if the limit is exceeded.

### Bug Fixes

- **Equation Equivalence in `isEqual()`** (Issue #275): Two equations are now
  correctly recognized as equivalent if they have the same solution set:

  ```javascript
  ce.parse('2x+1=0').isEqual(ce.parse('x=-1/2'));   // → true
  ce.parse('3x+1=0').isEqual(ce.parse('6x+2=0'));   // → true
  ```

  The implementation uses a sampling-based approach to check if the ratio of
  (LHS₁-RHS₁) to (LHS₂-RHS₂) is a non-zero constant, which indicates equivalent
  solution sets.

## 0.33.0 _2026-01-30_

### Bug Fixes

#### Arithmetic and Infinity

- **Division by Zero**: Improved handling of division by zero:
  - `0/0` returns `NaN` (indeterminate form)
  - `a/0` where `a ≠ 0` returns `ComplexInfinity` (~∞) as a "better NaN" that
    indicates an infinite result with unknown sign
  - This applies to all forms including `1/0`, `x/0`, and rational literals

- **Infinity Sign Propagation**: Fixed infinity multiplication not propagating
  signs correctly. Now `∞ * (-2) = -∞` and `-∞ * 2 = -∞` as expected.

- **Infinity Division**: Fixed `∞/∞` incorrectly returning `1`. Now correctly
  returns `NaN` (indeterminate form). The `a/a → 1` simplification rule now
  excludes infinity values.

#### Trigonometry

- **Trigonometric Period Identities**: Fixed incorrect sign handling for
  `csc(π+x)` and `cot(π+x)`:
  - `csc(π+x)` now correctly simplifies to `-csc(x)` (was incorrectly `csc(x)`)
  - `cot(π+x)` now correctly simplifies to `cot(x)` (was incorrectly `-cot(x)`,
    cotangent has period π)

- **Trigonometric Co-function Identities**: Fixed co-function identities not
  applying to canonical form expressions. Now correctly simplifies:
  - `sin(π/2 - x)` → `cos(x)`
  - `cos(π/2 - x)` → `sin(x)`
  - `tan(π/2 - x)` → `cot(x)`
  - `cot(π/2 - x)` → `tan(x)`
  - `sec(π/2 - x)` → `csc(x)`
  - `csc(π/2 - x)` → `sec(x)`

- **Double Angle with Coefficient**: Fixed `2sin(x)cos(x)` not simplifying to
  `sin(2x)`. The product-to-sum identity now handles coefficients:
  - `2sin(x)cos(x)` → `sin(2x)`
  - `c·sin(x)cos(x)` → `c·sin(2x)/2` for any coefficient `c`

- **Trigonometric Product Identities**: Improved handling of trig products in
  simplification. The Multiply rule now correctly defers to trig-specific rules
  for patterns like `sin(x)*cos(x)` and `tan(x)*cot(x)`, ensuring these are
  simplified to `sin(2x)/2` and `1` respectively.

#### Logarithms and Exponentials

- **Logarithm-Exponential Composition**: Fixed `log(exp(x))` incorrectly
  simplifying to `x`. Now correctly returns `x/ln(10)` ≈ `0.434x` since
  `log₁₀(eˣ) = x·log₁₀(e) = x/ln(10)`. The identity `log(exp(x)) = x` only holds
  for natural logarithm.

- **Logarithm of e**: Added simplification for `log(e)` → `1/ln(10)` ≈ `0.434`
  and `log_c(e)` → `1/ln(c)` for any base `c`.

- **Logarithm Combination Base Preservation**: Fixed `log(x) + log(y)` (base 10)
  incorrectly becoming `ln(xy)`. Now correctly produces `log(xy)` preserving the
  original base.

- **Logarithm Quotient Rule**: Added expansion rule for logarithm of quotients.
  `ln(x/y)` now simplifies to `ln(x) - ln(y)` when x and y are known positive.
  Similarly for any base: `log_c(x/y)` → `log_c(x) - log_c(y)`.

- **Exponential-Logarithm Composition**: Added simplification for `exp(log(x))`
  where log has a different base than e. Now `e^log(x)` → `x^{1/ln(10)}` and
  more generally `e^log_c(x)` → `x^{1/ln(c)}` for any base c.

#### Powers and Exponents

- **Zero Power with Symbolic Exponent**: Fixed `0^π` and similar expressions
  with positive symbolic exponents not simplifying. Now `0^x` → `0` when `x` is
  known to be positive (including `π`, `e`, etc.).

- **Exponent Evaluation in Products**: Fixed `(x³)² · (y²)²` not simplifying to
  `x⁶y⁴`. Numeric subexpressions in exponents (like `2×3` in `x^{2×3}`) are now
  evaluated when the expression is part of a product.

- **Negative Exponents on Fractions**: Fixed `(a/b)^{-n}` not simplifying
  properly. Now `(x³/y²)^{-2}` correctly simplifies to `y⁴/x⁶` during
  canonicalization by distributing the negative exponent.

- **Negative Base with Fractional Exponent**: Fixed `(-ax)^{p/q}` returning
  complex results when `p` and `q` are both odd. Now correctly factors out the
  negative sign: `(-2x)^{3/5}` → `-(2x)^{3/5}` = `-2^{3/5}·x^{3/5}`, giving real
  results. This affects products like `(-2x)^{3/5}·x` which now correctly
  simplify to `-2^{3/5}·x^{8/5}` instead of returning an imaginary value.

#### Radicals

- **Radical Perfect Square Factoring**: Fixed `√(x²y)` not simplifying to
  `|x|√y`. Adjusted cost function to penalize radicals containing perfect
  squares, enabling the simplification rule to apply.

- **Generalized Root Extraction**: Added comprehensive root simplification
  rules:
  - `√[n]{x^m}` → `x^{m/n}` for odd roots (always valid)
  - `√[n]{x^m}` → `|x|^{m/n}` for even roots with integer result
  - `√{x^{odd}}` → `|x|^n · √x` factoring (e.g., `√{x⁵}` → `|x|²√x`)
  - Handles all combinations: `√[4]{x⁶}` → `|x|^{3/2}`, `√[3]{x⁶}` → `x²`

- **Symbolic Radicals Preservation**: Fixed numeric radicals (`√2`, `∛5`,
  `2^{3/5}`) being evaluated to floating-point approximations during
  multiplication. Now `x * √2` stays as `√2 · x` instead of `1.414... · x`, and
  `x * 2^{1/3}` stays as `x · ∛2` instead of `1.259... · x`. This preserves
  exact irrational values and allows proper algebraic manipulation. Use `.N()`
  to get numeric approximations when needed.

#### LaTeX Parsing

- **LaTeX `\exp()` Juxtaposition**: Fixed adjacent `\exp()` calls not parsing as
  multiplication. Now `\exp(x)\exp(2)` correctly parses as `e^x · e^2` instead
  of producing a parse error. The expression then simplifies to `e^{x+2}` as
  expected.

### Features

#### Trigonometry

- **Fu Algorithm for Trigonometric Simplification**: Implemented the Fu
  algorithm based on Fu, Zhong, and Zeng's paper "Automated and readable
  simplification of trigonometric expressions" (2006). This provides systematic,
  high-quality trigonometric simplification through:
  - **Transformation Rules (TR1-TR22)**: Comprehensive set of rewrite rules
    including reciprocal conversions (sec→1/cos), ratio forms (tan→sin/cos),
    Pythagorean substitutions (sin²+cos²=1), power reductions, product-to-sum,
    sum-to-product, angle expansion/contraction, and Morrie's law for cosine
    product chains.

  - **Rule Lists (RL1, RL2)**: Organized application sequences for tan/cot
    expressions and sin/cos expressions respectively, with greedy selection of
    optimal results.

  - **Cost Function**: Minimizes trigonometric function count as primary metric,
    with leaf count as secondary, to find the most readable form.

  **Usage**:

  ```typescript
  // Option 1: Use strategy option with simplify()
  const result = expr.simplify({ strategy: 'fu' });

  // Option 2: Dedicated trigSimplify() method
  const result = expr.trigSimplify();
  ```

  **Examples**:
  - `sin(x)⁴ - cos(x)⁴` → `-cos(2x)`
  - `tan(x)·cot(x)` → `1`
  - `sin²(x) + cos²(x)` → `1`
  - `2sin(x)cos(x)` → `sin(2x)`
  - `cos(x)·cos(2x)·cos(4x)` → `sin(8x)/(8sin(x))` (Morrie's law)

  **Enhanced Transformations**:
  - **TRmorrie with Rational Coefficients**: Morrie's law now handles angles
    that are rational multiples of π, such as `cos(π/9)·cos(2π/9)·cos(4π/9)` →
    `1/8`. The algorithm detects maximal geometric sequences and handles cases
    where the sine terms cancel to produce pure fractions.

  - **TR12i Tangent Sum Identity**: Recognizes the pattern
    `tan(A) + tan(B) - k·tan(A)·tan(B)` and simplifies to `-tan(C)` when
    `A + B + C = π` and `k = tan(C)`. Works with standard angles (π/6, π/4, π/3,
    etc.) and handles sign variations.

  - **TRpythagorean for Compound Expressions**: Detects `sin²(x) + cos²(x)`
    pairs within larger Add expressions and simplifies them to 1, e.g.,
    `sin²(x) + cos²(x) + 2` → `3`.

  - **Early TR9 Sum-to-Product**: Applies sum-to-product transformation before
    angle expansion to catch patterns like `sin(x+h) + sin(x-h)` →
    `2sin(x)cos(h)` that would otherwise be expanded and lose their simplified
    form.

  - **Dual Strategy Approach**: The Fu strategy now tries both "Fu first" and
    "simplify first" approaches and picks the best result. This handles both
    Morrie-like patterns (which need Fu before evaluation) and period reduction
    patterns (which need simplification first for angle contraction).

- **Trigonometric Periodicity Reduction**: Trigonometric functions now simplify
  arguments containing integer multiples of π:
  - `sin(5π + k)` → `-sin(k)` (period 2π, with sign change for odd multiples)
  - `cos(4π + k)` → `cos(k)` (period 2π)
  - `tan(3π + k)` → `tan(k)` (period π)
  - Works for all six trig functions: sin, cos, tan, cot, sec, csc
  - Handles both positive and negative multiples of π

- **Pythagorean Trigonometric Identities**: Added simplification rules for all
  Pythagorean identities:
  - `sin²(x) + cos²(x)` → `1`
  - `1 - sin²(x)` → `cos²(x)` and `1 - cos²(x)` → `sin²(x)`
  - `sin²(x) - 1` → `-cos²(x)` and `cos²(x) - 1` → `-sin²(x)`
  - `tan²(x) + 1` → `sec²(x)` and `sec²(x) - 1` → `tan²(x)`
  - `1 + cot²(x)` → `csc²(x)` and `csc²(x) - 1` → `cot²(x)`
  - `a·sin²(x) + a·cos²(x)` → `a` (with coefficient)

- **Trigonometric Equation Solving**: The `solve()` method now handles basic
  trigonometric equations:
  - `sin(x) = a` → `x = arcsin(a)` and `x = π - arcsin(a)` (two solutions)
  - `cos(x) = a` → `x = arccos(a)` and `x = -arccos(a)` (two solutions)
  - `tan(x) = a` → `x = arctan(a)` (one solution per period)
  - `cot(x) = a` → `x = arccot(a)`
  - Supports coefficient form: `a·sin(x) + b = 0`
  - Domain validation: returns no solutions when |a| > 1 for sin/cos
  - Automatic deduplication of equivalent solutions (e.g., `cos(x) = 1` → single
    solution `0`)

#### Calculus

- **([#163](https://github.com/cortex-js/compute-engine/issues/163)) Additional
  Derivative Notations**: Added support for parsing multiple derivative
  notations beyond Leibniz notation:
  - **Newton's dot notation** for time derivatives: `\dot{x}` →
    `["D", "x", "t"]`, `\ddot{x}` for second derivative, `\dddot{x}` and
    `\ddddot{x}` for higher orders. The time variable is configurable via the
    new `timeDerivativeVariable` parser option (default: `"t"`).

  - **Lagrange prime notation with arguments**: `f'(x)` now parses to
    `["D", ["f", "x"], "x"]`, inferring the differentiation variable from the
    function argument. Works for `f''(x)`, `f'''(x)`, etc. for higher
    derivatives.

  - **Euler's subscript notation**: `D_x f` → `["D", "f", "x"]` and `D^2_x f` or
    `D_x^2 f` for second derivatives.

  - **Derivative serialization**: `D` expressions now serialize to Leibniz
    notation (`\frac{\mathrm{d}}{\mathrm{d}x}f`) for consistent round-trip
    parsing.

- **Derivative Rules for Special Functions**: Added derivative formulas for:
  - `d/dx Digamma(x) = Trigamma(x)`
  - `d/dx Erf(x)`, `d/dx Erfc(x)`, `d/dx Erfi(x)`
  - `d/dx FresnelS(x)`, `d/dx FresnelC(x)`
  - `d/dx LogGamma(x) = Digamma(x)`

#### Special Functions

- **Special Function Definitions**: Added type signatures for Digamma, Trigamma,
  and PolyGamma functions to the library:
  - `Digamma(x)` - The digamma function ψ(x), logarithmic derivative of Gamma
  - `Trigamma(x)` - The trigamma function ψ₁(x), derivative of digamma
  - `PolyGamma(n, x)` - The polygamma function ψₙ(x), nth derivative of digamma

#### Logarithms and Exponentials

- **Logarithm Combination Rules**: Added simplification rules that combine
  logarithms with the same base:
  - `ln(x) + ln(y)` → `ln(xy)` (addition combines via multiplication)
  - `ln(x) - ln(y)` → `ln(x/y)` (subtraction combines via division)
  - `log_c(x) + log_c(y)` → `log_c(xy)` (works with any base)
  - `log_c(x) - log_c(y)` → `log_c(x/y)`
  - Handles multiple terms: `ln(a) + ln(b) - ln(c)` → `ln(ab/c)`

- **Exponential e Simplification**: Added rules for combining powers of e:
  - `eˣ · eʸ` → `e^(x+y)` (same-base multiplication)
  - `eˣ / eʸ` → `e^(x-y)` (same-base division)
  - `eˣ · e` → `e^(x+1)` and `eˣ / e` → `e^(x-1)`
  - Preserves symbolic form instead of evaluating e^n numerically

#### Powers and Exponents

- **Negative Base Power Simplification**: Added rules to simplify powers with
  negated bases:
  - `(-x)^n` → `x^n` when n is even (e.g., `(-x)^4` → `x^4`)
  - `(-x)^n` → `-x^n` when n is odd (e.g., `(-x)^3` → `-x^3`)
  - `(-x)^{n/m}` → `x^{n/m}` when n is even and m is odd
  - `(-x)^{n/m}` → `-x^{n/m}` when both n and m are odd
  - `(-1)^{p/q}` → `-1` when both p and q are odd (real odd root)

- **Power Distribution**: Added rule to distribute integer exponents over
  products:
  - `(ab)^n` → `a^n · b^n` when n is an integer
  - Example: `(x³y²)²` → `x⁶y⁴`
  - Example: `(-2x)²` → `4x²`

- **Same-Base Power Combination**: Improved power combination for products with
  3+ terms:
  - `a³ · a · a²` → `a⁶` (combines all same-base terms)
  - Works with unknown symbols when sum of exponents is positive
  - Handles mixed products: `b³c²dx⁷ya⁵gb²x⁵(3b)` → `3dgyx¹²b⁶a⁵c²`

#### Sum and Product

- **([#133](https://github.com/cortex-js/compute-engine/issues/133))
  Element-based Indexing Sets for Sum/Product**: Added support for `\in`
  notation in summation and product subscripts:
  - **Parsing**: `\sum_{n \in \{1,2,3\}} n` now correctly parses to
    `["Sum", "n", ["Element", "n", ["Set", 1, 2, 3]]]` instead of silently
    dropping the constraint.

  - **Evaluation**: Sums and products over finite sets, lists, and ranges are
    now evaluated correctly:
    - `\sum_{n \in \{1,2,3\}} n` → `6`
    - `\sum_{n \in \{1,2,3\}} n^2` → `14`
    - `\prod_{k \in \{1,2,3,4\}} k` → `24`

  - **Serialization**: Element-based indexing sets serialize back to LaTeX with
    proper `\in` notation: `\sum_{n\in \{1, 2, 3\}}n`

  - **Range support**: Works with `Range` expressions via `ce.box()`:
    `["Sum", "n", ["Element", "n", ["Range", 1, 5]]]` → `15`

  - **Bracket notation as Range**: Two-element integer lists in bracket notation
    `[a,b]` are now treated as Range(a,b) when used in Element context:
    - `\sum_{n \in [1,5]} n` → `15` (iterates 1, 2, 3, 4, 5)
    - Previously returned `6` (treated as List with just elements 1 and 5)

  - **Interval support**: `Interval` expressions work with Element-based
    indexing, including support for `Open` and `Closed` boundary markers:
    - `["Interval", 1, 5]` → iterates integers 1, 2, 3, 4, 5 (closed bounds)
    - `["Interval", ["Open", 0], 5]` → iterates 1, 2, 3, 4, 5 (excludes 0)
    - `["Interval", 1, ["Open", 6]]` → iterates 1, 2, 3, 4, 5 (excludes 6)

  - **Infinite series with Element notation**: Known infinite integer sets are
    converted to their equivalent Limits form and iterated (capped at
    1,000,000):
    - `NonNegativeIntegers` (ℕ₀) → iterates from 0, like `\sum_{n=0}^{\infty}`
    - `PositiveIntegers` (ℤ⁺) → iterates from 1, like `\sum_{n=1}^{\infty}`
    - Convergent series produce numeric approximations:
      `\sum_{n \in \Z^+} \frac{1}{n^2}` → `≈1.6449` (close to π²/6)

  - **Non-enumerable domains stay symbolic**: When the domain cannot be
    enumerated (unknown symbol, non-iterable infinite set, or symbolic bounds),
    the expression stays symbolic instead of returning NaN:
    - `\sum_{n \in S} n` with unknown `S` → stays as
      `["Sum", "n", ["Element", "n", "S"]]`
    - `\sum_{n \in \Z} n` → stays symbolic (bidirectional, can't forward
      iterate)
    - `\sum_{x \in \R} f(x)` → stays symbolic (non-countable)
    - `\sum_{n \in [1,a]} n` with symbolic bound → stays symbolic
    - Previously these would all return `NaN` with no explanation

  - **Multiple Element indexing sets**: Comma-separated Element expressions now
    parse and evaluate correctly:
    - `\sum_{n \in A, m \in B} (n+m)` →
      `["Sum", ..., ["Element", "n", "A"], ["Element", "m", "B"]]`
    - Nested sums like `\sum_{i \in A}\sum_{j \in B} i \cdot j` evaluate
      correctly
    - Mixed indexing sets (Element + Limits) work together

  - **Condition/filter support in Element expressions**: Conditions can be
    attached to Element expressions to filter values from the set:
    - `\sum_{n \in S, n > 0} n` → sums only positive values from S
    - `\sum_{n \in S, n \ge 2} n` → sums values ≥ 2 from S
    - `\prod_{k \in S, k < 0} k` → multiplies only negative values from S
    - Supported operators: `>`, `>=`, `<`, `<=`, `!=`
    - Conditions are attached as the 4th operand of Element:
      `["Element", "n", "S", ["Greater", "n", 0]]`

#### Linear Algebra

- **Matrix Multiplication**: Added `MatrixMultiply` function supporting:
  - Matrix × Matrix: `A (m×n) × B (n×p) → result (m×p)`
  - Matrix × Vector: `A (m×n) × v (n) → result (m)`
  - Vector × Matrix: `v (m) × B (m×n) → result (n)`
  - Vector × Vector (dot product): `v1 (n) · v2 (n) → scalar`
  - Proper dimension validation with `incompatible-dimensions` errors
  - LaTeX serialization using `\cdot` notation

- **Matrix Addition and Scalar Broadcasting**: `Add` now supports element-wise
  operations on tensors (matrices and vectors):
  - Matrix + Matrix: Element-wise addition (shapes must match)
  - Scalar + Matrix: Broadcasts scalar to all elements
  - Vector + Vector: Element-wise addition
  - Scalar + Vector: Broadcasts scalar to all elements
  - Symbolic support: `[[a,b],[c,d]] + [[1,2],[3,4]]` evaluates correctly
  - Proper dimension validation with `incompatible-dimensions` errors

- **Matrix Construction Functions**: Added convenience functions for creating
  common matrices:
  - `IdentityMatrix(n)`: Creates an n×n identity matrix
  - `ZeroMatrix(m, n?)`: Creates an m×n matrix of zeros (square if n omitted)
  - `OnesMatrix(m, n?)`: Creates an m×n matrix of ones (square if n omitted)

- **Matrix and Vector Norms**: Added `Norm` function for computing various
  norms:
  - **Vector norms**: L1 (sum of absolute values), L2 (Euclidean, default),
    L-infinity (max absolute value), and general Lp norms
  - **Matrix norms**: Frobenius (default, sqrt of sum of squared elements), L1
    (max column sum), L-infinity (max row sum)
  - Scalar norms return the absolute value

- **Eigenvalues and Eigenvectors**: Added functions for eigenvalue
  decomposition:
  - `Eigenvalues(matrix)`: Returns list of eigenvalues (2×2: symbolic via
    characteristic polynomial; 3×3: Cardano's formula; larger: numeric QR)
  - `Eigenvectors(matrix)`: Returns list of corresponding eigenvectors using
    null space computation via Gaussian elimination
  - `Eigen(matrix)`: Returns tuple of (eigenvalues, eigenvectors)

- **Diagonal Function**: Now fully implemented with bidirectional behavior:
  - Vector → Matrix: Creates a diagonal matrix from a vector
    (`Diagonal([1,2,3])` → 3×3 diagonal matrix)
  - Matrix → Vector: Extracts the diagonal as a vector
    (`Diagonal([[1,2],[3,4]])` → `[1,4]`)

- **Higher-Rank Tensor Operations**: Extended `Transpose`, `ConjugateTranspose`,
  and `Trace` to work with rank > 2 tensors:
  - **Transpose**: Swaps last two axes by default (batch transpose), or specify
    explicit axes with `['Transpose', T, axis1, axis2]`
  - **ConjugateTranspose**: Same axis behavior as Transpose, plus element-wise
    complex conjugation
  - **Trace (batch trace)**: Returns a tensor of traces over the last two axes.
    For a `[2,2,2]` tensor, returns `[trace of T[0], trace of T[1]]`. Optional
    axis parameters: `['Trace', T, axis1, axis2]`

- **Reshape Cycling**: Implements APL-style ravel cycling. When reshaping to a
  larger shape, elements cycle from the beginning: `Reshape([1,2,3], (2,2))` →
  `[[1,2],[3,1]]`

- **Scalar Handling**: Most linear algebra functions now handle scalar inputs:
  - `Flatten(42)` → `[42]` (single-element list)
  - `Transpose(42)` → `42` (identity)
  - `Determinant(42)` → `42` (1×1 matrix determinant)
  - `Trace(42)` → `42` (1×1 matrix trace)
  - `Inverse(42)` → `1/42` (scalar reciprocal)
  - `ConjugateTranspose(42)` → `42` (conjugate of real is itself)
  - `Reshape(42, (2,2))` → `[[42,42],[42,42]]` (scalar replication)

- **Improved Error Messages**: Operations requiring square matrices
  (`Determinant`, `Trace`, `Inverse`) now return `expected-square-matrix` error
  for vectors and tensors (rank > 2).

### Performance

- **Pattern Matching Optimization**: Significantly improved performance of
  commutative pattern matching by adding early rejection guards:
  - **Arity Guard**: Patterns without sequence wildcards (`__`/`___`) now
    immediately reject expressions with mismatched operand counts instead of
    attempting factorial permutations
  - **Anchor Fingerprint**: Patterns with literal or symbolic anchors verify
    anchor presence before attempting permutation matching, eliminating
    impossible matches in O(n) time
  - **Universal Anchoring**: Extended the efficient anchor-based backtracking
    algorithm to all patterns with anchors, not just those with sequence
    wildcards
  - **Hash Bucketing**: For patterns with many anchors (4+) against large
    expressions (6+ operands), uses hash-based indexing to reduce anchor lookup
    from O(n×m) to O(n+m) average case
  - Example: Matching `a + b + c + 1` against `x + y + z` now rejects
    immediately (arity mismatch: 4 vs 3) instead of trying 24 permutations

### Bug Fixes

#### Arithmetic

- **Indeterminate Form Handling**: Fixed incorrect results for mathematical
  indeterminate forms:
  - `0 * ∞` now correctly returns `NaN` (previously returned `∞`)
  - `∞ / ∞` now correctly returns `NaN` (previously returned `1`)
  - `∞^0` now correctly returns `NaN` (was already correct)
  - All combinations (`0 * (-∞)`, `(-∞) / ∞`, etc.) are handled correctly

- **([#176](https://github.com/cortex-js/compute-engine/issues/176)) Power
  Combination Simplification**: Fixed simplification failing to combine powers
  with the same base when one factor has an implicit exponent or when there are
  3+ operands. Previously, expressions like `2 * 2^x`, `e * e^x * e^{-x}`, and
  `x^2 * x` would not simplify. Now correctly simplifies to `2^(x+1)`, `e`, and
  `x^3` respectively. The fix includes:
  - Extended power combination rules to support numeric literal bases
  - Added functional rule to handle n-ary Multiply expressions (3+ operands)
  - Adjusted simplification cost threshold from 1.2 to 1.3 to accept
    mathematically valid simplifications where exponents become slightly more
    complex (e.g., `2 * 2^x → 2^(x+1)`)

- **Symbolic Factorial**: Fixed `(n-1)!` incorrectly evaluating to `NaN` instead
  of staying symbolic. The factorial `evaluate` function was attempting numeric
  computation on symbolic arguments. Now correctly returns `undefined` (keeping
  the expression symbolic) when the argument is not a number literal.

#### Linear Algebra

- **Matrix Operations Type Validation**: Fixed matrix operations (`Shape`,
  `Rank`, `Flatten`, `Transpose`, `Determinant`, `Inverse`, `Trace`, etc.)
  returning incorrect results or failing with type errors. The root cause was a
  type mismatch: function signatures expected `matrix` type (a 2D list with
  dimensions), but `BoxedTensor.type` returned `list<number>` without
  dimensions. Now `BoxedTensor`, `BoxedFunction`, and `BoxedSymbol` correctly
  derive `shape` and `rank` from their type's dimensions. Additionally, linear
  algebra functions now properly evaluate their operands before checking if they
  are tensors.

#### Calculus

- **Numerical Integration**: Fixed `\int_0^1 \sin(x) dx` returning `NaN` when
  evaluated numerically with `.N()`. The integrand was already wrapped in a
  `Function` expression by the canonical form, but the numerical evaluation code
  was wrapping it again, creating a nested function that returned a function
  instead of a number. Now correctly checks if the integrand is already a
  `Function` before wrapping.

#### LaTeX Parsing and Serialization

- **Subscript Function Calls**: Fixed parsing of function calls with subscripted
  names like `f_\text{a}(5)`. Previously, this was incorrectly parsed as a
  `Tuple` instead of a function call because `Subscript` expressions weren't
  being canonicalized before the function call check. Now correctly recognizes
  that `f_a(5)` is a function call when the subscript canonicalizes to a symbol.

- **([#130](https://github.com/cortex-js/compute-engine/issues/130))
  Prefix/Postfix Operator LaTeX Serialization**: Fixed incorrect LaTeX output
  for prefix operators (like `Negate`) and postfix operators (like `Factorial`)
  when applied to expressions with lower precedence. Previously,
  `Negate(Add(a, b))` incorrectly serialized as `-a+b` instead of `-(a+b)`,
  causing round-trip failures where parsing the output produced a mathematically
  different expression. Similarly, `Factorial(Add(a, b))` now correctly
  serializes as `(a+b)!` instead of `a+b!`. The fix ensures operands are wrapped
  in parentheses when their precedence is lower than the operator's precedence.

- **([#156](https://github.com/cortex-js/compute-engine/issues/156)) Logical
  Operator Precedence**: Fixed parsing of logical operators `\vee` (Or) and
  `\wedge` (And) with relational operators. Previously, expressions like
  `3=4\vee 7=8` were incorrectly parsed with the wrong precedence. Now correctly
  parses as `["Or", ["Equal", 3, 4], ["Equal", 7, 8]]`. Logical operators have
  lower precedence (230-235) than comparison operators (245) and set relations
  (240), so compound propositions parse correctly without requiring parentheses.

- **([#156](https://github.com/cortex-js/compute-engine/issues/156)) Logical
  Connective Arrows**: Added support for additional arrow notation in logical
  expressions:
  - `\rightarrow` now parses as `Implies` (previously parsed as `To` for
    set/function mapping)
  - `\leftrightarrow` now parses as `Equivalent` (previously produced an
    "unexpected-command" error)
  - Long arrow variants now supported: `\Longrightarrow`, `\longrightarrow` →
    `Implies`; `\Longleftrightarrow`, `\longleftrightarrow` → `Equivalent`
  - The existing variants `\Rightarrow`, `\Leftrightarrow`, `\implies`, `\iff`
    continue to work
  - `\to` remains available for function/set mapping notation (e.g.,
    `f: A \to B`)

#### Simplification

- **Rules Cache Isolation**: Fixed rules cache building failing with "Invalid
  rule" errors when user expressions had previously polluted the global scope.
  For example, parsing `x(y+z)` would add `x` as a symbol with function type to
  the global scope. Later, when the simplification rules cache was built, rule
  parsing would fail because wildcards like `_x` in rules would be type-checked
  against the polluted scope where `x` had incompatible type. The fix ensures
  rule parsing uses a clean scope that inherits only from the system scope
  (containing built-in definitions), not from user-polluted scopes.

- **Simplification Rules**: Added and fixed several simplification rules:
  - `x + x` now correctly simplifies to `2x` (term combination)
  - `e^x * e^{-x}` now correctly simplifies to `1` (exponential inverse)
  - `sin(∞)` and `cos(∞)` now correctly evaluate to `NaN`
  - `tanh(∞)` now correctly evaluates to `1`, `tanh(-∞)` to `-1`
  - `log_b(x^n)` now correctly simplifies to `n * log_b(x)` (log power rule)
  - Improved cost function to prefer `n * ln(x)` form over `ln(x^n)`
  - Trigonometric functions now reduce arguments by their period (e.g.,
    `cos(5π + k)` simplifies using `cos(π + k) = -cos(k)`)

- **([#178](https://github.com/cortex-js/compute-engine/issues/178))
  Non-Canonical Expression Simplification**: Fixed `.simplify()` not working on
  expressions parsed with `{ canonical: false }`. Previously,
  `ce.parse('x+x', { canonical: false }).simplify()` would return `x+x` instead
  of `2x`. The bug was in the simplification loop detection: when canonicalizing
  before simplification, the non-canonical form was recorded in the "seen" set,
  and since `isSame()` considers non-canonical and canonical forms equivalent,
  the canonical form was incorrectly detected as already processed. Now the
  simplification correctly starts fresh when canonicalizing, allowing full
  simplification to proceed.

## 0.32.0 _2026-01-28_

### Bug Fixes

#### Calculus

- **([#230](https://github.com/cortex-js/compute-engine/issues/230)) Root
  Derivatives**: Fixed the `D` operator not differentiating expressions
  containing the `Root` operator (n-th roots). Previously, `D(Root(x, 3), x)`
  (derivative of ∛x) would return an unevaluated derivative expression instead
  of computing the result. Now correctly returns `1/(3x^(2/3))`, equivalent to
  the expected `(1/3)·x^(-2/3)`. The fix adds a special case in the
  `differentiate` function to handle `Root(base, n)` by applying the power rule
  with exponent `1/n`.

- **Abs Derivative**: Fixed `d/dx |x|` returning an error when evaluated with a
  variable that has an assigned value. The derivative formula now uses `Sign(x)`
  instead of a complex `Which` expression that couldn't be evaluated
  symbolically.

- **Step Function Derivatives**: Fixed `D(floor(x), x)`, `D(ceil(x), x)`, and
  `D(round(x), x)` causing infinite recursion. These step functions now
  correctly return 0 (the derivative is 0 almost everywhere). Also fixed a bug
  where derivative formulas that evaluate to 0 weren't recognized due to a falsy
  check.

- **Inverse Trig Integrals**: Fixed incorrect integration formulas for `arcsin`,
  `arccos`, and `arctan`. The previous formulas were completely wrong. Correct:
  - `∫ arcsin(x) dx = x·arcsin(x) + √(1-x²)`
  - `∫ arccos(x) dx = x·arccos(x) - √(1-x²)`
  - `∫ arctan(x) dx = x·arctan(x) - (1/2)·ln(1+x²)`

- **Erfc Derivative**: Fixed incorrect derivative formula for `erfc(x)`. Now
  correctly returns `-2/√π · e^(-x²)` (the negative of the `erf` derivative).

- **LogGamma Derivative**: Added derivative rule for `LogGamma(x)` which returns
  `Digamma(x)` (the digamma/psi function).

- **Special Function Derivatives**: Fixed derivative formulas for several
  special functions and removed incorrect ones:
  - Fixed `d/dx erfi(x) = (2/√π)·e^(x²)` (imaginary error function)
  - Fixed `d/dx S(x) = sin(πx²/2)` (Fresnel sine integral)
  - Fixed `d/dx C(x) = cos(πx²/2)` (Fresnel cosine integral)
  - Removed incorrect derivative formulas for Zeta, Digamma, PolyGamma, Beta,
    LambertW, Bessel functions, and Airy functions (these now return symbolic
    derivatives like `Digamma'(x)` instead of wrong numeric results)

- **Symbolic Derivative Evaluation**: Fixed derivatives of unknown functions
  returning `0` instead of symbolic derivatives. For example, `D(Digamma(x), x)`
  now correctly returns `Digamma'(x)` (as `Apply(Derivative(Digamma, 1), x)`)
  instead of incorrectly returning `0`.

#### LaTeX Parsing and Serialization

- **([#256](https://github.com/cortex-js/compute-engine/issues/256)) Subscript
  Symbol Parsing**: Fixed parsing of single-letter symbols with subscripts.
  Previously, `i_A` was incorrectly parsed as
  `["Subscript", ["Complex", 0, 1], "A"]` because `i` was recognized as the
  imaginary unit before the subscript was processed. Now `i_A` correctly parses
  as the symbol `i_A`. This applies to all single-letter symbols including
  constants like `e` and `i`. Complex subscripts containing operators (`n+1`),
  commas (`n,m`), or parentheses (`(n+1)`) still produce `Subscript`
  expressions.

- **LaTeX Serialization**: Fixed TypeScript error in power serialization where
  `denom` (a `number | null`) was incorrectly passed where an `Expression` was
  expected. Now correctly uses `operand(exp, 2)` to get the expression form.

- **([#168](https://github.com/cortex-js/compute-engine/issues/168)) Absolute
  Value**: Fixed parsing of nested absolute value expressions that start with a
  double bar (e.g. `||3-5|-4|`), which previously produced an invalid structure
  instead of evaluating correctly.

- **([#244](https://github.com/cortex-js/compute-engine/issues/244))
  Serialization**: Fixed LaTeX and ASCIIMath serialization ambiguity for
  negative bases and negated powers. Powers now render `(-2)^2` (instead of
  `-2^2`) when the base is negative, and negated powers now render as `-(2^2)`
  rather than `-2^2`.

- **([#243](https://github.com/cortex-js/compute-engine/issues/243)) LaTeX
  Parsing**: Fixed logic operator precedence causing expressions like
  `x = 1 \vee x = 2` to be parsed incorrectly as `x = (1 ∨ x) = 2` instead of
  `(x = 1) ∨ (x = 2)`. Comparison operators (`=`, `<`, `>`, etc.) now correctly
  bind tighter than logic operators (`\land`, `\lor`, `\veebar`, etc.).

- **([#264](https://github.com/cortex-js/compute-engine/issues/264))
  Serialization**: Fixed LaTeX serialization of quantified expressions
  (`ForAll`, `Exists`, `ExistsUnique`, `NotForAll`, `NotExists`). Previously,
  only the quantifier symbol was output (e.g., `\forall x` instead of
  `\forall x, x>y`). The body of the quantified expression is now correctly
  serialized.

- **([#257](https://github.com/cortex-js/compute-engine/issues/257)) LaTeX
  Parsing**: Fixed `\gcd` command not parsing function arguments correctly.
  Previously `\gcd\left(24,37\right)` would parse as
  `["Tuple", "GCD", ["Tuple", 24, 37]]` instead of the expected
  `["GCD", 24, 37]`. The `\operatorname{gcd}` form was unaffected. Also added
  support for `\lcm` as a LaTeX command (in addition to the existing
  `\operatorname{lcm}`).

- **([#223](https://github.com/cortex-js/compute-engine/issues/223))
  Serialization**: Fixed scientific/engineering LaTeX serialization dropping the
  leading coefficient for exact powers of ten. For example, `1000` now
  serializes to `1\cdot10^{3}` (or `1\times10^{3}` depending on
  `exponentProduct`) instead of `10^{3}`.

- **LaTeX Parsing**: Fixed `\cosh` incorrectly mapping to `Csch` instead of
  `Cosh`.

- **([#255](https://github.com/cortex-js/compute-engine/issues/255)) LaTeX
  Parsing**: Fixed multi-letter subscripts like `A_{CD}` causing
  "incompatible-type" errors in arithmetic operations. Multi-letter subscripts
  without parentheses are now interpreted as compound symbol names (e.g.,
  `A_{CD}` → `A_CD`, `x_{ij}` → `x_ij`, `T_{max}` → `T_max`). Use parentheses
  for expression subscripts: `A_{(CD)}` creates a `Subscript` expression where
  `CD` represents implicit multiplication. The `Delimiter` wrapper is now
  stripped from subscript expressions for cleaner output.

#### First-Order Logic

- **([#263](https://github.com/cortex-js/compute-engine/issues/263)) Quantifier
  Scope**: Fixed quantifier scope in First-Order Logic expressions. Previously,
  `\forall x.P(x)\rightarrow Q(x)` was parsed with the implication inside the
  quantifier scope: `["ForAll", "x", ["To", P(x), Q(x)]]`. Now it correctly
  follows standard FOL conventions where the quantifier binds only the
  immediately following formula: `["To", ["ForAll", "x", P(x)], Q(x)]`. This
  applies to all quantifiers (`ForAll`, `Exists`, `ExistsUnique`, `NotForAll`,
  `NotExists`) and all logical connectives (`\rightarrow`, `\to`, `\implies`,
  `\land`, `\lor`, `\iff`). Use explicit parentheses for wider scope:
  `\forall x.(P(x)\rightarrow Q(x))`. Also fixed quantifier type signatures to
  properly return `boolean`, enabling correct type checking when quantified
  expressions are used as arguments to logical operators.

#### Simplification

- **Sign Simplification**: Fixed `Sign(x).simplify()` returning `1` instead of
  `-1` when `x` is negative. The simplification rule incorrectly returned
  `ce.One` for both positive and negative cases.

#### Type System

- **Ceil Type Signature**: Fixed `Ceil` function signature from
  `(real) -> integer` to `(number) -> integer` to match `Floor`. This resolves
  "incompatible-type" errors when computing derivatives of ceiling expressions
  or using `Ceil` in contexts expecting a general number type.

#### Polynomials

- **Polynomial Degree Detection**: Fixed `polynomialDegree()` returning 0 for
  expressions like `e^x` or `e^(-x^2)` when it should return -1 (not a
  polynomial). When the base of a power is constant but the exponent depends on
  the variable, this is not a polynomial. This bug caused infinite recursion in
  simplification when simplifying expressions containing exponentials, such as
  the derivative of `erf(x)` which is `(2/√π)·e^(-x²)`.

#### Pattern Matching

- **([#258](https://github.com/cortex-js/compute-engine/issues/258)) Pattern
  Matching**: Fixed `BoxedExpression.match()` returning `null` when matching
  patterns against canonicalized expressions. Several cases are now handled:
  - `Rational` patterns now match expressions like `['Rational', 'x', 2]` which
    are canonicalized to `['Multiply', ['Rational', 1, 2], 'x']`
  - `Power` patterns now match `['Power', 'x', -1]` which is canonicalized to
    `['Divide', 1, 'x']`, returning `{_base: x, _exp: -1}`
  - `Power` patterns now match `['Root', 'x', 3]` (cube root), returning
    `{_base: x, _exp: ['Divide', 1, 3]}`

#### Sum and Product

- **([#252](https://github.com/cortex-js/compute-engine/issues/252))
  Sum/Product**: Fixed `Sum` and `Product` returning `NaN` when the body
  contains free variables (variables not bound by the index). For example,
  `\sum_{n=1}^{10}(x)` now correctly evaluates to `10x` instead of `NaN`, and
  `\prod_{n=1}^{5}(x)` evaluates to `x^5`. Mixed expressions like
  `\sum_{n=1}^{10}(n \cdot x)` now return `55x`. Also fixed `toString()` for
  `Sum` and `Product` expressions with non-trivial bodies (e.g., `Multiply`)
  which were incorrectly displayed as `int()`.

#### Equation Solving

- **([#242](https://github.com/cortex-js/compute-engine/issues/242)) Solve**:
  Fixed `solve()` returning an empty array for equations with variables in
  fractions. For example, `F = 3g/h` solved for `g` now correctly returns `Fh/3`
  instead of an empty array. The solver now clears denominators before applying
  solve rules, enabling it to handle expressions like `a + bx/c = 0`. Also added
  support for solving equations where the variable is in the denominator (e.g.,
  `a/x = b` now returns `x = a/b`).

- **([#220](https://github.com/cortex-js/compute-engine/issues/220)) Solve**:
  Fixed `solve()` returning an empty array for equations involving square roots
  of the unknown, e.g. `2x = \sqrt{5x}`. The solver now handles equations of the
  form `ax + b√x + c = 0` using quadratic substitution. Also added support for
  solving logarithmic equations like `a·ln(x) + b = 0` which returns
  `x = e^(-b/a)`.

### Improvements

#### First-Order Logic

- **([#263](https://github.com/cortex-js/compute-engine/issues/263)) First-Order
  Logic**: Added several improvements for working with First-Order Logic
  expressions:
  - **Configurable quantifier scope**: New `quantifierScope` parsing option
    controls how quantifier scope is determined. Use `"tight"` (default) for
    standard FOL conventions where quantifiers bind only the immediately
    following formula, or `"loose"` for scope extending to the end of the
    expression.
    ```typescript
    ce.parse('\\forall x. P(x)', { quantifierScope: 'tight' })  // default
    ce.parse('\\forall x. P(x)', { quantifierScope: 'loose' })
    ```
  - **Automatic predicate inference**: Single uppercase letters followed by
    parentheses (e.g., `P(x)`, `Q(a,b)`) are now automatically recognized as
    predicate/function applications without requiring explicit declaration. This
    enables natural FOL syntax like `\forall x. P(x) \rightarrow Q(x)` to work
    out of the box.
  - **Quantifier evaluation over finite domains**: Quantifiers (`ForAll`,
    `Exists`, `ExistsUnique`, `NotForAll`, `NotExists`) now evaluate to boolean
    values when the bound variable is constrained to a finite set. For example:
    ```typescript
    ce.box(['ForAll', ['Element', 'x', ['Set', 1, 2, 3]], ['Greater', 'x', 0]]).evaluate()
    // Returns True (all values in {1,2,3} are > 0)
    ce.box(['Exists', ['Element', 'x', ['Set', 1, 2, 3]], ['Greater', 'x', 2]]).evaluate()
    // Returns True (3 > 2)
    ce.box(['ExistsUnique', ['Element', 'x', ['Set', 1, 2, 3]], ['Equal', 'x', 2]]).evaluate()
    // Returns True (only one element equals 2)
    ```
    Supports `Set`, `List`, `Range`, and integer `Interval` domains up to 1000
    elements. Nested quantifiers are evaluated over the Cartesian product of
    their domains.
  - **Symbolic simplification for quantifiers**: Quantifiers now simplify
    automatically in special cases:
    - `∀x. True` → `True`, `∀x. False` → `False`
    - `∃x. True` → `True`, `∃x. False` → `False`
    - `∀x. P` → `P` (when P doesn't contain x)
    - `∃x. P` → `P` (when P doesn't contain x)
  - **CNF/DNF conversion**: New `ToCNF` and `ToDNF` functions convert boolean
    expressions to Conjunctive Normal Form and Disjunctive Normal Form
    respectively:
    ```typescript
    ce.box(['ToCNF', ['Or', ['And', 'A', 'B'], 'C']]).evaluate()
    // Returns (A ∨ C) ∧ (B ∨ C)
    ce.box(['ToDNF', ['And', ['Or', 'A', 'B'], 'C']]).evaluate()
    // Returns (A ∧ C) ∨ (B ∧ C)
    ```
    Handles `And`, `Or`, `Not`, `Implies`, `Equivalent`, `Xor`, `Nand`, and
    `Nor` operators using De Morgan's laws and distribution.
  - **Boolean operator evaluation**: Added evaluation support for `Xor`, `Nand`,
    and `Nor` operators with `True`/`False` arguments:
    ```typescript
    ce.box(['Xor', 'True', 'False']).evaluate()   // Returns True
    ce.box(['Nand', 'True', 'True']).evaluate()   // Returns False
    ce.box(['Nor', 'False', 'False']).evaluate()  // Returns True
    ```
  - **N-ary boolean operators**: `Xor`, `Nand`, and `Nor` now support any number
    of arguments:
    - `Xor(a, b, c, ...)` returns true when an odd number of arguments are true
    - `Nand(a, b, c, ...)` returns the negation of `And(a, b, c, ...)`
    - `Nor(a, b, c, ...)` returns the negation of `Or(a, b, c, ...)`
  - **Satisfiability checking**: New `IsSatisfiable` function checks if a
    boolean expression can be made true with some assignment of variables:
    ```typescript
    ce.box(['IsSatisfiable', ['And', 'A', ['Not', 'A']]]).evaluate()  // False
    ce.box(['IsSatisfiable', ['Or', 'A', 'B']]).evaluate()            // True
    ```
  - **Tautology checking**: New `IsTautology` function checks if a boolean
    expression is true for all possible variable assignments:
    ```typescript
    ce.box(['IsTautology', ['Or', 'A', ['Not', 'A']]]).evaluate()     // True
    ce.box(['IsTautology', ['And', 'A', 'B']]).evaluate()             // False
    ```
  - **Truth table generation**: New `TruthTable` function generates a complete
    truth table for a boolean expression:
    ```typescript
    ce.box(['TruthTable', ['And', 'A', 'B']]).evaluate()
    // Returns [["A","B","Result"],["False","False","False"],...]
    ```
  - **Explicit `Predicate` function**: Added a new `Predicate` function to
    explicitly represent predicate applications in First-Order Logic. Inside
    quantifier scopes (`\forall`, `\exists`, etc.), single uppercase letters
    followed by parentheses are now parsed as `["Predicate", "P", "x"]` instead
    of `["P", "x"]`. This distinguishes predicates from regular function
    applications and avoids naming conflicts with library functions.
    ```typescript
    ce.parse('\\forall x. P(x)').json
    // Returns ["ForAll", "x", ["Predicate", "P", "x"]]
    ```
    Outside quantifier scopes, `P(x)` is still parsed as `["P", "x"]` to
    maintain backward compatibility with function definitions like
    `Q(x) := ...`.
  - **`D(f, x)` no longer maps to derivative**: The LaTeX notation `D(f, x)` is
    not standard mathematical notation for derivatives and previously caused
    confusion with the `D` derivative function in MathJSON. Now `D(f, x)` in
    LaTeX parses as `["Predicate", "D", "f", "x"]` instead of the derivative.
    Use Leibniz notation (`\frac{d}{dx}f`) for derivatives in LaTeX, or
    construct the derivative directly in MathJSON: `["D", expr, "x"]`.
  - **`N(x)` no longer maps to numeric evaluation**: Similarly, `N(x)` in LaTeX
    is CAS-specific notation, not standard math notation. Now `N(x)` parses as
    `["Predicate", "N", "x"]` instead of the numeric evaluation function. This
    allows `N` to be used as a variable (e.g., "for all N in Naturals"). Use the
    `.N()` method for numeric evaluation, or construct it directly in MathJSON:
    `["N", expr]`.

#### Polynomials

- **Polynomial Simplification**: The `simplify()` function now automatically
  cancels common polynomial factors in univariate rational expressions. For
  example, `(x² - 1)/(x - 1)` simplifies to `x + 1`, `(x³ - x)/(x² - 1)`
  simplifies to `x`, and `(x + 1)/(x² + 3x + 2)` simplifies to `1/(x + 2)`.
  Previously, this required explicitly calling the `Cancel` function with a
  variable argument.

#### Sum and Product

- **Sum/Product Simplification**: Added simplification rules for `Sum` and
  `Product` expressions with symbolic bounds:
  - Constant body: `\sum_{n=1}^{b}(x)` simplifies to `b * x`
  - Triangular numbers (general bounds): `\sum_{n=a}^{b}(n)` simplifies to
    `(b(b+1) - a(a-1))/2`
  - Sum of squares: `\sum_{n=1}^{b}(n^2)` simplifies to `b(b+1)(2b+1)/6`
  - Sum of cubes: `\sum_{n=1}^{b}(n^3)` simplifies to `[b(b+1)/2]^2`
  - Geometric series: `\sum_{n=0}^{b}(r^n)` simplifies to `(1-r^(b+1))/(1-r)`
  - Alternating unit series: `\sum_{n=0}^{b}((-1)^n)` simplifies to
    `(1+(-1)^b)/2`
  - Alternating linear series: `\sum_{n=0}^{b}((-1)^n * n)` simplifies to
    `(-1)^b * floor((b+1)/2)`
  - Arithmetic progression: `\sum_{n=0}^{b}(a + d*n)` simplifies to
    `(b+1)(a + db/2)`
  - Sum of binomial coefficients: `\sum_{k=0}^{n}C(n,k)` simplifies to `2^n`
  - Alternating binomial sum: `\sum_{k=0}^{n}((-1)^k * C(n,k))` simplifies to
    `0`
  - Weighted binomial sum: `\sum_{k=0}^{n}(k * C(n,k))` simplifies to
    `n * 2^(n-1)`
  - Partial fractions (telescoping): `\sum_{k=1}^{n}(1/(k(k+1)))` simplifies to
    `n/(n+1)`
  - Partial fractions (telescoping): `\sum_{k=2}^{n}(1/(k(k-1)))` simplifies to
    `(n-1)/n`
  - Weighted squared binomial sum: `\sum_{k=0}^{n}(k^2 * C(n,k))` simplifies to
    `n(n+1) * 2^(n-2)`
  - Weighted cubed binomial sum: `\sum_{k=0}^{n}(k^3 * C(n,k))` simplifies to
    `n²(n+3) * 2^(n-3)`
  - Alternating weighted binomial sum: `\sum_{k=0}^{n}((-1)^k * k * C(n,k))`
    simplifies to `0` (n ≥ 2)
  - Sum of binomial squares: `\sum_{k=0}^{n}(C(n,k)^2)` simplifies to `C(2n, n)`
  - Sum of consecutive products: `\sum_{k=1}^{n}(k(k+1))` simplifies to
    `n(n+1)(n+2)/3`
  - Arithmetic progression (general bounds): `\sum_{n=m}^{b}(a + d*n)`
    simplifies to `(b-m+1)(a + d(m+b)/2)`
  - Product of constant: `\prod_{n=1}^{b}(x)` simplifies to `x^b`
  - Factorial: `\prod_{n=1}^{b}(n)` simplifies to `b!`
  - Shifted factorial: `\prod_{n=1}^{b}(n+c)` simplifies to `(b+c)!/c!`
  - Odd double factorial: `\prod_{n=1}^{b}(2n-1)` simplifies to `(2b-1)!!`
  - Even double factorial: `\prod_{n=1}^{b}(2n)` simplifies to `2^b * b!`
  - Rising factorial (Pochhammer): `\prod_{k=0}^{n-1}(x+k)` simplifies to
    `(x)_n`
  - Falling factorial: `\prod_{k=0}^{n-1}(x-k)` simplifies to `x!/(x-n)!`
  - Telescoping product: `\prod_{k=1}^{n}((k+1)/k)` simplifies to `n+1`
  - Wallis-like product: `\prod_{k=2}^{n}(1 - 1/k^2)` simplifies to `(n+1)/(2n)`
  - Factor out constants: `\sum_{n=1}^{b}(c \cdot f(n))` simplifies to
    `c \cdot \sum_{n=1}^{b}(f(n))`, and similarly for products where the
    constant is raised to the power of the iteration count
  - Nested sums/products: inner sums/products are simplified first, enabling
    cascading simplification
  - Edge cases: empty ranges (upper < lower) return identity elements (0 for
    Sum, 1 for Product), and single-iteration ranges substitute the bound value

## 0.31.0 _2026-01-27_

### Breaking Changes

- The `[Length]` function has been renamed to `[Count]`.
- The `xsize` property of collections has been renamed to `count`.
- The `xcontains()` method of collections has been renamed to `contains()`.
- Handling of dictionaries (`["Dictionary"]` expressions and `\{dict:...\}`
  shorthand) has been improved.
- **Inverse hyperbolic functions** have been renamed to follow the ISO 80000-2
  standard: `Arcsinh` → `Arsinh`, `Arccosh` → `Arcosh`, `Arctanh` → `Artanh`,
  `Arccoth` → `Arcoth`, `Arcsech` → `Arsech`, `Arccsch` → `Arcsch`. The "ar"
  prefix (for "area") is mathematically correct since these functions relate to
  areas on a hyperbola, not arc lengths. Both LaTeX spellings (`\arsinh` and
  `\arcsinh`) are accepted as input (Postel's law).

### Bug Fixes

#### LaTeX Parsing

- **Metadata Preservation**: Fixed `verbatimLatex` not being preserved when
  parsing with `preserveLatex: true`. The original LaTeX source is now correctly
  stored on parsed expressions (when using non-canonical mode). Also fixed
  metadata (`latex`, `wikidata`) being lost when boxing MathJSON objects that
  contain these attributes.

- **String Parsing**: Fixed parsing of `\text{...}` with `preserveLatex: true`
  which was incorrectly returning an "invalid-symbol" error instead of a string
  expression.

#### Calculus

- **Derivatives**: `d/dx e^x` now correctly simplifies to `e^x` instead of
  `ln(e) * e^x`. The `hasSymbolicTranscendental()` function now recognizes that
  transcendentals which simplify to exact rational values (like `ln(e) = 1`)
  should not be preserved symbolically.

- **Derivatives**: `d/dx log(x)` now returns `1 / (x * ln(10))` symbolically
  instead of evaluating to `0.434... / x`. Fixed by using substitution instead
  of function application when applying derivative formulas, which preserves
  symbolic transcendental constants.

#### Arithmetic

- **Rationals**: Fixed `reducedRational()` to properly normalize negative
  denominators before the early return check. Previously `1/-2` would not
  canonicalize to `-1/2`.

- **Arithmetic**: Fixed `.mul()` to preserve logarithms symbolically. Previously
  multiplying expressions containing `Ln` or `Log` would evaluate the logarithm
  to its numeric value.

#### Serialization

- **Serialization**: Fixed case inconsistency in `toString()` output for
  trigonometric functions. Some functions like `Cot` were being serialized with
  capital letters while others like `csc` were lowercase. All trig functions now
  consistently serialize in lowercase (e.g., `cot(x)` instead of `Cot(x)`).

- **Serialization**: Improved display of inverse trig derivatives and similar
  expressions:
  - Negative exponents like `x^(-1/2)` now display as `1/sqrt(x)` in both LaTeX
    and ASCII-math output
  - When a sum starts with a negative term and contains a positive constant, the
    constant is moved to the front (e.g., `-x^2 + 1` displays as `1 - x^2`)
    while preserving polynomial ordering (e.g., `x^2 - x + 3` stays unchanged)
  - `d/dx arcsin(x)` now displays as `1/sqrt(1-x^2)` instead of
    `(-x^2+1)^(-1/2)`

- **Scientific Notation**: Fixed normalization of scientific notation for
  fractional values (e.g., numbers less than 1).

#### Sum and Product

- **Compilation**: Fixed compilation of `Sum` and `Product` expressions.

- **Sum/Product**: Fixed `sum` and `prod` library functions to correctly handle
  substitution of index variables.

### New Features and Improvements

#### Serialization

- **Number Serialization**: Added `adaptiveScientific` notation mode. When
  serializing numbers to LaTeX, this mode uses scientific notation but avoids
  exponents within a configurable range (controlled by `avoidExponentsInRange`).
  This provides a balance between readability and precision for numbers across
  different orders of magnitude.

#### Type System

- Refactored the type parser to use a modular architecture. This allows for
  better extensibility and maintainability of the type system.

#### Pattern Matching

- **Pattern Matching**: The `validatePattern()` function is now exported from
  the public API. Use it to check patterns for invalid combinations like
  consecutive sequence wildcards before using them.

#### Polynomials

- **Polynomial Arithmetic**: Added new library functions for polynomial
  operations:
  - `PolynomialDegree(expr, var)` - Get the degree of a polynomial
  - `CoefficientList(expr, var)` - Get the list of coefficients
  - `PolynomialQuotient(dividend, divisor, var)` - Polynomial division quotient
  - `PolynomialRemainder(dividend, divisor, var)` - Polynomial division
    remainder
  - `PolynomialGCD(a, b, var)` - Greatest common divisor of polynomials
  - `Cancel(expr, var)` - Cancel common factors in rational expressions

#### Calculus

- **Integration**: Significantly expanded symbolic integration capabilities:
  - **Polynomial division**: Integrals like `∫ x²/(x²+1) dx` now correctly
    divide first, yielding `x - arctan(x)`
  - **Repeated linear roots**: `∫ 1/(x-1)² dx = -1/(x-1)` and higher powers
  - **Derivative pattern recognition**: `∫ f'(x)/f(x) dx = ln|f(x)|` is now
    recognized automatically
  - **Completing the square**: Irreducible quadratics like `∫ 1/(x²+2x+2) dx`
    now yield `arctan(x+1)`
  - **Reduction formulas**: `∫ 1/(x²+1)² dx` now works using reduction formulas
  - **Mixed partial fractions**: `∫ 1/((x-1)(x²+1)) dx` now decomposes correctly
  - **Factor cancellation**: `∫ (x+1)/(x²+3x+2) dx` simplifies before
    integrating
  - **Inverse hyperbolic**: Added `∫ 1/√(x²+1) dx = arcsinh(x)` and
    `∫ 1/√(x²-1) dx = arccosh(x)`
  - **Arcsec pattern**: Added `∫ 1/(x·√(x²-1)) dx = arcsec(x)`
  - **Trigonometric substitution**: Added support for `∫√(a²-x²) dx`,
    `∫√(x²+a²) dx`, and `∫√(x²-a²) dx` using trig/hyperbolic substitution

## 0.30.2 _2025-07-15_

### Breaking Changes

- The `expr.value` property reflects the value of the expression if it is a
  number literal or a symbol with a literal value. If you previously used the
  `expr.value` property to get the value of an expression, you should now use
  the `expr.N().valueOf()` method instead. The `valueOf()` method is suitable
  for interoperability with JavaScript, but it may result in a loss of precision
  for numbers with more than 15 digits.

- `BoxedExpr.sgn` now returns _undefined_ for complex numbers, or symbols with a
  complex-number value.

- The `ce.assign()` method previously accepted
  `ce.assign("f(x, y)", ce.parse("x+y"))`. This is now deprecated. Use
  `ce.assign("f", ce.parse("(x, y) \\mapsto x+y")` instead.

- It was previously possible to invoke `expr.evaluate()` or `expr.N()` on a
  non-canonical expression. This will now return the expression itself.

  To evaluate a non-canonical expression, use `expr.canonical.evaluate()` or
  `expr.canonical.N()`.

  That's also the case for the methods `numeratorDenominator()`, `numerator()`,
  and `denominator()`.

  In addition, invoking the methods `inv()`, `abs()`, `add()`, `mul()`, `div()`,
  `pow()`, `root()`, `ln()` will throw an error if the expression is not
  canonical.

### New Features and Improvements

- Collections now support lazy materialization. This means that the elements of
  some collection are not computed until they are needed. This can significantly
  improve performance when working with large collections, and allow working
  with infinite collections. For example:

  ```js
  ce.box(['Map', 'Integers', 'Square']).evaluate().print();
  // -> [0, 1, 4, 9, 16, ...]
  ```

  Materialization can be controlled with the `materialization` option of the
  `evaluate()` method. Lazy collections are materialized by default when
  converted to a string or LaTeX, or when assigned to a variable.

- The bindings of symbols and function expressions is now consistently done
  during canonicalization.

- It was previously not possible to change the type of an identifier from a
  function to a value or vice versa. This is now possible.

- **Antiderivatives** are now computed symbolically:

```js
ce.parse(`\\int_0^1 \\sin(\\pi x) dx`).evaluate().print();
// -> 2 / pi
ce.parse(`\\int \\sin(\\pi x) dx`).evaluate().print();
// -> -cos(pi * x) / pi
```

Requesting a numeric approximation of the integral will use a Monte Carlo
method:

```js
ce.parse(`\\int_0^1 \\sin(\\pi x) dx`).N().print();
// -> 0.6366
```

- Numeric approximations of integrals is several order of magnitude faster.

- Added **Number Theory** functions: `Totient`, `Sigma0`, `Sigma1`,
  `SigmaMinus1`, `IsPerfect`, `Eulerian`, `Stirling`, `NPartition`,
  `IsTriangular`, `IsSquare`, `IsOctahedral`, `IsCenteredSquare`, `IsHappy`,
  `IsAbundant`.

- Added **Combinatorics** functions: `Choose`, `Fibonacci`, `Binomial`,
  `CartesianProduct`, `PowerSet`, `Permutations`, `Combinations`, `Multinomial`,
  `Subfactorial` and `BellNumber`.

- The `symbol` type can be refined to match a specific symbol. For example
  `symbol<True>`. The type `expression` can be refined to match expressions with
  a specific operator, for example `expression<Add>` is a type that matches
  expressions with the `Add` operator. The numeric types can be refined with a
  lower and upper bound. For example `integer<0..10>` is a type that matches
  integers between 0 and 10. The type `real<1..>` matches real numbers greater
  than 1 and `rational<..0>` matches non-positive rational numbers.

- Numeric types can now be constrained with a lower and upper bound. For
  example, `real<0..10>` is a type that matches real numbers between 0 and 10.
  The type `integer<1..>` matches integers greater than or equal to 1.

- Collections that can be indexed (`list`, `tuple`) are now a subtype of
  `indexed_collection`.

- The `map` type has been replaced with `dictionary` for collections of
  arbitrary key-value pairs and `record` for collections of structured key-value
  pairs.

- Support for structural typing has been added. To define a structural type, use
  `ce.declareType()` with the `alias` flag, for example:

  ```js
  ce.declareType(
    "point", "tuple<x: integer, y: integer>",
    { alias: true }
  );
  ```

- Recursive types are now supported by using the `type` keyword to forward
  reference types. For example, to define a type for a binary tree:

  ```js
  ce.declareType(
    "binary_tree",
    "tuple<value: integer, left: type binary_tree?, right: type binary_tree?>",
  );
  ```

- The syntax for variadic arguments has changeed. To indicate a variadic
  argument, use a `+` or `*` after the type, for example:

  ```js
  ce.declare('f', '(number+) -> number');
  ```

  Use `+` for a non-empty list of arguments and `*` for a possibly empty list.

- Added a rule to solve the equation `a^x + b = 0`

- The LaTeX parser now supports the `\placeholder[]{}`, `\phantom{}`,
  `\hphantom{}`, `\vphantom{}`, `\mathstrut`, `\strut` and `\smash{}` commands.

- The range of recognized sign values, i.e. as returned from
  `BoxedExpression.sgn` has been simplified (e.g. '...-infinity' and 'nan' have
  been removed)

- The Power canonical-form is less aggressive - only carrying-out ops. as listed
  in doc. - is much more careful in its consideration of operand types &
  values... (for example, typically, exponents are required to be _numbers_:
  e.g. `x^1` will simplify, but `x^y` (where `y===0`), or `x^{1+0}`, will not)

### Issues Resolved

- Ensure expression LaTeX serialization is based on MathJSON generated with
  matching "pretty" formatting (or not), therefore resulting in LaTeX with less
  prettification, where `prettify === false` (#daef87f)

- Symbols declare with a `constant` flag are now not marked as "inferred"

- Some `BoxedSymbols` properties now more consistently return `undefined`,
  instead of a `boolean` (i.e. because the symbol is non-bound)

- Some `expr.root()` computations

- Canonical-forms
  - Fixes the `Number` form
  - Forms (at least, `Number`, `Power`) do not mistakenly _fully_ canonicalize
    operands
  - This (partial canonicalization) now substitutes symbols (constants) with a
    `holdUntil` value of `"never"` during/prior-to canonicalization (i.e. just
    like for full canonicalization)

## 0.29.1 _2025-03-31_

- **#231** During evaluation, some numbers, for example `10e-15` were
  incorrectly rounded to 0.

## 0.28.0 _2025-02-06_

### Issues Resolved

- **#211** More consistent canonicalization and serialization of exact numeric
  values of the form `(a√b)/c`.
- **#219** The `invisibleOperator` canonicalization previously also
  canonicalized some multiplication.
- **#218** Improved performance of parsing invisible operators, including fixing
  some cases where the parsing was incorrect.
- **#216** Correctly parse subscripts with a single character, for example
  `x_1`.
- **#216** Parse some non-standard integral signs, for example
  `\int x \cdot \differentialD x` (both the `\cdot` and the `\differentialD` are
  non-standard).
- **#210** Numeric approximation of odd nth roots of negative numbers evaluate
  correctly.
- **#153** Correctly parse integrals with `\limits`, e.g.
  `\int\limits_0^1 x^2 \mathrm{d} x`.
- Correctly serialize to ASCIIMath `Delimiter` expressions.
- When inferring the type of numeric values do not constrain them to be `real`.
  As a result:

  ```js
  ce.assign('a', ce.parse('i'));
  ce.parse('a+1').evaluate().print();
  ```

  now returns `1 + i` instead of throwing a type error.

- Correctly parse and evaluate unary and binary `\pm` and `\mp` operators.

### New Features and Improvements

- `expr.isEqual()` will now return true/false if the expressions include the
  same unknowns and are structurally equal after expansion and simplifications.
  For example:

  ```js
  console.info(ce.parse('(x+1)^2').isEqual(ce.parse('x^2+2x+1')));
  // -> true
  ```

#### Asynchronous Operations

Some computations can be time-consuming, for example, computing a very large
factorial. To prevent the browser from freezing, the Compute Engine can now
perform some operations asynchronously.

To perform an asynchronous operation, use the `expr.evaluateAsync` method. For
example:

```js
try {
  const fact = ce.parse('(70!)!');
  const factResult = await fact.evaluateAsync();
  factResult.print();
} catch (e) {
  console.error(e);
}
```

It is also possible to interrupt an operation, for example by providing a
pause/cancel button that the user can press. To do so, use an `AbortController`
object and a `signal`. For example:

```js
const abort = new AbortController();
const signal = abort.signal;
setTimeout(() => abort.abort(), 500);
try {
  const fact = ce.parse('(70!)!');
  const factResult = await fact.evaluateAsync({ signal });
  factResult.print();
} catch (e) {
  console.error(e);
}
```

In the example above, we trigger an abort after 500ms.

It is also possible to control how long an operation can run by setting the
`ce.timeLimit` property with a value in milliseconds. For example:

```js
ce.timeLimit = 1000;
try {
  const fact = ce.parse('(70!)!');
  fact.evaluate().print();
} catch (e) {
  console.error(e);
}
```

The time limit applies to either the synchronous or asynchronous evaluation.

The default time limit is 2,000ms (2 seconds).

When an operation is canceled either because of a timeout or an abort, a
`CancellationError` is thrown.

## 0.27.0 _2024-12-02_

- **#217** Correctly parse LaTeX expressions that include a command followed by
  a `*` such as `\\pi*2`.

- **#217** Correctly calculate the angle of trigonometric expressions with an
  expression containing a reference to `Pi`, for example `\\sin(\\pi^2)`.

- The `Factorial` function will now time out if the argument is too large. The
  timeout is signaled by throwing a `CancellationError`.

- When specifying `exp.toMathJSON({shorthands:[]})`, i.e., not to use shorthands
  in the MathJSON, actually avoid using shorthands.

- Correctly use custom multiply, plus, etc. for LaTeX serialization.

- When comparing two numeric values, the tolerance is now used to determine if
  the values are equal. The tolerance can be set with the `ce.tolerance`
  property.

- When comparing two expressions with `isEqual()` the values are compared
  structurally when necessary, or with a stochastic test when the expressions
  are too complex to compare structurally.

- Correctly serialize nested superscripts, e.g. `x^{y^z}`.

- The result of evaluating a `Hold` expression is now the expression itself.

- To prevent evaluation of an expression temporarily, use the `Unevaluated`
  function. The result of evaluating an `Unevaluated` expression is its
  argument.

- The type of a `Hold` expression was incorrectly returned as `string`. It now
  returns the type of its argument.

- The statistics function (`Mean`, `Median`, `Variance`, `StandardDeviation`,
  `Kurtosis`, `Skewness`, `Mode`, `Quartiles` and `InterQuartileRange`) now
  accept as argument either a collection or a sequence of values.

  ```js
  ce.parse("\\mathrm{Mean}([7, 2, 11])").evaluate().print();
  // -> 20/3
  ce.parse("\\mathrm{Mean}(7, 2, 11)").evaluate().print();
  // -> 20/3
  ```

- The `Variance` and `StandardDeviation` functions now have variants for
  population statistics, `PopulationVariance` and `PopulationStandardDeviation`.
  The default is to use sample statistics.

  ```js
  ce.parse("\\mathrm{PopulationVariance}([7, 2, 11])").evaluate().print();
  // -> 13.555
  ce.parse("\\mathrm{Variance}([7, 2, 11])").evaluate().print();
  // -> 20.333
  ```

- The statistics function can now be compiled to JavaScript:

  ```js
  const code = ce.parse("\\mathrm{Mean}(7, 2, 11)").compile();
  console.log(code());
  // -> 13.555
  ```

- The statistics function calculate either using machine numbers or bignums
  depending on the precision. The precision can be set with the `precision`
  property of the Compute Engine.

- The argument of compiled function is now optional.

- Compiled expressions can now reference external JavaScript functions. For
  example:

  ```js
  ce.defineFunction('Foo', {
    signature: 'number -> number',
    evaluate: ([x]) => ce.box(['Add', x, 1]),
  });

  const fn = ce.box(['Foo', 3]).compile({
    functions: { Foo: (x) => x + 1 },
  })!;

  console.info(fn());
  // -> 4
  ```

  ```js
  ce.defineFunction('Foo', {
    signature: 'number -> number',
    evaluate: ([x]) => ce.box(['Add', x, 1]),
  });

  function foo(x) {
    return x + 1;
  }

  const fn = ce.box(['Foo', 3]).compile({
    functions: { Foo: foo },
  })!;

  console.info(fn());
  // -> 4
  ```

  Additionally, functions can be implicitly imported (in case they are needed by
  other JavaScript functions):

  ```js
  ce.defineFunction('Foo', {
    signature: 'number -> number',
    evaluate: ([x]) => ce.box(['Add', x, 1]),
  });

  function bar(x, y) {
    return x + y;
  }

  function foo(x) {
    return bar(x, 1);
  }


  const fn = ce.box(['Foo', 3]).compile({
    functions: { Foo: 'foo' },
    imports: [foo, bar],
  })!;

  console.info(fn());
  // -> 4
  ```

- Compiled expression can now include an arbitrary preamble (JavaScript source)
  that is executed before the compiled function is executed. This can be used to
  define additional functions or constants.

  ```js
  ce.defineFunction('Foo', {
    signature: 'number -> number',
    evaluate: ([x]) => ce.box(['Add', x, 1]),
  });

  const code = ce.box(['Foo', 3]).compile({
    preamble: "function Foo(x) { return x + 1};",
  });
  ```

- The `hold` function definition flag has been renamed to `lazy`

## 0.26.4 _2024-10-17_

- **#201** Identifiers of the form `A_\text{1}` were not parsed correctly.
- **#202** Fixed serialization of integrals and bigops.

## 0.26.3 _2024-10-17_

- Correctly account for `fractionalDigits` when formatting numbers.
- **#191** Correctly handle `\\lnot\\forall` and `\\lnot\\exists`.
- **#206** The square root of 1000000 was canonicalized to 0.
- **#207** When a square root with a literal base greater than 1e6 was preceded
  by a non-integer literal number, the literal number was ignored during
  canonicalization.
- **#208** **#204** Correctly evaluate numeric approximation of roots, e.g.
  `\\sqrt[3]{125}`.
- **#205** `1/ln(0)` was incorrectly evaluated to `1`. It now returns `0`.

## 0.26.1 _2024-10-04_

### Issues Resolved

- **#194** Correctly handle the precedence of unary negate, for example in
  `-5^{\frac12}` or `-5!`.
- When using a function definition with `ce.declare()`, do not generate a
  runtime error.

### New Features and Improvements

- Added `.expand()` method to boxed expression. This method expands the
  expression, for example `ce.parse("(x+1)^2").expand()` will return
  `x^2 + 2x + 1`.

## 0.26.0 _2024-10-01_

### Breaking Changes

- The property `expr.head` has been deprecated. Use `expr.operator` instead.
  `expr.head` is still supported in this version but will be removed in a future
  update.

- The MathJSON utility functions `head()` and `op()` have been renamed to
  `operator()` and `operand()` respectively.

- The methods for algebraic operations (`add`, `div`, `mul`, etc...) have been
  moved from the Compute Engine to the Boxed Expression class. Instead of
  calling `ce.add(a, b)`, call `a.add(b)`.

  Those methods also behave more consistently: they apply some additional
  simplication rules over canonicalization. For example, while
  `ce.parse('1 + 2')` return `["Add", 1, 2]`, `ce.box(1).add(2)` will return
  `3`.

- The `ce.numericMode` option has been removed. Instead, set the `ce.precision`
  property to the desired precision. Set the precision to `"machine"` for
  machine precision calculations (about 15 digits). Set it to `"auto"` for a
  default of 21 digits. Set it to a number for a greater fixed precision.

- The MathJSON Dictionary element has been deprecated. Use a `Dictionary`
  expression instead.

- The `ExtendedRealNumbers`, `ExtendedComplexNumbers` domains have been
  deprecated. Use the `RealNumbers` and `ComplexNumbers` domains instead.

- The "Domain" expression has been deprecated. Use types instead (see below).

- Some `BoxedExpression` properties have been removed:
  - Instead of `expr.isZero`, use `expr.is(0)`.
  - Instead of `expr.isNotZero`, use `!expr.is(0)`.
  - Instead of `expr.isOne`, use `expr.is(1)`.
  - Instead of `expr.isNegativeOne`, use `expr.is(-1)`.

- The signature of `ce.declare()` has changed. In particular, the `N` handler
  has been replaced with `evaluate`.

```ts
// Before
ce.declare('Mean', {
  N: (ce: IComputeEngine): BoxedExpression => {
    return ce.number(1);
  },
});

// Now
ce.declare('Mean', { evaluate: (ops, { engine }) => ce.number(1) });
```

### New Features and Improvements

- **New Simplification Engine**

  The way expressions are simplified has been completely rewritten. The new
  engine is more powerful and more flexible.

  The core API remains the same: to simplify an expression, use
  `expr.simplify()`.

  To use a custom set of rules, pass the rules as an argument to `simplify()`:

  ```js
  expr.simplify({rules: [
    "|x:<0| -> -x",
    "|x:>=0| -> x",
  ]});
  ```

  There are a few changes to the way rules are represented. The `priority`
  property has been removed. Instead, rules are applied in the order in which
  they are defined.

  A rule can also now be a function that takes an expression and returns a new
  expression. For example:

  ```js
  expr.simplify({rules: [
    (expr) => {
      if (expr.operator !== 'Abs') return undefined;
      const x = expr.args[0];
      return x.isNegative ? x.negate() : expr;
    }
  ]});
  ```

  This can be used to perform more complex transformations at the cost of more
  verbose JavaScript code.

  The algorithm for simplification has been simplified. It attempts to apply
  each rule in the rule set in turn, then restarts the process until no more
  rules can be applied or the result of applying a rule returns a previously
  seen expression.

  Function definitions previously included a `simplify` handler that could be
  used to perform simplifications specific to this function. This has been
  removed. Instead, use a rule that matches the function and returns the
  simplified expression.

- **Types**

  Previously, an expression was associated with a domain such as `RealNumbers`
  or `ComplexNumbers`. This has been replaced with a more flexible system of
  types.

  A type is a set of values that an expression can take. For example, the type
  `real` is the set of real numbers, the type `integer` is the set of integers,

  The type of an expression can be set with the `type` property. For example:

  ```js
  const expr = ce.parse('\\sqrt{-1}');
  console.info(expr.type); // -> imaginary
  ```

  The type of a symbol can be set when declaring the symbol. For example:

  ```js
  ce.declare('x', 'imaginary');
  ```

  In addition to primitive types, the type system supports more complex types
  such union types, intersection types, and function types.

  For example, the type `real|imaginary` is the union of the real and imaginary
  numbers.

  When declaring a function, the type of the arguments and the return value can
  be specified. For example, to declare a function `f` that takes two integers
  and returns a real number:

  ```js
  ce.declare('f', '(integer, integer) -> real');
  ```

  The sets of numbers are defined as follows:
  - `number` - any number, real or complex, including NaN and infinity
  - `non_finite_number` - NaN or infinity
  - `real`
  - `finite_real` - finite real numbers (exclude NaN and infinity)
  - `imaginary` - imaginary numbers (complex numbers with a real part of 0)
  - `finite_imaginary`
  - `complex` - complex numbers with a real and imaginary part not equal to 0
  - `finite_complex`
  - `rational`
  - `finite_rational`
  - `integer`
  - `finite_integer`

  To check the type of an expression, use the `isSubtypeOf()` method. For
  example:

  ```js
  let expr = ce.parse('5');
  console.info(expr.type.isSubtypeOf('rational')); // -> true
  console.info(expr.type.isSubtypeOf('integer')); // -> true

  expr = ce.parse('\\frac{1}{2}');
  console.info(expr.type.isSubtypeOf('rational')); // -> true
  console.info(expr.type.isSubtypeOf('integer')); // -> false
  ```

  As a shortcut, the properties `isReal`, `isRational`, `isInteger` are
  available on boxed expressions. For example:

  ```js
  let expr = ce.parse('5');
  console.info(expr.isInteger); // -> true
  console.info(expr.isRational); // -> true
  ```

  They are equivalent to `expr.type.isSubtypeOf('integer')` and
  `expr.type.isSubtypeOf('rational')` respectively.

  To check if a number has a non-zero imaginary part, use:

  ```js
  let expr = ce.parse('5i');
  console.info(expr.isNumber && expr.isReal === false); // -> true
  ```

- **Collections**

  Support for collections has been improved. Collections include `List`, `Set`,
  `Tuple`, `Range`, `Interval`, `Linspace` and `Dictionary`.

  It is now possible to check if an element is contained in a collection using
  an `Element` expression. For example:

  ```js
  let expr = ce.parse('[1, 2, 3]');
  ce.box(['Element', 3, expr]).print(); // -> True
  ce.box(['Element', 5, expr]).print(); // -> False
  ```

  To check if a collection is a subset of another collection, use the `Subset`
  expression. For example:

  ```js
  ce.box(['Subset', 'Integers', 'RealNumbers']).print(); // -> True
  ```

  Collections can also be compared for equality. For example:

  ```js
  let set1 = ce.parse('\\lbrace 1, 2, 3 \\rbrace');
  let set2 = ce.parse('\\lbrace 3, 2, 1 \\rbrace');
  console.info(set1.isEqual(set2)); // -> true
  ```

  There are also additional convenience methods on boxed expressions:
  - `expr.isCollection`
  - `expr.contains(element)`
  - `expr.size`
  - `expr.isSubsetOf(other)`
  - `expr.indexOf(element)`
  - `expr.at(index)`
  - `expr.each()`
  - `expr.get(key)`

- **Exact calculations**

  The Compute Engine has a new backed for numerical calculations. The new backed
  can handle arbitrary precision calculations, including real and complex
  numbers. It can also handle exact calculations, preserving calculations with
  rationals and radicals (square root of integers). For example `1/2 + 1/3` is
  evaluated to `5/6` instead of `0.8(3)`.

  To get an approximate result, use the `N()` method, for example
  `ce.parse("\\frac12 + \\frac13").N()`.

  Previously the result of calculations was not always an exact number but
  returned a numerical approximation instead.

  This has now been improved by introducing a `NumericValue` type that
  encapsulates exact numbers and by doing all calculations in this type.
  Previously the calculations were handled manually in the various evaluation
  functions. This made the code complicated and error prone.

  A `NumericValue` is made of:
  - an imaginary part, represented as a fixed-precision number
  - a real part, represented either as a fixed or arbitrary precision number or
    as the product of a rational number and the square root of an integer.

  For example:
  - 234.567
  - 1/2
  - 3√5
  - √7/3
  - 4-3i

  While this is a significant change internally, the external API remains the
  same. The result of calculations should be more predictable and more accurate.

  One change to the public API is that the `expr.numericValue` property is now
  either a machine precision number or a `NumericValue` object.

- **Rule Wildcards**

  When defining a rule as a LaTeX expression, single character identifiers are
  interpreted as wildcards. For example, the rule `x + x -> 2x` will match any
  expression with two identical terms. The wildcard corresponding to `x` is
  `_x`.

  It is now possible to define sequence wildcards and optional sequence
  wildcards. Sequence wildcards match 1 or more expressions, while optional
  sequence wildcards match 0 or more expressions.

  They are indicated in LaTeX as `...x` and `...x?` respectively. For example:

  ```js
  expr.simplify("x + ...y -> 2x");
  ```

  If `expr` is `a + b + c` the rule will match and return `2a`

  ```js
  expr.simplify("x + ...y? -> 3x");
  ```

  If `expr` is `a + b + c` the rule will match and return `3a`. If `expr` is `a`
  the rule will match and return `3a`.

- **Conditional Rules**

  Rules can now include conditions that are evaluated at runtime. If the
  condition is not satisfied, the rules does not apply.

  For example, to simplify the expression `|x|`:

  ```js
  expr.simplify({rules: [
    "|x_{>=0}| -> x",
    "|x_{<0}| -> -x",
  ]});
  ```

  The condition is indicated as a subscript of the wildcard. The condition can
  be one of:
  - `boolean` - a boolean value, True or False
  - `string` - a string of characters
  - `number` - a number literal
  - `symbol`
  - `expression`

  - `numeric` - an expression that has a numeric value, i.e. 2√3, 1/2, 3.14
  - `integer` - an integer value, -2, -1, 0, 1, 2, 3, ...
  - `natural` - a natural number, 0, 1, 2, 3, ...
  - `real` - real numbers, including integers
  - `imaginary` - imaginary numbers, i.e. 2i, 3√-1 (not including real numbers)
  - `complex` - complex numbers, including real and imaginary
  - `rational` - rational numbers, 1/2, 3/4, 5/6, ...
  - `irrational` - irrational numbers, √2, √3, π, ...
  - `algebraic` - algebraic numbers, rational and irrational
  - `transcendental` - transcendental numbers, π, e, ...

  - `positive` - positive real numbers, \> 0
  - `negative` - negative real numbers, \< 0
  - `nonnegative` - nonnegative real numbers, \>= 0
  - `nonpositive` - nonpositive real numbers, \<= 0

  - `even` - even integers, 0, 2, 4, 6, ...
  - `odd` - odd integers, 1, 3, 5, 7, ...

  - `prime` :A000040 - prime numbers, 2, 3, 5, 7, 11, ...
  - `composite` :A002808 - composite numbers, 4, 6, 8, 9, 10, ...

  - `notzero` - a value that is not zero
  - `notone` - a value that is not one

  - `finite` - a finite value, not infinite
  - `infinite`

  - `constant`
  - `variable`

  - `function`

  - `operator`
  - `relation` - an equation or inequality
  - `equation`
  - `inequality`

  - `vector` - a tensor of rank 1
  - `matrix` - a tensor of rank 2
  - `list` - a collection of values
  - `set` - a collection of unique values
  - `tuple` - a fixed length list
  - `single` - a tuple of length 1
  - `pair` - a tuple of length 2
  - `triple` - a tuple of length 3
  - `collection` - a list, set, or tuple
  - `tensor` - a nested list of values of the same type
  - `scalar` - not a tensor or list

  or one of the following expressions:
  - `>0'` -> `positive`,
  - `\gt0'` -> `positive`,
  - `<0'` -> `negative`,
  - `\lt0'` -> `negative`,
  - `>=0'` -> `nonnegative`,
  - `\geq0'` -> `nonnegative`,
  - `<=0'` -> `nonpositive`,
  - `\leq0'` -> `nonpositive`,
  - `!=0'` -> `notzero`,
  - `\neq0'` -> `notzero`,
  - `!=1'` -> `notone`,
  - `\neq1'` -> `notone`,
  - `\in\Z'` -> `integer`,
  - `\in\mathbb{Z}'` -> `integer`,
  - `\in\N'` -> `natural`,
  - `\in\mathbb{N}'` -> `natural`,
  - `\in\R'` -> `real`,
  - `\in\mathbb{R}'` -> `real`,
  - `\in\C'` -> `complex`,
  - `\in\mathbb{C}'` -> `complex`,
  - `\in\Q'` -> `rational`,
  - `\in\mathbb{Q}'` -> `rational`,
  - `\in\Z^+'` -> `integer,positive`,
  - `\in\Z^-'` -> `intger,negative`,
  - `\in\Z^*'` -> `nonzero`,
  - `\in\R^+'` -> `positive`,
  - `\in\R^-'` -> `negative`,
  - `\in\R^*'` -> `real,nonzero`,
  - `\in\N^*'` -> `integer,positive`,
  - `\in\N_0'` -> `integer,nonnegative`,
  - `\in\R\backslash\Q'` -> `irrational`,

  More complex conditions can be specified following a semi-colon, for example:

  ```js
  expr.simplify({x -> 2x; x < 10});
  ```

  Note that this syntax complements the existing rule syntax, and can be used
  together with the existing, more verbose, rule syntax.

  ```js
  expr.simplify({rules: [
    {match: "x + x", replace: "2x", condition: "x < 10"}
  ]});
  ```

  This advanced syntax can specify more complex conditions, for example above
  the rule will only apply if `x` is less than 10.

- Improved results for `Expand`. In some cases the expression was not fully
  expanded. For example, `4x(3x+2)-5(5x-4)` now returns `12x^2 - 17x + 20`.
  Previously it returned `4x(3x+2)+25x-20`.

- **AsciiMath serialization** The `expr.toString()` method now returns a
  serialization of the expression using the [AsciiMath](https://asciimath.org/)
  format.

  The serialization to AsciiMath can be customized using the `toAsciiMath()`
  method. For example:

  ```js
  console.log(ce.box(['Sigma', 2]).toAsciiMath({functions: {Sigma: 'sigma'}}));
  // -> sigma(2)
  ```

- The tolerance can now be specified with a value of `"auto"` which will use the
  precision to determine a reasonable tolerance. The tolerance is used when
  comparing two numbers for equality. The tolerance can be specified with the
  `ce.tolerance` property or in the Compute Engine constructor.

- Boxed expressions have some additional properties:
  - `expr.isNumberLiteral` - true if the expression is a number literal.This is
    equivalent to checking if `expr.numericValue` is not `null`.
  - `expr.re` - the real part of the expression, if it is a number literal,
    `undefined` if not a number literal.
  - `expr.im` - the imaginary part of the expression, if it is a number literal,
    `undefined` if not a number literal.
  - `expr.bignumRe` - the real part of the expression as a bignum, if it is a
    number literal, `undefined` if not a number literal or a bignum
    representation is not available.
  - `expr.bignumIm` - the imaginary part of the expression as a bignum, if it is
    a number literal, `undefined` if not a number literal or if a bignum
    representation is not available.
  - `expr.root()` to get the root of the expression. For example, `expr.root(3)`
    will return the cube root of the expression.
  - Additionally, the relational operators (`expr.isLess(), expr.isEqual()`,
    etc...) now accept a number argument. For example, `expr.isGreater(1)` will
    return true if the expression is greater than 1.

- Added LaTeX syntax to index collections. If `a` is a collection:
  - `a[i]` is parsed as `["At", "a", "i"]`.
  - `a[i,j]` is parsed as `["At", "a", "i", "j"]`.
  - `a_i` is parsed as `["At", "a", "i"]`.
  - `a_{i,j}` is parsed as `["At", "a", "i", "j"]`.

- Added support for Kronecker delta notation, i.e. `\delta_{ij}`, which is
  parsed as `["KroneckerDelta", "i", "j"]` and is equal to 1 if `i = j` and 0
  otherwise.

  When a single index is provided the value of the function is 1 if the index is
  0 and 0 otherwise

  When multiple index are provided, the value of the function is 1 if all the
  indexes are equal and 0 otherwise.

- Added support for Iverson Bracket notation, i.e. `[a = b]`, which is parsed as
  `["Boole", ["Equal", "a", "b"]]` and is equal to 1 if its argument is true and
  0 otherwise. The argument is expected to be a relational expression.

- Implemented `Unique` and `Tally` on collections. `Unique` returns a collection
  with only the unique elements of the input collection, and `Tally` returns a
  collection with the count of each unique element.

  ```js
  console.log(ce.box(['Unique', ['List', 1, 2, 3, 1, 2, 3, 4, 5]]).value);
  // -> [1, 2, 3, 4, 5]

  console.log(ce.box(['Tally', ['List', 1, 2, 3, 1, 2, 3, 4, 5]]).value);
  // -> [['List', 1, 2, 3, 4, 5], ['List', 2, 2, 2, 1, 1]]
  ```

- Implemented the `Map`, `Filter` and `Tabulate` functions. These functions can
  be used to transform collections, for example:

  ```js
  // Using LaTeX
  console.log(ce.parse('\\mathrm{Map}([3, 5, 7], x \\mapsto x^2)').toString());
  // -> [9, 25, 49]

  // Using boxed expressions
  console.log(
    ce.box(['Map', ['List', 3, 5, 7], ['Square', '_']]).value
  );
  // -> [9, 25, 49]

  console.log(ce.box(['Tabulate',['Square', '_'], 5]).value);
  // -> [1, 4, 9, 16, 25]
  ```

  `Tabulate` can be used with multiple indexes. For example, to generate a 4x4
  unit matrix:

  ```js
  console.log(ce.box(['Tabulate', ['If', ['Equal', '_1', '_2'], 1, 0]], 4, 4).value);
  // -> [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

  // Using the Kronecker delta notation:
  console.log(ce.parse('\\mathrm{Tabulate}(i, j \\mapsto \\delta_{ij}, 4, 4)').value);
  // -> [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

  ```

- Added `Random` function. `["Random"]` returns a real pseudo-random number
  betwen 0 and 1. `["Random", 10]` returns an integer between 0 and 9,
  `["Random", 5, 10]` returns an integer between 5 and 10.

- Extended the definition of `expr.isConstant`. Previously, it only applied to
  symbols, e.g. `Pi`. Now it apply to all expressions. `expr.isConstant` is true
  if the expression is a number literal, a symbol with a constant value, or a
  pure function with constant arguments.

- The boxed expression properties `isPositive`, `isNegative`, `isNonNegative`,
  `isNonPositive`, `isZero`, `isNotZero` now return a useful value for most
  function expressions. For example, `ce.parse('|x + 1|').isPositive` is true.

  If the value cannot be determined, the property will return `undefined`. For
  example, `ce.parse('|x + 1|').isZero` is `undefined`.

  If the expression is not a real number, the property will return `NaN`. For
  example, `ce.parse('i').isPositive` is `NaN`.

- Added `Choose` function to compute binomial coefficients, i.e. `Choose(5, 2)`
  is equal to 10.

- The fallback for non-constructible complex values of trigonometric functions
  is now implemented via rules.

- The canonical order of the arguments has changed and should be more consistent
  and predictable. In particular, for polynomials, the
  [monomial order](https://en.wikipedia.org/wiki/Monomial_order) is now
  **degrevlex**.

- Canonical expressions can now include a `Root` expression. For example, the
  canonical form of `\\sqrt[3]{5}` is `["Root", 5, 3]`. Previously, these were
  represented as `["Power", 5, ["Divide", 1, 3]]`.

- The function definitions no longer have a `N` handler. Instead the `evaluate`
  handler has an optional `{numericApproximation}` argument.

### Issues Resolved

- **#188** Throw an error when invalid expressions are boxed, for example
  `ce.box(["Add", ["3"]])`.

- Some LaTeX renderer can't render `\/`, so use `/` instead.

- When definitions are added to the LaTeX dictionary, they now take precedence
  over the built-in definitions. This allows users to override the built-in
  definitions.

- Improved parsing of functions, including when a mixture of named and
  positional arguments are used.

- **#175** Matching some patterns when the target had not enough operands would
  result in a runtime error.

## 0.25.1 _2024-06-27_

### Issues Resolved

- **#174** Fixed some simplifications, such as `\frac{a^n}{a^m} = a^{n-m)`

### New Features

- Rules can be defined using a new shorthand syntax, where each rule is a string
  of LaTeX:

  ```js
  expr.simplify(["\\frac{x}{x} -> 1", "x + x -> 2x"]);
  ```

Single letter variables are assumed to be wildcards, so `x` is interpreted as
the wildcard `_x`.

Additionally, the expanded form can also include LaTeX strings. The previous
syntax using expressions can still be used, and the new and old syntax can be
mixed.

For example:

```js
expr.simplify([
  {
    match: "\\frac{x}{x}",
    replace: "1"
  },
  {
    match: ["Add", "x", "x"],
    replace: "2x"
  }
]);
```

The `condition` function can also be expressed as a LaTeX string.

```js
  expr.simplify([ { match: "\\frac{x}{x}", replace: 1, condition: "x != 0" }, ]);
```

The shorthand syntax can be used any where a ruleset is expected, including with
the `ce.rule()` function.

- A new `ce.getRuleSet()` method gives access to the built-in rules.
- **#171** The `Subtract` and `Divide` function can now accept an arbitrary
  number of arguments. For example, `["Subtract", 1, 2, 3]` is equivalent to
  `["Subtract", ["Subtract", 1, 2], 3]`.

## 0.25.0 _2024-06-25_

### Breaking Changes

- The canonical form of expressions has changed. It is now more consistent and
  simpler and should produce more predictable results.

  For example, previously `ce.parse("1-x^2")` would produce
  `["Subtract", 1, ["Square", "x"]]`.

  While this is a readable form, it introduces some complications when
  manipulating the expression: both the `Subtract` and `Square` functions have
  to be handled, in addition to `Add` and `Power`.

  The new canonical form of this expression is
  `["Add", 1, ["Negate", ["Power", "x", 2]]]`. It is a bit more verbose, but it
  is simpler to manipulate.

- The `ce.serialize()` method has been replaced with `expr.toLatex()` and
  `expr.toMathJson()`. The `ce.latexOptions` and `ce.jsonSerializationOptions`
  properties have been removed. Instead, pass the formating options directly to
  the `toLatex()` and `toMathJson()` methods. The `ce.parse()` method now takes
  an optional argument to specify the format of the input string.

- The default JSON serialization of an expression has changed.

  Previously, the default JSON serialization, accessed via the `.json` property,
  had some transformations applied to it (sugaring) to make the JSON more human
  readable.

  For example, `ce.parse("\frac12").json` would return the symbol `"Half"`
  instead of `["Divide", 1, 2]`.

  However, this could lead to some confusion when manipulating the JSON
  directly. Since the JSON is intended to be used by machine more than humans,
  these additional transformations have been removed.

  The `expr.json` property now returns the JSON representing the expression,
  without any transformations.

  To get a version of JSON with some transformations applied use the
  `ce.toMathJson()` function.

  ```js
  expr = ce.box(["Subtract", 1, ["Square", "x"]]);
  console.log(expr.json);
  // -> ["Add", 1, ["Negate", ["Power", "x", 2]]]
  expr.toMathJson()
  // -> ["Subtract", 1, ["Square", "x"]]
  expr.toMathJson({exclude: "Square"})
  // -> ["Subtract", 1, ["Power", "x", 2]]
  ```

  In practice, the impact of both of these changes should be minimal. If you
  were manipulating expressions using `BoxedExpression`, the new canonical form
  should make it easier to manipulate expressions. You can potentially simplify
  your code by removing special cases for functions such as `Square` and
  `Subtract`.

  If you were using the JSON serialization directly, you may also be able to
  simplify you code since the default output from `expr.json` is now more
  consistent and simpler.

- The name of some number formatting options has changed. The number formatting
  options are an optional argument of `ce.parse()` and `ce.toLatex()`. See the
  `NumberFormat` and `NumberSerializationFormat` types.

- The values +infinity, -infinity and NaN are now represented preferably with
  the symbols `PositiveInfinity`, `NegativeInfinity` and `NaN` respectively.
  Previously they were represented with numeric values, i.e.
  `{num: "+Infinity"}`, `{num: "-Infinity"}` and `{num: "NaN"}`. The numeric
  values are still supported, but the symbols are preferred.

- The method `expr.isNothing` has been removed. Instead, use
  `expr.symbol === "Nothing"`.

### New Features

- When serializing to LaTeX, the output can be "prettified". This involves
  modifying the LaTeX output to make it more pleasant to read, for example:
  - `a+\\frac{-b}{c}` -> `a-\\frac{b}{c}`
  - `a\\times b^{-1}` -> `\\frac{a}{b}`
  - `\\frac{a}{b}\\frac{c}{d}` -> `\\frac{a\\cdot c}{b\\cdot d}`
  - `--2` -> `2`

  This is on by default and can be turned off by setting the `prettify` option
  to `false`. For example:

  ```js
  ce.parse("a+\\frac{-b}{c}").toLatex({prettify: true})
  // -> "a-\\frac{b}{c}"
  ce.parse("a+\\frac{-b}{c}").toLatex({prettify: false})
  // -> "a+\\frac{-b}{c}"
  ```

- Numbers can have a different digit group length for the whole and fractional
  part of a number. For example,
  `ce.toLatex(ce.parse("1234.5678"), {digitGroup: [3, 0]})` will return
  `1\,234.5678`.
- Numbers can now be formatted using South-East Asian Numbering System, i.e.
  lakh and crore. For example:

  ```js
  ce.toLatex(ce.parse("12345678"), {digitGroup: "lakh"})
  // -> "1,23,45,678"
  ```

- Expressions with Integrate functions can now be compiled to JavaScript. The
  compiled function can be used to evaluate the integral numerically. For
  example:

  ```js
  const f = ce.parse("\\int_0^1 x^2 dx");
  const compiled = f.compile();
  console.log(compiled()); // -> 0.33232945619482307
  ```

- **#82** Support for angular units. The default is radians, but degrees can be
  used by setting `ce.angularUnit = "deg"`. Other possible values are "grad" and
  "turn". This affects how unitless numbers with a trigonometric function are
  interpreted. For example, `sin(90)` will return 1 when `ce.angularUnit` is
  "deg", 0.8939966636005579 when `ce.angularUnit` is "grad" and 0 when
  `ce.angularUnit` is "turn".
- Added `expr.map(fn)` method to apply a function to each subexpression of an
  expression. This can be useful to apply custom canonical forms and compare two
  expressions.
- An optional canonical form can now be specified with the `ce.function()`.

### Issues Resolved

- **#173** Parsing `1++2` would result in an expression with a `PreIncrement`
  function. It is now correctly parsed as `["Add", 1, 2]`.
- **#161** Power expressions would not be processed when their argument was a
  Divide expression.
- **#165** More aggressive simplification of expressions with exponent greater
  than 3.
- **#169** Calculating a constant integral (and integral that did not depend on
  the variable) would result in a runtime error.
- **#164** Negative mixed fractions (e.g. `-1\frac23`) are now parsed correctly.
- **#162** Numeric evaluation of expressions with large exponents could result
  in machine precision numbers instead of bignum numbers.
- **#155** The expression
  `["Subtract", ["Multiply", 0.5, "x"], ["Divide", "x", 2]]` will now evaluate
  to `0`.
- **#154** In some cases, parsing implicit argument of trig function return more
  natural results, for example `\cos a \sin b` is now parsed as
  `(\cos a)(\sin b)` and not `\cos (a \sin b)`.
- **#147** The associativity of some operators, including `/` was not applied
  correctly, resulting in unexpected results. For example, `1/2/3` would be
  parsed as `["Divide", 1, ["Divide", 2, 3]]` instead of
  `["Divide", ["Divide", 1, 2], 3]`.
- **#146** When parsing an expression like `x(x+1)` where `x` is an undeclared
  symbol, do not infer that `x` is a function. Instead, infer that `x` is a
  variable and that the expression is a product.
- **#145** The expression `["Or", "False", "False"]`, that is when all the
  arguments are `False`, is now evaluates to `False`.
- Fixed canonical form of `e^x^2`, and more generally apply power rule in more
  cases.
- Added missing "Sech" and "Csch" functions.
- The digit grouping serializing would place the separator in the wrong place
  for some numbers.
- The `avoidExponentsInRange` formating option would not always avoid exponents
  in the specified range.

## 0.24.0 _2024-02-23_

### Issues Resolved

- Fix parsing of very deeply nested expressions.
- Correctly apply rules to deeply nested expressions.
- `expr.print()` now correctly prints the expression when using the minified
  version of the library.
- `expr.isEqual()` now correctly compares equalities and inequalities.
- `expr.match()` has been improved and works correctly in more cases. The
  signature of the `match` function has been changed so that the pattern is the
  first argument, i.e. instead of `pattern.match(expr)` use
  `expr.match(pattern)`.
- Fix `expr.print()` when using the minified version of the library.
- **#142** Accept complex expressions as the subcript of `\ln` and `\log` in
  LaTeX.
- **#139** Parse quantifiers `\forall` and `\exists` in LaTeX.

## 0.23.1 _2024-01-27_

### Issues Resolved

- Using a custom canonical order of `"Multiply"` would not distribute the
  `Negate` function.
- **#141** The canonical form `"Order"` was applied to non-commutative
  functions.

## 0.23.0 _2024-01-01_

### New Features

- Added `ExpandAll` function to expand an expression recursively.
- Added `Factor` function to factor an expression.
- Added `Together` function to combine rational expressions into a single
  fraction.

### Issues Resolved

- The expression `\frac5 7` is now parsed correctly as `\frac{5}{7}` instead of
  `\frac{5}{}7`.
- Do not sugar non-canonical expression. Previously,
  `ce.parse('\\frac{1}{2}', {canonical: false})` would return `Half` instead of
  `['Divide', '1', '2']`.
- **#132** Attempting to set a value to 0 with
  `ce.defineSymbol("count", {value: 0})` would fail: the symbol would be
  undefined.
- Correctly evaluate power expressions in some cases, for example
  `(\sqrt2 + \sqrt2)^2`.
- Comparison of expressions containing non-exact numbers could fail. For
  example: `2(13.1+3.1x)` and `26.2+6.2x` would not be considered equal.

### Improvements

- Significant improvements to symbolic computation. Now, boxing,
  canonicalization and evaluation are more consistent and produce more
  predictable results.
- Adedd the `\neg` command, synonym for `\lnot` -> `Not`.
- Relational expressions (inequalities, etc...) are now properly factored.
- Integers are now factored when simplifying, i.e. `2x = 4x` -> `x = 2x`.

## 0.22.0 _2023-11-13_

### Breaking Changes

- **Rule Syntax**

  The syntax to describe rules has changed. The syntax for a rule was previously
  a tuple `[lhs, rhs, {condition} ]`. The new syntax is an object with the
  properties `match`, `replace` and `condition`. For example:
  - previous syntax: `[["Add", "_x", "_x"], ["Multiply", 2, "_x"]]`
  - new syntax: `{match: ["Add", "_x", "_x"], replace: ["Multiply", 2, "_x"]}`

  The `condition` property is optional, and is either a boxed function or a
  JavaScript function. For example, to add a condition that checks that `_x` is
  a number literal:

  ```js
  {
    match: ["Add", "_x", "_x"],
    replace: ["Multiply", 2, "_x"],
    condition: ({_x}) => _x.isNumberLiteral
  }
  ```

- **`CanonicalForm`**

  The `CanonicalOrder` function has been replaced by the more flexible
  `CanonicalForm` function. The `CanonicalForm` function takes an expression and
  a list of transformations to apply. To apply the same transformations as
  `CanonicalOrder`, use:

  ```json
  ['CanonicalForm', expr, 'Order']
  ```

  These canonical forms can also be specified with `box()` and `parse()`
  options:

  ```js
  ce.box(expr, { canonical: "Order" });
  ce.parse("x^2 + 2x + 1", { canonical: "Order" });
  ```

### Work In Progress

- Linear algebra functions: `Rank`, `Shape`,`Reshape`, `Flatten`, `Determinant`,
  `Trace`, `Transpose`, `ConjugateTranspose`, `Inverse`. See the
  [Linear Algebra](/compute-engine/reference/linear-algebra/) reference guide.
  Some of these function may not yet return correct result in all cases.

### New Features

- Added a `expr.print()` method as a synonym for `console.log(expr.toString())`.
- Added an `exact` option (false by default) to the `expr.match()` pattern
  matching method. When `true` some additional patterns are automatically
  recognized, for example, `x` will match `["Multiply", '_a', 'x']` when `exact`
  is `false`, but not when `exact` is `true`.

### Improvements

- The equation solver used by `expr.solve()` has been improved and can now solve
  more equations.
- The pattern matching engine has been improved and can now match more
  expressions, including sequences for commutative functions.

## 0.21.0 _2023-11-02_

### New Features

- **#125** Parse and serialize environemnts, i.e.
  `\begin{matrix} 1 & 2 \\ 3 & 4 \end{matrix}` will be parsed as
  `["Matrix", ["List", ["List", 1, 2], ["List", 3, 4]]]`.

  A new section on
  [Linear Algebra](/compute-engine/reference/linear-algebra/#formatting) has
  some details on the supported formats.

  The linear algebra operations are limited at the moment, but will be expanded
  in the future.

- Added `IsSame` function, which is the function expression corresponding to
  `expr.isSame()`.
- <s>Added `CanonicalOrder` function, which sorts the arguments of commutative
  functions into canonical order. This is useful to compare two non-canonical
  expressions for equality.</s>

```js
ce.box(["CanonicalOrder", ["Add", 1, "x"]]).isSame(
  ce.box(["CanonicalOrder", ["Add", "x", 1]])
);
// -> true
```

### Issue Resolved

- When evaluating a sum (`\sum`) with a bound that is not a number, return the
  sum expression instead of an error.

## 0.20.2 _2023-10-31_

### Issues Resolved

- Fixed numerical evaluation of integrals and limits when parsed from LaTeX.

```js
console.info(ce.parse("\\lim_{x \\to 0} \\frac{\\sin(x)}{x}").value);
// -> 1

console.info(ce.parse("\\int_{0}^{2} x^2 dx").value);
// -> 2.6666666666666665
```

## 0.20.1 _2023-10-31_

### Issues Resolved

- Fixed evaluation of functions with multiple arguments
- Fixed compilation of some function assignments
- Improved serialization of function assignment

## 0.20.0 _2023-10-30_

### Breaking Changes

- **Architectural changes**: the invisible operator is used to represent the
  multiplication of two adjacent symbols, i.e. `2x`. It was previously handled
  during parsing, but it is now handled during canonicalization. This allows
  more complex syntactic structures to be handled correctly, for example
  `f(x) := 2x`: previously, the left-hand-side argument would have been parsed
  as a function application, while in this case it should be interpreted as a
  function definition.

  A new `InvisibleOperator` function has been added to support this.

  The `applyInvisibleOperator` parsing option has been removed. To support
  custom invisible operators, use the `InvisibleOperator` function.

### Issues Resolved

- **#25** Correctly parse chained relational operators, i.e. `a < b <= c`
- **#126** Logic operators only accepted up to two arguments.
- **#127** Correctly compile `Log` with bases other than 10.
- Correctly parse numbers with repeating patterns but no fractional digits, i.e.
  `0.(1234)`
- Correctly parse `|1+|a|+2|`

### New Features and Improvements

- Function assignment can now be done with this syntax: `f(x) := 2x+1`. This
  syntax is equivalent to `f := x -> 2x+1`.
- Implement the `Mod` and `Congruent` function.
- Correctly parse `11 \bmod 5` (`Mod`) and `26\equiv 11 \pmod5` (`Congruent`)
- Better handle empty argument lists, i.e. `f()`
- When a function is used before being declared, infer that the symbol is a
  function, e.g. `f(12)` will infer that `f` is a function (and not a variable
  `f` multiplied by 12)
- When a constant is followed by some parentheses, don't assume this is a
  function application, e.g. `\pi(3+n)` is now parsed as
  `["Multiply", "Pi", ["Add", 3, "n"]]` instead of `["Pi", ["Add", 3, "n"]]`
- Improved parsing of nested lists, sequences and sets.
- Improved error messages when syntax errors are encountered during LaTeX
  parsing.
- When parsing with the canonical option set to false, preserve more closely the
  original LaTeX syntax.
- When parsing text strings, convert some LaTeX commands to Unicode, including
  spacing commands. As a result, `ce.parse("\\text{dead\;beef}_{16}")` correctly
  gets evaluated to 3,735,928,559.

## 0.19.1 _2023-10-26_

### Issues Resolved

- Assigning a function to an indentifier works correctly now, i.e.

```js
ce.parse("\\operatorname{f} := x \\mapsto 2x").evaluate();
```

## 0.19.0 _2023-10-25_

### Breaking Changes

- The `domain` property of the function definition `signature` is deprecated and
  replaced with the `params`, `optParams`, `restParam` and `result` properties
  instead. The `domain` property is still supported for backward compatibility,
  but will be removed in a future version.

### Issues Resolved

- When invoking a declared function in a numeric operation, correctly infer the
  result type.

```json
["Assign", "f", ["Add", "_", 1]]
["Add", ["f", 1], 1]
// -> 3
```

Previously a domain error was returned, now `f` is inferred to have a numeric
return type.

- Fixed a runtime error when inverting a fraction, i.e. `\frac{3}{4}^{-1}`
- The tangent of π/2 now correctly returns `ComplexInfinity`.
- The exact values of some constructible trigonometric operations (e.g.
  `\tan 18\degree = \frac{\sqrt{25-10\sqrt5}}{5}`) returned incorrect results.
  The unit test case was incorrect and did not detect the problem. The unit test
  case has been fixed and the returned values are now correct.

### New Features

- Implemented `Union` and `Intersection` of collections, for example:

```json
["Intersection", ["List", 3, 5, 7], ["List", 2, 5, 9]]
// -> ["Set", 5]

["Union", ["List", 3, 5, 7], ["List", 2, 5, 9]]
// -> ["Set", 3, 5, 7, 2, 9]
```

- Parse ranges, for example `1..5` or `1, 3..10`. Ranges are collections and can
  be used anywhere collections can be used.

- The functions `Sum`, `Product`, `Min`, `Max`, and the statistics functions
  (`Mean`, `Median`, `Variance`, etc...) now handle collection arguments:
  collections:
  - `["Range"]`, `["Interval"]`, `["Linspace"]` expressions
  - `["List"]` or `["Set"]` expressions
  - `["Tuple"]`, `["Pair"]`, `["Pair"]`, `["Triple"]` expressions
  - `["Sequence"]` expressions

- Most mathematical functions are now threadable, that is their arguments can be
  collections, for example:

```json
["Sin", ["List", 0, 1, 5]]
// -> ["List", 0, 0.8414709848078965, -0.9589242746631385]

["Add", ["List", 1, 2], ["List", 3, 4]]
// -> ["List", 4, 6]
```

- Added `GCD` and `LCM` functions

```json
["GCD", 10, 5, 15]
// -> 5

["LCM", 10, 5, 15]
// -> 30
```

- Added `Numerator`, `Denominator`, `NumeratorDenominator` functions. These
  functions can be used on non-canonical expressions.

- Added `Head` and `Tail` functions which can be used on non-canonical
  expressions.

- Added `display-quotient` and `inline-quotient` style for formatting of
  division expressions in LaTeX.

### Improvements

- Improved parsing of `\degree` command

```js
ce.parse("30\\degree)
// -> ["Divide", "Pi", 6]
```

- Improved interoperability with JavaScript: `expr.value` will return a
  JavaScript primitive (`number`, `boolean`, `string`, etc...) when possible.
  This is a more succinct version of `expr.N().valueOf()`.

## 0.18.1 _2023-10-16_

### Issues Resolved

- Parsing of whole numbers while in `rational` mode would return incorrect
  results.
- The `ND` function to evaluate derivatives numerically now return correct
  values.

```js
ce.parse("\\mathrm{ND}(x \\mapsto 3x^2+5x+7, 2)").N();
// -> 17.000000000001
```

### Improvements

- Speed up `NIntegrate` by temporarily switching the numeric mode to `machine`
  while computing the Monte Carlo approximation.

## 0.18.0 _2023-10-16_

### New Features

- Expanded LaTeX dictionary with `\max`, `\min`, `\sup`, `\inf` and `\lim`
  functions
- Added `Supremum` and `Infimum` functions
- Compilation of `Block` expressions, local variables, return statements and
  conditionals `If`.
- Added numerical evaluation of limits with `Limit` functions and `NLimit`
  functions, using a Richardson Extrapolation.

```js
console.info(ce.parse("\\lim_{x\\to0} \\frac{\\sin x}{x}").N().json);
// -> 1

console.info(
  ce.box(["NLimit", ["Divide", ["Sin", "_"], "_"], 0]).evaluate().json
);
// -> 1

console.info(ce.parse("\\lim_{x\\to \\infty} \\cos \\frac{1}{x}").N().json);
// -> 1
```

- Added `Assign` and `Declare` functions to assign values to symbols and declare
  symbols with a domain.

- `Block` evaluations with local variables work now. For example:

```js
ce.box(["Block", ["Assign", "c", 5], ["Multiply", "c", 2]]).evaluate().json;
// -> 10
```

- When decimal numbers are parsed they are interpreted as inexact numbers by
  default, i.e. "1.2" -> `{num: "1.2"}`. To force the number to be interpreted
  as a rational number, set `ce.latexOptions.parseNumbers = "rational"`. In that
  case, "1.2" -> `["Rational", 12, 10]`, an exact number.

  While regular decimals are considered "inexact" numbers (i.e. they are assumed
  to be an approximation), rationals are assumed to be exact. In most cases, the
  safest thing to do is to consider decimal numbers as inexact to avoid
  introducing errors in calculations. If you know that the decimal numbers you
  parse are exact, you can use this option to consider them as exact numbers.

### Improvements

- LaTeX parser: empty superscripts are now ignored, e.g. `4^{}` is interpreted
  as `4`.

## 0.17.0 _2023-10-12_

### Breaking Changes

- The `Nothing` domain has been renamed to `NothingDomain`
- The `Functions`, `Maybe`, `Sequence`, `Dictionary`, `List` and `Tuple` domain
  constructors have been renamed to `FunctionOf`, `OptArg`, `VarArg`,
  `DictionaryOf`, `ListOf` and `TupleOf`, respectively.
- Domains no longer require a `["Domain"]` expression wrapper, so for example
  `ce.box("Pi").domain` returns `"TranscendentalNumbers"` instead of
  `["Domain", "TranscendentalNumbers"]`.
- The `VarArg` domain constructor now indicates the presence of 0 or more
  arguments, instead of 1 or more arguments.
- The `MaybeBooleans` domain has been dropped. Use
  `["Union", "Booleans", "NothingDomain"]` instead.
- The `ce.defaultDomain` has been dropped. The domain of a symbol is now
  determined by the context in which it is used, or by the `ce.assume()` method.
  In some circumstances, the domain of a symbol can be `undefined`.

### New Features

- Symbolic derivatives of expressions can be calculated using the `D` function.
  For example, `ce.box(["D", ce.parse("x^2 + 3x + 1"), "x"]).evaluate().latex`
  returns `"2x + 3"`.

### Improvements

- Some frequently used expressions are now available as predefined constants,
  for example `ce.Pi`, `ce.True` and `ce.Numbers`.
- Improved type checking and inference, especially for functions with
  complicated or non-numeric signatures.

### Bugs Fixed

- Invoking a function repeatedly would invoke the function in the original scope
  rather than using a new scope for each invocation.

## 0.16.0 _2023-09-29_

### Breaking Changes

- The methods `ce.let()` and `ce.set()` have been renamed to `ce.declare()` and
  `ce.assign()` respectively.
- The method `ce.assume()` requires a predicate.
- The signatures of `ce.assume()` and `ce.ask()` have been simplified.
- The signature of `ce.pushScope()` has been simplified.
- The `expr.freeVars` property has been renamed to `expr.unknowns`. It returns
  the identifiers used in the expression that do not have a value associated
  with them. The `expr.freeVariables` property now return the identifiers used
  in the expression that are defined outside of the local scope and are not
  arguments of the function, if a function.

### New Features

- **Domain Inference** when the domain of a symbol is not set explicitly (for
  example with `ce.declare()`), the domain is inferred from the value of the
  symbol or from the context of its usage.

- Added `Assume`, `Identity`, `Which`, `Parse`, `N`, `Evaluate`, `Simplify`,
  `Domain`.

- Assignments in LaTeX: `x \\coloneq 42` produce `["Assign", "x", 42]`

- Added `ErfInv` (inverse error function)

- Added `Factorial2` (double factorial)

#### Functions

- Functions can now be defined:
  - using `ce.assign()` or `ce.declare()`
  - evaluating LaTeX: `(x, y) \mapsto x^2 + y^2`
  - evaluating MathJSON:
    `["Function", ["Add", ["Power", "x", 2], ["Power", "y", 2]]], "x", "y"]`

- Function can be applied using `\operatorname{apply}` or the operators `\rhd`
  and `\lhd`:
  - `\operatorname{apply}(f, x)`
  - `f \rhd x`
  - `x \lhd f`

See
[Adding New Definitions](https://cortexjs.io/compute-engine/guides/augmenting/)
and [Functions](https://cortexjs.io/compute-engine/reference/functions/).

#### Control Structures

- Added `FixedPoint`, `Block`, `If`, `Loop`
- Added `Break`, `Continue` and `Return` statements

See
[Control Structures](https://cortexjs.io/compute-engine/reference/control-structures/)

#### Calculus

- Added numeric approximation of derivatives, using an 8-th order centered
  difference approximation, with the `ND` function.
- Added numeric approximation of integrals, using a Monte Carlo method with
  rebasing for improper integrals, with the `NIntegrate` function
- Added symbolic calculation of derivatives with the `D` function.

#### Collections

Added support for **collections** such as lists, tuples, ranges, etc...

See [Collections](https://cortexjs.io/compute-engine/reference/collections/)

Collections can be used to represent various data structures, such as lists,
vectors, matrixes and more.

They can be iterated, sliced, filtered, mapped, etc...

```json example
["Length", ["List", 19, 23, 5]]
// -> 3

["IsEmpty", ["Range", 1, 10]]
// -> "False"

["Take", ["Linspace", 0, 100, 50], 4]
// -> ["List", 0, 2, 4, 6]

["Map", ["List", 1, 2, 3], ["Function", "x", ["Power", "x", 2]]]
// -> ["List", 1, 4, 9]

["Exclude", ["List", 33, 45, 12, 89, 65], -2, 2]
// -> ["List", 33, 12, 65]


["First", ["List", 33, 45, 12, 89, 65]]
// -> 33
```

### Improvements

- The [documentation](https://cortexjs.io/compute-engine/) has been
  significantly rewritten with help from an AI-powered writing assistant.

### Issues Resolved

- The LaTeX string returned in `["Error"]` expression was incorrectly tagged as
  `Latex` instead of `LatexString`.

## 0.15.0 _2023-09-14_

### Improvements

- The `ce.serialize()` function now takes an optional `canonical` argument. Set
  it to `false` to prevent some transformations that are done to produce more
  readable LaTeX, but that may not match exactly the MathJSON. For example, by
  default `ce.serialize(["Power", "x", -1])` returns `\frac{1}{x}` while
  `ce.serialize(["Power", "x", -1], {canonical: false})` returns `x^{-1}`.
- Improved parsing of delimiters, i.e. `\left(`, `\right]`, etc...
- Added complex functions `Real`, `Imaginary`, `Arg`, `Conjugate`, `AbsArg`. See
  [Complex](https://cortexjs.io/compute-engine/reference/complex/)
- Added parsing and evaluation of `\Re`, `\Im`, `\arg`, `^\star` (Conjugate).
- **#104** Added the `["ComplexRoots", x, n]` function which returns the nthroot
  of `x`.
- Added parsing and evaluation of statistics functions `Mean`, `Median`,
  `StandardDeviation`, `Variance`, `Skewness`, `Kurtosis`, `Quantile`,
  `Quartiles`, `InterquartileRange`, `Mode`, `Count`, `Erf`, `Erfc`. See
  [Statistics](https://cortexjs.io/compute-engine/reference/statistics/)

## 0.14.0 _2023-09-13_

### Breaking Changes

- The entries in the LaTeX syntax dictionary can now have LaTeX triggers
  (`latexTrigger`) or triggers based on identifiers (`symbolTrigger`). The
  former replaces the `trigger` property. The latter is new. An entry with a
  `triggerIdentifier` of `average` will match `\operatorname{average}`,
  `\mathrm{average}` and other variants.
- The `ce.latexOptions` and `ce.jsonSerializationOptions` properties are more
  robust. They can be modified directly or one of their properties can be
  modified.

### Improvements

- Added more functions and symbols supported by `expr.compile()`:
  - `Factorial` postfix operator `5!`
  - `Gamma` function `\Gamma(2)`
  - `LogGamma` function `\operatorname{LogGamma}(2)`
  - `Gcd` function `\operatorname{gcd}(20, 5)`
  - `Lcm` function `\operatorname{lcm}(20, 5)`
  - `Chop` function `\operatorname{chop}(0.00000000001)`
  - `Half` constant `\frac{1}{2}`
  - 'MachineEpsilon' constant
  - `GoldenRatio` constant
  - `CatalanConstant` constant
  - `EulerGamma` constant `\gamma`
  - `Max` function `\operatorname{max}(1, 2, 3)`
  - `Min` function `\operatorname{min}(13, 5, 7)`
  - Relational operators: `Less`, `Greater`, `LessEqual`, `GreaterEqual`,
    'Equal', 'NotEqual'
  - Some logical operators and constants: `And`, `Or`, `Not`, `True`, `False`

- More complex identifiers syntax are recognized, including `\mathbin{}`,
  `\mathord{}`, etc... `\operatorname{}` is the recommended syntax, though: it
  will display the identifier in upright font and with the propert spacing, and
  is properly enclosing. Some commands, such as `\mathrm{}` are not properly
  enclosing: two adjacent `\mathrm{}` command could be merged into one.

- Environments are now parsed and serialized correctly.

- When parsing LaTeX, function application is properly handled in more cases,
  including custom functions, e.g. `f(x)`

- When parsing LaTeX, multiple arguments are properly handled, e.g. `f(x, y)`

- Add LaTeX syntax for logical operators:
  - `And`: `\land`, `\operatorname{and}` (infix or function)
  - `Or`: `\lor`, `\operatorname{or}` (infix or function)
  - `Not`: `\lnot`, `\operatorname{not}` (prefix or function)
  - `Xor`: `\veebar` (infix)
  - `Nand`: `\barwedge` (infix)
  - `Nor`: `^^^^22BD` (infix)
  - `Implies`: `\implies` (infix)
  - `Equivalent`: `\iff` (infix)

- When a postfix operator is defined in the LaTeX syntax dictionary of the form
  `^` plus a single token, a definition with braces is added automatically so
  that both forms will be recognized.

- Extended the LaTeX dictionary with:
  - `floor`
  - `ceil`
  - `round`
  - `sgn`
  - `exp`
  - `abs`
  - `gcd`
  - `lcm`
  - `apply`

- Properly handle inverse and derivate notations, e.g. `\sin^{-1}(x)`,
  `\sin'(x)`, `\cos''(x)`, \cos^{(4)}(x)`or even`\sin^{-1}''(x)`

## 0.13.0 _2023-09-09_

### New Features

- **Compilation** Some expressions can be compiled to Javascript. This is useful
  to evaluate an expression many times, for example in a loop. The compiled
  expression is faster to evaluate than the original expression. To get the
  compiled expression, use `expr.compile()`. Read more at
  [Compiling](https://cortexjs.io/compute-engine/guides/compiling)

### Issues Resolved and Improvements

- Fixed parsing and serialization of extended LaTeX synonyms for `e` and `i`.
- Fixed serialization of `Half`.
- Fixed serialization of `Which`
- Improved serialization of `["Delimiter"]` expressions.

## 0.12.7 _2023-09-08_

### Improvements

- Made customization of the LaTeX dictionary simpler. The `ce.latexDictionary`
  property can be used to access and modify the dictionary. The
  [documentation](https://cortexjs.io/compute-engine/guides/latex-syntax/#customizing-the-latex-dictionary)
  has been updated.

## 0.12.6 _2023-09-08_

### Breaking Changes

- New API for the `Parser` class.

### Improvements and Bux Fixes

- The `ComputeEngine` now exports the `bignum()` and `complex()` methods that
  can be used to create bignum and complex numbers from strings or numbers. The
  methods `isBigNum()` and `isComplex()` have also been added to check if a
  value is a bignum (`Decimal`) or complex (`Complex`) number, for example as
  returned by `expr.numericValue`.
- **#69** `\leq` was incorrectly parsed as `Equals` instead of `LessEqual`
- **#94** The `\exp` command was not parsed correctly.
- Handle `PlusMinus` in infix and prefix position, i.e. `a\pm b` and `\pm a`.
- Improved parsing, serialization
- Improved simplification
- Improved evaluation of `Sum` and `Product`
- Support complex identifiers (i.e. non-latin scripts, emojis).
- Fixed serialization of mixed numbers.

## 0.12.1 _2022-12-01_

Work around unpckg.com issue with libraries using BigInt.

## 0.12.0 _2022-11-27_

### Breaking Changes

- The `expr.symbols` property return an array of `string`. Previously it
  returned an array of `BoxedExpression`.

### Improvements

- Rewrote the rational computation engine to use JavaScript `bigint` instead of
  `Decimal` instances. Performance improvements of up to 100x.
- `expr.freeVars` provides the free variables in an expression.
- Improved performance of prime factorization of big num by x100.
- Added `["RandomExpression"]`
- Improved accuracy of some operations, for example
  `expr.parse("1e999 + 1").simplify()`

### Issues Resolved

- When `ce.numericMode === "auto"`, square roots of negative numbers would
  return an expression instead of a complex number.
- The formatting of LaTeX numbers when using
  `ce.latexOptions.notation = "engineering"` or `"scientific"` was incorrect.
- The trig functions no longer "simplify" to the less simple exponential
  formulas.
- The canonical order of polynomials now orders non-lexicographic terms of
  degree 1 last, i.e. "ax^2+ bx+ c" instead of "x + ax^2 + bx".
- Fixed evaluation of inverse functions
- Fixed `expr.isLess`, `expr.isGreater`, `expr.isLessEqual`,
  `expr.isGreaterEqual` and `["Min"]`, `["Max"]`

## 0.11.0 _2022-11-18_

### Breaking Changes

- The signature of `ce.defineSymbol()`, `ce.defineFunction()` and
  `ce.pushScope()` have changed

### Improvements

- When a constant should be held or substituted with its value can now be more
  precisely controlled. The `hold` symbol attribute is now `holdUntil` and can
  specify at which stage the substitution should take place.

### Issues Resolved

- Some constants would return a value as bignum or complex even when the
  `numericMode` did not allow it.
- Changing the value or domain of a symbol is now correctly taken into account.
  Changes can be made with `ce.assume()`, `ce.set()` or `expr.value`.
- When a symbol does not have a value associated with it, assumptions about it
  (e.g. "x > 0") are now correctly tracked and reflected.

## 0.10.0 _2022-11-17_

### Breaking Changes

- `expr.isLiteral` has been removed. Use `expr.numericValue !== null` and
  `expr.string !== null` instead.

### Issues Resolved

- Calling `ce.forget()` would not affect expressions that previously referenced
  the symbol.

### Improvements

- More accurate calculations of some trig functions when using bignums.
- Improved performance when changing a value with `ce.set()`. Up to 10x faster
  when evaluating a simple polynomial in a loop.
- `ce.strict` can be set to `false` to bypass some domain and validity checks.

## 0.9.0 _2022-11-15_

### Breaking Changes

- The head of a number expression is always `Number`. Use `expr.domain` to be
  get more specific info about what kind of number this is.
- By default, `ce.box()` and `ce.parse()` return a canonical expression. A flag
  can be used if a non-canonical expression is desired.
- The API surface of `BoxedExpression` has been reduced. The properties
  `machineValue`, `bignumValue`, `asFloat`, `asSmallInteger`, `asRational`
  etc... have been replaced with a single `numericValue` property.
- `parseUnknownSymbol` is now `parseUnknownIdentifier`

### Improvements

- Support angles in degrees with `30\degree`, `30^\circ` and `\ang{30}`.
- More accurate error expressions, for example if there is a missing closing
  delimiter an `["Error", ["ErrorCode", "'expected-closing-delimiter'", "')'"]]`
  is produced.
- `["Expand"]` handles more cases
- The trig functions can now have a regular exponent, i.e.`\cos^2(x)` in
  addition to `-1` for inverse, and a combination of `\prime`, `\doubleprime`
  and `'` for derivatives.
- `ce.assume()` handle more expressions and can be used to define new symbols by
  domain or value.
- Better error message when parsing, e.g. `\sqrt(2)` (instead of `\sqrt{2}`)
- Better simplification for square root expressions:
  - `\sqrt{25x^2}` -> `5x`
- Improved evaluation of `["Power"]` expressions, including for negative
  arguments and non-integer exponents and complex arguments and exponents.
- Added `Arccot`, `Arcoth`, `Arcsch`, `Arcscc`, `Arsech` and `Arccsc`
- `expr.solve()` returns result for polynomials of order up to 2.
- The `pattern.match()` function now work correctly for commutative functions,
  i.e. `ce.pattern(['Add', '_a', 'x']).match(ce.parse('x+y')) -> {"_a": "y"}`
- Added `ce.let()` and `ce.set()` to declare and assign values to identifiers.
- Preserve exact calculations involving rationals or square root of rationals.
  - `\sqrt{\frac{49}{25}}` -> `\frac{7}{5}`
- Addition and multiplication provide more consistent results for `evaluate()`
  and `N()`. Evaluate returns an exact result when possible.
  - EXACT
    - 2 + 5 -> 7
    - 2 + 5/7 -> 19/7
    - 2 + √2 -> 2 + √2
    - 2 + √(5/7) -> 2 + √(5/7)
    - 5/7 + 9/11 -> 118/77
    - 5/7 + √2 -> 5/7 + √2
    - 10/14 + √(18/9) -> 5/7 + √2
    - √2 + √5 -> √2 + √5
    - √2 + √2 -> 2√2
    - sin(2) -> sin(2)
    - sin(π/3) -> √3/2
  - APPROXIMATE
    - 2 + 2.1 -> 4.1
    - 2 + √2.1 -> 3.44914
    - 5/7 + √2.1 -> 2.16342
    - sin(2) + √2.1 -> 2.35844

- More consistent behavior of the `auto` numeric mode: calculations are done
  with `bignum` and `complex` in most cases.
- `JsonSerializationOptions` has a new option to specify the numeric precision
  in the MathJSON serialization.
- Shorthand numbers can now be strings if they do not fit in a float-64:

```json example
// Before
["Rational", { "num": "1234567890123456789"}, { "num": "2345678901234567889"}]

// Now
["Rational", "1234567890123456789", "2345678901234567889"]
```

- `\sum` is now correctly parsed and evaluated. This includes creating a local
  scope with the index and expression value of the sum.

### Bugs Fixed

- The parsing and evaluation of log functions could produce unexpected results
- The `\gamma` command now correctly maps to `["Gamma"]`
- Fixed numeric evaluation of the `["Gamma"]` function when using bignum
- **#57** Substituting `0` (i.e. with `expr.subs({})`) did not work.
- **#60** Correctly parse multi-char symbols with underscore, i.e.
  `\mathrm{V_a}`
- Parsing a number with repeating decimals and an exponent would drop the
  exponent.
- Correct calculation of complex square roots
  - `\sqrt{-49}` -> `7i`
- Calculations were not always performed as bignum in `"auto"` numeric mode if
  the precision was less than 15. Now, if the numeric mode is `"auto"`,
  calculations are done as bignum or complex numbers.
- If an identifier contained multiple strings of digits, it would not be
  rendered to LaTeX correctly, e.g. `V20_20`.
- Correctly return `isReal` for real numbers

## 0.8.0 _2022-10-02_

### Breaking Changes

- Corrected the implementation of `expr.toJSON()`, `expr.valueOf()` and added
  the esoteric `[Symbol.toPrimitive]()` method. These are used by JavaScript
  when interacting with other primitive types. A major change is that
  `expr.toJSON()` now returns an `Expression` as an object literal, and not a
  string serialization of the `Expression`.

- Changed from "decimal" to "bignum". "Decimal" is a confusing name, since it is
  used to represent both integers and floating point numbers. Its key
  characteristic is that it is an arbitrary precision number, aka "bignum". This
  affects `ce.numericMode` which now uses `bignum` instead of
  `decimal', `expr.decimalValue`->`expr.bignumValue`, `decimalValue()`-> `bignumValue()`

### Bugs Fixed

- Numerical evaluation of expressions containing complex numbers when in
  `decimal` or `auto` mode produced incorrect results. Example: `e^{i\\pi}`

## 0.7.0 _2022-09-30_

### Breaking Changes

- The `ce.latexOptions.preserveLatex` default value is now `false`
- The first argument of the `["Error"]` expression (default value) has been
  dropped. The first argument is now an error code, either as a string or an
  `["ErrorCode"]` expression.

### Features

- Much improved LaTeX parser, in particular when parsing invalid LaTeX. The
  parser now avoids throwing, but will return a partial expression with
  `["Error"]` subexpressions indicating where the problems were.
- Implemented new domain computation system (similar to type systems in
  programming languages)
- Added support for multiple signatures per function (ad-hoc polymorphism)
- Added `FixedPoint`, `Loop`, `Product`, `Sum`, `Break`, `Continue`, `Block`,
  `If`, `Let`, `Set`, `Function`, `Apply`, `Return`
- Added `Min`, `Max`, `Clamp`
- Parsing of `\sum`, `\prod`, `\int`.
- Added parsing of log functions, `\lb`, `\ln`, `\ln_{10}`, `\ln_2`, etc...
- Added
  `expr.`subexpressions`, `expr.getSubexpressions()`, `expr.errors`, `expr.symbols`, `expr.isValid`.
- Symbols can now be used to represent functions, i.e. `ce.box('Sin').domain`
  correctly returns `["Domain", "Function"]`.
- Correctly handle rational numbers with a numerator or denominator outside the
  range of a 64-bit float.
- Instead of a `Missing` symbol an `["Error", "'missing'"]` expression is used.
- Name binding is now done lazily
- Correctly handle MathJSON numbers with repeating decimals, e.g. `1.(3)`.
- Correctly evaluate inverse functions, e.g. `ce.parse('\\sin^{-1}(.5)).N()`
- Fixed some LaTeX serialization issues

Read more at
[Core Reference](https://cortexjs.io/compute-engine/reference/core/) and
[Arithmetic Reference]
(https://cortexjs.io/compute-engine/reference/arithmetic/)

### Bugs Fixed

- **#43** If the input of `ce.parse()` is an empty string, return an empty
  string for `expr.latex` or `expr.json.latex`: that is, ensure verbatim LaTeX
  round-tripping
- Evaluating some functions, such as `\arccos` would result in a crash
- Correctly handle parsing of multi-token decimal markers, e.g. `{,}`

## 0.6.0 _2022-04-18_

### Improvements

- Parse more cases of tabular environments
- Handle simplify and evaluate of inert functions by default
- Avoid unnecessary wrapping of functions when serializing LaTeX
- Parse arguments of LaTeX commands (e.g. `\vec{}`)
- **#42** Export static `ComputeEngine.getLatexDictionary`
- Parse multi-character constants and variables, e.g. `\mathit{speed}` and
  `\mathrm{radius}`
- Parse/serialize some LaTeX styling commands: `\displaystyle`, `\tiny` and more

## 0.5.0 _2022-04-05_

### Improvements

- Correctly parse tabular content (for example in
  `\begin{pmatrix}...\end{pmatrix}`
- Correctly parse LaTeX groups, i.e. `{...}`
- Ensure constructible trigonometric values are canonical
- Correct and simplify evaluation loop for `simplify()`, `evaluate()` and `N()`.
- **#41** Preserve the parsed LaTeX verbatim for top-level expressions
- **#40** Correctly calculate the synthetic LaTeX metadata for numbers
- Only require Node LTS (16.14.2)
- Improved documentation, including Dark Mode support

## 0.4.4

**Release Date**: 2022-03-27

### Improvements

- Added option to specify custom LaTeX dictionaries in `ComputeEngine`
  constructor
- `expr.valueOf` returns rational numbers as `[number, number]` when applicable
- The non-ESM builds (`compute-engine.min.js`) now targets vintage JavaScript
  for improved compatibility with outdated toolchains (e.g. Webpack 4) and
  environments. The ESM build (`compute-engine.min.esm.js`) targets evergreen
  JavaScript (currently ECMAScript 2020).

## 0.4.3

**Release Date**: 2022-03-21

### Transition Guide from 0.4.2

The API has changed substantially between 0.4.2 and 0.4.3, however adapting code
to the new API is very straightforward.

The two major changes are the introduction of the `BoxedExpression` class and
the removal of top level functions.

### Boxed Expression

The `BoxedExpression` class is a immutable box (wrapper) that encapsulates a
MathJSON `Expression`. It provides some member functions that can be used to
manipulate the expression, for example `expr.simplify()` or `expr.evaluate()`.

The boxed expresson itself is immutable. For example, calling `expr.simplify()`
will return a new, simplified, expression, without modifying `expr`.

To create a "boxed" expression from a "raw" MathJSON expression, use `ce.box()`.
To create a boxed expression from a LaTeX string, use `ce.parse()`.

To access the "raw" MathJSON expression, use the `expr.json` property. To
serialize the expression to LaTeX, use the `expr.latex` property.

The top level functions such as `parse()` and `evaluate()` are now member
functions of the `ComputeEngine` class or the `BoxedExpression` class.

There are additional member functions to examine the content of a boxed
expression. For example, `expr.symbol` will return `null` if the expression is
not a MathJSON symbol, otherwise it will return the name of the symbol as a
string. Similarly, `expr.ops` return the arguments (operands) of a function,
`expr.asFloat` return `null` if the expression does not have a numeric value
that can be represented by a float, a `number` otherwise, etc...

### Canonical Form

Use `expr.canonical` to obtain the canonical form of an expression rather than
the `ce.format()` method.

The canonical form is less aggressive in its attempt to simplify than what was
performed by `ce.format()`.

The canonical form still accounts for distributive and associative functions,
and will collapse some integer constants. However, in some cases it may be
necessary to invoke `expr.simplify()` in order to get the same results as
`ce.format(expr)`.

### Rational and Division

In addition to machine floating points, arbitrary precision numbers and complex
numbers, the Compute Engine now also recognize and process rational numbers.

This is mostly an implementation detail, although you may see
`["Rational", 3, 4]`, for example, in the value of a `expr.json` property.

If you do not want rational numbers represented in the value of the `.json`
property, you can exclude the `Rational` function from the serialization of JSON
(see below) in which case `Divide` will be used instead.

Note also that internally (as a result of boxing), `Divide` is represented as a
product of a power with a negative exponent. This makes some pattern detection
and simplifications easier. However, when the `.json` property is accessed,
product of powers with a negative exponents are converted to a `Divide`, unless
you have included `Divide` as an excluded function for serialization.

Similarly, `Subtract` is converted internally to `Add`, but may be serialized
unless excluded.

### Parsing and Serialization Customization

Rather than using a separate instance of the `LatexSyntax` class to customize
the parsing or serialization, use a `ComputeEngine` instance and its
`ce.parse()` method and the `expr.latex` property.

Custom dictionaries (to parse/serialize custom LaTeX syntax) can be passed as an
argument to the `ComputeEngine` constructor.

For more advanced customizations, use `ce.latexOptions = {...}`. For example, to
change the formatting options of numbers, how the invisible operator is
interpreted, how unknown commands and symbols are interpreted, etc...

Note that there are also now options available for the "serialization" to
MathJSON, i.e. when the `expr.json` property is used. It is possible to control
for example if metadata should be included, if shorthand forms are allowed, or
whether some functions should be avoided (`Divide`, `Sqrt`, `Subtract`, etc...).
These options can be set using `ce.jsonSerializationOptions = {...}`.

### Comparing Expressions

There are more options to compare two expressions.

Previously, `match()` could be used to check if one expression matched another
as a pattern.

If `match()` returned `null`, the first expression could not be matched to the
second. If it returned an object literal, the two expressions matched.

The top-level `match()` function is replaced by the `expr.match()` method.
However, there are two other options that may offer better results:

- `expr.isSame(otherExpr)` return true if `expr` and `otherExpr` are
  structurally identical. Structural identity is closely related to the concept
  of pattern matching, that is `["Add", 1, "x"]` and `["Add", "x", 1]` are not
  the same, since the order of the arguments is different. It is useful for
  example to compare some input to an answer that is expected to have a specific
  form.
- `expr.isEqual(otherExpr)` return true if `expr` and `otherExpr` are
  mathematically identical. For example `ce.parse("1+1").isEqual(ce.parse("2"))`
  will return true. This is useful if the specific structure of the expression
  is not important.

It is also possible to evaluate a boolean expression with a relational operator,
such as `Equal`:

```ts
console.log(ce.box(["Equal", expr, 2]).evaluate().symbol);
// -> "True"

console.log(expr.isEqual(ce.box(2)));
// -> true
```

### Before / After

| Before                                    | After                                    |
| :---------------------------------------- | :--------------------------------------- |
| `expr = ["Add", 1, 2]`                    | `expr = ce.box(["Add", 1, 2])`           |
| `expr = ce.evaluate(expr)`                | `expr = expr.evaluate()`                 |
| `console.log(expr)`                       | `console.log(expr.json)`                 |
| `expr = new LatexSyntax().parse("x^2+1")` | `expr = ce.parse("x^2+1")`               |
| `new LatexSyntax().serialize(expr)`       | `expr.latex`                             |
| `ce.simplify(expr)`                       | `expr.simplify()`                        |
| `await ce.evaluate(expr)`                 | `expr.evaluate()`                        |
| `ce.N(expr)`                              | `expr.N()`                               |
| `ce.domain(expr)`                         | `expr.domain`                            |
| `ce.format(expr...)`                      | `expr.canonical` <br/> `expr.simplify()` |

## 0.3.0

**Release Date**: 2021-06-18

### Improvements

- In LaTeX, parse `\operatorname{foo}` as the MathJSON symbol `"foo"`.
