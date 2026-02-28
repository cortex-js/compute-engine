# BigDecimal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Replace `decimal.js` with a custom BigInt-backed `BigDecimal` class in
`src/big-decimal/`, eliminating the external dependency while improving
performance.

**Architecture:** `BigDecimal` stores `{ significand: bigint, exponent: number }`
(value = significand × 10^exponent). Precision is thread-local
(`BigDecimal.precision`). Transcendentals use fixed-point BigInt arithmetic
internally with Taylor series + argument reduction (exp, sin, cos), AGM (ln),
and Newton's method (sqrt, cbrt).

**Tech Stack:** TypeScript, native `bigint`, Jest for testing.

**Design doc:** `docs/plans/2026-02-27-big-decimal-design.md`

---

## Phase 1: Core BigDecimal Module

### Task 1: Scaffold Module and Representation

**Files:**
- Create: `src/big-decimal/big-decimal.ts`
- Create: `src/big-decimal/index.ts`

**Step 1: Write the failing test**

Create `test/big-decimal/big-decimal.test.ts`:

```typescript
import { BigDecimal } from '../../src/big-decimal';

describe('BigDecimal construction', () => {
  test('from integer string', () => {
    const d = new BigDecimal('123');
    expect(d.significand).toBe(123n);
    expect(d.exponent).toBe(0);
  });

  test('from decimal string', () => {
    const d = new BigDecimal('123.456');
    expect(d.significand).toBe(123456n);
    expect(d.exponent).toBe(-3);
  });

  test('from negative string', () => {
    const d = new BigDecimal('-42.5');
    expect(d.significand).toBe(-425n);
    expect(d.exponent).toBe(-1);
  });

  test('from scientific notation string', () => {
    const d = new BigDecimal('1.5e10');
    expect(d.significand).toBe(15n);
    expect(d.exponent).toBe(9);
  });

  test('from number', () => {
    const d = new BigDecimal(42);
    expect(d.significand).toBe(42n);
    expect(d.exponent).toBe(0);
  });

  test('from bigint', () => {
    const d = new BigDecimal(123456789012345678901234567890n);
    expect(d.significand).toBe(123456789012345678901234567890n);
    expect(d.exponent).toBe(0);
  });

  test('from BigDecimal (copy)', () => {
    const a = new BigDecimal('3.14');
    const b = new BigDecimal(a);
    expect(b.significand).toBe(314n);
    expect(b.exponent).toBe(-2);
  });

  test('trailing zeros are normalized', () => {
    const d = new BigDecimal('12.300');
    expect(d.significand).toBe(123n);
    expect(d.exponent).toBe(-1);
  });

  test('zero', () => {
    const d = new BigDecimal('0');
    expect(d.significand).toBe(0n);
    expect(d.exponent).toBe(0);
  });

  test('NaN from NaN', () => {
    const d = new BigDecimal(NaN);
    expect(d.isNaN()).toBe(true);
  });

  test('Infinity', () => {
    const d = new BigDecimal(Infinity);
    expect(d.isFinite()).toBe(false);
    expect(d.isPositive()).toBe(true);
  });

  test('-Infinity', () => {
    const d = new BigDecimal(-Infinity);
    expect(d.isFinite()).toBe(false);
    expect(d.isNegative()).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/big-decimal/big-decimal.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement BigDecimal core**

Create `src/big-decimal/big-decimal.ts` with:
- Constructor that parses `string | number | bigint | BigDecimal`
- String parsing: handle integer, decimal, scientific notation (e/E), negative
  sign, leading/trailing zeros
- Normalization: strip trailing zeros from significand, adjust exponent
- Special values: NaN (`exponent = NaN`), +Infinity (`significand = 1n,
  exponent = Infinity`), -Infinity (`significand = -1n, exponent = Infinity`)
- `readonly significand: bigint` and `readonly exponent: number` fields
- State check methods: `isNaN()`, `isZero()`, `isFinite()`, `isInteger()`,
  `isPositive()`, `isNegative()`

Create `src/big-decimal/index.ts` as barrel:

```typescript
export { BigDecimal } from './big-decimal';
```

**Step 4: Run test to verify it passes**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/big-decimal/big-decimal.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add BigDecimal core class with construction and state checks
```

---

### Task 2: Conversion Methods

**Files:**
- Modify: `src/big-decimal/big-decimal.ts`
- Test: `test/big-decimal/big-decimal.test.ts`

**Step 1: Write the failing test**

Add to `test/big-decimal/big-decimal.test.ts`:

```typescript
describe('BigDecimal conversion', () => {
  test('toNumber', () => {
    expect(new BigDecimal('123.456').toNumber()).toBe(123.456);
    expect(new BigDecimal('0').toNumber()).toBe(0);
    expect(new BigDecimal(NaN).toNumber()).toBeNaN();
    expect(new BigDecimal(Infinity).toNumber()).toBe(Infinity);
  });

  test('toString', () => {
    expect(new BigDecimal('123.456').toString()).toBe('123.456');
    expect(new BigDecimal('0').toString()).toBe('0');
    expect(new BigDecimal('-42').toString()).toBe('-42');
    expect(new BigDecimal('1.5e10').toString()).toBe('15000000000');
    expect(new BigDecimal(NaN).toString()).toBe('NaN');
    expect(new BigDecimal(Infinity).toString()).toBe('Infinity');
    expect(new BigDecimal(-Infinity).toString()).toBe('-Infinity');
  });

  test('toString with large exponent uses scientific notation', () => {
    const d = new BigDecimal('1e100');
    expect(d.toString()).toMatch(/1e\+?100/);
  });

  test('toFixed', () => {
    expect(new BigDecimal('123.456').toFixed(2)).toBe('123.46');
    expect(new BigDecimal('123.456').toFixed(0)).toBe('123');
    expect(new BigDecimal('123.456').toFixed(5)).toBe('123.45600');
    expect(new BigDecimal('0.001').toFixed(2)).toBe('0.00');
  });

  test('toBigInt', () => {
    expect(new BigDecimal('123').toBigInt()).toBe(123n);
    expect(new BigDecimal('123.9').toBigInt()).toBe(123n); // truncates
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/big-decimal/big-decimal.test.ts`
Expected: FAIL — methods not defined.

