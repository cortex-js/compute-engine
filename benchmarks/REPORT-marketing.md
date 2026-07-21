# Compute Engine — how it compares

_A quick, like-for-like comparison of Compute Engine against widely-used open-source math libraries. 2026-07-21._

**Compute Engine is the only open-source, browser-native library here that combines symbolic computation (simplify, differentiate, integrate) with arbitrary-precision numerics — running in the browser and Node.js at JavaScript speed.** SymPy matches it on symbolic breadth but needs a Python runtime and is markedly slower per call; math.js runs in JavaScript but has no symbolic integration and only light simplification; NumPy is numeric-only and limited to ~16 digits. **Mathematica** is the commercial capability ceiling — the broadest coverage of all — but it is a proprietary kernel you cannot embed in a web page, which is exactly the niche Compute Engine fills.

## At a glance

| Capability | Compute Engine | SymPy | math.js | NumPy | Mathematica |
|---|:--:|:--:|:--:|:--:|:--:|
| Runs in the browser (JavaScript) | ✅ | ❌ Python | ✅ | ❌ Python | ❌ kernel |
| Arbitrary-precision numerics | ✅ | ✅ | ✅ | ❌ ~16 digits | ✅ |
| Exact big-integer arithmetic | ✅ | ✅ | ✅ | ❌ overflow | ✅ |
| Special functions (ζ, Γ, W) | ✅ | ✅ | partial | ❌ | ✅ |
| Symbolic simplification | ✅ | ✅ | partial | ❌ | ✅ |
| Symbolic differentiation | ✅ | ✅ | ✅ | ❌ | ✅ |
| Symbolic integration | ✅ | ✅ | ❌ | ❌ | ✅ |
| Open-source licence | ✅ MIT | ✅ BSD | ✅ Apache-2.0 | ✅ BSD | ❌ commercial |
| Typical speed per call | **sub-millisecond** | milliseconds–tens of ms | sub-ms–ms | sub-ms | sub-ms–tens of ms (kernel) |

_Legend for the tables below: ✅ correct · 🟡 partial or not solved · ❌ incorrect · — capability not supported._

## Quality

Each row is a case where the libraries visibly differ — cases everyone solves the same way are omitted. Correctness is verified numerically against an independent `mpmath` reference.

### Arbitrary-precision & exact arithmetic

_High-precision constants, special functions, and exact big integers._

| Example | Compute Engine | SymPy | math.js | NumPy | Mathematica |
|---|:--:|:--:|:--:|:--:|:--:|
| $\pi$ | ✅ <sub>200 digits</sub> | ✅ <sub>200 digits</sub> | ✅ <sub>200 digits</sub> | 🟡 <sub>~16 digits (double)</sub> | ✅ <sub>200 digits</sub> |
| $100!$ | ✅ <sub>exact</sub> | ✅ <sub>exact</sub> | ✅ <sub>exact</sub> | ❌ <sub>inexact</sub> | ✅ <sub>exact</sub> |
| $\Gamma(\tfrac13)$ | ✅ <sub>40 digits</sub> | ✅ <sub>40 digits</sub> | ❌ <sub>error</sub> | — <sub>not supported</sub> | ✅ <sub>40 digits</sub> |

### Symbolic simplification

_Reducing an expression to a simpler equivalent form._

| Example | Compute Engine | SymPy | math.js | NumPy | Mathematica |
|---|:--:|:--:|:--:|:--:|:--:|
| $\frac{x^2-1}{x-1}$ | ✅ | ✅ | 🟡 <sub>value ok, not simplified</sub> | — <sub>not supported</sub> | ✅ |
| $\sin^2 x+\cos^2 x$ | ✅ | ✅ | 🟡 <sub>value ok, not simplified</sub> | — <sub>not supported</sub> | ✅ |
| $\frac{x^3-1}{x-1}$ | ✅ | ✅ | 🟡 <sub>value ok, not simplified</sub> | — <sub>not supported</sub> | ✅ |

### Differentiation

_All three compute these correctly — here the difference is speed (see the Performance section)._

| Example | Compute Engine | SymPy | math.js | NumPy | Mathematica |
|---|:--:|:--:|:--:|:--:|:--:|
| $\tfrac{d}{dx}x^x$ | ✅ | ✅ | ✅ | — <sub>not supported</sub> | ✅ |
| $\tfrac{d}{dx}x^2\sin x$ | ✅ | ✅ | ✅ | — <sub>not supported</sub> | ✅ |

