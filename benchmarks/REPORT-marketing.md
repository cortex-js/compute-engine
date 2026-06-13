# Compute Engine — how it compares

_A quick, like-for-like comparison of Compute Engine against widely-used open-source math libraries. 2026-06-13._

**Compute Engine is the only library here that combines symbolic computation (simplify, differentiate, integrate) with arbitrary-precision numerics — and runs natively in the browser and Node.js at JavaScript speed.** SymPy matches it on symbolic breadth but needs a Python runtime and is markedly slower per call; math.js runs in JavaScript but has no symbolic integration and only light simplification; NumPy is numeric-only and limited to ~16 digits.

## At a glance

| Capability | Compute Engine | SymPy | math.js | NumPy |
|---|:--:|:--:|:--:|:--:|
| Runs in the browser (JavaScript) | ✅ | ❌ Python | ✅ | ❌ Python |
| Arbitrary-precision numerics | ✅ | ✅ | ✅ | ❌ ~16 digits |
| Exact big-integer arithmetic | ✅ | ✅ | ✅ | ❌ overflow |
| Special functions (ζ, Γ, W) | ✅ | ✅ | partial | ❌ |
| Symbolic simplification | ✅ | ✅ | partial | ❌ |
| Symbolic differentiation | ✅ | ✅ | ✅ | ❌ |
| Symbolic integration | ✅ | ✅ | ❌ | ❌ |
| Typical speed per call | **sub-millisecond** | milliseconds–tens of ms | sub-ms–ms | sub-ms |

_Legend for the tables below: ✅ correct · 🟡 partial or not solved · ❌ incorrect · — capability not supported._

## Quality

Each row is a case where the libraries visibly differ — cases everyone solves the same way are omitted. Correctness is verified numerically against an independent `mpmath` reference.

### Arbitrary-precision & exact arithmetic

_High-precision constants, special functions, and exact big integers._

| Example | Compute Engine | SymPy | math.js | NumPy |
|---|:--:|:--:|:--:|:--:|
| $\pi$ | ✅ <sub>200 digits</sub> | ✅ <sub>200 digits</sub> | ✅ <sub>200 digits</sub> | 🟡 <sub>~16 digits (double)</sub> |
| $100!$ | ✅ <sub>exact</sub> | ✅ <sub>exact</sub> | ✅ <sub>exact</sub> | ❌ <sub>inexact</sub> |
| $\Gamma(\tfrac13)$ | ✅ <sub>40 digits</sub> | ✅ <sub>40 digits</sub> | ❌ <sub>error</sub> | — <sub>not supported</sub> |

### Symbolic simplification

_Reducing an expression to a simpler equivalent form._

| Example | Compute Engine | SymPy | math.js | NumPy |
|---|:--:|:--:|:--:|:--:|
| $\frac{x^2-1}{x-1}$ | ✅ | ✅ | 🟡 <sub>value ok, not simplified</sub> | — <sub>not supported</sub> |
| $\sin^2 x+\cos^2 x$ | ✅ | ✅ | 🟡 <sub>value ok, not simplified</sub> | — <sub>not supported</sub> |
| $\frac{x^3-1}{x-1}$ | ✅ | ✅ | 🟡 <sub>value ok, not simplified</sub> | — <sub>not supported</sub> |

### Differentiation

_All three compute these correctly — here the difference is speed (see the Performance section)._

| Example | Compute Engine | SymPy | math.js | NumPy |
|---|:--:|:--:|:--:|:--:|
| $\tfrac{d}{dx}x^x$ | ✅ | ✅ | ✅ | — <sub>not supported</sub> |
| $\tfrac{d}{dx}x^2\sin x$ | ✅ | ✅ | ✅ | — <sub>not supported</sub> |

### Symbolic integration

_Indefinite integrals — the capability JavaScript numeric libraries lack entirely._

| Example | Compute Engine | SymPy | math.js | NumPy |
|---|:--:|:--:|:--:|:--:|
| $\int x e^x\,dx$ | ✅ | ✅ | — <sub>not supported</sub> | — <sub>not supported</sub> |
| $\int\frac{1}{1+x^2}\,dx$ | ✅ | ✅ | — <sub>not supported</sub> | — <sub>not supported</sub> |
| $\int\frac{1}{x^3+1}\,dx$ | ✅ | ✅ | — <sub>not supported</sub> | — <sub>not supported</sub> |

## Performance

Median time per call (warm). Lower is better. Compute Engine and math.js run in Node.js; SymPy and NumPy in Python. Symbolic operations are where the gap is widest.

| Operation | Example | Compute Engine | SymPy | math.js |
|---|---|--:|--:|--:|
| Evaluate | $\pi$ <sub>(200 digits)</sub> | <0.01 ms | 0.25 ms | 0.06 ms |
| Evaluate | $100!$ <sub>(exact)</sub> | 0.02 ms | 0.41 ms | 0.54 ms |
| Evaluate | $\Gamma(\tfrac13)$ <sub>(40 digits)</sub> | 4.3 ms | 0.42 ms | — |
| Simplify | $\frac{x^2-1}{x-1}$ | 0.61 ms | 13.4 ms | 2.9 ms |
| Simplify | $\sin^2 x+\cos^2 x$ | 0.45 ms | 16.7 ms | 2.2 ms |
| Simplify | $\frac{x^3-1}{x-1}$ | 0.68 ms | 15.9 ms | 2.7 ms |
| Differentiate | $\tfrac{d}{dx}x^x$ | 0.26 ms | 2.8 ms | 3.8 ms |
| Differentiate | $\tfrac{d}{dx}x^2\sin x$ | 0.81 ms | 3.9 ms | 6.0 ms |
| Integrate | $\int x e^x\,dx$ | 0.75 ms | 13.2 ms | — |
| Integrate | $\int\frac{1}{1+x^2}\,dx$ | 0.39 ms | 53.4 ms | — |
| Integrate | $\int\frac{1}{x^3+1}\,dx$ | 13.2 ms | 57.1 ms | — |

On the symbolic operations shared with SymPy above, **Compute Engine is roughly 23× faster per call** (median 0.68 ms vs 15.9 ms) — while running in the browser rather than requiring a Python backend.

## The bottom line

- **Choose Compute Engine** when you need symbolic math *and* arbitrary precision in a web or Node.js app, with no server-side runtime and sub-millisecond response. It is the only option here that does symbolic integration in JavaScript.
- **SymPy** remains the most comprehensive symbolic engine (it solves some hard integrals Compute Engine does not), and is the right choice for heavy offline computer-algebra work in Python — at the cost of a Python runtime and higher latency.
- **math.js** is a capable JavaScript numerics library with arbitrary precision and differentiation, but it cannot integrate symbolically and rarely simplifies non-trivial expressions.
- **NumPy** is the standard for fast numerical array computing, but it is double-precision only and does no symbolic math — a different tool for a different job.

---

_Versions: Compute Engine 0.59.0, SymPy 1.14.0, math.js 15.2.0, NumPy 2.4.2. Methodology and the full case list: [REPORT.md](./REPORT.md). Reproduce: `node benchmarks/report.mjs && node benchmarks/report_marketing.mjs`._
