# Mathematica → Compute Engine name mapping

CE does **not** alias Mathematica operator names (policy decision,
2026-07-05): MathJSON has its own vocabulary, and a Mathematica spelling that
doesn't exist simply stays inert (an unknown head is not an error). This
table records the correspondences for anyone translating problems or
migrating code — it was prompted by the Wester-suite work, where several
capabilities were nearly misreported as missing because they were probed
under their Mathematica names (see `test/compute-engine/wester.test.ts` and
ROADMAP B14).

Every row below was **verified against the engine** (2026-07-05). When
adding rows, probe first:
`npx tsx -e "import {ComputeEngine} from './src/compute-engine'; …"` — an
unknown head echoes back unevaluated, which is easy to mistake for a
capability gap.

## Different names

| Mathematica | Compute Engine | Note |
|---|---|---|
| `Log[x]` | `Ln` | **Trap:** Mathematica's 1-arg `Log` is the natural log; CE's 1-arg `Log` is base 10. |
| `Log[b, x]` | `["Log", x, b]` | **Trap:** argument order is swapped (CE takes the base second). |
| `Prime[n]` | `NthPrime` | Alias `PrimeNumber` also exists. |
| `PartitionsP[n]` | `NPartition` | |
| `StirlingS2[n, m]` | `Stirling` | Second kind. First kind (`StirlingS1`) is not implemented (ROADMAP B14). |
| `EulerPhi[n]` | `Totient` | |
| `FactorInteger[n]` | `FactorInteger` | Same name; distinct-primes-only variant is `PrimeFactors`. |
| `Det[m]` | `Determinant` | |
| `Tr[m]` | `Trace` | |
| `Factorial2[n]` / `n!!` | `Factorial2` | |
| `SingularValueDecomposition` | `SVD` | Float-only; no symbolic `SingularValues` (ROADMAP B14). |

## Same name, verified

`Abs`, `Sqrt`, `GCD`, `Mod`, `PowerMod` (incl. negative exponents, i.e.
modular inverse), `NextPrime`, `PrimitiveRoot`, `ContinuedFraction`,
`Binomial`, `Pochhammer`, `Union`, `Intersection`, `Norm` (matrix ∞-norm:
`["Norm", m, "PositiveInfinity"]`), `Transpose`, `ConjugateTranspose`,
`Inverse`, `Dot`, `Eigenvalues`, `Eigenvectors`, `CharacteristicPolynomial`,
`MatrixPower` (integer exponents only), `RowReduce`, `MatrixRank` (as
`Rank` semantics), `LUDecomposition`, `Mean`, `Median`, `Mode`, `Quartiles`,
`Variance`, `StandardDeviation`, `PDF`, `CDF` (with distribution
constructors like `BinomialDistribution`, `NormalDistribution`), `Expand`,
`Factor`, `Solve`, `D`, `Limit`, `Sum`, `Product`, `BaseForm`, `ForAll`,
`Exists` (finite domains only).

## Mathematica names with no CE equivalent

These stay inert if used (see ROADMAP **B14** for the tracked subset):
`StirlingS1`, `ModularInverse` (use `PowerMod(a, -1, m)`), `Rationalize`
(single-argument `Rational` rationalizes at full precision, but there is no
tolerance parameter), `ToPeriodicForm`, `MatrixExp` (**trap:** `Exp` of a
matrix broadcasts elementwise — it is *not* the matrix exponential),
`MatrixFunction`, `JordanDecomposition`, Smith normal form, `MeanTest` (and
other hypothesis tests), `Resolve`/quantifier elimination over ℝ.

## See also

- `benchmarks/runners/mathjson-to-wl.mjs` — the reverse direction: the
  MathJSON → Wolfram Language translator used by the benchmark harnesses.
- `test/compute-engine/wester.test.ts` — the CI capability suite where most
  of these correspondences are exercised.
