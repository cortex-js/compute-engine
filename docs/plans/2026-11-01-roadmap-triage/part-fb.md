# Triage of the older defects queued by session compute-engine-fb

These 16 defects were found during the fixes of 2026-10-31 and 2026-11-01.
They are older than the change that found them, and each was the same at
the base commit of that change. The rules are the header of `ROADMAP.md`
and "Caveats of compiled code" in `docs/COMPILATION-MODEL.md`. Only the
`fix` rows become `ROADMAP.md` entries, and only after the user has read
this table.

| item | kind | witness | bucket | reason |
| ---- | ---- | ------- | ------ | ------ |
| F38 | defect (LaTeX round trip) | crafted | drop | `A_{(i)}` serializes to `A_{\imaginaryI}`, which parses back as the symbol `A_ImaginaryUnit`. The index is an expression in parentheses, built to reach the case. It is an interpreter case, and CE-127 already holds the question of expression indices. |
| F40 | defect (LaTeX round trip) | crafted | drop | The MathJSON `Subscript(A, Pi)` serializes to `A_{\pi}`, which parses back as the symbol `A_pi`. The LaTeX `A_\pi` already parses to the symbol, so only a form built by a host reaches the case. |
| F42 | defect (compiled emission) | crafted | drop | `(g: real) ↦ D(g^2, g)` with a global `g: list<real>` compiles to a run-time broadcast. The global and the parameter have the same name by choice. The value is correct, so it is not a wrong value or shape. |
| F43 | decline | crafted | drop | A compiled `D(Cos·Sin(x), Cos, x)` declines, where the interpreter gives `Cos(0.5)`. A decline is always allowed. |
| F45 | canonical form | crafted | drop | `Divide(∞ + 0.5, 2)` canonicalizes to `0.5 + ∞`; `0.25 + ∞` was expected. Both forms have the value `∞`, so no value is wrong. |
| F47 | performance (async pacing) | none | drop | The async loop of the `Set` handler does not yield to the event loop. No program shows a stall, so this is an idea, not a defect. |
| F48 | defect (`isSame`) | crafted | drop | A typed use (`f + x`) lets inference declare `f` globally. After `ce.declare('f', 'integer')`, the old literal is not `isSame` to a new boxing. It is an interpreter case built to reach it, in the area of CE-107. |
| F49 | defect (`isSame`) | crafted | drop | Two literals that a host builds with `Block(f + x)` bodies are not `isSame`. Same area and kind as F48. |
| F52 | wrong value | crafted | drop | With `y = 3` and `g := x ↦ x + 0.5`, `g(HoldValues(y + 1, y))` gives `4.5`, while `HoldValues(y + 1, y) + 0.5` keeps `y + 1 + 0.5`. `HoldValues` inside a call argument is a construct built to reach the case. |
| F54 | wrong value | plausible | fix | With `a := 3` and `h := x ↦ a·x`, `Apply(Derivative(a ↦ h(a)), 2)` gives `4`; expected `3`. `Apply(Derivative(a ↦ a·h(a)), 2)` gives `14`; expected `12`. When the body of `h` is inlined, its global `a` becomes the parameter `a`. A parameter with the name of a global is common in notebooks. Code: the `Derivative` handler in `src/compute-engine/library/calculus.ts`. |
| F55 | wrong static type | crafted | drop | With `u: number \| list<list<number>>`, `Apply(x ↦ 2x, u)` is typed `list<number> \| number`; expected `list<list<number>> \| number`. The value is correct. The union of a scalar and a nested list is chosen to reach the case. |
| F56 | wrong static type | plausible | fix | With `mk := n ↦ (x ↦ x + n)`, `Apply(mk(1), [1, 2])` is typed `number`, but its value is `[2, 3]`. A curried function applied to a list is a two-line program. A type that does not hold the value can give a compiled result of the wrong shape. Code: `anonymousApplicationType` in `src/compute-engine/library/core.ts`. |
| F57 | wrong static type | crafted | drop | `Apply(Derivative(Length), [1, 2])` is typed `infinity \| integer`, but its value is `[0, 0]`. A derivative of `Length` is built to reach the case. |
| F58 | wrong value (no value) | crafted | drop | `Power(Divide(1, Pi), ∞).evaluate()` gives `Indeterminate`; expected `0`. `.N()` gives the float `0`. An exact constant base raised to an infinity is built to reach the case. |
| F59 | wrong value | plausible | fix | Verified at `a4abc3c5e`: with `x := 2`, `ce.box(['Power', 0, 'x'])` folds to `0` when it is boxed. After `x := -1`, its `evaluate()` still gives `0`, but a new boxing gives `~oo`. A host that boxes once and then assigns new values (a slider) reaches it. Code: the zero-base block of `canonicalPower` in `src/compute-engine/boxed-expression/arithmetic-power.ts` reads `b.isGreater(0)` with the value that the symbol has at boxing. |
| F60 | defect (comparison) | crafted | drop | `ce.box({num: '1.000000000000000000001'}).isGreater(1)` is `false`; the comparison reads doubles. A 22-digit literal is built to reach the case. The `Power` folds of `a4abc3c5e` no longer depend on it. |

Counts: fix 3 (F54, F56, F59), document 0, drop 13.
