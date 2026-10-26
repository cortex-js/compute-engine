# Number field factoring with Factor

See the
[full public-API verification report](plans/2026-10-25-public-factoring-api.md)
for the API baseline, and the
[prime-ideal factoring report](plans/2026-10-25-prime-ideal-factorization.md)
for the subsequent algorithm improvements and corpus verification.

## JavaScript convenience and structured results

The exported `factor()` helper accepts `variable` and `generator` options in
addition to its existing `strict` parsing option. Existing one-argument calls
retain their structural factoring behavior. Strings are parsed using the same
lenient grammar as the other free functions; MathJSON and boxed expressions are
also accepted. A boxed input keeps its own engine, including assigned symbols.

```ts
import { factor, factorDetailed } from '@cortex-js/compute-engine';

factor('x^2 - 2', { variable: 'x', generator: 'sqrt(2)' });
factor('x^2 + 1', { variable: 'x', generator: 'i' });

const result = factorDetailed('(x^2 + 1)^2', {
  variable: 'x',
  generator: 'i',
  profile: true,
});
if (result.status === 'complete') {
  // result.coefficient and each entry's factor are ordinary CE expressions.
  // result.expression is their product with the stated multiplicities.
  for (const { factor, multiplicity } of result.factors) {
    console.log(factor.json, multiplicity);
  }
}
```

Both functions and the `FactorOptions`, `FactorizationResult`, and
`FactorStatistics` types are exported by the main and core entry points. Core
users without a syntax provider should supply MathJSON or boxed expressions. An
explicit generator requires an explicit variable. Generator strings are parsed
in the input expression's engine, not an unrelated default engine.

`factorDetailed()` is an exact univariate API. Without a generator, its domain
is Q; it does not report structural or multivariate heuristics as certified
factorizations. Its outcomes are:

| Status        | Meaning                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `complete`    | All returned factors are certified irreducible in the selected field. An irreducible input can return itself as one factor. |
| `zero`        | The zero polynomial; scalar zero and an empty factor list, not a claim of irreducibility.                                   |
| `incomplete`  | A work/conversion limit or failed internal verification prevented completion; `reason` explains the refusal.                |
| `unsupported` | The expression or generator is outside the supported exact representation.                                                  |
| `invalid`     | Invalid expression data or an invalid/reducible defining relation was established.                                          |

Only `complete` and `zero` expose `coefficient` and `factors`. Other outcomes
retain an unevaluated `Factor` expression and a reason; no partial factors are
presented as a complete certificate. Rational factors use primitive integer
coefficients with scalar content outside; number-field factors are monic.
Malformed JavaScript options throw, and cancellation/deadlines propagate rather
than becoming unsupported or incomplete results.

Failures also identify their `stage`: `field-certification`, `conversion`, or
`factorization`. In particular, a conversion refusal does not mean the exact
arithmetic kernel cannot factor that polynomial.

Both helpers accept `maxOperations`, `maxDegree`, and `maxCoefficientBits`.
Number-field requests additionally use `maxIntermediateCoefficientBits`,
`maxNormDegree`, `maxNumberFieldPrimes`, and `maxNumberFieldLifts`; these
controls do not extend the set of representable coefficient fields. `profile`
enables kernel phase statistics. Supplying work/profile controls to `factor()`
selects the certified path used by `factorDetailed()`; on refusal it returns the
held request rather than falling back to structural heuristics.

Number-field statistics also expose per-component direct-method diagnostics,
including the selected prime and residue degree, lift precision, certificate,
and fallback reason. The final refusal reason may be a norm limit while the
direct-method entry explains what caused that fallback.

The rational kernel defaults to two million operations; the public number-field
route defaults to twenty million. Expression conversion has its own fixed
100,000-operation budget and degree/depth bounds. Field certification and
factoring each receive the configured kernel budget; these are not one combined
end-to-end budget. Certified fields can be cached. Statistics describe the
factoring kernel, not parsing, conversion, or field setup; they can be absent
when a request stops before the kernel runs. Use CE deadlines for elapsed-time
control. Limits and timings are not portable proof objects.

### Still not exposed or implemented

- Automatic discovery of a minimal polynomial for arbitrary algebraic
  expressions, multiple generators, composita, or general field coercions.
- A public splitting-field constructor or chosen embeddings/numerical roots for
  abstract generators.
- Certified general multivariate factoring over number fields, or selecting
  finite fields through these helpers.
- Portable independently checkable irreducibility certificates. The structured
  result reports successful internal certification, not a serialized proof.
- Unbounded degree/size coverage. Explicit limits and unsupported exact
  representations remain observable outcomes, not mathematical impossibility.

No new MathJSON operator is needed: `Factor` and `AlgebraicGenerator` are
reused.

`Factor(polynomial, variable, generator)` factors an exact univariate polynomial
over the field generated by the third argument over the rationals. It returns
ordinary CE products, sums, powers, and exact coefficients. Omitting the third
argument preserves the existing rational and structural factoring behavior.

