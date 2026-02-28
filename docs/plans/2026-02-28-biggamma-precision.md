# bigGamma Precision-Scaling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fixed-coefficient Lanczos `bigGamma`/`bigGammaln` with a Stirling series + runtime Bernoulli numbers, so Gamma precision scales with `BigDecimal.precision` (up to 500+ digits).

**Architecture:** Compute Bernoulli numbers B₂..B_{2N} as exact `[bigint, bigint]` rationals via an O(N²) recurrence, cache them in `ce._cache`. Use these to evaluate the Stirling asymptotic series for ln(Γ(z)) after shifting z upward via the Gamma recurrence. Integer and half-integer inputs get exact fast paths.

**Tech Stack:** TypeScript, BigDecimal (custom bigint-backed arbitrary precision), bigint rationals, Jest snapshots.

---

### Task 1: Write failing tests for exact integer Gamma values

**Files:**
- Modify: `test/big-decimal/precision-comparison.test.ts:390-477`

The existing Gamma tests show 0-16 matching digits. After the fix, integer inputs should be exact. Update the inline snapshots to reflect the expected results. But first, verify the current tests still fail as expected (baseline).

**Step 1: Run existing precision-comparison tests to confirm baseline**

Run: `npm run test big-decimal/precision-comparison`
Expected: All tests PASS (snapshots match current low-precision results).

**Step 2: Add high-precision Gamma tests at prec=500**

Add a new test after the existing Gamma tests (around line 518) that tests Gamma at prec=500 for integer and half-integer inputs. These will fail until the implementation is done.

```typescript
test('Gamma precision scales with BigDecimal.precision', () => {
  // At prec=500, integer Gamma should give all 500 digits exact,
  // and Gamma(1/2) should give ~495 digits matching sqrt(pi)
  const prec = 500;
  BigDecimal.precision = prec;
  const ce = new ComputeEngine();
  ce.precision = prec;

  // Integer: Gamma(10) = 9! = 362880
  const g10 = bigGamma(ce, new BigDecimal('10'));
  const digits10 = matchingDigits(g10.toString(), '362880');
  expect(digits10).toBeGreaterThan(100); // currently ~4

  // Half-integer: Gamma(1/2) = sqrt(pi)
  BigDecimal.precision = prec + 50;
  const sqrtPiRef = BigDecimal.PI.sqrt().toString();
  BigDecimal.precision = prec;
  const g05 = bigGamma(ce, new BigDecimal('0.5'));
  const digits05 = matchingDigits(g05.toString(), sqrtPiRef);
  expect(digits05).toBeGreaterThan(100); // currently ~16

  BigDecimal.precision = 50; // restore
});
```

**Step 3: Run test to verify it fails**

Run: `npm run test big-decimal/precision-comparison`
Expected: The new test FAILS because `bigGamma` still uses Lanczos coefficients (digits10 ≈ 4, digits05 ≈ 16).

---

### Task 2: Implement `computeBernoulliEven` — exact rational Bernoulli numbers

**Files:**
- Modify: `src/compute-engine/numerics/special-functions.ts` (add new function near line 222)

**Step 1: Write a unit test for Bernoulli number computation**

Create a small test in the precision-comparison test file (or a new section) that validates the first several Bernoulli numbers against known exact values.

Add to `test/big-decimal/precision-comparison.test.ts` at the end:

