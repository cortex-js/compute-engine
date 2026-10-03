# Symbolic contour integration

`ce.contourIntegrate(integrand, variable, contour)` returns a structured
residue-theorem calculation. `ContourIntegrate` is its MathJSON operator;
`Integrate` also uses this machinery for supported integrals over the entire
real line.

```ts
const report = ce.contourIntegrate(['Divide', 1, 'z'], 'z', {
  kind: 'circle', center: 0, radius: 2,
});
report.status;                 // 'success'
report.poles[0].point.json;     // 0
report.poles[0].location;       // 'inside'
report.poles[0].residue.json;   // 1
report.residueSum.json;         // 1
report.value;                  // 2 Pi i

ce.expr(['ContourIntegrate', ['Divide', 1, 'z'], 'z',
  ['CircleContour', 0, 2, -1]]).evaluate(); // -2 Pi i
ce.parse('\\oint_{|z|=2} \\frac{1}{z}\\,dz').evaluate(); // 2 Pi i
```

## Contours

| Object form | MathJSON form | Orientation |
| --- | --- | --- |
| `{kind: 'circle', center, radius}` | `CircleContour(center, radius, direction?)` | Counterclockwise by default |
| `{kind: 'polygon', vertices}` | `PolygonContour(List(vertices...), direction?)` | Vertex traversal order |
| `{kind: 'rectangle', lowerLeft, upperRight}` | `RectangleContour(lowerLeft, upperRight, direction?)` | Counterclockwise by default |
| `{kind: 'real-line', principalValue: false}` | `RealLineContour(False)` | Chosen by the decaying exponential |

Object contours accept `orientation: 'clockwise'` or `'counterclockwise'`.
MathJSON uses `direction = -1` or `+1`. An explicit polygon orientation
overrides its vertex order. Points are complex scalar expressions, such as
`['Complex', 1, 2]`, rather than coordinate lists. Polygons close implicitly;
a repeated final copy of the first vertex is also accepted. Self-intersections,
touching edges, adjacent collinear edges, and degenerate contours are rejected.

Circle conditions `|z - c| = r` can appear under `\\oint` or be supplied as
`['Equal', ['Abs', ['Subtract', 'z', c]], r]`. A named contour assigned a
supported constructor can also appear under `\\oint`.

Geometry uses exact arithmetic and CE's existing `refineExactConstants`
resolver for supported transcendental coordinates, such as `Pi/4`. Strict
signs require bounds separated from zero under the resolver's error model.
The narrow-at-limit equality heuristic is deliberately not used: a boundary
requires exact equality, while overlapping bounds remain undetermined.
Inexact coordinates and constants for which the resolver has no finite real
enclosure remain unsupported; the engine's equality tolerance never decides
contour inclusion.

## Real integrals

```ts
const f = ['Divide', ['Cos', 'x'], ['Add', ['Power', 'x', 2], 1]];
ce.expr(['Integrate', f,
  ['Tuple', 'x', 'NegativeInfinity', 'PositiveInfinity']]).evaluate();
// Pi / ExponentialE

const report = ce.contourIntegrate(f, 'x', {kind: 'real-line'});
// report.realIntegral: upper half-plane, real projection, ordinary integral
```

Supported families are rational functions `R(x)` decaying at least as
`1/x²`, and `R(x) cos(a x+b)`, `R(x) sin(a x+b)`, or
`R(x) exp(i(a x+b))` with nonzero real frequency and `R(x)` tending to zero.
The rational coefficients must be exact. Cosine and sine projection requires
real rational coefficients and radian angular units. The exponential kernel
is closed in the upper half-plane for positive frequency, and the lower
half-plane for negative frequency. The degree test establishes that the
closing arc vanishes before an ordinary integral is returned. Reversed `Integrate`
bounds negate the result. `.N()` approximates the exact result when available.

`Integrate` also reduces supported even integrands on `[0, +Infinity]` or
`[-Infinity, 0]` to half of the full-line integral, after the residue driver
has checked convergence. Oddness alone never establishes convergence. This
includes, for example, `cos(x)/(x²+4)` on `[0, +Infinity]`, giving `Pi/(4 e²)`.

