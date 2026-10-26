# Public factoring API parity and full number-field verification

## Baseline and scope

Based on upstream `8092e4cb0` (0.169.0), on `feat/public-factoring-results`. The
preceding number-field PR was manually integrated upstream; its commits were not
replayed. The existing extended benchmark work was preserved. This report
records the API-only milestone; the
[prime-ideal follow-up](2026-10-25-prime-ideal-factorization.md) records the
subsequent algorithm changes and full-coverage result.

The scope is public access to the existing certified univariate rational and
number-field algorithms, not new splitting-field or multivariate algorithms.
Everything added to CE is TypeScript; no runtime dependency or MathJSON operator
is introduced.

## Changes and justification

1. **Convenience parity:** `factor(input, { variable, generator })` now reaches
   the same explicit-domain `Factor` route. Existing single-argument structural
   factoring and strict parsing remain available. Input expressions keep their
   owning engine; assigned polynomial/generator names resolve without replacing
   the selected polynomial variable by an assigned value.
2. **Structured outcomes:** `factorDetailed()` returns the expression, domain,
   variable, generator, exact scalar, factors and multiplicities on success. It
   distinguishes `complete`, `zero`, `unsupported`, `invalid`, and `incomplete`.
   Refusals identify their reason and stage; incomplete requests never expose
   partial factors as a complete certificate. Both entry points export the
   helpers and their types. Deadlines/cancellation propagate.
3. **Shared implementation:** the expression and diagnostic APIs share the
   existing conversion and certified kernels. Work controls and optional kernel
   statistics are public, without introducing a duplicate factorizer. Statistics
   exclude parsing, conversion, and field setup; a structured result is not a
   portable proof object.
4. **Measured conversion fix:** the first full public run identified six
   degree-96/128 repeated-factor cases rejected before entering the kernel.
   Reading `x^n` through repeated dense polynomial multiplication spent the
   conversion budget on zeros. The number-field reader now constructs that
   monomial directly, following the rational reader's approach. No budget was
   raised. A degree-96 expanded-input regression checks exact reconstruction,
   multiplicities, and an explicit lower conversion-degree bound.
5. **Public corpus verification:** workers use only the public CE entry point
   for computation. The harness independently decodes the actual returned
   expression and the structured scalar/factor product, compares exact factors
   to the fixture oracle, and reconstructs the original input in its supplied
   quotient field. Expected factors never reach a worker.

See the [API guide](../number-field-factoring.md) for usage and contracts.

## Full corpus results

Node **26.12.0**, full extended number-field corpus: **199 distinct inputs in 21
field presentations**, including every regular/challenge case, 75 added
high-degree generated cases and 14 sourced/adapted examples. Square-free degrees
reach 64; repeated-factor degrees reach 128. This is the full current
number-field development corpus, not all possible polynomials or a rerun of the
separate rational corpus.

One trial per public route, five-second worker deadline, public default
20-million-operation kernel budget, norm-degree bound 128. Both runs contain
**597 audited records**: no missing or duplicate IDs, errors, or mismatches. The
audit checks completion markers and frozen source/bundle/corpus hashes.

| Public route       | Before fix: verified / limited / timeout | After fix: verified / limited / timeout |
| ------------------ | ---------------------------------------- | --------------------------------------- |
| MathJSON `Factor`  | 180 / 18 / 1                             | 186 / 12 / 1                            |
| `factor()`         | 179 / 18 / 2                             | 185 / 12 / 2                            |
| `factorDetailed()` | 179 / 18 / 2                             | 186 / 12 / 1                            |

The common verified intersection increased from **179 to 185**. All six
`extended-{sqrt2,cubic,quintic}-repeated-{96,128}` cases changed from conversion
operation-limit refusals to verified results on all three routes. The extra
detailed-route completion is a deadline-sensitive case, not an additional
algorithmic capability claim.

Local evidence (ignored build output, not intended for publication):