```typescript
describe('Bernoulli number computation', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { computeBernoulliEven } = require('../../src/compute-engine/numerics/special-functions');

  test('first 5 Bernoulli numbers are exact', () => {
    const bernoulli = computeBernoulliEven(5);
    // B_2 = 1/6
    expect(bernoulli[0][0]).toBe(1n);
    expect(bernoulli[0][1]).toBe(6n);
    // B_4 = -1/30
    expect(bernoulli[1][0]).toBe(-1n);
    expect(bernoulli[1][1]).toBe(30n);
    // B_6 = 1/42
    expect(bernoulli[2][0]).toBe(1n);
    expect(bernoulli[2][1]).toBe(42n);
    // B_8 = -1/30
    expect(bernoulli[3][0]).toBe(-1n);
    expect(bernoulli[3][1]).toBe(30n);
    // B_10 = 5/66
    expect(bernoulli[4][0]).toBe(5n);
    expect(bernoulli[4][1]).toBe(66n);
  });

  test('can compute 200 Bernoulli numbers without error', () => {
    const bernoulli = computeBernoulliEven(200);
    expect(bernoulli.length).toBe(200);
    // All denominators should be positive
    for (const [_num, den] of bernoulli) {
      expect(den > 0n).toBe(true);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test big-decimal/precision-comparison`
Expected: FAIL — `computeBernoulliEven` is not exported yet.

**Step 3: Implement `computeBernoulliEven`**

Add to `src/compute-engine/numerics/special-functions.ts` around line 222 (before `BERNOULLI_2K_STRINGS`):

```typescript
/**
 * Compute even Bernoulli numbers B_2, B_4, ..., B_{2n} as exact rationals.
 * Returns an array of [numerator, denominator] bigint pairs, reduced to lowest terms.
 *
 * Uses the recurrence:
 *   B_{2m} = 1 - 1/(2m+1) · Σ_{j=0}^{m-1} C(2m+1, 2j) · B_{2j}
 * where B_0 = 1, and C(n,k) is the binomial coefficient.
 *
 * All arithmetic is exact bigint rational — no precision loss.
 */
export function computeBernoulliEven(n: number): [bigint, bigint][] {
  // B_0 = 1 (used internally but not returned)
  // We store all B_{2j} for j=0..n as [num, den] rationals
  const all: [bigint, bigint][] = [[1n, 1n]]; // B_0 = 1

  for (let m = 1; m <= n; m++) {
    // Compute B_{2m} = 1 - 1/(2m+1) * Σ_{j=0}^{m-1} C(2m+1, 2j) * B_{2j}
    const twoM = BigInt(2 * m);
    const twoMp1 = twoM + 1n;

    // Compute sum = Σ_{j=0}^{m-1} C(2m+1, 2j) * B_{2j}
    let sumNum = 0n;
    let sumDen = 1n;

    let binom = 1n; // C(2m+1, 0) = 1
    for (let j = 0; j < m; j++) {
      const twoJ = BigInt(2 * j);
      // binom = C(2m+1, 2j)
      if (j > 0) {
        // C(2m+1, 2j) = C(2m+1, 2j-2) * (2m+1-2j+2)(2m+1-2j+1) / ((2j)(2j-1))
        binom = binom * (twoMp1 - twoJ + 2n) * (twoMp1 - twoJ + 1n);
        binom = binom / (twoJ * (twoJ - 1n));
      }

      // Add binom * B_{2j} to sum (rational addition)
      const [bNum, bDen] = all[j];
      // sumNum/sumDen += binom * bNum / bDen
      sumNum = sumNum * bDen + binom * bNum * sumDen;
      sumDen = sumDen * bDen;

      // Reduce periodically to prevent coefficient explosion
      if (j % 10 === 9) {
        const g = gcdBigint(abs(sumNum), sumDen);
        sumNum = sumNum / g;
        sumDen = sumDen / g;
      }
    }

    // B_{2m} = 1 - sum/(2m+1) = (2m+1 - sum) / (2m+1)
    // = (twoMp1 * sumDen - sumNum) / (twoMp1 * sumDen)
    let num = twoMp1 * sumDen - sumNum;
    let den = twoMp1 * sumDen;

    // Reduce to lowest terms
    const g = gcdBigint(abs(num), den);
    num = num / g;
    den = den / g;

    all.push([num, den]);
  }

  // Return B_2, B_4, ..., B_{2n} (skip B_0)
  return all.slice(1);
}

function gcdBigint(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test big-decimal/precision-comparison`
Expected: The Bernoulli tests PASS. The "Gamma precision scales" test still fails.