**Step 3: Implement conversion methods**

Add to `BigDecimal`:
- `toNumber()`: convert significand and exponent to JS number. Handle
  NaN/Infinity. For large values, use `Number(significand) * 10**exponent`.
- `toString()`: reconstruct decimal string from significand and exponent.
  Scientific notation for exponents > 20 or < -6.
- `toFixed(digits)`: format with fixed decimal places, rounding as needed.
- `toBigInt()`: truncate fractional part, return `bigint`.

**Step 4: Run test to verify it passes**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/big-decimal/big-decimal.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add BigDecimal conversion methods (toNumber, toString, toFixed, toBigInt)
```

---

### Task 3: Comparison Methods

**Files:**
- Modify: `src/big-decimal/big-decimal.ts`
- Test: `test/big-decimal/big-decimal.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal comparison', () => {
  test('eq', () => {
    expect(new BigDecimal('1.0').eq(new BigDecimal('1'))).toBe(true);
    expect(new BigDecimal('1.5').eq(1.5)).toBe(true);
    expect(new BigDecimal('1').eq(2)).toBe(false);
    expect(new BigDecimal(NaN).eq(NaN)).toBe(false); // NaN !== NaN
  });

  test('lt / lte', () => {
    expect(new BigDecimal('1').lt(new BigDecimal('2'))).toBe(true);
    expect(new BigDecimal('2').lt(new BigDecimal('1'))).toBe(false);
    expect(new BigDecimal('1').lt(1)).toBe(false);
    expect(new BigDecimal('1').lte(1)).toBe(true);
  });

  test('gt / gte', () => {
    expect(new BigDecimal('2').gt(new BigDecimal('1'))).toBe(true);
    expect(new BigDecimal('1').gt(new BigDecimal('2'))).toBe(false);
    expect(new BigDecimal('1').gte(1)).toBe(true);
  });

  test('cmp', () => {
    expect(new BigDecimal('1').cmp(new BigDecimal('2'))).toBe(-1);
    expect(new BigDecimal('2').cmp(new BigDecimal('1'))).toBe(1);
    expect(new BigDecimal('1').cmp(new BigDecimal('1'))).toBe(0);
  });

  test('comparison with different exponents', () => {
    // 1.5 vs 150 (different exponents, different values)
    expect(new BigDecimal('1.5').lt(new BigDecimal('150'))).toBe(true);
    // 0.0015 vs 0.15
    expect(new BigDecimal('0.0015').lt(new BigDecimal('0.15'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement comparison**

Internal helper: `cmp(other)` aligns exponents (multiply the smaller-exponent
significand by 10^diff), then compares bigint significands. Returns -1, 0, 1.

`eq`, `lt`, `lte`, `gt`, `gte` delegate to `cmp`. Accept `BigDecimal | number`
(wrap number in BigDecimal).

**Step 4: Run tests**

**Step 5: Commit**

```
feat: add BigDecimal comparison methods
```

---

### Task 4: Core Arithmetic (add, sub, mul, neg, abs)

**Files:**
- Modify: `src/big-decimal/big-decimal.ts`
- Test: `test/big-decimal/big-decimal.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal arithmetic', () => {
  test('add', () => {
    expect(new BigDecimal('1.5').add(new BigDecimal('2.3')).toString())
      .toBe('3.8');
    expect(new BigDecimal('100').add(new BigDecimal('0.001')).toString())
      .toBe('100.001');
  });

  test('sub', () => {
    expect(new BigDecimal('5').sub(new BigDecimal('3')).toString()).toBe('2');
    expect(new BigDecimal('1').sub(new BigDecimal('1')).isZero()).toBe(true);
  });

  test('mul', () => {
    expect(new BigDecimal('3').mul(new BigDecimal('4')).toString()).toBe('12');
    expect(new BigDecimal('1.5').mul(new BigDecimal('2')).toString()).toBe('3');
    expect(new BigDecimal('0.1').mul(new BigDecimal('0.2')).toString())
      .toBe('0.02');
  });

  test('neg', () => {
    expect(new BigDecimal('5').neg().toString()).toBe('-5');
    expect(new BigDecimal('-3').neg().toString()).toBe('3');
    expect(new BigDecimal('0').neg().isZero()).toBe(true);
  });

  test('abs', () => {
    expect(new BigDecimal('-5').abs().toString()).toBe('5');
    expect(new BigDecimal('5').abs().toString()).toBe('5');
  });

  test('NaN propagation', () => {
    expect(new BigDecimal(NaN).add(new BigDecimal('1')).isNaN()).toBe(true);
    expect(new BigDecimal('1').mul(new BigDecimal(NaN)).isNaN()).toBe(true);
  });

  test('Infinity arithmetic', () => {
    expect(new BigDecimal(Infinity).add(new BigDecimal('1')).isFinite())
      .toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

- `add(other)`: align exponents, add significands, normalize.
- `sub(other)`: `this.add(other.neg())`
- `mul(other)`: multiply significands, add exponents, normalize.
- `neg()`: negate significand.
- `abs()`: absolute value of significand.
- Handle NaN/Infinity propagation in each method.

Add and mul are **exact** — no precision loss, no truncation.

**Step 4: Run tests**

**Step 5: Commit**

```
feat: add BigDecimal arithmetic (add, sub, mul, neg, abs)
```

---

### Task 5: Division, Modulo, Power (integer)

**Files:**
- Modify: `src/big-decimal/big-decimal.ts`
- Test: `test/big-decimal/big-decimal.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal division and power', () => {
  beforeAll(() => { BigDecimal.precision = 50; });

  test('div', () => {
    expect(new BigDecimal('10').div(new BigDecimal('3')).toString())
      .toMatch(/^3\.3+/); // 3.333...
    expect(new BigDecimal('1').div(new BigDecimal('4')).toString()).toBe('0.25');
    expect(new BigDecimal('0').div(new BigDecimal('5')).isZero()).toBe(true);
  });

  test('div by zero', () => {
    expect(new BigDecimal('1').div(new BigDecimal('0')).isNaN()).toBe(true);
  });

  test('mod', () => {
    expect(new BigDecimal('10').mod(new BigDecimal('3')).toString()).toBe('1');
    expect(new BigDecimal('10.5').mod(new BigDecimal('3')).toString())
      .toBe('1.5');
  });

  test('pow with positive integer', () => {
    expect(new BigDecimal('2').pow(new BigDecimal('10')).toString())
      .toBe('1024');
    expect(new BigDecimal('3').pow(new BigDecimal('0')).toString()).toBe('1');
  });

  test('pow with negative integer', () => {
    expect(new BigDecimal('2').pow(new BigDecimal('-1')).toString()).toBe('0.5');
  });

  test('high precision division', () => {
    BigDecimal.precision = 100;
    const result = new BigDecimal('1').div(new BigDecimal('7'));
    // Should have ~100 significant digits
    expect(result.toString().replace('0.', '').replace(/0+$/, '').length)
      .toBeGreaterThanOrEqual(95);
    BigDecimal.precision = 50;
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

- `div(other)`: uses `BigDecimal.precision`. Scale dividend significand by
  `10^(precision + guard)`, divide bigints, normalize. Guard digits = 10.
- `mod(other)`: `this.sub(this.div(other).trunc().mul(other))`
- `pow(n)`: for integer n, use repeated squaring (exact). For negative integer,
  `pow(abs(n)).inv()`. Non-integer pow is deferred to Task 11 (uses
  `exp(n * ln(x))`).

**Step 4: Run tests**

**Step 5: Commit**

```
feat: add BigDecimal div, mod, pow (integer exponent)
```

---

### Task 6: Rounding Methods

**Files:**
- Modify: `src/big-decimal/big-decimal.ts`
- Test: `test/big-decimal/big-decimal.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal rounding', () => {
  test('floor', () => {
    expect(new BigDecimal('3.7').floor().toString()).toBe('3');
    expect(new BigDecimal('-3.7').floor().toString()).toBe('-4');
    expect(new BigDecimal('5').floor().toString()).toBe('5');
  });

  test('ceil', () => {
    expect(new BigDecimal('3.2').ceil().toString()).toBe('4');
    expect(new BigDecimal('-3.2').ceil().toString()).toBe('-3');
  });

  test('round', () => {
    expect(new BigDecimal('3.5').round().toString()).toBe('4');
    expect(new BigDecimal('3.4').round().toString()).toBe('3');
    expect(new BigDecimal('-3.5').round().toString()).toBe('-4');
  });

  test('trunc', () => {
    expect(new BigDecimal('3.9').trunc().toString()).toBe('3');
    expect(new BigDecimal('-3.9').trunc().toString()).toBe('-3');
  });
});
```

**Step 2–5: Implement, test, commit**

Implementation: if `exponent >= 0`, already integer. If `exponent < 0`, shift
significand right by `10^(-exponent)`, apply rounding logic, normalize.

```
feat: add BigDecimal rounding (floor, ceil, round, trunc)
```

---

### Task 7: Static Constants and Precision Management

**Files:**
- Modify: `src/big-decimal/big-decimal.ts`
- Test: `test/big-decimal/big-decimal.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal constants and precision', () => {
  test('static constants exist', () => {
    expect(BigDecimal.ZERO.isZero()).toBe(true);
    expect(BigDecimal.ONE.eq(1)).toBe(true);
    expect(BigDecimal.TWO.eq(2)).toBe(true);
    expect(BigDecimal.NEGATIVE_ONE.eq(-1)).toBe(true);
    expect(BigDecimal.HALF.eq(new BigDecimal('0.5'))).toBe(true);
    expect(BigDecimal.NAN.isNaN()).toBe(true);
    expect(BigDecimal.POSITIVE_INFINITY.isFinite()).toBe(false);
    expect(BigDecimal.NEGATIVE_INFINITY.isFinite()).toBe(false);
  });

  test('precision setter updates context', () => {
    BigDecimal.precision = 100;
    expect(BigDecimal.precision).toBe(100);
    const result = new BigDecimal('1').div(new BigDecimal('3'));
    // Verify ~100 digits of precision
    const digits = result.toString().replace('0.', '').replace(/0+$/, '');
    expect(digits.length).toBeGreaterThanOrEqual(95);
    BigDecimal.precision = 50; // restore
  });
});
```

**Step 2–5: Implement, test, commit**

PI is NOT computed here — it requires transcendentals (Task 10). Add a
placeholder that throws if accessed before transcendentals are initialized. The
`BigDecimal.PI` static will be set in the transcendentals module.

```
feat: add BigDecimal static constants and precision management
```

---

## Phase 2: Transcendental Functions

### Task 8: Fixed-Point BigInt Utilities

**Files:**
- Create: `src/big-decimal/utils.ts`
- Test: `test/big-decimal/utils.test.ts`

**Step 1: Write the failing test**

```typescript
import { fpmul, fpdiv, fpsqrt } from '../../src/big-decimal/utils';

describe('fixed-point BigInt utilities', () => {
  // Working at scale = 10^20 (20 decimal digits of fractional precision)
  const SCALE = 10n ** 20n;

  test('fpmul: 1.5 * 2.0 = 3.0', () => {
    const a = 15n * SCALE / 10n; // 1.5
    const b = 2n * SCALE;        // 2.0
    expect(fpmul(a, b, SCALE)).toBe(3n * SCALE);
  });

  test('fpdiv: 1.0 / 3.0 ≈ 0.333...', () => {
    const a = 1n * SCALE;
    const b = 3n * SCALE;
    const result = fpdiv(a, b, SCALE);
    // Should be close to SCALE / 3
    const expected = SCALE / 3n;
    expect(result - expected).toBeLessThan(2n); // rounding error ≤ 1 ULP
  });

  test('fpsqrt: sqrt(2) ≈ 1.41421...', () => {
    const a = 2n * SCALE;
    const result = fpsqrt(a, SCALE);
    // Verify: result² / SCALE ≈ 2 * SCALE
    const squared = result * result / SCALE;
    const diff = squared - 2n * SCALE;
    expect(diff >= -2n && diff <= 2n).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

Create `src/big-decimal/utils.ts`:
- `fpmul(a, b, scale)`: `(a * b) / scale` — fixed-point multiply.
- `fpdiv(a, b, scale)`: `(a * scale) / b` — fixed-point divide.
- `fpsqrt(a, scale)`: Newton/Heron iteration in BigInt. Seed from
  `BigInt(Math.floor(Math.sqrt(Number(a) / Number(scale)))) * scale`. Iterate
  `x = (x + a * scale / x) / 2n` until convergence.
- Helper: `bigintAbs(n)`, `bigintSign(n)`.

**Step 4: Run tests**

**Step 5: Commit**

```
feat: add fixed-point BigInt utility functions
```

---

### Task 9: sqrt and cbrt

**Files:**
- Create: `src/big-decimal/transcendentals.ts`
- Test: `test/big-decimal/transcendentals.test.ts`

**Step 1: Write the failing test**

```typescript
import { BigDecimal } from '../../src/big-decimal';

describe('BigDecimal sqrt/cbrt', () => {
  beforeAll(() => { BigDecimal.precision = 50; });

  test('sqrt(4) = 2', () => {
    expect(new BigDecimal('4').sqrt().eq(2)).toBe(true);
  });

  test('sqrt(2) ≈ 1.41421356...', () => {
    const result = new BigDecimal('2').sqrt();
    expect(result.toString()).toMatch(/^1\.414213562373/);
  });

  test('sqrt(0) = 0', () => {
    expect(new BigDecimal('0').sqrt().isZero()).toBe(true);
  });

  test('sqrt(negative) = NaN', () => {
    expect(new BigDecimal('-1').sqrt().isNaN()).toBe(true);
  });

  test('cbrt(27) = 3', () => {
    expect(new BigDecimal('27').cbrt().toString()).toMatch(/^3(\.0*)?$/);
  });

  test('cbrt(2) ≈ 1.25992105...', () => {
    const result = new BigDecimal('2').cbrt();
    expect(result.toString()).toMatch(/^1\.259921049894/);
  });

  test('high precision sqrt', () => {
    BigDecimal.precision = 200;
    const result = new BigDecimal('2').sqrt();
    // Verify by squaring: result² should be very close to 2
    const squared = result.mul(result);
    const diff = squared.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-195'))).toBe(true);
    BigDecimal.precision = 50;
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

Create `src/big-decimal/transcendentals.ts`. Attach methods to
`BigDecimal.prototype`:

- `sqrt()`: convert to fixed-point, call `fpsqrt`, convert back. Use
  `precision + 10` guard digits internally.
- `cbrt()`: Newton iteration: `x_{n+1} = (2·x_n + a/x_n²) / 3`. Seed from
  `Math.cbrt(this.toNumber())`.

Export barrel in `src/big-decimal/index.ts`:

```typescript
export { BigDecimal } from './big-decimal';
import './transcendentals'; // side-effect: attaches methods to prototype
```

**Step 4: Run tests**

**Step 5: Commit**

```
feat: add BigDecimal sqrt and cbrt
```

---

### Task 10: exp and ln

**Files:**
- Modify: `src/big-decimal/transcendentals.ts`
- Test: `test/big-decimal/transcendentals.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal exp/ln', () => {
  beforeAll(() => { BigDecimal.precision = 50; });

  test('exp(0) = 1', () => {
    expect(new BigDecimal('0').exp().eq(1)).toBe(true);
  });

  test('exp(1) ≈ 2.71828182845...', () => {
    const result = new BigDecimal('1').exp();
    expect(result.toString()).toMatch(/^2\.718281828459045/);
  });

  test('ln(1) = 0', () => {
    expect(new BigDecimal('1').ln().isZero()).toBe(true);
  });

  test('ln(e) ≈ 1', () => {
    const e = new BigDecimal('1').exp();
    const result = e.ln();
    const diff = result.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('exp(ln(x)) ≈ x', () => {
    const x = new BigDecimal('42.5');
    const result = x.ln().exp();
    const diff = result.sub(x).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('ln(negative) = NaN', () => {
    expect(new BigDecimal('-1').ln().isNaN()).toBe(true);
  });

  test('ln(0) = -Infinity', () => {
    expect(new BigDecimal('0').ln().isNegative()).toBe(true);
    expect(new BigDecimal('0').ln().isFinite()).toBe(false);
  });

  test('log base 10', () => {
    const result = new BigDecimal('1000').log(10);
    const diff = result.sub(new BigDecimal('3')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('high precision exp', () => {
    BigDecimal.precision = 200;
    const result = new BigDecimal('1').exp();
    // Known digits of e
    expect(result.toString()).toMatch(
      /^2\.71828182845904523536028747135266249775724709369995/
    );
    BigDecimal.precision = 50;
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

**`exp(x)`**: Argument reduction: compute `k` such that `|x / 2^k| < 1`. Then
Taylor: `exp(r) = Σ r^n / n!` for small `r`. Finally `exp(x) = exp(r)^(2^k)`.
All in fixed-point BigInt. Use rectangular splitting for efficiency: group ~√n
terms.

**`ln(x)`**: AGM method. `ln(x) = π / (2 · AGM(1, 4/s))` where
`s = x · 2^m` with `m` chosen so `s · 2^p > 1`. AGM converges quadratically:
~log2(precision) iterations. Requires `BigDecimal.PI` — compute π lazily here
using Machin-like formula via `atan` (or iterative Brent-Salamin). Cache it.

**`log(base)`**: `this.ln().div(new BigDecimal(base).ln())`

Also: compute and cache `BigDecimal.PI` here. Set the static property once
computed.

**Step 4: Run tests**

**Step 5: Commit**

```
feat: add BigDecimal exp, ln, log and PI computation
```

---

### Task 11: Trigonometric Functions (sin, cos, tan, asin, acos, atan)

**Files:**
- Modify: `src/big-decimal/transcendentals.ts`
- Test: `test/big-decimal/transcendentals.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal trigonometry', () => {
  beforeAll(() => { BigDecimal.precision = 50; });

  test('sin(0) = 0', () => {
    expect(new BigDecimal('0').sin().isZero()).toBe(true);
  });

  test('cos(0) = 1', () => {
    expect(new BigDecimal('0').cos().eq(1)).toBe(true);
  });

  test('sin(π/2) ≈ 1', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const diff = piHalf.sin().sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cos(π) ≈ -1', () => {
    const diff = BigDecimal.PI.cos().sub(new BigDecimal('-1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin²(x) + cos²(x) ≈ 1', () => {
    const x = new BigDecimal('1.234');
    const s = x.sin();
    const c = x.cos();
    const sum = s.mul(s).add(c.mul(c));
    const diff = sum.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tan(x) = sin(x)/cos(x)', () => {
    const x = new BigDecimal('0.7');
    const tanX = x.tan();
    const ratio = x.sin().div(x.cos());
    const diff = tanX.sub(ratio).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('asin(0) = 0', () => {
    expect(new BigDecimal('0').asin().isZero()).toBe(true);
  });

  test('acos(1) = 0', () => {
    const diff = new BigDecimal('1').acos().abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('acos(-1) ≈ π', () => {
    const diff = new BigDecimal('-1').acos().sub(BigDecimal.PI).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan(1) ≈ π/4', () => {
    const piQuarter = BigDecimal.PI.div(new BigDecimal('4'));
    const diff = new BigDecimal('1').atan().sub(piQuarter).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2', () => {
    const result = BigDecimal.atan2(new BigDecimal('1'), new BigDecimal('1'));
    const piQuarter = BigDecimal.PI.div(new BigDecimal('4'));
    const diff = result.sub(piQuarter).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('static sqrt and log10', () => {
    expect(BigDecimal.sqrt(new BigDecimal('9')).eq(3)).toBe(true);
    const log10_1000 = BigDecimal.log10(new BigDecimal('1000'));
    expect(log10_1000.sub(new BigDecimal('3')).abs().lt(
      new BigDecimal('1e-45')
    )).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

**`sin(x)` / `cos(x)`**: Argument reduction modulo 2π (using cached PI). Then
double-angle reduction: `sin(x) = 2·sin(x/2)·cos(x/2)` repeated until
`|x| < 0.5`. Taylor series for small args:
`sin(r) = r - r³/3! + r⁵/5! - ...`, `cos(r) = 1 - r²/2! + r⁴/4! - ...`.

**`tan(x)`**: `sin(x).div(cos(x))`

**`atan(x)`**: For `|x| ≤ 0.5`: Taylor `x - x³/3 + x⁵/5 - ...`. For larger
args: reduce via `atan(x) = 2·atan(x / (1 + sqrt(1+x²)))`. Iterate until small.

**`asin(x)`**: `atan(x / sqrt(1 - x²))`

**`acos(x)`**: `PI/2 - asin(x)`

**`atan2(y, x)`**: Standard quadrant logic using `atan(y/x)` + sign adjustments.

**Static methods**: `BigDecimal.sqrt(x)` delegates to `x.sqrt()`.
`BigDecimal.log10(x)` = `x.log(10)`.

**Step 4: Run tests**

**Step 5: Commit**

```
feat: add BigDecimal trig functions (sin, cos, tan, asin, acos, atan, atan2)
```

---

### Task 12: Hyperbolic Functions and Non-Integer Power

**Files:**
- Modify: `src/big-decimal/transcendentals.ts`
- Test: `test/big-decimal/transcendentals.test.ts`

**Step 1: Write the failing test**

```typescript
describe('BigDecimal hyperbolic and pow', () => {
  beforeAll(() => { BigDecimal.precision = 50; });

  test('sinh(0) = 0', () => {
    expect(new BigDecimal('0').sinh().isZero()).toBe(true);
  });

  test('cosh(0) = 1', () => {
    expect(new BigDecimal('0').cosh().eq(1)).toBe(true);
  });

  test('tanh identity', () => {
    const x = new BigDecimal('1');
    const result = x.tanh();
    const expected = x.sinh().div(x.cosh());
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('pow with non-integer exponent', () => {
    // 4^0.5 = 2
    const result = new BigDecimal('4').pow(new BigDecimal('0.5'));
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('pow with fractional exponent', () => {
    // 8^(1/3) = 2
    const exp = new BigDecimal('1').div(new BigDecimal('3'));
    const result = new BigDecimal('8').pow(exp);
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });
});
```

**Step 2–5: Implement, test, commit**

- `sinh(x)`: `(exp(x) - exp(-x)) / 2`
- `cosh(x)`: `(exp(x) + exp(-x)) / 2`
- `tanh(x)`: `sinh(x) / cosh(x)`
- `pow(non-integer)`: `exp(n.mul(this.ln()))` — delegates to exp and ln.

```
feat: add BigDecimal hyperbolic functions and non-integer pow
```

---

### Task 13: Cross-Validation Against Decimal.js

**Files:**
- Create: `test/big-decimal/cross-validation.test.ts`

**Step 1: Write cross-validation tests**

```typescript
import { BigDecimal } from '../../src/big-decimal';
import { Decimal } from 'decimal.js';

/**
 * Compare BigDecimal results against Decimal.js at multiple precisions.
 * This is the key correctness gate before migration.
 */
describe('BigDecimal vs Decimal.js cross-validation', () => {
  for (const prec of [50, 100, 500]) {
    describe(`at precision ${prec}`, () => {
      beforeAll(() => {
        BigDecimal.precision = prec;
        Decimal.set({ precision: prec });
      });

      test('1/7', () => {
        const ours = new BigDecimal('1').div(new BigDecimal('7')).toString();
        const theirs = new Decimal('1').div('7').toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });

      test('sqrt(2)', () => {
        const ours = new BigDecimal('2').sqrt().toString();
        const theirs = new Decimal('2').sqrt().toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });

      test('exp(1)', () => {
        const ours = new BigDecimal('1').exp().toString();
        const theirs = new Decimal('1').exp().toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });

      test('ln(2)', () => {
        const ours = new BigDecimal('2').ln().toString();
        const theirs = new Decimal('2').ln().toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });

      test('sin(1)', () => {
        const ours = new BigDecimal('1').sin().toString();
        const theirs = new Decimal('1').sin().toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });

      test('cos(1)', () => {
        const ours = new BigDecimal('1').cos().toString();
        const theirs = new Decimal('1').cos().toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });

      test('atan(1)', () => {
        const ours = new BigDecimal('1').atan().toString();
        const theirs = new Decimal('1').atan().toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });

      test('PI', () => {
        const ours = BigDecimal.PI.toString();
        const theirs = Decimal.acos(-1).toString();
        expect(ours.slice(0, prec - 5)).toBe(theirs.slice(0, prec - 5));
      });
    });
  }
});
```

**Step 2: Run tests — all should pass if Phases 1-2 are correct**

**Step 3: Fix any discrepancies found**

**Step 4: Commit**

```
test: add BigDecimal cross-validation against Decimal.js
```

---

### Task 14: Performance Benchmarks

**Files:**
- Create: `test/big-decimal/benchmarks.ts`

**Step 1: Write benchmarks**

Create a benchmark script (not a Jest test — run manually):

```typescript
import { BigDecimal } from '../../src/big-decimal';
import { Decimal } from 'decimal.js';

function bench(name: string, fn: () => void, iterations = 1000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  console.log(`${name}: ${(elapsed / iterations).toFixed(3)}ms/op (${iterations} iterations)`);
}

for (const prec of [50, 100, 500, 1000]) {
  console.log(`\n=== Precision: ${prec} ===`);
  BigDecimal.precision = prec;
  Decimal.set({ precision: prec });

  bench(`BigDecimal add (p=${prec})`, () => {
    new BigDecimal('123.456').add(new BigDecimal('789.012'));
  }, 10000);
  bench(`Decimal.js add (p=${prec})`, () => {
    new Decimal('123.456').add('789.012');
  }, 10000);

  bench(`BigDecimal mul (p=${prec})`, () => {
    new BigDecimal('123.456').mul(new BigDecimal('789.012'));
  }, 10000);
  bench(`Decimal.js mul (p=${prec})`, () => {
    new Decimal('123.456').mul('789.012');
  }, 10000);

  bench(`BigDecimal div (p=${prec})`, () => {
    new BigDecimal('1').div(new BigDecimal('7'));
  }, 1000);
  bench(`Decimal.js div (p=${prec})`, () => {
    new Decimal('1').div('7');
  }, 1000);

  bench(`BigDecimal exp (p=${prec})`, () => {
    new BigDecimal('1.5').exp();
  }, 100);
  bench(`Decimal.js exp (p=${prec})`, () => {
    new Decimal('1.5').exp();
  }, 100);

  bench(`BigDecimal sin (p=${prec})`, () => {
    new BigDecimal('1.5').sin();
  }, 100);
  bench(`Decimal.js sin (p=${prec})`, () => {
    new Decimal('1.5').sin();
  }, 100);

  bench(`BigDecimal ln (p=${prec})`, () => {
    new BigDecimal('42.5').ln();
  }, 100);
  bench(`Decimal.js ln (p=${prec})`, () => {
    new Decimal('42.5').ln();
  }, 100);
}
```

**Step 2: Run benchmarks**

Run: `npx tsx test/big-decimal/benchmarks.ts`

Document results. If any operation is significantly slower than Decimal.js,
investigate and optimize before proceeding to Phase 3.

**Step 3: Commit**

```
test: add BigDecimal performance benchmarks
```

---

## Phase 3: Compute Engine Migration

### Task 15: Update Type Aliases and Interfaces

**Files:**
- Modify: `src/compute-engine/numerics/types.ts`
- Modify: `src/compute-engine/numeric-value/types.ts`

**Step 1: Update `numerics/types.ts`**

- Change `import { Decimal } from 'decimal.js'` →
  `import { BigDecimal } from '../../big-decimal'`
- Change `export type BigNum = Decimal` → `export type BigNum = BigDecimal`
- Remove `BigNumFactory` type
- Remove `IBigNum` interface (constants now on `BigDecimal.*`)

**Step 2: Update `numeric-value/types.ts`**

- Change `import { Decimal } from 'decimal.js'` →
  `import { BigDecimal } from '../../big-decimal'`
- Change all `Decimal` type references → `BigDecimal`
- Update `NumericValueData.re` type: `Decimal | number` → `BigDecimal | number`
- Update `NumericValueFactory` parameter type
- Update abstract method signatures in `NumericValue`

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: many errors in consuming files (expected — they still import Decimal).

**Step 4: Commit**

```
refactor: update type aliases from Decimal to BigDecimal
```

---

### Task 16: Migrate `EngineNumericConfiguration`

**Files:**
- Modify: `src/compute-engine/engine-numeric-configuration.ts`

**Step 1: Rewrite the file**

- Replace `import { Decimal } from 'decimal.js'` →
  `import { BigDecimal } from '../big-decimal'`
- Remove `_bignum: Decimal.Constructor` field
- `setPrecision()`: call `BigDecimal.precision = n` instead of
  `Decimal.clone({ precision })`
- Remove `BignumConstants` type — constants are now `BigDecimal.ZERO`, etc.
- Remove `computeConstants()` method
- Simplify `bignum(value)` to `new BigDecimal(value)`
- Update tolerance fields from `Decimal` to `BigDecimal`
- Replace all constant getters (`bignumZero`, `bignumOne`, etc.) with delegations
  to `BigDecimal.*`

**Step 2: Run typecheck**

**Step 3: Commit**

```
refactor: migrate EngineNumericConfiguration to BigDecimal
```

---

### Task 17: Migrate `BigNumericValue`

**Files:**
- Modify: `src/compute-engine/numeric-value/big-numeric-value.ts`

This is the largest single file change.

**Step 1: Update imports and fields**

- Replace `import { Decimal } from 'decimal.js'` →
  `import { BigDecimal } from '../../big-decimal'`
- `decimal: Decimal` → `decimal: BigDecimal`
- Remove `bignum: BigNumFactory` field
- Update constructor: remove `bignum` parameter, use `new BigDecimal(value)`
- `instanceof Decimal` → `instanceof BigDecimal`

**Step 2: Update all method bodies**

All Decimal method calls map 1:1 to BigDecimal. The method names are the same
by design. Key changes:
- `Decimal.atan2(b, a)` → `BigDecimal.atan2(b, a)` (3 locations)
- `this.bignum(x)` → `new BigDecimal(x)` (3 locations)
- `decimalToString` helper: update to use BigDecimal's `toString()` and
  `toFixed()` (adjust the internal `.d` / `.e` access — BigDecimal uses
  `.significand` / `.exponent`)

**Step 3: Run typecheck**

**Step 4: Commit**

```
refactor: migrate BigNumericValue to BigDecimal
```

---

### Task 18: Migrate Engine Core (`index.ts`, `types-engine.ts`)

**Files:**
- Modify: `src/compute-engine/index.ts`
- Modify: `src/compute-engine/types-engine.ts`

**Step 1: Update `types-engine.ts`**

- Replace `Decimal` type references → `BigDecimal`
- Remove `_BIGNUM_*` property declarations from engine interface (or redirect to
  `BigDecimal.*`)

**Step 2: Update `index.ts`**

- Replace import
- Update `_BIGNUM_*` getters to return `BigDecimal.*` statics
- Update `bignum()` method to use `new BigDecimal()`
- Remove `BigNumFactory` usage

**Step 3: Run typecheck**

**Step 4: Commit**

```
refactor: migrate engine core to BigDecimal
```

---

### Task 19: Migrate Remaining Files (Batch)

**Files (11 files with mechanical changes):**
- `src/compute-engine/numerics/bigint.ts` — `instanceof Decimal` → `instanceof BigDecimal`
- `src/compute-engine/numerics/numeric-bignum.ts` — update `IBigNum` usage, fix
  `isInMachineRange` to use `BigDecimal.significand` / `.exponent` instead of
  `.d` / `.e`
- `src/compute-engine/numeric-value/machine-numeric-value.ts` — `instanceof Decimal` check
- `src/compute-engine/numeric-value/exact-numeric-value.ts` — remove `BigNumFactory` field
- `src/compute-engine/boxed-expression/serialize.ts` — type swap
- `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` — type swap
- `src/compute-engine/boxed-expression/trigonometry.ts` — `Decimal.atan2` →
  `BigDecimal.atan2`, `ce._BIGNUM_ONE` → `BigDecimal.ONE`
- `src/compute-engine/boxed-expression/apply.ts` — factory calls
- `src/compute-engine/boxed-expression/numerics.ts` — factory calls
- `src/compute-engine/boxed-expression/box.ts` — type swap
- `src/compute-engine/boxed-expression/boxed-number.ts` — factory calls
- `src/compute-engine/engine-expression-entrypoints.ts` — type swap
- `src/compute-engine/library/arithmetic.ts` — `Decimal.log10` → `BigDecimal.log10`
- `src/compute-engine/library/trigonometry.ts` — `ce._BIGNUM_PI` → `BigDecimal.PI`
- `src/compute-engine/library/number-theory.ts` — `Decimal.sqrt` → `BigDecimal.sqrt`

**Step 1: Update all files**

For each file:
1. Replace `import { Decimal } from 'decimal.js'` →
   `import { BigDecimal } from '../../big-decimal'` (adjust relative path)
2. Replace `Decimal` type references → `BigDecimal`
3. Replace `ce._BIGNUM_*` → `BigDecimal.*`
4. Replace `ce.bignum(x)` → `new BigDecimal(x)` where `bignum` factory was used
5. Replace `Decimal.staticMethod()` → `BigDecimal.staticMethod()`
6. Replace `instanceof Decimal` → `instanceof BigDecimal`

**Step 2: Special attention: `isInMachineRange`** in `numeric-bignum.ts`

This function accesses Decimal internals (`d.d`, `d.e`, `d.precision()`). Rewrite
to use BigDecimal's public API:
- Check if `significand` fits in a safe integer range
- Check if the effective exponent is within IEEE 754 range

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors (all files migrated).

**Step 4: Commit**

```
refactor: migrate remaining 15 files from Decimal to BigDecimal
```

---

### Task 20: Migrate Special Functions

**Files:**
- Modify: `src/compute-engine/numerics/special-functions.ts`

**Step 1: Update imports**

The file uses `BigNum` type (which now resolves to `BigDecimal`). Update:
- `ce.bignum(x)` → `new BigDecimal(x)` in all factory calls
- `ce._BIGNUM_*` → `BigDecimal.*` for all constant references
- `.minus()` → `.sub()` (if BigDecimal uses `sub` not `minus`)
- `.times()` → `.mul()` (if BigDecimal uses `mul` not `times`)
- `.lessThan()` → `.lt()`
- `.greaterThan()` → `.gt()`
- `.modulo()` → `.mod()`

Note: `bigGammaln`, `bigGamma`, `bigDigamma`, `bigTrigamma`, `bigPolygamma`,
`bigBeta`, `bigZeta`, `bigLambertW` all use the same pattern: BigNum arithmetic
with `ce._BIGNUM_*` constants. The algorithms don't change — only the types
and method names.

**Step 2: Run typecheck**

**Step 3: Commit**

```
refactor: migrate special functions to BigDecimal
```

---

### Task 21: Remove Decimal.js Dependency

**Files:**
- Modify: `package.json`

**Step 1: Remove dependency**

Run: `npm uninstall decimal.js`

**Step 2: Verify no remaining imports**

Search: `grep -r "decimal.js" src/` — should return 0 results.

**Step 3: Run full build**

Run: `npm run build`
Expected: success, no errors.

**Step 4: Commit**

```
chore: remove decimal.js dependency
```

---

### Task 22: Run Full Test Suite

**Step 1: Run all tests**

Run: `npm run test compute-engine/numeric-mode`
Run: `npm run test compute-engine/numeric`
Run: `npm run test compute-engine/arithmetic`
Run: `npm run test compute-engine/trigonometry`

Then run the full suite to catch anything else.

**Step 2: Fix any failures**

Snapshot updates may be needed if string formatting differs slightly (e.g.,
trailing digit differences at the precision boundary). Use
`npm run test snapshot` to update snapshots after verifying the differences
are acceptable (within guard digit tolerance, not algorithmic errors).

**Step 3: Commit**

```
test: verify full test suite passes with BigDecimal
```

---

### Task 23: Run Benchmarks and Document Results

**Step 1: Run benchmarks from Task 14**

Run: `npx tsx test/big-decimal/benchmarks.ts`

**Step 2: Document results**

Add results to the design doc or a new `docs/plans/2026-02-27-big-decimal-benchmarks.md`.

**Step 3: Commit**

```
docs: add BigDecimal benchmark results
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| **Phase 1** | 1-7 | Core BigDecimal: construction, conversion, comparison, arithmetic, rounding, constants |
| **Phase 2** | 8-14 | Transcendentals: sqrt, exp, ln, trig, hyperbolic + cross-validation + benchmarks |
| **Phase 3** | 15-23 | Compute engine migration: swap all 19 files, remove decimal.js, verify tests |

Total: 23 tasks. Phase 1 and 2 can be developed and validated independently
before touching any compute-engine code. Phase 3 is a mechanical migration
once BigDecimal is proven correct and performant.
