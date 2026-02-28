# Precision-Scaling bigGamma / bigGammaln

**Date:** 2026-02-28
**Status:** Approved

## Problem

`bigGamma` and `bigGammaln` in `src/compute-engine/numerics/special-functions.ts`
use fixed Lanczos/Spouge coefficient tables with ~16 digits of precision. At
BigDecimal.precision > 16, the results are dominated by coefficient error:

- Gamma(1) at prec=100: `1.00000000000000000000298...` (should be exactly 1)
- Gamma(5) at prec=100: `24.0000000000000000000564...` (should be exactly 24)
- Gamma(1/2) at prec=100: 16 matching digits vs sqrt(pi)

Meanwhile, all BigDecimal elementary functions (exp, ln, sin, cos, sqrt, atan)
match decimal.js at 499-500 of 500 digits. Gamma is the outlier.

## Approach: Stirling Series + Runtime Bernoulli Numbers

Replace the fixed-coefficient Lanczos approximation with the Stirling asymptotic
series for ln(Γ(z)), using Bernoulli numbers computed at runtime to the needed
precision. This is the same pattern already used by `bigDigamma`.

### Algorithm for bigGammaln(ce, z)

1. **Exact fast paths** (no approximation error):
   - Positive integer z: return `ln((z-1)!)` from exact bigint factorial
   - Half-integer z = n + 1/2: return `ln((2n)! √π / (4^n n!))` — exact up to √π

2. **Reflection** (existing, unchanged):
   For z < 0.5, use `Γ(z) = π / (sin(πz) · Γ(1-z))`

3. **Stirling series** for general z ≥ 0.5:
   - Shift z upward by m steps using recurrence:
     `lnΓ(z) = lnΓ(z+m) - ln(z·(z+1)·...·(z+m-1))`
   - Shift target: `z+m > p·ln(10)/(2π) ≈ 0.37·p` where p = BigDecimal.precision
   - Compute via Stirling:
     `lnΓ(w) = (w-½)ln(w) - w + ½ln(2π) + Σ_{k=1}^{N} B_{2k} / (2k(2k-1)·w^{2k-1})`
   - N ≈ π·w terms (stop when term < 10^{-(p+guard)})

### Algorithm for bigGamma(ce, z)

Thin wrapper:
- Positive integer z ≥ 1: return exact `(z-1)!` as BigDecimal
- Otherwise: `exp(bigGammaln(ce, z))`

### Bernoulli Number Computation

Compute B₂, B₄, ..., B_{2N} as exact rationals `[bigint, bigint]` using the
even-only recurrence:

```
B_{2m} = (2m-1)/(2(2m+1)) - 1/(2m+1) · Σ_{j=1}^{m-1} C(2m+1, 2j) · B_{2j}
```

This is O(N²) bigint operations with no precision loss. The rational table is
converted to BigDecimal at working precision + guard digits when evaluating the
Stirling series.

**Scaling:** For p=100, N ≈ 115 Bernoulli numbers. For p=500, N ≈ 575. The
bigint recurrence runs in under 100ms even for p=500.

### Caching

- `'bernoulli-even-rationals'` in `ce._cache`: the `[bigint, bigint][]` table.
  Grows monotonically (exact rationals never need recomputation). Extended if a
  higher-precision call needs more terms.
- Remove `'lanczos-7-c'`, `'gamma-p-ln'`, `'gamma-g-ln'` cache entries (dead).

## Files Changed

1. **`src/compute-engine/numerics/special-functions.ts`**
   - Replace `bigGamma` and `bigGammaln` implementations
   - Add `computeBernoulliEven(n)` → `[bigint, bigint][]` utility
   - Remove `LANCZOS_7_C` and `GAMMA_P_LN` coefficient arrays

2. **No other files change.** Function signatures are identical, so all callers
   (`bigBeta`, `bigZeta`, Gamma library entry in `arithmetic.ts`) work unchanged.

## Testing

The existing `test/big-decimal/precision-comparison.test.ts` Gamma section is
the regression test. After the fix, expected results:

| Input        | Before (digits) | After (digits, prec=50) | After (digits, prec=100) |
|--------------|-----------------|------------------------|-------------------------|
| Gamma(1)     | 0               | 50 (exact)             | 100 (exact)             |
| Gamma(2)     | 0               | 50 (exact)             | 100 (exact)             |
| Gamma(5)     | 1               | 50 (exact)             | 100 (exact)             |
| Gamma(10)    | 4               | 50 (exact)             | 100 (exact)             |
| Gamma(1/2)   | 16              | ~45                    | ~95                     |
| Gamma(3/2)   | 16              | ~45                    | ~95                     |

## Future Work

- Upgrade `bigDigamma`/`bigTrigamma`/`bigPolygamma` to use the same runtime
  Bernoulli table (they currently use the 15-entry `BERNOULLI_2K_STRINGS` array,
  limiting them to ~50 digits). Natural follow-up, not part of this change.
