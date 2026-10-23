# General number field factorization

This TypeScript-only follow-up targets certified factorization in K[x], where K
is an explicitly specified finite extension of the rationals. It is separate
from the public rational-factorization contract integrated from PR #461. The
public integration extends `Factor` with an explicit field-generator argument;
see [number field factoring](../number-field-factoring.md) for the supported
contract. Low-level strategy and profiling controls remain internal. No external
CAS is a runtime dependency.

The direct backend with optimized exact recovery verifies all 110 challenge
inputs on every trial. See
[recovery benchmark results](#recovery-benchmark-results) for the latest matched
comparison and remaining bottlenecks. Earlier results retain the frozen
norm-route, subset, and lattice milestones.

## Stages and acceptance criteria

1. Harden field identity, explicit embeddings, option validation, incomplete
   results, and coefficient-size limits. Test general cubic, quartic, quintic,
   and higher fields, not formulas recognizing named quadratic extensions.
2. Profile and improve the Trager norm route. Measure arithmetic, square-free
   decomposition, shifts/norms, rational factoring, recovery, and verification
   separately. Keep an independent baseline and exact behavioral regressions.
3. Add direct modular number-field machinery: good prime selection, finite
   residue fields, lifting, coefficient reconstruction, and certified
   recombination. A modular irreducibility test alone is not this full stage.
4. Select strategies using measured evidence and expose independently checkable
   certificates. Exact multiplication is a reconstruction check, not an
   irreducibility proof. Incomplete computations must not claim irreducibility.
5. Extend to compact towers, splitting fields, and multivariate absolute
   factorization after general K[x] is dependable. These are separate
   algorithms, not implied by a working univariate norm routine.

## Public Factor integration

The expression interface adds `Factor(polynomial, variable, generator)` without
changing the existing one- or two-argument behavior. Its five integration steps
are:

1. Select a field explicitly through its generator. Reuse exact radicals, roots,
   and `ImaginaryUnit`; introduce only `AlgebraicGenerator(List(...))` for
   general irreducible rational defining polynomials.
2. Read bounded exact polynomial expressions into the existing power-basis
   representation. Reject inexact coefficients and unsupported field coercions.
3. Dispatch to the existing certified backend with CE deadline checks. An
   incomplete explicit-field request remains unevaluated, without a fallback to
   Q.
4. Return ordinary CE arithmetic expressions containing the original generator.
   An abstract generator carries its defining polynomial through serialization
   and does not invent a numerical embedding.
5. Exercise the complete public route in `factor-number-field.test.ts`,
   including parsed calls, bound operands, exact coefficients, multiplicities,
   general fields, serialization, unsupported inputs, and cancellation. Document
   syntax and limitations in `docs/number-field-factoring.md`.

This does not add a global algebraic-number simplifier or automatically find
primitive elements for multiple independent generators. The low-level benchmark
results below measure the factoring backend, not expression parsing, generator
certification, or display conversion in this new public route.

Post-rebase verification on Node 26.12.0 against upstream main at `41240b5e9`:
490 tests passed across 31 selected suites, including the new end-to-end suite,
existing polynomial factoring and partial fractions, transformer composition,
library registration, and operator metadata. The local Jest report is
`build/number-field-main-verification-01.json`. Full-source TypeScript checking,
targeted test/harness TypeScript checking, full-source Oxlint,
source/test/document Prettier checks, and `git diff --check` passed. The
operator catalogs retain their existing generated JSON formatting. This is
targeted regression verification, not a run of CE's entire test suite or a new
PARI/SymPy timing comparison.

The rebase preserves the maintainer's `factorPolynomialWith()` integration of PR
#461. All 27 archived backend and harness files in the recovery comparison match
the rebased sources after line-ending normalization. Both the 1,650-record
comparison and 330-record profile passed their journal audits again; the timing
measurements below remain the original snapshots, not newly measured timings.

## Benchmark contract

The first corpus contains 48 generated expanded inputs in eight fields of
degrees 2, 3, 4, 5, 6, and 8. Families include distinct and repeated linear
factors, nonmonic algebraic scalars with rational denominators, quadratic and
cubic Eisenstein factors, and repeated nonlinear factors. Field definitions
include a nonradical quintic and a cyclotomic quartic.

For a nonlinear factor x^r + p*a*x + p, the defining polynomial is monic
integral and has square-free reduction modulo p. Thus p does not divide its
discriminant and is unramified in K. At any prime above p, the constant has
valuation one and every other nonleading coefficient has positive valuation.
Eisenstein proves irreducibility over K. Linearity certifies the other factors.
The production factorizer receives expanded inputs only, without these proofs or
expected factors.

The manual harness uses Node 26 and persistent isolated workers, seeded shuffled
case order, rotating backends, and one solve at a time. SymPy and PARI receive
the same defining polynomial and power-basis coefficients. Field setup and input
conversion are recorded separately from factoring. The external PARI comparator
is the existing separately installed WASM distribution; CE remains TypeScript
only. This is not a native PARI performance claim.

New output directories contain corpus and source fingerprints, append-only
journals, runtime versions, and stderr. The read-only audit checks all IDs and
trial counts, exact factor signatures, and reconstruction using separate
rational and quotient-ring arithmetic. Timeouts and incomplete results stay in
coverage denominators. Timings are compared only on the common completed case
set.

## Algorithm references

- [Trager factoring in SymPy](https://docs.sympy.org/latest/modules/polys/internals.html)
- [PARI nffactor](https://pari.math.u-bordeaux.fr/dochtml/html/General_number_fields.html#nffactor)
- [Belabas relative van Hoeij algorithm](https://www.math.u-bordeaux.fr/~kbelabas/research/vanhoeij.pdf)
- [Modular number field GCDs](https://arxiv.org/abs/1601.01038)

Implementations are first-party code. References describe mathematics, not
permission to copy third-party implementations.

## Implemented foundations

Factoring validates finite integer limits before handling even zero inputs.
Zero, constant, and linear inputs do not require a norm. Input degree and norm
degree are separate limits, with the latter applied to each square-free
component actually sent to norm computation. Incomplete results retain the
original input and claim no factors. Caller cancellation propagates, including
exceptions whose classes resemble internal budget failures. Extension rational
arithmetic checks an additional intermediate coefficient-size limit; this is not
a hard wall-time or memory bound. Applications needing those boundaries must use
a worker.

Explicit certified embeddings check the proposed generator image against the
source defining polynomial and cache its powers. Elements retain field identity;
there is no implicit identification of unrelated field instances or numerical
selection of conjugates. This supports maps between arbitrary supplied simple
fields, not automatic discovery of composita or numerical embeddings.

### Modular GCD reconstruction

Reduce both polynomials and the defining polynomial at small primes. Reject
denominator primes, nonsquare-free defining reductions, degree drops, and
nonunit pivots in the finite quotient algebra. The defining polynomial need not
remain irreducible modulo the prime. All successful Euclidean steps must use
units, so their reductions are valid in every residue-field component.

Retain the smallest successful modular GCD degree; reset CRT data when it drops.
Reconstruct rational coefficients in the original power basis. Stable candidates
are accepted only after exact division into both inputs. Good reduction bounds
the characteristic-zero GCD degree from above, and the verified divisor attains
that degree. Stability is an optimization, not a certificate. Thirty-two prime
attempts bound the modular search; failure falls back to size-guarded Euclidean
GCDs. This is a general GCD algorithm, not direct modular polynomial factoring.

### Modular norm determinants

Construct the multiplication matrix in the power basis, clear each row's
rational denominators, and compute its determinant by finite-field evaluation
and Newton interpolation. The determinant degree is bounded by the sum of row
degrees. If M_i is the largest polynomial coefficient L1 norm in row i, the
Leibniz expansion bounds the integer determinant's coefficient L1 norm by n!
times product(M_i). CRT reconstruction stops only after its modulus exceeds
twice that bound. Centered coefficients are therefore exact; divide by the
product of the row denominators to recover the rational determinant. No
approximate root selection or coefficient-stabilization assumption enters this
certificate.

The dispatcher uses this method for field degree at least four. Explicit
Euclidean/Bareiss overrides permit matched ablation benchmarks. The generic
polynomial division loop also trims one mutable remainder instead of repeatedly
copying it, and reduced field elements avoid redundant polynomial reduction.

## Remaining stages

Stages 1 and 2 provide the field and norm foundations. Stage 3 now includes
direct Hensel lifting and certified subset and lattice recombination at inert
good primes, described below. Arbitrary-prime-ideal lifting remains future work.
Public coefficient-domain syntax, automatic multiple-generator construction,
portable irreducibility proof objects, compact towers, and multivariate absolute
factorization remain future work. Existing splitting-field experiments remain
internal and are not a production API.

The automatic dispatcher first attempts the direct method. When its bounded
search finds no inert good prime, it uses Trager: find a square-free shifted
norm, factor it with the certified rational engine, recover factors by extension
GCD, and verify exact reconstruction with multiplicities. That fallback
certifies irreducibility through square-free norm factorization, not
multiplication alone.

## Regular benchmark results

Runtime: Node 26.12.0, Python 3.12.14, SymPy 1.14.0, and PARI/GP 2.13.2 from the
separately installed @sagemath/pari 1.0.5 WASM comparator. Machine: Windows on
Intel Core Ultra 7 165U. Native/current PARI is not measured. The host was not
exclusive; small timing differences should not be overinterpreted.

`build/number-field-corrected-regular` contains 720 audited records: 48 inputs,
three trials, five configurations. All successful outputs match the proved
expected irreducible factors and independently reconstruct exactly. There are no
incorrect results or backend errors. The ablation comparison subset contains 46
inputs completed on every trial by every configuration.

| Configuration                             | Verified attempts out of 144 | Timeouts | Solve total on the common 46 inputs over three trials |
| ----------------------------------------- | ---------------------------: | -------: | ----------------------------------------------------: |
| TypeScript Euclidean GCD and Bareiss norm |                          139 |        5 |                                              14.703 s |
| TypeScript modular GCD and Bareiss norm   |                          144 |        0 |                                               2.671 s |
| TypeScript modular GCD and adaptive norm  |                          144 |        0 |                                               1.685 s |
| External PARI WASM                        |                          144 |        0 |                                               0.464 s |
| SymPy                                     |                          144 |        0 |                                               4.360 s |

On this shared subset, modular GCDs reduce aggregate solve time by 5.51 times;
adding modular norms gives a further 1.59 times. Together the optimized path is
8.73 times faster than the current Euclidean/Bareiss ablation. All three
production comparators complete all 48 cases on every trial: their full-corpus
solve totals are TypeScript 1.931 s, PARI 0.536 s, and SymPy 5.108 s. Thus CE is
2.65 times faster than SymPy and 3.60 times slower than this PARI build on this
corpus. These are corpus-specific measurements, not universal language or CAS
rankings.

The first pre-optimization baseline (`build/number-field-baseline-02`) completed
46/48 CE cases within five seconds. Its SymPy adapter, also used in
`number-field-final-regular` and the aborted `number-field-final-challenge`,
converted exact coefficients to symbolic expressions and back during output.
Those round trips caused false kernel-timeout impressions. These runs are
superseded for cross-CAS comparisons. The corrected adapter factors and
serializes ANP coefficients directly through SymPy's polynomial representation.
It completes all 48 regular cases. `number-field-baseline-01` was an interrupted
initial PARI adapter-development run and is not a valid score. Raw journals are
retained.

Separate exclusive-phase profiles explain the optimization choice. Before
modular GCDs, preprocessing plus recovery consumed about 7.09 of 7.98 profiled
seconds on the 46 completed cases. After modular GCDs all 48 completed, with
norm work accounting for 276 ms of 430 ms total solve time. Adding modular norms
reduced norm work to 69 ms and total solve time to 255 ms in that diagnostic
run. Profiling clocks, completion sets, and host load differ; the repeated
common-set comparison above is the speed comparison to use.

## Challenge benchmark results

`build/number-field-clean-challenge` contains 990 audited records: 110 inputs in
eleven fields, three trials, and three backends. It includes the regular 48
inputs rather than being a disjoint corpus. Field degrees extend to 16. The
per-request deadline remains five seconds, with CE's five-million-operation and
degree-128 norm limits unchanged. No incorrect answers or backend errors were
observed. Returned factors were checked against proved expected factors and
independently reconstructed.

| Backend            | Verified attempts out of 330 | Other outcomes                | Solve total on the common 104 inputs over three trials |
| ------------------ | ---------------------------: | ----------------------------- | -----------------------------------------------------: |
| TypeScript         |                          321 | 9 explicit incomplete results |                                               20.237 s |
| External PARI WASM |                          330 | None                          |                                                2.585 s |
| SymPy              |                          314 | 16 timeouts                   |                                               66.111 s |

CE completed 107/110 distinct inputs on every trial; PARI completed 110/110;
SymPy completed 104/110 on every trial. Five SymPy inputs timed out in all three
trials and a sixth timed out in one trial. On the shared 104-input set, CE was
3.27 times faster than SymPy and 7.83 times slower than this PARI build.
Timeouts are censored observations, not proof that a CAS cannot factor an input.

All three CE misses are products of nine linear factors in higher-degree fields:

- `field-8-case-9`, degree-10 field: operation limit.
- `field-9-case-9`, degree-12 field: operation limit.
- `field-10-case-9`, degree-16 field: norm degree 144 exceeds 128.

These motivate direct number-field lifting and recombination, which avoid
expanding the entire problem into a rational norm of degree n times [K:Q].
Increasing limits alone is not the proposed algorithmic improvement. This corpus
is a structured diagnostic suite, not evidence of universal CAS coverage.

The final 110-case diagnostic profile (`build/number-field-challenge-profile`)
reproduces the same 107 completions and three explicit refusals. Including the
work spent on refused inputs, norms account for 5.257 s, rational norm factoring
2.603 s, and modular GCDs 1.446 s. The degree-12 nine-factor case exhausts its
budget during the second shifted norm; norm work consumes 4,745,832 operations.
The degree-10 counterpart completes two norms but exhausts the remaining budget
during rational factoring; norms consume 3,567,810 operations and rational
factoring 1,428,055. This locates the next bottleneck more precisely than total
wall time alone. Profile timings are diagnostic, not the cross-CAS comparison.

The earlier `number-field-corrected-challenge` timing run is superseded: Windows
worker-tree termination failed silently and left timed-out SymPy interpreters
running. Those owned workers were stopped, and the complete comparison was rerun
with checked termination. The clean run exited normally, and a process inventory
confirmed no remaining challenge workers. Raw journals are retained. The
finalized harness aborts on cleanup failure and writes a completion marker only
after successful cleanup; the audit requires that marker for new runs.
`number-field-final-harness-smoke` independently verifies all 144 records in a
one-trial, three-backend regular run with that final protocol.

The measured runs archive their exact source files. The final source-only lint
correction qualifies the profiling clock as `globalThis.performance`; it does
not change factorization or unprofiled timing behavior. Later harness changes
remove expected factors from worker requests and require the completion marker;
the actual CAS calls never used expected factors.

## First milestone verification and handoff

First-milestone verification on Node 26.12.0:

- 317 tests passed across 22 polynomial, factoring, and partial-fraction suites.
- Full source TypeScript checking passed, plus separate checking of the new
  tests and benchmark entry points (Jest does not type-check tests here).
- Source Oxlint, formatting checks on changed TypeScript/Markdown, and
  `git diff --check` passed.
- The 720-record regular comparison, 990-record clean challenge comparison,
  144-record finalized-harness smoke run, and 110-record challenge profile
  passed their full-journal audits. Benchmark workers were confirmed stopped.

New behavioral tests cover higher-degree and nonintegral field definitions,
repeated/nonmonic factors, strategy agreement, unlucky and ramified primes,
nonunit finite-algebra pivots, rational reconstruction, denominator clearing,
determinant cancellation, exact embeddings, resource refusals, cancellation, and
profiling invariance. Unit tests contain no speed thresholds or benchmark score
assertions. The full repository test suite and CI corpus pipeline were not run
for this milestone.

This first backend milestone predates the public `Factor` integration described
above. Production changes are TypeScript only; Python/SymPy and the external
PARI WASM installation are benchmark comparators, not runtime dependencies. The
results above are the frozen first-milestone baseline for the direct method
below; they do not establish completion of the five-stage roadmap.

## Direct lifting and certified recombination

The direct backend uses general polynomial arithmetic in a supplied number
field, without recognizing particular radicals or benchmark inputs. It accepts
rational defining polynomials and arbitrary rational power-basis coefficients.
It does not need a maximal integral basis.

### Integral model and good primes

For K=Q(alpha), let D clear the denominators of the monic defining polynomial.
The generator beta=D*alpha has monic integral defining polynomial
M(t)=D^d*m(t/D). A second integer T clears denominators of the input
coefficients when expressed in beta. For a monic degree-n input, F(y)=T^n*f(y/T)
is then monic in Z[beta][y]. Both changes of coordinates are exact and reversed
on output. Repeated factors and the original leading coefficient are handled
outside this square-free monic core. Intermediate-size checks also guard these
transforms and the coefficient-bound computation.

The prime search excludes divisors of D and T, requires M modulo p to be
irreducible, and requires F to remain square-free. This gives a genuine finite
coefficient field F_(p^d), with coprime modular factors. The default search
checks at most 24 odd primes. Not every number field has an inert prime: for
example, the biquadratic field defined by t^4-10*t^2+1 has none. Exhausting the
search is not evidence of irreducibility and does not prove that no inert prime
exists. The automatic strategy falls back to Trager; forced `hensel` returns an
explicit incomplete result. The automatic strategy also falls back when the
direct method reaches one of its own limits: the reconstruction bound exceeds
the intermediate coefficient limit, the lift count reaches its limit, or the
finite extension is too large. The operation limit is shared by both methods,
so it stops both. Arbitrary residue-degree primes need additional
prime-ideal reconstruction machinery and remain future work.

### Finite extension factorization

Absolute Berlekamp uses the p-power Frobenius on the F_p-vector space
F_(p^d)[y]/F, with basis beta^j*y^i. For square-free F this algebra is a product
of finite fields. Its Frobenius fixed space has one F_p dimension per
irreducible factor over F_(p^d). Row reduction finds that space; splitting with
b-s for s in F_p separates the factors. Reaching the fixed-space dimension and
checking the product certifies a complete irreducible factorization. This
includes characteristic two in the finite-field helper, although the
number-field prime search currently uses odd primes.

The first experimental splitter repeatedly exponentiated in F_(p^d) and consumed
the entire operation budget on the degree-16 regression. The absolute Frobenius
matrix removes those large-exponent splits. Its dimension is n*d, limited to 512
to bound allocation. Work budgets remain enforced during matrix formation,
elimination, and splitting. This is a diagnostic implementation choice, not a
claim that dense Berlekamp matrices scale to arbitrarily large inputs.

### Precision doubling

A degree-balanced product tree stores each factor product and the inverse of its
right child modulo its left child. At modulus q=p^k, the product error (F-G*H)/q
determines corrections modulo q. Newton inversion updates the stored inverse,
and the tree lifts to q^2. Polynomial division in the coefficient ring
(Z/qZ)[beta]/M is restricted to monic divisors; it does not pretend that this
prime-power ring is a field. Every node checks its target and correction
congruences. The new tree and precision are committed only after every node has
lifted successfully, so cancellation cannot leave a partially updated tree.

### Reconstruction and irreducibility certificates

The direct subset baseline has three successful termination conditions; the
lattice extension below adds a fourth:

1. An irreducible good reduction certifies the original monic input.
2. An exactly recovered single modular factor is irreducible. If all but one
   modular factors are recovered, the exact remaining quotient has the final
   irreducible reduction. This permits early termination without a global bound.
3. Otherwise, lift past a proved coefficient bound and exhaust modular subsets
   in increasing cardinality. The first exact divisor found is irreducible: any
   proper factor would have used a smaller subset already tested at adequate
   precision. If no subset of at most half the remaining modular factors
   divides, the remaining polynomial is irreducible.

The bound accounts for nonmaximal power orders. Write M(t)=sum M_i*t^i. The
trace-dual element for the beta^j coordinate is w_j=(sum\_(k>j)
M_k*beta^(k-j-1))/M'(beta). Let L clear every rational coefficient of the w_j.
For an algebraic integer c, L*c_j=Tr(c*L*w_j) is an integer, since L*w_j belongs
to Z[beta]. Thus the power-basis coordinates of a monic divisor of F need not be
integral, but multiplying them by L makes them integral. This uses the
trace-dual construction discussed in
[Milne, Algebraic Number Theory, Remark 2.33](https://www.jmilne.org/math/CourseNotes/ANTc.pdf).

For an explicit bound, take R=1+max_(i<d)|M_i|. Every conjugate of beta has
modulus at most R. Let A be the largest weighted coefficient norm sum_j
|F_ij|*R^j among the nonleading coefficients of F. Every conjugate root of F has
modulus at most 1+A, so every coefficient of every monic divisor has all
conjugates bounded by B=(2+A)^n. Consequently |L*c_j| <= d*B*sum_l
|(L*w_j)_l|*R^l. The largest of these bounds is C. Once q>2*C, centered
coefficients of L times a modular subset product uniquely recover any actual
divisor. Subset exhaustion below this threshold is never used to claim
irreducibility. Exact division and final reconstruction are still required.
These deliberately conservative bounds can be tightened later.

This baseline is certified Zassenhaus subset recombination. Its worst-case
subset search is exponential. The direct benchmark results below measure this
baseline; the later lattice milestone has a separate matched comparison.

### Controls and diagnostics

`numberFieldStrategy` accepts `auto`, `trager`, or `hensel`. The direct method
has `maxNumberFieldPrimes` (default 24) and `maxNumberFieldLifts` (default 12
precision doublings). Existing global work, input-degree, and coefficient-size
limits still apply. Norm-degree and shift limits constrain only actual Trager
work, so a direct solve can succeed with `maxNormDegree: 0`. Existing rational
`lifting` and `recombination` overrides configure the rational norm engine only.

Each square-free component records prime attempts, selected prime, modular
factor count, lift count, precision, tested subsets, optional coefficient-bound
size, and certificate method or fallback reason. Exclusive profiles add
finite-field factorization, Hensel lifting, and recombination phases. A
successful arithmetic certificate is established by the implementation; these
diagnostics are not yet a portable, independently replayable proof object.

## Direct benchmark results

`build/number-field-direct-comparison-01` contains 1,320 audited records: all
110 challenge inputs, three trials, and four configurations. Node 26.12.0, SymPy
1.14.0, and external PARI/GP 2.13.2 WASM are unchanged. The five-second request
deadline, five-million-operation CE budget, and degree-128 norm cap are
unchanged. No imported or expected factors enter a CAS call. There are no
mismatches or backend errors. The completion marker and process inspection
confirm that workers stopped; timeouts did not leave competing computations.

| Backend                 | Inputs completed on every trial | Verified attempts | Other attempts | Solve total on common 105 inputs across three trials |
| ----------------------- | ------------------------------: | ----------------: | -------------- | ---------------------------------------------------: |
| Forced Trager CE        |                         107/110 |           321/330 | 9 incomplete   |                                             17.690 s |
| Direct CE with fallback |                         110/110 |           330/330 | None           |                                              6.091 s |
| External PARI WASM      |                         110/110 |           330/330 | None           |                                              2.147 s |
| SymPy                   |                         105/110 |           317/330 | 13 timeouts    |                                             67.504 s |

On this shared set, direct CE is 2.90 times faster than the norm baseline and
11.08 times faster than SymPy, and 2.84 times slower than this PARI build.
Across all 110 inputs, which CE and PARI both complete, their three-trial totals
are 6.881 s and 2.887 s respectively (CE is 2.38 times slower). Native or
current PARI is not measured. These are corpus-specific, nonexclusive-host
measurements; the five-second deadline is a benchmark constraint, not a
mathematical limit of a comparator. The 48-input regular subset also completes
on all three trials for every backend: direct CE totals 1.549 s versus Trager
1.876 s, PARI 0.578 s, and SymPy 5.469 s.

### Previously incomplete cases

All three are expanded degree-nine polynomials with coefficients in the supplied
power basis. Their results are independently checked on every trial. Median
solve times below use the same run, not a separate hand-tuned measurement.

| Field degree | Input ID        | Old outcome       | Direct CE median | PARI median | Direct operations | Precision doublings |
| ------------ | --------------- | ----------------- | ---------------: | ----------: | ----------------: | ------------------: |
| 10           | field-8-case-9  | Operation limit   |          41.8 ms |     25.7 ms |           100,939 |                   2 |
| 12           | field-9-case-9  | Operation limit   |          44.1 ms |     53.9 ms |            99,503 |                   1 |
| 16           | field-10-case-9 | Norm-degree limit |          76.0 ms |     43.0 ms |           203,272 |                   1 |

The direct method uses no norms in any of these cases. SymPy completes the
degree-10 case in two of three trials (3.58 and 4.37 seconds of solve time),
with one timeout; its degree-12 and degree-16 cases time out on every trial. No
speedup ratio is assigned to the old incomplete CE results or timed-out
comparator results.

This is not solely early linear-factor recovery: across each full trial, 99
square-free components use the direct backend, of which 57 require bounded
subset recombination, 39 finish by recovered modular atoms, and three have an
irreducible modular reduction. Other components are handled directly as linear
polynomials during square-free decomposition. None of the 110 inputs needs
Trager fallback; the no-inert-prime fallback is exercised separately in tests.

### Final profiling and verification

The separate 110-record `build/number-field-direct-final-profile` run also
verifies every input. Aggregate phase times are preprocessing 0.340 s, modular
GCD 0.200 s, finite-field factoring 0.213 s, Hensel lifting 0.337 s,
recombination 0.785 s, and final verification 0.094 s. Norm work is zero. These
diagnostic clocks are not substituted for the unprofiled comparison.

The largest remaining measured cost is exact reconstruction/division during
recombination, especially irreducible quartics over the degree-12 and degree-16
fields. In the latter, recombination consumes about 108 of 142 profiled ms,
despite testing only ten subsets. Cheap modular rejection before exact division,
tighter coefficient bounds, and better prime selection are plausible next
optimizations. Lattice recombination targets the separate exponential-growth
problem when the number of modular factors becomes large. Arbitrary-prime-ideal
support is needed for direct factoring in fields without inert primes.

Verification includes 335 passing tests across 24 polynomial, factoring, and
partial-fraction suites, source lint and TypeScript checking, separate typing of
new tests and benchmark entry points, formatting, and whitespace checks. The new
tests cover finite extension arithmetic in characteristics two and three,
irreducible reductions, precision doubling, product congruences, atomic failed
lifts, cancellation, nonmaximal power orders, nonintegral defining polynomials,
nonmonic/repeated inputs, higher-degree fields, bounded nonlinear recombination,
unavailable inert primes, and insufficient precision. Norm-limit tests
explicitly select Trager, since a direct solve is no longer constrained by a
norm it does not compute. Unit tests assert mathematical behavior, not timing
scores.

All production code is TypeScript. This backend milestone predates the public
`Factor` integration above; portable proof objects remain future work. These
results do not include a full-repository test or CI corpus-pipeline run.

## Number field lattice recombination

The lattice backend reuses the rational engine's exact LLL implementation,
integer row-basis reduction, and gradual truncated-constraint reducer. Only the
number-field logarithmic derivatives and their coordinate bounds are new. No
public mathematical operator or alternate field-element representation is
needed. `numberFieldRecombination` selects `auto`, `subsets`, or `lattice`
independently of the inherited rational norm-engine option.

For each lifted modular factor g_i, compute H_i=F*g_i'/g_i in the prime-power
coefficient ring. A true divisor corresponds to a zero-one indicator e, and sum
e_i*H_i=F*g'/g has algebraic-integer coefficients. With the trace-dual
denominator L above, every power-basis coordinate of L times this sum is an
integer. This step is essential: integral elements need not have integral
coordinates in a nonmaximal power order.

Let N=sum_(i,j) |F_ij|*R^j and W_j=sum_l |(L*w_j)_l|*R^l. Under every complex
embedding, Mahler(F) is at most N. Expanding F*g'/g as a sum of omitted-root
products bounds its kth coefficient by n*binomial(n-1,k)*N. The trace formula
therefore gives the rigorous integer-coordinate bound
B_kj=d*n*binomial(n-1,k)*N*W_j. It applies to every monic divisor, not just
candidate factors that happened to reconstruct.

Each coordinate supplies a modular linear constraint. At modulus M choose T=2^b
with T*B_kj<=M and truncate each canonical residue c_i to a_i=floor(T*c_i/M).
Every true indicator has a corresponding lattice vector (e, sum e_i*a_i-h*T)
with squared norm at most r+(r+1)^2, including truncation error. Exact
Gram-Schmidt norms permit removal only of trailing vectors beyond this bound.
Projection and integer row-basis reduction preserve every true indicator.
Floating-point LLL proposals never certify a removal.

Equal columns in the retained indicator lattice cannot be separated by any true
divisor. If all columns coincide, the exact remaining input is therefore
irreducible. Otherwise each proposed block must recover, divide exactly, and
collectively reconstruct the remaining input before its factors are accepted.
Short LLL rows are not themselves assumed to be factor indicators. Constraints
computed with the original F remain valid after exact modular atoms are removed,
because each remaining divisor also divides F.

The local probe budget is bounded and reserves part of the caller's remaining
work. Probes support at most 64 modular factors. Insufficient precision or an
exhausted probe is inconclusive, never an irreducibility certificate. Automatic
mode retains certified subset exhaustion as a fallback; forced lattice mode
keeps lifting within the existing limits and otherwise returns incomplete.
Cancellation and global operation limits continue to propagate. Diagnostics
record probes, processed columns, retained rank, and the certificate method; the
exclusive `lattice` profile includes block recovery checks.

This is a power-basis, inert-prime implementation of logarithmic-derivative
recombination, not a reproduction of PARI's complete number-field backend.
Prime-ideal lattices, reduced integral bases, tighter embedding bounds, and
portable proof objects remain distinct future work.

## Lattice benchmark results

`build/number-field-lattice-comparison-01` contains 1,650 audited records: the
unchanged 110-input challenge corpus, three trials, and five configurations.
Node 26.12.0, SymPy 1.14.0, external PARI/GP 2.13.2 WASM, the five-second
request deadline, and CE's five-million-operation budget are unchanged. The
lattice-milestone production and harness sources match its frozen fingerprints.
All returned results match the independently proved factor signatures and
reconstruct exactly; there are no mismatches, errors, or CE incomplete results.

| Backend                 | Verified attempts out of 330 | Other outcomes | Solve total on common 105 inputs over three trials |
| ----------------------- | ---------------------------: | -------------- | -------------------------------------------------: |
| CE subset-only ablation |                          330 | None           |                                            8.156 s |
| CE adaptive lattice     |                          330 | None           |                                            5.358 s |
| CE forced lattice       |                          330 | None           |                                            5.394 s |
| External PARI WASM      |                          330 | None           |                                            2.453 s |
| SymPy                   |                          315 | 15 timeouts    |                                           77.271 s |

Adaptive CE is 1.52 times faster than the subset ablation on the shared
105-input set, 14.42 times faster than SymPy, and 2.18 times slower than this
PARI build. Across all 110 inputs, completed by every CE configuration and PARI,
the three-trial totals are 9.134 s for subsets, 6.179 s for adaptive CE, 6.206 s
for forced lattice, and 3.292 s for PARI. The full-set CE-to-PARI ratio improves
from 2.77 to 1.88 in this matched run. These are nonexclusive-host corpus
measurements, not native/current PARI results or universal CAS rankings.

Across each trial, 57 square-free components finish through lattice
certification, 39 through recovered modular atoms, and three through irreducible
modular reductions. Linear components bypass the direct backend. The adaptive
configuration uses no subset exhaustion on this corpus, but retains that
fallback for inconclusive probes on other inputs. Forced lattice's similar total
does not establish that it is preferable for all inputs.

### Targeted bottlenecks

The two irreducible-quartic bottlenecks improve without larger work budgets:

| Field degree | Subset median | Adaptive median | PARI median | CE operations before and after | Precision bits before and after |
| ------------ | ------------: | --------------: | ----------: | ------------------------------ | ------------------------------- |
| 12           |       64.7 ms |         22.2 ms |      1.7 ms | 182,451 to 152,745             | 60 to 30                        |
| 16           |      127.3 ms |         23.1 ms |     33.6 ms | 153,571 to 122,013             | 75 to 38                        |

Each removes ten exact subset trials and one precision doubling. The degree-16
example improves by 5.50 times, but the degree-12 example remains much slower
than PARI. The three formerly incomplete nine-linear-factor cases remain fully
verified and still terminate through modular atoms; lattice work does not run
there, and timing changes on those cases are not credited to this algorithm.

The separate `build/number-field-lattice-profile-01` run audits 220 records,
covering both CE strategies on all 110 inputs. Subset trials fall from 197 to
zero, precision doublings from 302 to 255, and counted operations from 4,261,857
to 3,909,239. The operation count does not weight bigint operand sizes and is
not itself a timing estimate. Combined reconstruction/recombination time falls
from 1.391 s to 1.049 s, including 0.154 s in lattice construction, reduction,
and block verification. Other phase clocks vary on this shared host; use the
three-trial unprofiled comparison for speed ratios.

The largest remaining full-corpus time gap versus PARI is the many-linear-factor
family: 1.494 s versus 0.729 s across three trials. These cases already recover
modular atoms without lattice work. Profiles point to exact reconstruction and
extension division, with additional costs in preprocessing, finite-field
factoring, and Hensel arithmetic. General next steps are cheaper rejection of
false early reconstructions, faster extension arithmetic and reusable field
invariants, and prime selection that accounts for residue-factor structure.
Arbitrary-prime-ideal lifting remains necessary for fields without inert primes.

### Lattice verification and handoff

Behavioral tests cover irreducible inputs with split inert reductions, nonlinear
factors in degree-two and degree-four fields, twelve modular atoms recombined
into six nonlinear factors, early atom removal, rational generators, nonmaximal
orders, repeated/nonmonic inputs, insufficient precision, independent strategy
validation, shared-lattice indicator preservation, local probe exhaustion, and
caller cancellation. Existing rational lattice tests exercise the shared reducer
after extraction. No unit test asserts a timing threshold.

On Node 26.12.0, the broad polynomial/factor/partial-fraction run passes 346
tests across 25 suites. The final dedicated lattice suite passes all 12 tests,
including one additional half-integral-coordinate regression added after that
broad run. Full source TypeScript checking, separate test/harness typing,
polynomial source lint, changed-TypeScript formatting, and whitespace checks
pass. Both full-journal audits pass, and no benchmark workers remain running.
The full repository test suite and CI corpus pipeline are outside this run.

The lattice machinery remains TypeScript-only and internal. It adds no public
operator, runtime dependency, or alternate LLL implementation. The benchmark
comparison and profile are complete, not samples.

## Exact recovery and division

Recovery uses the shared exact-field implementation, not a separate linear-root
solver. Monic long division avoids inversion and multiplication by the leading
unit. For every exact field, the eliminated leading term is known to cancel, so
division removes it without allocating its product and zero coefficient. The
degree-smaller-than-divisor case returns before inversion. Constant and nonmonic
divisors retain the same exact quotient/remainder contract.

Coefficient arithmetic avoids multiplying by known zero polynomial coefficients
and adding the initial zero to each product coefficient. Number-field scalar
inversion uses rational inversion; scalar multiplication uses polynomial scaling
instead of convolution. Canonical zero and one elements are reused after exact
normalization. Integer rational normalization and equal-denominator addition
avoid unnecessary gcd/product work. Field-ownership checks still reject foreign
elements, including multiplication by zero, and scalar arithmetic retains the
intermediate-coefficient guards.

The direct decoder reuses the rational-reconstruction uniqueness bound for each
lifting precision and caches exact coordinate-scaling powers per factorization.
Monic leading coefficients are already known and need no reconstruction. The
same decoder serves modular atoms, lattice blocks, and certified subset
products; there is no recognition of particular roots, radicals, or benchmark
inputs.

### One sided modular rejection

Before expensive exact trial division, the candidate and current remainder can
be reduced in a small finite quotient algebra. If a monic candidate divides over
K, long division expresses its quotient using only addition and multiplication
of input coefficients. Every reduction where the defining, input, and candidate
denominators are invertible therefore preserves divisibility. A nonzero modular
remainder proves rejection. A zero modular remainder is only inconclusive and
must still be followed by exact division; a modular collision is tested
explicitly.

The auxiliary prime differs from the Hensel prime, where the candidate's
congruence would be uninformative. Three deterministic small primes bound the
filter's work. Unavailable denominator primes are skipped, and if all are
unavailable the exact path runs normally. No irreducibility or square-freeness
condition is needed for the defining reduction: monic division works in split
and ramified quotient algebras without inversion of nonunits. The implementation
reuses the existing finite quotient arithmetic and polynomial division.

Input reductions are cached for the current remainder. After a successful exact
division, the cache is replaced for the new remainder. A denominator in one
candidate does not disable a prime for later candidates. Cancellation and global
work exhaustion propagate; only unavailable-prime exceptions are inconclusive.
`numberFieldRecovery: 'unfiltered'` disables this rejection step for diagnostics
while retaining all new arithmetic and decoder improvements.

Profiles separate coordinate reconstruction, modular recovery filtering, and
exact trial division from surrounding recombination work. Direct diagnostics
count decoded trial candidates, modular rejections, and ensuing exact divisions.
These trial counters do not include final reconstruction verification or lattice
block verification. Mathematical acceptance and irreducibility certificates are
unchanged.

### Matched frozen baseline

The recovery comparison reruns the preceding lattice milestone's actual frozen
worker and polynomial sources alongside current code. This is necessary because
shared arithmetic improvements also affect an option-only ablation. The harness
checks completion, corpus hash, Node version, and every baseline source hash,
copies the sources into the new report, and audits both source trees. The
original snapshot is never edited. Workers receive the same expanded inputs and
limits, with no expected factors. Current unfiltered CE isolates
arithmetic/decoder changes; current default CE adds the modular rejection step.

## Recovery benchmark results

`build/number-field-recovery-comparison-01` contains 1,650 audited records: all
110 unchanged challenge inputs, three trials, and five configurations. The
baseline is the actual source snapshot from
`build/number-field-lattice-comparison-01`, rerun in this comparison rather than
measured using its historical times. Node 26.12.0, SymPy 1.14.0, external
PARI/GP 2.13.2 WASM, five-second request timeouts, and CE's
five-million-operation budget are unchanged. Every completed result matches the
proved irreducible factor signatures and independently reconstructs exactly.
There are no CE incomplete results, mismatches, or backend errors.

| Configuration                                   | Verified attempts out of 330 | Other outcomes | Solve total on common 105 inputs over three trials |
| ----------------------------------------------- | ---------------------------: | -------------- | -------------------------------------------------: |
| Frozen lattice CE baseline                      |                          330 | None           |                                            5.141 s |
| New CE arithmetic and decoder without filtering |                          330 | None           |                                            3.460 s |
| New CE default with filtering                   |                          330 | None           |                                            2.942 s |
| External PARI WASM                              |                          330 | None           |                                            2.607 s |
| SymPy                                           |                          316 | 14 timeouts    |                                           65.332 s |

On that shared set, the new default is 1.75 times faster than the frozen
baseline and 1.18 times faster than the new unfiltered ablation. It remains 1.13
times slower than this PARI build and is 22.21 times faster than SymPy on the
shared completed cases. Timeouts remain in coverage counts, not as invented
solve times.

Across the full 110 inputs, completed on every trial by all three CE
configurations and PARI, totals are 5.860 s for the frozen baseline, 3.864 s for
unfiltered CE, 3.314 s for default CE, and 3.340 s for PARI. The new CE total is
within one percent of PARI in this run. This is practical parity on this corpus,
not evidence of a statistically significant win, native/current PARI parity, or
a universal CAS ranking. The host is nonexclusive, and the shared-set and
full-set comparisons weight different inputs.

### Many linear factors and remaining gaps

The targeted many-linear-factor family totals 1.267 s with the frozen baseline,
0.716 s without filtering, 0.623 s with default CE, and 0.608 s with PARI,
across all three trials. Thus CE improves by 2.03 times and is within about 2.5
percent of PARI for this family in the measured run. The algorithms receive only
the expanded polynomials; no roots or expected factors are supplied.

Improvements also cover nonlinear products (0.680 s to 0.380 s), repeated
nonlinear inputs (0.535 s to 0.325 s), and large-denominator inputs (0.736 s to
0.471 s). The largest remaining aggregate gap is now irreducible quartics: 0.313
s for CE versus 0.151 s for PARI. These figures do not imply identical relative
performance for each individual field or input.

### Recovery profiling

The separate `build/number-field-recovery-profile-01` run contains 330 audited
records: the same 110 inputs for frozen baseline, new unfiltered CE, and new
default CE. All results verify. The filter rejects 210 of 366 decoded trial
candidates, reducing exact trial divisions from 366 to 156. Every accepted
candidate still undergoes exact division. Precision doublings remain 255 in all
three configurations; this improvement is not a change in lifting targets or a
larger work budget.

The new unfiltered profile spends 0.194 s in exact trial division; the default
spends 0.076 s there plus 0.041 s in modular filtering. The frozen baseline's
combined recombination phase is 0.683 s. With equivalent boundaries, the new
default totals 0.233 s across recombination, coordinate reconstruction,
filtering, and trial division. Lattice work is separately about 0.068 s. Other
phase clocks vary between processes; speed ratios above use the repeated
unprofiled run.

Counted work is 3,909,239 operations for the frozen baseline, 3,523,551 for new
unfiltered CE, and 3,544,182 for default CE. The filter slightly increases that
count while decreasing time: cheap modular operations and rational extension
operations have different costs, and the counter does not weight bigint sizes.

CPU profiles `baseline.cpuprofile` and `recovery.cpuprofile` in the comparison
directory each cover 80 repetitions of the degree-16-field many-linear case,
using the archived source trees. They retain startup/corpus-generation samples
and are diagnostic rather than an additional coverage score. The initial CPU
profile identified allocation-heavy polynomial coefficient multiplication,
addition, and garbage collection; the implementation removes unnecessary unit,
zero, and normalization work in those shared routines.

In the default full-corpus phase profile, finite-field factoring takes 0.327 s
and Hensel lifting 0.478 s, together about 48 percent of the 1.660 s solve
total. These are now the largest combined target. Further general work can
examine residue-field arithmetic, good-prime selection, and lifting arithmetic
without weakening reconstruction or irreducibility checks. Arbitrary-prime-ideal
support and portable proof objects remain separate capability work. Explicit
public field selection is now provided by the `Factor` integration described
above.

### Recovery tests and scope

The new recovery suite compares optimized division with ordinary long division
over field degrees 1, 2, 3, and 5, including constants, nonmonic divisors, zero
remainders, trailing zeros, and immutable inputs. It also checks scalar
inversion, coefficient guards, foreign-field operands including zero products,
cancellation, resource limits, modular false positives, candidate and input
denominator primes, unavailable defining reductions, split/ramified finite
quotients, reconstruction bound reuse, and factoring agreement with filtering
enabled and disabled in degrees 2, 3, 5, and 8. Unit tests assert mathematical
behavior, not timing scores.

The final Node 26.12.0 regression run passes 366 tests across 26 polynomial,
factoring, and partial-fraction suites, including all 19 recovery tests. Full
source TypeScript checking, separate test/harness typing, source lint,
changed-TypeScript formatting, and whitespace checks pass. Current source
fingerprints match the frozen measured implementation. Process inspection
confirms no benchmark or profiling workers remain. The full repository test
suite and CI corpus pipeline were not run for this milestone.

The recovery machinery remains TypeScript-only and internal, with no external
runtime dependency or duplicate division implementation. The full benchmark and
profile pass their source, count, factor, and reconstruction audits. The public
interface is covered by the separate verification above.