Rational combinations of `sin(x)` and `cos(x)` with exact algebraic constants
on `[0, 2 Pi]` use `z = exp(i x)` and `dx = dz/(i z)`. The transformed rational
function is integrated on the unit circle. On `[0, Pi]`, this reduction also
requires the integrand to be even. Reversed bounds are supported. For example,
`1/(5-4 cos(x))` on `[0, 2 Pi]` gives `2 Pi/3`, and
`sin(x)²/(2+cos(x))` on `[0, Pi]` gives `Pi (2-sqrt(3))`.
These reductions require radians. Higher harmonics, arbitrary phase-shifted
periodic bounds, noninteger powers, and unproved parameter conditions defer
to the existing integration paths. A transformed pole on the unit circle
returns `Indeterminate`, not an implicit principal value.

Real-axis poles never silently imply a principal value. In particular,
the ordinary integral of `cos(x)/(x³+1)` from minus infinity to infinity is
undefined because of the pole at `-1`. Request its Cauchy principal value
explicitly:

```ts
const f = ['Divide', ['Cos', 'x'], ['Add', ['Power', 'x', 3], 1]];
ce.contourIntegrate(f, 'x', {kind: 'real-line'}).status;
// 'pole-on-contour'
const pv = ce.contourIntegrate(f, 'x', {
  kind: 'real-line', principalValue: true,
});
pv.value; // exact symbolic expression; call .N() for an approximation

ce.expr(['ContourIntegrate', f, 'x', ['RealLineContour', 'True']]).evaluate();
```

For this example the value is
`Pi/3 * (sin(1) + exp(-sqrt(3)/2) * (sin(1/2) + sqrt(3)*cos(1/2)))`.
The principal-value path supports simple real-axis poles; it does not assume
a Hadamard finite part for higher-order poles. The reported residues are
those of the exponential kernel, and `residueSum` includes half of its
simple real-axis residues before multiplication by the oriented `2 Pi i`
and real/imaginary projection. These indentations can also be needed when
the original sine integrand has a removable singularity.

Explicit principal values additionally admit rational functions with
`R(z) = c/z + O(1/z²)`. Their upper semicircle contributes `i Pi c`, which
is subtracted from the weighted residue result and exposed as
`realIntegral.largeArcContribution`. For example, `PV ∫ 1/x dx` over the
entire real line is zero, whereas `PV ∫ 1/(x-i) dx` is `i Pi`. These are
symmetric principal values at infinity, not convergent ordinary integrals.

## Results and limits

The report contains `method`, `status`, `reason` when needed, a normalized
`contour`, `polesComplete`, `poles`, and, on success only, `residueSum` and
`value`. Each pole entry contains its `point`, `location`, `enclosed` flag,
`kind`, and, when determined, its `order` and `residue`. Removable denominator
zeros are marked `kind: 'removable'`; they contribute nothing. A double pole
with zero residue remains a pole, including when it lies on the boundary.
Essential singularities are marked `kind: 'essential'`, with a residue but
no finite `order`. Zero residue does not make an essential singularity removable.
After complete discovery, `poleScope` is `'global'` for a complete finite
singularity set or `'contour'` for a periodic family enumerated over a bounding
region. `polesComplete` refers to that scope. A contour-scoped report may
include excluded neighbours but does not list infinitely many exterior poles.

Statuses are `success`, `pole-on-contour`, `invalid-contour`, `unsupported`,
and `undetermined`. The operator returns `Indeterminate` for a pole or essential singularity on the
contour and stays unevaluated for unsupported or unresolved cases. The
structured API retains the reason and intermediate results. Existing
`CircularIntegrate` notation without a specified contour remains unevaluated.

