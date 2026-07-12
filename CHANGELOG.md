## [Unreleased]

### Typed Function Literals

- **Function literals can declare parameter and return types.** A `Function`
  parameter may be annotated — `["Typed", "x", "'integer'"]` — and the body
  may carry a return-type ascription, so
  `["Function", ["Add", "x", 1], ["Typed", "x", "'integer'"]]` now has type
  `(x: integer) -> integer` instead of `(unknown) -> number`. Annotations feed
  body type inference, and in strict mode arguments are checked at
  application: applying `2.5` to an `integer` parameter yields an
  `incompatible-type` error instead of silently computing. Partial application
  preserves the remaining annotations and the return type. Assigning an
  annotated literal to a symbol gives it the full typed signature — including
  the declared return type, which is an *ascription* (authoritative, like a
  TypeScript annotation) rather than a check against inference. Untyped
  literals are unchanged.
- **New `Typed` operator for type ascription.** `["Typed", expr, type]`
  asserts the type of an expression for the type system and is transparent at
  evaluation. It accepts a type string (`"'integer'"`) or a type-name symbol
  (`integer`). LaTeX serialization drops annotations (no typed-parameter
  notation in v1); MathJSON round-trips them.
- **Cortex: typed function definitions are enforced end to end.**
  `f(x: integer) -> real = x + 1`, `function g(n: integer) -> integer {…}`,
  and the anonymous form `(x: integer) |-> x + 1` (new grammar) all parse to
  native annotated literals; mistyped calls error, declared return types are
  carried, and `serializeCortex` reconstructs the typed syntax faithfully.
  Recursive typed definitions work
  (`fact(n: integer) -> integer = if n <= 1 {1} else {n * fact(n - 1)}`).

### Programming and Collections

- **Closures capture per-call state.** A zero-parameter closure returned from a
  factory function now captures its own instance of the factory's local
  variables, so separate invocations no longer share mutable state. For example,
  two counters built from the same `makeCounter()` factory advance
  independently. Parameterized factories already behaved this way; the fix
  extends the same per-call scope instantiation to nullary functions.
- **Lazy collection operations iterate eager sources.** A lazy operation such as
  `Map` or `Filter` applied to a collection that only materializes on evaluation
  (e.g. `UnicodeScalars(s)`, `Characters(s)`) now iterates its elements instead
  of behaving as empty. For example,
  `StringFrom(Map(UnicodeScalars(s), c -> c + 1), "unicode-scalars")` now
  produces the shifted string rather than `""`.

### Symbolic Computation

- **Arithmetic and function application thread through conditional values.**
  A restricted value `When(v, cond)` and a piecewise `Which(c_1, v_1, …)` now
  flow through scalar operations instead of staying inert:
  `sin(When(x, x > 0))` → `When(sin(x), x > 0)`, guards combining by
  conjunction (`When(x, x > 0) · When(y, y < 1)` →
  `When(x·y, x > 0 ∧ y < 1)`), and `Which(x > 0, 1, x < 0, -1) + 2` →
  `Which(x > 0, 3, x < 0, 1)`. Logic operators are excluded (so
  `And(When(A, g), False)` still short-circuits to `False`), and piecewise
  products above 16 combined branches stay unevaluated.
- **Restriction guards survive arithmetic cancellation.** Evaluating
  `When(x, c) − When(x, c)` previously folded to plain `0`, silently
  discarding the restriction on the (fat) region where `c` fails; it now
  yields `When(0, c)`. Similarly `0 · When(x, c)` → `When(0, c)` and
  `When(x, c) / When(x, c)` → `When(1, c)`.
- **`When` respects numeric approximation.** `When(π, cond).N()` with a true
  condition now numericizes (previously the option was dropped and the value
  stayed symbolic).

### Calculus

- **Improper integrals with symbolic parameters return convergence-guarded
  results.** `∫₀^∞ e^(−ax)dx` with a free `a` previously stayed unevaluated;
  it now returns `1/a {0 < a}`. Results that formerly leaked indeterminate
  endpoint forms are fixed: `∫₀^1 xⁿdx` returned an expression containing
  `0^(n+1)`, and `∫₁^∞ x^(−s)dx` one containing `∞^(1−s)`; they now return
  `1/(n+1) {0 < n+1}` and `1/(s−1) {1 < s}`. Integrals whose endpoint
  behavior cannot be classified stay unevaluated rather than leaking
  indeterminates. Numeric-parameter integrals are unchanged.

### Sums and Products

- **Geometric series closed form.** `Σ_{n=0}^∞ rⁿ` now evaluates: exactly for
  a numeric ratio (`Σ(1/2)ⁿ → 2`, `Σ(1/√2)ⁿ → 2 + √2`), and with its
  convergence condition for a symbolic ratio (`Σxⁿ → 1/(1−x) {|x| < 1}`).
  Constant multiples and integer start indices are handled
  (`Σ_{n=2}^∞ xⁿ → x²/(1−x) {|x| < 1}`); divergent numeric ratios stay
  unevaluated.

### Solving Equations

- **Trigonometric and hyperbolic equations with symbolic coefficients record
  their validity condition.** `Solve(sin(x) = a, x)` previously returned
  `arcsin(a)` and `π − arcsin(a)` unconditionally — wrong whenever
  `|a| > 1`. Roots now carry their domain-of-validity guard — a `When`
  restriction, displayed `arcsin(a) {|a| <= 1}` (LaTeX
  `\arcsin(a)\left\{|a|\le 1\right\}`). The guard resolves as soon as it is
  decidable:
  substituting `a = 1/2` collapses the root to `π/6`, while `a = 3` yields
  `Undefined`, and a guard known false at solve time prunes the root (down
  to `[]`). Numeric-coefficient equations are unchanged. The same applies to
  `cos` (`|ratio| ≤ 1`), `cosh` (`ratio ≥ 1`), and `tanh` (`|ratio| < 1`)
  equations.
- **`Solve` of an inequality stays inert instead of returning an empty list.**
  `Solve(x^2 < 4, x)` previously returned `[]`, which reads as "no solutions";
  univariate inequality solving is unsupported, so the expression now stays
  unevaluated. Solving equations is unchanged.

### Compilation

- **The deprecated `interval-glsl` compilation target has been removed.** GPU
  interval evaluation only pays off when the entire pipeline stays on the GPU,
  and the target could not compile relational operators, so it could not host
  restriction conditions. Use `interval-js` (CPU interval arithmetic) or the
  scalar `glsl`/`wgsl` targets instead. The `IntervalGLSLTarget` export from
  `@cortex-js/compute-engine/compile` is gone, and
  `compile(expr, { to: 'interval-glsl' })` now throws an unregistered-target
  error.

## 0.76.0 _2026-07-11_

### Programming and Collections

- **Dictionary lookups have the value's type.** `At(dict, key)` — and thus
  `d["a"]` in Cortex — was statically typed as the key-value _pair_
  (`tuple<string, T>`), so using a lookup directly in arithmetic (`d["a"] + 10`)
  failed with an `incompatible-type` error. It is now typed as the value; a
  record indexed by a literal string gets that field's precise type.

- **`Reduce`/`Fold` honor the exactness contract.** The compiled floating-point
  fast path no longer runs under plain `evaluate()`: exact operands fold exactly
  (`Fold((a, k) ↦ a + 1/k, 0, Range(1, 5))` → `137/60` instead of `2.2833…`).
  The fast path is reserved for `.N()` and already-inexact inputs.
  Complex-valued folds no longer silently drop imaginary parts
  (`Product(Map(Range(1, 3), k ↦ k + i))` → `10i`, previously `6`).

- **`Map` infers its element type from the mapped function.** The result of
  `Map(Range(1, 3), k ↦ k + i)` was typed with the _source_ element type
  (`integer`); it now reflects the lambda's result type, so downstream
  operations dispatch correctly.

- **Elementwise broadcasting is uniform across lazy and eager collections.** A
  finite lazy `Range` now broadcasts like an eager `List` in tuple products:
  with `R = Range(-2, 2)`, `R·(2,3)` yields a list of five scaled points instead
  of distributing the range inside the tuple components. A scalar also folds
  into a collection produced by an inner broadcast step: `L^2 - 2` evaluates to
  `[-1, 2, 7]` instead of the unevaluated `Add(-2, [1, 4, 9])`, and evaluation
  is idempotent again on these shapes. Infinite or unknown-length ranges stay
  symbolic rather than transposing.

- **Scalar operations accept lazy collection operands during validation.**
  `Mod([0,\ldots,kN], N)` with a symbolic bound produced an `incompatible-type`
  error at canonicalization even though the eager-list form broadcast fine; the
  argument validator now recognizes parametrized `indexed_collection<T>`
  wherever broadcasting applies. Declared types follow the values: broadcast
  results type `list<…>` (previously a scalar-or-list union, or a scalar type
  for symbolic-length ranges).

- **Big integers survive numeric list literals.** A list literal promoted to a
  tensor stored oversized integers in float64 and truncated them (`[100!]` lost
  digits, breaking exact iterative algorithms such as a Fibonacci pair
  accumulator). Integers beyond the float-safe range now keep their exact
  representation.

- **`StringFrom` joins collections.** With a list argument and the
  `"unicode-scalars"`, `"utf-8"`, or `"utf-16"` format,
  `StringFrom([100, 101, 102], "unicode-scalars")` returns `"def"`; it
  previously broadcast element-wise and returned a list of one-character
  strings.

- **One-step function definitions bind inside function bodies (Cortex).**
  `function outer(n) { sq(m) = m * m; sq(n) }` left `sq(n)` unevaluated because
  the call site resolved a value placeholder while the runtime created an
  operator definition; function application now falls back to the operator
  definition. The example-program suite grew by 18 programs covering control
  flow, number theory, complex numbers, linear algebra, and exact sums (mirrored
  in the Cortex documentation).

- **Cortex: `do { … }` block expressions and zero-parameter lambdas.** A
  statement block can now appear in any expression position with the explicit
  `do` prefix — its value is its final statement — so multi-statement closure
  bodies are expressible: `x |-> do { let t = x * x; t + 1 }`. Set literals are
  unchanged (`x |-> {1, 2}` still returns a set). Zero-parameter lambdas
  (`() |-> …`) now parse and apply, enabling the stateful `makeCounter`-style
  closure documented in the examples.

- **Cortex: a named inner function escapes its scope as a value.**
  `function make() { helper(x) = x + 1; helper }` now returns a callable
  first-class function — previously the returned symbol went inert once the call
  frame popped. Captured locals and parameters of the enclosing call are
  preserved; returned `|->` lambdas are unchanged.

- **Cortex: lowercase `true`/`false`, ASCII `..` ranges, and `StringJoin` over a
  list.** `true`/`false` are now input aliases for `True`/`False` (and reserved
  as binding names); `1..n` is a range (`for k in 1..5`), equivalent to the
  existing `‥`, without disturbing decimal literals like `1.5`; and `StringJoin`
  accepts a single collection of strings —
  `StringJoin(Reverse(Characters("hello")))` → `"olleh"`.

- **Cortex: "did you mean" warnings for near-miss function names.** Calling an
  undeclared function whose name is close to a library operator no longer fails
  silently symbolic: `executeCortex` emits a warning diagnostic with the
  suggestion (`Quartile(xs)` → _did you mean `Quartiles`?_). The match is
  conservative (case-insensitive, singular/plural, small edit distance, unique
  prefix) and the diagnostic only fires when a suggestion exists, so
  intentionally symbolic calls are never flagged; the returned value is
  unchanged. The matcher is also available as `ce.suggestOperatorName(name)`.
  `Arg` is now an alias for `Argument`.

### Compilation

- **Calls to user-defined functions compile.** After `f(x) := e^{-x^2/2}`,
  compiling `f(2)` — or any expression referencing `f` — emits the definition as
  a named local function instead of throwing ``Unknown operator `f` ``. Nested
  user functions are emitted in dependency order; recursive definitions fail
  closed with an explanatory error. This also removes a silent interpreted
  fallback in numeric integration: definite integrals of user-defined functions
  now run compiled quadrature (10⁷ samples instead of 10⁴ — comparable wall
  time, ~30× tighter error estimate). Applies to the `javascript` and
  `interval-js` targets.

- **Collection-valued conditions fail closed instead of compiling wrong code.**
  `Equal`/`NotEqual` over a collection-typed operand, and `If`/`Which`/`When`
  with a collection-typed condition, previously compiled with `success: true`
  and returned `null` or the wrong branch at run time; they now throw an
  explanatory compile-time error. Interpreted evaluation is unchanged:
  comparisons broadcast elementwise, conditionals require a scalar boolean.

- **`Reduce`, `Length`, and `At` compile on the `javascript` target.**
  `Reduce(xs, Add|Multiply|Min|Max, init?)` compiles to a loop; `Length` returns
  the element count; `At` follows the interpreter's 1-based, negative-from-end
  indexing (out-of-range yields `NaN`).

- **GLSL: `Length` no longer collides with the `length()` builtin.** CE's
  `Length` (element count) compiled to GLSL `length()` — the Euclidean norm —
  reporting success while computing the wrong value, or emitting invalid GLSL
  for lists longer than four. `length()` is now emitted for `Norm`; collection
  `Length` fails closed on the GPU targets.

- **GLSL/WGSL: literal integer powers are sign-correct on the GPU.** `x^3`
  compiled to `pow(x, 3.0)`, which the GLSL specification leaves undefined for
  negative bases — real GPUs returned `pow(-2, 3) = +8`, silently flipping the
  sign of odd-power terms. Small integer exponents now emit repeated
  multiplication; larger and compound-base cases use a sign-preserving
  `_gpu_powi` preamble helper; negative integer exponents wrap the reciprocal.
  Fractional exponents still emit `pow`.

- **The `interval-glsl` target is deprecated.** GPU interval evaluation only
  pays off when the entire pipeline stays on the GPU, and the target cannot
  compile relational operators, so it cannot host restriction conditions. A
  once-per-process warning now points to `interval-js` and the scalar
  `glsl`/`wgsl` targets. It will be removed in a future release.

### Numeric Evaluation

- **Numeric infinite products use tail acceleration.** `.N()` now
  Richardson-extrapolates the logarithms of positive real factors instead of
  returning a plain finite truncation. This gives accurate values for products
  such as `Product(1 + 1/k², k, 1, +∞) = sinh(π)/π`. Products with non-real,
  non-positive, or non-convergent factors decline the accelerator and retain the
  existing bounded-truncation behavior.

- **Machine `Gamma` keeps full relative accuracy through the overflow edge.**
  Positive real arguments now use a balanced recurrence from the Lanczos core
  instead of reconstructing large values from `exp(gammaln(z))`, which preserves
  about 15-16 digits up to the IEEE-754 limit near `Gamma(171.624)`.

### Linear Algebra

- **Matrix operators infer fresh symbolic operands from context.** An expression
  such as `\det(A+2B)` no longer fails because bottom-up arithmetic
  canonicalization provisionally typed `A` and `B` as numbers before
  `Determinant` required a matrix. Validation now repairs only inferences made
  while constructing the current expression and canonicalizes the argument once
  more with matrix context. Explicit declarations and inferences from earlier
  expressions are never overwritten, and ambiguous products remain unchanged
  rather than guessing which factor is the matrix.

### Symbolic Computation

- **Exact cube-root arithmetic handles more algebraic forms.** Positive
  perfect-power bases with rational exponents normalize to a common base and
  extract their integer part (`4^(2/3) → 2·2^(1/3)`), allowing compatible
  cube-root powers to combine exactly. Real nested cube roots of the form
  `∛(a+b√c)` are denested when exact integer conjugate identities prove a
  result; in particular, `∛(90+34√7) → 3+√7` (and the conjugate form with minus
  signs). The Wester-28 cube-root identity now simplifies directly to exact zero
  (no explicit `Expand` required) and numericizes without `NaN`.

- **Infinite p-series support positive-integer lower bounds beyond 1.**
  `Sum(k^(-s), k, a, +∞)` now returns `Zeta(s) − Sum(k^(-s), k, 1, a−1)` for
  exact real `s > 1`; for example, `Sum(1/k², k, 3, +∞)` evaluates to
  `π²/6 − 5/4`. The existing lower-bound-1 behavior and divergence guards are
  unchanged.

- **`e^{iθ}` stays exact for constructible angles.** `e^{i\pi/3}` now evaluates
  to `1/2 + (√3/2)i` instead of a machine float (the exact cosine/sine values
  were being recombined through float-folding arithmetic). `.N()` numericizes as
  before, and the degenerate angles (`e^{i\pi} → -1`, `e^{i\pi/2} → i`) are
  unchanged.

### Serialization

- **AsciiMath prints series in textbook order.** Taylor-series terms are
  serialized in ascending degree and asymptotic series in descending degree,
  with the `BigO` remainder last, matching LaTeX output. Canonical expression
  order and ordinary sums without a `BigO` term are unchanged.

### Parsing

- **Stepped ellipsis ranges accept negative and symbolic samples.**
  `[-9,-6,\ldots,9]` now parses to `Range(-9, 9, 3)` — previously any negative
  leading sample fell back to a literal list containing a
  `ContinuationPlaceholder` that enumerated as `NaN`. Symbolic stepped forms
  infer a symbolic step when the samples are numeric multiples of one common
  symbol (`[-3N,-2N,\ldots,3N]` → `Range(-3N, 3N, N)`, progression-validated on
  the coefficients); generic sequence notation (`[x_1,x_2,\ldots,x_n]`)
  intentionally still parses as a plain list.

### Engine Lifecycle

- **Popping a scope releases configuration listeners owned by its constants.**
  Constant definitions now retain and invoke the unsubscribe closure returned
  when they register for precision and angular-unit changes. Local constants
  from discarded scopes therefore no longer remain reachable for the lifetime of
  the compute engine.

- **Cancellation errors carry a structured cause.** A cap breach reports
  `'timeout'`, `'iteration-limit-exceeded'`, or `'recursion-depth-exceeded'` via
  the exported `CancellationCause` type. In Cortex, a final-statement breach
  carries the cause as a second operand on the `Error` value, and non-final
  statements emit a dedicated `evaluation-canceled` diagnostic. Error messages
  are unchanged, so existing string matching keeps working.

## 0.75.0 _2026-07-11_

### Numeric Evaluation

- **Inverse trigonometric and hyperbolic functions now evaluate outside their
  real domain.** `.N()` returns the complex principal value when no real value
  exists, for example `\arcsin(2)` → `1.571 − 1.317i` and
  `\operatorname{arcosh}(0.5)` → `1.047i`. Complex arguments such as
  `\operatorname{arsinh}(1+i)` are also supported. Exact arguments remain
  symbolic with `evaluate()`. Incorrect complex values from `Arcoth` on part of
  its branch cut and from `Arsech` have also been fixed.
- **Products and quotients of square roots no longer throw on large radicands.**
  Evaluating an expression such as `\sqrt{1234}\cdot\sqrt{1235}`, whose combined
  radicand (`1234·1235`) exceeds the exact-radical limit, no longer raises an
  internal "Unexpected value for radical part" error. Any perfect-square factor
  is extracted (`√(k²·r) = k·√r`), keeping the result exact when the square-free
  part is small enough and otherwise returning the numeric value.

### Solving Equations

- **`Solve` handles systems of equations.** `Solve([eq1, eq2, …], [x, y, …])`
  returns each solution as a tuple of values in the order of the variable list:
  `Solve([x + y = 3, x - y = 1], [x, y])` → `[(2, 1)]`, and a nonlinear system
  such as `[x^2 + y^2 = 25, x + y = 7]` returns both solutions
  `[(3, 4), (4, 3)]`. Linear systems solve exactly (rational values), an
  underdetermined system returns a parametric tuple (`[(5 - y, y)]` for
  `x + y = 5`), and a system the solver cannot decide stays unevaluated. This
  matches the tuple shape already used when solving over explicit domains.
- **`solve()` correctly rejects trigonometric and hyperbolic equations with no
  real solutions.** Equations such as `\sin x = 2`, `\tanh x = 2`, and
  `\cosh x = 1/2` now return no solutions. Symbolic equations and equations with
  complex polynomial roots are unaffected.

### Integration (opt-in Rubi rules)

- **More integrals containing binomial radicals are supported.** This includes
  mixed even- and odd-power numerators such as
  `\int\frac{c+dx}{\sqrt{-a-bx^4}}dx`,
  `\int\frac{x^2(c+dx+ex^2+fx^3)}{(a+bx^4)^{3/2}}dx`, and Laurent variants with
  denominators of the form `(a+b·x^n)^{3/2}`.
- **More integrals that are algebraic in a hyperbolic function are supported.**
  Half-integer powers of hyperbolic expressions such as
  `\int\coth(x)(a+b\sinh^2 x)^{3/2}\,dx`,
  `\int\coth^2 x\sqrt{a+b\tanh^2 x}\,dx`,
  `\int\frac{\operatorname{csch} x}{(a+b\sinh^2 x)^{3/2}}\,dx`, and
  `\int\sqrt{a+b\operatorname{csch}^2 x}\,dx` now close in elementary form via a
  hyperbolic substitution. This also fixes a wrong-answer case,
  `\int\frac{\sqrt{\coth(a+b\ln(cx^n))}}{x}\,dx`.
- **More integrals that are rational in a hyperbolic function are supported.**
  Ratios of hyperbolic functions with a squared-or-higher power, such as
  `\int\frac{\tanh^2 x}{a+b\tanh x}\,dx`, `\int\frac{\tanh x}{a+b\sinh x}\,dx`,
  and `\int(a+b\tanh^2 x)^3\tanh^4 x\,dx`, now close in elementary form.

### Library and Definitions

- **Definitions can be searched by concept.** `ce.searchDefinitions(query)`
  returns a ranked list of matching `{ id, kind }` entries. It searches names,
  descriptions, synonyms (for example, `average` finds `Mean`), and LaTeX
  commands (for example, `\gcd` finds `GCD`). Use the optional `limit` argument
  to control the number of results (default: 10). Custom definitions declared
  with `ce.declare()` can provide an optional `keywords` list, and returned IDs
  can be passed to `ce.lookupDefinition()`.
- **Definition descriptions filled in.** About 80 operators and constants that
  lacked a `description` now have one (the trigonometric family, logic and
  relational operators, collection primitives such as `List`, `Range`, and
  `Fold`, and constants like `Pi` and `ExponentialE`), and `Sec`'s description
  was corrected (secant is the _reciprocal_, not the inverse, of cosine). These
  surface in `ce.searchDefinitions()` and `ce.lookupDefinition()`.
- **New builtin operators are available:** `Pipe(x, f)`,
  `Append(collection, element)`, `Fold(f, init, collection)`,
  `StringJoin(s1, s2, …)`, and `RandomInteger(n)` or `RandomInteger(a, b)`.
  `Pipe` enables evaluation of `x |> f`; `StringJoin` enables the existing `<>`
  notation; and `RandomInteger` uses inclusive bounds and honors the seeded
  random-number generator.

### Calculus

- **`Limit` accepts the explicit-variable form.** `Limit(expr, var, point)` —
  e.g. `["Limit", ["Divide", ["Sin", "x"], "x"], "x", 0]` → `1` — now
  canonicalizes to the same internal form as `Limit(expr, point)`, matching the
  convention `Series` already uses. The `(function, point, direction)` reading
  is preserved when the middle operand is not a free variable of the expression.

### Linear Algebra

- **`Inverse` of an exact matrix is exact.** An integer or rational matrix now
  inverts over the rationals — `Inverse([[2,1],[1,3]])` →
  `[[3/5,-1/5],[-1/5,2/5]]` instead of floats — with `.N()` and inexact matrices
  using the numeric path as before.
- **New `LinearSolve(A, b)` operator** solves the linear system `A·x = b`,
  exactly for exact input. Composed forms like `Dot(Inverse(A), b)` also work
  now: `Inverse`'s result is typed as a matrix, so matrix operators accept it.

### Units and Quantities

- **`Quantity` accepts a string unit.** `Quantity(30, "km/h")` parses the string
  through the same unit grammar as the LaTeX path and canonicalizes identically
  to the symbolic form; a malformed unit string produces a clear error instead
  of a partially-built expression.

### Programming and Collections

- **Recursive functions can be defined without a separate declaration.** A
  function assignment that refers to itself, such as
  `ce.parse('f(n) := n \\cdot f(n-1)')`, now works directly.
- **`N()` numericizes through user-defined functions.** For `f(x) := x/3`,
  `N(f(2))` now returns `0.666…` instead of the exact `2/3`; plain `evaluate()`
  still returns the exact form, and the approximation is applied within the
  function's own scope, preserving lexical scoping.
- **`Keys(dict)` and `Values(dict)` evaluate**, returning the keys (as strings)
  and values in the dictionary's iteration order — the same order
  `for kv in dict` yields.
- **`Intersection` accepts lists** (any finite collection), deduplicating into a
  `Set`; `Union` already did.
- **A 2-element MathJSON `List` in a set operation is a collection, not an
  interval.** `["Intersection", ["List",1,2], ["List",2,3]]` (Cortex:
  `Intersection([1,2], [2,3])`) now intersects the two-element collections —
  `Set(2)` — instead of reading the lists as closed intervals. The interval
  reading of ambiguous bracket pairs is now applied where it belongs, at the
  LaTeX boundary: `x \in \lbrack 1, 5 \rbrack`, `(-\infty, 0) \cup (0, \infty)`,
  and the subset relations parse to `Interval` exactly as before, and
  `\setminus` now gets the same interval reading (previously
  `\R \setminus (0, 1)` kept a raw pair). Unambiguous interval notations
  (`[a, b)`, `]a, b[`, …) are unchanged.
- **Collection equality no longer depends on representation.** A computed
  collection — an `Intersection` or `Union` result, a lazy `Map`, `Filter`, or
  `Join` pipeline, or a symbol assigned a collection — now compares equal to a
  literal with the same elements: `Intersection({1,2,3,4}, {2,3,5}) = {2,3}` is
  `True` (it was `False` unless the operand was evaluated first). Sequences
  compare element-wise in order, sets by membership, and a set is never equal to
  a sequence. In addition, `Equal` between two collections now always returns a
  scalar boolean instead of sometimes broadcasting element-wise (`{1,2} = [1,2]`
  returned `["True","True"]`); broadcasting still applies to list-vs-scalar
  comparisons such as `L = 4`.
- **`Intersection` of two `Filter` collections no longer overflows the stack.**
  Membership tests on a lazy `Filter` recursed without bound;
  `Intersection(Filter(…), Filter(…))` now evaluates normally.
- **Indexing a matrix once returns a correctly typed row.** Expressions such as
  `At(At(m, 2), 1)` now validate and evaluate correctly for matrices and other
  rank-2-or-higher collections.
- **List elements and dictionary values are evaluated by `evaluate()` and
  `.N()`.** For example, `["List", "y", ["Add", "y", 1]]` with `y = 7` evaluates
  to `[7, 8]`, and `[1/3].N()` is numericized. Lazy collections such as `Range`,
  `Map`, and `Filter` remain lazily enumerated.
- **Ellipsis lists with symbolic bounds parse to `Range`.**
  `\left[-N,\ldots,N\right]` and `\left[-3N,\ldots,3N\right]` now parse to
  `Range(-N, N)` and `Range(-3N, 3N)`, matching the numeric-start forms
  (`[1,\ldots,N]`). Previously a symbolic start fell through to a raw `List`
  containing a literal `ContinuationPlaceholder`, which enumerated as `NaN`. In
  addition, a `Range` whose bounds bind looser than the `..` operator now
  serializes with parentheses (`(-N)..N`) so it round-trips through LaTeX (an
  unwrapped `-N..N` reads back as `-(N..N)`).
- **Using a symbol bound to a symbolic list no longer corrupts builtin
  definitions.** After `ce.assign('L_1', ce.parse('\\left[N,2N\\right]'))`,
  constructing `2 L_1` — via `subs()`, `ce.box()`, or `ce.function()` —
  permanently broke the builtin `N` operator for the lifetime of the engine:
  every subsequent parse of the token `N` returned an `unexpected-symbol` error.
  Type inference on the list elements no longer overwrites an operator
  definition with an unsatisfiable (`never`) type.

### Cortex

- **`%` and postfix `!` operators**: `a % b` is `Mod(a, b)` (multiplicative
  precedence) and `n!` is `Factorial(n)` (the `!` must directly follow its
  operand; prefix `!x` is still `Not` and `x != y` is still `NotEqual`).
- **Chained indexing**: `m[2][1]` now works alongside `m[2, 1]`.
- **String escape sequences are processed correctly.** `"a\tb\nc"` now contains
  a real tab and newline (escapes were previously double-processed in plain and
  multiline strings; interpolated strings were already correct).
- **The examples suite roughly doubled** (`src/cortex/docs/examples.md`), adding
  units and uncertainty, calculus, linear systems, dictionaries, sets, closures,
  seeded randomness, errors-as-values, and string formatting — every example
  verified by an executable test.

## 0.74.0 _2026-07-10_

This release significantly expands CE's calculus capabilities. Limits, residues,
and series now handle many poles of special functions exactly; infinite sums and
products gain more closed forms and substantially better numeric convergence;
and the optional Rubi integration rules support more integrands, any integration
variable, and reliable time limits. Step-by-step explanations now cover
integration and systems of equations or inequalities, with clearer traces for
simplification.

It also improves exact and symbolic computation throughout the engine. Linear
algebra gains exact ranks, null spaces, eigenvectors, matrix square roots, and
singular values; assumptions and simplification prove more identities; and
several correctness issues involving canonicalization, fractions, symbolic
collections, compilation, and LaTeX parsing are fixed. New special-function
support, reproducible seeded randomness, and more useful Cortex diagnostics
round out the release.

### Calculus

- **Limits and residues at special-function poles evaluate exactly.**
  Expressions at poles of `Gamma`, `Digamma`, `Trigamma`, `PolyGamma`, and
  `Zeta` that previously stayed symbolic now resolve in closed form:
  `\lim_{x\to-1}(x+1)\psi(x) = -1`, `\lim_{x\to0}(\Gamma(x)-1/x) = -\gamma`,
  `\lim_{s\to1}(s-1)\zeta(s) = 1`,
  `\operatorname{Res}_{s=1}\Gamma(s)\zeta(s) = 1`,
  `\operatorname{Res}_{x=0}\Gamma(x)^2 = -2\gamma`, and higher-order poles that
  previously deferred
  (`\operatorname{Res}_{x=-2} \Gamma(x)/(x+2) = 3/4 - \gamma/2`). Deferral
  behavior is unchanged where no exact expansion exists (branch points,
  essential singularities, two-sided pole limits).
- **The polygamma family expands, differentiates, and integrates through the
  ladder.** `Series` now produces correct Laurent expansions of `Trigamma` and
  integer-order `PolyGamma(m, x)` at their poles (previously a spurious regular
  expansion could be produced), and `D` knows `\psi_1' = \psi^{(2)}` and the
  general `d/du\,\psi^{(m)}(u) = \psi^{(m+1)}(u)`. `Series` at a `Digamma` pole
  is also about 20× faster.
- **Residues at infinity evaluate.** `Residue(f, x, \infty)` — any infinite
  point names the Riemann-sphere point at infinity — computes
  `-\operatorname{Res}_{s=0} f(1/s)/s^2` through the exact Laurent kernel:
  `\operatorname{Res}_\infty 1/x = -1`,
  `\operatorname{Res}_\infty \frac{3x^2+2}{x^3+x} = -3` (the negated sum of the
  finite residues).
- **Limits at poles resolve to signed infinities.** A _directional_ limit at a
  pole now evaluates to `\pm\infty` from the exact Laurent data:
  `\lim_{x\to0^+} 1/x = +\infty`, `\lim_{x\to0^-}\Gamma(x) = -\infty`,
  `\lim_{s\to1^\pm}\zeta(s) = \pm\infty`, `\lim_{x\to0^+}\ln x = -\infty`. A
  _two-sided_ limit resolves only when both sides agree (even pole order):
  `\lim_{x\to0} 1/x^2 = +\infty`, `\Gamma(x)^2 \to +\infty`,
  `\ln(x^2) \to -\infty`. Disagreeing two-sided limits (`\lim_{x\to0} 1/x`,
  `\Gamma`, `\ln x` at their poles) deliberately stay inert — the engine does
  not produce `ComplexInfinity` limits.
- **`Beta` joins the meromorphic pole family.** The Laurent kernel expands
  `\operatorname{B}(a,b)` through the `\Gamma`-quotient identity, so residues,
  limits and `Series` at Beta poles evaluate:
  `\operatorname{Res}_{x=0} \operatorname{B}(x,3) = 1`,
  `\lim_{x\to0} x\cdot\operatorname{B}(x,3) = 1`.
- **Numeric limits containing sums now converge instead of hanging.** `N()`
  respects evaluation limits when probing a `Limit` at `\infty` whose body
  contains a variable-length `Sum` or `Product`. Examples that now converge
  quickly include `\lim_{n\to\infty}(\sum_{k=1}^{n} 1/k - \ln n)`, which
  evaluates to the Euler–Mascheroni constant, and
  `\lim_{n\to\infty}\frac{4}{n^2}\sum_{k=1}^{n}\sqrt{n^2-k^2}`, which evaluates
  to `\pi`.
- **Numeric limits with odd-power error terms now converge correctly.** This
  fixes cases such as `H_n - \ln n - \gamma \sim 1/2n`, which previously
  returned `NaN`. Decaying oscillations such as `\operatorname{sinc}` at
  `-\infty` now resolve to `0`, while divergent oscillations such as `\sin x` at
  `\infty` still return `NaN`.

### Step-by-Step Explanations

- **`explain('Integrate')` traces symbolic integration through the Rubi rule
  chain.** With the opt-in integration rules loaded (`loadIntegrationRules(ce)`
  from `@cortex-js/compute-engine/integration-rules`),
  `ce.parse('\\int x\\sqrt{1+x}\\,dx').explain('Integrate')` replays the
  driver's derivation as whole-expression states — term-by-term splits
  (`integrate.sum`), constant factors moved out (`integrate.constant-factor`),
  each corpus rule application (a stable `rubi:…` id with a compact description
  such as _"Apply integration rule 1.1.1.2#19 (Rubi)"_), reductions to special
  functions (`integrate.si-ci`, `integrate.partial-fractions`, …), and a closing
  simplification. A **definite** integral is presented via the Fundamental
  Theorem of Calculus: the antiderivative derivation, then the bracket `F |_a^b`
  (`integrate.fundamental-theorem`), the bounds substituted unevaluated
  (`integrate.evaluate-bounds` — skipped for improper integrals, where the
  bracket is a limit), and the value. Symbolic bounds are supported. The result
  is identical to `evaluate()`. Without the rules loaded, or when the rules
  cannot close the integral, a precise error is thrown. (Also fixed: the LaTeX
  serialization of the two-bound `\left. F \right|_a^b` `EvaluateAt` form
  dropped the upper bound.)

- **`explain('solve')` traces systems of inequalities and mixed systems.** A
  `List`/`And` of linear inequalities in two variables is traced through
  constraint normalization (`solve.system.normalize-inequality`), boundary
  intersection (`solve.system.intersect-boundaries`), and the feasible vertices
  (`solve.system.vertices`); mixed equality/inequality systems show the
  elimination steps, then each candidate checked against the constraints
  (`solve.system.check-constraints`, `solve.system.reject`). Both previously
  threw "not supported" errors.

- **`explain('simplify')` surfaces the work done inside operands.**
  Simplifications applied while descending into the operands of a sum, product
  or function argument — previously summarized by an opaque bookkeeping step —
  now appear as labeled steps with their own rule ids
  (`\tan x\cot x + \frac{x^3+x^2}{x^2}` shows the $\tan x\cot x \to 1$ rewrite
  before the expansion). At default verbosity, consecutive applications of the
  same rule are coalesced into a single step; pass `verbosity: 'all'` for the
  raw chain.

### Integration (opt-in Rubi rules)

- **Integration consistently respects `timeLimitMs`.** Nested integration
  attempts now share the original time limit and recursion safeguards, avoiding
  runaway evaluation on cyclic or difficult subproblems.
- **Any integration variable works—not just `x`.** Integrals using another
  variable could previously return an expression in `x`; for example,
  `\int t^2\,dt` now correctly returns `t^3/3`.
- **Symbolic-coefficient quartic-denominator rationals close.**
  `\int \frac{d+e\,x^2}{a+b\,x^4}\,dx` — and shapes that reduce to it, such as
  `\int \frac{x^6}{(a+c\,x^4)^3}\,dx` — now reach the trinomial terminal rules
  instead of ping-ponging between integrand expansion and binomial splitting.
- **Symbolic-coefficient reciprocal hyperbolics close.**
  `\int \frac{1}{a+b\sinh x}\,dx` and the cosh/tanh/coth/sech/csch variants
  resolve via a rational-normal-form retry in the exponential-substitution
  fallback.
- **Complex special-function closures.** Rational integrands with irreducible
  quadratic denominators split over complex-conjugate roots in the Si/Ci
  fallback, reciprocal-argument integrands like `\int x^m \sin(a + b/x)\,dx`
  close, and inverse-trig antiderivatives producing complex-argument `Erfi`
  evaluate (riding the new complex error-function kernels).
- **`\int F(\ln(a\,x^n))/x\,dx` closes** via a function-of-logarithm recognizer
  (substitution `u = \ln(a\,x^n)`).
- **Products of sines and cosines reduce via product-to-sum** before
  integration, closing mixed-angle products the term-by-term rules could not
  reach.

### Arithmetic

- **Canonical expressions no longer depend on a variable's current value.** A
  mutable symbol holding `0`, `1`, or `-1` could be folded into an expression
  while it was boxed, producing stale and sometimes incorrect results after the
  symbol changed. Canonicalization now folds only literal numbers; symbol values
  are substituted during evaluation. Numeric `const` symbols follow the same
  evaluation behavior as `Pi`.
- **Huge scientific exponents no longer crash.** Parsing or serializing a number
  literal whose exponent exceeds what the bignum layer can represent
  (`1e999999999`) threw; it now overflows cleanly to `+\infty` (and `-\infty`
  for negative mantissas), matching float semantics.
- **Complex values with an infinite component type as `complex`.** A `Complex`
  whose real or imaginary part is infinite was typed `finite_complex`, so
  type-gated paths mishandled it; it now reports the non-finite `complex` type.

### Sums and Products

- **Telescoping sums and products evaluate in closed form.** A sum whose body is
  a `k \to k+1` shift pair collapses exactly, for arbitrary symbolic bounds and
  either orientation: `\sum_{k=0}^{n} \bigl(g(k+1) - g(k)\bigr)` evaluates to
  `g(n+1) - g(0)`. The product counterpart recognizes a shift-quotient body
  after combining it over a common denominator:
  `\prod_{k=1}^{n-1}\left(1 + \frac{1}{k}\right)` evaluates to `n`.
- **`\prod_{k=1}^{n} k` evaluates to `n!`.** The bare-index product with a
  symbolic upper bound returns `Factorial(n)` instead of staying inert.
- **Classic infinite series and products evaluate to their exact closed forms.**
  p-series reduce to the zeta function — `\sum_{k=1}^{\infty} \frac{1}{k^2}`
  evaluates to `\frac{\pi^2}{6}`, `\sum \frac{1}{k^2} + \frac{1}{k^3}` to
  `\frac{\pi^2}{6} + \zeta(3)` (term-wise splitting applies only when every
  summand has a closed form) — and the Wallis product
  `\prod_{k=1}^{\infty}\left(1 - \frac{1}{(2k)^2}\right)` evaluates to
  `\frac{2}{\pi}`. Series with no known closed form stay symbolic under exact
  `evaluate()`, per the infinite-domain contract.
- **`.N()` of convergent infinite sums reaches near machine precision.** The
  numeric path Richardson-extrapolates the partial sums instead of returning a
  plain 10⁴-term truncation: `\sum 1/k^2` now numericizes to ~2·10⁻¹⁶ of `π²/6`
  (previously ~10⁻⁴ off), and series without closed forms benefit equally
  (`\sum 1/(k^2+1)` to ~2·10⁻¹⁴). Divergent or non-smooth series are detected
  and fall back to the capped truncation.

### Equation Solving

- **Trigonometric equations with symbolic coefficients solve correctly.** For
  example, `x^2 - 2x\cos t + 1 = 0` solved for `t` now returns
  `\pm\arccos\left(\frac{x^2+1}{2x}\right)`.

### Assumptions

- **Transitive closure over assumed inequality chains.** Assumptions now chain:
  `a \ge b`, `b \ge c`, `c \ge d` entails `a \ge d`, strictness propagates
  (`p > q > r` entails `p > r` and `p \ne r`), and an antisymmetric cycle
  collapses to equality — Wester 21's `x \ge y, y \ge z, z \ge x` now proves
  `x = z` is `True`. A chain without a back-edge deliberately does _not_ prove
  equality.
- **Even-power monotonicity on ordered positives.** Wester 22's
  `x > y, y > 0 \vdash 2x^2 > 2y^2` now evaluates to `True` (a difference of
  equally-scaled squares factors as `k(x-y)(x+y)` with both factor signs settled
  from the assumptions). `x > y` alone deliberately does _not_ conclude
  `x^2 > y^2`, and solve()'s conservative root-filtering behavior is unchanged.

### Simplification and Exact Arithmetic

- **The Fu strategy reduces same-power sin/cos differences.**
  `simplify({ strategy: 'fu' })` now rewrites `\sin^4 x - \cos^4 x` to
  `-\cos 2x` (and the mirrored/2nd-power forms): a difference of squares whose
  Pythagorean sum factor is `1`, which the exponent-2-only TR5/TR6/TR7
  transforms could not reach. Verified numerically; the default `simplify()`
  path is deliberately unchanged (pinned by test).
- **Exact modulus of complex expressions with radical parts.** `Abs` of a
  constant `a + b\,i` with radical/rational parts computes the exact
  `\sqrt{a^2 + b^2}` when it genuinely folds: Kahan's
  `\left|3-\sqrt{7}+i\sqrt{6\sqrt{7}-15}\right|` simplifies to exactly `1` (its
  `.N()` alone carries a `1.0000000000000000315` float residue), `|5-12i| = 13`,
  `|2+\sqrt{5}\,i| = 3`, `|1+2i| = \sqrt{5}`. A split whose "imaginary part" is
  itself imaginary (a negative radicand) is rejected by a numeric cross-check,
  and symbolic `|x+iy|` never folds.
- **Matrices differentiate elementwise.** `D` over a vector/matrix `List`
  literal maps over the elements (recursively for nested lists) instead of
  producing a nonsensical scalar chain-rule expansion: the second derivative of
  the rotation matrix `[[\cos t, \sin t], [-\sin t, \cos t]]` is `-M`, as it
  should be. `Derivative` shares the fix.
- **`Together` combines fractions correctly.** It now uses a common denominator
  instead of adding numerators and denominators independently:
  `\frac{a}{b} + \frac{c}{d} \to \frac{ad + bc}{bd}`,
  `1 + \frac{1}{k} \to \frac{k+1}{k}`, reusing the denominator when terms
  already share it.

### Linear Algebra

- **Exact null spaces, ranks, and eigenvectors.** The exact bigint-fraction
  elimination introduced for `RowReduce` in 0.73.0 now backs `Kernel`
  (null-space basis vectors come out as exact rationals: `[[2,3],[0,0]]` → basis
  `[-3/2, 1]`), `MatrixRank` (rank = exact pivot count, with no float-tolerance
  ambiguity), and eigenvector computation (when the matrix and the eigenvalue
  are exact rationals, `A - \lambda I` is solved exactly — the eigenvectors of
  `[[4,1],[2,3]]` are the exact `[1, 1]` and `[-1/2, 1]`). Inexact or symbolic
  entries fall back to the numeric path unchanged.
- **`M · M^{-1}` simplifies to the identity for symbolic matrices.** Two fixes
  combine: `simplify()` now recurses into `List` elements (matrix entries were
  previously unreachable by any simplify rule), and a new rule combines a sum of
  fractions sharing an identical denominator into a single fraction so the
  diagonal entries `\frac{a^2 b}{a^2 b - b} + \frac{-b}{a^2 b - b}` cancel to
  `1`.
- **Symbolic matrix rank via the determinant.** `MatrixRank` of a small symbolic
  matrix now concludes when the simplified determinant settles the question: the
  trigonometric matrix
  `[[\sin 2t, \cos 2t], [2\sin t\cos t, \cos^2 t - \sin^2 t]]` has rank `1` (its
  determinant vanishes under `TrigReduce`). Indeterminate cases stay symbolic,
  as before.
- **Vandermonde determinants return the difference product.** The determinant of
  a symbolic Vandermonde matrix (either orientation) is produced directly in its
  factored closed form `\prod_{i<j}(x_j - x_i)` instead of an unfactored
  expansion.
- **The numeric eigensolver converges on hard spectra.** The QR iteration was
  rebuilt as Householder reduction to Hessenberg form followed by the Francis
  double-shift algorithm with deflation. The classic 8×8 Rosser stress matrix —
  double eigenvalue `1000`, a `±10\sqrt{10405}` pair, and a tiny eigenvalue
  `≈0.098` — now yields the true spectrum (the unshifted iteration returned
  wrong values), and non-symmetric matrices get proper complex-conjugate
  eigenvalue pairs (`[[0,-1],[1,0]]` → `\{i, -i\}`).
- **`MatrixPower(M, 1/2)` — principal matrix square root.** Half-integer powers
  of an exact 2×2 positive-semidefinite matrix evaluate exactly via the closed
  form
  `\sqrt{M} = (M + \sqrt{\det M}\,I)/\sqrt{\operatorname{tr} M + 2\sqrt{\det M}}`:
  `MatrixPower([[10,7],[7,17]], 1/2)` → `[[3,1],[1,4]]`, and `3/2`, `-1/2` etc.
  compose with the integer path.
- **New operator: `SingularValues`** — the singular values of a matrix,
  descending, zeros included; exact when the Gram matrix is at most 2×2 with
  rational entries (`SingularValues([[1,1],[2,2],[3,3]])` → `\{2\sqrt{7}, 0\}`),
  numeric via the SVD machinery otherwise. (Across this release's Wester rounds
  the `wester.test.ts` skip ledger drops from 21 to 3 — the remaining three are
  the radical-denesting tail.)

### Core

- **`String(…)` joins values, not serialized forms.** A string operand's quotes
  leaked into the result: `String("x = ", 3)` evaluated to a string whose
  _content_ was `"x = "3`. It now evaluates to `x = 3`. This also fixes Cortex
  string interpolation, which lowers to `String` — the documentation's headline
  example `"\(x) has type \(Type(x))"` now produces `"2047 has type integer"`.
- **`Type` reports the type of symbols and expressions.** The `Type` operator
  holds its operand unevaluated, but an unevaluated operand is not canonical and
  a non-canonical expression has no type — so `Type(y)` returned `"unknown"`
  even for a symbol bound to an integer, and `Type(1 + x)` returned `"unknown"`
  instead of `"number"`. The operand is now canonicalized (still not evaluated)
  before its type is read.

### Cortex Language (Experimental)

- **Runtime problems in non-final statements are no longer silent.** Only the
  last statement's value is returned from `executeCortex`, so an error value
  produced by an earlier statement used to vanish — an unsupported indexed
  assignment (`xs[2] = 9`) or a mid-program `const` reassignment went completely
  unreported. Each non-final statement that evaluates to an error value now
  emits a `runtime-error` diagnostic carrying the statement's source range; the
  final statement's errors stay in `value`, per the errors-are-values contract.
- **Verbatim symbols are truly literal.** The content of a backtick-quoted
  symbol (`` `while` ``) receives no escape processing and must be a valid
  MathJSON symbol name — the verbatim form exists to name reserved words.
  Previously, string escape sequences were applied inside the backticks
  (`` `\sin` `` silently cooked `\s` into a space) even though no valid symbol
  name contains an escapable character, so every such escape could only produce
  an invalid name.
- **New “Examples” documentation page.** Eighteen complete Cortex programs —
  iteration and accumulation, recursion, numeric methods, exact and symbolic
  computation, collections — from FizzBuzz-as-a-`Map` to Newton's method on
  exact rationals, the Basel problem against `\pi^2/6`, and a golden-ratio
  continued fraction checked against a `$…$` LaTeX island. Every program on the
  page is verified by an executable test suite.

### Collections

- **Symbolic-bound `Range` and `Linspace` stay inert instead of collapsing.** A
  symbolic bound was silently coerced to `1`, so `Range(1, n)` behaved as the
  one-element range `[1]` everywhere: `Count(Range(1, n))` evaluated to `1`,
  `Sum(Range(1, n))` to `1`, `Range(1, n) = Range(1, m)` to `True`, and
  materialization produced the literal `[1]`. All of these now stay
  symbolic/indeterminate, across the scalar accessors (`Count`, `At`, equality,
  `SubsetOf`, element sign), iteration, materialization, and the extrema
  (`Supremum`/`Infimum`/`Min`/`Max`). Likewise for `Linspace`: a _symbolic_
  point count is indeterminate (only a _missing_ count selects the default of
  50), and symbolic endpoints no longer materialize as `NaN` literals or fold
  `Sum(Linspace(a, 1, 3))` to `0` — a collection that reports a size but cannot
  compute its elements now keeps its lazy form rather than fold to the
  reduction's initial value. Concrete bounds are unaffected.
- **`Min`/`Max`/`Supremum`/`Infimum` keep unenumerable collections symbolic.**
  The extrema used to iterate any collection operand: an infinite one (a `Map`
  over a continuous `Interval`) ground through the interval's dense sampler
  until the evaluation deadline, and one that reports elements it cannot compute
  (a `Map` over a `Linspace` with a symbolic endpoint) silently _vanished_ from
  the result — `Min(Map(...), 5)` returned `5` even though the mapped values
  could be smaller. Both now stay in the symbolic result. A genuinely empty lazy
  collection (a `Filter` with no matches) still folds away, and finite
  collections fold as before.

### Compilation

- **New `iterationBudget` compile option.**
  `expr.compile({ iterationBudget: 1e6 })` caps the trip count of emitted
  `Sum`/`Product` loops: a loop whose iteration count would exceed the budget —
  including an _infinite_ bound, which previously compiled to a loop that never
  terminated — evaluates to `NaN` instead of running. Compilation without the
  option is unchanged (unbounded loops, zero overhead); the engine's numeric
  limit probes use it internally to stay interruptible.
- **The `interval-js` target compiles every operand of n-ary nodes.** Chained
  relations (`1<x<4`) compiled to only their first binary comparison, and n-ary
  `And`/`Or` dropped every operand past the first pair — for `Or` this was
  unsound in the exclusion direction (an interval admitted only by a dropped
  branch reported a definitive `"false"`, so a mask-driven consumer would
  wrongly cull it). Chains now emit the tri-state conjunction of all pairwise
  comparisons, and `And`/`Or` fold all operands; the `javascript`/`glsl` targets
  were always correct.
- **The `javascript` target fails closed on scalar arithmetic over a list-valued
  operand.** `L + x` with a list-valued `L` previously compiled with
  `success: true` to JS array coercion (returning a _string_). It now reports
  `success: false` with an explanatory error, and the interpretation fallback
  returns the correct broadcast list. Supported list compilation — broadcast
  (`\sin([x, 2x])`), literals, ranges, GPU vectors, custom vector operators — is
  unchanged.
- **Seeded, reproducible randomness: `ce.randomSeed`.** Assigning a `number` or
  `string` seed makes `Random()`/`Random(n)` (and `Shuffle`, `Sample`) draw from
  a per-engine deterministic PRNG stream; re-assigning the same seed resets the
  stream so identical evaluation sequences reproduce, and `null` (the default)
  restores non-deterministic behavior. With a seed set at compile time, each
  `Random` node in a `javascript`-target compilation bakes to a constant derived
  from the seed and the node's position — a compiled plot function returns the
  same value at the same call site on every invocation (one draw per
  compilation), instead of flickering per sample. The explicit per-call
  `Random(seed)` overload is unchanged.
- **GLSL masked branches emit an overridable `_gpu_nan()` helper.** The
  else-branch of a compiled `When`/`Which`/`If` was a bare `0.0 / 0.0`, whose
  NaN semantics GLSL ES 1.00 leaves implementation-defined. The literal now
  lives in a single selective-preamble helper that ES 3.00 hosts can replace
  with `intBitsToFloat(0x7FC00000)` for a guaranteed bit pattern.

### Parsing

- **Bare-command function names `\abs`, `\floor`, `\mod`, `\sign` parse as
  function calls.** `\abs\left(x\right)` → `Abs(x)`, `\floor(x)` → `Floor(x)`,
  `\mod(a, b)` → `Mod(a, b)`, `\sign(x)` → `Sign(x)` — common informal shorthand
  (and Desmos output) that previously errored with `unexpected-command`. The
  infix `a \mod b` (synonym of `\bmod`) is unchanged. Also,
  `\operatorname{sign}` now aliases to `Sign` like `sgn` (it previously parsed
  silently as a free symbol `sign` multiplied by the argument).
- **A dot-number after a closing group multiplies.**
  `\left(1-t\right).9\left(2\right)` and `t^{i}.4` parse the `.9`/`.4` as a
  decimal literal juxtaposed with the preceding operand (implicit
  multiplication), instead of erroring with `unexpected-operator`. Degenerate
  dot sequences after a _number_ (`1.2.3`) still error, and member access
  (`v.x`), ranges (`1..2`), and trailing-dot numbers (`(1., 2)`) are unaffected.
- **`\frac{d}{X}` is a division unless the denominator is a differential.**
  Leibniz-derivative parsing now requires an actual `d`-marker in the
  denominator (`\frac{d}{dx}`, `\frac{dy}{dx}`, `\frac{d^2}{dx^2}`…). A bare-`d`
  numerator over a plain denominator — `\frac{d}{L}` where `d` is an ordinary
  variable, common in pedagogy graphs — previously parsed to a malformed
  derivative `D(missing, L)`; it is now `Divide(d, L)`.
- **A matrix environment parses as a function argument.**
  `\operatorname{Trace}\left(\begin{pmatrix}1&2\\3&4\end{pmatrix}\right)` — and
  any library or user-declared function called on a `pmatrix`-family
  environment, with or without `\left`/`\right` — parsed the argument as a
  missing-argument error, so `Trace`, `Eigenvalues`, `Eigenvectors`, etc.
  appeared broken from LaTeX while working from MathJSON. The matrix (alone or
  among other arguments) now parses, evaluates, and round-trips.

### API

- **`ce.operatorInfo()` reports computability.** The returned record now carries
  `canEvaluate: boolean` — `true` when the operator's definition has an
  evaluation rule, `false` for a registered-but-inert head that only
  parses/serializes (e.g. `To`, `Tilde`). Together with an `undefined` return
  (no operator definition), integrators can gate free-form input on "can this
  actually compute" instead of hand-maintaining allowlists. Note: heads that
  reduce via canonicalization to another operator (`Exp` → `Power`, `Greater` →
  `Less`) report `false`; query the canonical form.

### Special Functions

- **New operators: `SinhIntegral` and `CoshIntegral`** — the hyperbolic sine and
  cosine integrals Shi and Chi, with numeric evaluation for real _and_ complex
  arguments (`Shi(2) ≈ 2.50157`, `Chi(2) ≈ 2.45267`; validated against mpmath)
  and derivatives (`\frac{d}{dx}\operatorname{Shi}(x) = \frac{\sinh x}{x}`,
  `\frac{d}{dx}\operatorname{Chi}(x) = \frac{\cosh x}{x}`). Exact arguments stay
  symbolic under `evaluate()`; `.N()` owns the numeric path.
- **`Erf` and `Erfi` evaluate for complex arguments.** Both error functions now
  have full complex-plane numeric kernels
  (`\operatorname{erf}(1+i) ≈ 1.31615 + 0.19045i`, validated against mpmath),
  instead of evaluating only on the real line.
- **Subscripted special-function notation parses.** `\operatorname{W}_{-1}(x)`
  now parses to the two-argument `["LambertW", x, -1]` (branch last), and
  `\operatorname{J}_{n}(x)` / `\operatorname{Y}` / `\operatorname{I}` /
  `\operatorname{K}` parse to `BesselJ(n, x)` et al. (order first) — these forms
  previously serialized but did not parse back, so LaTeX round-trips of
  non-principal Lambert branches and indexed Bessel functions now close.
- **The two-argument `LambertW(z, k)` differentiates.** Every fixed branch
  satisfies the same functional equation, so
  `d/dz W(z,k) = W(z,k)/(z·(1+W(z,k)))` now carries the branch through (chain
  rule included); the derivative with respect to the discrete branch index stays
  inert. Verified against central differences on both real branches.
- **Fungrim identities: `W₋₁(x·ln x) → ln x` fires.** The upstream entry
  `a172c7` published an _empty_ assumption interval
  (`OpenClosedInterval(0, −1/e)`); the corrected band `x ∈ (0, 1/e]` was fixed
  in the corpus fork (submitted upstream), and the recompiled identities
  artifact now carries the rule: with `loadIdentities(ce)` and
  `assume(0 < x ≤ 1/4)`, `simplify(W(x·ln x, −1))` returns `ln x`.
- **Fungrim identities: the polygamma family is live (+28 rules, artifact
  1,442).** The corpus' 2-argument `DigammaFunction(z, m)` (the order-`m`
  polygamma) now translates to CE's native `PolyGamma(m, z)` instead of a
  compat-shadowed 2-arg `Digamma`, so 28 previously skipped identities and
  special values compile and fire: `simplify(PolyGamma(1, 1)) → π²/6`,
  `PolyGamma(1, 1/4) → π² + 8·Catalan`, `PolyGamma(1, 1/2) → π²/2`, the
  digamma/polygamma recurrence and reflection identities, and more.
- **Fungrim identities: set-builder comprehensions get a real encoding (+8
  rules, artifact 1,450).** Corpus formulas of the shape
  `{f(x) : x \in S, P(x)}` used to translate to a literal `Set` that CE read as
  a two-element enumeration — producing wrong scalars where one was consulted
  (`Count` of a set-builder returned its operand count). They now translate to
  the faithful `Map(Filter(S, P), f)` form, which both fixed the miscounts and
  _recovered_ nine identities whose match side had been untranslatable — notably
  the prime-counting definition, so with `loadIdentities(ce)`, `simplify`
  rewrites `Count(\{p \in \mathrm{Primes} : p \le x\})` to
  `\operatorname{PrimePi}(x)`. Extrema over comprehensions
  (`\min\{f(x) : x \in S\}`) get the same encoding. The full 2,551-entry corpus
  now validates with **zero** numerically false entries.

## 0.73.0 _2026-07-09_

### New Operator: `Interpret`

- **`Interpret(expr)` gives formal meaning to elliptical notation.** Evaluating
  `["Interpret", expr]` turns a continuation-bearing sum or product (the inert
  notational objects produced by the ellipsis fold barrier, see below) into a
  formal `Sum`/`Product`: `Interpret(1 + 2 + \dots + n)` → `\sum_{k=1}^{n} k`,
  `Interpret(2 \cdot 4 \cdot \dots \cdot 2n)` → `\prod_{k=1}^{n} 2k`, and
  `Interpret(1 + 2 + \dots + 100)` → a `Sum` that evaluates to `5050`.
  Interpretation is an explicit opt-in — a plain `evaluate()` never guesses —
  and the gate is strict by design: at least two exact numeric sample terms in
  arithmetic progression and a single anchor whose implied upper bound is
  integral (so `1 + 3 + \dots + 2n`, whose even anchor does not belong to the
  odd progression, stays untouched). Anything the gate cannot prove is returned
  unchanged.
- **Polynomial and geometric patterns are recognized too (v2).** Successive
  finite differences identify polynomial general terms —
  `Interpret(1 + 4 + 9 + 16 + \dots + n^2)` → `\sum_{k=1}^{n} k^2`, cubes and
  triangular numbers likewise — and a constant exact ratio identifies geometric
  ones: `1 + 2 + 4 + \dots + 2^n` → `\sum_{k=1}^{n+1} 2^{k-1}`,
  `2 \cdot 4 \cdot 8 \cdot \dots \cdot 2^n` → `\prod_{k=1}^{n} 2^k`. Numeric
  anchors resolve to concrete bounds (`1 + 4 + 9 + \dots + 100` → a sum to 10
  that evaluates to `385`). An evidence discipline guards against overfitting: a
  degree-g polynomial needs its constant difference row witnessed twice, or one
  fewer sample when the anchor structurally confirms the general term — three
  samples fit _any_ quadratic, so `1 + 2 + 4 + \dots + m` stays untouched.
- **Linear recurrences are recognized (v3).** An exact-rational Berlekamp–Massey
  pass finds the minimal constant-coefficient recurrence (order ≥ 2) behind the
  samples, obtains a verified closed form through `RSolve`, and resolves numeric
  anchors by iterating the recurrence exactly:
  `Interpret(1 + 1 + 2 + 3 + 5 + 8 + \dots + 55)` →
  `\sum_{k=1}^{10} \operatorname{Fibonacci}(k)`, which evaluates exactly to
  `143`; Pell-number sums likewise (with a Binet-style body). The same evidence
  discipline applies — a recurrence of order L needs `2L+1` samples (or `2L`
  with a confirming anchor), so primes and factorials stay untouched. Closed
  forms are verified against every sample before being trusted.
- **Subtraction-spelled ellipses are protected too.**

### Number Theory

- **Modular arithmetic reaches common notation.** `Mod` and `Congruent` now
  reduce integer-valued expressions in ℤ/mℤ without materializing the
  (potentially astronomically large) intermediate value. Modular exponentiation,
  sums, products, negations and factorial reduction are all handled, so
  `2^{3^{20}} \pmod{100}` evaluates to `52` and
  `2^{3^{20}} \equiv 52 \pmod{100}` evaluates to `True`, where both used to stay
  inert. The floored-sign convention of `Mod` (the result follows the divisor)
  is preserved on the new path.
- **New `ModularInverse(a, m)`** returns the modular multiplicative inverse of
  `a` modulo `m` — the integer `x` in `[0, m)` with `a·x ≡ 1 (mod m)` — and
  stays symbolic when `a` and `m` are not coprime.
- **Linear congruences and CRT systems solve.** `solve` on a linear congruence
  returns the parametric residue family with a fresh integer parameter `t ∈ ℤ`
  (`6n \equiv 4 \pmod 7` → `7t + 3`), an empty result when there is no solution
  (`2x \equiv 1 \pmod 4`), and reduces gcd-divisible congruences
  (`4x \equiv 2 \pmod 6` → `3t + 2`). A system of simultaneous congruences in
  one unknown is combined via the Chinese Remainder Theorem — including
  non-coprime moduli — into a single family (`x \equiv 2 \pmod 3`,
  `x \equiv 3 \pmod 5`, `x \equiv 2 \pmod 7` → `105t + 23`); an inconsistent
  system reports no solution.
- **Huge exact products stay symbolic instead of overflowing.** `Multiply` now
  applies the same digit-count budget as `Power` when an exact power term
  (`base^exp`) would be folded into a product's numeric coefficient: if
  materializing that power would exceed the budget, the factor is kept as a
  symbolic `Power` term rather than computed eagerly (`2 \cdot 3^{5000000}`
  stays `2 \cdot 3^{5000000}` instead of building a multi-million-digit
  `bigint`). This also lets `Mod`/`Congruent` reduce such products —
  `2 \cdot 3^{5000000} \pmod 7` evaluates to `4` — without ever materializing
  the giant intermediate value.

### Arithmetic

- **New operator: `PolyLog` — the polylogarithm Liₛ(z).** Numeric evaluation for
  integer order s ≥ 2 over the whole complex plane (validated against mpmath to
  ≈5·10⁻¹⁵; branch cut z ∈ (1, ∞) with the below-the-cut convention), and exact
  reductions for the elementary orders and special points: `Li₁(z) → −ln(1−z)`,
  `Li₀(z) → z/(1−z)`, `Li₋₁(z) → z/(1−z)²`, `Liₙ(1) → ζ(n)`,
  `Liₙ(−1) → (2^{1−n}−1)·ζ(n)`, `Liₛ(0) → 0`. Parses and serializes as
  `\operatorname{Li}_s(z)` (the unsubscripted `\operatorname{Li}`,
  conventionally the _offset_ logarithmic integral, is deliberately not
  claimed).
- **`LogIntegral` now has its standard notation.** `\operatorname{li}(x)` parses
  to `LogIntegral` and serializes back (previously the fallback
  `\mathrm{LogIntegral}(x)`).
- **Repeating decimals box as exact rationals.** A LaTeX repeating-decimal
  literal — vinculum (`0.\overline{3}`), dots
  (`0.\overset{.}{1}4285\overset{.}{7}`), parenthetical (`1.54(2345)`), or arc
  (`0.\wideparen{142857}`) notation — and the MathJSON `{num: "0.(3)"}`
  shorthand now box directly to the exact `Rational` they represent
  (`0.\overline{3}` → `["Rational", 1, 3]`, `1.(2345)` →
  `["Rational", 12344, 9999]`) instead of a truncated decimal float carrying a
  repeating-decimal marker.
- **`Norm` accepts point-like `Tuple`s.** `\|(-3, 4)\|` now evaluates to `5`
  instead of leaving the expression inert.
- **Double-factorial symbolic reductions.** Under `simplify()`, `(2n)!!` reduces
  to `2^n \cdot n!` and `(2n+1)!!` reduces to `\frac{(2n+1)!}{2^n \cdot n!}`
  when `n` is integer-typed.

### Equation Solving

On a 40-case univariate solving benchmark derived from SymPy's own test suite
(graded by substituting the returned roots back into the equation), this release
reaches **38/40 — parity with both SymPy and Mathematica** — up from 26/40 for
the previous release (base engine, without the opt-in solve templates: 33/40, up
from 24). The two remaining cases (Dottie-style transcendental fixed points) are
unsolved by SymPy and Mathematica as well. What changed:

- **Inverse trigonometric and hyperbolic equations solve exactly.**
  `\arcsin x = c`, `\arccos x = c` and `\arctan x = c` return the exact root
  (`\arcsin x = \frac12` → `\sin\frac12`), with out-of-range constants correctly
  rejected (`\arctan x = 2` has no solution — `2` is outside arctan's range).
  `\sinh x = c` and `\tanh x = c` return their single root, and `\cosh x = c`
  returns **both** roots `\pm\operatorname{arcosh}(c)`.
- **Exponential-symmetric equations are recognized.** `e^x \pm e^{-x}`
  harmonizes to `2\cosh x` / `2\sinh x` before solving, so `e^x + e^{-x} = 4`
  returns both roots `\pm\operatorname{arcosh}(2)`.
- **Two-absolute-value equations solve.**
  `a\,\lvert f(x)\rvert = b\,\lvert g(x)\rvert` is squared into
  `a^2 f^2 - b^2 g^2` (candidates are validated against the original equation,
  so no extraneous roots): `\lvert x-1\rvert = \lvert x+3\rvert` → `-1`.
- **Rational equations cancel correctly before solving.** Clearing denominators
  no longer expands numerators past their common factor (`\frac{2x}{x+2} = 1` →
  `2`), and pure-number denominators are no longer multiplied through at all —
  rational constants stay where the solve patterns expect them.
- **`LambertW` gains the real lower branch W₋₁.** The 2-argument form
  `["LambertW", z, k]` selects the branch (`k` is `0` or `-1`; other branches
  stay symbolic): exact evaluation, machine- and arbitrary-precision numerics on
  the branch domain `[-1/e, 0)`, compilation, and `\operatorname{W}_{-1}(x)`
  LaTeX serialization. `W(-\frac1{10}, -1)` evaluates symbolically and `.N()`s
  to `-3.5771520639…`.
- **The opt-in solve templates now cover Lambert-type equations on both real
  branches.** With `loadIdentities(ce, { solve: true })` (from the `identities`
  bundle), equations reducible to `W` solve exactly and return **every real
  root**: `x e^x = -\frac1{10}` →
  `\{\operatorname{W}(-\frac1{10}), \operatorname{W}_{-1}(-\frac1{10})\}`,
  `e^x - x - 2 = 0` →
  `\{-2 - \operatorname{W}(-e^{-2}), -2 - \operatorname{W}_{-1}(-e^{-2})\}`, and
  mixed linear-exponential forms like `x + 2^x = 0` →
  `-\operatorname{W}(\ln 2)/\ln 2`. Exact rational, float, and integer
  right-hand sides are all handled. The identities library also simplifies
  `W(x e^x, -1) \to x` under `assume(x \le -1)`.

### Integration (opt-in Rubi rules)

New rule coverage in the `integration-rules` bundle (`loadIntegrationRules`):

- **Polynomial × csc²/sec² integrates by parts.** `\int x\csc^2 x\,dx` →
  `-x\cot x + \ln \sin x`, and likewise for `P(x)\sec^2(ax+b)` with any
  polynomial `P` (the recursion reduces the polynomial degree).
- **Rational × sin/cos of a linear argument reduces to Si/Ci.**
  `\int \frac{\sin x}{x+1}\,dx` returns the exact
  `\sin(-1)\operatorname{Ci}(x+1) + \cos(-1)\operatorname{Si}(x+1)` form via
  partial fractions over linear factors.
- **Secant-family binomials route through the dedicated secant rules.**
  Integrands like `\frac{1}{1+\sec x}` now resolve
  (`x - \frac{\tan x}{\sec x + 1}`) instead of returning unevaluated.
- **Cotangent integrands reflect onto the tangent rules**, closing forms like
  `\int \cot^3 x\,dx` → `-\frac{\cot^2 x}{2} - \ln \sin x`.

### Simplification and Exact Arithmetic (Wester round 1)

- **Rational radicands extract perfect-power factors.** `(1029/1000)^{1/3}` now
  canonicalizes to `\frac{7}{10}\sqrt[3]{3}` (numerator and denominator factored
  independently), extending the existing integer-radicand extraction. Also fixed
  an exactness leak where a higher root of an exact literal could evaluate to a
  float times `Root(1, n)` (e.g. Wester 28's `2^{1/3}` expressions now stay
  all-exact under `evaluate()`).
- **Pythagorean factoring in `simplify()`.**
  `\cos^3 x + \cos x\sin^2 x - \cos x` now simplifies to `0`: a sum with a
  shared factor times `\cos^2 u` and `\sin^2 u` combines
  (`g\cos^2 u + g\sin^2 u \to g`), generalizing the bare
  `\sin^2 x + \cos^2 x \to 1` case.
- **Rational-function cancellation fires in `simplify()`** (Wester 14):
  `\frac{x^2-4}{x^2+4x+4}` simplifies to `\frac{x-2}{x+2}`. The cancellation
  machinery existed but its result was destroyed by a subsequent
  expand-over-sum-denominator rewrite in the same pass; that split is now
  suppressed (it never reduces complexity).
- **`Binomial(n, k)` and `Pochhammer(a, k)` expand for small literal `k`** with
  a symbolic first argument: `Binomial(n, 3)` evaluates to
  `\frac{n(n-1)(n-2)}{6}`, `Pochhammer(a, 3)` to `a(a+1)(a+2)` (k ≤ 20).
  `Pochhammer` is a newly registered operator (it previously had no definition
  and was fully inert).
- Six Wester CAS-review tests unskipped in `wester.test.ts` (the skip ledger
  drops from 27 to 21).

### Linear Algebra

- **`RowReduce` is exact on exact input.** Reduction of an integer or rational
  matrix now uses exact bigint-fraction elimination — the RREF of an integer
  matrix has exact `-1`/`3` pivots instead of `-0.999…`/`2.999…` float
  artifacts. Float matrices use the numeric path unchanged.
  (`NullSpace`/`MatrixRank`'s float elimination is tracked in the ROADMAP for
  the same treatment.)
- **Products of declared matrices type correctly.** A product with a
  matrix/vector/list-typed operand now carries the collection type instead of
  collapsing to a numeric type: with `X` and `Y` declared `matrix`, `2Y`, `XY`,
  `X - Y` and `3X + 2Y` all type as `matrix` (previously `finite_number`, which
  made `\det(XY)` fail validation as an `incompatible-type` error). `Trace` of a
  matrix now types as `number`. All-scalar products are unchanged. Note:
  _undeclared_ symbols in a matrix-expecting argument (`\det(A+2B)` with fresh
  `A`, `B`) still infer as numbers — declare matrix/vector symbols for symbolic
  matrix algebra (see the ROADMAP "Matrix-operator typing" item for the planned
  inference-ordering fix).

### Units

- **Compound units cancel in quantity arithmetic.** Multiplying or dividing
  quantities now cancels units structurally instead of accumulating them:
  `18 \text{ in} / (12 \text{ in/ft})` evaluates to `1.5 \text{ ft}` (previously
  the inscrutable `1.5 \text{ in/in/ft}`). A repeated unit symbol cancels
  exactly — no conversion factors are introduced — while different units of the
  same dimension on opposite sides of a fraction bar are converted and folded
  into the magnitude: `\frac{10 \text{ m} \cdot 1 \text{ s}}{5 \text{ in}}` →
  `78.74 \text{ s}`. Products of same-dimension units are left as written
  (`2 \text{ in} \cdot 3 \text{ ft}` stays `6 \text{ in} \cdot \text{ft}`), and
  simplification to named derived SI units still applies afterwards
  (`2 \text{ N} \cdot 3 \text{ m}` → `6 \text{ J}`). Works with measurement
  (uncertainty-carrying) magnitudes as well.
- **New units: `yd`, `qt`, `pt`, `cup`, `wk`.** Yards, quarts, pints, cups (US
  liquid convention, consistent with the existing US `gal`) and weeks join the
  unit registry, with their English word aliases (`5 \text{ yards}` →
  `5 \text{ yd}`), and convert exactly: `1 \text{ gal} / 1 \text{ qt}` evaluates
  to `4`.
- **Currency: dollars and cents.** A new currency dimension backs the `USD` and
  `cent` units (`18 \text{ dollars}` → `18 \text{ USD}`,
  `1 \text{ dollar} + 50 \text{ cents}` → `1.5 \text{ USD}`), and currency
  participates in unit cancellation (`\$6 / (\$2/\text{lb})` → `3 \text{ lb}`).
  Other currencies are deliberately not modeled: exchange rates are not fixed
  constants, so cross-currency expressions stay inert rather than silently
  wrong.
- **Spaced unit phrases parse.** Multi-word unit text such as
  `60 \text{ miles per hour}` now parses to `60 \text{ mi/h}` — spaces inside
  `\text{...}` unit annotations are preserved and `per` reads as division —
  where previously the words ran together and the unit was not recognized.

### New Notations

- **Base-subscript numerals compute.** A numeral with an integer-literal
  subscript base, e.g. `10111_2` or `2748_{16}`, now parses to the numeric
  `BaseForm(value, base)` head (`10111_2` → `["BaseForm", 23, 2]`), so
  arithmetic on based numerals works: `1011_2 \cdot 101_2` evaluates to `55`,
  and `11_8 - 3_8 = 6_8` evaluates to `True`. The guard is strict — every digit
  must be valid for the base (`19_2` stays an inert `Subscript`), subscripted
  symbols (`x_2`) are unchanged, and values larger than 2⁵³ stay exact. The
  `BaseForm` LaTeX serializer was also fixed (it emitted an unbalanced
  parenthesis) and now round-trips: `BaseForm(23, 2)` serializes as `10111_{2}`.
  A numeral with a **symbol** subscript base, e.g. `161_b` or `161_{b}`, now
  parses to `BaseForm` of the digit polynomial in that base (`161_b` →
  `["BaseForm", ["Add", ["Power", "b", 2], ["Multiply", 6, "b"], 1], "b"]`, i.e.
  `b² + 6b + 1`), so arithmetic works symbolically (`161_b + 134_b` evaluates to
  `2b² + 9b + 5`) and the numeral round-trips back to `161_{b}`. Base equations
  solve: `161_b + 134_b = 315_b` reduces to `b² − 8b = 0` and solves to `b = 8`
  (and `b = 0`).
- **Sequence-braces notation.** `\{a_n\}_{n=1}^{\infty}` now parses to the new
  inert `IndexedSequence(term, index, lower, upper)` head instead of an
  `incompatible-type` error. The term uses the operator-call form
  (`["a_", "n"]`) so the index binding survives; `_{n\in\mathbb{N}}` subscripts
  map to the set's least element as the lower bound; the expression is inert
  under `evaluate()` and `simplify()` and round-trips through LaTeX. Bare
  `\{a_n\}` remains a `Set`, and the parenthesized form `(a_n)_{n\in\mathbb{N}}`
  is unchanged.

### Ellipsis Expressions

- **Sums and products no longer fold numeric terms across an ellipsis.** An
  `Add` or `Multiply` containing an ellipsis (`\dots`, the
  `ContinuationPlaceholder` symbol) is a notational pattern, not an arithmetic
  one: it now keeps its operands in source order with their structure intact,
  and is returned unchanged by `evaluate()`, `N()` and `simplify()`. Previously
  `1 + 2 + \dots + n` canonicalized to `n + 3 + \ldots` — folding the sample
  terms and destroying the pattern — and `2 \cdot 4 \cdot \dots \cdot 2n` folded
  to `16 \cdot \ldots \cdot n`, tearing the coefficient out of the `2n` anchor.
  Such products also round-trip through LaTeX now (an explicit `\times` is
  emitted around the ellipsis instead of juxtaposition).

### LaTeX Parsing

Recovery fixes from the Hendrycks-MATH genre sweep (`docs/mathnet/`), taking
that corpus from 97.09% to 97.38% clean parse:

- **Ordinal superscripts** devolve to the base number: `13^{\text{th}}` now
  parses as `13` (also `1^{\text{st}}`, `k^\text{th}`, `\mbox` variants). Only
  an exact ordinal suffix (`st`/`nd`/`rd`/`th`, case-insensitive) is dropped;
  other superscripts are unchanged.
- **Empty scripts are dropped:** `x^{}` and `x_{}` now parse as `x` instead of
  producing an error.
- **`{,}` thousands separator:** the LaTeX thin-separator idiom `1{,}000` now
  parses as the number `1000`. Only between digits, and a configured
  `decimalSeparator: '{,}'` (European convention) takes precedence — `3{,}14`
  still parses as `3.14` in that mode.
- **`\cancel`, `\bcancel`, `\xcancel`** unwrap to their body, and
  **`\cancelto{4}{72}`** parses to the replacement value `4` — matching the
  worked-solution usage the notation comes from.
- **`\not`-prefixed relations** compose into the negated relation: `\not=` →
  `NotEqual`, `\not\in` → `NotElement`, `\not\equiv` (incl. a trailing
  `\pmod n`) → the negated congruence, `\not\subset` → `NotSubset`, and
  relations without a dedicated negated head wrap in `Not(…)`.
- **Standalone `\pmod{7}`** now places the modulus as the second argument of
  `Mod` (previously the operands were flipped).
- **`(2n)!!` stays symbolic:** `Factorial2` accepts symbolic arguments (its
  signature was integer-only and rejected `2n` with an `incompatible-type`
  error); numeric double factorials are unchanged (`8!! = 384`).
- **Primed variables type-check as arguments:** `\sin a'` now parses to
  `Sin(Prime(a))` instead of a type error — `Prime` mirrors the type of its base
  (a primed value is a value; a primed function is a function). Derivative
  notation (`f'(x)` → `D(f(x), x)`) is unchanged.
- **Bare `N`/`D` devolve to variables in all argument positions:**
  `N \equiv 1 \pmod k` now parses as a congruence over the variable `N`
  (previously the standard-library `N` operator's function type failed the
  relation's numeric parameter check; the existing devolution fallback ran only
  for arithmetic operators). Applied uses (`N(2/3)`) still call the operator.
- **Congruence chains and fragments:**
  `3^{27}\equiv 3^7\pmod{100}\equiv 87\pmod{100}` folds into a conjunction of
  the adjacent congruence steps; a leading `\equiv b \pmod n` with an elided
  left-hand side recovers with a missing-operand placeholder.
- **Empty subscripts on multi-letter symbols are dropped:** `\alpha_{}` parses
  as `alpha` (completing the earlier `x_{}`/`13^{}` fix).
- **English unit words in `\text{…}` parse as quantities.** `18 \text{ inches}`
  → `["Quantity", 18, "in"]`: common measurement words (singular and plural —
  inches, feet, miles, gallons, pounds, minutes, hours, meters, liters, degrees,
  …) are normalized to their canonical unit symbols at the parse boundary,
  including inside compound units (`\text{ inches/foot}` → `in/ft`). An exponent
  _outside_ the text binds to the trailing unit factor:
  `7.5 \text{ gallons/ft}^3` → `Quantity(7.5, gal/ft³)` (gallons per cubic foot,
  not `(gal/ft)³`). Strictly gated: the whole text must resolve as a unit, so
  prose like `9\text{ to }80` is untouched. No `ton(s)` alias (a US short ton is
  not the metric tonne `t` — mapping it would be a silent 10% error).

### Restriction Braces

- **Comma-separated brace conditions combine as a union (`Or`).**
  `x^2\{x\ge0, x\le3\}` now parses to `["When", x², ["Or", 0≤x, x≤3]]` — each
  comma element is piecewise shorthand for `cond: 1` evaluated first-match, so
  the expression is defined where **any** condition holds. (Previously the
  condition was a `Tuple`, which is not boolean and could not compile.) Stacked
  braces (`\{c_1\}\{c_2\}`) still AND-combine, unchanged.
- **Colon groups parse as piecewise value selectors.** `x\{x>0:1, x<0:-1\}` now
  parses to `["Multiply", "x", ["Which", 0<x, 1, x<0, −1]]`: a brace group is a
  first-class piecewise _value_ (`{cond}` ≡ `{cond: 1}`) attached by
  juxtaposition — i.e. multiplication, the same convention that makes the
  bare-condition form a restriction. A trailing bare value is the else branch
  (`\{x>0:1, -1\}` → `…, "True", −1`), and a bare condition inside a colon group
  means `cond: 1`. (Previously the `cond:val` pairs were parsed as a `When`
  _gate_ for the body — inverted semantics.)
- **`When` now masks correctly on the `interval-js` compile target.** The
  interval comparisons return the tri-state string `'true' | 'false' | 'maybe'`
  — all truthy — so the previously-emitted JS ternary could never take its
  masking branch: an input interval entirely outside the restriction returned a
  normal interval result. `When` now compiles to a tri-state-aware runtime
  helper (`_IA.restrict`): `'false'` masks (`{kind: 'empty'}`), `'true'` passes
  the value through, and `'maybe'` — an input straddling the restriction
  boundary — reports the value range as domain-clipped
  (`{kind: 'partial', domainClipped: 'both'}`) so adaptive samplers see a domain
  edge rather than a clean interval. Scalar `javascript` and `glsl` `When`
  emission is unchanged.

### Pipelines and Held Operands

- **Hold operators reduce transformer heads.** `Solve`, `Integrate`, and `Limit`
  hold their expression operand (so an equation is not collapsed to a boolean
  before solving) — but a held operand whose head is an expression _transformer_
  (`Simplify`, `Expand`, `ExpandAll`, `Factor`, `Together`, `Distribute`,
  `TrigExpand`) is a computation step and is now reduced before the algorithm
  runs. `x^2+2x+1 \rhd \operatorname{Simplify} \rhd \operatorname{Solve}` now
  returns `[-1]` (previously `[]`: the solver found no roots in an expression
  whose operator was `Simplify`), and `\int \operatorname{Simplify}(x^2)\,dx` /
  `\lim` of a transformer-wrapped body compute instead of staying inert. Only
  the curated transformer set is reduced — full evaluation would collapse
  relations and substitute assigned values into the unknown.
- **Unknown-inference defers on the pipe topic placeholder.** Operators that
  infer their variable when omitted (`Solve`, `D`, `Series`, the polynomial
  operators) no longer run that inference on the pipeline topic placeholder `_`:
  `ce.box(["Solve", "_"])` stays `["Solve", "_"]` instead of canonicalizing to
  `["Solve", "_", "_"]`, which baked the placeholder into the unknown slot so a
  _prefix_ pipeline stage (`\rhd \operatorname{Solve}`) computed
  `Solve(expr, expr)` → `[0]` where the infix spelling returned `[-1]`. `Solve`
  re-infers the unknown when the applied stage evaluates; the two spellings now
  agree. Piping an _equation_ through the prefix form works too, now that an
  undecidable `Equal` survives the lambda's argument pre-evaluation (see
  "Undecidable Relations Stay Symbolic" below): `Apply(\rhd Solve, x^2 = 4)` →
  `[2, -2]`.

### Undecidable Relations Stay Symbolic

- **An equation with free variables is a condition, not a falsity.** `Equal` and
  `NotEqual` with an undecidable comparison now stay **inert** under
  `evaluate()`: `x^2 = 4` evaluates to itself instead of `False` (and `x \ne 4`
  to itself instead of `True`). This matches the inequality operators —
  `x^2 < 4` already stayed symbolic — and Mathematica's `==`. Decidable
  comparisons are unchanged (`2+2=4` → `True`, `2=3` → `False`, `x=x` → `True`),
  list/scalar elementwise comparisons are unchanged, and assumption discharge
  still applies (`assume(z > 0)` ⇒ `z \ne 0` → `True`). The previous collapse
  silently ruined stored equations: a notebook cell holding `x^2 = 4` evaluated
  to `False` at storage time, breaking every answer-referencing `Solve` pipe
  downstream.
- **`If` and `Which` stay unevaluated on an undecided condition.** A condition
  that is boolean-typed but not yet decidable (e.g. `x = 4` with a free `x`)
  leaves the conditional inert — it may become decidable once the variables are
  bound — instead of throwing `Condition must evaluate to "True" or "False"`
  (or, previously for `Equal` conditions, silently taking the else branch).
  Genuinely non-boolean conditions (a number, a misspelled symbol) still throw
  with the spell-check hint.

### Issues Resolved

- `toLatex({ digits: <number> })` no longer throws
  `RangeError: The number NaN cannot be converted to a BigInt` on a
  bignum-precision engine. A bare number — not part of the documented
  `DisplayDigits` forms, but the exact shape of a mechanical
  `fractionalDigits: n` → `digits: n` migration — is accepted with the
  deprecated numeric convention (`n ≥ 0` = fractional digits, `n < 0` =
  significant digits), and a genuinely invalid shape reports a clear validation
  error instead of crashing.
- The engine no longer trips its own
  `` `digits` and `fractionalDigits` were both specified `` deprecation warning.
  The serializer re-entered the public `toMathJson()` boundary — which always
  carries both (resolved) options — for any dictionary-_typed_ expression; for a
  symbol bound to a dictionary value this also recursed without bound (a warning
  flood followed by a stack overflow). Dictionary values now serialize inside
  the serializer proper; the warning fires only for genuine caller mistakes,
  once.
- `BoxedDictionary.toMathJson()` called without options no longer throws
  (`Cannot read properties of undefined`); it resolves the same defaults as
  every other expression kind.
- `.latex` on a dictionary-typed symbol with no value no longer overflows the
  stack; it serializes as the symbol. (`.latex` on a dictionary _value_ — which
  crashed in released builds — now returns an empty string: dictionaries have no
  LaTeX display form yet.)

### Benchmarks

#### Numeric performance (200-digit precision)

Median time per call, in **microseconds — lower is better**. `—` means the tool
returned no usable result at that precision.

| Expression         | CE (current) | CE 0.70.0 | SymPy | math.js | Mathematica |
| ------------------ | -----------: | --------: | ----: | ------: | ----------: |
| $\pi^2$            |           18 |        12 |   281 |     275 |         6.2 |
| $\sin 1$           |           34 |        36 |   353 |     945 |         7.1 |
| $\cos 1$           |           40 |        41 |   351 |   1,315 |          11 |
| $\ln 2$            |           27 |        24 |   598 |   8,195 |         5.8 |
| $e^{\pi}$          |           20 |        22 |   376 |   8,984 |         7.5 |
| $\zeta(3)$         |        2,715 |     2,787 |   494 |       — |         151 |
| $\Gamma(\tfrac13)$ |        1,452 |     1,424 | 4,843 |       — |         267 |
| $\psi(\tfrac13)$   |        1,269 |     1,241 | 3,782 |       — |         235 |

#### Symbolic capability & performance

Each cell is **how many times faster than Mathematica** that engine is on the
case (`Mathematica ÷ engine`, so **higher is better**; Mathematica itself is
`1×`). `—` means the engine can't do the case; `✓` means it solves a case
Mathematica can't. Compare the **CE (current)** and **CE 0.70.0** columns to see
what is _new this release_ (a `—` under `0.70.0` next to a number under the
current build). The **CE + R/F** column is the current build with the opt-in
Rubi integrator + Fungrim identities loaded (`loadIntegrationRules` /
`loadIdentities`), on the same minified bundle.

| Operation                              | CE (current) | CE + R/F | CE 0.70.0 |  SymPy  | math.js | Mathematica |
| -------------------------------------- | :----------: | :------: | :-------: | :-----: | :-----: | :---------: |
| **Antiderivatives**                    |              |          |           |         |         |             |
| $\int\frac{1}{\sqrt x}\,dx$            |     7.4×     |   3.0×   |   5.0×    |  0.6×   |    —    |     1×      |
| $\int\frac{x}{\sqrt{1-x^2}}\,dx$       |     8.3×     |   1.2×   |   7.7×    |  0.08×  |    —    |     1×      |
| $\int\frac{1}{x^3+1}\,dx$              |     4.3×     |   0.7×   |   3.4×    |  0.3×   |    —    |     1×      |
| $\int\frac{\sqrt x}{1+x}\,dx$          |      —       |   2.0×   |     —     |  0.1×   |    —    |     1×      |
| $\int\frac{x}{(1+x)^{1/3}}\,dx$        |      —       |   0.9×   |     —     | 0.008×  |    —    |     1×      |
| $\int\frac{x^2}{(1+x)^{1/3}}\,dx$      |      —       |   1.2×   |     —     | 0.006×  |    —    |     1×      |
| **Derivatives**                        |              |          |           |         |         |             |
| $\tfrac{d}{dx}\sqrt{1-x^2}$            |    0.01×     |  0.02×   |   0.02×   | 0.0009× | 0.002×  |     1×      |
| **Simplification**                     |              |          |           |         |         |             |
| $\sqrt{3+2\sqrt2}$                     |     29×      |   23×    |    27×    |    —    |    —    |     1×      |
| $\sqrt6\,x+\sqrt2\,x$                  |     71×      |   36×    |    54×    |  2.8×   |  9.1×   |     1×      |
| **Evaluation**                         |              |          |           |         |         |             |
| $\lim_{x\to0}\tfrac{\sin x}{x}$        |     43×      |   20×    |    38×    |  2.5×   |    —    |     1×      |
| $\lim_{x\to\infty}(1+\tfrac1x)^x$      |     6.3×     |   4.2×   |   6.0×    |  2.1×   |    —    |     1×      |
| $\int_1^2\tfrac1x\,dx$                 |    5213×     |  6049×   |   5202×   |   82×   |    —    |     1×      |
| $\int_{-\infty}^{\infty} e^{-x^2}\,dx$ |     332×     |   106×   |   279×    |  2.3×   |    —    |     1×      |
| **Solving**                            |              |          |           |         |         |             |
| $x^4+x^2-1=0$                          |     0.2×     |   0.2×   |   0.2×    |  0.06×  |    —    |     1×      |
| $x^3-x-1=0$                            |     1.2×     |   1.4×   |   1.4×    |  0.04×  |    —    |     1×      |

Across the cases both solve, Compute Engine is a **median 6.3× faster than
Mathematica** (up to 5213×).

<sub>
Measured 2026-07-10 · Compute Engine `0.72.0` @ `2cf87db4` (current build) · published `0.70.0` · SymPy `1.14.0` · math.js `15.2.0` · Mathematica `14.3.0 for Mac OS X ARM` · Node `v22.13.1`. Correctness is verified numerically against an independent `mpmath` reference, never another tool. Reproduce with `npm run build production && ./venv/bin/python3 benchmarks/gen_cases.py && node benchmarks/report.mjs && node benchmarks/report_changelog.mjs`.
</sub>

## 0.72.0 _2026-07-09_

### Angular Units

- **Compilation targets honor `ce.angularUnit`.** Compiled code from every
  built-in target (`javascript`, `interval-js`, `glsl`, `wgsl`, `interval-glsl`,
  `python`) now reproduces the engine's angular-unit semantics instead of always
  computing in radians: direct trigonometric arguments (`Sin`…`Csc`,
  `Haversine`) are scaled by the unit→radian factor and inverse-trigonometric
  results (`Arcsin`…`Arccsc`, `Arctan2`, `InverseHaversine`) by its reciprocal,
  for all units (`deg`, `grad`, `turn`). With `ce.angularUnit = 'deg'`,
  `compile('\\sin(x)')` emits `Math.sin(0.017453… * x)` so `run({x: 90})`
  returns 1, matching `evaluate()` — previously a degree-mode expression
  _evaluated_ in degrees but _compiled_ (and therefore plotted) as if radians.
  Radian mode emits the same code as before.

- **Hyperbolic functions are now unit-independent.** Their argument (and an
  inverse hyperbolic's result) is a dimensionless real, not an angle, so `sinh`,
  `cosh`, `tanh`, `coth`, `sech`, `csch` and `arsinh`…`artanh` no longer convert
  under a non-radian `angularUnit`. Previously in degree mode `\sinh(1)`
  evaluated to $\sinh(\pi/180) \approx 0.0175$ instead of $1.1752$.

- **Exact inverse-trigonometric values are returned in the current angular
  unit.** In degree mode `\arcsin(1)` now evaluates to the exact integer `90`
  (previously the exact _radian_ value $\pi/2$, disagreeing with `.N()`, which
  returned 90). Similarly `100` in `grad` mode and the exact rational `1/4` in
  `turn` mode; radian mode still returns $\pi/2$.

- **`Arctan2` honors `angularUnit`,** consistently with `Arctan` (it previously
  always returned radians): in degree mode `Arctan2(1, 1)` evaluates to the
  exact `45`, with the quadrant corrections applied in the current unit
  (`Arctan2(1, -1)` → `135`).

  Symbolic calculus (`D`, `Integrate`) remains radian-based regardless of
  `angularUnit` (no $\pi/180$ chain-rule factor); this is a known limitation.

### Step-by-Step Explanations

- **`explain('D')` handles higher-order and mixed partial derivatives.** A new
  `order` option requests the $n$-th derivative
  (`ce.parse('x \\sin x').explain('D', { variable: 'x', order: 2 })`), and a
  receiver that is itself a `D` expression — including mixed partials such as
  `D(f, x, y)` — is traced through its whole differentiation sequence. The
  explanation differentiates one order at a time: each stage replays the
  textbook rule applications inside the remaining derivative operators, folds to
  the simplified derivative, then differentiates again.

- **`explain('solve')` traces systems of equations and alternatives.** A `List`
  or `And` of equations is traced through the same solvers `solve()` runs:
  Gaussian elimination shows one step per eliminated variable and per
  back-substituted variable (`solve.system.eliminate`,
  `solve.system.back-substitute`, `solve.system.parametric`), and nonlinear 2×2
  systems show the product–sum or solve-and-substitute strategy
  (`solve.system.product-sum`, `solve.system.solve-for`,
  `solve.system.substitute`). An `Or` of univariate equations is solved case by
  case (`solve.case`) with the roots merged. The solutions are identical to
  `solve()` — the trace is a pure observation channel. Systems of inequalities
  and mixed systems are not traced and throw a precise error. To support
  systems, the `variable` explain option now also accepts an array of unknowns.

### Cortex Language (Experimental)

- **Cortex ships as a new entry point `@cortex-js/compute-engine/cortex`.**
  Cortex is a text-syntax programming language for scientific computing whose
  intermediate representation is MathJSON, evaluated by the Compute Engine. The
  entry point exports `parseCortex()` (Cortex text → MathJSON),
  `serializeCortex()` (MathJSON → Cortex text), and `executeCortex()` (parse and
  evaluate a program against a host-created engine):

  ```js
  import { ComputeEngine, executeCortex } from '@cortex-js/compute-engine/cortex';
  const ce = new ComputeEngine();
  const { value } = executeCortex(ce, `
    let x = 1/2
    if (x < 1) { x + 1 } else { 0 }
  `);
  // value.toString() === '3/2'
  ```

  **This is experimental**: the syntax and semantics may change between
  releases.

### Pipeline Operator

- **A pipeline operator applies the expression on its left to the function on
  its right.** `x \rhd f` (also `x \triangleright f`, `x \vartriangleright f`,
  `x ⊳ f`, or the plain-text shortcut `x |> f`) parses to `f(x)`. A `\square`
  topic marker in the right-hand side names the position the piped value fills,
  so a stage can be a multi-argument call:
  `x^2 = 4 \rhd \operatorname{Solve}(\square, x)` is `Solve(x^2 = 4, x)`. Stages
  chain left to right (`4 \rhd \sqrt \rhd \ln` is `ln(√4)`), a bare function
  command such as `\ln`, `\lb` or `\sqrt` acts as a function reference
  (`12 \rhd \ln` is `ln(12)`), and the prefix form (`\rhd f`, with no left-hand
  side) denotes the anonymous unary function `_ ↦ f(_)`.

- **The unknown/variable argument of `Solve`, `D`, `Series` and the polynomial
  operators may now be omitted.** It defaults to the input's single free
  variable, or to `x` when there are several free variables and one of them is
  `x`; with no inferable default the expression stays unevaluated. This enables
  point-free pipelines such as `x^2 = 4 \rhd \operatorname{Solve}` or
  `x^2 \rhd \operatorname{D}`. Applies to `Solve`, `D`, `Series`,
  `PolynomialDegree`, `CoefficientList`, `PolynomialRoots`, `Discriminant`,
  `PolynomialQuotient`, `PolynomialRemainder`, `PolynomialGCD`, `Resultant`,
  `Cancel`, `PartialFraction` and `Apart` (`Factor` already inferred its
  variable). For the two-input polynomial operators the default is inferred from
  both operands together.

### LaTeX Parsing

Notation coverage driven by a cross-genre corpus sweep (Hendrycks MATH, 15,546
fragments across all seven subjects including worked solutions; see
`docs/mathnet/math-genre-sweep.md`), which took the measured clean-parse rate
from 95.3% to 97.1%:

- **Text-styling commands.** `\textbf`, `\textit`, `\emph`, `\texttt`,
  `\textsf`, and `\textup` parse their argument as a text run and produce an
  `Annotated` expression with the matching style (`\textbf{Sizes}` →
  `["Annotated", "'Sizes'", {dict: {fontWeight: "bold"}}]`) that round-trips
  back to the same LaTeX. `\textrm` and `\mbox` parse like `\text`. `\bold`,
  `\boldsymbol`, and `\bm` are synonyms of `\mathbf` (`\bold{v}` → the symbol
  `v_bold`).

- **Vector-norm bars.** The `\|` command is now recognized as a norm delimiter
  everywhere `\Vert` is: `\|\mathbf{a}\|`, `\left\| b \right\|`, and `\|a\|^2`
  all parse to `Norm`.

- **TeX-primitive binomial.** The infix `{n \choose k}` form parses to
  `Binomial(n, k)`, joining the already supported `\binom`, `\dbinom` and
  `\tbinom`.

- **Bare mod annotations.** `x \pmod n` with no preceding `\equiv` parses as
  `Mod(x, n)` (`-811 \pmod{24}` → `["Mod", -811, 24]`), matching the existing
  `\bmod` behavior. Congruence chains followed by an implication now parse
  correctly: `a+1 \equiv 4 \pmod 7 \implies a \equiv 3 \pmod 7` is
  `Implies(Congruent(…), Congruent(…))` (the congruence previously disintegrated
  when `\implies` followed the modulus). `\equiv` now binds at comparison
  precedence, tighter than `\implies` (zero snapshot impact).

- **Mixed braced/unbraced fraction and binomial arguments.** `\frac1{-1}`,
  `\frac{900}7`, `\binom{n}k`, `\binom n{k+1}` parse correctly. Each argument is
  now independently a group or a single token, per TeX semantics; previously
  both arguments were forced into the style of the first, and the mixed forms
  produced a `missing` error.

### Issues Resolved

- Reading `.latex` (or `.toString()`) on the canonical, unevaluated form of a
  scalar×tuple product — `ce.parse('3(1,2)').latex`,
  `ce.box(['Multiply', 2, ['Tuple', 1, 2]]).latex` — no longer throws
  `RangeError: Maximum call stack size exceeded`. The pretty-JSON `Multiply`
  serializer round-trips through `Product.asRationalExpression()`, and the
  tuple-aware branch of `canonicalDivide` returned an inert `Divide(expr, 1)`
  instead of stripping the trivial divisor, sending the serializer into infinite
  recursion. Trivial `/1` and `/-1` divisors of tuple-typed expressions are now
  reduced.

- Juxtaposing a scalar with a tuple-**typed** symbol now means scaling, not
  tuple construction: with `z` declared `tuple<number, number>`, `3z` parses to
  `["Multiply", 3, "z"]` (previously a spurious `["Tuple", 3, "z"]`). Literal
  tuples (`3(1,2)`) were already handled; heterogeneous tuples such as
  `tuple<string, number>` still group as a `Tuple`.

- Compiled broadcasts over a list operand now compute their values. The
  generated `.map()` callback read its element variable from the vars object
  instead of the callback parameter, so a compiled `\sin([x, 2x])` returned
  `[null, null]` for every input. Compiled broadcast results now agree with
  `evaluate()`.

- `\operatorname{csch}(x)` now parses to the `Csch` function (previously a free
  symbol named `csch`, silently turning the expression into an implicit
  multiplication), joining the existing `\csch` command and matching
  `\operatorname{sech}`.

- Constructing many `ComputeEngine` instances in a synchronous loop no longer
  balloons memory (~430 KB pinned per engine until the task yielded to the event
  loop, enough to exhaust the default V8 heap after a few thousand engines).
  Every constant definition subscribed to configuration changes through a
  `new WeakRef(...)`, and the ECMAScript kept-objects rule pins each `WeakRef`
  target until the next microtask checkpoint. The tracker now holds its
  listeners directly; since it is owned by the engine, the engine and its
  listeners form a self-contained cycle that is garbage-collected as a unit.

- A bare `\ln` or `\log` — with no argument, as in the pipeline
  `12 \triangleright \ln` — now parses to the function symbol (`"Ln"`, `"Log"`),
  consistent with `\cos`, `\lg` and `\lb`. It previously parsed to an empty
  function application, so piping a value into it produced a `missing` error
  instead of applying the function:
  `ce.parse('12 \\triangleright \\ln').evaluate()` now returns $2\ln 2 + \ln 3$.
  The bare symbols also serialize back to `\ln`, `\log` and `\lg` (previously
  `\ln()`).

- A bare `\lb` (binary log) now parses to the `Lb` function symbol, so
  `12 \triangleright \lb` computes $\log_2 12$. It previously parsed to `Log`,
  silently computing the base-10 logarithm instead.

- A log with a base but no argument (`\log_2`) now parses with the pipeline
  topic marker `\square` standing in for the argument: `8 \triangleright \log_2`
  fills the hole and computes $\log_2 8 = 3$ (composing with inverse
  superscripts too: `9 \triangleright \log_3^{-1}` gives $3^9$), and a
  standalone `\log_2` displays as $\log_2(\square)$. It previously parsed as
  $\log_{10} 2$ — the base was read as the _argument_ — so piping into it
  silently discarded the piped value.

- Likewise, a function with a superscript but no argument (`\cos^2`, `\ln^{-1}`,
  `\lg^{-1}`) holds a topic-marker hole: `x \triangleright \cos^2` computes
  $\cos^2 x$, `12 \triangleright \ln^{-1}` computes $e^{12}$, and a standalone
  `\cos^2` displays as $\cos(\square)^2$. These previously produced a `Power` of
  the bare function symbol, which failed to type when piped into.

## 0.71.0 _2026-07-08_

### Differential Equations

- **First-order nonlinear equations solve.** (contributed by
  [KingArth0r](https://github.com/KingArth0r)) `DSolve` now handles four
  classical first-order classes:
  - **Separable** equations return an implicit solution when no explicit form is
    available: $y' = x/y$ gives $\frac12 y(x)^2 = \frac12 x^2 + c_1$.
  - **Bernoulli** equations $y' = p(x)\,y + q(x)\,y^n$ reduce via the
    $v = y^{1-n}$ substitution and return explicit solutions.
  - **Homogeneous** equations of the form $y' = F(y/x)$ solve by the $v = y/x$
    substitution: $y' = 1 + y/x$ gives $y(x)/x = \ln x + c_1$.
  - **Exact** equations $M(x,y) + N(x,y)\,y' = 0$ return the implicit potential:
    $2xy + y^2 + (x^2 + 2xy)\,y' = 0$ gives $x^2\,y(x) + x\,y(x)^2 = c_1$.

  Implicit solutions are expressed in terms of $y(x)$ itself. Equations outside
  the supported classes (e.g. the Riccati equation $y' = x + y^2$) stay inert.

- **Initial and boundary conditions are applied.** Scalar conditions can be
  passed in a list alongside the equation:
  `DSolve([y'' = -y, y(0) = 0, y'(0) = 1], y, x)` returns $y(x) = \sin x$.
  Derivative conditions are recognized in both the `Apply(Derivative(y, 1), x0)`
  and flat `D(y(x0), x)` forms. Conditions also apply to supported implicit
  solutions ($y' = x/y$ with $y(0) = 1$ gives
  $\frac12 y(x)^2 = \frac12 x^2 + \frac12$), and free parameters survive:
  $y' = kx/y$ with $y(0) = 2$ gives $\frac12 y(x)^2 = \frac12 k x^2 + 2$ with
  $k$ untouched. If the conditions cannot be applied to the solution class, the
  equation stays inert rather than silently dropping them.

- **Nonhomogeneous constant-coefficient equations of any order.** The
  undetermined-coefficients method now covers **polynomial, exponential, and
  sinusoidal** forcing at any order (previously polynomial forcing was
  second-order only), including **resonant** cases, which retry the ansatz with
  powers of $x$: $y'' - y = e^x$ gives $c_1 e^x + c_2 e^{-x} + \frac12 x e^x$,
  and $y''' - y = \sin x$ and resonant $y'' + y = \sin x$ both solve.

- **First-order linear homogeneous systems solve.** Pass the equations and
  dependent functions as lists: `DSolve([y' = z, z' = y], [y, z], x)` returns
  the general solution built from the eigen-decomposition of the coefficient
  matrix. Systems with repeated — or numerically indistinguishable — eigenvalues
  stay inert rather than returning a degenerate basis.

- **`NDSolve` integrates first-order systems.** Fixed-step RK4 now handles
  systems, including nonlinear ones, with the dependent functions and initial
  values given as lists:
  `NDSolve([y' = z, z' = -y], [y, z], Limits(x, 0, 1), [0, 1], 200)` produces
  samples as `[x, [y, z]]` pairs. Malformed or unsupported systems stay inert
  rather than returning partial results.

### Recurrence Equations

- **New `RSolve` operator.** (contributed by
  [KingArth0r](https://github.com/KingArth0r)) `RSolve(equation, a, n)` solves
  **linear homogeneous constant-coefficient** recurrences via the characteristic
  polynomial: geometric ($a_{n+1} = 2a_n$ gives $a(n) = c_1\,2^n$),
  Fibonacci-style, repeated roots with $n^k r^n$ modes
  ($a_{n+2} + a_n = 2a_{n+1}$ gives $a(n) = c_1 + c_2\,n$), and complex roots
  ($a_{n+2} = -a_n$ gives $a(n) = c_1\,i^n + c_2\,(-i)^n$). Initial conditions
  can be given in list form: `RSolve([a(n+1) = 2a(n), a(0) = 3], a, n)` gives
  $a(n) = 3 \cdot 2^n$. Nonhomogeneous and variable-coefficient recurrences stay
  inert.

## 0.70.0 _2026-07-08_

### Breaking Changes

- **The published `dist/` directory is reorganized into per-variant
  subdirectories.** The flat layout — where the variant was encoded in each
  filename (`compute-engine.min.esm.js`, `compute-engine.umd.cjs`, …) — is
  replaced by `esm/`, `esm-min/`, `umd/`, `umd-min/`, and the unchanged
  `types/`. The variant marker moves from the filename into the directory, so a
  bundle is now `<dir>/<name>.<ext>`. The general mapping is `<name>.esm.js` →
  `esm/<name>.js`, `<name>.min.esm.js` → `esm-min/<name>.js`, `<name>.umd.cjs` →
  `umd/<name>.cjs`, and `<name>.min.umd.cjs` → `umd-min/<name>.cjs`; for example
  `dist/compute-engine.min.esm.js` is now `dist/esm-min/compute-engine.js`.
  Consumers importing via the bare package specifier
  (`@cortex-js/compute-engine` and its sub-paths such as
  `@cortex-js/compute-engine/identities`) are **unaffected** — the package
  `exports` map absorbs the move. Only deep imports that reach into `…/dist/…`
  directly, and pinned CDN URLs, need to be updated. Each `esm*/` directory is
  now fully self-contained, with its own `chunks/` subdirectory holding only
  that variant's shared chunks, so vendoring a build is now "copy the directory
  for the variant you use."

- **The non-minified builds are no longer published to npm.** The package now
  ships `dist/esm-min/`, `dist/umd-min/`, and `dist/types/` only. The
  non-minified `esm/` and `umd/` directories — about 60% of the unpacked
  package, and never referenced by the `exports` map — are now build-only
  artifacts: `npm run build` still produces them locally for development and
  debugging, but if you need a readable (non-minified) bundle, build from
  source.

### Improvements

- **The declaration build and typecheck now run on TypeScript 7** (the native
  compiler), cutting `.d.ts` emission from ~31s to ~5s and the full production
  build from ~45s to ~29s. TS 7.0 ships no programmatic API, so it is installed
  side-by-side: the module name `typescript` stays aliased to the TS 6 API
  (`@typescript/typescript6`) for ts-jest, typedoc, typescript-eslint and madge,
  while the native compiler (`@typescript/native`) drives the CLI. No
  consumer-facing change — the published declarations are type-identical; only
  cosmetic emission differences appear (single-quoted string literals, sorted
  numeric-literal unions, literal non-ASCII property keys instead of `\uXXXX`
  escapes).

## 0.69.1 _2026-07-08_

### Issues Resolved

- **#318** Type declarations now resolve correctly in projects using
  `"module": "nodenext"`/`"node16"`. The published `.d.ts` files used
  extensionless relative imports, which produced `TS2834` errors (or collapsed
  every imported type to `any` with `skipLibCheck`). The build now rewrites the
  emitted declarations with explicit `.js` extensions and validates them against
  a `nodenext` consumer as part of every release build.

## 0.69.0 _2026-07-08_

### Breaking Changes

- **`\pm` now parses to a `Measurement`, not `PlusMinus`.** `a \pm b` parses to
  `["Measurement", a, b]` — a value with an uncertainty (see below) — replacing
  the previous `PlusMinus` head that evaluated to the two-branch tuple
  `(a−b, a+b)`. Consequences: solution sets that previously used `\pm` (e.g.
  quadratic roots) are now returned as an explicit `List` of the branches, and a
  numeric integral that reports an error estimate now returns
  `["Measurement", estimate, error]` instead of a `PlusMinus` tuple. Prefix
  `\pm b` parses to `["Measurement", 0, b]`.

- **`Loop` no longer produces a list — comprehensions moved to the new
  `Comprehension` operator.** `["Loop", body, ["Element", x, coll], …]` is now
  an imperative for-each evaluated **for effect**: its value is `Nothing` (or
  the value carried by a `Break`/`Return`), and it no longer collects the body
  values into a `List`. The trailing-`for` comprehension syntax
  (`x^2 \operatorname{for} x = [1...10]`) now parses to
  `["Comprehension", body, ["Element", …], …]`, which returns exactly what the
  collecting `Loop` used to — for consumers of the parse tree this is a head
  rename. The undocumented arity-2 form `["Loop", body, collection]` (body
  applied as a lambda to each element) has been removed: use `Map`, or an
  `Element` clause; a non-`Element` iterator argument is now an error.

- **`scalar + point` is now an error.** Adding a scalar to a numeric tuple
  (`1 + (2, 3)`) previously broadcast the scalar over the components; points are
  now proper vectors in ℝⁿ (see below) and a scalar term does not broadcast into
  them. Add a tuple explicitly (`(1,1) + (2,3)`) instead. Multiplying or
  dividing a point by a scalar still scales it.

- **Comparing a list to a scalar is now elementwise.** `[1, 4, 4] = 4`
  previously evaluated to `False` (whole-list comparison against a scalar); it
  now broadcasts and evaluates to `["List", "False", "True", "True"]`, as do
  `<`, `<=`, `>`, `>=`, and `!=`. Comparing two collections is unchanged:
  `Equal(L, M)` remains a whole-value comparison (`[1,2,3] = [1,2,3]` → `True`).

### Measurements and Uncertainty

- **New `Measurement` type — values with a propagated uncertainty.**
  `Measurement(value, error)` (written `value \pm error`) represents a measured
  quantity carrying a 1σ absolute uncertainty, and the uncertainty **propagates
  through arithmetic** using standard independent, first-order (quadrature)
  error propagation:
  - Algebraic and elementary operations propagate the error:
    `(5 \pm 0.2)(3 \pm 0.1)` → `15.00 \pm 0.78`, `\sqrt{4 \pm 0.2}` →
    `2.000 \pm 0.050`, `\sin(1 \pm 0.1)` → `0.841 \pm 0.054` (trig respects the
    engine's angular unit).
  - Measurements combine with **units**: `(5.1 \pm 0.2)\,\mathrm{cm}` is a
    measured quantity, and the error carries through quantity arithmetic and
    unit conversion (`UnitConvert` of `(5.1 \pm 0.2)\,\mathrm{cm}` to `m` →
    `(0.0510 \pm 0.0020)\,\mathrm{m}`). The bare form `5.1 \pm 0.2\,\mathrm{cm}`
    (no parentheses) parses to the same thing: a unit on only one operand of
    `\pm` scopes over the whole measurement (a dimensionless value with a
    dimensioned error is never meaningful). An error in a _different_ unit than
    the value (`5.1\,\mathrm{cm} \pm 2\,\mathrm{mm}`) stays as written.
  - **Display** follows the physics convention — the uncertainty is shown to two
    significant figures by default and the value is rounded to the same decimal
    place (`5.134 \pm 0.021`, `8.00 \pm 0.22`). Controlled by the `digits`
    serialization option (`{ significant: n }`, `{ fractional: n }`, `"max"`);
    `.toMathJson()` stays lossless.
  - **Correctness note:** propagation is _independent_ — exact when each
    measured quantity appears once (`A = L·W`) or in a single operation (`x^2`),
    but it over/under-estimates when one measured variable is reused across an
    expression (`x·x`, `x/(x+1)`), which are treated as independent. See the
    [Units guide](/compute-engine/guides/units/) for details and the `simplify`
    workaround.

### Points and Tuples

- **Numeric tuples are now points/vectors in ℝⁿ, distinct from lists.**
  Arithmetic on tuples is componentwise vector arithmetic and stays a `Tuple`:
  `(1,2) + (3,4)` → `(4,6)`, `3(1,2)` → `(3,6)`, `(4,2)/2` → `(2,1)`, `-(1,2)` →
  `(-1,-2)`. This fixes `(1,2)-(3,4)`, which previously produced a malformed
  nested list. `tuple · tuple` is an error (no implicit dot product — use
  `Dot`), and `scalar + tuple` is rejected (see Breaking Changes). Lists keep
  their existing broadcast semantics.

- **Tuple arithmetic and component access work symbolically for typed symbols.**
  A symbol declared `tuple<number, number>` participates in vector arithmetic
  without a value, and its components are accessible with the `.x`/`.y`/`.z`
  member syntax, which parses to `First`/`Second`/etc. (`P.x` →
  `["First", "P"]`). Component access on a point literal (`(1,2).x` → `1`) also
  works.

- **Color functions broadcast over lists**, so `rgb` and `hsv` applied to list
  arguments produce a list of colors, matching the other broadcastable numeric
  operators.

### Lists and Collections

- **Filtering a list with a condition in index position.** `L[L > 0]` evaluates
  to the elements of `L` where the condition holds — the Desmos list-filtering
  notation. The condition may reference the list itself (`L[L>0]`), another list
  (`L[d=4]` where `d` is a list), or compute a positional mask from a `Range`
  (`L[|[1...\operatorname{length}(L)]-i|>0]` removes the `i`-th element). A
  condition may be combined with integer indexes. The mask applies positionally
  and truncates to the shorter of list and mask.

- **Relational operators broadcast over lists.** `[-1, 2, -3] > 0` evaluates to
  `["List", "False", "True", "False"]`, typed `list<boolean>`. Scalar and
  symbolic comparisons are unchanged (`x > 0` stays symbolic). For `=` and `!=`
  the elementwise form applies only when exactly one operand is a collection —
  comparing two collections remains a whole-value equality (see Breaking
  Changes).

- **Broadcast results now report an honest `list<…>` type.** A broadcastable
  numeric operator applied to a list operand produces a list value, and its
  declared type now says so: `Sin([t, 1])` is typed `list<finite_number>`
  (previously the scalar `finite_number`, contradicting the value), and
  `[1,2] \cdot 2` / `[1,2] + x` report `vector<2>` rather than a scalar or a
  `number | vector<2>` union. Code that inspects `.type` before evaluating no
  longer needs to special-case list-broadcast expressions.

- **`When` broadcasts over a list-valued condition.** A domain restriction whose
  condition is a finite list of booleans now masks element by element — the
  Desmos restriction semantics. `x^2\{[1,2,3] > 0\}` evaluates to
  `[x^2, x^2, x^2]`, and with `x = 2`, `x\{x \le [1,2,3]\}` evaluates to
  `[Undefined, 2, 2]` (one masked branch per element: the value where the
  element condition is `True`, `Undefined` where `False`, a held `When` where
  the element is still symbolic). When the restricted expression is itself a
  list, the two are zipped elementwise, truncating to the shorter. Scalar
  restrictions (`x^2\{x > 0\}`) are unchanged, and the result type is lifted to
  `list<…>` only when the condition's type is a list of booleans.

### Parsing and Serialization

- **Fixed: bracket indexing after a symbol with `\left[` delimiters.**
  `A\left[1\right]` silently dropped the bracket group and parsed as bare `A`;
  it now parses to `["At", "A", 1]` like `A[1]` always did. Indexing also works
  on parenthesized groups and function applications: `(3,4)[1]` and `f(x)[i]`
  parse to `At` expressions.

- **Numbers with a leading or trailing decimal dot parse correctly.** `.85x`
  parses as `0.85 x`, and a trailing-dot literal inside delimiters (`(1., 2)`)
  is accepted.

- **Scaling a list/vector by juxtaposition is a `Multiply`, not a `Tuple`.** A
  scalar written next to a list- or vector-typed operand — including a scaled
  fraction whose numerator is a list or range, as in Desmos'
  `2\frac{[0,...,8]}{8}` — now canonicalizes to `Multiply` (element-wise
  scaling). Previously such juxtapositions produced a spurious `Tuple`, which
  raised an `incompatible-type` error when the result was used in further
  arithmetic. Genuine tuples (`2(3, 4)`) and plain list literals (`[1,2,3]`) are
  unaffected.

- **Restriction braces attach across visual space.** A `\{...\}`
  domain-restriction suffix now attaches to its base expression even when
  separated by spacing commands: `s(t) = (1-t)^2(1+2t)\ \{t\ge0\}\{t\le1\}`
  parses to a `When` with both conditions. The space-tolerance is specific to
  restriction braces: a space before an indexing bracket (`x\ \left[1,2\right]`)
  is still not an index access.

- **New inert `Polygon` operator.** `\operatorname{polygon}((0,0),(1,0),(0,1))`
  parses to `["Polygon", ...]`, an opaque geometric primitive like `Triangle`
  and `Segment`, for consumers that render it.

- **`histogram`, `pdf`, `cdf`, `length`, and `nCr` parse to `Histogram`, `PDF`,
  `CDF`, `Length`, and `Choose`.** The lowercase `\operatorname{...}` forms used
  by Desmos are now aliases of the existing operators. The member form `.length`
  (`S.\operatorname{length}`) also maps to `Length`, joining `.count`, `.max`,
  `.min`, `.total`, and the `.x`/`.y`/`.z` component accessors. `Histogram` and
  `BinCounts` accept any number as their bin specification (a non-integer bin
  count is left unevaluated; translate a Desmos bin _width_ to explicit bin
  edges at the import boundary).

- **New `digits` serialization option for significant-figures and decimal-place
  display control.** Available on `expr.toLatex()`, `expr.toMathJson()`, and
  honored by `expr.toString()`, `digits` controls how many digits of a number
  are _displayed_ (a formatting choice — it does not change the stored value or
  computation precision):
  - `digits: { significant: n }` rounds to `n` significant figures
    (`ce.parse("\\pi").N().toLatex({ digits: { significant: 3 } })` → `3.14`).
    Rounding is independent of notation (`1500` at two significant figures stays
    `1500` in fixed notation; use `notation: "scientific"` for
    `1.5 \cdot 10^{3}`), and exact integers, rationals, and radicals are shown
    in full — only inexact values are rounded.
  - `digits: { fractional: n }` shows `n` digits after the decimal point
    (`toFixed` semantics), and `digits: "auto"` / `"max"` behave as before.
  - The `fractionalDigits` option is **deprecated** in favor of `digits`. It
    continues to work (a numeric `n` is equivalent to
    `digits: { fractional: n }`); if both are provided, `digits` wins.

- **The pipeline operator `|>` supports a topic marker and a prefix form.** A
  `\square` in the right-hand side marks where the piped value is substituted,
  so the right-hand side may be a multi-argument call:
  `x^2 + 2x + 1 |> \operatorname{Solve}(\square, x)` parses to
  `Solve(x^2+2x+1, x)`. Without a marker the value is passed as the sole
  argument, as before (`x |> f` → `f(x)`). A prefix `|> f` (or
  `|> \operatorname{Solve}(\square, x)`) leaves the left-hand side implied and
  yields an anonymous unary function over the topic
  (`Function(Apply(f, _), _)`), which the caller applies to whatever value it
  wants to pipe in. `\rhd`, `\triangleright`, and `⊳` behave identically.

### Runtime and Scoping

- **`Declare` now accepts an optional initial value.** The three-operand form
  `["Declare", symbol, type, value]` declares the symbol with the given type,
  sets its initial value, and evaluates to that value (the previous form
  evaluated to `Nothing`). This matches the documented signature; earlier the
  value operand was silently dropped. The one- and two-operand forms are
  unchanged. A value-carrying `Declare` also compiles correctly (the initializer
  is emitted for the JavaScript and GLSL targets), not just when evaluated.

- **`Declare` can attach definition attributes via a trailing dictionary,
  including declaring constants.** An optional final `Dictionary` operand
  carries any of `type`, `value`, `constant`, and `holdUntil`, mirroring the
  JavaScript `ce.declare(name, def)` API. For example,
  `["Declare", "c", "real", 299792458, ["Dictionary", ["KeyValuePair", "constant", "True"]]]`
  declares an immutable constant (a later `Assign` to it is rejected), and
  `holdUntil` controls when the symbol's value is substituted (as for built-in
  constants such as `Pi`). A positional `type`/`value` takes precedence over the
  same key in the dictionary. This gives MathJSON a representation for constant
  declarations (e.g. the target for a `const` keyword in a surface language).

### Control Flow

- **`Loop` is now imperative control flow only** (see Breaking Changes above),
  and `["Loop", body]` is a real infinite loop: the body is evaluated repeatedly
  until it yields a `["Break", value?]` (the loop's value) or a `["Return", …]`
  (propagated), guarded by `ce.iterationLimit` and the evaluation deadline.
  Previously this form — documented as `while(true)` — evaluated the body only
  once. It compiles to `while (true) { … }` in JavaScript, and `Loop` with
  `Element` clauses compiles to plain `for` / `for…of` statement loops with no
  result array.

- **New `Comprehension` operator: value-producing list comprehensions.**
  `["Comprehension", body, ["Element", x, xs], …]` evaluates `body` for each
  combination of one or more `Element` clauses and collects the results into a
  `List`. Independent clauses produce a flat Cartesian product; a later clause's
  collection may reference an earlier binding
  (`[…, ["Element", "x", ["Range", 1, 3]], ["Element", "y", ["Range", 1, "x"]]]`
  iterates the triangle). Bound names do not leak. With a single clause it is
  equivalent to `Map(xs, x ↦ body)`; unlike `Map` (lazy) it materializes its
  result. Compiles to JavaScript as nested array-collecting loops (not available
  on the GLSL/WGSL targets, which have no dynamic arrays).

- **`Break` and `Continue` are now registered operators.** `Break(value?)` exits
  the enclosing loop immediately and its optional value becomes the loop's
  value; `Continue()` skips to the next iteration. Outside a loop both are
  inert.

- **Control flow now propagates out of `Block` statement results.** A `Break`,
  `Continue`, or `Return` produced by a statement's _result_ — e.g.
  `["If", cond, ["Break"]]` — now short-circuits the enclosing `Block` and
  propagates to the enclosing loop or function, as the documentation always
  specified. Previously only a statement that was _literally_ one of those heads
  short-circuited, so a conditional `Break` inside a block was silently
  discarded and the loop ran to the iteration limit. Consequences: the
  `while`-loop lowering `["Loop", ["Block", ["If", cond, ["Break"]], …body]]`
  now terminates correctly, and a `Block` whose value is a `Return` evaluates to
  the `["Return", value]` expression itself (unwrapped at the function
  application boundary), where it previously unwrapped eagerly.

- **`If` without an else branch is fixed.** `["If", cond, then]` — the
  documented two-operand form — failed to canonicalize (throwing
  `Cannot read properties of undefined`) and was left inert. It now
  canonicalizes and evaluates to `Nothing` when the condition is false.

- **Nested scopes now see the enclosing block's variables (lexical scoping
  fix).** A `Block`, `If` branch, or `Loop` body nested inside a `Block`
  resolved symbols against a stale canonicalization-time scope, so it could not
  read the values of the enclosing block's locals:
  `["Block", ["Declare", "k", "integer"], ["Assign", "k", 7], ["Block", "k"]]`
  evaluated to symbolic `k` instead of `7`, a `while`-style
  `["Loop", ["Block", ["If", cond, …], …]]` threw
  `Condition must evaluate to "True" or "False"`, and an `Element`-clause loop
  whose body is a `Block` left the loop variable symbolic
  (`Loop(Block(Assign(s, s + n)), Element(n, Range(1, 5)))` produced `5n`
  instead of accumulating `15`). Nested scopes now resolve enclosing block
  locals, loop variables, and — inside a function body — the function's
  parameters and locals correctly, so `while`/`for` lowerings with block bodies
  evaluate as expected.

- **Re-evaluating a program with `Declare` statements no longer throws.**
  Evaluating the same `Block` expression more than once — or a `Declare` inside
  a loop body, which re-executes every iteration — threw
  `The symbol "…" is already declared in this scope` on the second entry. A
  `Declare` statement now resets the binding it created on a previous run of the
  same scope. Genuine conflicts (redeclaring a function parameter, or
  `ce.declare()` on an explicitly declared symbol) still throw.

### Benchmarks

The numeric and symbolic state of this release is summarized below against the
last packed comparator release (`0.66.0`), SymPy, math.js, and **Mathematica** —
the reference baseline, since it is the broadest engine in the field. The tables
are generated by the harness in [`benchmarks/`](./benchmarks/)
(`node benchmarks/report_changelog.mjs`); every result is verified numerically
against an independent `mpmath` reference, never another tool. "CE 0.69.0" is
this release.

#### Numeric performance (200-digit precision)

Median time per call, in **microseconds — lower is better**. `—` means the tool
returned no usable result at that precision.

| Expression         | CE 0.69.0 | CE 0.66.0 | SymPy | math.js | Mathematica |
| ------------------ | --------: | --------: | ----: | ------: | ----------: |
| $\pi^2$            |       5.9 |       7.9 |   176 |     104 |         3.9 |
| $\sin 1$           |        20 |        20 |   222 |     442 |         5.2 |
| $\cos 1$           |        20 |        20 |   224 |     455 |         7.1 |
| $\ln 2$            |        13 |        81 |   339 |   4,315 |         3.8 |
| $e^{\pi}$          |        12 |        23 |   213 |   4,787 |         4.0 |
| $\zeta(3)$         |     1,542 |     3,395 |   268 |       — |          49 |
| $\Gamma(\tfrac13)$ |       830 |         — |   354 |       — |         214 |
| $\psi(\tfrac13)$   |       725 |         — | 2,810 |       — |         172 |

Biggest gains over `0.66.0`: $\ln 2$ **6.1× faster**, $\zeta(3)$ **2.2×
faster**.

#### Symbolic capability & performance

Each cell is **how many times faster than Mathematica** that engine is on the
case (`Mathematica ÷ engine`, so **higher is better**; Mathematica itself is
`1×`). `—` means the engine can't do the case; `✓` means it solves a case
Mathematica can't. Compare the **CE 0.69.0** and **CE 0.66.0** columns to see
what is _new this release_ (a `—` under `0.66.0` next to a number under the
current build). The **CE + R/F** column is the current build with the opt-in
Rubi integrator + Fungrim identities loaded (`loadIntegrationRules` /
`loadIdentities`), on the same minified bundle.

| Operation                              | CE 0.69.0 | CE + R/F | CE 0.66.0 | SymPy  | math.js | Mathematica |
| -------------------------------------- | :-------: | :------: | :-------: | :----: | :-----: | :---------: |
| **Antiderivatives**                    |           |          |           |        |         |             |
| $\int\frac{1}{\sqrt x}\,dx$            |   6.8×    |   3.1×   |   7.5×    |  0.5×  |    —    |     1×      |
| $\int\frac{x}{\sqrt{1-x^2}}\,dx$       |    11×    |   1.7×   |   10.0×   | 0.08×  |    —    |     1×      |
| $\int\frac{1}{x^3+1}\,dx$              |   6.3×    |   0.9×   |   6.7×    |  0.3×  |    —    |     1×      |
| $\int\frac{\sqrt x}{1+x}\,dx$          |     —     |   2.1×   |     —     |  0.1×  |    —    |     1×      |
| $\int\frac{x}{(1+x)^{1/3}}\,dx$        |     —     |   1.4×   |     —     | 0.01×  |    —    |     1×      |
| $\int\frac{x^2}{(1+x)^{1/3}}\,dx$      |     —     |   1.3×   |     —     | 0.007× |    —    |     1×      |
| **Derivatives**                        |           |          |           |        |         |             |
| $\tfrac{d}{dx}\sqrt{1-x^2}$            |   0.03×   |  0.03×   |   0.03×   | 0.001× | 0.004×  |     1×      |
| **Simplification**                     |           |          |           |        |         |             |
| $\sqrt{3+2\sqrt2}$                     |    46×    |   30×    |    41×    |   —    |    —    |     1×      |
| $\sqrt6\,x+\sqrt2\,x$                  |    98×    |   58×    |    97×    |  3.1×  |   19×   |     1×      |
| **Evaluation**                         |           |          |           |        |         |             |
| $\lim_{x\to0}\tfrac{\sin x}{x}$        |    55×    |   25×    |    56×    |  3.1×  |    —    |     1×      |
| $\lim_{x\to\infty}(1+\tfrac1x)^x$      |   9.7×    |   6.0×   |   5.1×    |  2.1×  |    —    |     1×      |
| $\int_1^2\tfrac1x\,dx$                 |   7429×   |  7782×   |   7935×   |  90×   |    —    |     1×      |
| $\int_{-\infty}^{\infty} e^{-x^2}\,dx$ |   459×    |   153×   |   586×    |  2.5×  |    —    |     1×      |
| **Solving**                            |           |          |           |        |         |             |
| $x^4+x^2-1=0$                          |   0.3×    |   0.2×   |   0.1×    | 0.06×  |    —    |     1×      |
| $x^3-x-1=0$                            |   1.9×    |   2.0×   |   0.2×    | 0.04×  |    —    |     1×      |

Across the cases both solve, Compute Engine is a **median 6.8× faster than
Mathematica** (up to 7429×).

<sub>
Measured 2026-07-08 · Compute Engine `0.68.0` @ `5a2abce1` (current build) · published `0.66.0` · SymPy `1.14.0` · math.js `15.2.0` · Mathematica `14.3.0 for Mac OS X ARM` · Node `v22.13.1`. Correctness is verified numerically against an independent `mpmath` reference, never another tool. Reproduce with `npm run build production && ./venv/bin/python3 benchmarks/gen_cases.py && node benchmarks/report.mjs && node benchmarks/report_changelog.mjs`.
</sub>

## 0.68.0 _2026-07-05_

### Breaking Changes

- **The ESM builds are no longer single-file: they load a shared chunk from
  `dist/chunks/`.** `compute-engine.esm.js`, `compute-engine.min.esm.js` and the
  corresponding `integration-rules` bundles are now built with code splitting,
  so the engine core is emitted once into a `chunks/chunk-*.js` file that both
  entry points import (this fixes `instanceof` failures when the
  integration-rules plugin is loaded alongside the main library, which
  previously carried its own duplicate copy of the engine). If you copy
  `compute-engine.min.esm.js` out of the package as a standalone file — for
  example to vendor it or serve it from your own static assets — you must now
  copy the `chunks/` directory alongside it, preserving the relative layout.
  Installing the package from npm, importing it from a bundler, or loading it
  from a CDN that serves the whole package (jsDelivr, unpkg, esm.sh) is
  unaffected. The `.umd.cjs` builds remain self-contained single files if you
  need a copyable artifact.

  Note that the chunk is required even if you don't use the integration-rules
  plugin: it contains the shared engine core, not the rule data. To vendor the
  Compute Engine _without_ the optional rule corpora, copy
  `compute-engine.min.esm.js` plus the `chunks/` directory and omit
  `integration-rules.*` (the Rubi corpus) and `identities.*` (the Fungrim
  corpus) — neither is loaded unless you import it explicitly. Each entry point
  imports exactly one chunk, so if you only ship the minified build you only
  need one of the two chunk files — the smaller one (the minified chunk), or
  definitively the one named in the entry file's first `import` statement. Just
  remember the names contain a content hash that changes between releases. All
  other sub-path bundles (`core`, `latex-syntax`, `numerics`, `compile`,
  `interval`, `identities`) remain self-contained. `Or`.\*\* `AB \parallel CD`
  is the parallelism relation, consistent with `\perp` → `Perpendicular`. Use
  `\lor` or `\vee` for disjunction (unchanged).

- **`\rightarrow` now parses to the mapping arrow `To`, not `Implies`.**
  `f: \mathbb{R} \rightarrow \mathbb{R}` now parses as a function signature,
  matching `\to`. This reverses the mapping introduced for issue #156:
  `\rightarrow`-as-implication was far rarer in practice than
  `\rightarrow`-as-mapping. Use `\Rightarrow`, `\implies`, or `\Longrightarrow`
  for implication (unchanged).

### New Operators

- **`Series`, `BigO`, and `Normal` provide symbolic series expansion.**
  `Series(f, x, x0, n)` returns the Taylor expansion of `f` in `x` about `x0`
  (default `x0 = 0`) up to and including the power `n` (default `n = 5`), plus
  an explicit remainder term. `x0` may be `±∞` for an asymptotic expansion in
  powers of `1/x`.
  - `Series(\sin x, x)` → $x - \tfrac{x^3}{6} + \tfrac{x^5}{120} + O(x^7)$;
    `Series(\ln(\cos x), x)` → $-\tfrac{x^2}{2} - \tfrac{x^4}{12} + O(x^6)$;
    `Series(\arctan x, x, +\infty)` →
    $\tfrac{\pi}{2} - \tfrac{1}{x} + \tfrac{1}{3x^3} - \dots$. Coefficients are
    exact (`Series(\sin x, x, \frac{\pi}{6})` gives $\tfrac12$,
    $\tfrac{\sqrt
    3}{2}$, …), and an undeclared `f` yields the textbook form
    $f(0) + f'(0)x +
    \dots$.
  - At a **pole** the result is a Laurent expansion with a finite principal
    part: `Series(\frac{1}{\sin x}, x)` →
    $\tfrac{1}{x} + \tfrac{x}{6} +
    \tfrac{7x^3}{360} + O(x^7)$,
    `Series(\cot x, x)` →
    $\tfrac{1}{x} - \tfrac{x}{3} - \tfrac{x^3}{45} + \dots$, and the special
    functions expand at their poles with exact coefficients —
    `Series(\Gamma(x), x)` →
    $\tfrac{1}{x} - \gamma + (\tfrac{\gamma^2}{2} +
    \tfrac{\pi^2}{12})x + \dots$,
    `Series(\zeta(x), x, 1)` → $\tfrac{1}{x-1} + \gamma + O(x-1)$. Poles at `±∞`
    are handled too (`Series(\frac{x^2}{x-1}, x, +\infty)` →
    $x + 1 + \tfrac1x + \tfrac1{x^2} +
    \dots$). An essential singularity or
    branch point (e.g. `Series(e^{1/x}, x)`, `Series(\ln x, x)`) is still left
    unevaluated rather than expanded incorrectly.
  - `BigO(u)` is the inert Landau remainder, serialized `O\left(u\right)` and
    parsed from `\mathcal{O}(u)` and `\operatorname{O}(u)`. It is inert under
    `evaluate`/`simplify`; a numeric approximation (`.N()`) of any expression
    containing it is `NaN`.
  - `Normal(expr)` strips the `BigO` terms, yielding the compilable/plottable
    truncated polynomial: `Normal(Series(\sin x, x))` →
    $x - \tfrac{x^3}{6} +
    \tfrac{x^5}{120}$.

- **`TrigExpand`, `TrigToExp`, and `TrigReduce` rewrite trigonometric and
  hyperbolic expressions.** These are transformation verbs in the spirit of
  `Expand`/`Factor` and preserve exactness.
  - `TrigExpand` expands functions of sums and integer multiples of angles:
    `TrigExpand(\sin(a+b))` → $\sin a\cos b + \cos a\sin b$ and
    `TrigExpand(\cos(2x))` → $\cos^2 x - \sin^2 x$ (hyperbolic analogs, and
    `\sec`/`\csc`/`\cot` as reciprocals of the expanded `\cos`/`\sin`, are also
    handled).
  - `TrigToExp` rewrites trigonometric and hyperbolic functions in terms of the
    complex exponential, exactly: `TrigToExp(\sin x)` →
    $-\tfrac{i}{2}e^{ix} + \tfrac{i}{2}e^{-ix}$.
  - `TrigReduce` is the inverse of `TrigExpand`, rewriting products and integer
    powers as functions of multiple angles: `TrigReduce(\sin^2 x)` →
    $\tfrac{1 - \cos 2x}{2}$ and `TrigReduce(\sin x\cos x)` →
    $\tfrac{\sin 2x}{2}$.

- **Probability distributions: `NormalDistribution`, `BinomialDistribution`,
  `PoissonDistribution`, `UniformDistribution`, `ExponentialDistribution`,
  consumed by the generic `PDF`, `CDF`, and `Quantile` operators.** A
  distribution is a first-class value — assign it, pass it around, query it:
  - `PDF(dist, x)`, `CDF(dist, x)` and `Quantile(dist, p)` evaluate to **exact
    closed forms**: `CDF(NormalDistribution(0, 1), x)` →
    $\tfrac12\left(1 + \operatorname{erf}\tfrac{x}{\sqrt2}\right)$, an ordinary
    expression that can be simplified, differentiated, compiled and plotted.
    Exact arguments give exact results —
    `PDF(BinomialDistribution(4, \tfrac12), 2)` → $\tfrac38$ — and `.N()`
    numericizes at machine or arbitrary precision.
  - For discrete distributions `PDF` is the probability mass function, and
    `Quantile` (the least $k$ with $\operatorname{CDF}(k) \ge p$) is computed by
    exact search: `Quantile(PoissonDistribution(9), 0.95)` → `14`.
  - `Mean`, `Variance`, and `StandardDeviation` now also accept a distribution:
    `Mean(NormalDistribution(\mu, \sigma))` → $\mu$,
    `Variance(BinomialDistribution(n, p))` → $np(1-p)$.
  - `NormalDistribution(\mu, \sigma)` takes the standard deviation (not the
    variance), and `ExponentialDistribution(\lambda)` the rate — the Mathematica
    and scipy conventions.

- **`GammaRegularized` and `BetaRegularized` — the regularized incomplete gamma
  and beta functions.** `GammaRegularized(a, z)` is
  $Q(a, z) = \Gamma(a, z)/\Gamma(a)$ and `BetaRegularized(x, a, b)` is
  $I_x(a, b)$. They follow the exactness contract (special values fold —
  `GammaRegularized(1, z)` → $e^{-z}$ — and exact arguments stay symbolic),
  evaluate numerically at machine and arbitrary precision, and compile to
  JavaScript and Python (`scipy.special.gammaincc`/`betainc`). The discrete
  distribution CDFs evaluate to closed forms in these functions, e.g.
  `CDF(PoissonDistribution(\lambda), k)` →
  $\operatorname{GammaRegularized}(k+1, \lambda)$.

- **`Covariance`, `PopulationCovariance` and `Correlation` measure the
  relationship between two data sets.** Each accepts either two equal-length
  collections or a single collection of $(x, y)$ pairs (a scatter of points).
  Exact data gives exact results — `Covariance([1,2,3,4,5], [2,4,5,4,5])` →
  $\tfrac32$ and the Pearson correlation of the same data is
  $\tfrac{\sqrt{15}}{5}$, exactly. `Covariance` uses the sample ($n-1$)
  convention, `PopulationCovariance` the population ($n$) convention, matching
  `Variance`/`PopulationVariance`. Parse aliases: `\operatorname{cov}` and
  `\operatorname{corr}`. Both compile to JavaScript and Python
  (`np.cov`/`np.corrcoef`).

- **`LinearRegression` and `PolynomialFit` compute least-squares fits.**
  `LinearRegression(xs, ys)` (or a collection of points) evaluates to
  `(intercept, slope)`, and `PolynomialFit(data, degree)` to the list of
  coefficients, constant term first. **Exact data yields exact coefficients**:
  points lying on $1 + x^2$ fit at degree 2 to exactly `[1, 0, 1]`, and rational
  data produces exact rational coefficients rather than floats. With a trailing
  variable argument the fitted **expression** is returned directly, ready to
  plot: `PolynomialFit([(0,1), (1,2), (2,5), (3,10)], 2, x)` → $x^2 + 1$.

- **`Quantile` computes empirical quantiles of data.** `Quantile(collection, p)`
  interpolates the sorted data so that `Quantile(xs, 1/4)`, `Quantile(xs, 1/2)`
  and `Quantile(xs, 3/4)` agree exactly with `Quartiles` and `Median`
  (Moore–McCabe convention), with general `p` interpolated through the order
  statistics in rank space. (Combined with the distribution form above,
  `Quantile` covers both the theoretical and the empirical case.)

- **`Divides` and `NotDivides` express divisibility.** `a \mid b` parses to
  `Divides(a, b)` and `p \nmid ab` to `NotDivides(...)`; both evaluate for
  concrete integers (`Divides(3, 12)` → `True`) and stay symbolic otherwise.

- **Geometry notation is transcribed as inert heads.** `\angle ABC` →
  `Angle(A, B, C)` (also `\varangle`, `∠`), `\triangle ABC` →
  `Triangle(A, B, C)`, `\square ABCD` → `Quadrilateral(A, B, C, D)`, `A \perp B`
  → `Perpendicular`, `AB \parallel CD` → `Parallel`, `\widehat{ABC}` → `Arc`,
  `\overparen{BC}` → `OverParen`, and `\langle a, b \rangle` → `AngleBracket`.
  These heads have no evaluation semantics — the Compute Engine does not model
  geometry — but they parse and serialize faithfully so downstream consumers
  (e.g. graphical clients) get the structure instead of an error. Angle and arc
  measures are typed as numbers, so `\angle A + \angle B + \angle C = 180^\circ`
  composes in arithmetic.

- **`\sim` parses to the generic similarity relation `Tilde`.** It covers
  triangle similarity (`\triangle ABC \sim \triangle DEF`), asymptotic
  equivalence, and "is distributed as" (`X \sim N(0, 1)`); `\nsim` negates it,
  and `\simeq` now maps to the existing `TildeEqual` head (it previously had no
  LaTeX trigger).

### Step-by-Step Explanations

- **`expr.explain()` returns a structured, step-by-step explanation of a
  simplification** — the textbook chain _expression → step (with a reason) → … →
  result_. Each step carries the expression state after the step, a stable
  machine `id` (the localization key for consumers), and a default English
  description; `explain().result` is always the same value `simplify()` returns.
  `ce.parse('\\frac{x^2-1}{x-1}').explain()` yields one step, _"Cancel the
  common factors"_, ending at `x + 1`.
  - The step chain is curated by default (driver bookkeeping is filtered out);
    pass `{verbosity: 'all'}` for the raw trace (rule authoring, debugging).
    `simplify()` options (`rules`, `costFunction`, `strategy`) are honored.
  - The most frequently fired simplification rules ship with curated
    descriptions ("Apply the Pythagorean identity: sin²x + cos²x = 1", "Combine
    powers with the same base: xⁿ·xᵐ = xⁿ⁺ᵐ", …); other rules get a readable
    fallback derived from the rule id. `registerStepLabels()` lets a host
    application override or extend the descriptions.
  - **`expr.explain('solve')` traces equation solving.** Step values are
    _equations_ — the state after each phase — so the chain reads like textbook
    working: `2x+1=5` → _Move all terms to one side_ `2x-4=0` → _Isolate the
    unknown_ `x=2`. The trace covers the solver's algorithmic phases (clearing
    denominators, squaring both sides, substitutions like `u = eˣ` with
    back-substitution, zero-product factoring, the quadratic formula, checking
    candidates and rejecting extraneous roots) and the root-template rules,
    which now carry stable `solve.*` ids. `explain('solve').result` is a `List`
    of the same roots `solve()` returns; the unknown is inferred or passed via
    `options.variable`. Systems of equations are not traced yet.
  - **`expr.explain('D')` traces differentiation.** Steps are whole-expression
    states in traversal order — each textbook rule (sum, product, quotient,
    power, chain, exponential, logarithmic differentiation, table lookups) first
    appears with its unresolved sub-derivatives as inert `D(…)` terms, which
    resolve step by step: `D(x·sin x, x)` → _Apply the product rule_
    `x·D(sin x, x) + sin x` → _Differentiate using a known derivative_
    `x·cos x + sin x`. The variable is inferred when unambiguous (or passed via
    `options.variable`), and the result always matches evaluating
    `D(expr, variable)`.

### Solving

- **`Solve` accepts a domain for the unknown.**
  `Solve(x^2-5x+6=0,\; x \in 1..1000)` restricts solutions to a collection: the
  equation is solved symbolically and the roots are filtered to the domain (an
  integer domain also discards non-integer roots up front). When the symbolic
  solver finds nothing and the domain is finite and reasonably sized, `Solve`
  falls back to enumeration with a compiled predicate, confirming every
  candidate exactly so float rounding never produces a wrong answer (budgeted,
  interruptible; an unaffordable search returns the expression unevaluated
  rather than a partial answer). The predicate is not limited to equations — any
  boolean condition works: `Solve(2^n \equiv 1 \pmod{7},\; n \in 1..20)` →
  `[3, 6, 9, 12, 15, 18]`, and an extra condition can ride on the domain
  (`n \in 1..100, n > 5`-style, as in `Sum` indexing sets). The two-argument
  form is unchanged.

- **Multiple unknowns enumerate over the product of their domains.**
  `Solve(x^3+y^3=1729,\; x \in 1..12,\; y \in 1..12)` →
  `[(1,12), (9,10), (10,9), (12,1)]` — a `List` of `Tuple`s in unknown order,
  with the same budget, exact-confirmation, and interruption guarantees as the
  univariate case.

- **Integer equations are solved symbolically (diophantine solving).** When
  every unknown ranges over integers, `Solve` recognizes **linear** equations in
  any number of unknowns and **Pell-family** equations $x^2 - Dy^2 = N$
  (including the elliptic case $x^2 + |D|y^2 = N$) and solves them in closed
  form — ported from SymPy's diophantine module and validated against its test
  suite. Over a bounded domain this reaches answers enumeration cannot:
  `Solve(x^2-29y^2=1,\; x \in 1..10^5,\; y \in 1..10^5)` → `[(9801, 1820)]` via
  continued fractions, where the $10^{10}$-candidate sweep would be refused; an
  unsolvable equation is decided instantly
  (`Solve(6x+9y=4,\; x \in \pm10^6,\; y \in \pm10^6)` → `[]`). With
  integer-typed unknowns and no domain — previously inert — `Solve` returns the
  **parametric family**: `Solve(3n+4m=7, n, m)` → `[(4t-7,\; -3t+7)]` with the
  fresh parameter `t` ranging over ℤ, and Pell equations yield their exact
  closed forms $\bigl(\tfrac{(3+2\sqrt2)^t + (3-2\sqrt2)^t}{2}, \dots\bigr)$,
  and **Pythagorean triples** return the complete classical parametrization:
  `Solve(x^2+y^2=z^2, x, y, z)` →
  $\bigl(t(t_1^2-t_2^2),\; 2t\,t_1 t_2,\; t(t_1^2+t_2^2)\bigr)$ and its leg-swap
  — every integer triple, including all signs, lies in one of the two families.
  Every concrete solution is exact-confirmed by substitution; half-bounded
  domains (e.g. $n \ge 1$ alone) are left unevaluated, and forms whose textbook
  parametrizations are provably incomplete (weighted coefficients, four or more
  squares) are declined rather than answered partially.

- **Periodic equations expand their root families over a bounded domain.**
  `Solve(\sin x = \tfrac12,\; x \in [0, 4\pi])` returns all four exact solutions
  $\tfrac{\pi}{6}, \tfrac{5\pi}{6}, \tfrac{13\pi}{6},
  \tfrac{17\pi}{6}$ — not
  just the principal values. Scaled arguments work too (`\sin 2x = 1` over
  $[0, 2\pi]$ → $\tfrac{\pi}{4}, \tfrac{5\pi}{4}$). Expansion applies when the
  unknown appears only inside trigonometric functions of linear arguments; each
  family member is verified by exact substitution, and unreasonably large
  expansions degrade gracefully to the principal roots.

- **`assume()` bounds now filter solutions.** After `assume(n > 0)`,
  `Solve(n^2 = 16, n)` (and `expr.solve("n")`) returns `[4]` instead of
  `[4, -4]`; `assume(n \in 1..10)`, inequality, and `\ne` assumptions are
  honored the same way, conjunctively with any explicit domain. Roots are
  dropped only when an assumption definitely excludes them — symbolic roots that
  cannot be decided are kept.

### Parsing Resilience

The parser was hardened against a corpus of ~2,300 math fragments extracted from
real olympiad problems (the MathNet dataset); the clean-parse rate on that
corpus went from 85% to ~96%, and the one crash it exposed is fixed. See
`docs/mathnet/` for the corpus, the regression checker, and the work plan.

- **Ellipsis in a numeric context no longer throws.**
  `(1!)^2 + (2!)^2 + \dots + (2018!)^2` crashed with
  `The type of the constant "ContinuationPlaceholder" cannot be changed` (type
  inference attempted to narrow a constant). Inference is now a no-op on
  constants.

- **`\cdots`, `\dotsb`, `\dotsc`, `\dotsm`, and Unicode `…` parse as ellipsis.**
  Previously only `\dots`/`\ldots`/`...` did; `(2!+2)(3!+3) \cdots (2019!+3)`
  now parses with the placeholder as an inert operand instead of erroring.

- **A trailing sentence period no longer breaks an equation.** Input copied from
  prose often ends in `.`, `;` or `,` (e.g. `... = z^2.`). When — and only when
  — the parse would otherwise contain an error, the trailing punctuation is
  dropped and the input re-parsed. Valid input is unaffected: `5.` still parses
  as the decimal $5$.

- **Congruences parse and evaluate.** `a \equiv b \pmod{n}` (also `\bmod`, the
  parenthesized `(\bmod n)`, and the ASCII form `n ≡ 1 (mod 3)`) parse to
  `Congruent(a, b, n)`, which evaluates for concrete integers
  (`7 \equiv 1 \pmod{3}` → `True`) and now accepts symbolic moduli
  (`2^n \equiv 1 \pmod{p^{k+1}}` stays symbolic instead of erroring).

- **Common Unicode math symbols are accepted:** `≡` (congruence), `∈`, `∉`, `∪`,
  `∩`, `≈`, `∠`, and `…` — useful when input comes from plain-text sources
  rather than LaTeX.

- **Alignment environments parse as systems.**
  `\begin{aligned} a^2+ab+c=0 \\ b^2+bc+a=0 \end{aligned}` (also `align`,
  `gather`, `split`, `multline`, `eqnarray` and their starred variants) parses
  to a `List` of the row expressions — the same convention as `\begin{cases}`,
  accepted by `solve()`. Alignment markers are transparent: `x &= y` is `x = y`.

- **Qualified number sets parse.** `\mathbb{R}_{>0}` → `PositiveNumbers`,
  `\mathbb{Z}_{\ge0}` → `NonNegativeIntegers`, `\mathbb{N}^*` →
  `PositiveIntegers`, etc., and they round-trip to canonical LaTeX. A
  qualification with no named set (`\mathbb{N}_{>1}`) falls back to a faithful
  set-builder.

- **Structural odds and ends:** `A \backslash B` parses as `SetMinus` (the
  common alternative spelling of `\setminus`); a standalone quantified condition
  `\forall n \ge 1` parses instead of erroring; `\underbrace` mirrors
  `\overbrace`.

- **A symbol's inferred type narrows instead of erroring.** When a free symbol's
  type was inferred from one use and a later use requires a more specific type,
  argument validation now narrows the inference (when sound) instead of
  producing an `incompatible-type` error. This fixes
  `(A \setminus B) \cup (B \setminus A)` — where `B` was inferred as a value and
  then rejected as a set — as well as `-n!!` (double factorial of an undeclared
  symbol) and a family of similar mixed-use expressions. Declared types are
  unaffected: passing a declared string where a set is required is still an
  error.

### Packaging

- **The `integration-rules` plugin shares code with the main library.** The ESM
  builds of `compute-engine` and the opt-in
  `@cortex-js/compute-engine/integration-rules` entry point are now emitted with
  code splitting: the engine core lives in a shared chunk imported by both,
  instead of being bundled twice. This shrinks the combined download and fixes
  cross-bundle `instanceof` failures when a host mixed objects from the two
  bundles. The UMD builds remain self-contained single files.

### Lenient parsing and string helpers

- **The string helpers take a `strict` option.** `simplify()`, `evaluate()`,
  `N()`, `expand()`, `expandAll()`, `factor()`, `solve()`, and `compile()` parse
  string input in lenient (non-strict) mode by default. Note that lenient mode
  is not a pure superset of strict LaTeX: unbraced multi-digit scripts change
  meaning — `x^23` is $x^{23}$ (not $3x^2$), and `x_23`/`a_12` are single
  multi-digit subscripts. Pass `{ strict: true }` (e.g.
  `N('x^23', { strict: true })`) to restore the strict LaTeX grammar.

- **Lenient inverse functions, `atan2`, and letter runs parse correctly.**
  `sin^-1 x` now means $\arcsin x$ (the inverse function), not $1/\sin x$
  (matching strict `\sin^{-1}`); `sin^-2 x` stays $1/\sin^2 x$. `atan2(1, 2)`
  parses as `Arctan2(1, 2)`, and `acot`/`asec`/`acsc` are recognized. A
  multi-letter run with an embedded Greek constant is segmented (`2pix` →
  $2\pi x$, `xpi` → $x\pi$) instead of injecting a spurious imaginary unit, and
  an implicit subscript is accepted on a constant base (`alpha2` → $\alpha_2$).

### Differential Equations

- **Repeated roots produce correct general solutions.** `DSolve` now clusters
  numeric characteristic roots by multiplicity: $y'''' + 2y'' + y = 0$ gives
  $(c_1 + c_2 x)\cos x + (c_3 + c_4 x)\sin x$ instead of a degenerate basis with
  spurious $e^{\varepsilon x}$ factors, and repeated real roots keep their
  $x e^{x}$ modes. A structural self-check returns the equation unevaluated
  rather than emit a basis with fewer independent solutions than the order.

- **No more corrupted solutions.** Equations with variable coefficients on
  higher-order derivatives (e.g. $x^2 y'' + x y' = x$) previously returned a
  "solution" containing an internal `Error` node; they now stay unevaluated when
  the class is unsupported. Equations whose right-hand side references the
  dependent function with a transformed argument (e.g. $y'(x) = y(2x)$) stay
  unevaluated instead of returning an unevaluated integral as "solved".

- **Exponential forcing terms solve.** Variation of parameters was silently
  disabled for exponential bases (an internal Wronskian stayed unsimplified):
  $y'' - y = e^x$ now returns
  $c_1 e^x + c_2 e^{-x} + \frac12 x e^x - \frac14 e^x$, and $y'' + y = e^x$
  returns $c_1 \cos x + c_2 \sin x + \frac12 e^x$, instead of the equation
  unevaluated. Solutions are returned in collected form (no $e^a \cdot e^b$
  products or $A\sin^2 u + A\cos^2 u$ pairs).

- **Parsed LaTeX input works end-to-end.** `ce.parse("y''(x)+y(x)=0")` no longer
  canonicalizes the derivative of an undeclared function into an `Error` node: a
  derivative now reports a numeric result type, so prime/dot-notation equations
  flow from `parse()` through `DSolve` ($\dot x + \ddot x$ expressions are
  likewise no longer corrupted). The implicit first-order form
  `Apply(Derivative(y), x)` is also recognized (order defaults to 1).

### Evaluation

- **`Beta` is exact and pole-aware.** $\mathrm{B}(a, m)$ with a positive integer
  argument reduces exactly ($\mathrm{B}(2,3) = \frac{1}{12}$,
  $\mathrm{B}(-2,2) = \frac12$), and arguments at gamma-function poles return
  $\tilde\infty$ instead of a silently wrong finite value ($\mathrm{B}(-1,2)$
  previously returned $-2.97\times10^{49}$).

- **Multiplication by infinity respects sign information.** $x \cdot \infty$
  stays symbolic when the sign of $x$ is unknown, evaluates to $-\infty$ when
  $x$ is known negative, and to `NaN` when $x$ is zero — it no longer collapses
  to $+\infty$ unconditionally.

- **Inverse hyperbolic functions have values at their poles.**
  $\operatorname{artanh}(\pm 1)$ and $\operatorname{arcoth}(\pm 1)$ evaluate to
  $\pm\infty$, $\operatorname{arsech}(0)$ to $+\infty$, and
  $\operatorname{arcsch}(0)$ to $\tilde\infty$, with result types that no longer
  claim a finite value at a pole.

- **`Sum` reports incompatible elements.** Summing a collection containing a
  string returns a typed error instead of a silent `NaN`.

- **Sums and products over an infinite domain stay symbolic under
  `evaluate()`.** An infinite domain has no exact value by truncation, so
  $\sum_{n=1}^{\infty} \frac{1}{n^2}$ now evaluates to itself; `.N()` returns
  the truncated numeric approximation, as before. Previously `evaluate()`
  returned a silently truncated partial sum (off by $\sim 10^{-4}$ for this
  example) — a float where the exactness contract promises an exact value.

- **Sums and products with symbolic bounds no longer evaluate to a number.**
  `\sum_{k=1}^{n} k` with an unbound $n$ evaluated to $50\,015\,001$ — the sum
  truncated at an internal iteration cap of $10\,001$ — under both `evaluate()`
  and `.N()`. It now stays symbolic (`simplify()` still produces the closed form
  $\tfrac{n^2+n}{2}$).

- **`Expand` computes constant powers.** `Expand((2+3i)^{1000})` returns the
  exact 557-digit Gaussian integer (matching SymPy's `expand()`), and
  `Expand(2^{1000})` the exact integer; both previously returned unevaluated.
  Structural expansion of symbolic powers is unchanged, and powers too large for
  exact computation still stay symbolic.

- **Huge exact complex numbers are finite and print in full.** An exact Gaussian
  integer with components beyond float64 range (e.g. $(2+3i)^{1000}$) reported
  `isInfinity` `true`, serialized as $\tilde\infty$ in plain text, and had a
  `NaN` `bignumIm` — all artifacts of routing through the machine-float
  projection. It now types as `finite_complex`, prints its full digits, and
  `bignumIm` is exact.

- **Perfect-power radicands reduce.** $(997^3)^{1/6} = \sqrt{997}$,
  $8^{1/6} = \sqrt2$, $8^{1/4} = 2^{3/4}$: when canonicalization folds a power
  into an opaque integer, the root now recovers the structure by perfect-power
  decomposition. In particular the zero-equivalence test
  $\sqrt{997} - (997^3)^{1/6}$ evaluates to exact $0$ (it previously leaked a
  float residue).

- **Logarithms reduce when the argument and base are powers of a common base.**
  $\log_8 32768 = 5$, $\log_8 2 = \tfrac13$, $\log_4 8 = \tfrac32$ — exactly,
  honoring the exactness contract ($\ln 2$ and $\log_8 10$ stay symbolic).

- **`Xor` cancels repeated operands.** $a \oplus a = \mathrm{False}$, so
  `Xor(x, y, y)` evaluates to $x$; cancellation composes with the existing
  `True`/`False` folding.

### Linear Algebra

- **3×3 `Eigenvalues` returned wrong values — fixed.** The analytic solver used
  a sign-flipped term in its depressed cubic, mirroring every eigenvalue about
  $\operatorname{tr}/3$: e.g. $[[5,-3,-7],[-2,1,2],[2,-3,-4]]$ returned
  $\{\tfrac{10}{3}, -\tfrac53,
  \tfrac13\}$ instead of $\{1, -2, 3\}$. (Spectra
  symmetric about their mean — like $\{1,2,3\}$ — were unaffected, which is how
  it escaped notice.) Additionally, a complex-conjugate eigenvalue pair was
  returned as its real part twice ($\{2, \pm i\}$ came back $\{2, 0, 0\}$);
  complex eigenvalues are now returned as complex numbers.

### Rules and Pattern Matching

- **Rule conditions must return a boolean.** A `condition` function returning a
  non-boolean (e.g. the boxed symbol `False`, which is a truthy JavaScript
  object) no longer fires the rule; a one-time console warning identifies the
  malformed condition. Returning the boxed symbol `True` is accepted.

- **`e` and `i` work in string rules.** Rules such as `'e^2 -> 7'` now match:
  the constants are resolved to `ExponentialE` and the imaginary unit when the
  rule is parsed, instead of remaining inert symbols that could never match.

- **Explicit wildcards work in LaTeX match patterns.** An object-form rule such
  as `{match: '_a + 1', replace: '_a'}` now parses `_a`/`__a` as wildcards
  instead of an implicit product.

- **A throwing condition no longer discards subexpression rewrites.** If a rule
  condition throws, the rule is skipped at that node but successful rewrites of
  the operands are kept.

## 0.67.0 _2026-07-03_

This release improves correctness and predictability across the public Compute
Engine API: exact complex and integer arithmetic stays exact more often, partial
derivatives and assumptions are more capable, LaTeX and lenient parsing
round-trip more reliably, compiled output agrees more closely with interpreted
evaluation, and arbitrary-precision arithmetic is substantially faster. It also
fixes many cases where `evaluate()`, `N()`, `simplify()`, `isEqual()`,
`assume()`, `verify()`, serialization, or compilation could return a wrong
answer, lose exactness, hang, or silently accept invalid input.

### Exact and Numeric Evaluation

- **Exact complex arithmetic preserves exact values.** Gaussian integer and
  rational complex values now stay exact through arithmetic: $(1+i)^3$ evaluates
  to $-2+2i$, $(1+i)^{-2}$ to $-\frac{i}{2}$, $\frac{1}{1+i}$ to
  $\frac{1-i}{2}$, $\sqrt{3+4i}$ to $2+i$, and $\sqrt{-4}$ to $2i$. Exact
  complex numbers also round-trip through MathJSON as `["Complex", re, im]` with
  exact components.

- **Integer powers and large integers stay exact.** Integer powers such as
  $2^{127}$ now evaluate to exact integers, negative integer powers produce
  exact rationals such as $2^{-2} = \frac14$, and powers of Gaussian integers
  such as $(1+i)^2$ evaluate exactly. Very large exact integers are no longer
  rounded when used by `IsPrime`, `IsOdd`, `IsEven`, `FactorInteger`, `Mod`, or
  `DigitSum`.

- **Exact results are preserved more consistently.** `evaluate()` no longer
  turns exact arguments into floats in cases such as $\sqrt{-2}$,
  $\operatorname{Fract}(\frac12)$, $\Re(\frac12)$, $|1+i|$, $\log_2(\pi)$,
  `Distance`, and statistics functions. For example,
  $\operatorname{Mean}([1,2,3,4])$ now returns $\frac52$, and
  $\operatorname{StandardDeviation}([1,2,3,4])$ returns $\frac{\sqrt{15}}{3}$.

- **Special functions are more accurate.** `PolyGamma`, `Zeta`, `BesselI`,
  `BesselK`, Airy functions, logarithms, roots, trigonometric functions near
  zeros and poles, `LambertW`, `acos`, `erfInv`, `Hypergeometric2F1`, `Gamma`,
  `Beta`, Fresnel integrals, and complex elementary functions have improved
  numeric accuracy, including at high precision.

- **Negative logarithms and complex logarithms are consistent.** Inexact
  negative arguments now produce the principal complex value under both
  `evaluate()` and `N()`. Exact negative arguments stay symbolic under
  `evaluate()` and produce the principal complex value under `N()`. Logarithms
  with a complex argument and explicit base now agree between `evaluate()` and
  `N()`.

- **Roots and radicals are more reliable.** Exact perfect powers such as
  $64^{1/3}$ and $(27/8)^{1/3}$ evaluate exactly, `Root(64, 3).N()` returns
  exactly $4$, odd roots of negative numbers keep the real-root convention, and
  `N(\sqrt{4y})` now returns $2\sqrt{y}$ instead of dropping the radical.

- **Sums and infinite sums behave better.** Exact sums such as
  $\sum_{k=1}^{5}\sqrt{k}$ now remain exact, while sums over infinite index sets
  such as $\sum_{n \in \mathbb{Z}^+}\frac{1}{n^2}$ evaluate numerically when
  appropriate, remain symbolic when parameters prevent evaluation, and respect
  `timeLimit`.

### Differentiation, Integration, and Simplification

- **Partial derivatives of multivariate functions now work symbolically.**
  `D(f(x, y), x)` now represents the partial derivative with respect to the
  first argument, mixed partials accumulate correctly, and multivariate chain,
  product, power, and quotient rules compose as expected. For example,
  `D(f(x^2, y), x)` returns a symbolic chain-rule result proportional to $2x$.

- **Partial-derivative notation parses and evaluates.** Forms such as
  $\partial_x f(x,y)$, $\frac{\partial}{\partial x} f(x,y)$,
  $\frac{\partial^2}{\partial x \partial y} f(x,y)$, and
  $\frac{\partial^2}{\partial x^2} f(x,y)$ now parse to `D` and evaluate
  correctly.

- **Derivative notation is more robust.** Compact derivatives such as
  `d/dx(f(g(x)))` preserve unknown-function chain rules, higher-order
  derivatives round-trip through LaTeX, and $\frac{d}{dx}[\sin x]$ treats the
  square brackets as grouping rather than a one-element list.

- **Several derivative rules are corrected.** Variable-degree radicals such as
  `Root(x, x)` differentiate as $x^{1/x}$, $\frac{d}{dx}\operatorname{Mod}(x,5)$
  gives $1$ almost everywhere, and $D(\operatorname{arcoth}(x), x)$ returns
  $\frac{1}{1-x^2}$.

- **Definite integrals no longer return fabricated closed forms.** If no
  closed-form antiderivative is found, `evaluate()` keeps the definite integral
  symbolic instead of substituting bounds into the integrand. `N()` still
  computes a numeric value.

- **Default simplification covers more identities.** The sine addition identity
  $\sin(x)\cos(y)+\cos(x)\sin(y)=\sin(x+y)$ now applies in the default
  `simplify()` path. Pythagorean identities such as $\sin^2 x+\cos^2 x$ also
  simplify inside larger sums.

- **Simplification is more exact and branch-aware.** Combining powers keeps
  exact exponents, for example $x \cdot x^{\sqrt2}$ becomes $x^{1+\sqrt2}$. The
  simplification of $\ln(x^2)$ now produces $2\ln(|x|)$ for real $x$, and
  identities that require real arguments no longer apply to symbols declared as
  complex.

- **Some unsafe rewrites were removed.** `simplify()` no longer rewrites
  $|\sin x|$ as $\sin|x|$, `Arctan2` preserves the correct quadrant, rule
  conditions such as $x \ne 0$ require proof rather than assuming unknown
  symbols satisfy them, and alternating-binomial sum simplifications now check
  their validity bounds.

- **Differential equation solvers handle higher-order equations.** (contributed
  by [KingArth0r](https://github.com/KingArth0r)) `DSolve` now solves **linear
  constant-coefficient homogeneous** equations of any order via the
  characteristic polynomial — distinct real, repeated, and complex roots — for
  example `y''(x) = y(x)` → `[y(x) = c_1·e^x + c_2·e^{-x}]` and
  `y''(x) + y(x) = 0` → `[y(x) = c_1·cos(x) + c_2·sin(x)]`. Roots are kept exact
  when the characteristic polynomial factors and fall back to numeric roots
  otherwise. It also solves **second-order constant-coefficient nonhomogeneous**
  equations (undetermined coefficients for polynomial forcing, variation of
  parameters otherwise) and **second-order Cauchy–Euler** equations. Integration
  constants are now named `c_1`, `c_2`, … (fresh names are chosen if those are
  already in use). Correspondingly, `NDSolve` now solves explicit
  **higher-order** initial value problems `y⁽ⁿ⁾(x) = f(x, y, y', …, y⁽ⁿ⁻¹⁾)` by
  reducing them to a first-order RK4 system, with the initial condition given as
  a list `[y(x0), y'(x0), …]`. Equations outside these classes remain inert.

### Parsing and Serialization

- **`\binom` is supported.** `\binom{n}{k}`, `\dbinom{n}{k}`, and
  `\tbinom{n}{k}` parse to `Binomial(n, k)`, and `Binomial` serializes back to
  `\binom`.

- **LaTeX parsing accepts more common notation.** `N(...)` and `D(...)` parse as
  numeric evaluation and differentiation outside quantifier scopes, superscripts
  on `\log`, `\ln`, `\lg`, and `\exp` bind to the applied function, and `==`,
  `!=`, chained `\ne`, mixed-direction inequality chains, parenthesized
  relations, and double negation such as `x--y` now parse with the expected
  meaning.

- **Lenient parsing is more useful.** In lenient mode, digit suffixes parse as
  subscripts (`x2` as $x_2$), bare known function names apply to the following
  factor (`sin x`), `log2(8)` means $\log_2 8$, `[1,...,10]` parses as a range,
  and $\mathbb{Z}^+$ parses as `PositiveIntegers`.

- **The public string helpers accept their documented syntax.** `simplify()`,
  `evaluate()`, `N()`, `expand()`, `expandAll()`, `factor()`, `solve()`, and
  `compile()` now parse string input in non-strict mode, so expressions such as
  `sqrt(5)`, `sin(alpha)`, and `x**2` work as documented.

- **`verify()` and `assume()` accept strings.** `ce.verify('x > 0')` and
  `ce.assume('$x > 0$')` parse the predicate and report clear errors for
  unparseable input.

- **MathJSON `.json` serialization is lossless for more numbers.** Exact large
  integers, 16- and 17-digit values, high-precision complex numbers, exact
  rational/radical values such as $\frac{\sqrt3}{2}$, and repeating decimals now
  round-trip without silently changing value.

- **LaTeX round-trips are improved.** Repeating decimals serialize with an
  overline, sequence expressions no longer serialize as ambiguous adjacent
  numbers, set-builder notation attaches conditions to the comprehension, and
  `toMathJson({exclude: ...})` honors exclusions for number literals.

### Assumptions, Types, and Equality

- **The numeric type hierarchy is more natural.** `real` is now a subtype of
  `complex`, so real-typed symbols satisfy complex-typed signatures and guards.
  Union types flatten and canonicalize their member order, and type negation now
  distinguishes `never` from `nothing`.

- **Complex and non-finite type inference is more precise.** Expressions such as
  $\sqrt2 i$, $i^2$, $i/2$, $i^3$, $e^i$, and $\ln(-1)$ infer more accurate
  types. Non-finite values such as $\tan(\frac\pi2)$, $\Gamma(0)$, $\zeta(1)$,
  $\ln(0)$, $0 \cdot \infty$, and $k/0$ no longer claim finite types when that
  is unsound.

- **Assumptions can prove more facts.** Assumptions over signed integer and real
  sets refine both type and sign. Inequality bounds now affect equality checks,
  comparisons between bounded symbols, and `verify()`. Chained inequalities and
  equations with multiple roots are recorded correctly, contradictory
  assumptions are rejected atomically, and `forget()` clears values introduced
  by `assume('x = 5')` while preserving values set with `assign()`.

- **Assumptions respect scope.** Assumptions made inside a pushed scope no
  longer leak into parent scopes or continue to affect expression results after
  `popScope()`.

- **Equality and ordering are more coherent.** `isSame` is now an equivalence
  relation, `isEqual` returns `undefined` for indeterminate equality with free
  variables, equality and ordering share one tolerance, collection equality uses
  scalar tolerance semantics, and complex numbers are no longer ordered against
  real numbers.

- **Set, collection, and statistics behavior is corrected.** `Intersection`,
  `SymmetricDifference`, `Union`, and `SetMinus` produce correct finite-set
  results, `Reverse([1,2,3])` returns `[3,2,1]`, `Quartiles` consistently uses
  the Moore-McCabe convention, and single-argument
  $\operatorname{KroneckerDelta}(0)$ returns $1$.

### Compilation

- **Compiled JavaScript, Python, GLSL, WGSL, and interval output now match the
  interpreter more closely.** Equality uses the engine tolerance, `Mod` and
  `Remainder` use consistent conventions, chained relations evaluate middle
  operands once, dynamic $0^0$ returns `NaN`, non-boolean `Which` and `When`
  conditions throw, and interval arithmetic matches interpreter conventions for
  branches, rounding, modulus, and odd roots of negative numbers.

- **Compilation fails closed when a target cannot represent an expression
  correctly.** Unsupported or unsafe cases such as invalid shader constructs,
  reserved shader variable names, non-real values in real-only target helpers,
  multi-index sums or products that a target cannot express, and invalid
  constant folds now fail at compile time instead of emitting wrong code.

- **The Python target emits valid Python for more expressions.** Conditional
  expressions, `NaN`, logical operators, chained relations, assigned symbols,
  `vars`, and target options now compile consistently with the JavaScript target
  and the interpreter.

### Additional Resolved Issues

- **Evaluation limits are honored more reliably.** Hard limits such as
  nested-exponential limits, divergent infinite sums, and very large special
  function inputs now return promptly, remain symbolic, or throw a
  `CancellationError` when `timeLimit` or the recursion limit is exceeded.
  Examples include $\lim_{x\to\infty} e^{e^{e^x}}/e^{e^{e^{x-1}}}$,
  $\Gamma(10^{300})$, $\zeta(\pm 10^{300})$, $\operatorname{Fib}(10^9)$,
  $\binom{2 \times 10^9}{10^9}$, and $\operatorname{Subfactorial}(10^6)$.

- **`simplify()` honors more of its public contract.** `simplify({rules: null})`
  now applies no rewrite rules, as documented, and logarithmic simplifications
  such as $\ln(a)/\ln(b)$ no longer reduce to an integer unless the identity can
  be verified exactly. `simplify()` also preserves exact exponents when
  combining powers, so $x \cdot x^{\sqrt2}$ becomes $x^{1+\sqrt2}$ rather than a
  decimal exponent.

- **Numeric comparison and formatting edge cases are fixed.** Two large 15-digit
  values that previously compared in the wrong order now compare correctly,
  `toPrecision(15)` no longer corrupts `999999999999999`, NaN has a
  deterministic place in canonical ordering, and high-precision `toString()`,
  `.json`, and `toFixed()` avoid long stalls on enormous exponents.

- **Substitution and collection operations are more complete.** `subs()` now
  reaches into lists and tensors, for example `Median([a,b,c]).subs({a: 1})`.
  Finite set operations such as `Intersection({1,2}, {2})` and
  `SymmetricDifference` now evaluate correctly, and `Reverse([1,2,3])` returns
  `[3,2,1]` instead of throwing.

- **Strict and non-strict validation are more predictable.** In strict mode,
  user-declared function signatures are enforced for closed arguments, numeric
  operators reject provably non-numeric operands such as `Sin("hello")`, big-op
  bounds are type-checked, and `Map([1,2,3], "nf")` is rejected. In non-strict
  mode, missing required arguments such as `Sqrt()` or `Power(2)` no longer
  crash.

- **Rule replacement is safer.** Rule guards such as $x \ne 0$ must now be
  provable before they match, wildcard conditions such as `:notzero` no longer
  assume unknowns satisfy the condition, and failed sequence-wildcard matches no
  longer drop operands from the expression being transformed.

- **Special values and combinatorics are corrected.** `Choose` and `Binomial`
  now share standard conventions, including `Choose(2,3) = 0` and negative upper
  indices such as `Binomial(-2,3) = -4`. `Argument(1+i)` evaluates to $\pi/4$,
  several `Digamma` special values simplify when the Fungrim pack is loaded, and
  integer-domain functions such as `Fibonacci(+Infinity)` and
  `MoebiusMu(Infinity)` stay symbolic instead of throwing.

- **Modular arithmetic is consistent.** `Mod` is floored everywhere, so
  `Mod(-7, 3)` returns $2$, while `Remainder` uses round-to-nearest semantics.
  Exact rational inputs stay exact, for example `Mod(\frac12, \frac13)` returns
  $\frac16$.

- **Complex and matrix products no longer lose meaning.** Multiplying a scalar
  by a complex literal such as `["Complex", 1, 1]` preserves both real and
  imaginary parts, and symbolic matrix products preserve their written order, so
  a commutator such as $MP - PM$ no longer collapses to $0$ for declared matrix
  symbols.

- **Parsing rejects or preserves ambiguous forms more reliably.** `x^2^3` is now
  a parse error instead of an unintended list power, `Sequence(1,2)` no longer
  serializes as `1 2`, parenthesized relations are treated as atomic operands
  inside larger chains, and a scalar or matrix next to a function- or
  matrix-valued symbol is parsed as multiplication rather than a tuple.

- **`0^0` and non-finite values are consistent across paths.** `evaluate()`,
  `N()`, and compiled JavaScript now agree that $0^0$ is `NaN`. Trigonometric
  poles such as `N(\cot \pi)` and `N(\csc \pi)` now return complex infinity
  rather than huge finite artifacts.

### Performance

- **LaTeX parsing is 15-28% faster.** Parsing is faster on derivative,
  polynomial, matrix, and definite-integral inputs, with the same parse results
  as before.

- **Arbitrary-precision arithmetic is substantially faster.** At 100 significant
  digits, addition, subtraction, multiplication, division, and comparison are
  now much faster than in 0.66.0, and high-precision `ln`, `exp`, `Gamma`, and
  related operations also benefit. The improvements are visible in both direct
  numeric work and symbolic operations that depend on arbitrary-precision
  arithmetic.

  **Arbitrary-precision arithmetic at 100 significant digits** (ns per
  operation, lower is better; warm median, distinct operands per call):

  | op     | **CE 0.67.0** | CE 0.66.0 |  math.js¹ | Mathematica² |
  | ------ | ------------: | --------: | --------: | -----------: |
  | `add`  |        **75** |       152 |       278 |        1,023 |
  | `sub`  |        **91** |       167 |       329 |        1,212 |
  | `mul`  |       **202** |       319 |     7,984 |        1,025 |
  | `div`  |       **501** |     1,748 |    11,890 |        1,366 |
  | `cmp`  |        **29** |       198 |        61 |          984 |
  | `sqrt` |         3,163 |     4,018 |    54,696 |    **1,055** |
  | `exp`  |         4,795 |     8,698 |   728,876 |    **1,682** |
  | `ln`   |         5,887 |    32,398 |   670,206 |    **1,353** |
  | `cos`  |         6,914 |     7,467 | 1,666,292 |    **2,059** |

  <small>¹ math.js `BigNumber` (decimal.js) at precision 100. ² Mathematica 14.3
  timed inside the kernel with result caches disabled; its ~1 µs per-call
  dispatch floor dominates its small-op rows. CE and 0.66.0 from
  `benchmarks/big-decimal/ops-results.json`; reproduce with
  `node benchmarks/big-decimal/run-ops.mjs` and
  `wolframscript -file benchmarks/big-decimal/ops-bench.wls`.</small>

  **Symbolic operations** (ms per call, lower is better; warm median, from the
  cross-library suite in `benchmarks/REPORT.md`):

  | case                    | **CE 0.67.0** | CE 0.66.0 | math.js |   SymPy | Mathematica |
  | ----------------------- | ------------: | --------: | ------: | ------: | ----------: |
  | simplify `√(3+2√2)`     |      **0.07** |      0.09 | 🟡 0.92 | 🟡 3.56 |        3.28 |
  | simplify `√6·x + √2·x`  |      **0.16** |      0.19 |    1.13 |    5.69 |        18.0 |
  | simplify `(x²−1)/(x−1)` |      **0.10** |      0.15 | 🟡 0.99 |    8.53 |        0.17 |
  | `d/dx √(1−x²)`          |          0.22 |      0.21 |    2.13 |    5.70 |   **0.008** |
  | `d/dx xˣ`               |          0.04 |      0.04 |    1.83 |    1.80 |   **0.005** |
  | `∫ x eˣ dx`             |      **0.08** |      0.09 |       — |    6.53 |        0.57 |
  | `∫ x/(x²+1) dx`         |      **0.16** |      0.18 |       — |    7.23 |        0.60 |
  | `lim sin(x)/x`          |      **0.03** |      0.04 |       — |    0.62 |        1.93 |
  | `lim (1+1/x)ˣ`          |      **0.55** |      1.13 |       — |    2.76 |        5.81 |
  | solve `x⁴+x²−1 = 0`     |          1.88 |      4.65 |       — |    8.56 |    **0.55** |
  | solve `x³−x−1 = 0`      |      **0.11** |      1.18 |       — |    5.73 |        0.23 |

  <small>🟡 = value-correct but not fully simplified. — = not supported. SymPy
  1.14 via `sympify`/`evalf` (per-call parse included, as for every string-based
  tool). All engines measured warm, per-call from source, same protocol
  (`benchmarks/REPORT.md`, "Methodology").</small>

- **Integration, assumptions, polynomial solving, and factoring are faster.**
  Rubi-backed integration spends less time on integrals it cannot solve,
  sign-related assumption queries respond faster, polynomial equations solve
  faster, and `Factor` handles common square-pattern cases more efficiently.

## 0.66.0 _2026-06-28_

### New Features

- **`Multiply` now operates on vectors and matrices.** Previously a product with
  any list/matrix operand was left unevaluated — even `2 * [1, 2, 3]`.
  `Multiply` (i.e. `*`, `\cdot`, `\times`, and implicit products) now follows
  matrix-product / scalar-scaling semantics, matching `Add`'s existing
  element-wise threading:

  - **Scalar × tensor** scales every element: `2 * [1, 2, 3]` → `[2, 4, 6]`,
    `2 * \begin{pmatrix}1&2\\3&4\end{pmatrix}` →
    `\begin{pmatrix}2&4\\6&8\end{pmatrix}` (exact values are preserved, e.g.
    `\frac12 [2, 4, 6]` → `[1, 2, 3]`).
  - **Two or more matrices/vectors** form the **matrix product**, folded
    left-to-right in the written order:
    `\begin{pmatrix}1&2\\3&4\end{pmatrix}\begin{pmatrix}5&6\\7&8\end{pmatrix}` →
    `\begin{pmatrix}19&22\\43&50\end{pmatrix}`. The product is **not**
    commutative — operand order is preserved (including for `matrix·vector` vs
    `vector·matrix`), and `vector·vector` reduces to the dot product. This
    reuses the existing `MatrixMultiply` implementation.

  Element-wise (Hadamard) multiplication of two same-shape tensors is therefore
  **not** what `*` does; tensors of incompatible dimensions are left
  unevaluated, and symbolic operands of unknown shape are unaffected.

- **Hadamard (element-wise) product `\odot`.** A new `HadamardProduct` operator,
  written `\odot`, multiplies two vectors or matrices of the same shape entry by
  entry: `[1,2,3] \odot [4,5,6]` → `[4,10,18]` and
  `\begin{pmatrix}1&2\\3&4\end{pmatrix} \odot \begin{pmatrix}5&6\\7&8\end{pmatrix}`
  → `\begin{pmatrix}5&12\\21&32\end{pmatrix}` (compare the matrix product `*`,
  which gives `\begin{pmatrix}19&22\\43&50\end{pmatrix}`). Operands of
  incompatible shape report an `incompatible-dimensions` error. It binds like
  multiplication and round-trips through LaTeX as `\odot`.

### Resolved Issues

- **Mixed chained inequalities keep their middle term.** A chain combining
  different operators — e.g. `5 \le b \lt 7` — canonicalized to
  `And(5 \le 7, b \lt 7)`, dropping `b` from the first link (so `3 \le 2 \lt 7`
  wrongly evaluated to `True`). It now canonicalizes to `And(5 \le b, b \lt 7)`.
  Uniform chains (`5 \le b \le 7`) and the already-correct `a \lt b \le c` form
  are unchanged.

- **A transcendental of an exact _constant expression_ stays symbolic.** Per the
  exactness contract, `evaluate()` of a transcendental of an exact argument
  returns a symbolic result and only `.N()` numericizes. This held for number
  literals (`sin(2)` → `sin(2)`) but not for exact constant _expressions_:
  `sin(\pi^2)` numericized to `-0.4303…` instead of staying `sin(π²)` (and
  likewise `cos(√2)`, etc.). These now stay symbolic under `evaluate()`; an
  inexact (float) argument such as `sin(2.5)` still numericizes.

- **An exact real added to the imaginary unit keeps its exact real part.**
  `\frac12 + i` evaluated to `0.5 + i`, and `\frac34\sqrt3 + i` to `1.299… + i`
  — the exact real part was floatified when folded with `i`. Exact reals
  (rationals, radicals) are now preserved alongside the imaginary unit
  (`1/2 + i`, `3/4·√3 + i`); `.N()` still numericizes, and inexact reals
  (`1.5 + i`) are unchanged.

- **Matrix/vector arithmetic preserves exact entries.** A tensor with exact
  rational or radical entries was stored with a `float64` element type, so
  element-wise operations silently produced floats — e.g.
  `\begin{pmatrix}½&⅓\end{pmatrix} + \begin{pmatrix}½&⅓\end{pmatrix}` returned
  `[1, 0.666…]` instead of `[1, ⅔]`, and a matrix of `√2` entries decayed to
  decimals. Exact entries now use the `expression` element type and stay exact;
  inexact (machine/decimal) values continue to use `float64`.

- **`A^n` is now the matrix power for an integer exponent.** A power of a matrix
  was element-wise for non-negative exponents (`A^2` squared each entry, `A^0`
  gave a matrix of ones) yet `A^{-1}` already returned the inverse, and
  `\begin{pmatrix}…\end{pmatrix}^2` did not evaluate at all. `A^n` is now the
  matrix power — repeated matrix multiplication — consistent with `*` being the
  matrix product: `A^2 = A·A`, `A^0` is the identity, `A^{-1}` the inverse, and
  `A^{-n} = (A^n)^{-1}`. A non-square base reports `expected-square-matrix`.
  (Also fixes `MatrixPower(A, n)` for `n < -1`, which previously collapsed to
  `A^{-1}`.)

- **Element-wise functions now distribute over matrix/vector-valued
  sub-expressions.** A broadcastable unary function applied to an operand that
  only becomes a collection _after_ evaluation — e.g. `\sqrt{AB}`, `\sin(AB)`,
  `|AB|` where `AB` is a matrix product — was left unevaluated, because
  broadcasting was decided from the raw (un-evaluated) operand. It now also
  broadcasts over the evaluated operand, so these distribute element-wise like
  `\sqrt{M}` on a literal matrix already did. (`Add`/`Multiply` keep their
  dedicated tensor handling.)

- **Juxtaposed matrices now form the matrix product.** Writing two matrices next
  to each other (`\begin{pmatrix}…\end{pmatrix}\begin{pmatrix}…\end{pmatrix}`),
  or a scalar next to a matrix (`2\begin{pmatrix}…\end{pmatrix}`), previously
  produced a `Tuple` instead of a product, because the `Matrix(…)` wrapper is
  not reported as an indexed collection. The invisible (implicit) operator now
  treats matrix operands as multiplication, consistent with
  `*`/`\cdot`/`\times`.

- **`Negate` (and hence `Subtract`) of a matrix-valued product is distributed
  correctly.** A negation whose operand only became a vector/matrix after
  evaluation — e.g. `Negate(Multiply(A, B))` from `A B - A B` — was left
  undistributed, so the following `Add`/`Subtract` misclassified it as a scalar
  and broadcast it over the other matrix, yielding a bogus higher-rank result.
  Matrix subtraction (e.g. the commutator `AB - BA`) now evaluates correctly.

- **A `\textcolor` wrapping a bare operator now parses as that operator.** Input
  such as `x \textcolor{red}{=} y` previously failed — the `=` could not be
  parsed as a standalone group, producing a `Tuple` around an
  `expected-closing-delimiter` error. The color command is now transparent in
  operator position, so `x \textcolor{red}{=} y` parses as `Equal(x, y)` (and
  likewise for `+`, `<`, `\le`, `\times`, …). Because MathJSON has no way to
  annotate a lone operator glyph, the operator's color is dropped; coloring an
  operand (`\textcolor{red}{y}`, `\textcolor{red}{x+1}`) is unchanged and still
  yields an `Annotated`.

- **One-sided `\left( … \right.` enclosures now parse.** `\right.` (and the
  `\bigr.`/`\Bigr.`/… variants) is a TeX _null delimiter_: a fence with no
  visible closing glyph. Previously a one-sided group such as
  `\sin\left(x\right.` was rejected, leaking the `\left` out as an
  `unexpected-command` error; it now parses the same as `\sin\left(x\right)` (→
  `Sin(x)`). The null _open_ form (`\left.…\right|`, used by `EvaluateAt`) and
  ordinary two-sided delimiters are unchanged.

- **Summation/product indices written as a `\le` range are now recognized.** An
  index set of the form `\sum_{1 \le i \le 10} i^2` (and the one-sided
  `\sum_{i \le 10}`) is now turned into the expected `Limits`, so the index `i`
  is bound by the sum instead of falling through to the imaginary unit. The
  example above now evaluates to `385` rather than staying symbolic with
  `i → Complex(0, 1)`. This mirrors the existing handling of `i \ge 1` and
  `i = 1`; strict `<` chains are not yet treated as index sets.

## 0.65.0 _2026-06-28_

### New Features

- **Differential equation solvers.** (contributed by
  [KingArth0r](https://github.com/KingArth0r)) Two new functions in the calculus
  library provide an initial slice of ordinary differential equation (ODE)
  support:

  - **`DSolve(eq, y, x)`** — symbolic solver for **first-order linear scalar**
    equations of the form `y'(x) + p(x)·y(x) = q(x)`. It returns a `List` of
    solutions, each an `Equal` expression for `y(x)`, introducing an integration
    constant `C` (a fresh name is chosen if `C` is already in use). For example,
    `DSolve(y'(x) = y(x), y, x)` → `[y(x) = C·e^x]` and
    `DSolve(y'(x) + y(x) = x, y, x)` → `[y(x) = x - 1 + C·e^{-x}]`. Nonlinear or
    higher-order equations are left unevaluated (inert).

  - **`NDSolve(eq, y, limits, y0, steps?)`** — numerical solver for **explicit
    scalar first-order** initial value problems `y'(x) = f(x, y)`, `y(x0) = y0`,
    using a fixed-step fourth-order Runge–Kutta (RK4) method. It returns a
    `List` of `[x, y]` sample pairs over the interval given by `limits` (a
    `Limits` or `Tuple` of `(x, x0, x1)`); the number of steps defaults to 100.
    It handles integrands with no elementary antiderivative (e.g. a Gaussian IVP
    whose solution is expressed with `Erf`).

  This slice is intentionally narrow so the API and result shape can get
  feedback before broader ODE support (adaptive RK45, systems, higher-order
  reductions, stiff and implicit solvers) is added.

- **`\keyword{…}` command for control-flow and logic keywords.** Keyword
  constructs — `if`/`then`/`else`, `for`/`from`/`to`/`do`, `where`, `such that`,
  `and`, `or`, `iff`, `for all`, `there exists`, `break`, `continue`, `return` —
  can now be written with a dedicated `\keyword{…}` command, for example:

  ```latex
  \keyword{if} x > 0 \keyword{then} 1 \keyword{else} 0
  ```

  Unlike `\text{…}`, `\keyword{…}` keeps the input in math mode, and unlike
  `\operatorname{…}` it is rendered with symmetric keyword spacing. The existing
  `\text{…}` and `\operatorname{…}` spellings continue to work, and all three
  parse to the same expression. Multi-word keywords are written as a single
  token (e.g. `\keyword{for all}`). `\keyword{otherwise}` / `\keyword{else}`
  also serve as the default-branch marker inside a `cases` environment.

  A new `keywordStyle` serialization option — `"text"` (default), `"keyword"`,
  or `"operatorname"` — selects which spelling is emitted when serializing `If`,
  `Loop`, `Break`, `Continue`, and `Return` back to LaTeX. The default preserves
  the previous `\text{…}` output.

## 0.64.0 _2026-06-27_

### New Features

- **Expanded number-theory library.** A set of standard number-theoretic
  functions has been added to the `number-theory` library. Integer arguments use
  arbitrary-precision (bigint) arithmetic, and long-running cases honor the
  evaluation deadline.

  _Factorization & divisors:_

  - **`FactorInteger(n)`** — prime factorization as a list of
    `[prime, exponent]` tuples ordered by ascending prime: `FactorInteger(360)`
    → `[(2, 3), (3, 2), (5, 1)]`. Following Mathematica's conventions,
    `FactorInteger(0)` → `[(0, 1)]`, `FactorInteger(1)` → `[(1, 1)]`, and a
    negative integer carries its sign in a leading `[-1, 1]` tuple.
  - **`PrimeFactors(n)`** — the sorted distinct prime factors:
    `PrimeFactors(360)` → `[2, 3, 5]`.
  - **`Divisors(n)`** — the sorted positive divisors: `Divisors(12)` →
    `[1, 2, 3, 4, 6, 12]`. `Divisors(0)` is left unevaluated.
  - **`Radical(n)`** — the square-free kernel (product of distinct primes):
    `Radical(360)` → `30`.
  - **`PrimeNu(n)`** / **`PrimeOmega(n)`** — the number of prime factors without
    / with multiplicity (ω and Ω).
  - **`MoebiusMu(n)`** — the Möbius function μ(n).
  - **`DivisorSigma(k, n)`** — the divisor function σ_k(n) (generalizes the
    existing `Sigma0`/`Sigma1`).
  - **`IsSquareFree(n)`** — whether `n` is square-free.
  - **`IsPerfectPower(n)`** — whether `n = a^b` for integers `a`, `b ≥ 2`.

  _Primes:_

  - **`NthPrime(n)`** — the nth prime (1-based): `NthPrime(10)` → 29.
    (Mathematica names this `Prime`, but in the Compute Engine `Prime` denotes
    derivative notation, so the prime-number function is `NthPrime`.)
  - **`NextPrime(n)`** / **`NextPrime(n, k)`** — the smallest prime greater than
    `n`; with `k`, the kth prime after `n` (or the |k|th before it when
    `k < 0`).
  - **`PrimePi(n)`** — the prime-counting function π(n): `PrimePi(10)` → 4.
  - **`RandomPrime(n)`** / **`RandomPrime(m, n)`** — a random prime in the
    range.

    Primality for these uses exact 6k±1 trial division for small `n` and
    switches to Miller–Rabin above 2³² (deterministic for the supported range),
    so `NextPrime` and `RandomPrime` are fast even for very large arguments.

  _Modular arithmetic & GCD:_

  - **`PowerMod(a, b, m)`** — modular exponentiation `a^b mod m`; a negative `b`
    uses the modular inverse (undefined when `a` and `m` are not coprime).
  - **`ExtendedGCD(a, b)`** — the GCD with Bézout coefficients, as `(g, x, y)`.
  - **`ChineseRemainder(residues, moduli)`** — solves a system of simultaneous
    congruences (moduli need not be coprime).
  - **`MultiplicativeOrder(a, n)`** — the order of `a` modulo `n`;
    **`PrimitiveRoot(n)`** — the smallest primitive root mod `n`.
  - **`JacobiSymbol(a, n)`** / **`LegendreSymbol(a, p)`** — the Jacobi and
    Legendre symbols.

  _Other primitives:_

  - **`IntegerSqrt(n)`** — the integer (floor) square root.
  - **`CarmichaelLambda(n)`** — the reduced totient λ(n).
  - **`LucasL(n)`** — the nth Lucas number; **`CatalanNumber(n)`** — the nth
    Catalan number.
  - **`BernoulliB(n)`** — the nth Bernoulli number as an exact rational, with
    the convention B₁ = -1/2.
  - **`ContinuedFraction(x, n?)`** / **`FromContinuedFraction(list)`** — the
    continued-fraction expansion of a number (exact for rationals) and its
    inverse.
  - **`IntegerDigits(n, base?, length?)`** / **`FromDigits(list, base?)`** — the
    digits of `n` in a given base, and its inverse.
    **`DigitCount(n, base?, digit?)`** — digit-occurrence counts;
    **`DigitSum(n, base?)`** — the digit sum.

- **`IsPrime` is now reliable for large integers.** Primality was previously
  left unevaluated above ~10¹⁵ and could silently round integers beyond 2⁵³ to a
  wrong machine value. `IsPrime` (and `IsComposite`) now route through a single
  deterministic Miller–Rabin implementation shared with the number-theory
  library, so e.g. `IsPrime(2^61 - 1)` correctly returns `True`. (The previous
  duplicate Miller–Rabin code, which used random bases and overflowed for large
  inputs, has been removed.) Relatedly, the internal `toInteger` helper now
  returns `null` instead of a precision-lost value for integers beyond the
  safe-integer range, so this class of silent-rounding bug cannot recur in the
  operators that use it for counts and indices.

- **`Factorial2`, `Subfactorial`, and `BellNumber` no longer round a non-integer
  argument.** These are defined only on integers; in non-strict mode they
  previously rounded a non-integer (e.g. `Factorial2(5.5)` returned `6!!`). They
  now stay symbolic for non-integer arguments. (In strict mode the `(integer)`
  signature already rejected such inputs.)

- **`N(expr, precision)` evaluates to a requested number of significant
  digits.** The `N` function (and the `["N", expr]` MathJSON form) now accepts
  an optional precision argument: `["N", "Pi", 50]` returns π to 50 significant
  digits. When the requested precision exceeds the engine's working precision,
  the working precision is raised to match — and kept, since display precision
  is a global setting. When it is at or below the working precision, the result
  is rounded to that many significant digits without changing the global
  precision (`N(1/3, 4)` → `0.3333`).

- **New linear-algebra operators.**
  - **`Dot(a, b)`** — vector inner product / matrix product (Mathematica's `.`):
    `Dot([1,2,3], [4,5,6])` → `32`.
  - **`Cross(a, b)`** — cross product of two 3-vectors.
  - **`MatrixRank(m)`** — the rank (number of linearly independent rows/columns)
    via the rank–nullity theorem.
  - **`MatrixPower(m, n)`** — a square matrix raised to an integer power (the
    repeated matrix product `A·A·…`, with negative powers using the inverse).
    Distinct from `["Power", m, n]`, which threads element-wise.
  - **`CharacteristicPolynomial(m, x?)`** — the monic characteristic polynomial
    `det(x·I − A)` (variable defaults to `x`): `[[1,2],[3,4]]` → `x² − 5x − 2`.
  - **`RowReduce(m)`** — the reduced row echelon form (RREF) of a matrix.
  - **`IsSymmetric(m)`** / **`IsDiagonal(m)`** / **`IsSquareMatrix(m)`** —
    matrix-shape predicates returning `True`/`False`.

### Resolved Issues

- **`["N", expr]` now numerically evaluates its operand.** The `N` operator
  holds its argument unevaluated and previously called `.N()` on the still
  unbound operand — a no-op for symbolic constants — so `["N", "Pi"]` returned
  `Pi` unchanged (and `["N", ["Sqrt", 2]]` returned `Sqrt(2)`) instead of a
  numeric value. The operand is now bound before evaluation, making
  `["N", expr]` equivalent to `expr.N()`.

## 0.63.0 _2026-06-26_

### New Features

- **LaTeX parse errors carry their source location.** (contributed by
  [zojize](https://github.com/zojize)) The `Error` expressions produced by the
  LaTeX parser now include a `sourceOffsets: [start, end]` character range
  identifying where in the input the error occurred, so a consumer can map a
  parse error back to the offending span — e.g. to highlight an invalid token in
  a mathfield. Offsets are zero-based and end-exclusive into the serialized
  LaTeX (`tokensToString`); for input that round-trips through the tokenizer
  unchanged — editor-generated LaTeX, with no comments, Unicode normalization,
  or macro expansion — they match the original input string. Missing-operand
  errors (an empty `\sqrt{}` or `\frac{}{}`) use a zero-width range at the
  position where the token was expected. The new
  `Parser.sourceOffsets(startToken, endToken?)` helper lets custom dictionary
  entries attach a range to errors they raise. The raw parser output
  (`LatexSyntax().parse()`) always carries these offsets, so an `Error` node is
  now emitted in object form (`{ fn: ["Error", …], sourceOffsets }`) rather than
  the bare `["Error", …]` array whenever a range is available — a consumer
  matching `expr[0] === "Error"` should also handle `expr.fn?.[0] === "Error"`.
  Through the boxed path (`ce.parse(latex).toMathJson()`), source offsets are
  opt-in metadata like `latex` and `wikidata`: included with
  `metadata: ['sourceOffsets']` or `metadata: 'all'`, and omitted from the
  default serialization.

- **Long numerators over a single power serialize with an inline solidus.** When
  prettifying, a large numerator divided by a single power of a small base now
  serializes as `(3x^4+2x^3+x+5)/x^{23}` instead of the tall, lopsided fraction
  `\frac{3x^4+2x^3+x+5}{x^{23}}`. This rounds out the existing prettify
  heuristics, which already factor a small denominator out of a large numerator
  (`\frac{1}{x}(…)`) and write a small numerator over a large denominator with a
  negative exponent (`(a)(…)^{-1}`). The new form applies when the numerator is
  large and the denominator is a single power of a small base — `base^{k}` with
  an integer exponent `k ≥ 2` (`/x^{23}`), a square (`/x^2`), or a square root
  (`/\sqrt{x}`). Lone powers (`\frac{1}{x^{23}}`), products in the denominator
  (`a·x^n`), compound bases (`(x+1)^{23}`), and all other shapes are unchanged.
  As with the other rewrites, it is disabled by `prettify: false`.

- **Double-quoted string literals in LaTeX.** `"hello"` now parses to a string
  (previously `"` was an `unexpected-token`). Content is read verbatim up to the
  closing quote, with LaTeX commands normalized to Unicode like `\text{…}`
  (`"\alpha"` → `α`); there is no escaping (use `\text{…}` for a string that
  must contain a `"`). Strings still serialize back to `\text{…}`. A `"` inside
  `\unicode{…}`/`\char` remains a hex prefix and is unaffected.

- **Dictionary values can be read by key with `At`.** `["At", dict, "key"]`
  (string key) now returns the value of that entry in a dictionary — e.g.
  `["At", { dict: { height: 42 } }, "height"]` → `42`. A missing key yields
  `Nothing`. Previously `At` was restricted to _indexed_ (positional)
  collections and rejected dictionaries with an `incompatible-type` error; its
  value type is now `indexed_collection | dictionary`. In LaTeX, the postfix
  bracket form accepts a string key, so `\mathrm{data}["height"]` (or
  `\mathrm{data}[\text{height}]`) parses to `["At", "data", "height"]`.
  Dot-notation also works when the base is a symbol declared as a dictionary:
  `\mathrm{data}.height` → `["At", "data", "height"]` (the key is an alphabetic,
  space-free name; for a dictionary base, `.x` / `.real` are key lookups, not
  `First` / `Real` component access). Positional indexing of indexed collections
  is unchanged.

- **`BoxedExpression.referencedFunctions` and `BoxedExpression.references`.**
  Two accessors aimed at dependency graphs (e.g. notebooks). The operator head
  of a function application — the `f` in `f(x)` or `g(x) := f(x) + 1` — is not a
  symbol of the expression, so it appears in neither `symbols` nor
  `freeVariables`; `referencedFunctions` recovers those applied user-function
  names (excluding built-in operators, constants, and names bound by an
  enclosing scope, using the same predicate `freeVariables` applies to ordinary
  symbols). `references` is the complete in-edge set — `freeVariables` ∪
  `referencedFunctions`, minus `defines` — so it pairs with `defines` (the
  out-edges) to build a use/def graph in one call. Subtracting `defines` drops
  self-references, so a recursive `g(x) := g(x - 1)` reports no dependency on
  itself.

- **`ce.declare()` refines an auto-declared binding instead of throwing.**
  Parsing auto-declares the names it encounters (a free variable `a` in `a + 1`,
  a called function `f` in `f(x)`), recording an _inferred_ binding. Calling
  `ce.declare(name, …)` for such a name now refines that inferred binding rather
  than throwing `"… already declared in this scope"` — which is exactly what the
  `inferred` flag is for. This lets a declare-first workflow parse cells to
  discover names and then declare them on the **same** engine. Re-declaring an
  _explicit_ binding still throws, and a name bound to a value (e.g. a function
  argument) is still a genuine conflict.

### Resolved Issues

- **`canonical` and `structural` options are now honored by `parse()`, `expr()`,
  and `function()`.** These methods only consulted the `form` option when
  deciding how to box their result, so the documented `canonical` / `structural`
  shortcuts were silently ignored: `ce.parse(latex, { canonical: false })`
  returned a _canonical_ expression (and, as a side effect of canonicalization,
  auto-declared its symbols), and
  `ce.function('Power', ops, { structural: true })` returned canonical `Root`
  instead of a structural `Power`. The keys now resolve the same way `form`
  does, with an explicit `form` taking precedence. As part of this,
  `ce.assume()` now canonicalizes its predicate so the assumption machinery
  always sees a normalized form (e.g. `Negate(ImaginaryUnit)` folded to the
  complex literal `-i`) regardless of how the caller boxed it.

## 0.62.1 _2026-06-22_

### New Features

- **`indexStyle` serialization option for collection indexing.** The `At`
  operator (e.g. `["At", v, 1]`) can now be serialized either as a subscript
  (`v_1`, `M_{i,j}`) or with programming-style brackets (`v[1]`, `M[i,j]`). Like
  the other style options (`fractionStyle`, `rootStyle`, …) it is a callback
  `(expr, level) => 'subscript' | 'bracket'`, settable engine-wide via
  `ce.latexOptions.indexStyle` or per-call via `expr.toLatex({ indexStyle })`.
  The default is `'subscript'`.

### Resolved Issues

- **Collection indexing (`At`) now serializes to valid, round-tripping LaTeX.**
  `["At", v, 1]` previously serialized to `\lbrack v, 1\rbrack` — i.e. the
  _list_ `[v, 1]`, which re-parsed as `["List", v, 1]`, silently changing the
  meaning on a serialize→parse cycle. It now serializes as `v_1` (or `v[1]` with
  `indexStyle: 'bracket'`), both of which parse back to `At`.

- **Accents and decorations serialize with brace notation and round-trip.**
  `OverHat`, `OverVector`, `OverTilde`, `OverBar`, `UnderBar`, the over-arrows,
  `OverBrace`, etc. had no serializer and fell back to function-call notation —
  `\hat{x}` came back out as `\hat(x)`, which re-parsed to
  `["Multiply", x, ["OverHat"]]` instead of `["OverHat", x]`. They now serialize
  as `\hat{x}`, `\vec{v}`, `\overline{x}`, … and round-trip correctly, including
  when subscripted (`\hat{x}_0`).

- **Subscripted single-letter symbols serialize with an italic base instead of
  an upright one.** When a symbol name carried a subscript (e.g. `a_1`, `x_n`,
  `S_t`), the serializer chose its font style from the _decorated_ string rather
  than the base: the subscript inflated the token count, so the multi-character
  rule wrapped the whole thing in `\mathrm{…}` and rendered the base letter
  upright (`\mathrm{a_1}`). A single-letter variable with a subscript is now
  rendered italic, as a variable should be — `a_1` serializes to `a_1`, not
  `\mathrm{a_1}`. The font style is now decided from the base alone:
  multi-letter bases are still upright with the wrapper enclosing the whole
  symbol, so descriptive subscripts stay roman
  (`speed_max → \mathrm{speed_{max}}`), and explicit style modifiers (`\mathbf`,
  `\mathbb`, …) are unchanged. Greek single-letter bases are likewise rendered
  with their default (italic) style.

## 0.62.0 _2026-06-20_

### Resolved Issues

- **Arbitrary-precision sums of three or more terms no longer collapse to
  machine precision.** `BigNumericValue.add` had a fast path that, when adding
  to a zero value, cloned the other operand through a constructor that reads its
  **machine** real part (`decimal.toNumber()`), silently truncating a
  full-precision bignum to ~16 significant digits. The exact (rational/radical)
  arithmetic path was unaffected, and two-term sums were unaffected, so this
  only surfaced when summing **three or more inexact values** at a precision
  above machine: `ExactNumericValue.sum` folds those starting from a zero
  accumulator, and the very first `0 + xᵢ` step lost all extra precision. The
  degradation was invisible when the terms were of similar magnitude (the result
  was merely capped at ~16 digits), but became a wrong answer under cancellation
  — e.g. numerically evaluating a high-order symbolic derivative at a point
  (large factorial-scale terms cancelling to a small value) returned garbage at
  any working precision. The zero-accumulator path now reads the full-precision
  real part, matching the non-zero path. Coefficients were always computed
  exactly; only the final numeric summation was affected.

- **High-order derivatives are reduced instead of blowing up.** The `Derivative`
  operator applies the differentiation rules iteratively, and the quotient and
  product rules square the denominator at each step, so the r-th derivative of a
  quotient carried an `x^(2ʳ)`-scale denominator — e.g. the 75th derivative of
  `sin(x)/x` came back over `x^(2⁷⁵)`. The result was mathematically exact (the
  integer coefficients are computed exactly), but the enormous exponent made it
  unusable and overflowed to `NaN` when evaluated at a point. `Derivative` of
  order ≥ 2 now runs a single simplification at the end, cancelling the common
  factors back to a linear-degree denominator (`x^(2⁷⁵) → x⁷⁶`). It is applied
  once, not per step, so it is cheap (~30 ms at order 75) and leaves first
  derivatives and the existing low-order results unchanged.

- **`interval-glsl` is now outward-rounded, making it a sound standalone
  exclusion oracle in `float32` (preview).** As shipped in 0.61.0 the `_iv_*`
  ops clamped to the sentinel range but rounded to nearest, so an operation — or
  the cell box itself — could come back slightly **narrower** than the true
  range. At a boundary that is enough to flip the exclusion verdict for a box
  the curve only grazes (e.g. the unit circle's tangent corner at `(1, 0)`),
  violating the containment contract that the GLSL interval must _contain_ the
  `interval-js` (float64) result — a spuriously narrow interval can exclude a
  box the curve actually passes through. Every inexact operation now widens its
  result outward (`lo` toward −∞, `hi` toward +∞) before the clamp: by ~1 ulp
  for the correctly-rounded ops (`+ − ×`, `Square`), and by a larger relative
  margin for the GLSL ES built-ins that are not correctly rounded — 8 ulp for
  `/`, `Sqrt`, `Exp`/`Ln`/`Log`, and inverse trigonometry, and 32 ulp for
  `Power` (`x^n` with `n ≥ 3`, and fractional powers such as the astroid
  `x^{2/3}`). Crucially, the cell box that `compileExclusionShader`'s `main()`
  builds is itself outward-rounded (via the new `_iv_widen_box`): the float32
  `mix` that constructs it rounds to nearest and is the actual source of the
  grazing miss, which per-op widening alone cannot fix (with exact endpoints the
  op chain is exact). That box pad is scaled to the **domain extent**, not the
  edge value, since that is what bounds the `mix` error — a value-relative pad
  would vanish for a box edge near 0 in a wide domain. Widening only ever moves
  a bound outward, so it cannot break soundness; the `empty` (`lo > hi`) /
  `entire` (`±IV_INF`) encodings, the finite `IV_INF` sentinel, the per-op
  clamp, and exact empty-propagation are all preserved. `Sin`/`Cos` remain
  best-effort (see below).

- **`freeVariables` / `unknowns` no longer report the bound variables of
  `Function` literals and integrals.** A function literal leaked its own
  parameters, and `Integrate` / `Limit` leaked their variable — e.g.
  `freeVariables` of `f(x) := x^2 + b` wrongly included the parameter `x`, and a
  definite integral leaked its integration variable. They now return only
  genuinely free symbols (`[b, f]` for that definition, `[]` for `∫ sin(x) dx`),
  while a free coefficient is still reported (`∫ a·sin(x) dx → [a]`). `Sum` /
  `Product` were already correct, and `symbols` is unchanged (it still includes
  bound variables). This is a behavior change for code that relied on the
  previous, over-inclusive result.

- **Runaway user-function recursion now throws a catchable `CancellationError`
  instead of a native `RangeError`.** A recursive definition with no reachable
  base case (e.g. `f(x) := f(x-1) + 1`) previously overflowed the JavaScript
  call stack with an uninformative `RangeError`. `recursionLimit` — previously
  defined but never enforced — is now applied to user-function application:
  exceeding it throws a `CancellationError` with
  `cause: 'recursion-depth-exceeded'`, consistent with how `timeLimit` and
  `iterationLimit` are surfaced. The default `recursionLimit` is now **256**
  (was a nominal, unenforced 1024), chosen to fire below the native stack limit
  on typical engines; raise `ce.recursionLimit` for legitimately deep recursion.
  Iterating a user function (e.g. `\sum f(i)`) is **not** counted as recursion.
  (A sufficiently complex single call can still exceed the native stack before
  the limit is reached, so a robust caller catches `RangeError` as a backstop.)

- **`Integrate` binds only the integration variable in its canonical
  integrand.** `∫ a·sin(x) dx` previously canonicalized to
  `Integrate(Function(body, a, x), …)`, listing the free coefficient `a` as a
  spurious integrand parameter; it is now `Integrate(Function(body, x), …)`.
  Introspecting the integrand (`expr.op1`) therefore reports `a` as free, and
  the integrand is a proper single-variable function. Evaluation is unchanged.

- **Nested (multivariate) integrals now parse and evaluate correctly.**
  `\int_1^2\int_3^4 x y \, dx \, dy` previously attached _all_ the trailing
  differentials to the innermost integral, leaving the outer integrals with a
  `Nothing` integration variable — so the expression could not evaluate. Each
  `\int` now consumes only its own differential (the innermost `dx` pairs with
  the innermost `\int`, the next `dy` with the next), producing a properly
  nested `Integrate` where every level carries its own variable and limits
  (`\iint` / `\iiint` still bind 2 / 3 variables at one level). Combined with
  the definite-integral evaluator now applying the limits to a _parametric_
  antiderivative (e.g. `∫_3^4 k·x dx → 7/2·k`; the symbolic `f(b) - f(a)` was
  previously left as an unevaluated `EvaluateAt`), nested definite integrals
  evaluate to a value: `∫_1^2∫_3^4 x·y dx dy → 21/4`.

- **Multiple-integral and contour-integral serialization round-trips.** `\iint`
  / `\iiint` (and `\oiint` / `\oiiint`) now serialize back to the compact sign
  with a single region subscript (`\iint_{D}\!…`) instead of a stack of `\int`s,
  so a flat multiple integral round-trips to the same structure. A separate
  long-standing bug that emitted the literal text `\ointundefined` for any
  `\oint` with a region (its limit is a 3-element `Tuple`, serialized to
  MathJSON as `Triple`, which the serializer did not recognize) is also fixed:
  `\oint_V f(s)\,ds` now serializes as `\oint_{V}\!f(s)\, \mathrm{d}s`.

- **`1^x` simplifies to `1` for any finite exponent.** A symbolic or function
  exponent (e.g. `1^{n+1}`, `1^{\sin x}`) previously left `Power(1, x)`
  un-reduced because the canonicalizer bailed before its base-1 rule. `1^x → 1`
  now (matching SymPy / Mathematica); only a genuinely infinite or NaN exponent
  stays indeterminate (`1^∞ → NaN`, unchanged).

### New Features

- **`interval-glsl`: public outward-rounding helpers and an opt-in absolute trig
  pad (preview).** The widen helpers `_iv_widen` / `_iv_widen_t` /
  `_iv_widen_pow` / `_iv_widen_sc` / `_iv_widen_box`, and their epsilons
  `IV_EPS` / `IV_EPS_FN` / `IV_EPS_POW` / `IV_BOX_EPS`, are a stable, public
  part of the emitted preamble: a renderer that builds its own cell box (instead
  of using `compileExclusionShader`) outward-rounds it by calling
  `_iv_widen_box(vec2(lo, hi), extent)` per axis, where `extent` is the domain
  extent for that axis (the box pad is domain-scaled, not value-relative). The
  preamble is now emitted for any expression with free variables (not only ones
  that reference an `_iv_*` op), so those helpers are always available — e.g.
  for an axis line `f = x`. GLSL ES `Sin`/`Cos` carry an _absolute_,
  implementation-defined error (≈2⁻¹¹ in the worst case; macOS ANGLE→Metal
  differs) that no relative pad can cover. A new `trigAbsPad` option (default
  `0`, off) on `compile()`, `IntervalGLSLTarget.compileExclusionShader()`, and
  the new `IntervalGLSLTarget.getPreamble()` adds an absolute `Sin`/`Cos` pad,
  so a trigonometric implicit curve can be a strictly-sound standalone oracle at
  the cost of fatter trig intervals.

- **`BoxedExpression.defines`.** A new accessor returning the symbols an
  expression _defines_: the target of a top-level `Assign` / `Declare` (`a` in
  `a := 3`, `f` in `f(x) := …`), recursing through `Block`. It complements
  `freeVariables` (the symbols an expression _references_) — together they let
  tooling build a definition/use dependency graph, with
  `references = freeVariables` minus `defines`.

- **`ComputeEngine.appliedNonFunctions(latex)`.** Returns the symbols written in
  function-application syntax `f(…)` in `latex` that are **not** functions in
  the current scope, and so parse as implicit multiplication (`f·x`) or are left
  unresolved. The check is scope-aware (a symbol declared as a function is not
  reported) and has no side effects. Useful for flagging a likely call to an
  undefined function — e.g. warning that `f(x)` was read as `f·x`.

## 0.61.0 _2026-06-17_

### New Features

- **`interval-glsl` compilation target (preview).** A GPU compilation target
  that evaluates an expression with **interval arithmetic** in GLSL — each value
  is a `vec2 (lo, hi)` — so a robust implicit-curve renderer can run its
  per-cell exclusion test (`lo > 0 || hi < 0`) on the GPU instead of CPU-side
  via `interval-js`. (Reinstates the `interval-glsl` target removed in 0.52,
  with a simpler `vec2`-only representation — the GPU acts as an exclusion
  oracle and the CPU keeps curve extraction — instead of the former status-flag
  struct.) `compile(expr, { to: 'interval-glsl' })` emits `_iv_*` helper calls
  plus a preamble library. Coverage: arithmetic, integer and positive rational
  powers, `Abs`, `Sqrt`, `Exp`, `Ln`/`Log`/`Lb`, trigonometry / inverse
  trigonometry (`Sin`, `Cos`, `Tan`, `Arcsin`, `Arccos`, `Arctan`, with interval
  range reduction), and the step / rounding family (`Floor`, `Ceil`, `Round`,
  `Truncate`, `Fract`, `Sign`, `Heaviside`, `Mod`, `Min`, `Max`) — covering
  polynomial, rational, algebraic, trigonometric, and lattice/periodic implicit
  curves (conics, lemniscate, astroid, superellipse, trig lattices, floor/mod
  grids, …). Jump-discontinuity functions return a tight, sound value-range
  enclosure (so cells can still be excluded), with discontinuity classification
  left to the CPU; only genuine poles widen to the full range. A head that is
  not yet supported (e.g. hyperbolic functions) is reported in the result's
  `unsupported` field, so a caller can fall back to another target
  per-expression. Values use a finite ±∞ sentinel and a `lo > hi` encoding for
  the empty (domain-undefined) interval, propagated through every operation;
  domain-restricted functions (`sqrt`/`ln`/`asin`/rational `pow` of an
  out-of-domain argument) yield `empty`, and a pole (zero-spanning denominator,
  `tan` asymptote) yields the full range. Parity with the `interval-js` target
  is verified against a shared corpus.
  `IntervalGLSLTarget.compileExclusionShader()` emits a complete, self-contained
  fragment shader (preamble + an `_implicit` interval evaluator + a reference
  `main` that derives each fragment's cell box and applies the exclusion test)
  ready to drop into a WebGL2 renderer.

### Resolved Issues

- **A function parameter now shadows a same-named constant.** A parameter named
  like a constant (`i`, `e`, `Pi`/`\pi`, …) was rewritten to the constant while
  the function body was canonicalized, so the binding was lost — `λi. 2i`
  applied to `5` returned `2i` (the imaginary unit doubled) instead of `10`.
  Parameters now shadow whatever their name means in the enclosing scope — a
  constant, an assigned variable, or nothing — which is standard lexical
  scoping. A free symbol that is _not_ a parameter is unchanged (`i` outside a
  parameter is still the imaginary unit), and closure capture is preserved
  (`λi. λz. (z + i)` captures `i` correctly).

- **`compile()` no longer emits a dangling reference to a symbol that has an
  assigned value (GLSL, WGSL, JavaScript, and interval-JS targets).** When an
  expression referenced a symbol with an assigned value in the engine
  (`ce.assign("a", 1.5)`), `compile()` emitted a bare `a` — an undeclared GLSL
  identifier (a shader that silently fails to compile) or a bare JS global (a
  `ReferenceError` when the compiled function is called) — even though the
  symbol is omitted from `expr.unknowns` and folded by `evaluate()`. The value
  is now folded into the generated code (`sin(a·x)` → `sin(1.5 * x)`), making
  `compile()`, `evaluate()`, and `unknowns` consistent. This also folds
  user-declared constants (`ce.declare("c", { value: 3 })`), and applies on the
  direct-target `compile(expr, { target })` path as well. A symbol supplied
  through the `compile()` `vars` option is never folded — the mapping always
  wins, so a per-frame GLSL uniform / JS argument keeps updating the result
  without recompiling — and a genuinely free symbol is unchanged.

- **`compile()` folds a _symbolic_ assigned value correctly, parenthesizing it
  and resolving the free symbols it references.** When a symbol was assigned an
  expression rather than a number (`ce.assign("b", ce.parse("c + 1"))`), folding
  `b` into a larger expression had two bugs: the compound value was spliced in
  without parentheses, so `b · x` compiled to `c + 1 * x` (i.e. `c + x`) instead
  of `(c + 1) * x` — a **silently wrong result** (`2·b` → `2 * c + 1`, `b²` →
  `(c + 1 * c + 1)`); and the inner free symbol `c`, hidden behind `b`'s value
  and therefore absent from `expr.unknowns`, was emitted as a bare global
  (`ReferenceError` on the JS target). The folded value is now parenthesized for
  its context, and a free symbol reachable only through a folded value routes
  through the normal free-symbol plumbing (`_.c` on the JS / interval-JS
  targets; a uniform on GPU) and is reported in the result's `freeSymbols`.

- **GPU compilation rejects non-finite numbers instead of emitting a
  non-compilable shader.** GLSL and WGSL have no infinity or NaN literals, but
  `compile()` emitted `Infinity.0` / `NaN.0` for a `±∞` or `NaN` value (e.g.
  from a literal `\infty` or a constant-folded `1/0`) and reported
  `success: true` — a shader that silently fails to compile on the GPU. Such
  values now throw a clear error from the GLSL/WGSL targets (so the free
  `compile()` falls back to `success: false` with a diagnostic), consistent with
  how other GPU-unsupported constructs are handled. The JavaScript target is
  unchanged (`Infinity` / `NaN` are valid there).

- **The JavaScript compilation target now lowers the exponential, trigonometric,
  and logarithmic integrals.** `SinIntegral` (Si), `CosIntegral` (Ci),
  `ExpIntegralEi` (Ei), and `LogIntegral` (li) compile to `_SYS` runtime
  helpers, matching the existing support for `Erf`, `FresnelS`, `Gamma`,
  `BesselJ`, etc. These are the closed forms the antiderivative engine emits
  (e.g. `∫ sin x / x dx = SinIntegral(x)`), so an "evaluate then compile"
  pipeline — such as plotting `∫ f dx` from its closed form — no longer throws
  `Unknown operator` and falls back to numeric sampling. (GLSL/WGSL shader
  approximations of these are not yet provided.)

- **The JavaScript compilation target now lowers the elliptic, AGM, and
  hypergeometric kernels.** `AGM`, `EllipticK`, `EllipticE`, `EllipticF`,
  `EllipticPi`, `Hypergeometric2F1`, `Hypergeometric1F1`, `Erfi`, and `Choose`
  compile to `_SYS` runtime helpers. Like the integral functions above, these
  are closed forms `evaluate()`/`.N()` produces (e.g. a pendulum period or an
  arc length reduces to an elliptic integral), so they can now be plotted from
  the closed form rather than re-sampled numerically. `EllipticE` and
  `EllipticPi` keep their arity-overloaded complete/incomplete forms, and `AGM`
  accepts the one-argument `AGM(z) = AGM(1, z)` shorthand. (Real-valued like the
  other special functions on this target; GLSL/WGSL not provided.)

### Improvements

- **`compile()` results now report their external references.** A
  `CompilationResult` carries two new fields so a caller can check that a result
  is self-contained _declaratively_, instead of executing or GPU-compiling the
  code to discover a dangling reference:

  - `freeSymbols` — the identifiers the generated code references that the
    caller must supply at run time (JS vars-object keys / GLSL uniforms). These
    are the free symbols _as codegen sees them_: assigned values and constants
    are folded out, bound variables (lambda parameters, `Sum`/`Product`/
    `Integrate`/`Loop` indices, `Block` locals) are excluded, and `vars`-mapped
    symbols are always included. Unlike `expr.unknowns`, it also surfaces a free
    symbol reachable only through a folded value (e.g. `b` assigned `c + 1`
    exposes `c`). Use it to build a uniforms / vars mapping that is guaranteed
    consistent with the emitted code.
  - `unsupported` — operator heads the target cannot lower (no operator/function
    mapping, not a structural form). On a failed `compile()` this is populated
    alongside a human-readable `error`, so an unlowerable operator (e.g.
    `SinIntegral` on the GLSL target) surfaces as `success: false` with a
    machine-readable list rather than only a thrown exception.

  Built-in targets populate `freeSymbols` (and an empty `unsupported`) on every
  successful compile. The direct `getCompilationTarget(name).compile(expr)` path
  still throws on a genuinely unsupported operator (so the engine-level
  `compile()` can fall back to interpretation); the `unsupported` / `error`
  fields are how the engine-level `compile()` reports that condition without a
  throw.

## 0.60.0 _2026-06-16_

### Behavior Changes

- **`isFinite` is now known for finite symbolic constants.** Expressions such as
  `√π`, `1/π`, and `π^π` report `expr.isFinite === true` (previously
  `undefined`), because finiteness is propagated through `Sqrt`, `Root`,
  `Power`, and `Divide` of finite operands. Cases that are genuinely
  indeterminate (e.g. `1/x` for an unconstrained `x`) still report `undefined`.

- **Exact transcendental expressions now remain symbolic under `evaluate()`.**
  For example, `ln(2)` remains `ln(2)` instead of becoming `0.693…`. Use `.N()`
  or `{ numericApproximation: true }` when a numeric approximation is wanted.
  Inexact inputs still evaluate numerically, and known exact values such as
  `cos(π) = -1` and `arctan(1) = π/4` still simplify. As a result, definite
  integrals also preserve exact results, such as `∫₁² 1/x dx = ln(2)` and
  `∫₀¹ 1/(1+x²) dx = π/4`.

- **`(aⁿ)ᵐ` no longer folds to `aⁿᵐ` based solely on an odd inner exponent.**
  This combine was unsound on the principal branch: when `a < 0` and `m` is not
  an integer, the two sides differ by a phase. For example `(x³)^{1/2}` now
  stays `√(x³)` (which is `8i` at `x = -4`) instead of becoming the inequivalent
  `x^{3/2}` (`-8i`), and it is again confluent with the `√(x³)` form. The fold
  still applies when the base is non-negative or the outer exponent is an
  integer. (Roots are unaffected: `(x³)^{1/3} = x` still holds, since odd-index
  roots use the real-root convention.)

- **Logarithms are no longer combined across a branch cut.**
  `ln(a) + ln(b) → ln(ab)` (and the `log` and subtraction variants) is only
  valid on the principal branch; for arguments on the negative real axis the two
  sides differ by a multiple of `2πi`. For example `ln(-2) + ln(-3)` no longer
  simplifies to the inequivalent `ln(6)` (its true value is `ln(6) + 2πi`). The
  combine still applies to positive and unconstrained-symbolic arguments. The
  guard consults the analytic-property store's branch-cut records (see Special
  Functions).

- **`e^{iθ}` stays in exponential form under `evaluate()` for a symbolic
  angle.** Euler's formula `e^{iθ} → cos θ + i·sin θ` is now applied only when
  `θ` is a constant that reduces to a closed form (`e^{iπ/2} = i`,
  `e^{iπ} = -1`, `e^{ln y} = y` are unchanged); for a symbolic angle, `e^{ix}`
  stays `e^{ix}` — a basis change is not an evaluation, and it no longer differs
  from the previous inconsistency where `(e^{ix})²` expanded while `e^{ix}` did
  not. Convert to trigonometric form on demand with the new strategy
  `expr.simplify({ strategy: 'trig' })`.

- **`N()` at a known pole now returns `ComplexInfinity` instead of `NaN`.** When
  a function is evaluated numerically at a pole recorded in the new
  analytic-property metadata store (see Special Functions), the result is
  `ComplexInfinity` rather than `NaN` or an unevaluated expression — for example
  `Digamma(0).N()` and `Digamma(-2).N()`. Functions whose kernels already
  returned an infinity at their poles (such as `Gamma`) are unchanged.

### Benchmarks

The numeric and symbolic gains in this release are summarized below against the
last release (`0.59.0`), SymPy, math.js, and **Mathematica** — the reference
baseline, since it is the broadest engine in the field. The tables are generated
by the harness in [`benchmarks/`](./benchmarks/)
(`node benchmarks/report_changelog.mjs`); every result is verified numerically
against an independent `mpmath` reference, never another tool. "CE 0.60.0" is
this release.

#### Numeric performance (200-digit precision)

Median time per call, in **microseconds — lower is better**. `—` means the tool
returned no usable result at that precision.

| Expression         | CE 0.60.0 | CE 0.59.0 | SymPy | math.js | Mathematica |
| ------------------ | --------: | --------: | ----: | ------: | ----------: |
| $\pi^2$            |        15 |        20 |   174 |     107 |         3.9 |
| $\sin 1$           |        25 |        61 |   220 |     429 |         5.2 |
| $\cos 1$           |        24 |        60 |   222 |     455 |         7.1 |
| $\ln 2$            |        87 |       302 |   339 |   4,374 |         3.7 |
| $e^{\pi}$          |        31 |       398 |   214 |   4,771 |         4.6 |
| $\zeta(3)$         |     3,419 |         — |   264 |       — |          49 |
| $\Gamma(\tfrac13)$ |     1,867 |   427,938 |   341 |       — |         212 |
| $\psi(\tfrac13)$   |     1,689 |   404,300 | 2,831 |       — |         169 |

Biggest gains over `0.59.0`: $\psi(\tfrac13)$ **239× faster**,
$\Gamma(\tfrac13)$ **229× faster**, $e^{\pi}$ **13× faster** (it no longer
recomputes $\ln e$ on every call), $\ln 2$ **3.5× faster**, $\sin 1$ / $\cos 1$
**~2.5× faster**. The elementary functions widen further at 1000+ digits (e.g.
$\ln 2$ ≈ 21× faster, where it now also leads SymPy and mpmath). `0.59.0` could
not reach 200 digits for $\zeta(3)$ (it was capped near machine precision);
math.js has no arbitrary-precision ζ/Γ/ψ. Mathematica's native bignum kernel is
faster still on these constants.

#### Symbolic capability & performance

Each cell is **how many times faster than Mathematica** that engine is on the
case (`Mathematica ÷ engine`, so **higher is better**; Mathematica itself is
`1×`). `—` means the engine can't do the case. Compare the **CE 0.60.0** and
**CE 0.59.0** columns to see what is _new this release_ (a `—` under `0.59.0`
next to a number under **CE 0.60.0**). The **CE + R/F** column is CE 0.60.0 with
the opt-in Rubi integrator and Fungrim identities loaded (`loadIntegrationRules`
/ `loadIdentities`), on the same minified bundle: sometimes it improves
performance, sometimes it hurts it, but the overall effect is improved coverage.

| Operation                              | CE 0.60.0 | CE + R/F | CE 0.59.0 | SymPy  | math.js | Mathematica |
| -------------------------------------- | :-------: | :------: | :-------: | :----: | :-----: | :---------: |
| **Antiderivatives**                    |           |          |           |        |         |             |
| $\int\frac{1}{\sqrt x}\,dx$            |   1.5×    |   3.7×   |     —     |  0.5×  |    —    |     1×      |
| $\int\frac{x}{\sqrt{1-x^2}}\,dx$       |   2.5×    |   2.6×   |     —     | 0.09×  |    —    |     1×      |
| $\int\frac{1}{x^3+1}\,dx$              |   2.2×    |   11×    |     —     |  0.3×  |    —    |     1×      |
| $\int\frac{\sqrt x}{1+x}\,dx$          |     —     |   3.7×   |     —     |  0.1×  |    —    |     1×      |
| $\int\frac{x}{(1+x)^{1/3}}\,dx$        |     —     |   3.9×   |     —     | 0.01×  |    —    |     1×      |
| $\int\frac{x^2}{(1+x)^{1/3}}\,dx$      |     —     |   4.1×   |     —     | 0.007× |    —    |     1×      |
| **Derivatives**                        |           |          |           |        |         |             |
| $\tfrac{d}{dx}\sqrt{1-x^2}$            |   0.01×   |  0.03×   |   0.01×   | 0.001× | 0.004×  |     1×      |
| **Simplification**                     |           |          |           |        |         |             |
| $\sqrt{3+2\sqrt2}$                     |    11×    |   20×    |     —     |   —    |    —    |     1×      |
| $\sqrt6\,x+\sqrt2\,x$                  |    28×    |   65×    |    30×    |  3.3×  |   18×   |     1×      |
| **Evaluation**                         |           |          |           |        |         |             |
| $\lim_{x\to0}\tfrac{\sin x}{x}$        |   9.2×    |   23×    |     —     |  3.1×  |    —    |     1×      |
| $\lim_{x\to\infty}(1+\tfrac1x)^x$      |   1.6×    |   1.6×   |     —     |  2.1×  |    —    |     1×      |
| $\int_1^2\tfrac1x\,dx$                 |   1996×   |  1907×   |     —     |  92×   |    —    |     1×      |
| $\int_{-\infty}^{\infty} e^{-x^2}\,dx$ |   106×    |   428×   |     —     |  2.5×  |    —    |     1×      |
| **Solving**                            |           |          |           |        |         |             |
| $x^4+x^2-1=0$                          |   0.07×   |  0.08×   |     —     | 0.06×  |    —    |     1×      |
| $x^3-x-1=0$                            |   0.08×   |   0.1×   |     —     | 0.04×  |    —    |     1×      |

Across the cases both solve, Compute Engine is a **median 3.7× faster than
Mathematica** (up to 1996×). The `—` entries under `0.59.0` show what is new
this release: limits, exact definite/improper integrals, and polynomial solving.
The bottom three antiderivative rows are integrals the base engine still leaves
unevaluated but the opt-in **Rubi** rules solve. Mathematica still leads on raw
derivative and root-finding latency (the `<1×` rows), where its native kernel is
hard to beat.

<sub>Measured 2026-06-16 · SymPy 1.14.0 · math.js 15.2.0 · Mathematica 14.3.0 ·
Node 22 · verified against `mpmath`. Reproduce:
`npm run build production && ./venv/bin/python3 benchmarks/gen_cases.py && node benchmarks/report.mjs && node benchmarks/report_changelog.mjs`.</sub>

### Calculus

- **`Limit` can now return exact symbolic results.** This includes direct
  substitution, indeterminate quotients, rational functions at infinity,
  dominant-term analysis, and exponential forms. Examples include
  `lim(x→0) sin(x)/x = 1`, `lim(x→∞) (1+1/x)^x = e`, and
  `lim(x→∞) arctan(x) = π/2`. Limits that cannot be determined reliably fall
  back to numeric evaluation or remain unevaluated. `NLimit` remains numeric.

- **Limits no longer return a wrong value at a special-function pole.** A limit
  whose expression contains a special function (`Gamma`, `Digamma`, `PolyGamma`,
  `Zeta`, …) evaluated at one of its poles — e.g. `lim(x→-1) (x+1)·Digamma(x)` —
  previously substituted the pole as a finite value and returned a confident
  wrong result (`0`). Such limits now stay unevaluated (or are recovered
  numerically where sampling allows) rather than reporting a false value.

- **Symbolic integration supports many more integrands**, including:
  - Gaussian integrals and quadratic exponentials using `Erf` and `Erfi`
  - Fresnel integrals
  - Sine, cosine, exponential, and logarithmic integrals
  - Products of polynomials, exponentials, and trigonometric functions
  - More radical and quadratic-root integrands
  - Powers of secant, cosecant, tangent, and cotangent
  - Reverse power-chain forms such as `∫ln(x)/x dx = ½ln²(x)`
  - Products with symbolic exponents that previously failed or timed out
  - Powers and radicals of a linear function, e.g. `∫√(1+x) dx`, `∫x√(1+2x) dx`,
    and `∫(a+bx)^p dx`
  - Radical powers of a polynomial via the reverse chain rule, e.g.
    `∫x√(1−x²) dx = −⅓(1−x²)^{3/2}`
  - Quotients by a sum of two square roots, e.g. `∫1/(√(a+bx)+√(c+bx)) dx`, by
    conjugate rationalization
  - Absolute value of a linear argument, e.g. `∫|x| dx = x|x|/2` and
    `∫|ax+b| dx = (ax+b)|ax+b|/(2a)` (valid for all `x`)

- **Rational-function integration is more exact and complete.** Partial
  fractions now preserve rational and radical coefficients for a wider range of
  denominators, including `x³+1`, `x⁴+1`, `x⁴-1`, and biquadratic polynomials.
  Several cases that previously returned incomplete results, floating-point
  coefficients, or no result now return exact antiderivatives.

- **More improper integrals evaluate correctly.** Exact results now include
  Gaussian, rational, and Fresnel integrals over infinite intervals. Numeric
  integration of convergent oscillatory integrals is also more reliable, while
  divergent or low-confidence cases remain unevaluated instead of returning a
  misleading finite value.

- Fixed incorrect or missing antiderivatives for `sin²(ax+b)`, `cos²(ax+b)`,
  `√x`, `1/√x`, `1/√(1-x²)`, and related forms.

- **New `Residue(f, x, a)` operator** computes the residue of `f` at `x = a`
  (the coefficient of `(x-a)⁻¹` in its Laurent expansion). It detects the pole
  order and evaluates exactly via the symbolic limit engine, e.g.
  `Residue(1/(x²-1), x, 1) → 1/2`, `Residue(eˣ/(x-1)², x, 1) → e`, and
  `Residue(cot(x), x, 0) → 1`. Residues of `Gamma`, `Digamma`, and `Zeta` at
  their poles use closed forms gated by the analytic-property store, e.g.
  `Residue(Gamma(x), x, -2) → 1/2` and `Residue(Zeta(s), s, 1) → 1` — including
  in a product or quotient with an analytic cofactor, such as
  `Residue(Gamma(x)/(x-5), x, -2) → -1/14`.

### Algebra and Solving

- **`solve` handles equations between two different inverse-trigonometric
  functions** by applying `tan` to both sides to clear them, then solving the
  resulting algebraic equation. For example `arcsin(x) = arctan(x) → 0` and
  `arccos(x) = arctan(x) → √((√5−1)/2)`. As part of this, `√(f(x)) = g(x)` with
  a non-linear right-hand side now solves too (e.g. `√(1−x²) = x²`).

- **New `Solve` operator.** `Solve(equation, unknown)` returns the list of
  solutions of an equation for an unknown, using the same solver as the
  `expr.solve()` method — for example `["Solve", ["Equal", "x^2", 1], "x"]`
  returns `["List", 1, -1]`. The equation may be an `Equal` expression or a bare
  expression read as `= 0`; the arguments are held, so the equation is no longer
  prematurely reduced to a boolean.

- **`solve` now handles general cubic, quartic, and higher-degree polynomials.**
  Exact roots are still preferred; when no supported exact form is available,
  real roots are returned as numeric approximations.

- **Absolute-value equations solve more reliably.** This includes equations such
  as `|x| = 2`, `|x-1| = 2`, non-linear arguments such as `|x²-3| = 1`, and
  equations with an absolute value on both sides.

- **`solve` handles more transcendental and substitution equations.** Equations
  with equal exponential bases reduce by their exponents
  (`e^{2-x²} = e^{-x} → -1, 2`; `2^x = 2^3 → 3`); `a·sin(x) + b·cos(x) = 0`
  solves via the tangent (`sin x = cos x → π/4`); equations that are polynomials
  in a root of the unknown solve by substitution (`2√x + 3·⁴√x = 2 → 1/16`); and
  a single square root with a non-constant coefficient is eliminated by squaring
  (`x = 1/√(x²+1)`).

- **Biquadratic and sparse-power equations return exact roots.** Polynomials
  whose exponents share a common factor — such as `x⁴ + x² − 1` — are solved by
  substituting `u = x²` (or `x³`, …), so the roots are exact radicals
  (`±√((√5−1)/2)`) instead of numeric approximations.

- **`solve` handles equations that are polynomials in a single nonlinear
  generator**, by substituting `u = g(x)` for a logarithmic, exponential,
  trigonometric, or radical generator `g`, solving for `u`, and inverting. For
  example `(ln x)² = 4 → e², e⁻²`, `e^{2x} − 3eˣ + 2 = 0 → 0, ln 2`, and
  `√(ln x) = ln√x → 1, e⁴`.

- **`solve` factors a zero product.** When an equation is a product whose
  factors each involve the unknown — such as `ln(x)·(x − 1) = 0`, or an
  already-factored `(x + 1)·cos³(3x) = 0` — its roots are the union of the roots
  of each factor.

- **`GCD` now finds common polynomial factors** for univariate and multivariate
  polynomials. Integer operands retain their existing behavior; use
  `PolynomialGCD()` when an explicit polynomial result of `1` is needed for
  coprime inputs.

- **New `Resultant(a, b, x)` operator** computes the resultant of two
  polynomials with respect to a variable (the Sylvester-matrix determinant). It
  is zero exactly when the polynomials share a common factor, e.g.
  `Resultant(x² - 1, x - 1, x) → 0` and `Resultant(x² + 1, x² - 1, x) → 4`.
  Symbolic coefficients are supported: `Resultant(x² + a, x + b, x) → a + b²`.

- **Polynomial factorization is more complete and reliable.** In particular,
  `Factor(xⁿ-1)` now returns polynomial factors without introducing
  branch-dependent radicals, and the public `factor()` function once again
  factors expressions such as `x²+5x+6`.

- **Nested radicals are simplified when possible**, for example
  `√(3+2√2) = 1+√2`.

### Special Functions

- Added numeric evaluation for:
  - Complete and incomplete elliptic integrals: `EllipticK`, `EllipticE`,
    `EllipticF`, and `EllipticPi`
  - The arithmetic-geometric mean `AGM`
  - `Hypergeometric2F1`, `Hypergeometric1F1`, and `AppellF1`
  - Jacobi theta functions and the Dedekind eta function
  - `Erfi`, `SinIntegral`, `CosIntegral`, `ExpIntegralEi`, and `LogIntegral`

- **`Gamma` now accepts a second argument, the upper incomplete gamma function**
  `Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt` (e.g. `["Gamma", s, z]`). It is evaluated
  numerically for real and complex arguments, including negative and fractional
  orders `s` (`Gamma(-4, 2)`, `Gamma(1/2, -1)`), and honors the exactness
  contract: it stays symbolic under `evaluate()` and reduces `Γ(s, 0)` to the
  ordinary `Γ(s)`. Use `.N()` for a numeric value. The one-argument `Γ(z)` is
  unchanged.

- **`Hypergeometric2F1` now supports analytic continuation across most of the
  complex plane**, rather than being limited to its defining power series.

- **`Zeta` and `Gamma` now honor the requested precision.** At high
  `ce.precision`, numeric evaluation of `Zeta`, `Gamma`, `GammaLn`, `Beta`,
  `Digamma`, `Trigamma`, and `PolyGamma` previously stalled near machine
  precision (e.g. `Zeta(3)` was correct to only ~16 digits regardless of
  precision). They now return the full requested precision — `Zeta` uses the
  Cohen–Villegas–Zagier acceleration, and all of these kernels compute with
  guard digits.

- **`EulerGamma` (γ) now honors the requested precision.** It was previously a
  fixed ~858-digit constant, so at higher `ce.precision` it silently stopped at
  ~858 correct digits (making identities such as `Digamma(1) = -γ` appear wrong
  past that point). It is now computed on demand to the full working precision.

- **`Gamma` and the polygamma family are dramatically faster at high precision**
  (~340× at 300 digits — `Gamma(1/3)` ≈1.9 s → ≈5 ms; ~130× at 1000 digits). The
  Stirling-series kernels (`Gamma`, `GammaLn`, `Digamma`, `Trigamma`,
  `PolyGamma`) were both shifting their argument just short of where the series
  converges (running far more terms than needed) and letting intermediate
  products grow in size without bound; the shift, term count, and per-step
  rounding are now chosen so the series converges quickly with bounded-size
  arithmetic. Results are unchanged to full precision.

- The Identities Library has been updated from 1,350 to 1,376 verified rules,
  including corrected Jacobi theta identities.

- **Modular and theta-function identities now discharge under `Im(τ) > 0`.** The
  upper-half-plane condition guarding these identities is expressed as the part
  inequality `Im(τ) > 0`, so they apply once you `assume(Im(τ) > 0)` (previously
  an opaque `τ ∈ HH` set membership was required). A new LaTeX shorthand,
  `\mathbb{C}^+` (also `\C^+`), denotes the open upper half-plane:
  `z \in \mathbb{C}^+` canonicalizes to `Im(z) > 0`. As a side effect three
  further identities became available — the derivative of the modular j-function
  and the θ₁/θ₂ logarithmic derivatives — recovered because the inequality form
  is verifiable where the opaque set was not.

- **`EisensteinE(s, τ)` now evaluates numerically.** The normalized Eisenstein
  series of even weight `s ≥ 2` gets a numeric kernel (Lambert-series
  q-expansion in the upper half-plane), joining `JacobiTheta`/`DedekindEta`. For
  example `EisensteinE(4, i).N()` is `1.45576…`, `EisensteinE(2, i).N()` is
  `3/π`, and `EisensteinE(6, i).N()` is `0` (an elliptic fixed point). Exact
  arguments stay symbolic under `evaluate()`; the kernel requires `Im(τ) > 0`.

- **New analytic-property metadata store.** `ce.functionProperties(name)`
  exposes per-operator analytic properties drawn from the Fungrim corpus —
  poles, zeros, branch points and cuts, residues, and holomorphic/meromorphic
  domains. For example `ce.functionProperties('Gamma')?.poles` is the set
  `NonPositiveIntegers`. Convenience accessors (`poles`, `zeros`, `branchCuts`,
  `holomorphicDomain`, …) return the unconditional record of each kind;
  parametric records (such as residues that depend on parameters) are available
  via `entries`. This also powers pole-aware `N()` (see Behavior Changes).

### Numeric Evaluation

- **Arbitrary-precision elementary and transcendental functions are
  substantially faster**, especially at hundreds or thousands of digits.
  High-precision `π` and trigonometric functions are no longer limited to about
  2,350 digits. Square root is roughly twice as fast at 1,000+ digits (a
  giant-steps integer square root), the natural logarithm switches to the faster
  arithmetic–geometric-mean method from around 700 digits (previously ~1,250),
  and a power no longer recomputes the logarithm of its base on every call — at
  1,000 digits `Exp(x).N()` is about three times faster, and a repeated base
  such as `2^x` or `10^x` about 2.8 times faster. Results are unchanged.

- Odd roots of negative real numbers now use the real-root convention, so
  `Root(-8, 3)` and `(-8)^(1/3)` evaluate to `-2`.

- **`N()` of a non-unit rational power of a negative base no longer returns
  `NaN`.** Previously only unit fractions worked (they route through
  `Sqrt`/`Root`); `(-4)^{3/2}`, `(-8)^{2/3}`, and similar fell through to
  `Math.pow(negative, non-integer) = NaN`. They now follow the same branch
  conventions as the roots above: an even denominator takes the principal
  complex value (`(-4)^{3/2} = -8i`, consistent with `Sqrt(-4) = 2i`), and an
  odd denominator the real root (`(-8)^{2/3} = 4`, `(-8)^{5/3} = -32`,
  consistent with `(-8)^{1/3} = -2`).

- **Exact `evaluate()` of a non-unit rational power of a perfect power now
  reduces.** When `x^{p/q}` has a real base and its `q`-th root is an exact
  perfect power, it reduces to an exact value (`8^{2/3} = 4`, `27^{2/3} = 9`,
  `(-8)^{5/3} = -32`), extending the unit-fraction behavior (`8^{1/3} = 2`) to
  non-unit numerators and matching `N()`. Non-perfect powers (`2^{2/3}`) and the
  negative even-root branch (`(-4)^{3/2}`, complex) stay symbolic under
  `evaluate()`.

- `N()` now fully evaluates applied functions and constants such as `e`, `i`,
  and expressions in Euler form.

- Complex equality and arbitrary-precision complex square roots are more robust
  in the presence of small rounding errors.

### Collections and Matrices

- `Take`, `Drop`, `Slice`, and `Count` now operate on matrix rows consistently.
  For example, `Count(matrix)` returns the number of rows.

- `Join` now preserves list order, duplicates, and all elements when joining
  lists. Joining sets continues to produce a deduplicated set.

- Sums and products over ranges from `-∞` to a finite bound, or from `-∞` to
  `∞`, now iterate over an appropriate finite approximation instead of an empty
  range.

### Resolved Issues

- Significant performance boost when many boxed expressions are involved in
  computations, due to improved handling of configuration changes and listener
  management.

- **Long-running evaluation is interruptible.** Collection operations,
  number-theory functions, limits, differentiation, simplification, and
  integration now respect `ce.timeLimit` more consistently. Operations that
  cannot finish in time either throw `CancellationError` or return the best
  numeric estimate available, as appropriate.

- **Fractional powers and radicals now preserve the correct principal complex
  branch.** This fixes several unsafe transformations involving negative or
  unknown-sign values, including `x/√(x²)`, negative factors under roots,
  products and quotients raised to fractional powers, and `1/√u`.

- Infinity arithmetic is more reliable for finite symbolic denominators, while
  indeterminate forms such as `∞/∞` remain indeterminate.

- Numeric limits now reject overflow, catastrophic cancellation, oscillation,
  and other low-confidence results instead of returning spurious values.

- Fixed hangs and crashes when factoring certain sums, simplifying expressions
  with radical coefficients, or mixing non-finite rational values with
  arbitrary-precision integers.

- `ce.number()` now throws a helpful error when passed a MathJSON expression
  array; use `ce.expr()` for expressions.

- Fixed incorrect simplification or evaluation of `2^i`, division by a
  floating-point zero coefficient, and several exact expressions involving
  negative radicals.

- Fixed a rational function such as `1/(x(x²+x))` wrongly simplifying (and
  integrating) to `0` when its factored denominator contained factors sharing a
  common root. The partial-fraction solver now detects the inconsistent system
  instead of returning a spurious all-zero decomposition.

- `Factor` is more complete: it now extracts a common monomial factor (e.g.
  `x³+x² → x²(x+1)`, `3x⁴+2x³ → x³(3x+2)`) and fully factors already-factored
  products and powers, so partial-fraction decomposition sees irreducible
  factors with correct multiplicities.

- Partial-fraction decomposition now uses exact arbitrary-precision integer
  arithmetic, so decompositions of higher-degree denominators no longer lose
  precision (the previous machine-integer solver overflowed past 2⁵³ and could
  return wrong coefficients).

- Rational functions with **repeated** linear or irreducible-quadratic factors
  now integrate to a closed form via full partial-fraction decomposition — e.g.
  `∫1/(x²(x+1)) dx` and `∫1/(x(1+x²)²) dx`, which previously returned an
  unevaluated integral.

- **Nested powers serialize to LaTeX and round-trip correctly.** A `Power` whose
  base is itself a `Power` — i.e. `(aᵇ)ᶜ` — was serialized as `a^{bᶜ}`, which
  re-parses as `a^(bᶜ)`, a different expression. It now serializes as `{aᵇ}^ᶜ`,
  so e.g. `(x³)^{2/5}` round-trips instead of becoming `x^{3^{2/5}}`.

- **GLSL/WGSL compilation no longer declares `int`/`i32` for a `Block`'s local
  bindings.** An integer-valued local (e.g. `["Assign", "r", 3]`) was declared
  as `int r;` while its value was emitted as a float literal (`r = 3.0;`),
  producing non-compilable shader code that also poisoned downstream float
  arithmetic. Scalar locals are now declared as `float`/`f32` — consistent with
  the always-float number literals and scalar shader math — and an explicit
  `["Declare", "r", "complex"]` type is honored. Complex locals still declare as
  `vec2`/`vec2f`.

- **`Loop` now compiles to JavaScript that returns its collected values.** A
  value loop such as `Loop(i², Element(i, Range(1, 5)))` compiled to a
  `for`-loop IIFE with no `return`, so it evaluated to `undefined` at runtime
  instead of the `[1, 4, 9, 16, 25]` the interpreter produces. The compiled loop
  now collects each iteration's value and returns the array. Imperative loops
  that mutate an outer accumulator or use `Break`/`Continue`/`Return` are
  unchanged.

- **`Integrate` now compiles to JavaScript that returns a numeric estimate.**
  For the common `\int x^2 dx` parse shape (where the integrand is a `Function`
  expression), the integrand was wrapped in a double lambda
  (`(x) => ((x) => x*x)`), so the Monte-Carlo estimator never called the inner
  function and returned `NaN`; it now compiles to a single lambda and returns
  the estimate (e.g. `∫₀¹ x² dx ≈ 0.333`). Integration bounds are also no longer
  floored, so non-integer limits such as `∫₀^0.5` integrate over the correct
  interval.

## 0.59.0 _2026-06-10_

This is a significant update to the Compute Engine.

The headline feature of this release is a large collection of curated
mathematical identities, the Identities Library:

```js
// When the Identities Library is loaded, CE can prove that...
console.log(parse("\\arctan(2-\\sqrt{3})").simplify().latex);
// ➔ "\frac{\pi}{12}"

// Declare that n is a positive integer...
ce.declare("n", "integer");
ce.assume(parse("n > 0"));

// ...and the parity identity applies:
console.log(parse("\\sin(\\pi n + \\frac{\\pi}{2})").simplify().latex);
// ➔ "(-1)^n"
```

Read more about the Identities Library in the
[dedicated guide](https://mathlive.io/compute-engine/guides/identities/).

This release also includes a large collection of performance improvements and
bug fixes across the library.

This release includes some breaking changes.

### Breaking Changes

- **`replace()` no longer eagerly canonicalizes the complete result.** The
  requested `form`, or the form produced by the rule, applies to replaced
  subexpressions. Call `.canonical` on the result to restore the previous
  behavior.

- **Fixed-size numeric collections now infer dimensioned types.** For example,
  `[1, 2, 3]` is now `vector<3>` instead of `list<number>`, and a 3×3 numeric
  collection is `matrix<3x3>`.

### Features

- **Curated mathematical identities**: the new opt-in `loadIdentities()` API
  loads over 1,300 guarded simplification rules and special values derived from
  [Fungrim](https://fungrim.org). Identities can be selected by topic, class, or
  purpose, and rules apply only when their side conditions can be proven.

  ```ts
  import { ComputeEngine } from '@cortex-js/compute-engine';
  import { loadIdentities } from '@cortex-js/compute-engine/identities';

  const ce = new ComputeEngine();
  loadIdentities(ce); // Or: loadIdentities(ce, { topics: ['gamma'] })
  ce.parse('\\Gamma(\\frac12)').simplify(); // → √π
  ```

  The loader is synchronous and idempotent per engine. Importing the identities
  subpath is required, so applications that do not use it incur no bundle cost.

  Simplifying with the full Identities Library loaded is now substantially
  faster: `simplify()` runs at roughly 1.2–1.3× the unloaded baseline
  (previously ~1.6×). The many guarded rules that share a common arithmetic head
  — `Multiply`, `Add`, `Divide`, … — are dispatched together per head instead of
  one at a time, so the per-rule overhead on every arithmetic node is paid once
  per head rather than once per rule. Results are unchanged.

- **More control over replacements**:
  - `ReplaceOptions.form` controls the form of replacement expressions:
    `'canonical'`, `'structural'`, `'raw'`, or a specific canonical transform.
    The previous `canonical` option is deprecated and remains available as an
    alias for this release.
  - `ReplaceOptions.direction` selects left-to-right or right-to-left traversal
    for order-sensitive rules.
  - Custom rules can now match user-defined function operators in `replace()`
    and `simplify({ rules })`.

- **Improved algebra**:
  - `solve()` now handles quadratics with symbolic coefficients, including
    `x^2 - a x + 1 = 0` and the general `a x^2 + b x + c = 0`. (#300)
  - `Factor` infers the variable of a univariate polynomial and preserves
    extracted numeric content: `Factor(x^2 + 5x + 6)` returns `(x+2)(x+3)`, and
    `Factor(6x + 9)` returns `3(2x + 3)`. (#309)

- **Parsing improvements**:
  - Two-argument `\arctan(y, x)` and `\tan^{-1}(y, x)` now parse as `Arctan2`.
  - LaTeX input is normalized to Unicode NFC, so decomposed identifiers parse
    like their precomposed equivalents.
  - A trailing bare `\` and trailing visual spacing commands are tolerated.
  - Multi-character subscripted identifiers such as `D_{etectsize}` no longer
    collide with Euler derivative notation.

### Resolved Issues

- **Numeric evaluation and arithmetic**:
  - Corrected complex powers, reciprocals, roots, and logarithms, including
    `i^2`, `i^i`, negative complex exponents, and even roots of negative reals.
  - Restored arbitrary-precision accuracy for roots, `exp()`, `ln()`, `mod()`,
    `gammaln()`, and large integer conversion. Very small real results such as
    `Power(10, -100).N()` are no longer rounded to zero.
  - Exact `floor()`, `ceil()`, and `round()` no longer lose digits beyond 2^53.
    Large decimal powers no longer report false overflow.
  - Division by zero, `NaN * 0`, infinity comparisons, and signed infinities now
    behave consistently across numeric representations.
  - Corrected `Arctan2` quadrants, `ln(Root(a, b))`, non-integer logarithm
    bases, exact radicals such as `sqrt(8)`, and division of Gaussian integers.

- **Special functions and statistics**:
  - Added complex `Gamma` and `GammaLn` evaluation. Gamma and factorial poles at
    non-positive integers now return `ComplexInfinity`, while factorials of
    positive non-integers evaluate through `Gamma(x + 1)`.
  - Improved `Erf`/`Erfc` to machine precision and corrected small-argument
    `gammaln()`.
  - Corrected `GCD`, `LCM`, `Congruent`, `Subfactorial`, negative-index
    `Fibonacci`, `IsOctahedral`, `Multinomial`, and `BellNumber`.
  - Corrected skewness, kurtosis, interquartile range, histogram/bin endpoints,
    and exact combinatorial calculations.

- **Simplification, comparison, and assumptions**:
  - Indeterminate comparisons now remain unknown instead of becoming `false`;
    this also improves sign inference, `Boole`, and `KroneckerDelta`.
  - Fixed equality handling for unordered expressions and multi-variable
    equation equivalence.
  - Prevented invalid simplification of rational powers such as `(-x)^(3/4)`.
  - Set membership now remains undecided when a symbol's type is unknown, and
    `Subset`, `SubsetEqual`, `Superset`, and empty-set relations use the correct
    direction.
  - Symbolic common factors are now recognized, and unresolved derivatives
    remain symbolic instead of recursing indefinitely.

- **Collections, matrices, and tensors**:
  - Corrected `Rest`, `Slice`, `Drop`, `Cycle`, `Position`, `SetFrom`,
    `TupleFrom`, `Filter`, `Zip`, and compiled `Reduce` behavior.
  - Determinants now work for matrices of any supported size, with exact integer
    results; inverses work beyond 2×2.
  - Corrected matrix row access and the `isUpperTriangular`, `isDiagonal`, and
    `isTriangular` predicates.
  - Incompatible tensor broadcasts now throw instead of producing invalid data;
    `diagonal()` respects its axis arguments, and mixed real/complex dtype joins
    preserve precision.

- **Types and serialization**:
  - Dimensioned list and matrix type strings now parse and round-trip, including
    unknown dimensions, spaces, parenthesized element types, and single `^N`
    dimensions.
  - Corrected union reduction, `never` subtyping, narrowing of disjoint types,
    bare `matrix` handling, numeric literal subtyping, and invalid range
    validation.
  - String literals now remain strings after MathJSON round-trips, dictionary
    conversion retains every entry, and function literals can be applied
    directly.
  - Plain symbols no longer report themselves as empty finite collections.

- **LaTeX parsing and serialization**:
  - Corrected scaled/big delimiters, nested `\text{...}`, repeating decimals
    beginning with `.`, digit-like symbol names, prefixed-symbol errors, and
    unbalanced environment names.
  - Multiplication signs are now emitted where juxtaposition would merge numeric
    factors, for example `3 \times 2^2` instead of `32^2`. (#302)
  - Re-declaring a parser symbol with the same type no longer reports a
    conflict.

- **Compilation**:
  - Corrected JavaScript compilation of symbolic `Range`, compound-bounded
    interval `Sum`/`Product`, and interpreted fallback for multi-argument
    lambdas.
  - Corrected Python parentheses for `(a^b)^c`.
  - Corrected GLSL/WGSL output for `Degrees`, complex multiplication,
    `Gamma`/`Factorial`/`Beta`/`Erf`, and `If`/`Which`/`When`.
  - Corrected symbolic derivatives of `Arcsec` and `Arccsc`.

- **Interval arithmetic**:
  - Restored conservative enclosures for multiplication involving zero and
    infinity, negative-modulus `mod`, `clamp`, `binomial`, `gcd`, `lcm`,
    `gamma`, `gammaln`, `sinc`, and Fresnel integrals.

## 0.58.0 _2026-05-12_

### Added

- **`\operatorname{count}(L)` lowercase alias** — function-call form now parses
  to `["Length", L]`, matching the existing dot-notation form
  (`L.\operatorname{count}`) and the other lowercase aliases (`mod`, `var`,
  `shuffle`, `repeat`, `join`).

- **`Repeat(value, count)` 2-arg form** — `Repeat` now accepts an optional
  integer `count` and evaluates to a finite list of `count` copies of `value`.
  The 1-arg `Repeat(value)` keeps its existing infinite-sequence semantics.
  Materialization is gated by `ce.maxCollectionSize`; larger values stay lazy
  (still accessible via `.at()` / iterator).

- **`ce.maxCollectionSize`** — new configurable cap (default `10_000`) on the
  number of elements a collection may have when materialized into a concrete
  `List`. Assigning `<= 0` or `Infinity` disables the cap (matching
  `iterationLimit` and `recursionLimit`).

- **`Sum(L)` collection-reducer form** — `Sum` now accepts a single collection
  argument and reduces to the sum of its elements:
  `["Sum", ["List", 1, 2, 3, 4, 5]] // ➔ 15`. The big-op form
  `Sum(body, [i, a, b], …)` is unchanged. The `Sum` head is now preserved
  through canonicalization (previously rewritten to `Reduce(L, "Add", 0)`), so
  `L.\operatorname{total}` round-trips cleanly with
  `latexOptions.dotNotation = true`. The async path throws `CancellationError`
  on signal abort.

- **`At` extended with boolean-mask and integer-list indices** — `At(L, mask)`
  where `mask` is a finite collection of `True`/`False` returns the elements of
  `L` where the mask is `True`. `At(L, indices)` where `indices` is a finite
  collection of integers returns a sublist picked at those positions;
  out-of-range positions are filtered. Integer indices (`At(L, 2)`) and string
  keys (`At(d, "key")`) work as before.

- **Function-application broadcasting for user-defined lambdas** — when a user
  function with scalar-typed parameters is applied to a finite indexed
  collection, CE now broadcasts the call elementwise. For
  `ce.assign('f', ce.parse('x \\mapsto x^2 + 1'))`, the expression
  `["f", ["List", 1, 2, 3]]` evaluates to `["List", 2, 5, 10]`. Multi-arg
  functions broadcast with zip semantics, mixing scalars and lists naturally.
  The inferred default for `\mapsto` lambdas is scalar parameters, so most user
  functions broadcast by default. To opt out, declare an explicit list parameter
  type via `ce.declare(name, '(list<X>) -> Y')`.

- **List type for mixed-kind and mixed-dimension elements** — `widen()` now
  builds a structural union when the common supertype would otherwise collapse
  to a lossy generic category (`scalar`, `value`, `list`, `tuple`, `dictionary`,
  …). Consumers can detect heterogeneous lists by inspecting
  `expr.type.toString()`:
  - `[1, 2, 3]` → `list<number>` (precise)
  - `[1, "hello", 3]` → `list<finite_integer | string>` (union)
  - `[(1,2), (1,2,3)]` →
    `list<tuple<finite_integer, finite_integer> | tuple<finite_integer, finite_integer, finite_integer>>`
    (mixed dimension)
  - `[]` → `list<nothing>` (empty)

- **`ce.expr(true)` / `ce.expr(false)`** — JS boolean primitives now box to the
  `True` / `False` symbols (previously fell through to `Undefined`).

- **`Length` operator definition** — `ce.operatorInfo('Length')` now returns a
  valid entry. The evaluator returns an integer count for finite collections and
  leaves the expression unevaluated for non-collection or infinite inputs.

- **Library entries for `Complex`, `Colon`, `Prime`** — `ce.operatorInfo()` now
  returns introspection data for these heads (previously `undefined`). `Complex`
  boxing is unchanged — `["Complex", re, im]` still produces a `BoxedNumber`.

- **`ce.symbolInfo(name)`** — new public API parallel to `ce.operatorInfo()`,
  for introspecting constants and declared variables. Returns
  `{ kind: 'constant' | 'variable', type: BoxedType }` for symbols like `Pi`,
  `True`, `ExponentialE`, `ImaginaryUnit`. Returns `undefined` for unknown names
  and for operator heads. Added `SymbolInfo` type to the public type surface.
  - Note: `Infinity` is registered as `PositiveInfinity` / `NegativeInfinity`;
    `Undefined` has no value definition.

- **`ce.normalizeIdentifier(latex)`** — new public helper that converts a LaTeX
  identifier string to its canonical MathJSON name without side effects.
  Examples: `R_{3}` → `R_3`, `f_{Bm}` → `f_Bm`, `\theta_x` → `theta_x`. Inputs
  that aren't identifiers (`'1 + 2'`, empty string) return `''`. Useful in
  importer pipelines that need to call `ce.declare()` with normalized names
  before parsing referencing rows.

- **`First`/`Second`/`Third` compile entries** — component access (`p.x`, `p.y`,
  `p.z`) now compiles cleanly. JS uses `[0]`/`[1]`/`[2]` index access; GLSL/WGSL
  use `.x`/`.y`/`.z` swizzles, assuming the argument compiles to a
  `vec2`/`vec3`/`vec4`. 5+-element tuples (which compile to `float[N]` arrays)
  aren't supported.

- **`Range` GPU compile entry** — `Range(lo, hi[, step])` with
  compile-time-constant bounds emits an inline `float[N](...)` (GLSL) or
  `array<f32, N>(...)` (WGSL) literal. Non-constant bounds throw a clear error
  directing the caller to materialize on the JS host and upload as a uniform.
  Sequence count is capped at 256 elements per call site.

- **`Variance`/`GCD`/`Median` GPU compile entries** — GLSL+WGSL parity with
  their JS counterparts.
  - `Variance` is inlined (no size limit).
  - `GCD` uses a preamble function implementing the Euclidean algorithm.
  - `Median` is supported for list sizes 2–8; lists with 9+ elements throw.

- **`Random` GPU compile with deterministic seed** — `Random(seed)` in GLSL/WGSL
  compiles to a hash-based pseudorandom. `Random()` (no args) in GLSL falls back
  to a `gl_FragCoord`-derived seed (fragment-shader only); in WGSL it throws —
  callers must provide an explicit seed.
  - The fract-sin hash exhibits banding near `seed ≈ kπ`. For high-quality
    shader random, use a more robust hash (e.g. PCG or xxHash).
  - JS-side `Random` is unchanged (still `Math.random`, non-seeded). A seeded JS
    form will land in a future release.

- **`toSignedFunction()`** — new method on `BoxedExpression` for
  implicit-surface rendering and region classification:
  - `Equal(a, b)` → `a - b` (zero on the surface)
  - `Less(a, b)` / `LessEqual(a, b)` → `a - b` (negative when relation holds)
  - `Greater(a, b)` / `GreaterEqual(a, b)` → `b - a` (negative when relation
    holds)
  - `NotEqual(a, b)` → `a - b`
  - Non-relation expressions return `undefined`.

  Strictness and direction are encoded in `expr.operator`. Note that CE
  canonical form normalizes `GreaterEqual` to `LessEqual(b, a)` (and similarly
  `Greater` to `Less`), so callers will typically see the `Less`/`LessEqual`
  operator on parsed expressions — the signed-function semantics are preserved.

- **`BoxedExpression.getInterval(symbol)`** — new method for extracting domain
  bounds from restriction expressions. Returns `IntervalBounds` with
  `lower`/`upper`/`lowerStrict`/`upperStrict` for `When(e, cond)`,
  `And(c1, c2, …)`, and bare comparison expressions; returns `undefined` for
  unsupported shapes. Useful for 2D-plot domain derivation (e.g. clipping
  `y = f(x)\{0 < x < 5\}` to `[0, 5]`). Added `IntervalBounds` type to the
  public type surface.

- **Compact piecewise `\{cond_1 : val_1, …, default\}`** — now parses to
  `Which(c_1, v_1, …, True, default)`, the same head CE produces for
  `\begin{cases}…\end{cases}`. Disambiguated from set-builder `\{x : type\}` by
  inspecting the LHS of the top-level `Colon`: comparison/boolean heads (`Less`,
  `Greater`, `Equal`, `And`, `Or`, `Not`, …) → piecewise branch; otherwise →
  set-builder. Normal set literals (`\{1, 2, 3\}`) and set-builder via `\mid`
  are unchanged.

#### Fixed

- **`Linspace` endpoint inclusion** — `Linspace(a, b, n)` now produces `n`
  points evenly spanning `[a, b]` inclusive of both endpoints (matching NumPy,
  Julia, and MATLAB). Previously the last sample fell short of `b` (e.g.
  `Linspace(0, 1, 5)` yielded `0, 0.2, 0.4, 0.6, 0.8` instead of
  `0, 0.25, 0.5, 0.75, 1`). `Linspace(a, b, 1)` is the degenerate case and
  returns just `a`. The `contains` check is now tolerance-based (was an exact
  `%` test that failed for typical floating-point values).

- **Heterogeneous-list type rendering** — lists containing mixed kinds or
  mixed-dimension tuples previously rendered their type as `"[object Object]"`
  in some paths (`BoxedDictionary.type`, `collectionElementType`). Types are now
  constructed programmatically. Lists containing tuples, sets, dictionaries,
  records, or strings are no longer misclassified as numeric `BoxedTensor`s.

#### Known issues

- **JS `Loop` compile produces `undefined`** — the imperative `for`-loop IIFE
  generated for `Loop(body, Element(i, Range(lo, hi)))` has no `return`
  statement, so the compiled function returns `undefined` rather than the list
  of body values. Tracked for a future release.

- **JS `Integrate` compile produces `NaN`** — when `args[0]` is a `Function`
  expression (the common `\int x^2 dx` parse shape), `compileIntegrate` produces
  a double-lambda, so `_SYS.integrate` receives a function-returning function.
  Tracked for a future release.

## 0.57.0 _2026-05-10_

### Added

- **`verbatim` opt-in for `toLatex()`** — `expr.toLatex({ verbatim: true })`
  returns the original LaTeX source captured at parse time when the expression
  was parsed with `preserveLatex: true`. Falls back to normal re-serialization
  if no verbatim is available (e.g. for synthetic or transformed expressions).
  The default behavior of `expr.latex` and `expr.toLatex()` is unchanged —
  verbatim is strictly opt-in. Useful for round-tripping authored LaTeX (e.g.
  `p.x`, `\sin(x)`) without rewriting it to canonical form.
  - Verbatim is set only on the top-level boxed expression produced directly by
    `ce.parse(..., { preserveLatex: true })`. Canonicalization, `simplify()`,
    `evaluate()`, `subs()`, and `ce._fn()` produce fresh expressions with
    `verbatimLatex === undefined`.
  - Function expressions whose operator has a custom canonical handler (e.g.
    `Sin`, `Add`) currently do not preserve top-level verbatim through
    canonicalization — the handler reconstructs the result without threading
    metadata. Atoms (symbols, numbers) and functions without custom canonical
    handlers (e.g. `First`) do preserve it. Use `form: 'structural'` to skip
    canonical handlers when verbatim preservation matters.

- **`dotNotation` serialization option** — when enabled (default off),
  member-access heads serialize to dot notation rather than function-call form:
  `First(p)` → `p.x`, `Length(L)` → `L.\operatorname{count}`, etc. Useful for
  round-tripping editor-authored dot-notation back to its source form. Set via
  `ce.latexOptions.dotNotation = true` or per-call
  `expr.toLatex({ dotNotation: true })`. Only applies to arity-1 forms;
  multi-operand forms (e.g. `Sum` with an index range) keep their standard
  serialization.
  - **Serializer-only.** The flag lives in `SerializeLatexOptions` and has no
    effect on parsing. All input forms continue to parse as before regardless of
    the flag: `|L|`, `\operatorname{count}(L)`, `L.\operatorname{count}`,
    `\operatorname{length}(L)` all still parse to `["Length", L]` whether
    `dotNotation` is on or off. The flag only decides which form the serializer
    emits.

- **Component access** (`p.x`, `L.\operatorname{count}`, `z.\operatorname{re}`)
  — dot notation now parses to existing semantic heads at parse time. No generic
  accessor head was introduced.
  - Recognized members and their AST mapping: `x`/`y`/`z` →
    `First`/`Second`/`Third`; `real`/`re` → `Real`; `imag`/`im` → `Imaginary`;
    `count` → `Length`; `total` → `Sum`; `max` → `Max`; `min` → `Min`.
  - Disambiguation: after a terminated integer or decimal, `.` followed by a
    letter or `\operatorname{...}` is component access, not a decimal point.
    Examples: `1.x` parses as `["First", 1]` (not a malformed decimal); `1.5.x`
    parses as `["First", 1.5]`.
  - Only `\operatorname{...}` and bare-letter identifiers are recognized after
    `.`. `\mathrm{...}` is not accepted (deliberately tight).
  - `Third` is a new operator (parallels `First`/`Second`) with signature
    `(any) -> any`. `First`/`Second` were widened from `(collection) -> any` to
    `(any) -> any` so component access on a non-collection (e.g. `1.x`) defers
    type-checking to evaluation; evaluation returns an `Error` expression for
    incompatible types.

- **Restriction braces** (`expr\{cond\}`) — trailing brace predicates parse to a
  new `When` head.
  - `f(x)\{0 < x < 2\}` → `["When", ["f", "x"], ["Less", 0, "x", 2]]`.
  - **Stacked restrictions canonicalize**: `expr\{c_1\}\{c_2\}` →
    `["When", expr, ["And", c_1, c_2]]`. Downstream simplification, evaluation,
    interval intersection, and compilation see a single canonical shape
    regardless of source form.
  - Disambiguation from set literals is positional: standalone `\{1, 2, 3\}`
    continues to parse as a `Set`; `<expr>\{cond\}` parses as a `When`
    restriction. Allowed left operands include function calls, tuples, list/set
    literals, bare symbols, subscripted symbols, member access, power
    expressions, and chained restrictions.
  - Evaluator semantics: `When(e, True)` evaluates `e`; `When(e, False)` returns
    `Undefined`; indeterminate `cond` holds the form.
  - Serializer round-trips to the stacked-brace form (not `\wedge` inside one
    set of braces) so authored source and re-serialized output stay visually
    consistent.
  - JS and GLSL compilation: ternary `(cond ? e : NaN)`.

- **List-range ellipsis** (`[1...9]`, `[0, 0.1, ..., 1]`) — ranges inside list
  literals parse to the existing `Range` head.
  - Endpoint-only form: `[a...b]` → `["Range", a, b]`. Triggers `...`, `\ldots`,
    and `\dots` are all accepted.
  - Inferred-step form: `[a_0, a_1, ..., a_n]` → `["Range", a_0, a_n, step]`
    where `step = a_1 - a_0` is inferred from the first sample pair.
    Intermediate samples are validated against `a_0 + k·step` within
    `ce.tolerance`; inconsistent samples produce a parse error.
  - The float idiom `[0, 0.1, 0.2, ..., 1]` is supported (tolerance-aware
    comparison; `0.1 + 0.1 ≠ 0.2` exactly but is accepted within tolerance).
  - Outside `[...]` brackets, `\ldots`/`\dots`/`...` continue to parse as the
    `ContinuationPlaceholder` symbol. The trigger is bracket context.

- **For-comprehensions** (`(x, y) \operatorname{for} x=L_1, y=L_2`) — the `Loop`
  head now accepts multiple `Element` clauses, evaluated as nested loops with
  later bindings seeing earlier ones in scope.
  - `Loop(body, Element(x, L_1), Element(y, L_2), ...)` produces an
    `indexed_collection<T>` of body evaluations, in row-major order.
  - For independent bindings this is the Cartesian product:
    `(x, y) \operatorname{for} x = [1...2], y = [1...2]` → 4 tuples.
  - For dependent bindings later clauses see earlier:
    `(x, y) \operatorname{for} x = [1...3], y = [1...x]` → 6 tuples (triangle,
    not Cartesian).
  - Precedence: `\operatorname{for}` binds looser than `,` and `=`, tighter than
    `;`. So `(x + y) \operatorname{for} x = L_1, y = L_2` parses with body
    `x + y` and two bindings.
  - Bound names do not leak into the enclosing scope (uses
    `Scope.noAutoDeclare`).
  - Legacy single-Element form continues to round-trip via the existing
    `\text{for } i \text{ from } a \text{ to } b \text{ do } body` syntax.
    Multi-Element comprehensions serialize to the `\operatorname{for}` form.

- **`Range` type is now dynamic** — element type narrows based on the step
  argument: integer step (or no step) yields `indexed_collection<integer>`;
  non-integer step yields `indexed_collection<number>`. Previously the type was
  always `indexed_collection<integer>`, which was incorrect for float-step
  ranges.

- **`When` head** — new conditional-value operator. `When(expr, cond)` returns
  `expr` when `cond` is true, `Undefined` when `cond` is false, and holds when
  `cond` is indeterminate. Used by restriction-brace parsing (see above) but
  also usable directly.

- **`ce.operatorInfo(head)`** — new method on `ComputeEngine` for introspecting
  registered operator heads. Returns
  `{ kind: 'function' | 'opaque', signature?: BoxedType }` or `undefined`.
  - `'function'` — head has an `evaluate` handler or a `collection` handler
    (lazy producers like `Range`, `Linspace`, `Tuple` work via the latter).
  - `'opaque'` — head is declared with a signature but has neither (e.g.,
    `Triangle`, `Sphere`, `GeometricVector`).
  - `undefined` — no operator definition (constants like `Pi` and unknown
    heads).
  - Lets external tooling classify heads by capability without maintaining a
    parallel list of supported operators.

- **`tolerance` in `ParseLatexOptions`** — populated automatically from
  `ce.tolerance` when parsing through `ce.parse()`. Used by list-range sample
  validation; available to other parse handlers that need tolerance-aware
  comparison.

#### Fixed

- **`Loop` with `Element` clause** — single-Element
  `Loop(body, Element(i, range))` previously did not produce a list of body
  evaluations (the iteration path for `Element` form had a bug). The new
  variadic evaluator correctly yields a `List` of body values for each
  iteration.

## 0.56.0 _2026-03-10_

### Added

- **First-class color values** — colors are now typed values with a dedicated
  `color` primitive type and per-colorspace constructor heads, rather than
  anonymous tuples.
  - **Constructor heads**: `Rgb`, `Hsv`, `Hsl`, `Oklab`, `Oklch`. Each takes 3
    components plus an optional alpha. Channels follow each colorspace's own
    conventions (RGB: 0–1 sRGB; HSV/HSL: hue in degrees, S/V/L 0–1; Oklab/Oklch:
    standard ranges).
  - **LaTeX**: `\operatorname{rgb}(...)`, `\operatorname{hsv}(...)`,
    `\operatorname{hsl}(...)`, `\operatorname{oklab}(...)`,
    `\operatorname{oklch}(...)`, parsing and serialization both directions.
  - **Conversions**: `AsRgb`, `AsHsv`, `AsHsl`, `AsOklab`, `AsOklch` convert any
    color to the named space (identity if already there).
  - **`ColorDelta(a, b)`** — perceptual color difference (ΔE_OK, Euclidean
    distance in OKLab). Wide-gamut inputs are not clipped before measurement.

- **JavaScript compile-target support for color values** — all color
  constructors, the `As*` converters, `ColorDelta`, and `Distance` are
  supported. At runtime a color is a 3- or 4-element OKLCh array (`[L, C, H]` or
  `[L, C, H, alpha]`), matching the GPU target's `vec3`/`vec4` representation,
  so values move between JS, GLSL, and WGSL without conversion.

- **`Distance(p1, p2)`** — Euclidean distance between two points represented as
  tuples. Accepts any positive dimension; mismatched dimensions return a typed
  error. LaTeX trigger `\operatorname{distance}(p1, p2)`.

- **Geometric primitive heads** — `Triangle`, `Sphere`, `Segment`, and
  `GeometricVector` are now recognized as typed function heads (no evaluator,
  preserved structurally for downstream consumers). LaTeX triggers
  `\operatorname{triangle}`, `\operatorname{sphere}`, `\operatorname{segment}`,
  `\operatorname{vector}(p1, p2)`. `GeometricVector` is distinct from the
  existing `Vector` (column-vector construction).

- **`To` head registered** — `\to` already parsed to `["To", a, b]` but was
  classified as `unsupported-operator`; it is now a known typed head.

- **Function-style aliases** — lowercase `\operatorname{...}` forms common in
  Desmos-style notation now parse to their existing capitalized operators:
  `\operatorname{mod}` → `Mod`, `\operatorname{var}` → `Variance`,
  `\operatorname{shuffle}` → `Shuffle`, `\operatorname{random}` → `Random`,
  `\operatorname{repeat}` → `Repeat`, `\operatorname{join}` → `Join`.

- **`ce.latexOptions`** — new mutable, engine-wide bag of LaTeX parse/serialize
  options (e.g. `decimalSeparator`, `digitGroupSeparator`). Available as a
  constructor option and as a read/write property:
  ```ts
  const ce = new ComputeEngine({ latexOptions: { decimalSeparator: '{,}' } });
  // or post-construction:
  ce.latexOptions = { decimalSeparator: '{,}' };
  ```
  These options are merged into every `ce.parse()` and `expr.toLatex()` call.
  Precedence (most-specific wins): `LatexSyntax` instance defaults <
  `ce.latexOptions` < per-call options. Previously, options like
  `decimalSeparator` could only be changed per call post-construction (and
  `expr.latex` could not be customized at all).

#### Changed

- **`Color('...')`** now returns an `Oklch` head instead of a 0–1 sRGB `Tuple`.
  The string parser still accepts the same set of CSS-style inputs.
- **`ColorMix`** now returns an `Oklch` head and mixes in OKLCh directly,
  preserving out-of-gamut chroma. Hue interpolation takes the shortest path
  around the wheel; mixing with an achromatic endpoint carries the other
  endpoint's hue (matches CSS Color 4 `color-mix`).
- **`ContrastingColor`** now returns an `Rgb` head (was: 0–1 sRGB `Tuple`).
- **`Colormap`** now returns `Oklch` heads — either a `List(Oklch, ...)` or a
  single `Oklch` for position-sampling.
- **`ColorToString`** with `'oklch'` format serializes typed color inputs
  without an sRGB round-trip; out-of-gamut chroma serializes losslessly.
  `'hex'`/`'rgb'`/`'hsl'` paths are unchanged.
- **Color-consuming signatures tightened** — `(any, any)` →
  `(color | string | tuple, color | string | tuple)` for `ColorDelta`,
  `ColorContrast`, `ColorMix`, `ContrastingColor`, `ColorToString`,
  `ColorToColorspace`. The `As*` converters take `(color) -> color`.

#### Migration notes

Code that consumed the tuple output of `Color('...')`, `ColorMix`,
`ContrastingColor`, or `Colormap` now sees a typed color head. To get the
previous 0–1 sRGB shape, wrap with `AsRgb`:

```ts
// Before: const tuple = ce.expr(['Color', "'red'"]).evaluate();  // [r, g, b] in 0-1
// Now (equivalent 0-1 sRGB):
const rgb = ce.expr(['AsRgb', ['Color', "'red'"]]).evaluate();
// rgb is ['Rgb', r, g, b] with channels 0-1
```

`Rgb` head components are **0–1 sRGB** across all layers (engine, JS compile,
GPU compile).

#### Fixed

- **Super-linear parse time on deeply-nested parametric expressions** —
  `ce.parse()` could exhibit exponential blowup on inputs like nested rotation
  matrices `\left(\cos(\theta)\cdot S+\sin(\theta)\right)` (depth 6 took ~44s).
  Two underlying causes were addressed: the type/sign cache on `BoxedFunction`
  was effectively disabled (causing every `.type` access to recurse through all
  operands), and `parseEnclosure` was speculatively trying matchfix definitions
  whose close-delimiter token wasn't even present in the input. Parse time on
  the affected inputs is now linear.

- **`ce.parse()` ignored the injected `LatexSyntax` instance's
  `decimalSeparator`** — `ce.parse()` hardcoded `decimalSeparator: '.'`,
  silently overriding any value configured on a `LatexSyntax` passed via the
  constructor's `latexSyntax` option. The injected instance's configured
  separator now takes effect end-to-end.

- **`expr.toMathJson({ metadata: ['latex'] })` was silently dropped** — passing
  a metadata array of specific fields (e.g. `['latex']` or `['wikidata']`) was
  ignored; only `metadata: 'all'` worked. The array form now correctly populates
  the requested fields.

- **`expr.toMathJson({ shorthands: ['all'] })` disabled all shorthands** — the
  `['all']` array form had the opposite of its intended effect. The string form
  `'all'` and explicit lists like `['function']` were unaffected.

## 0.55.6 _2026-03-08_

### Resolved Issues

- **LaTeX parsing: `\lim` with postfix operators** —
  `\lim_{x\to 0}\left(x\right)^x` now correctly parses as `Limit(x^x)` instead
  of `Power(Limit(x), x)`. The `\lim` parser was using
  `parseArguments('implicit')` which stripped the delimiters and left the `^x`
  unconsumed; it now uses `parseExpression` so postfix operators are included in
  the limit body.

- **LaTeX parsing: style, size, and color switch commands** — `\displaystyle`,
  `\textstyle`, `\scriptstyle`, `\scriptscriptstyle`, `\tiny`..`\Huge` (10 size
  commands), and `\color{...}` were silently discarded during parsing. They now
  produce `Annotated` expressions that preserve the styling information and
  round-trip correctly through serialization. Added `\scriptstyle` /
  `\scriptscriptstyle` serialization support (previously only `\displaystyle`
  and `\textstyle` were handled).

- **LaTeX parsing: set-builder notation** — `\{x \in \R \mid x > 0\}` now parses
  to `["Set", expr, ["Condition", cond]]`. Registered `\mid` as an infix
  operator (`Divides`, precedence 160). The serializer round-trips set-builder
  notation correctly.

- **LaTeX serialization: `Complement`** — `["Complement", "A"]` now serializes
  to `A^\complement` instead of falling back to the generic function form.
  Removed stale `@todo` comments about a non-existent multi-argument case.

- **LaTeX parsing: spacing commands** — `\hspace{dim}`, `\hspace*{dim}`,
  `\hskip`, and `\kern` are now consumed during parsing (previously caused
  "unexpected token" errors). These are treated as visual spacing and skipped.

- **LaTeX serialization: `HorizontalSpacing` math classes** — the 2-argument
  form `["HorizontalSpacing", expr, "'bin'"]` now serializes to `\mathbin{expr}`
  (and similarly for `rel`, `op`, `ord`, `open`, `close`, `punct`, `inner`).
  Previously the second argument was silently dropped.

- **LaTeX serialization: redundant parens on matchfix operators** — `wrap()` no
  longer adds parentheses around `Abs`, `Floor`, `Ceil`, `Norm`, and other
  matchfix expressions that already have visible delimiters.

- **LaTeX serialization: tabular environments** — default environment serializer
  now renders matrix bodies (List of Lists) with `&` column separators and `\\`
  row separators instead of nested function calls.

- **LaTeX serialization: matchfix delimiter scaling** — default matchfix
  serializer now respects `groupStyle` to choose between bare delimiters,
  `\left..\right`, or `\bigl..\bigr` scaling.

- **LaTeX parsing: Greek symbols in string groups** — `\alpha`, `\beta`, etc. in
  `parseStringGroupContent()` (used by `\begin`/`\end`, color arguments) are now
  interpreted as their Unicode equivalents instead of passing through as raw
  LaTeX commands.

## 0.55.5 _2026-03-06_

### Resolved Issues

- **Deep-zoom fractal precision** — emulated-double (dp) and perturbation (pt)
  shaders now compute per-pixel coordinates from `v_uv` and viewport uniforms
  instead of the shader template's single-precision `mix()`, which lost
  distinguishability at high zoom levels.
- **Perturbation theory: absolute vs delta coordinates** — the perturbation
  Mandelbrot/Julia handlers were passing absolute single-precision coordinates
  to the shader instead of the small delta from the reference center. Fixed by
  introducing `_pt_delta()` which computes the per-pixel offset from viewport
  uniforms.
- **`compile()` free function dropped `hints`** — the `hints` option (viewport
  center/radius) was accepted but silently not forwarded to the language target.
  Fixed in `compile-expression.ts`.

### New Features

- **`BigDecimal` export** — the arbitrary-precision decimal class is now
  exported from the public API for use by plot engines and other consumers that
  need precision beyond float64.
- **`HighPrecisionCoord` type** — new union type
  (`number | string | { hi: number; lo: number }`) for passing
  extended-precision viewport coordinates through the compile API. The
  `viewport.center` option now accepts this type instead of plain
  `[number, number]`.

## 0.55.4 _2026-03-06_

### Resolved Issues

- **[#254](https://github.com/cortex-js/compute-engine/issues/254) LaTeX
  parsing: interval notation with `\lbrack`/`\lparen`** — parsing `\lbrack5,7)`
  or `\left\lbrack5,7\right)` now correctly produces an `Interval` expression.
  Previously, when the open delimiter was a LaTeX command (e.g., `\lbrack`), the
  parser incorrectly required the close delimiter to also be a LaTeX command
  (e.g., `\rparen` instead of `)`), causing mismatched-delimiter intervals to
  fail.
- **LaTeX parsing: invalid symbols in `\mathrm{}` and related prefixes** —
  invalid content inside `\mathrm{}`, `\operatorname{}`, etc. (e.g.,
  `\mathrm{=}` or `\mathrm{DavidBowie👨🏻‍🎤}`) now produces the correct
  `invalid-symbol` error instead of cascading parse errors. Also fixed
  `matchPrefixedSymbol` leaking parser state on failure, and emoji sequences are
  now properly recognized inside symbol prefixes (e.g.,
  `\operatorname{😎🤏😳🕶🤏}`).

### New Features

- **High-precision Mandelbrot/Julia compilation** — the GPU compilation targets
  (GLSL, WGSL) now support three precision tiers for fractal rendering, selected
  automatically based on viewport hints:
  - **Single float** (zoom < 10^6x): existing implementation, no overhead
  - **Emulated double** (zoom 10^6x–10^14x): double-single (float-float)
    arithmetic using Dekker/Knuth algorithms, ~48-bit mantissa from two 32-bit
    floats
  - **Perturbation theory** (zoom > 10^14x): reference orbit computed on CPU at
    arbitrary precision via `BigDecimal`, GPU iterates only the small delta from
    the reference, with glitch detection and single-float rebase fallback
- **Viewport-aware compile API** — `compile()` accepts optional
  `hints: { viewport: { center, radius } }`. The compiler auto-selects the
  precision strategy and returns `staleWhen` thresholds for cheap staleness
  checking by the plot engine.
- **`CompilationResult` extensions** — new optional fields: `staleWhen` (plain
  data staleness predicate), `uniforms` (scalar shader uniforms), `textures`
  (typed texture data with format/dimensions for GPU upload).

## 0.55.3 _2026-03-05_

### Improved

- **Compilation: constant folding** — `Add`, `Multiply`, `Subtract`, `Negate`,
  `Divide`, `Power`, `Sqrt`, and `Root` handlers now fold numeric literals at
  compile time and eliminate identity values.
  - `x + yi` compiles to `vec2(x, y)` instead of
    `vec2(x, 0.0) + (y * vec2(0.0, 1.0))`
  - `2 + 3` → `5.0`, `x + 0` → `x`, `x * 1` → `x`, `x * 0` → `0.0`
  - `Power(x, 2)` → `(x * x)` for simple operands, `pow(f(x), 2.0)` for complex
    expressions to avoid duplicate computation
  - `Power(x, 0.5)` → `sqrt(x)`, `Power(x, 0)` → `1.0`, `Power(x, -1)` →
    `(1.0 / x)`
  - `Sqrt(4)` → `2.0`, `Root(x, 2)` → `sqrt(x)`
- **`isComplexValued`** uses expression type system instead of hard-coded
  operator list.
- **Integer arguments** in GPU fractal functions emit as `200` instead of
  `int(200.0)`.
- **Type-based optimizations** — compilation handlers now use expression type
  information for better code generation:
  - `Floor`/`Ceil`/`Round`/`Truncate` are no-ops when the operand is
    integer-typed
  - `Abs` is a no-op when the operand is provably non-negative
  - `Power(x, 2)` only expands to `(x * x)` for simple operands (symbols,
    literals) — function calls like `Power(Sin(x), 2)` use `pow`/`Math.pow` to
    avoid duplicate evaluation
  - Integer `Mod` with non-negative dividend uses plain `%` instead of the
    Euclidean double-mod formula
  - GPU variable declarations infer `i32`/`int` type for integer-typed locals

### Resolved Issues

- **`Abs` signature**: return type is now `real` instead of propagating the
  input type (which incorrectly returned `complex` for complex inputs).
- **Compilation fallback**: uses `pushScope`/`assign` pattern instead of
  crashing when receiving a vars object.

### New Features

- **`Mandelbrot` and `Julia`** operators in JavaScript and GPU compilation
  targets.

## 0.55.2 _2026-03-04_

### Resolved Issues

- **`\text{}` flush bug**: `\text{a$x$b}` now correctly produces
  `["Text", "'a'", "x", "'b'"]`. Previously the text before and after inline
  math were merged due to a missing `flush()` call in `parseTextRun`.
- **`#` / `*` parsed as valid symbols**: Bare `#` and `*` tokens were
  incorrectly accepted as valid symbol names because they match the Unicode
  `Emoji` property (keycap base characters). They now produce `unexpected-token`
  errors as expected. The fix excludes ASCII characters from the emoji regex in
  symbol validation.
- **`Text` operator type**: The `Text` operator now has return type `string`
  instead of `expression`.
- **`\textcolor` inside `\text{}`**: `\textcolor{red}{RED}` inside `\text{}` now
  correctly parses the body as text (`'RED'`) instead of switching to math mode
  and treating each letter as a separate symbol.
- **`parseSyntaxError` token consumption**: Non-command tokens (like `#`, `&`)
  are now consumed when producing errors, preventing potential parser loops.
- **`parseSymbolToken` hardening**: Raw tokens are pre-validated against
  `\p{XIDC}` before being consumed as symbols, providing defense-in-depth
  against future `isValidSymbol` regressions.

### New Features

- **Text promotion**: When `InvisibleOperator` canonicalization encounters a
  `Text` expression or a string operand, it now absorbs all operands into a
  single `Text` expression. For example, `a\text{ in $x$ }b` canonicalizes to
  `["Text", "a", " in ", "x", " ", "b"]` instead of producing a `Tuple`.
- **Text infix keywords**: `\text{and}`, `\text{or}`, `\text{iff}`, and
  `\text{if and only if}` are now recognized as infix operators that produce
  `And`, `Or`, and `Equivalent` expressions respectively, following the existing
  `\text{where}` pattern.
- **Additional text keywords**: `\text{such that}` (maps to `Colon`),
  `\text{for all}` (maps to `ForAll`), and `\text{there exists}` (maps to
  `Exists`) are now recognized as operators.
- **`Text` serializer**: `Text` expressions now round-trip back to proper
  `\text{...}` LaTeX with inline `$...$` for math sub-expressions, instead of
  falling through to the default `\mathrm{Text}(...)` output.
- **`Text` evaluate handler**: Evaluating a `Text` expression now concatenates
  all operands into a single string.

## 0.55.1 _2026-03-04_

### Resolved Issues

- After `parse('f(x):=\\sin(x)')`, the symbol `f` is now immediately recognized
  as having type `function`. Previously its type remained `unknown` until the
  `Assign` expression was explicitly evaluated.
- `2f(x)` and `2f \left(x\right)` now both correctly parse as
  `["Multiply", 2, ["f", "x"]]` when `f` is a known function symbol. Previously,
  a space before `\left` caused the parser to produce a `Tuple` instead of
  `Multiply`, and expressions whose return type was `any` (e.g., calls to
  generically-typed functions) were also misclassified as `Tuple`.
- Expressions involving operators that return `expression` type (such as `D`,
  `Simplify`, `Annotated`) are now correctly treated as multiplicable in
  juxtaposition contexts. For example, `2f'(x)` now produces
  `["Multiply", 2, ["D", ...]]` instead of `Tuple`.
- The `D` (derivative) operator now returns a numeric type when its body is
  numeric, instead of always returning the generic `expression` type.
- Undeclared symbols followed by parenthesized multi-argument expressions (e.g.,
  `2g(x,y)`) are now auto-declared as functions in all invisible operator paths,
  not just the two-operand path.

## 0.55.0 _2026-03-04_

### Breaking Changes

- `ce.box()`/`box()` renamed to `ce.expr()`/`expr()` (`ce.box()` remains as a
  deprecated wrapper).
- Removed `ce.latexDictionary` getter/setter; configure dictionaries through
  `new LatexSyntax({ dictionary: [...] })`.
- Removed `ComputeEngine.getLatexDictionary()`; import dictionary constants from
  package exports.
- Removed deprecated type guard aliases: `isBoxedExpression`, `isBoxedNumber`,
  `isBoxedSymbol`, `isBoxedFunction`, `isBoxedString`, `isBoxedTensor` (use
  `isExpression`, `isNumber`, `isSymbol`, `isFunction`, `isString`, `isTensor`).
- Removed `LibraryDefinition.latexDictionary`; LaTeX dictionaries now live in
  the `latex-syntax` module.

### Resolved Issues

- **#295** The `parse()` free function now accepts the form options object, so
  `parse("\\frac{10}{2}", { form: "raw" })` return `["Divide", "10", "2"]`.
- Undeclared symbols followed by parenthesized numeric expressions are now
  interpreted as multiplication, not implicit function calls (for example,
  `q(2q)` -> `2q^2`). Function-call behavior remains for explicitly declared
  function symbols and non-numeric argument forms.

### New Features

- Modular package exports for smaller bundles: `@cortex-js/compute-engine/core`,
  `@cortex-js/compute-engine/compile`, `@cortex-js/compute-engine/latex-syntax`,
  `@cortex-js/compute-engine/numerics`, and `@cortex-js/compute-engine/interval`
  (with existing sub-paths still available, including `math-json`).
- New standalone `LatexSyntax` API (class + `parse()`/`serialize()` helpers) for
  LaTeX <-> MathJSON without a `ComputeEngine` instance.
- New `ILatexSyntax` interface exposed via `IComputeEngine.latexSyntax` to allow
  custom LaTeX parser/serializer implementations.
- All 16 LaTeX domain dictionaries are now exported individually, plus the
  combined `LATEX_DICTIONARY`.
- `Parser` type is now exported from the main package for typed custom
  `LatexDictionaryEntry` parse handlers.

### Changed

- `ComputeEngine` now accepts an injectable `latexSyntax` dependency.
  - Full package imports still auto-create a LaTeX syntax instance.
  - Core-only imports do not bundle LaTeX support; `parse()`, `.latex`, and
    `toLatex()` require an injected `LatexSyntax`.
  - MathJSON serialization omits optional LaTeX metadata when no LaTeX syntax is
    present.
- `decimal.js` has been replaced with a native `bigint`-backed `BigDecimal`
  implementation, reducing dependency surface and bundle size.
- `BigDecimal` `add()`, `sub()`, and `mul()` are now exact; rounding is limited
  to operations that require it (`div()`, non-integer `pow()`, transcendentals).
- Numeric string/LaTeX serialization now respects precision settings:
  `.latex`/`.toString()` round to `ce.precision`, while `.json`/`toJSON()`
  remain lossless.
- High-precision special functions (`bigGamma`, `bigGammaln`, `bigDigamma`,
  `bigTrigamma`, `bigPolygamma`, `bigZeta`) now scale with
  `BigDecimal.precision`; integer Gamma values are exact.

## 0.54.0 _2026-02-26_

- **New `expr.polynomialCoefficients()` method**: Returns the coefficients of a
  polynomial expression in descending order of degree, or `undefined` if the
  expression is not a polynomial. Auto-detects the variable when the expression
  has exactly one unknown. Subsumes `isPolynomial` (check `!== undefined`) and
  degree computation (`length - 1`).

- **`polynomialCoefficients()` now accepts an array of variables**: Pass
  `['x', 'y']` to verify the expression is polynomial in all listed variables.
  Coefficients are decomposed by the first variable.

- **New `expr.polynomialRoots()` method**: Returns the roots of a polynomial
  expression, or `undefined` if not a polynomial. Handles degree 3+ polynomials
  with rational roots via the Rational Root Theorem.

- **New `Polynomial` CAS function**: Constructs a polynomial from a coefficient
  list (descending order) and a variable. Inverse of `CoefficientList`:
  `Polynomial([1, 0, 2, 1], x)` evaluates to `x³ + 2x + 1`.

- **Improved `Factor` for degree 3+ polynomials**: `Factor` now uses the
  Rational Root Theorem to factor polynomials with integer coefficients and
  rational roots. Previously only handled degree ≤ 2.

- **Improved `Factor` with content extraction**: `Factor` now extracts the GCD
  of integer coefficients before applying other strategies. For example,
  `Factor(6x² + 12x + 6, x)` now produces `6(x+1)²`.

- **New `PartialFraction` CAS function**: Decomposes rational expressions into
  partial fractions. Supports distinct and repeated linear factors, irreducible
  quadratic factors, and improper fractions (polynomial division performed
  first). Example: `PartialFraction(1/((x+1)(x+2)), x)` → `1/(x+1) - 1/(x+2)`.

- **New `Apart` CAS function**: Alias for `PartialFraction`.

- **New `PolynomialRoots` CAS function**: Returns the roots of a polynomial as a
  set. Example: `PolynomialRoots(x² - 5x + 6, x)` → `{2, 3}`.

- **New `Discriminant` CAS function**: Returns the discriminant of a polynomial
  of degree 2, 3, or 4. Supports symbolic coefficients. Example:
  `Discriminant(x² - 5x + 6, x)` → `1`.

- **`simplify()` auto-decomposes partial fractions**: When a `Divide` expression
  has a denominator already in factored form (product or power) and the
  decomposition is simpler, `simplify()` automatically applies partial fraction
  decomposition.

- **Breaking: `CoefficientList` now returns descending order**: The CAS function
  `CoefficientList` now returns coefficients from highest to lowest degree
  (e.g., `[1, 0, 2, 1]` for `x^3 + 2x + 1`), matching the new
  `polynomialCoefficients()` method and common external conventions. Previously
  it returned ascending order.

- **`expr.match()` now accepts string patterns with auto-wildcarding**: Pass a
  LaTeX string like `'ax^2+bx+c'` and single-character symbols are automatically
  treated as wildcards. Results use clean unprefixed keys (`{a: 3, b: 2, c: 5}`)
  with self-matches filtered out. `useVariations` and `matchMissingTerms`
  default to `true` for string patterns.

- **`expr.match()` now accepts MathJSON arrays directly**: Pass a raw MathJSON
  pattern like `['Add', '_a', '_b']` without calling `ce.box()` first.

- **New `matchMissingTerms` option for `match()`**: When enabled, expressions
  with fewer operands than the pattern can still match by treating missing terms
  as identity elements (0 for `Add`, 1 for `Multiply`). For example, `3x^2+5`
  matches the pattern `ax^2+bx+c` with `b = 0`. Enabled by default for string
  patterns.

- **Non-strict parsing: implicit superscript for letter+digit**: In non-strict
  mode, a single letter immediately followed by a digit 2–9 is parsed as an
  exponent: `x2 + y2` → `x^2 + y^2`. Handles common copy-paste from web pages.
  Only digits 2–9, only single ASCII letters, and only when adjacent (no space).

## 0.53.1 _2026-02-25_

- **`timeLimit` now reliably interrupts long-running evaluations**: `Factorial`,
  `Sum`, `Product`, `Loop`, and `Reduce` all respect the `timeLimit` property
  and throw `CancellationError` when the deadline is exceeded. Previously,
  generators yielded too infrequently (every 1,000–50,000 iterations), allowing
  a single `gen.next()` call to block for longer than the timeout. All
  generators now yield every iteration. The `Factorial` handler no longer
  silently swallows `CancellationError`, and `withDeadline`/`withDeadlineAsync`
  now use `try/finally` to always reset the engine deadline.

- **Fixed GPU compilation of `Sum`, `Product`, `Loop`, and `Function`**: These
  constructs no longer leak JavaScript-specific syntax (IIFEs, `let`, `while`,
  arrow functions, `{ re, im }` objects) into GLSL/WGSL output. `Sum`/`Product`
  with small constant bounds are unrolled inline; larger ranges emit native
  `for` loops. `Loop` emits a GPU `for` loop with `int`/`i32` index. `Function`
  (lambda) now throws a clear error for GPU targets. Block-level `Declare`
  statements infer `vec2`/`vec2f` type from subsequent complex-valued
  assignments.

- **Added GLSL/WGSL compilation for `Heaviside`, `Sinc`, `FresnelC`, `FresnelS`,
  `BesselJ`**: These five special functions now compile to GPU shader targets.
  `FresnelC`/`FresnelS` use a three-region rational Chebyshev approximation
  (ported from Cephes/scipy) with a shared `_gpu_polevl` helper. `BesselJ` uses
  power series, Hankel asymptotic, and Miller's backward recurrence depending on
  the argument range. Both GLSL and WGSL preambles are emitted on demand.

- **Fixed GLSL/WGSL block expression compilation**: Block expressions (produced
  by `\coloneq` / semicolon blocks) now emit valid GPU shader code instead of
  JavaScript syntax. Variable declarations use `float x` (GLSL) or `var x: f32`
  (WGSL) instead of `let x`, and blocks are emitted as plain statements instead
  of JavaScript IIFEs. `compileFunction` correctly formats multi-statement
  bodies.

- **Fixed `\;` in `\text{where}` clauses**: Visual spacing commands like `\;`,
  `\,`, `\quad`, etc. between comma-separated bindings in where-clauses are now
  correctly skipped instead of being parsed as `HorizontalSpacing` expressions
  wrapped in `InvisibleOperator`.

- **Fixed `require()` returning empty exports on Node 22+** (#292): Because the
  package sets `"type": "module"`, Node treated the UMD `.js` files as ESM,
  breaking the UMD factory pattern. The UMD builds now use a `.cjs` extension so
  Node always treats them as CommonJS.

## 0.53.0 _2026-02-21_

### Runtime and Scoping

- **True lexical scoping for `Function` expressions**: Functions now capture
  their defining scope and resolve free variables from that scope chain (not the
  call site), with a fresh child scope on each call.

- **BigOp scope pollution fixed**: `Sum`, `Product`, and other big operators now
  only declare their index variable locally. Other names are declared in the
  enclosing scope via `noAutoDeclare`.

- **Closure capture for nested functions**: Returned functions now correctly
  capture outer parameters across multiple nesting levels.

- **`EvalContext.values` removed**: Symbol values now live only in
  `BoxedValueDefinition.value`. The per-frame shadow map and `withArguments`
  option were removed.

- **`forget()` now resets values set by `assume()`**: `forget('x')` now clears
  values introduced by `assume('x = ...')` (value reset to `undefined`), in
  addition to clearing assumptions.

### Expressions and Equality

- **`expand()` now returns the input expression instead of `null`**: Both the
  free function and internal `expand()`/`expandAll()` now return the original
  expression when no expansion is possible.

- **New `.toRational()` method**: Returns `[numerator, denominator]` integers
  for rational expressions, or `null` otherwise.

- **New `.factors()` method**: Returns multiplicative factors as a flat array by
  decomposing `Multiply` and `Negate` structurally.

- **`.is()` now tries expansion**: After structural comparison, `.is()` expands
  both sides before numeric fallback, catching forms like `(x+1)^2` and
  `x^2+2x+1`.

- **`.is()` is now symmetric**: `a.is(b) === b.is(a)` now holds across all
  expression types.

### LaTeX Parsing

- **Parse `\mleft`/`\mright` delimiters**: Alternative delimiters from the
  `mleftright` package are now treated like `\left`/`\right`.

- **Parse `\color` in math mode**: `\color{...}` is now recognized in math mode;
  the color argument is consumed so the following math parses normally.

- **Parse `:` and `\colon` as infix operators**: Outside quantifier contexts, a
  bare `:`/`\colon` now parses as `Colon` (e.g. `f:[a,b]\to\R`), without
  affecting `:=` assignment or quantifier syntax.

- **Parse `\dfrac`, `\tfrac`, and `\cfrac` as fractions**: These variants now
  parse the same as `\frac`.

### Fractals

- **New `Mandelbrot` and `Julia` functions**: Added built-in escape-time fractal
  operators. `Mandelbrot(c, maxIter)` and `Julia(z, c, maxIter)` return a
  smooth, normalized value in `[0, 1]` (`1` for interior points, fractional for
  escaping points via `log₂(log₂(|z|²))` smoothing). Both evaluate in JavaScript
  and compile to GLSL/WGSL.

## 0.52.1 _2026-02-19_

### Expressions

- **Exact number literal check**: Use `isNumber(expr) && expr.isExact` to test
  for exact numeric literals.

- **`raw` form preserves subtraction**: `x-1` now parses as
  `["Subtract", "x", "1"]` (instead of `["Add", "x", -1]`) when using raw form.

### Parsing and Blocks

- **Fix `;\;` parsing in semicolon blocks**: Spacing commands after semicolons
  (`\;`, `\,`, `\quad`, etc.) no longer create spurious `Nothing` operands.

- **Fix `\text{if}` parsing with `\;` spacing**:
  `\text{if}\;...\;\text{then}\;...\;\text{else}\;...` now parses correctly as
  `If`.

- **Block serializer now uses `; `**: Serialization emits `; ` (not `;\; `) to
  avoid reintroducing spacing-related parse issues on round-trip.

- **Block compiler filters `Nothing` operands**: The Block compiler now removes
  `Nothing` symbols and empty compile results before generating code.

- **Subscripted variable names in blocks**: Names like `r_1` are treated as
  compound symbols (not `Subscript`) when the base is not a known collection.

- **Non-strict parser supports exponents on bare functions**: In `strict: false`
  mode, forms like `sin^2(x)` and `cos^{10}(x)` now parse correctly as powers.

- **Unicode superscript/subscript digits supported**: Superscript and subscript
  Unicode digits now normalize to `^{...}` / `_{...}` in parsing.

### Compilation

- **Selective GLSL interval preamble**: `interval-glsl` now emits only used
  helper functions (plus dependencies), typically reducing preamble size by
  60-80%.

- **Selective WGSL interval preamble**: `interval-wgsl` now applies the same
  used-only preamble strategy.

- **Fix recursive GLSL gamma helper**: Replaced recursive `_gpu_gamma()`
  reflection logic (illegal in GLSL) with a non-recursive implementation.

### Equality

- **`.is()` now works with assigned variables**: Numeric fallback now applies to
  expressions with no free variables, including variables with assigned values.

- **`.is()` now accepts an optional `tolerance`**: A per-call tolerance can
  override `engine.tolerance` for numeric comparison.

## 0.52.0 _2026-02-18_

### New Features

- **Smart `.is()` / exact `.isSame()` separation**: The `.is()` and `.isSame()`
  methods on expressions now have distinct roles:
  - **`.isSame(v)`** — Fast exact structural check. No evaluation, no tolerance.
    Now accepts primitives (`number`, `bigint`, `boolean`, `string`) in addition
    to `Expression`. This is the method used internally throughout the engine.

  - **`.is(v)`** — Smart check with numeric evaluation fallback. Tries
    `.isSame()` first; if that fails and the expression is constant (no free
    variables), evaluates numerically and compares within `engine.tolerance`.
    For literal numbers, behaves identically to `.isSame()` — tolerance only
    applies to expressions that require evaluation.

  This resolves a common pain point where `ce.parse('\\cos(\\pi/2)').is(0)`
  returned `false` because `.is()` was purely structural. Now it returns `true`:

  ```ts
  ce.parse('\\sin(\\pi)').is(0);            // true  (evaluates, within tolerance)
  ce.parse('\\cos(\\frac{\\pi}{2})').is(0); // true
  ce.number(1e-17).is(0);                   // false (literal number, no tolerance)
  ce.parse('x + 1').is(1);                  // false (not constant, no fallback)
  ```

- **`numericValue()` convenience helper**: New standalone function that combines
  the `isNumber()` guard with `.numericValue` access. Returns the numeric value
  if the expression is a number literal, or `undefined` otherwise. Useful for
  safely extracting numeric values without verbose ternary patterns:

  ```ts
  import { numericValue } from '@cortex-js/compute-engine';

  // Before
  const val = isNumber(expr) ? expr.numericValue : undefined;

  // After
  const val = numericValue(expr);
  ```

- **Stochastic equality check for expressions with unknowns**: `expr.isEqual()`
  now uses a stochastic fallback when symbolic methods (expand + simplify) can't
  prove equality. Both expressions are evaluated at 50 sample points (9
  well-known values + 41 random) and compared with relative+absolute tolerance.
  This detects equivalences like `sin²(x) + cos²(x) = 1`, `(x+y)² = x²+2xy+y²`,
  and `sin(2x) = 2sin(x)cos(x)` that were previously returned as `undefined`.
  Singularities (NaN at a sample point) are skipped rather than treated as
  disagreements. The check also works when the two expressions have different
  unknowns (e.g. `x - x + y` vs `y`).

- **`expr.freeVariables` property**: New property on `BoxedExpression` that
  returns the free variables of an expression — symbols that are not constants,
  not operators, not bound to a value, and not locally scoped by constructs like
  `Sum` or `Product`. Semantically identical to `expr.unknowns`.

- **New interval-js compilation functions**: Added `Binomial`, `GCD`, `LCM`,
  `Chop`, `Erf`, `Erfc`, `Exp2`, `Arctan2`, and `Hypot` to the interval-js
  compilation target, with corresponding interval arithmetic implementations.

- **GLSL/WGSL variable exponent support**: The interval GLSL and WGSL targets
  now support `Power` with variable exponents (e.g. `(-1)^k`, `x^n`). Previously
  these threw at compile time. Added `ia_pow_interval()` to both GPU library
  preambles using four-corner `exp(exp * ln(base))` evaluation with special
  cases for point-integer exponents and `(-1)^n`.

- **`Factorial`, `Gamma`, `GammaLn` for GLSL/WGSL interval targets**: Added
  `ia_factorial` (via `ia_gamma(x+1)`) to both GPU targets. Added `ia_gamma`
  (Lanczos approximation) and `ia_gammaln` (Stirling asymptotic) to the WGSL
  target, matching existing GLSL implementations.

### Resolved Issues

- **`parse()` with `form: 'structural'` ignored the structural flag**: The
  `structural` option from `formToInternal()` was dropped in
  `parseLatexEntrypoint()`, making `ce.parse(s, { form: 'structural' })` behave
  identically to `{ form: 'raw' }` (unbound, unsorted). Now correctly produces a
  bound, structural expression.

- **Partial canonicalization with `'Flatten'` form folded numerics**: Using
  `ce.parse(s, { form: ['Flatten', 'Order'] })` unexpectedly evaluated numeric
  operands (e.g. `3×2+1` became `7`) because `flattenForm()` used
  `ce.function()` which defaults to full canonical mode. Now uses `ce._fn()` to
  preserve operand structure. This enables structural comparison of expressions
  modulo commutativity and associativity without numeric evaluation — useful for
  checking the _method_ used to solve a problem rather than just the numeric
  result:

  ```ts
  const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
  const b = ce.parse('1+2\\times3', { form: ['Flatten', 'Order'] });
  a.isSame(b);  // ➔ true  (same structure, different order)

  const c = ce.parse('7', { form: ['Flatten', 'Order'] });
  a.isSame(c);  // ➔ false (different structure)
  ```

- **Sum/Product with symbolic bounds compiled incorrectly**: Expressions like
  `\sum_{k=0}^{n} f(k, x)` where the upper bound is a variable produced loops
  that iterated 10001 times instead of using the variable `n`. The compilation
  extracted bounds via `normalizeIndexingSet()` which converted symbolic bounds
  to `NaN` and fell back to a hardcoded limit. Now bounds are extracted as
  expressions and compiled to code (e.g. `Math.floor(_.n)` for JS,
  `Math.floor((_.n).hi)` for interval-js). This fixes Taylor series patterns
  like `\sum_{k=0}^{n} \frac{(-1)^k x^{2k+1}}{(2k+1)!}` for both JS and
  interval-js targets.

- **Interval `(-1)^k` returned `empty` instead of correct value**: The
  `powInterval()` function required positive bases for variable exponents,
  causing `(-1)^k` patterns in summations (e.g. Taylor series) to fail at
  runtime. Now correctly delegates to `intPow()` when the exponent is a point
  interval with an integer value, preserving even/odd parity. Also handles the
  case where base is `-1` and the exponent spans multiple integers by returning
  the conservative interval `[-1, 1]`.

- **`Factorial` missing from interval-js compilation target**: Expressions
  containing `n!` (e.g. `\frac{(-1)^k x^{2k+1}}{(2k+1)!}`) failed interval-js
  compilation with `success: false`. Added `Factorial` and `Factorial2` interval
  functions and compilation handlers.

- **`expr.unknowns` included bound variables**: Scoped constructs like `Sum`,
  `Product`, `Integrate`, and `Block` bind index variables in a local scope, but
  `expr.unknowns` was reporting them as free unknowns. For example,
  `\sum_{k=0}^{10} k \cdot x` returned `["k", "x"]` instead of `["x"]`. Now
  correctly excludes locally bound variables from the result.

- **Symbolic upper bounds missing from `expr.unknowns`**: In expressions like
  `\sum_{k=0}^{M} k \cdot x`, the symbolic upper bound `M` was incorrectly
  excluded from `unknowns` because the scope's bindings map captured all symbols
  referenced during canonicalization. Now extracts bound variables structurally
  from `Limits`/`Element`/`Assign`/`Declare` expressions, so only true bound
  variables are excluded. This also fixes `Block` expressions where locally
  assigned variables (via `Assign` or `Declare`) were reported as unknowns.

- **`Integrate` with symbolic bounds compiled incorrectly**: Same issue as
  Sum/Product — `compileIntegrate()` used `normalizeIndexingSet()` which
  converted symbolic bounds to `NaN`. Now uses `extractLimits()` and compiles
  bounds as expressions.

- **Interval `piecewise` test fix**: Fixed test that incorrectly accessed
  `result.lo` directly instead of unwrapping the `IntervalResult` envelope
  (`result.value.lo`). The `piecewise()` function correctly returns
  `IntervalResult` objects.

## 0.51.1 _2026-02-15_

### Features

- **#172 Degrees-Minutes-Seconds (DMS) notation**: Parse and serialize
  geographic angle notation such as `9°30'15"`. The LaTeX parser now recognizes
  arc-minute (`'`, `\prime`) and arc-second (`"`, `\doubleprime`) symbols when
  they follow a degree symbol, producing
  `Add(Quantity(…, deg), Quantity(…, arcmin), …)` expressions that evaluate and
  simplify through the existing unit system. Negative angles (e.g. `-45°30'`)
  are fully supported for latitude/longitude coordinates.
- **`dmsFormat` serialization option**: Set `dmsFormat: true` in
  `SerializeLatexOptions` to serialize angle quantities as DMS notation (e.g.
  `Quantity(9.5, deg)` → `9°30'`).
- **`angleNormalization` serialization option**: Normalize angles during
  serialization with `'0...360'` (useful for bearings) or `'-180...180'` (useful
  for longitude). Default is `'none'`.
- **`realOnly` compilation option**: Pass `{ realOnly: true }` to `compile()` to
  automatically convert complex `{ re, im }` results to real numbers — returns
  `re` when `im === 0`, `NaN` otherwise. Useful for plotting and other contexts
  that only need real-valued output.
- **`Sinc` function**: Unnormalized cardinal sine `sinc(x) = sin(x)/x` with
  `sinc(0) = 1`. Includes LaTeX parsing via `\operatorname{sinc}`, JavaScript
  and interval-arithmetic compilation targets.
- **Fresnel integrals (`FresnelS`, `FresnelC`)**: Numeric evaluation using
  Cephes rational Chebyshev approximation, LaTeX parsing via
  `\operatorname{FresnelS}` / `\operatorname{FresnelC}`, JavaScript and
  interval-arithmetic compilation targets.
- **`Heaviside` step function**: `H(x) = 0` for `x < 0`, `1/2` for `x = 0`, `1`
  for `x > 0`. LaTeX parsing via `\operatorname{Heaviside}`, JavaScript and
  interval-arithmetic compilation with singularity detection at zero.

### LaTeX Syntax

- **`Which` compilation**: `\begin{cases}` expressions now compile to JavaScript
  and interval-js targets as chained ternary operators with `NaN` fallback when
  no condition matches.
- **`Sum`/`Product` compilation**: `\sum_{k=a}^{b}` and `\prod_{k=a}^{b}`
  expressions with numeric bounds now compile to JavaScript loops with
  accumulator variables, including complex number support.
- **`Loop` compilation**: `Loop`, `Break`, `Continue`, and `Return` operators
  compile to JavaScript `for` loops wrapped in IIFEs with standard control flow
  keywords.
- **Inline `If` syntax**: Parse `\text{if } C \text{ then } A \text{ else } B`
  (or `\operatorname{if}`) to `["If", C, A, B]` expressions.
- **`where` syntax**: Parse `E \text{ where } x \coloneq V` to `Block`
  expressions with implicit variable declarations.
- **Semicolon block syntax**: Semicolons (`;`, `\;`) act as statement
  separators, building `Block` expressions with auto-declared variables when
  assignments are present.
- **`for` loop syntax**: Parse
  `\text{for } i \text{ from } a \text{ to } b \text{ do } body` to
  `["Loop", body, ["Element", "i", ["Range", a, b]]]`.

### Resolved Issues

- **Interval-JS compilation for Gamma functions**: Added missing `gamma` and
  `gammaln` exports and implementations in the interval-arithmetic library.
- **Interval-JS graceful fallback**: The `interval-js` target no longer throws
  when encountering unsupported functions. Unsupported operators now produce
  `{ success: false }` at compile time, and runtime errors return
  `{ kind: "entire" }` instead of propagating.
- **`CompilationResult.run` type signature**: The TypeScript type for `run` now
  correctly reflects the actual calling convention (`(...args: unknown[])`)
  instead of the previous misleading `(...args: (number | {re, im})[])`.
- **`Loop` compilation for interval-js target**: Loop counter now uses raw
  numbers (not `_IA.point()`) for the `for` statement, with loop index
  references properly wrapped in the body. Conditions in `if`/`break`/
  `continue` statements inside loops use scalar comparisons instead of interval
  comparison functions.

### Other Changes

- Updated color palettes
- Deduplicated runtime helper object (`SYS_HELPERS`) shared between
  `ComputeEngineFunction` and `ComputeEngineFunctionLiteral` in compilation
  target
- Centralized `sinc` implementation in `numerics/special-functions.ts` (shared
  by library evaluation and JS compilation runtime)
- Removed dead `args === null` checks in compilation base class

## 0.51.0 _2026-02-14_

### Colors

- **New `colors` library**: Four MathJSON operators for color manipulation and
  color space conversion, available as the `"colors"` library category.
- **`Color`**: Parse a color string (hex 3/6/8-digit, `rgb()`, `hsl()`, named
  CSS color, `transparent`) into a canonical sRGB `Tuple` with components
  normalized to 0-1. Alpha is included as a fourth component when not equal
  to 1.
- **`Colormap`**: Sample named visualization palettes. Three variants: no second
  argument returns the full palette as a `List`; integer _n_ >= 2 resamples to
  _n_ evenly spaced colors; real _t_ in [0, 1] interpolates at position _t_
  using OKLCh color space with shorter-arc hue interpolation. Includes 8
  sequential palettes (viridis, inferno, magma, plasma, cividis, turbo, rocket,
  mako), 6 categorical palettes (graph6, spectrum6, spectrum12, tableau10,
  tycho11, kelly22), and 12 diverging palettes (roma, vik, broc, rdbu, coolwarm,
  ocean-balance, plus reversed variants).
- **`ColorToColorspace`**: Convert an sRGB color (string or `Tuple`) to
  components in `"rgb"`, `"hsl"`, `"oklch"`, or `"oklab"` (alias `"lab"`).
  Preserves alpha when present.
- **`ColorFromColorspace`**: Convert color space components back to a canonical
  sRGB `Tuple`. Accepts the same color space names as `ColorToColorspace`.
- **`ColorToString`**: Convert a color (string or sRGB `Tuple`) to a formatted
  string. Supports optional format argument: `"hex"` (default), `"rgb"`,
  `"hsl"`, or `"oklch"` for CSS-style output. Alpha is included when not equal
  to 1.
- **`ColorMix`**: Blend two colors in OKLCh space with an optional ratio
  (default 0.5). Accepts color strings or sRGB `Tuple` values. Interpolates
  lightness and chroma linearly, hue with shorter-arc interpolation.
- **`ColorContrast`**: Compute the APCA contrast ratio between a background and
  foreground color. Returns a positive value for dark-on-light and negative for
  light-on-dark.
- **`ContrastingColor`**: Choose the foreground color with better APCA contrast
  against a background. With one argument, picks between white and black. With
  three arguments, picks the better of two foreground candidates.
- **LaTeX color support**: `\textcolor{color}{body}`, `\colorbox{color}{body}`,
  and `\boxed{body}` now roundtrip through `Annotated` expressions. Parsing and
  serialization are handled in the core `Annotated` infrastructure.
- **LaTeX font annotations**: `\textbf`, `\textit`, `\texttt`, `\textsf`,
  `\textup` now serialize correctly from `Annotated` expressions via
  `fontWeight`, `fontStyle`, and `fontFamily` dict keys.
- **JavaScript compilation**: All color operators (`Color`, `ColorToString`,
  `ColorMix`, `ColorContrast`, `ContrastingColor`, `ColorToColorspace`,
  `ColorFromColorspace`, `Colormap`) now compile to JavaScript.
- **`oklab()` CSS parsing**: `parseColor()` now accepts `oklab(L a b)` and
  `oklab(L a b / alpha)` syntax, matching the existing `oklch()` support.
- **GPU compilation**: `ColorMix`, `ColorContrast`, `ContrastingColor`,
  `ColorToColorspace`, and `ColorFromColorspace` now compile to GLSL and WGSL.
  Preamble functions provide sRGB ↔ OKLab ↔ OKLCh conversion, color mixing with
  shorter-arc hue interpolation, and APCA contrast on the GPU.
- Added `rgbToHsl()` conversion function. Exported `hslToRgb()` (previously
  private).

### Resolved Issues

- **(#290) Derivatives of user-defined functions**: `\frac{d}{dx} f` and `f'(x)`
  now correctly evaluate when `f` is a user-defined function (e.g.,
  `f(x) := 2x`). Previously `\frac{d}{dx} f` returned `0` and `f'(x)` returned a
  symbolic `Apply(Derivative(...))`.
- **Cleaner `D` canonical form**: `f'(x)` now canonicalizes to
  `["D", ["f", "x"], "x"]` instead of the verbose
  `["D", ["Function", ["Block", ["f", "x"]], "x"], "x"]`. Function calls are no
  longer redundantly wrapped in `Function(Block(...))`. Similarly,
  `\frac{d}{dx} f` where `f` is a known function symbol canonicalizes to
  `["D", ["f", "x"], "x"]` by applying the function to the differentiation
  variable.

### Free Functions

- Free functions (`simplify`, `evaluate`, `N`, `expand`, `expandAll`, `factor`,
  `solve`, `compile`) now accept `ExpressionInput` in addition to `LatexString`
  and `Expression`. This means you can pass numbers, MathJSON objects, or tuple
  arrays directly — e.g., `evaluate(["Add", 1, 2])` or
  `simplify(["Power", "x", 2])`.
- Added `declare()` free function to declare symbols without instantiating a
  `ComputeEngine` explicitly — e.g., `declare('x', 'integer')` or
  `declare({ x: 'integer', y: 'real' })`.

### Units and Quantities

- **New `units` library**: A comprehensive unit system for physical quantities,
  available as the `"units"` library category. Supports SI base units, 18 named
  derived units, SI prefixes (quetta through quecto), and common non-SI units
  (imperial, angles, logarithmic).
- **`Quantity` expression**: Pairs a numeric value with a unit:
  `["Quantity", 9.8, ["Divide", "m", ["Power", "s", 2]]]`. Accessors
  `QuantityMagnitude` and `QuantityUnit` extract the parts.
- **Quantity arithmetic**: `Add`, `Subtract`, `Multiply`, `Divide`, and `Power`
  are unit-aware. Addition and subtraction automatically convert compatible
  units and express the result in the unit with the largest scale factor (e.g.,
  `12 cm + 1 m` evaluates to `1.12 m`). Incompatible dimensions remain
  unevaluated.
- **Unit conversion**: `UnitConvert` converts between compatible units,
  including compound units like `m/s` to `km/h`. Supports affine temperature
  conversions (`degC`, `degF`, `K`). Returns an error for incompatible units.
  `UnitSimplify` reduces compound units to named derived units when possible
  (e.g., `kg*m/s^2` to `N`).
- **Dimensional analysis**: `IsCompatibleUnit` tests dimensional compatibility.
  `UnitDimension` returns the 7-element SI dimension vector. Both support
  compound unit expressions.
- **LaTeX parsing**: `\mathrm{...}` and `\text{...}` containing recognized units
  produce `Quantity` expressions when juxtaposed with numbers. Compound units
  with `/`, `^`, and `\cdot` are supported (e.g., `5\,\mathrm{m/s^{2}}`).
- **siunitx commands**: `\qty{value}{unit}`, `\SI{value}{unit}`, `\unit{unit}`,
  and `\si{unit}` are parsed.
- **LaTeX serialization**: `Quantity` expressions serialize to
  `value\,\mathrm{unit}` notation.
- **DSL string sugar**: Compound units can be specified as strings in MathJSON:
  `["Quantity", 9.8, "m/s^2"]` is canonicalized to the structured form.
  Parentheses are supported for grouping: `"kg/(m*s^2)"`.
- **Temperature units**: `degC` and `degF` with affine offset conversions.
- **Angular unit unification**: Trigonometric functions (`Sin`, `Cos`, `Tan`,
  etc.) accept `Quantity` arguments with angular units (`deg`, `rad`, `grad`,
  `arcmin`, `arcsec`) and convert to radians automatically.
- **Physics constants**: 11 CODATA 2018 constants defined as `Quantity`
  expressions: `SpeedOfLight`, `PlanckConstant`, `Mu0`, `StandardGravity`,
  `ElementaryCharge`, `BoltzmannConstant`, `AvogadroConstant`,
  `VacuumPermittivity`, `GravitationalConstant`, `StefanBoltzmannConstant`, and
  `GasConstant`.

### Compilation

- **Tuple and Matrix compilation**: `Tuple` and `Matrix` expressions can now be
  compiled across all targets. `compile('(\\sin(t), \\cos(t))')` produces
  `[Math.sin(t), Math.cos(t)]` in JavaScript, `vec2(sin(t), cos(t))` in GLSL,
  `vec2f(sin(t), cos(t))` in WGSL, and `(np.sin(t), np.cos(t))` in Python.
- **GPU-native matrix types**: Square matrices (2x2, 3x3, 4x4) compile to native
  GPU matrix constructors (`mat2`/`mat3`/`mat4` in GLSL,
  `mat2x2f`/`mat3x3f`/`mat4x4f` in WGSL) with proper column-major transposition.
  Column vectors are flattened to `vecN`/`vecNf` instead of nested
  single-element arrays.
- **Complex number compilation**: The JavaScript compilation target now supports
  complex-valued expressions. The compiler performs static type analysis at
  compile time to determine whether each subexpression is real or complex, and
  emits the appropriate code path. Simple arithmetic (Add, Subtract, Multiply,
  Divide, Negate) uses inline `{re, im}` field math to avoid allocation.
  Transcendental functions (Sin, Cos, Exp, Ln, Sqrt, Power, and others) delegate
  to runtime helpers backed by the `complex-esm` library. Mixed real/complex
  operands are promoted inline. `ImaginaryUnit` compiles to `{re: 0, im: 1}`.
  Symbols with unknown type are assumed real. Complex-aware `Sum` and `Product`
  loops emit `{re, im}` accumulators when the loop body is complex-valued.
  Reciprocal trig/hyperbolic functions (Cot, Sec, Csc, Coth, Sech, Csch) and
  their inverses dispatch to complex helpers when operands are complex.
- **Python complex compilation**: The Python target now supports complex-valued
  expressions using Python's native `complex()` constructor and the `cmath`
  module for transcendental functions. Real-valued expressions continue to use
  NumPy.
- **Gamma function compilation**: `Gamma` and `GammaLn` can now be compiled to
  `interval-js`, `glsl`, `wgsl`, and `interval-glsl` targets. The interval
  targets include pole detection at non-positive integers and correct
  monotonicity handling around the minimum at x ≈ 1.46.
- **Special function compilation**: 27 additional functions can now be compiled
  to JavaScript: `Erf`, `Erfc`, `ErfInv`, `Beta`, `Digamma`, `Trigamma`,
  `PolyGamma`, `Zeta`, `LambertW`, `BesselJ`, `BesselY`, `BesselI`, `BesselK`,
  `AiryAi`, `AiryBi`, `Factorial`, `Factorial2`, `Exp2`, `Log2`, `Log10`, `Lg`,
  `Arctan2`, `Hypot`, `Degrees`, `Haversine`, `InverseHaversine`, `Binomial`,
  and `Fibonacci`.
- **GPU special functions**: `Erf`, `Erfc`, `ErfInv`, `Beta`, `Factorial`,
  `Arctan2`, `Hypot`, `Haversine`, `InverseHaversine`, `Log10`, and `Lg` can now
  be compiled to GLSL and WGSL targets. `Erf`/`ErfInv` use Abramowitz & Stegun
  polynomial approximations; `Beta` and `Factorial` leverage the existing GPU
  Gamma preamble.

### Simplification

- **Factorial quotient simplification**: `n!/k!` is now simplified to a partial
  product for both concrete integers (e.g., `10!/7!` → `720`) and symbolic
  expressions with small constant difference (e.g., `n!/(n-2)!` → `n(n-1)`).
- **Binomial detection**: Expressions of the form `n!/(k!(n-k)!)` are
  automatically recognized and simplified to `Binomial(n, k)`.
- **Binomial identity simplification**: `C(n,0)` → `1`, `C(n,1)` → `n`, `C(n,n)`
  → `1`, `C(n,n-1)` → `n`.
- **Factorial sum factoring**: Sums and differences of factorials with related
  arguments are factored out, e.g., `n! - (n-1)!` → `(n-1)! * (n-1)`,
  `(n+1)! + n!` → `n! * (n+2)`.

## 0.50.2 _2026-02-12_

### Numerics

- **Centralized overflow protection**: Improved robustness of `Rational` and
  `ExactNumericValue` arithmetic by centralizing overflow checks and automatic
  promotion to `BigInt`.
- **\[#287\](https://github.com/cortex-js/compute-engine/issues/287) Improved
  precision for large integer products**: Multiplications and additions of large
  integers that would previously lose precision (exceeding
  `Number.MAX_SAFE_INTEGER`) are now automatically promoted to `BigInt` to
  maintain exact results.

### Symbols

- **[\#288](https://github.com/cortex-js/compute-engine/issues/288) Allow
  reassigning a symbol from operator to value**: `ce.assign()` no longer throws
  when assigning a plain value to a symbol that was previously declared as a
  function. Existing expressions using the symbol as a function head will
  produce a type error at evaluation time if the new value is not callable.

### Evaluation

- **Fixed scope leaks**: Ensured that evaluation contexts are correctly popped
  even when an error or timeout occurs in `BoxedFunction.evaluate()`,
  `findUnivariateRoots()`, and rule-boxing operations.
- **Improved numerical evaluation performance**: `Sum`, `Product`, `Divide`, and
  statistical operators (`Mean`, `Variance`, etc.) now correctly propagate the
  `numericApproximation` option, significantly speeding up large numerical
  calculations by avoiding expensive exact arithmetic.

## 0.50.1 _2026-02-11_

### Compilation

- **`CompilationResult.preamble` for shader targets**: `compile()` with
  `interval-wgsl` and `interval-glsl` targets now returns a `preamble` field
  containing the interval arithmetic library (struct definitions, helper
  functions). Previously, the compiled `code` referenced functions like `ia_div`
  and `ia_sin` that were not included in the output. Use `preamble + code` for a
  self-contained shader, or call `compileShaderFunction()` on the target
  directly.

## 0.50.0 _2026-02-11_

### Breaking API Changes

This release includes several breaking changes to the public API.

The most significant is the restructuring of the `Expression` type hierarchy and
the introduction of type-guarded role interfaces, which improves type safety and
API ergonomics but requires updates to code that accessed role-specific
properties directly on expression instances.

See
[`MIGRATION_GUIDE_0.50.0.md`](https://github.com/cortex-js/compute-engine/blob/main/MIGRATION_GUIDE_0.50.0.md)
for details.

#### Naming Alignment: `Expression`, `MathJsonExpression`, and `ExpressionInput`

- The compute-engine runtime type is now `Expression` (preferred name).
  `BoxedExpression` is retained as a deprecated alias for migration.
- The MathJSON type is now `MathJsonExpression` (the old MathJSON `Expression`
  name has been removed from the `math-json` entrypoint).
- `SemiBoxedExpression` is now `ExpressionInput` (with a deprecated alias for
  migration).

#### Role-Specific Properties Moved to Type-Guarded Interfaces

Properties that were previously on all `Expression` instances (returning
`undefined` when not applicable) have been moved to role interfaces. They are
now only accessible after narrowing with a type guard.

| Removed from `Expression`             | Access via                                                           |
| :------------------------------------ | :------------------------------------------------------------------- |
| `.symbol`                             | `isSymbol(expr)` or `isSymbol(expr, 'Pi')` then `expr.symbol`        |
| `.string`                             | `isString(expr)` then `expr.string`                                  |
| `.ops`, `.nops`, `.op1`/`.op2`/`.op3` | `isFunction(expr)` or `isFunction(expr, 'Add')` then `expr.ops` etc. |
| `.numericValue`, `.isNumberLiteral`   | `isNumber(expr)` then `expr.numericValue`                            |
| `.tensor`                             | `isTensor(expr)` then `expr.tensor`                                  |

```ts
// Before
if (expr.symbol !== null) console.log(expr.symbol);

// After
import { isSymbol, sym } from '@cortex-js/compute-engine';

if (isSymbol(expr)) console.log(expr.symbol);
// isSymbol() accepts an optional symbol name:
if (isSymbol(expr, 'Pi')) { /* expr is the Pi symbol */ }
// or use the convenience helper:
if (sym(expr) === 'Pi') { /* ... */ }

// isFunction() accepts an optional operator name:
if (isFunction(expr, 'Add')) {
  // expr is narrowed to a function AND has operator 'Add'
  console.log(expr.ops);
}
```

Properties that remain on `Expression`: `.operator`, `.re`/`.im`, `.shape`, all
arithmetic methods (`.add()`, `.mul()`, etc.), and all numeric predicates
(`.isPositive`, `.isInteger`, etc.).

#### Expression Creation: `form` Replaces `canonical`/`structural`

The `canonical` (boolean or array) and `structural` (boolean) options on
`ce.box()`, `ce.function()`, and `ce.parse()` have been unified into a single
`form` option.

```ts
ce.box(['Add', 1, 'x'], { form: 'canonical' }); // default
ce.box(['Add', 1, 'x'], { form: 'raw' });        // no canonicalization, no binding
ce.function('Add', [1, 'x'], { form: 'structural' }); // bound, not fully canonical
ce.box(['Add', 1, 'x'], { form: ['Number', 'Order'] }); // selective passes
```

#### New Free Functions

Top-level free functions are now available for common operations and use a
shared `ComputeEngine` instance created on first call.

| Function                               | Purpose                                                        |
| :------------------------------------- | :------------------------------------------------------------- |
| `getDefaultEngine()`                   | Return the shared default `ComputeEngine` instance.            |
| `parse(latex)`                         | Parse a LaTeX string into an `Expression`.                     |
| `simplify(exprOrLatex)`                | Simplify an expression or LaTeX input.                         |
| `evaluate(exprOrLatex)`                | Evaluate an expression or LaTeX input symbolically.            |
| `N(exprOrLatex)`                       | Numerically evaluate an expression or LaTeX input.             |
| `assign(id, value)` / `assign(record)` | Assign one symbol value or many at once.                       |
| `expand(exprOrLatex)`                  | Expand distributively at the top level (`Expression \| null`). |
| `expandAll(exprOrLatex)`               | Expand distributively recursively (`Expression \| null`).      |
| `solve(exprOrLatex, vars?)`            | Solve equations/systems (returns solve result variants).       |
| `factor(exprOrLatex)`                  | Factor an expression.                                          |
| `compile(exprOrLatex, options?)`       | Compile to a target language with `CompilationResult`.         |

```ts
import {
  getDefaultEngine,
  parse,
  simplify,
  evaluate,
  N,
  assign,
  expand,
  expandAll,
  solve,
  factor,
  compile,
} from '@cortex-js/compute-engine';

assign('x', 3);

const expr = parse('x^2 - 5x + 6');
solve(expr, 'x');           // [2, 3]
factor('(2x)(4y)');         // 8xy
compile('x^2 + 1').run({ x: 3 }); // 10
```

Except for `parse()`, `assign()`, and `getDefaultEngine()`, these free functions
accept either a LaTeX string or an existing `Expression`.

#### Free Function Notes

- `compile()` is now a top-level entry point returning `CompilationResult`.
  Custom compilation targets are managed with `ce.registerCompilationTarget()`
  and `ce.unregisterCompilationTarget()`.
- `expand()` and `expandAll()` return `null` when an expression is not
  expandable.
- `solve()` is available as a top-level wrapper over equation/system solving.
- `factor()` is the top-level factoring entry point. Specialized helpers such as
  `factorPolynomial()` and `factorQuadratic()` remain expression-only APIs.

#### `trigSimplify()` Method Removed

Use `simplify({ strategy: 'fu' })` instead, which is equivalent.

```ts
// Before
const result = expr.trigSimplify();

// After
const result = expr.simplify({ strategy: 'fu' });
```

#### Library System

The constructor now accepts a `libraries` option for controlling which libraries
are loaded. Libraries declare their dependencies and are loaded in topological
order.

```ts
// Load specific standard libraries
const ce = new ComputeEngine({
  libraries: ['core', 'arithmetic', 'trigonometry'],
});

// Add a custom library
const ce = new ComputeEngine({
  libraries: [
    ...ComputeEngine.getStandardLibrary(),
    { name: 'physics', requires: ['arithmetic'], definitions: { /* ... */ } },
  ],
});
```

#### User-Extensible Simplification Rules

`ce.simplificationRules` is now a public getter/setter. Users can push
additional rules or replace the entire rule set.

```ts
ce.simplificationRules.push({
  match: ['Power', ['Sin', '_x'], 2],
  replace: ['Subtract', 1, ['Power', ['Cos', '_x'], 2]],
});
```

### Canonicalization

- **Exact numeric folding during canonicalization**: `canonicalAdd` and
  `canonicalMultiply` now fold **exact** numeric operands at canonicalization
  time, making behavior consistent with `canonicalDivide` which already folded
  coefficients. This means expressions are reduced earlier in the pipeline
  without waiting for a `.simplify()` call.

  **What gets folded** (exact values):
  - Integers: `Add(2, x, 5)` &rarr; `Add(x, 7)`
  - Rationals: `Add(1/3, x, 2/3)` &rarr; `Add(x, 1)`
  - Radicals: `Add(√2, x, √2)` &rarr; `Add(x, 2√2)`
  - Mixed exact: `Multiply(2, x, 5)` &rarr; `Multiply(10, x)`
  - Full reduction: `Add(2, 3)` &rarr; `5`, `Multiply(2, 3)` &rarr; `6`
  - Identity elimination: `Multiply(1/2, x, 2)` &rarr; `x`
  - Complex promotion: `Add(1, Complex(0, -1))` &rarr; `Complex(1, -1)`

  **What is NOT folded** (non-exact values):
  - Machine floats: `Add(1.5, x, 0.5)` remains `Add(x, 0.5, 1.5)`
  - Infinity/NaN: `Multiply(0, ∞)` correctly returns `NaN`
  - Single numeric: `Multiply(5, Pi)` is unchanged (nothing to fold)

  The folding uses the existing `ExactNumericValue` arithmetic, which
  automatically handles radical grouping (`√2 + √2 = 2√2`) and rational
  simplification (`1/3 + 2/3 = 1`).

- **Exact numeric folding in `canonicalPower`**: Integer powers of numeric
  literals are now folded during canonicalization when the exponent is an
  integer with |e| &le; 64. For machine-number bases, the result must be a safe
  integer; for exact numeric values (rationals, radicals), `NumericValue.pow()`
  is used.
  - `Power(2, 3)` &rarr; `8`
  - `Power(3, 2)` &rarr; `9`
  - `Power(1/2, 2)` &rarr; `1/4`
  - `Power(-2, 3)` &rarr; `-8`
  - `Power(2, 100)` remains unevaluated (exponent exceeds limit)

- **Complex promotion handles non-adjacent operands**: `canonicalAdd` now
  combines a real float with imaginary terms even when they are not adjacent in
  the operand list. Previously, only a real immediately followed by an imaginary
  was promoted to a complex number.

### Type Inference

- **Type handlers for 25 operators**: Added explicit `type` handlers to
  operators that were missing them, enabling the type system to return precise
  types instead of the broad signature return type.
  - **Arithmetic**: `Factorial`, `Factorial2`, `Sign` return `finite_integer`;
    `Ceil` and `Floor` return `finite_integer` for finite inputs, `integer`
    otherwise.
  - **Trigonometry**: `Arctan` uses `numericTypeHandler` (returns `finite_real`
    for real inputs, `finite_number` for complex).
  - **Complex**: `Real`, `Imaginary`, `Argument` return `finite_real`.
  - **Number theory**: `Totient`, `Sigma0`, `Sigma1`, `Eulerian`, `Stirling`,
    `NPartition` return `finite_integer`; `SigmaMinus1` returns
    `finite_rational`.
  - **Combinatorics**: `Choose`, `Fibonacci`, `Binomial`, `Multinomial`,
    `Subfactorial`, `BellNumber` return `finite_integer`.
  - **`Truncate`, `GCD`, `LCM` type handlers**: `Truncate` returns
    `finite_integer` for finite inputs (matching `Ceil`/`Floor`); `GCD` and
    `LCM` always return `finite_integer`.

### Solving

- **`And` operator support for systems of equations**: `solve()` now accepts
  `And(Equal(...), Equal(...))` in addition to `List(Equal(...), Equal(...))`
  for representing systems of equations. Both forms route through the same
  linear, polynomial, and inequality solvers.

- **Parametric solution type filtering**: `filterSolutionByTypes` now uses
  `=== false` instead of `!== true` for type predicate checks. This allows
  underdetermined (parametric) solutions to pass through when type predicates
  return `undefined` (unknown) rather than being incorrectly rejected.

- **`Or` operator support in `solve()`**: Solving `Or(Equal(x,1), Equal(x,2))`
  returns the union of solutions from each branch, with deduplication. Works for
  both univariate (returns array of values) and multivariate (returns array of
  records) cases.

- **Mixed equality + inequality systems**: `solve()` now handles systems
  combining `Equal` and inequality operators (`Less`, `LessEqual`, `Greater`,
  `GreaterEqual`). Equalities are solved first, then solutions are filtered
  against the inequalities.

- **Parametric solutions omit free variables**: Underdetermined linear systems
  no longer include free variables (self-referential entries) in the result
  record. Only dependent variables with non-trivial expressions are returned.

### Special Functions

- **Numeric evaluation for Digamma, Trigamma, PolyGamma, Beta, Zeta, LambertW**:
  These six functions now evaluate numerically when `.N()` is called, at both
  machine precision and arbitrary precision (bignum). Returns unevaluated
  without numeric approximation.
  - `Digamma`/`Trigamma`: recurrence + asymptotic with Bernoulli numbers
  - `PolyGamma`: generalized recurrence for arbitrary order n
  - `Beta`: via gamma, with log-gamma fallback for large arguments
  - `Zeta`: Cohen-Villegas-Zagier acceleration, functional equation for
    $\operatorname{Re}(s)<0$
  - `LambertW`: Halley's method with branch-point handling

- **Arbitrary-precision (bignum) variants for special functions**: When
  `ce.precision > 15`, `Digamma`, `Trigamma`, `PolyGamma`, `Beta`, `Zeta`, and
  `LambertW` now compute results to the requested precision using bignum
  arithmetic. The asymptotic shift threshold scales with precision to maintain
  accuracy (e.g., `ce.precision = 50` produces 50-digit results for Digamma and
  Zeta).

- **Numeric evaluation for Bessel functions (`BesselJ`, `BesselY`, `BesselI`,
  `BesselK`)**: Integer-order Bessel functions now evaluate numerically.
  - `BesselJ`: power series for small $|x|$, Miller's backward recurrence for
    intermediate values, Hankel asymptotic expansion for large $|x|$
  - `BesselY`: DLMF 10.8.3 series for $Y_0$/$Y_1$, forward recurrence for higher
    orders, shared Hankel asymptotic with `BesselJ`
  - `BesselI`: power series + asymptotic expansion
  - `BesselK`: series for $K_0$, Wronskian-derived $K_1$, forward recurrence for
    higher orders, asymptotic for large $x$

- **Numeric evaluation for Airy functions (`AiryAi`, `AiryBi`)**: Power series
  using Maclaurin coefficients for $|x| \leq 5$, asymptotic expansions
  (exponential decay for Ai, exponential growth for Bi at positive $x$,
  oscillatory for negative $x$) for large arguments.

### Linear Algebra

(Fix [#285](https://github.com/cortex-js/compute-engine/issues/285))

- **`\begin{vmatrix}` now parses to `Determinant`**: The `vmatrix` LaTeX
  environment now produces `["Determinant", ["Matrix", ...]]` instead of
  `["Matrix", ..., "'||'"]`. Serialization round-trips correctly back to
  `\begin{vmatrix}...\end{vmatrix}` when the argument is a `Matrix` expression,
  and uses `\det\left(...\right)` for symbol arguments.

- **`\begin{Vmatrix}` now parses to `Norm`**: The `Vmatrix` LaTeX environment
  now produces `["Norm", ["Matrix", ...]]` instead of `["Matrix", ..., "'‖‖'"]`.
  Serialization round-trips to `\begin{Vmatrix}...\end{Vmatrix}` when the
  argument is a `Matrix`, and uses `\left\Vert...\right\Vert` for symbol
  arguments.

- **`A^{-1}` produces `Inverse` for matrix-typed symbols and matrix
  expressions**: When a symbol is declared with type `matrix`, parsing `A^{-1}`
  now returns `["Inverse", "A"]` instead of `["Power", "A", -1]`. This also
  works for inline matrix expressions, e.g.
  `\begin{pmatrix}...\end{pmatrix}^{-1}`. Undeclared symbols still fall through
  to the default `Power`/`Divide` handling, and function symbols still produce
  `InverseFunction` (e.g., `\sin^{-1}` &rarr; `Arcsin`).

- **`Inverse` serializes as `^{-1}`**: `["Inverse", "A"]` now serializes to
  `A^{-1}` instead of `\mathrm{Inverse}(A)`.

- **`Power(A, -1)` canonicalizes to `Inverse(A)` for matrices**: When `A` has a
  matrix type, `ce.box(["Power", "A", -1])` now canonicalizes to
  `["Inverse", "A"]` instead of `["Divide", 1, "A"]`.

- **`\det(A)` and `\tr(A)` now parse correctly**: Fixed `Determinant` and
  `Trace` LaTeX dictionary entries to use `latexTrigger` (`\det`, `\tr`) instead
  of `symbolTrigger`, which only matches plain identifiers. Both functions also
  accept plain text forms (`det(A)`, `tr(A)`).

- **`\det A` and `\tr A` work without parentheses**: `Determinant` and `Trace`
  now accept implicit arguments, so `\det A` parses as `["Determinant", "A"]`
  (like `\cos x` parses as `["Cos", "x"]`). Implicit arguments bind at
  multiplication precedence, so `\det 2A + 1` parses as `det(2A) + 1`.

- **`Determinant` serialization uses `\det A` for simple arguments**: Symbol
  arguments serialize as `\det A` instead of `\det\left(A\right)`. Matrix
  arguments still serialize as `\begin{vmatrix}...\end{vmatrix}`.

- **Added standard LaTeX operators `\ker`, `\dim`, `\deg`, `\hom`**: These
  commands are now in the MathJSON LaTeX dictionary as function entries with
  implicit arguments, so forms like `\ker V`, `\dim V`, `\deg p`, and
  `\hom(V, W)` parse correctly and serialize back to the corresponding standard
  operator notation. The corresponding function symbols (`Kernel`, `Dimension`,
  `Degree`, `Hom`) are also registered in the linear algebra library.

- **Implemented runtime evaluation for `Kernel`, `Dimension`, `Degree`, and
  `Hom`**:
  - `Kernel` now computes a numeric null-space basis (for scalar/vector/matrix
    real inputs) and returns it as a list of basis vectors.
  - `Dimension` now evaluates finite dimensions for concrete tensors and
    collections, and computes `dim(Hom(V, W)) = dim(V) * dim(W)` when both
    dimensions are inferable.
  - `Degree` now evaluates polynomial degree for polynomial-form expressions
    while keeping ambiguous bare symbols (for example `Degree(p)`) unevaluated.
  - `Hom` now evaluates/simplifies its arguments while preserving the symbolic
    `Hom(...)` form.

#### LaTeX Parsing

- **`arguments: 'implicit'` option for function dictionary entries**: Function
  entries in the LaTeX dictionary can now set `arguments: 'implicit'` to accept
  bare arguments without parentheses (e.g., `\det A`), matching the behavior of
  trig functions. The default remains `'enclosure'` (parentheses required).
  Applied to `\det`, `\tr`, `\Re`, `\Im`, `\arg`, `\max`, `\min`, `\sup`,
  `\inf`.

### Simplification

- **Infinity handling for 24+ functions**: `arctan(∞)`, `arccot(±∞)`,
  `tanh/coth/sech/csch(±∞)`, `arsinh(-∞)`, `arcosh(-∞)`, `arccoth(±∞)`,
  `arcsch(±∞)`, `π^∞`, `∞^n`, `(-∞)^{-n}`, `log_∞(x)`, `log_{0.5}(∞)`, `√∞`,
  `∛∞` now all return correct limits.

- **Root edge cases**: `Root(x, 0) → NaN`, `Root(0, n)`, `Root(1, n)`,
  `Root(+∞, n)`, and `Sqrt(+∞)` now handled correctly.

- **Division edge cases**: `a/a → 1` now works for compound expressions (e.g.,
  `(π+1)/(π+1)`); `2/0 → ComplexInfinity` and `1/(1/0) → 0` propagate correctly.

- **Logarithm edge cases**: Fixed infinity detection in `simplify-log.ts` (was
  using `sym()` which fails on `BoxedNumber` infinity values); added
  `log_∞(∞) → NaN`, base-aware `log_c(0)`, guards for `log_1(x)` and
  `log_c(c^x)` evaluation.

- **Absolute value of odd functions**: `|arcsin(x)|`, `|sinh(x)|`,
  `|arsinh(x)|`, `|artanh(x)|` now simplify to `f(|x|)`.

- **Even function with abs argument**: `cosh(|x+2|) → cosh(x+2)`.

- **Trig period shifts**: `cot(π+x) → cot(x)`, `csc(π+x) → -csc(x)`.

- **Ln simplification in Add/Multiply operands**: `ln(x^3) − 3·ln(x) → 0` and
  `ln(x^√2) → √2·ln(x)` now work; cost function bypassed for log rules that are
  mathematically valid but structurally more expensive.

- **Preserved function identity**: Removed unconditional expansions of
  `sinh/cosh → exp`, `arsinh/arcosh/artanh → ln`, and `arcsin → arctan2` that
  prevented abs/odd-function rules from firing.

### Compilation

- **WGSL (WebGPU Shading Language) Compilation Target**: New built-in WGSL
  target for compiling mathematical expressions to WebGPU shaders.

  ```ts
  // Via the registry
  const result = compile(expr, { to: 'wgsl' });
  ```

  WGSL-specific differences from GLSL:
  - `inverseSqrt` (camelCase) instead of `inversesqrt`
  - `%` operator for mod instead of `mod()` function
  - `vec2f`/`vec3f`/`vec4f` constructors instead of `vec2`/`vec3`/`vec4`
  - `array<f32, n>()` instead of `float[n]()`
  - `fn name(x: f32) -> f32` instead of `float name(float x)`
  - `@vertex`/`@fragment`/`@compute` entry points with struct-based I/O
  - `@group`/`@binding` uniform declarations and `@workgroup_size` for compute

- **Interval WGSL Compilation Target**: New `interval-wgsl` target for interval
  arithmetic in WebGPU shaders, mirroring the existing `interval-glsl` target.
  Since WGSL does not support function overloading, the library uses `_v`
  suffixes for internal vec2f-parameter implementations (e.g., `ia_add_v`),
  while the public API (`ia_add`, `ia_sin`, etc.) takes `IntervalResult` values.

### Resolved Issues

- **`Sequence` type inference now returns a proper tuple type**: Multi-argument
  `Sequence` expressions previously returned `'any'` as their inferred type,
  losing all type information. They now return a `tuple<...>` type with each
  element's individual type preserved (e.g., `Sequence(1, "a")` types as
  `tuple<integer, string>`), consistent with the `Tuple` operator.

- **Subscript parsing now checks for collection type**: The LaTeX subscript
  (`_`) parser now checks whether the LHS is a collection (symbol declared as
  `indexed_collection`, or a list literal) and produces `At()` directly at parse
  time, consistent with bracket indexing (`x[i]`). Multi-index subscripts on
  collections (`A_{k,j}`) are now correctly unpacked into separate `At`
  arguments instead of being wrapped in a `Tuple`.

- **`NumericValue(0).mul(Infinity)` now returns NaN**: All three `NumericValue`
  subclasses (`MachineNumericValue`, `BigNumericValue`, `ExactNumericValue`) had
  an early-return `if (this.isZero) return this` in `mul()`, which returned `0`
  without checking if the other operand was infinity. `0 × ±∞` is now correctly
  indeterminate (`NaN`), and `±∞ × 0` is handled symmetrically.

- **Power simplification `(a^n)^m -> a^{nm}` now correctly guarded**: The rule
  was applied unconditionally, which is mathematically incorrect when the base
  can be negative and exponents are non-integer. The classic counterexample:
  `((-1)^2)^{1/2} = 1`, but `(-1)^{2·1/2} = -1`. The rule is now only applied
  when: (1) the base is non-negative, (2) the outer exponent is an integer, or
  (3) the inner exponent is an odd integer. This fix applies to canonicalization
  (`canonicalPower`), the `pow()` helper, and simplification (`simplifyPower`).
  As a result, `(x^2)^{1/2}` now correctly simplifies to `|x|` instead of `x`.

- **Power distribution rules now guarded for non-integer exponents**: Three
  additional power distribution rules in `pow()` were applied unconditionally,
  producing wrong results when the exponent is non-integer and operands are
  negative. (1) `(a/b)^c -> a^c / b^c` — e.g. `((-2)(-3))^{1/2} = sqrt(6)` but
  distributing gives `(-2)^{1/2} * (-3)^{1/2} = -sqrt(6)`. (2)
  `(a*b)^c -> a^c * b^c` — same class of bug. (3) `(-x)^n` used `n % 2 === 0` to
  test parity, but for non-integer `n` (e.g. 0.5), `0.5 % 2 = 0.5` falls to the
  odd branch, giving `(-x)^{0.5} -> -(x^{0.5})` which is wrong. All three rules,
  plus the corresponding `canonicalPower()` Divide rule, now require integer
  exponents (or non-negative operands) before distributing.

- **Sqrt/Root exponent rearrangement now guarded**: Two more rules in `pow()`
  unconditionally rearranged exponents. (1) `(√a)^b -> √(a^b)` rearranges
  `(a^{1/2})^b` to `(a^b)^{1/2}`, which is wrong for negative `a` (e.g.
  `(√(-4))^3 = -8i` but `√((-4)^3) = 8i`). Now only applied when `a >= 0`. The
  even-integer branches (`(√a)^2 -> a`, `(√a)^{2k} -> a^k`) remain unconditional
  since integer outer exponents are always safe. (2) `Root(a,b)^c -> a^{c/b}`
  combined exponents unconditionally. Now guarded with `a >= 0` or `c` is
  integer. Audit of `simplify-power.ts` confirmed all rules there are already
  properly guarded.

- **Relational operators now evaluate**: Seven relational operators
  (`TildeFullEqual`, `TildeEqual`, `Approx`, `ApproxEqual`, `ApproxNotEqual`,
  `Precedes`, `Succeeds`) previously had `canonical` handlers but no `evaluate`
  handlers, so expressions like `Approx(3.14, 3.14)` returned unevaluated. The
  approximate-equality family (`TildeFullEqual`, `TildeEqual`, `Approx`,
  `ApproxEqual`) now checks whether `|a - b| <= tolerance` via `ce.chop()`, with
  support for multi-argument chains. `Precedes` and `Succeeds` evaluate as
  numeric `<` and `>` respectively. Negated variants (`NotApprox`,
  `NotTildeFullEqual`, etc.) work automatically through the `Not` operator.

- **`BoxedNumber.operator` now returns specific numeric types**: The `operator`
  property on `BoxedNumber` instances previously returned the generic `'Number'`
  for all numeric values. It now returns specific types that match the internal
  type system: `'Integer'` for integers, `'Rational'` for non-integer rationals,
  `'Real'` for floating-point numbers, `'Complex'` for complex numbers with
  non-zero imaginary part, and `'NaN'`, `'PositiveInfinity'`,
  `'NegativeInfinity'` for special values. This improves API consistency with
  the `type` property and enables more precise pattern matching and type
  discrimination in user code. **Breaking change**: Code that explicitly checks
  for `.operator === 'Number'` will need to be updated to check for specific
  numeric types or use the `isNumber()` type guard instead.

- **Non-XIDC Unicode characters in symbol names now encoded correctly**: When
  parsing LaTeX symbols containing non-identifier Unicode characters via
  `\unicode{...}`, `\char`, or `^^XX` escapes (e.g., figure dash U+2012 in
  `\operatorname{speed\unicode{"2012}of\unicode{"2012}sound}`), the characters
  are now encoded as `____XXXXXX` (4 underscores + 6 hex digits) in the symbol
  name. This encoding is valid per `isValidSymbol()` and round-trips correctly:
  the serializer decodes `____XXXXXX` back to `\unicode{"XXXX"}` in LaTeX
  output. Previously, these characters passed through raw and caused symbol
  validation to fail.

- **Assign to compound symbol names no longer misinterpreted as sequence
  definitions** (fixes
  [#286](https://github.com/cortex-js/compute-engine/issues/286)):
  `ce.box(["Assign", "t_half", 10])` previously failed because the Assign
  evaluate handler split any symbol containing `_` and treated it as a
  subscripted sequence definition. User-provided compound symbols like `t_half`
  or `half_life` are now assigned correctly. Sequence definitions via parsed
  LaTeX (e.g., `L_0 := 1`) continue to work as before.

## 0.35.6 _2026-02-07_

### Resolved Issues

- **Monte Carlo improper integrals**: Fixed two bugs in `monteCarloEstimate()`
  that produced incorrect results (typically `NaN` or `Infinity`) for improper
  integrals. The change-of-variables estimator was inverted
  ($f(x) / \mathrm{jacobian}$ instead of $f(x) * \mathrm{jacobian}$), and the
  finite-interval scale factor $b - a$ was applied to transformed domains where
  it is infinite. Affects `NIntegrate` and compiled `integrate` for any integral
  with infinite bounds.

### Compilation

- **`Truncate`, `Remainder`, and `Mod` for JS/GLSL targets**: Added `Truncate`
  (`Math.trunc` / `trunc`), `Remainder`, and `Mod` to the JavaScript and GLSL
  compilation targets, matching the Python target which already had them.

- **Interval `trunc` and `remainder`**: Added `trunc()` and `remainder()` to the
  interval arithmetic library. `trunc` has proper discontinuity detection
  (behaves like `floor` for positive, `ceil` for negative, continuous at zero).
  `remainder(a, b) = a - b * round(a/b)` composes existing interval operations
  with discontinuity detection inherited from `round`. Added corresponding
  mappings to both interval JavaScript and interval GLSL targets.

- **Interval `Lb`, `Log`, and `Root` for GLSL**: Added `ia_log2`, `ia_log10`,
  and `Root` to the interval GLSL target for consistency with the interval
  JavaScript target.

- **Reverse cross-reference test**: Added a test that verifies all core CE math
  functions have compilation support in every target. Currently all 5 targets
  have full coverage of the 47 compilable math functions.

## 0.35.5 _2026-02-06_

### Resolved Issues

- **Compilation Target Function Name Mismatches**: Fixed several function keys
  in compilation targets that did not match their canonical library operator
  names, causing silent compilation failures and runtime errors ("Unexpected
  value"). Affected mappings: `Ceiling` → `Ceil`, `Sgn` → `Sign`, `LogGamma` →
  `GammaLn`, `Arcsinh` → `Arsinh`, `Arccosh` → `Arcosh`, `Arctanh` → `Artanh`,
  `Re` → `Real`, `Im` → `Imaginary`, `Arg` → `Argument` across all five
  compilation targets.

- **Missing Library Operator Definitions**: Added library definitions for
  `Exp2`, `Fract`, `Log10`, `Log2`, `Remainder`, and `Truncate` which were
  referenced by compilation targets but had no corresponding library entries.
  `Exp2` canonicalizes to `Power(2, x)`, `Log10`/`Log2` canonicalize to `Log`
  with the appropriate base, and `Fract`, `Remainder`, `Truncate` have direct
  numeric evaluation.

- **Derivative Rule for GammaLn**: Fixed the derivative table entry that used
  the non-canonical name `LogGamma` instead of `GammaLn`, preventing the
  derivative `d/dx GammaLn(x) = Digamma(x)` from being computed.

## 0.35.4 _2026-02-06_

### Interval Arithmetic

- **Discontinuity Continuity Direction**: Singular interval results now include
  an optional `continuity` field (`'left'` or `'right'`) indicating from which
  side the function is continuous at a jump discontinuity. `Floor`, `Round`,
  `Fract`, and `Mod` report `'right'` (right-continuous), `Ceil` reports
  `'left'` (left-continuous). Pole-type singularities (e.g., `tan`, `1/x`) leave
  the field undefined. This is reflected in both the JavaScript and GLSL
  interval arithmetic targets (new `IA_SINGULAR_RIGHT` and `IA_SINGULAR_LEFT`
  status constants in GLSL).

## 0.35.3 _2026-02-06_

### Compilation

- **Expanded Function Support Across All Targets**: Added comprehensive function
  mappings to all five compilation targets (JavaScript, GLSL, Interval GLSL,
  Interval JavaScript, Python): reciprocal trig (`Cot`, `Csc`, `Sec`), inverse
  reciprocal trig (`Arccot`, `Arccsc`, `Arcsec`), hyperbolic (`Sinh`, `Cosh`,
  `Tanh`), reciprocal hyperbolic (`Coth`, `Csch`, `Sech`), inverse hyperbolic
  (`Arcosh`, `Arsinh`, `Artanh`, `Arcoth`, `Arcsch`, `Arsech`), and elementary
  functions (`Sgn`, `Lb`, `Log` with base, `Square`, `Root`, `Fract`).

- **Interval Discontinuity Detection**: `Floor`, `Ceil`, `Round`, `Sign`,
  `Fract`, and `Mod` now correctly report singularities when an interval spans a
  discontinuity point, in both the JavaScript and GLSL interval arithmetic
  targets. Previously these functions returned normal interval bounds even
  across jump discontinuities, which could cause incorrect connecting lines in
  plotted curves.

- **New Interval Functions**: Added `Round`, `Fract`, and `Mod` to the interval
  arithmetic targets (both JS and GLSL) with proper discontinuity detection.

## 0.35.2 _2026-02-05_

### Resolved Issues

- **Decimal Number Representation**: Numbers written with a decimal point (e.g.,
  `6.02e23`) are now correctly treated as approximate decimal values
  (`BigNumericValue`) rather than exact integers. Previously, `6.02e23` was
  incorrectly converted to the exact bigint `602000000000000000000000`, which
  implied false precision and caused memory inefficiency for very large
  exponents. Numbers without a decimal point (e.g., `602e21`) continue to be
  treated as exact integers when possible. This change aligns with the
  documented behavior of the `parseNumbers: 'auto'` option.

- **Scientific Notation Serialization**
  ([#284](https://github.com/cortex-js/compute-engine/issues/284)): Fixed
  `toLatex()` with `scientific` and `adaptiveScientific` notation options to
  produce properly normalized output. Previously, numbers like `6.02e23` would
  serialize as `602\cdot10^{21}` instead of the expected `6.02\cdot10^{23}`. The
  output now depends only on the numeric value and formatting options, not on
  the internal representation.

- **Numeric Sum Precision**: Fixed precision loss when summing large integers
  with rational values (e.g., `12345678^3 + 1/3`). The `ExactNumericValue.sum()`
  method now uses `bignumRe` instead of `re` to preserve full precision when
  handling large integer values from `BigNumericValue`.

- **Broadcastable Functions with Union/Any Types**
  ([#235](https://github.com/cortex-js/compute-engine/issues/235)):
  Broadcastable (threadable) functions like `Multiply` and `Add` no longer
  reject arguments whose type is a union of numeric and collection types (e.g.,
  `number | list`) or `any`. Previously, declaring a symbol as
  `ce.declare('a', 'number | list')` and using it in
  `ce.box(['Multiply', 'a', 'b'])` would produce an `incompatible-type` error.

- **Division Canonicalization Over-Simplification**
  ([#227](https://github.com/cortex-js/compute-engine/issues/227)): Fixed `A/A`
  being incorrectly simplified to `1` during canonicalization for constant
  expressions that evaluate to infinity or zero, such as `tan(π/2)/tan(π/2)`.
  This now correctly evaluates to `NaN` (since `∞/∞` is indeterminate) instead
  of `1`. Expressions with free variables (e.g., `x/x`, `sin(x)/sin(x)`)
  continue to simplify to `1` per standard algebraic convention. Also fixed
  deferred constant divisions like `0/(1-1)` and `(1-1)/(1-1)` to properly
  evaluate to `NaN` instead of remaining as unevaluated expressions.

## 0.35.1 _2026-02-03_

### Resolved Issues

- **Interval Arithmetic (JS/GLSL)**: Fixed interval evaluation of compound
  arguments (e.g. `sin(2x)`, `sin(x+x)`, `sin(x^2)`, `cos(2x)`) by propagating
  interval results through trig, elementary, and comparison functions in
  `interval-js`, and by adding `IntervalResult` overloads to the GLSL interval
  library for `interval-glsl`.

## 0.35.0 _2026-02-02_

### Parsing

- **Large Integer Precision**: Fixed precision loss when parsing integers
  exceeding `Number.MAX_SAFE_INTEGER` with `parseNumbers: 'rational'`. Large
  integers and rational numerators now use BigInt arithmetic to preserve exact
  values. Fixes #283.

### Compilation

- **Interval Arithmetic Targets**: Added two new compilation targets for
  reliable singularity detection:
  - `interval-js` - Compiles to JavaScript using interval arithmetic
  - `interval-glsl` - Compiles to GLSL for GPU-based interval evaluation

## 0.34.0 _2026-02-01_

### Parsing

- **`\mathopen` and `\mathclose`**: The LaTeX parser supports `\mathopen` and
  `\mathclose` delimiter prefixes for matchfix operators (explicit delimiter
  spacing control), e.g. `\mathopen(a, b\mathclose)` and
  `\mathopen{(}a, b\mathclose{)}`.

- **Interval Notation Parsing**: Added support for parsing mathematical interval
  notation from LaTeX, including half-open intervals. Addresses #254.

  ```javascript
  // Half-open intervals (American notation)
  ce.parse('[3, 4)').json;   // → ["Interval", 3, ["Open", 4]]
  ce.parse('(3, 4]').json;   // → ["Interval", ["Open", 3], 4]

  // Open intervals (ISO/European notation)
  ce.parse(']3, 4[').json;   // → ["Interval", ["Open", 3], ["Open", 4]]

  // LaTeX bracket commands and sizing prefixes
  ce.parse('\\lbrack 3, 4\\rparen').json;  // → ["Interval", 3, ["Open", 4]]
  ce.parse('\\left[ 3, 4 \\right)').json;  // → ["Interval", 3, ["Open", 4]]
  ce.parse('\\bigl( 3, 4 \\bigr]').json;   // → ["Interval", ["Open", 3], 4]
  ```

  **Contextual Parsing**: Lists and tuples are automatically converted to
  intervals when used in set contexts (Element, Union, Intersection, etc.):

  ```javascript
  ce.parse('x \\in [0, 1]').json;
  // → ["Element", "x", ["Interval", 0, 1]]

  ce.parse('[0, 1] \\cup [2, 3]').json;
  // → ["Union", ["Interval", 0, 1], ["Interval", 2, 3]]

  // Standalone notation remains backward compatible
  ce.parse('[0, 1]').json;  // → ["List", 0, 1]
  ce.parse('(0, 1)').json;  // → ["Tuple", 0, 1]
  ```

### Compilation

- **Custom Operator Compilation**: The `compile()` method now supports
  overriding operators to use function calls instead of native operators. This
  enables compilation of vector/matrix operations and custom domain-specific
  languages. Addresses #240.

  ```javascript
  // Override operators for vector operations
  const expr = ce.parse('v + w');
  const compiled = expr.compile({
    operators: {
      Add: ['add', 11],      // Convert + to add() function
      Multiply: ['mul', 12]  // Convert * to mul() function
    },
    functions: {
      add: (a, b) => a.map((v, i) => v + b[i]),
      mul: (a, b) => a.map((v, i) => v * b[i])
    }
  });

  const result = compiled({ v: [1, 2, 3], w: [4, 5, 6] });
  // → [5, 7, 9]
  ```

  Highlights:
  - Map operators via an object or a function
  - Function-name operators compile to calls; symbol operators compile to infix
  - Supports scalar/collection arguments and partial overrides

- **Exported Compilation Interfaces**: Advanced users can now create custom
  compilation targets by using the exported `CompileTarget` interface,
  `BaseCompiler` class, and `JavaScriptTarget` class.

  ```javascript
  import { BaseCompiler, JavaScriptTarget } from '@cortex-js/compute-engine';

  // Create a custom compilation target
  const customTarget = {
    language: 'my-dsl',
    operators: (op) => ({ Add: ['ADD', 11], Multiply: ['MUL', 12] }[op]),
    functions: (id) => id.toUpperCase(),
    var: (id) => `VAR("${id}")`,
    string: (s) => `"${s}"`,
    number: (n) => n.toString(),
    ws: () => ' ',
    preamble: '',
    indent: 0,
  };

  const expr = ce.parse('x + y * 2');
  const code = BaseCompiler.compile(expr, customTarget);
  // → "ADD(VAR("x"), MUL(VAR("y"), 2))"
  ```

  Exported building blocks include `CompileTarget`, `LanguageTarget`,
  `CompilationOptions`, `CompiledExecutable`, `BaseCompiler`,
  `JavaScriptTarget`, and `GLSLTarget` (plus helper types like
  `CompiledOperators` and `CompiledFunctions`).

- **Compilation Plugin Architecture**: The Compute Engine now supports
  registering custom compilation targets, allowing you to compile mathematical
  expressions to any target language beyond the built-in JavaScript and GLSL
  targets.

  ```javascript
  import { ComputeEngine, BaseCompiler } from '@cortex-js/compute-engine';

  const ce = new ComputeEngine();

  // Define a custom Python target
  class PythonTarget {
    // ... implementation (see documentation)
  }

  // Register the custom target
  ce.registerCompilationTarget('python', new PythonTarget());

  // Compile to Python
  const expr = ce.parse('\\sin(x) + \\cos(y)');
  const pythonCode = expr.compile({ to: 'python' });
  console.log(pythonCode.toString());
  // → math.sin(x) + math.cos(y)

  // Switch between targets
  const jsFunc = expr.compile({ to: 'javascript' });
  const glslCode = expr.compile({ to: 'glsl' });
  ```

  Notes:
  - Built-in targets: `javascript` (executable) and `glsl` (shader code)
  - Add targets via `ce.registerCompilationTarget(name, target)`
  - Switch targets with `compile({ to: ... })` (or override once with `target`)

- **Python/NumPy Compilation Target**: Added a complete Python/NumPy compilation
  target for scientific computing workflows. The `PythonTarget` class compiles
  mathematical expressions to NumPy-compatible Python code.

  ```javascript
  import { ComputeEngine, PythonTarget } from '@cortex-js/compute-engine';

  const ce = new ComputeEngine();
  const python = new PythonTarget({ includeImports: true });

  // Register the target
  ce.registerCompilationTarget('python', python);

  // Compile expressions to Python
  const expr = ce.parse('\\sin(x) + \\cos(y)');
  const code = expr.compile({ to: 'python' });
  console.log(code.toString());
  // → import numpy as np
  //
  //   np.sin(x) + np.cos(y)

  // Generate complete Python functions
  const func = python.compileFunction(
    ce.parse('\\sqrt{x^2 + y^2}'),
    'magnitude',
    ['x', 'y'],
    'Calculate vector magnitude'
  );
  // Generates:
  // import numpy as np
  //
  // def magnitude(x, y):
  //     """Calculate vector magnitude"""
  //     return np.sqrt(x ** 2 + y ** 2)
  ```

  Highlights:
  - NumPy-compatible output (including arrays)
  - Function mapping for common math + linear algebra
  - Helpers for full functions, lambdas, and vectorized code

  See the [Python/NumPy Target Guide](/compute-engine/guides/python-target/) for
  complete documentation and examples.

- **GLSL Compilation Target**: New built-in GLSL (OpenGL Shading Language)
  target for compiling mathematical expressions to WebGL shaders.

  ```javascript
  const expr = ce.parse('x^2 + y^2');
  const glslCode = expr.compile({ to: 'glsl' });
  console.log(glslCode.toString());
  // → pow(x, 2.0) + pow(y, 2.0)

  // Generate complete GLSL functions
  import { GLSLTarget } from '@cortex-js/compute-engine';
  const glsl = new GLSLTarget();

  const distExpr = ce.parse('\\sqrt{x^2 + y^2 + z^2}');
  const func = glsl.compileFunction(distExpr, 'distance3D', 'float', [
    ['x', 'float'],
    ['y', 'float'],
    ['z', 'float'],
  ]);
  console.log(func);
  // → float distance3D(float x, float y, float z) {
  //     return sqrt(pow(x, 2.0) + pow(y, 2.0) + pow(z, 2.0));
  //   }

  // Generate complete shaders
  const shader = glsl.compileShader({
    type: 'fragment',
    version: '300 es',
    outputs: [{ name: 'fragColor', type: 'vec4' }],
    body: [
      {
        variable: 'fragColor',
        expression: ce.box(['List', 1, 0, 0, 1]),
      },
    ],
  });
  ```

  Highlights:
  - Native vector/matrix operators and constructors
  - Float literal formatting (`2.0`)
  - Helpers for functions and complete shaders

### Algebra

- **Polynomial Factoring**: The `Factor` function now supports comprehensive
  polynomial factoring including perfect square trinomials, difference of
  squares, and quadratic factoring with rational roots. Addresses #180 and #33.

  ```javascript
  // Perfect square trinomials
  ce.parse('x^2 + 2x + 1').factor().latex;
  // → "(x+1)^2"

  ce.parse('4x^2 + 12x + 9').factor().latex;
  // → "(2x+3)^2"

  // Difference of squares
  ce.parse('x^2 - 4').factor().latex;
  // → "(x-2)(x+2)"

  // Quadratic with rational roots
  ce.box(['Factor', ['Add', ['Power', 'x', 2], ['Multiply', 5, 'x'], 6], 'x'])
    .evaluate().latex;
  // → "(x+2)(x+3)"
  ```

  **Automatic Factoring in sqrt Simplification**: Square roots now automatically
  factor their arguments before applying simplification rules, enabling
  expressions like `√(x²+2x+1)` to simplify to `|x+1|`.

  ```javascript
  // Issue #180 - Now works!
  ce.parse('\\sqrt{x^2 + 2x + 1}').simplify().latex;
  // → "\\vert x+1\\vert"

  ce.parse('\\sqrt{4x^2 + 12x + 9}').simplify().latex;
  // → "\\vert 2x+3\\vert"

  ce.parse('\\sqrt{a^2 + 2ab + b^2}').simplify().latex;
  // → "\\vert a+b\\vert"
  ```

  Includes perfect square trinomials, difference of squares, and quadratics with
  rational roots. Helper functions are exported for advanced usage
  (`factorPerfectSquare`, `factorDifferenceOfSquares`, `factorQuadratic`,
  `factorPolynomial`).

  **MathJSON API**:

  ```json
  ["Factor", expr]              // Auto-detect variable
  ["Factor", expr, variable]    // Explicit variable specification
  ```

  The enhanced factoring system works seamlessly with existing polynomial
  functions like `Expand`, `Together`, `Cancel`, `PolynomialGCD`, and others.

### Simplification

- **Absolute Value Power Simplification**: Fixed simplification of `|x^n|`
  expressions with even and rational exponents. Previously, expressions like
  `|x²|` and `|x^{2/3}|` were not simplified. Now they correctly simplify based
  on the parity of the exponent's numerator. Addresses #181.

  ```javascript
  ce.parse('|x^2|').simplify().latex;      // → "x^2" (even exponent)
  ce.parse('|x^3|').simplify().latex;      // → "|x|^3" (odd exponent)
  ce.parse('|x^{2/3}|').simplify().latex;  // → "x^{2/3}" (even numerator)
  ce.parse('|x^{3/2}|').simplify().latex;  // → "|x|^{3/2}" (odd numerator)
  ```

- **Assumption-Based Simplification**: Simplification rules use assumptions
  about symbol signs:

  ```javascript
  ce.assume(ce.parse('x > 0'));
  ce.parse('\\sqrt{x^2}').simplify().latex;  // → "x" (was "|x|")
  ce.parse('|x|').simplify().latex;          // → "x" (was "|x|")

  ce.assume(ce.parse('y < 0'));
  ce.parse('\\sqrt{y^2}').simplify().latex;  // → "-y"
  ce.parse('|y|').simplify().latex;          // → "-y"
  ```

- **Nested Root Simplification**: Nested roots simplify to a single root:

  ```javascript
  ce.box(['Sqrt', ['Sqrt', 'x']]).simplify()     // → root(4)(x)
  ce.box(['Root', ['Root', 'x', 3], 2]).simplify() // → root(6)(x)
  ce.box(['Sqrt', ['Root', 'x', 3]]).simplify()  // → root(6)(x)
  ```

  Applies to all combinations: `sqrt(sqrt(x))`, `root(sqrt(x), n)`,
  `sqrt(root(x, n))`, and `root(root(x, m), n)`.

- **Extended Coefficient Factoring in Power Combination**: The power combination
  rule now handles additional coefficient forms when combining same-base powers
  in products:
  - **Multi-prime coefficients**: `12·2ˣ·3ˣ` &rarr; `2^(x+2)·3^(x+1)` (since 12
    = 2²·3). All primes in the factorization must have a matching base.
    Non-matching multi-prime coefficients like `6·2ˣ` are left unchanged.
  - **Negative coefficients**: `-4·2ˣ` &rarr; `-2^(x+2)`, `-8·2ˣ` &rarr;
    `-2^(x+3)`. The absolute value is factored and the sign is preserved.
  - **Rational-radical coefficients**: `√2·2ˣ` &rarr; `2^(x+½)`, `2√2·2ˣ` &rarr;
    `2^(x+3/2)`, `(√2/2)·2ˣ` &rarr; `2^(x-½)`. Decomposes `(num/den)·√radical`
    into prime contributions from all three components (radical primes get
    half-integer exponents, numerator primes get positive exponents, denominator
    primes get negative exponents).
  - **Rational coefficients**: `2ˣ/4` &rarr; `2^(x-2)`, `3ˣ/9` &rarr; `3^(x-2)`.
    Factors both numerator (positive exponents) and denominator (negative
    exponents).

- **Improved Cost Function for Negated Powers**: `Negate(Power(...))` now costs
  `3 + cost(exponent)`, consistent with the cost of `Multiply(-1, Power(...))`.
  This makes the cost model more accurate when comparing negated power forms.

### Assumptions & Types

- **Improved `ask()` Queries**: `ce.ask()` now matches patterns with wildcards
  correctly, can answer common "bound" queries such as
  `ask(["Greater", "x", "_k"])` and `ask(["Greater", "_x", "_k"])`, normalizes
  inequality patterns for matching (e.g. `ask(["Greater", "_x", 0])`), and falls
  back to `verify()` for closed predicates when the fact is known but not stored
  as an explicit assumption.

- **Tri-state `verify()`**: Implemented `ce.verify()` as a truth query that
  returns `true`, `false` or `undefined` when a predicate cannot be determined
  from the current assumptions and declarations. `And`/`Or`/`Not` use 3-valued
  logic.

- **`Element`/`NotElement` Type Membership**: `Element(x, T)` and
  `NotElement(x, T)` now support type-style RHS (e.g. `real`, `finite_real`,
  `number`, `any`) in addition to set collections (e.g. `RealNumbers`,
  `Integers`).

- **Value Resolution from Equality Assumptions**: After
  `ce.assume(['Equal', symbol, value])`, the symbol now evaluates to the assumed
  value:

  ```javascript
  ce.assume(ce.box(['Equal', 'one', 1]));
  ce.box('one').evaluate();               // → 1 (was: 'one')
  ce.box(['Equal', 'one', 1]).evaluate(); // → True (was: ['Equal', 'one', 1])
  ce.box(['Equal', 'one', 0]).evaluate(); // → False
  ce.box('one').type.matches('integer');  // → true
  ```

  This also fixes comparison evaluation: `Equal(symbol, assumed_value)` now
  correctly evaluates to `True` instead of staying symbolic.

- **Inequality Evaluation Using Assumptions**: Inequality comparisons can use
  transitive bounds extracted from assumptions.

  ```javascript
  ce.assume(ce.box(['Greater', 'x', 4]));
  ce.box(['Greater', 'x', 0]).evaluate();  // → True (x > 4 > 0)
  ce.box(['Less', 'x', 0]).evaluate();     // → False
  ce.box('x').isGreater(0);                // → true
  ce.box('x').isPositive;                  // → true
  ```

- **Type Inference from Assumptions**: Inequalities infer `real`; equalities
  infer from the value.

  ```javascript
  ce.assume(ce.box(['Greater', 'x', 4]));
  ce.box('x').type.toString();  // → 'real' (was: 'unknown')

  ce.assume(ce.box(['Equal', 'one', 1]));
  ce.box('one').type.toString();  // → 'integer' (was: 'unknown')
  ```

- **Tautology and Contradiction Detection**: `ce.assume()` returns `'tautology'`
  for redundant assumptions and `'contradiction'` for conflicts.

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

### Solving

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

  Non-linear systems that don't match known patterns and inconsistent systems
  return `null`.

- **Non-linear Polynomial Systems**: The `solve()` method now handles certain
  non-linear polynomial systems with 2 equations and 2 variables:
  - **Product + sum pattern**: Systems like `xy = p, x + y = s` are solved by
    recognizing that x and y are roots of the quadratic `t² - st + p = 0`.

  - **Substitution method**: When one equation is linear in one variable, it
    substitutes into the other equation and solves the resulting univariate
    equation.

  Returns an array of solution objects (multiple solutions possible):

  ```javascript
  // Product + sum pattern
  const e = ce.parse('\\begin{cases}xy=6\\\\x+y=5\\end{cases}');
  const result = e.solve(['x', 'y']);
  // → [{ x: 2, y: 3 }, { x: 3, y: 2 }]

  // Substitution method
  const e2 = ce.parse('\\begin{cases}x+y=5\\\\x^2+y=7\\end{cases}');
  const result2 = e2.solve(['x', 'y']);
  // → [{ x: 2, y: 3 }, { x: -1, y: 6 }]
  ```

  Only real solutions are returned; complex solutions are filtered out.

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

- **Linear Inequality Systems**: The `solve()` method now handles systems of
  linear inequalities in 2 variables, returning the vertices of the feasible
  region (convex polygon). Supports all inequality operators: `<`, `<=`, `>`,
  `>=`.

  ```javascript
  // Triangle: x >= 0, y >= 0, x + y <= 10
  const e = ce.parse('\\begin{cases}x\\geq 0\\\\y\\geq 0\\\\x+y\\leq 10\\end{cases}');
  const result = e.solve(['x', 'y']);
  // → [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]

  // Square: 0 <= x <= 5, 0 <= y <= 5
  const square = ce.parse('\\begin{cases}x\\geq 0\\\\x\\leq 5\\\\y\\geq 0\\\\y\\leq 5\\end{cases}');
  square.solve(['x', 'y']);
  // → [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }]
  ```

  Vertices are returned in counterclockwise convex hull order. Returns `null`
  for infeasible systems or non-linear constraints.

- **Under-determined Systems (Parametric Solutions)**: The `solve()` method now
  returns parametric solutions for under-determined linear systems (fewer
  equations than variables) instead of returning `null`. Free variables appear
  as themselves in the solution, with other variables expressed in terms of
  them.

  ```javascript
  // Single equation with two variables
  const e = ce.parse('\\begin{cases}x+y=5\\end{cases}');
  const result = e.solve(['x', 'y']);
  // → { x: -y + 5, y: y }  (y is a free variable)

  // Two equations with three variables
  const e2 = ce.parse('\\begin{cases}x+y+z=6\\\\x-y=2\\end{cases}');
  const result2 = e2.solve(['x', 'y', 'z']);
  // → { x: -z/2 + 4, y: -z/2 + 2, z: z }  (z is a free variable)
  ```

  Inconsistent systems still return `null`.

- **Extended Sqrt Equation Solving**: The equation solver now handles sqrt
  equations of the form `√(f(x)) = g(x)` by squaring both sides and solving the
  resulting polynomial. Extraneous roots are automatically filtered.

  ```javascript
  ce.parse('\\sqrt{x+1} = x').solve('x');      // → [1.618...] (golden ratio)
  ce.parse('\\sqrt{2x+3} = x - 1').solve('x'); // → [4.449...]
  ce.parse('\\sqrt{3x-2} = x').solve('x');     // → [1, 2]
  ce.parse('\\sqrt{x} = x').solve('x');        // → [0, 1]
  ```

- **Two Sqrt Equation Solving**: The equation solver now handles equations with
  two sqrt terms of the form `√(f(x)) + √(g(x)) = e` using double squaring. Both
  addition and subtraction forms are supported, and extraneous roots are
  automatically filtered.

  ```javascript
  ce.parse('\\sqrt{x+1} + \\sqrt{x+4} = 3').solve('x');  // → [0]
  ce.parse('\\sqrt{x} + \\sqrt{x+7} = 7').solve('x');    // → [9]
  ce.parse('\\sqrt{x+5} - \\sqrt{x-3} = 2').solve('x');  // → [4]
  ce.parse('\\sqrt{2x+1} + \\sqrt{x-1} = 4').solve('x'); // → [46 - 8√29] ≈ 2.919
  ```

- **Nested Sqrt Equation Solving**: The equation solver now handles nested sqrt
  equations of the form `√(x + √x) = a` using substitution. These patterns have
  √x inside the argument of an outer sqrt. The solver uses u = √x substitution,
  solves the resulting quadratic, and filters negative u values.

  ```javascript
  ce.parse('\\sqrt{x + 2\\sqrt{x}} = 3').solve('x');  // → [11 - 2√10] ≈ 4.675
  ce.parse('\\sqrt{x + \\sqrt{x}} = 2').solve('x');   // → [9/2 - √17/2] ≈ 2.438
  ce.parse('\\sqrt{x - \\sqrt{x}} = 1').solve('x');   // → [φ²] ≈ 2.618
  ```

- **Quadratic Equations Without Constant Term**: Added support for solving
  quadratic equations of the form `ax² + bx = 0` (missing constant term). These
  are solved by factoring: `x(ax + b) = 0` → `x = 0` or `x = -b/a`.

  ```javascript
  ce.parse('x^2 + 3x = 0').solve('x');  // → [0, -3]
  ce.parse('2x^2 - 4x = 0').solve('x'); // → [0, 2]
  ```

### Subscripts & Indexing

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
  When the handler returns `undefined`, the expression stays symbolic.
  Subscripted expressions with `subscriptEvaluate` have type `number` and can be
  used in arithmetic operations: `ce.parse('F_{5} + F_{3}').evaluate()` works
  correctly.

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

### Sequences

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

  Alternatively, sequences can be defined using natural LaTeX assignment
  notation:

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
  Sequences (OEIS) and verify your sequences against known mathematical
  sequences:

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

- **Multi-Index Sequences**: Define sequences with multiple indices like
  Pascal's triangle `P_{n,k}` or grid-based recurrences:

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
  - Pattern-based base cases: `'n,0'` matches any (n, 0), `'n,n'` matches
    diagonal
  - Per-variable domain constraints
  - Constraint expressions (e.g., `'k <= n'`)
  - Composite key memoization (e.g., `'5,2'`)
  - Full introspection support with `isMultiIndex` flag

  Pattern matching for base cases:
  - Exact values: `'0,0'` matches only (0, 0)
  - Wildcards: `'n,0'` matches any value for n with k=0
  - Equality: `'n,n'` matches when both indices are equal
  - Priority: exact matches are checked before patterns

### Special Functions

- **Special Function Definitions**: Added type signatures for special
  mathematical functions, enabling them to be used in expressions without type
  errors:
  - `Zeta` - Riemann zeta function $\zeta(s)$
  - `Beta` - Euler beta function $B(a,b) = \Gamma(a)\Gamma(b)/\Gamma(a+b)$
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

### Calculus

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
  expressions where the denominator is a product and one factor is the
  derivative of another:

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

- **Derivative Recursion Safety**: Added recursion protection to
  `differentiate()` with a depth limit (`MAX_DIFFERENTIATION_DEPTH`), returning
  `undefined` when the limit is exceeded.

- **Equation Equivalence in `isEqual()`** (Issue #275): Two equations are now
  recognized as equivalent if they have the same solution set:

  ```javascript
  ce.parse('2x+1=0').isEqual(ce.parse('x=-1/2'));   // → true
  ce.parse('3x+1=0').isEqual(ce.parse('6x+2=0'));   // → true
  ```

  Uses sampling to check whether (LHS₁-RHS₁)/(LHS₂-RHS₂) is a non-zero constant.

### Logic

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

### Linear Algebra

- **Matrix Decompositions**: Added four matrix decomposition functions for
  numerical linear algebra:
  - `LUDecomposition(A)` → `[P, L, U]` - LU factorization with partial pivoting
  - `QRDecomposition(A)` → `[Q, R]` - QR factorization using Householder
    reflections
  - `CholeskyDecomposition(A)` → `L` - Cholesky factorization for positive
    definite matrices
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

### Fixed

- **replace() Literal Matching in Object Rules**:
  `.replace({ match: 'a', replace: 2 })` no longer treats `'a'` as a wildcard
  (string rules like `"a*x -> 2*x"` still auto-wildcard).

  ```javascript
  const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
  expr.replace({match: 'a', replace: 2}, {recursive: true});
  // → 2x + b (was: 2 - incorrectly matched entire expression)
  ```

- **forget() Clears Assumed Values**: `ce.forget()` now clears values set by
  equality assumptions across all evaluation context frames.

  ```javascript
  ce.assume(ce.box(['Equal', 'x', 5]));
  ce.box('x').evaluate();  // → 5
  ce.forget('x');
  ce.box('x').evaluate();  // → 'x' (was: 5)
  ```

- **Scoped Assumptions Clean Up on popScope()**: Assumptions made inside a scope
  no longer leak after `popScope()`.

  ```javascript
  ce.pushScope();
  ce.assume(ce.box(['Equal', 'y', 10]));
  ce.box('y').evaluate();  // → 10
  ce.popScope();
  ce.box('y').evaluate();  // → 'y' (was: 10)
  ```

- **Extraneous Root Filtering for Sqrt Equations**: Candidate solutions are now
  validated against the original expression (before clearing denominators /
  harmonization) to filter extraneous roots.

  Examples of equations that now correctly filter extraneous roots:
  - `√x = x - 2` → returns `[4]` (filters out x=1)
  - `√x + x - 2 = 0` → returns `[1]` (filters out x=4)
  - `√x - x + 2 = 0` → returns `[4]` (filters out x=1)
  - `x - 2√x - 3 = 0` → returns `[9]` (filters out x=1)
  - `2x + 3√x - 2 = 0` → returns `[1/4]` (filters out x=4)

- **Simplification (#178)**:
  - Safer division canonicalization for denominators that may simplify to `0`
  - Implicit multiplication powers: `xx` → `x^2`
  - Targeted exp/log rewriting for `\exp(\log(x)±y)`

## 0.33.0 _2026-01-30_

### Resolved Issues

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

### Resolved Issues

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

### Resolved Issues

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

### Resolved Issues

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
  `\sin'(x)`, `\cos''(x)`, `\cos^{(4)}(x)` or even `\sin^{-1}''(x)`

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
  affects `ce.numericMode` which now uses `bignum` instead of `decimal`,
  `expr.decimalValue`->`expr.bignumValue`, `decimalValue()`->`bignumValue()`

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
- Added `expr.subexpressions`, `expr.getSubexpressions()`, `expr.errors`,
  `expr.symbols`, `expr.isValid`.
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

## 0.4.4 _2022-03-27_

### Improvements

- Added option to specify custom LaTeX dictionaries in `ComputeEngine`
  constructor
- `expr.valueOf` returns rational numbers as `[number, number]` when applicable
- The non-ESM builds (`compute-engine.min.js`) now targets vintage JavaScript
  for improved compatibility with outdated toolchains (e.g. Webpack 4) and
  environments. The ESM build (`compute-engine.min.esm.js`) targets evergreen
  JavaScript (currently ECMAScript 2020).

## 0.4.3 _2022-03-21_

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

## 0.3.0 _2021-06-18_

### Improvements

- In LaTeX, parse `\operatorname{foo}` as the MathJSON symbol `"foo"`.