## Choosing the coefficient field

The field determines which factors are irreducible. For example:

| Request               | Result                      |
| --------------------- | --------------------------- |
| Factor(x² − 2, x)     | x² − 2                      |
| Factor(x² − 2, x, √2) | (x − √2)(x + √2)            |
| Factor(x² + 1, x, i)  | (x − i)(x + i)              |
| Factor(x³ − 2, x, ∛2) | (x − ∛2)(x² + ∛2 x + (∛2)²) |

The last quadratic remains irreducible over the real cubic field. Specifying a
field does not request a splitting field or factorization over all complex
numbers. The variable is mandatory with a third argument and is protected from
assigned values, as in the existing two-argument form.

In MathJSON, the quadratic example is:

```json
["Factor", ["Subtract", ["Power", "x", 2], 2], "x", ["Sqrt", 2]]
```

Evaluate the boxed expression normally. Existing `Sqrt`, `Root`, `Power`, and
`ImaginaryUnit` representations are reused. Exact rational generators select Q.
Radical shorthand is supported when its rational binomial defining polynomial is
irreducible; this is not a general minimal-polynomial finder for arbitrary
algebraic expressions. Unsupported shorthands remain unevaluated.

## General algebraic fields

The single new operation is `AlgebraicGenerator(coefficients)`. Its argument is
a `List` of exact rational coefficients in ascending degree order. For example,
`AlgebraicGenerator([-2, 0, 0, 1])` denotes the abstract generator α satisfying
α³ − 2 = 0. A general quintic field can use
`AlgebraicGenerator([-1, -1, 0, 0, 0, 1])`.

This is the exact polynomial backend's coefficient order. CE's `CoefficientList`
returns descending coefficients, so reverse that list before using it here.

```json
["Factor",
  ["Subtract", ["Power", "x", 3], 2],
  "x",
  ["AlgebraicGenerator", ["List", -2, 0, 0, 1]]
]
```

The result contains the same generator, rather than an unbound symbol named α.
Its defining relation therefore survives MathJSON serialization and transfer to
another CE instance. A symbol assigned to this expression can be used as a
convenient name in the input.

The defining polynomial must be nonconstant and irreducible over Q. It is
certified before field arithmetic is used. The backend normalizes its leading
coefficient, so nonmonic rational defining polynomials are permitted.

This generator is abstract: it does not select a particular real or complex
root, and numerical evaluation does not invent an approximation. Identical
generator expressions denote the same generator, not independently chosen
conjugates. Different descriptors are not automatically identified or embedded
into one another. Relations are reduced by the explicit-field `Factor` path, and
a power α^k with deg m ≤ k ≤ 128 is reduced modulo the defining polynomial m
wherever it is built (in canonical form, by `evaluate()`, `Expand` and `.N()`):
for a root of t² - 2, α² is 2. A generator is reduced only when its polynomial
is proved irreducible. Other relations are not reduced: a negative power stays
as it is, and general CE simplification is not upgraded to a global
algebraic-number engine.

Numerical evaluation preserves the exact defining coefficient list. An enclosing
`N` also leaves explicit-field factoring exact: it does not turn the generator
or the polynomial coefficients into a different, approximate factoring problem.

## Coefficients and results

Supported polynomial expressions use exact rational constants, the selected
generator, the polynomial variable, addition, subtraction, multiplication,
nonnegative integer powers, and division by nonzero coefficients in the field.
Negative integer powers of nonzero field coefficients are also supported.
Fractions involving the polynomial variable are not polynomials.

The result retains scalar content and repeated-factor multiplicities.
Coefficients are reduced to rational combinations of powers of the selected
generator. Successful completion uses the existing number-field irreducibility
and exact reconstruction checks; it is not based on numerical roots or
approximate matching.

Membership conversion is conservative. Writing a coefficient with the selected
generator works; arbitrary equivalent radical forms, multiple independent field
generators, transcendental coefficients, and floating-point approximations do
not trigger automatic field discovery. Use a single explicit primitive generator
and its rational power-basis expressions for general fields.

## Incomplete and invalid requests

An unsupported explicit-field request or exhausted factoring budget leaves
`Factor(...)` unevaluated. It never silently retries over Q. An unchanged call
is not an irreducibility certificate. Evaluating an invalid `AlgebraicGenerator`
directly returns an error when invalidity is established; a certification budget
failure leaves it unevaluated. Caller cancellation and CE deadlines propagate.

Expression conversion has bounded degree, depth, operation count, and
intermediate coefficient sizes. The polynomial degree ceiling is 128;
`maxDegree` can lower it, but cannot raise this expression-conversion ceiling.
This is a safety limit, not a promise that every polynomial of that degree will
finish. The existing backend also bounds field certification, lifting, and
recombination.

No new public numerical-root, splitting-field, field-coercion, or
ideal-arithmetic operation is introduced. `Factor` returns a mathematical
expression; the exported `factorDetailed()` helper exposes structured factors,
status, and optional kernel profiling information through the same backend.
