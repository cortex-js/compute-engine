# Candidate benchmark sources (not yet wired in)

Benchmark suites worth mining for future harnesses. They used to live as
comments in `test/compute-engine/benchmarks/expand.test.ts`, where they were
unrelated to expansion; they are tracked here instead. When one of these is
adopted, wire it into a harness listed in [`README.md`](./README.md) and move
its entry there.

## WolframMark (Mathematica's built-in benchmark)

Source: <http://adereth.github.io/oneoff/mathematicamark9-20131231/#sources>

A 15-test numeric suite. Reference result (Wolfram Cloud, Mathematica 13.0,
March 2022, `BenchmarkResult -> 1.927`, total 7.185 s):

| Test | Time (s) |
|---|---|
| Data Fitting | 0.466 |
| Digits of Pi | 0.346 |
| Discrete Fourier Transform | 0.665 |
| Eigenvalues of a Matrix | 0.600 |
| Elementary Functions | 0.544 |
| Gamma Function | 0.460 |
| Large Integer Multiplication | 0.433 |
| Matrix Arithmetic | 0.306 |
| Matrix Multiplication | 0.534 |
| Matrix Transpose | 0.744 |
| Numerical Integration | 0.735 |
| Polynomial Expansion | 0.103 |
| Random Number Sort | 0.328 |
| Singular Value Decomposition | 0.478 |
| Solving a Linear System | 0.443 |

Most tests exercise dense numeric linear algebra (outside CE's symbolic
focus), but several map directly onto CE capabilities:

- **Digits of Pi** — `AbsoluteTiming[N[\[Pi], 1000000];]` (arbitrary-precision
  kernel; compare with `big-decimal/` microbenchmarks).
- **Elementary Functions** — `Exp`/`Sin`/`ArcTan` over 2.2M-element real
  vectors, 30×: `Module[{m1, m2}, SeedRandom[1]; m1 = RandomReal[{}, {2.2*^6}];
  m2 = RandomReal[{}, {2.2*^6}]; Do[Exp[m1]; Sin[m1]; ArcTan[m1, m2], {30}]]`
  (a fit for `compile()` targets).
- **Gamma Function** — `Gamma` at 55 random integers in `[80000, 90000]`
  (exact bigint factorial growth).
- **Large Integer Multiplication** — `a (a+1)` for a random ~1.1M-digit
  integer, 20×.
- **Polynomial Expansion** — `Expand[Times @@ Table[(c + x)^3, {c, 350}]]`
  (the audit `expand` category covers binomial powers; this one is a product
  of 350 distinct cubed binomials).
- **Numerical Integration** — `NIntegrate[Sin[x^2 + y^2], {x, -2.6π, 2.6π},
  {y, -2.6π, 2.6π}]` → 3.147414059… (2-D oscillatory quadrature).

The remaining tests (Data Fitting / FindFit, DFT, eigenvalues, matrix
arithmetic/multiply/transpose, random sort, SVD, LinearSolve) benchmark
numeric array kernels; if CE ever grows those, the full WL sources are at the
link above.

## Other comparison suites

- SageMath tour of benchmarks: <https://www.sagemath.org/tour-benchmarks.html>
- "Comparing computational speed of MATLAB and Mathematica across a set of
  benchmark number crunching problems":
  <http://ac.inf.elte.hu/Vol_049_2019/219_49.pdf>
