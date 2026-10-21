# Certified univariate rational polynomial factorization

## Delivered scope

Compute Engine factors exact univariate polynomials over Q using first-party
TypeScript. The existing `Factor` operator uses the implementation when its
coefficients can be read exactly. The structured API is
`factorRationalPolynomial`, exported with its input/output types from
`@cortex-js/compute-engine/numerics`. No external CAS, WASM kernel or additional
build tool is required at runtime.

```ts
import { factorRationalPolynomial } from '@cortex-js/compute-engine/numerics';

// Ascending coefficients: x^4 + 5*x^2 + 6.
const result = factorRationalPolynomial(
  [6n, 0n, 5n, 0n, 1n].map((numerator) => ({ numerator, denominator: 1n }))
);
if (result.status === 'complete') {
  // Primitive integer factors x^2+2 and x^2+3, each with multiplicity one.
  console.log(result.coefficient, result.factors);
}
```

Rational inputs are normalized bigint numerator/denominator pairs. Dense
coefficient arrays are ascending; an empty array represents zero. Output
factors have positive leading coefficients and primitive integer coefficients;
a rational scalar and positive multiplicities reconstruct the original input.

## Certification and algorithms

The implementation removes rational content, performs square-free decomposition,
and maps nonmonic factors to monic integer polynomials. A modular square-free
certificate avoids expensive rational GCDs where possible; repeated factors
use a primitive integer pseudo-remainder sequence. Exact translation and
Eisenstein tests provide inexpensive certifications when applicable.

Finite-field Berlekamp factorization supplies modular factors. Independent
Rabin irreducibility tests and exact reconstruction validate their output,
including output from an explicitly supplied modular backend. Degree-balanced
quadratic Hensel lifting raises precision; a linear lifting strategy remains
available for diagnostic comparisons.

Recombination uses either bounded exhaustive subset search with necessary
coefficient filters, or a gradual logarithmic-derivative lattice. Fraction-free
exact LLL and certified short-vector removal retain every true factor indicator.
Equal-column blocks are accepted only after exact division. The detailed
containment argument and limitations are in
[gradual recombination](2026-10-21-gradual-recombination.md).

A completed result certifies both reconstruction and irreducibility. Checking
reconstruction alone is insufficient: returning the input as one factor always
reconstructs it, but does not prove it irreducible. These are algorithmic
certificates, not portable serialized proof objects or numerical root tests.

## Results, budgets and engine integration

`status` is `complete`, `zero`, or `incomplete`. An incomplete result includes
the original rational remainder and a reason, with no claimed factors. Reasons
include operation/degree/coefficient limits, inability to find a suitable prime,
and `verification-failed` for an internal certificate failure. Invalid caller
options and zero rational denominators throw. Cancellation and arbitrary
callback exceptions propagate rather than being mistaken for a certificate.

Default limits are degree 128, 4096 bits per input coefficient, and 2,000,000
counted operations. Normalized/transformed coefficients have additional size
checks. These counts bound arithmetic steps, not bigint bit complexity or wall
time. Applications requiring a hard time or memory boundary should use a worker
process. The `check` callback supports application cancellation; optional
profiling records exclusive phases. Strategy overrides support reproducible
comparisons and are not separate correctness modes.

The boxed reader accepts exact rational arithmetic, reads coefficients from
their exact numeric representation, and constructs variable powers directly.
It does not expand arbitrary symbolic expressions, guess a number field, or
round coefficients through display strings or working precision. Its independent
100,000-step reading budget protects general expression traversal.

`Factor` retains existing behavior for symbolic or irrational coefficients.
An incomplete certified attempt returns control to the existing rational-root
fallback, which can still extract useful factors. CE deadline checks are
strided at this integration boundary; generic polynomial callbacks retain their
original semantics. Partial-fraction decomposition shares this factoring path.

## Testing and reproducible comparison

Unit tests assert mathematical behavior, not benchmark rankings or timing
thresholds. Coverage includes rational content, nonmonic and repeated factors,
irreducibles, nonlinear factors, large exact integers and denominators,
translation, modular-output rejection, budgets, cancellation, exact lattice
invariants, lifted-factor reconstruction and boxed `Factor`/partial fractions.
Regression cases cover scientific-notation integers, expanded `(x+1)^100`,
and rational roots recovered after an incomplete high-degree attempt.

The [factorization harness](../../benchmarks/factorization/README.md) compares
TypeScript strategies with separately installed SymPy and PARI. It records
source/corpus fingerprints, interleaves seeded trials, separates warm solving
from startup and conversion, and independently audits result counts and exact
factor reconstruction. Generated corpora cover regular, stress, challenge and
multiquadratic recombination families. Incomplete results and timeouts remain
in coverage denominators; timing comparisons identify their matched subset.
Mathematica is not measured because no licensed installation is available.

External CAS installations and raw generated journals remain in ignored build
storage. PARI's optional external WASM distribution is a comparator, not a CE
dependency. Benchmark measurements do not imply a language-level speed claim.

## Internal experiments and follow-up requirements

Multivariate Kronecker factorization, abstract number-field arithmetic and
splitting-field construction remain internal experiments, with no exports from
the public numerics entry point. They are not included in the delivered public
API contract. Before a separate API proposal, they need:

- Operand-size-aware budgets or modular GCDs: rational coefficient growth in
  extension arithmetic can make a few counted operations very expensive.
  Maintainer probes include degree-12 splitting fields taking over 90 seconds
  and `x^4+x+1` taking over ten minutes; the current counters do not prevent this.
- Consistent result fields and zero-input semantics across domains, and a
  documented failure contract for field construction and exhausted budgets.
- Public signatures independent of internal `PolynomialWork`/`ExactField`
  implementation details, plus validated finite integer option values.
- Clear degree-limit semantics: Kronecker encoded degree is not total degree;
  norm degree and field degree are different limits.
- More efficient polynomial division/reduction without repeated full remainder
  copying, and realistic default budgets backed by large-field profiling.

Sparse multivariate lifting, modular number-field arithmetic, compact defining
polynomials, and certified real/complex embeddings are future capabilities.
The present univariate API does not imply any numerical embedding or root order.