Finite-contour integration supports rational combinations with polynomial
denominators and products/powers of `sin(a*z+b)` or `cos(a*z+b)`, where `a`
and `b` are exact real constants and `a` is nonzero. Trigonometric integration
requires radians. Their zero families are kept symbolically as `(n*Pi-b)/a`
or `(Pi/2+n*Pi-b)/a`. Resolver bounds on the contour's real projection give
a conservative finite integer range; every candidate is then classified
against the actual circle or polygon. An unbounded or oversized enumeration
returns unsupported, never a partial integral. Nonlinear arguments, complex
slopes/shifts, and sums of trigonometric denominator terms are not yet supported.

Recognized entire numerators include polynomials, exponentials,
sine/cosine, and hyperbolic sine/cosine. Complex roots are obtained from
linear/quadratic formulas, factored denominators, and the existing solver.
Higher-degree results require exact division to certify that no roots were
missed; an incomplete list never produces a partial integral. Residues reuse
the existing Laurent engine, widening its coefficient window for high-order
polynomial poles when needed, with the exact simple-pole formula
`h(p)/q'(p)` for exact symbolic points its series expansion cannot handle.
For repeated zeros of entire denominators, bounded Taylor division computes the residue
and remaining pole order, including numerator cancellations and zero residues.
This fallback supports denominator zero orders up to eight.
Even polynomials can be reduced to polynomials in `z²`, and nested shifted
powers are expanded recursively for coefficient extraction. Real expressions
`a+b sqrt(d)` are compared by exact squared magnitudes when their terms have
opposite signs; approximate equality is never used for contour inclusion.
Complex square roots are constructed in exact Cartesian form and checked by
squaring before lifting the reduced polynomial roots. This covers, for example,
all six poles of `1/(z^6+1)`. Periodic substitutions preserve denominator
factors so repeated algebraic roots need not be rediscovered from an expansion.

### Initial essential-singularity support

The shared `Residue` operator and contour driver support recognized forms of
`P(z) exp(c/(z-a))`, where `P` is a polynomial of degree at most 64 and its
coefficients, `a`, and nonzero `c` are finite exact constants that can be
established. Scaled linear denominators are normalized to this form. Shifted
and complex centres/coefficient values are supported when the exact arithmetic
can be preserved. A zero polynomial prefactor is removable, not essential.

Writing `P(a+t) = sum p_k t^k`, the residue is the finite sum
`sum p_k c^(k+1)/(k+1)!`. The shared extractor uses exact integer factorials
and binomial translation; it does not truncate an infinite principal part or
invent a finite pole order. `Residue(exp(2/z), z, 0)` is `2`, and
`Residue(z² exp(1/z), z, 0)` is `1/6`. Their counterclockwise unit-circle
integrals are `4 Pi i` and `Pi i/3`, respectively.

The finite-principal-part Laurent kernel and `Series` behavior are unchanged.
General analytic/rational prefactors, sums of essential terms, higher-order
polar exponents, and parameter-dependent essential classification remain
unsupported by this extractor. In particular, the residue operator does not
mistake real-axis decay of `exp(-1/z²)` for complex removability.

Branch-dependent functions, nonholomorphic functions, other essential
singularities, other infinite pole families, unresolved parameters, uncertified
roots, and general contours are outside this initial implementation. The
limits are 64 polynomial degrees/candidate poles and 128 polygon vertices.
The contour parser/classifier is separate from residue evaluation so new
contour types and numerical integration can be added without changing the
existing input representations. Numerical contour quadrature is not yet
implemented.

## Textbook regression corpus

`test/compute-engine/fixtures/contour-textbook.ts` contains 105 mathematical
integration fixtures, each with a stable ID, source locator, problem family,
integrand, domain, and independently specified expected answer. The collection
is curated, not a claim to contain every exercise in any book. It contains
selected computational examples plus explicitly labeled parameter variations.
Only mathematical formulas and bibliographic metadata are stored; textbook
prose, diagrams, and worked solutions are not mirrored.

The sources inspected are:

