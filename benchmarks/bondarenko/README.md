# Bondarenko integration problems

`bondarenko-problems.m` is a verbatim copy of Vladimir Bondarenko's 35
integration problems — an independent test set from the Rubi
[MathematicaSyntaxTestSuite](https://github.com/RuleBasedIntegration/MathematicaSyntaxTestSuite)
(`0 Independent test suites/Bondarenko Problems.m`, **MIT license**). They are
deliberately hard: nested radicals, logs of radical/trig expressions, and
transcendental integrands that stress an antiderivative engine.

Each problem is a one-line Wolfram-Language list

```
{integrand, variable, optimal-step-count, optimal-antiderivative[, alternates…]}
```

parsed by `scripts/rubi/load-tests.ts` (`loadTestFile`). The integration
variable is `x` or `z`; the step count is Rubi's optimal-solution length (a
difficulty signal). `benchmarks/audit/bondarenko.ts` consumes this file — it runs
each indefinite integral on base CE / CE+Rubi+Fungrim / SymPy / Mathematica and
grades by the invariant `d/dx(F) ≈ f`, writing `audit/REPORT-bondarenko.md`.
