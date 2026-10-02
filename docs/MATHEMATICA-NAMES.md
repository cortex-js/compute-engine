# Mathematica → Compute Engine name mapping

## Naming policy

Decided by the user on 2026-10-01. This replaces the decision of 2026-07-05,
which was that CE never aliases a Mathematica name.

1. **A new operator takes the Wolfram Language name** when Wolfram has the
   same function with the same arguments in the same order (`PowerModList`,
   `LogGamma`, `BarnesG`). When Wolfram has no such head, the operator gets a
   descriptive name in CE's own style (`ClausenCl`,
   `RationalReconstruction`). A Wolfram name that is already a CE operator
   with a different meaning keeps the CE meaning (`Log`, see below).
2. **An existing operator keeps its CE name as the primary name.** A rename
   would change the output of every existing user, so `Stirling`, `Totient`
   and `Determinant` stay as they are.
3. **A Wolfram name can be an alias of an existing operator** only when the
   meaning, the argument order and the number of arguments are all the same.
   The alias is rewritten to the CE operator when the expression is made
   canonical (`StirlingS2(6, k)` becomes `Stirling(6, k)`), so the output
   uses one spelling and `isSame` and the rules see one operator. A Wolfram
   spelling whose arguments differ (`Log[b, x]`) gets no alias: a wrong
   answer without a warning is worse than an expression that stays
   unevaluated. Aliases are added one at a time, each with a test.

A Mathematica spelling that is not a CE operator or alias stays unevaluated
(an unknown head is not an error). The table below records the
correspondences for anyone translating problems or migrating code. It was
prompted by the Wester-suite work, where several capabilities were nearly
reported as missing because they were probed under their Mathematica names
(see `test/compute-engine/wester.test.ts` and ROADMAP B14).

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
| `StirlingS2[n, m]` | `Stirling` | Second kind. Alias `StirlingS2` also exists. First kind is `StirlingS1`. |
| `EulerPhi[n]` | `Totient` | |
| `FactorInteger[n]` | `FactorInteger` | Same name; distinct-primes-only variant is `PrimeFactors`. |
| `Det[m]` | `Determinant` | |
| `Tr[m]` | `Trace` | |
| `Factorial2[n]` / `n!!` | `Factorial2` | |
| `SingularValueDecomposition` | `SVD` | Float-only; no symbolic `SingularValues` (ROADMAP B14). |

## Same name, verified

`Abs`, `Sqrt`, `GCD`, `Mod`, `PowerMod` (incl. negative exponents, i.e.
modular inverse, and rational exponents, i.e. the least root), `PowerModList`,
`NextPrime`, `PrimitiveRoot`, `PrimitiveRootList`, `ContinuedFraction`,
`Binomial`, `Pochhammer`, `StirlingS1` (signed, as Mathematica:
`StirlingS1(5, 2)` is `-50`), `Union`, `Intersection`, `Norm` (matrix ∞-norm:
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
`ModularInverse` (use `PowerMod(a, -1, m)`), `Rationalize`
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
