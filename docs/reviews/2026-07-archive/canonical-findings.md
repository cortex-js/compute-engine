# Canonicalization Boundary Cases — Correctness Review Findings

Reviewer area: transforms applied at boxing/canonicalization time, canonical/structural/non-canonical
mode contract, assumption-dependent identities at canonical time.
Repo: /Users/arno/dev/compute-engine @ main 9b818ec8. All findings have executed repros
(batteries in `scratchpad/canonical/battery*.ts`, run with `npx tsx` from the repo root).

Cross-referenced and NOT re-reported: x/x→1 (SYMBOLIC P1-11), 1^x→1 (known),
ln(x²)→2ln(x) (P0-2, simplify), e^(ln x)→x (documented intentional; note: observed only on
the evaluate path, canonical keeps `e^(ln x)`), Add(2,x,5)→Add(x,7) exact-folding contract
(verified: machine non-integer floats, ∞, NaN are indeed excluded from Add/Multiply folding).

---

## P0-1 Exact-integer overflow folds to NaN at canonicalization (`rationals.ts mul`)

**Repro**
```ts
ce.box(['Multiply', 1e200, 'x', 1e200])          // → "NaN * x"   (canonical, no evaluate)
ce.box(['Multiply', 1e200, 1e200]).evaluate()    // → NaN
ce.box(['Multiply', 1e308, 'x', 1e308]).N()      // → NaN
```
**Expected** `1e200` boxes as the *exact* integer 10^200 (typeof numericValue === 'number',
integer-valued double ⇒ exact per CE convention). The product is the exact integer 10^400 —
exactly what the Add path produces: `ce.box(['Add', 1e308, 'x', 1e308])` folds correctly to the
exact 309-digit bigint sum.

**Actual** `NaN * x`, silently, at canonical time. `.N()` is NaN too.

**Why** `src/compute-engine/numerics/rationals.ts:132` (in `mul()`): after computing the
machine product `n = lhs[0] * rhs[0]`, the code does
`if (!Number.isFinite(n) || !Number.isFinite(d)) return [NaN, 1];`
i.e. *overflow of finite inputs* is conflated with *non-finite inputs* (the legitimate NaN
guards are at lines 108–121). When both inputs are finite integer doubles, promotion via
`BigInt(lhs[0]) * BigInt(rhs[0])` is exact and is precisely what the next line does for the
`> MAX_SAFE_INTEGER but finite` case. The bigint path is only unreachable because the product
overflowed the double first.

Entry path: `canonicalMultiply` exact-numeric folding (`arithmetic-mul-div.ts:982-995`) →
`ExactNumericValue.mul` (`exact-numeric-value.ts:401`, keeps machine rational `[1e200, 1]`) →
`rationals.ts mul()`.

**Same pattern in `add()`** at `rationals.ts:99`. Mostly shielded in `ExactNumericValue.sum`
(the running sum promotes to bigint at the first unsafe-but-finite value), but reachable via
direct coefficient addition in `Terms.N()` (`arithmetic-add.ts:389`,
`coef.reduce((acc, x) => acc.add(x))`):
```ts
const e = ce.box(['Add', ['Multiply', 1.7e308, 'x'], ['Multiply', 1.7e308, 'x']]);
e.evaluate()  // → 3.39999…e308 · x   (exact, correct)
e.N()         // → NaN                (wrong; inconsistent with evaluate)
```

**Fix direction** In `mul()`/`add()`: test the *inputs* for finiteness (already done at the
top of `mul()` for the NaN encodings); if inputs are finite, always fall through to the BigInt
promotion instead of returning `[NaN, 1]` when the machine result is non-finite.

**Test** `expect(ce.box(['Multiply', 1e200, 1e200]).evaluate().toString()).toBe('1e+400')`
(exact bigint 10^400); `Add(1.7e308·x)·2 N()` regression above.

---

## P0-2 Canonical sort commutes symbolic matrix products

**Repro**
```ts
ce.declare('M', 'matrix'); ce.declare('P', 'matrix');
ce.box(['Multiply', 'P', 'M']).json   // → ["Multiply","M","P"]  — reordered!
ce.box(['Multiply', 'M', 'P']).isSame(ce.box(['Multiply', 'P', 'M']))  // true
ce.box(['Subtract', ['Multiply','M','P'], ['Multiply','P','M']]).evaluate()  // → 0  (!!)
```
Also with one concrete matrix: `Multiply(M, [[1,2],[3,4]])` and `Multiply([[1,2],[3,4]], M)`
canonicalize to the same expression (`isSame: true`). Vector·matrix symbolic pairs commute
too (`v1·v2` ≡ `v2·v1` for declared `vector`/`matrix`).