---

### Task 3: Replace `bigGammaln` with Stirling series

**Files:**
- Modify: `src/compute-engine/numerics/special-functions.ts:140-178` (replace `bigGammaln`)

**Step 1: Replace `bigGammaln` implementation**

Replace lines 140-178 with the Stirling series implementation:

```typescript
/**
 * Bignum log-gamma function ln(Γ(z)) using the Stirling asymptotic series
 * with runtime-computed Bernoulli numbers for arbitrary precision.
 *
 * Algorithm:
 * 1. Reflection for z < 0.5: ln(Γ(z)) = ln(π) - ln(sin(πz)) - ln(Γ(1-z))
 * 2. Exact fast path for positive integers: ln((z-1)!)
 * 3. Exact fast path for half-integers z = n+1/2: ln((2n)!√π/(4^n·n!))
 * 4. Shift z upward via recurrence until z+m > 0.37·p
 * 5. Stirling series: (w-½)ln(w) - w + ½ln(2π) + Σ B_{2k}/(2k(2k-1)w^{2k-1})
 */
export function bigGammaln(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;

  // Reflection: ln(Γ(z)) = ln(π) - ln(|sin(πz)|) - ln(Γ(1-z))
  if (z.lt(BigDecimal.HALF)) {
    const pi = BigDecimal.PI;
    const sinPiZ = pi.mul(z).sin().abs();
    if (sinPiZ.isZero()) return BigDecimal.NAN; // pole at non-positive integers
    return pi.ln().sub(sinPiZ.ln()).sub(bigGammaln(ce, BigDecimal.ONE.sub(z)));
  }

  // Exact fast path: positive integer z → ln((z-1)!)
  if (z.isInteger() && z.isPositive()) {
    const n = z.toNumber();
    if (n <= 1) return BigDecimal.ZERO; // ln(0!) = ln(1) = 0
    let factBigint = 1n;
    for (let i = 2; i < n; i++) factBigint *= BigInt(i);
    return new BigDecimal(factBigint.toString()).ln();
  }

  // Exact fast path: half-integer z = n + 1/2
  // Γ(n+1/2) = (2n)! √π / (4^n · n!)
  const zMinusHalf = z.sub(BigDecimal.HALF);
  if (zMinusHalf.isInteger() && zMinusHalf.isPositive()) {
    const n = zMinusHalf.toNumber();
    // Compute (2n)!
    let fact2n = 1n;
    for (let i = 2; i <= 2 * n; i++) fact2n *= BigInt(i);
    // Compute n!
    let factN = 1n;
    for (let i = 2; i <= n; i++) factN *= BigInt(i);
    // Compute 4^n
    const fourN = 4n ** BigInt(n);
    // ln(Γ(n+1/2)) = ln((2n)!) + ln(√π) - ln(4^n) - ln(n!)
    return new BigDecimal(fact2n.toString()).ln()
      .add(BigDecimal.PI.ln().div(BigDecimal.TWO))
      .sub(new BigDecimal(fourN.toString()).ln())
      .sub(new BigDecimal(factN.toString()).ln());
  }

  // General case: Stirling series with upward shift
  const p = BigDecimal.precision;
  const guard = 10;
  const workingPrec = p + guard;

  // Shift target: z+m > 0.37·p (≈ p·ln(10)/(2π))
  const shiftTarget = Math.ceil(0.37 * p);
  const zNum = z.toNumber();
  const m = Math.max(0, Math.ceil(shiftTarget - zNum));

  // Compute ln(z·(z+1)·...·(z+m-1)) for the recurrence unshift
  let logProduct = BigDecimal.ZERO;
  let w = z;
  for (let i = 0; i < m; i++) {
    logProduct = logProduct.add(w.ln());
    w = w.add(BigDecimal.ONE);
  }
  // Now w = z + m

  // Get Bernoulli numbers (extend cache if needed)
  const maxTerms = Math.ceil(Math.PI * w.toNumber()) + 10;
  const bernoulliRationals = getBernoulliRationals(ce, maxTerms);

  // Stirling series: ln(Γ(w)) = (w-½)ln(w) - w + ½ln(2π) + Σ
  const wMinusHalf = w.sub(BigDecimal.HALF);
  let result = wMinusHalf.mul(w.ln()).sub(w).add(
    BigDecimal.PI.mul(BigDecimal.TWO).ln().div(BigDecimal.TWO)
  );

  // Sum: Σ_{k=1}^{N} B_{2k} / (2k · (2k-1) · w^{2k-1})
  const w2 = w.mul(w);
  let wPow = w; // w^1, will become w^3, w^5, ...
  const tol = new BigDecimal(10).pow(-workingPrec);
  const nTerms = Math.min(maxTerms, bernoulliRationals.length);
  for (let k = 0; k < nTerms; k++) {
    const twoK = 2 * (k + 1);
    const [bNum, bDen] = bernoulliRationals[k];
    // B_{2k} / (2k · (2k-1) · w^{2k-1})
    // = bNum / (bDen · 2k · (2k-1) · wPow)
    const denom = BigInt(twoK) * BigInt(twoK - 1);
    const coeffNum = new BigDecimal(bNum.toString());
    const coeffDen = new BigDecimal((bDen * denom).toString());
    const term = coeffNum.div(coeffDen.mul(wPow));
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.add(term);
    wPow = wPow.mul(w2);
  }

  // Unshift: ln(Γ(z)) = ln(Γ(z+m)) - ln(z·(z+1)·...·(z+m-1))
  return result.sub(logProduct);
}
```

