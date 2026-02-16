# Compute Engine Gaps Analysis

Analysis of functions in `tests/visual/plotting/grid_paper.html` that cannot be
converted from raw JavaScript to LaTeX/CE compilation.

## Summary

**Total functions analyzed:** ~51 **Converted to LaTeX:** 17 (33%) **Could be
converted with current CE:** ~10 more (see below) **Genuine CE gaps:** ~5
features needed for the remainder

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

**Status: CONVERTIBLE** (with explicit expansion)

CE supports `\sum` notation (`Sum` operator), but the `Sum` operator does not
currently compile to JavaScript — it can only be evaluated symbolically or
numerically. However, for fixed term counts the expressions can be expanded:

- 1 term: `"\frac{4}{\pi}\sin(x)"`
- 3 terms: `"\frac{4}{\pi}(\sin(x) + \frac{\sin(3x)}{3} + \frac{\sin(5x)}{5})"`
- 7 terms: expand similarly
- 15 terms: expand similarly

A helper function could generate these LaTeX strings at setup time.

**CE Gap:** `Sum` with fixed integer bounds does not compile. If it did, all
Fourier and Taylor series could be written as
`\sum_{k=0}^{n} \frac{(-1)^k}{(2k+1)!} x^{2k+1}` and compiled directly.

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

**Status: CONVERTIBLE** (with explicit expansion)

Same approach as Fourier — expand for each specific order:

- Order 0: `"x"`
- Order 1: `"x - x^3/6"`
- Order 2: `"x - x^3/6 + x^5/120"`

CE already supports `!` (factorial) and all the needed arithmetic, so the
expanded forms compile fine.

---

### 2. Conditional Logic (6 functions)

#### Single-Slit Diffraction Pattern

```javascript
fn: (x) => (Math.abs(x) < 0.001 ? 1.0 : Math.pow(Math.sin(x) / x, 2));
```

**Status: CONVERTIBLE NOW**

CE supports `If` (compiles to JS ternary, and to `_IA.piecewise` for
interval-js). Use `\begin{cases}` or construct the MathJSON directly:

LaTeX:
```latex
\begin{cases} 1 & |x| < 0.001 \\ \left(\frac{\sin(x)}{x}\right)^2 & \text{otherwise} \end{cases}
```

MathJSON: `["If", ["Less", ["Abs", "x"], 0.001], 1, ["Power", ["Divide", ["Sin", "x"], "x"], 2]]`

Both `If` and `Abs` compile on all targets (JS, interval-js, GLSL).

**Alternative:** A dedicated `Sinc` function would be cleaner. See CE gaps
below.

#### Square Wave

```javascript
fn: (x) => Math.sign(Math.sin(x));
```

**Status: CONVERTIBLE NOW**

CE has `Sign` (LaTeX: `\operatorname{sgn}`), which compiles to `Math.sign` (JS)
and `_IA.sign` (interval-js):

```latex
\operatorname{sgn}(\sin(x))
```

#### Step Function (Heaviside)

```javascript
fn: (t) => (t >= 0 ? 1 : 0);
```

**Status: CONVERTIBLE NOW**

Use `If` with a comparison:

LaTeX:
```latex
\begin{cases} 1 & t \geq 0 \\ 0 & \text{otherwise} \end{cases}
```

MathJSON: `["If", ["GreaterEqual", "t", 0], 1, 0]`

Alternatively, express using `Sign`: `\frac{1 + \operatorname{sgn}(t)}{2}`

**Note:** A dedicated `Heaviside` function would be more idiomatic. See CE gaps
below.

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

**Status: CONVERTIBLE NOW**

CE compiles `If`, `Exp`, `Sqrt`, `Sin`, and `Arctan2` (LaTeX:
`\operatorname{Arctan2}`). With `zeta` inlined as a constant (e.g., 0.3):

```latex
\begin{cases}
  0 & t < 0 \\
  1 - \frac{e^{-0.3t}}{\sqrt{1 - 0.09}} \sin(\sqrt{1 - 0.09} \cdot t + \operatorname{Arctan2}(\sqrt{1 - 0.09}, 0.3)) & \text{otherwise}
\end{cases}
```

If you want `zeta` as a parameter, use a lambda:
`\zeta \mapsto t \mapsto \begin{cases}...\end{cases}`

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

**Status: CONVERTIBLE NOW**

The core formula inlines directly. The overflow guard can use `If`. With T
inlined (e.g., T=5000):

```latex
\begin{cases}
  10^{-20} & \frac{5}{\frac{T}{3000} \lambda} > 500 \\
  \frac{1}{\lambda^5 (\exp(\frac{5}{\frac{T}{3000} \lambda}) - 1)} & \text{otherwise}
\end{cases}
```