**Expected** Matrix multiplication is non-commutative; `M·P − P·M` (the commutator) is not 0.
The engine already knows the operands are matrices — `Power(M, 2)` routes to `MatrixPower`
at canonicalization using exactly this type information (`arithmetic-power.ts:147`).

**Actual** `canonicalMultiply` sorts all non-concrete-tensor operands
(`arithmetic-mul-div.ts:1104-1109`); the guard `isTensorOperand`
(`arithmetic-mul-div.ts:1118-1120`) only recognizes `isTensor(x)` (concrete literals) and
`isFunction(x, 'Matrix')`. Its comment says "Symbolic operands of unknown shape are
intentionally excluded" — but a symbol *declared* `matrix` is not of unknown shape-kind: the
type system knows it is a matrix, and the mathematically wrong identification `M·P = P·M`
(and `commutator = 0`) follows silently.

**Files** `src/compute-engine/boxed-expression/arithmetic-mul-div.ts:1104-1120`.

**Fix direction** Extend `isTensorOperand` to `x.type.matches('matrix')` /
`x.type.matches('vector')` (mirroring the `canonicalPower` matrix check), so declared-matrix
symbols keep their written order like concrete tensors already do. (True unknown/`number`
symbols keep current behavior.)

**Test** commutator repro above must not canonicalize to 0.

---

## P1-1 `evaluate()`/`N()` silently no-op on non-canonical expressions (documented contract violated)

**Repro**
```ts
ce.box(['Add', 1, 2], { canonical: false }).evaluate()  // → 1 + 2   (unchanged)
ce.box(['Add', 1, 2], { canonical: false }).N()         // → 1 + 2
ce.box(['Add', 1, 2], { canonical: false }).simplify()  // → 3       (simplify DOES canonicalize)
ce.box(['Divide', 2, 4], { canonical: false }).evaluate() // → 2 / 4
```
**Expected** `types-expression.ts:1731` documents `evaluate()` as "Return the value of the
**canonical form** of this expression" and line 1746 "The result is in canonical form."
The internal rule comment (`types-expression.ts:389`) says operations requiring a canonical
expression "should return undefined or throw" — returning `this` silently is neither.

**Actual** `BoxedFunction._computeValue` (`boxed-function.ts:1203`) bails with `return this`
when `!this._def` (non-canonical ⇒ unbound ⇒ no def). Callers using
`ce.parse(s, {canonical: false}) … .evaluate()` get the raw expression back with no signal.
`simplify()` behaving differently from `evaluate()`/`N()` makes the trio inconsistent.

**Fix direction** Either (a) make `evaluate()` on a bailable non-canonical expression delegate
to `this.canonical.evaluate()` per the docs, or (b) change the docs + make the no-op loud
(assert). (a) matches the documented contract and user expectation.

**Files** `src/compute-engine/boxed-expression/boxed-function.ts:1203`,
`src/compute-engine/types-expression.ts:1731-1749`.

---

## P1-2 Partial canonical forms: inconsistent bind status; `{form:['Flatten','Order']}` result unusable in arithmetic

**Repro**
```ts
const e = ce.box(['Add', 3, 2, 'x'], { form: ['Flatten', 'Order'] });
e.isCanonical  // false
e.isStructural // false   ← raw/unbound
e.mul(ce.symbol('y'))  // THROWS "Not canonical"
e.evaluate()           // no-op (see P1-1)
// but:
ce.box(['Add',3,2,'x'], { form: ['Add'] }).isStructural      // true — .mul works
ce.box(['Multiply',2,'x',3], { form: ['Multiply'] }).isStructural // true — .mul works
ce.box(['Divide','x',2], { form: ['Divide'] }).isStructural  // true — .mul works
ce.box(['Multiply',2,'ImaginaryUnit'], { form: ['Number'] }).isStructural // false — .mul throws
ce.box(['Power','x',['Rational',1,2]], { form: ['Power'] }).isStructural  // false — .mul throws
```
**Why wrong** `canonicalForm` (`canonical.ts:75-84`) itself documents "Partial
canonicalization produces a structural expression … allows subsequent .canonical calls",
but the structural re-wrap only fires when the top result is flagged canonical (which happens
for the Add/Multiply/Divide forms whose `canonicalAdd`/… output canonical-flagged nodes).
`flattenForm`, `numberForm`, and `powerForm` return `_fn(..., {canonical: false})` nodes, so
their results are raw/unbound. CLAUDE.md explicitly recommends
"`For sorting/flattening without numeric folding, use {form: ['Flatten','Order']}`" as the
alternative to structural mode — but its output throws in arithmetic where structural works.