**Step 2: Add the `getBernoulliRationals` helper** (cache integration)

Add this right before `bigGammaln`:

```typescript
/**
 * Get or extend the cached table of even Bernoulli rationals.
 * The table grows monotonically — exact rationals never need recomputation.
 */
function getBernoulliRationals(ce: ComputeEngine, minTerms: number): [bigint, bigint][] {
  const cached = ce._cache<[bigint, bigint][]>(
    'bernoulli-even-rationals',
    () => computeBernoulliEven(minTerms),
    (existing) => {
      if (existing.length >= minTerms) return existing;
      // Need more terms — recompute the full table
      return computeBernoulliEven(minTerms);
    }
  );
  return cached;
}
```

**Step 3: Run test**

Run: `npm run test big-decimal/precision-comparison`
Expected: Integer Gamma tests should now show much higher digit counts. The "Gamma precision scales" test should start passing.

---

### Task 4: Replace `bigGamma` with exact-factorial + exp(bigGammaln)

**Files:**
- Modify: `src/compute-engine/numerics/special-functions.ts:180-220` (replace `bigGamma`)

**Step 1: Replace `bigGamma` implementation**

Replace lines 180-220 with:

```typescript
/**
 * Bignum Gamma function Γ(z) using precision-scaling Stirling series.
 *
 * - Positive integer z: returns exact (z-1)! as BigDecimal
 * - z < 0.5: reflection formula Γ(z) = π / (sin(πz) · Γ(1-z))
 * - Otherwise: exp(bigGammaln(ce, z))
 */
export function bigGamma(ce: ComputeEngine, z: BigNum): BigNum {
  // Exact fast path: positive integer → (z-1)!
  if (z.isInteger() && z.isPositive()) {
    const n = z.toNumber();
    if (n <= 0) return BigDecimal.NAN;
    let fact = 1n;
    for (let i = 2; i < n; i++) fact *= BigInt(i);
    return new BigDecimal(fact.toString());
  }

  // Reflection for z < 0.5
  if (z.lt(BigDecimal.HALF)) {
    const pi = BigDecimal.PI;
    const sinPiZ = pi.mul(z).sin();
    if (sinPiZ.isZero()) return BigDecimal.NAN; // pole
    return pi.div(sinPiZ.mul(bigGamma(ce, BigDecimal.ONE.sub(z))));
  }

  // General case
  return bigGammaln(ce, z).exp();
}
```