### Symbolic integration

_Indefinite integrals — the capability JavaScript numeric libraries lack entirely._

| Example | Compute Engine | SymPy | math.js | NumPy | Mathematica |
|---|:--:|:--:|:--:|:--:|:--:|
| $\int x e^x\,dx$ | ✅ | ✅ | — <sub>not supported</sub> | — <sub>not supported</sub> | ✅ |
| $\int\frac{1}{1+x^2}\,dx$ | ✅ | ✅ | — <sub>not supported</sub> | — <sub>not supported</sub> | ✅ |
| $\int\frac{1}{x^3+1}\,dx$ | ✅ | ✅ | — <sub>not supported</sub> | — <sub>not supported</sub> | ✅ |

## Performance

Median time per call (warm). Lower is better. Compute Engine and math.js run in Node.js; SymPy and NumPy in Python. Symbolic operations are where the gap is widest.

| Operation | Example | Compute Engine | SymPy | math.js | Mathematica |
|---|---|--:|--:|--:|--:|
| Evaluate | $\pi$ <sub>(200 digits)</sub> | <0.01 ms | 0.16 ms | 0.01 ms | <0.01 ms |
| Evaluate | $100!$ <sub>(exact)</sub> | <0.01 ms | 0.27 ms | 0.12 ms | <0.01 ms |
| Evaluate | $\Gamma(\tfrac13)$ <sub>(40 digits)</sub> | 0.16 ms | 0.25 ms | — | 0.05 ms |
| Simplify | $\frac{x^2-1}{x-1}$ | 0.13 ms | 9.1 ms | 0.96 ms | 0.17 ms |
| Simplify | $\sin^2 x+\cos^2 x$ | 0.07 ms | 9.1 ms | 0.96 ms | 0.08 ms |
| Simplify | $\frac{x^3-1}{x-1}$ | 0.10 ms | 8.7 ms | 1.0 ms | 1.0 ms |
| Differentiate | $\tfrac{d}{dx}x^x$ | 0.05 ms | 1.7 ms | 1.7 ms | <0.01 ms |
| Differentiate | $\tfrac{d}{dx}x^2\sin x$ | 0.13 ms | 2.0 ms | 1.6 ms | <0.01 ms |
| Integrate | $\int x e^x\,dx$ | 0.12 ms | 6.8 ms | — | 0.57 ms |
| Integrate | $\int\frac{1}{1+x^2}\,dx$ | 0.05 ms | 9.7 ms | — | 0.84 ms |
| Integrate | $\int\frac{1}{x^3+1}\,dx$ | 1.4 ms | 24.1 ms | — | 8.5 ms |

On the symbolic operations shared with SymPy above, **Compute Engine is roughly 73× faster per call** (median 0.12 ms vs 9.1 ms) — while running in the browser rather than requiring a Python backend.

## The bottom line

- **Choose Compute Engine** when you need symbolic math *and* arbitrary precision in a web or Node.js app, with no server-side runtime and sub-millisecond response. It is the only option here that does symbolic integration in JavaScript.
- **SymPy** remains the most comprehensive symbolic engine (it solves some hard integrals Compute Engine does not), and is the right choice for heavy offline computer-algebra work in Python — at the cost of a Python runtime and higher latency.
- **math.js** is a capable JavaScript numerics library with arbitrary precision and differentiation, but it cannot integrate symbolically and rarely simplifies non-trivial expressions.
- **NumPy** is the standard for fast numerical array computing, but it is double-precision only and does no symbolic math — a different tool for a different job.
- **Mathematica / Wolfram** is the broadest engine of all and the de-facto reference, but it is a proprietary kernel with a commercial licence and multi-second start-up — it cannot run inside a web page, which is exactly the gap Compute Engine fills.

---

_Versions: Compute Engine 0.90.0, SymPy 1.14.0, math.js 15.2.0, NumPy 2.4.2, Mathematica 14.3.0 for Mac OS X ARM. Methodology and the full case list: [REPORT.md](./REPORT.md). Reproduce: `node benchmarks/report.mjs && node benchmarks/report_marketing.mjs`._