- Before fix: `build/number-field-public-api-01/`.
- After fix: `build/number-field-public-api-02/`.
- Each directory contains `manifest.json`, `corpus.json`, `results.jsonl`,
  `initializations.jsonl`, `completion.json`, the frozen worker bundle, and
  source snapshots.

After-fix public-call totals on the **same 185 verified cases** were 37.37 s for
`Factor`, 40.51 s for `factor()`, and 40.53 s for `factorDetailed()`. These are
single-pass diagnostic totals, not statistically established speed rankings.
Input construction and response encoding also count toward the worker deadline
but are not included in `solveMs`. No heavy tests were run concurrently with the
measured corpus. Whole-machine load was not controlled.

Do not compare these totals directly with the earlier internal-kernel baseline:
that run used a five-million-operation budget and excluded the public expression
path. SymPy and PARI were not rerun for this API-only comparison. LaTeX parsing
is tested separately; corpus inputs are exact expanded MathJSON.

## Remaining corpus failures

All 12 deterministic after-fix refusals report `stage: factorization` and
`reason: norm-degree-limit` through the detailed API:

| Case family                                                 | Polynomial degrees | Count |
| ----------------------------------------------------------- | ------------------ | ----- |
| `extended-zeta8-linear`, `extended-zeta8-mixed`             | 48, 64             | 4     |
| `extended-biquadratic-linear`, `extended-biquadratic-mixed` | 48, 64             | 4     |
| `extended-quartic-linear`                                   | 48, 64             | 2     |
| `extended-nonintegral-3`, `extended-nonintegral-5`          | 48                 | 2     |

This is the reported terminal fallback limit, not evidence that a larger norm
budget would necessarily finish. Next kernel work should distinguish why direct
lifting/recombination falls back, improve that route, and assess larger norms
with measured work/size bounds instead of simply removing the limit.

`extended-nonintegral-5-24` timed out on every route.
`extended-nonintegral-3-24` timed out on `factor()` but completed on the other
two. These timeouts remain in the denominator; route-level timing variation is
not proof of a semantic discrepancy.

Still outside the public contract: automatic minimal-polynomial discovery for
arbitrary algebraic expressions, multiple generators/composita and general field
coercions, splitting-field construction and chosen embeddings, certified general
multivariate number-field factoring, finite-field selection through these
helpers, and serialized independently checkable irreducibility certificates. The
expression conversion degree ceiling remains 128, even if `maxDegree` is set
higher. A refusal is not a mathematical impossibility result.

## Tests and reproduction

- **276 tests passed in nine CE suites:** public/main/core API parity, strict
  parsing, bound symbols, rational scalar normalization, multiplicities, exact
  complex coefficients, constants/zero/irreducibility, unsupported input,
  invalid fields/options, conversion and kernel limits, deadlines, and the
  existing rational/number-field factoring regressions.
- **Nine manual benchmark tests passed**, including independent reconstruction
  of all fixtures, source pins, duplicate detection, malformed/wrong-factor and
  wrong-field rejection, and external PARI basis-conversion checks.
- Source type checking and source lint passed; public test/harness types were
  checked separately because Jest does not type-check test files.
- The full repository test suite and CI pipeline were not run in this change.

Run with Node 26 from the repository root, choosing a fresh output directory:

```sh
node --import tsx --test benchmarks/number-field/public.test.ts benchmarks/number-field/corpus.test.ts benchmarks/number-field/adapters.test.ts
node --import tsx benchmarks/number-field/run.ts --output build/public-factor-verification --corpus extended --backends public-factor,public-helper,public-detailed --repeats 1 --timeout 5
node --import tsx benchmarks/number-field/audit.ts build/public-factor-verification
```

The external PARI adapter test skips if that optional installation is absent.
See the [benchmark guide](../../benchmarks/number-field/README.md) for worker
ownership, warm-up, frozen-source, timeout, and independent-verification
details.