For multiple temperature curves, generate a LaTeX string per temperature value.

#### Radioactive Decay Chain (A -> B -> C)

```javascript
const lambda_A = 0.5,
  lambda_B = 0.3;
const decayA = (t) => Math.exp(-lambda_A * t);
const decayB = (t) => /* complex expression */;
const decayC = (t) => /* complex expression */;
```

**Status: CONVERTIBLE** (verbose but straightforward)

Each decay function is a closed-form expression using `Exp`. Inline the
constants and write each as a separate LaTeX expression. The Bateman equations
are long but contain only arithmetic and exponentials — all of which compile.

#### Gaussian Distribution

```javascript
function gaussian(x) {
  const sigma = 1.5;
  const norm = 1 / (sigma * Math.sqrt(2 * PI));
  return norm * Math.exp((-x * x) / (2 * sigma * sigma));
}
```

**Status: CONVERTIBLE NOW**

```latex
\frac{1}{1.5\sqrt{2\pi}} \exp\left(\frac{-x^2}{2 \cdot 1.5^2}\right)
```

All components (`Sqrt`, `Exp`, `Pi`) compile to JS, interval-js, and GLSL.

#### Kernel Density Estimation (KDE)

```javascript
function kde(x) {
  let sum = 0;
  const h = 0.5;
  for (const xi of kdeSamples) {
    const u = (x - xi) / h;
    sum += gaussian(u);
  }
  return sum / (kdeSamples.length * h);
}
```

**Status: MUST REMAIN AS JS**

Requires iterating over a runtime data array. This is fundamentally
non-compilable — the data points are not known at LaTeX-authoring time.

**Potential approach:** For a fixed dataset, generate an expanded sum like
`\frac{1}{Nh}(G(\frac{x - x_1}{h}) + G(\frac{x - x_2}{h}) + \cdots)` with
constants inlined. Impractical for large datasets.

---

#### Dose-Response Sigmoid

```javascript
const doseA = 0.1, doseB = 0.9, doseC = 5.0, doseN = 2.5;
fn: (x) => doseA + doseB / (1 + Math.pow(x / doseC, doseN));
```

**Status: CONVERTIBLE NOW**

```latex
0.1 + \frac{0.9}{1 + (x/5)^{2.5}}
```

#### Chemical Kinetics (A -> B -> C)

Same situation as radioactive decay — closed-form Bateman equations. Verbose but
all operators compile.

**Status: CONVERTIBLE** (inline constants, expand formulas)

---

### 4. Complex Transformations (7 functions)

Functions involving multi-step transformations or special functions.

#### Spherical Harmonics

```javascript
fn: (theta, phi) => {
  const cost = Math.cos(theta);
  const sint = Math.sin(theta);
  const Y = /* complex expression with associated Legendre polynomials */;
  const r = 1 + 0.3 * Y;
  return [r * sint * Math.cos(phi), r * sint * Math.sin(phi), r * cost];
}
```

**Status: PARTIALLY CONVERTIBLE**

For *specific* (l, m) values, the associated Legendre polynomial reduces to a
known closed-form expression. For example, Y_2^0 involves only `cos(theta)` and
constants. The tuple output compiles as separate components.

For *general* spherical harmonics, CE lacks `SphericalHarmonic` and
`AssociatedLegendre` functions.

**CE Gap:** No `SphericalHarmonic(l, m, theta, phi)` or
`AssociatedLegendreP(n, m, x)` functions.

#### Joukowski Transformation (Airfoil)

```javascript
const cx = -0.1, cy = 0.14, radius = 1.02;
fn: (t) => {
  const zx = cx + radius * Math.cos(t);
  const zy = cy + radius * Math.sin(t);
  const wx = zx + zx / (zx * zx + zy * zy);
  const wy = zy - zy / (zx * zx + zy * zy);
  return [wx, wy];
};
```

**Status: CONVERTIBLE NOW**

CE supports `Block` with `Declare`/`Assign` for intermediate variables, and
this compiles to JavaScript. The Joukowski transform can be written as a block:

MathJSON:
```json
["Block",
  ["Declare", "zx"], ["Assign", "zx", ["Add", -0.1, ["Multiply", 1.02, ["Cos", "t"]]]],
  ["Declare", "zy"], ["Assign", "zy", ["Add", 0.14, ["Multiply", 1.02, ["Sin", "t"]]]],
  ["Declare", "r2"], ["Assign", "r2", ["Add", ["Power", "zx", 2], ["Power", "zy", 2]]],
  ["Tuple",
    ["Add", "zx", ["Divide", "zx", "r2"]],
    ["Subtract", "zy", ["Divide", "zy", "r2"]]
  ]
]
```