**Fix direction** After the form loop, re-wrap *any* function result as structural (bind
without canonicalizing), not just the `isCanonical` ones.

**Files** `src/compute-engine/boxed-expression/canonical.ts:75-84, 94-125, 173-259, 305-314`.

---

## P1-3 `multiplyForm` (partial `'Multiply'` form) discards recursion into non-Multiply operators

**Repro**
```ts
ce.box(['f', ['Multiply', 'x', 2, 3]], { form: ['Multiply'] }).json
// → ["f",["Multiply","x",2,3]]  — inner Multiply NOT canonicalized
ce.box(['Add', ['Multiply', 'x', 2, 3], 'y'], { form: ['Multiply'] }).json
// → ["Add",["Multiply","x",2,3],"y"] — unchanged
// compare: addForm recurses correctly:
ce.box(['f', ['Add', 1, 2, 'x']], { form: ['Add'] }).json // → ["f",["Add","x",3]]
```
**Why** `canonical.ts:269-281`: `multiplyForm` computes `const ops = expr.ops.map(multiplyForm)`
but for a non-`Multiply`/`Negate` operator ends with `return expr;` — the mapped ops are thrown
away. Its own docstring says "Apply the 'Multiply' form **recursively**. Each sub-expression is
visited". `addForm`/`divideForm`/`powerForm` all rebuild with the mapped ops.

**Fix direction** `return expr.engine._fn(expr.operator, ops, { canonical: false });`
(matching `powerForm`; also note `addForm:294` and `divideForm:349` rebuild with `_fn`'s
default `canonical: true` flag while sibling forms pass `{canonical:false}` — harmless today
because `_fn` doesn't transform, but the flag inconsistency is what drives P1-2's
structural-vs-raw divergence and deserves unification in the same pass).

**Files** `src/compute-engine/boxed-expression/canonical.ts:269-281` (bug), 283-295 & 341-350
(flag inconsistency).

---

## P1-4 Generic-point folds at canonicalization: `x/0 → ~∞`, `0/x → 0`, `x/∞ → 0`, `2·0·x → 0`

**Repro (all canonical-time, no evaluate)**
```ts
ce.box(['Divide', 'x', 0])                    // → ComplexInfinity   (assumes x ≠ 0; 0/0 = NaN)
ce.box(['Divide', 'x', ['Subtract', 1, 1]])   // → ComplexInfinity   (1-1 folds to 0 first)
ce.box(['Divide', 0, 'x'])                    // → 0                 (assumes x ≠ 0 and x finite)
ce.box(['Divide', 'x', 'PositiveInfinity'])   // → 0                 (assumes x finite; ∞/∞ = NaN)
ce.box(['Multiply', 2, 0, 'x'])               // → 0                 (assumes x finite; 2·0·∞ = NaN)
ce.box(['Multiply', 0, 'x'])                  // → 0x  (stays!)      — inconsistent with the line above
```
Substitution traps (canonical-then-subs vs subs-then-canonical):
`Divide(x,0).subs({x:0})` → `~∞` but `Divide(0,0)` → `NaN`;
`Multiply(2,0,x).subs({x:∞})` → `0` but `Multiply(2,0,∞)` → `NaN`;
`Divide(x,∞).subs({x:∞})` → `0` but `Divide(∞,∞)` → `NaN`.

**Why flagged** These are assumption-dependent identities applied silently at canonicalization
for *symbolic* x whose value may be 0/∞/NaN. `x/0 → ~∞` is commented as "a/0 = ~∞ (a≠0)"
(`arithmetic-mul-div.ts:629-631`) — the a≠0 side condition is not checked for symbols. The
`0/x → 0` fold (`:634-643`) has a careful guard for constant *expressions* (0/(1-1) stays
structural) but none for symbols. Meanwhile the sibling indeterminate forms `0*x`, `x-x`,
`0^x`, `x^0` are all conservatively left symbolic at canonical time, so the convention is
internally inconsistent (most glaring: `0·x` stays but `2·0·x` folds to exact 0 because the
≥2-exact-numerics folding path in `canonicalMultiply` — `arithmetic-mul-div.ts:986-989` — checks
the *remaining* operands only for `isInfinity`/`isNaN`, treating a symbolic `x` as finite).

**Severity note** Likely intentional generic-point conventions (SymPy does some of these at
construction too), but they are *undocumented* and mutually inconsistent. Per charter this is
P1 (undocumented generic-point convention). The `2·0·x` vs `0·x` split is a genuine
inconsistency whichever convention is chosen.

**Files** `src/compute-engine/boxed-expression/arithmetic-mul-div.ts:629-663, 986-993`.

