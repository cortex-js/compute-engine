# Compiled-output vs interpreted-evaluation correctness review

Branch `main` @ 9b818ec8. Scope: `src/compute-engine/compilation/` (JS, GLSL, WGSL, Python, interval-JS targets).
Contract audited: compiled code must agree with interpreted `.N()` within documented tolerance; unsupported heads must fail clearly.

**Method.** JS parity fuzz: 160 expressions × ~15 points = 2,446 executed comparisons against `.subs(...).N()` (rel-tol 1e-9), plus 6 targeted verify batteries. Python: 39 expressions × 107 points executed with `./venv/bin/python3` against interpreted values. GLSL/WGSL: 29-expression emission scan × 2 targets, statically validated and cross-checked against the JS target's math (shaders can't be executed here; those findings are marked *static*). interval-js: 8 executed spot checks. Baseline: `compile*.test.ts` suites pass (green) before review; no repo files modified.

**Raw stats.** JS: 136/2,446 point-level disagreements (1 compile-failure), all classified below — no unexplained residue. Python: 31/107 disagreements (25 genuine, 6 harness artifacts from missing scipy in venv). interval-js: 3/8 spot disagreements (same clusters as JS). GLSL/WGSL: 4 invalid-emission classes found by scan.

Repro scripts: `scratchpad/compile/fuzz-js.ts`, `fuzz-python.ts` (+generated `parity.py`), `verify1..6.ts`.

---

## P0 — compiled result disagrees with interpreted `.N()` / silently wrong code

