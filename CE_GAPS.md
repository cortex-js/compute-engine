# Compute Engine Gaps Analysis

Analysis of functions in `tests/visual/plotting/grid_paper.html` that cannot be
converted from raw JavaScript to LaTeX/CE compilation.

## Summary

**Total functions analyzed:** ~51 **Converted to LaTeX:** 17 (33%) **Must remain
as JS:** 34 (67%)

## Categories of Unconvertible Functions

### 1. Procedural Logic with Loops (10 functions)

Functions that accumulate values iteratively cannot be expressed as single LaTeX
expressions.

#### Fourier Series Approximations

```javascript
function fourierSquare(nTerms) {
  return (x) => {
    let sum = 0;
    for (let k = 0; k < nTerms; k++) {
      const n = 2 * k + 1;
      sum += Math.sin(n * x) / n;
    }
    return (4 / PI) * sum;
  };
}
```

**Why unconvertible:** Requires loop to sum terms. Would need explicit LaTeX
formula for each term count (1, 3, 7, 15 terms).

**Potential solution:** Could generate explicit LaTeX strings for specific term
counts:

- 1 term: `"(4/\\pi)\\sin(x)"`
- 3 terms: `"(4/\\pi)(\\sin(x) + \\sin(3x)/3 + \\sin(5x)/5)"`
- etc.

#### Taylor Series Approximations

```javascript
function taylorSin(order) {
  return (x) => {
    let sum = 0;
    for (let k = 0; k <= order; k++) {
      const n = 2 * k + 1;
      let factorial = 1;
      for (let j = 2; j <= n; j++) factorial *= j;
      sum += (Math.pow(-1, k) * Math.pow(x, n)) / factorial;
    }
    return sum;
  };
}
```

**Why unconvertible:** Nested loops for factorial calculation and term
summation.

**Potential solution:** Explicit formulas:

- Order 0: `"x"`
- Order 1: `"x - x^3/6"`
- Order 2: `"x - x^3/6 + x^5/120"`
- etc.

**CE Gap:** No support for summation notation (`\sum_{k=0}^{n}`) with runtime
variable `n`.

---

### 2. Conditional Logic (6 functions)

Functions with branching logic based on runtime conditions.

#### Single-Slit Diffraction Pattern

```javascript
fn: (x) => (Math.abs(x) < 0.001 ? 1.0 : Math.pow(Math.sin(x) / x, 2));
```

**Why unconvertible:** Conditional to avoid division by zero at x=0.

**CE Gap:** No piecewise function support in LaTeX, or sinc function that
handles x=0 correctly.

**Potential workaround:** Use limit behavior:
`"\left(\frac{\sin(x)}{x}\right)^2"` and rely on CE to handle the singularity.

#### Step Function

```javascript
fn: (t) => (t >= 0 ? 1 : 0);
```

**Why unconvertible:** Conditional logic.

**CE Gap:** No Heaviside step function `H(t)` or support for `\begin{cases}`
piecewise notation.

#### Step Response (Control Systems)

```javascript
fn: (t) =>
  t < 0
    ? 0
    : 1 -
      (Math.exp(-zeta * t) / Math.sqrt(1 - zeta * zeta)) *
        Math.sin(
          Math.sqrt(1 - zeta * zeta) * t +
            Math.atan2(Math.sqrt(1 - zeta * zeta), zeta)
        );
```

**Why unconvertible:** Conditional with complex expression.

---

### 3. Helper Functions with Complex Calculations (15 functions)

Functions that call other helper functions with complex intermediate
calculations.

#### Planck's Law (Blackbody Radiation)

```javascript
function planckArb(lambda, T) {
  const x = 5.0 / ((T / 3000) * lambda);
  if (x > 500) return 1e-20; // Avoid overflow
  return 1.0 / Math.pow(lambda, 5) / (Math.exp(x) - 1);
}
// Called with: fn: (lambda) => planckArb(lambda, T)
```

**Why unconvertible:**

- Uses helper function with intermediate calculation
- Has overflow protection conditional
- Temperature `T` is external parameter