**Fix direction** Document the generic-point convention (docs + CLAUDE.md), and align the
`Multiply` zero-fold with the `0·x` behavior (either both fold or both stay; if folding, the
guard should be "no non-number operands" not just "no ∞/NaN literals").

---

## P1-5 InvisibleOperator mixed-number: magnitude-dependent semantic flip (Add vs Multiply)

**Repro**
```ts
ce.parse('2\\frac{999}{1000}').N()   // → 2.999   (interpreted as 2 + 999/1000)
ce.parse('2\\frac{1001}{1000}').N()  // → 2.002   (interpreted as 2 × 1001/1000)
ce.box(['InvisibleOperator', 2, ['Divide', 1, 2]])    // → 2 + 1/2   (Add)
ce.box(['InvisibleOperator', 'y', ['Divide', 1, 2]])  // → 1/2 · y   (Multiply)
```
**Why wrong** `invisible-operator.ts:23-45`: the mixed-number (implicit addition) reading
applies only when numerator ∈ (0, 1000] and denominator ∈ (1, 1000]. Crossing that arbitrary
threshold silently flips the operator from `Add` to `Multiply` — a discontinuous semantic
change in otherwise-identical syntax (`2\frac{999}{1000}` = 2.999 vs `2\frac{1001}{1000}` =
2.002). The heuristic itself (integer ⨯ literal-fraction ⇒ mixed number) is a documented
design choice, but the magnitude cliff is not documented anywhere user-visible, and no
warning/error is emitted.

**Severity** P1 (silent meaning assignment that changes the value); at minimum needs
documentation + a parser warning, or removal of the magnitude limit.

**Files** `src/compute-engine/boxed-expression/invisible-operator.ts:18-45`.

---

## P2-1 Exactness downgraded by complex capture in `canonicalAdd`