Alternatively, inline everything into a single (verbose) tuple expression — no
intermediate variables needed since `zx`, `zy` are simple.

With constants inlined into a tuple:
```latex
\left(
  (-0.1 + 1.02\cos t) + \frac{-0.1 + 1.02\cos t}{(-0.1 + 1.02\cos t)^2 + (0.14 + 1.02\sin t)^2},\;
  (0.14 + 1.02\sin t) - \frac{0.14 + 1.02\sin t}{(-0.1 + 1.02\cos t)^2 + (0.14 + 1.02\sin t)^2}
\right)
```

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

**Status: CONVERTIBLE NOW**

Use `If` for the conditional, inline the gain into each tuple component. The
expression is repeated but compilable:

```latex
\begin{cases}
  (0, 0) & |\sin\theta| < 0.01 \\
  \left(\left(\frac{\cos(\frac{\pi}{2}\cos\theta)}{\sin\theta}\right)^2 \cos\theta,\;
        \left(\frac{\cos(\frac{\pi}{2}\cos\theta)}{\sin\theta}\right)^2 \sin\theta\right) & \text{otherwise}
\end{cases}
```

Or use `Block` with an intermediate variable for the gain to avoid repetition.

#### Spirograph, Heart Curve, Butterfly Curve, Limacon

**Status: CONVERTIBLE NOW**

These are all closed-form parametric expressions using only trig and arithmetic.
They may look complex in JS due to helper variables, but inline directly to
LaTeX tuples. Examples:

- **Heart curve:** `(\sin^3 t, \frac{13\cos t - 5\cos(2t) - 2\cos(3t) - \cos(4t)}{16})`
- **Spirograph:** `((R-r)\cos t + d\cos(\frac{R-r}{r}t),\; (R-r)\sin t - d\sin(\frac{R-r}{r}t))`
- **Butterfly:** `r(\theta) = e^{\sin\theta} - 2\cos(4\theta) + \sin^5(\frac{2\theta - \pi}{24})`

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

**Status: MUST REMAIN AS JS** (without Fresnel integrals)

The parametric form `(C(t), S(t))` where `C` and `S` are Fresnel integrals
would be ideal, but CE does not implement Fresnel integrals.

**CE Gap:** No `FresnelC(t)` or `FresnelS(t)` functions.

---

### 6. Runtime-Computed Parameters (1 function)

Functions that use values computed at runtime from dynamic data.

#### Linear Regression Fit

```javascript
const m = num / den; // slope
const b = yMean - m * xMean; // intercept
fn: (x) => m * x + b;
```

**Status: CONVERTIBLE** (once m, b are known)

After computing `m` and `b`, generate a LaTeX string with the values inlined:
`"${m}x + ${b}"`. The `compile` free function accepts LaTeX strings directly.

Alternatively, use `DerivedSeries` if the plot library supports regression fits
natively.

---

## Genuine CE Gaps

These are features that would meaningfully expand what can be compiled:

### 1. Compilable `Sum`/`Product` with fixed bounds (HIGH IMPACT)

`\sum_{k=0}^{n} f(k)` parses correctly but does not compile. Adding compilation
for fixed integer bounds would enable all Fourier series, Taylor series, and
similar constructs without explicit expansion.

**Suggested implementation:** When both bounds are numeric literals, unroll the
loop in the generated code:

```javascript
// \sum_{k=0}^{3} sin((2k+1)x)/(2k+1)
// Compiles to:
(Math.sin(1*_.x)/1 + Math.sin(3*_.x)/3 + Math.sin(5*_.x)/5 + Math.sin(7*_.x)/7)
```

### 2. `Which` compilation (MEDIUM IMPACT)

`\begin{cases}` parses to `Which` but `Which` does not compile — only `If`
(two-branch conditional) compiles. Multi-branch piecewise functions require
manually nesting `If` expressions.

**Suggested implementation:** Compile to chained ternaries:
```javascript
// Which(cond1, val1, cond2, val2, True, default)
(cond1 ? val1 : (cond2 ? val2 : default))
```

### 3. Fresnel Integrals (LOW-MEDIUM IMPACT)

`FresnelC(t)` and `FresnelS(t)` would enable Cornu spirals and diffraction
patterns without pre-computed data arrays. These have well-known series
expansions and rational approximations suitable for compilation.

### 4. `Sinc` function (LOW IMPACT, CONVENIENCE)

`\operatorname{sinc}(x) = \sin(x)/x` with correct handling at x=0. Currently
requires a piecewise workaround. Not critical since `If` works, but would be
more natural.

### 5. Spherical Harmonics / Associated Legendre (LOW IMPACT, SPECIALIZED)