**Potential solution:** Inline the formula with constants:

```latex
\frac{1}{\lambda^5(\exp(5/(T\lambda/3000)) - 1)}
```

But still needs conditional logic for overflow protection.

#### Radioactive Decay Chain (A → B → C)

```javascript
const lambda_A = 0.5, lambda_B = 0.3;
const decayA = (t) => Math.exp(-lambda_A * t);
const decayB = (t) => /* complex expression */;
const decayC = (t) => /* complex expression */;

// Stacked area plot uses:
fn: (t) => decayC(t) + decayB(t) + decayA(t)
```

**Why unconvertible:** Requires solving coupled differential equations; formulas
are very long.

**Potential solution:** Could inline if formulas are expanded, but expressions
become unwieldy.

#### Gaussian Distribution

```javascript
function gaussian(x) {
  const sigma = 1.5;
  const norm = 1 / (sigma * Math.sqrt(2 * PI));
  return norm * Math.exp((-x * x) / (2 * sigma * sigma));
}
```

**Why unconvertible:** Uses helper function.

**Potential solution:** Inline:
`"\frac{1}{1.5\sqrt{2\pi}}\exp(-x^2/(2 \cdot 1.5^2))"` ✅

**This could be converted!**

#### Kernel Density Estimation (KDE)

```javascript
function kde(x) {
  let sum = 0;
  const h = 0.5; // bandwidth
  for (const xi of kdeSamples) {
    const u = (x - xi) / h;
    sum += gaussian(u); // Epanechnikov kernel
  }
  return sum / (kdeSamples.length * h);
}
```

**Why unconvertible:** Loop over data points, calls gaussian helper.

---

#### Dose-Response Sigmoid

```javascript
const doseA = 0.1,
  doseB = 0.9,
  doseC = 5.0,
  doseN = 2.5;
fn: (x) => doseA + doseB / (1 + Math.pow(x / doseC, doseN));
```

**Why unconvertible:** Uses external constants.

**Potential solution:** Inline constants: `"0.1 + 0.9/(1 + (x/5)^{2.5})"` ✅

**This could be converted!**

#### Chemical Kinetics (A → B → C)

Similar to radioactive decay - complex coupled expressions.

---

### 4. Complex Transformations (7 functions)

Functions involving multi-step transformations or special functions.

#### Spherical Harmonics

```javascript
fn: (theta, phi) => {
  // Real spherical harmonic Y_3^2
  const cost = Math.cos(theta);
  const sint = Math.sin(theta);
  const Y = /* complex expression with associated Legendre polynomials */;
  const r = 1 + 0.3 * Y;
  return [r * sint * Math.cos(phi), r * sint * Math.sin(phi), r * cost];
}
```

**Why unconvertible:** Requires intermediate calculations, special functions
(associated Legendre polynomials).

**CE Gap:** No support for spherical harmonics `Y_l^m(\theta, \phi)`.

#### Joukowski Transformation (Airfoil)

```javascript
const cx = -0.1,
  cy = 0.14,
  radius = 1.02;
fn: (t) => {
  const zx = cx + radius * Math.cos(t);
  const zy = cy + radius * Math.sin(t);
  const wx = zx + zx / (zx * zx + zy * zy);
  const wy = zy - zy / (zx * zx + zy * zy);
  return [wx, wy];
};
```

**Why unconvertible:** Multi-step transformation requiring intermediate
variables.

**Potential solution:** Could be expanded into a single tuple expression, but
would be very complex.

#### Antenna Radiation Patterns

```javascript
function dipoleGain(theta) {
  const stheta = Math.sin(theta);
  return Math.abs(stheta) < 0.01
    ? 0
    : Math.pow(Math.cos((PI / 2) * Math.cos(theta)) / stheta, 2);
}
fn: (t) => [dipoleGain(t) * Math.cos(t), dipoleGain(t) * Math.sin(t)];
```

**Why unconvertible:** Conditional in gain calculation, complex expression.

---

### 5. Array/Data Indexing (2 functions)

Functions that index into pre-computed data arrays.

#### Cornu Spiral (Fresnel Integrals)