**Step 2: Remove dead Lanczos code**

Delete the following from `special-functions.ts`:
- The `GAMMA_P_LN` cache block (old lines ~143-161 — now replaced)
- The `GAMMA_G_LN` cache line (old line ~168 — now replaced)
- The `LANCZOS_7_C` cache block (old lines ~198-210 — now replaced)

These are all inside the old `bigGammaln` and `bigGamma` functions, so they'll already be gone after the replacements in Tasks 3 and 4. Just verify no other code references these cache keys.

**Step 3: Run test**

Run: `npm run test big-decimal/precision-comparison`
Expected: All Gamma precision tests pass with high digit counts. The "Gamma precision scales" test passes.

---

### Task 5: Update precision-comparison snapshots and verify

**Files:**
- Modify: `test/big-decimal/precision-comparison.test.ts:425-518` (update inline snapshots)

**Step 1: Update all Gamma test snapshots**

Run: `npm run test big-decimal/precision-comparison -- -u`
This updates inline snapshots to reflect the new, higher digit counts.

**Step 2: Inspect the updated snapshots**

Verify by reading the file that:
- Gamma(1), Gamma(2), Gamma(3), Gamma(5) at prec=50 and prec=100 show exact results (all digits match or the BigDecimal representation is exact)
- Gamma(10), Gamma(15), Gamma(20) show exact results (all digits match)
- Gamma(1/2) and Gamma(3/2) show ~45+ digits at prec=50 and ~95+ digits at prec=100

**Step 3: Run the full test suite to check for regressions**

Run: `npm run test big-decimal/precision-comparison`
Expected: All tests PASS with updated snapshots.

---

### Task 6: Run existing compute-engine tests for regressions

**Files:** (read-only verification)

The `bigGamma`/`bigGammaln` functions are called by `bigBeta`, `bigZeta`, and the Gamma library entry. We need to verify nothing broke.

**Step 1: Run the numeric test**

Run: `npm run test compute-engine/numeric`
Expected: PASS (or snapshot updates needed — the N-auto values for Gamma(1) and Gamma(5) should now be much more accurate).

**Step 2: Update numeric.test.ts snapshots if needed**

Run: `npm run test compute-engine/numeric -- -u`
The inline snapshots for `Gamma(1)` and `Gamma(5)` N-auto values should change from `1.00000000000000000000298...` to `1` (or very close).

**Step 3: Run the arithmetic test**

Run: `npm run test compute-engine/arithmetic`
Expected: PASS (may need snapshot update).

**Step 4: Run the full test suite**

Run: `npm run test compute-engine/awesome`
Expected: PASS.

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors (the function signatures haven't changed).

---

### Task 7: Verify precision at prec=500

**Files:**
- Modify: `test/big-decimal/precision-comparison.test.ts` (the test from Task 1)

**Step 1: Run the "Gamma precision scales" test**

Run: `npm run test big-decimal/precision-comparison`
Expected: PASS — digits10 > 100 and digits05 > 100 at prec=500.

**Step 2: Optionally add a targeted prec=500 snapshot test**

If the test from Task 1 passes but you want a snapshot for tracking, add:

```typescript
test('Gamma(1/2) at prec=500', () => {
  const prec = 500;
  BigDecimal.precision = prec;
  const ce = new ComputeEngine();
  ce.precision = prec;
  BigDecimal.precision = prec + 50;
  const sqrtPiRef = BigDecimal.PI.sqrt().toString();
  BigDecimal.precision = prec;
  const result = bigGamma(ce, new BigDecimal('0.5'));
  const digits = matchingDigits(result.toString(), sqrtPiRef);
  // Should get ~490-495 of 500 digits
  expect(digits).toBeGreaterThan(480);
  BigDecimal.precision = 50;
});
```

**Step 3: Run final test**

Run: `npm run test big-decimal/precision-comparison`
Expected: All tests PASS.