Only needed for advanced 3D surface visualizations. Low priority since specific
(l, m) values can be expanded to closed-form expressions manually.

---

## Updated Conversion Assessment

With the findings above, many more functions are convertible than originally
estimated:

| Category               | Total | Convertible Now | Was marked unconvertible |
| ---------------------- | ----- | --------------- | ----------------------- |
| Procedural (loops)     | 10    | 8 (expand)      | All 10                  |
| Conditionals           | 6     | 6 (`If`, `Sign`)| All 6                   |
| Helper functions       | 15    | 12 (inline)     | All 15                  |
| Complex transforms     | 7     | 6 (inline/Block)| All 7                   |
| Array indexing         | 2     | 0               | 2                       |
| Runtime parameters     | 1     | 1 (inline vals) | 1                       |
| **Already converted**  | **17**| **17**          | -                       |
| **Total**              | **51**| **50**          |                         |

**Revised conversion rate:** ~50/51 (98%) can be expressed in LaTeX/MathJSON
with current CE capabilities. The only truly unconvertible function is KDE
(requires iterating over a runtime data array).

The Cornu spiral *could* be converted if Fresnel integrals were added to CE.

---

## Key Techniques for Conversion

### Using `If` for conditionals

CE's `If` operator compiles to JS (ternary), interval-js (`_IA.piecewise`), and
GLSL. It is the primary tool for piecewise functions:

```latex
\begin{cases} \text{value}_1 & \text{condition} \\ \text{value}_2 & \text{otherwise} \end{cases}
```

For multi-branch, nest `If` expressions until `Which` compilation is added:

MathJSON: `["If", cond1, val1, ["If", cond2, val2, default]]`

### Using `Block` for intermediate variables

CE compiles `Block` with `Declare`/`Assign` to JavaScript. This avoids
repeating subexpressions:

```json
["Block",
  ["Declare", "r2"],
  ["Assign", "r2", ["Add", ["Power", "x", 2], ["Power", "y", 2]]],
  ["Divide", 1, "r2"]
]
```

Note: `Block` does not currently have a standard LaTeX input syntax — construct
via MathJSON directly.

### Using lambdas for parameterized families

For families of curves (e.g., Planck's law at different temperatures), use
`\mapsto` to define the parameter:

```latex
T \mapsto \frac{1}{\lambda^5 (\exp(\frac{15000}{T \lambda}) - 1)}
```

Then generate multiple compiled functions by providing different `T` values.

### Inlining constants

Most "helper function" patterns are just inlining constants into a formula.
Generate LaTeX strings programmatically:

```typescript
function planckLatex(T: number): string {
  const c = 5.0 / (T / 3000);
  return `\\frac{1}{\\lambda^5 (\\exp(\\frac{${c}}{\\lambda}) - 1)}`;
}
```

---

## Appendix: Full List with Updated Status

### Now Convertible (were marked unconvertible)

1. Fourier square wave (4 variants) - expand terms explicitly
2. Taylor series sin(x) (4 variants) - expand terms explicitly
3. Square wave - `\operatorname{sgn}(\sin(x))`
4. Diffraction pattern - `If` with `Abs`
5. Step input - `If` with comparison
6. Step response - `If` with `Exp`, `Sin`, `Arctan2`
7. Planck's law - `If` for overflow guard, inline formula
8. Radioactive decay chain - Bateman equations, inline constants
9. Gaussian distribution (2 instances) - inline constants
10. Dose-response sigmoid - inline constants
11. Chemical kinetics - Bateman equations, inline constants
12. Joukowski airfoil - inline or `Block`
13. Dipole antenna pattern - `If` with inline gain
14. Cardioid antenna pattern - polar trig expression
15. Spirograph - parametric tuple
16. Heart curve - parametric tuple
17. Limacon - polar expression
18. Butterfly curve - polar expression
19. Linear regression fit - inline computed m, b

### Must Remain as JS

20. KDE - runtime data array iteration

### Convertible if CE Gaps Are Filled

21. Cornu spiral - needs `FresnelC`, `FresnelS`
22. Drumhead vibration - needs nothing extra (`BesselJ` already compiles!)

### Already Converted

23-51. (17 previously converted + Torus, Helicoid, etc.)

### Verified: Previously Thought Unconvertible but Actually Work

- **Drumhead vibration (Bessel functions):** CE has `BesselJ`, `BesselY`,
  `BesselI`, `BesselK` — all compile to JS via `_SYS.besselJ` etc. The
  drumhead `J_n(x)` expressions compile directly.
- **Mobius strip, Seashell, Klein bottle:** These are parametric surfaces using
  only trig and arithmetic — all operators compile. They are verbose but
  expressible as tuple LaTeX.