### P0-1. `Mod` with negative operands: every target disagrees with the interpreter (and targets disagree with each other)
- **Repro (executed):** `Mod(-1, 3)` → interpreted `.N()` = **-1** (truncated, sign of dividend); compiled JS `((_.x % 3) + 3) % 3` = **2** (floored). Also `Mod(7,-3)`: interp 1, JS -2. Python `np.mod(-7,3)`=2 vs interp -1. interval-js `Mod(-1,3)` = [2,2]. WGSL emits `(x % y)` (truncated — matches today's interp, diverges from GLSL/JS/Python siblings); GLSL emits `mod(x,y)` (floored).
- **Why:** the library `Mod` evaluate (`src/compute-engine/library/arithmetic.ts:999-1007`) applies the floored correction `((a%b)+b)%b` only to the **machine** lambda; the bignum lambda is bare `a.mod(b)`, and `BigDecimal.mod` is documented truncated (`src/big-decimal/big-decimal.ts:770-780`). At default precision the bignum path runs, so interpreted Mod is truncated while the documented intent (comment: "adapt it to return a modulo") and 4 of 5 compile targets are floored.
- **Files:** `library/arithmetic.ts:999-1007` (root cause, interpreter side); `compilation/javascript-target.ts:518-530`; `compilation/glsl-target.ts:27`; `compilation/wgsl-target.ts:31-34`; `compilation/python-target.ts:246`; `compilation/interval-javascript-target.ts` (Mod entry).
- **Fix direction:** decide the semantic (floored, per the wikidata/Q1799665 description and machine path) and apply it to the bignum lambda (`a.mod(b).add(b).mod(b)`-style) **and** to WGSL (`(a % b + b) % b` or emit helper). Then add negative-operand points to the parity suite (`a1-c1-compile-parity.test.ts` currently has none).
- **Test locking wrong expectation:** `test/compute-engine/compile-wgsl.test.ts:36-39` inline-snapshots `(x % y)` for WGSL Mod.

### P0-2. `Round` half-way negatives: compiled targets disagree with interpreter (3 conventions in play)
- **Repro (executed):** `Round(-2.5)`: interp **-3** (half-away-from-zero, BigDecimal `.round()`); JS `Math.round` → **-2** (half-toward-+∞); `Round(-0.5)`: interp -1, JS **-0**. Python `np.round(2.5)` → **2** (banker's) vs interp **3** — wrong on *positive* halves too.
- **Why:** library Round evaluate (`library/arithmetic.ts:1370-1376`) uses `Math.round` for machine but BigDecimal `.round()` (half-away) for bignum — interp default is bignum; JS target emits `Math.round` (`javascript-target.ts:457-460`); Python target emits `np.round` (`python-target.ts:238`); GPU emits `round()` (impl-defined halves in GLSL).
- **Fix direction:** pick half-away-from-zero (current interpreted default); JS: `Math.sign(x) * Math.round(Math.abs(x))`; Python: emit a sign-corrected expression, not `np.round`; GPU: `floor(abs(x)+0.5)*sign(x)`.

### P0-3. `Arccot` of negative arguments: wrong branch in JS, Python, GPU, and interval-js
- **Repro (executed):** `Arccot(-2)`: interp **2.6779** (range (0, π)); compiled JS `Math.atan(1/x)` → **-0.4636**. Same numbers from Python `np.arctan(1/x)` and interval-js; GLSL/WGSL emit the same `atan(1.0/(x))` formula (*static, cross-checked*).
- **Files:** `javascript-target.ts:164-168`; `python-target.ts:134-137`; `gpu-target.ts:576-579`; interval-js Arccot entry.
- **Fix direction:** `x > 0 ? atan(1/x) : atan(1/x) + π` (or `π/2 − atan(x)`). Note `Arccoth/Arcsec/Arccsc` verified correct (they agree with interp conventions).

### P0-4. Negative-base roots: compiled `NaN` where interpreter returns a real root — including constant folds that emit a literal `NaN`
- **Repro (executed):**
  - `Root(x, 5)` at x=-2: interp **-1.1487**, JS `Math.pow(x, 0.2)` → **NaN** (also Python `np.power`, GPU `pow` — *static* for GPU).
  - `Power(x, 2/3)` at x=-1: interp **1**, compiled `Math.pow(x, 0.666…)` → **NaN**.
  - **Constant folding:** `ce.expr(['Sqrt', -4])` compiles to literal code `NaN` (interp: `2i`); `Power(-8, 1/3)` (canonical `Root(-8,3)`) compiles to literal `NaN` (interp: **-2**). `success: true` with a constant-wrong program.
- **Why:** `Root`/`Power`/`Sqrt` handlers fold with `String(Math.pow(...))`/`String(Math.sqrt(c))` without a negative-base/odd-n branch, and the runtime path uses `Math.pow` which is NaN for negative base + non-integer exponent. Interpreter uses the real-root convention for odd-n roots and rational powers with odd denominator.
- **Files:** `javascript-target.ts:426-437` (Root), `356-381` (Power fold at 366-369), `500-506` (Sqrt fold at 504); `python-target.ts:223-227`; `gpu-target.ts:757-766`.
- **Fix direction:** odd-n Root → `sign(x)*pow(abs(x),1/n)`; rational exponent p/q with odd q → sign-corrected pow; constant folds must go through the interpreter's own numeric (or at minimum refuse to fold and throw) instead of emitting `NaN`/wrong sign. For genuinely complex results (Sqrt(-4)) either emit the complex literal `({re:0,im:2})` (JS/GPU vec2 support exists) or throw.

### P0-5. Multi-index `Sum`/`Product` silently drops all but the first `Limits` clause
- **Repro (executed):** `Sum(i·j, Limits(i,1,3), Limits(j,1,3))`: interp **36**; compiled code is `((1 * _.j) + (2 * _.j) + (3 * _.j))` → `_.j` undefined → **NaN**, with `success: true` **and `freeSymbols: []`** (the reference analysis binds indices from *all* clauses, so the result claims self-containedness while the code dangles `_.j`).
- **Files:** `javascript-target.ts:1785-1868` (`compileSumProduct` reads only `args[1]`); same shape in `base-compiler.ts:841-921` (`compileLoop`) and `gpu-target.ts:130-219`; analysis mismatch at `base-compiler.ts:1125-1139`.
- **Fix direction:** iterate `args.slice(1)` and nest loops (the interpreter supports multi-index); until then, throw on `args.length > 2` so it falls back to interpretation.

### P0-6. Python: `Power(-2, x)` emits `-2 ** x` — sign-flipped result
- **Repro (executed):** compiled Python for `['Power', -2, 'x']` is `-2 ** x`; at x=2 Python evaluates `-(2**2)` = **-4.0**; interp = **4**. Root cause: `BaseCompiler.compile`'s number path (`base-compiler.ts:64-72`) emits negative literals unparenthesized regardless of the precedence context, and Python's `**` binds tighter than unary minus on its left operand. Same hazard for any folded negative symbol value used as a `**` base.
- **Fix direction:** in the number formatter / operator path, parenthesize negative numeric literals when emitted as operands at precedence ≥ the surrounding operator (or have PythonTarget's `number()` wrap negatives).

### P0-7. Python: `Remainder` emits `np.remainder`, which is floored mod, not IEEE remainder
- **Repro (executed):** `Remainder(7, 4)`: interp (IEEE, round-to-nearest quotient; `library/arithmetic.ts:1330-1344`) = **-1**; emitted `np.remainder(7,4)` = **3.0**. (JS target's `a - b*round(a/b)` is correct — verified agreeing at 8 point pairs.)
- **File:** `python-target.ts:247`. Fix: emit `(a - b * np.round(a / b))` (with P0-2's round caveat) or `math.remainder`.

### P0-8. Interpretation-fallback `run()` permanently corrupts engine state (assign leak)
- **Repro (executed):** declare `g: (number)->number`; `compile(ce.parse('g(x) + x'))` → `success:false` fallback; `run({x: 5})`; afterwards `ce.expr('x').evaluate()` is **5** engine-wide, forever. Any later `evaluate()` — or worse, later `compile()` which **folds** assigned values into generated code — silently uses the stale 5.
- **Why:** the fallback runner (`compilation/compile-expression.ts:146-156`) does `pushScope(); assign(k,v); …; popScope()`, but `ce.assign` mutates the binding in the scope where the symbol was *declared* (the outer/global scope where the expression was boxed), so `popScope` restores nothing. Verified minimal engine-level repro: `pushScope(); assign('x',42); popScope()` → x stays 42.
- **Fix direction:** snapshot-and-restore the previous values around the call (`const old = ce.expr(k).value` … reassign in `finally`), or declare fresh local bindings in the pushed scope before assigning, or evaluate via `expr.subs(...)`/`Apply` instead of scope mutation.

### P0-9. Non-canonical expressions compile to wrong-grouping code (missing associativity parentheses)
- **Repro (executed):** `ce.expr(['Divide','a',['Divide','b','c']], {canonical:false})` compiles to `_.a / _.b / _.c` → run(a=12,b=6,c=2) = **1**, expected **4**. `['Subtract','a',['Subtract','b','c']]` → `_.a - _.b - _.c` → **3**, expected **7**. `success: true`, silent wrong math.
- **Why:** the operator path (`base-compiler.ts:165-188`) parenthesizes only `op[1] < prec`; the **right** operand of a left-associative operator of *equal* precedence is never wrapped (only Power gets the right-assoc `+1` treatment). Canonical forms rarely produce these shapes, but `compile()` accepts non-canonical input without complaint (this is the documented way to preserve parse shape) — and the 0.59 changelog fixed exactly this class for Python `(a^b)^c`, so the shape is considered supported.
- **Fix direction:** compile the right operand of `-`/`/` at `op[1] + 1` (mirror of the Power fix), all targets at once since this is BaseCompiler.

---

## P1 — invalid emitted code with `success: true`, unclear failure modes, undocumented divergence

### P1-1. Python: `If`/`When`/`Which` emit JavaScript ternaries + bare `NaN` → SyntaxError, `success: true`
- **Repro (executed):** `If(x>0, 2x, -x)` → `((0 < x) ? (2 * x) : (-x))`; Python `SyntaxError`. `When` additionally emits bare `NaN` (undefined name in Python). The base compiler's JS-shaped defaults (`base-compiler.ts:235-306`) fire because `PYTHON_FUNCTIONS` has no `If`/`When`/`Which` entries.
- **Fix:** Python handlers emitting `(t if c else f)` and `float('nan')`.

### P1-2. Python: `And`/`Or` emit `and(a, b)` — keyword used as a function call → SyntaxError
- **Repro (executed):** `And(Not(x>0), x<5)` → `and(not(0 < x), x < 5)` → SyntaxError. Root cause: `base-compiler.ts:138` decides "function vs operator" by regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/` on the operator string — Python's `and`/`or`/`not` are identifiers, so the infix path is skipped. (`not(...)` survives only by accident of syntax.) Also **chained relations** (`Less(-1,x,1)`) emit hardcoded JS `') && ('` in `base-compiler.ts:162` — invalid Python (fine for GLSL/WGSL).
- **Fix:** per-target "wordy operator" flag (or target-provided joiner for relational chains); don't infer function-ness from spelling.

### P1-3. GPU: statement-block `Sum`/`Product` spliced into expressions → invalid shader, `success: true`
- **Repro (emission, executed compile):** `Add(1, Sum(1/i, i=1..200))` (loop path, >100 terms) emits
  `float _acc = 0.0;\nfor (...) {...}\nreturn _acc; + 1.0` — a statement list concatenated inside an expression, for both GLSL and WGSL. The loop form is only valid as a whole `compileFunction` body.
- **Files:** `gpu-target.ts:183-218`; consumed via operator path in `base-compiler.ts`.
- **Fix:** throw when a loop-form Sum/Product is not the root expression (or emit via a named preamble helper function and call it inline).

### P1-4. GPU `Loop` uses the `int` loop counter directly in float arithmetic → invalid GLSL/WGSL
- **Repro (emission):** `Loop(i·0.5, Element(i, Range(1,5)))` → `for (int i = 1; i <= 5; i++) { i * 0.5; }` — `int * float` is a type error in GLSL ES / WGSL. The Sum/Product path wraps `float(i)`/`f32(i)` (`gpu-target.ts:188-196`) but the `Loop` handler does not (`gpu-target.ts:1032-1035`).

### P1-5. WGSL `Argument` (real branch) emits a ternary — WGSL has no `?:`
- **Repro (emission):** `Argument(x)` → `(x >= 0.0 ? 0.0 : 3.14159265359)` under `to:'wgsl'`. Everything else was converted to `select(...)` in the 0.59 fix; this one was missed because it bypasses `gpuConditional`. File: `gpu-target.ts:526-532`.

### P1-6. GPU `Min`/`Max` with 3+ args emit variadic `min(x, 1.0, 2.0)` — invalid GLSL/WGSL (2-arg builtins)
- **Repro (emission):** `Min(x, 1, 2)` → `min(x, 1.0, 2.0)`. JS is fine (`Math.min` variadic). Fix: fold pairwise `min(min(x,1.0),2.0)`. File: `gpu-target.ts:414-415` (string mappings).

### P1-7. Complex-valued results/arguments in the real pipeline: silent NaN — or worse, garbage numbers
- **Repro (executed):**
  - Runtime branch crossings: `Sqrt(x)` at x<0, `Ln(x)` at x<0, `Power(x, 2.5)` at x<0, `x^x` at negative non-integer x — compiled **NaN**, interpreted returns the complex value (76 of the 136 JS fuzz disagreements). This is inherent to type-driven compilation but is **not documented** anywhere in the compilation docs (`MIGRATION_GUIDE_0.60.0.md` §7 presents complex support without stating the real-typed-symbol NaN divergence).
  - Worse: complex-**typed** args flow into real-only helpers without a guard: with `z: complex`, `Erf(z)` compiles to `_SYS.erf(_.z)` and returns **-1** (a plausible-looking wrong number, not NaN); `Max(z, 1)` → `Math.max(_.z, 1)` → NaN. Handlers with complex dispatch cover trig/exp/ln/sqrt only.
- **Fix direction:** document the divergence; for unguarded helpers, throw at compile time when an operand `isComplexValued` and no complex kernel exists (matches "fail clearly").

### P1-8. `Equal`/`NotEqual` compile to exact float `===` — interpreter uses tolerance
- **Repro (executed):** `Equal(x, 0.3)` at `x = 0.1+0.2`: interp **True**, compiled `0.30000000000000004 === 0.3` → **false**. Same for GPU `==` and Python `==`/`np.equal`. May be intentional for shaders but is undocumented and breaks `When`/`Which` guards that the interpreter would take. Files: `javascript-target.ts:112`, `gpu-target.ts:39-40`, `python-target.ts:26-27`.

### P1-9. Compiled `Zeta` helper is only ~1e-7 accurate (systematically beyond fp64 noise)
- **Repro (executed):** compiled `zeta(3)` = 1.20205**67979884** vs true 1.20205**69031595942** (rel err 8.7e-8); zeta(1.5), zeta(5) similar. The Cohen–Villegas–Zagier implementation in `numerics/special-functions.ts:1112-1145` appears to use wrong `d_k` coefficients (`d_k = Σ C(n,i)` partial binomial sums instead of the CVZ chebyshev-derived ones), capping accuracy. Interp (bignum path) is fully accurate. `digamma` also shows ~2e-8-2e-9 wobble (acceptable-ish; zeta is not).

### P1-10. Python target: options ignored, assigned symbols never folded, `freeSymbols` inconsistent with emitted code
- **Repro (executed):** with `ce.assign('a', 7)`, `compile(x+a, {to:'python'})` emits `a + x` (contract in `types.ts:172-186` says known symbols fold) while `freeSymbols` reports only `["x"]` — the result claims self-containedness but `a` is a dangling Python name. Also `vars: {x: 'data["x"]'}` is ignored (emitted `x + 1`) — `compileToSource` discards `_options` entirely (`python-target.ts:343-365` var fallback `return id`; `412-429`).
- **Fix:** make `var()` return `undefined` for unknown ids (mirrors the GPU target fix noted in its comments), and thread `vars`/`operators`/`functions` through `createTarget`.

---

## P2 — edge inconsistencies, missing tests, contract nits

- **P2-1. Sum/Product unrolling with negative index + `Negate`:** `Sum(-i, i=-3..-1)` substitutes the literal into `-${…}` producing `--3` → JS `SyntaxError` (caught → silently falls back to interpretation with a console.warn); GLSL/WGSL **emit** `((--3.0 + 2.0) + …)` with `success: true` (invalid shader). Substituted literals need parens when negative. `javascript-target.ts:1813-1817`, `gpu-target.ts:172-180`, root shared with P0-6.
- **P2-2. Division by zero / `0^0` / NaN-condition divergences (executed):** `1/0`: compiled `Infinity`, interp `~oo` (ComplexInfinity); `0^0`: compiled `Math.pow`→**1**, interp literal `Power(0,0).N()`→**NaN** (note: interp itself returns 1 via the assigned-value path — engine inconsistency); `Which`/`When` with NaN condition: compiled falsy→ default/NaN branch, interp **throws** `Condition must evaluate to "True" or "False"`. None documented.
- **P2-3. GLSL/WGSL reserved-word symbols emitted bare (emission):** free symbols named `sample`, `filter`, `in`, `texture` are emitted verbatim → shader keyword collision. Suggest a mangling scheme (`_v_sample`) with the mapping surfaced in `freeSymbols`.
- **P2-4. Chained relational operands compiled twice (emission):** `Less(0, Random(), 1)` → `(0 < Math.random()) && (Math.random() < 1)` — two different draws; also double-evaluates expensive/side-effecting middles. `base-compiler.ts:148-163`.
- **P2-5. Multiply/Divide flattening changes overflow order (executed):** `x·(y/z)` compiles to `x * y / z`; at x=y=z=1e300 compiled `Infinity`, interp `1e300`.
- **P2-6. `python` target documented but not registered:** `MIGRATION_GUIDE_0.60.0.md` §7 says `to:` accepts `'python'`; `engine-compilation-targets.ts:42-49` registers only javascript/glsl/wgsl/interval-js/interval-glsl → `compile(expr, {to:'python'})` throws "not registered". Register it or fix the doc.
- **P2-7. Compiled `Integrate` tolerance undocumented:** `_SYS.integrate` = Monte-Carlo with 1e7 samples (`javascript-target.ts:1334-1335`) → rel err ~1e-4-3e-5 and ~200ms per call; agrees with interpreted `.N()` only within joint MC noise. Works (docs' "Integrate compiles to NaN" limitation is stale — see P3-1) but the tolerance and cost should be documented.
- **P2-8. Boolean results & `realOnly`:** compiled relations return JS `true`/`false`; `realOnly: true` passes booleans through unchanged (contract says `number`). Interp returns True/False symbols. Harmless for `if` contexts, surprising for arithmetic consumers.
- **P2-9. Python `GammaLn` → `scipy.special.loggamma`** (complex log-gamma; differs from `gammaln` for negative args) and scipy import is emitted only under `useScipy` — generated code referencing `scipy.special.*` fails where scipy isn't installed (observed in repo venv).
- **P2-10. Missing parity tests:** the parity suite has no negative-operand `Mod`/`Round`/`Arccot`/odd-root points (which is why P0-1..P0-4 survived), no multi-index Sum, no non-canonical compile shapes.

## P3 — docs

- **P3-1.** `MIGRATION_GUIDE_0.60.0.md` "⚠️ Known compile limitations (still open in 0.60.0)" is stale: `Loop` now compiles and collects values (verified `[1,4,9,16]`), and `Function`-wrapped `Integrate` works (verified 0.3334 vs 1/3). Replace with the actual current caveats (MC tolerance, complex→NaN).
- **P3-2.** `Sequence` compiles to a comma expression `(1.0, 2.0)` in GLSL (evaluates to last element) and a tuple in Python — semantics differ per target, undocumented.

## Engine-side asides discovered while establishing references (for the interpreter reviewers, not compilation bugs)
- `.subs()` does not substitute into lazy collection arguments (`Mean`/`Median`/`Variance` lists) nor into `Integrate` bounds — `Median([x,2,4,8]).subs(x=10).N()` = 3 vs assign-based 6; `Zeta(x).subs(x=4).N()` = NaN while `Zeta(4).N()` is fine.
- `pushScope(); assign(sym, v); popScope()` does not scope the assignment when `sym` is declared in an outer scope (root cause of P0-8; also invalidates that pattern in user code).
- Interpreted `Power(0,0)`: literal → NaN, via assigned symbols → 1.
- Interpreted `Which`/`When` throw on non-boolean (NaN) conditions instead of returning undefined/NaN.

## Not re-reported (per instructions)
Interval-GLSL pad soundness/design (validated on-device June 2026); items in SYMBOLIC_FINDINGS.md / PERFORMANCE_FINDINGS.md. interval-js was checked only for parity semantics; its 3 disagreements are the shared P0-1/2/3 clusters, no *new* interval-algebra bugs found (1/[-1,1]→singular, 1/[0,0]→empty are defensible interval semantics).