- John H. Mathews and Russell W. Howell, *Complex Analysis*,
  [§6.5](https://complexanalysis.org/web/sec_cauchy-integral-formulas.html) and
  [§8.1](https://complexanalysis.org/web/sec_residue-thm.html), CC BY 4.0.
- Jiří Lebl, *Guide to Cultivating Complex Analysis*,
  [§5.3](https://www.jirka.org/ca/), using the author's
  [LaTeX source](https://raw.githubusercontent.com/jirilebl/ca/master/ca.tex).
  The book is dual-licensed CC BY-SA 4.0 / CC BY-NC-SA 4.0.
- Jeremy Orloff, *Complex Variables with Applications*,
  [definite-integral chapter](https://math.libretexts.org/Bookshelves/Analysis/Complex_Variables_with_Applications_(Orloff)/10%3A_Definite_Integrals_Using_the_Residue_Theorem),
  §§10.2–10.5, CC BY-NC-SA 4.0. Individual page URLs and example locators are
  recorded in the fixture source table.

Sources were inspected on 2026-10-02. Variable names are standardized to `z`;
parameter substitutions and changes from half-line to full-line problems are
identified in each locator. Expected formulas are not generated by calling
the engine under test. Gaussian and square-root endpoint examples already
handled by the existing `Integrate` machinery count as solved computational
problems, not as new branch-contour capabilities.

Measured coverage is **104 solved fixtures and 1 unresolved target**. The
normal regression suite executes the supported problems and visibly skips
the remaining target-answer assertion. Separate safety tests verify that unsupported
contours do not produce fabricated residue sums or values. Supported cases
must return a symbolic expression before numerical comparison; a quadrature
fallback cannot count as symbolic coverage. Native-arithmetic quadrature,
independent of the engine's integration machinery, cross-checks selected
periodic and full-line answers. Additional tests exercise orientation,
variable binding, angular units, exact radical signs, and invalid reductions.

Run the regression suite:

```sh
npm run test compute-engine/contour-textbook
```

Run all target-answer assertions, including the unresolved problems:

```sh
CE_CONTOUR_TEXTBOOK_STRICT=1 npm run test compute-engine/contour-textbook
```

In PowerShell, set `$env:CE_CONTOUR_TEXTBOOK_STRICT = '1'` before running the
test command and remove it afterward. Strict mode is an intentionally failing
coverage audit until all listed gaps are solved. When a target is implemented,
remove its `gap` field to make it mandatory in normal CI as well.
The flag is read only by the textbook test suite, not by CE at runtime.
Normal CI does not enable it: unsupported targets are visible skips, while
every supported fixture is a mandatory regression. The shell spellings above
only set this optional test-process environment variable on each platform.

| Remaining capability | Target IDs | Count |
| --- | --- | --- |
| Branch-aware keyhole contours | `O-10.4-E1` | 1 |

### Shared CE capabilities needed next

These are implementation gaps, not mathematical impossibility. Adding more
test cases alone will not supply the following missing algorithms:

1. **Branch-aware paths and convergence (1 target).**
   Existing function-property metadata describes cut membership, not analytic
   continuation along a path. Keyhole contours need a declared branch,
   arguments/values on both banks of the cut, small-circle and large-circle
   limit proofs, and the resulting real-integral jump relation. Start with
   `x^(1/3)/(1+x²)` on `[0, Infinity]`; do not treat a branch point as a pole
   or silently change the selected branch. Half-line Mellin/Beta identities
   are an alternative `Integrate` extension, but would not themselves provide
   general branch-contour support.

The contour-level extensions already implemented solve the sextic,
repeated-algebraic-pole, and nonvanishing-PV-arc targets without changing
these shared representations. Transcendental coordinates and bounded real-affine
trigonometric pole families reuse CE's existing constant resolver rather than
requiring a new one. The initial essential-singularity family shares one
coefficient extractor between `Residue` and contour integration. Further work should update the corresponding
CE subsystem and its standalone tests before enabling the remaining fixtures.

This is a regression baseline, not a percentage of all textbook integration
problems. Other families still needing dedicated representations and fixtures
include open/parametrized paths, multiply wound cycles, logarithmic keyholes,
Bromwich contours, and symbolic parameter-dependent convergence conditions.
Solving these requires new algorithms and domain checks, not merely a larger
collection of examples.