**Repro**
```ts
const e = ce.box(['Add', 2, ['Complex', 0, 3], 'x']);  // → x + (2 + 3i)
// the (2+3i) operand: type finite_complex, isExact: false
```
**Why wrong** Exact integer `2` + Gaussian-integer `3i` are captured into a *machine* complex
(`ce._numericValue({re, im})`, `arithmetic-add.ts:97-140`) whose `isExact` is false — while
`ExactNumericValue.sum` (exact-numeric-value.ts:838-840) explicitly treats Gaussian integers
as exact to avoid exactly this floatification ("otherwise an exact real summed with it would
floatify"). Downstream exact folding will now skip this value. Contrast: `Add(1/3, 3i, x)`
correctly keeps `1/3` exact and separate. No numeric error today (small integers are
representable), but the exactness *flag* is lost at canonicalization, which contradicts the
evaluate-exactness contract.

**Files** `src/compute-engine/boxed-expression/arithmetic-add.ts:76-140`.

---

## P2-2 Divide coefficient extraction manufactures exact values from floats (inconsistent with Add/Multiply float exclusion)

**Repro**
```ts
ce.box(['Divide', ['Multiply', 0.3, 'x'], ['Multiply', 0.1, 'y']])  // → (3x)/y  — exact 3!
ce.box(['Divide', 0.3, 0.1])                                        // → 0.3/0.1 (stays)
// note: 0.3/0.1 = 2.9999999999999996 in binary doubles
// toNumericValue(0.3·x) coefficient: BigNumericValue 0.3 (isExact false)
// coef.div(coef) → BigNumericValue 3, isExact TRUE
```
**Why flagged** At default precision the coefficients are `BigNumericValue`s carrying the
*decimal* value 0.3, so `0.3/0.1 → 3` "exactly", and `canonicalDivide`
(`arithmetic-mul-div.ts:795-820`) folds two inexact floats into an exact integer coefficient
at canonical time. Meanwhile `Add`/`Multiply` folding deliberately excludes machine floats,
and the plain `Divide(0.3, 0.1)` literal is left untouched. Whether decimal-reading of float
literals is desired or not, the three behaviors are mutually inconsistent, and an
`isExact: true` value is minted from two `isExact: false` inputs.

**Files** `src/compute-engine/boxed-expression/arithmetic-mul-div.ts:788-820`.

---

## P2-3 `x^(-1/n)` canonical form inconsistent: `1/√x` for n=2 but `Root(x, -3)` for n≥3

**Repro**
```ts
ce.box(['Power', 'x', ['Rational', -1, 2]])  // → ["Divide", 1, ["Sqrt", "x"]]
ce.box(['Power', 'x', ['Rational', -1, 3]])  // → ["Root", "x", -3]   (latex: \sqrt[-3]{x})
ce.box(['Divide', 1, ['Root', 'x', 3]])      // → ["Root", "x", -3]
```
**Why flagged** `canonicalPower` (`arithmetic-power.ts:346-358`) builds
`ce.function('Divide', [One, Root(x,n)])` and its comment states the canonical target form is
`1/Root(a, n)` — but `canonicalDivide`'s `1/a → a.inv()` rule collapses it to a
negative-degree `Root(x, -n)`, while the n=2 case survives as `Divide(1, Sqrt(x))`.
Evaluation is correct (`Root(8,-3)` → 1/2), and the two spellings do unify with each other,
but the canonical representation is irregular across n, the code comment no longer matches the
output, and the LaTeX serialization `\sqrt[-3]{x}` is unusual. P2 representation/doc
inconsistency, not a math error.

**Files** `src/compute-engine/boxed-expression/arithmetic-power.ts:346-358`,
`arithmetic-mul-div.ts:723-724`.

---

## P2-4 `parse('--x')` → `PreDecrement(x)` (test-locked)

**Repro** `ce.parse('--x').json` → `["PreDecrement","x"]`; evaluates inertly to
`PreDecrement(5)` with `x=5` (no value, no side effect). In LaTeX math input `--x` is far more
plausibly `-(-x) = x` (and `-(-x)` does parse to `x`). Test
`test/compute-engine/latex-syntax/operators.test.ts:205` locks the C-style reading.
Flagging per charter as a test locking a questionable expectation; the inert evaluation makes
it low-impact. P2/P3.

---

## P3 notes / verified-correct behaviors

- **Order stability** ✓: Add/Multiply built in any operand order produce identical canonical
  JSON (`batteryB`), including mixed exact/float operand sets; concrete tensor operands keep
  written order with scalars floated ✓.
- **Flatten multiplicity** ✓: `Add(x,Add(x,x),x)` → 4 x's; `Multiply` likewise; no operand loss.
- **Idempotence** ✓: `canonical(canonical(e)) === canonical(e)` (identical reference) on all
  probed shapes, incl. via `.canonical` on raw and structural forms.
- **Float/∞/NaN exclusion from Add/Multiply folding** ✓ (`Add(0.1,x,0.2)` stays; `Add(∞,x,-∞)`
  stays and evaluates to NaN; `Multiply(0,NaN)` stays). Note integer-valued doubles (1e308)
  are treated as exact integers by design and *do* fold (Add path exact ✓; Multiply path
  broken — P0-1).
- **Branch-cut guards at canonical time** ✓: `(x^2)^(1/2)` stays nested; `(x^a)^b` stays;
  `Sqrt(-4)` stays symbolic at canonical (evaluates to 2i); `(-8)^(1/3)` → `Root(-8,3)` → -2
  (real-root convention, documented); `Root(-16,4).N()` → principal complex ✓;
  `(a/b)^(-1/2)` not distributed ✓; `(-u)^(1/2)` not split ✓.
- **Mode contract basics** ✓: `{canonical:false}` preserved raw JSON on all 9 probes;
  structural binds and allows arithmetic; non-canonical `.mul()` throws "Not canonical" as
  documented; `_fn('Multiply',[1,x])` flags canonical without transforming (documented).
- **Constant-expression division guard** ✓: `0/(tan(π/2))` and `tan(π/2)/tan(π/2)` stay
  structural at canonical, evaluate to NaN. (But exact-foldable constants like `1-1` reduce to
  0 before the guard — see P1-4.)
- **library canonical handlers probed** (Abs, Arg, Conjugate, Re/Im, Ln/Exp compositions, trig
  at special angles, Floor, Max/Min, Which): no domain-sensitive rewrites at canonical time
  found; all stay symbolic. `Ln(1) → 0` (always valid) and alias mappings (Lg/Lb/Log2/Log10 →
  Log) are the only canonical-time rewrites — benign.
- `x·(1/x)`, `x/x²`, `(x²-1)/(x-1)`, `x-x`, `0^x`, `x^0`, `0^0→NaN`, `1^∞→NaN` all behave
  conservatively/consistently at canonical time.
- `InvisibleOperator(2, i)` → 2i ✓; `f(2,1)` (commas) → function call + auto-declare ✓;
  undeclared `f(x)` single numeric arg → `f·x` multiplication (documented heuristic in
  invisible-operator.ts:113-122; silent meaning assignment, but deliberate).
- `Divide(∞, x)` stays symbolic (sign unknown) ✓ and `∞/√π → +∞` ✓ (documented in code).
- `Rational(4,-6)` → -2/3, `Divide(-x,-y)` → x/y, `Negate(Negate(x))` → x ✓.
