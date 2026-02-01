# Simplification status for issue #178

Source: cortex-js/compute-engine#178 ("x+x does not simplify to 2x")

Checked: 2026-02-01
Compute Engine version (package.json): 0.33.0

Method: `ce.parse(<latex>, { canonical: false }).simplify()` and record `simplified.latex`.
Note: some items in the issue comment omit LaTeX backslashes (e.g. `log(1)`); these are normalized to LaTeX (e.g. `\log(1)`) for `ce.parse()`.

## Still notable / requires explicit evaluation or assumptions

- \frac{0}{1-1}: \(\frac{0}{1-1}\) — No longer incorrectly simplifies to 0 (requires explicit evaluation to reach 0/0).
- \frac{1-1}{0}: \(\tilde\infty\) — Requires explicit evaluation to detect 0/0.
- 2(x+h)^2-2x^2: \(2(h+x)^2-2x^2\) — Does not expand powers during simplify().
- ln(\frac{x}{y}): \(\ln(\frac{x}{y})\) — Quotient expansion is domain-sensitive; not applied without positivity assumptions.

## Full results

| Section | Issue text | LaTeX parsed | Simplified (LaTeX) | Notes |
|---|---|---|---|---|
| Base | `x+x` | `x+x` | `2x` |  |
| Hard | `\frac{0}{1-1}` | `\frac{0}{1-1}` | `\frac{0}{1-1}` | Now stays as a fraction (no longer incorrectly simplifies to 0). |
| Hard | `\frac{1-1}{0}` | `\frac{1-1}{0}` | `\tilde\infty` | Without an explicit evaluation of (1-1), this may not reduce to NaN. |
| Hard | `\frac{0}{0}` | `\frac{0}{0}` | `\operatorname{NaN}` |  |
| Hard | `2(x+h)^2-2x^2` | `2(x+h)^2-2x^2` | `2(h+x)^2-2x^2` | Default simplify does not expand powers; an explicit `.expand()` may be required to reach a polynomial form. |
| Hard | `\frac{\pi+1}{\pi+1}` | `\frac{\pi+1}{\pi+1}` | `1` |  |
| Hard | `\frac{x^2}{5x^2}` | `\frac{x^2}{5x^2}` | `\frac{1}{5}` |  |
| Hard | `\frac{5x^2}{x^2}` | `\frac{5x^2}{x^2}` | `5` |  |
| Hard | `(-1)^{3/5}` | `(-1)^{3/5}` | `-1` |  |
| Hard | `\frac{\frac{1}{x^6}}{\frac{1}{y^4}}` | `\frac{\frac{1}{x^6}}{\frac{1}{y^4}}` | `\frac{y^4}{x^6}` |  |
| Hard | `\left(\frac{x^3}{y^2}\right)^{-2}` | `\left(\frac{x^3}{y^2}\right)^{-2}` | `\frac{y^4}{x^6}` |  |
| Hard | `exp(x)exp(2)` | `\exp(x)\exp(2)` | `\exp(x+2)` | Normalized to LaTeX (\exp) for ce.parse(). |
| Hard | `\frac{x+1-1+1}{x+1}` | `\frac{x+1-1+1}{x+1}` | `1` |  |
| Hard | `\frac{x+1-1+1}{x}` | `\frac{x+1-1+1}{x}` | `\frac{1}{x}+1` |  |
| Hard | `(-2x)^{3/5}x` | `(-2x)^{3/5}x` | `-(2^{\frac{3}{5}}x^{\frac{8}{5}})` |  |
| Hard | `(2x)^{3/5}x` | `(2x)^{3/5}x` | `1.515\,716\,566\,510\,398\,082\,35x^{\frac{8}{5}}` |  |
| Hard | `(x^3y^2)^2` | `(x^3y^2)^2` | `x^6y^4` |  |
| Hard | `\frac{2\sqrt{3}}{\sqrt{3}}` | `\frac{2\sqrt{3}}{\sqrt{3}}` | `2` |  |
| Hard | `\frac{\sqrt{12x}}{\sqrt{3x}}` | `\frac{\sqrt{12x}}{\sqrt{3x}}` | `2` |  |
| Hard | `\sqrt{12}` | `\sqrt{12}` | `2\sqrt{3}` |  |
| Hard | `\sqrt{x^2y}` | `\sqrt{x^2y}` | `\vert x\vert\sqrt{y}` |  |
| Hard | `\sqrt{x^2}` | `\sqrt{x^2}` | `\vert x\vert` |  |
| Hard | `\sqrt[4]{x^4}` | `\sqrt[4]{x^4}` | `\vert x\vert` |  |
| Hard | `\sqrt[4]{x^6}` | `\sqrt[4]{x^6}` | `\sqrt{\vert x\vert}^{3}` |  |
| Logs | `log(e^xy)` | `\log(\exp(xy))` | `0.434\,294\,481\,903\,251\,768\,053xy` | Compute Engine: \log is base-10, \ln is natural. |
| Logs | `ln(\frac{x}{y})` | `\ln(\frac{x}{y})` | `\ln(\frac{x}{y})` |  |
| Logs | `log(xy)-log(x)-log(y)` | `\log(xy)-\log(x)-\log(y)` | `0` |  |
| Logs | `log(1)` | `\log(1)` | `0` |  |
| Logs | `log(e)` | `\log(\exponentialE)` | `0.434\,294\,481\,903\,251\,768\,053` |  |
| Logs | `exp(log(x))` | `\exp(\log(x))` | `x^{0.434\,294\,481\,903\,251\,768\,053}` |  |
| Logs | `exp(log(x)+y)` | `\exp(\log(x)+y)` | `\exponentialE^{y}x^{0.434\,294\,481\,903\,251\,768\,053}` | Separates the log term; accepted via a targeted default cost-function preference. |
| Logs | `exp(log(x)-y)` | `\exp(\log(x)-y)` | `\exp(-y)x^{0.434\,294\,481\,903\,251\,768\,053}` | Separates the log term; accepted via a targeted default cost-function preference. |
| Logs | `log(exp(x))` | `\log(\exp(x))` | `0.434\,294\,481\,903\,251\,768\,053x` |  |
| Logs | `\log(\sqrt{2})` | `\log(\sqrt{2})` | `0.150\,514\,997\,831\,990\,597\,606` |  |
| Logs | `\ln(\sqrt{2})` | `\ln(\sqrt{2})` | `0.346\,573\,590\,279\,972\,654\,707` |  |
| Negative | `(-x)(-6)` | `(-x)(-6)` | `6x` |  |
| Negative | `-\frac{-1}{x}` | `-\frac{-1}{x}` | `\frac{1}{x}` |  |
| Negative | `(-x)^2` | `(-x)^2` | `x^2` |  |
| Exponents | `2xx` | `2xx` | `2x^2` |  |
| Exponents | `xx` | `xx` | `x^2` | Now simplifies to x^2. |
| Exponents | `\frac{e^x}{e}` | `\frac{e^x}{e}` | `\exp(x-1)` |  |
| Exponents | `\frac{e}{e^x}` | `\frac{e}{e^x}` | `\exp(1-x)` |  |
| Exponents | `e^xe` | `e^xe` | `\exp(x+1)` |  |
| Exponents | `e^xe^1` | `e^xe^1` | `\exp(x+1)` |  |
| Exponents | `\left(\frac{1}{x}\right)^{-1}` | `\left(\frac{1}{x}\right)^{-1}` | `x` |  |
| Powers | `0^0` | `0^0` | `\operatorname{NaN}` |  |
| Powers | `0^\pi` | `0^\pi` | `0` |  |
| Infinity | `\infty^0` | `\infty^0` | `\operatorname{NaN}` |  |
| Infinity | `\infty(1-1)` | `\infty(1-1)` | `\operatorname{NaN}` |  |
| Infinity | `1^\infty` | `1^\infty` | `\operatorname{NaN}` |  |
| Infinity | `-\infty(-2)` | `-\infty(-2)` | `\infty` |  |
| Infinity | `\infty(-2)` | `\infty(-2)` | `-\infty` |  |
| Infinity | `-\infty(2)` | `-\infty(2)` | `-\infty` |  |
| Infinity | `\infty(2)` | `\infty(2)` | `\infty` |  |
| Infinity | `\frac{\infty}{2}` | `\frac{\infty}{2}` | `\infty` |  |
| Infinity | `\frac{\infty}{\infty}` | `\frac{\infty}{\infty}` | `\operatorname{NaN}` |  |
| Infinity | `\frac{\infty}{\infty^{-2}}` | `\frac{\infty}{\infty^{-2}}` | `\tilde\infty` |  |
| Misc | `\frac{1}{0}` | `\frac{1}{0}` | `\tilde\infty` |  |
| Trig | `sec(-x)` | `\sec(-x)` | `\sec(x)` |  |
| Trig | `csc(pi+x)` | `\csc(\pi+x)` | `-\csc(x)` |  |
| Trig | `tan(pi/2-x)` | `\tan(\pi/2-x)` | `\cot(x)` |  |
| Trig | `sec(pi/2-x)` | `\sec(\pi/2-x)` | `\csc(x)` |  |
| Trig | `csc(pi/2-x)` | `\csc(\pi/2-x)` | `\sec(x)` |  |
| Trig | `cot(pi+x)` | `\cot(\pi+x)` | `\cot(x)` |  |
| Trig | `tan(-x)cot(x)` | `\tan(-x)\cot(x)` | `-1` |  |
| Trig | `tan(x)cot(x)` | `\tan(x)\cot(x)` | `1` |  |
| Trig | `sin^2(x)` | `\sin^2(x)` | `\sin(x)^2` |  |
| Trig | `2sin^2(x)` | `2\sin^2(x)` | `2\sin(x)^2` |  |
| Trig | `sin(x)cos(x)` | `\sin(x)\cos(x)` | `\frac{\sin(2x)}{2}` |  |
| Trig | `2sin(x)cos(x)` | `2\sin(x)\cos(x)` | `\sin(2x)` |  |