```javascript
const cornuPts = /* 200 pre-computed [x, y] points */;
fn: (i) => {
  const idx = Math.floor(i);
  return cornuPts[Math.min(idx, cornuPts.length - 1)];
}
```

**Why unconvertible:** Requires array lookup. Fresnel integrals don't have
closed-form expressions.

**CE Gap:** No support for Fresnel integrals
`C(t) = \int_0^t \cos(\pi u^2/2) du`.

---

### 6. Runtime-Computed Parameters (1 function)

Functions that use values computed at runtime from dynamic data.

#### Linear Regression Fit

```javascript
// Compute least-squares fit from random data
const m = num / den; // slope
const b = yMean - m * xMean; // intercept
fn: (x) => m * x + b;
```

**Why unconvertible:** `m` and `b` are computed from runtime data.

**Potential solution:** Use `DerivedSeries`! The plot library now supports
derived series that can reference other series' data.

**Action item:** Investigate using `type: 'derived'` with fit operations.

---

## Recommendations

### Immediate Wins (Could be converted with effort)

1. **Gaussian Distribution** - Inline constants
2. **Dose-Response Sigmoid** - Inline constants
3. **Fourier/Taylor Series** - Generate explicit LaTeX for specific term counts
4. **Some parametric surfaces** - Expand multi-step calculations into single
   expressions

### CE Feature Requests

1. **Piecewise functions** - Support `\begin{cases}` or Heaviside `H(x)`
2. **Summation notation** - Support `\sum_{k=0}^{n}` with runtime `n`
3. **Special functions** - Fresnel integrals, spherical harmonics, Bessel
   functions
4. **Sign function** - `\operatorname{sgn}(x)`

### Integration with DerivedSeries

The plot library supports `type: 'derived'` series that can:

- Reference other series via `source: 'series-id'`
- Apply transformations: `transform: 'cumsum'`, `'derivative'`,
  `'moving-average'`
- Compute regression fits

**Investigation needed:** Can DerivedSeries replace runtime-computed parameters
like the regression fit?

---

## Conversion Statistics

| Category               | Count  | % of Total |
| ---------------------- | ------ | ---------- |
| Procedural (loops)     | 10     | 20%        |
| Conditionals           | 6      | 12%        |
| Helper functions       | 15     | 29%        |
| Complex transforms     | 7      | 14%        |
| Array indexing         | 2      | 4%         |
| Runtime parameters     | 1      | 2%         |
| **Converted to LaTeX** | **17** | **33%**    |
| **Total**              | **51** | **100%**   |

---

## Appendix: Full List of Unconvertible Functions

### Procedural Logic

1. Fourier square wave (4 variants: 1, 3, 7, 15 terms)
2. Taylor series sin(x) (4 variants: orders 0-3)
3. KDE (kernel density estimation)

### Conditionals

4. Square wave: `Math.sign(Math.sin(x))`
5. Diffraction pattern: `Math.abs(x) < 0.001 ? 1.0 : pow(sin(x)/x, 2)`
6. Step input: `t >= 0 ? 1 : 0`
7. Step response (control systems)

### Helper Functions

8. Planck's law (blackbody radiation)
9. Radioactive decay chain (3 stacked functions)
10. Gaussian distribution (2 instances) - **Could be converted**
11. Dose-response sigmoid - **Could be converted**
12. Chemical kinetics (3 stacked functions)
13. Drumhead vibration (Bessel functions)

### Complex Transformations

14. Spherical harmonics
15. Joukowski airfoil (2 curves: circle + airfoil)
16. Dipole antenna pattern
17. Cardioid antenna pattern
18. Spirograph
19. Heart curve
20. Limaçon (depends on complexity)
21. Butterfly curve

### Array Indexing

22. Cornu spiral (2 branches: positive + negative)

### Runtime Parameters

23. Linear regression fit - **Investigate DerivedSeries**

### Verified Complex Surfaces (Multi-statement)

24. Torus - **CONVERTED** ✅
25. Klein bottle
26. Helicoid - **CONVERTED** ✅
27. Möbius strip
28. Seashell
